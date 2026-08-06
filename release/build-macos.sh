#!/bin/bash
# SetMaster 3 - macOS release builder (#179)
#
# Produces a clean-machine artifact: a .tar.gz that needs nothing preinstalled on
# the user's Mac (no Python, no Node, no terminal). .tar.gz rather than .zip
# because it preserves the executable bit on the .command launchers and on the
# bundled Python - a macOS double-click launcher that arrives non-executable is
# exactly the failure #182 is about.
#
# RUN THIS ON A MAC. It is a per-OS builder: the bundled CPython is a macOS
# build, and the executable bits it sets cannot be produced from Windows.
#
#     ./release/build-macos.sh              # host architecture
#     ./release/build-macos.sh macos-x64    # explicit target (Intel)
#
# Payload layout - the layout the launchers already assume, plus the runtime:
#
#     SetMaster3-<version>-<target>/
#         launchers/          double-click start/stop (what the user runs)
#         backend/app/        FastAPI app
#         backend/pipeline/   ported SM2 pipeline
#         frontend/dist/      built UI, served by the backend
#         runtime/python/     self-contained CPython + locked dependencies
#         release-info.json   version, commit, runtime, build time

set -euo pipefail

RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RELEASE_DIR/.." && pwd)"
CACHE_DIR="$RELEASE_DIR/.cache"
OUT_DIR="${SM3_RELEASE_OUT:-$RELEASE_DIR/dist}"

step() { printf '==> %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "build-macos.sh must run on macOS (this is $(uname -s)). Use release/build-windows.ps1 on Windows."

# --- 0. inputs ---------------------------------------------------------------
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
    case "$(uname -m)" in
        arm64)  TARGET="macos-arm64" ;;
        x86_64) TARGET="macos-x64" ;;
        *)      fail "Unsupported architecture: $(uname -m)" ;;
    esac
fi

PY_BOOTSTRAP="$(command -v python3 || true)"
[ -n "$PY_BOOTSTRAP" ] || fail "python3 is needed to read release/runtime.json (macOS ships one with the Command Line Tools)."

read_cfg() {  # <python expression over the parsed runtime.json, as `cfg`>
    "$PY_BOOTSTRAP" -c '
import json, sys
cfg = json.load(open(sys.argv[1]))
print(eval(sys.argv[2]))
' "$RELEASE_DIR/runtime.json" "$1"
}

VERSION="$("$PY_BOOTSTRAP" - "$REPO_ROOT/backend/app/__init__.py" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
m = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', text)
print(m.group(1) if m else "")
PY
)"
[ -n "$VERSION" ] || fail "Could not read APP_VERSION from backend/app/__init__.py"

ASSET="$(read_cfg "cfg['targets']['$TARGET']['asset']")"
SHA_EXPECTED="$(read_cfg "cfg['targets']['$TARGET']['sha256']")"
BASE_URL="$(read_cfg "cfg['base_url']")"
PY_VERSION="$(read_cfg "cfg['python_version']")"
PBS_RELEASE="$(read_cfg "cfg['pbs_release']")"
[ -n "$ASSET" ] || fail "release/runtime.json has no target '$TARGET'"

COMMIT="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
NAME="SetMaster3-$VERSION-$TARGET"
PAYLOAD="$OUT_DIR/$NAME"

step "SetMaster 3 $VERSION ($COMMIT) -> $NAME"

# --- 1. build the UI ---------------------------------------------------------
step "Building the UI (frontend/dist)"
command -v npm >/dev/null 2>&1 || fail "npm is required to build the UI. Install Node.js and re-run."
(
    cd "$REPO_ROOT/frontend"
    if [ "${SM3_SKIP_NPM_CI:-}" != "1" ]; then npm ci; fi
    npm run build
)
[ -f "$REPO_ROOT/frontend/dist/index.html" ] || fail "frontend/dist/index.html is missing after the build"

# --- 2. fetch + verify the self-contained CPython ----------------------------
step "Fetching CPython $PY_VERSION ($TARGET)"
mkdir -p "$CACHE_DIR"
TARBALL="$CACHE_DIR/$ASSET"
if [ ! -f "$TARBALL" ]; then
    curl -fL --retry 3 -o "$TARBALL" "$BASE_URL/$ASSET"
fi
SHA_ACTUAL="$(shasum -a 256 "$TARBALL" | awk '{print $1}')"
[ "$SHA_ACTUAL" = "$SHA_EXPECTED" ] || fail "Runtime checksum mismatch for $ASSET
  expected $SHA_EXPECTED
  actual   $SHA_ACTUAL"
echo "    sha256 verified"

# --- 3. assemble the payload -------------------------------------------------
step "Assembling the payload"
rm -rf "$PAYLOAD"
mkdir -p "$PAYLOAD/runtime" "$PAYLOAD/backend" "$PAYLOAD/frontend"
tar -xzf "$TARBALL" -C "$PAYLOAD/runtime"
PY="$PAYLOAD/runtime/python/bin/python3"
[ -x "$PY" ] || fail "Extracted runtime has no executable python3 at $PY"

step "Installing locked dependencies into the bundled runtime"
"$PY" -m pip install --no-cache-dir --no-warn-script-location -r "$RELEASE_DIR/requirements.txt"
"$PY" -c "import fastapi, uvicorn, pandas, numpy, openpyxl, regex, multipart; print('    runtime imports OK')"

step "Copying application files"
cp -R "$REPO_ROOT/backend/app"      "$PAYLOAD/backend/app"
cp -R "$REPO_ROOT/backend/pipeline" "$PAYLOAD/backend/pipeline"
cp -R "$REPO_ROOT/frontend/dist"    "$PAYLOAD/frontend/dist"
cp -R "$REPO_ROOT/launchers"        "$PAYLOAD/launchers"

# --- 3a. strip the build machine out of the payload (#223) -------------------
# A .pyc records the ABSOLUTE path of the source it was compiled from, and that
# path is what appears in every traceback the user ever sees. pip compiles
# bytecode during `pip install`, so the ~2,940 .pyc it just wrote into
# runtime/python/lib all carry this machine's home directory. Purging only
# backend/ (which is what this script used to do) left every one of them in
# place: measured on the 3.0.3 macOS payload, 2,945 files named /Users/<builder>.
#
# So purge the WHOLE payload and recompile it ourselves with the recorded root
# rewritten to "SetMaster3" - which leaks nothing and reads better in a stack
# trace than an absolute path ever did.
step "Pre-compiling bytecode with the build path stripped (#223)"
find "$PAYLOAD" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find "$PAYLOAD" -name '*.pyc' -delete 2>/dev/null || true

# -s/-p, NOT --stripdir/--prependdir: the long forms do not exist, and passing
# them fails the whole call. Do not swallow the error - a silent failure here
# ships ~3k absolute build paths to users, which is exactly how #223 happened.
#
# unchecked-hash invalidation makes each .pyc valid regardless of the source
# file's mtime, which copying and archiving do not reliably preserve. With
# mtime-based .pyc the user's Python would consider them stale and recompile on
# first run, silently paying the startup cost the pre-compile exists to avoid.
"$PY" -m compileall -q -f \
    --invalidation-mode unchecked-hash \
    -s "$PAYLOAD" -p "SetMaster3" \
    "$PAYLOAD/runtime/python/lib" \
    "$PAYLOAD/backend" \
    || fail "bytecode pre-compilation failed - do not ship this build"
echo "    $(find "$PAYLOAD" -name '*.pyc' | wc -l | tr -d ' ') .pyc files pre-compiled"

# pip writes the build-time interpreter path into every console-script shim's
# shebang (uvicorn, fastapi, f2py, idna, numpy-config). The launchers run
# `python3 -m uvicorn` and never invoke these, but they ship, so they leak.
step "Sanitizing console-script shebangs (#223)"
SHIMS=0
for shim in "$PAYLOAD/runtime/python/bin/"*; do
    [ -f "$shim" ] || continue
    head -c 2 "$shim" 2>/dev/null | grep -q '#!' || continue
    if grep -qI -e "$REPO_ROOT" -e "$HOME" "$shim" 2>/dev/null; then
        "$PY_BOOTSTRAP" - "$shim" <<'PY'
import sys
path = sys.argv[1]
lines = open(path, encoding="utf-8", errors="surrogateescape").read().split("\n")
lines[0] = "#!/usr/bin/env python3"
open(path, "w", encoding="utf-8", errors="surrogateescape").write("\n".join(lines))
PY
        SHIMS=$((SHIMS + 1))
    fi
done
echo "    rewrote $SHIMS shebang(s) that named the build machine"

# The whole point of shipping a tarball: the double-click launchers arrive
# executable, so a user never needs a terminal chmod (#182).
step "Setting executable bits on the launchers"
chmod +x "$PAYLOAD/launchers/"*.command
ls -l "$PAYLOAD/launchers/"*.command | sed 's/^/    /'

cp "$RELEASE_DIR/INSTALL-macos.txt" "$PAYLOAD/READ ME FIRST.txt"
BUILT_AT="$(date +%Y-%m-%dT%H:%M:%S%z)"
cat > "$PAYLOAD/release-info.json" <<JSON
{
  "app_version": "$VERSION",
  "git_commit": "$COMMIT",
  "target": "$TARGET",
  "python_version": "$PY_VERSION",
  "pbs_release": "$PBS_RELEASE",
  "built_at": "$BUILT_AT",
  "built_on": "$(uname -srm)"
}
JSON

# --- 4. leak scan, last, on the finished payload (#223) ----------------------
# tools/public-mirror/scan.py gates the SOURCE tree and cannot see any of this:
# these paths are injected by the build, not committed. So the artifact needs
# its own gate. It has already earned itself once - on the .dmg path it is what
# caught a compileall call failing silently.
#
# Deliberately the last thing before the tarball, so it also covers
# release-info.json and anything else written after the payload was assembled.
step "Leak scan of the finished payload (#223)"
# scan_paths.py, not `grep -rIl`: grep searches for one contiguous byte run, so
# it cannot see a path stored as UTF-16, and it is case-sensitive. Both are
# fail-open in the one check whose whole job is to fail closed. The shared
# scanner is also what the Windows side and the smoke checks run, so all five
# gates now agree on what "names the build machine" means.
LEAK_LIST="$(mktemp)"
NEEDLES="$(mktemp)"
printf '%s\n' "$REPO_ROOT" "$HOME" > "$NEEDLES"
set +e
"$PY_BOOTSTRAP" "$RELEASE_DIR/scan_paths.py" "$PAYLOAD" "$NEEDLES" > "$LEAK_LIST"
SCAN_RC=$?
set -e
rm -f "$NEEDLES"
# 0 = clean, 1 = hits. Anything else is the scanner itself failing, which must
# not read as "clean" - that is how a silently-failing compileall shipped once.
if [ "$SCAN_RC" -gt 1 ]; then
    rm -f "$LEAK_LIST"
    fail "the leak scanner failed (exit $SCAN_RC). Refusing to vouch for this payload."
fi
LEAKS="$(wc -l < "$LEAK_LIST" | tr -d ' ')"
if [ "$LEAKS" != "0" ]; then
    sed -n '1,10p' "$LEAK_LIST" | sed "s|^|    |"
    [ "$LEAKS" -gt 10 ] && echo "    ... and $((LEAKS - 10)) more"
    rm -f "$LEAK_LIST"
    fail "$LEAKS file(s) in the payload name the build machine. Do not ship this build."
fi
rm -f "$LEAK_LIST"
echo "    no build-machine paths in the payload (utf-8, utf-16le, utf-16be)"

# --- 5. tar it ---------------------------------------------------------------
step "Creating the tarball"
ARCHIVE="$OUT_DIR/$NAME.tar.gz"
rm -f "$ARCHIVE"
tar -czf "$ARCHIVE" -C "$OUT_DIR" "$NAME"
ARCHIVE_SHA="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
SIZE="$(du -h "$ARCHIVE" | awk '{print $1}')"

echo
echo "Artifact : $ARCHIVE"
echo "Size     : $SIZE"
echo "SHA256   : $ARCHIVE_SHA"
echo "Payload  : $PAYLOAD"
echo
echo "Smoke-test the artifact before releasing it:"
echo "    ./release/smoke-macos.sh \"$ARCHIVE\""
