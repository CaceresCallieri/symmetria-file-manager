import { isFailure } from "@symmetria/fm-core/contract";
import { type FrecentDirectory, filterFrecent } from "@symmetria/fm-core/zoxide";
import { useEffect, useMemo, useRef, useState } from "react";

import { frecentDirectories } from "../bridge.ts";

/** A stable id per row, so the field can name the one that is current. */
function rowId(index: number): string {
  return `zoxide-row-${index}`;
}

export interface ZoxidePopupProps {
  readonly onChoose: (path: string) => void;
  readonly onClose: () => void;
}

/**
 * The directories zoxide already knows you go to.
 *
 * **The list is fetched once, on open, and narrowed here.** Asking zoxide costs
 * a subprocess, so a query per keystroke would spawn a process per character.
 *
 * A modal handles its own keys, which is what makes the cascade's "a modal
 * handles it" true rather than a claim. Escape closes, the arrows move, Enter
 * goes. Nothing here reaches the pane's keymap, and the pane's keymap does not
 * reach in.
 */
export function ZoxidePopup({ onChoose, onClose }: ZoxidePopupProps) {
  const [entries, setEntries] = useState<readonly FrecentDirectory[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let current = true;
    void frecentDirectories().then((reply) => {
      if (!current) return;
      // An empty list and a missing binary look identical on screen, and only
      // one of them is something the user can fix.
      if (isFailure(reply)) setProblem(reply.error.message);
      else setEntries(reply.value.entries);
    });

    return () => {
      current = false;
    };
  }, []);

  // The field takes the keyboard, so what the user types goes into it rather
  // than into the pane behind. The cascade also reports a text input as
  // focused, which is the other half of the same guarantee.
  useEffect(() => {
    field.current?.focus();
  }, []);

  // Escape, at the window, as a backstop — the same listener the help sheet
  // has and for the same reason.
  //
  // The handler below is a prop on the input, so it fires only while the input
  // has focus. Review found that Tab moved focus off it and the popup then
  // became UNCLOSABLE by keyboard: no handler fired, and the cascade's modal
  // step only calls `preventDefault`, so every key was swallowed by a dialog
  // nothing could dismiss. Tab is trapped below as well; this is the half that
  // does not depend on having thought of every key.
  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, [onClose]);

  const shown = useMemo(() => filterFrecent(entries, query), [entries, query]);

  // Clamp rather than reset: narrowing the list under a highlight that was near
  // the bottom must leave it on something real, and putting it back to the top
  // on every keystroke would fight the user's arrow keys.
  const highlighted = Math.min(active, Math.max(shown.length - 1, 0));

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Every key belongs to the popup while it is up. Letting one through would
    // move the cursor in the pane the user cannot see behind it.
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    // There is one focusable element in this popup, so a Tab has nowhere
    // useful to go and moving focus off the field takes the keyboard with it.
    if (event.key === "Tab") {
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(highlighted + 1, Math.max(shown.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(highlighted - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = shown[highlighted];
      if (chosen !== undefined) onChoose(chosen.path);
    }
  };

  return (
    // The same scrim and panel the help sheet uses. A second way to centre a
    // dialog is a second thing to keep in step with the tokens.
    <div className="overlay">
      <div data-testid="zoxide" className="overlay__panel zoxide">
        {/* The input holds focus and names the current row, which is the
            shape a listbox takes when the keyboard belongs to a text field.
            No conflict here with the pane's document-level keymap: this popup
            owns every key while it is up. */}
        <input
          data-testid="zoxide-query"
          ref={field}
          className="zoxide__query"
          value={query}
          placeholder="jump to…"
          role="combobox"
          aria-expanded={true}
          aria-controls="zoxide-list"
          aria-activedescendant={shown[highlighted] === undefined ? undefined : rowId(highlighted)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {problem === null ? null : <p className="zoxide__problem">{problem}</p>}
        {/* Plain elements carrying the roles, rather than a `ul` and `li`
            given them. A list element with an interactive role is a list to
            the parser and a listbox to the reader, and the two disagree; a
            `div` claims nothing it then has to override.

            `tabIndex={-1}` on the box and none on the rows is the shape this
            pattern takes: focus stays in the field, which names the current
            row with `aria-activedescendant`, so no row is ever a tab stop.

            That is why each row suppresses `useFocusableInteractive`. The rule
            wants every option to be focusable, which is the opposite of what
            this pattern requires — a tabIndex per row would put all of them in
            the tab order and break the very thing the roles declare. The
            suppression is one line directly above the element on purpose:
            biome attaches it to whatever follows, and a continuation comment
            in between silently detaches it. */}
        <div
          id="zoxide-list"
          className="zoxide__list"
          role="listbox"
          aria-label="Frecent directories"
          tabIndex={-1}
        >
          {shown.map((entry, index) => (
            // biome-ignore lint/a11y/useFocusableInteractive: see the note above
            <div
              key={entry.path}
              id={rowId(index)}
              data-testid="zoxide-row"
              role="option"
              aria-selected={index === highlighted}
              data-active={index === highlighted ? "true" : undefined}
              className={`zoxide__row${index === highlighted ? " zoxide__row--active" : ""}`}
            >
              <span className="zoxide__score">{Math.round(entry.score)}</span>
              <span className="zoxide__path">{entry.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
