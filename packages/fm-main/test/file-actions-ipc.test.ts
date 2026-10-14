import { failure, type IpcReply } from "@symmetria/fm-core/contract";
import { describe, expect, it } from "vitest";
import type { FileActionService } from "../src/fileActions/service.ts";
import { REQUEST_CHANNELS } from "../src/ipc/channels.ts";
import { registerFileActions } from "../src/ipc/fileActions.ts";
import type { IpcHandler, SenderHandle } from "../src/ipc/register.ts";

function harness(service?: FileActionService) {
  const handlers = new Map<string, IpcHandler>();
  const registry = registerFileActions(
    {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      removeHandler: () => {},
    },
    service,
  );
  return {
    registry,
    invoke: (channel: string, payload: unknown, sender: SenderHandle): Promise<IpcReply> =>
      handlers.get(channel)?.(payload, sender) ??
      Promise.resolve(failure("invalid_request", "missing")),
  };
}
const request = {
  id: "archive-1",
  paths: ["/tmp/file"],
  action: "extract",
  choice: "",
  destination: "",
  prefix: "",
  format: "zip",
  makeExecutable: false,
};
describe("owned desktop action jobs", () => {
  it("rejects unavailable hosts and invalid launch options", async () => {
    const h = harness();
    const sender = { send() {} };
    expect((await h.invoke(REQUEST_CHANNELS.fileActionExecute, request, sender)).ok).toBe(false);
    const result = await h.invoke(
      REQUEST_CHANNELS.fileActionExecute,
      { ...request, prefix: "relative" },
      sender,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
  });
  it("isolates cancellation by sender and aborts a job when its owner closes", async () => {
    let observed: AbortSignal | null = null;
    const service: FileActionService = {
      inspect: async () => {
        throw new Error("unused");
      },
      execute: async (_, signal) => {
        observed = signal;
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
        );
      },
    };
    const h = harness(service);
    const owner = { send() {} };
    const other = { send() {} };
    const running = h.invoke(REQUEST_CHANNELS.fileActionExecute, request, owner);
    await h.invoke(REQUEST_CHANNELS.fileActionCancel, { id: request.id }, other);
    // The cast is test-only: execute publishes the signal synchronously to this harness.
    expect((observed as AbortSignal | null)?.aborted).toBe(false);
    h.registry.disposeSender(owner);
    const result = await running;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("cancelled");
  });
});
