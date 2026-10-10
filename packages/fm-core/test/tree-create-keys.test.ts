import { expect, it } from "vitest";
import { bindingsFor, CORE } from "../src/keys/registry.ts";

it("tree-create AC4: exposes the existing create registry row in standalone tree mode", () => {
  const create = CORE.find((binding) => binding.id === "op.create");
  expect(create).toBeDefined();
  const tree = bindingsFor("tree");
  expect(tree.filter((binding) => binding.keys.includes("a") && binding.mods === "")).toEqual([
    create,
  ]);
  expect(tree).toContain(create);
  expect(create?.label).toBe("New file / folder");
});
