import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { memo, useEffect, useRef, useState } from "react";
import type { PdfRenderQueue } from "./renderQueue.ts";

interface PdfPageProps {
  readonly pdf: PDFDocumentProxy;
  readonly pageNumber: number;
  readonly width: number;
  readonly estimatedAspect: number;
  readonly queue: PdfRenderQueue;
  readonly priority: number;
  readonly thumbnail?: boolean;
}

/** An unmounted page retains no canvas bitmap. PDF.js releases decoded resources. */
export const PdfPage = memo(function PdfPage({
  pdf,
  pageNumber,
  width,
  estimatedAspect,
  queue,
  priority,
  thumbnail = false,
}: PdfPageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [aspect, setAspect] = useState(estimatedAspect);
  const [status, setStatus] = useState("Loading page…");
  // Priority matters when a page first enters the cache, not on every scroll.
  const initialPriority = useRef(priority);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    let page: PDFPageProxy | undefined;
    let task: RenderTask | undefined;
    let disposed = false;
    setStatus("Loading page…");
    const cancel = queue.enqueue(async (signal) => {
      try {
        page = await pdf.getPage(pageNumber);
        if (signal.aborted) return;
        const original = page.getViewport({ scale: 1 });
        setAspect(original.height / original.width);
        const viewport = page.getViewport({ scale: width / original.width });
        // Bound individual bitmaps at extreme zoom. Normal fit-width retains DPR.
        const outputScale = Math.min(
          devicePixelRatio,
          Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
        );
        target.width = Math.ceil(viewport.width * outputScale);
        target.height = Math.ceil(viewport.height * outputScale);
        task = page.render({
          canvas: target,
          viewport,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
        });
        const abort = () => task?.cancel();
        signal.addEventListener("abort", abort, { once: true });
        try {
          await task.promise;
          if (!disposed) setStatus("");
        } finally {
          signal.removeEventListener("abort", abort);
        }
      } catch {
        if (!signal.aborted) setStatus("Could not render this page.");
      } finally {
        if (disposed) page?.cleanup();
      }
    }, initialPriority.current);
    return () => {
      disposed = true;
      cancel();
      task?.cancel();
      target.width = target.height = 0;
      page?.cleanup();
    };
  }, [pdf, pageNumber, width, queue]);

  return (
    <div
      className="pdf-page"
      data-pdf-page={thumbnail ? undefined : pageNumber}
      data-pdf-thumbnail={thumbnail ? pageNumber : undefined}
      style={{ width, height: width * aspect }}
    >
      <canvas
        ref={canvas}
        aria-label={`PDF page ${pageNumber}`}
        style={{ visibility: status ? "hidden" : "visible" }}
      />
      {status && <span className="pdf-page__status">{thumbnail ? "…" : status}</span>}
    </div>
  );
});
