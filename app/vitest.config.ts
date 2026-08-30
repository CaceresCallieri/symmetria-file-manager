import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The smoke test launches the real application, and Electron cannot run
    // TypeScript, so the bundles must exist before the suite starts.
    globalSetup: ["test/build.setup.ts"],
    // The smoke test spawns a real Electron binary under a virtual display.
    // It is slow and it must never race a second copy of itself.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
