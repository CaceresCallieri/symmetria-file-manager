import type { OverviewModel } from "../overview/useOverview.ts";
import { FileTree } from "../tree/FileTree.tsx";
import type { useTreeMode } from "../tree/useTreeMode.ts";
import type { Tabs } from "../useTabs.ts";
import { MillerColumns, type MillerColumnsProps } from "./MillerColumns.tsx";
import { PathBar } from "./PathBar.tsx";
import { PreviewPane } from "./preview/PreviewPane.tsx";

export function BrowsingView({
  chrome,
  tabs,
  tree,
  model,
  onOpen,
  matches,
  preview,
  flashLabels,
  flashActive,
  onVisibleRange,
  onActivate,
  onLeaveTo,
}: {
  /** Atmosphere: see `AppProps.chrome`. */
  chrome?: "atmosphere" | undefined;
  tabs: Tabs;
  tree: ReturnType<typeof useTreeMode>;
  model: OverviewModel;
  onOpen(path: string): void;
  matches: ReadonlySet<number>;
  preview: Exclude<MillerColumnsProps["preview"], undefined>;
  flashLabels: NonNullable<MillerColumnsProps["flashLabels"]>;
  flashActive: boolean;
  onVisibleRange: NonNullable<MillerColumnsProps["onVisibleRange"]>;
  onActivate(index: number): void;
  onLeaveTo(name: string): void;
}) {
  if (tree.root !== null && tree.record !== null) {
    const fileTree = (
      <FileTree
        key={tree.key}
        root={tree.root}
        record={tree.record}
        model={model}
        port={tree.port}
        onOpen={onOpen}
        onMiller={tree.close}
      />
    );
    // Atmosphere: the standalone shows a preview beside the tree.
    // Composed here, never inside `FileTree`, so Mesura Code's tree pane stays
    // a bare tree (docs/design/atmosphere-design-system.md, "Host profiles").
    if (chrome !== "atmosphere") return fileTree;
    return (
      <div className="tree-split">
        {fileTree}
        {preview ? <PreviewPane {...preview} /> : <div className="list" />}
      </div>
    );
  }
  return (
    <>
      {chrome === "atmosphere" ? null : (
        <div className="view-control">
          <PathBar path={tabs.pane.path} onNavigate={tabs.navigate} />
        </div>
      )}
      <MillerColumns
        path={tabs.pane.path}
        parentEntries={tabs.parentEntries}
        entries={tabs.pane.entries}
        cursorIndex={tabs.pane.cursorIndex}
        parentCursorName={tabs.parentCursorName}
        selection={tabs.pane.selection}
        matches={matches}
        onSelect={tabs.moveTo}
        onActivate={onActivate}
        onLeaveTo={onLeaveTo}
        preview={preview}
        flashLabels={flashLabels}
        flashActive={flashActive}
        onVisibleRange={onVisibleRange}
      />
    </>
  );
}
