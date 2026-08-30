/**
 * @vitest-environment happy-dom
 *
 * The preview pane, driven through the cursor.
 *
 * `route.test.ts` proves the decision tree. This proves the pane is wired to
 * it, that the debounce holds, and that a preview which cannot be built still
 * shows something truthful.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/renderer/App.tsx";
import { PREVIEW_DEBOUNCE_MS } from "../../src/renderer/usePreview.ts";
import { type BridgeLog, cursorIn, installBridge, namesIn } from "./support.ts";

let log: BridgeLog;

beforeEach(() => {
  log = installBridge();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function opened(): Promise<void> {
  render(<App startPath="/home/jc" />);
  await waitFor(() => expect(namesIn("column-current")).toContain("projects"));
}

describe("the preview column", () => {
  it("counts a directory's entries rather than trying to read it", async () => {
    // The cursor starts on `projects`, a directory.
    await opened();

    const shown = await screen.findByTestId("preview-directory");
    expect(shown.textContent).toBe("2 entries");
  });

  it("renders a text file's contents", async () => {
    await opened();
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(cursorIn("column-current")).toContain("notes.txt"));

    const shown = await screen.findByTestId("preview-text");
    expect(shown.textContent).toContain("plain notes");
    expect(shown.textContent).toContain("second line");
  });

  it("routes a known language to the code branch", async () => {
    await opened();
    fireEvent.keyDown(window, { key: "l" });
    await waitFor(() => expect(namesIn("column-current")).toContain("beta.md"));
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(cursorIn("column-current")).toContain("beta.md"));

    const shown = await screen.findByTestId("preview-code");
    expect(shown.dataset["language"]).toBe("markdown");
    // No `Worker` in this environment, so the file renders as plain text —
    // which is the required behaviour, not a shortcoming of the test.
    expect(shown.textContent).toContain("# beta");
  });

  it("names the column by what the router chose", async () => {
    await opened();

    await waitFor(() =>
      expect(screen.getByTestId("column-preview").dataset["kind"]).toBe("directory"),
    );
  });
});

describe("the debounce", () => {
  it("does not describe every entry the cursor passes over", async () => {
    // Holding `j` through a directory would otherwise stat, resolve a MIME type
    // and read a head for every entry passed — work for a preview nobody sees.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App startPath="/home/jc" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("projects"));

    const before = log.described.length;
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(window, { key: "j" });
      // Well inside the window, so each move cancels the previous one.
      await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS / 3);
    }
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS * 2);

    // One description for where the cursor came to rest, not one per step.
    const asked = log.described.slice(before);
    expect(asked).toEqual(["/home/jc/todo.txt"]);
  });

  it("describes the entry the cursor settles on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<App startPath="/home/jc" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("projects"));

    fireEvent.keyDown(window, { key: "j" });
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS * 2);

    expect(log.described).toContain("/home/jc/notes.txt");
  });
});

describe("a preview that cannot be built", () => {
  it("says why, instead of showing an empty column", async () => {
    // A file the process cannot stat — no permission, or gone between the
    // cursor landing and the read — used to produce an empty column
    // indistinguishable from an empty file.
    render(<App startPath="/home/jc/projects" />);
    await waitFor(() => expect(namesIn("column-current")).toContain("beta.md"));

    // `alpha` is a directory the fixture does not describe.
    const shown = await screen.findByTestId("preview-error");
    expect(shown.textContent).toContain("alpha");
  });
});
