// The prototype application. Every direction mounts this same module with its
// own config and stylesheet, so the comparison is about design, not behaviour.

import { CONTENT, DEVICES, HOME, nodeAt, PINNED, PLACES } from "./data.js";
import {
  artSVG,
  artURL,
  codeBlock,
  esc,
  extOf,
  fileIcon,
  formatDate,
  formatLongDate,
  formatSize,
  icon,
  markdown,
  permissions,
  typeOf,
  waveformSVG,
} from "./render.js";

const DEFAULTS = {
  name: "Prototype",
  sidebar: true,
  tabs: false,
  relativeNumbers: false,
  dateStyle: "friendly",
  currentMeta: ["size", "date"],
  parentMeta: false,
  columnHeaders: true,
  previewProps: true,
  wallpaper: 0,
  /** Extra wallpapers `W` cycles through, as [art seed, label]. */
  wallpapers: null,
  themeToggle: false,
  modeNames: { normal: "Normal", search: "Search", visual: "Select" },
  homeAlias: "~",
  homeLabel: "~",
};

const SORTS = ["name", "modified", "size", "ext"];
const SORT_LABEL = { name: "Name", modified: "Modified", size: "Size", ext: "Kind" };
const GIT_LABEL = { M: "Modified", A: "Added", "?": "Untracked", D: "Deleted" };

let cfg;
let root;
const state = {
  path: `${HOME}/Downloads`,
  cursorName: new Map(),
  history: [],
  future: [],
  marks: new Set(),
  clip: null,
  search: { open: false, query: "", committed: "" },
  showHidden: false,
  sortByPath: new Map([[`${HOME}/Downloads`, "modified"]]),
  view: "miller",
  help: false,
  chord: null,
  dialog: null,
  transient: null,
  theme: "dark",
  sidebarOpen: true,
  tabs: [],
  activeTab: 0,
  colScroll: new Map(),
};

// ── Model queries ───────────────────────────────────────────────────────────

const sortFor = (path) => state.sortByPath.get(path) ?? "name";
const visible = (n) => state.showHidden || !n.hidden;

function listing(node) {
  if (!node || node.kind !== "dir") return [];
  const mode = sortFor(node.path);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const cmp = {
    name: byName,
    modified: (a, b) => a.hoursAgo - b.hoursAgo,
    size: (a, b) => weight(b) - weight(a),
    ext: (a, b) => extOf(a).localeCompare(extOf(b)) || byName(a, b),
  }[mode];
  return node.children.filter(visible).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "dir" ? -1 : 1) || cmp(a, b));
}
const weight = (n) => (n.kind === "dir" ? n.children.length * 1e6 : n.size);
const countLabel = (n) => {
  const c = n.children.filter(visible).length;
  return cfg.dateStyle === "compact" ? String(c) : `${c} ${c === 1 ? "item" : "items"}`;
};

function cursorIndex(node, list = listing(node)) {
  const name = state.cursorName.get(node.path);
  const i = list.findIndex((c) => c.name === name);
  return i < 0 ? 0 : i;
}
const current = () => nodeAt(state.path);
/**
 * The list the cursor walks in the active view, with a setter.
 *
 * Miller walks the current directory; the tree walks its flattened visible
 * rows. Every cursor operation (j/k, marks, search jumps, file operations)
 * goes through this, so the two views cannot drift apart.
 */
function nav() {
  if (state.view === "tree") {
    const rows = treeRows();
    const index = Math.max(0, rows.findIndex((r) => r.node.path === tree.cursor));
    return {
      items: rows.map((r) => r.node),
      index,
      set: (i) => {
        const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
        if (row) tree.cursor = row.node.path;
      },
    };
  }
  const node = current();
  const list = listing(node);
  return { items: list, index: cursorIndex(node, list), set: (i) => setCursor(node, i) };
}
function cursorNode() {
  const n = nav();
  return n.items[n.index] ?? null;
}

// ── File tree ───────────────────────────────────────────────────────────────

const tree = { root: null, expanded: new Set(), cursor: null };

function openTree() {
  tree.root = state.path;
  tree.expanded = new Set();
  const list = listing(current());
  tree.cursor = list[cursorIndex(current(), list)]?.path ?? null;
  state.view = "tree";
}
function closeTree() {
  // Leave tree mode BEFORE navigating: go() re-roots the tree while it is open.
  state.view = "miller";
  const node = nodeAt(tree.cursor ?? "");
  if (node?.parent && node.parent.path !== state.path) go(node.parent.path, { cursor: node.name });
  else if (node) state.cursorName.set(state.path, node.name);
}
function treeRows() {
  const rows = [];
  const walk = (dirNode, depth) => {
    for (const child of listing(dirNode)) {
      const open = child.kind === "dir" && tree.expanded.has(child.path);
      rows.push({ node: child, depth, open });
      if (open) walk(child, depth + 1);
    }
  };
  const rootNode = nodeAt(tree.root);
  if (rootNode) walk(rootNode, 0);
  return rows;
}
function treeToggle(node, open = !tree.expanded.has(node.path)) {
  if (node.kind !== "dir" || node.ignored) return;
  if (open) tree.expanded.add(node.path);
  else tree.expanded.delete(node.path);
}
function treeRight() {
  const node = cursorNode();
  if (!node) return;
  if (node.kind !== "dir") return openCursor();
  if (!tree.expanded.has(node.path)) return treeToggle(node, true);
  const first = listing(node)[0];
  if (first) tree.cursor = first.path;
}
function treeLeft() {
  const node = cursorNode();
  if (!node) return;
  if (node.kind === "dir" && tree.expanded.has(node.path)) return treeToggle(node, false);
  if (node.parent && node.parent.path !== tree.root) tree.cursor = node.parent.path;
}
function treeExpandAll() {
  const walk = (dirNode, depth) => {
    for (const child of listing(dirNode)) {
      if (child.kind !== "dir" || child.ignored || child.name === ".git") continue;
      tree.expanded.add(child.path);
      if (depth < 2) walk(child, depth + 1);
    }
  };
  walk(nodeAt(tree.root), 0);
  flashMessage("Expanded the project, three levels deep", "info", 1600);
}
function setCursor(node, index) {
  const list = listing(node);
  if (!list.length) return;
  const i = Math.max(0, Math.min(list.length - 1, index));
  state.cursorName.set(node.path, list[i].name);
}
function displayPath(path) {
  return path === HOME ? cfg.homeAlias : path.startsWith(`${HOME}/`) ? `${cfg.homeAlias}${path.slice(HOME.length)}` : path;
}
function shortPath(path) {
  const parts = displayPath(path).split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}
function repoOf(node) {
  for (let n = node; n; n = n.parent) if (n.repo) return n;
  return null;
}
function searchMatches(list) {
  const q = (state.search.open ? state.search.query : state.search.committed).toLowerCase();
  if (!q) return new Set();
  return new Set(list.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.name));
}

// ── Navigation ──────────────────────────────────────────────────────────────

function go(path, { record = true, cursor } = {}) {
  const node = nodeAt(path);
  if (!node || node.kind !== "dir") return;
  if (record && path !== state.path) {
    state.history.push(state.path);
    state.future = [];
  }
  state.path = path;
  if (cursor) state.cursorName.set(path, cursor);
  if (cfg.tabs) state.tabs[state.activeTab] = path;
  state.search.committed = "";
  if (state.view === "tree") openTree();
}
function openCursor() {
  const node = cursorNode();
  if (!node) return;
  if (node.kind === "dir") go(node.path);
  else flashMessage(`Opened ${node.name} with ${defaultApp(node)}`, "info");
}
function goUp() {
  const node = current();
  if (!node.parent) return;
  go(node.parent.path, { cursor: node.name });
}
function back() {
  if (!state.history.length) return;
  state.future.push(state.path);
  go(state.history.pop(), { record: false });
}
function forward() {
  if (!state.future.length) return;
  state.history.push(state.path);
  go(state.future.pop(), { record: false });
}
function defaultApp(node) {
  const t = typeOf(node);
  if (t.icon === "image") return "Image Viewer";
  if (t.icon === "file-code" || t.icon === "file-json") return "Neovim";
  if (t.icon === "music" || t.icon === "film") return "mpv";
  if (extOf(node) === "pdf") return "Zathura";
  return "the default application";
}

let transientTimer;
function flashMessage(text, tone = "info", ms = 2600) {
  state.transient = { text, tone };
  clearTimeout(transientTimer);
  transientTimer = setTimeout(() => {
    state.transient = null;
    render();
  }, ms);
}

// ── File operations (on the mock tree) ─────────────────────────────────────

function targets() {
  const marked = nav().items.filter((n) => state.marks.has(n.path));
  if (marked.length) return marked;
  const c = cursorNode();
  return c ? [c] : [];
}
function reindex(node) {
  for (const child of node.children ?? []) {
    child.parent = node;
    child.path = node.path === "/" ? `/${child.name}` : `${node.path}/${child.name}`;
    reindex(child);
  }
}
function clone(node) {
  const copy = { ...node, children: node.children?.map(clone), hoursAgo: 0 };
  return copy;
}
function paste() {
  if (!state.clip) return;
  const at = cursorNode();
  const dest = state.view === "tree" && at ? (at.kind === "dir" ? at : at.parent) : current();
  const items = state.clip.paths.map(nodeAt).filter(Boolean);
  const total = items.length;
  state.transient = { text: `${state.clip.mode === "cut" ? "Moving" : "Copying"} ${total} ${total === 1 ? "item" : "items"}`, tone: "progress", progress: 0 };
  const started = performance.now();
  const tick = () => {
    const p = Math.min(1, (performance.now() - started) / 1400);
    state.transient.progress = p;
    renderStatus();
    if (p < 1) requestAnimationFrame(tick);
    else {
      for (const item of items) {
        const fresh = clone(item);
        if (state.clip.mode === "cut") item.parent.children = item.parent.children.filter((c) => c !== item);
        let name = item.name;
        while (dest.children.some((c) => c.name === name)) name = name.replace(/(\.[^.]+)?$/, " copy$1");
        fresh.name = name;
        dest.children.push(fresh);
      }
      reindex(dest);
      const verb = state.clip.mode === "cut" ? "Moved" : "Copied";
      state.clip = null;
      flashMessage(`${verb} ${total} ${total === 1 ? "item" : "items"} to ${displayPath(dest.path)}`, "success");
      render();
    }
  };
  requestAnimationFrame(tick);
}
function confirmDialog() {
  const d = state.dialog;
  if (!d) return;
  if (d.type === "trash") {
    for (const item of d.items) item.parent.children = item.parent.children.filter((c) => c !== item);
    state.marks.clear();
    flashMessage(`Moved ${d.items.length} ${d.items.length === 1 ? "item" : "items"} to Trash`, "success");
  } else if (d.type === "rename") {
    const value = root.querySelector(".dialog input")?.value.trim();
    if (value && value !== d.items[0].name) {
      d.items[0].name = value;
      reindex(d.items[0].parent);
      state.cursorName.set(state.path, value);
      flashMessage(`Renamed to ${value}`, "success");
    }
  }
  state.dialog = null;
}

// ── Markup: rows and columns ────────────────────────────────────────────────

function rowHTML(node, o = {}) {
  const classes = ["row"];
  if (o.cursor) classes.push("is-cursor");
  if (state.marks.has(node.path)) classes.push("is-marked");
  if (state.clip?.paths.includes(node.path)) classes.push(state.clip.mode === "cut" ? "is-cut" : "is-yank");
  if (o.match) classes.push("is-match");
  if (node.hidden) classes.push("is-hidden");
  if (node.ignored) classes.push("is-ignored");
  const meta = (o.meta ?? [])
    .map((m) => {
      if (m === "size") return `<span class="row-meta m-size">${node.kind === "dir" ? countLabel(node) : formatSize(node.size)}</span>`;
      if (m === "date") return `<span class="row-meta m-date">${formatDate(node, cfg.dateStyle)}</span>`;
      return "";
    })
    .join("");
  const gutter = o.gutter !== undefined ? `<span class="row-gutter">${o.gutter}</span>` : "";
  const git = node.git ? `<span class="row-git" data-git="${node.git === "?" ? "U" : node.git}">${node.git === "?" ? "U" : node.git}</span>` : "";
  const link = node.link ? `<span class="row-link" title="→ ${esc(node.link)}">${icon("arrow-right")}</span>` : "";
  const chevron = node.kind === "dir" && o.chevron ? `<span class="row-chev">${icon("chevron-right")}</span>` : "";
  if (o.open) classes.push("is-open");
  const indent =
    o.depth !== undefined
      ? `<span class="tree-guides" style="--depth:${o.depth}"></span><span class="tree-disc">${node.kind === "dir" && !node.ignored ? icon("chevron-right") : ""}</span>`
      : "";
  return `<div class="${classes.join(" ")}" data-name="${esc(node.name)}" data-path="${esc(node.path)}" data-kind="${node.kind}" data-col="${o.col ?? ""}">${gutter}${indent}<span class="row-strip"></span>${fileIcon(node)}<span class="row-name">${esc(node.name)}</span>${link}${git}${meta}${chevron}</div>`;
}

function columnHTML(node, col, { cursorAt, meta = [], active = false, header = true } = {}) {
  const list = listing(node);
  const matches = col === "current" ? searchMatches(list) : new Set();
  const ci = cursorAt ?? -1;
  const rows = list.length
    ? list
        .map((n, i) =>
          rowHTML(n, {
            cursor: i === ci,
            meta,
            col,
            match: matches.has(n.name),
            chevron: col !== "preview",
            gutter: cfg.relativeNumbers && col === "current" ? (i === ci ? i + 1 : Math.abs(i - ci)) : undefined,
          }),
        )
        .join("")
    : `<div class="empty">${icon("folder-open", "ico empty-ico")}<span>This folder is empty</span></div>`;
  const metaHead = meta.length
    ? `<span class="col-meta-head">${meta.map((m) => `<span class="h-${m}">${m === "size" ? "Size" : "Modified"}</span>`).join("")}</span>`
    : "";
  const head =
    cfg.columnHeaders && header
      ? `<div class="col-head"><span class="col-title">${col === "current" && cfg.relativeNumbers ? "<span class=\"col-gutter-head\">#</span>" : ""}${esc(node.name === "/" ? "/" : node.name)}</span><span class="col-count">${list.length}</span>${metaHead}</div>`
      : "";
  return `<section class="col col-${col}${active ? " is-active" : ""}" data-path="${esc(node.path)}">${head}<div class="col-body" data-scroll="${esc(node.path)}">${rows}</div></section>`;
}

// ── Markup: preview ─────────────────────────────────────────────────────────

function propsHTML(rows) {
  return `<dl class="pv-props">${rows
    .filter(Boolean)
    .map(([k, v, cls = ""]) => `<div class="pv-prop ${cls}"><dt>${k}</dt><dd>${v}</dd></div>`)
    .join("")}</dl>`;
}

function previewBody(node) {
  if (node.content && CONTENT[node.content]) {
    const { lang, text } = CONTENT[node.content];
    if (lang === "md") return `<div class="pv-doc">${markdown(text)}</div>`;
    return `<div class="pv-code">${codeBlock(text, lang)}</div>`;
  }
  if (node.art !== undefined)
    return `<figure class="pv-image"><div class="pv-image-frame">${artSVG(node.art, { w: 1600, h: 1000 })}</div></figure>`;
  if (node.audio)
    return `<div class="pv-audio"><div class="pv-audio-art">${artSVG(node.name.length % 5, { w: 600, h: 600 })}</div><div class="pv-audio-wave">${waveformSVG(node.name.length)}<div class="pv-audio-progress"></div></div><div class="pv-audio-controls"><button class="btn-round" data-act="play">${icon("play")}</button><span class="pv-audio-time">0:00 <span>/ ${node.audio.duration}</span></span></div></div>`;
  if (node.video)
    return `<figure class="pv-video"><div class="pv-image-frame">${artSVG(2, { w: 1600, h: 900 })}<span class="pv-play">${icon("play")}</span><span class="pv-chip">${node.video.duration}</span></div></figure>`;
  if (node.pdf)
    return `<div class="pv-pdf">${Array.from({ length: Math.min(2, node.pdf.pages) }, (_, p) => `<div class="pdf-page"><div class="pdf-title" style="width:${50 + p * 10}%"></div>${Array.from({ length: 14 }, (_, i) => `<div class="pdf-line" style="width:${60 + ((i * 37 + p * 13) % 38)}%"></div>`).join("")}</div>`).join("")}</div>`;
  if (node.sheet) {
    const rows = [
      ["Concepto", "Cantidad", "Unitario", "Total"],
      ["Hormigón H21", "18 m³", "$ 142.000", "$ 2.556.000"],
      ["Hierro Ø8", "64 u", "$ 9.800", "$ 627.200"],
      ["Ladrillo hueco", "2.400 u", "$ 610", "$ 1.464.000"],
      ["Mano de obra", "120 h", "$ 11.500", "$ 1.380.000"],
      ["Flete", "3", "$ 85.000", "$ 255.000"],
      ["", "", "Subtotal", "$ 6.282.200"],
    ];
    return `<div class="pv-sheet"><table>${rows.map((r, i) => `<tr>${r.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("")}</table></div>`;
  }
  if (node.archive)
    return `<div class="pv-list">${node.archive
      .map((e) => {
        const isDir = e.endsWith("/");
        const n = { name: e.replace(/\/$/, ""), kind: isDir ? "dir" : "file", hoursAgo: 600, size: 4200, children: [] };
        return `<div class="row" data-kind="${n.kind}"><span class="row-strip"></span>${fileIcon(n)}<span class="row-name">${esc(e)}</span></div>`;
      })
      .join("")}</div>`;
  if (extOf(node) === "txt") {
    const text = `Notas — ${node.name.replace(/\.txt$/, "")}\n\n- Revisar pendientes de la semana\n- Llamar a proveedor por el presupuesto\n- Subir respaldo al disco externo\n\nÚltima edición: ${formatDate(node, "iso")}`;
    return `<div class="pv-code">${codeBlock(text, "plain")}</div>`;
  }
  return `<div class="empty">${icon(typeOf(node).icon, "ico empty-ico")}<span>No preview for this file type</span><span class="empty-sub">Enter opens it with ${defaultApp(node)}</span></div>`;
}

function previewHTML(node) {
  if (!node) return `<section class="col col-preview"><div class="empty"><span>Nothing selected</span></div></section>`;
  if (node.kind === "dir") {
    if (node.ignored)
      return `<section class="col col-preview"><div class="pv-head">${fileIcon(node)}<div class="pv-title"><span class="pv-name">${esc(node.name)}</span><span class="pv-kind">Excluded by scope</span></div></div><div class="empty">${icon("eye", "ico empty-ico")}<span>Ignored by .gitignore</span><button class="btn">Load this folder</button></div></section>`;
    const repo = node.repo;
    const head = cfg.previewProps
      ? `<div class="pv-head">${fileIcon(node)}<div class="pv-title"><span class="pv-name">${esc(node.name)}</span><span class="pv-kind">${typeOf(node).kind} · ${countLabel(node)}</span></div></div>`
      : "";
    const props = cfg.previewProps && repo ? propsHTML([["Branch", `${icon("git-branch")} ${esc(repo.branch)}`], ["Ahead", `${repo.ahead} commits`], ["Modified", formatDate(node, "friendly")]]) : "";
    return `<section class="col col-preview is-dir">${head}${props}${columnHTML(node, "preview", { header: !cfg.previewProps })}</section>`;
  }
  const t = typeOf(node);
  const content = node.content && CONTENT[node.content];
  const lines = content ? content.text.split("\n").length - 1 : null;
  const repo = repoOf(node);
  const props = cfg.previewProps
    ? propsHTML([
        ["Kind", t.kind],
        ["Size", `${formatSize(node.size)}${lines ? ` · ${lines} lines` : ""}`],
        node.dims && ["Dimensions", node.dims],
        node.audio && ["Duration", node.audio.duration],
        node.video && ["Duration", node.video.duration],
        node.pdf && ["Pages", String(node.pdf.pages)],
        ["Modified", formatLongDate(node), "wide"],
        ["Permissions", `<code>${permissions(node)}</code>`],
        node.link && ["Links to", `<code>${esc(node.link)}</code>`],
        repo && ["Git", node.git ? `<span class="git-pill" data-git="${node.git === "?" ? "U" : node.git}">${GIT_LABEL[node.git]}</span>` : "Clean"],
      ])
    : "";
  return `<section class="col col-preview is-file" data-type="${t.icon}"><div class="pv-head">${fileIcon(node)}<div class="pv-title"><span class="pv-name">${esc(node.name)}</span><span class="pv-kind">${t.kind} · ${formatSize(node.size)}</span></div><div class="pv-actions"><button class="icon-btn" title="Open">${icon("arrow-up")}</button><button class="icon-btn" title="More">${icon("ellipsis")}</button></div></div>${props}<div class="pv-body">${previewBody(node)}</div></section>`;
}

// ── Markup: tree ────────────────────────────────────────────────────────────

function treeHTML() {
  const rows = treeRows();
  const rootNode = nodeAt(tree.root);
  const matches = searchMatches(rows.map((r) => r.node));
  const ci = rows.findIndex((r) => r.node.path === tree.cursor);
  const body = rows.length
    ? rows.map((r, i) => rowHTML(r.node, { cursor: i === ci, depth: r.depth, open: r.open, col: "tree", meta: cfg.currentMeta, match: matches.has(r.node.name) })).join("")
    : `<div class="empty">${icon("folder-open", "ico empty-ico")}<span>This folder is empty</span></div>`;
  const metaHead = cfg.currentMeta.length
    ? `<span class="col-meta-head">${cfg.currentMeta.map((m) => `<span class="h-${m}">${m === "size" ? "Size" : "Modified"}</span>`).join("")}</span>`
    : "";
  return `<div class="tree-toolbar">
      <div class="ov-title"><span class="ov-name">File tree</span><span class="ov-sub">${rows.length} entries shown · ${tree.expanded.size} folders open</span></div>
      <div class="ov-tools">
        <button class="btn" data-act="tree-expand">${icon("list-tree")}Expand project</button>
        <button class="btn" data-act="tree-collapse">${icon("minus")}Collapse all</button>
        <button class="btn" data-act="view-miller">Columns <kbd>Esc</kbd></button>
      </div>
    </div>
    <div class="tree-body">
      <section class="col col-tree is-active col-current" data-path="${esc(tree.root)}"><div class="col-head"><span class="col-title">${esc(rootNode.name)}</span><span class="col-count">${listing(rootNode).length}</span>${metaHead}</div><div class="col-body" data-scroll="tree:${esc(tree.root)}">${body}</div></section>
      ${previewHTML(rows[ci]?.node ?? null)}
    </div>`;
}

// ── Markup: chrome ──────────────────────────────────────────────────────────

function crumbsHTML() {
  const parts = [];
  let acc = "";
  for (const seg of state.path.split("/").filter(Boolean)) {
    acc += `/${seg}`;
    parts.push({ label: seg, path: acc });
  }
  const startAt = parts.findIndex((p) => p.path === HOME);
  const shown = startAt >= 0 ? [{ label: cfg.homeLabel, path: HOME, home: true }, ...parts.slice(startAt + 1)] : [{ label: "/", path: "/" }, ...parts];
  return `<nav class="crumbs">${shown
    .map((p, i) => {
      const last = i === shown.length - 1;
      const sep = i ? `<span class="crumb-sep">${icon("chevron-right")}</span>` : "";
      return `${sep}<button class="crumb${last ? " is-last" : ""}" data-go="${esc(p.path)}">${p.home ? `${icon("house", "ico crumb-home")}<span>${esc(p.label)}</span>` : esc(p.label)}</button>`;
    })
    .join("")}</nav>`;
}

function titlebarHTML() {
  const themeBtn = cfg.themeToggle ? `<button class="icon-btn" data-act="theme" title="Toggle theme (T)">${icon(state.theme === "dark" ? "sun" : "moon")}</button>` : "";
  return `<header class="titlebar">
    <div class="tb-group tb-nav">
      ${cfg.sidebar ? `<button class="icon-btn" data-act="sidebar" title="Toggle sidebar (Ctrl+B)">${icon("panel-left")}</button>` : ""}
      <button class="icon-btn" data-act="back" ${state.history.length ? "" : "disabled"} title="Back">${icon("arrow-left")}</button>
      <button class="icon-btn" data-act="forward" ${state.future.length ? "" : "disabled"} title="Forward">${icon("arrow-right")}</button>
    </div>
    ${crumbsHTML()}
    <div class="tb-group tb-tools">
      <button class="search-trigger" data-act="search">${icon("search")}<span>Search</span><kbd>/</kbd></button>
      <div class="segmented" role="tablist">
        <button class="seg${state.view === "miller" ? " is-on" : ""}" data-act="view-miller" title="Columns">${icon("columns-3")}<span>Columns</span></button>
        <button class="seg${state.view === "tree" ? " is-on" : ""}" data-act="view-tree" title="File tree (Ctrl+E)">${icon("list-tree")}<span>Tree</span></button>
        <button class="seg${state.view === "overview" ? " is-on" : ""}" data-act="view-overview" title="Folder overview (Ctrl+O)">${icon("network")}<span>Overview</span></button>
      </div>
      ${themeBtn}
      <button class="icon-btn" data-act="help" title="Keyboard shortcuts (?)">${icon("keyboard")}</button>
    </div>
  </header>`;
}

function tabsHTML() {
  if (!cfg.tabs) return "";
  return `<div class="tabs">${state.tabs
    .map((p, i) => {
      const n = nodeAt(p);
      return `<button class="tab${i === state.activeTab ? " is-on" : ""}" data-tab="${i}"><span class="tab-num">${i + 1}</span>${fileIcon(n)}<span class="tab-name">${esc(n.name)}</span></button>`;
    })
    .join("")}<button class="tab tab-add" title="New tab">${icon("plus")}</button></div>`;
}

function sidebarHTML() {
  if (!cfg.sidebar) return "";
  const item = (p, iconHTML) =>
    `<button class="side-item${state.path === p.path ? " is-on" : ""}" data-go="${esc(p.path)}">${iconHTML}<span>${esc(p.label)}</span></button>`;
  const dev = DEVICES[0];
  return `<aside class="sidebar">
    <div class="side-section"><div class="side-label">Places</div>${PLACES.map((p) => item(p, `<span class="fi" data-tint="side">${icon(p.icon)}</span>`)).join("")}</div>
    <div class="side-section"><div class="side-label">Pinned</div>${PINNED.map((p) => item(p, `<span class="side-dot" data-color="${p.color}" data-initial="${esc(p.label[0].toUpperCase())}"></span>`)).join("")}</div>
    <div class="side-section side-devices"><div class="side-label">Devices</div>
      <div class="side-device">${icon(dev.icon)}<div class="side-device-info"><span>${dev.label}</span><div class="meter"><div style="width:${(dev.used / dev.total) * 100}%"></div></div><span class="side-device-sub">${dev.total - dev.used} GB free of ${dev.total} GB</span></div></div>
    </div>
  </aside>`;
}

function statusHTML() {
  const node = current();
  const { items: list, index: ci } = nav();
  const marked = list.filter((n) => state.marks.has(n.path)).length;
  const mode = state.search.open ? "search" : marked ? "visual" : "normal";
  const repo = repoOf(node);
  let left;
  if (state.search.open) {
    const hits = searchMatches(list).size;
    left = `<label class="status-search">${icon("search")}<input id="search-input" value="${esc(state.search.query)}" placeholder="Search in ${esc(node.name)}" autocomplete="off" spellcheck="false"/><span class="status-hits">${state.search.query ? `${hits} ${hits === 1 ? "match" : "matches"}` : ""}</span></label>`;
  } else if (state.transient) {
    const tr = state.transient;
    const bar = tr.tone === "progress" ? `<span class="progress"><span style="width:${Math.round(tr.progress * 100)}%"></span></span><span class="status-dim">${Math.round(tr.progress * 100)}%</span>` : "";
    left = `<span class="status-msg" data-tone="${tr.tone}">${tr.tone === "success" ? icon("circle-dot") : ""}${esc(tr.text)}</span>${bar}`;
  } else {
    const clip = state.clip ? `<span class="status-chip" data-clip="${state.clip.mode}">${icon(state.clip.mode === "cut" ? "scissors" : "copy")}${state.clip.paths.length} ${state.clip.mode === "cut" ? "cut" : "yanked"}</span>` : "";
    left = `<span class="status-count">${list.length.toLocaleString("en-US")} ${state.view === "tree" ? "entries shown" : "items"}</span>${marked ? `<span class="status-sel">${marked} selected</span>` : ""}${clip}${state.search.committed ? `<span class="status-chip">${icon("search")}“${esc(state.search.committed)}” · n/N</span>` : ""}`;
  }
  return `<span class="mode" data-mode="${mode}">${cfg.modeNames[mode]}</span><div class="status-left">${left}</div>
    <div class="status-right">
      ${repo ? `<span class="status-item">${icon("git-branch")}${esc(repo.repo.branch)}</span>` : ""}
      <button class="status-item" data-act="sort">${icon("arrow-down-up")}${SORT_LABEL[sortFor(node.path)]}</button>
      <span class="status-item${state.showHidden ? "" : " is-off"}">${icon("eye")}Hidden</span>
      <span class="status-pos">${list.length ? ci + 1 : 0}/${list.length}</span>
      <span class="status-hints"><kbd>?</kbd>help</span>
    </div>`;
}

const CHORDS = {
  g: [
    ["g", "Top of list", () => nav().set(0)],
    ["h", "Home", () => go(HOME)],
    ["d", "Downloads", () => go(`${HOME}/Downloads`)],
    ["p", "Projects", () => go(`${HOME}/projects`)],
    ["s", "symmetria-file-manager", () => go(`${HOME}/projects/symmetria-file-manager`)],
    ["w", "Wallpapers", () => go(`${HOME}/Pictures/wallpapers`)],
    ["c", ".config", () => go(`${HOME}/.config`)],
  ],
};

const HELP = [
  ["Navigate", [["j k", "Move down / up"], ["h l", "Parent / open"], ["gg G", "First / last"], ["g …", "Go to place"], ["⌃e", "File tree"]]],
  ["Select", [["Space", "Mark and move"], ["Esc", "Clear marks"], ["y", "Yank (copy)"], ["x", "Cut"], ["p", "Paste here"]]],
  ["Act", [["Enter", "Open"], ["r", "Rename"], ["d", "Move to Trash"], ["/", "Search folder"], ["n N", "Next / previous match"]]],
  ["View", [["⌃o", "Folder overview"], ["o", "Tree: toggle folder"], [".", "Hidden files"], ["s", "Cycle sort"], ["1 2 3", "Switch tab", "tabs"], ["T", "Light / dark", "themeToggle"], ["W", "Change wallpaper", "wallpapers"], ["V", "Glass: ideal / compositor", "wallpapers"]]],
];

function overlaysHTML() {
  let html = "";
  if (state.chord) {
    html += `<div class="whichkey"><div class="wk-head"><kbd>${state.chord}</kbd><span>Go to…</span></div><div class="wk-grid">${CHORDS[state.chord].map(([k, label]) => `<div class="wk-item"><kbd>${k}</kbd><span>${label}</span></div>`).join("")}</div></div>`;
  }
  if (state.help) {
    html += `<div class="scrim" data-act="close-help"></div><div class="help" role="dialog"><div class="help-head"><span>Keyboard shortcuts</span><button class="icon-btn" data-act="close-help">${icon("x")}</button></div><div class="help-grid">${HELP.map(([g, rows]) => `<div class="help-group"><div class="help-label">${g}</div>${rows.filter(([, , needs]) => !needs || cfg[needs]).map(([k, l]) => `<div class="help-row"><span>${l}</span><span class="keys">${k.split(" ").map((x) => `<kbd>${x}</kbd>`).join("")}</span></div>`).join("")}</div>`).join("")}</div></div>`;
  }
  if (state.dialog) {
    const d = state.dialog;
    const list = d.items.slice(0, 4).map((n) => `<div class="dlg-item">${fileIcon(n)}<span>${esc(n.name)}</span></div>`).join("");
    const more = d.items.length > 4 ? `<div class="dlg-more">and ${d.items.length - 4} more</div>` : "";
    const body =
      d.type === "trash"
        ? `<div class="dlg-title">Move ${d.items.length} ${d.items.length === 1 ? "item" : "items"} to Trash?</div><div class="dlg-sub">You can restore them from the Trash later.</div><div class="dlg-list">${list}${more}</div><div class="dlg-actions"><button class="btn" data-act="dlg-cancel">Cancel <kbd>Esc</kbd></button><button class="btn btn-danger" data-act="dlg-ok">Move to Trash <kbd>↵</kbd></button></div>`
        : `<div class="dlg-title">Rename</div><div class="dlg-sub">${esc(displayPath(d.items[0].parent.path))}</div><label class="field">${fileIcon(d.items[0])}<input value="${esc(d.items[0].name)}" spellcheck="false"/></label><div class="dlg-actions"><button class="btn" data-act="dlg-cancel">Cancel <kbd>Esc</kbd></button><button class="btn btn-primary" data-act="dlg-ok">Rename <kbd>↵</kbd></button></div>`;
    html += `<div class="scrim" data-act="dlg-cancel"></div><div class="dialog" role="dialog">${body}</div>`;
  }
  return html;
}

// ── Render ──────────────────────────────────────────────────────────────────

function millerHTML() {
  const node = current();
  const list = listing(node);
  const ci = cursorIndex(node, list);
  const parent = node.parent;
  const parentCol = parent
    ? columnHTML(parent, "parent", { cursorAt: listing(parent).findIndex((n) => n.name === node.name), meta: cfg.parentMeta ? ["size"] : [] })
    : `<section class="col col-parent"></section>`;
  const cur = columnHTML(node, "current", { cursorAt: ci, meta: cfg.currentMeta, active: true });
  return `${parentCol}${cur}${previewHTML(list[ci])}`;
}

function saveScroll() {
  for (const el of root.querySelectorAll("[data-scroll]")) state.colScroll.set(el.dataset.scroll, el.scrollTop);
}
function restoreScroll() {
  for (const el of root.querySelectorAll("[data-scroll]")) {
    el.scrollTop = state.colScroll.get(el.dataset.scroll) ?? 0;
    const cur = el.querySelector(".is-cursor");
    if (cur) {
      const top = cur.offsetTop - el.offsetTop;
      const pad = cur.offsetHeight * 3;
      if (top < el.scrollTop + pad) el.scrollTop = Math.max(0, top - pad);
      else if (top + cur.offsetHeight > el.scrollTop + el.clientHeight - pad) el.scrollTop = top + cur.offsetHeight - el.clientHeight + pad;
    }
  }
}

function renderStatus() {
  const bar = root.querySelector(".statusbar");
  if (bar && !state.search.open) bar.innerHTML = statusHTML();
}

function render() {
  saveScroll();
  const win = root.querySelector(".window");
  win.dataset.view = state.view;
  win.dataset.sidebar = cfg.sidebar && state.sidebarOpen ? "open" : "closed";
  document.documentElement.dataset.theme = state.theme;
  win.querySelector(".titlebar-slot").innerHTML = titlebarHTML() + tabsHTML();
  win.querySelector(".sidebar-slot").innerHTML = sidebarHTML();
  win.querySelector(".miller").innerHTML = state.view === "miller" ? millerHTML() : "";
  win.querySelector(".tree").innerHTML = state.view === "tree" ? treeHTML() : "";
  const bar = win.querySelector(".statusbar");
  bar.innerHTML = statusHTML();
  if (state.search.open) {
    const input = bar.querySelector("input");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  win.querySelector(".overlays").innerHTML = overlaysHTML();
  const dlgInput = win.querySelector(".dialog input");
  if (dlgInput && document.activeElement !== dlgInput) {
    dlgInput.focus();
    const dot = dlgInput.value.lastIndexOf(".");
    dlgInput.setSelectionRange(0, dot > 0 ? dot : dlgInput.value.length);
  }
  if (state.view === "overview") overview.render();
  restoreScroll();
}

// ── Overview (connected folder map) ─────────────────────────────────────────

function openOverview() {
  if (state.view !== "overview") overview.returnTo = state.view;
  state.view = "overview";
}

const overview = {
  returnTo: "miller",
  cam: { x: 32, y: 28, k: 1 },
  focus: 0,
  details: true,
  minimap: true,
  builtFor: null,
  cards: [],
  render() {
    const host = root.querySelector(".overview");
    const rootNode = current();
    if (this.builtFor !== rootNode.path) {
      this.builtFor = rootNode.path;
      this.focus = 0;
      this.cam = { x: 32, y: 28, k: 1 };
    }
    const cards = [];
    const walk = (node, depth, parentIdx, viaName) => {
      const idx = cards.length;
      const excluded = node.ignored || node.name === ".git";
      cards.push({ node, depth, parentIdx, viaName, excluded });
      if (depth < 2 && !excluded) for (const child of listing(node).filter((c) => c.kind === "dir")) walk(child, depth + 1, idx, child.name);
    };
    walk(rootNode, 0, -1, null);
    this.cards = cards;
    const inspected = cards.reduce((s, c) => s + (c.excluded ? 0 : listing(c.node).length), 0);
    host.innerHTML = `<div class="ov-toolbar">
        <div class="ov-title"><span class="ov-name">Folder overview</span><span class="ov-sub">${inspected} entries inspected</span><button class="btn btn-ghost">${icon("sliders-horizontal")}Scope<span class="ov-scope">Depth 2 · gitignore</span></button></div>
        <div class="ov-tools">
          <div class="btn-group"><button class="btn" data-ov="out">${icon("minus")}</button><span class="ov-zoom">${Math.round(this.cam.k * 100)}%</span><button class="btn" data-ov="in">${icon("plus")}</button></div>
          <button class="btn" data-ov="fit">${icon("maximize")}Fit</button>
          <button class="btn" data-ov="rearrange">${icon("layout-grid")}Rearrange</button>
          <button class="btn${this.minimap ? " is-on" : ""}" data-ov="minimap">${icon("map")}</button>
          <button class="btn${this.details ? " is-on" : ""}" data-ov="details">${icon("info")}Details</button>
          <button class="btn" data-act="view-miller">Close <kbd>Esc</kbd></button>
        </div>
      </div>
      <div class="ov-canvas"><div class="ov-world"><svg class="ov-links"></svg>${cards.map((c, i) => this.cardHTML(c, i)).join("")}</div><div class="ov-minimap"></div></div>`;
    host.dataset.details = this.details ? "on" : "off";
    this.layout(host);
    this.bind(host);
  },
  cardHTML(c, i) {
    const list = listing(c.node);
    const cols = c.depth === 0 ? Math.max(1, Math.min(3, Math.ceil(list.length / 10))) : list.length > 12 ? 2 : 1;
    const cap = c.depth === 0 ? 30 : 14;
    const body = c.excluded
      ? `<div class="ov-excluded"><span>Excluded by scope</span><button class="btn">Load this folder</button></div>`
      : `<div class="ov-entries" style="--cols:${cols}">${list
          .slice(0, cap)
          .map((n) => `<div class="ov-entry${n.kind === "dir" ? " is-dir" : ""}" data-name="${esc(n.name)}">${fileIcon(n)}<span>${esc(n.name)}</span>${n.link ? icon("arrow-right", "ico ov-link-ico") : ""}</div>`)
          .join("")}${list.length > cap ? `<div class="ov-more">+${list.length - cap} more</div>` : ""}${list.length ? "" : `<div class="ov-more">Empty</div>`}</div>`;
    return `<div class="ov-card${i === this.focus ? " is-focus" : ""}${c.depth === 0 ? " is-root" : ""}" data-card="${i}"><div class="ov-card-head">${fileIcon(c.node)}<span class="ov-card-name">${esc(c.node.name)}</span><span class="ov-card-count">${c.excluded ? "—" : list.length}</span><button class="ov-collapse">${icon("minus")}</button></div><div class="ov-card-path">${esc(shortPath(c.node.parent?.path ?? "/"))}/</div>${body}</div>`;
  },
  layout(host) {
    const els = [...host.querySelectorAll(".ov-card")];
    const gapX = 96;
    const gapY = 22;
    const colX = [0];
    const widths = [0, 0, 0];
    els.forEach((el, i) => (widths[this.cards[i].depth] = Math.max(widths[this.cards[i].depth], el.offsetWidth)));
    colX[1] = widths[0] + gapX;
    colX[2] = colX[1] + widths[1] + gapX;
    const bottom = [0, 0, 0];
    const rects = [];
    els.forEach((el, i) => {
      const c = this.cards[i];
      const parentRect = rects[c.parentIdx];
      let y = bottom[c.depth];
      if (parentRect) {
        const row = els[c.parentIdx].querySelector(`.ov-entry[data-name="${CSS.escape(c.viaName)}"]`);
        const anchor = parentRect.y + (row ? row.offsetTop : 0) - 18;
        y = Math.max(y, anchor);
      }
      rects[i] = { x: colX[c.depth], y, w: el.offsetWidth, h: el.offsetHeight };
      bottom[c.depth] = y + el.offsetHeight + gapY;
      el.style.transform = `translate(${rects[i].x}px, ${rects[i].y}px)`;
    });
    this.rects = rects;
    const paths = els
      .map((el, i) => {
        const c = this.cards[i];
        if (c.parentIdx < 0) return "";
        const p = rects[c.parentIdx];
        const row = els[c.parentIdx].querySelector(`.ov-entry[data-name="${CSS.escape(c.viaName)}"]`);
        const x1 = p.x + p.w;
        const y1 = p.y + (row ? row.offsetTop + row.offsetHeight / 2 : 20);
        const x2 = rects[i].x;
        const y2 = rects[i].y + 20;
        const mx = (x1 + x2) / 2;
        const hot = i === this.focus || c.parentIdx === this.focus;
        return `<path class="${hot ? "is-hot" : ""}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/><circle cx="${x1}" cy="${y1}" r="3"/><circle cx="${x2}" cy="${y2}" r="3"/>`;
      })
      .join("");
    const w = Math.max(...rects.map((r) => r.x + r.w)) + 40;
    const h = Math.max(...rects.map((r) => r.y + r.h)) + 40;
    this.bounds = { w, h };
    const svg = host.querySelector(".ov-links");
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
    svg.innerHTML = paths;
    this.apply(host);
  },
  apply(host) {
    host.querySelector(".ov-world").style.transform = `translate(${this.cam.x}px, ${this.cam.y}px) scale(${this.cam.k})`;
    const zoom = host.querySelector(".ov-zoom");
    if (zoom) zoom.textContent = `${Math.round(this.cam.k * 100)}%`;
    const mm = host.querySelector(".ov-minimap");
    mm.hidden = !this.minimap;
    if (!this.minimap || !this.rects) return;
    const canvas = host.querySelector(".ov-canvas");
    const inset = 8;
    const s = Math.min(164 / this.bounds.w, 124 / this.bounds.h);
    mm.style.width = `${this.bounds.w * s + inset * 2}px`;
    mm.style.height = `${this.bounds.h * s + inset * 2}px`;
    const box = (x, y, w, h) => `left:${inset + x * s}px;top:${inset + y * s}px;width:${w * s}px;height:${h * s}px`;
    mm.innerHTML =
      this.rects.map((r, i) => `<div class="mm-card${i === this.focus ? " is-focus" : ""}" style="${box(r.x, r.y, r.w, r.h)}"></div>`).join("") +
      `<div class="mm-view" style="${box(-this.cam.x / this.cam.k, -this.cam.y / this.cam.k, canvas.clientWidth / this.cam.k, canvas.clientHeight / this.cam.k)}"></div>`;
  },
  zoom(factor, cx, cy) {
    const host = root.querySelector(".overview");
    const canvas = host.querySelector(".ov-canvas");
    const px = cx ?? canvas.clientWidth / 2;
    const py = cy ?? canvas.clientHeight / 2;
    const k = Math.max(0.25, Math.min(2, this.cam.k * factor));
    this.cam.x = px - ((px - this.cam.x) * k) / this.cam.k;
    this.cam.y = py - ((py - this.cam.y) * k) / this.cam.k;
    this.cam.k = k;
    this.apply(host);
  },
  fit() {
    const host = root.querySelector(".overview");
    const canvas = host.querySelector(".ov-canvas");
    const k = Math.min(1.2, (canvas.clientWidth - 48) / this.bounds.w, (canvas.clientHeight - 48) / this.bounds.h);
    this.cam = { k, x: (canvas.clientWidth - this.bounds.w * k) / 2, y: 24 };
    this.apply(host);
  },
  centerOn(i) {
    const host = root.querySelector(".overview");
    const canvas = host.querySelector(".ov-canvas");
    const r = this.rects[i];
    const inView = r.x * this.cam.k + this.cam.x > 0 && (r.x + r.w) * this.cam.k + this.cam.x < canvas.clientWidth && r.y * this.cam.k + this.cam.y > 0 && (r.y + Math.min(r.h, 300)) * this.cam.k + this.cam.y < canvas.clientHeight;
    if (!inView) {
      this.cam.x = canvas.clientWidth / 2 - (r.x + r.w / 2) * this.cam.k;
      this.cam.y = 60 - r.y * this.cam.k;
    }
  },
  move(delta) {
    this.focus = (this.focus + delta + this.cards.length) % this.cards.length;
    this.render();
    this.centerOn(this.focus);
    this.apply(root.querySelector(".overview"));
  },
  bind(host) {
    const canvas = host.querySelector(".ov-canvas");
    canvas.onwheel = (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = canvas.getBoundingClientRect();
        this.zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
      } else {
        this.cam.x -= e.deltaX;
        this.cam.y -= e.deltaY;
        this.apply(host);
      }
    };
    canvas.onpointerdown = (e) => {
      if (e.target.closest(".ov-card, .ov-minimap")) return;
      const start = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
      canvas.classList.add("is-panning");
      const moveFn = (ev) => {
        this.cam.x = start.cx + ev.clientX - start.x;
        this.cam.y = start.cy + ev.clientY - start.y;
        this.apply(host);
      };
      const up = () => {
        canvas.classList.remove("is-panning");
        window.removeEventListener("pointermove", moveFn);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", moveFn);
      window.addEventListener("pointerup", up);
    };
  },
  key(e) {
    const k = e.key;
    if (k === "Escape" || (k === "o" && e.ctrlKey)) state.view = overview.returnTo;
    else if (k === "+" || k === "=") return this.zoom(1.15);
    else if (k === "-") return this.zoom(1 / 1.15);
    else if (k === "f" || k === "0") return this.fit();
    else if (k === "j" || k === "ArrowDown" || k === "Tab") return this.move(e.shiftKey ? -1 : 1);
    else if (k === "k" || k === "ArrowUp") return this.move(-1);
    else if (k === "Enter" || k === "l") {
      state.view = overview.returnTo;
      go(this.cards[this.focus].node.path);
    } else if (k === "?") state.help = !state.help;
    else return;
    e.preventDefault();
    render();
  },
};

// ── Input ───────────────────────────────────────────────────────────────────

function handleAction(act) {
  const actions = {
    back,
    forward,
    sidebar: () => (state.sidebarOpen = !state.sidebarOpen),
    search: () => (state.search = { open: true, query: "", committed: "" }),
    "view-miller": () => (state.view === "tree" ? closeTree() : (state.view = "miller")),
    "view-tree": () => state.view !== "tree" && (state.view === "overview" && (state.view = "miller"), openTree()),
    "view-overview": openOverview,
    "tree-expand": treeExpandAll,
    "tree-collapse": () => tree.expanded.clear(),
    theme: () => (state.theme = state.theme === "dark" ? "light" : "dark"),
    help: () => (state.help = true),
    "close-help": () => (state.help = false),
    sort: cycleSort,
    "dlg-cancel": () => (state.dialog = null),
    "dlg-ok": confirmDialog,
    play: () => root.querySelector(".pv-audio")?.classList.toggle("is-playing"),
  };
  if (act === "play") return actions.play();
  actions[act]?.();
  render();
}

function cycleSort() {
  const p = state.path;
  const next = SORTS[(SORTS.indexOf(sortFor(p)) + 1) % SORTS.length];
  state.sortByPath.set(p, next);
  flashMessage(`Sorted by ${SORT_LABEL[next].toLowerCase()}`, "info", 1400);
}

function jumpMatch(dir) {
  const { items, index, set } = nav();
  const matches = searchMatches(items);
  if (!matches.size) return;
  for (let step = 1; step <= items.length; step++) {
    const i = (index + dir * step + items.length) % items.length;
    if (matches.has(items[i].name)) return set(i);
  }
}

function onKey(e) {
  if (state.view === "overview" && !state.help) return overview.key(e);
  const k = e.key;
  if (state.dialog) {
    if (k === "Escape") state.dialog = null;
    else if (k === "Enter") confirmDialog();
    else return;
    e.preventDefault();
    return render();
  }
  if (state.search.open) {
    if (k === "Escape") state.search = { open: false, query: "", committed: "" };
    else if (k === "Enter") state.search = { open: false, query: "", committed: state.search.query };
    else if (k === "ArrowDown" || (e.ctrlKey && k === "n")) jumpMatch(1);
    else if (k === "ArrowUp" || (e.ctrlKey && k === "p")) jumpMatch(-1);
    else return;
    e.preventDefault();
    return render();
  }
  if (state.help) {
    if (k === "Escape" || k === "?" || k === "q") {
      state.help = false;
      render();
    }
    return;
  }
  if (e.metaKey || e.altKey) return;
  if (e.ctrlKey) {
    if (k === "b") state.sidebarOpen = !state.sidebarOpen;
    else if (k === "e") state.view === "tree" ? closeTree() : openTree();
    else if (k === "o") openOverview();
    else return;
    e.preventDefault();
    return render();
  }
  const { items: list, index: ci, set } = nav();
  if (state.chord) {
    const hit = CHORDS[state.chord].find(([key]) => key === k);
    state.chord = null;
    if (hit) hit[2]();
    e.preventDefault();
    return render();
  }
  const keymap = {
    j: () => set(ci + 1),
    ArrowDown: () => set(ci + 1),
    k: () => set(ci - 1),
    ArrowUp: () => set(ci - 1),
    l: openCursor,
    ArrowRight: openCursor,
    Enter: openCursor,
    h: goUp,
    ArrowLeft: goUp,
    Backspace: goUp,
    G: () => set(list.length - 1),
    g: () => (state.chord = "g"),
    "~": () => go(HOME),
    " ": () => {
      const n = list[ci];
      if (!n) return;
      if (state.marks.has(n.path)) state.marks.delete(n.path);
      else state.marks.add(n.path);
      set(ci + 1);
    },
    Escape: () => {
      if (state.marks.size) state.marks.clear();
      else if (state.search.committed) state.search.committed = "";
      else if (state.clip) state.clip = null;
      else if (state.view === "tree") closeTree();
    },
    y: () => {
      state.clip = { mode: "yank", paths: targets().map((n) => n.path) };
      state.marks.clear();
      flashMessage(`Yanked ${state.clip.paths.length} ${state.clip.paths.length === 1 ? "item" : "items"} · p to paste`, "info");
    },
    x: () => {
      state.clip = { mode: "cut", paths: targets().map((n) => n.path) };
      state.marks.clear();
      flashMessage(`Cut ${state.clip.paths.length} ${state.clip.paths.length === 1 ? "item" : "items"} · p to paste`, "info");
    },
    p: paste,
    d: () => targets().length && (state.dialog = { type: "trash", items: targets() }),
    r: () => list[ci] && (state.dialog = { type: "rename", items: [list[ci]] }),
    "/": () => (state.search = { open: true, query: "", committed: "" }),
    n: () => jumpMatch(1),
    N: () => jumpMatch(-1),
    ".": () => {
      state.showHidden = !state.showHidden;
      flashMessage(state.showHidden ? "Showing hidden files" : "Hiding hidden files", "info", 1400);
    },
    s: cycleSort,
    "?": () => (state.help = true),
    T: () => cfg.themeToggle && (state.theme = state.theme === "dark" ? "light" : "dark"),
    W: cycleWallpaper,
    V: cycleGlass,
    1: () => switchTab(0),
    2: () => switchTab(1),
    3: () => switchTab(2),
  };
  // The tree's own bindings, as in fm-core's TREE_ONLY rows.
  if (state.view === "tree") {
    Object.assign(keymap, {
      l: treeRight,
      ArrowRight: treeRight,
      h: treeLeft,
      ArrowLeft: treeLeft,
      Backspace: treeLeft,
      o: () => cursorNode() && treeToggle(cursorNode()),
      Enter: () => (cursorNode()?.kind === "dir" ? treeToggle(cursorNode()) : openCursor()),
      Home: () => set(0),
      End: () => set(list.length - 1),
      H: keymap["."],
    });
  }
  const fn = keymap[k];
  if (!fn) return;
  e.preventDefault();
  fn();
  render();
}

/**
 * Glass modes. "ideal" is what CSS can do inside a page (greyscale blur).
 * The others emulate a real Electron window: Hyprland blurs the desktop
 * without desaturating it, so only the opacity of our neutral fill limits
 * the wallpaper's hue. The number is that fill's alpha.
 */
const GLASS = [
  ["ideal", "In-page greyscale (prototype only)"],
  ["c70", "Compositor blur, 70% fill"],
  ["c82", "Compositor blur, 82% fill"],
  ["c90", "Compositor blur, 90% fill"],
];
function cycleGlass() {
  if (!cfg.wallpapers) return;
  const i = (GLASS.findIndex(([id]) => id === (document.documentElement.dataset.glass ?? "ideal")) + 1) % GLASS.length;
  document.documentElement.dataset.glass = GLASS[i][0];
  flashMessage(`Glass: ${GLASS[i][1]}`, "info", 2200);
}

let wallpaperIndex = 0;
function cycleWallpaper() {
  if (!cfg.wallpapers) return;
  wallpaperIndex = (wallpaperIndex + 1) % cfg.wallpapers.length;
  const [seed, label] = cfg.wallpapers[wallpaperIndex];
  applyWallpaper(seed);
  flashMessage(`Wallpaper: ${label}`, "info", 1600);
}
function applyWallpaper(seed) {
  root.querySelector(".desktop").style.setProperty("--wallpaper", artURL(seed, { w: 2560, h: 1600 }).replace(/"/g, "'"));
}

function switchTab(i) {
  if (!cfg.tabs || i >= state.tabs.length) return;
  state.activeTab = i;
  go(state.tabs[i], { record: false });
}

function onClick(e) {
  const t = e.target;
  const actEl = t.closest("[data-act]");
  if (actEl) return handleAction(actEl.dataset.act);
  const ovEl = t.closest("[data-ov]");
  if (ovEl) {
    const a = ovEl.dataset.ov;
    if (a === "in") overview.zoom(1.15);
    else if (a === "out") overview.zoom(1 / 1.15);
    else if (a === "fit") overview.fit();
    else if (a === "rearrange") overview.render();
    else if (a === "minimap") {
      overview.minimap = !overview.minimap;
      overview.render();
    } else if (a === "details") {
      overview.details = !overview.details;
      overview.render();
    }
    return;
  }
  const goEl = t.closest("[data-go]");
  if (goEl) {
    go(goEl.dataset.go);
    return render();
  }
  const tabEl = t.closest("[data-tab]");
  if (tabEl) {
    switchTab(Number(tabEl.dataset.tab));
    return render();
  }
  const card = t.closest(".ov-card");
  if (card) {
    overview.focus = Number(card.dataset.card);
    overview.render();
    return;
  }
  const row = t.closest(".row[data-col]");
  if (!row) return;
  if (row.dataset.col === "tree") {
    tree.cursor = row.dataset.path;
    if (t.closest(".tree-disc")) treeToggle(nodeAt(row.dataset.path));
    return render();
  }
  const col = row.closest(".col");
  const colNode = nodeAt(col.dataset.path);
  if (row.dataset.col === "current") setCursor(colNode, listing(colNode).findIndex((n) => n.name === row.dataset.name));
  else if (row.dataset.col === "parent") go(colNode.path, { cursor: row.dataset.name });
  else if (row.dataset.col === "preview") go(colNode.path, { cursor: row.dataset.name });
  render();
}

function onDblClick(e) {
  const entry = e.target.closest(".ov-entry.is-dir");
  if (entry) {
    const card = overview.cards[Number(entry.closest(".ov-card").dataset.card)];
    go(`${card.node.path}/${entry.dataset.name}`);
    state.view = "miller";
    return render();
  }
  const card = e.target.closest(".ov-card");
  if (card) {
    go(overview.cards[Number(card.dataset.card)].node.path);
    state.view = "miller";
    return render();
  }
  const treeRow = e.target.closest(".row[data-col='tree']");
  if (treeRow) {
    const node = nodeAt(treeRow.dataset.path);
    if (node.kind === "dir") treeToggle(node);
    else openCursor();
    return render();
  }
  if (e.target.closest(".row[data-col='current']")) {
    openCursor();
    render();
  }
}

// ── Mount ───────────────────────────────────────────────────────────────────

const DIRECTIONS = [
  ["studio", "Studio"],
  ["atmosphere", "Atmosphere"],
];

export function mount(config) {
  cfg = { ...DEFAULTS, ...config };
  root = document.body;
  const params = new URLSearchParams(location.search);
  state.tabs = cfg.tabs ? [`${HOME}/Downloads`, `${HOME}/projects/symmetria-file-manager/packages/fm-ui/src/components`, `${HOME}/Pictures/wallpapers`] : [];
  if (params.get("path")) state.path = params.get("path").replace(/^~/, HOME);
  if (cfg.tabs) {
    state.tabs[0] = state.path;
    if (state.tabs[1] === state.path) state.tabs[1] = `${HOME}/Downloads`;
  }
  if (params.get("cursor")) state.cursorName.set(state.path, params.get("cursor"));
  if (params.get("view") === "tree") openTree();
  else if (params.get("view")) state.view = params.get("view");
  for (const p of params.getAll("open")) tree.expanded.add(p.replace(/^~/, HOME));
  if (params.get("theme")) state.theme = params.get("theme");
  if (params.get("glass")) document.documentElement.dataset.glass = params.get("glass");
  const wallParam = cfg.wallpapers?.findIndex(([, label]) => label.toLowerCase() === params.get("wallpaper"));
  if (params.get("demo") === "marks") {
    const list = listing(current());
    state.marks = new Set(list.slice(3, 5).map((n) => n.path));
    state.clip = { mode: "yank", paths: [list[7].path] };
  }
  if (params.get("demo") === "help") state.help = true;
  if (params.get("demo") === "chord") state.chord = "g";
  if (params.get("demo") === "trash") state.dialog = { type: "trash", items: listing(current()).slice(2, 5) };
  if (params.get("demo") === "search") state.search = { open: true, query: params.get("q") ?? "row", committed: "" };

  document.body.innerHTML = `<div class="desktop" style="--wallpaper:${artURL(cfg.wallpaper, { w: 2560, h: 1600 }).replace(/"/g, "'")}">
    <div class="window" data-direction="${esc(cfg.id)}">
      <div class="titlebar-slot"></div>
      <div class="body"><div class="sidebar-slot"></div><main class="stage"><div class="miller"></div><div class="tree"></div><div class="overview"></div></main></div>
      <footer class="statusbar"></footer>
      <div class="overlays"></div>
    </div>
    <nav class="proto-switch"><a href="../index.html">${icon("layout-grid")}</a>${DIRECTIONS.map(([id, name]) => `<a href="../${id}/index.html" class="${id === cfg.id ? "is-on" : ""}">${name}</a>`).join("")}</nav>
  </div>`;
  if (wallParam >= 0) {
    wallpaperIndex = wallParam;
    applyWallpaper(cfg.wallpapers[wallParam][0]);
  }
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onClick);
  document.addEventListener("dblclick", onDblClick);
  document.addEventListener("input", (e) => {
    if (e.target.id !== "search-input") return;
    state.search.query = e.target.value;
    const { items, set } = nav();
    const first = items.findIndex((n) => n.name.toLowerCase().includes(state.search.query.toLowerCase()));
    if (state.search.query && first >= 0) set(first);
    render();
  });
  window.addEventListener("resize", () => state.view === "overview" && overview.render());
  render();
}
