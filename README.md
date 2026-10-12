<p align="center">
  <img src="assets/symmetria-fm.png" width="128" alt="Symmetria File Manager">
</p>

<h1 align="center">Symmetria File Manager</h1>

A keyboard-first Electron file manager. The standalone application and the panel embedded in Mesura Code share the same TypeScript packages.

## Features

- Miller columns and a file tree with Vim-style navigation, selection, chords, and Flash navigation.
- A file finder with path search, content search, and a command palette.
- Previews for text, images, PDF, HTML, audio, video, archives, and spreadsheets.
- A reader that expands the current preview.
- Tabs, bookmarks, file operations, and optional zoxide navigation.
- Desktop file dialogs, folder associations, and “Show in folder” through D-Bus.

## Development

Use Node.js 24 or later and the pnpm version declared in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm --filter @symmetria/fm-app build
pnpm --filter @symmetria/fm-app start
```

Run the tests with each package's configuration:

```bash
pnpm -r test
```

Read `AGENTS.md` for the deterministic checks and the required production build after a test run.

## Desktop installation

For an independent laptop release, follow `docs/electron-transition/35-laptop-release.md`. This installation survives deletion of a development worktree.

For a development checkout:

```bash
./install-desktop-integration.sh
./portal/install-portal-electron.sh
./portal/install-filemanager1.sh
```

The portal installer creates a Python virtualenv with `dbus-fast`. It does not change portal routing. Select `symmetria-electron` for FileChooser in `~/.config/xdg-desktop-portal/portals.conf` when you want Symmetria to answer file dialogs.

The CLI opens a directory or shows an item in its parent:

```bash
symmetria-fm-electron-cli open ~/Downloads
symmetria-fm-electron-cli reveal /path/to/file
```

## Embedding

The file-manager panel lives in `packages/fm-ui`. The independent finder lives in `packages/fm-search`. Read each package's README for its host contract. Mesura Code consumes `packages/` through a git subtree.

Electron replaces the retired native application. Symmetria Shell owns its filesystem model. Symmetria-IDE is retired. Git history retains the previous implementation and migration inventories.

## License

MIT. See `LICENSE`.
