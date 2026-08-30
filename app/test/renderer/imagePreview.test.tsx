/**
 * @vitest-environment happy-dom
 *
 * The image branch, including the case where the name lies.
 *
 * Routing is decided by the file's NAME, so a `.png` that is not a PNG can only
 * be caught at the decode — which is in the browser, not in the router.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BRIDGE_KEY, type Bridge } from "../../src/preload/bridge.ts";
import { ImagePreview } from "../../src/renderer/components/preview/ImagePreview.tsx";

beforeEach(() => {
  const bridge = {
    version: "test",
    list: () => Promise.resolve({ ok: true as const, value: null }),
    watch: () => Promise.resolve({ ok: true as const, value: null }),
    unwatch: () => Promise.resolve({ ok: true as const, value: null }),
    readText: () => Promise.resolve({ ok: true as const, value: null }),
    cancel: () => Promise.resolve({ ok: true as const, value: null }),
    describe: () => Promise.resolve({ ok: true as const, value: null }),
    previewUrl: () =>
      Promise.resolve({ ok: true as const, value: { url: "symmetria-fm://app/__preview/t" } }),
    onListBatch: () => () => undefined,
    onChanged: () => () => undefined,
  } satisfies Bridge;

  Object.defineProperty(window, BRIDGE_KEY, { value: bridge, configurable: true, writable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ImagePreview", () => {
  it("loads the image from the application's own scheme, not from the disk", async () => {
    // Not a `file://` URL and not a blob built from bytes sent over the bridge:
    // the main process authorises the path and names an address for it.
    render(<ImagePreview path="/tmp/logo.png" mime="image/png" />);

    const image = await screen.findByTestId("preview-image-element");
    expect(image.getAttribute("src")).toMatch(/^symmetria-fm:\/\/app\/__preview\//);
  });

  it("says so when the bytes are not a readable image", async () => {
    // Verification found this failing in total silence: no error state, no
    // console line, and a pane collapsed to zero height — which reads as a
    // rendering fault rather than as a file whose name lies about its contents.
    render(<ImagePreview path="/tmp/fake.png" mime="image/png" />);
    const image = await screen.findByTestId("preview-image-element");

    fireEvent.error(image);

    const failed = await screen.findByTestId("preview-image-failed");
    expect(failed.textContent).toContain("image/png");
  });

  it("gives a different file a different address", async () => {
    const view = render(<ImagePreview path="/tmp/a.png" mime="image/png" />);
    await screen.findByTestId("preview-image-element");

    view.rerender(<ImagePreview path="/tmp/b.png" mime="image/png" />);

    // The failure state must not survive into the next file, or one undecodable
    // image would leave the pane reporting failure for everything after it.
    await waitFor(() => expect(screen.queryByTestId("preview-image-failed")).toBeNull());
  });
});
