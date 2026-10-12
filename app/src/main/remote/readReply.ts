import {
  decodeDescribeReply,
  decodeDiskUsageReply,
  decodeListReply,
  decodePlacesReply,
  decodePreviewUrlReply,
  decodeReadTextReply,
  failure,
  type IpcReply,
  type Result,
  success,
} from "@symmetria/fm-core/contract";
import { decodeOverviewReply } from "@symmetria/fm-core/overview/contract";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";

const decoders = new Map<string, (value: unknown) => IpcReply>([
  [REQUEST_CHANNELS.list, decodeListReply],
  [REQUEST_CHANNELS.describe, decodeDescribeReply],
  [REQUEST_CHANNELS.readText, decodeReadTextReply],
  [REQUEST_CHANNELS.overview, decodeOverviewReply],
  [REQUEST_CHANNELS.previewUrl, decodePreviewUrlReply],
  [REQUEST_CHANNELS.previewDirectoryUrl, decodePreviewUrlReply],
  [REQUEST_CHANNELS.diskUsage, decodeDiskUsageReply],
  [REQUEST_CHANNELS.places, decodePlacesReply],
]);
const acknowledgements = new Set<string>([
  REQUEST_CHANNELS.watch,
  REQUEST_CHANNELS.unwatch,
  REQUEST_CHANNELS.cancel,
]);
export function decodeReadReply(channel: string, reply: Result<unknown>): IpcReply {
  if (!reply.ok) return reply;
  const decode = decoders.get(channel);
  if (decode) return decode(reply.value);
  return decodeAcknowledgement(channel, reply.value);
}

function decodeAcknowledgement(channel: string, value: unknown): IpcReply {
  if (acknowledgements.has(channel) && value === null) return success(null);
  return failure("invalid_reply", "Invalid read-only service reply");
}
