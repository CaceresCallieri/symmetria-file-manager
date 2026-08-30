import type { Bookmark } from "@symmetria/fm-core/bookmarks";
import { isFailure } from "@symmetria/fm-core/contract";
import { useEffect, useState } from "react";

import { readBookmarks } from "./bridge.ts";

/**
 * The bookmark store, as the window sees it.
 *
 * Loaded once. The main process owns the file — where it is, seeding it on a
 * first run, writing it atomically — and this owns nothing but the copy the
 * keyboard reads. Two windows would each hold their own copy and the last write
 * would win, which is what the Qt build does too and has never mattered: a
 * bookmark is changed a handful of times a year.
 */

export interface Bookmarks {
  readonly byLetter: ReadonlyMap<string, Bookmark>;
  /** Where a letter points, or `null` when nothing is bound there. */
  pathFor(letter: string): string | null;
}

export function useBookmarks(): Bookmarks {
  const [byLetter, setByLetter] = useState<ReadonlyMap<string, Bookmark>>(new Map());

  useEffect(() => {
    let current = true;
    void readBookmarks().then((reply) => {
      // The window may have closed while the read was in flight.
      if (!current || isFailure(reply)) return;
      setByLetter(reply.value);
    });
    return () => {
      current = false;
    };
  }, []);

  return {
    byLetter,
    pathFor: (letter) => byLetter.get(letter)?.path ?? null,
  };
}
