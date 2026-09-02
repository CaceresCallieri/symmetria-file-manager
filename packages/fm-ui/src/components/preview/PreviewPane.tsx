import type { EntrySummary } from "@symmetria/fm-core/entry";
import type { PreviewRoute } from "@symmetria/fm-core/preview/route";

import { FileIcon } from "../FileIcon.tsx";
import { AudioPreview } from "./AudioPreview.tsx";
import { CodePreview } from "./CodePreview.tsx";
import { DocumentPreview } from "./DocumentPreview.tsx";
import { ImagePreview } from "./ImagePreview.tsx";
import { TextPreview } from "./TextPreview.tsx";
import { VideoPreview } from "./VideoPreview.tsx";

export interface PreviewPaneProps {
  readonly route: PreviewRoute;
  readonly path: string | null;
  readonly size: number;
  /** Why there is nothing to show, when there is a reason. */
  readonly error?: string | null;
  /**
   * Whether the user has asked the audio under the cursor to play.
   *
   * Owned by `App` rather than by the pane, because clearing it needs to know
   * where the cursor is and the pane does not. It must survive a re-render and
   * must NOT survive a move to another file, which is why `App` stores it as a
   * path rather than as a flag.
   */
  readonly audioPlaying?: boolean;
}

/** A size a person can read. */
function humanSize(bytes: number): string {
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Render whatever the router chose.
 *
 * The router decides; this only draws. Keeping the decision out of here is what
 * lets a second consumer — the fuzzy finder's info pane, next — show the same
 * previews without re-deriving which one applies. In the Qt build that
 * separation is why a preview type added once appeared in both panes.
 */
export function PreviewPane({ route, path, size, error, audioPlaying }: PreviewPaneProps) {
  return (
    <div className="list preview-pane" data-testid="column-preview" data-kind={route.kind}>
      {error == null ? (
        body(route, path, size, audioPlaying === true)
      ) : (
        <p className="preview__failed" data-testid="preview-error">
          {error}
        </p>
      )}
    </div>
  );
}

function body(route: PreviewRoute, path: string | null, size: number, audioPlaying: boolean) {
  if (path === null || route.kind === "none") return null;
  return contents(route, path, audioPlaying) ?? notice(route, size);
}

/** The branches that render the file itself. */
function contents(route: PreviewRoute, path: string, audioPlaying: boolean) {
  switch (route.kind) {
    case "image":
      return <ImagePreview path={path} mime={route.mime} />;
    case "document":
      return <DocumentPreview path={path} mime={route.mime} />;
    case "video":
      return <VideoPreview path={path} mime={route.mime} />;
    case "audio":
      return <AudioPreview path={path} mime={route.mime} playing={audioPlaying} />;
    case "code":
      return <CodePreview path={path} language={route.language} />;
    case "text":
      return <TextPreview path={path} />;
    default:
      return null;
  }
}

/**
 * A directory, listed.
 *
 * A directory is not a file, so reading it as one would show nothing — but a
 * count is a fact ABOUT the directory rather than the directory itself, and
 * Miller columns are three columns precisely because the third shows what
 * entering would reveal.
 *
 * The rows reuse `.row` and `FileIcon` so a folder looks the same here as it
 * does in the two navigable columns. They are deliberately NOT `FileRow`: that
 * component takes a cursor and a mark, and this column has neither — passing
 * `false` for both would imply a cursor could live here.
 */
function directoryListing(entries: readonly EntrySummary[], total: number) {
  const hidden = total - entries.length;

  return (
    <div data-testid="preview-directory" className="preview preview--directory">
      {entries.length === 0 ? (
        <p className="preview__empty">empty</p>
      ) : (
        <div className="preview__listing">
          {entries.map((entry) => (
            <div
              key={entry.name}
              data-testid="preview-entry"
              className="row"
              data-kind={entry.kind}
            >
              <FileIcon name={entry.name} kind={entry.kind} />
              <span className="row__name">{entry.name}</span>
            </div>
          ))}
        </div>
      )}
      {hidden > 0 ? <p className="preview__truncated">and {hidden} more</p> : null}
    </div>
  );
}

/** The branches that describe the entry instead of showing it. */
function notice(route: PreviewRoute, size: number) {
  if (route.kind === "directory") return directoryListing(route.entries, route.entryCount);

  // Naming what is missing is a different statement from showing a size and
  // hoping the reader works it out.
  if (route.kind === "unbuilt") {
    return (
      <p data-testid="preview-unbuilt">
        no {route.what} preview yet — {humanSize(size)}
      </p>
    );
  }

  const mime = route.kind === "fallback" ? route.mime : null;
  return (
    <p data-testid="preview-fallback">
      {mime ?? "unknown type"} — {humanSize(size)}
    </p>
  );
}
