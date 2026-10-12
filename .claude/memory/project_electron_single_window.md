---
name: project-electron-single-window
description: "2026-09-01 — the Electron FM is now a RESIDENT single-window daemon on the named Hyprland workspace `files`; what was decided, what shipped, and what is still open"
metadata: 
  node_type: memory
  type: project
  originSessionId: 93ba8dd0-4f8f-4159-b85f-f81992fa0bf0
  modified: 2026-09-01T14:55:28.119Z
---

**Built and running.** Designed with the operator on 2026-09-01 and delivered the
same day on branch `t3code/map-electron-file-manager`. The daemon is enabled and
starts at login. This note is the record of *why*, because none of it is
derivable from the code.

**MERGED TO `main` on 2026-09-02** (PR #52, merge commit `6eb9550`). Every path
cited below — `docs/electron-transition/`, `packages/fm-main`, `packages/fm-ui`,
the unit, the desktop entry — is now on `main`. This note previously warned that
they existed only on the branch; that is no longer true.

## What shipped

| Commit | What |
|---|---|
| `a9a703a` | Closing hides the window instead of destroying it; a Unix socket decides who is the daemon; a plain-Node CLI opens a path as a tab |
| `9d96404` | The desktop entry, the systemd unit, an install script, the Hyprland fragment |
| `7a18815` | `packages/fm-main` and `packages/fm-ui`, each with an invariant test |
| `f4f5bc3` | The picker-window spike |
| `4fb5b2f`, `e65e4bc` | Two unit defects found by running it for real |

In `~/.dotfiles`: `0d17e03` and `98ced0c` add the `files` workspace, the routing
rule and the binds.

This **completed the half of the single-window decision** (`docs/electron-transition/15-decisions.md`)
that had never been implemented: "one window" shipped in the first Electron run,
"resident" did not — `index.ts` quit on `window-all-closed` under a comment
citing the very decision it was contradicting. `a9a703a` fixed that.

## The framing that settled the attach question

The operator worried that attaching a file to WhatsApp opens a second window and
breaks the one-window rule. **It does not, because the picker is not a window of
the file manager.** Its defining property is that *a caller is blocked waiting* —
the portal holds a D-Bus call open and a reader is blocked on a FIFO. It cannot
accumulate. The one-window discipline is about not accumulating *browse* windows.

## The four decisions

1. **Close keeps everything** — tabs, cursor, scroll. The window is hidden, never
   destroyed. *Rejected: resetting to home*, which the operator turned down; they
   want a place they return to.
2. **A named Hyprland workspace `files`, NOT a scratchpad.** The operator had
   already rejected special workspaces: `~/.dotfiles/.config/hypr/workspaces.conf`
   records that the app-owned workspaces "used to be special workspaces … and
   became normal workspaces so their windows stay visible and countable in the
   bar." **Reading the destination before designing for it was worth more than
   reasoning from the application side.**
3. **The picker: measured, not assumed.** See *the spike* below.
4. **Order: resident → packages split → picker.** The split preceded the picker
   because the picker adds the most host code.

## The spike answered, and it is close

`docs/electron-transition/23-spike-picker-window.md`. Measured in FRAMES, because
the instrument is `requestAnimationFrame` and cannot resolve below one frame —
**warm takes 2 frames every run; fresh takes 4 to 7.** The recommendation is
**fresh, on architecture alone**: a window never used has no state to reset, so
that defect class cannot be written. The speed evidence favours warm and grew
stronger at every correction. **Not settled** — build the picker fresh, measure
the whole path (socket, validation, FIFO, window), and switch to warm if the
total approaches where a person notices.

The document was wrong twice before it was right, both times by reading the
instrument's resolution as signal. If a measurement here ever looks bimodal,
divide by 16.7 ms before theorising.

## Three things a future agent must not re-derive

**The raise problem is gone, not solved.** Nothing calls `show()` or `focus()`.
The operator switches to where the window lives, so Wayland's activation-token
problem — which the research calls the hardest problem in the design — never
arises.

**The picker's window TITLE is a contract.** Chromium sets the Wayland app id
once per process from the desktop name, so a dialog cannot have its own. The
routing rule therefore excludes the picker by title
(`match:title negative:^(Choose a file.*)$`). When the picker is built its title
must start with "Choose a file" or it lands on the wrong workspace.

**Two exit codes are load-bearing.** `69` means another daemon holds the socket;
`78` means the application directory is gone. The unit exempts exactly those from
`Restart=always`. It said `1` first, which also matched Node's uncaught-exception
exit and the launcher's failed build — telling systemd to give up after a real
crash. Do not simplify these back to 1.
