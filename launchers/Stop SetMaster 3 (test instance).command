#!/bin/bash
# Stop SetMaster 3 (test instance) - double-click to shut the test copy down
#
# Double-click this file to stop the test copy of SetMaster 3 (the one on port
# 8140). Your real SetMaster 3 on port 8137 keeps running and is not touched.
# A message confirms when the test copy has stopped; you can then close its
# browser tabs. (Nothing is deleted - the test copy's data is still there the
# next time you start it. To empty it, use "Reset test instance.command".)
#
# This file ships executable (mode 755 in git, exec bit set by the release
# builder, .tar.gz distribution preserves it), so no terminal chmod is needed.
#
# How it works: it sets one environment variable and then hands over to the real
# stop script, so there is only ONE copy of the stop logic to keep working. The
# export lives in this process only and cannot point the real stop script at the
# wrong instance.
#
# Only the port is needed. The stop script takes the data dir from the answer
# the server itself gives on /api/status and matches it against that folder's
# instance.json, so each copy proves its own identity - do not add SM3_DATA_DIR
# here, it would have no effect.
#
# NOTE: mirrors the Windows test-instance stop script but has NOT yet been run
# on a Mac. Verify with release/smoke-macos.sh
# (build-notes/macos-release-verification.md).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL="$HERE/Stop SetMaster 3.command"

if [ ! -f "$REAL" ]; then
    /usr/bin/osascript -e "display dialog \"SetMaster 3 is missing a required file: $REAL . Please reinstall SetMaster 3.\" buttons {\"OK\"} with icon stop with title \"SetMaster 3 (test instance)\"" >/dev/null 2>&1 || true
    echo "ERROR: missing $REAL" >&2
    exit 1
fi

export SM3_PORT="8140"

exec bash "$REAL"
