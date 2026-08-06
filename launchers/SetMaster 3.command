#!/bin/bash
# SetMaster 3 - double-click launcher (macOS)
#
# Double-click this file in Finder to start SetMaster 3. It starts the app in
# the background and opens it in your default web browser. If SetMaster 3 is
# already running it just re-opens the browser (it will not start a second copy).
#
# First-run note: SetMaster 3 is not signed by an Apple-registered developer, so
# the first launch needs one extra step. macOS may say the file "cannot be opened
# because it is from an unidentified developer": right-click the file, choose
# Open, then click Open in the dialog. On macOS 15 and later you may instead have
# to go to System Settings -> Privacy & Security and click "Open Anyway". Either
# way you only do it once, and no terminal is involved.
#
# This file ships executable (mode 755 in git, exec bit set by the release
# builder, and the macOS artifact is a .tar.gz so unpacking preserves it), so no
# chmod is ever needed. If some unpacking tool discarded permissions, unpack the
# original .tar.gz again in Finder rather than reaching for a terminal.
#
# NOTE: this launcher mirrors the tested Windows launcher and is intentionally
# identical in logic to _start.ps1, but has NOT yet been run on a Mac. Verify a
# macOS artifact with release/smoke-macos.sh before claiming macOS support
# (build-notes/macos-release-verification.md).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
BACKEND="$REPO/backend"
DIST="$REPO/frontend/dist"

# Python, in preference order: the runtime bundled into a release payload
# (runtime/python/, self-contained - a user's Mac needs nothing installed),
# then a developer checkout's virtualenv.
PY=""
for candidate in "$REPO/runtime/python/bin/python3" "$BACKEND/.venv/bin/python"; do
    if [ -x "$candidate" ]; then
        PY="$candidate"
        break
    fi
done
PORT="${SM3_PORT:-8137}"
URL="http://127.0.0.1:$PORT/"
LOG="$HERE/setmaster3-$PORT.log"

err() {
    # Show a native dialog so a non-programmer sees the problem.
    /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} with icon stop with title \"SetMaster 3\"" >/dev/null 2>&1 || true
    echo "ERROR: $1" >&2
    exit 1
}

ready() {
    # True only when SetMaster 3 itself answers on the port.
    curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/status" 2>/dev/null | grep -q 'app_version'
}

# 1. Already running? Just open the browser (idempotent).
if ready; then
    open "$URL"
    exit 0
fi

# 2. Environment checks.
[ -n "$PY" ] || err "SetMaster 3 is not fully installed: its Python was not found at $REPO/runtime/python . Please reinstall SetMaster 3."
[ -f "$DIST/index.html" ] || err "SetMaster 3's UI bundle is missing (frontend/dist). Please reinstall SetMaster 3, or build it with: cd frontend && npm install && npm run build"

# 3. Start the backend in the background, detached, logging to a file.
cd "$BACKEND"
nohup "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
disown || true

# 4. Wait for readiness (up to ~30s), then open the browser.
for _ in $(seq 1 60); do
    if ready; then
        open "$URL"
        exit 0
    fi
    sleep 0.5
done

err "SetMaster 3's backend did not start within 30 seconds. Port $PORT may already be in use. Run 'Stop SetMaster 3.command' - it will tell you whether the port belongs to SetMaster 3 (and stop it) or to another program, which it leaves running for you to close yourself. See the log at $LOG"
