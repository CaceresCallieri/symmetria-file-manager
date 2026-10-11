#!/usr/bin/env python3
# NOTE: run by systemd with the portal's virtualenv Python,
# ~/.local/share/symmetria/portal-venv/bin/python3, which carries dbus-fast
# (see install-portal.sh). The system Python is never modified.
"""org.freedesktop.FileManager1 for the Symmetria File Manager (Electron build).

"Show in folder" in Chromium, Electron apps, Firefox and Zen calls
`ShowItems` on this bus name, and whichever file manager owns the name is the
one that opens. Without this service the name belongs to Nautilus.

Each call becomes one `symmetria-fm-electron-cli` invocation. The decisions —
is the path a file or a directory, which tab, where the cursor lands, taking
the user to the window — all live in the daemon, so this stays a thin
translation from D-Bus to the command-line tool:

    ShowItems           -> reveal <path>   the item inside its folder
    ShowItemProperties  -> reveal <path>   there is no properties view
    ShowFolders         -> open <path>     the folder itself

The file manager has one window, so a call naming several URIs shows the
first one that is a local path. Nautilus opens a window per folder; one window
receiving several destinations at once would only leave the user on the last.
"""

import asyncio
import logging
import os
import sys
from urllib.parse import unquote, urlsplit

from dbus_fast import NameFlag, RequestNameReply
from dbus_fast.aio import MessageBus
from dbus_fast.service import ServiceInterface, method

logging.basicConfig(
    level=logging.INFO,
    format="[symmetria-filemanager1] %(levelname)s: %(message)s",
)
log = logging.getLogger(__name__)

BUS_NAME = "org.freedesktop.FileManager1"
OBJECT_PATH = "/org/freedesktop/FileManager1"
INTERFACE = "org.freedesktop.FileManager1"

# The unit sets this to an absolute path: a service's PATH is not guaranteed
# to contain ~/.local/bin, where the tool is installed.
FM_CLI = os.environ.get("SYMMETRIA_FILEMANAGER1_CLI", "symmetria-fm-electron-cli")

# sysexits.h EX_UNAVAILABLE, the same "another process provides this" code the
# daemon exits with. The unit exempts it from Restart=, because retrying cannot
# succeed while another file manager holds the name.
EX_UNAVAILABLE = 69


def local_path(uri: str) -> str | None:
    """The local path a URI names, or None when it is not a local file.

    Callers send `file://` URIs, percent-encoded; some send a bare absolute
    path. Anything else — another host, another scheme, a NUL — is not a path
    the file manager can show.
    """
    if uri.startswith("/"):
        path = uri
    else:
        try:
            parts = urlsplit(uri)
        except ValueError:
            # A malformed URI — `https://[broken` — names nothing; it must not
            # cost the caller the local path beside it.
            return None
        if parts.scheme != "file" or parts.netloc not in ("", "localhost"):
            return None
        path = unquote(parts.path)
    if not path.startswith("/") or "\0" in path:
        return None
    return path


async def run_cli(command: str, path: str) -> None:
    """Hand one path to the file manager. Failures are logged, never raised:
    the caller is another application, and an error reply would only make it
    fall back to some other file manager."""
    process = await asyncio.create_subprocess_exec(
        FM_CLI,
        command,
        path,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await process.communicate()
    if process.returncode != 0:
        log.warning("%s %s %r failed: %s", FM_CLI, command, path, stderr.decode().strip())


class FileManager1(ServiceInterface):
    def __init__(self) -> None:
        super().__init__(INTERFACE)

    async def _show(self, command: str, uris: list[str]) -> None:
        # Lazily, so the URIs after the first local one are never parsed.
        path = next((path for path in map(local_path, uris) if path is not None), None)
        if path is None:
            log.info("Nothing local to show in %r", uris)
            return
        log.info("%s %s", command, path)
        await run_cli(command, path)

    # `startup_id` is accepted and unused. It is an activation token the
    # Electron window cannot take; the daemon focuses its window through the
    # compositor instead.
    @method(name="ShowFolders")
    async def show_folders(self, uris: "as", startup_id: "s"):
        await self._show("open", uris)

    @method(name="ShowItems")
    async def show_items(self, uris: "as", startup_id: "s"):
        await self._show("reveal", uris)

    @method(name="ShowItemProperties")
    async def show_item_properties(self, uris: "as", startup_id: "s"):
        await self._show("reveal", uris)


async def main() -> int:
    bus = await MessageBus().connect()
    bus.export(OBJECT_PATH, FileManager1())

    # DO_NOT_QUEUE: waiting in line behind another owner — Nautilus,
    # typically — would leave the unit "activating" until systemd's timeout.
    reply = await bus.request_name(BUS_NAME, NameFlag.DO_NOT_QUEUE)
    if reply not in (RequestNameReply.PRIMARY_OWNER, RequestNameReply.ALREADY_OWNER):
        log.error(
            "%s is held by another file manager. Quit it (for Nautilus: nautilus -q)"
            " and start this service again.",
            BUS_NAME,
        )
        return EX_UNAVAILABLE

    log.info("Answering %s", BUS_NAME)
    try:
        await bus.wait_for_disconnect()
    except (EOFError, ConnectionError):
        # The bus went away: the session is ending. That is a normal way for
        # this service to stop, and reporting it as a failure would make
        # Restart=on-failure start it against a bus that no longer exists.
        log.info("Session bus closed")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass
