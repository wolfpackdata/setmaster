#!/bin/bash
# Reset test instance - double-click to empty the test copy (macOS)
#
# Double-click this file in Finder to throw away everything in the TEST copy of
# SetMaster 3 and start over with a fresh, empty one. It asks you to confirm
# first, then stops the test copy and deletes its data folder
# (~/Library/Application Support/SetMaster3-test).
#
# Your real SetMaster 3 - its sets, notes and settings - is NOT touched. This
# only ever affects the test copy on port 8140.
#
# Safety rules, most important first (#122):
#   1. The folder is HARD-CODED below and is deliberately NOT an argument. A
#      reset that can be pointed at another folder is a data-loss bug waiting
#      to happen.
#   2. It refuses unless the last part of the path is exactly
#      "SetMaster3-test", and refuses outright if that path is a symlink.
#   3. It refuses if something answering on the test port reports a different
#      data folder, because that is not the test instance.
#   4. SM3_DATA_DIR is ignored on purpose, so a stray environment variable
#      cannot redirect the delete.
#   5. The confirmation prompt fails closed: if it cannot be shown or is
#      cancelled, nothing is deleted.
#
# This file ships executable (mode 755 in git, exec bit set by the release
# builder, .tar.gz distribution preserves it), so no terminal chmod is needed.
#
# NOTE: mirrors the Windows reset script but has NOT yet been run on a Mac.
# Verify with release/smoke-macos.sh
# (build-notes/macos-release-verification.md).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TITLE="SetMaster 3 (test instance)"

# --- hard-coded identity of the test instance ----------------------------
TEST_PORT="8140"
TEST_DIR_NAME="SetMaster3-test"
TEST_DATA_DIR="$HOME/Library/Application Support/$TEST_DIR_NAME"
PROD_DATA_DIR="$HOME/Library/Application Support/SetMaster3"

note() {
    /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} with icon note with title \"$TITLE\"" >/dev/null 2>&1 || true
    echo "$1"
}

# Every refusal path ends here: say why, change nothing, exit non-zero.
refuse() {
    /usr/bin/osascript -e "display dialog \"$1\" buttons {\"OK\"} with icon stop with title \"$TITLE\"" >/dev/null 2>&1 || true
    echo "$1" >&2
    exit 1
}

confirm() {
    # SM3_RESET_CONFIRMED=1 stands in for a click; the automated launcher checks
    # set it. It skips only this prompt, never any of the guards above it.
    if [ "${SM3_RESET_CONFIRMED:-}" = "1" ]; then
        echo "Confirmation supplied via SM3_RESET_CONFIRMED=1."
        return 0
    fi
    # osascript exits non-zero when the user cancels AND when there is no GUI to
    # draw on, so a prompt that cannot be answered fails closed. The button text
    # is checked explicitly rather than trusting the exit status alone.
    local reply
    reply="$(/usr/bin/osascript -e "display dialog \"$1\" buttons {\"Cancel\",\"Reset\"} default button \"Cancel\" with icon caution with title \"$TITLE\"" 2>/dev/null)" || return 1
    case "$reply" in
        *"button returned:Reset"*) return 0 ;;
        *) return 1 ;;
    esac
}

# --- 1. prove the folder is the right one --------------------------------
# Guard A: the last part of the path must be exactly "SetMaster3-test".
if [ "$(basename "$TEST_DATA_DIR")" != "$TEST_DIR_NAME" ]; then
    refuse "The test instance was NOT reset: the folder to delete did not look like the test folder. Nothing was deleted."
fi

# Guard B: never the real folder, whatever the paths worked out to.
if [ "$TEST_DATA_DIR" = "$PROD_DATA_DIR" ]; then
    refuse "The test instance was NOT reset: the test folder and your real SetMaster 3 folder came out the same. Nothing was deleted."
fi

if [ ! -e "$TEST_DATA_DIR" ]; then
    note "The test instance is already empty - there is nothing to reset. Starting 'SetMaster 3 (test instance)' will create a fresh, empty copy. Your real SetMaster 3 data was not touched."
    exit 0
fi

# Guard C: a symlink would let a delete escape to another folder.
if [ -L "$TEST_DATA_DIR" ]; then
    refuse "The test instance was NOT reset: that folder is a symbolic link to somewhere else, and deleting it could remove the wrong files. Nothing was deleted."
fi

# Guard D: it must be a folder, not a file someone left with that name.
if [ ! -d "$TEST_DATA_DIR" ]; then
    refuse "The test instance was NOT reset: that path is a file, not a folder. Nothing was deleted."
fi

# Guard E: whatever is serving the test port must agree it owns this folder.
STATUS="$(curl -fsS --max-time 3 "http://127.0.0.1:$TEST_PORT/api/status" 2>/dev/null || true)"
if [ -n "$STATUS" ]; then
    SERVING="$(printf '%s' "$STATUS" | sed -n 's/.*"app_data_dir"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    if [ -n "$SERVING" ] && [ "${SERVING%/}" != "${TEST_DATA_DIR%/}" ]; then
        refuse "The test instance was NOT reset. SetMaster 3 is answering on port $TEST_PORT, but it is using this data folder: $SERVING - not the test folder: $TEST_DATA_DIR . That may be your real SetMaster 3 on the wrong port. Nothing was deleted."
    fi
fi

# --- 2. ask before destroying anything -----------------------------------
if ! confirm "This empties the TEST copy of SetMaster 3. Everything in the test copy - its sets, notes and settings - will be permanently deleted, and the next start will be a fresh, empty SetMaster 3. Your real SetMaster 3 data is NOT affected."; then
    note "The test instance was not reset. Nothing was deleted."
    exit 0
fi

# --- 3. stop the test instance so its files are not in use ---------------
STOPPER="$HERE/Stop SetMaster 3.command"
if [ -f "$STOPPER" ]; then
    echo "Stopping the test instance on port $TEST_PORT ..."
    SM3_PORT="$TEST_PORT" SM3_QUIET=1 bash "$STOPPER" || true
fi

# --- 4. delete the folder (retry: the server may still be letting go) ----
echo "Deleting $TEST_DATA_DIR ..."
for _ in $(seq 1 10); do
    [ -e "$TEST_DATA_DIR" ] || break
    rm -rf "$TEST_DATA_DIR" 2>/dev/null || true
    [ -e "$TEST_DATA_DIR" ] || break
    sleep 0.3
done

if [ -e "$TEST_DATA_DIR" ]; then
    refuse "The test instance could not be fully reset - some of its files are still in use. Close any SetMaster 3 test windows, run 'Stop SetMaster 3 (test instance).command', then try again. Your real SetMaster 3 data was not touched."
fi

note "The test copy of SetMaster 3 has been reset. The next time you start 'SetMaster 3 (test instance)' it will be a fresh, empty SetMaster 3. Your real SetMaster 3 data was not touched."
exit 0
