import { isFailure } from "@symmetria/fm-core/contract";
import { DEFAULT_LISTING_OPTIONS, type ListingOptions } from "@symmetria/fm-core/listingOptions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useFileManagerIo } from "./IoContext.tsx";

/**
 * The listing order, loaded once and saved on every change.
 *
 * Its own hook rather than more lines inside `useTabs`, for the reason the
 * complexity gate keeps making in this package: `useTabs` is measured as one
 * function and this is a self-contained concern with its own lifecycle. The
 * same pressure produced `useExternalOpen` and `usePicker`.
 *
 * ── The window paints before the disk answers ───────────────────────────────
 * It starts on the default and applies what was stored when it arrives, so
 * opening a window costs no disk read. `useTabs` re-lists only where the two
 * differ — and because most stored files hold exactly the default, the common
 * case is no second listing at all.
 */
interface StoredOrder {
  readonly options: ListingOptions;
  readonly ready: boolean;
  /** Replace the order and write it back. */
  set(options: ListingOptions): void;
}

/** A reveal can show hidden files in this window without changing disk preferences. */
export function useWindowListingOptions() {
  const stored = useListingOptions();
  const [temporaryHidden, setTemporaryHidden] = useState(false);
  const options = useMemo(
    () => (temporaryHidden ? { ...stored.options, showHidden: true } : stored.options),
    [stored.options, temporaryHidden],
  );
  return {
    options,
    ready: stored.ready,
    setSort: (sort: ListingOptions["sort"], reverse: boolean) =>
      stored.set({ ...stored.options, sort, reverse }),
    toggleHidden: () => {
      setTemporaryHidden(false);
      stored.set({ ...stored.options, showHidden: !options.showHidden });
    },
    showHiddenTemporarily: () => setTemporaryHidden(true),
    toggleRenderDocuments: () =>
      stored.set({ ...stored.options, renderDocuments: !options.renderDocuments }),
  };
}

function useListingOptions(): StoredOrder {
  const { readListingOptions, writeListingOptions } = useFileManagerIo();
  const [options, setOptions] = useState<ListingOptions>(DEFAULT_LISTING_OPTIONS);

  /**
   * Whether the stored order has arrived.
   *
   * It gates the WRITE, not the read: a window that loads its options and
   * immediately saves them back is harmless until two windows do it at once,
   * and the file dialog opens a second one.
   */
  const loaded = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let current = true;

    const done = () => {
      // Set OUTSIDE the cancellation guard below, and in the rejection handler
      // too. The read has FINISHED either way; the guard exists to stop a state
      // update reaching a component that no longer wants one, which is a
      // different question from whether the work completed.
      //
      // **This is defensive, not a repair.** An earlier draft of this logic —
      // inline in `useTabs`, before it was extracted here — did leave the flag
      // unset and stopped saving, and this ordering was written believing it
      // was the cause. Mutating it back proves otherwise: every test still
      // passes, including under `StrictMode`, because the second effect issues
      // its own read and sets the flag anyway. The real cause was somewhere in
      // that integration and went with it. Do not weaken this on the strength
      // of the mutation passing; do not credit it with a fix either.
      loaded.current = true;
      if (current) setReady(true);
    };

    void readListingOptions().then((reply) => {
      done();
      if (!current) return;

      // A failure is not an error to show. The main process answers the
      // default for a missing file AND for one nobody can read, so the only
      // failures left here are a missing bridge and a malformed reply — and a
      // window that refused to list because of either would be worse than one
      // that opens in an order the operator sets again.
      if (!isFailure(reply)) setOptions(reply.value);
    }, done);

    return () => {
      current = false;
    };
  }, [readListingOptions]);

  /**
   * Writes land in the order they were made.
   *
   * Two in flight at once are otherwise decided by whichever finishes its disk
   * I/O last, so pressing `,s` and then `,S` can store the sort change and lose
   * the reverse — a choice the status bar already showed as taken, absent on
   * the next start. `useBookmarks` solves the identical problem one file over
   * and this is its chain; review found that I had copied that hook's shape
   * without its defence.
   */
  const writeChain = useRef<Promise<unknown>>(Promise.resolve());

  const set = useCallback(
    (next: ListingOptions) => {
      setOptions(next);
      if (!loaded.current) return;

      // The whole object rather than a delta: it is three fields, and a
      // partial-update path would be a second shape for one fact.
      //
      // `catch` on the chain and not on the write: one rejection must not break
      // the link and strand every write after it.
      writeChain.current = writeChain.current.then(
        () => writeListingOptions(next),
        () => writeListingOptions(next),
      );
    },
    [writeListingOptions],
  );

  return { options, set, ready };
}
