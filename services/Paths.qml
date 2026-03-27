pragma Singleton

import Quickshell

Singleton {
    readonly property string home: Quickshell.env("HOME")
    readonly property string _homeSlash: home + "/"

    function shortenHomeBare(path: string): string {
        if (path === home)
            return "~";
        if (path.startsWith(_homeSlash))
            return path.slice(_homeSlash.length);
        return path;
    }

    function shortenHome(path: string): string {
        if (path === home)
            return "~";
        if (path.startsWith(_homeSlash))
            return "~/" + path.slice(_homeSlash.length);
        return path;
    }
}
