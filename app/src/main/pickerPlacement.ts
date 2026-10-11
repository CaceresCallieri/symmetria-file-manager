import { isRecord } from "@symmetria/fm-core/contract";

import {
  type HyprlandRequest,
  hyprlandSender,
  hyprlandSocketPath,
  withDeadline,
} from "./hyprland.ts";
import { PICKER_TITLE_PREFIX } from "./picker.ts";

/**
 * Open the picker over the window that asked for it.
 *
 * A file dialog belongs to the application that requested it, so on Hyprland
 * the picker floats over that application at 90% of its size, centred on it.
 * Three facts shape how, and each was measured on Hyprland 0.56.2:
 *
 * - **The caller is the focused window at request time.** The portal does send
 *   a parent handle, but it is an `xdg-foreign` handle and Electron cannot
 *   import one (see `decodePickerOptions` in `@symmetria/fm-core/command`). A
 *   person who just clicked "Attach" in an application is focused on it.
 * - **A Wayland client cannot position its own window**, so the position is a
 *   window rule the compositor applies when the picker MAPS. The rule is set
 *   before the window is shown, which is when Chromium creates the toplevel.
 * - **The rule is NAMED and updated in place.** An anonymous rule added per
 *   request stays in Hyprland until the next config reload, so they pile up;
 *   `windowrule[<name>]:<field>` rewrites the one rule instead.
 * - **The rule is switched off while it is rewritten, and on only when every
 *   field took.** Hyprland applies a batch request by request, with no
 *   rollback, so a refused field would otherwise leave a rule that is half
 *   this picker's and half the last one's. A placement that gives up switches
 *   the rule off too: a rule left on from an earlier picker would place this
 *   one over the wrong window.
 *
 * Everything here is best effort. When the compositor is not Hyprland, cannot
 * be reached, or answers late, the picker opens exactly as it did before this
 * existed: the dialog must never wait on its own decoration.
 */

/** A size in logical pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in logical pixels, relative to its monitor's origin. */
export interface Area extends Size {
  readonly x: number;
  readonly y: number;
}

/** The area the picker covers, and the monitor that area sits on. */
export interface CallerArea {
  readonly area: Area;
  readonly monitor: Size;
  /**
   * The monitor's connector name, written into the rule. The coordinates are
   * relative to THIS monitor, and Hyprland maps a window on whichever monitor
   * has focus at map time; focus that moves between the query and the map
   * would otherwise put these coordinates on the wrong screen.
   */
  readonly monitorName: string;
}

/** How much of the caller the picker covers, on each axis. */
const PICKER_COVERAGE = 0.9;

/**
 * The Wayland app id of every window this daemon opens.
 *
 * Chromium sets it from `desktopName` in `app/package.json`, once per process,
 * which is why the rule also matches on the title: the browse window carries
 * the same class and must never be floated. `pickerPlacement.test.ts` asserts
 * this equals the desktop name.
 */
export const PICKER_WINDOW_CLASS = "symmetria-fm-electron";

/**
 * The Hyprland rule this daemon owns. One name, rewritten for every picker.
 *
 * Only one picker is open at a time (`createPickerHost`), so one rule is
 * enough, and a rule left behind after a picker closes matches nothing else.
 */
const PICKER_RULE = "windowrule[symmetria-fm-picker]";

/**
 * How long placement may take, in total, before the picker opens unplaced.
 *
 * A healthy compositor answers each request in about a millisecond, and
 * placement makes three rounds: the query, the staged rule, the switch-on.
 */
const PLACEMENT_BUDGET_MS = 300;

/**
 * How long switching the rule off may take when placement gives up.
 *
 * OUTSIDE the placement budget on purpose. The budget running out is one of
 * the reasons placement gives up, and a switch-off that shared it would then
 * never be sent — leaving an earlier picker's rule on to place this one, or a
 * switch-on Hyprland applied but whose reply was lost. Review found both. The
 * worst case for a dialog is therefore this plus the budget, 450 ms.
 */
const CLEANUP_TIMEOUT_MS = 150;

const DISABLE_RULE = `keyword ${PICKER_RULE}:enable false`;
const ENABLE_RULE = `keyword ${PICKER_RULE}:enable true`;

/** Parse a reply and decode it, or fall back when it is not JSON at all. */
function decodeJson<T>(text: string, decode: (raw: unknown) => T, unreadable: T): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreadable;
  }
  return decode(parsed);
}

function isFiniteNumber(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw);
}

function decodePair(raw: unknown): readonly [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [first, second] = raw;
  return isFiniteNumber(first) && isFiniteNumber(second) ? [first, second] : null;
}

/** One monitor as `j/monitors` reports it, reduced to what placement needs. */
interface Monitor {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly focused: boolean;
  /** Logical size: what windows are measured in. */
  readonly logical: Size;
}

/**
 * A monitor's size in logical pixels: what windows and rules are measured in.
 *
 * `width` and `height` are the mode, in physical pixels and before rotation.
 * An odd transform turns the monitor a quarter, which swaps the two.
 */
function logicalSize(raw: Record<string, unknown>): Size | null {
  const { width, height, scale, transform } = raw;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (!isFiniteNumber(scale) || scale <= 0) return null;
  const [across, down] =
    isFiniteNumber(transform) && transform % 2 === 1 ? [height, width] : [width, height];
  return { width: Math.floor(across / scale), height: Math.floor(down / scale) };
}

function decodeMonitor(raw: unknown): Monitor | null {
  if (!isRecord(raw)) return null;
  const { id, name, x, y } = raw;
  const logical = logicalSize(raw);
  if (!isFiniteNumber(id) || typeof name !== "string" || name === "") return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || logical === null) return null;
  return { id, name, x, y, focused: raw.focused === true, logical };
}

function decodeMonitors(reply: string): readonly Monitor[] {
  return decodeJson(
    reply,
    (raw) =>
      Array.isArray(raw) ? raw.map(decodeMonitor).filter((monitor) => monitor !== null) : [],
    [],
  );
}

/** The focused window, in global logical pixels. */
interface FocusedWindow {
  readonly at: readonly [number, number];
  readonly size: readonly [number, number];
  /** The id of the monitor it is on. */
  readonly monitor: number;
}

function decodeFocusedWindow(raw: unknown): FocusedWindow | null {
  // Hyprland answers `{}` when no window has focus.
  if (!isRecord(raw) || typeof raw.address !== "string" || raw.address === "") return null;
  const at = decodePair(raw.at);
  const size = decodePair(raw.size);
  if (at === null || size === null || !isFiniteNumber(raw.monitor)) return null;
  return { at, size, monitor: raw.monitor };
}

/**
 * What the picker should cover: the focused window, or the focused monitor
 * when no window has focus. Null when Hyprland's replies do not say.
 *
 * The result is relative to the monitor because a rule's `move` is: measured,
 * `move 100 100` on a monitor at x=1920 put the window at x=2020. `at` from
 * `j/activewindow` is global, so the monitor's origin is subtracted.
 */
export function decodeCallerArea(
  activeWindowReply: string,
  monitorsReply: string,
): CallerArea | null {
  const monitors = decodeMonitors(monitorsReply);
  const window = decodeJson(activeWindowReply, decodeFocusedWindow, null);

  const host =
    window === null ? undefined : monitors.find((monitor) => monitor.id === window.monitor);
  if (window !== null && host !== undefined) {
    return {
      area: {
        x: window.at[0] - host.x,
        y: window.at[1] - host.y,
        width: window.size[0],
        height: window.size[1],
      },
      monitor: host.logical,
      monitorName: host.name,
    };
  }

  const focused = monitors.find((monitor) => monitor.focused);
  if (focused === undefined) return null;
  return {
    area: { x: 0, y: 0, ...focused.logical },
    monitor: focused.logical,
    monitorName: focused.name,
  };
}

/** One axis: the length the picker takes, and where it starts. */
function placeOnAxis(start: number, length: number, minimum: number, bound: number) {
  const size = Math.min(Math.max(Math.round(length * PICKER_COVERAGE), minimum), bound);
  const centred = Math.round(start + (length - size) / 2);
  // Kept on the monitor. A caller narrower than the picker's minimum would
  // otherwise push a centred picker past the monitor's edge.
  const origin = Math.min(Math.max(centred, 0), bound - size);
  return { size, origin };
}

/**
 * The picker's rectangle: 90% of the caller, centred on it, never smaller than
 * the window's own minimum, never larger than the monitor or off its edges.
 */
export function pickerArea(caller: CallerArea, minimum: Size): Area {
  const horizontal = placeOnAxis(
    caller.area.x,
    caller.area.width,
    minimum.width,
    caller.monitor.width,
  );
  const vertical = placeOnAxis(
    caller.area.y,
    caller.area.height,
    minimum.height,
    caller.monitor.height,
  );
  return {
    x: horizontal.origin,
    y: vertical.origin,
    width: horizontal.size,
    height: vertical.size,
  };
}

/**
 * The staged rule: switched off first, then every field, so the rule is whole
 * however it was left — a config reload deletes it, and a refused field in an
 * earlier batch could have left it partial. `ENABLE_RULE` switches it on once
 * all of these were accepted.
 *
 * The title match is the contract `PICKER_TITLE_PREFIX` documents. `dim_around`
 * darkens what the picker covers, so the dialog reads as modal to the caller.
 */
export function pickerRuleRequests(area: Area, monitorName: string): readonly string[] {
  return [
    DISABLE_RULE,
    `keyword ${PICKER_RULE}:match:class ^(${PICKER_WINDOW_CLASS})$`,
    `keyword ${PICKER_RULE}:match:title ^(${PICKER_TITLE_PREFIX}.*)$`,
    `keyword ${PICKER_RULE}:float on`,
    `keyword ${PICKER_RULE}:dim_around on`,
    `keyword ${PICKER_RULE}:monitor ${monitorName}`,
    `keyword ${PICKER_RULE}:size ${area.width} ${area.height}`,
    `keyword ${PICKER_RULE}:move ${area.x} ${area.y}`,
  ];
}

/**
 * Did Hyprland accept every request in the batch?
 *
 * A batch answers each request in turn: `ok` for a keyword it applied, an
 * error sentence for one it refused.
 */
function acceptedAll(reply: string, count: number): boolean {
  const answers = reply.split("\n").filter((line) => line.trim() !== "");
  return answers.length === count && answers.every((line) => line.trim() === "ok");
}

/** The two ways placement talks to Hyprland. */
export interface PlacementChannel {
  /** The queries and the rule, all inside one placement budget. */
  readonly request: HyprlandRequest;
  /** Switching the rule off when placement gives up, with its own limit. */
  readonly cleanup: HyprlandRequest;
}

/**
 * Ask Hyprland where the caller is and set the rule that places the next
 * picker over it. Resolves to the picker's area, or null when the picker must
 * open unplaced — and then the rule is off, so no earlier picker's geometry
 * applies to this one.
 */
export async function placePicker(
  { request, cleanup }: PlacementChannel,
  minimum: Size,
): Promise<Area | null> {
  const decline = async () => {
    // Best effort, like everything here: when Hyprland is unreachable this
    // fails too, and then there is nobody for a stale rule to apply in.
    await cleanup(DISABLE_RULE);
    return null;
  };

  const [activeWindow, monitors] = await Promise.all([
    request("j/activewindow"),
    request("j/monitors"),
  ]);
  const caller = monitors === null ? null : decodeCallerArea(activeWindow ?? "{}", monitors);
  if (caller === null) return decline();

  const area = pickerArea(caller, minimum);
  const rule = pickerRuleRequests(area, caller.monitorName);
  const staged = await request(`[[BATCH]]${rule.join(";")}`);
  if (staged === null || !acceptedAll(staged, rule.length)) return decline();

  const enabled = await request(ENABLE_RULE);
  if (enabled === null || !acceptedAll(enabled, 1)) return decline();
  return area;
}

/** Place the next picker, or decline. Never rejects. */
export type PickerPlacer = () => Promise<Area | null>;

const unplaced: PickerPlacer = async () => null;

/**
 * The placer for this process.
 *
 * Disabled when the session is not Hyprland, and when Chromium runs on X11.
 * The second is not hypothetical: every launch the tests, the benches and the
 * release check make is `--ozone-platform=x11` under `xvfb-run`, and those
 * processes inherit the developer's `HYPRLAND_INSTANCE_SIGNATURE`. An X window
 * on a virtual display is not Hyprland's to place, and a test must not rewrite
 * a rule in the session somebody is using.
 */
export function pickerPlacer(
  env: Record<string, string | undefined>,
  ozonePlatform: string,
  minimum: Size,
): PickerPlacer {
  const socketPath = hyprlandSocketPath(env);
  if (socketPath === null || ozonePlatform === "x11") return unplaced;
  const send = hyprlandSender(socketPath);
  const cleanup: HyprlandRequest = (request) => send(request, CLEANUP_TIMEOUT_MS);
  // A fresh budget for every picker, started when that picker is requested.
  return () => placePicker({ request: withDeadline(send, PLACEMENT_BUDGET_MS), cleanup }, minimum);
}
