import { expect, it } from "vitest";
import { matchKey } from "../src/keys/keyEvent.ts";
import { bindingsFor } from "../src/keys/registry.ts";

const plain = { ctrl: false, alt: false, meta: false, shift: false };
it("accepts generated symbols but rejects deliberate Ctrl and Meta combinations", () => {
  for (const key of ["/", "?", "+", "=", "-"]) {
    const binding = bindingsFor("overview").find((row) => row.keys.includes(key));
    if (!binding) throw new Error(`Missing overview key ${key}`);
    expect(matchKey(binding, { ...plain, key, shift: true })).toBe(true);
    expect(matchKey(binding, { ...plain, key, ctrl: true, alt: true, altGraph: true })).toBe(true);
    expect(matchKey(binding, { ...plain, key, ctrl: true })).toBe(false);
    expect(matchKey(binding, { ...plain, key, meta: true })).toBe(false);
  }
});
it("separates every direction from half and full camera commands", () => {
  for (const [key, direction] of [
    ["h", "left"],
    ["j", "down"],
    ["k", "up"],
    ["l", "right"],
    ["ArrowLeft", "left"],
    ["ArrowDown", "down"],
    ["ArrowUp", "up"],
    ["ArrowRight", "right"],
  ]) {
    if (!key) throw new Error("missing key");
    for (const [ctrl, shift, prefix] of [
      [false, false, ""],
      [true, false, "half-"],
      [true, true, "full-"],
    ] as const) {
      expect(
        bindingsFor("overview")
          .filter((binding) => matchKey(binding, { ...plain, key, ctrl, shift }))
          .map((binding) => binding.id),
      ).toEqual([`overview.${prefix}${direction}`]);
    }
  }
});

it("names Space and directional aliases in help", () => {
  const rows = bindingsFor("overview");
  expect(rows.find((row) => row.id === "overview.toggle")?.keycap).toBe("Space");
  expect(rows.find((row) => row.id === "overview.left")?.keycap).toBe("h / ←");
});
