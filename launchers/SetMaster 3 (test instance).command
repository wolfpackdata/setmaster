#!/bin/bash
# SetMaster 3 (test instance) - double-click launcher (macOS)
#
# Double-click this file in Finder to start a second, EMPTY copy of SetMaster 3
# for trying things out. It keeps its own sets, notes and settings in
# ~/Library/Application Support/SetMaster3-test and runs on port 8140, so your
# real SetMaster 3 (port 8137) is not touched. Both can run at the same time.
#
# The two browser tabs look identical - check the address bar before doing
# anything that changes or deletes data: 8137 is real, 8140 is the test copy.
#
# First-run note: the same one-time step as the main launcher applies, because
# SetMaster 3 is not signed by an Apple-registered developer. If macOS says the
# file "cannot be opened because it is from an unidentified developer",
# right-click the file, choose Open, then click Open in the dialog. On macOS 15
# and later you may instead have to go to System Settings -> Privacy & Security
# and click "Open Anyway". No terminal is involved.
#
# This file ships executable (mode 755 in git, exec bit set by the release
# builder, and the macOS artifact is a .tar.gz so unpacking preserves it), so no
# chmod is ever needed.
#
# How it works: it sets two environment variables and then hands over to the
# real launcher, so there is only ONE copy of the start logic to keep working.
# The exports live in this process only and cannot leak into the real launcher.
#
# NOTE: mirrors the Windows test-instance launcher and is intentionally
# identical in logic to "SetMaster 3 (test instance).vbs", but has NOT yet been
# run on a Mac. Verify a macOS artifact with release/smoke-macos.sh before
# claiming macOS support (build-notes/macos-release-verification.md).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL="$HERE/SetMaster 3.command"

if [ ! -f "$REAL" ]; then
    /usr/bin/osascript -e "display dialog \"SetMaster 3 is missing a required file: $REAL . Please reinstall SetMaster 3.\" buttons {\"OK\"} with icon stop with title \"SetMaster 3 (test instance)\"" >/dev/null 2>&1 || true
    echo "ERROR: missing $REAL" >&2
    exit 1
fi

# This copy's own data folder and port. `export` here affects only this process
# and the launcher it hands over to - it can never redirect the real launcher.
export SM3_DATA_DIR="$HOME/Library/Application Support/SetMaster3-test"
export SM3_PORT="8140"

exec bash "$REAL"
