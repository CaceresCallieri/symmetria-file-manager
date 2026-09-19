/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { type BridgeLog, installBridge, namesIn } from "./support.ts";

let log: BridgeLog;
beforeEach(() => {
  log = installBridge();
});
afterEach(cleanup);

async function opened() {
  render(<App startPath="/home/jc" />);
  await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));
}

function row(name: string, column = "column-current") {
  const entry = within(screen.getByTestId(column)).getByText(name).closest("[data-testid='row']");
  if (entry === null) throw new Error(`Missing row: ${name}`);
  return entry;
}

function key(key: string) {
  fireEvent.keyDown(window, { key });
}

it("keeps the yank indicator on the source after moving the cursor and pasting", async () => {
  await opened();
  key("j");
  key("y");
  expect(row("notes.txt").querySelector('[aria-label="Yanked"]')).not.toBeNull();
  key("j");
  expect(row("notes.txt").querySelector('[aria-label="Yanked"]')).not.toBeNull();
  expect(row("todo.txt").querySelector('[aria-label="Yanked"]')).toBeNull();
  key("p");
  await waitFor(() => expect(log.ops).toContain("copy /home/jc/notes.txt -> /home/jc"));
  expect(row("notes.txt").querySelector('[aria-label="Yanked"]')).not.toBeNull();
});

it("marks every yanked selection and replaces the indicators on the next cut", async () => {
  await opened();
  key("j");
  key(" ");
  key(" ");
  key("y");
  for (const name of ["notes.txt", "todo.txt"]) {
    expect(row(name).querySelector('[aria-label="Yanked"]')).not.toBeNull();
    expect(row(name).hasAttribute("data-marked")).toBe(false);
  }
  key("x");
  expect(screen.queryAllByRole("img", { name: "Yanked" })).toHaveLength(0);
  expect(row("empty").querySelector('[aria-label="Cut"]')).not.toBeNull();
  key("p");
  await waitFor(() => expect(screen.queryAllByRole("img", { name: "Cut" })).toHaveLength(0));
});

it("shows the same source in the parent and preview columns after navigation", async () => {
  await opened();
  key("j");
  key("y");
  key("k");
  key("l");
  await waitFor(() => expect(namesIn("column-current")).toContain("beta.md"));
  expect(row("notes.txt", "column-parent").querySelector('[aria-label="Yanked"]')).not.toBeNull();
  expect(
    within(screen.getByTestId("column-current")).queryByRole("img", { name: "Yanked" }),
  ).toBeNull();
  key("h");
  await waitFor(() =>
    expect(row("notes.txt").querySelector('[aria-label="Yanked"]')).not.toBeNull(),
  );
  key("h");
  await waitFor(() => expect(namesIn("column-current")).toContain("jc"));
  await waitFor(() => {
    const preview = screen.getByTestId("preview-directory");
    expect(
      within(preview).getByText("notes.txt").parentElement?.querySelector('[aria-label="Yanked"]'),
    ).not.toBeNull();
  });
});
