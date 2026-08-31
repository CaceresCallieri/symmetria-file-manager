/**
 * What the window URL carries, written and read from one place.
 *
 * Two facts travel on it and they are deliberately different:
 *
 * - the **fragment** is where this window OPENS;
 * - the **query** is where HOME is, which is where the tilde goes.
 *
 * They hold the same value today only because nothing opens a window anywhere
 * else yet. The first thing that does would otherwise silently redefine the
 * tilde as "back to where this window started", which is not what it says.
 *
 * Both halves live here because they are two ends of one agreement between two
 * processes that cannot import each other. The main process builds the URL and
 * the sandboxed renderer reads it, so a typo in the parameter name on either
 * side would break the tilde with nothing to catch it — the failure is a key
 * that is simply absent, which reads exactly like a window with no home. One
 * string, used by both, removes the possibility rather than testing for it.
 *
 * **`URLSearchParams` is not used, for two reasons and both matter.** This
 * package compiles against no environment at all — no DOM and no Node — so the
 * global is not in scope here, which is the same rule that keeps a `window`
 * reference out of the main process. And it would be wrong even where it is
 * available: its parser is the HTML form encoding, which decodes `+` to a
 * space, so a directory named `c++` would come back as `c  `. A pair of
 * `encodeURIComponent` and `decodeURIComponent` round-trips every byte.
 */

/** The query parameter's name. Never written out anywhere else. */
const HOME_PARAM = "home";

/** The query string the main process appends, including its leading `?`. */
export function homeQuery(home: string): string {
  return `?${HOME_PARAM}=${encodeURIComponent(home)}`;
}

/**
 * The home directory a window was told about, or `/`.
 *
 * The fallback is the same one the fragment reader uses for a malformed value:
 * a window that cannot tell where home is stays usable, and the tilde goes
 * somewhere real rather than throwing or doing nothing. Three things reach it —
 * no query at all, a query without this parameter, and a value that is not an
 * absolute path.
 */
export function homeFromSearch(search: string): string {
  const query = search.startsWith("?") ? search.slice(1) : search;

  for (const pair of query.split("&")) {
    const equals = pair.indexOf("=");
    if (equals < 0 || pair.slice(0, equals) !== HOME_PARAM) continue;

    const value = decodeOrEmpty(pair.slice(equals + 1));
    return value.startsWith("/") ? value : "/";
  }

  return "/";
}

/**
 * Decode, or give up.
 *
 * `decodeURIComponent` THROWS on a malformed escape — `%zz`, or a bare `%` at
 * the end. Nothing in this application produces one, and a URL is external
 * input the moment anything else can set it, so a throw here would take the
 * whole render down over a stray character.
 */
function decodeOrEmpty(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}
