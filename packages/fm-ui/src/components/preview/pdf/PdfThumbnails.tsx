import { useVirtualizer } from "@tanstack/react-virtual";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { useEffect, useRef } from "react";
import { PdfPage } from "./PdfPage.tsx";
import type { PdfRenderQueue } from "./renderQueue.ts";

interface PdfThumbnailsProps {
  readonly pdf: PDFDocumentProxy;
  readonly aspect: number;
  readonly width: number;
  readonly queue: PdfRenderQueue;
  readonly currentPage: number;
  readonly onChoose: (index: number) => void;
}

export function PdfThumbnails({
  pdf,
  aspect,
  width,
  queue,
  currentPage,
  onChoose,
}: PdfThumbnailsProps) {
  const container = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: pdf.numPages,
    getScrollElement: () => container.current,
    estimateSize: () => width * aspect + 40,
    overscan: 1,
  });
  useEffect(() => {
    virtualizer.scrollToIndex(currentPage, { align: "auto" });
  }, [currentPage, virtualizer]);

  return (
    <nav className="pdf-thumbnails" aria-label="PDF page thumbnails" style={{ width: width + 40 }}>
      <div
        ref={container}
        className="pdf-thumbnails__scroll"
        data-testid="pdf-thumbnails-scroll"
        data-scrolls="true"
      >
        <div className="pdf-pages" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className="pdf-thumbnail-slot"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <button
                type="button"
                className="pdf-thumbnail"
                aria-label={`Go to page ${item.index + 1}`}
                aria-current={item.index === currentPage ? "page" : undefined}
                onClick={() => onChoose(item.index)}
              >
                <PdfPage
                  pdf={pdf}
                  pageNumber={item.index + 1}
                  width={width}
                  estimatedAspect={aspect}
                  queue={queue}
                  priority={pdf.numPages + item.index}
                  thumbnail
                />
                <span>{item.index + 1}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
