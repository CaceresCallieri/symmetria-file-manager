import { esc, icon } from "../shared/render.js";

// Prototype fixtures isolate interaction design from filesystem and launch APIs.
// Replace these fixtures with connection metadata when this design enters delivery.
const files = [
  {
    name: "deploy.sh",
    type: "script",
    icon: "file-code",
    size: "1.2 KB",
    kind: "Shell script",
    content:
      "#!/usr/bin/env bash\nset -euo pipefail\n\n# Deploy the application\npnpm build\necho 'Ready.'",
    permission: "rwxr-xr-x",
  },
  {
    name: "assets.zip",
    type: "archive",
    icon: "package",
    size: "24.8 MB",
    kind: "ZIP archive",
    content: "assets/\n  fonts/\n  images/\n  icons/\nREADME.md",
    permission: "rw-r--r--",
  },
  {
    name: "Game.exe",
    type: "windows",
    icon: "app-window",
    size: "1.6 MB",
    kind: "Windows executable",
    content: "Windows application\n\nChoose an existing Wine\nenvironment with Run With…",
    permission: "rw-r--r--",
  },
  {
    name: "release.tar.gz",
    type: "archive",
    icon: "package",
    size: "8.3 MB",
    kind: "Compressed TAR archive",
    content: "release/\n  bin/\n  config/\n  LICENSE\n  README.md",
    permission: "rw-r--r--",
  },
  {
    name: "notes.md",
    type: "document",
    icon: "file-text",
    size: "4.1 KB",
    kind: "Markdown document",
    content:
      "# Release notes\n\nA quieter workspace.\nEverything within reach.\n\nReview before publishing.",
    permission: "rw-r--r--",
  },
  {
    name: "wallpaper.png",
    type: "image",
    icon: "image",
    size: "3.2 MB",
    kind: "PNG image",
    content: "Image preview\n\n2560 × 1440\nRGB · 8-bit",
    permission: "rw-r--r--",
  },
  {
    name: "locales",
    type: "folder",
    icon: "folder",
    size: "12 items",
    kind: "Folder",
    content: "en/\nes/\nfr/\nit/\npt/",
    permission: "rwxr-xr-x",
  },
  {
    name: "README.txt",
    type: "document",
    icon: "file-text",
    size: "920 B",
    kind: "Text document",
    content: "Getting started\n\nRead the instructions\nbefore running the program.",
    permission: "rw-r--r--",
  },
];

const fileList = document.querySelector("#file-list");
const menu = document.querySelector("#action-menu");
const dialog = document.querySelector("#action-dialog");
const actionsButton = document.querySelector("#actions-button");
const notice = document.querySelector("#notice");
let cursor = 0;
const marked = new Set();
let capturedTargets = [];
let currentActions = [];
let menuIndex = 0;
let clipboard = null;

function targets() {
  return marked.size ? files.filter((file) => marked.has(file.name)) : [files[cursor]];
}

function focusCursor() {
  document.querySelector(".file-row.cursor").focus({ preventScroll: true });
}

function closeDialog() {
  dialog.close();
  // Restore focus synchronously so the next chord cannot reach a closed form.
  focusCursor();
}

function renderFiles(focus = false) {
  fileList.innerHTML = files
    .map(
      (file, index) =>
        `<div class="file-row ${index === cursor ? "cursor" : ""} ${marked.has(file.name) ? "marked" : ""}" role="option" aria-selected="${marked.has(file.name)}" tabindex="${index === cursor ? 0 : -1}" data-index="${index}"><button class="mark" type="button" tabindex="-1" aria-label="Select ${esc(file.name)}" aria-pressed="${marked.has(file.name)}">${marked.has(file.name) ? "●" : "○"}</button>${icon(file.icon)}<span class="filename">${esc(file.name)}</span><span class="file-size">${file.size}</span></div>`,
    )
    .join("");
  const file = files[cursor];
  document.querySelector("#preview").innerHTML =
    `<span class="preview-label">PREVIEW</span><div class="preview-icon">${icon(file.icon)}</div><h2>${esc(file.name)}</h2><div class="preview-type">${file.kind}</div><div class="preview-content"><pre>${esc(file.content)}</pre></div><dl><dt>Size</dt><dd>${file.size}</dd><dt>Permissions</dt><dd>${file.permission}</dd><dt>Location</dt><dd>Downloads</dd></dl>`;
  document.querySelector("#selection-status").textContent = marked.size
    ? `${marked.size} selected · Space to toggle · Esc to clear`
    : "8 items";
  if (focus) focusCursor();
}

function toggleMark(index) {
  cursor = index;
  const name = files[index].name;
  if (marked.has(name)) marked.delete(name);
  else marked.add(name);
  renderFiles(true);
}

function action(id, label, key, group, extra = {}) {
  return { id, label, key, group, ...extra };
}

// One table supplies menu labels, mnemonic dispatch, and normal-mode shortcuts.
function actionsFor(selection) {
  const single = selection.length === 1;
  const type = single ? selection[0].type : null;
  const allArchives = selection.every((file) => file.type === "archive");
  return [
    ...(single
      ? [
          action(
            "open",
            type === "windows" ? "Open with Wine" : type === "folder" ? "Open Folder" : "Open",
            "Shift+Enter",
            "open",
          ),
          ...(type === "folder" ? [] : [action("open-with", "Open With…", "o", "open")]),
        ]
      : []),
    ...(type === "script"
      ? [action("run", "Run", "r", "open"), action("run-terminal", "Run in Terminal", "t", "open")]
      : []),
    ...(type === "windows" ? [action("run-with", "Run With…", "w", "open")] : []),
    ...(type === "folder" ? [action("terminal", "Open Terminal Here", "t", "open")] : []),
    ...(allArchives
      ? [
          action("extract-here", "Extract Here", "e", "archive"),
          action("extract-to", "Extract To…", "E", "archive"),
        ]
      : []),
    action("cut", "Cut", "x", "clipboard", { direct: "x" }),
    action("copy", "Copy", "y", "clipboard", { direct: "y" }),
    action("paste", "Paste", "p", "clipboard", { direct: "p", disabled: clipboard === null }),
    ...(single
      ? [action("rename", "Rename…", "n", "modify", { direct: "r", hint: "r outside menu" })]
      : []),
    action("compress", "Compress…", "c", "modify"),
    action("trash", "Move to Trash", "d", "modify", { direct: "d", danger: true }),
    action("properties", "Properties…", "i", "properties"),
  ];
}

function openMenu(position) {
  capturedTargets = [...targets()];
  currentActions = actionsFor(capturedTargets);
  menuIndex = currentActions.findIndex((item) => !item.disabled);
  const targetLabel =
    capturedTargets.length === 1
      ? capturedTargets[0].name
      : `${capturedTargets.length} selected files`;
  let previousGroup = "";
  menu.innerHTML = `<div class="menu-target">${esc(targetLabel)}</div>${currentActions
    .map((item, index) => {
      const separator =
        previousGroup && previousGroup !== item.group
          ? '<div class="menu-separator" role="separator"></div>'
          : "";
      previousGroup = item.group;
      return `${separator}<button class="menu-item ${item.danger ? "danger" : ""}" type="button" role="menuitem" tabindex="-1" data-action="${index}" ${item.disabled ? "disabled" : ""} ${item.hint ? `title="${item.hint}"` : ""}><span>${item.label}</span><kbd>${item.key === "Shift+Enter" ? "⇧ Enter" : item.key}</kbd></button>`;
    })
    .join(
      "",
    )}<div class="menu-footer"><span><kbd>j/k</kbd> navigate</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> close</span></div>`;
  menu.hidden = false;
  actionsButton.setAttribute("aria-expanded", "true");
  document.querySelector("#mode").textContent = "ACTIONS";
  const row = document.querySelector(".file-row.cursor").getBoundingClientRect();
  const left = position?.x ?? row.left + Math.min(row.width * 0.5, 180);
  const top = position?.y ?? row.bottom - 4;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(left, window.innerWidth - bounds.width - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12))}px`;
  focusMenuItem();
}

function focusMenuItem() {
  menu.querySelector(`[data-action="${menuIndex}"]`).focus({ preventScroll: true });
}

function closeMenu(restoreFocus = true) {
  menu.hidden = true;
  actionsButton.setAttribute("aria-expanded", "false");
  document.querySelector("#mode").textContent = "NORMAL";
  if (restoreFocus) focusCursor();
}

function moveMenu(delta) {
  do {
    menuIndex = (menuIndex + delta + currentActions.length) % currentActions.length;
  } while (currentActions[menuIndex].disabled);
  focusMenuItem();
}

function describeTargets(selection) {
  return selection.length === 1 ? selection[0].name : `${selection.length} files`;
}

function report(message) {
  notice.textContent = `Simulated · ${message}`;
}

function choices(options) {
  return options
    .map(
      ([value, title, detail], index) =>
        `<label class="choice"><input type="radio" name="choice" value="${esc(value)}" ${index === 0 ? "checked" : ""}><span><strong>${esc(title)}</strong><small>${esc(detail)}</small></span></label>`,
    )
    .join("");
}

function field(label, value, name = "value") {
  return `<label class="field">${label}<input name="${name}" value="${esc(value)}" required></label>`;
}

function showDialog(item, selection) {
  const first = selection[0];
  const subject = describeTargets(selection);
  let body = "";
  let confirm = "Confirm";
  if (item.id === "open-with") {
    const options =
      first.type === "windows"
        ? [
            ["wine", "Wine", "Default application"],
            ["bottles", "Bottles", "Choose a Windows environment"],
          ]
        : first.type === "image"
          ? [
              ["viewer", "Image Viewer", "Default application"],
              ["gimp", "GIMP", "Image editor"],
            ]
          : first.type === "archive"
            ? [
                ["archive-manager", "Archive Manager", "Default application"],
                ["peazip", "PeaZip", "Archive utility"],
              ]
            : [
                ["editor", "Text Editor", "Default application"],
                ["code", "Visual Studio Code", "Code editor"],
                ["terminal-editor", "Neovim", "Runs in a terminal"],
              ];
    body =
      choices(options) +
      '<p class="dialog-hint">Open once. Your default application stays the same.</p>';
    confirm = "Open";
  } else if (item.id === "run-with") {
    body = choices([
      ["wine", "Wine", "Default prefix · ~/.wine"],
      ["bottles", "Bottles", "Choose an existing bottle"],
      ["lutris", "Lutris", "Choose a configured game environment"],
    ]);
    confirm = "Continue";
  } else if (item.id === "choose-environment") {
    body = choices(
      item.provider === "bottles"
        ? [
            ["Applications", "Applications", "Application environment"],
            ["Games", "Games", "Gaming environment"],
          ]
        : [["Game profile", "Game profile", "Configured Wine runner"]],
    );
    confirm = "Run";
  } else if (item.id === "compress") {
    body =
      field("Archive name", `${selection.length === 1 ? first.name : "Downloads"}.zip`) +
      '<label class="field">Format<select name="format"><option>ZIP</option><option>TAR.GZ</option><option>TAR.XZ</option></select></label>' +
      '<p class="dialog-hint">Destination: Downloads</p>';
    confirm = "Compress";
  } else if (item.id === "extract-to") {
    body =
      field("Destination", "/home/jc/Downloads", "destination") +
      '<p class="dialog-hint">Create a separate folder for each archive.</p>';
    confirm = "Extract";
  } else if (item.id === "rename") {
    body = field("Name", first.name);
    confirm = "Rename";
  } else if (item.id === "properties") {
    body = selection
      .map(
        (file) =>
          `<p class="dialog-hint"><strong>${esc(file.name)}</strong><br>${file.kind} · ${file.size}<br>Permissions: ${file.permission}</p>`,
      )
      .join("");
    confirm = "Done";
  } else {
    body = '<p class="dialog-hint">Move the selected items to Trash.</p>';
    confirm = "Move to Trash";
  }
  dialog.innerHTML = `<form><span class="eyebrow">FILE ACTION</span><h2 id="dialog-title">${item.id === "choose-environment" ? `Choose ${item.provider === "bottles" ? "a bottle" : "a game environment"}` : item.label.replace("…", "")}</h2><p class="dialog-target">${esc(subject)}</p>${body}<p class="dialog-hint">Prototype: no files change and no programs launch.</p><div class="dialog-buttons"><button type="button" data-cancel>Cancel</button><button type="submit">${confirm}</button></div></form>`;
  dialog.querySelector("[data-cancel]").addEventListener("click", closeDialog);
  dialog.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const provider = data.get("choice");
    closeDialog();
    if (item.id === "run-with" && provider !== "wine") {
      showDialog({ ...item, id: "choose-environment", provider }, selection);
      return;
    }
    if (item.id === "open-with" && provider === "bottles") {
      showDialog({ ...item, id: "choose-environment", provider }, selection);
      return;
    }
    const detail = [...data.values()].join(" · ");
    report(`${item.label.replace("…", "")} → ${subject}${detail ? ` · ${detail}` : ""}`);
  });
  dialog.showModal();
}

function execute(item, selection) {
  if (!item || item.disabled) return;
  closeMenu(false);
  const subject = describeTargets(selection);
  if (item.id === "copy" || item.id === "cut") {
    clipboard = { selection: [...selection], mode: item.id };
    report(`${item.label} → ${subject}`);
    focusCursor();
  } else if (
    ["open", "extract-here", "paste", "terminal", "run", "run-terminal"].includes(item.id)
  ) {
    report(
      item.id === "extract-here"
        ? `Extract → ${subject} · new folder beside each archive`
        : item.id === "paste"
          ? `Paste → Downloads · ${describeTargets(clipboard.selection)}`
          : `${item.label} → ${subject}`,
    );
    focusCursor();
  } else showDialog(item, selection);
}

fileList.addEventListener("click", (event) => {
  const row = event.target.closest(".file-row");
  if (!row) return;
  closeMenu(false);
  const index = Number(row.dataset.index);
  if (event.target.closest(".mark") || event.ctrlKey || event.metaKey) toggleMark(index);
  else {
    cursor = index;
    marked.clear();
    renderFiles(true);
  }
});

fileList.addEventListener("contextmenu", (event) => {
  const row = event.target.closest(".file-row");
  if (!row) return;
  event.preventDefault();
  cursor = Number(row.dataset.index);
  if (!marked.has(files[cursor].name)) marked.clear();
  renderFiles();
  openMenu({ x: event.clientX, y: event.clientY });
});

menu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) execute(currentActions[Number(button.dataset.action)], capturedTargets);
});
menu.addEventListener("pointermove", (event) => {
  const button = event.target.closest("[data-action]");
  if (button && !button.disabled) {
    menuIndex = Number(button.dataset.action);
    focusMenuItem();
  }
});
actionsButton.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeDialog();
});
document.addEventListener("pointerdown", (event) => {
  if (!menu.hidden && !menu.contains(event.target) && !actionsButton.contains(event.target))
    closeMenu(false);
});
window.addEventListener("resize", () => {
  if (!menu.hidden) closeMenu();
});
window.addEventListener("blur", () => {
  if (!menu.hidden) closeMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (dialog.open) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (!menu.hidden) {
    event.preventDefault();
    if (["j", "ArrowDown", "Tab"].includes(event.key))
      moveMenu(event.shiftKey && event.key === "Tab" ? -1 : 1);
    else if (["k", "ArrowUp"].includes(event.key)) moveMenu(-1);
    else if (["Escape", ";"].includes(event.key)) closeMenu();
    else if (event.key === "Enter")
      execute(
        event.shiftKey
          ? currentActions.find((item) => item.id === "open")
          : currentActions[menuIndex],
        capturedTargets,
      );
    else
      execute(
        currentActions.find((item) => item.key === event.key),
        capturedTargets,
      );
    return;
  }
  if (event.target.closest("input, select, textarea")) return;
  if (event.key === ";" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    openMenu();
  } else if (["j", "k", "ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    cursor = Math.max(
      0,
      Math.min(files.length - 1, cursor + (["j", "ArrowDown"].includes(event.key) ? 1 : -1)),
    );
    renderFiles(true);
  } else if (event.key === " ") {
    event.preventDefault();
    toggleMark(cursor);
  } else if (event.key === "Escape") {
    marked.clear();
    renderFiles(true);
  } else {
    const item = actionsFor(targets()).find((entry) =>
      event.key === "Enter" && event.shiftKey
        ? entry.id === "open"
        : !event.shiftKey && entry.direct === event.key,
    );
    if (item) {
      event.preventDefault();
      execute(item, [...targets()]);
    }
  }
});

renderFiles();
