import type { MouseEvent } from "react";

import type { TabView } from "../useTabs.ts";

/**
 * Keep keyboard focus where it was, for the reason a row and a crumb do: the
 * document-level handler owns the keymap. A focused tab button took Enter for
 * itself, so in the tree the next Enter re-activated the tab instead of
 * opening the selected row.
 */
const keepFocus = (event: MouseEvent) => event.preventDefault();

export interface TabBarProps {
  readonly visible?: boolean;
  readonly views: readonly TabView[];
  readonly activeIndex: number;
  onActivate(index: number): void;
  onClose(index: number): void;
}

/**
 * The open locations, as a strip.
 *
 * Shown only when there is more than one, so a single-tab window spends no
 * height on a control that says nothing. Each tab is named by its directory,
 * which is what the user navigated to and thinks of it as; the full path is the
 * title, for the case where two tabs share a name.
 */
export function TabBar({ views, activeIndex, onActivate, onClose, visible = true }: TabBarProps) {
  if (!visible) return null;
  return (
    <nav className="tab-bar" data-testid="tab-bar">
      {views.map((view, index) => (
        <span
          key={view.id}
          className={index === activeIndex ? "tab tab--active" : "tab"}
          data-testid="tab"
          data-active={index === activeIndex ? "true" : undefined}
          title={view.path}
        >
          <button
            type="button"
            className="tab__name"
            onMouseDown={keepFocus}
            onClick={() => onActivate(index)}
          >
            {view.name}
          </button>
          <button
            type="button"
            className="tab__close"
            aria-label={`Close ${view.name}`}
            onMouseDown={keepFocus}
            onClick={() => onClose(index)}
          >
            ×
          </button>
        </span>
      ))}
    </nav>
  );
}
