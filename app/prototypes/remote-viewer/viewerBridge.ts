import type { Bridge, Unsubscribe } from "@symmetria/fm-core/bridge";
import { failure, isRecord, type Result, success } from "@symmetria/fm-core/contract";
import {
  DEFAULT_LISTING_OPTIONS,
  decodeListingOptions,
  type ListingOptions,
} from "@symmetria/fm-core/listingOptions";
import { PUSH_CHANNELS, REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";

export interface ViewerTransport {
  call(channel: string, payload: unknown): Promise<Result<unknown>>;
  listen(channel: string): (listener: (event: unknown) => void) => Unsubscribe;
}

/** Both hosts share view preferences and capability restrictions. */
export function createViewerBridge(transport: ViewerTransport): Bridge {
  const send = (channel: string) => (payload: unknown) => transport.call(channel, payload);
  const unavailable = () => Promise.resolve(failure("write_failed", "This viewer is read-only"));
  let listing: ListingOptions = {
    ...DEFAULT_LISTING_OPTIONS,
    sort: "alphabetical",
    reverse: false,
  };
  return {
    version: "remote-viewer-prototype",
    list: send(REQUEST_CHANNELS.list),
    overview: send(REQUEST_CHANNELS.overview),
    watch: send(REQUEST_CHANNELS.watch),
    unwatch: send(REQUEST_CHANNELS.unwatch),
    cancel: send(REQUEST_CHANNELS.cancel),
    describe: send(REQUEST_CHANNELS.describe),
    readText: send(REQUEST_CHANNELS.readText),
    previewUrl: send(REQUEST_CHANNELS.previewUrl),
    previewDirectoryUrl: send(REQUEST_CHANNELS.previewDirectoryUrl),
    diskUsage: send(REQUEST_CHANNELS.diskUsage),
    places: send(REQUEST_CHANNELS.places),
    transfer: unavailable,
    cancelTransfer: unavailable,
    create: unavailable,
    rename: unavailable,
    trash: unavailable,
    open: unavailable,
    clipboard: unavailable,
    searchStart: () =>
      Promise.resolve(failure("read_failed", "Use / to search the current folder")),
    searchQuery: unavailable,
    searchRecord: unavailable,
    searchRelease: () => Promise.resolve(success(null)),
    frecent: () => Promise.resolve(success({ entries: [] })),
    bookmarksRead: () => Promise.resolve(success({ bookmarks: [] })),
    bookmarksWrite: unavailable,
    listingRead: () => Promise.resolve(success({ options: listing })),
    listingWrite: (raw) => {
      if (isRecord(raw)) listing = decodeListingOptions(raw.options);
      return Promise.resolve(success(null));
    },
    hideWindow: unavailable,
    pickerConfirm: unavailable,
    pickerCancel: unavailable,
    onChanged: transport.listen(PUSH_CHANNELS.changed),
    onListBatch: transport.listen(PUSH_CHANNELS.listBatch),
    onTransferProgress: transport.listen(PUSH_CHANNELS.transferProgress),
    onOpenPath: transport.listen(PUSH_CHANNELS.openPath),
  };
}
