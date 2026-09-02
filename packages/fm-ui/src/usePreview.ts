import { isFailure } from "@symmetria/fm-core/contract";
import type { MimeTables } from "@symmetria/fm-core/mime";
import { type PreviewRoute, routePreview } from "@symmetria/fm-core/preview/route";
import { useEffect, useMemo, useState } from "react";
import { describeEntry } from "./bridge.ts";
import type { PreviewPaneProps } from "./components/preview/PreviewPane.tsx";
import { useAudioPlayback } from "./useAudioPlayback.ts";

/**
 * What to show for the entry under the cursor, after it stops moving.
 *
 * **Debounced at 150 milliseconds**, the figure the Qt original used. Holding
 * `j` through a directory would otherwise `stat`, resolve a MIME type and read
 * a head for every entry passed over — work for a preview nobody sees, and on a
 * network mount it is work that arrives long after the cursor has left.
 */
export const PREVIEW_DEBOUNCE_MS = 150;

/**
 * The MIME tables, as the renderer sees them.
 *
 * The renderer never reads the database — the main process resolves each
 * entry's type and sends it. What is left for the router is inheritance, and
 * that needs the tables. Rather than ship a second copy of a several-thousand
 * row database into the renderer, the router is handed the small subset the
 * branch tests actually consult.
 *
 * The consequence, stated plainly: a type whose image-ness or text-ness is only
 * derivable through a subclass chain NOT listed here falls through to the
 * content sniff, which is the same answer the Qt build gave for an unregistered
 * type. It is a smaller table, not a wrong one.
 */
const RENDERER_TABLES: MimeTables = {
  globs: [],
  subclasses: new Map([
    ["image/svg+xml", ["application/xml"]],
    ["application/xml", ["text/plain"]],
    ["text/markdown", ["text/plain"]],
    ["application/json", ["application/javascript"]],
    ["application/javascript", ["text/plain"]],
    ["application/x-shellscript", ["text/plain"]],
    ["text/x-shellscript", ["text/plain"]],
    ["application/x-compressed-tar", ["application/x-tar"]],
    ["application/x-gtar", ["application/x-tar"]],
  ]),
  aliases: new Map([
    ["application/x-yaml", "application/yaml"],
    ["text/xml", "application/xml"],
  ]),
};

export interface Preview {
  readonly route: PreviewRoute;
  /** The path the route describes, so a consumer can read the file itself. */
  readonly path: string | null;
  readonly size: number;
  /**
   * Why there is no preview, when there is a reason.
   *
   * A file the process cannot stat — no permission, or gone between the cursor
   * landing and the read — used to produce an empty column indistinguishable
   * from an empty file. Saying so is the difference between "nothing here" and
   * "I could not look".
   */
  readonly error: string | null;
}

const NOTHING: Preview = { route: { kind: "none" }, path: null, size: 0, error: null };

/**
 * Decide what to preview for `path`, once the cursor has settled on it.
 *
 * Not exported: `usePreviewPane` below is the whole of what a caller needs, and
 * a second entry point that returns half of it invites an assembly step to be
 * written twice.
 */
function usePreview(path: string | null): Preview {
  const [preview, setPreview] = useState<Preview>(NOTHING);

  useEffect(() => {
    if (path === null) {
      setPreview(NOTHING);
      return;
    }

    let current = true;
    const timer = setTimeout(() => {
      void describeEntry(path).then((reply) => {
        // The cursor moved on while the read was in flight. Showing this now
        // would put the wrong file's preview beside the right file's name.
        if (!current) return;

        if (isFailure(reply)) {
          setPreview({ route: { kind: "none" }, path, size: 0, error: reply.error.message });
          return;
        }
        setPreview({
          route: routePreview(RENDERER_TABLES, reply.value),
          path,
          size: reply.value.size,
          error: null,
        });
      });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [path]);

  return preview;
}

/** Everything the preview column needs, and the one action it can be sent. */
export interface PreviewWiring {
  /** The routed preview itself, for callers that ask questions about it. */
  readonly preview: Preview;
  /** Straight through to the pane. Assembled here rather than in the caller. */
  readonly pane: PreviewPaneProps;
  /** What `Ctrl+P` calls. */
  readonly toggleAudio: () => void;
}

/**
 * The preview column, wired.
 *
 * Two hooks that were called side by side in `App` and whose results were then
 * hand-assembled into one prop object there. Composing them here says what was
 * already true — the playback request is part of what the preview column is —
 * and it keeps the application's root a list of regions rather than a list of
 * regions plus the plumbing between two of them.
 */
export function usePreviewPane(cursorPath: string | null): PreviewWiring {
  const preview = usePreview(cursorPath);
  const audio = useAudioPlayback(cursorPath, preview.path);

  const pane = useMemo<PreviewPaneProps>(
    () => ({
      route: preview.route,
      path: preview.path,
      size: preview.size,
      error: preview.error,
      audioPlaying: audio.playing,
    }),
    [preview, audio.playing],
  );

  return useMemo(
    () => ({ preview, pane, toggleAudio: audio.toggle }),
    [preview, pane, audio.toggle],
  );
}
