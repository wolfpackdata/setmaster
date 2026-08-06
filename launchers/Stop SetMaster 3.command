#!/bin/bash
# Stop SetMaster 3 - double-click to shut the app down (macOS)
#
# Double-click this file to stop the SetMaster 3 background server. Your sets,
# notes and settings are saved automatically and are not affected. You can then
# close any SetMaster 3 browser tabs.
#
# It stops SetMaster 3 and nothing else. A process is never killed merely for
# owning the port (#181): it must answer /api/status on the port as SetMaster 3
# AND report an instance token matching the instance.json file in the app-data
# dir that same answer names. If ownership cannot be proved, the port owner is
# reported and left alone.
#
# This file ships executable (mode 755 in git, exec bit set by the release
# builder, .tar.gz distribution preserves it), so no terminal chmod is needed.
#
# NOTE: mirrors the tested Windows stop script but has NOT yet been run on a Mac.
# Verify with release/smoke-macos.sh (build-notes/macos-release-verification.md).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SM3_PORT:-8137}"

# SM3_QUIET suppresses the pop-up dialogs (used by "Reset test instance.command",
# which shows its own). Unset by default, so double-click behaviour is unchanged.
note() {
    [ -n "${SM3_QUIET:-}" ] || /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} with icon note with title \"SetMaster 3\"" >/dev/null 2>&1 || true
    echo "$1"
}

warn() {
    [ -n "${SM3_QUIET:-}" ] || /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} with icon stop with title \"SetMaster 3\"" >/dev/null 2>&1 || true
    echo "$1" >&2
}

listeners() {
    lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true
}

# Read one field out of the JSON we were given. Uses the app's own Python when
# it is present (the start script requires it), else the system python3, else a
# sed fallback - so the ownership check still works on a bare Mac.
json_field() {  # <json> <field> [scope]
    local json="$1" field="$2" scope="${3:-}"
    local py
    for py in "$(cd "$HERE/.." && pwd)/backend/.venv/bin/python" /usr/bin/python3 python3; do
        if [ -x "$py" ] || command -v "$py" >/dev/null 2>&1; then
            printf '%s' "$json" | "$py" -c '
import json, sys
field, scope = sys.argv[1], sys.argv[2]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
if scope:
    data = data.get(scope) or {}
value = data.get(field)
print("" if value is None else value)
' "$field" "$scope" 2>/dev/null && return 0
        fi
    done
    # No Python available: pull the field out of the (flat) JSON text.
    local blob="$json"
    if [ -n "$scope" ]; then
        blob="$(printf '%s' "$json" | sed -n "s/.*\"$scope\"[[:space:]]*:[[:space:]]*{\([^}]*\)}.*/\1/p")"
    fi
    printf '%s' "$blob" | sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p"
}

PIDS="$(listeners)"
if [ -z "$PIDS" ]; then
    note "SetMaster 3 does not appear to be running (nothing is listening on port $PORT)."
    exit 0
fi

# 1. Does SetMaster 3 itself answer on the port?
STATUS="$(curl -fsS --max-time 3 "http://127.0.0.1:$PORT/api/status" 2>/dev/null || true)"
APP_VERSION="$(json_field "$STATUS" app_version)"
DATA_DIR="$(json_field "$STATUS" app_data_dir)"
STATUS_TOKEN="$(json_field "$STATUS" token instance)"
OWNED_PID="$(json_field "$STATUS" pid instance)"

if [ -z "$APP_VERSION" ]; then
    warn "Another program is using port $PORT, so SetMaster 3 was not stopped and nothing was closed. Close the other program yourself, or set a different port, then try again."
    exit 1
fi

if [ -z "$DATA_DIR" ] || [ -z "$STATUS_TOKEN" ] || [ -z "$OWNED_PID" ]; then
    # An older SetMaster 3 that predates the instance-token contract: identify
    # the server process itself instead ("python -m uvicorn app.main:app").
    OWNED_PID=""
    for candidate in $PIDS; do
        if ps -o command= -p "$candidate" 2>/dev/null | grep -q 'uvicorn.*app\.main:app'; then
            OWNED_PID="$candidate"
            break
        fi
    done
    if [ -z "$OWNED_PID" ]; then
        warn "Port $PORT is served by something that does not identify itself as SetMaster 3, so nothing was closed."
        exit 1
    fi
    echo "Older SetMaster 3 build on port $PORT - identified by its server process."
else
    # 2. The same token must be on disk in the data dir that answer names.
    DISK_TOKEN="$(json_field "$(cat "$DATA_DIR/instance.json" 2>/dev/null || true)" token)"
    if [ -z "$DISK_TOKEN" ] || [ "$DISK_TOKEN" != "$STATUS_TOKEN" ]; then
        warn "SetMaster 3 was not stopped: its identity could not be confirmed in $DATA_DIR, so nothing was closed."
        exit 1
    fi
fi

# 3. The proven process must be the one holding the port (or its parent).
owns_port() {
    local candidate
    for candidate in $PIDS; do
        [ "$candidate" = "$OWNED_PID" ] && return 0
        [ "$(ps -o ppid= -p "$candidate" 2>/dev/null | tr -d ' ')" = "$OWNED_PID" ] && return 0
    done
    return 1
}
if ! owns_port; then
    warn "SetMaster 3 was not stopped: the program listening on port $PORT is not the SetMaster 3 process that answered, so nothing was closed."
    exit 1
fi

# 4. Stop only that process (and any child it spawned).
CHILDREN="$(pgrep -P "$OWNED_PID" 2>/dev/null || true)"
# shellcheck disable=SC2086
kill $CHILDREN "$OWNED_PID" 2>/dev/null || true
sleep 1
if kill -0 "$OWNED_PID" 2>/dev/null; then
    # shellcheck disable=SC2086
    kill -9 $CHILDREN "$OWNED_PID" 2>/dev/null || true
    sleep 1
fi

if kill -0 "$OWNED_PID" 2>/dev/null; then
    warn "SetMaster 3 could not be fully stopped. Open Activity Monitor, quit the 'Python' process, then try again."
    exit 1
fi

note "SetMaster 3 has been stopped. You can close any SetMaster 3 browser tabs."
