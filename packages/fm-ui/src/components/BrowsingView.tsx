import type { OverviewModel } from "../overview/useOverview.ts";
import { FileTree } from "../tree/FileTree.tsx";
import type { useTreeMode } from "../tree/useTreeMode.ts";
import type { Tabs } from "../useTabs.ts";
import { MillerColumns, type MillerColumnsProps } from "./MillerColumns.tsx";
import { PathBar } from "./PathBar.tsx";

export function BrowsingView({
  tabs,
  tree,
  model,
  onOpen,
  toggleView,
  pickerActive,
  matches,
  preview,
  onActivate,
  onLeaveTo,
}: {
  tabs: Tabs;
  tree: ReturnType<typeof useTreeMode>;
  model: OverviewModel;
  onOpen(path: string): void;
  toggleView(): void;
  pickerActive: boolean;
  matches: ReadonlySet<number>;
  preview: NonNullable<MillerColumnsProps["preview"]>;
  onActivate(index: number): void;
  onLeaveTo(name: string): void;
}) {
  if (tree.root !== null && tree.record !== null)
    return (
      <FileTree
        key={tree.key}
        root={tree.root}
        record={tree.record}
        model={model}
        port={tree.port}
        onOpen={onOpen}
        onMiller={toggleView}
      />
    );
  return (
    <>
      <div className="view-control">
        <PathBar path={tabs.pane.path} onNavigate={tabs.navigate} />
        {!pickerActive ? (
          <button type="button" aria-label="Show file tree" onClick={toggleView}>
            Tree · Ctrl+E
          </button>
        ) : null}
      </div>
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
      />
    </>
  );
}
