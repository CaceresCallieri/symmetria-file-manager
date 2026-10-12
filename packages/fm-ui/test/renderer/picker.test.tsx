/**
 * @vitest-environment happy-dom
 *
 * The panel, when it is a file dialog rather than a file manager.
 *
 * A picker is the same panel with chrome added and some keys taken away. What
 * is guarded here is the difference: that the chrome appears only in a dialog,
 * that confirming sends what the user chose rather than what the cursor
 * happens to be on, and that the suppression ported with the keyboard registry
 * — inert since the phase that introduced it — is finally live.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../../src/App.tsx";
import { type BridgeLog, installBridge, installFilePreview, namesIn } from "./support.ts";

let log: BridgeLog;

beforeEach(() => {
  log = installBridge();
});
afterEach(cleanup);

const FIFO = "/tmp/symmetria-picker-test.fifo";

const OPTIONS = {
  title: "Select a File",
  acceptLabel: "",
  multiple: false,
  directory: false,
  saveMode: false,
  suggestedName: "",
  currentFolder: "",
};

function requestFor(overrides: Partial<typeof OPTIONS> = {}) {
  return { fifo: FIFO, options: { ...OPTIONS, ...overrides } };
}

/** Render the panel as a dialog and wait for its listing. */
async function openPicker(overrides: Partial<typeof OPTIONS> = {}): Promise<void> {
  render(<App startPath="/home/jc" homePath="/home/jc" picker={requestFor(overrides)} />);
  await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
  await act(async () => undefined);
}

/** Render the ordinary browse panel. */
async function openBrowser(): Promise<void> {
  render(<App startPath="/home/jc" homePath="/home/jc" />);
  await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
  await act(async () => undefined);
}

/**
 * Put the cursor on the first FILE.
 *
 * The fixture home opens on `projects`, a DIRECTORY, and a file dialog will not
 * accept one — so the cursor has to move before confirming means anything. One
 * `j` reaches `notes.txt`.
 *
 * The fake bridge returns the listing in DECLARATION order: sorting is the main
 * process's job and there is no main process here. So the index is the
 * fixture's own order and not the sorted one, which is why this is one press
 * rather than four. The fixture's comment forbids inserting entries into that
 * listing for exactly this reason — the whole suite counts `j` from the top.
 */
async function moveToFirstFile(): Promise<void> {
  fireEvent.keyDown(window, { key: "j" });
  await act(async () => undefined);
}

describe("the chrome appears only in a dialog", () => {
  it("shows an Accept and a Cancel button in a picker", async () => {
    await openPicker();

    expect(screen.getByTestId("picker-accept")).toBeTruthy();
    expect(screen.getByTestId("picker-cancel")).toBeTruthy();
  });

  it("shows neither in the browse window", async () => {
    // The resident window must be untouched by this phase. It is the thing the
    // operator uses all day and it is not a dialog.
    await openBrowser();

    expect(screen.queryByTestId("picker-accept")).toBeNull();
    expect(screen.queryByTestId("picker-cancel")).toBeNull();
    expect(screen.queryByTestId("picker-save-name")).toBeNull();
  });

  it("shows the save-filename field only in a save dialog", async () => {
    await openPicker({ saveMode: true, suggestedName: "report.pdf" });

    const field = screen.getByTestId("picker-save-name") as HTMLInputElement;
    expect(field.value).toBe("report.pdf");
  });

  it("hides the save-filename field in an open dialog", async () => {
    await openPicker();

    expect(screen.queryByTestId("picker-save-name")).toBeNull();
  });

  it("labels the Accept button as the calling application asked", async () => {
    await openPicker({ acceptLabel: "Attach" });

    expect(screen.getByTestId("picker-accept").textContent).toBe("Attach");
  });
});

describe("confirming a picker", () => {
  it("sends the entry under the cursor, with its fifo", async () => {
    // The cursor starts on a DIRECTORY in this fixture, and a file dialog will
    // not accept one — so the cursor is moved to a file first. Discovering that
    // is the point of driving the real panel rather than the pure function:
    // the truth table is tested in `pickerSelection.test.ts`, and what is
    // tested here is that the panel feeds it the right thing.
    await openPicker();
    await moveToFirstFile();

    fireEvent.click(screen.getByTestId("picker-accept"));
    await act(async () => undefined);

    expect(log.pickerConfirms).toHaveLength(1);
    expect(log.pickerConfirms[0]?.fifo).toBe(FIFO);
    expect(log.pickerConfirms[0]?.paths[0]).toContain("/home/jc/");
  });

  it("sends the directory joined to the typed name in a save dialog", async () => {
    // What the user typed is the answer, not the row under the cursor. A save
    // dialog that returned the highlighted file would overwrite it.
    await openPicker({ saveMode: true, suggestedName: "old.txt" });

    const field = screen.getByTestId("picker-save-name");
    fireEvent.change(field, { target: { value: "new-name.txt" } });
    fireEvent.click(screen.getByTestId("picker-accept"));
    await act(async () => undefined);

    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/new-name.txt"]);
  });

  it("sends nothing when the cursor is on the wrong kind of thing", async () => {
    // A FILE in a directory dialog. `G` puts the cursor on the last entry,
    // which the fixture makes a file.
    await openPicker({ directory: true });
    await moveToFirstFile();

    fireEvent.click(screen.getByTestId("picker-accept"));
    await act(async () => undefined);

    expect(log.pickerConfirms).toEqual([]);
  });

  it("disables the Accept button when confirming would do nothing", async () => {
    // The button and the answer come from ONE function, so they cannot
    // disagree — and this is what pins that they do not.
    await openPicker({ directory: true });
    await moveToFirstFile();

    expect((screen.getByTestId("picker-accept") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("cancelling a picker", () => {
  it("sends the cancel with its fifo when the button is pressed", async () => {
    await openPicker();
    fireEvent.click(screen.getByTestId("picker-cancel"));
    await act(async () => undefined);

    expect(log.pickerCancels).toEqual([FIFO]);
  });

  it("sends the cancel when Escape reaches the dialog", async () => {
    await openPicker();
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => undefined);

    expect(log.pickerCancels).toEqual([FIFO]);
  });
});

describe("the keys a dialog takes away", () => {
  it("does not paste in a picker", async () => {
    // The suppression pre-pass has been ported and inert since the registry
    // phase, because `PickerState.active` was hardcoded false. This is the
    // first thing that proves it runs.
    await openPicker();
    fireEvent.keyDown(window, { key: "p" });
    await act(async () => undefined);

    expect(log.transferIds).toEqual([]);
  });

  it("still pastes in the browse window", async () => {
    // The other half, and the one that catches over-suppression: a pre-pass
    // that ran everywhere would break the file manager the operator uses.
    await openBrowser();
    fireEvent.keyDown(window, { key: "y" });
    fireEvent.keyDown(window, { key: "p" });
    await act(async () => undefined);

    // `y` yanks and `p` pastes; with nothing yanked the paste is a no-op, so
    // what is asserted is that the key was DISPATCHED rather than swallowed.
    expect(screen.queryByTestId("status-strip")?.textContent ?? "").not.toContain(
      "is not built yet",
    );
  });

  it("keeps space marking usable in a multi-select dialog", async () => {
    // Space is suppressed in a picker EXCEPT under multi-select, where marking
    // before confirming is the whole point.
    // On a FILE, because a folder marked in a file dialog is deliberately not
    // counted — the button's number is the number of paths pressing it returns.
    await openPicker({ multiple: true });
    await moveToFirstFile();
    fireEvent.keyDown(window, { key: " " });
    await act(async () => undefined);

    expect(screen.getByTestId("picker-accept").textContent).toBe("Select (1)");
  });
});

describe("a mark the dialog will not take", () => {
  it("is not counted on the button", async () => {
    // The fixture opens on a directory, and this is a FILE dialog. Review found
    // the marked branch was the one place an entry's kind was never checked, so
    // a caller asking for files could be handed a folder the user had marked.
    await openPicker({ multiple: true });
    fireEvent.keyDown(window, { key: " " });
    await act(async () => undefined);

    expect(screen.getByTestId("picker-accept").textContent).toBe("Select");
  });
});

describe("Enter inside a dialog", () => {
  /**
   * The defect verification found, and the one with consequences outside this
   * process.
   *
   * Enter fell through to the ordinary "activate" action, which hands a file to
   * the desktop's default application. Driven for real under a virtual display,
   * it launched a terminal running an editor on `/etc/xattr.conf` — on the
   * operator's own session that window would have appeared on their desktop.
   *
   * The earlier implementation routes Enter through `confirmPickerSelection`, the same
   * function its Accept button uses, for exactly this reason.
   */
  it("confirms rather than handing the file to another application", async () => {
    await openPicker();
    await moveToFirstFile();

    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);

    expect(log.pickerConfirms).toHaveLength(1);
    expect(log.ops.filter((each) => each.startsWith("open "))).toEqual([]);
  });

  it("still enters a directory, because that is how you reach a file", async () => {
    // Browsing has to keep working: a dialog that confirmed the directory under
    // the cursor could never be navigated at all.
    await openPicker();
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);

    expect(log.pickerConfirms).toEqual([]);
    expect(log.ops.filter((each) => each.startsWith("open "))).toEqual([]);
  });

  it("does nothing on a file the dialog will not accept", async () => {
    await openPicker({ directory: true });
    await moveToFirstFile();

    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);

    expect(log.pickerConfirms).toEqual([]);
    expect(log.ops.filter((each) => each.startsWith("open "))).toEqual([]);
  });

  it("still opens a file in the browse window", async () => {
    // The other half. Suppressing the external open everywhere would break the
    // file manager the operator uses all day.
    await openBrowser();
    await moveToFirstFile();

    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);

    expect(log.ops.filter((each) => each.startsWith("open "))).toHaveLength(1);
  });
});

describe("a focused dialog button keeps its own Enter", () => {
  it("leaves Enter on Cancel to the button, so it never confirms the file under the cursor", async () => {
    await openPicker();
    await moveToFirstFile();
    const cancel = screen.getByTestId("picker-cancel");
    cancel.focus();

    // `true`: nothing called preventDefault, so the browser's own activation
    // (a click on Cancel) runs. Before, `nav.activate` took the key and
    // confirmed `notes.txt`.
    expect(fireEvent.keyDown(cancel, { key: "Enter" })).toBe(true);
    await act(async () => undefined);
    expect(log.pickerConfirms).toEqual([]);
  });

  it("leaves Space on Accept to the button, so the keymap does not also act", async () => {
    await openPicker();
    await moveToFirstFile();
    const accept = screen.getByTestId("picker-accept");
    accept.focus();

    expect(fireEvent.keyDown(accept, { key: " " })).toBe(true);
    await act(async () => undefined);
    expect(log.pickerConfirms).toEqual([]);
  });
});

describe("entering a picker path", () => {
  function editPath(value: string) {
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    const field = screen.getByRole("textbox", { name: "File or folder path" });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value } });
    fireEvent.keyDown(field, { key: "Enter" });
    return field;
  }

  it.each([
    "/home/jc/projects/beta.md",
    "/home//jc/projects//beta.md",
    "projects/beta.md",
    "./projects/./beta.md",
    "~/projects/beta.md",
    "file:///home/jc/projects/beta%2Emd",
  ])("reveals %s and confirms it on the next Enter", async (value) => {
    await openPicker();
    editPath(value);
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull(),
    );
    expect(screen.getByTestId("crumb-current").textContent).toBe("projects");
    expect(log.pickerConfirms).toEqual([]);
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/projects/beta.md"]);
    expect(log.ops.filter((each) => each.startsWith("open "))).toEqual([]);
  });

  it("opens a pasted folder without confirming a file", async () => {
    await openPicker();
    editPath("/home/jc/projects/");
    await waitFor(() => expect(screen.getByTestId("crumb-current").textContent).toBe("projects"));
    expect(log.pickerConfirms).toEqual([]);
  });

  it.each([
    "/does-not-exist",
    "/home/jc/locked",
    "https://example.com/file",
    "file://other-host/tmp/file",
    "file:///tmp/%ZZ",
  ])("keeps %s editable and reports the error", async (value) => {
    await openPicker();
    const field = editPath(value);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(document.activeElement).toBe(field);
    expect(namesIn("column-current")).toContain("notes.txt");
    expect(log.pickerConfirms).toEqual([]);
  });

  it("leaves the path field with Escape and keeps the picker open", async () => {
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Enter file or folder path (Ctrl+L)" }));
    const field = screen.getByRole("textbox", { name: "File or folder path" });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull();
    expect(log.pickerCancels).toEqual([]);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => undefined);
    expect(log.pickerCancels).toEqual([FIFO]);
  });

  it("clears old marks before revealing a pasted file", async () => {
    await openPicker({ multiple: true });
    await moveToFirstFile();
    fireEvent.keyDown(window, { key: " " });
    editPath("/home/jc/todo.txt");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull(),
    );
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/todo.txt"]);
  });

  it("does not edit paths in the browse window", async () => {
    await openBrowser();
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull();
  });

  it("keeps directory-picker cursor selection after navigating to a pasted folder", async () => {
    await openPicker({ directory: true });
    editPath("/home/jc/projects");
    await waitFor(() => expect(namesIn("column-current")).toContain("alpha"));
    expect(log.pickerConfirms).toEqual([]);
    fireEvent.click(screen.getByTestId("picker-accept"));
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/projects/alpha"]);
  });

  it("does not take Ctrl+L from a modal", async () => {
    await openPicker();
    fireEvent.keyDown(window, { key: "?" });
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull();
  });

  it("reveals hidden files by enabling hidden entries first", async () => {
    installFilePreview("/home/jc/dotted/.secret", "text/plain", "secret");
    await openPicker();
    editPath("/home/jc/dotted/.secret");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull(),
    );
    expect(log.listAsks.some((list) => list.path === "/home/jc/dotted" && list.showHidden)).toBe(
      true,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/dotted/.secret"]);
    expect(log.listingWrites).toEqual([]);
  });

  it("keeps the path editor out of save dialogs", async () => {
    await openPicker({ saveMode: true, suggestedName: "new.txt" });
    expect(screen.queryByRole("button", { name: "Enter file or folder path (Ctrl+L)" })).toBeNull();
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull();
    fireEvent.click(screen.getByTestId("picker-accept"));
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/new.txt"]);
  });

  it.each(["e", "o"])("keeps Ctrl+%s from opening a second view in a picker", async (key) => {
    render(
      <App startPath="/home/jc" homePath="/home/jc" picker={requestFor()} chrome="atmosphere" />,
    );
    await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key, ctrlKey: true });
    await act(async () => undefined);
    expect(namesIn("column-current")).toContain("notes.txt");
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(screen.getByRole("textbox", { name: "File or folder path" })).toBeTruthy();
  });

  it("keeps repeated Enter and Accept from confirming the old file during a read", async () => {
    await openPicker();
    await moveToFirstFile();
    const release = log.holdNextList("/home/jc/projects", ["beta.md"]);
    const field = editPath("/home/jc/projects/beta.md");
    await act(async () => undefined);
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByTestId("picker-accept"));
    expect(log.pickerConfirms).toEqual([]);
    expect((screen.getByTestId("picker-accept") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => release());
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull(),
    );
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/projects/beta.md"]);
  });

  it("cancels a pending path read with Escape", async () => {
    await openPicker();
    const release = log.holdNextList("/home/jc/projects", ["beta.md"]);
    const field = editPath("/home/jc/projects/beta.md");
    await act(async () => undefined);
    fireEvent.keyDown(field, { key: "Escape" });
    await act(async () => release());
    expect(screen.getByTestId("crumb-current").textContent).toBe("jc");
    expect(log.pickerConfirms).toEqual([]);
    expect(log.pickerCancels).toEqual([]);
  });

  it("returns to the source folder when Escape cancels an unfinished reveal", async () => {
    await openPicker();
    const validate = log.holdNextList("/home/jc/projects", ["beta.md"]);
    const field = editPath("/home/jc/projects/beta.md");
    await act(async () => undefined);
    const reveal = log.holdNextList("/home/jc/projects", ["beta.md"]);
    await act(async () => validate());
    expect(field.getAttribute("aria-busy")).toBe("true");
    fireEvent.keyDown(field, { key: "Escape" });
    await act(async () => reveal());
    await waitFor(() => expect(namesIn("column-current")).toContain("notes.txt"));
    expect(screen.getByTestId("crumb-current").textContent).toBe("jc");
    expect(log.pickerConfirms).toEqual([]);
    expect(log.pickerCancels).toEqual([]);
  });

  it("waits for a fresh reveal even after a navigation error", async () => {
    await openPicker();
    for (let index = 0; index < 4; index++) fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "l" });
    await waitFor(() => expect(screen.getByTestId("crumb-current").textContent).toBe("jc"));
    await act(async () => undefined);
    const validate = log.holdNextList("/home/jc/projects", ["beta.md"]);
    const field = editPath("/home/jc/projects/beta.md");
    await act(async () => undefined);
    const reveal = log.holdNextList("/home/jc/projects", ["beta.md"]);
    await act(async () => validate());
    expect(screen.getByRole("textbox", { name: "File or folder path" })).toBe(field);
    expect(field.getAttribute("aria-busy")).toBe("true");
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.click(screen.getByTestId("picker-accept"));
    expect(log.pickerConfirms).toEqual([]);
    await act(async () => reveal());
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull(),
    );
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/projects/beta.md"]);
  });

  it("provides the same path field in the standalone header", async () => {
    render(
      <App startPath="/home/jc" homePath="/home/jc" picker={requestFor()} chrome="atmosphere" />,
    );
    await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
    editPath("/home/jc/notes.txt");
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "File or folder path" })).toBeNull(),
    );
    fireEvent.keyDown(window, { key: "Enter" });
    await act(async () => undefined);
    expect(log.pickerConfirms[0]?.paths).toEqual(["/home/jc/notes.txt"]);
  });
});
