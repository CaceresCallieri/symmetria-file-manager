import type { OverviewCommand } from "@symmetria/fm-core/overview/navigation";
export function OverviewControls({
  zoom,
  run,
  selected,
  canFocus,
  onFocus,
  onRearrange,
}: {
  readonly zoom: number;
  readonly run: (command: OverviewCommand) => void;
  readonly selected: string;
  readonly canFocus: boolean;
  readonly onFocus: () => void;
  readonly onRearrange: () => void;
}) {
  return (
    <div className="overview-camera-controls">
      <button type="button" aria-label="Zoom out" onClick={() => run("zoom-out")}>
        −
      </button>
      <span>{Math.round(zoom * 100)}%</span>
      <button type="button" aria-label="Zoom in" onClick={() => run("zoom-in")}>
        +
      </button>
      <button type="button" onClick={() => run("fit")}>
        Fit
      </button>
      <button type="button" onClick={onRearrange}>
        Rearrange
      </button>
      <details>
        <summary>Details</summary>
        <div className="overview-popover">
          <p>{selected}</p>
          {canFocus ? (
            <button type="button" onClick={onFocus}>
              Focus here
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
