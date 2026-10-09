import type {
  RenameReply,
  RenameRequest,
  Result,
  TransferReply,
  TransferRequest,
  TrashRequest,
} from "@symmetria/fm-core/contract";
import { decodeTransferReply } from "@symmetria/fm-core/contract";
import { basename, joinPath, parentOf } from "@symmetria/fm-core/pane";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { openCreateTree, type treeEntry, treeKey, treeRow } from "./tree-support.ts";

/** Reuse the tree-create filesystem and App entry point; mutate listings as the bridge does. */
export async function openOperationsTree(extra: ReturnType<typeof treeEntry>[] = []) {
  const log = await openCreateTree("/home/jc", extra);
  const entries = log.entries;
  const remove = (path: string) => {
    const parent = parentOf(path);
    entries.set(
      parent,
      (entries.get(parent) ?? []).filter((entry) => entry.name !== basename(path)),
    );
    for (const key of entries.keys()) {
      if (key === path || key.startsWith(`${path}/`)) entries.delete(key);
    }
  };
  const copy = (source: string, destination: string) => {
    const entry = entries.get(parentOf(source))?.find((item) => item.name === basename(source));
    if (!entry) throw new Error(`Missing operation fixture source: ${source}`);
    const target = joinPath(destination, entry.name);
    const listing = (entries.get(destination) ?? []).filter((item) => item.name !== entry.name);
    entries.set(destination, [...listing, entry]);
    for (const [path, listing] of [...entries]) {
      if (path === source || path.startsWith(`${source}/`)) {
        entries.set(`${target}${path.slice(source.length)}`, [...listing]);
      }
    }
  };
  const trash = vi.fn(async ({ paths }: TrashRequest): Promise<Result<null>> => {
    for (const path of paths) remove(path);
    return { ok: true, value: null };
  });
  const rename = vi.fn(async ({ path, name }: RenameRequest): Promise<Result<RenameReply>> => {
    const parent = parentOf(path);
    const listing = entries.get(parent) ?? [];
    if (listing.some((entry) => entry.name === name)) {
      return { ok: false, error: { code: "write_failed", message: `${name} already exists` } };
    }
    const entry = listing.find((item) => item.name === basename(path));
    if (!entry) return { ok: false, error: { code: "write_failed", message: "missing source" } };
    const renamed = joinPath(parent, name);
    const nested = [...entries].filter(([key]) => key === path || key.startsWith(`${path}/`));
    remove(path);
    entries.set(parent, [...(entries.get(parent) ?? []), { ...entry, name }]);
    for (const [key, listing] of nested)
      entries.set(`${renamed}${key.slice(path.length)}`, listing);
    return { ok: true, value: { path: renamed } };
  });
  const originalTransfer = window.symmetriaFm?.transfer;
  if (!originalTransfer) throw new Error("Missing shared fixture transfer");
  const transfer = vi.fn(async (request: TransferRequest): Promise<Result<TransferReply>> => {
    const raw = await originalTransfer(request);
    const reply = raw.ok ? decodeTransferReply(raw.value) : raw;
    if (reply.ok && reply.value.conflicts.length === 0) {
      for (const source of request.sources) {
        copy(source, request.destination);
        if (request.mode === "move") remove(source);
      }
    }
    return reply;
  });
  Object.assign(window.symmetriaFm ?? {}, { trash, rename, transfer });
  await selectTreePath("/home/jc/src/beta.ts");
  return { ...log, trash, rename, transfer };
}

export async function selectTreePath(path: string) {
  await waitFor(() => treeRow(path));
  fireEvent.click(treeRow(path));
}

export async function confirmTreeDialog(kind: "delete" | "conflict") {
  const dialog = await screen.findByTestId(`modal-${kind}`);
  fireEvent.click(within(dialog).getByTestId("dialog-confirm"));
}

export async function renameTreeInput(fullName = false) {
  fireEvent.keyDown(window, { key: fullName ? "R" : "r", shiftKey: fullName });
  return screen.findByTestId("dialog-name") as Promise<HTMLInputElement>;
}

export function submitTreeName(input: HTMLElement, name: string) {
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: "Enter" });
}

export function activateTreeTab(index: number) {
  const tab = screen.getAllByTestId("tab")[index];
  if (!tab) throw new Error(`Missing fixture tab ${index}`);
  fireEvent.click(within(tab).getByRole("button", { name: "jc" }));
}

export async function addSecondTreeTab() {
  treeKey("t");
  treeKey("e", true);
  await waitFor(() => treeRow("/home/jc/src/beta.ts"));
  activateTreeTab(0);
  await waitFor(() => treeRow("/home/jc/src/beta.ts"));
}
