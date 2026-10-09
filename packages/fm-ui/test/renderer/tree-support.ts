import type { CreateRequest, Result } from "@symmetria/fm-core/contract";
import type { OverviewEntry, OverviewRequest } from "@symmetria/fm-core/overview/contract";
import { parentOf } from "@symmetria/fm-core/pane";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement } from "react";
import { expect, vi } from "vitest";
import { App, type AppProps } from "../../src/App.tsx";
import { installBridge } from "./support.ts";

export function treeEntry(name: string, kind: OverviewEntry["kind"] = "file"): OverviewEntry {
  return { name, kind, isHidden: name.startsWith("."), isSymlink: false };
}

export function installTreeBridge(extra: readonly OverviewEntry[] = []) {
  const log = installBridge();
  const entries = new Map<string, readonly OverviewEntry[]>([
    [
      "/home/jc",
      [
        treeEntry("src", "directory"),
        treeEntry("empty", "directory"),
        treeEntry("locked", "directory"),
        treeEntry("node_modules", "directory"),
        treeEntry("partial", "directory"),
        treeEntry("notes.txt"),
        ...extra,
      ],
    ],
    ["/home/jc/src", [treeEntry("nested", "directory"), treeEntry("beta.ts")]],
    ["/home/jc/src/nested", [treeEntry("İinteresting long filename.md")]],
    ["/home/jc/empty", []],
    ["/home/jc/partial", [treeEntry("known.txt")]],
  ]);
  const overview = vi.fn(async ({ path }: OverviewRequest) => {
    const found = entries.get(path);
    return found
      ? {
          ok: true,
          value: { entries: found, inspected: found.length, truncated: path.endsWith("/partial") },
        }
      : { ok: false, error: { code: "scan_failed", message: "permission denied" } };
  });
  const originalList = window.symmetriaFm?.list;
  const list = vi.fn(async (request: { path: string }) => {
    const found = entries.get(request.path);
    if (!found && originalList) return originalList(request);
    return {
      ok: true,
      value: {
        entries: (found ?? []).map((entry) => ({ ...entry, size: 0, modifiedMs: 0 })),
        total: found?.length ?? 0,
        streamId: null,
      },
    };
  });
  const open = vi.fn(async () => ({ ok: true, value: null }));
  const trash = vi.fn(async () => ({ ok: true, value: null }));
  const clipboard = vi.fn(async () => ({ ok: true, value: null }));
  Object.assign(window.symmetriaFm ?? {}, { overview, list, open, trash, clipboard });
  return { ...log, overview, list, open, trash, clipboard, entries };
}

export function treeKey(key: string, ctrlKey = false) {
  fireEvent.keyDown(window, { key, ctrlKey });
}

export function treeRow(path: string): HTMLElement {
  const row = within(screen.getByRole("tree"))
    .getAllByRole("treeitem")
    .find((item) => item.dataset.path === path);
  if (!row) throw new Error(`Tree row missing: ${path}`);
  return row;
}

export async function openTree(extra: ReturnType<typeof treeEntry>[] = []) {
  const log = installTreeBridge(extra);
  render(createElement<AppProps>(App, { startPath: "/home/jc" }));
  treeKey("e", true);
  await screen.findByRole("tree");
  await waitFor(() => treeRow("/home/jc/src"));
  return log;
}

export async function openCreateTree(root = "/home/jc", extra: readonly OverviewEntry[] = []) {
  const log = installTreeBridge(extra);
  if (root === "/") log.entries.set("/", [treeEntry("home", "directory")]);
  const create = vi.fn(async ({ path, kind }: CreateRequest): Promise<Result<null>> => {
    const parent = parentOf(path);
    const entries = log.entries.get(parent);
    const name = path.slice(parent === "/" ? 1 : parent.length + 1);
    if (!entries) {
      return { ok: false, error: { code: "write_failed", message: "permission denied" } };
    }
    if (entries.some((entry) => entry.name === name)) {
      return {
        ok: false,
        error: {
          code: "write_failed",
          message: `EEXIST: file already exists, ${kind === "directory" ? "mkdir" : "open"} '${path}'`,
        },
      };
    }
    log.entries.set(parent, [...entries, treeEntry(name, kind)]);
    if (kind === "directory") log.entries.set(path, []);
    return { ok: true, value: null };
  });
  Object.assign(window.symmetriaFm ?? {}, { create });
  render(createElement<AppProps>(App, { startPath: root }));
  await waitFor(() => expect(screen.getAllByTestId("row").length).toBeGreaterThan(0));
  treeKey("e", true);
  await screen.findByRole("tree");
  await waitFor(() => treeRow(root));
  return { ...log, create };
}
