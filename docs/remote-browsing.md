# Browse Vigilia Home

The standalone Electron file manager supports two machines: Local and Vigilia Home.
The service runs in Node on Vigilia Home. Mesura Code can stop without stopping file browsing.

## Interface

- Select the laptop or Home server icon in the vertical lower-left dock. Both buttons show storage usage.
- The compact buttons omit visible labels. Hover or focus a button to see its machine name and storage details.
- Machine controls use neutral colors. The header shows the folder path without a machine selector.
- Press `m` to open the chooser. Press `j` or `k` to move. Press Enter to select. Press Escape to close.
- Press `mm` to toggle machines. Press `ml` for Local. Press `mh` for Vigilia Home.
- The chooser does not intercept search, Flash, an existing chord, or a modal dialog.
- Each machine retains its tabs, folder paths, cursor memory, and navigation history while the window remains open.
- Columns, Tree, and Overview remain independent of the selected machine.
- This first version resets temporary panel state on a machine switch, including search, expanded previews, and the panel clipboard.
- A desktop request to show a local folder returns the window to Local.

Vigilia Home supports directory listings, watches, text reads, and the existing previews.
Enter or a double click on a remote file opens the expanded preview.
Create, rename, delete, paste, external application launches, and the local finder are unavailable on Home.
Home listing preferences and bookmarks remain in main-process memory until the application restarts. They do not write files on Home.

## Start the service

Build the application with `pnpm --filter @symmetria/fm-app build`.
The build produces `app/dist-electron/remote/service.mjs`. This bundle needs Node 24 or newer.
It does not need Electron or repository dependencies at runtime.

Generate a token with `openssl rand -hex 32`. Store it in a private environment file with mode `0600`:

```sh
export FM_REMOTE_TOKEN=<64 lowercase hexadecimal characters>
export FM_REMOTE_BIND=<the server's tailnet IPv4 address>
export FM_REMOTE_PORT=4787
```

The service defaults to `127.0.0.1` if `FM_REMOTE_BIND` is absent.
Bind the service to the tailnet address for laptop access.
The token grants read access to files that the service account can read.
The service refuses file mutations through an explicit request allowlist.

Copy the bundle out of the worktree, then run it as a persistent user unit,
`~/.config/systemd/user/symmetria-fm-remote.service`:

```ini
[Unit]
Description=Read-only Symmetria Home file service
StartLimitIntervalSec=0

[Service]
Slice=mesura-agents.slice
MemoryHigh=512M
WorkingDirectory=/home/dev/.local/share/symmetria-fm-remote
ExecStart=/bin/bash -c '. /home/dev/.config/symmetria-fm-remote/<id>.env; exec /home/dev/.local/share/vite-plus/bin/node /home/dev/.local/share/symmetria-fm-remote/service-<id>.mjs'
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Enable it with `systemctl --user enable --now symmetria-fm-remote.service`.

**Use `Restart=always`, not a one-time launcher.** The user manager starts the
unit at boot before Tailscale assigns the tailnet address, so the first `listen`
fails with `EADDRNOTAVAIL`. A user unit cannot order itself after the system's
`tailscaled.service`. The restart loop covers that race and any later crash.
On 2026-10-14 a oneshot unit that launched the service through
`mesura-agent-service` reported success while the service exited at boot, and
Home stayed offline for 8 days.
`StartLimitIntervalSec=0` keeps systemd from giving up while Tailscale is down.
The unit stays in `mesura-agents.slice`, so it shares the agents' memory budget.
`mesura-agent-reaper` stops only `mesura-agent-*.scope` units, so it never stops this unit.

Check or restart the service:

```sh
systemctl --user status symmetria-fm-remote.service
journalctl --user -u symmetria-fm-remote.service
systemctl --user restart symmetria-fm-remote.service
```

## Configure the laptop

Create `remote.json` in Electron's `userData` directory for this application.
Alternatively, set `SYMMETRIA_FM_REMOTE_CONFIG` to the absolute path of that file before starting Electron.
Use mode `0600` for the file.

```json
{
  "url": "http://<home-server-tailnet-name>:4787",
  "token": "<the same 64-character token>",
  "name": "Vigilia Home"
}
```

Use the service's root URL. The URL must not contain credentials, a query, or a fragment.
Restart the Electron host after changing this configuration.
If configuration is absent or invalid, the host offers Local only. It logs configuration errors.
An offline Home entry remains visible and shows `Offline · reconnecting`.
The window probes the service again after 2, 5 and 10 seconds, then every 30 seconds, and at once when the network returns.
When Home answers, the window opens a new connection and keeps the saved tabs.
Select Home to retry at once.
Connection errors name the cause, for example a refused connection or an unreachable host, in place of the bare `fetch failed`.
The host does not substitute local files for a failed remote request.

## Connection isolation

The preload opens a distinct context for each mounted panel and each storage meter.
The main process owns context identifiers and ties each identifier to its renderer.
Every request, watch, and push stays inside that context.
Closing a context cancels its watches and remote event stream.
Requests that use a closed or foreign context fail.
File-picker windows cannot open Home.

The main process retains the service token. It proxies previews through opaque URLs under the application's origin.
Preview ranges and the HTML Content-Security-Policy remain intact.
Directory preview grants retain the service's containment checks.

## Verification

`pnpm -r test` includes the service integration tests and the native Electron test.
The native test starts a service in plain Node, opens Home through the real sandboxed preload,
reads a preview through the application protocol, and verifies that a mutation request fails.
Renderer tests cover machine switching, tab retention, callback cleanup, and isolation of delayed reads and watches.

The browser study in `app/prototypes/remote-viewer` remains a design preview.
Its Local files are sample data. The native implementation reads the laptop's real files.
