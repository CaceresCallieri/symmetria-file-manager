# Action-menu interaction study

This browser prototype preserves the first interaction study. It uses sample files and simulated actions. The Electron application does not import or serve these files.

The in-app menu uses existing file operations for Open, Copy, Cut, Paste, Rename, and Trash. The in-app menu provides desktop action backends for the remaining actions. The broader parity proposal is in `../../file-manager-parity.md`.

The accepted menu now uses real desktop action backends in the standalone app. Open With, execution, Wine options, archive operations, and Properties use the optional desktop action bridge. This historical HTML study remains simulated.
