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
find "$PAYLOAD/backend" -name '__pycache__' -type d -prune -exec rm -rf {} +
find "$PAYLOAD/backend" -name '*.pyc' -delete

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

# --- 4. tar it ---------------------------------------------------------------
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
