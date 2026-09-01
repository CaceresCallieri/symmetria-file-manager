import { useEffect, useRef, useState } from "react";

import type { HighlightRequest, HighlightResponse } from "../../highlight.worker.ts";
import { TruncationMarker, useFileText } from "./TextPreview.tsx";

export interface CodePreviewProps {
  readonly path: string;
  readonly language: string;
}

/**
 * One worker for the whole application.
 *
 * Started on first use, never torn down: a preview pane highlights on nearly
 * every cursor settle, and spawning a worker per file would cost more than the
 * highlighting. Created lazily so a session that previews no code never pays
 * for it — and so a test environment with no `Worker` is not required to have
 * one.
 */
let worker: Worker | null = null;

function highlighter(): Worker | null {
  if (worker !== null) return worker;
  if (typeof Worker === "undefined") return null;

  worker = new Worker(new URL("../../highlight.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A source file, highlighted.
 *
 * Highlighting is decoration: when there is no worker, or the language is one
 * the bundle does not carry, the file still renders — as escaped plain text.
 * A preview that fails to highlight must never be a preview that fails.
 */
export function CodePreview({ path, language }: CodePreviewProps) {
  const loaded = useFileText(path);
  const [html, setHtml] = useState<string | null>(null);
  const [lineCapped, setLineCapped] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    if (loaded === null) return;

    const instance = highlighter();
    if (instance === null) {
      setHtml(escapeHtml(loaded.text));
      return;
    }

    const id = ++nextId.current;
    const onMessage = (event: MessageEvent<HighlightResponse>) => {
      // A stale answer belongs to a file the cursor has already left.
      if (event.data.id !== id) return;
      setHtml(event.data.html);
      setLineCapped(event.data.truncated);
    };

    instance.addEventListener("message", onMessage);
    const request: HighlightRequest = { id, text: loaded.text, language };
    instance.postMessage(request);

    return () => instance.removeEventListener("message", onMessage);
  }, [loaded, language]);

  if (loaded === null) return <div data-testid="preview-loading">reading…</div>;

  return (
    <div className="preview preview--code" data-testid="preview-code" data-language={language}>
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
    </div>
  );
}
