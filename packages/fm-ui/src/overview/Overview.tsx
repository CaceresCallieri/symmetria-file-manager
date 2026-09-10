import { useEffect, useRef } from "react";
import { ConnectedGroups } from "./ConnectedGroups.tsx";
import { EXCLUSIONS } from "./session.ts";
import type { useOverview } from "./useOverview.ts";
import "./overview.css";

function Overview({
  root,
  model,
  onClose,
}: {
  readonly root: string;
  readonly model: ReturnType<typeof useOverview>;
  readonly onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const origin = document.activeElement;
    panel.current?.focus();
    return () => {
      if (origin instanceof HTMLElement) origin.focus();
    };
  }, []);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Folder overview"
      data-root={root}
      tabIndex={-1}
      className="overview"
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
      <ConnectedGroups root={root} model={model} />
    </div>
  );
}

export function OverviewLayer({
  root,
  model,
  onClose,
}: {
  readonly root: string | null;
  readonly model: ReturnType<typeof useOverview>;
  readonly onClose: () => void;
}) {
  return root === null ? null : <Overview root={root} model={model} onClose={onClose} />;
}
