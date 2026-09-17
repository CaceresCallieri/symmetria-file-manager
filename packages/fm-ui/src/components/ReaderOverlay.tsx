import { humanSize } from "@symmetria/fm-core/format";
import type { PreviewTarget } from "@symmetria/fm-core/preview/route";
import { useRef } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus.ts";
import { useEmbedFocusGuard } from "../hooks/useEmbedFocusGuard.ts";
import { isEscape, useOverlayCloseKeys } from "../hooks/useOverlayCloseKeys.ts";
import { PreviewPane, type PreviewPaneProps } from "./preview/PreviewPane.tsx";

/** Facts from the same describe reply as the route, without another read. */
export type ReaderDescription = Pick<PreviewTarget, "name" | "mime">;

interface ReaderOverlayProps {
  readonly pane: PreviewPaneProps | null;
  /**
   * What the header names, beside the pane rather than inside it.
   *
   * `PreviewPane` never reads it: the reader is the only surface that names the
   * file it is showing, so carrying it through the pane's props would make that
   * type a transport bag and send a future reader looking for a consumer there.
   */
  readonly description: ReaderDescription | null;
  readonly onClose: () => void;
}

/** The id the dialog points `aria-labelledby` at when the header is drawn. */
const HEADER_NAME_ID = "reader-header-name";

/** The two keys that leave the reader. Ctrl+Enter both opens and closes it. */
function closesReader(event: KeyboardEvent): boolean {
  return isEscape(event) || (event.key === "Enter" && event.ctrlKey);
}

/** Expand the existing preview while the modal cascade holds the cursor still. */
export function ReaderOverlay({ pane, description, onClose }: ReaderOverlayProps) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  useOverlayCloseKeys(onClose, closesReader, { consume: true });
  useEmbedFocusGuard(panel);

  // The header names the file, so it is a better label than a fixed string —
  // but it is only in the document once there is something to describe.
  const named = pane !== null && description !== null;

  return (
    <div className="overlay">
      <div
        className="reader"
        data-testid="reader"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={named ? HEADER_NAME_ID : undefined}
        aria-label={named ? undefined : "Expanded preview"}
      >
        {pane === null ? (
          <div className="list" role="status">
            Reading…
          </div>
        ) : (
          <>
            <ReaderHeader description={description} size={pane.size} />
            <PreviewPane {...pane} variant="reader" />
          </>
        )}
      </div>
    </div>
  );
}

function ReaderHeader({
  description,
  size,
}: {
  readonly description: ReaderDescription | null;
  readonly size: number;
}) {
  if (description === null) return null;
  const type = description.mime ?? "unknown type";
  return (
    <div className="reader__header" data-testid="reader-header">
      <span className="reader__name" id={HEADER_NAME_ID} title={description.name}>
        {description.name}
      </span>
      <span>{humanSize(size)}</span>
      <span>{type}</span>
    </div>
  );
}
