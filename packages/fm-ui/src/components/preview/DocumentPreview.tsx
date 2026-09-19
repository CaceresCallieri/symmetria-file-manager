import { lazy, Suspense } from "react";
import { usePreviewUrl } from "./previewUrl.ts";
import type { PreviewVariant } from "./variant.ts";

const PagedPdfPreview = lazy(() => import("./pdf/PagedPdfPreview.tsx"));

export interface DocumentPreviewProps {
  readonly path: string;
  readonly variant?: PreviewVariant;
}

/** The router classifies PDFs and their MIME descendants before reaching here. */
export function DocumentPreview({ path, variant = "column" }: DocumentPreviewProps) {
  const url = usePreviewUrl(path);
  if (url === null) return <div data-testid="preview-loading">reading…</div>;
  return (
    <div className="preview preview--document" data-testid="preview-document">
      <Suspense fallback={<div>Loading PDF…</div>}>
        <PagedPdfPreview key={url} url={url} variant={variant} />
      </Suspense>
    </div>
  );
}
