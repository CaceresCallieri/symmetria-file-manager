import { CHORD_GROUPS, copyGroupFor } from "@symmetria/fm-core/keys/chords";
import { isSuppressedInPicker } from "@symmetria/fm-core/keys/dispatch";
import { bindingsFor, HELP_GROUPS, MODES } from "@symmetria/fm-core/keys/registry";
import type { KeyContext } from "@symmetria/fm-core/keys/types";
import { useEffect } from "react";

export interface HelpOverlayProps {
  readonly context: KeyContext;
  readonly onClose: () => void;
}

/**
 * The cheat sheet, rendered from the registry.
 *
 * It reads the same table the dispatcher does, which is the property the
 * registry exists for: a binding added in one place both works and appears
 * here. Nothing in this file lists a key.
 *
 * "Chords" is skipped as a binding group and drawn from the chord table
 * instead, because a bare prefix row would tell the reader that `g` does
 * something rather than that `g` opens a menu.
 */
export function HelpOverlay({ context, onClose }: HelpOverlayProps) {
  // A modal handles its own Escape. The cascade reports `modal` and does
  // nothing, which is what makes "the modal handles it" true rather than a
  // claim — if this listener were missing, the help would be uncloseable by
  // keyboard in a keyboard-first application.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const bindings = bindingsFor(context.view);
  const cursorIsImage = context.state.cursorEntry?.isImage === true;

  return (
    <div className="overlay" data-testid="help-overlay">
      <div className="overlay__panel">
        <header className="overlay__head">
          <h2>Keyboard</h2>
          <button type="button" onClick={onClose}>
            close
          </button>
        </header>

        {HELP_GROUPS.filter((group) => group !== "Chords").map((group) => {
          const rows = bindings.filter(
            (binding) =>
              binding.group === group &&
              // Never advertise a key the picker has taken away.
              !isSuppressedInPicker(binding, context),
          );
          if (rows.length === 0) return null;

          return (
            <section key={group} data-testid={`help-group-${group}`}>
              <h3>{group}</h3>
              {rows.map((binding) => (
                <div key={binding.id} className="help-row" data-testid="help-row">
                  <kbd>{binding.keycap}</kbd>
                  <span>{binding.label}</span>
                </div>
              ))}
            </section>
          );
        })}

        <section data-testid="help-group-Chords">
          <h3>Chords</h3>
          {[...CHORD_GROUPS].map(([prefix, group]) => {
            const shown = prefix === "c" ? copyGroupFor(cursorIsImage) : group;
            return (
              <div key={prefix} data-testid={`chord-group-${prefix}`}>
                <h4>
                  <kbd>{prefix}</kbd> {shown.label}
                </h4>
                {shown.binds.map((entry) => (
                  <div key={entry.key} className="help-row" data-testid="help-row">
                    <kbd>
                      {prefix}
                      {entry.key}
                    </kbd>
                    <span>{entry.label}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </section>

        <section data-testid="help-group-Modes">
          <h3>Modes</h3>
          {MODES.map((mode) => (
            <div key={mode.keycap} className="help-row" data-testid="help-row">
              <kbd>{mode.keycap}</kbd>
              <span>{mode.label}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
