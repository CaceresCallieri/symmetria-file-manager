# Electron architecture and measurements

Electron is the only implementation in this repository. The standalone application and Mesura Code share the workspace packages. Symmetria Shell owns its filesystem model. Symmetria-IDE is retired.

Read `AGENTS.md` for the constraints that apply before editing. Read the package READMEs for host contracts.

- `13-syntax-highlighting.md`: measured highlighting costs and the KDE theme converter.
- `14-image-decoding-and-thumbnails.md`: image decoding and thumbnail interoperability.
- `15-decisions.md`: architecture decisions and their rationale.
- `19-spike-image-pipeline.md`: image pipeline measurements.
- `22-desktop-integration.md`: desktop entry, service, and compositor integration.
- `23-spike-picker-window.md`: picker window measurements.
- `24-picker.md`: picker lifecycle and portal integration.
- `35-laptop-release.md`: an independent laptop installation.

Git history retains the superseded implementation inventories and migration plans.
