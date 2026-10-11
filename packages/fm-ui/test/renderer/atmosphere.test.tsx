/**
 * @vitest-environment happy-dom
 *
 * The standalone's Atmosphere chrome, and the promise that it stays opt-in.
 *
 * Mesura Code mounts `App` with no `chrome` prop and no `rowHeight`, so the
 * first block pins what it must keep getting. The rest drives the header and
 * the rail the way a pointer does and checks that each control reaches the
 * action its key already reaches.
 *
 * happy-dom has no layout engine, so nothing here measures a pixel. The row
 * height is read where the virtualiser writes it: the spacer's height is
 * `count × rowHeight`.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../src/App.tsx";
import { type BridgeOptions, HOME_ENTRY_COUNT, installBridge, namesIn } from "./support.ts";

afterEach(cleanup);

async function opened(atmosphere: boolean, options: BridgeOptions = {}, startPath = "/home/jc") {
  const log = installBridge(options);
  render(
    atmosphere ? (
      <App startPath={startPath} homePath="/home/jc" chrome="atmosphere" rowHeight={31} />
    ) : (
      <App startPath={startPath} homePath="/home/jc" />
    ),
  );
  await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
  await act(async () => undefined);
  return log;
}

function header(): HTMLElement {
  const found = document.querySelector<HTMLElement>(".atmo-header");
  if (found === null) throw new Error("no Atmosphere header");
  return found;
}

function rail(): HTMLElement {
  return screen.getByRole("navigation", { name: "Places" });
}

/** The current column's spacer: the virtualiser sets it to `count × rowHeight`. */
function spacerHeight(): string {
  const spacer = screen.getByTestId("column-current").firstElementChild;
  return spacer instanceof HTMLElement ? spacer.style.height : "";
}

function where(): string {
  return screen.getByTestId("crumb-current").textContent ?? "";
}

describe("a host that asks for no chrome", () => {
  it("gets no header, no rail and no window wrapper", async () => {
    await opened(false);

    expect(document.querySelector(".atmo-window")).toBeNull();
    expect(document.querySelector(".atmo-header")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Places" })).toBeNull();
    expect(document.querySelector(".app")?.className).toBe("app");
  });

  it("keeps 24px rows", async () => {
    await opened(false);

    expect(spacerHeight()).toBe(`${HOME_ENTRY_COUNT * 24}px`);
  });

  it("shows the tree alone, with no preview beside it", async () => {
    await opened(false);
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });

    await screen.findByRole("region", { name: "Project file tree" });
    expect(document.querySelector(".tree-split")).toBeNull();
  });
});

describe("the Atmosphere chrome", () => {
  it("lays rows out at the height the host passes", async () => {
    await opened(true);

    expect(spacerHeight()).toBe(`${HOME_ENTRY_COUNT * 31}px`);
  });

  it("draws one breadcrumb, in the header", async () => {
    await opened(true);

    expect(screen.getAllByTestId("path-bar")).toHaveLength(1);
    expect(header().contains(screen.getByTestId("path-bar"))).toBe(true);
  });

  it("keeps keyboard focus where it was when a header button is pressed", async () => {
    await opened(true);
    const search = within(header()).getByRole("button", { name: /Search/ });

    // `fireEvent` answers false when a handler called `preventDefault`, which
    // is what stops the button from taking focus away from the keymap.
    expect(fireEvent.mouseDown(search)).toBe(false);
  });

  it("opens the search from the Search button", async () => {
    await opened(true);

    fireEvent.click(within(header()).getByRole("button", { name: /Search/ }));

    expect(await screen.findByTestId("search-field")).toBeTruthy();
  });

  it("switches between columns, tree and overview, and marks the active view", async () => {
    await opened(true);
    const views = within(header()).getByRole("radiogroup", { name: "View" });
    const button = (name: RegExp) => within(views).getByRole("button", { name });

    expect(button(/^Columns/).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button(/^File tree/));
    await screen.findByRole("region", { name: "Project file tree" });
    expect(button(/^File tree/).getAttribute("aria-pressed")).toBe("true");
    // The standalone composes a preview beside the tree; `FileTree` itself
    // stays a bare tree for Mesura Code's pane.
    expect(document.querySelector(".tree-split [data-testid='column-preview']")).not.toBeNull();

    fireEvent.click(button(/^Folder overview/));
    await screen.findByRole("dialog", { name: "Folder overview" });
    expect(button(/^Folder overview/).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button(/^Columns/));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Folder overview" })).toBeNull(),
    );
    await waitFor(() => expect(namesIn("column-current").length).toBe(HOME_ENTRY_COUNT));
    expect(screen.queryByRole("region", { name: "Project file tree" })).toBeNull();
  });

  it("goes back and forward through the history buttons", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "l" });
    await waitFor(() => expect(where()).toBe("projects"));

    fireEvent.click(within(header()).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(where()).toBe("jc"));

    fireEvent.click(within(header()).getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(where()).toBe("projects"));
  });

  it("opens a new tab from the plus button", async () => {
    await opened(true);
    const tabs = () => header().querySelectorAll(".tab").length;
    expect(tabs()).toBe(1);

    fireEvent.click(within(header()).getByRole("button", { name: "New tab" }));

    await waitFor(() => expect(tabs()).toBe(2));
  });

  it("opens help from the keyboard button", async () => {
    await opened(true);

    fireEvent.click(within(header()).getByRole("button", { name: /Keyboard shortcuts/ }));

    expect(await screen.findByTestId("help-overlay")).toBeTruthy();
  });
});

describe("the rail", () => {
  it("goes to a place, and marks the place the pane is in", async () => {
    await opened(true, {}, "/home/jc/projects");
    const home = within(rail()).getByRole("button", { name: /^Home/ });
    expect(home.getAttribute("aria-current")).toBeNull();

    fireEvent.click(home);

    await waitFor(() => expect(where()).toBe("jc"));
    expect(home.getAttribute("aria-current")).toBe("page");
  });

  it("lists the bookmarks by letter and goes to one", async () => {
    await opened(true);
    // The seed's `r` is `/home/jc/projects`.
    const projects = within(rail()).getByRole("button", { name: /^R projects gr$/ });

    fireEvent.click(projects);

    await waitFor(() => expect(where()).toBe("projects"));
  });
});

describe("the disk meter", () => {
  it("is absent when the host's bridge cannot measure", async () => {
    await opened(true);

    expect(screen.queryByRole("meter", { name: "Disk usage" })).toBeNull();
  });

  it("measures the filesystem holding the current directory", async () => {
    const log = await opened(true, { diskUsage: { total: 1024 ** 4, free: 256 * 1024 ** 3 } });

    const meter = await screen.findByRole("meter", { name: "Disk usage" });
    expect(meter.getAttribute("value")).toBe("0.75");
    expect(rail().textContent).toContain("256.0 GB free of 1.0 TB");
    expect(rail().textContent).toContain("75%");
    expect(log.diskAsks).toContain("/home/jc");

    fireEvent.keyDown(window, { key: "l" });
    await waitFor(() => expect(log.diskAsks).toContain("/home/jc/projects"));
  });

  it.each([
    [10.01, "ok"],
    [10, "warn"],
    [3.01, "warn"],
    [3, "full"],
  ])("with %s%% free, sets the level %s (the bounds are inclusive)", async (free, level) => {
    await opened(true, { diskUsage: { total: 100, free } });

    await screen.findByRole("meter", { name: "Disk usage" });
    expect(document.querySelector(".atmo-disk")?.getAttribute("data-level")).toBe(level);
  });
});

describe("what the Atmosphere stylesheet reads from the markup", () => {
  it("labels the status bar's mode", async () => {
    await opened(true);
    const mode = () => document.querySelector(".status-bar__mode")?.getAttribute("data-label");

    expect(mode()).toBe("Normal");

    fireEvent.keyDown(window, { key: "/" });
    await screen.findByTestId("search-field");
    expect(mode()).toBe("Search");
  });

  it("names a previewed folder and counts what it holds", async () => {
    await opened(true);

    await waitFor(() =>
      expect(document.querySelector(".preview-head__kind")?.textContent).toBe("Folder · 2 items"),
    );
    expect(document.querySelector(".preview-head__name")?.textContent).toBe("projects");
  });

  it("keeps a row's text its name, with size and date in attributes", async () => {
    await opened(true);
    const row = screen
      .getAllByTestId("row")
      .find((each) => each.textContent?.includes("notes.txt"));

    expect(row?.textContent).toBe("notes.txt");
    expect(row?.querySelector(".row__size")?.getAttribute("data-value")).toBe("3 B");
    // A directory's size is its inode, not its contents, so it stays blank.
    const projects = screen.getAllByTestId("row").find((each) => each.textContent === "projects");
    expect(projects?.querySelector(".row__size")?.getAttribute("data-value")).toBe("");
  });
});

describe("header controls are gated as their keys are", () => {
  const PICKER = {
    fifo: "/tmp/fake.fifo",
    options: {
      title: "Select a File",
      acceptLabel: "",
      multiple: false,
      directory: false,
      saveMode: false,
      suggestedName: "",
      currentFolder: "",
    },
  };

  async function openedAsPicker() {
    installBridge();
    render(
      <App
        startPath="/home/jc"
        homePath="/home/jc"
        chrome="atmosphere"
        rowHeight={31}
        picker={PICKER}
      />,
    );
    await waitFor(() => expect(namesIn("column-current").length).toBeGreaterThan(0));
    await act(async () => undefined);
  }

  it("refuses the overview, the tree and a new tab in a file dialog", async () => {
    await openedAsPicker();
    const views = within(header()).getByRole("radiogroup", { name: "View" });

    fireEvent.click(within(views).getByRole("button", { name: /^Folder overview/ }));
    fireEvent.click(within(views).getByRole("button", { name: /^File tree/ }));
    fireEvent.click(within(header()).getByRole("button", { name: "New tab" }));
    await act(async () => undefined);

    expect(screen.queryByRole("dialog", { name: "Folder overview" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Project file tree" })).toBeNull();
    expect(header().querySelectorAll(".tab")).toHaveLength(1);
  });

  it("opens the overview's own search from the Search button in the overview", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Folder overview" });

    fireEvent.click(within(header()).getByRole("button", { name: /Search/ }));

    expect(await screen.findByRole("textbox", { name: "Search loaded paths" })).toBeTruthy();
    // The browsing search would open UNDER the inert overview, out of reach.
    expect(screen.queryByRole("textbox", { name: "Search this directory" })).toBeNull();
  });

  it("does nothing behind an open dialog", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "?" });
    await screen.findByTestId("help-overlay");

    fireEvent.click(within(header()).getByRole("button", { name: "New tab" }));
    await act(async () => undefined);

    expect(header().querySelectorAll(".tab")).toHaveLength(1);
  });
});

describe("the view switch from the overview", () => {
  it("reaches Columns when the overview was opened from the tree", async () => {
    await opened(true);
    const views = within(header()).getByRole("radiogroup", { name: "View" });
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    await screen.findByRole("region", { name: "Project file tree" });
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Folder overview" });

    fireEvent.click(within(views).getByRole("button", { name: /^Columns/ }));

    await waitFor(() =>
      expect(
        within(views)
          .getByRole("button", { name: /^Columns/ })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    expect(screen.queryByRole("region", { name: "Project file tree" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Folder overview" })).toBeNull();
  });

  it("reaches the tree when the overview was opened from Columns", async () => {
    await opened(true);
    const views = within(header()).getByRole("radiogroup", { name: "View" });
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Folder overview" });

    fireEvent.click(within(views).getByRole("button", { name: /^File tree/ }));

    await screen.findByRole("region", { name: "Project file tree" });
    expect(screen.queryByRole("dialog", { name: "Folder overview" })).toBeNull();
  });
});

describe("navigating from the chrome", () => {
  it("leaves the tree, so the window shows one place", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    await screen.findByRole("region", { name: "Project file tree" });

    fireEvent.click(within(rail()).getByRole("button", { name: /^R projects gr$/ }));

    await waitFor(() => expect(where()).toBe("projects"));
    expect(screen.queryByRole("region", { name: "Project file tree" })).toBeNull();
    await waitFor(() => expect(namesIn("column-current")).toEqual(["alpha", "beta.md"]));
  });

  it("keeps keyboard focus when a tab is clicked", async () => {
    await opened(true);
    fireEvent.click(within(header()).getByRole("button", { name: "New tab" }));
    await waitFor(() => expect(header().querySelectorAll(".tab")).toHaveLength(2));

    const [first] = within(header()).getAllByRole("button", { name: "jc" });
    expect(first === undefined ? true : fireEvent.mouseDown(first)).toBe(false);
    const [close] = within(header()).getAllByRole("button", { name: "Close jc" });
    expect(close === undefined ? true : fireEvent.mouseDown(close)).toBe(false);
  });
});

describe("the rail's places", () => {
  it("offers Home alone when the host cannot resolve user directories", async () => {
    await opened(true);
    await act(async () => undefined);

    const section = rail().querySelector(".atmo-rail-section");
    expect(section?.querySelectorAll("button")).toHaveLength(1);
    expect(within(rail()).getByRole("button", { name: /^Home/ })).toBeTruthy();
  });

  it("names each user directory as the user named it, and goes there", async () => {
    await opened(true, {
      places: [
        { kind: "download", path: "/home/jc/projects" },
        { kind: "music", path: "relative/ignored" },
      ],
    });

    const projects = await within(rail()).findByRole("button", { name: /^projects$/ });
    // The malformed row was dropped by the decoder, not drawn.
    expect(rail().querySelector(".atmo-rail-section")?.querySelectorAll("button")).toHaveLength(2);

    fireEvent.click(projects);
    await waitFor(() => expect(where()).toBe("projects"));
  });
});

describe("the preview head and the mode pill follow the truth", () => {
  it("counts every entry of a folder, not the capped listing", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "G", shiftKey: true });

    await waitFor(() =>
      expect(document.querySelector(".preview-head__name")?.textContent).toBe("many"),
    );
    expect(document.querySelector(".preview-head__kind")?.textContent).toBe("Folder · 537 items");
  });

  it("says Search while the tree's own search is open", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    await screen.findByRole("region", { name: "Project file tree" });

    fireEvent.keyDown(window, { key: "/" });
    await screen.findByRole("textbox", { name: "Search loaded paths" });

    await waitFor(() =>
      expect(document.querySelector(".status-bar__mode")?.getAttribute("data-label")).toBe(
        "Search",
      ),
    );
  });

  it("names the overview while it is open", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Folder overview" });

    expect(document.querySelector(".status-bar__mode")?.getAttribute("data-label")).toBe(
      "Overview",
    );
  });
});

describe("regressions the witnesses found", () => {
  it("keeps the rail clickable while the overview makes main inert", async () => {
    await opened(true);
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Folder overview" });

    expect(document.querySelector("main")?.hasAttribute("inert")).toBe(true);
    expect(rail().closest("[inert]")).toBeNull();
    expect(header().closest("[inert]")).toBeNull();
  });

  it("queues nothing behind a view-switch click a dialog swallowed", async () => {
    await opened(true);
    const views = within(header()).getByRole("radiogroup", { name: "View" });
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    await screen.findByRole("region", { name: "Project file tree" });
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Folder overview" });
    fireEvent.keyDown(window, { key: "?" });
    await screen.findByTestId("help-overlay");

    // Swallowed by the help dialog: nothing may happen now or later.
    fireEvent.click(within(views).getByRole("button", { name: /^Columns/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("help-overlay")).toBeNull());
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Folder overview" })).toBeNull(),
    );

    // The overview returns to the tree it was opened from, and stays there.
    await act(async () => undefined);
    expect(screen.queryByRole("region", { name: "Project file tree" })).not.toBeNull();
  });
});
