pragma Singleton

import Quickshell

Singleton {
    readonly property FileManagerConfig fileManager: FileManagerConfig {}

    function save(): void {
        // No-op — config persistence deferred to later phase
    }
}
