import { Fragment } from "react";
import { FLASH_STATUS_LAYOUT } from "./flashTargets.ts";
import type { useOverviewFlash } from "./useOverviewFlash.ts";

export function OverviewFlash({ flash }: { readonly flash: ReturnType<typeof useOverviewFlash> }) {
  if (!flash.active) return null;
  const hint = flash.empty
    ? "No visible names"
    : flash.needsRefinement
      ? "Type more to separate labels"
      : flash.query
        ? flash.count === 0
          ? "No matching names"
          : "Type a label to jump"
        : "Type a name";
  return (
    <div className="overview-flash" data-flash-active="true">
      {flash.labels.map((label) => (
        <Fragment key={label.path}>
          <span
            className="overview-flash-match"
            aria-hidden="true"
            style={{
              left: label.match.x,
              top: label.match.y,
              ...label.typography,
              width: label.match.width,
              padding: 0,
            }}
          >
            {label.match.text}
          </span>
          <span
            className="overview-flash-label"
            data-flash-path={label.path}
            data-flash-label={label.label}
            style={{
              ...label.typography,
              left: label.x,
              top: label.y,
              padding: `0 ${label.typography.padding}px`,
            }}
          >
            <span className="overview-flash-prefix">
              {label.label.slice(0, flash.prefix.length)}
            </span>
            {label.label.slice(flash.prefix.length)}
          </span>
        </Fragment>
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
