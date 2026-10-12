import { type DiskUsageReply, isFailure } from "@symmetria/fm-core/contract";
import { useEffect, useState } from "react";
import type { FileManagerIo } from "./bridge.ts";

/** Refresh storage while a directory remains unchanged. */
const DISK_REFRESH_MS = 30_000;
export function observeDiskUsage(
  io: Pick<FileManagerIo, "diskUsage">,
  path: string,
  receive: (usage: DiskUsageReply | null) => void,
): () => void {
  let current = true;
  const read = () =>
    void io.diskUsage(path).then((reply) => {
      if (current) receive(isFailure(reply) ? null : reply.value);
    });
  read();
  const timer = window.setInterval(read, DISK_REFRESH_MS);
  return () => {
    current = false;
    window.clearInterval(timer);
  };
}
export function useDiskUsage(
  io: Pick<FileManagerIo, "diskUsage">,
  path: string,
): DiskUsageReply | null {
  const [usage, setUsage] = useState<DiskUsageReply | null>(null);
  useEffect(() => observeDiskUsage(io, path, setUsage), [io, path]);
  return usage;
}
