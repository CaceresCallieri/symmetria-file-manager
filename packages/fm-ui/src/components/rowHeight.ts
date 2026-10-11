import { createContext, useContext } from "react";

/**
 * The height, in pixels, of one row in every fixed-height list: the Miller
 * columns, a previewed directory's listing and the file tree.
 *
 * A figure the JavaScript must know, not only the stylesheet, because the
 * virtualisers place rows by arithmetic (`index × height`) with no measurement
 * pass, and the tree's paging and scroll anchoring do the same. A row the CSS
 * draws taller than this figure drifts further from its slot on every row.
 *
 * A context rather than a constant, because the height belongs to the HOST,
 * whose stylesheet draws the rows. `App` provides its `rowHeight` prop: the
 * standalone passes 31 and sets `--row-height` from the same number
 * (`app/src/renderer/main.tsx`). Every other host — Mesura Code's layer, and
 * its tree pane, which mounts `FileTree` with no `App` around it — gets this
 * default, which is what `tokens.css` draws.
 *
 * An earlier version read `--row-height` back from `:root` at module load.
 * It worked only because the production build links the stylesheet before the
 * scripts run, and it could not see a token a host declares on its own layer
 * element. Do not reintroduce a CSS read here.
 */
export const DEFAULT_ROW_HEIGHT = 24;

export const RowHeightContext = createContext(DEFAULT_ROW_HEIGHT);

/** The row height this list is drawn at. */
export function useRowHeight(): number {
  return useContext(RowHeightContext);
}
