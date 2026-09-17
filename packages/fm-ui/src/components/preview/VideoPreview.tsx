import { useEffect, useRef, useState } from "react";

import { usePreviewUrl } from "./previewUrl.ts";
import type { PreviewVariant } from "./variant.ts";

export interface VideoPreviewProps {
  readonly path: string;
  readonly mime: string;
  readonly variant?: PreviewVariant;
}

/**
 * A video, initially muted. The column loops; the reader offers native controls.
 *
 * Parity with the Qt build's `VideoPreview.qml`, which autoplays and loops
 * forever and attaches no audio output at all. The column preserves that
 * behavior; the reader lets the user control playback:
 *
 * - **`muted`** decides whether anything happens. Chromium blocks autoplay with
 *   sound, so an unmuted element refuses to start and reports nothing.
 * - **`loop`** repeats the column preview. The reader drops it so a clip ends.
 * - **`controls`** lets the reader pause, seek, and unmute deliberately.
 * - **`playsInline`** stops a host that honours it from going fullscreen.
 *
 * The browser does the decoding, which is why this file contains no codec
 * knowledge: measured on Electron 41, Chromium plays H.264, HEVC, AV1, VP8,
 * VP9 and Matroska carrying H.264. A container it cannot decode raises `error`
 * and takes the failure path below, which is the same path a file whose name
 * lies about its contents takes.
 */
export function VideoPreview({ path, mime, variant = "column" }: VideoPreviewProps) {
  const url = usePreviewUrl(path);
  const element = useRef<HTMLVideoElement | null>(null);

  // The failure is remembered AS a path, not as a flag an effect resets. A flag
  // needs clearing when the file changes, and an effect that only clears it
  // reads none of what it depends on; comparing paths makes "this failure
  // belongs to that file" the value itself. Taken from `ImagePreview`, where
  // verification found the version without it failing in total silence.
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const failed = failedPath === path;

  /**
   * Whether showing the window again should resume playback.
   *
   * A ref, not a closure local. The effect below re-runs whenever `url`
   * changes, and a grant renewal hands the SAME file a new URL — a local would
   * reset to `true` there and quietly turn a reader pause back into "resume on
   * show". Only a new `path` is a new intent, so only a new `path` resets it.
   *
   * Reset while rendering rather than from an effect of its own: the effect
   * form only mutates a ref, so `useExhaustiveDependencies` reads `[path]` as
   * a dependency more than the body needs and rejects it.
   */
  const resume = useRef(true);
  const intentPath = useRef(path);
  if (intentPath.current !== path) {
    intentPath.current = path;
    resume.current = true;
  }

  /**
   * Stop decoding while nobody can see it.
   *
   * The window is a resident daemon — hidden far more often than it is closed —
   * and autoplay on every cursor settle would otherwise leave it decoding video
   * for as long as it stays hidden. This is the bound that makes parity
   * affordable, and it is deliberately NOT a size limit: a small file hidden
   * for an hour costs more than a large one watched for a second.
   *
   * **The state is applied on arrival too, not only on the transition.** A
   * listener alone covers the window being hidden while a video plays, and
   * misses the case that actually happens more often: the window is ALREADY
   * hidden and the cursor moves, mounting a fresh element whose `autoPlay`
   * starts decoding with no transition left to stop it. Found in review.
   *
   * The arrival path pauses the element DIRECTLY rather than calling
   * `applyVisibility`, and that is the whole reason it does not reuse it: at
   * mount autoplay may not have started, so the element reads as paused, and
   * `applyVisibility` would record that initial state as a user pause and then
   * never play the clip again.
   *
   * **It depends on `url`, and an empty dependency list is WRONG here.** The
   * first render has no `<video>` at all — the component shows "reading…" until
   * the main process answers — so an effect that runs once runs while the ref
   * is still null, returns immediately, and never runs again once the element
   * exists. That is not a theory: written with `[]`, the guard below caught it,
   * and the already-hidden case stayed unfixed while looking fixed. Keying on
   * `url` also re-applies the state for each new file, which is what a pane the
   * cursor moves through needs.
   */
  useEffect(() => {
    // Nothing to apply before the URL arrives: until then this component renders
    // "reading…" and there is no element to pause. Reading `url` here is also
    // what makes it an honest dependency rather than a bare trigger the linter
    // would strip.
    if (url === null) return;

    const applyVisibility = () => {
      const video = element.current;
      if (video === null) return;

      if (document.visibilityState === "hidden") {
        // Reader controls make a user pause authoritative across hide/show.
        // The column has no controls and retains its continuous autoplay.
        // An ended element already reports `paused`, so the ended case needs no
        // term of its own here.
        resume.current = variant === "column" || !video.paused;
        video.pause();
        return;
      }
      // `play()` rejects when the element has no source yet or the document is
      // still not allowed to autoplay. Neither is an error worth surfacing in a
      // preview pane, and an unhandled rejection would reach the console.
      if (resume.current) void video.play().catch(() => undefined);
    };

    // At first mount autoplay may not have started yet. Pause without
    // mistaking that initial paused state for a user pause.
    if (document.visibilityState === "hidden") element.current?.pause();

    document.addEventListener("visibilitychange", applyVisibility);
    return () => document.removeEventListener("visibilitychange", applyVisibility);
  }, [url, variant]);

  if (url === null) return <div data-testid="preview-loading">reading…</div>;

  if (failed) {
    return (
      <p className="preview__failed" data-testid="preview-video-failed">
        not a playable {mime} video
      </p>
    );
  }

  return (
    <div className="preview preview--video" data-testid="preview-video">
      {/* `object-fit: contain` in the stylesheet keeps the aspect ratio, which
          is why no width or height is set here. There is no external caption
          source in the preview contract, so no empty track is invented. */}
      <video
        ref={element}
        src={url}
        autoPlay
        loop={variant === "column"}
        controls={variant === "reader"}
        muted
        playsInline
        data-testid="preview-video-element"
        onError={() => setFailedPath(path)}
      />
    </div>
  );
}
