import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { isRecord } from "@symmetria/fm-core/contract";

export interface RemoteConfig {
  readonly url: string;
  readonly token: string;
  readonly name: string;
}
function decodeRemoteConfig(raw: unknown): RemoteConfig {
  if (!isRecord(raw)) throw new Error("Invalid remote configuration");
  if (typeof raw.url !== "string" || typeof raw.token !== "string")
    throw new Error("The remote configuration needs a URL and token");
  const url = validateRemoteUrl(raw.url);
  if (!/^[a-f0-9]{64}$/.test(raw.token)) throw new Error("Invalid remote access token");
  return {
    url: url.href.replace(/\/$/, ""),
    token: raw.token,
    name: typeof raw.name === "string" ? raw.name : "Vigilia Home",
  };
}

async function loadRemoteConfig(
  userData: string,
  sourcePath = join(userData, "remote.json"),
): Promise<RemoteConfig | null> {
  if (!isAbsolute(sourcePath)) throw new Error("Use an absolute remote configuration path");
  const source = await readFile(sourcePath, "utf8").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return null;
    throw cause;
  });
  return source === null ? null : parseConfig(source);
}

function validateRemoteUrl(source: string): URL {
  const url = new URL(source);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported remote URL");
  if ([url.username, url.password, url.search, url.hash].some(Boolean))
    throw new Error("Use a remote URL without credentials or query parameters");
  if (url.pathname !== "/") throw new Error("Use the root URL of the remote service");
  return url;
}

/** A broken Home configuration must not disable Local or picker IPC. */
export async function loadOptionalRemoteConfig(
  userData: string,
  sourcePath: string | undefined,
  report: (message: string) => void,
): Promise<RemoteConfig | null> {
  try {
    return await loadRemoteConfig(userData, sourcePath);
  } catch (cause) {
    report(cause instanceof Error ? cause.message : String(cause));
    return null;
  }
}

function parseConfig(source: string): RemoteConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    // SyntaxError messages can quote token bytes from the input. Never log them.
    throw new Error("Remote configuration is not valid JSON");
  }
  return decodeRemoteConfig(raw);
}
