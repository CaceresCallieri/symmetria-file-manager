/**
 * Every channel, in one place, split by direction.
 *
 * The split is not decoration. A request channel gets a handler and returns a
 * reply; a push channel is sent to and never handled. Keeping them in one flat
 * map made a test asserting "every channel has a handler" fail for a correct
 * implementation, which is a sign the map was hiding a real distinction.
 *
 * One prefix throughout, so a channel that does not belong to this application
 * is obvious at a glance and the whole surface is assertable.
 */

/** Renderer asks, main process replies. Each one has exactly one handler. */
export const REQUEST_CHANNELS = {
  /** List a directory. */
  list: "symmetria-fm:list",
  /** Start watching a directory. */
  watch: "symmetria-fm:watch",
  /** Stop watching. */
  unwatch: "symmetria-fm:unwatch",
  /** Read the head of a text file. */
  readText: "symmetria-fm:read-text",
  /** Abandon an in-flight stream. */
  cancel: "symmetria-fm:cancel",
  /** Everything the preview router needs about one entry. */
  describe: "symmetria-fm:describe",
  /** Make one file loadable by the renderer, and name the URL. */
  previewUrl: "symmetria-fm:preview-url",
} as const;

/** Main process pushes, renderer listens. These are never handled. */
export const PUSH_CHANNELS = {
  /** One batch of a streamed listing. */
  listBatch: "symmetria-fm:list-batch",
  /** A watched directory changed. */
  changed: "symmetria-fm:changed",
} as const;

export const CHANNELS = { ...REQUEST_CHANNELS, ...PUSH_CHANNELS } as const;
