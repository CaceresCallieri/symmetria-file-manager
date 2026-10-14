import type { ActionInspection, ActionRequest } from "@symmetria/fm-core/fileActions";
/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/App.tsx";
import { cursorIn, installBridge, namesIn } from "./support.ts";
import { installTreeBridge, treeEntry } from "./tree-support.ts";

let fixture: ReturnType<typeof installBridge>;
beforeEach(() => {
  fixture = installBridge();
});
afterEach(cleanup);
async function mount(enabled = true) {
  render(<App startPath="/home/jc" actionMenu={enabled} />);
  await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));
}
function context(name: string) {
  const row = within(screen.getByTestId("column-current"))
    .getByText(name)
    .closest('[data-testid="row"]');
  if (!row) throw new Error("Missing file row");
  fireEvent.contextMenu(row, { clientX: 50, clientY: 70 });
}
function key(key: string, options = {}) {
  fireEvent.keyDown(window, { key, ...options });
}

describe("file action menu", () => {
  it("owns j/k and routes trash through the existing confirmation", async () => {
    await mount();
    const original = cursorIn("column-current");
    key(";");
    key("j");
    expect(cursorIn("column-current")).toBe(original);
    key("d");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("delete-list").textContent).toContain("projects");
    expect(fixture.ops.some((op) => op.startsWith("trash"))).toBe(false);
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(fixture.ops).toContain("trash /home/jc/projects"));
  });
  it("copies the right-clicked path and pastes into the clicked folder", async () => {
    await mount();
    context("notes.txt");
    key("y");
    context("empty");
    key("p");
    await waitFor(() => expect(fixture.ops).toContain("copy /home/jc/notes.txt -> /home/jc/empty"));
  });
  it("preserves the captured rename path and reports a bridge failure", async () => {
    await mount();
    context("notes.txt");
    key("n");
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("value")).toBe("notes.txt");
    fireEvent.change(input, { target: { value: "taken.txt" } });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(fixture.ops).toContain("rename /home/jc/notes.txt -> taken.txt"));
    expect(screen.getByRole("dialog")).toBeDefined();
    await waitFor(() => expect(document.body.textContent).toContain("taken.txt already exists"));
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("disables missing backends without sample dialogs or simulated results", async () => {
    await mount();
    context("notes.txt");
    const openWith = screen.getByRole("menuitem", { name: /Open With/ });
    expect(openWith.getAttribute("aria-disabled")).toBe("true");
    key("o");
    expect(screen.getByRole("menu")).toBeDefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fixture.ops).toEqual([]);
    expect(screen.getByRole("menuitem", { name: /Paste Here/ }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });
  it("restores focus and normal navigation on Escape", async () => {
    await mount();
    const focus = document.activeElement;
    key(";");
    key("Escape");
    expect(document.activeElement).toBe(focus);
    key("j");
    await waitFor(() => expect(cursorIn("column-current")).toContain("notes.txt"));
  });
  it("does not intercept input or open over a dialog", async () => {
    await mount();
    key("r");
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: ";" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
    key("/");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: ";" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("keeps the feature opt-in and refuses read-only and picker contexts", async () => {
    await mount(false);
    key(";");
    expect(screen.queryByRole("menu")).toBeNull();
    cleanup();
    render(<App startPath="/home/jc" actionMenu readOnly />);
    await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));
    context("notes.txt");
    key(";");
    expect(screen.queryByRole("menu")).toBeNull();
    cleanup();
    render(
      <App
        startPath="/home/jc"
        actionMenu
        picker={{
          fifo: "/tmp/picker",
          options: {
            title: "Open",
            acceptLabel: "Open",
            multiple: false,
            directory: false,
            saveMode: false,
            suggestedName: "",
            currentFolder: "/home/jc",
          },
        }}
      />,
    );
    await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));
    key(";");
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("targets an unmarked cursor row like a right-click and preserves unrelated marks", async () => {
    await mount();
    key("j");
    key(" ");
    key("k");
    key("k");
    key(";");
    expect(screen.getByRole("menu").textContent).toContain("projects");
    expect(screen.getByRole("menuitem", { name: /Terminal Here/ })).toBeDefined();
    key("n");
    expect(screen.getByRole("textbox").getAttribute("value")).toBe("projects");
  });
  it("keeps multi-selection for a right-click on a marked row", async () => {
    await mount();
    key("j");
    key(" ");
    key(" ");
    context("notes.txt");
    expect(screen.getByRole("menu").textContent).toContain("2 selected items");
    expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
    key("y");
    key("p");
    await waitFor(() =>
      expect(fixture.ops).toEqual(["copy /home/jc/notes.txt,/home/jc/todo.txt -> /home/jc"]),
    );
  });
  it("does not clear unrelated marks when trashing an unmarked row", async () => {
    await mount();
    key("j");
    key(" ");
    context("todo.txt");
    key("d");
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(fixture.ops).toContain("trash /home/jc/todo.txt"));
    expect(
      screen.getByTestId("column-current").querySelector('[data-marked="true"]')?.textContent,
    ).toContain("notes.txt");
  });
  it("supports the tree and protects its root", async () => {
    installTreeBridge();
    render(<App startPath="/home/jc" actionMenu />);
    key("e", { ctrlKey: true });
    await screen.findByRole("treeitem", { name: "notes.txt" });
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "jc" }));
    expect(
      screen.getByRole("menuitem", { name: /Move to Trash/ }).getAttribute("aria-disabled"),
    ).toBe("true");
    key("d");
    expect(screen.queryByRole("dialog")).toBeNull();
    key("Escape");
    fireEvent.contextMenu(await screen.findByRole("treeitem", { name: "notes.txt" }));
    key("n");
    expect(screen.getByRole("textbox").getAttribute("value")).toBe("notes.txt");
  });
});

function desktopBridge() {
  installTreeBridge([treeEntry("setup.sh"), treeEntry("game.exe"), treeEntry("bundle.zip")]);
  const calls: ActionRequest[] = [];
  const inspection = (paths: readonly string[]): ActionInspection => ({
    entries: paths.map((path) => ({
      path,
      kind: /\.(txt|sh|exe|zip)$/.test(path) ? "file" : "directory",
      size: 8,
      modified: 0,
      mode: 0o644,
      executable: false,
      runnable: path.endsWith(".sh"),
      link: null,
    })),
    applications: [{ id: "editor.desktop", name: "Editor", recommended: true }],
    bottles: ["Gaming"],
    tools: { gio: true, terminal: true, wine: true, bottles: true, lutris: true, archives: true },
    applicationError: null,
    bottleError: null,
  });
  Object.assign(window.symmetriaFm ?? {}, {
    fileActionInspect: async ({ paths }: { paths: readonly string[] }) => ({
      ok: true,
      value: inspection(paths),
    }),
    fileActionExecute: async (request: ActionRequest) => {
      calls.push(request);
      return { ok: true, value: { message: "Started", outputs: [] } };
    },
  });
  return calls;
}
async function desktopMenu(name: string) {
  context(name);
  await waitFor(() =>
    expect(screen.getByRole("menuitem", { name: /Properties/ }).getAttribute("aria-disabled")).toBe(
      "false",
    ),
  );
}
describe("desktop action dialogs", () => {
  it("keeps permission consent on the checkbox when it becomes valid", async () => {
    const calls = desktopBridge();
    await mount();
    await desktopMenu("setup.sh");
    key("r");
    const checkbox = screen.getByRole("checkbox");
    expect(document.activeElement).toBe(checkbox);
    fireEvent.click(checkbox);
    expect(document.activeElement).toBe(checkbox);
    expect(screen.getByTestId("dialog-confirm").hasAttribute("disabled")).toBe(false);
    fireEvent.click(checkbox);
    expect(document.activeElement).toBe(checkbox);
    expect(screen.getByTestId("dialog-confirm").hasAttribute("disabled")).toBe(true);
    expect(calls).toEqual([]);
  });
  it.each([
    ["empty", "t"],
    ["bundle.zip", "e"],
    ["notes.txt", "i"],
  ])("focuses fieldless %s dialogs and restores focus after close", async (name, shortcut) => {
    desktopBridge();
    await mount();
    const origin = document.activeElement;
    await desktopMenu(name);
    key(shortcut);
    expect(document.activeElement).toBe(screen.getByTestId("dialog-confirm"));
    fireEvent.keyDown(document.activeElement ?? window, { key: "Tab" });
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    key("Escape");
    expect(document.activeElement).toBe(origin);
  });
  it("selects an installed application and sends the captured file", async () => {
    const calls = desktopBridge();
    await mount();
    await desktopMenu("notes.txt");
    key("o");
    expect(screen.getByRole("dialog").textContent).toContain("Open With");
    expect(screen.getByLabelText("Application").textContent).toContain("Editor");
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(calls[0]?.action).toBe("application"));
    expect(calls[0]?.paths).toEqual(["/home/jc/notes.txt"]);
    expect(calls[0]?.choice).toBe("editor.desktop");
    await waitFor(() => expect(screen.getByTestId("dialog-confirm").textContent).toBe("Close"));
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
  it("requires executable permission confirmation and supports Run in Terminal", async () => {
    const calls = desktopBridge();
    await mount();
    await desktopMenu("setup.sh");
    key("r");
    expect(screen.getByTestId("dialog-confirm").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(calls[0]?.action).toBe("run"));
    expect(calls[0]?.makeExecutable).toBe(true);
    await waitFor(() => expect(screen.getByTestId("dialog-confirm").textContent).toBe("Close"));
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await desktopMenu("setup.sh");
    key("t");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(calls[1]?.action).toBe("run-terminal"));
  });
  it("offers Wine, a real bottle, and Lutris system Wine with explicit options", async () => {
    const calls = desktopBridge();
    await mount();
    await desktopMenu("game.exe");
    key("w");
    fireEvent.change(screen.getByLabelText("Runner"), { target: { value: "bottles" } });
    expect(screen.getByLabelText("Bottle").textContent).toBe("Gaming");
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(calls[0]?.action).toBe("bottles"));
    expect(calls[0]?.choice).toBe("Gaming");
    await waitFor(() => expect(screen.getByTestId("dialog-confirm").textContent).toBe("Close"));
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await desktopMenu("game.exe");
    key("w");
    fireEvent.change(screen.getByLabelText("Runner"), { target: { value: "lutris" } });
    expect(screen.getByRole("dialog").textContent).toContain(
      "Saved game profiles remain in Lutris",
    );
    fireEvent.change(screen.getByLabelText("Wine prefix (optional)"), {
      target: { value: "/home/jc/Games/prefix" },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(calls[1]?.action).toBe("lutris"));
    expect(calls[1]?.prefix).toBe("/home/jc/Games/prefix");
  });
  it("uses archive destinations and reports backend errors without closing the dialog", async () => {
    const calls = desktopBridge();
    await mount();
    await desktopMenu("bundle.zip");
    key("E", { shiftKey: true });
    fireEvent.change(screen.getByLabelText("Destination parent folder"), {
      target: { value: "/home/jc/empty" },
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await waitFor(() => expect(calls[0]?.action).toBe("extract"));
    expect(calls[0]?.destination).toBe("/home/jc/empty");
    await waitFor(() => expect(screen.getByTestId("dialog-confirm").textContent).toBe("Close"));
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await desktopMenu("notes.txt");
    key("c");
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "tar.gz" } });
    expect((screen.getByLabelText("Archive path") as HTMLInputElement).value).toBe(
      "/home/jc/notes.txt.tar.gz",
    );
    Object.assign(window.symmetriaFm ?? {}, {
      fileActionExecute: async () => ({
        ok: false,
        error: { code: "conflict", message: "Destination already exists" },
      }),
    });
    fireEvent.click(screen.getByTestId("dialog-confirm"));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog").textContent).toContain("Destination already exists");
  });
  it("shows real metadata and keeps a desktop dialog above the menu", async () => {
    desktopBridge();
    await mount();
    await desktopMenu("notes.txt");
    key("i");
    expect(screen.getByRole("dialog").textContent).toContain("0644");
    context("bundle.zip");
    expect(screen.queryByRole("menu")).toBeNull();
    key("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
describe("menu focus and view routing", () => {
  it("supports Tab, Shift+Tab, Shift+Enter and pointer dismissal", async () => {
    await mount();
    context("notes.txt");
    key("Tab");
    expect(document.activeElement?.textContent).toContain("Open With");
    key("Tab", { shiftKey: true });
    expect(document.activeElement?.textContent).toContain("Open");
    key("Enter", { shiftKey: true });
    await waitFor(() => expect(fixture.ops).toContain("open /home/jc/notes.txt"));
    context("notes.txt");
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    context("notes.txt");
    fireEvent.blur(window);
    expect(screen.queryByRole("menu")).toBeNull();
    context("notes.txt");
    fireEvent.resize(window);
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("opens a tree folder in place and preserves menus during internal scroll", async () => {
    installTreeBridge();
    render(<App startPath="/home/jc" actionMenu />);
    key("e", { ctrlKey: true });
    const folder = await screen.findByRole("treeitem", { name: "src" });
    const expanded = folder.getAttribute("aria-expanded");
    fireEvent.contextMenu(folder);
    fireEvent.scroll(screen.getByRole("tree"));
    expect(screen.getByRole("menu")).toBeDefined();
    key("Enter");
    await waitFor(() => expect(folder.getAttribute("aria-expanded")).not.toBe(expanded));
    expect(screen.getByRole("tree")).toBeDefined();
    fireEvent.contextMenu(folder);
    fireEvent.wheel(screen.getByRole("tree"));
    expect(screen.queryByRole("menu")).toBeNull();
    key("/");
    fireEvent.contextMenu(folder);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
