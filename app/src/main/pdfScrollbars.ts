import { PDF_DOCUMENT_TOKENS, SCROLLBAR_RULES } from "@symmetria/fm-core/scrollbar";
import type { WebContents, WebFrameMain } from "electron";
import { APP_SCHEME_PROTOCOL } from "./appScheme.ts";
import { isBuiltInPdfViewer } from "./frameNavigation.ts";

/** Only Chromium's viewer and its direct PDF document child receive styles. */
export function pdfScrollbarTarget(
  url: string,
  parentUrl: string | undefined,
): "viewer" | "document" | null {
  try {
    const parsed = new URL(url);
    if (isBuiltInPdfViewer(parsed)) return "viewer";
    if (
      parsed.protocol === APP_SCHEME_PROTOCOL &&
      parentUrl !== undefined &&
      isBuiltInPdfViewer(new URL(parentUrl))
    ) {
      return "document";
    }
  } catch {
    // A frame can report an empty URL before it commits a document.
  }
  return null;
}

const DOCUMENT_STYLE = `
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(PDF_DOCUMENT_TOKENS + SCROLLBAR_RULES)};
  document.head.append(style);
`;

// The native plugin paints its own page surround; a CSS background alone leaves
// that area grey. Its setBackgroundColor message accepts an unsigned ARGB value.
// Resolve the shared CSS token through canvas so the plugin uses the same colour.
const PDF_SURROUND = `
  const plugin = document.querySelector('embed[type="application/x-google-chrome-pdf"]');
  if (plugin) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    plugin.postMessage({type: 'setBackgroundColor', color: alpha * 16777216 + red * 65536 + green * 256 + blue});
  }
`;

// WORKAROUND: Chromium exposes no PDF scrollbar theme API. Style its internal
// shadow roots and native surround once at document load. Replace this adapter
// when Electron exposes a supported theme API; recheck it when upgrading Chromium.
const VIEWER_STYLE = `
  ${DOCUMENT_STYLE}
  let root = document;
  for (const tag of ['pdf-viewer', 'viewer-pdf-sidenav', 'viewer-thumbnail-bar']) {
    await customElements.whenDefined(tag);
    const element = root.querySelector(tag);
    if (!element) return;
    await element.updateComplete;
    root = element.shadowRoot;
    if (!root) return;
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(SCROLLBAR_RULES)};
    root.append(style);
  }
`;

async function stylePdfFrame(frame: WebFrameMain): Promise<void> {
  if (frame.isDestroyed()) return;
  const target = pdfScrollbarTarget(frame.url, frame.parent?.url);
  if (target === null) return;
  try {
    await frame.executeJavaScript(
      `(async () => { ${target === "viewer" ? VIEWER_STYLE : DOCUMENT_STYLE + PDF_SURROUND} })()`,
    );
  } catch (error) {
    // Navigation can destroy the PDF frame while the style request is pending.
    if (!frame.isDestroyed()) console.warn("Could not style PDF scrollbars", error);
  }
}

/** Register before loading the window, including windows used as file pickers. */
export function stylePdfScrollbars(contents: WebContents): void {
  contents.on("frame-created", (_event, { frame }) => {
    if (frame === null) return;
    frame.on("dom-ready", () => void stylePdfFrame(frame));
  });
}
