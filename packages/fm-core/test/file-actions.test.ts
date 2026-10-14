import { describe, expect, it } from "vitest";
import {
  archiveStem,
  decodeActionInspection,
  decodeActionPaths,
  decodeActionRequest,
} from "../src/fileActions.ts";

describe("file action contract", () => {
  const request = {
    id: "run-1",
    paths: ["/tmp/file"],
    action: "run",
    choice: "",
    destination: "",
    prefix: "",
    format: "zip",
    makeExecutable: false,
  };
  it("refuses malformed requests before reaching a launch backend", () => {
    expect(decodeActionRequest(request).ok).toBe(true);
    for (const malformed of [
      { ...request, paths: ["relative"] },
      { ...request, paths: ["/a", "/b"] },
      { ...request, id: "../other" },
      { ...request, prefix: "relative" },
      { ...request, action: "arbitrary" },
      { ...request, makeExecutable: "true" },
      { ...request, choice: "a\0b" },
      { ...request, format: "shell" },
    ])
      expect(decodeActionRequest(malformed).ok).toBe(false);
    expect(decodeActionPaths({ paths: Array.from({ length: 1001 }, () => "/a") }).ok).toBe(false);
  });
  it("requires well-formed privileged capability replies", () => {
    const reply = {
      entries: [
        {
          path: "/tmp/file",
          kind: "file",
          size: 1,
          modified: 0,
          mode: 0o644,
          executable: false,
          runnable: true,
          link: null,
        },
      ],
      applications: [{ id: "editor.desktop", name: "Editor", recommended: true }],
      bottles: ["Gaming"],
      tools: {
        gio: true,
        terminal: false,
        wine: false,
        bottles: true,
        lutris: false,
        archives: true,
      },
      applicationError: null,
      bottleError: null,
    };
    expect(decodeActionInspection(reply).ok).toBe(true);
    for (const malformed of [
      { ...reply, tools: { ...reply.tools, wine: "installed" } },
      { ...reply, entries: [{ ...reply.entries[0], size: Number.NaN }] },
      { ...reply, bottles: [42] },
      { ...reply, applicationError: {} },
    ])
      expect(decodeActionInspection(malformed).ok).toBe(false);
  });
  it("uses complete compound extensions when naming extracted folders", () => {
    expect(archiveStem("/tmp/release.tar.gz")).toBe("release");
    expect(archiveStem("/tmp/release.tar.zst")).toBe("release");
    expect(archiveStem("/tmp/.zip")).toBe("archive");
  });
});
