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
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
          <PreviewPane {...pane} />
        )}
      </div>
    </div>
  );
}
