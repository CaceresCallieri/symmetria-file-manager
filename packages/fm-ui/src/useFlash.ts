import type { FsEntry } from "@symmetria/fm-core/entry";
import {
  computeFlash,
  type FlashCandidate,
  type FlashLabelling,
} from "@symmetria/fm-core/flash/labels";
import { type FlashState, flashKey, newFlashState } from "@symmetria/fm-core/flash/session";
import { useCallback, useMemo, useRef, useState } from "react";

import type { FlashRowLabel } from "./components/FlashName.tsx";

/**
 * The host's half of flash jump.
 *
 * `fm-core/flash` decides which names match, which key jumps to each, and what
 * every key means. This owns the things that only exist in a window: which
 * rows are candidates, where the cursor was when the session started, and what
 * a jump actually does to the pane.
 *
 * ── Why this one is NOT focus-driven, unlike search ─────────────────────────
 * `useSearch` needs no key handling because its field is a real `<input>` and
 * the DOM decides. Flash has no field — it reads the raw key stream — so the
 * cascade has to be told a session is running, and `useKeyDispatch` routes
 * every key here while it is. That is what makes `j` a character instead of a
 * cursor move.
 */

export interface Flash {
  /** True while a session is running. Feeds the cascade's `flashActive`. */
  readonly active: boolean;
  /**
   * What the status bar draws, or null when no session is running.
   *
   * A ready-made shape rather than a query plus a flag, mirroring
   * `picker.chrome` next door: the alternative puts a ternary in `App`, which
   * is already at the complexity gate's shoulder.
   */
  readonly chrome: { readonly query: string } | null;
  /** Labels for the current column, by row index. */
  readonly labels: ReadonlyMap<number, FlashRowLabel>;
  /** Begin a session, remembering where the cursor is. */
  start(): void;
  /** Hand one key to the session. */
  onKey(event: KeyboardEvent): void;
}

export interface FlashHost {
  readonly entries: readonly FsEntry[];
  readonly cursorIndex: number;
  /** Where the pane is. Changing it ends any session. */
  readonly path: string;
  moveTo(index: number): void;
}

/**
 * Where the cursor was when a session started, by NAME and by index.
 *
 * By name first, because the listing can change under a running session — a
 * download lands, a watcher refreshes — and an index that was right when `s`
 * was pressed then addresses a different file. The index survives only as the
 * fallback for when the remembered entry is gone.
 */
interface CursorMemory {
  readonly index: number;
  readonly name: string;
}

/** Where cancelling should put the cursor, in the listing as it stands now. */
function restoreIndex(memory: CursorMemory, candidates: readonly FlashCandidate[]): number {
  const byName = candidates.findIndex((candidate) => candidate.name === memory.name);
  if (byName >= 0) return byName;
  return Math.min(memory.index, Math.max(candidates.length - 1, 0));
}

/** Labels for the current column, keyed by the row they belong to. */
function labelsFor(session: FlashState | null): ReadonlyMap<number, FlashRowLabel> {
  const labels = new Map<number, FlashRowLabel>();
  if (session === null) return labels;

  for (const match of session.labelling.matches) {
    // An unlabelled match has nothing to press, so it is not drawn as a match
    // and dims with the rest. That is the Qt behaviour and it is the honest
    // one: a highlight offering no key is a highlight that lies.
    if (match.column === "current" && match.label !== "") {
      labels.set(match.index, {
        query: session.query,
        label: match.label,
        matchStart: match.matchStart,
      });
    }
  }
  return labels;
}

/** A mutable holder for the session `onKey` reads. Named, so it can be passed. */
interface LiveSession {
  current: FlashState | null;
}

interface UpkeepInputs {
  readonly path: string;
  readonly candidates: readonly FlashCandidate[];
  readonly live: LiveSession;
  readonly setSession: (session: FlashState | null) => void;
  readonly relabel: (query: string) => FlashLabelling;
}

/**
 * Keep a running session true to the ground it was computed against.
 *
 * Both adjustments happen DURING render rather than in an effect. An effect
 * would have to list an input its body never reads — which the lint rule
 * reports, correctly — and it would let one frame paint with labels addressing
 * rows that have gone.
 *
 * **Leaving the directory ends the session.** Its labels address a listing that
 * is being replaced wholesale.
 *
 * **A listing that changes without the pane moving relabels instead** — a
 * watcher refresh, a re-sort, a download landing. This is not tidiness: a label
 * carries the index it was computed for, and the jump moves the cursor to that
 * index, so a session that outlived one inserted row would draw its labels over
 * the wrong names and then jump to the wrong file, silently and plausibly.
 * Review found this. The Qt build has the same gap between two keystrokes and
 * it is worse here, because nothing else rebuilds the candidate list.
 *
 * A held prefix does NOT survive a relabelling: a fresh pass can hand its first
 * character to a different match, so what the user half-typed no longer means
 * what they read.
 */
function useSessionUpkeep({ path, candidates, live, setSession, relabel }: UpkeepInputs): void {
  const [pathSeen, setPathSeen] = useState(path);
  const [candidatesSeen, setCandidatesSeen] = useState(candidates);

  if (pathSeen !== path) {
    setPathSeen(path);
    setCandidatesSeen(candidates);
    live.current = null;
    setSession(null);
    return;
  }

  if (candidatesSeen === candidates) return;
  setCandidatesSeen(candidates);

  const running = live.current;
  if (running === null) return;

  const relabelled = { ...running, pendingLabel: "", labelling: relabel(running.query) };
  live.current = relabelled;
  setSession(relabelled);
}

export function useFlash(host: FlashHost): Flash {
  const [session, setSession] = useState<FlashState | null>(null);

  // The session is ALSO held in a ref, and the ref is what `onKey` reads.
  //
  // Two keys can arrive before React re-renders — a held key repeats faster
  // than a commit — and reading the state variable would then hand the second
  // key the state the first one replaced. Deriving the next state inside a
  // `setState` updater would fix that and introduce a worse problem: a jump
  // moves the cursor, which is a side effect, and React may call an updater
  // more than once.
  const live = useRef<FlashState | null>(null);

  const candidates = useMemo<FlashCandidate[]>(
    () => host.entries.map((entry, index) => ({ name: entry.name, column: "current", index })),
    [host.entries],
  );

  // One listener's worth of fresh inputs, read through a ref for the same
  // reason `useKeyDispatch` does: `onKey` must not change identity per keypress.
  const latest = useRef({ candidates, cursorIndex: host.cursorIndex, moveTo: host.moveTo });
  latest.current = { candidates, cursorIndex: host.cursorIndex, moveTo: host.moveTo };

  const restoreTo = useRef<CursorMemory>({ index: 0, name: "" });

  const relabel = useCallback(
    (query: string) => computeFlash(query, latest.current.candidates, latest.current.cursorIndex),
    [],
  );

  const finish = useCallback((index: number) => {
    live.current = null;
    setSession(null);
    latest.current.moveTo(index);
  }, []);

  const start = useCallback(() => {
    const { candidates: rows, cursorIndex } = latest.current;
    restoreTo.current = { index: cursorIndex, name: rows[cursorIndex]?.name ?? "" };
    const fresh = newFlashState();
    live.current = fresh;
    setSession(fresh);
  }, []);

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const current = live.current;
      if (current === null) return;

      const outcome = flashKey(current, { key: event.key }, relabel);
      if (outcome.kind === "state") {
        live.current = outcome.state;
        setSession(outcome.state);
        return;
      }
      // Cancelling puts the cursor back; jumping puts it on the target. The
      // engine reports which, and neither is its own to perform.
      finish(
        outcome.kind === "cancel"
          ? restoreIndex(restoreTo.current, latest.current.candidates)
          : outcome.match.index,
      );
    },
    [finish, relabel],
  );

  useSessionUpkeep({ path: host.path, candidates, live, setSession, relabel });

  const labels = useMemo(() => labelsFor(session), [session]);

  const chrome = useMemo(() => (session === null ? null : { query: session.query }), [session]);

  return { active: session !== null, chrome, labels, start, onKey };
}
