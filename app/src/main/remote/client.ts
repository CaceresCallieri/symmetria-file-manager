import { randomUUID } from "node:crypto";
import { failure, isRecord, type Result, success } from "@symmetria/fm-core/contract";
import { MACHINE_LOST_CHANNEL } from "@symmetria/fm-core/machines";
import { PUSH_CHANNELS, REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import type { SenderHandle } from "@symmetria/fm-main/ipc/register";
import type { RemoteConfig } from "./config.ts";
import {
  answerTimeoutMessage,
  describeConnectionFailure,
  errorMessage,
} from "./connectionFailure.ts";
import { consumeEvents } from "./events.ts";
import { decodeRemoteReply, decodeRemoteRequest, type RemoteRequest } from "./policy.ts";

export class RemoteClient {
  private readonly sessionId = randomUUID();
  private readonly controller = new AbortController();
  private readonly watches = new Set<string>();
  private readonly ready: Promise<void>;
  private lost: string | null = null;
  constructor(
    readonly config: RemoteConfig,
    private readonly sender: SenderHandle,
    private readonly requestTimeoutMs = 15_000,
    private readonly connectTimeoutMs = 10_000,
  ) {
    this.ready = new Promise((resolve, reject) => {
      void this.follow(resolve).catch((cause: unknown) => {
        const message = describeConnectionFailure(cause, config.name);
        this.markLost(message);
        reject(new Error(message));
      });
    });
    void this.ready.catch(() => {});
  }
  private markLost(message: string): void {
    if (this.lost !== null || this.controller.signal.aborted) return;
    this.lost = message;
    this.emit(MACHINE_LOST_CHANNEL, message);
    for (const subscriptionId of this.watches)
      this.emit(PUSH_CHANNELS.changed, {
        subscriptionId,
        error: `${message}; reconnecting`,
      });
    this.watches.clear();
    this.controller.abort();
  }
  private emit(channel: string, payload: unknown): void {
    this.sender.send(channel, payload);
  }
  private async follow(ready: () => void): Promise<void> {
    const response = await remoteFetch(this.config, `/events?session=${this.sessionId}`, {
      signal: this.controller.signal,
    });
    if (!response.ok || response.body === null)
      throw new Error(`Remote events answered ${response.status}`);
    await consumeEvents(response.body, ready, (event) => this.emit(event.channel, event.payload));
  }
  async invoke(channel: string, payload: unknown): Promise<Result<unknown>> {
    const permitted = decodeRemoteRequest({ sessionId: this.sessionId, channel, payload });
    if (!permitted.ok) return permitted;
    if (this.lost !== null) return failure("read_failed", this.lost);
    return this.request(permitted.value, channel, payload);
  }
  private async connected(): Promise<Result<null>> {
    try {
      await Promise.race([this.ready, connectionTimeout(this.config.name, this.connectTimeoutMs)]);
      return success(null);
    } catch (cause) {
      const message = errorMessage(cause);
      this.markLost(message);
      return failure("read_failed", message);
    }
  }
  private async request(
    request: RemoteRequest,
    channel: string,
    payload: unknown,
  ): Promise<Result<unknown>> {
    const connection = await this.connected();
    if (!connection.ok) return connection;
    try {
      const response = await remoteFetch(this.config, "/rpc", {
        method: "POST",
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (!response.ok) return failure("read_failed", `Vigilia Home answered ${response.status}`);
      const reply = decodeRemoteReply(await response.json());
      if (!reply.ok && reply.error.message === "session is not connected")
        this.markLost("Vigilia Home disconnected");
      if (reply.ok) this.rememberWatch(channel, payload);
      return reply;
    } catch (cause) {
      const message = describeConnectionFailure(cause, this.config.name);
      // Timeout and JSON errors affect this request. A network TypeError affects
      // the connection; SSE liveness and expired sessions cover the other losses.
      if (cause instanceof TypeError) this.markLost(message);
      return failure("read_failed", message);
    }
  }
  private rememberWatch(channel: string, payload: unknown): void {
    const id = subscriptionId(payload);
    if (id === null) return;
    if (channel === REQUEST_CHANNELS.watch) this.watches.add(id);
    if (channel === REQUEST_CHANNELS.unwatch) this.watches.delete(id);
  }
  dispose(): void {
    this.controller.abort();
    this.watches.clear();
  }
}
function connectionTimeout(machineName: string, timeoutMs: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(answerTimeoutMessage(machineName))), timeoutMs);
    timer.unref();
  });
}
export function remoteFetch(
  config: RemoteConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${config.url}${path}`, {
    ...init,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

function subscriptionId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  return typeof payload.subscriptionId === "string" ? payload.subscriptionId : null;
}
