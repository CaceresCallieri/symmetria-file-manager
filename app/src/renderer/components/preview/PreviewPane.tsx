import type { PreviewRoute } from "@symmetria/fm-core/preview/route";

import { CodePreview } from "./CodePreview.tsx";
import { DocumentPreview } from "./DocumentPreview.tsx";
import { ImagePreview } from "./ImagePreview.tsx";
import { TextPreview } from "./TextPreview.tsx";

export interface PreviewPaneProps {
  readonly route: PreviewRoute;
  readonly path: string | null;
  readonly size: number;
  /** Why there is nothing to show, when there is a reason. */
  readonly error?: string | null;
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
export function PreviewPane({ route, path, size, error }: PreviewPaneProps) {
  return (
    <div className="list preview-pane" data-testid="column-preview" data-kind={route.kind}>
      {error == null ? (
        body(route, path, size)
      ) : (
        <p className="preview__failed" data-testid="preview-error">
          {error}
        </p>
      )}
    </div>
  );
}

function body(route: PreviewRoute, path: string | null, size: number) {
  if (path === null || route.kind === "none") return null;
  return contents(route, path) ?? notice(route, size);
}

/** The branches that render the file itself. */
function contents(route: PreviewRoute, path: string) {
  switch (route.kind) {
    case "image":
      return <ImagePreview path={path} mime={route.mime} />;
    case "document":
      return <DocumentPreview path={path} mime={route.mime} />;
    case "code":
      return <CodePreview path={path} language={route.language} />;
    case "text":
      return <TextPreview path={path} />;
    default:
      return null;
  }
}

/** The branches that describe the entry instead of showing it. */
function notice(route: PreviewRoute, size: number) {
  // A directory is not a file and reading it as one would show nothing. The
  // count is the useful fact, and it is the fact the Qt build showed.
  if (route.kind === "directory") {
    return (
      <p data-testid="preview-directory">
        {route.entryCount} {route.entryCount === 1 ? "entry" : "entries"}
      </p>
    );
  }

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
