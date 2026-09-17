/**
 * @vitest-environment happy-dom
 *
 * Who holds focus when a dialog and its contents mount together.
 *
 * The reader's scroll surface focuses itself, and React runs a child's effects
 * BEFORE its parent's. The reader only escapes the collision today because the
 * file read is asynchronous, so the viewer arrives in a later commit than the
 * panel — a read cache would make the two commits one and the reader would open
 * with focus on the panel and keyboard scrolling silently dead. This drives the
 * hook directly because that is the only way to put both in one commit.
 */
import { cleanup, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, expect, it } from "vitest";

import { useDialogFocus } from "../../src/hooks/useDialogFocus.ts";

afterEach(cleanup);

/** A viewer that takes focus in its own effect, as `ScrollablePreview` does. */
function SelfFocusingChild() {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => surface.current?.focus(), []);
  return <div ref={surface} data-testid="surface" data-scrolls="true" tabIndex={-1} />;
}

function Panel({ withChild }: { readonly withChild: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel);
  return (
    <div ref={panel} data-testid="panel" tabIndex={-1}>
      {withChild ? <SelfFocusingChild /> : null}
    </div>
  );
}

it("guard: the panel leaves focus with a descendant that took it in the same commit", () => {
  const { getByTestId } = render(<Panel withChild={true} />);

  expect(document.activeElement).toBe(getByTestId("surface"));
});

it("spec: the panel takes focus when nothing inside it has", () => {
  const { getByTestId } = render(<Panel withChild={false} />);

  expect(document.activeElement).toBe(getByTestId("panel"));
});
