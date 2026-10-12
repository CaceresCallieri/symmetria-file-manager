# 24 — The file picker, as built

The Electron file manager can answer a system file dialog. This is what was
built, what a witness observed, what it costs, and the one thing that is
deliberately not switched on.

## What it does

A caller asks the desktop for a file. The portal creates a FIFO, blocks reading
it, and asks the daemon for a dialog. The daemon opens a second window on the
workspace the caller is on, the user chooses, and the chosen paths come back on
the FIFO. Every way out of the dialog writes to it — confirm, cancel, the
window closing, a `closePicker`, a request turned away, and the dialog
outliving the caller entirely.

Observed, driving a launched daemon under a virtual display: `/etc/xattr.conf`
came back on the pipe; a save dialog returned `/tmp/notes.txt` rather than the
highlighted file; a folder dialog refused a file with Accept greyed out; Escape
sent `__PICKER_CANCELLED__`; and `p` did not paste, which is the first time the
ported suppression has ever been reachable.

## Where it opens

On Hyprland the picker floats over the application that asked for it, at 90%
of that window's size and centred on it. It stays there until the user
chooses or presses Escape. The operator chose this over a layer surface and
over a separate full-size window: Electron cannot create a `layer-shell`
surface, and a layer is anchored to monitor edges and shown on every
workspace, which is wrong for a dialog that belongs to one window.

`app/src/main/pickerPlacement.ts` does it. Each fact below was measured on
Hyprland 0.56.2, and each one is a reason the code looks the way it does:

- **The caller is the focused window at request time.** The portal sends an
  `xdg-foreign` parent handle that Electron cannot import, so the focused
  window, read from `j/activewindow` before the picker is constructed, stands
  in for it. With no focused window the picker covers 90% of the focused
  monitor.
- **The position is a window rule, applied when the picker maps.** A Wayland
  client cannot place its own window. The daemon sets the rule, and only then
  shows the window, because showing is what maps it.
- **The rule is named, `windowrule[symmetria-fm-picker]`, and rewritten in
  place.** An anonymous rule per request stays in Hyprland until the next
  config reload. Every field is written every time, so a reload that deleted
  the rule cannot leave it partial.
- **The rule is off while it is rewritten.** Hyprland applies a `[[BATCH]]`
  request by request with no rollback, so a refused field would leave the
  other fields applied. The batch starts with `enable false`, and a separate
  `enable true` follows only when every field was accepted. A placement that
  gives up for any reason sends `enable false` too, because a rule left on by
  the PREVIOUS picker would otherwise place this one over the wrong window.
  Verification observed exactly that before the gate existed.
- **A rule's `move` is relative to the monitor, and the rule names it.**
  `at` from `j/activewindow` is global, and on the laptop the panel starts at
  x=1920. Hyprland maps a window on whichever monitor has focus at map time,
  so the rule also sets `monitor <caller's monitor>`.

Placement is best effort and shares one 300 ms budget across its three
requests (query, staged rule, switch-on). The switch-off on giving up has its
own 150 ms outside that budget, because a spent budget is one of the reasons
to give up, and a switch-off inside it would never be sent. A dialog therefore
waits at most 450 ms; a healthy compositor answers in a few milliseconds.
Outside Hyprland, on X11, with the socket absent, or with a refused keyword,
the picker opens unplaced at its own 900×600. Every test, bench and release-check
launch runs `--ozone-platform=x11` and inherits the developer's
`HYPRLAND_INSTANCE_SIGNATURE`; the X11 check is what keeps those launches from
rewriting the rule in a live session.

## What it costs

Two halves, measured separately because nothing can measure them together from
outside the process.

| Half | p50 | p95 | Instrument |
|---|---|---|---|
| socket write → daemon reply | **9.8 ms** (0.59 frame) | 11.8 ms (0.71 frame) | `app/bench/pickerPath.mjs`, 20 iterations against a real daemon |
| window construction → paint | 4 frames | 7 frames | `app/bench/pickerWindow.mjs`, the earlier spike |

The first half covers the socket round trip, JSON decoding, the FIFO-path
validation, the one-at-a-time check and `new BrowserWindow`. It does NOT cover
paint: no external observer can see a first frame, and instrumenting the product
to report one would measure the probe.

**A fresh dialog therefore costs roughly 5 to 8 frames, 83 to 133 ms.** A warm
one would be about 2.6 frames, 43 ms.

### The fresh-versus-warm decision, closed

**Fresh stays.** The complete number does not change it.

The spike recommended fresh on architecture — a window never reused has no state
to reset, so that defect class cannot be written — while the speed evidence
favoured warm and grew stronger at every correction. It left the decision open
pending this measurement, on the grounds that the socket, the validation and the
FIFO open were all missing from the figure.

They are in it now, and they are **under one frame between them**. The gap
between fresh and warm is the paint, exactly as the spike measured it, and
nothing this phase added moved it. A ~60 ms difference on an action a person
takes deliberately, a few times a day, does not buy the between-uses reset
correctness that a single warm window in the whole application would have to
carry alone.

Two figures to keep in mind if this is ever revisited. `requestToReply` is not
quantised — it is a socket round trip, not a frame clock — so its 0.59 is a real
0.59 and not a rounding of one. The paint half IS quantised, and the earlier
document was wrong twice by reading that quantisation as signal; divide by
16.667 before theorising about it.

## The portal registration

`portal/symmetria_electron_portal.py` implements FileChooser. It defaults to `symmetria-fm-electron-cli` and `org.freedesktop.impl.portal.desktop.symmetria-electron`. The systemd unit supplies the installed CLI's absolute path.

```bash
./portal/install-portal-electron.sh
```

The installer creates its own virtualenv with `dbus-fast`. It does not change routing or start services. For a new installation, select the backend in `~/.config/xdg-desktop-portal/portals.conf`:

```ini
[preferred]
org.freedesktop.impl.portal.FileChooser=symmetria-electron
```

Restart `xdg-desktop-portal-symmetria-electron.service` after replacing its script. Restart `xdg-desktop-portal` after changing routing. The portal router also needs its GTK Settings backend ready; check the router's service status if activation stalls.

## Proven against the real bus

The backend was installed, started on its own name, and driven with a real
D-Bus `OpenFile`:

```
CALL:    OpenFile on the Electron backend
backend: Created FIFO: /tmp/symmetria-picker-9eeeff8e…
backend: Launching createPicker: symmetria-fm-electron-cli createPicker {…}
DISMISS: closing the dialog on /tmp/symmetria-picker-9eeeff8e…
backend: Picker cancelled
REPLY:   code=1 results={} after 3.1s
```

The backend exposes `OpenFile`, `SaveFile` and `SaveFiles`. The chain is D-Bus → portal script → command-line tool → daemon → picker window → FIFO → D-Bus reply.

⚠ **The first attempt failed, and the reason is worth keeping.** The daemon had
been running since login, from before the picker existed, and answered
`unknown command: createPicker` — so the portal launched the tool, the tool was
refused, and nothing opened while the caller waited out its timeout. The
systemd unit builds on FIRST RUN ONLY; it does not rebuild on start. **After
changing the daemon, `systemctl --user restart symmetria-fm-electron.service`
or the portal talks to yesterday's code**, and the symptom is a dialog that
never appears rather than an error anybody sees.

## What is still not proven

- **The switch itself.** Nothing has verified that `xdg-desktop-portal` selects
  this backend when told to, because telling it means taking the operator's
  working dialogs down and restarting a session service they are using.
- **Typing a replacement filename** into the save field. There is no window
  manager under a bare virtual display, so `xdotool windowactivate` fails and
  there is no dependable route into that text input. Confirming with the
  suggested name works.
- **The 305-second default picker expiry.** Only the
  `SYMMETRIA_FM_PICKER_LIFETIME_MS` override was exercised; the constant itself
  is pinned by a unit test rather than by observation.
