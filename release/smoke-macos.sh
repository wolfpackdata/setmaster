#!/bin/bash
# SetMaster 3 - clean-machine smoke check for a macOS release artifact (#179, #182)
#
# RUN THIS ON A MAC, on the artifact you are about to ship:
#
#     ./release/smoke-macos.sh release/dist/SetMaster3-3.0.2-macos-arm64.tar.gz
#
# It extracts the tarball somewhere neutral and exercises THAT payload - not a
# developer checkout - as an isolated test instance (its own port and data dir),
# so a real SetMaster 3 on the default port is left alone.
#
# What it asserts:
#   1. the payload is self-contained (bundled runtime, UI bundle, app code)
#   2. both .command launchers arrived executable (no terminal chmod needed)
#   3. the start launcher brings the app up and it serves the built UI
#   4. relaunching is idempotent (no second server)
#   5. the stop launcher stops it
#   6. the stop launcher leaves an unrelated owner of the port alone (#181)
#   7. nothing in the artifact names the build machine (#223)

set -uo pipefail

RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RELEASE_DIR/.." && pwd)"

ARCHIVE="${1:-}"
PORT="${SM3_SMOKE_PORT:-8139}"
[ -n "$ARCHIVE" ] || { echo "usage: $0 <artifact.tar.gz>" >&2; exit 2; }
[ -f "$ARCHIVE" ] || { echo "ERROR: artifact not found: $ARCHIVE" >&2; exit 2; }
[ "$(uname -s)" = "Darwin" ] || { echo "ERROR: run this on macOS (this is $(uname -s))." >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sm3-smoke-XXXXXX")"
FAILURES=0

step()  { printf '==> %s\n' "$1"; }
pass()  { printf '  PASS  %s\n' "$1"; }
fail()  { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
check() { if [ "$1" = "0" ]; then pass "$2"; else fail "$2"; fi }

status_up() { curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/status" 2>/dev/null | grep -q app_version; }

wait_up()   { local end=$((SECONDS + ${1:-40})); while [ $SECONDS -lt $end ]; do status_up && return 0; sleep 1; done; return 1; }
wait_down() { local end=$((SECONDS + ${1:-25})); while [ $SECONDS -lt $end ]; do status_up || return 0; sleep 1; done; return 1; }
listeners() { lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | sort -u | tr '\n' ' '; }

step "Extracting $ARCHIVE"
tar -xzf "$ARCHIVE" -C "$WORK" || { echo "ERROR: extraction failed" >&2; exit 1; }
PAYLOAD="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)"
[ -n "$PAYLOAD" ] || { echo "ERROR: the artifact contained no payload folder" >&2; exit 1; }

step "Checking the payload is self-contained"
for rel in runtime/python/bin/python3 backend/app/main.py backend/pipeline \
           frontend/dist/index.html release-info.json \
           "launchers/SetMaster 3.command" "launchers/Stop SetMaster 3.command"; do
    if [ -e "$PAYLOAD/$rel" ]; then pass "present: $rel"; else fail "missing: $rel"; fi
done
[ ! -d "$PAYLOAD/backend/.venv" ]
check $? "ships no developer virtualenv"
"$PAYLOAD/runtime/python/bin/python3" -c \
    "import fastapi, uvicorn, pandas, numpy, openpyxl, regex, multipart" 2>/dev/null
check $? "bundled runtime imports every dependency"

# The second gate on the #223 class, run against the EXTRACTED artifact rather
# than the payload directory the builder happened to produce. The builder's own
# scan can only vouch for what it saw; this one vouches for what is actually in
# the tarball a user downloads.
step "Checking the artifact names no build machine (#223)"
# Same shared scanner the builder runs (release/scan_paths.py) - UTF-8, UTF-16LE
# and UTF-16BE, case-insensitive. Run with the artifact's own bundled python so
# this check needs nothing preinstalled, exactly like the rest of the smoke.
LEAK_LIST="$(mktemp)"
NEEDLES="$(mktemp)"
printf '%s\n' "$REPO_ROOT" "$HOME" > "$NEEDLES"
"$PAYLOAD/runtime/python/bin/python3" "$RELEASE_DIR/scan_paths.py" \
    "$PAYLOAD" "$NEEDLES" > "$LEAK_LIST"
SCAN_RC=$?
rm -f "$NEEDLES"
if [ "$SCAN_RC" -gt 1 ]; then
    fail "leak scanner failed (exit $SCAN_RC) - cannot vouch for the artifact"
else
    LEAKS="$(wc -l < "$LEAK_LIST" | tr -d ' ')"
    [ "$LEAKS" = "0" ]
    check "$?" "no build-machine paths in the artifact ($LEAKS file(s) matched)"
    if [ "$LEAKS" != "0" ]; then
        sed -n '1,10p' "$LEAK_LIST" | sed 's|^|        |'
    fi
fi
rm -f "$LEAK_LIST"

# A .pyc that still records an absolute source path defeats the point even if
# the string does not happen to match this machine. Sample the bytecode and
# assert the rewritten "SetMaster3" root is what got recorded.
PYC="$(find "$PAYLOAD/runtime/python/lib" -name '*.pyc' 2>/dev/null | head -1)"
if [ -n "$PYC" ]; then
    "$PAYLOAD/runtime/python/bin/python3" - "$PYC" <<'PY'
import sys, importlib.util, marshal
with open(sys.argv[1], "rb") as fh:
    fh.read(16)  # magic + flags + hash/mtime + size
    code = marshal.load(fh)
sys.exit(0 if code.co_filename.startswith("SetMaster3") else 1)
PY
    check $? "bytecode records a relative root, not the build machine ($(basename "$PYC"))"
else
    fail "no pre-compiled bytecode found in the runtime - the #223 pre-compile did not run"
fi

step "Checking the double-click launchers are executable (#182)"
for launcher in "SetMaster 3.command" "Stop SetMaster 3.command"; do
    [ -x "$PAYLOAD/launchers/$launcher" ]
    check $? "executable on arrival: $launcher"
done

export SM3_PORT="$PORT"
export SM3_DATA_DIR="$WORK/appdata"

step "Starting via the double-click launcher (port $PORT, isolated data dir)"
if status_up; then "$PAYLOAD/launchers/Stop SetMaster 3.command" >/dev/null 2>&1 || true; wait_down 20; fi
"$PAYLOAD/launchers/SetMaster 3.command" >"$WORK/start.log" 2>&1 &
wait_up 45
check $? "app comes up on :$PORT"

curl -fsS --max-time 5 "http://127.0.0.1:$PORT/" 2>/dev/null | grep -qiE '<div id="root"|<!doctype html'
check $? "serves the built UI at /"

FIRST="$(listeners)"
[ "$(echo "$FIRST" | wc -w | tr -d ' ')" = "1" ]
check $? "exactly one listener on :$PORT ($FIRST)"

step "Relaunching (idempotency)"
"$PAYLOAD/launchers/SetMaster 3.command" >>"$WORK/start.log" 2>&1 &
sleep 5
[ "$(listeners)" = "$FIRST" ] && status_up
check $? "relaunch is idempotent ($(listeners))"

step "Stopping via the double-click launcher"
"$PAYLOAD/launchers/Stop SetMaster 3.command" >"$WORK/stop.log" 2>&1 || true
wait_down 25
check $? "stop launcher frees the port"

step "Stopping with an unrelated program on :$PORT (#181)"
"$PAYLOAD/runtime/python/bin/python3" -m http.server "$PORT" --bind 127.0.0.1 >"$WORK/impostor.log" 2>&1 &
IMPOSTOR=$!
sleep 2
"$PAYLOAD/launchers/Stop SetMaster 3.command" >"$WORK/stop-foreign.log" 2>&1 || true
sleep 3
kill -0 "$IMPOSTOR" 2>/dev/null
check $? "stop leaves an unrelated port owner alive"
kill "$IMPOSTOR" 2>/dev/null || true

echo
if [ "$FAILURES" = "0" ]; then
    echo "ARTIFACT SMOKE CHECK PASSED  ($ARCHIVE)"
    echo "Extracted payload kept at: $PAYLOAD"
    exit 0
fi
echo "ARTIFACT SMOKE CHECK FAILED ($FAILURES check(s))  ($ARCHIVE)"
echo "Extracted payload and logs kept at: $WORK"
exit 1
