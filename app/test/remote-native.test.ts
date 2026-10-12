import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { createRemoteFileService } from "../src/main/remote/service.ts";

it.each([false, true])(
  "keeps native Local usable and configured Home read-only (invalid config: %s)",
  async (invalid) => {
    const scratch = await mkdtemp(join(tmpdir(), "fm-remote-native-"));
    const token = randomBytes(32).toString("hex");
    const service = createRemoteFileService({ token, startPath: scratch });
    await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
    const address = service.address();
    if (!address || typeof address === "string") throw new Error("Missing service address");
    const config = join(scratch, "remote.json");
    await writeFile(join(scratch, "remote.txt"), "native remote preview\n");
    await writeFile(
      config,
      invalid ? "{" : JSON.stringify({ url: `http://127.0.0.1:${address.port}`, token }),
      {
        mode: 0o600,
      },
    );
    const appDirectory = fileURLToPath(new URL("..", import.meta.url));
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      SYMMETRIA_FM_SMOKE: "1",
      SYMMETRIA_FM_REMOTE_CONFIG: config,
      SYMMETRIA_FM_SOCKET: join(scratch, "daemon.sock"),
    };
    delete environment.ELECTRON_RUN_AS_NODE;
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          "xvfb-run",
          [
            "-a",
            "--",
            fileURLToPath(new URL("../../node_modules/electron/dist/electron", import.meta.url)),
            ".",
            "--no-sandbox",
            "--ozone-platform=x11",
          ],
          { cwd: appDirectory, env: environment, timeout: 45_000 },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += String(chunk);
        });
        child.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.on("error", reject);
        child.on("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
      });
      const line = output.split("\n").find((line) => line.startsWith("SMOKE_REPORT "));
      expect(line).toBeDefined();
      const report = JSON.parse(line?.slice("SMOKE_REPORT ".length) ?? "{}");
      if (invalid) {
        expect(report.machineProbe).toMatchObject({ reply: { ok: true } });
        expect(report.machineProbe).not.toHaveProperty("homeList");
        return;
      }
      expect(report.machineProbe).toMatchObject({
        homeList: { ok: true },
        denied: { ok: false },
        text: "native remote preview\n",
      });
      expect(report.machineProbe.label).toContain("Vigilia Home");
      expect(report.machineProbe.label).toContain("Read-only");
      expect(report.machineProbe.rows).toContain("remote.txt");
    } finally {
      service.closeAllConnections();
      await new Promise<void>((resolve) => service.close(() => resolve()));
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
