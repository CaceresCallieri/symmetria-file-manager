import {
  ARCHIVE_FORMATS,
  type ArchiveFormat,
  type LaunchKind,
} from "@symmetria/fm-core/fileActions";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "../components/modals/OpsModals.tsx";
import {
  type DesktopDialog,
  initialDestination,
  type useDesktopActions,
} from "./useDesktopActions.ts";

const titles = {
  "open-with": "Open With",
  run: "Run Program",
  "run-terminal": "Run in Terminal",
  "run-with": "Run Windows Program",
  terminal: "Open Terminal Here",
  "extract-here": "Extract Here",
  "extract-to": "Extract To",
  compress: "Compress",
  properties: "Properties",
};
export function DesktopActionDialog({
  desktop,
}: {
  readonly desktop: ReturnType<typeof useDesktopActions>;
}) {
  return desktop.dialog ? (
    <ActionDialog key={desktop.dialog.id} desktop={desktop} dialog={desktop.dialog} />
  ) : null;
}
function useActionOptions(dialog: DesktopDialog) {
  const [choice, setChoice] = useState(dialog.inspection.applications[0]?.id ?? "");
  const initialRunner = defaultRunner(dialog);
  const [runner, setRunner] = useState<LaunchKind>(initialRunner);
  const [bottle, setBottle] = useState(dialog.inspection.bottles[0] ?? "");
  const [prefix, setPrefix] = useState("");
  const [destination, setDestination] = useState(initialDestination(dialog));
  const [format, setFormat] = useState<ArchiveFormat>("zip");
  const [makeExecutable, setMakeExecutable] = useState(false);
  const [filter, setFilter] = useState("");
  const options = {
    choice: runner === "bottles" && dialog.action === "run-with" ? bottle : choice,
    runner,
    prefix,
    destination: dialog.action === "extract-here" ? "" : destination,
    format,
    makeExecutable,
  };
  return {
    choice,
    setChoice,
    runner,
    setRunner,
    bottle,
    setBottle,
    prefix,
    setPrefix,
    destination,
    setDestination,
    format,
    setFormat,
    makeExecutable,
    setMakeExecutable,
    filter,
    setFilter,
    options,
  };
}
type ActionForm = ReturnType<typeof useActionOptions>;
interface FieldsProps {
  readonly dialog: DesktopDialog;
  readonly form: ActionForm;
}
function ActionDialog({
  desktop,
  dialog,
}: {
  readonly desktop: ReturnType<typeof useDesktopActions>;
  readonly dialog: DesktopDialog;
}) {
  const form = useActionOptions(dialog);
  const focus = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focus.current?.querySelector<HTMLElement>("input, select, [tabindex]")?.focus();
  }, []);
  const title =
    Object.entries(titles).find(([action]) => action === dialog.action)?.[1] ?? "File Action";
  const readonly = dialog.action === "properties" || dialog.message !== null;
  const confirm = () => {
    if (readonly) desktop.close();
    else void desktop.confirm(form.options);
  };
  return (
    <Dialog
      title={title}
      testId="desktop-action-dialog"
      confirmLabel={readonly ? "Close" : dialog.busy ? "Working…" : "Confirm"}
      confirmDisabled={dialog.busy || (!readonly && unavailable(dialog, form))}
      busy={dialog.busy}
      onCancel={desktop.close}
      onConfirm={confirm}
    >
      <div className="desktop-action-fields" ref={focus}>
        <p className="dialog__hint">{dialog.target.paths.join("\n")}</p>
        <ActionFields dialog={dialog} form={form} />
        <ActionStatus dialog={dialog} />
      </div>
    </Dialog>
  );
}
function ActionStatus({ dialog }: { readonly dialog: DesktopDialog }) {
  return (
    <>
      {dialog.busy ? <p role="status">Working… Cancel stops archive work.</p> : null}
      {dialog.error ? <p role="alert">{dialog.error}</p> : null}
      {dialog.message ? <p role="status">{dialog.message}</p> : null}
    </>
  );
}
function ActionFields(props: FieldsProps) {
  switch (props.dialog.action) {
    case "properties":
      return <Properties dialog={props.dialog} />;
    case "open-with":
      return <ApplicationFields {...props} />;
    case "run":
    case "run-terminal":
      return <RunFields {...props} />;
    case "run-with":
      return <WineFields {...props} />;
    case "extract-here":
    case "extract-to":
    case "compress":
      return <ArchiveFields {...props} />;
    default:
      return null;
  }
}
function ApplicationFields({ dialog, form }: FieldsProps) {
  return (
    <>
      <label>
        Filter applications
        <input
          value={form.filter}
          disabled={dialog.busy}
          onChange={(event) => form.setFilter(event.target.value)}
        />
      </label>
      <label>
        Application
        <select
          value={form.choice}
          disabled={dialog.busy}
          onChange={(event) => form.setChoice(event.target.value)}
        >
          {dialog.inspection.applications
            .filter(
              (app) =>
                app.name.toLowerCase().includes(form.filter.toLowerCase()) ||
                app.id === form.choice,
            )
            .map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
                {app.recommended ? " · recommended" : ""}
              </option>
            ))}
        </select>
      </label>
      <p className="dialog__hint">Open this file once. The default application stays the same.</p>
    </>
  );
}
function RunFields({ dialog, form }: FieldsProps) {
  return (
    <>
      <p className="dialog__hint">
        Run this file as a program in its own directory. Only run programs you trust.
      </p>
      {!dialog.inspection.entries[0]?.executable ? (
        <label>
          <input
            type="checkbox"
            checked={form.makeExecutable}
            disabled={dialog.busy}
            onChange={(event) => form.setMakeExecutable(event.target.checked)}
          />
          Allow executable permission and run
        </label>
      ) : null}
    </>
  );
}
function WineFields({ dialog, form }: FieldsProps) {
  const tools = dialog.inspection.tools;
  return (
    <>
      <label>
        Runner
        <select
          value={form.runner}
          disabled={dialog.busy}
          onChange={(event) => form.setRunner(runnerChoice(event.target.value))}
        >
          <option value="wine" disabled={!tools.wine}>
            Wine · direct
          </option>
          <option
            value="bottles"
            disabled={!tools.bottles || dialog.inspection.bottles.length === 0}
          >
            Bottles · selected bottle
          </option>
          <option value="lutris" disabled={!tools.lutris}>
            Lutris · system Wine
          </option>
        </select>
      </label>
      {form.runner === "bottles" ? (
        <label>
          Bottle
          <select
            value={form.bottle}
            disabled={dialog.busy}
            onChange={(event) => form.setBottle(event.target.value)}
          >
            {dialog.inspection.bottles.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      ) : (
        <label>
          Wine prefix (optional)
          <input
            placeholder="Default Wine prefix"
            value={form.prefix}
            disabled={dialog.busy}
            onChange={(event) => form.setPrefix(event.target.value)}
          />
        </label>
      )}
      <p className="dialog__hint">{wineExplanation(form.runner)}</p>
    </>
  );
}
function wineExplanation(runner: LaunchKind): string {
  if (runner === "bottles")
    return "Bottles uses the selected bottle's Wine version and settings. Flatpak receives access to this program's folder for this launch.";
  if (runner === "lutris")
    return "Lutris launches system Wine with this prefix. Saved game profiles remain in Lutris.";
  return "Wine launches directly. Leave the prefix empty to use Wine's default environment.";
}
function ArchiveFields({ dialog, form }: FieldsProps) {
  const compressing = dialog.action === "compress";
  const changeFormat = (value: string) => {
    const next = ARCHIVE_FORMATS.find((format) => format === value);
    if (!next) return;
    form.setFormat(next);
    form.setDestination((path) => path.replace(/\.(zip|tar(\.(gz|xz|zst))?)$/, `.${next}`));
  };
  return (
    <>
      {dialog.action !== "extract-here" ? (
        <label>
          {compressing ? "Archive path" : "Destination parent folder"}
          <input
            value={form.destination}
            disabled={dialog.busy}
            onChange={(event) => form.setDestination(event.target.value)}
          />
        </label>
      ) : null}
      {compressing ? (
        <label>
          Format
          <select
            value={form.format}
            disabled={dialog.busy}
            onChange={(event) => changeFormat(event.target.value)}
          >
            {ARCHIVE_FORMATS.map((format) => (
              <option key={format}>{format}</option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="dialog__hint">
        {compressing
          ? "Create a new archive. Existing destinations are preserved."
          : "Create a new folder named after each archive. Existing folders are preserved."}{" "}
        Archive limit: 1 GiB, 20,000 entries, 2 minutes. Cancel stops the current job. Completed
        outputs remain.
      </p>
    </>
  );
}
function runnerChoice(value: string): LaunchKind {
  return value === "bottles" ? "bottles" : value === "lutris" ? "lutris" : "wine";
}
function unavailable(dialog: DesktopDialog, form: ActionForm): boolean {
  if (dialog.action === "open-with") return form.choice === "";
  if (dialog.action === "run-with") return form.runner === "bottles" && form.bottle === "";
  return (
    ["run", "run-terminal"].includes(dialog.action) &&
    !dialog.inspection.entries[0]?.executable &&
    !form.makeExecutable
  );
}
function Properties({ dialog }: { readonly dialog: DesktopDialog }) {
  return (
    <div className="desktop-properties" data-scrolls="true">
      {dialog.inspection.entries.map((entry) => (
        <dl key={entry.path}>
          <dt>Path</dt>
          <dd>{entry.path}</dd>
          <dt>Type</dt>
          <dd>{entry.kind}</dd>
          <dt>Size</dt>
          <dd>
            {entry.size.toLocaleString()} bytes
            {entry.kind === "directory" ? " (directory entry, excludes contents)" : ""}
          </dd>
          <dt>Modified</dt>
          <dd>{new Date(entry.modified).toLocaleString()}</dd>
          <dt>Permissions</dt>
          <dd>{entry.mode.toString(8).padStart(4, "0")}</dd>
          {entry.link ? (
            <>
              <dt>Link target</dt>
              <dd>{entry.link}</dd>
            </>
          ) : null}
        </dl>
      ))}
    </div>
  );
}

function defaultRunner(dialog: DesktopDialog): LaunchKind {
  if (dialog.inspection.tools.wine) return "wine";
  return dialog.inspection.tools.bottles ? "bottles" : "lutris";
}
