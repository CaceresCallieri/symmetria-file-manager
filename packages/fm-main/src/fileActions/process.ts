import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export interface ProcessOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}
export interface ActionProcesses {
  find(command: string): Promise<string | null>;
  run(command: string, args: readonly string[], options?: ProcessOptions): Promise<string>;
  dispatch(command: string, args: readonly string[], options?: ProcessOptions): Promise<void>;
  start(command: string, args: readonly string[], options?: ProcessOptions): Promise<void>;
}
async function find(command: string): Promise<string | null> {
  const candidates = isAbsolute(command)
    ? [command]
    : (process.env["PATH"] ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, command));
  for (const candidate of candidates)
    if (
      await access(candidate, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return candidate;
  return null;
}
function run(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    let fault: Error | null = null;
    const fail = (cause: Error) => {
      fault = cause;
      child.kill("SIGKILL");
    };
    const cancel = () => fail(new Error("Cancelled."));
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(
      () => fail(new Error("The operation exceeded its time limit.")),
      120_000,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 2_000_000) fail(new Error("The tool returned too much output."));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-16_000);
    });
    child.on("error", (cause) => {
      fault = cause;
    });
    // Wait for close before stage cleanup. Abort's error event can precede exit.
    child.on("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      if (fault) reject(fault);
      else if (code === 0) resolve(output);
      else reject(new Error(errors.trim() || `${command} exited with status ${code}.`));
    });
  });
}

function start(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { ...options, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
/** Wait for launcher exit with no pipes inherited by the launched application. */
function dispatch(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: "ignore",
    });
    let timedOut = false;
    const cancel = () => {
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    };
    child.once("error", (cause) => {
      cleanup();
      reject(cause);
    });
    child.once("exit", (code) => {
      cleanup();
      child.unref();
      if (options.signal?.aborted) reject(new Error("Cancelled."));
      else if (timedOut)
        reject(new Error("The desktop launcher exceeded its 10-second time limit."));
      else if (code === 0) resolve();
      else
        reject(
          new Error(
            `${command} could not launch the selected application (status ${code}). Check the application's installation and desktop entry.`,
          ),
        );
    });
  });
}

export const actionProcesses: ActionProcesses = { find, run, start, dispatch };
export async function requireTool(processes: ActionProcesses, name: string): Promise<string> {
  const tool = await processes.find(name);
  if (tool === null) throw new Error(`${name} is not installed.`);
  return tool;
}
