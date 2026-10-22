import type { DiskUsageReply } from "@symmetria/fm-core/contract";
import { humanSize } from "@symmetria/fm-core/format";
import type { MachineId, MachineInfo } from "@symmetria/fm-core/machines";
import { Check, ChevronRight, Laptop } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import "./machines.css";

export type MachineStorage = Readonly<Partial<Record<MachineId, DiskUsageReply>>>;
interface Controls {
  readonly machines: readonly MachineInfo[];
  readonly current: MachineId;
  readonly storage: MachineStorage;
  readonly choose: (machine: MachineId) => void;
}
const KEYCAPS = { local: "l", home: "h" };
function MachineIcon({
  machine,
  size = 18,
}: {
  readonly machine: MachineId;
  readonly size?: number;
}) {
  if (machine === "local") return <Laptop size={size} aria-hidden="true" />;
  // Use the MacMiniIcon geometry from Mesura Code's EnvironmentMachineIcon.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect width="20" height="8" x="2" y="8" rx="2" />
      <path d="M6 12h.01" />
    </svg>
  );
}
function storageText(usage: DiskUsageReply | undefined): string {
  return usage
    ? `${humanSize(usage.free)} free of ${humanSize(usage.total)}`
    : "Storage unavailable";
}
function status(machine: MachineInfo): string {
  if (machine.error !== null) return "Offline · reconnecting";
  return machine.readOnly ? "Read-only" : "This laptop";
}
export function MachineDock({ machines, current, storage, choose }: Controls) {
  return (
    <div className="machine-dock" data-testid="machine-dock">
      {machines.map((machine) => (
        <button
          type="button"
          key={machine.id}
          className="machine-dock-button"
          aria-label={`Browse ${machine.name}`}
          aria-pressed={machine.id === current}
          onClick={(event) => {
            // Return keys to the document keymap after activation. Retaining
            // dock focus makes Enter select a machine instead of opening a file.
            event.currentTarget.blur();
            choose(machine.id);
          }}
        >
          <MachineIcon machine={machine.id} />
          <StorageBar usage={storage[machine.id]} />
          <span className="machine-dot" />
          <span className="machine-tooltip">
            <strong>{machine.name}</strong>
            <span>{status(machine)}</span>
            <small>{storageText(storage[machine.id])}</small>
            <kbd>m{KEYCAPS[machine.id]} · Browse</kbd>
          </span>
        </button>
      ))}
    </div>
  );
}
function StorageBar({ usage }: { readonly usage: DiskUsageReply | undefined }) {
  if (!usage || usage.total <= 0) return <span className="machine-storage-bar" />;
  return (
    <meter
      className="machine-storage-bar"
      aria-label="Storage used"
      min={0}
      max={1}
      value={(usage.total - usage.free) / usage.total}
    />
  );
}
function moveFocus(panel: HTMLDivElement | null, step: number): void {
  if (!panel) return;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("[data-machine]")];
  const index = buttons.findIndex((button) => button === document.activeElement);
  buttons[(index + step + buttons.length) % buttons.length]?.focus();
}
export function MachineChooser({
  machines,
  current,
  storage,
  choose,
  close,
}: Controls & { readonly close: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const origin = document.activeElement;
    panel.current?.querySelector<HTMLButtonElement>(`[data-machine=${current}]`)?.focus();
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    };
  }, [current]);
  const onKey = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || event.repeat) {
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveFocus(panel.current, event.shiftKey ? -1 : 1);
      return;
    }
    if ([event.ctrlKey, event.altKey, event.metaKey, event.shiftKey].some(Boolean)) return;
    const command = new Map([
      ["j", () => moveFocus(panel.current, 1)],
      ["ArrowDown", () => moveFocus(panel.current, 1)],
      ["k", () => moveFocus(panel.current, -1)],
      ["ArrowUp", () => moveFocus(panel.current, -1)],
      ["m", () => choose(current === "local" ? "home" : "local")],
      ["l", () => choose("local")],
      ["h", () => choose("home")],
    ]).get(event.key);
    if (command) {
      event.preventDefault();
      command();
    }
  };
  return (
    <div className="machine-scrim">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a machine"
        className="machine-chooser"
        onKeyDown={onKey}
      >
        <div className="machine-chooser-heading">
          <span>Choose a machine</span>
          <button type="button" onClick={close} aria-label="Close machine chooser">
            <kbd>esc</kbd>
          </button>
        </div>
        {machines.map((machine) => (
          <button
            key={machine.id}
            type="button"
            data-machine={machine.id}
            className="machine-option"
            onClick={() => choose(machine.id)}
            title={machine.error ?? undefined}
          >
            <span className="machine-option-icon">
              <MachineIcon machine={machine.id} size={24} />
            </span>
            <span className="machine-option-copy">
              <strong>
                {machine.name}
                <kbd className="machine-direct-key">{KEYCAPS[machine.id]}</kbd>
              </strong>
              <span>{status(machine)}</span>
              <small>{storageText(storage[machine.id])}</small>
            </span>
            {machine.id === current ? (
              <Check className="machine-check" size={20} aria-label="Current machine" />
            ) : (
              <ChevronRight size={20} />
            )}
          </button>
        ))}
        <div className="machine-chooser-foot">
          <span>
            <kbd>j</kbd>
            <kbd>k</kbd> choose <kbd>↵</kbd> open <kbd>m</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  );
}
