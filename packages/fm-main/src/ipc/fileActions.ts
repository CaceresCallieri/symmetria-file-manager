import { failure, type IpcReply, success } from "@symmetria/fm-core/contract";
import {
  decodeActionId,
  decodeActionPaths,
  decodeActionRequest,
} from "@symmetria/fm-core/fileActions";
import type { FileActionService } from "../fileActions/service.ts";
import { REQUEST_CHANNELS } from "./channels.ts";
import type { IpcSurface, SenderHandle } from "./register.ts";

export function registerFileActions(ipc: IpcSurface, service: FileActionService | undefined) {
  const jobs = new Map<SenderHandle, Map<string, AbortController>>();
  ipc.handle(REQUEST_CHANNELS.fileActionInspect, async (raw): Promise<IpcReply> => {
    const decoded = decodeActionPaths(raw);
    if (!decoded.ok) return decoded;
    if (!service) return failure("read_failed", "This host does not provide desktop actions.");
    try {
      return success(await service.inspect(decoded.value.paths));
    } catch (cause) {
      return failure("read_failed", String(cause));
    }
  });
  ipc.handle(REQUEST_CHANNELS.fileActionExecute, async (raw, sender): Promise<IpcReply> => {
    const decoded = decodeActionRequest(raw);
    if (!decoded.ok) return decoded;
    if (!service) return failure("write_failed", "This host does not provide desktop actions.");
    const owned = jobs.get(sender) ?? new Map<string, AbortController>();
    if (owned.size >= 4 || owned.has(decoded.value.id))
      return failure(
        "invalid_request",
        "This action is already running or too many actions are active.",
      );
    const controller = new AbortController();
    owned.set(decoded.value.id, controller);
    jobs.set(sender, owned);
    try {
      return success(await service.execute(decoded.value, controller.signal));
    } catch (cause) {
      return failure(controller.signal.aborted ? "cancelled" : "write_failed", String(cause));
    } finally {
      owned.delete(decoded.value.id);
      if (!owned.size) jobs.delete(sender);
    }
  });
  ipc.handle(REQUEST_CHANNELS.fileActionCancel, async (raw, sender): Promise<IpcReply> => {
    const decoded = decodeActionId(raw);
    if (!decoded.ok) return decoded;
    jobs.get(sender)?.get(decoded.value.id)?.abort();
    return success(null);
  });
  return {
    disposeSender(sender: SenderHandle) {
      for (const controller of jobs.get(sender)?.values() ?? []) controller.abort();
      jobs.delete(sender);
    },
    dispose() {
      for (const owned of jobs.values())
        for (const controller of owned.values()) controller.abort();
      jobs.clear();
    },
  };
}
