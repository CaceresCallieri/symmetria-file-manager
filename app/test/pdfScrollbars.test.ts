import { describe, expect, it } from "vitest";
import { pdfScrollbarTarget } from "../src/main/pdfScrollbars.ts";

const viewer = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html";
const preview = "symmetria-fm://app/__preview/document-token";

describe("PDF scrollbar frame selection", () => {
  it("styles the viewer and its native PDF child", () => {
    expect(pdfScrollbarTarget(viewer, preview)).toBe("viewer");
    expect(pdfScrollbarTarget(preview, viewer)).toBe("document");
  });

  it.each([
    [preview, "symmetria-fm://app/index.html"],
    ["https://example.com", viewer],
    ["file:///tmp/document.pdf", viewer],
    ["data:text/html,example", viewer],
    ["chrome-extension://another-extension/index.html", preview],
    [preview, "chrome-extension://another-extension/index.html"],
    [preview, "https://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html"],
    [preview, undefined],
    ["", viewer],
    [preview, "invalid URL"],
  ])("leaves unrelated or uncommitted frames alone: %s", (url, parent) => {
    expect(pdfScrollbarTarget(url, parent)).toBeNull();
  });
});
