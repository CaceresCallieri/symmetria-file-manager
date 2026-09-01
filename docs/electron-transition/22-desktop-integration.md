# 22 — The desktop integration: entry, unit, and the workspace it lives on

What the resident daemon needs from the desktop, and the exact lines to add. The
entry, the unit and the install script live in this repository; the Hyprland
fragment below belongs in the operator's dotfiles and **is not applied by
anything in this repository**.

## The identifier contract

Three strings must be `symmetria-fm-electron`, and they fail differently:

| Corner | Where | What breaks when it drifts |
|---|---|---|
| the entry's basename | `symmetria-fm-electron.desktop` | the portal's app-info lookup, silently |
| `desktopName` | `app/package.json` | Chromium's Wayland `app_id`, so the window rule stops matching |
| `StartupWMClass` | inside the entry | nothing here — a launcher and XWayland hint only |

**Only the first two are load-bearing.** Electron 41 has no
`app.setDesktopName()`; it reads the name from `desktopName`, hands it to
Chromium, and Chromium sets `xdg_toplevel.set_app_id` from it. That is what a
compositor rule matches. `StartupWMClass` drives nothing — editing it to fix a
window rule will do nothing at all — and is kept in step only so the three never
disagree. `app/test/desktopEntry.test.ts` asserts all three.

Deliberately **not** `symmetria-fm`, which is the Qt build's. The two run side by
side until parity and the operator uses the Qt one daily.

## The Hyprland fragment

Three files in `~/.dotfiles/.config/hypr/`, following the pattern the browser and
the editor already use. **Add these by hand and reload the compositor yourself.**

```conf
# ── workspaces.conf, beside name:browser and name:agents ──
workspace = name:files

# ── windowrules.conf, beside the zen and mesura-code rules ──
# `silent` is not optional. The operator's own comments on the Zen and Mesura
# Code rules say why: without it every relaunch yanks them off whatever
# workspace they were working on, and this daemon relaunches on every rebuild.
#
# The title exclusion is what keeps a SAVE DIALOG off this workspace. Chromium
# sets the Wayland app id once per PROCESS, from the desktop name, so a dialog
# cannot have an id of its own — the title is the only discriminator there is.
# Without this, every "attach a file" dialog would be dragged here instead of
# appearing over the application that asked for it. The precedent is the Zen
# rule, which excludes Picture-in-Picture in exactly this way for exactly this
# reason: one class, two kinds of toplevel.
#
# ⚠ THIS MAKES THE PICKER'S WINDOW TITLE A CONTRACT. The picker does not exist
# yet; when it is built its title must start with "Choose a file", or it will
# land on the wrong workspace. Whoever changes a window title for cosmetic
# reasons is the person this breaks.
windowrule = workspace name:files silent, match:class ^(symmetria-fm-electron)$, match:title negative:^(Choose a file.*)$

# ── keybindings.conf, beside the Super+B and Super+A group ──
#
# ⚠ REPLACE, DO NOT ADD. `keybindings.conf` line 45 already binds Super+Shift+E:
#
#     bind = Super+Shift, E, exec, $HOME/.local/bin/symmetria-fm-electron
#
# DELETE that line. Hyprland fires EVERY bind matching a chord, so leaving it in
# place means one press both switches workspace and tries to launch the
# application again — which is the opposite of the design here, where nothing
# ever launches or raises anything and the operator simply goes to where the
# window lives. Review caught this against the live config.
#
# Super+E stays with the Qt build, which is still the daily driver. The Electron
# one keeps the secondary binding until the operator moves it deliberately.
bind = Super+Shift, E,       exec, $hyprScripts/switch_workspace.sh name:files
bind = Super+Shift+Ctrl, E,  movetoworkspace,       name:files
```

The launcher that old bind pointed at is now `bin/symmetria-fm-electron` in this
repository, linked onto the PATH by the install script. Nothing needs to launch
it by hand: the systemd unit starts it at login, and after that the workspace is
where you go.

**Nothing raises the window.** That is the point of a named workspace rather than
a scratchpad: the operator switches to where the window lives, using their own
key and their own `switch_workspace.sh`. The application never calls `show()` or
`focus()`, so Wayland's activation-token problem — which the research calls the
hardest problem in this design — is deleted rather than solved.

A scratchpad was considered and rejected, and not by us: `workspaces.conf`
records that the app-owned workspaces "used to be special workspaces (overlays
toggled on top of the current one) and became normal workspaces so their windows
stay visible and countable in the bar."

## Applying it

```bash
./install-desktop-integration.sh    # links the entry, the unit and the CLI; enables the unit
```

The script starts nothing and touches no compositor. Then, in either order:

1. add the fragment above and reload Hyprland;
2. log out and back in, or `systemctl --user start symmetria-fm-electron.service`
   once the compositor knows where to put the window.

## Verifying

```bash
systemctl --user status symmetria-fm-electron.service
systemctl --user show-environment | grep WAYLAND_DISPLAY   # must be set, or the daemon cannot paint
hyprctl clients -j | jq -r '.[] | select(.class=="symmetria-fm-electron") | .workspace.name'
```

An empty `WAYLAND_DISPLAY` in the user manager is the failure that looks like a
broken application: the unit starts, cannot reach the compositor, and either
restarts forever or serves windows nobody can see.
