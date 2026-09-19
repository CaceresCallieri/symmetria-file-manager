import {
  GlobalWorkerOptions,
  getDocument,
  PasswordResponses,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { useEffect, useState } from "react";
import type { PreviewVariant } from "../variant.ts";
import { PdfBinaryDataFactory } from "./binaryAssets.ts";
import { PdfPasswordForm } from "./PdfPasswordForm.tsx";
import { PdfViewport } from "./PdfViewport.tsx";
import "./pdf.css";

// Chromium 146 lacks Math.sumPrecise. The modern worker silently substitutes
// system fonts after that error. Keep the library and worker on the legacy build.
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

type DocumentState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | {
      readonly kind: "password";
      readonly incorrect: boolean;
      readonly unlock: (password: string) => void;
    }
  | {
      readonly kind: "ready";
      readonly pdf: PDFDocumentProxy;
      readonly aspect: number;
    };

/** Parsing and image decoding run in PDF.js's worker; only nearby pages get canvases. */
export default function PagedPdfPreview({
  url,
  variant,
}: {
  readonly url: string;
  readonly variant: PreviewVariant;
}) {
  const [state, setState] = useState<DocumentState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    let loading: PDFDocumentLoadingTask | undefined;
    setState({ kind: "loading" });
    void (async () => {
      try {
        // fetch supports the authorised custom scheme. PDF.js's URL loader assumes HTTP.
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("PDF request failed");
        const data = new Uint8Array(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        loading = getDocument({
          data,
          useSystemFonts: true,
          BinaryDataFactory: PdfBinaryDataFactory,
          useWorkerFetch: false,
        });
        loading.onPassword = (updatePassword: (password: string) => void, reason: number) => {
          if (controller.signal.aborted) return;
          setState({
            kind: "password",
            incorrect: reason === PasswordResponses.INCORRECT_PASSWORD,
            unlock: (password) => {
              if (controller.signal.aborted) return;
              setState({ kind: "loading" });
              updatePassword(password);
            },
          });
        };
        const pdf = await loading.promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        if (!controller.signal.aborted)
          setState({ kind: "ready", pdf, aspect: viewport.height / viewport.width });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    })();
    return () => {
      controller.abort();
      void loading?.destroy().catch(() => undefined);
    };
  }, [url]);

  if (state.kind === "loading") return <div className="pdf-message">Loading PDF…</div>;
  if (state.kind === "error") return <div className="pdf-message">Could not open this PDF.</div>;
  if (state.kind === "password")
    return (
      <PdfPasswordForm
        incorrect={state.incorrect}
        onUnlock={state.unlock}
        focusInput={variant === "reader"}
      />
    );
  return <PdfViewport key={url} pdf={state.pdf} aspect={state.aspect} variant={variant} />;
}
