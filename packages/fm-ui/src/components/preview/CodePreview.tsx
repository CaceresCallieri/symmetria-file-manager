import { ScrollablePreview } from "./ScrollablePreview.tsx";
import { TruncationMarker, useFileText } from "./TextPreview.tsx";
import { useHighlighted } from "./useHighlighted.ts";
import type { PreviewVariant } from "./variant.ts";

export interface CodePreviewProps {
  readonly path: string;
  readonly language: string;
  readonly variant?: PreviewVariant;
}

/**
 * A source file, highlighted.
 *
 * The worker and the stale-answer guard moved to `useHighlighted` when the
 * rendered markdown preview needed the same thing for its fenced blocks; what
 * is left here is the reading and the drawing. See that module for why
 * highlighting failing must never make the preview fail.
 */
export function CodePreview({ path, language, variant = "column" }: CodePreviewProps) {
  const loaded = useFileText(path);
  const { html, lineCapped } = useHighlighted(loaded === null ? null : loaded.text, language);

  if (loaded === null) return <div data-testid="preview-loading">reading…</div>;

  return (
    <ScrollablePreview kind="code" variant={variant} language={language}>
      {html === null ? (
        <pre className="preview__body">{loaded.text}</pre>
      ) : (
        // The HTML comes from our own worker, which either escapes the text or
        // hands it to `highlight.js` — whose output is escaped by construction.
        // Nothing from the file reaches the DOM unescaped.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the worker escapes everything it emits
        <pre className="preview__body hljs" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {loaded.truncated || lineCapped ? <TruncationMarker /> : null}
    </ScrollablePreview>
  );
}
