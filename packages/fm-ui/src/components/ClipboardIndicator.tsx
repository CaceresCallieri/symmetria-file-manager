import type { TransferMode } from "@symmetria/fm-core/contract";
import { joinPath } from "@symmetria/fm-core/pane";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { FileOps } from "../useFileOps.ts";

const ClipboardPaths = createContext<ReadonlyMap<string, TransferMode>>(new Map());

/** Derive row indicators from the same clipboard that paste consumes. */
export function ClipboardIndicators({
  clipboard,
  children,
}: {
  readonly clipboard: FileOps["clipboard"];
  readonly children: ReactNode;
}) {
  const paths = useMemo(
    () => new Map(clipboard?.paths.map((path) => [path, clipboard.mode])),
    [clipboard],
  );
  return <ClipboardPaths value={paths}>{children}</ClipboardPaths>;
}

export function ClipboardIndicator({
  directory,
  name,
}: {
  readonly directory: string | undefined;
  readonly name: string;
}) {
  const paths = useContext(ClipboardPaths);
  const mode = directory === undefined ? undefined : paths.get(joinPath(directory, name));
  if (mode === undefined) return null;
  return (
    <span
      className="row__clipboard"
      data-clipboard={mode}
      role="img"
      aria-label={mode === "copy" ? "Yanked" : "Cut"}
    />
  );
}
