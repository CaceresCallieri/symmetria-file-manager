import { expect, it } from "vitest";
import { dispatch, matchBinding } from "../src/keys/dispatch.ts";
import { contextWith, press } from "./support/keys.ts";

it.each(["miller", "tree"] as const)(
  "routes the action menu through the %s registry with a symbol glyph",
  (view) => {
    const context = contextWith({}, view);
    const connected = {
      ...context,
      actions: { ...context.actions, openActions: () => context.calls.push("menu") },
    };
    expect(dispatch(press(";", "Shift"), connected)).toBe(true);
    expect(context.calls).toEqual(["menu"]);
    expect(matchBinding(press(";", "Ctrl"), connected)).toBeNull();
    expect(
      matchBinding(press(";"), {
        ...context,
        actions: { ...context.actions, openActions: undefined },
      }),
    ).toBeNull();
    expect(
      matchBinding(press(";"), { ...connected, state: { ...connected.state, readOnly: true } }),
    ).toBeNull();
    expect(
      matchBinding(press(";"), {
        ...connected,
        state: { ...connected.state, picker: { ...connected.state.picker, active: true } },
      }),
    ).toBeNull();
  },
);
