import { randomUUID } from "node:crypto";

/**
 * Paths the renderer has been given permission to load directly.
 *
 * ── Why a token rather than bytes over the bridge ───────────────────────────
 * An image and a document both need a URL the browser can load. Sending their
 * bytes across the process boundary and building a blob URL works for an image
 * and does NOT work for a document: Chromium's PDF viewer refuses a `blob:` URL
 * whose origin is a custom scheme, and the `<embed>` resolves to
 * `chrome-error://chromewebdata` — a failure invisible from the DOM and silent
 * at the console. Verification found it only in the frame tree.
 *
 * A token turns each file into an ordinary same-origin URL the viewer accepts,
 * and it also removes a copy of up to 64 megabytes per preview.
 *
 * ── What it does and does not protect ───────────────────────────────────────
 * It does NOT narrow what the renderer may read: the renderer may still ask for
 * any path, exactly as the byte-reading channel allowed. What it preserves is
 * the property phase 2 established — that the renderer cannot reach the disk
 * WITHOUT the main process handing it something. Every path served this way was
 * named in a request the main process answered, so policy has one place to live
 * if it is ever needed.
 */

/**
 * How many paths stay loadable at once.
 *
 * Bounded because a resident application previews thousands of files in a
 * session, and an unbounded map would keep every one of them addressable for
 * the lifetime of the process. Generous enough that a token cannot expire while
 * the image it belongs to is still on screen.
 */
const MAX_TOKENS = 64;

const paths = new Map<string, string>();

/** The URL path prefix these are served under. */
export const TOKEN_PREFIX = "/__preview/";

/**
 * Make a path loadable, and return the token that addresses it.
 *
 * Asking twice for the same path returns the same token, so a component that
 * re-renders does not leak a token per render.
 */
export function authorisePreview(path: string): string {
  for (const [token, existing] of paths) {
    if (existing === path) return token;
  }

  const token = randomUUID();
  paths.set(token, path);

  // Oldest first: insertion order is the eviction order, and the oldest token
  // belongs to the file the user looked at longest ago.
  while (paths.size > MAX_TOKENS) {
    const oldest = paths.keys().next().value;
    if (oldest === undefined) break;
    paths.delete(oldest);
  }

  return token;
}

/** The path a token addresses, or `null` for one that was never issued. */
export function resolveToken(token: string): string | null {
  return paths.get(token) ?? null;
}

/** Drop every token. For tests, which must not inherit another test's grants. */
export function forgetPreviewTokens(): void {
  paths.clear();
}
