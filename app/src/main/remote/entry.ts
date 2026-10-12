import { createRemoteFileService } from "./service.ts";

const token = process.env.FM_REMOTE_TOKEN;
if (token === undefined) throw new Error("Set FM_REMOTE_TOKEN");
const port = Number(process.env.FM_REMOTE_PORT ?? 4787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid FM_REMOTE_PORT");
const server = createRemoteFileService({ token });
server.listen(port, process.env.FM_REMOTE_BIND ?? "127.0.0.1", () =>
  console.log(`Read-only file service listening on port ${port}`),
);
function stop() {
  server.close();
  server.closeAllConnections();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
