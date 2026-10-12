import { expect, it } from "vitest";
import { dispatch, isSuppressedInPicker, matchBinding } from "../src/keys/dispatch.ts";
import { bindingsFor } from "../src/keys/registry.ts";
import { contextWith, press } from "./support/keys.ts";

it.each(["miller", "tree", "overview"] as const)(
  "routes m through the %s key registry only when the host supplies machines",
  (view) => {
    const recorded = contextWith({}, view);
    const context = { ...recorded, actions: { ...recorded.actions, openMachines: undefined } };
    expect(matchBinding(press("m"), context)).toBeNull();
    const choose = () => context.calls.push("machines");
    const connected = { ...context, actions: { ...context.actions, openMachines: choose } };
    expect(dispatch(press("m"), connected)).toBe(true);
    expect(context.calls).toEqual(["machines"]);
    expect(matchBinding(press("m", "Ctrl"), connected)).toBeNull();
  },
);
it("suppresses file operations and local-only tools on a read-only machine", () => {
  const context = contextWith({ readOnly: true });
  for (const key of ["a", "d", "r", "x", "p", "y", "f", "z", "c"])
    expect(dispatch(press(key), context)).toBe(false);
  expect(context.calls).toEqual([]);
  expect(dispatch(press("j"), context)).toBe(true);
  for (const binding of bindingsFor("miller").filter((binding) =>
    ["File", "Clipboard"].includes(binding.group),
  ))
    expect(isSuppressedInPicker(binding, context)).toBe(true);
});
