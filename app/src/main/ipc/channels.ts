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
  /** Copy or move entries into a directory. */
  transfer: "symmetria-fm:transfer",
  /** Abandon a running transfer. */
  cancelTransfer: "symmetria-fm:cancel-transfer",
  /** Create an empty file or a directory, with its parents. */
  create: "symmetria-fm:create",
  /** Rename an entry in place. */
  rename: "symmetria-fm:rename",
  /** Send entries to the desktop trash. */
  trash: "symmetria-fm:trash",
  /** The directories zoxide records this user going to. */
  frecent: "symmetria-fm:frecent",
  /** Put text or an image on the system clipboard. */
  clipboard: "symmetria-fm:clipboard",
  /** Hand an entry to whatever the desktop says opens it. */
  open: "symmetria-fm:open",
  /** Read the bookmark store, seeding it on a first run. */
  bookmarksRead: "symmetria-fm:bookmarks-read",
  /** Replace the bookmark store. */
  bookmarksWrite: "symmetria-fm:bookmarks-write",
} as const;

/** Main process pushes, renderer listens. These are never handled. */
export const PUSH_CHANNELS = {
  /** One batch of a streamed listing. */
  listBatch: "symmetria-fm:list-batch",
  /** A watched directory changed. */
  changed: "symmetria-fm:changed",
  /** How far a transfer has got. */
  transferProgress: "symmetria-fm:transfer-progress",
} as const;

export const CHANNELS = { ...REQUEST_CHANNELS, ...PUSH_CHANNELS } as const;
