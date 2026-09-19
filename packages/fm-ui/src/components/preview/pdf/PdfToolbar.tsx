import { useEffect, useState } from "react";

interface PdfToolbarProps {
  readonly currentPage: number;
  readonly pageCount: number;
  readonly zoom: number;
  readonly onZoom: (zoom: number) => void;
  readonly onChoose: (index: number) => void;
  readonly showThumbnails: boolean;
  readonly onToggleThumbnails: () => void;
}

export function PdfToolbar({
  currentPage,
  pageCount,
  zoom,
  onZoom,
  onChoose,
  showThumbnails,
  onToggleThumbnails,
}: PdfToolbarProps) {
  const [pageInput, setPageInput] = useState("1");
  useEffect(() => setPageInput(String(currentPage + 1)), [currentPage]);
  return (
    <div className="pdf-toolbar" role="toolbar" aria-label="PDF controls">
      <button
        type="button"
        aria-label="Page thumbnails"
        aria-expanded={showThumbnails}
        onClick={() => onToggleThumbnails()}
      >
        Pages
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const page = Number(pageInput);
          if (Number.isInteger(page) && page >= 1 && page <= pageCount) onChoose(page - 1);
        }}
      >
        <input
          aria-label="PDF page number"
          inputMode="numeric"
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
        />
        <span>/ {pageCount}</span>
      </form>
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => onZoom(Math.max(0.5, zoom / 1.25))}
      >
        −
      </button>
      <button type="button" onClick={() => onZoom(1)} title="Fit page width">
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" aria-label="Zoom in" onClick={() => onZoom(Math.min(3, zoom * 1.25))}>
        +
      </button>
    </div>
  );
}
