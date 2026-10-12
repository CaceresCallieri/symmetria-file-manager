import {
  decodeDescribeRequest,
  decodeListRequest,
  decodeReadTextRequest,
  failure,
  type Result,
  success,
} from "@symmetria/fm-core/contract";
import type { FsEntry } from "@symmetria/fm-core/entry";
import { filterEntries } from "@symmetria/fm-core/filter";
import { decodeOverviewRequest } from "@symmetria/fm-core/overview/contract";
import { parentOf } from "@symmetria/fm-core/pane";
import { sortEntries } from "@symmetria/fm-core/sort";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import { createViewerBridge } from "./viewerBridge.ts";

export const LOCAL_HOME = "/home/local";
export const LOCAL_STORAGE = { total: 512 * 1024 ** 3, free: 238 * 1024 ** 3 };

interface SampleNode {
  readonly kind: "file" | "directory";
  readonly text: string;
}

// HACK: Local uses an in-memory filesystem to compare the machine-switcher UI.
// This browser host cannot read the laptop's disk. Remove this sample when the
// accepted design is connected to the laptop's existing Electron bridge.
const nodes = new Map<string, SampleNode>();
for (const directory of [
  "/",
  "/home",
  LOCAL_HOME,
  "Downloads",
  "Documents",
  "Pictures",
  "Projects",
  "Projects/symmetria",
  "Projects/mesura-code",
]) {
  const path = directory.startsWith("/") ? directory : `${LOCAL_HOME}/${directory}`;
  nodes.set(path, { kind: "directory", text: "" });
}
const sampleFiles: readonly (readonly [string, string])[] = [
  [
    "notes.txt",
    "LOCAL SAMPLE\n\nThese sample files show the laptop side of the machine switcher.\nVigilia Home shows real server files.\n\nm opens the machine chooser. mm switches machines.\n",
  ],
  ["Downloads/receipt.txt", "Local sample receipt\nTotal: 42.00\n"],
  [
    "Documents/todo.txt",
    "Local sample tasks\n- Review the lower-left dock\n- Compare the header switch\n- Try the storage menu\n",
  ],
  [
    "Projects/symmetria/design.txt",
    "Keep machine selection next to storage.\nKeep view selection in the header.\n",
  ],
  [
    "Projects/mesura-code/readme.txt",
    "Editing belongs in Mesura Code.\nThis file manager only views files.\n",
  ],
];
for (const [path, text] of sampleFiles) nodes.set(`${LOCAL_HOME}/${path}`, { kind: "file", text });

function entriesIn(path: string): FsEntry[] {
  return [...nodes]
    .filter(([full]) => full !== path && parentOf(full) === path)
    .map(([full, node]) => ({
      name: full.slice(full.lastIndexOf("/") + 1),
      kind: node.kind,
      size: new TextEncoder().encode(node.text).length,
      modifiedMs: Date.UTC(2026, 9, 12),
      isSymlink: false,
      isHidden: false,
    }));
}

function list(raw: unknown): Result<unknown> {
  const request = decodeListRequest(raw);
  if (!request.ok) return request;
  const { path, sort, reverse, showHidden } = request.value;
  if (!nodes.has(path)) return failure("scan_failed", "This folder is outside the Local sample");
  const entries = sortEntries(filterEntries(entriesIn(path), { showHidden }), sort, reverse);
  return success({ entries, total: entries.length, streamId: null });
}

function overview(raw: unknown): Result<unknown> {
  const request = decodeOverviewRequest(raw);
  if (!request.ok) return request;
  const entries = entriesIn(request.value.path);
  return success({ entries, inspected: entries.length, truncated: false });
}

function describe(raw: unknown): Result<unknown> {
  const request = decodeDescribeRequest(raw);
  if (!request.ok) return request;
  const path = request.value.path;
  const node = nodes.get(path);
  if (node === undefined) return failure("read_failed", "This file is outside the Local sample");
  const entries = entriesIn(path);
  const head = new TextEncoder().encode(node.text);
  return success({
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    isDirectory: node.kind === "directory",
    entryCount: entries.length,
    entries,
    size: head.length,
    mime: node.kind === "directory" ? "inode/directory" : "text/plain",
    head,
  });
}

function readText(raw: unknown): Result<unknown> {
  const request = decodeReadTextRequest(raw);
  if (!request.ok) return request;
  const node = nodes.get(request.value.path);
  if (node === undefined) return failure("read_failed", "This file is outside the Local sample");
  const bytes = new TextEncoder().encode(node.text);
  const slice = bytes.subarray(0, request.value.maxBytes);
  return success({
    text: new TextDecoder().decode(slice),
    bytesRead: slice.length,
    truncated: slice.length < bytes.length,
  });
}

export function createLocalSampleBridge() {
  const handlers: ReadonlyMap<string, (raw: unknown) => Result<unknown>> = new Map([
    [REQUEST_CHANNELS.list, list],
    [REQUEST_CHANNELS.overview, overview],
    [REQUEST_CHANNELS.describe, describe],
    [REQUEST_CHANNELS.readText, readText],
    [REQUEST_CHANNELS.watch, () => success(null)],
    [REQUEST_CHANNELS.unwatch, () => success(null)],
    [REQUEST_CHANNELS.cancel, () => success(null)],
    [REQUEST_CHANNELS.diskUsage, () => success(LOCAL_STORAGE)],
    [
      REQUEST_CHANNELS.places,
      () =>
        success({
          places: [
            { kind: "download", path: `${LOCAL_HOME}/Downloads` },
            { kind: "documents", path: `${LOCAL_HOME}/Documents` },
            { kind: "pictures", path: `${LOCAL_HOME}/Pictures` },
          ],
        }),
    ],
  ]);
  return createViewerBridge({
    call: (channel, payload) =>
      Promise.resolve(
        handlers.get(channel)?.(payload) ??
          failure("read_failed", "Unavailable in the Local sample"),
      ),
    listen: () => () => () => {},
  });
}
