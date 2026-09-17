import { type ReactNode, useEffect, useRef } from "react";

import type { PreviewVariant } from "./variant.ts";

interface ScrollablePreviewProps {
  readonly kind: "text" | "code" | "markdown";
  readonly variant: PreviewVariant;
  readonly language?: string;
  readonly children: ReactNode;
}

/** Mount after the read completes so focus reaches the scroll container. */
export function ScrollablePreview({ kind, variant, language, children }: ScrollablePreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (variant === "reader") container.current?.focus();
  }, [variant]);

  return (
    <div
      ref={container}
      className={`preview preview--${kind}`}
      data-testid={`preview-${kind}`}
      data-language={language}
      data-scrolls={variant === "reader" ? "true" : undefined}
      tabIndex={variant === "reader" ? -1 : undefined}
    >
      {children}
    </div>
  );
}
