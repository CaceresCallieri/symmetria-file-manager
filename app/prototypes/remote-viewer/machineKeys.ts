function plainMachineKey(event: KeyboardEvent): boolean {
  return ![
    event.ctrlKey,
    event.altKey,
    event.metaKey,
    event.shiftKey,
    event.repeat,
    event.isComposing,
  ].some(Boolean);
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function opensChooser(event: KeyboardEvent): boolean {
  if ([event.defaultPrevented, !plainMachineKey(event), typingInto(event.target)].some(Boolean))
    return false;
  return (
    ["m", "F6"].includes(event.key) &&
    document.querySelector('[role="dialog"]:not(.overview)') === null
  );
}

export function listenForMachineKey(open: () => void): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (!opensChooser(event)) return;
    event.preventDefault();
    open();
  };
  // WORKAROUND: this study installs its listener after the panel's key dispatcher.
  // defaultPrevented preserves the panel's chord, flash and modal precedence.
  // The sample-data harness does not pass onChooseMachine to App. Remove this
  // listener if it adopts that production host callback.
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
