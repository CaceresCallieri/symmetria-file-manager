import type { Bookmark } from "@symmetria/fm-core/bookmarks";
import {
  type DiskUsageReply,
  isFailure,
  type Place,
  type PlaceKind,
} from "@symmetria/fm-core/contract";
import { humanSize } from "@symmetria/fm-core/format";
import type { KeyEvent, ViewKind } from "@symmetria/fm-core/keys/types";
import {
  ArrowLeft,
  ArrowRight,
  Columns3,
  Download,
  FileText,
  Film,
  HardDrive,
  House,
  Image,
  Keyboard,
  ListTree,
  type LucideIcon,
  Music,
  Network,
  Plus,
  Search,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useState } from "react";

import { diskUsage, userPlaces } from "../bridge.ts";
import type { PressKey } from "../hooks/useKeyDispatch.ts";
import { useViewSwitch } from "../hooks/useViewSwitch.ts";

import type { TabView } from "../useTabs.ts";
import { PathBar } from "./PathBar.tsx";
import { TabBar } from "./TabBar.tsx";

/*
 * Atmosphere — the standalone's window chrome: one header row
 * (tabs, history, breadcrumb, search, the three views, help) and an icon rail
 * (places, bookmarks and a disk meter). Rendered only when the host passes
 * `chrome="atmosphere"` to `App`; Mesura Code's host does not, so its layer
 * keeps today's layout. Spec: docs/design/atmosphere-design-system.md.
 *
 * Every header control presses the key the keymap already has, through the
 * cascade (`press`), so it is gated exactly as that key is. Nothing here owns
 * file-manager state, and every button keeps keyboard focus where it was, for
 * the reason a row does: the document-level handler owns the keymap.
 */

const keepFocus = (event: MouseEvent) => event.preventDefault();

function IconButton({
  label,
  onClick,
  pressed,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly pressed?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="atmo-icon-button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const VIEWS: readonly {
  readonly kind: ViewKind;
  readonly label: string;
  readonly Icon: LucideIcon;
}[] = [
  { kind: "miller", label: "Columns", Icon: Columns3 },
  { kind: "tree", label: "File tree (Ctrl+E)", Icon: ListTree },
  { kind: "overview", label: "Folder overview (Ctrl+O)", Icon: Network },
];

function plainKey(key: string, shift = false): KeyEvent {
  return { key, ctrl: false, shift, alt: false, meta: false };
}

/**
 * The keys behind the header's buttons. Pressed through the cascade, never as
 * direct action calls, so each button is gated exactly as its key is: the
 * picker refuses a new tab, a dialog swallows the click, and `/` in the
 * overview opens the overview's own search.
 */
const HEADER_KEYS = {
  newTab: plainKey("t"),
  back: plainKey("S", true),
  forward: plainKey("D", true),
  search: plainKey("/"),
  help: plainKey("?"),
} as const;

export interface AtmosphereHeaderProps {
  readonly views: readonly TabView[];
  readonly activeTab: number;
  onActivateTab(index: number): void;
  onCloseTab(index: number): void;
  readonly path: string;
  onNavigate(path: string): void;
  readonly view: ViewKind;
  /** Runs a key through the cascade, as a keypress would. */
  readonly press: PressKey;
  /** Leaves the tree for Columns, as the tree toolbar's own control does. */
  onCloseTree(): void;
}

export function AtmosphereHeader(props: AtmosphereHeaderProps) {
  const { press } = props;
  const switchView = useViewSwitch(props.view, press, props.onCloseTree);
  return (
    <header className="atmo-header">
      <div className="atmo-tabs">
        <TabBar
          views={props.views}
          activeIndex={props.activeTab}
          onActivate={props.onActivateTab}
          onClose={props.onCloseTab}
        />
        <IconButton label="New tab" onClick={() => press(HEADER_KEYS.newTab)}>
          <Plus size={14} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="atmo-history">
        <IconButton label="Back" onClick={() => press(HEADER_KEYS.back)}>
          <ArrowLeft size={16} aria-hidden="true" />
        </IconButton>
        <IconButton label="Forward" onClick={() => press(HEADER_KEYS.forward)}>
          <ArrowRight size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="atmo-crumbs">
        <PathBar path={props.path} onNavigate={props.onNavigate} />
      </div>
      <button
        type="button"
        className="atmo-search"
        onMouseDown={keepFocus}
        onClick={() => press(HEADER_KEYS.search)}
      >
        <Search size={15} aria-hidden="true" />
        <span>Search</span>
        <kbd>/</kbd>
      </button>
      <div className="atmo-views" role="radiogroup" aria-label="View">
        {VIEWS.map(({ kind, label, Icon }) => (
          <IconButton
            key={kind}
            label={label}
            pressed={props.view === kind}
            onClick={() => switchView(kind)}
          >
            <Icon size={15} aria-hidden="true" />
          </IconButton>
        ))}
      </div>
      <IconButton label="Keyboard shortcuts (?)" onClick={() => press(HEADER_KEYS.help)}>
        <Keyboard size={16} aria-hidden="true" />
      </IconButton>
    </header>
  );
}

const PLACE_ICONS = {
  download: Download,
  documents: FileText,
  pictures: Image,
  videos: Film,
  music: Music,
} satisfies Record<PlaceKind, LucideIcon>;

/**
 * The user directories that exist, asked once. Empty until the answer, and for
 * a host that cannot resolve them: the rail then offers Home alone rather than
 * guessing English names a user may have renamed or never had.
 */
function usePlaces(): readonly Place[] {
  const [places, setPlaces] = useState<readonly Place[]>([]);
  useEffect(() => {
    let current = true;
    void userPlaces().then((reply) => {
      if (current && !isFailure(reply)) setPlaces(reply.value.places);
    });
    return () => {
      current = false;
    };
  }, []);
  return places;
}

export interface AtmosphereRailProps {
  readonly home: string;
  readonly path: string;
  readonly bookmarks: ReadonlyMap<string, Bookmark>;
  onNavigate(path: string): void;
}

export function AtmosphereRail({ home, path, bookmarks, onNavigate }: AtmosphereRailProps) {
  const places = usePlaces();
  return (
    <nav className="atmo-rail" aria-label="Places">
      <div className="atmo-rail-section">
        <RailPlace label="Home" target={home} path={path} Icon={House} onNavigate={onNavigate} />
        {places.map((place) => (
          <RailPlace
            key={place.kind}
            // The directory's own name, so a translated or renamed one reads
            // as the user named it ("Descargas", not "Downloads").
            label={place.path.slice(place.path.lastIndexOf("/") + 1)}
            target={place.path}
            path={path}
            Icon={PLACE_ICONS[place.kind]}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      {bookmarks.size > 0 ? (
        <div className="atmo-rail-section">
          {[...bookmarks].map(([letter, bookmark]) => (
            <button
              key={letter}
              type="button"
              className="atmo-rail-item"
              aria-current={path === bookmark.path ? "page" : undefined}
              onMouseDown={keepFocus}
              onClick={() => onNavigate(bookmark.path)}
            >
              <span className="atmo-monogram">{letter.toUpperCase()}</span>
              <span className="atmo-rail-tip">
                {bookmark.label} <kbd>g{letter}</kbd>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <DiskMeter path={path} />
    </nav>
  );
}

function RailPlace({
  label,
  target,
  path,
  Icon,
  onNavigate,
}: {
  readonly label: string;
  readonly target: string;
  readonly path: string;
  readonly Icon: LucideIcon;
  onNavigate(path: string): void;
}) {
  return (
    <button
      type="button"
      className="atmo-rail-item"
      aria-current={path === target ? "page" : undefined}
      onMouseDown={keepFocus}
      onClick={() => onNavigate(target)}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="atmo-rail-tip">{label}</span>
    </button>
  );
}

/** How often the meter re-reads while the directory stays the same. */
const DISK_REFRESH_MS = 30_000;

/**
 * The filesystem holding `path`, re-read when the directory changes and every
 * `DISK_REFRESH_MS` while it does not, so a copy into the same folder still
 * moves the bar. Null until the first answer, and for a host that cannot
 * measure.
 */
function useDiskUsage(path: string): DiskUsageReply | null {
  const [usage, setUsage] = useState<DiskUsageReply | null>(null);
  useEffect(() => {
    let current = true;
    const read = () =>
      void diskUsage(path).then((reply) => {
        if (current) setUsage(isFailure(reply) ? null : reply.value);
      });
    read();
    const timer = window.setInterval(read, DISK_REFRESH_MS);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [path]);
  return usage;
}

/** Used share at or above which the bar turns amber, then red. */
const DISK_WARN = 0.9;
const DISK_FULL = 0.97;

/**
 * Decided here with `>=`, not left to the `<meter>`'s `low` / `high`:
 * Chromium counts a value exactly AT `low` as optimum and exactly at `high` as
 * suboptimum, so a disk at 90.0% stayed neutral and one at 97.0% stayed amber.
 */
function diskLevel(used: number): "ok" | "warn" | "full" {
  if (used >= DISK_FULL) return "full";
  return used >= DISK_WARN ? "warn" : "ok";
}

function DiskMeter({ path }: { readonly path: string }) {
  const usage = useDiskUsage(path);
  if (usage === null) return null;

  const used = (usage.total - usage.free) / usage.total;
  return (
    <div className="atmo-rail-item atmo-disk" data-level={diskLevel(used)}>
      <HardDrive size={18} aria-hidden="true" />
      <meter className="atmo-disk-bar" aria-label="Disk usage" min={0} max={1} value={used} />
      <span className="atmo-rail-tip">
        {humanSize(usage.free)} free of {humanSize(usage.total)}{" "}
        <kbd>{Math.round(used * 100)}%</kbd>
      </span>
    </div>
  );
}
