import { describe, expect, it } from "vitest";

import {
  decodeDiskUsageReply,
  decodeDiskUsageRequest,
  decodePlacesReply,
  isFailure,
} from "../src/contract.ts";

/** The rail's disk meter divides by `total` and draws `free / total` as a width. */
describe("the disk usage contract", () => {
  it("accepts a total and a free count in order", () => {
    expect(decodeDiskUsageReply({ total: 1000, free: 250 })).toEqual({
      ok: true,
      value: { total: 1000, free: 250 },
    });
  });

  it("refuses a zero total, which the meter would divide by", () => {
    expect(isFailure(decodeDiskUsageReply({ total: 0, free: 0 }))).toBe(true);
  });

  it("refuses more free space than the disk holds", () => {
    expect(isFailure(decodeDiskUsageReply({ total: 100, free: 101 }))).toBe(true);
  });

  it("refuses a NaN, which passes a bare typeof test", () => {
    expect(isFailure(decodeDiskUsageReply({ total: 100, free: Number.NaN }))).toBe(true);
  });

  it("asks about an absolute path only", () => {
    expect(isFailure(decodeDiskUsageRequest({ path: "relative" }))).toBe(true);
    expect(decodeDiskUsageRequest({ path: "/home" })).toEqual({
      ok: true,
      value: { path: "/home" },
    });
  });
});

describe("the places contract", () => {
  it("keeps well-formed rows and drops the rest", () => {
    expect(
      decodePlacesReply({
        places: [
          { kind: "download", path: "/home/jc/Descargas" },
          { kind: "templates", path: "/home/jc/T" },
          { kind: "music", path: "relative" },
          "not a row",
        ],
      }),
    ).toEqual({ ok: true, value: { places: [{ kind: "download", path: "/home/jc/Descargas" }] } });
  });

  it("refuses a reply with no list", () => {
    expect(isFailure(decodePlacesReply({}))).toBe(true);
  });
});
