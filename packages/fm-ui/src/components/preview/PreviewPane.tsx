import type { EntrySummary } from "@symmetria/fm-core/entry";
import type { PreviewRoute, RenderableAs } from "@symmetria/fm-core/preview/route";

import { FileIcon } from "../FileIcon.tsx";
import { ArchivePreview } from "./ArchivePreview.tsx";
import { AudioPreview } from "./AudioPreview.tsx";
import { CodePreview } from "./CodePreview.tsx";
import { DocumentPreview } from "./DocumentPreview.tsx";
import { humanSize } from "./humanSize.ts";
import { ImagePreview } from "./ImagePreview.tsx";
import { MarkdownPreview } from "./MarkdownPreview.tsx";
import { SpreadsheetPreview } from "./SpreadsheetPreview.tsx";
import { TextPreview } from "./TextPreview.tsx";
import { VideoPreview } from "./VideoPreview.tsx";

export interface PreviewPaneProps {
  readonly route: PreviewRoute;
  readonly path: string | null;
  readonly size: number;
  /** Why there is nothing to show, when there is a reason. */
  readonly error?: string | null;
  /**
   * Whether this file has a rendered form, and which.
   *
   * Beside the route rather than inside it: the route says what KIND of thing
   * the file is, and this says whether that kind has a second presentation.
   * See `renderableAs` in the shared router.
   */
  readonly renderAs?: RenderableAs | null;
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

/**
 * Render whatever the router chose.
 *
 * The router decides; this only draws. Keeping the decision out of here is what
 * lets a second consumer — the fuzzy finder's info pane, next — show the same
 * previews without re-deriving which one applies. In the Qt build that
 * separation is why a preview type added once appeared in both panes.
 */
export function PreviewPane({
  route,
  path,
  size,
  error,
  renderAs,
  audioPlaying,
}: PreviewPaneProps) {
  return (
    <div
      className="list preview-pane"
      data-testid="column-preview"
      data-kind={route.kind}
      data-rendered={renderAs ?? undefined}
    >
      {error == null ? (
        body(route, path, size, audioPlaying === true, renderAs ?? null)
      ) : (
        <p className="preview__failed" data-testid="preview-error">
          {error}
        </p>
      )}
    </div>
  );
}

function body(
  route: PreviewRoute,
  path: string | null,
  size: number,
  audioPlaying: boolean,
  renderAs: RenderableAs | null,
) {
  if (path === null || route.kind === "none") return null;
  return contents(route, path, size, audioPlaying, renderAs) ?? notice(route, size);
}

/**
 * A text file: its rendered form where it has one, its source otherwise.
 *
 * Split out of the switch below rather than nested inside its `code` case. The
 * pane is measured as one function by the complexity gate, and the gate was
 * right to push here — "which of three ways to show text" is a decision worth
 * reading on its own.
 */
function textual(path: string, language: string | null, renderAs: RenderableAs | null) {
  if (renderAs === "markdown") return <MarkdownPreview path={path} />;
  return language === null ? (
    <TextPreview path={path} />
  ) : (
    <CodePreview path={path} language={language} />
  );
}

/**
 * The branches that render the file itself.
 *
 * `size` is passed through for the archive branch alone: a zip's index is at
 * the END of the file, so reading one starts from its length — and the scan
 * already knows it, which saves the pane a round trip to ask.
 */
function contents(
  route: PreviewRoute,
  path: string,
  size: number,
  audioPlaying: boolean,
  renderAs: RenderableAs | null,
) {
  switch (route.kind) {
    case "image":
      return <ImagePreview path={path} mime={route.mime} />;
    case "document":
      return <DocumentPreview path={path} mime={route.mime} />;
    case "video":
      return <VideoPreview path={path} mime={route.mime} />;
    case "audio":
      return <AudioPreview path={path} mime={route.mime} playing={audioPlaying} />;
    case "spreadsheet":
      return <SpreadsheetPreview path={path} mime={route.mime} />;
    case "archive":
      return (
        <ArchivePreview
          path={path}
          format={route.format}
          compression={route.compression}
          size={size}
        />
      );
    case "code":
      return textual(path, route.language, renderAs);
    case "text":
      return textual(path, null, renderAs);
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
