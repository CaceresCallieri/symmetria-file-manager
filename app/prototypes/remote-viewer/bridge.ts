import type { Bridge, Unsubscribe } from "@symmetria/fm-core/bridge";
import { failure, isRecord, type Result } from "@symmetria/fm-core/contract";
import { decodeRemoteReply } from "./policy.ts";
import { createViewerBridge } from "./viewerBridge.ts";

function failed(cause: unknown): Result<never> {
  return failure("read_failed", cause instanceof Error ? cause.message : String(cause));
}

function pushEvent(raw: unknown): { channel: string; payload: unknown } | null {
  if (!isRecord(raw)) return null;
  return typeof raw.channel === "string" ? { channel: raw.channel, payload: raw.payload } : null;
}

export function createRemoteBridge(onLost: () => void): Bridge {
  // HTTP on a tailnet is not a secure browser context, so randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const sessionId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const events = new EventSource(`/events?session=${sessionId}`);
  let lost = false;
  const ready = new Promise<void>((resolve, reject) => {
    events.addEventListener("ready", () => resolve());
    events.onerror = () => {
      lost = true;
      events.close();
      reject(new Error("Home server disconnected"));
      onLost();
    };
  });
  // Handle a connection failure even when the panel made no request yet.
  void ready.catch(() => {});
  events.onmessage = (event) => {
    const push = pushEvent(JSON.parse(event.data));
    if (push === null) return;
    for (const listener of listeners.get(push.channel) ?? []) listener(push.payload);
  };
  window.addEventListener("pagehide", () => events.close(), { once: true });

  const send =
    (channel: string) =>
    async (payload: unknown): Promise<Result<unknown>> => {
      if (lost) return failure("read_failed", "Home server disconnected; reconnect to continue");
      try {
        await ready;
        const response = await fetch("/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, channel, payload }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) return failure("read_failed", `Home server answered ${response.status}`);
        return decodeRemoteReply(await response.json());
      } catch (cause) {
        return failed(cause);
      }
    };
  const listen =
    (channel: string) =>
    (listener: (event: unknown) => void): Unsubscribe => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => {
        set.delete(listener);
      };
    };
  return createViewerBridge({ call: (channel, payload) => send(channel)(payload), listen });
}
