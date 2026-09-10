import { useEffect, useRef } from "react";
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
          <p>Depth 4 · 5,000 entries · 128 directories</p>
          <p>Excluded: {EXCLUSIONS.join(", ")}</p>
        </details>
        <button type="button" onClick={onClose}>
          Close · Esc
        </button>
      </header>
      <div className="overview-content">
        {[...model.folders.values()].map((folder) => (
          <section key={folder.path}>
            <h2>{folder.path.split("/").pop() || "/"}</h2>
            <small>{folder.path}</small>
            <p>{folder.status}</p>
            {folder.status === "Loaded" && folder.entries.length === 0 ? <p>Empty folder</p> : null}
            <ul>
              {folder.entries.map((entry) => (
                <li key={entry.name}>
                  {entry.name}
                  {entry.isSymlink ? " ↗ (symlink)" : ""}
                </li>
              ))}
            </ul>
            {folder.status === "Excluded by scope" || folder.status === "Depth limit reached" ? (
              <button type="button" onClick={() => model.include(folder.path)}>
                Load this folder
              </button>
            ) : null}
          </section>
        ))}
      </div>
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
