#!/usr/bin/env python3.12
# NOTE: python3.12 is pinned explicitly because dbus-fast was installed for that
# interpreter via `python3.12 -m pip install dbus-fast` (see install-portal.sh).
# If you change the interpreter, reinstall dbus-fast for the new version.
"""Symmetria XDG Desktop Portal FileChooser backend.

Implements org.freedesktop.impl.portal.FileChooser by delegating to
the Symmetria File Manager via QuickShell IPC. Communication back
from the picker uses a FIFO (named pipe) — the same pattern as
Symmetria's askpass module.
"""

import asyncio
import json
import logging
import os
import subprocess
import threading
import uuid

from dbus_fast import Variant
from dbus_fast.aio import MessageBus
from dbus_fast.service import ServiceInterface, method

logging.basicConfig(
    level=logging.INFO,
    format="[symmetria-portal] %(levelname)s: %(message)s",
)
log = logging.getLogger(__name__)

HOME_DIR = os.path.normpath(os.path.expanduser("~"))
_downloads_candidate = os.path.join(HOME_DIR, "Downloads")
# Use ~/Downloads as save-dialog default only if the directory actually exists.
DOWNLOADS_DIR = _downloads_candidate if os.path.isdir(_downloads_candidate) else HOME_DIR
FIFO_PREFIX = "/tmp/symmetria-picker-"
FIFO_TIMEOUT_SECONDS = 300  # 5 minutes max wait for user interaction
CANCELLED_SENTINEL = "__PICKER_CANCELLED__"

QS_IPC_CMD = [
    "qs", "ipc", "--any-display", "-c", "symmetria-fm",
    "call", "filemanager", "createPicker",
]


def decode_byte_array_path(variant_value) -> str:
    """Decode a portal current_folder (ay, null-terminated bytes) to a string."""
    if variant_value is None:
        return ""
    raw_bytes = bytes(variant_value)
    # Strip trailing null byte(s)
    raw_bytes = raw_bytes.rstrip(b"\x00")
    if not raw_bytes:
        return ""
    return raw_bytes.decode("utf-8", errors="replace")


def get_option(options: dict, key: str, default=None):
    """Extract a value from a D-Bus options dict (a{sv})."""
    if key in options:
        return options[key].value
    return default


async def read_fifo(fifo_path: str, timeout: float) -> str:
    """Read from a FIFO with a timeout. Returns the content or raises TimeoutError."""
    loop = asyncio.get_running_loop()  # get_event_loop() is deprecated in Python 3.10+

    def _blocking_read():
        with open(fifo_path, "r") as f:
            return f.read()

    return await asyncio.wait_for(
        loop.run_in_executor(None, _blocking_read),
        timeout=timeout,
    )


def create_fifo() -> str:
    """Create a secure FIFO and return its path.

    Uses uuid4 to generate a unique name and os.mkfifo for atomic creation,
    avoiding the TOCTOU race inherent in tempfile.mktemp.
    """
    path = f"/tmp/symmetria-picker-{uuid.uuid4().hex}"
    os.mkfifo(path, mode=0o600)
    return path


def launch_picker_ipc(options_json: str) -> None:
    """Fire-and-forget IPC call to open the picker window.

    Uses Popen + communicate() in a daemon thread so the process is fully
    reaped and no zombie is left behind, without blocking the event loop.
    """
    cmd = QS_IPC_CMD + [options_json]
    log.info("Launching picker: %s", " ".join(cmd))

    def _run():
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        proc.communicate()  # Reap the process so no zombie is created

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()


class FileChooserBackend(ServiceInterface):
    """Implements org.freedesktop.impl.portal.FileChooser."""

    def __init__(self):
        super().__init__("org.freedesktop.impl.portal.FileChooser")

    @method(name="OpenFile")
    async def open_file(
        self,
        handle: "o",
        app_id: "s",
        parent_window: "s",
        title: "s",
        options: "a{sv}",
    ) -> "ua{sv}":
        log.info("OpenFile request: title=%r, app_id=%r", title, app_id)

        multiple = get_option(options, "multiple", False)
        directory = get_option(options, "directory", False)
        accept_label = get_option(options, "accept_label", "")
        current_folder_raw = get_option(options, "current_folder", None)
        current_folder = decode_byte_array_path(current_folder_raw)
        # Open-file dialogs intentionally do not default to ~/Downloads — the
        # calling app's folder hint is meaningful (e.g. "open an image from where
        # you last looked"), so we honour it or fall back to empty (home dir).

        fifo_path = create_fifo()
        log.info("Created FIFO: %s", fifo_path)

        try:
            picker_options = json.dumps({
                "title": title or "Select a File",
                "fifo": fifo_path,
                "multiple": multiple,
                "directory": directory,
                "acceptLabel": accept_label,
                "currentFolder": current_folder,
            })

            launch_picker_ipc(picker_options)

            result = await read_fifo(fifo_path, FIFO_TIMEOUT_SECONDS)
            result = result.strip()

            if not result or result == CANCELLED_SENTINEL:
                log.info("Picker cancelled")
                return [1, {}]

            # Parse newline-separated paths into file:// URIs
            paths = [line for line in result.split("\n") if line]
            uris = [f"file://{p}" for p in paths]
            log.info("Picker completed: %s", uris)

            return [0, {"uris": Variant("as", uris)}]

        except asyncio.TimeoutError:
            log.warning("Picker timed out after %ds", FIFO_TIMEOUT_SECONDS)
            return [1, {}]
        except Exception as exc:
            log.error("Picker error: %s", exc)
            return [2, {}]
        finally:
            try:
                os.unlink(fifo_path)
            except OSError:
                pass

    @method(name="SaveFile")
    async def save_file(
        self,
        handle: "o",
        app_id: "s",
        parent_window: "s",
        title: "s",
        options: "a{sv}",
    ) -> "ua{sv}":
        log.info("SaveFile request: title=%r, app_id=%r", title, app_id)

        current_name = get_option(options, "current_name", "")
        accept_label = get_option(options, "accept_label", "")
        current_folder_raw = get_option(options, "current_folder", None)
        current_folder = decode_byte_array_path(current_folder_raw)
        current_file_raw = get_option(options, "current_file", None)
        current_file = decode_byte_array_path(current_file_raw)

        # If current_file is set, extract folder and filename from it
        if current_file and not current_folder:
            current_folder = os.path.dirname(current_file)
        if current_file and not current_name:
            current_name = os.path.basename(current_file)

        # Default to ~/Downloads for save dialogs when the app doesn't
        # provide a specific folder (empty or just home directory).
        if not current_folder or os.path.normpath(current_folder) == HOME_DIR:
            current_folder = DOWNLOADS_DIR

        log.info("SaveFile: name=%r, folder=%r", current_name, current_folder)

        fifo_path = create_fifo()
        log.info("Created FIFO: %s", fifo_path)

        try:
            picker_options = json.dumps({
                "title": title or "Save File",
                "fifo": fifo_path,
                "multiple": False,
                "directory": False,
                "saveMode": True,
                "suggestedName": current_name,
                "acceptLabel": accept_label or "Save",
                "currentFolder": current_folder,
            })

            launch_picker_ipc(picker_options)

            result = await read_fifo(fifo_path, FIFO_TIMEOUT_SECONDS)
            result = result.strip()

            if not result or result == CANCELLED_SENTINEL:
                log.info("Save picker cancelled")
                return [1, {}]

            # Result is a single directory path or full file path
            paths = [line for line in result.split("\n") if line]
            save_path = paths[0]

            # If user selected a directory, append the suggested filename
            if os.path.isdir(save_path) and current_name:
                save_path = os.path.join(save_path, current_name)

            uri = f"file://{save_path}"
            log.info("Save completed: %s", uri)

            return [0, {"uris": Variant("as", [uri])}]

        except asyncio.TimeoutError:
            log.warning("Save picker timed out after %ds", FIFO_TIMEOUT_SECONDS)
            return [1, {}]
        except Exception as exc:
            log.error("Save picker error: %s", exc)
            return [2, {}]
        finally:
            try:
                os.unlink(fifo_path)
            except OSError:
                pass

    @method(name="SaveFiles")
    async def save_files(
        self,
        handle: "o",
        app_id: "s",
        parent_window: "s",
        title: "s",
        options: "a{sv}",
    ) -> "ua{sv}":
        log.info("SaveFiles request: title=%r, app_id=%r", title, app_id)

        accept_label = get_option(options, "accept_label", "")
        current_folder_raw = get_option(options, "current_folder", None)
        current_folder = decode_byte_array_path(current_folder_raw)

        # Default to ~/Downloads (same rationale as save_file).
        if not current_folder or os.path.normpath(current_folder) == HOME_DIR:
            current_folder = DOWNLOADS_DIR

        fifo_path = create_fifo()
        log.info("Created FIFO: %s", fifo_path)

        try:
            picker_options = json.dumps({
                "title": title or "Save Files",
                "fifo": fifo_path,
                "multiple": False,
                "directory": True,
                "saveMode": True,
                "acceptLabel": accept_label or "Save Here",
                "currentFolder": current_folder,
            })

            launch_picker_ipc(picker_options)

            result = await read_fifo(fifo_path, FIFO_TIMEOUT_SECONDS)
            result = result.strip()

            if not result or result == CANCELLED_SENTINEL:
                log.info("SaveFiles picker cancelled")
                return [1, {}]

            save_dir = result.split("\n")[0]
            uri = f"file://{save_dir}"
            log.info("SaveFiles completed: %s", uri)

            return [0, {"uris": Variant("as", [uri])}]

        except asyncio.TimeoutError:
            log.warning("SaveFiles picker timed out after %ds", FIFO_TIMEOUT_SECONDS)
            return [1, {}]
        except Exception as exc:
            log.error("SaveFiles error: %s", exc)
            return [2, {}]
        finally:
            try:
                os.unlink(fifo_path)
            except OSError:
                pass


async def main():
    bus = await MessageBus().connect()
    backend = FileChooserBackend()
    bus.export("/org/freedesktop/portal/desktop", backend)

    bus_name = "org.freedesktop.impl.portal.desktop.symmetria"
    await bus.request_name(bus_name)
    log.info("Portal backend running as %s", bus_name)

    # Run until terminated
    await bus.wait_for_disconnect()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    finally:
        log.info("Portal backend stopped")
