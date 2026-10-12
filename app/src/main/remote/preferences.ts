import {
  type BookmarksReply,
  decodeBookmarksWriteRequest,
  decodeListingOptionsWriteRequest,
  type IpcReply,
  success,
} from "@symmetria/fm-core/contract";
import { DEFAULT_LISTING_OPTIONS } from "@symmetria/fm-core/listingOptions";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";

/** These are window preferences. They never write files on the remote machine. */
export class RemotePreferences {
  private bookmarks: BookmarksReply = { bookmarks: [] };
  private options = DEFAULT_LISTING_OPTIONS;
  invoke(channel: string, payload: unknown): IpcReply | null {
    if (channel === REQUEST_CHANNELS.bookmarksRead) return success(this.bookmarks);
    if (channel === REQUEST_CHANNELS.listingRead) return success({ options: this.options });
    if (channel === REQUEST_CHANNELS.bookmarksWrite) return this.saveBookmarks(payload);
    if (channel === REQUEST_CHANNELS.listingWrite) return this.saveListing(payload);
    return null;
  }
  private saveBookmarks(payload: unknown): IpcReply {
    const request = decodeBookmarksWriteRequest(payload);
    if (!request.ok) return request;
    this.bookmarks = request.value;
    return success(null);
  }
  private saveListing(payload: unknown): IpcReply {
    const request = decodeListingOptionsWriteRequest(payload);
    if (!request.ok) return request;
    this.options = request.value.options;
    return success(null);
  }
}
