# File-manager parity: capability map and proposed design

## Status and scope

This document is a design proposal, not an approved implementation plan.
GNOME Files (Nautilus) is the comparison baseline.
The first target is local files in the standalone Electron application.
Shared package changes must also support embedding without requiring a host to implement desktop launch capabilities.

Parity means that a user can complete the same file task. Symmetria can retain its keyboard navigation, Miller columns, tree, and previews.
Wine, Bottles, and Lutris integration are additional desktop integrations. Do not treat them as built-in GNOME Files features.

## Capability map

The current-state assessment comes from the bridge contract, operation implementations, key registry, preview router, and remote-browsing documentation.
“Missing” means no dedicated operation was found in the inspected active Electron implementation. It does not mean that an external application cannot perform the task.

| Task | Current Symmetria support | Proposed addition |
| --- | --- | --- |
| Open with the desktop default | Present; includes a special terminal-app route | Preserve the action and improve launch handling |
| Choose another application | Missing | Open With chooser |
| Change the default application | Missing | Explicit setting for a file type |
| Inspect archive contents | ZIP, TAR, and gzip TAR preview | Preserve preview; distinguish preview formats from extraction formats |
| Extract an archive | Missing | Extract Here and Extract To… |
| Create an archive | Missing | Compress… for files and directories |
| Run a script or native executable | No dedicated action | Run and Run in Terminal |
| Change executable permission | Missing | Properties action with an executable control |
| Launch a Windows program | Desktop default may delegate to an installed handler | Explicit Wine and Bottles choices; later Lutris integration |
| Copy, move, rename, create, and trash | Present for local files | Reuse existing operations |
| View and restore Trash | No dedicated operation in the bridge | Separate parity workstream |
| Undo operations | Deliberately absent | Separate operation-history design |
| Inspect and edit file properties | Preview metadata exists; no full properties operation | Properties dialog; permission changes as a distinct operation |
| Create symbolic links | No dedicated operation in the bridge | Separate link operation |
| Open a folder in a terminal | No dedicated operation in the bridge | Open Terminal Here |
| Browse another machine | Home is read-only | Keep mutations and launches unavailable there |
| Mount/eject drives and browse standard network locations | Not established by the current desktop bridge | Separate device and network inventory |
| Extend actions with scripts or plugins | No general action provider found | Defer until built-in actions establish the contract |

GNOME documents alternate applications and type-wide defaults here:
https://help.gnome.org/gnome-help/files-open.html

GNOME's operation implementation contains extraction and compression jobs:
https://github.com/GNOME/nautilus/blob/main/src/nautilus-file-operations.c

GNOME documents the broader task surface here:
https://help.gnome.org/gnome-help/files.html
https://apps.gnome.org/Nautilus/

This map is not a claim of complete parity. Drag-and-drop, desktop clipboard interoperability, batch rename, metadata, accessibility, and device behavior need a later task-by-task audit.

## One action model

Use one action definition for the keyboard, command palette, and context menu.
Each action defines an identifier, label, target rules, availability, and executor.
Availability depends on the selected machine, host capabilities, entry metadata, selection count, and picker mode.
The backend must validate requests even when the interface disables an action.

Reuse the existing operation-target model. Capture paths, machine identity, and destination when the action starts.
Opening a dialog must not let a later cursor move or machine switch change its target.
Close a dialog tied to a connection when that connection disappears.
Completion must update only the originating view if it still owns the operation.

For a right click on an unselected item, target that item.
For a right click inside a selection, target the selection.
Do not silently apply a single-file action to the first of several selected files.
Disable actions in a file picker when they can launch a program or mutate files outside the picker's intended workflow.

The existing key registry and operation-target adapters provide prior art.
A general context menu and a palette of file actions are proposed surfaces; the README's command-palette claim does not establish this action model.
Keep the independent finder package free of panel dependencies.

## Proposed interactions

### Open With

1. The user selects a file and invokes Open With….
2. The chooser shows the default application and recommended applications for its MIME type.
3. The user can search all installed applications.
4. Open launches the chosen application once.
5. A separate Set as Default action states that it changes the default for every file of that type.

For multiple files, show only applications that can handle the whole selection.
Respect applications that accept one file per launch and applications that accept a list.
For the first version, keep mixed-type selection unavailable unless the application compatibility rules are implemented.
Do not introduce an arbitrary shell-command field in the first version.

Use the desktop's application registry and association rules, rather than maintaining a second association store.
GIO AppInfo provides application discovery, launch, and default-setting APIs:
https://docs.gtk.org/gio/iface.AppInfo.html

A small GIO-backed helper is a candidate, not a selected dependency.
An implementation spike must establish packaging, invocation, Flatpak exports, terminal support, and behavior outside GNOME.
`gio launch` alone does not provide the complete application-discovery contract.

The existing terminal route splits the desktop entry's Exec value on whitespace and removes field codes.
That can mishandle quoted arguments and field-code semantics. Replace that route through the same launch adapter before extending it.
The desktop-entry specification defines these semantics:
https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html

### Archives

An archive offers Preview, Open With…, Extract Here, and Extract To….
A selection of ordinary files or directories offers Compress….
Selecting an archive continues to preview it. Extraction is an explicit action.

Proposed Extract Here behavior: create a uniquely named directory beside the archive, extract into it, then reveal it.
This avoids scattering files into the current directory. It is a proposed Symmetria behavior, not an assertion about Nautilus naming rules.
Extract To… chooses a destination and uses the same directory-creation policy.
For several archives, create one result directory per archive.
Compress… asks for the archive name, format, and destination.

Start with ZIP and TAR variants. Add 7z and RAR extraction only when a selected backend reports support.
Show formats from backend capabilities. An unsupported preview must not prevent extraction by a capable backend.
Decide encrypted archives, passwords, split archives, and compression formats explicitly before implementation.

Keep the current archive index readers in the sandboxed renderer for previews.
They are not extraction engines. Do not move them into the privileged process to write archive members.
Evaluate a maintained extraction backend in a worker or helper process.
Reuse progress, cancellation, conflict decisions, and refresh behavior from transfers where their semantics match.

Extraction must prevent writes outside the result directory, including through symbolic links and hard links.
Define limits for expanded bytes, entry count, depth, and disk space.
Use private staging under the chosen destination and publish the result only after success.
Cancellation or failure must clean staging and preserve the archive and existing files.
Compression must exclude its own output and report unreadable inputs.

### Scripts and native programs

A script offers Open, Open With…, Run, and Run in Terminal when supported.
Properties exposes executable permission without changing it during Open.
Do not decide execution from the `.sh` suffix alone.
Inspect executable permission and interpreter metadata in the backend.

Run uses the executable file and its shebang. Run in Terminal uses the same execution rules inside the terminal.
A missing executable permission produces an explanation and a separate Make Executable action.
A missing or unusable interpreter produces an error. Do not silently force every script through Bash.
Any later Run with Interpreter action must name the interpreter explicitly.
Native executables use their absolute path.
AppImage and desktop launchers need separate behavior and trust decisions; do not group them under `.sh` handling.

Proposed working directory: the program's containing directory.
If arguments are exposed, represent them as an argument list and explain the working directory in the run dialog.
Preserve Open as the document/application association action.
Give terminal runs a readable exit result so a short-lived terminal does not conceal errors.
Report launch failure separately from a program's later non-zero exit.
Launched applications must survive closing the file manager.

### Windows programs

For a supported local Windows executable, offer Open With… and Run With….
The latter shows installed providers and requires an environment choice where applicable.
Do not create an environment or install dependencies as a side effect of opening a file.

**Wine directly:** lowest integration cost. The user selects a Wine prefix or explicitly accepts the default prefix.
The prefix holds the program's Windows environment and configuration.
Launch an `.exe` with Wine. Treat `.msi` as a separate installer action that uses the Windows installer.
Arguments and the prefix are structured backend inputs, not a shell string.
The Wine manual documents program arguments and WINEPREFIX:
https://man.archlinux.org/man/wine.1.en

**Bottles:** the user selects an existing bottle. Bottles owns runner and dependency configuration.
Its CLI provides JSON output, bottle enumeration, and executable launch with a bottle name.
Support native and Flatpak installations only after verifying both routes.
Check file visibility inside the Flatpak sandbox and show a clear error when the executable is inaccessible.
Do not silently broaden Flatpak permissions.
https://docs.usebottles.com/advanced/cli
https://docs.usebottles.com/flatpak/expose-directories

**Lutris:** treat this as a separate manager integration, initially through installed desktop associations.
A later provider can use managed game entries and their configured runners.
Do not promise that selecting an arbitrary `.exe` can reuse any Lutris game environment.
Validate the installed CLI and managed-entry behavior before designing that provider.

Recommendation: desktop associations first, explicit Wine second, a Bottles chooser third.
Keep Lutris provider work separate until a concrete managed-game workflow is selected.

## Package and host boundaries

- `fm-core`: action identifiers and environment-free request/reply contracts.
- `fm-ui`: shared action presentation, chooser dialogs, operation targeting, and capability checks.
- `fm-main`: privileged metadata, archive jobs, desktop application lookup, and launch adapters.
- `app`: standalone provider wiring and standalone styling.
- `fm-search`: retain its independent host contract; do not import the panel to obtain actions.

Add optional, discoverable capabilities for existing embedding hosts.
An absent capability must produce unavailable actions, not a runtime missing-method error.
The standalone local connection can advertise desktop launch and archive operations.
Home remains read-only and must reject these operations in its backend allowlist.
Never reinterpret a remote path as a local path for launch or extraction.
Downloading a remote file for local opening is a separate future workflow with an explicit destination and cleanup policy.

Keep discovery requests separate from launch requests.
Use application identifiers and provider identifiers that the backend resolves and validates.
Use explicit operation contracts instead of a renderer-supplied arbitrary process command.
Do not grant Node access to the renderer.

## Suggested delivery order

1. Establish action availability and presentation. Deliver Open With and Open Terminal Here through one desktop adapter.
2. Deliver Extract Here, Extract To…, and Compress… with job progress and cancellation.
3. Deliver Properties metadata, executable permission, Run, and Run in Terminal.
4. Deliver explicit Wine launch and Bottles environment selection.
5. Audit and prioritize Trash restore, undo, links, devices, network locations, and broader parity tasks.

Each delivery needs its own approved scope. This order does not authorize implementation.
Avoid making a complete properties editor a prerequisite for the application chooser.

## Verification requirements for implementation

- Application discovery respects user overrides, hidden entries, file types, quoted Exec arguments, field codes, terminal apps, and Flatpak exports.
- Default changes affect the intended MIME type and survive restart.
- Host capability absence, picker mode, remote mode, and machine switching produce correct action availability.
- Names with spaces, quotes, leading hyphens, and shell metacharacters remain literal arguments.
- Archive tests include traversal, links, duplicate members, corrupt data, expansion limits, conflicts, cancellation, and partial failure.
- Program launch tests cover permission denial, missing interpreters, working directory, unavailable terminal, and provider failure.
- Wine and Bottles tests prove that the selected environment reaches the adapter.
- Desktop-launch tests assert adapter inputs with controlled launchers. They must not launch the operator's installed applications.
- Run the repository's required deterministic checks and package-configured tests for each implementation change.
- Follow AGENTS.md for production rebuild and daemon reload when implementation changes affect Electron bundles.

## Decisions to settle before a build plan

- Confirm the first delivery scope and the proposed archive destination policy.
- Select archive formats, backend, encrypted-archive behavior, and result limits.
- Select the desktop adapter after a packaging spike.
- Decide whether script launch needs configurable arguments in the first version.
- Decide whether Wine exposes arbitrary existing prefixes or only saved profiles.
- Select a concrete Lutris workflow before adding a dedicated provider.

## Accepted action menu delivery

The standalone enables the action menu. Embedding hosts opt in with `actionMenu` and can omit the three optional desktop action bridge methods.
The menu captures the operation target at invocation. The existing file operations own copy, cut, paste, rename, and trash.
Keyboard and pointer invocation preserve the marked selection only when the invoked row belongs to it. An unmarked row becomes the target and leaves unrelated marks intact.
The core key registry owns the `;` opener. The menu consumes its local letter shortcuts through the panel's central dispatcher.

Open With discovers desktop entries in XDG data directories, with user entries taking precedence. It lists recommended handlers first and uses `gio launch` for the selected desktop entry. It does not change MIME defaults.
Run uses executable permission and the file's interpreter line. A script without executable permission requires explicit confirmation before the backend adds owner executable permission.
Run in Terminal invokes the selected file as an argument to a fixed shell wrapper and keeps the terminal open until Enter.
Open Terminal Here supports `TERMINAL`, `xdg-terminal-exec`, Kitty, Foot, Konsole, Alacritty, WezTerm, GNOME Terminal, and Xterm.
`TERMINAL` must name one executable, without arguments.

Wine launches an EXE directly or an MSI through `msiexec /i`. An optional absolute Wine prefix selects its environment.
Bottles requires a bottle returned by its CLI. Native and Flatpak installations are supported. Flatpak receives a folder grant for that invocation only.
Lutris launches system Wine through its `--exec` command. This option does not select a saved game profile or a Lutris-managed Wine version. The dialog states this limit.
Missing tools and missing bottles disable their corresponding menu choices.
Discovery caches tool availability, applications per path, and bottle lists for 30 seconds. Non-Windows targets never enumerate bottles. Launch revalidates the selected application or bottle.
Launch confirmation reports process dispatch, without waiting for the program to finish. Cancellation can stop pending dispatch; a program that already started owns its own lifetime.
Flatpak Bottles rejects program folder paths that contain a colon because Flatpak uses that character in its permission syntax. Native Bottles supports those paths.

Extraction uses libarchive's `bsdtar` reader and creates a folder named after each archive. Extract Here uses the archive's parent. Extract To asks for an existing destination parent folder.
Compression creates ZIP, TAR, TAR.GZ, TAR.XZ, or TAR.ZST archives. The output must be outside the source entries.
Both archive operations use a private staging directory. Publication refuses an existing destination, including a dangling symlink. Extraction retains libarchive's default path protections and rejects external links and special files before publication.
Archive work has a two-minute process timeout, a monitored one-GiB output limit, and a 20,000-entry limit. The monitor polls at 100 milliseconds; these are operational limits, not a resource sandbox.
Cancellation removes the current staging directory after the tool exits. Earlier completed outputs in a multi-archive request remain.
Extract actions target archive formats, including compressed TAR files. Raw single-file compression such as `notes.txt.gz` does not expose extraction. Internal dangling symlinks remain inside the extracted root. Published folders use the process umask.
Properties displays metadata for each selected entry. Directory sizes describe the directory entry and exclude recursive contents.
Remote hosts do not provide these desktop operations.

Platform interfaces:

- https://gnome.pages.gitlab.gnome.org/gtk/gio/method.AppInfo.launch.html
- https://docs.usebottles.com/advanced/cli
- https://github.com/lutris/lutris/blob/master/lutris/gui/application.py
- https://github.com/libarchive/libarchive/blob/master/tar/bsdtar.c
