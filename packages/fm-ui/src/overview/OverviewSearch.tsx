import { joinPath } from "@symmetria/fm-core/pane";
import { useEffect, useRef, useState } from "react";
import type { useOverview } from "./useOverview.ts";
export function OverviewSearch({
  model,
  onChoose,
  onClose,
}: {
  readonly model: ReturnType<typeof useOverview>;
  readonly onChoose: (path: string) => void;
  readonly onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const position = useRef(-1);
  useEffect(() => input.current?.focus(), []);
  const paths = [
    ...new Set(
      [...model.folders.values()].flatMap((folder) => [
        folder.path,
        ...folder.entries.map((entry) => joinPath(folder.path, entry.name)),
      ]),
    ),
  ]
    .filter((path) => path.toLowerCase().includes(query.toLowerCase()))
    .sort();
  return (
    <div className="overview-search">
      <input
        ref={input}
        aria-label="Search loaded paths"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          position.current = -1;
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Enter" && paths.length) {
            event.preventDefault();
            position.current =
              ((position.current < 0 && event.shiftKey ? 0 : position.current) +
                (event.shiftKey ? -1 : 1) +
                paths.length) %
              paths.length;
            const path = paths[position.current];
            if (path) onChoose(path);
          }
        }}
      />
      <span>{paths.length} matches in loaded paths</span>
      <button type="button" onClick={onClose}>
        Close search
      </button>
    </div>
  );
}
