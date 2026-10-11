import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hyprlandSender,
  hyprlandSenderFor,
  hyprlandSocketPath,
  withDeadline,
} from "../src/main/hyprland.ts";
import { PICKER_TITLE_PREFIX } from "../src/main/picker.ts";
import {
  decodeCallerArea,
  pickerArea,
  pickerPlacer,
  pickerRuleRequests,
  placePicker,
} from "../src/main/pickerPlacement.ts";
import { WINDOW_CLASS, WINDOW_MINIMUM_SIZE } from "../src/main/window.ts";

/**
 * The picker opens over the window that asked for it.
 *
 * The replies below are the shapes Hyprland 0.56.2 returned on the operator's
 * laptop and on the server: a laptop panel at x=1920 with scale 1.6, and a Zen
 * window filling most of it. The laptop case is the one that caught `move`
 * being monitor-relative.
 */

const LAPTOP_MONITORS = JSON.stringify([
  {
    id: 0,
    name: "eDP-1",
    x: 1920,
    y: 0,
    width: 2560,
    height: 1600,
    scale: 1.6,
    transform: 0,
    focused: true,
  },
]);

const ZEN = JSON.stringify({
  address: "0x55a1",
  at: [1921, 37],
  size: [1598, 962],
  monitor: 0,
  class: "zen",
});

/** Two 1920x1080 monitors side by side; the FIRST has focus. */
const TWO_MONITORS = JSON.stringify([
  {
    id: 0,
    name: "DP-1",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scale: 1,
    transform: 0,
    focused: true,
  },
  {
    id: 1,
    name: "DP-2",
    x: 1920,
    y: 0,
    width: 1920,
    height: 1080,
    scale: 1,
    transform: 0,
    focused: false,
  },
]);

/** A caller on the SECOND monitor of `TWO_MONITORS`. */
const ON_SECOND = JSON.stringify({ address: "0x1", at: [2880, 0], size: [960, 1080], monitor: 1 });

const MINIMUM = WINDOW_MINIMUM_SIZE;

describe("decodeCallerArea", () => {
  it("measures the focused window relative to its monitor", () => {
    expect(decodeCallerArea(ZEN, LAPTOP_MONITORS)).toEqual({
      area: { x: 1, y: 37, width: 1598, height: 962 },
      monitor: { width: 1600, height: 1000 },
      monitorName: "eDP-1",
    });
  });

  it("covers the focused monitor when no window has focus", () => {
    // Hyprland answers `{}` for `j/activewindow` on an empty workspace.
    expect(decodeCallerArea("{}", LAPTOP_MONITORS)).toEqual({
      area: { x: 0, y: 0, width: 1600, height: 1000 },
      monitor: { width: 1600, height: 1000 },
      monitorName: "eDP-1",
    });
  });

  it("swaps a rotated monitor's sides", () => {
    const portrait = JSON.stringify([
      {
        id: 0,
        name: "DP-1",
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        scale: 1,
        transform: 1,
        focused: true,
      },
    ]);
    expect(decodeCallerArea("{}", portrait)?.monitor).toEqual({ width: 1080, height: 1920 });
  });

  it("finds the window's own monitor, not the focused one", () => {
    const caller = decodeCallerArea(ON_SECOND, TWO_MONITORS);
    expect(caller?.area).toEqual({ x: 960, y: 0, width: 960, height: 1080 });
    expect(caller?.monitorName).toBe("DP-2");
  });

  it("declines replies it cannot read", () => {
    expect(decodeCallerArea(ZEN, "not json")).toBeNull();
    expect(decodeCallerArea(ZEN, "[]")).toBeNull();
    expect(decodeCallerArea("{}", JSON.stringify([{ id: 0, focused: true }]))).toBeNull();
  });
});

describe("pickerArea", () => {
  it("takes 90% of the caller, centred on it", () => {
    // Observed on the laptop: Zen 1598x962 at (1, 37) -> picker 1438x865 at (81, 85).
    const caller = decodeCallerArea(ZEN, LAPTOP_MONITORS);
    expect(caller).not.toBeNull();
    if (caller === null) return;
    expect(pickerArea(caller, MINIMUM)).toEqual({ x: 81, y: 85, width: 1438, height: 866 });
  });

  const fullHd = { width: 1920, height: 1080 };

  it("never goes below the window's minimum", () => {
    const narrow = {
      area: { x: 100, y: 100, width: 300, height: 200 },
      monitor: fullHd,
      monitorName: "DP-1",
    };
    const area = pickerArea(narrow, MINIMUM);
    expect(area.width).toBe(MINIMUM.width);
    expect(area.height).toBe(MINIMUM.height);
  });

  it("stays on the monitor when a small caller sits at its edge", () => {
    const corner = {
      area: { x: 0, y: 0, width: 300, height: 200 },
      monitor: fullHd,
      monitorName: "DP-1",
    };
    const area = pickerArea(corner, MINIMUM);
    expect(area.x).toBe(0);
    expect(area.y).toBe(0);

    const farCorner = {
      area: { x: 1620, y: 880, width: 300, height: 200 },
      monitor: fullHd,
      monitorName: "DP-1",
    };
    const far = pickerArea(farCorner, MINIMUM);
    expect(far.x + far.width).toBe(1920);
    expect(far.y + far.height).toBe(1080);
  });

  it("is never larger than a monitor smaller than the minimum", () => {
    const small = { width: 500, height: 300 };
    const tiny = { area: { x: 0, y: 0, ...small }, monitor: small, monitorName: "DP-1" };
    expect(pickerArea(tiny, MINIMUM)).toEqual({ x: 0, y: 0, width: 500, height: 300 });
  });
});

describe("the rule", () => {
  const rule = pickerRuleRequests({ x: 81, y: 85, width: 1438, height: 866 }, "eDP-1");

  it("matches only the picker: this app's class AND the picker's title", () => {
    expect(rule).toContain(
      `keyword windowrule[symmetria-fm-picker]:match:class ^(${WINDOW_CLASS})$`,
    );
    expect(rule).toContain(
      `keyword windowrule[symmetria-fm-picker]:match:title ^(${PICKER_TITLE_PREFIX}.*)$`,
    );
  });

  it("is one named rule, so a second picker rewrites it rather than adding one", () => {
    const second = pickerRuleRequests({ x: 0, y: 0, width: 700, height: 500 }, "DP-2");
    const names = (requests: readonly string[]) =>
      new Set(requests.map((line) => line.split(":")[0]));
    expect(names(rule)).toEqual(names(second));
    expect(names(rule).size).toBe(1);
  });

  it("is switched off before any field is rewritten, and not switched on here", () => {
    expect(rule[0]).toBe("keyword windowrule[symmetria-fm-picker]:enable false");
    expect(rule).not.toContain("keyword windowrule[symmetria-fm-picker]:enable true");
  });

  it("floats, pins to the caller's monitor, sizes and moves the picker", () => {
    expect(rule).toContain("keyword windowrule[symmetria-fm-picker]:float on");
    expect(rule).toContain("keyword windowrule[symmetria-fm-picker]:monitor eDP-1");
    expect(rule).toContain("keyword windowrule[symmetria-fm-picker]:size 1438 866");
    expect(rule).toContain("keyword windowrule[symmetria-fm-picker]:move 81 85");
  });

  it("contains no `;`, which would split the batch", () => {
    expect(rule.every((line) => !line.includes(";"))).toBe(true);
  });

  it("names the class Chromium actually sets", () => {
    // Chromium takes the Wayland app id from `desktopName`. Drift here and the
    // rule silently stops matching the picker.
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(`${WINDOW_CLASS}.desktop`).toBe(manifest.desktopName);
  });
});

describe("placePicker", () => {
  interface FakeReplies {
    activeWindow: string | null;
    monitors: string | null;
    refuse: readonly string[];
  }

  /**
   * A Hyprland that keeps the named rule's state and applies a batch the way
   * the real one does: request by request, no rollback, and the answers joined
   * with the separator captured from its socket, `"ok\n\n\nok"`. `replies` is
   * mutable so one test can change what a LATER placement sees.
   */
  function fakeHyprland(initial: Partial<FakeReplies>) {
    const replies: FakeReplies = { activeWindow: null, monitors: null, refuse: [], ...initial };
    const rule = new Map<string, string>();
    const asked: string[] = [];
    const keyword = (line: string) => {
      const parsed = /^keyword windowrule\[symmetria-fm-picker\]:(\S+) (.*)$/.exec(line);
      if (parsed === null) return "unknown request";
      const [, field = "", value = ""] = parsed;
      if (replies.refuse.includes(field)) {
        return `config option <windowrule:${field}> does not exist.`;
      }
      rule.set(field, value);
      return "ok";
    };
    const request = async (line: string) => {
      asked.push(line);
      if (line === "j/activewindow") return replies.activeWindow;
      if (line === "j/monitors") return replies.monitors;
      if (line.startsWith("[[BATCH]]")) {
        return line.slice("[[BATCH]]".length).split(";").map(keyword).join("\n\n\n");
      }
      return keyword(line);
    };
    // Both halves reach the same Hyprland unless a test says otherwise.
    return { asked, replies, rule, request, channel: { request, cleanup: request } };
  }

  it("stages the rule, switches it on, and returns the picker's area", async () => {
    const hyprland = fakeHyprland({ activeWindow: ZEN, monitors: LAPTOP_MONITORS });
    expect(await placePicker(hyprland.channel, MINIMUM)).toEqual({
      x: 81,
      y: 85,
      width: 1438,
      height: 866,
    });
    expect(hyprland.rule.get("enable")).toBe("true");
    expect(hyprland.rule.get("size")).toBe("1438 866");
    expect(hyprland.rule.get("move")).toBe("81 85");
    expect(hyprland.rule.get("monitor")).toBe("eDP-1");
  });

  it("pins the rule to the CALLER's monitor, not the focused one", async () => {
    const hyprland = fakeHyprland({ activeWindow: ON_SECOND, monitors: TWO_MONITORS });
    await placePicker(hyprland.channel, MINIMUM);
    expect(hyprland.rule.get("monitor")).toBe("DP-2");
    expect(hyprland.rule.get("move")).toBe("1008 54");
  });

  it("leaves the rule OFF when Hyprland refuses one field of the batch", async () => {
    // The fields around the refused one are applied anyway. With the rule on,
    // they would float and place a picker that should open unplaced.
    const hyprland = fakeHyprland({
      activeWindow: ZEN,
      monitors: LAPTOP_MONITORS,
      refuse: ["dim_around"],
    });
    expect(await placePicker(hyprland.channel, MINIMUM)).toBeNull();
    expect(hyprland.rule.get("float")).toBe("on");
    expect(hyprland.rule.get("enable")).toBe("false");
  });

  it("switches off an earlier picker's rule when a later placement declines", async () => {
    const hyprland = fakeHyprland({ activeWindow: ZEN, monitors: LAPTOP_MONITORS });
    await placePicker(hyprland.channel, MINIMUM);
    expect(hyprland.rule.get("enable")).toBe("true");

    hyprland.replies.monitors = "not json";
    expect(await placePicker(hyprland.channel, MINIMUM)).toBeNull();
    // The earlier geometry is still there, and it no longer applies to anything.
    expect(hyprland.rule.get("move")).toBe("81 85");
    expect(hyprland.rule.get("enable")).toBe("false");
  });

  it("switches the rule off, and writes no field, when the monitors cannot be read", async () => {
    const hyprland = fakeHyprland({ activeWindow: ZEN, monitors: null });
    expect(await placePicker(hyprland.channel, MINIMUM)).toBeNull();
    expect(hyprland.asked.some((line) => line.startsWith("[[BATCH]]"))).toBe(false);
    expect([...hyprland.rule.entries()]).toEqual([["enable", "false"]]);
  });

  it("switches the rule off even when the placement budget is spent", async () => {
    const hyprland = fakeHyprland({ activeWindow: ZEN, monitors: LAPTOP_MONITORS });
    await placePicker(hyprland.channel, MINIMUM);
    expect(hyprland.rule.get("enable")).toBe("true");

    // A spent budget answers every request with null without sending it. The
    // switch-off must still reach Hyprland, or the earlier rule places this
    // picker.
    const spent = { request: async () => null, cleanup: hyprland.request };
    expect(await placePicker(spent, MINIMUM)).toBeNull();
    expect(hyprland.rule.get("enable")).toBe("false");
  });

  it("switches the rule off when Hyprland applied the switch-on but its reply was lost", async () => {
    const hyprland = fakeHyprland({ activeWindow: ZEN, monitors: LAPTOP_MONITORS });
    const replyLost = async (line: string) => {
      const reply = await hyprland.request(line);
      return line.endsWith(":enable true") ? null : reply;
    };
    expect(
      await placePicker({ request: replyLost, cleanup: hyprland.request }, MINIMUM),
    ).toBeNull();
    expect(hyprland.rule.get("enable")).toBe("false");
  });

  it("covers the monitor when the focused window cannot be read", async () => {
    const hyprland = fakeHyprland({ activeWindow: null, monitors: LAPTOP_MONITORS });
    expect(await placePicker(hyprland.channel, MINIMUM)).toEqual({
      x: 80,
      y: 50,
      width: 1440,
      height: 900,
    });
  });
});

describe("withDeadline", () => {
  it("gives each request what is left of ONE budget, then sends nothing", async () => {
    let clock = 1_000;
    const limits: number[] = [];
    const send = async (_request: string, timeoutMs: number) => {
      limits.push(timeoutMs);
      clock += 150;
      return "ok";
    };
    const request = withDeadline(send, 400, () => clock);

    expect(await request("a")).toBe("ok");
    expect(await request("b")).toBe("ok");
    expect(await request("c")).toBe("ok");
    expect(await request("d")).toBeNull();
    expect(limits).toEqual([400, 250, 100]);
  });
});

describe("hyprlandSocketPath", () => {
  it("is the instance's request socket under the runtime directory", () => {
    expect(
      hyprlandSocketPath({ HYPRLAND_INSTANCE_SIGNATURE: "abc", XDG_RUNTIME_DIR: "/run/user/1000" }),
    ).toBe("/run/user/1000/hypr/abc/.socket.sock");
  });

  it("is null without a Hyprland signature or a runtime directory", () => {
    expect(hyprlandSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBeNull();
    expect(
      hyprlandSocketPath({ HYPRLAND_INSTANCE_SIGNATURE: "", XDG_RUNTIME_DIR: "/run/user/1000" }),
    ).toBeNull();
    expect(hyprlandSocketPath({ HYPRLAND_INSTANCE_SIGNATURE: "abc" })).toBeNull();
  });
});

describe("against a real socket", () => {
  let dir: string;
  let server: Server | null = null;
  // `server.close` waits for every open connection, and the hanging peer
  // below never closes its own, so the cleanup ends them.
  const connections = new Set<Socket>();
  let connectionCount = 0;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fm-hyprland-"));
    connectionCount = 0;
  });

  afterEach(async () => {
    for (const connection of connections) connection.destroy();
    connections.clear();
    await new Promise<void>((resolve) =>
      server === null ? resolve() : server.close(() => resolve()),
    );
    server = null;
    await rm(dir, { recursive: true, force: true });
  });

  /** A socket that behaves as Hyprland does: read one request, answer, close. */
  async function listen(
    answer: (request: string) => string | null,
    path = join(dir, ".socket.sock"),
  ): Promise<string> {
    // Half-open allowed, as a real peer that has not answered yet: without
    // it Node ends the connection the moment the request's FIN arrives.
    server = createServer({ allowHalfOpen: true }, (connection) => {
      connectionCount += 1;
      connections.add(connection);
      connection.once("data", (chunk) => {
        const reply = answer(chunk.toString("utf8"));
        // null: accept and never answer, the hang the timeout exists for.
        if (reply !== null) connection.end(reply);
      });
    });
    const listening = server;
    await new Promise<void>((resolve) => listening.listen(path, resolve));
    return path;
  }

  /** A Hyprland socket where `pickerPlacer` looks for it, under `dir`. */
  async function hyprlandAt(answer: (request: string) => string | null) {
    const env = { HYPRLAND_INSTANCE_SIGNATURE: "sig", XDG_RUNTIME_DIR: dir };
    await mkdir(join(dir, "hypr", "sig"), { recursive: true });
    await listen(answer, join(dir, "hypr", "sig", ".socket.sock"));
    return env;
  }

  it("sends the request and returns the whole reply", async () => {
    const path = await listen((request) => `echo:${request}`);
    expect(await hyprlandSender(path)("j/monitors", 1_000)).toBe("echo:j/monitors");
  });

  it("resolves null when the peer closes without answering", async () => {
    const path = await listen(() => "");
    expect(await hyprlandSender(path)("j/monitors", 1_000)).toBeNull();
  });

  it("resolves null when nothing listens", async () => {
    expect(await hyprlandSender(join(dir, "absent.sock"))("j/monitors", 1_000)).toBeNull();
  });

  it("resolves null, in bounded time, when the compositor never answers", async () => {
    const path = await listen(() => null);
    const started = Date.now();
    expect(await hyprlandSender(path)("j/monitors", 100)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("pickerPlacer reaches a Hyprland it finds, so the guards below face a live one", async () => {
    const env = await hyprlandAt(() => "ok");
    await pickerPlacer(hyprlandSenderFor(env, "wayland"), MINIMUM)();
    expect(connectionCount).toBeGreaterThan(0);
  });

  it("pickerPlacer never connects for an X11 window, which is how every test launch runs", async () => {
    const env = await hyprlandAt(() => "ok");
    expect(await pickerPlacer(hyprlandSenderFor(env, "x11"), MINIMUM)()).toBeNull();
    expect(connectionCount).toBe(0);
  });

  it("pickerPlacer does nothing outside Hyprland", async () => {
    await hyprlandAt(() => "ok");
    expect(
      await pickerPlacer(hyprlandSenderFor({ XDG_RUNTIME_DIR: dir }, "wayland"), MINIMUM)(),
    ).toBeNull();
    expect(connectionCount).toBe(0);
  });

  it("pickerPlacer opens unplaced, promptly, when the socket is not there", async () => {
    const env = { HYPRLAND_INSTANCE_SIGNATURE: "absent", XDG_RUNTIME_DIR: dir };
    const started = Date.now();
    expect(await pickerPlacer(hyprlandSenderFor(env, "wayland"), MINIMUM)()).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("pickerPlacer gives up within ONE budget when Hyprland never answers", async () => {
    const env = await hyprlandAt(() => null);
    const started = Date.now();
    expect(await pickerPlacer(hyprlandSenderFor(env, "wayland"), MINIMUM)()).toBeNull();
    // 300 ms of budget plus 150 ms for the switch-off; the slack is for a busy box.
    expect(Date.now() - started).toBeLessThan(750);
  });
});
