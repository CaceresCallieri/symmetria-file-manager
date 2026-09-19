import { useVirtualizer } from "@tanstack/react-virtual";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PreviewVariant } from "../variant.ts";
import { PdfPage } from "./PdfPage.tsx";
import { PdfThumbnails } from "./PdfThumbnails.tsx";
import { PdfToolbar } from "./PdfToolbar.tsx";
import { PdfRenderQueue } from "./renderQueue.ts";

interface PdfViewportProps {
  readonly pdf: PDFDocumentProxy;
  readonly aspect: number;
  readonly variant: PreviewVariant;
}

export function PdfViewport({ pdf, aspect, variant }: PdfViewportProps) {
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(640);
  const [zoom, setZoom] = useState(1);
  const [showThumbnails, setShowThumbnails] = useState(true);
  const queue = useMemo(() => new PdfRenderQueue(), []);
  const width = Math.max(100, (availableWidth - 24) * zoom);
  const virtualizer = useVirtualizer({
    count: pdf.numPages,
    getScrollElement: () => container.current,
    estimateSize: () => width * aspect + 16,
    overscan: 1,
  });
  const items = virtualizer.getVirtualItems();
  const currentPage = items.find((item) => item.end > (virtualizer.scrollOffset ?? 0))?.index ?? 0;
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const goToPage = (index: number) => virtualizer.scrollToIndex(index, { align: "start" });

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth));
    observer.observe(element);
    setAvailableWidth(element.clientWidth);
    if (variant === "reader") element.focus();
    return () => observer.disconnect();
  }, [variant]);
  useEffect(() => () => queue.clear(), [queue]);
  useEffect(() => {
    // Invalidate measured heights after zoom/resize, then retain the current page.
    void width;
    virtualizer.measure();
    virtualizer.scrollToIndex(currentPageRef.current, { align: "start" });
  }, [width, virtualizer]);

  return (
    <div className="preview pdf-paged" data-testid="pdf-paged" data-variant={variant}>
      <PdfToolbar
        currentPage={currentPage}
        pageCount={pdf.numPages}
        zoom={zoom}
        onZoom={setZoom}
        onChoose={goToPage}
        showThumbnails={showThumbnails}
        onToggleThumbnails={() => setShowThumbnails((value) => !value)}
      />
      <div className="pdf-body">
        {showThumbnails && (
          <PdfThumbnails
            pdf={pdf}
            aspect={aspect}
            queue={queue}
            currentPage={currentPage}
            width={variant === "reader" ? 128 : 64}
            onChoose={goToPage}
          />
        )}
        <div
          ref={container}
          role="document"
          className="pdf-scroll"
          data-testid="pdf-scroll"
          data-scrolls={variant === "reader" ? "true" : undefined}
          tabIndex={variant === "reader" ? -1 : undefined}
          aria-label="PDF pages"
        >
          <div
            className="pdf-pages"
            style={{ height: virtualizer.getTotalSize(), minWidth: width + 24 }}
          >
            {items.map((item) => (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                className="pdf-page-slot"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <PdfPage
                  pdf={pdf}
                  pageNumber={item.index + 1}
                  width={width}
                  estimatedAspect={aspect}
                  queue={queue}
                  priority={Math.abs(item.index - currentPage)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
