# Architecture decisions

Electron is the only file-manager implementation. Git history retains the previous implementation and the superseded migration inventories.

## Independent application and shared packages

The file manager keeps its own repository and release cycle. Mesura Code consumes its shared packages. A host does not need to run the standalone application to mount the panel or the finder.

The standalone and embedded hosts have different visual profiles. Standalone styles belong to the host. Shared renderer styles also affect Mesura Code at its next subtree update. Read `AGENTS.md` before changing those styles.

## Plain TypeScript at the host boundary

The packages expose plain values, promises, and injected interfaces. They do not require Effect-TS. A host can wrap a promise in its own effect system. Requiring that effect system inside the packages would impose it on every host.

## The host owns policy

The panel owns navigation and interaction. The host supplies capabilities, including git data and file opening. An absent optional capability remains safe. A policy change in one host must not require a second implementation of the panel.

The finder is independently embeddable. It receives host activation and preview callbacks. It does not import the file-manager panel.

## Resident daemon and separate picker windows

The standalone keeps one resident daemon and one browsing window with tabs. A normal workspace holds that window. The operator rejected a scratchpad because it hides the window from the normal workspace model.

Picker windows remain separate from browsing state. A fresh picker avoids stale state without paying a material startup cost. Measurements and lifecycle constraints live in `23-spike-picker-window.md` and `24-picker.md`.

## Process isolation for search

Each indexed directory gets a separate engine process. The native engine store rejects a second open in one process. Separate processes can share the store. Read the finder constraints in `AGENTS.md` before changing the pool.

## Preview ownership

The reader and column are separate component trees. Expanding a preview transfers its ownership to the reader. Remounting a document can reset its page position; this is accepted. The panel must not mount the same preview in both trees to preserve that position.

HTML remains a sandboxed preview. A preview must not execute document scripts, load remote resources, or navigate the application away from its current surface.

## Documentation authority

`AGENTS.md` holds the constraints an agent needs before editing. Package READMEs describe the public host contracts. Source files define implementation details. The measurements in this directory support specific decisions and do not define a parallel implementation.
