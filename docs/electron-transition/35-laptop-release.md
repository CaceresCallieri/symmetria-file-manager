# Laptop release installation

The laptop's Electron installation must remain independent of development
worktrees. The operator requested this boundary because feature work must not
remove or overwrite the application they use. Do not relink the laptop's desktop
integration with `install-desktop-integration.sh`: that script installs a
worktree for development. Use the release installer instead.

Keep the current release until a replacement passes the repository checks and
the release checks. Updates are manual: the agent installs a new release only
when the operator requests an update. This policy does not deploy feature edits.
The installer retains previous releases and integration backups. It restores
the previous integration if the replacement daemon fails to accept a command.
It restarts only `symmetria-fm-electron.service`. Never restart the Qt daemon as
part of a release installation.

## Build and transfer

Run the repository suite as `pnpm -r test`. Run the change-scoped deterministic
checks in `AGENTS.md`. Package after the suite because the suite overwrites the
bundle with a development build.

Set `LAPTOP` to the laptop's SSH user and full tailnet host name. Obtain the
full host name from `tailscale status` before transfer.

```bash
# The destination must not exist. The command builds a production bundle.
pnpm --filter @symmetria/fm-app release:pack /tmp/symmetria-fm-release
ELECTRON_RUN_AS_NODE=1 /tmp/symmetria-fm-release/runtime/electron \
  /tmp/symmetria-fm-release/app/scripts/verify-release.mjs

tar -C /tmp/symmetria-fm-release -czf /tmp/symmetria-fm-release.tar.gz .
sha256sum /tmp/symmetria-fm-release.tar.gz
LAPTOP='jc@<laptop-tailnet-host>'
rsync -a --partial-dir=.rsync-partial /tmp/symmetria-fm-release.tar.gz \
  "$LAPTOP:/home/jc/Downloads/"
ssh "$LAPTOP" \
  'sha256sum /home/jc/Downloads/symmetria-fm-release.tar.gz'
```

Compare the hashes before installation. Extract into a new staging directory,
then run its installer. The laptop requires `xvfb-run` for the release checks.
The installed application carries its own Electron runtime and native finder
dependencies. The CLI and the bootstrap installer use bundled Electron in Node
mode (`ELECTRON_RUN_AS_NODE=1`). System Node and pnpm are needed only on the build
machine. The laptop does not need a source checkout or a build step at startup.

```bash
mkdir /home/jc/Downloads/symmetria-fm-release
tar -xzf /home/jc/Downloads/symmetria-fm-release.tar.gz \
  -C /home/jc/Downloads/symmetria-fm-release
/home/jc/Downloads/symmetria-fm-release/install-electron-release.sh \
  /home/jc/Downloads/symmetria-fm-release
```

The laptop stores releases under
`/home/jc/.local/share/symmetria-fm-electron/releases/`. Desktop integration points
through `/home/jc/.local/share/symmetria-fm-electron/current`. The installer prints
the previous integration backup. Retain the previous release for recovery.

The release checks use a virtual X display and a separate socket. They do not
reach the desktop daemon. Installation restarts the desktop daemon and closes
its Electron windows. The installer opens the home folder after startup to
confirm that the replacement daemon accepts commands.
