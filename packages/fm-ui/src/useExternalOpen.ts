import type { ExternalOpen } from "@symmetria/fm-core/bridge";
import { basename } from "@symmetria/fm-core/pane";
import { useEffect, useRef, useState } from "react";

import { useFileManagerIo } from "./IoContext.tsx";

/** What the hook drives on the tab collection. */
export interface ExternalOpenTarget {
  /** Show a directory, reusing a tab already on it. */
  openAt(path: string): void;
  /** Land the active tab's cursor on an entry, by its full path. */
  reveal(path: string): void;
  /** The active tab's directory. */
  readonly activePath: string;
  readonly showHidden: boolean;
  readonly ready?: boolean;
  toggleHidden(): void;
}

/**
 * A directory another program asked this one to show, and optionally the entry
 * in it to put the cursor on.
 *
 * The origin is outside both processes — the command-line tool, a desktop
 * entry, "Show in folder" through `org.freedesktop.FileManager1` — so this is a
 * push the interface receives rather than an answer to anything it asked.
 *
 * **Subscribed exactly once, whatever identity the handlers have.** The actions
 * it calls are fresh arrows on every render, like every other action the tab
 * hook returns, so an effect depending on them directly would re-subscribe on
 * every cursor move — and the preload's `listen` removes and re-adds a native
 * IPC listener on each subscribe, which is real churn on the hot render path.
 * Review traced it. The ref is written in an effect rather than during render,
 * for the reason `useTabs` records on `optionsRef`: React does not promise a
 * render it began is a render it keeps.
 *
 * **The reveal waits for the open to land.** `openAt` reuses a tab already on
 * the directory or opens a new one, and `reveal` acts on the ACTIVE tab, so it
 * must run only once the active pane is on that directory — one render later.
 * The request is held in state, not a ref, so that holding it IS the render
 * that runs the effect, even when the tab was already active and nothing else
 * changes. A request whose directory is not the active one when it is looked
 * at is dropped: it must not fire later, when the user walks there by hand.
 *
 * **A hidden target turns hidden files on first.** The main process filters
 * dotfiles out of a listing while hidden files are off, so the reveal would
 * find nothing and report the entry as gone. Someone who asked to be shown
 * `.bashrc` asked to see it; the request stays pending for the one render it
 * takes the setting to change.
 *
 * Its own module rather than hooks inline in the component, and the reason is
 * measured rather than aesthetic: inline, they took the component past this
 * project's hook-density bound. One call site costs one.
 */
export function useExternalOpen(
  target: ExternalOpenTarget,
  initialRequest?: ExternalOpen | null,
): void {
  const { onOpenPath } = useFileManagerIo();
  const latest = useRef(target);
  const [pending, setPending] = useState<ExternalOpen | null>(null);

  useEffect(() => {
    latest.current = target;
  });

  useEffect(
    () =>
      onOpenPath((request) => {
        latest.current.openAt(request.path);
        setPending(request.reveal === null ? null : request);
      }),
    [onOpenPath],
  );

  useEffect(() => {
    if (!initialRequest) return;
    latest.current.openAt(initialRequest.path);
    setPending(initialRequest.reveal === null ? null : initialRequest);
  }, [initialRequest]);

  const { activePath, showHidden, ready = true } = target;
  useEffect(() => {
    // A reveal at mount must wait for preferences. Otherwise the initial read
    // can turn hidden files off after the reveal turns them on.
    if (!ready || pending === null || pending.reveal === null) return;
    if (activePath !== pending.path) {
      setPending(null);
      return;
    }
    if (basename(pending.reveal).startsWith(".") && !showHidden) {
      latest.current.toggleHidden();
      return;
    }
    setPending(null);
    latest.current.reveal(pending.reveal);
  }, [pending, activePath, showHidden, ready]);
}
