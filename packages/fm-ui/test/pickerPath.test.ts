import { describe, expect, it } from "vitest";
import { pickerPath } from "../src/pickerPath.ts";

describe("local picker paths", () => {
  it.each([
    ["/tmp/report final.pdf", "/tmp/report final.pdf"],
    ["~/report.pdf", "/home/jc/report.pdf"],
    ["~", "/home/jc"],
    ["notes.txt", "/tmp/notes.txt"],
    ["./notes.txt", "/tmp/notes.txt"],
    [".", "/tmp"],
    ["/tmp/./folder/./file.txt", "/tmp/folder/file.txt"],
    ["Report: final.pdf", "/tmp/Report: final.pdf"],
    ["notes:v2.txt", "/tmp/notes:v2.txt"],
    ["/", "/"],
    ["///", "/"],
    ["/tmp/folder/", "/tmp/folder"],
    ["/tmp//folder///file.txt", "/tmp/folder/file.txt"],
    ["file:///tmp/c++%20report.pdf", "/tmp/c++ report.pdf"],
    ["file://localhost/tmp/report.pdf", "/tmp/report.pdf"],
    ["/tmp/100%25.txt", "/tmp/100%25.txt"],
    ["/tmp/symlink/../file.txt", "/tmp/symlink/../file.txt"],
  ])("resolves %s as %s", (input, expected) => {
    expect(pickerPath(input, "/tmp", "/home/jc")).toBe(expected);
  });

  it.each([
    "",
    " ",
    "/tmp/a\n/tmp/b",
    "/tmp/a\0b",
    "file:///tmp/a%00b",
    "file:///tmp/a%0Ab",
    "file://server/tmp/a",
    "https://example.com/a",
    "file:///tmp/a?query=1",
    "file:///tmp/a#fragment",
    "file:///tmp/%ZZ",
  ])("rejects an invalid or remote path: %s", (input) => {
    expect(() => pickerPath(input, "/tmp", "/home/jc")).toThrow();
  });
});
