"""Per-process instance identity, so a stopper can prove what it is killing.

The stop launchers must never terminate a process just because it owns the
port (issue #181). The server therefore writes a small identity file into its
own app-data dir and reports the same identity over ``/api/status``: a stopper
that finds the token in both places has proved the process answering the port
is a SetMaster 3 instance owning *this* machine's data dir, and gets the PID to
stop from the same answer.

The token is an identity nonce, not a secret — it is served over unauthenticated
localhost HTTP by design (single-user, offline app).
"""
from __future__ import annotations

import datetime
import json
import os
import uuid
from pathlib import Path

INSTANCE_FILENAME = "instance.json"

# one identity per server process, fixed for its lifetime
_TOKEN = uuid.uuid4().hex
_STARTED_AT = datetime.datetime.now().astimezone().isoformat(timespec="seconds")


def info() -> dict:
    return {"pid": os.getpid(), "token": _TOKEN, "started_at": _STARTED_AT}


def write(data_dir: Path) -> None:
    """Publish this process's identity into the data dir (best effort).

    Called on startup and again after a restore swap, so the file always
    describes the process actually serving the directory.
    """
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        (data_dir / INSTANCE_FILENAME).write_text(
            json.dumps(info(), indent=2), encoding="utf-8"
        )
    except OSError:
        pass  # a missing identity file only costs the stopper its fast path


def remove(data_dir: Path) -> None:
    """Clear our identity on clean shutdown (best effort)."""
    try:
        path = data_dir / INSTANCE_FILENAME
        if path.is_file() and json.loads(path.read_text(encoding="utf-8")).get("token") == _TOKEN:
            path.unlink()
    except (OSError, ValueError):
        pass
