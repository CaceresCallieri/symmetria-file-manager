import { describe, expect, it } from "vitest";

import { PICKER_TITLE_PREFIX } from "../src/main/picker.ts";
import { WINDOW_CLASS } from "../src/main/window.ts";
import { focusOwnWindow, ownWindowAddress, windowFocuser } from "../src/main/windowFocus.ts";

/**
 * Taking the user to the file manager after another program opened something
 * in it.
 *
 * Measured on Hyprland 0.56.2 before this existed: an `open` while the user was
 * on another workspace answered `{"ok":true}` and moved nobody. The replies
 * below are `j/clients` shapes from that probe.
 */

const PID = 4242;

function client(fields: Record<string, unknown>) {
  return {
    address: "0xbrowse",
    pid: PID,
    class: WINDOW_CLASS,
    title: "Symmetria File Manager",
    mapped: true,
    hidden: false,
    ...fields,
  };
}

describe("ownWindowAddress", () => {
  it("finds this process's browse window", () => {
    const clients = JSON.stringify([
      client({ address: "0xother", pid: 7, class: "zen" }),
      client({}),
    ]);
    expect(ownWindowAddress(clients, PID)).toBe("0xbrowse");
  });

  it("skips a picker, which shares the class and the pid", () => {
    const clients = JSON.stringify([
      client({ address: "0xpicker", title: `${PICKER_TITLE_PREFIX} — Upload` }),
      client({}),
    ]);
    expect(ownWindowAddress(clients, PID)).toBe("0xbrowse");
  });

  it("skips another process's window of the same class", () => {
    // A second daemon, say one a test launched: not ours to focus.
    expect(ownWindowAddress(JSON.stringify([client({ pid: 99 })]), PID)).toBeNull();
  });

  it("skips a window that is not mapped or is hidden", () => {
    expect(ownWindowAddress(JSON.stringify([client({ mapped: false })]), PID)).toBeNull();
    expect(ownWindowAddress(JSON.stringify([client({ hidden: true })]), PID)).toBeNull();
  });

  it("declines a reply it cannot read", () => {
    expect(ownWindowAddress("not json", PID)).toBeNull();
    expect(ownWindowAddress("{}", PID)).toBeNull();
  });
});

describe("focusOwnWindow", () => {
  it("focuses the window by address", async () => {
    const asked: string[] = [];
    const request = async (line: string) => {
      asked.push(line);
      return line === "j/clients" ? JSON.stringify([client({})]) : "ok";
    };
    expect(await focusOwnWindow(request, PID, async () => undefined)).toBe(true);
    expect(asked).toEqual(["j/clients", "dispatch focuswindow address:0xbrowse"]);
  });

  it("waits for a window that `show()` has not mapped yet", async () => {
    // A hidden window is mapped again by `show()`, a few frames later.
    let looks = 0;
    const request = async (line: string) => {
      if (line !== "j/clients") return "ok";
      looks += 1;
      return JSON.stringify(looks < 3 ? [] : [client({})]);
    };
    expect(await focusOwnWindow(request, PID, async () => undefined)).toBe(true);
    expect(looks).toBe(3);
  });

  it("gives up, bounded, when the window never appears", async () => {
    let looks = 0;
    const request = async () => {
      looks += 1;
      return "[]";
    };
    expect(await focusOwnWindow(request, PID, async () => undefined)).toBe(false);
    expect(looks).toBeLessThanOrEqual(12);
  });

  it("stops at once when Hyprland does not answer", async () => {
    let looks = 0;
    const request = async () => {
      looks += 1;
      return null;
    };
    expect(await focusOwnWindow(request, PID, async () => undefined)).toBe(false);
    expect(looks).toBe(1);
  });
});

describe("windowFocuser", () => {
  it("does nothing without a Hyprland to talk to", async () => {
    expect(await windowFocuser(null, PID)()).toBe(false);
  });
});
