import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./theme/tokens.css";
import "./styles.css";
import "./syntax-wine.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html is missing its #root element");

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
