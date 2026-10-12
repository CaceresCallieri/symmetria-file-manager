import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

// Run from the repository root: node app/prototypes/remote-viewer/build.mjs
// Launch the built server with mesura-agent-service and Node.
// FM_VIEWER_TOKEN must contain 32 random bytes encoded as hex. The access URL is
// http://<tailnet-host>:4786/#<token>. The page exchanges the token for an HttpOnly cookie.
// Verify the running server: node --test app/prototypes/remote-viewer/probe.test.mjs
// Pass the same FM_VIEWER_TOKEN to the probe. The probe writes only dist/probe-* fixtures.

const root = fileURLToPath(new URL(".", import.meta.url));
await viteBuild({
  configFile: false,
  root,
  plugins: [react()],
  build: { outDir: "dist/ui", target: "chrome146" },
});
await esbuild({
  entryPoints: [`${root}/server.ts`],
  outfile: `${root}/dist/server.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["electron"],
});
