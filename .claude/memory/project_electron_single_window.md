---
name: project-electron-single-window
description: "2026-09-01 — the resident single-window design for the Electron FM: named Hyprland workspace, the picker as a dialog not a window, and the packages split that the Mesura Code embedding needs"
metadata: 
  node_type: memory
  type: project
  originSessionId: 93ba8dd0-4f8f-4159-b85f-f81992fa0bf0
  modified: 2026-09-01T04:04:00.325Z
---

Design settled with the operator on 2026-09-01, for the run after
[[project-electron-v2-backlog]]. Nothing is built yet. This completes the half
of **D3** (`docs/electron-transition/15-decisions.md`) that was never
implemented: "one window" shipped, "resident" did not — `index.ts` quits on
`window-all-closed` while its own comment cites D3.

## The framing that settled the attach question

The operator worried that attaching a file to WhatsApp opens a second window and
breaks the one-window rule. **It does not, because the picker is not a window of
the file manager.** Three surfaces with three lifetimes:

| | Browse window | Picker | Panel in Mesura Code |
|---|---|---|---|
| How many | one, forever | one at a time, per request | one per editor window |
| Returns a value | no | yes — a path list or a cancel | no |
| Own process | the daemon | the same daemon | no, Mesura Code's |

The picker's defining property is that **a caller is blocked waiting** — the
portal holds a D-Bus call open and a reader is blocked on the FIFO. It cannot
accumulate. The one-window discipline is about not accumulating *browse* windows.

## Decisions

1. **Close keeps everything** — tabs, cursor, scroll. The window is never hidden
   and never destroyed.
2. **A named Hyprland workspace `files`**, NOT a special workspace. The operator
   rejected special workspaces already: `~/.dotfiles/.config/hypr/workspaces.conf`
   says the app-owned workspaces "used to be special workspaces … and became
   normal workspaces so their windows stay visible and countable in the bar."
   Follow the Zen / Mesura Code pattern: `workspace = name:files`, a `silent`
   routing rule on class `^(symmetria-fm-electron)$`, and
   `bind = Super, E, exec, $hyprScripts/switch_workspace.sh name:files`.
3. **The picker window: spike before choosing.** Operator prefers a fresh window
   per request if it is not slow. Bar is the research target — p50 under 60 ms,
   p95 under 120 ms, measured warm under `xvfb-run`. This would REVERSE report 10
   §3.4, which recommended a warm hidden singleton — that advice assumed a
   warm-window pool that D3 removed, leaving the picker carrying all of the
   between-uses reset correctness alone.
4. **Order: resident window → packages split → picker.** The split precedes the
   picker because the picker adds the most host code.

## Two consequences that are easy to miss

**The raise problem is gone, not solved.** Report 10 §5.4 calls Wayland
activation the hardest problem in the design. With a named workspace nothing
raises the window — the user switches to where it lives, via their own keybind
and their own `switch_workspace.sh`. The app never calls `show()` or `focus()`.

**The window TITLE becomes a contract.** Chromium sets the Wayland app id once
per process from the desktop name, so the picker cannot have its own app id. It
must therefore be excluded from the `name:files` routing rule **by title**, or
every save dialog is dragged off to the file manager's workspace instead of
appearing over the app that asked. Precedent already in the operator's config:
the Zen rule carries `match:title negative:^(Picture-in-Picture)$` for exactly
this reason.

## The Mesura Code embedding is a packaging problem, not a rewrite

Inside Mesura Code there is **no second process and no second window** — it is
itself Electron, so the FM is a React component in its renderer whose privileged
half registers handlers in Mesura Code's own main process. The seam already
holds: `createRegistry(electronIpcSurface(ipcMain), {send})` takes an injected
surface, and `electronSurface.ts` is the only file in the main process that names
`ipcMain`. The renderer never names the `symmetria-fm://` scheme either —
`previewUrlFor` builds the URL in the main process and it crosses the bridge as
an opaque string, so the UI is already origin-blind. **Lock both properties down
with a test before they drift.**

The split line: **anything naming `BrowserWindow`, `app`, or the scheme is host
code; everything else is a package.** By that test only `index.ts`, `window.ts`,
`protocol.ts` and `main.tsx` stay in `app/`.

## Gaps found while designing this

- `package.json` declares `desktopName: "symmetria-fm-electron.desktop"` and
  **that file does not exist in the repository.** The app-id contract has a
  dangling corner, and it is what the window rule matches.
- The picker's KEYBOARD half is already built and unreachable, like the tree
  view: `PickerState`, the suppression pre-pass in `dispatch.ts`, and
  `isSuppressedInPicker` feeding the help sheet all exist;
  `useKeyActions.ts:224` hardcodes `active: false`. Missing is the window, the
  socket and the dialog chrome (filename field, filter, Accept/Cancel).
