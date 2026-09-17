import { type ReactNode, useEffect, useRef } from "react";

import type { PreviewVariant } from "./variant.ts";

interface ScrollablePreviewProps {
  readonly kind: "text" | "code" | "markdown" | "html";
  readonly variant: PreviewVariant;
  readonly language?: string;
  readonly children: ReactNode;
}

/**
 * The scroll surface every textual viewer shares.
 *
 * In the reader it is focusable and carries `data-scrolls`, which is what makes
 * `useKeyDispatch` leave the browser's native scrolling alone for it. It takes
 * focus on mount, before the dialog's own panel does — see `useDialogFocus`,
 * which is written not to take it back.
 *
 * A `<section>` with a name, not an anonymous `<div>`: in the reader the
 * surface is focusable and its focus ring is suppressed, so without both it
 * announces as an unlabelled group the user cannot place. The element carries
 * the name for both variants rather than for the reader alone — a role Biome
 * cannot resolve statically is a rule it rejects, and naming the column's
 * viewer too costs nothing and says the same true thing about it.
 */
export function ScrollablePreview({ kind, variant, language, children }: ScrollablePreviewProps) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (variant === "reader") container.current?.focus();
  }, [variant]);

  return (
    <section
      ref={container}
      className={`preview preview--${kind}`}
      data-testid={`preview-${kind}`}
      data-language={language}
      data-scrolls={variant === "reader" ? "true" : undefined}
      tabIndex={variant === "reader" ? -1 : undefined}
      aria-label={kind}
    >
      {children}
    </section>
  );
}
