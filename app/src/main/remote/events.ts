import { isRecord } from "@symmetria/fm-core/contract";
import { PUSH_CHANNELS } from "@symmetria/fm-main/ipc/channels";

export interface RemotePush {
  readonly channel: string;
  readonly payload: unknown;
}
const channels: readonly string[] = Object.values(PUSH_CHANNELS);
function pushFrom(data: string): RemotePush | null {
  const raw: unknown = JSON.parse(data);
  if (!isRecord(raw) || typeof raw.channel !== "string") return null;
  return channels.includes(raw.channel) ? { channel: raw.channel, payload: raw.payload } : null;
}

/** The service emits one JSON data line per frame. Bound an unfinished frame. */
export async function consumeEvents(
  body: ReadableStream<Uint8Array>,
  ready: () => void,
  push: (event: RemotePush) => void,
  idleMs = 45_000,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const chunk = await readWithDeadline(reader, idleMs);
      if (chunk.done) throw new Error("Vigilia Home disconnected");
      pending += decoder.decode(chunk.value, { stream: true });
      const batch = splitFrames(pending);
      pending = batch.pending;
      for (const frame of batch.frames) deliverFrame(frame, ready, push);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function deliverFrame(frame: string, ready: () => void, push: (event: RemotePush) => void): void {
  if (frame.startsWith("event: ready\n")) {
    ready();
    return;
  }
  if (!frame.startsWith("data: ")) return;
  const event = pushFrom(frame.slice(6));
  if (event !== null) push(event);
}

function splitFrames(text: string) {
  const frames = text.split("\n\n");
  const pending = frames.pop() ?? "";
  if ([pending, ...frames].some((frame) => frame.length > 2 * 1024 * 1024))
    throw new Error("Remote event exceeds the size limit");
  return { pending, frames };
}

/** Every chunk, including a heartbeat, renews the event stream deadline. */
async function readWithDeadline(reader: ReadableStreamDefaultReader<Uint8Array>, idleMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Vigilia Home disconnected: heartbeat timed out")),
          idleMs,
        );
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
