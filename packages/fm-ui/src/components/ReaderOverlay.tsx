import { humanSize } from "@symmetria/fm-core/format";
import { useEffect, useRef } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus.ts";
import { PreviewPane, type PreviewPaneProps } from "./preview/PreviewPane.tsx";

interface ReaderOverlayProps {
  readonly pane: PreviewPaneProps | null;
  readonly onClose: () => void;
}

/** Expand the existing preview while the modal cascade holds the cursor still. */
export function ReaderOverlay({ pane, onClose }: ReaderOverlayProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || (event.key === "Enter" && event.ctrlKey)) {
        event.preventDefault();
        // An operation dialog can arrive asynchronously behind the reader.
        // Its window listener must not cancel that operation on this key.
        event.stopImmediatePropagation();
        onClose();
      }
    };
    // Chromium's PDF viewer is a plugin: once it holds keyboard focus, no key
    // reaches the page, the main process, or this listener, so Escape could not
    // close the reader. When focus leaves the document into an embedded
    // viewer inside the panel, take it back on the next tick. The plugin keeps
    // mouse scrolling, which follows the pointer; it loses its own keys.
    const onBlur = () => {
      const active = document.activeElement;
      const embedded = active instanceof HTMLEmbedElement || active instanceof HTMLIFrameElement;
      if (embedded && panel.current?.contains(active)) {
        setTimeout(() => panel.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  return (
    <div className="overlay">
      <div
        className="reader"
        data-testid="reader"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Expanded preview"
      >
        {pane === null ? (
          <div className="list" role="status">
            Reading…
          </div>
        ) : (
          <>
            <ReaderHeader pane={pane} />
            <PreviewPane {...pane} variant="reader" />
          </>
        )}
      </div>
    </div>
  );
}

function ReaderHeader({ pane }: { readonly pane: PreviewPaneProps }) {
  const description = pane.description;
  if (description == null) return null;
  const type = description.mime ?? "unknown type";
  return (
    <div className="reader__header" data-testid="reader-header">
      <span className="reader__name" title={description.name}>
        {description.name}
      </span>
      <span>{humanSize(pane.size)}</span>
      <span>{type}</span>
    </div>
  );
}
