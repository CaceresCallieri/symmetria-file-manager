/**
 * @vitest-environment happy-dom
 *
 * The full-window reader, driven through the real key listener.
 *
 * These tests describe the phase contract from the user's actions. They do
 * not import the reader component, because the application wiring is part of
 * the behavior: the registry, modal cascade, preview pane, and focus return
 * must work as one path.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";

import { App } from "../../src/App.tsx";
import { type BridgeLog, cursorIn, installBridge, namesIn } from "./support.ts";

let log: BridgeLog;

beforeEach(() => {
  log = installBridge();
});
afterEach(cleanup);

async function openedAtHome(): Promise<void> {
  render(<App startPath="/home/jc" />);
  await waitFor(() => expect(namesIn("column-current")).toContain("projects"));
}

async function moveToNotes(): Promise<void> {
  await openedAtHome();
  fireEvent.keyDown(window, { key: "j" });
  await waitFor(() => expect(cursorIn("column-current")).toContain("notes.txt"));
}

async function openReader(): Promise<HTMLElement> {
  await moveToNotes();
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  return screen.findByTestId("reader");
}

it("spec: Ctrl+Enter on a file opens a reader containing that file's preview pane", async () => {
  const reader = await openReader();

  const preview = await within(reader).findByTestId("column-preview");
  await waitFor(() => expect(preview.dataset.kind).toBe("text"));
  await waitFor(() => expect(preview.textContent).toContain("plain notes"));
});

it("guard: Ctrl+Enter on a directory does nothing and is not consumed", async () => {
  await openedAtHome();
  expect(cursorIn("column-current")).toContain("projects");

  const propagated = fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

  expect(propagated).toBe(true);
  expect(screen.queryByTestId("reader")).toBeNull();
  expect(screen.queryByTestId("pane-message")).toBeNull();
  expect(cursorIn("column-current")).toContain("projects");
});

it("spec: an open reader makes the columns inert and swallows j", async () => {
  await openReader();
  const before = cursorIn("column-current");

  fireEvent.keyDown(window, { key: "j" });

  expect(document.querySelector("main.app")?.hasAttribute("inert")).toBe(true);
  expect(cursorIn("column-current")).toBe(before);
});

it.each([
  ["Escape", { key: "Escape" }],
  ["Ctrl+Enter", { key: "Enter", ctrlKey: true }],
])(
  "spec: %s closes the reader without moving the cursor and returns keys to the list",
  async (_, key) => {
    await moveToNotes();
    const origin = screen.getByTestId("column-current");
    origin.tabIndex = -1;
    origin.focus();
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    const reader = await screen.findByTestId("reader");
    expect(document.activeElement).toBe(reader);
    const before = cursorIn("column-current");

    fireEvent.keyDown(window, key);

    await waitFor(() => expect(screen.queryByTestId("reader")).toBeNull());
    expect(cursorIn("column-current")).toBe(before);
    expect(document.activeElement).toBe(origin);

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() => expect(cursorIn("column-current")).toContain("todo.txt"));
  },
);

it("spec: opening and closing the reader never calls the open-path bridge", async () => {
  await openReader();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("reader")).toBeNull());

  expect(log.ops.filter((operation) => operation.startsWith("open "))).toEqual([]);
});

it("spec: the reader is the only mounted preview and closing restores the column preview", async () => {
  const reader = await openReader();
  await within(reader).findByTestId("column-preview");
  expect(screen.getAllByTestId("column-preview")).toHaveLength(1);
  expect(document.querySelector("main.app .preview-pane")).toBeNull();
  expect(screen.getByTestId("preview-placeholder")).toBeDefined();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("reader")).toBeNull());
  expect(screen.getAllByTestId("column-preview")).toHaveLength(1);
  expect(document.querySelector("main.app .preview-pane")).not.toBeNull();
  expect(screen.queryByTestId("preview-placeholder")).toBeNull();
  expect(cursorIn("column-current")).toContain("notes.txt");
  await waitFor(() =>
    expect(screen.getByTestId("column-preview").textContent).toContain("plain notes"),
  );
});

it("spec: Ctrl+Enter preserves the directory listing preview without opening a reader", async () => {
  await openedAtHome();
  const preview = screen.getByTestId("column-preview");
  await waitFor(() => expect(preview.dataset.kind).toBe("directory"));
  expect(preview.textContent).toContain("beta.md");
  expect(fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })).toBe(true);
  expect(screen.queryByTestId("reader")).toBeNull();
  expect(preview.dataset.kind).toBe("directory");
  expect(preview.textContent).toContain("beta.md");
});

it("spec: the reader routes an image entry to that image", async () => {
  render(<App startPath="/home/jc/pictures" />);
  await waitFor(() => expect(cursorIn("column-current")).toContain("shot.png"));
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  const reader = await screen.findByTestId("reader");
  const preview = await within(reader).findByTestId("column-preview");
  expect(preview.dataset.kind).toBe("image");
  const image = await within(preview).findByTestId("preview-image-element");
  expect(image.getAttribute("src")).toContain(encodeURIComponent("/home/jc/pictures/shot.png"));
});

it("spec: reopening the reader on a different entry shows only that entry's contents", async () => {
  const first = await openReader();
  await waitFor(() => expect(first.textContent).toContain("plain notes"));
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("reader")).toBeNull());
  fireEvent.keyDown(window, { key: "j" });
  expect(cursorIn("column-current")).toContain("todo.txt");
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  const second = await screen.findByTestId("reader");
  expect(second.textContent).not.toContain("plain notes");
  await waitFor(() => expect(second.textContent).toContain("todo"));
  expect(within(second).getByTestId("column-preview").dataset.kind).toBe("text");
  expect(second.textContent).not.toContain("plain notes");
});

it("spec: help advertises Expand preview with its Ctrl+Enter keycap", async () => {
  await openedAtHome();
  fireEvent.keyDown(window, { key: "?", shiftKey: true });
  const help = await screen.findByTestId("help-overlay");
  const rows = within(help).getAllByTestId("help-row");
  const expansion = rows.filter((row) => row.textContent?.includes("Expand preview"));
  expect(expansion).toHaveLength(1);
  expect(expansion[0]?.querySelector("kbd")?.textContent).toBe("⌃⏎");
});

it("spec: Ctrl+Enter cannot open a reader when the directory has no cursor entry", async () => {
  render(<App startPath="/home/jc/empty" />);
  await waitFor(() => expect(screen.getByTestId("crumb-current").textContent).toBe("empty"));
  expect(cursorIn("column-current")).toBe("");
  expect(namesIn("column-current")).toEqual([]);
  expect(fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })).toBe(true);
  expect(screen.queryByTestId("reader")).toBeNull();
  expect(log.ops.filter((operation) => operation.startsWith("open "))).toEqual([]);
});

it("spec: opening before the preview debounce resolves never shows the previous file", async () => {
  await moveToNotes();
  await waitFor(() =>
    expect(screen.getByTestId("column-preview").textContent).toContain("plain notes"),
  );
  fireEvent.keyDown(window, { key: "j" });
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  const reader = screen.getByTestId("reader");
  expect(within(reader).getByRole("status").textContent).toBe("Reading…");
  expect(reader.textContent).not.toContain("plain notes");
  const preview = await within(reader).findByTestId("column-preview");
  await waitFor(() => expect(preview.textContent).toContain("todo"));
});

it("spec: the reader consumes Escape before an asynchronously attached window listener", async () => {
  await openReader();
  let cancellations = 0;
  const cancel = () => {
    cancellations += 1;
  };
  window.addEventListener("keydown", cancel);
  try {
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("reader")).toBeNull());
    expect(cancellations).toBe(0);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancellations).toBe(1);
  } finally {
    window.removeEventListener("keydown", cancel);
  }
});

it("guard: plain Enter still opens the current file through the bridge", async () => {
  await moveToNotes();

  fireEvent.keyDown(window, { key: "Enter" });

  await waitFor(() => expect(log.ops).toContain("open /home/jc/notes.txt"));
});

it("guard: the column preview continues to follow the current file", async () => {
  await moveToNotes();

  const preview = screen.getByTestId("column-preview");
  await waitFor(() => expect(preview.dataset.kind).toBe("text"));
  await waitFor(() => expect(preview.textContent).toContain("plain notes"));
});
