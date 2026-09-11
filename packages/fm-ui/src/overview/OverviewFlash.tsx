import { FLASH_STATUS_LAYOUT } from "./flashTargets.ts";
import type { useOverviewFlash } from "./useOverviewFlash.ts";

export function OverviewFlash({ flash }: { readonly flash: ReturnType<typeof useOverviewFlash> }) {
  if (!flash.active) return null;
  const hint = flash.empty
    ? "No visible names"
    : flash.needsRefinement
      ? "Type more to separate labels"
      : flash.query
        ? "Type a label to jump"
        : "Type a name";
  return (
    <div className="overview-flash" data-flash-active="true">
      {flash.labels.map((label) => (
        <span
          key={label.path}
          className="overview-flash-label"
          data-flash-path={label.path}
          data-flash-label={label.label}
          style={{ left: label.x, top: label.y, width: label.width }}
        >
          <span className="overview-flash-prefix">{label.label.slice(0, flash.prefix.length)}</span>
          {label.label.slice(flash.prefix.length)}
        </span>
      ))}
      <div
        className="overview-flash-status"
        role="status"
        aria-label="Flash navigation"
        style={{
          left: FLASH_STATUS_LAYOUT.inset,
          bottom: FLASH_STATUS_LAYOUT.inset,
          width: FLASH_STATUS_LAYOUT.width,
          height: FLASH_STATUS_LAYOUT.height,
        }}
      >
        <strong>s</strong>{" "}
        <span className="overview-flash-query" title={flash.query}>
          {flash.query}
        </span>
        <span>{flash.count} matches</span>
        <span>{hint} · Esc cancels</span>
      </div>
    </div>
  );
}
