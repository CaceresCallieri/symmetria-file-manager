pragma Singleton

import Quickshell

Singleton {
    readonly property string home: Quickshell.env("HOME")

    function shortenHome(path: string): string {
        if (path === home)
            return "~";
        if (path.startsWith(home + "/"))
            return "~" + path.slice(home.length);
        return path;
    }
}
