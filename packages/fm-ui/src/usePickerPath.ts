import { isFailure } from "@symmetria/fm-core/contract";
import { basename, parentOf } from "@symmetria/fm-core/pane";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeEntry, listDirectory } from "./bridge.ts";
import { cursorPathOf } from "./cursorPath.ts";
import { pickerPath } from "./pickerPath.ts";
import type { Tabs } from "./useTabs.ts";

interface PickerRevealNavigation {
  readonly tabId: string | undefined;
  readonly origin: string;
  readonly navigation: number;
}

export function usePickerPath(tabs: Tabs, home: string) {
  const { editing, setEditing, value, setValue, inputRef } = usePickerPathInput();
  const [{ error, busy }, setRequest] = useState<{ error: string | null; busy: boolean }>({
    error: null,
    busy: false,
  });
  const [pending, setPending] = useState<{
    path: string;
    tabId: string | undefined;
    origin: string;
    started: number | null;
  } | null>(null);
  const generation = useRef(0);
  const latest = useRef(tabs);
  const activeReveal = useRef<PickerRevealNavigation | null>(null);
  useEffect(() => {
    latest.current = tabs;
  });
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  const finish = useCallback(() => {
    generation.current++;
    activeReveal.current = null;
    setPending(null);
    setRequest({ error: null, busy: false });
    setEditing(false);
    inputRef.current?.blur();
  }, [inputRef, setEditing]);

  const cancel = useCallback(() => {
    abortPickerReveal(latest.current, activeReveal.current);
    finish();
  }, [finish]);

  const focus = useCallback(() => {
    cancel();
    setValue(latest.current.pane.path);
    setPending(null);
    setRequest({ error: null, busy: false });
    setEditing(true);
  }, [cancel, setValue, setEditing]);

  // Keep Enter in the field until reveal puts the cursor on the requested file.
  // Otherwise a second Enter can confirm the previous cursor while the scan runs.
  useEffect(() => {
    if (pending === null) return;
    if (activeTabId(tabs) !== pending.tabId) {
      finish();
      return;
    }
    if (pending.started === null) {
      startPickerReveal(pending.path, tabs, (started) => {
        activeReveal.current = {
          tabId: pending.tabId,
          origin: pending.origin,
          navigation: started,
        };
        setPending({ ...pending, started });
      });
      return;
    }
    if (tabs.navigationGeneration() !== pending.started) {
      finish();
      return;
    }
    // A previous navigation error is not the result of this reveal. Wait for
    // the directory loader to complete before inspecting its cursor or error.
    // The live pendingRevealPath() cleared before React committed the new
    // cursor and falsely reported failure on fast same-folder reads. This
    // snapshot is from the same render as pane, so both advance together.
    if (tabs.revealingPath !== null) return;
    if (cursorPathOf(tabs.pane) === pending.path) finish();
    else {
      activeReveal.current = null;
      setRequest({ error: tabs.error ?? "Cannot reveal this file.", busy: false });
      setPending(null);
    }
  }, [pending, tabs, finish]);

  const submit = useCallback(async () => {
    if (busy) return;
    const mine = ++generation.current;
    setRequest({ error: null, busy: true });
    try {
      const source = latest.current;
      const tabId = activeTabId(source);
      const navigation = source.navigationGeneration();
      const path = pickerPath(value, source.pane.path, home);
      const isDirectory = await validatePickerPath(path, source);
      if (mine !== generation.current) return;
      if (!sameNavigation(latest.current, tabId, navigation)) {
        finish();
        return;
      }
      latest.current.clearMarks();
      if (isDirectory) {
        latest.current.navigate(path);
        finish();
      } else {
        setPending({ path, tabId, origin: source.pane.path, started: null });
      }
    } catch (failure) {
      if (mine !== generation.current) return;
      setRequest({
        error: failure instanceof Error ? failure.message : "Cannot open this path.",
        busy: false,
      });
    }
  }, [busy, value, home, finish]);

  return useMemo(
    () => ({ editing, value, setValue, error, busy, inputRef, focus, cancel, submit }),
    [editing, value, setValue, error, busy, inputRef, focus, cancel, submit],
  );
}

/** Own the path field's value and focus independently of filesystem work. */
function usePickerPathInput() {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);
  return { editing, setEditing, value, setValue, inputRef };
}

function sameNavigation(tabs: Tabs, tabId: string | undefined, navigation: number): boolean {
  return activeTabId(tabs) === tabId && tabs.navigationGeneration() === navigation;
}

function abortPickerReveal(tabs: Tabs, reveal: PickerRevealNavigation | null): void {
  // Navigate back only while this reveal still owns the tab. The existing
  // navigation route invalidates its scan before restoring the source path.
  if (reveal && sameNavigation(tabs, reveal.tabId, reveal.navigation)) {
    tabs.navigate(reveal.origin);
  }
}

function activeTabId(tabs: Tabs): string | undefined {
  return tabs.views[tabs.activeIndex]?.id;
}

/** Apply hidden visibility before starting the file's cursor reveal. */
function startPickerReveal(path: string, tabs: Tabs, onStart: (navigation: number) => void): void {
  if (basename(path).startsWith(".") && !tabs.showHidden) {
    tabs.showHiddenTemporarily();
    return;
  }
  tabs.reveal(path);
  onStart(tabs.navigationGeneration());
}

/** Check existence and the parent listing before changing the picker cursor. */
async function validatePickerPath(path: string, tabs: Tabs): Promise<boolean> {
  const reply = await describeEntry(path);
  if (isFailure(reply)) throw new Error(reply.error.message);
  const directory = reply.value.isDirectory ? path : parentOf(path);
  const listing = await listDirectory(directory, {
    sort: tabs.sort,
    reverse: tabs.reverse,
    showHidden: true,
  });
  if (isFailure(listing)) throw new Error(listing.error.message);
  if (
    !reply.value.isDirectory &&
    !listing.value.entries.some((entry) => entry.name === basename(path))
  ) {
    throw new Error("The file is no longer in this folder.");
  }
  return reply.value.isDirectory;
}
