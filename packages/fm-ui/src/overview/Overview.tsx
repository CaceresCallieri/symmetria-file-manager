import { useRef } from "react";
import { useDialogFocus } from "../hooks/useDialogFocus.ts";
import { ConnectedGroups } from "./ConnectedGroups.tsx";
import { EXCLUSIONS } from "./session.ts";
import type { useOverview } from "./useOverview.ts";
import type { OverviewPort } from "./useOverviewMode.ts";
import "./overview.css";

function Overview({
  root,
  model,
  onClose,
  port,
}: {
  readonly root: string;
  readonly model: ReturnType<typeof useOverview>;
  readonly onClose: () => void;
  readonly port: OverviewPort;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Folder overview"
      data-root={root}
      tabIndex={-1}
      className="overview"
      onKeyDownCapture={(event) => {
        if (
          event.key !== "Escape" ||
          (event.target instanceof Element && event.target.closest("input,textarea,select"))
        )
          return;
        const opened = panel.current?.querySelector("details[open]");
        if (opened) {
          opened.removeAttribute("open");
          event.preventDefault();
          event.stopPropagation();
          panel.current?.focus();
        }
      }}
    >
      <header className="overview-toolbar">
        <strong>Folder overview</strong>
        <span>{model.loading ? "Loading…" : `${model.inspected} entries inspected`}</span>
        <details>
          <summary>Scope</summary>
          <div className="overview-popover">
            <p>Depth 4 · 5,000 entries · 128 directories</p>
            <p>Excluded: {EXCLUSIONS.join(", ")}</p>
          </div>
        </details>
        <button type="button" onClick={onClose}>
          Close · Esc
        </button>
      </header>
      <ConnectedGroups root={root} model={model} port={port} />
    </div>
  );
}

export function OverviewLayer({
  root,
  model,
  onClose,
  port,
}: {
  readonly root: string | null;
  readonly model: ReturnType<typeof useOverview>;
  readonly onClose: () => void;
  readonly port: OverviewPort;
}) {
  return root === null ? null : (
    <Overview key={root} root={root} model={model} onClose={onClose} port={port} />
  );
}
