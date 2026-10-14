import { useLayoutEffect, useRef } from "react";
import { DesktopActionDialog } from "./DesktopActionDialog.tsx";
import { targetLabel } from "./model.ts";
import type { useActionMenu } from "./useActionMenu.ts";

export function ActionMenu({ menu }: { readonly menu: ReturnType<typeof useActionMenu> }) {
  const element = useRef<HTMLDivElement>(null);
  const { snapshot, index } = menu;
  useLayoutEffect(() => {
    if (!snapshot || !element.current) return;
    const bounds = element.current.getBoundingClientRect();
    element.current.style.left = `${Math.max(8, Math.min(snapshot.x, window.innerWidth - bounds.width - 8))}px`;
    element.current.style.top = `${Math.max(8, Math.min(snapshot.y, window.innerHeight - bounds.height - 8))}px`;
    element.current.querySelectorAll<HTMLButtonElement>("button")[index]?.focus();
  }, [snapshot, index]);
  if (!snapshot) return <DesktopActionDialog desktop={menu.desktop} />;
  return (
    <div className="file-actions" ref={element} role="menu" aria-label="File actions">
      <div className="file-actions__target">{targetLabel(snapshot.target)}</div>
      {snapshot.actions.map((item, position, actions) => (
        <div key={item.id}>
          {position > 0 && actions[position - 1]?.group !== item.group ? (
            <hr className="file-actions__separator" />
          ) : null}
          <button
            type="button"
            role="menuitem"
            aria-disabled={item.unavailable !== null}
            title={item.unavailable ?? undefined}
            tabIndex={position === index ? 0 : -1}
            onPointerMove={() => menu.highlight(position)}
            onClick={() => menu.choose(item)}
          >
            <span>{item.label}</span>
            <kbd>{item.key}</kbd>
          </button>
        </div>
      ))}
      <div className="file-actions__footer">j/k move · Enter select · Esc close</div>
      <div className="file-actions__hint" role="status">
        {snapshot.actions[index]?.unavailable ?? "Shortcuts apply while this menu is open."}
      </div>
    </div>
  );
}
