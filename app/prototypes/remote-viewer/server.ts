import { fileURLToPath } from "node:url";
import { createRemoteFileService } from "../../src/main/remote/service.ts";

const token = process.env.FM_VIEWER_TOKEN;
if (token === undefined) throw new Error("Set FM_VIEWER_TOKEN");
const server = createRemoteFileService({
  token,
  uiRoot: fileURLToPath(new URL("ui/", import.meta.url)),
  startPath: "/opt/dev/repos",
});
server.listen(4786, "0.0.0.0", () => console.log("Read-only file viewer listening on port 4786"));
process.once("SIGTERM", () => {
  server.close();
  server.closeAllConnections();
});
