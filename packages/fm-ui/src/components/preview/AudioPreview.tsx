import { formatDuration } from "@symmetria/fm-core/preview/duration";
import { useEffect, useRef, useState } from "react";

import type { TagsRequest, TagsResponse } from "../../tags.worker.ts";
import { usePreviewUrl } from "./previewUrl.ts";
import { useMediaProgress } from "./useMediaProgress.ts";

export interface AudioPreviewProps {
  readonly path: string;
  readonly mime: string;
  /** Whether the user has asked for this file to be playing. Owned by `App`. */
  readonly playing: boolean;
}

/**
 * One worker for the whole application.
 *
 * Started on first use and never torn down, exactly as the highlighter is: this
 * pane reads tags for nearly every audio file the cursor rests on, and spawning
 * a worker per file would cost more than the parsing. Created lazily so a
 * session that previews no audio never pays for it, and so a host without
 * workers — or a test environment — is not required to have one.
 */
let worker: Worker | null = null;

function tagReader(): Worker | null {
  if (worker !== null) return worker;
  if (typeof Worker === "undefined") return null;

  worker = new Worker(new URL("../../tags.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

/**
 * Drop the shared worker.
 *
 * For tests, which must not inherit another test's worker — the same reason
 * `forgetPreviewTokens` exists in the main process.
 */
export function forgetTagsWorker(): void {
  worker?.terminate();
  worker = null;
}

interface Tags {
  readonly title: string;
  readonly artist: string;
  readonly durationSeconds: number;
  readonly artUrl: string | null;
}

const NO_TAGS: Tags = { title: "", artist: "", durationSeconds: 0, artUrl: null };

/**
 * What the file says about itself, or nothing.
 *
 * Returns `NO_TAGS` while the answer is in flight AND when it never comes, and
 * the two are deliberately the same value: the pane draws the file either way,
 * so a caller has nothing to do differently.
 */
function useAudioTags(url: string | null): Tags {
  const [tags, setTags] = useState<Tags>(NO_TAGS);
  const nextId = useRef(0);

  useEffect(() => {
    // Clearing FIRST is what stops the previous file's title sitting under the
    // next file's name for as long as the parse takes.
    setTags(NO_TAGS);
    if (url === null) return;

    const instance = tagReader();
    if (instance === null) return;

    const id = ++nextId.current;
    let artUrl: string | null = null;

    const onMessage = (event: MessageEvent<TagsResponse>) => {
      // A stale answer belongs to a file the cursor has already left.
      if (event.data.id !== id) return;

      const picture = event.data.picture;
      if (picture !== null) {
        artUrl = URL.createObjectURL(new Blob([picture.bytes], { type: picture.mime }));
      }
      setTags({
        title: event.data.title,
        artist: event.data.artist,
        durationSeconds: event.data.durationSeconds,
        artUrl,
      });
    };

    instance.addEventListener("message", onMessage);
    const request: TagsRequest = { id, url };
    instance.postMessage(request);

    return () => {
      instance.removeEventListener("message", onMessage);
      // A resident application previews thousands of files in a session, so a
      // blob URL kept per cover art is a real leak rather than a tidy-up.
      if (artUrl !== null) URL.revokeObjectURL(artUrl);
    };
  }, [url]);

  return tags;
}

/** The last path segment. The fallback title, and always available. */
function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * A sound file: what it is, and a way to hear it.
 *
 * Laid out like the Qt build's `AudioPreview.qml` — art, then title and artist,
 * then the transport — and it differs from the video pane in one deliberate
 * way: **there is no `autoPlay`**. Sound starting by itself as the cursor moves
 * through a directory is an interruption, not a preview, which is why the Qt
 * original sets `autoPlay: false` too. `Ctrl+P` is the only thing that starts
 * it, and the state behind that lives in `App` because it has to be cleared
 * when the cursor moves and only `App` knows where the cursor is.
 *
 * **This component is NOT remounted when the cursor moves between two audio
 * files.** Only its `path` prop changes, because the pane renders the same
 * component at the same position. An earlier comment here claimed the opposite
 * and every piece of state below was written trusting it — which is how the
 * duration and the playhead came to belong to whichever file had been shown
 * previously. Anything that describes the FILE is stored with the URL it
 * describes.
 */
export function AudioPreview({ path, mime, playing }: AudioPreviewProps) {
  const url = usePreviewUrl(path);
  const tags = useAudioTags(url);
  const element = useRef<HTMLAudioElement | null>(null);
  const progress = useMediaProgress(url, tags.durationSeconds);

  /**
   * Follow the play/pause request from above.
   *
   * Keyed on `url` as well as `playing` for the reason the video pane records
   * in full: the first render has no element at all, so an effect that runs
   * before the file arrives finds a null ref and never runs again.
   */
  useEffect(() => {
    const audio = element.current;
    if (audio === null || url === null) return;

    if (playing) {
      // `play()` rejects when the element has no source yet, which is not an
      // error worth surfacing in a preview pane — and an unhandled rejection
      // would reach the console.
      void audio.play().catch(() => undefined);
      return;
    }
    audio.pause();
  }, [playing, url]);

  if (url === null) return <div data-testid="preview-loading">reading…</div>;

  const duration = progress.duration;
  const length = duration === null ? "" : formatDuration(duration);

  return (
    <div className="preview preview--audio" data-testid="preview-audio">
      <div className="preview__art">
        {tags.artUrl === null ? (
          <div className="preview__art-placeholder" data-testid="preview-audio-art-placeholder">
            ♪
          </div>
        ) : (
          <img src={tags.artUrl} alt="" data-testid="preview-audio-art" />
        )}
      </div>

      <p className="preview__title" data-testid="preview-audio-title">
        {tags.title === "" ? fileNameOf(path) : tags.title}
      </p>
      <p className="preview__artist" data-testid="preview-audio-artist">
        {tags.artist}
      </p>
      <p className="preview__duration" data-testid="preview-audio-duration">
        {length === "" ? mime : length}
      </p>

      <input
        className="preview__seek"
        data-testid="preview-audio-seek"
        type="range"
        min={0}
        max={duration ?? 0}
        step="any"
        value={progress.position}
        aria-label="Seek"
        disabled={duration === null}
        onChange={(event) => {
          const seconds = Number(event.target.value);
          progress.reportPosition(seconds);
          if (element.current !== null) element.current.currentTime = seconds;
        }}
      />

      {/* biome-ignore lint/a11y/useMediaCaption: a preview of a sound file the
          user is pointing at has no caption track to offer, and an empty one
          would announce itself for nothing. */}
      <audio
        ref={element}
        src={url}
        data-testid="preview-audio-element"
        onTimeUpdate={(event) => progress.reportPosition(event.currentTarget.currentTime)}
        // `durationchange` as well as `loadedmetadata`: a stream reports
        // `Infinity` first and a real length later, and only the second is
        // usable — `useMediaProgress` discards the non-finite one.
        onLoadedMetadata={(event) => progress.reportDuration(event.currentTarget.duration)}
        onDurationChange={(event) => progress.reportDuration(event.currentTarget.duration)}
      />
    </div>
  );
}
