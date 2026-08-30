import { breadcrumbs } from "@symmetria/fm-core/pane";

export interface PathBarProps {
  readonly path: string;
}

/**
 * The location, as segments.
 *
 * A breadcrumb, not an editable field. The Qt version's path bar was read-only
 * too; the PRD promised editing and it was never built, so this is parity with
 * what exists rather than with what was written down.
 */
export function PathBar({ path }: PathBarProps) {
  const crumbs = breadcrumbs(path);

  return (
    <nav data-testid="path-bar" className="path-bar">
      {crumbs.map((crumb, index) => (
        <span
          key={crumb.path}
          data-testid={index === crumbs.length - 1 ? "crumb-current" : "crumb"}
          className={index === crumbs.length - 1 ? "crumb crumb--current" : "crumb"}
        >
          {crumb.label}
        </span>
      ))}
    </nav>
  );
}
