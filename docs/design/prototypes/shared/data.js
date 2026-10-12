// Mock file system shared by every prototype direction.
//
// Times are "hours before NOW". Sizes are bytes. A directory's size is left
// undefined: the prototypes show its entry count instead, which is what the
// real panel can know without a recursive walk.

export const NOW = new Date("2026-10-11T14:20:00");
export const HOME = "/home/jc";

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function dir(name, hoursAgo, children = [], extra = {}) {
  return { name, kind: "dir", hoursAgo, children, ...extra };
}
function file(name, size, hoursAgo, extra = {}) {
  return { name, kind: "file", size, hoursAgo, ...extra };
}
/** A directory whose contents the prototype does not model, but whose count it shows. */
function opaque(name, hoursAgo, count, extra = {}) {
  return dir(name, hoursAgo, filler(count, name), extra);
}
function filler(count, seed) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(file(`${seed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(i + 1).padStart(2, "0")}.txt`, 900 + ((i * 7919) % 40000), 30 + i * 11));
  }
  return out;
}

// ── Preview content ─────────────────────────────────────────────────────────

export const CONTENT = {
  "file-row": {
    lang: "tsx",
    text: `import type { FsEntry } from "@symmetria/fm-core/entry";

import { FileIcon } from "@symmetria/fm-search/ui";
import { ClipboardIndicator } from "./ClipboardIndicator.tsx";
import { FlashName, type FlashRowLabel } from "./FlashName.tsx";

export interface FileRowProps {
  readonly entry: FsEntry;
  readonly isCursor: boolean;
  /** Marked for a file operation. Distinct from the cursor. */
  readonly isMarked?: boolean;
  readonly isMatch?: boolean;
  readonly flash?: FlashRowLabel | null;
  readonly onSelect?: () => void;
  readonly onActivate?: () => void;
}

/** The independent states one row can be in at once. */
interface RowStates {
  readonly isCursor: boolean;
  readonly isMarked: boolean;
  readonly isMatch: boolean;
}

function rowClassName(states: RowStates): string {
  const classes = ["row"];
  if (states.isCursor) classes.push("row--cursor");
  if (states.isMarked) classes.push("row--marked");
  if (states.isMatch) classes.push("row--match");
  return classes.join(" ");
}

export function FileRow({ entry, isCursor, isMarked = false, onSelect }: FileRowProps) {
  const clickable = onSelect !== undefined;
  return (
    <div
      className={rowClassName({ isCursor, isMarked, isMatch: false })}
      data-kind={entry.kind}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <FileIcon entry={entry} />
      <span className="row__name">{entry.name}</span>
      <ClipboardIndicator path={entry.path} />
    </div>
  );
}
`,
  },
  "styles-css": {
    lang: "css",
    text: `/*
 * Every colour here is a token from \`theme/tokens.css\`. A literal in this
 * file cannot be re-themed and cannot be found.
 */

.row {
  position: relative;
  display: flex;
  gap: 6px;
  align-items: center;
  height: var(--row-height);
  padding: 0 6px;
  white-space: nowrap;
  border-radius: var(--radius-sm);
}

.row--cursor {
  background: var(--accent);
}

.row--marked {
  color: var(--marked);
}
`,
  },
  "package-json": {
    lang: "json",
    text: `{
  "name": "@symmetria/fm-ui",
  "version": "0.24.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./styles.css": "./src/styles.css"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@symmetria/fm-core": "workspace:*",
    "@symmetria/fm-search": "workspace:*",
    "react": "^19.2.0",
    "lucide-react": "^0.548.0"
  }
}
`,
  },
  "install-sh": {
    lang: "sh",
    text: `#!/usr/bin/env bash
# Install a sealed Electron release into ~/.local and point the unit at it.
set -euo pipefail

release_dir="$(cd "$(dirname "$0")" && pwd)"
target="$HOME/.local/share/symmetria-fm-electron"

echo "Installing $(jq -r .version "$release_dir/release.json")"
rm -rf "$target.next"
cp -a "$release_dir" "$target.next"
mv -T "$target.next" "$target"

ln -sf "$target/bin/symmetria-fm-electron" "$HOME/.local/bin/"
install -Dm644 "$release_dir/symmetria-fm-electron.service" \\
  "$HOME/.config/systemd/user/symmetria-fm-electron.service"

systemctl --user daemon-reload
systemctl --user enable --now symmetria-fm-electron.service
`,
  },
  "release-json": {
    lang: "json",
    text: `{
  "version": "0.24.0-sealed.3",
  "commit": "2da44d5",
  "builtAt": "2026-10-11T12:48:09Z",
  "electron": "38.2.1",
  "platform": "linux-x64",
  "sealed": true
}
`,
  },
  "agents-md": {
    lang: "md",
    text: `# Symmetria File Manager

A **keyboard-first** file manager for one person who lives in the terminal, in NeoVim, and in an agent harness.

> The beauty in functionality and the functionality of beauty.

## Principles

1. Standalone first, embedded second
2. The host owns policy, the panel owns behaviour
3. Do not do work the user did not ask for

## Build & run

Rebuild the bundle, then restart the daemon:

\`\`\`sh
pnpm --filter @symmetria/fm-app build
systemctl --user restart symmetria-fm-electron
\`\`\`

The panel is also embeddable: Mesura Code mounts the \`fm-search\` overlay without the file manager.
`,
  },
  "vision-md": {
    lang: "md",
    text: `# Vision

> The beauty in functionality and the functionality of beauty.

This document states what the file manager is for and what it **refuses** to be. It is the place to settle arguments about direction.

## What it is

A keyboard-first file manager for one person who lives in the terminal. It is a daily-driver tool, used all day, on its own — not a feature of a larger application.

- One tree, one preview router, one search
- One set of keybindings, everywhere
`,
  },
  gitignore: { lang: "plain", text: "node_modules/\ndist-electron/\nplugin/build/\n*.log\n.DS_Store\n" },
};

// ── The tree ────────────────────────────────────────────────────────────────

const fmUi = dir("fm-ui", 0.4, [
  dir("src", 0.4, [
    dir("components", 0.4, [
      dir("modals", 26, [file("DeleteDialog.tsx", 4.1 * KB, 26), file("RenameDialog.tsx", 3.6 * KB, 50), file("CreateDialog.tsx", 3.2 * KB, 50)]),
      dir("preview", 30, [file("CodePreview.tsx", 6.4 * KB, 30), file("ImagePreview.tsx", 3.1 * KB, 72), file("MarkdownPreview.tsx", 5.2 * KB, 96), file("AudioPreview.tsx", 4.7 * KB, 140)]),
      file("BrowsingView.tsx", 7.9 * KB, 3, { git: "M" }),
      file("ClipboardIndicator.tsx", 1.4 * KB, 120),
      file("FileList.tsx", 8.8 * KB, 0.6, { git: "M" }),
      file("FileRow.tsx", 6.2 * KB, 0.4, { git: "M", content: "file-row" }),
      file("FinderPreview.tsx", 2.9 * KB, 200),
      file("FlashName.tsx", 3.3 * KB, 210),
      file("HelpOverlay.tsx", 9.4 * KB, 74),
      file("MillerColumns.tsx", 11.2 * KB, 3, { git: "M" }),
      file("PathBar.tsx", 2.7 * KB, 1.2, { git: "A" }),
      file("ReaderOverlay.tsx", 6.8 * KB, 90),
      file("SearchField.tsx", 2.2 * KB, 160),
      file("StatusBar.tsx", 7.1 * KB, 1.2, { git: "M" }),
      file("TabBar.tsx", 3.9 * KB, 300),
      file("WhichKeyOverlay.tsx", 4.4 * KB, 74),
      file("ZoxidePopup.tsx", 5.0 * KB, 400),
      file("Toolbar.tsx", 1.9 * KB, 0.2, { git: "?" }),
    ]),
    dir("hooks", 50, filler(9, "use-hook")),
    dir("overview", 20, filler(14, "overview")),
    dir("theme", 1.1, [file("tokens.css", 9.8 * KB, 1.1, { git: "M" }), file("fonts.css", 0.8 * KB, 0.3, { git: "?" })]),
    file("App.tsx", 14.6 * KB, 5),
    file("bridge.ts", 3.4 * KB, 240),
    file("styles.css", 38.1 * KB, 1.1, { git: "M", content: "styles-css" }),
    file("syntax-wine.css", 2.6 * KB, 700),
  ]),
  dir("test", 12, filler(16, "test")),
  file("package.json", 1.1 * KB, 300, { content: "package-json" }),
  file("tsconfig.json", 0.6 * KB, 900),
  file("vitest.config.ts", 0.9 * KB, 900),
]);

const symmetria = dir(
  "symmetria-file-manager",
  0.4,
  [
    dir(".git", 0.2, filler(12, "git"), { hidden: true }),
    dir("app", 5, [dir("src", 5, filler(11, "main")), dir("dist-electron", 2, filler(4, "bundle"), { ignored: true }), file("vitest.config.ts", 1.2 * KB, 500)]),
    dir("docs", 3, [
      dir("electron-transition", 24, filler(26, "spec")),
      dir("design", 0.1, [dir("prototypes", 0.1, filler(4, "prototype"), { git: "?" })], { git: "?" }),
      file("vision.md", 12.4 * KB, 1100, { content: "vision-md" }),
      file("pdf-viewer-research.md", 8.8 * KB, 600),
    ]),
    dir("node_modules", 30, filler(40, "pkg"), { ignored: true }),
    dir("packages", 0.4, [dir("fm-core", 8, filler(18, "core")), dir("fm-main", 30, filler(12, "main")), dir("fm-search", 50, filler(10, "search")), fmUi]),
    dir("plugin", 300, filler(9, "plugin")),
    dir("qml", 400, filler(6, "qml")),
    dir("tools", 90, filler(5, "tool")),
    file(".gitignore", 0.2 * KB, 900, { hidden: true, content: "gitignore" }),
    file("AGENTS.md", 41.2 * KB, 26, { content: "agents-md" }),
    file("CLAUDE.md", 9, 1800, { link: "AGENTS.md", content: "agents-md" }),
    file("biome.jsonc", 2.1 * KB, 300),
    file("package.json", 1.8 * KB, 30),
    file("pnpm-lock.yaml", 412 * KB, 30),
    file("pnpm-workspace.yaml", 0.1 * KB, 900),
    file("README.md", 3.3 * KB, 400, { content: "vision-md" }),
  ],
  { repo: { branch: "t3code/7ec389bc", ahead: 2 } },
);

const sealed = dir("symmetria-fm-sealed-d8o6KGtZ", 1.3, [
  dir("app", 1.3, filler(6, "app")),
  dir("assets", 1.3, [file("icon.png", 48 * KB, 1.3, { art: 3 }), file("icon.svg", 2.2 * KB, 1.3)]),
  dir("bin", 1.3, [file("symmetria-fm-electron", 2.1 * KB, 1.3, { exec: true })]),
  file("install-electron-release.sh", 2.4 * KB, 1.3, { exec: true, content: "install-sh" }),
  file("release.json", 0.3 * KB, 1.3, { content: "release-json" }),
  dir("runtime", 1.3, filler(22, "runtime")),
  file("symmetria-fm-electron.desktop", 0.4 * KB, 1.3),
  file("symmetria-fm-electron.service", 0.6 * KB, 1.3),
]);

const downloads = dir("Downloads", 1.3, [
  sealed,
  dir("symmetria-fm-release-XVWxY9Q4", 5, filler(7, "release")),
  dir("el-terron-presentaciones", 20, filler(12, "slide")),
  dir("mesura-aesthetic-references", 26, [
    file("mesura-code-sidebar.png", 1.4 * MB, 26, { art: 1, dims: "2560 × 1600" }),
    file("composer-glass.png", 0.9 * MB, 26, { art: 2, dims: "1920 × 1080" }),
    file("palette-study.png", 0.4 * MB, 27, { art: 4, dims: "1600 × 1000" }),
  ]),
  dir("formulario-seguro-vida", 40, filler(3, "form")),
  dir("LocalSend", 52, filler(18, "share")),
  dir("Taffy_Tales_Redux-The_Morning_After-v1.0.36 (2)", 70, filler(9, "game")),
  dir("Taffy_Tales_Redux-The_Morning_After-v1.0.36", 71, filler(9, "game")),
  dir("audios", 80, [file("nota-de-voz-0912.opus", 1.8 * MB, 80, { audio: { duration: "3:42" } }), file("reunion-pallas.m4a", 22 * MB, 82, { audio: { duration: "41:08" } })]),
  dir("bambin-lista-09-26", 110, filler(4, "lista")),
  dir("rapthor-v3", 130, filler(15, "rapthor")),
  dir("rapthor-2026", 150, filler(11, "rapthor")),
  dir("liquidacion-sanchez-28-08-26", 170, filler(2, "liq")),
  dir("msi-x670p-m2", 200, filler(6, "bios")),
  dir("second-brain-usb-backup", 260, filler(30, "note")),
  dir("whatsapp-mockup", 300, filler(8, "mock")),
  dir("pedidos-prueba-cotizacion", 320, filler(5, "pedido")),
  dir("biomimetic-separated-assets", 350, filler(24, "asset")),
  dir("games", 380, filler(7, "game")),
  dir("cyberpunk-quickhack-mods", 420, filler(13, "mod")),
  dir("cyberpunk-ads", 430, filler(10, "ad")),
  dir("Maxi-Chini", 470, filler(3, "doc")),
  dir("cyberpunk-frameworks", 500, filler(5, "fw")),
  dir("FPSAnimationPack_Ultimate_Demo", 530, filler(9, "anim")),
  dir("TacticalShooterPack_Demo", 560, filler(9, "anim")),
  dir("Linux_Unreal_Engine_5.7.4(1)", 600, filler(4, "ue")),
  dir("workshop", 640, filler(6, "ws")),
  file("Linux_Unreal_Engine_5.7.4.zip", 31.4 * GB, 610, { archive: ["Engine/", "Engine/Binaries/", "Engine/Content/", "Engine/Plugins/", "FeaturePacks/", "Samples/", "Templates/", "Setup.sh", "GenerateProjectFiles.sh"] }),
  file("factura-octubre.pdf", 182 * KB, 8, { pdf: { pages: 2 } }),
  file("presupuesto-pallas.xlsx", 64 * KB, 30, { sheet: true }),
  file("wallpaper-dunes.jpg", 4.6 * MB, 3, { art: 0, dims: "3840 × 2160" }),
  file("screen-recording-1011.mp4", 88 * MB, 0.7, { video: { duration: "0:41" } }),
  dir("Moiso-Cindi", 700, filler(4, "doc")),
  dir("liquidaciones-lunes-6.4", 760, filler(6, "liq")),
  dir("whatsapp-exports", 800, filler(14, "chat")),
  dir("resúmenes tarjeta naranja", 850, filler(12, "resumen")),
  dir("compu-manu", 900, filler(5, "spec")),
  dir("test", 950, filler(2, "test")),
  dir("garin-pagos", 1000, filler(8, "pago")),
]);

const pictures = dir("Pictures", 3, [
  dir("Screenshots", 0.3, [
    file("2026-10-11-141207.png", 1.2 * MB, 0.13, { art: 5, dims: "2560 × 1540" }),
    file("2026-10-11-135940.png", 1.1 * MB, 0.33, { art: 6, dims: "2560 × 1556" }),
    file("2026-10-10-221503.png", 0.8 * MB, 16, { art: 2, dims: "2560 × 1600" }),
  ]),
  dir("wallpapers", 3, [
    file("dunes-at-dusk.jpg", 4.6 * MB, 3, { art: 0, dims: "3840 × 2160" }),
    file("aurora-plum.jpg", 3.9 * MB, 90, { art: 1, dims: "3840 × 2160" }),
    file("tidal-glass.jpg", 5.2 * MB, 300, { art: 2, dims: "5120 × 2880" }),
    file("ember-field.jpg", 4.1 * MB, 600, { art: 3, dims: "3840 × 2160" }),
  ]),
  file("profile.jpg", 0.3 * MB, 2000, { art: 4, dims: "1024 × 1024" }),
]);

const projects = dir("projects", 0.4, [
  symmetria,
  dir("mesura-code", 2, filler(22, "mesura"), { repo: { branch: "main", ahead: 0 } }),
  dir("chamba-hq", 30, [
    dir("radar-de-inocuidad", 30, [
      dir("data", 30, [file("volumen.db", 18 * MB, 30)]),
      dir("docs", 40, filler(5, "doc")),
      dir("pipeline", 30, filler(14, "py")),
      dir("public", 60, filler(4, "png")),
      dir("src", 30, filler(12, "ts")),
      file("AGENTS.md", 6.2 * KB, 40, { content: "agents-md" }),
      file("package.json", 1.4 * KB, 60),
    ]),
  ]),
  dir("symmetria-shell", 200, filler(18, "qml")),
  dir("symmetria-ide", 120, filler(16, "py")),
]);

export const ROOT = dir("/", 2000, [
  dir("home", 2000, [
    dir("jc", 0.13, [
      dir(".config", 4, filler(30, "config"), { hidden: true }),
      dir(".local", 1.3, filler(4, "local"), { hidden: true }),
      file(".bashrc", 3.1 * KB, 240, { hidden: true }),
      dir("Applications", 900, filler(6, "app")),
      dir("Audio", 300, filler(8, "audio")),
      dir("Desktop", 2000, filler(2, "desk")),
      dir("Documents", 30, [
        file("contrato-servicios-2026.pdf", 240 * KB, 400, { pdf: { pages: 6 } }),
        file("presupuesto-obra.xlsx", 88 * KB, 50, { sheet: true }),
        dir("facturas", 8, filler(24, "factura")),
        dir("respaldos", 600, filler(7, "bak")),
      ]),
      downloads,
      dir("Games", 1400, filler(5, "game")),
      dir("Music", 700, [file("night-drive.flac", 38 * MB, 700, { audio: { duration: "5:12" } })]),
      dir("notes", 0.13, filler(48, "note")),
      pictures,
      projects,
      dir("scripts", 50, filler(19, "script"), { link: "~/.dotfiles/scripts" }),
      dir("Videos", 120, filler(6, "video")),
      dir("work", 60, filler(11, "work")),
    ]),
  ]),
]);

// ── Parent links + paths ────────────────────────────────────────────────────

function index(node, parentPath) {
  node.path = parentPath === null ? "/" : parentPath === "/" ? `/${node.name}` : `${parentPath}/${node.name}`;
  for (const child of node.children ?? []) {
    child.parent = node;
    index(child, node.path);
  }
}
index(ROOT, null);

export function nodeAt(path) {
  if (path === "/") return ROOT;
  let node = ROOT;
  for (const part of path.split("/").filter(Boolean)) {
    node = node.children?.find((c) => c.name === part);
    if (!node) return null;
  }
  return node;
}

export const PLACES = [
  { label: "Home", icon: "house", path: HOME },
  { label: "Downloads", icon: "download", path: `${HOME}/Downloads` },
  { label: "Documents", icon: "file-text", path: `${HOME}/Documents` },
  { label: "Pictures", icon: "image", path: `${HOME}/Pictures` },
  { label: "Projects", icon: "folder-git-2", path: `${HOME}/projects` },
  { label: "Notes", icon: "folder-heart", path: `${HOME}/notes` },
];

export const PINNED = [
  { label: "symmetria-file-manager", path: `${HOME}/projects/symmetria-file-manager`, color: "blue" },
  { label: "fm-ui/components", path: `${HOME}/projects/symmetria-file-manager/packages/fm-ui/src/components`, color: "green" },
  { label: "radar-de-inocuidad", path: `${HOME}/projects/chamba-hq/radar-de-inocuidad`, color: "orange" },
  { label: "wallpapers", path: `${HOME}/Pictures/wallpapers`, color: "purple" },
];

export const DEVICES = [{ label: "nvme0n1p2", icon: "hard-drive", used: 612, total: 931 }];
