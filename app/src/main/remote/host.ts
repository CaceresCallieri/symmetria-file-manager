import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import {
  decodePreviewUrlReply,
  failure,
  type IpcReply,
  isRecord,
  success,
} from "@symmetria/fm-core/contract";
import {
  MACHINE_CLOSE_CHANNEL,
  MACHINE_OPEN_CHANNEL,
  MACHINES_CHANNEL,
  type MachineId,
  type MachineInfo,
} from "@symmetria/fm-core/machines";
import { REQUEST_CHANNELS } from "@symmetria/fm-main/ipc/channels";
import type {
  IpcHandler,
  IpcSurface,
  Registry,
  SenderHandle,
} from "@symmetria/fm-main/ipc/register";
import { RemoteClient, remoteFetch } from "./client.ts";
import type { RemoteConfig } from "./config.ts";
import { describeConnectionFailure } from "./connectionFailure.ts";
import { RemotePreferences } from "./preferences.ts";
import { remotePreviewUrl } from "./previews.ts";
import { decodeReadReply } from "./readReply.ts";

interface Context {
  readonly owner: SenderHandle;
  readonly sender: SenderHandle;
  readonly machine: MachineId;
  readonly remote: RemoteClient | null;
}
export class MachineHost {
  private readonly contexts = new Map<string, Context>();
  private registry: Registry | null = null;
  private readonly preferences = new RemotePreferences();
  constructor(
    private readonly config: RemoteConfig | null,
    private readonly allowsRemote: (sender: SenderHandle) => boolean,
  ) {}
  bindRegistry(registry: Registry): void {
    this.registry = registry;
  }
  wrap(target: IpcSurface): IpcSurface {
    target.handle(MACHINES_CHANNEL, async (_, owner) => success(await this.machines(owner)));
    target.handle(MACHINE_OPEN_CHANNEL, async (raw, owner) => this.open(raw, owner));
    target.handle(MACHINE_CLOSE_CHANNEL, async (raw, owner) => this.close(raw, owner));
    return {
      handle: (channel, handler) =>
        target.handle(channel, async (raw, owner) => this.route(channel, raw, owner, handler)),
      removeHandler: (channel) => target.removeHandler(channel),
    };
  }
  private route(
    channel: string,
    raw: unknown,
    owner: SenderHandle,
    handler: IpcHandler,
  ): Promise<IpcReply> {
    if (!isEnvelope(raw)) return handler(raw, owner);
    const context = this.context(raw.fmContext, owner);
    if (context === null)
      return Promise.resolve(failure("invalid_request", "Machine connection is closed"));
    if (context.remote === null) return handler(raw.payload, context.sender);
    return this.remoteReply(context.remote, channel, raw.payload);
  }
  private context(id: unknown, owner: SenderHandle): Context | null {
    if (typeof id !== "string") return null;
    const context = this.contexts.get(id);
    return context?.owner === owner ? context : null;
  }
  private open(raw: unknown, owner: SenderHandle): IpcReply {
    const machine = requestedMachine(raw);
    if (machine === null) return failure("invalid_request", "Invalid machine");
    if (machine === "home" && !this.remoteAllowed(owner))
      return failure("invalid_request", "Vigilia Home is not configured for this window");
    if ([...this.contexts.values()].filter((context) => context.owner === owner).length >= 8)
      return failure("invalid_request", "Too many machine connections");
    return this.createConnection(machine, owner);
  }
  private remoteAllowed(owner: SenderHandle): boolean {
    return this.config !== null && this.allowsRemote(owner);
  }
  private createConnection(machine: MachineId, owner: SenderHandle): IpcReply {
    const id = randomUUID();
    const sender: SenderHandle = {
      send: (channel, payload) => owner.send(channel, { fmContext: id, payload }),
    };
    const remote =
      machine === "home" && this.config !== null ? new RemoteClient(this.config, sender) : null;
    this.contexts.set(id, { owner, sender, machine, remote });
    return success({ id });
  }
  private close(raw: unknown, owner: SenderHandle): IpcReply {
    if (!isRecord(raw) || typeof raw.id !== "string")
      return failure("invalid_request", "Invalid machine connection");
    const context = this.context(raw.id, owner);
    if (context !== null) {
      if (context.remote !== null) context.remote.dispose();
      this.registry?.disposeSender(context.sender);
      this.contexts.delete(raw.id);
    }
    return success(null);
  }
  closeOwner(owner: SenderHandle): void {
    for (const [id, context] of this.contexts)
      if (context.owner === owner) this.close({ id }, owner);
  }
  dispose(): void {
    for (const context of [...this.contexts.values()]) this.closeOwner(context.owner);
  }
  private async remoteReply(
    client: RemoteClient,
    channel: string,
    payload: unknown,
  ): Promise<IpcReply> {
    const preference = this.preferences.invoke(channel, payload);
    if (preference !== null) return preference;
    const raw = await client.invoke(channel, payload);
    const reply = decodeReadReply(channel, raw);
    return previewReply(reply, channel, client.config);
  }
  private async machines(owner: SenderHandle): Promise<readonly MachineInfo[]> {
    const local: MachineInfo = {
      id: "local",
      name: "Local",
      homePath: homedir(),
      startPath: homedir(),
      readOnly: false,
      error: null,
    };
    if (this.config === null || !this.allowsRemote(owner)) return [local];
    try {
      const info = await homeMetadata(this.config);
      return [
        local,
        {
          id: "home",
          name: this.config.name,
          homePath: info.homePath,
          startPath: info.startPath,
          readOnly: true,
          error: null,
        },
      ];
    } catch (cause) {
      return [
        local,
        {
          id: "home",
          name: this.config.name,
          homePath: "/",
          startPath: "/",
          readOnly: true,
          error: describeConnectionFailure(cause, this.config.name),
        },
      ];
    }
  }
}

function isEnvelope(raw: unknown): raw is Record<string, unknown> {
  return isRecord(raw) && "fmContext" in raw;
}
function requestedMachine(raw: unknown): MachineId | null {
  if (!isRecord(raw)) return null;
  return raw.machine === "local" || raw.machine === "home" ? raw.machine : null;
}
function isPreviewChannel(channel: string): boolean {
  return (
    channel === REQUEST_CHANNELS.previewUrl || channel === REQUEST_CHANNELS.previewDirectoryUrl
  );
}
function previewReply(reply: IpcReply, channel: string, config: RemoteConfig): IpcReply {
  if (!reply.ok || !isPreviewChannel(channel)) return reply;
  const preview = decodePreviewUrlReply(reply.value);
  if (!preview.ok) return preview;
  return success({
    url: remotePreviewUrl(
      config,
      preview.value.url,
      channel === REQUEST_CHANNELS.previewDirectoryUrl,
    ),
  });
}
function metadataPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) throw new Error("Invalid home service path");
  return raw;
}
async function homeMetadata(
  config: RemoteConfig,
): Promise<{ homePath: string; startPath: string }> {
  const response = await remoteFetch(config, "/host", { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Vigilia Home answered ${response.status}`);
  const info: unknown = await response.json();
  if (!isRecord(info)) throw new Error("Invalid home service reply");
  return { homePath: metadataPath(info.homePath), startPath: metadataPath(info.startPath) };
}
