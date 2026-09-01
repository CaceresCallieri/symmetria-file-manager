import { describe, expect, it } from "vitest";

import {
  createPickerHost,
  type OpenPickerWindow,
  PICKER_TITLE_PREFIX,
  type PickerWindow,
  pickerWindowTitle,
} from "../src/main/picker.ts";

/**
 * One picker at a time, and a title the compositor can route by.
 *
 * The window itself is injected rather than constructed here, for the same
 * reason `buildWindowOptions` is a pure function: the decisions worth testing —
 * how many windows open, which request owns the open one, what the window is
 * called — must not need a display to check. The real window is exercised by
 * the smoke test, which launches Electron under a virtual display.
 */

const FIFO_A = "/tmp/symmetria-picker-aaaa.fifo";
const FIFO_B = "/tmp/symmetria-picker-bbbb.fifo";

const OPTIONS = {
  title: "Select a File",
  acceptLabel: "",
  multiple: false,
  directory: false,
  saveMode: false,
  suggestedName: "",
  currentFolder: "",
} as const;

function request(fifo: string, title = "Select a File") {
  return { cmd: "createPicker", fifo, options: { ...OPTIONS, title } } as const;
}

/** A window that records what was asked of it and can pretend the user closed it. */
function fakeWindow() {
  const enforced: string[] = [];
  let closedListener: (() => void) | null = null;
  let closeCalls = 0;
  let releases = 0;
  let gone = false;

  const window: PickerWindow = {
    enforceTitle: (title) => {
      enforced.push(title);
    },
    onClosed: (listener) => {
      closedListener = listener;
    },
    close: () => {
      closeCalls += 1;
    },
    isGone: () => gone,
    release: () => {
      releases += 1;
    },
  };

  return {
    window,
    enforced,
    closeCalls: () => closeCalls,
    releases: () => releases,
    /** What the real window does when it has really gone AND says so. */
    fireClosed: () => closedListener?.(),
    /**
     * What a window looks like once it is gone but its close event has not
     * arrived — a crashed renderer the host has just destroyed, or the gap
     * between a forced destroy and the `closed` that follows it.
     */
    dieSilently: () => {
      gone = true;
    },
  };
}

/** A factory that hands out fresh fake windows and remembers every call. */
function factory() {
  const opened: { title: string; window: ReturnType<typeof fakeWindow> }[] = [];
  const open: OpenPickerWindow = (_command, title) => {
    const made = fakeWindow();
    opened.push({ title, window: made });
    return made.window;
  };
  return { open, opened };
}

describe("the picker window's title is a compositor contract", () => {
  it("always begins with the routing prefix, whatever the caller asked to call it", () => {
    // `~/.dotfiles/.config/hypr/windowrules.conf` routes this application to the
    // `files` workspace and EXCLUDES the picker by title, because Chromium sets
    // the Wayland app id once per process — every window of this daemon carries
    // the same class, so the title is the only discriminator there is. A picker
    // whose title misses the prefix is dragged onto the file manager's own
    // workspace, away from the application that asked for it.
    for (const asked of ["Save your download", "", "Choose a file", "Открыть файл"]) {
      expect(pickerWindowTitle(asked).startsWith(PICKER_TITLE_PREFIX), asked).toBe(true);
    }
  });

  it("still shows what the calling application asked to call it", () => {
    expect(pickerWindowTitle("Save your download")).toContain("Save your download");
  });

  it("does not repeat the prefix when the caller already used it", () => {
    expect(pickerWindowTitle("Choose a file")).toBe(PICKER_TITLE_PREFIX);
  });
});

describe("one picker at a time", () => {
  it("opens exactly one window for a create", () => {
    const f = factory();
    const host = createPickerHost(f.open);

    const outcome = host.create(request(FIFO_A));

    expect(outcome.ok).toBe(true);
    expect(f.opened).toHaveLength(1);
    expect(f.opened[0]?.title.startsWith(PICKER_TITLE_PREFIX)).toBe(true);
  });

  it("gives the window its title at construction and re-asserts it afterwards", () => {
    // Two separate needs. The compositor reads the title when the window MAPS,
    // so it has to be in the constructor options; and Electron lets the page's
    // own `<title>` replace it later, which would break the rule after the fact.
    const f = factory();
    const host = createPickerHost(f.open);

    host.create(request(FIFO_A));

    const made = f.opened[0];
    expect(made).toBeDefined();
    if (!made) return;
    expect(made.title.startsWith(PICKER_TITLE_PREFIX)).toBe(true);
    expect(made.window.enforced).toEqual([made.title]);
  });

  it("refuses a second create while one is open, and opens no window for it", () => {
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    const outcome = host.create(request(FIFO_B));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Distinguishable, because the portal backend branches on it: a busy
    // rejection has to be answerable on the new request's own FIFO, which a
    // generic failure could not be told apart from a broken daemon.
    expect(outcome.error.code).toBe("conflict");
    expect(f.opened).toHaveLength(1);
  });

  it("keeps the first picker open when it refuses the second", () => {
    // The rejection must not disturb the request that is legitimately in
    // progress — a user is looking at that window.
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    host.create(request(FIFO_B));

    expect(f.opened[0]?.window.closeCalls()).toBe(0);
    expect(host.openFifo()).toBe(FIFO_A);
  });

  it("accepts a new create once the open one has gone", () => {
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    f.opened[0]?.window.fireClosed();
    const outcome = host.create(request(FIFO_B));

    expect(outcome.ok).toBe(true);
    expect(f.opened).toHaveLength(2);
    expect(host.openFifo()).toBe(FIFO_B);
  });

  it("reports no open picker before the first create", () => {
    expect(createPickerHost(factory().open).openFifo()).toBe(null);
  });
});

describe("a picker window that is gone before its close event arrives", () => {
  /**
   * The defect verification found and instrumentation confirmed.
   *
   * The slot used to be cleared only by the window's close event, and that
   * event is not guaranteed to have arrived — a crashed renderer leaves a live
   * window around a dead process, and a forced destroy raises `closed`
   * asynchronously. The daemon then refused every later `createPicker` for the
   * rest of the process: on a machine where it runs for days, a file dialog
   * dead until the next login.
   */
  it("does not hold the slot forever", () => {
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    f.opened[0]?.window.dieSilently();
    const outcome = host.create(request(FIFO_B));

    expect(outcome.ok).toBe(true);
    expect(f.opened).toHaveLength(2);
    expect(host.openFifo()).toBe(FIFO_B);
  });

  it("gives back what that window was holding", () => {
    // The other half, and it is not cosmetic: the window's streams and file
    // watches live in the IPC registry under a STRONG key, so a slot cleared
    // without releasing trades one permanent leak for another. Review found
    // that the first version of this fix would have done exactly that.
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    f.opened[0]?.window.dieSilently();
    host.create(request(FIFO_B));

    expect(f.opened[0]?.window.releases()).toBe(1);
  });

  it("reports the slot as empty rather than naming a window nobody can see", () => {
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    f.opened[0]?.window.dieSilently();

    expect(host.openFifo()).toBe(null);
  });

  it("stops a close from reaching a window that has already gone", () => {
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    f.opened[0]?.window.dieSilently();
    host.close({ cmd: "closePicker", fifo: FIFO_A });

    expect(f.opened[0]?.window.closeCalls()).toBe(0);
  });
});

describe("closing a picker", () => {
  it("closes the window when the fifo names the open picker", () => {
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    const outcome = host.close({ cmd: "closePicker", fifo: FIFO_A });

    expect(outcome.ok).toBe(true);
    expect(f.opened[0]?.window.closeCalls()).toBe(1);
  });

  it("does nothing when the fifo names a different request", () => {
    // The portal sends this when the CALLING application withdraws or dies, and
    // by then the picker it meant may already have been answered and replaced.
    // Honouring it blindly would close a dialog a different application is
    // waiting on. The Qt daemon compares the fifo for exactly this reason.
    const f = factory();
    const host = createPickerHost(f.open);
    host.create(request(FIFO_A));

    const outcome = host.close({ cmd: "closePicker", fifo: FIFO_B });

    expect(outcome.ok).toBe(true);
    expect(f.opened[0]?.window.closeCalls()).toBe(0);
    expect(host.openFifo()).toBe(FIFO_A);
  });

  it("is harmless when no picker is open", () => {
    const host = createPickerHost(factory().open);

    expect(host.close({ cmd: "closePicker", fifo: FIFO_A }).ok).toBe(true);
  });
});
