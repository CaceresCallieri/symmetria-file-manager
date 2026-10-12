import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MachinePanel } from "./MachinePanel.tsx";
import "@symmetria/fm-ui/theme/tokens.css";
import "@symmetria/fm-ui/styles.css";
import "@symmetria/fm-ui/syntax-wine.css";
// The Atmosphere design, standalone only. Last, so it wins by order.
import "./atmosphere.css";

/**
 * The Atmosphere row height, in pixels: ONE figure for both readers. The
 * stylesheet draws rows at `--row-height`, set here on the root element (an
 * inline value beats `tokens.css`'s `:root` rule), and the virtualisers place
 * rows by `index × rowHeight`, passed to `App`. A row drawn taller than the
 * virtualiser's figure drifts a little further down every row, so never set
 * `--row-height` in `atmosphere.css`.
 */
const ATMOSPHERE_ROW_HEIGHT = 31;
document.documentElement.style.setProperty("--row-height", `${ATMOSPHERE_ROW_HEIGHT}px`);

const host = document.getElementById("root");
if (!host) throw new Error("index.html is missing its #root element");

createRoot(host).render(
  <StrictMode>
    <MachinePanel rowHeight={ATMOSPHERE_ROW_HEIGHT} />
  </StrictMode>,
);
