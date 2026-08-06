#!/bin/bash
# SetMaster - signed, notarized macOS .app inside a .dmg (#214)
#
# Turns the release payload built by build-macos.sh into SetMaster.app, signs
# it with Developer ID, notarizes it, and wraps it in a drag-to-Applications
# disk image that opens with no Gatekeeper prompts.
#
#     ./release/build-macos-dmg.sh                 # full run, notarized
#     ./release/build-macos-dmg.sh --no-notarize   # local iteration, signed only
#     ./release/build-macos-dmg.sh --reuse-payload # skip build-macos.sh
#
# Requires: Developer ID Application identity in the login keychain, and a
# notarytool keychain profile (default SM3-notary, override with SM3_NOTARY_PROFILE).
#
# WHY NOT codesign --deep
# -----------------------
# --deep passes local verification and is then REJECTED at notarization. The
# bundled CPython carries many nested Mach-O files - 76 as of 3.0.3, mostly
# lib-dynload and the numpy/pandas extension modules, and that count grows with
# every dependency added. Each must be signed individually, innermost first,
# before the outer bundle is sealed. This script finds them by magic bytes
# rather than by extension, because plenty carry no suffix at all.
#
# python-build-standalone ships ad-hoc signed binaries, so every codesign call
# needs --force or it refuses to replace the existing signature.

set -euo pipefail

RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$RELEASE_DIR/.." && pwd)"
OUT_DIR="${SM3_RELEASE_OUT:-$RELEASE_DIR/dist}"
MACOS_DIR="$RELEASE_DIR/macos"

APP_NAME="SetMaster"
BUNDLE_ID="com.wolfstrategyllc.setmaster"
# The floor the app claims to Launch Services. It is NOT a free choice: the
# bundled wheels set a hard lower bound, and the gate in section 3a fails the
# build if anything in the payload needs a newer macOS than this. 14.0 because
# numpy ships arm64 as macosx_14_0_arm64 (#229).
MIN_MACOS="14.0"
NOTARY_PROFILE="${SM3_NOTARY_PROFILE:-SM3-notary}"

NOTARIZE=1
REUSE_PAYLOAD=0
for arg in "$@"; do
    case "$arg" in
        --no-notarize)   NOTARIZE=0 ;;
        --reuse-payload) REUSE_PAYLOAD=1 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

step() { printf '\n==> %s\n' "$1"; }
info() { printf '    %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

# Submit and wait, but survive a slow queue.
#
# `notarytool submit --wait` aborts on its own timeout and takes the submission
# id with it, so a build that was minutes from succeeding has to start over.
# Observed 2026-08-04: a valid submission sat In Progress for over three hours
# while Apple's status page stayed green, and one 18 KB test bundle was accepted
# in the same window - the queue, not the payload.
#
# So: submit once, keep the id, then poll. On timeout the id is printed with the
# command to resume, and nothing already uploaded is wasted.
notarize_wait() {  # <file> <label>
    local file="$1" label="$2" id status waited=0 out
    local budget="${SM3_NOTARY_BUDGET:-7200}"   # seconds; override for a slow day

    # Capture, THEN parse. Piping notarytool straight into `awk ... exit` closes
    # the pipe while notarytool is still writing, so it takes SIGPIPE and
    # `pipefail` turns the assignment into exit 141 - killing the build under
    # `set -e` a moment after the submission went live at Apple (#247). Whether
    # it loses that race depends on notarytool's output buffering, which differs
    # between a TTY and a file, so it passed interactively for months and failed
    # every time the build was logged or backgrounded. Once the output is a
    # shell string there is no reader to disappear and `exit` is harmless.
    out="$(xcrun notarytool submit "$file" --keychain-profile "$NOTARY_PROFILE" \
           --no-wait 2>&1)" || { printf '%s\n' "$out" >&2
                                 fail "notarytool submit failed for $label"; }
    id="$(printf '%s\n' "$out" | awk '/^  id:/{print $2; exit}')"
    [ -n "$id" ] || { printf '%s\n' "$out" >&2
                      fail "could not read a submission id for $label"; }
    info "submission id: $id"

    while [ "$waited" -lt "$budget" ]; do
        out="$(xcrun notarytool info "$id" --keychain-profile "$NOTARY_PROFILE" 2>&1 || true)"
        status="$(printf '%s\n' "$out" | awk '/status:/{ $1=""; sub(/^ /,""); print; exit }')"
        case "$status" in
            Accepted)
                info "accepted after $((waited / 60))m"
                return 0 ;;
            "In Progress"|"")
                sleep 30; waited=$((waited + 30))
                if [ $((waited % 300)) -eq 0 ]; then info "  still queued (${waited}s)"; fi
                ;;
            *)
                printf '\n'
                # Same capture-then-trim as above, and it matters most here:
                # piping into `head -60` can SIGPIPE the log fetch, and under
                # `pipefail` + `set -e` that kills the script before `fail`
                # runs - losing the one output that says WHY Apple rejected it.
                out="$(xcrun notarytool log "$id" --keychain-profile "$NOTARY_PROFILE" 2>&1 || true)"
                printf '%s\n' "$out" | sed -n '1,60p'
                fail "$label notarization returned: $status (id $id)" ;;
        esac
    done

    fail "$label is still queued after $((budget / 60))m. Nothing is lost - the
    submission is live. Check it with:
        xcrun notarytool info $id --keychain-profile $NOTARY_PROFILE
    then re-run with --reuse-payload once it is Accepted."
}

[ "$(uname -s)" = "Darwin" ] || fail "must run on macOS"
[ "$(uname -m)" = "arm64" ]  || fail "this project ships Apple Silicon only (#214)"

# --- 0. inputs ---------------------------------------------------------------

# NOTE: no literal apostrophes below. macOS ships bash 3.2, which tracks quotes
# while scanning for the closing paren of $( ) even inside a quoted heredoc, so
# an odd number of them here is a syntax error in the whole script.
VERSION="$(python3 - "$REPO_ROOT/backend/app/__init__.py" <<'PY'
import sys
QUOTES = chr(34) + chr(39)
version = "0.0.0"
for line in open(sys.argv[1], encoding="utf-8"):
    if line.strip().startswith("APP_VERSION"):
        version = line.split("=", 1)[1].strip().strip(QUOTES)
        break
print(version)
PY
)"
TARGET="macos-arm64"
PAYLOAD="$OUT_DIR/SetMaster3-$VERSION-$TARGET"
APP="$OUT_DIR/$APP_NAME.app"
DMG="$OUT_DIR/$APP_NAME-$VERSION-macos-arm64.dmg"
ICNS="$MACOS_DIR/$APP_NAME.icns"

[ -f "$ICNS" ] || fail "missing $ICNS - run: python3 tools/icon/make-icon.py"

# The identity is resolved by name; the System-keychain duplicate that made this
# ambiguous was removed on 2026-08-04 (see the runbook).
IDENTITY="$(security find-identity -v -p codesigning \
            | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)"
[ -n "$IDENTITY" ] || fail "no Developer ID Application identity in the keychain"
info "identity: $IDENTITY"

if [ "$NOTARIZE" = "1" ]; then
    xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 \
        || fail "notarytool profile '$NOTARY_PROFILE' is not usable. Create it with:
    xcrun notarytool store-credentials \"$NOTARY_PROFILE\" --apple-id <id> --team-id <team>"
fi

# --- 1. payload --------------------------------------------------------------

if [ "$REUSE_PAYLOAD" = "1" ] && [ -d "$PAYLOAD" ]; then
    step "Reusing payload $PAYLOAD"
else
    step "Building the release payload"
    "$RELEASE_DIR/build-macos.sh" "$TARGET"
fi
[ -d "$PAYLOAD" ] || fail "payload not found at $PAYLOAD"

# --- 2. compile the launcher -------------------------------------------------

step "Compiling the launcher"
LAUNCHER_BIN="$(mktemp -d)/$APP_NAME"
clang -fobjc-arc -framework Cocoa \
      -mmacosx-version-min="$MIN_MACOS" \
      -O2 -Wall \
      -o "$LAUNCHER_BIN" "$MACOS_DIR/launcher/SetMaster.m"
info "$(file -b "$LAUNCHER_BIN")"

# --- 3. assemble the bundle --------------------------------------------------

step "Assembling $APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

cp "$LAUNCHER_BIN" "$APP/Contents/MacOS/$APP_NAME"
chmod 755 "$APP/Contents/MacOS/$APP_NAME"
cp "$ICNS" "$APP/Contents/Resources/$APP_NAME.icns"

# Only what the app runs. launchers/ and the READ ME are for the .tar.gz
# distribution; inside the .app the launcher IS the app.
for item in backend frontend runtime release-info.json; do
    [ -e "$PAYLOAD/$item" ] || fail "payload is missing $item"
    cp -R "$PAYLOAD/$item" "$APP/Contents/Resources/app/"
done

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>                  <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>           <string>$APP_NAME</string>
    <key>CFBundleExecutable</key>            <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>            <string>$BUNDLE_ID</string>
    <key>CFBundleIconFile</key>              <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>           <string>APPL</string>
    <key>CFBundleShortVersionString</key>    <string>$VERSION</string>
    <key>CFBundleVersion</key>               <string>$VERSION</string>
    <key>CFBundleInfoDictionaryVersion</key> <string>6.0</string>
    <key>LSMinimumSystemVersion</key>        <string>$MIN_MACOS</string>
    <key>LSApplicationCategoryType</key>     <string>public.app-category.music</string>
    <key>NSHighResolutionCapable</key>       <true/>
    <key>NSHumanReadableCopyright</key>      <string>SetMaster is unaffiliated fan software. Not affiliated with or endorsed by Native Instruments or Spotify.</string>
</dict>
</plist>
PLIST

# The bundle must be read-only at runtime; user data lives in
# ~/Library/Application Support/SetMaster3 and logs in ~/Library/Logs/SetMaster3.
find "$APP" -name '.DS_Store' -delete 2>/dev/null || true

# Pre-compile bytecode BEFORE signing, so the .pyc files are sealed into the
# signature instead of appearing at first launch and invalidating it.
#
# Measured, not theoretical: without this the first run writes 980 .pyc files
# into the bundle and `codesign --verify` immediately reports "a sealed resource
# is missing or invalid". Deleting __pycache__ pre-sign makes it worse, not
# better - Python just recreates it on launch.
#
# unchecked-hash invalidation makes each .pyc valid regardless of the source
# file's mtime, which copying and archiving do not preserve. With mtime-based
# .pyc, Python would consider them stale and try to rewrite - which the runtime
# guard below then blocks, silently costing startup time on every launch.
# --stripdir/-p matter for privacy, not tidiness: a .pyc records the absolute
# path of the file it was compiled from, and that path is what appears in every
# traceback. Compiling in place would stamp the BUILD MACHINE's home directory
# into all ~3.5k of them and ship it to users. Rewriting the recorded root to
# "SetMaster" leaks nothing and reads better in a stack trace.
# The payload's own __pycache__ came from pip at build time and records the
# PAYLOAD path, so copying it in would ship the build machine's home directory
# even though we recompile. Purge first, then compile everything ourselves.
step "Pre-compiling bytecode (sealed into the signature)"
find "$APP/Contents/Resources/app" -name '__pycache__' -type d -prune \
     -exec rm -rf {} + 2>/dev/null || true

# -s/-p, NOT --stripdir/--prependdir: the long forms do not exist, and getting
# this wrong fails the whole call. Do not swallow the error - a silent failure
# here ships ~3k absolute build paths to users.
PYTHONDONTWRITEBYTECODE=1 \
"$APP/Contents/Resources/app/runtime/python/bin/python3" -m compileall -q -f \
    --invalidation-mode unchecked-hash \
    -s "$APP/Contents/Resources/app" -p "SetMaster" \
    "$APP/Contents/Resources/app/runtime/python/lib" \
    "$APP/Contents/Resources/app/backend" \
    || fail "bytecode pre-compilation failed - do not ship this build"
info "$(find "$APP" -name '*.pyc' | wc -l | tr -d ' ') .pyc files pre-compiled"

# pip writes the build-time interpreter path into every console-script shim's
# shebang. The launcher runs `python3 -m uvicorn` and never invokes these, but
# they still ship, so they still leak. Pre-existing - the .tar.gz carries the
# same thing on both platforms.
step "Sanitizing console-script shebangs"
SHIMS=0
for shim in "$APP/Contents/Resources/app/runtime/python/bin/"*; do
    [ -f "$shim" ] || continue
    head -c 2 "$shim" 2>/dev/null | grep -q '#!' || continue
    if grep -qI "$REPO_ROOT" "$shim" 2>/dev/null; then
        python3 - "$shim" <<'PY'
import sys
path = sys.argv[1]
lines = open(path, encoding="utf-8", errors="surrogateescape").read().split("\n")
lines[0] = "#!/usr/bin/env python3"
open(path, "w", encoding="utf-8", errors="surrogateescape").write("\n".join(lines))
PY
        SHIMS=$((SHIMS + 1))
    fi
done
info "rewrote $SHIMS shebang(s) that named the build machine"

# The mirror's leak scan (tools/public-mirror/scan.py) checks the SOURCE tree and
# cannot see this: absolute paths are injected by the build, not committed. So
# the artifact needs its own gate. It has already earned itself once - it is what
# caught the compileall call failing silently.
#
# scan_paths.py rather than `grep -rIl`: grep looks for one contiguous byte run,
# so a path stored as UTF-16 (a PE resource, a plist, any UTF-16 string table)
# steps straight past it, and grep is case-sensitive on a filesystem that is not.
step "Leak scan of the assembled bundle"
LEAK_LIST="$(mktemp)"
NEEDLES="$(mktemp)"
printf '%s\n' "$REPO_ROOT" "$HOME" > "$NEEDLES"
set +e
python3 "$RELEASE_DIR/scan_paths.py" "$APP/Contents/Resources/app" "$NEEDLES" > "$LEAK_LIST"
SCAN_RC=$?
set -e
rm -f "$NEEDLES"
if [ "$SCAN_RC" -gt 1 ]; then
    rm -f "$LEAK_LIST"
    fail "the leak scanner failed (exit $SCAN_RC). Refusing to vouch for this bundle."
fi
LEAKS="$(wc -l < "$LEAK_LIST" | tr -d ' ')"
if [ "$LEAKS" != "0" ]; then
    sed -n '1,10p' "$LEAK_LIST" | sed "s|^|    |"
    [ "$LEAKS" -gt 10 ] && info "    ... and $((LEAKS - 10)) more"
    rm -f "$LEAK_LIST"
    fail "$LEAKS file(s) in the bundle name the build machine. Do not ship this build."
fi
rm -f "$LEAK_LIST"
info "no build-machine paths in the payload (utf-8, utf-16le, utf-16be)"

info "bundle size: $(du -sh "$APP" | cut -f1)"

# --- 4. deep-sign, innermost first -------------------------------------------

step "Finding nested Mach-O binaries"
MACHO_LIST="$(mktemp)"
python3 - "$APP" > "$MACHO_LIST" <<'PY'
import os, sys
# Mach-O magics: 64/32-bit LE+BE, and fat/universal in BOTH widths.
#
# FAT_MAGIC_64/FAT_CIGAM_64 (...bf) are not decoration. A 64-bit universal
# binary whose magic is missing here is invisible to this walk, which means it
# is absent from the deployment-floor check AND from the innermost-first signing
# list below - it would ship unsigned inside a signed bundle and unchecked
# against the OS floor the app claims.
MAGIC = {
    b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce",
    b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca",
    b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca",
}
for dirpath, _dirnames, filenames in os.walk(sys.argv[1]):
    for name in filenames:
        path = os.path.join(dirpath, name)
        if os.path.islink(path):
            continue
        try:
            with open(path, "rb") as fh:
                if fh.read(4) in MAGIC:
                    print(path)
        except OSError:
            pass
PY
COUNT="$(wc -l < "$MACHO_LIST" | tr -d ' ')"
info "$COUNT nested Mach-O files"

# --- 3a. the OS floor we claim must be one the payload can actually meet ------
#
# LSMinimumSystemVersion is a promise to Launch Services, and Launch Services
# believes it: set it too low and macOS cheerfully opens an app whose runtime
# cannot load. dyld refuses any Mach-O whose LC_BUILD_VERSION minos exceeds the
# running OS, so a single too-new dependency breaks the whole backend.
#
# Not hypothetical (#229). MIN_MACOS was 11.0 while numpy shipped its only arm64
# wheel as macosx_14_0_arm64: 19 binaries in the bundle recorded minos 14.0, so
# every macOS 11-13 user could install the app and never start it.
#
# Keeping the claim and the payload in sync by hand is exactly the kind of thing
# that silently rots, so it is checked instead.
step "Checking every bundled binary can run on macOS $MIN_MACOS"
MINOS_REPORT="$(mktemp)"
python3 - "$MIN_MACOS" "$MACHO_LIST" > "$MINOS_REPORT" <<'PY'
import struct, sys

LC_VERSION_MIN_MACOSX, LC_BUILD_VERSION = 0x24, 0x32
THIN = {b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe",
        b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce"}
FAT32 = {b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"}
FAT64 = {b"\xca\xfe\xba\xbf", b"\xbf\xba\xfe\xca"}
# The CIGAM spellings are the byte-swapped ones, i.e. little-endian headers.
FAT_LE = {b"\xbe\xba\xfe\xca", b"\xbf\xba\xfe\xca"}
# Real universal binaries carry a handful of slices. A wild count means the
# bytes are not what we think they are, and guessing is how a gate fails open.
MAX_FAT_ARCHES = 64


class Unparseable(Exception):
    """These bytes are not a Mach-O this gate can read - so it must not vouch."""


def ver(raw):
    return (raw >> 16, (raw >> 8) & 0xFF, raw & 0xFF)


def minos_of_slice(data, off):
    """Highest deployment target in the Mach-O header at `off`.

    Returns None when the slice parses cleanly but records no deployment target
    at all; raises Unparseable when the bytes cannot be read as a Mach-O. The
    caller has to tell those apart, because both are "not a version" but only
    one of them means the file might be lying about what it needs.
    """
    magic = data[off:off + 4]
    if magic in (b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe"):
        endian, wide = "<", magic[0] == 0xCF
    elif magic in (b"\xfe\xed\xfa\xcf", b"\xfe\xed\xfa\xce"):
        endian, wide = ">", magic[3] == 0xCF
    else:
        raise Unparseable(f"unrecognized Mach-O magic {magic.hex()} at offset {off}")

    hdr = 32 if wide else 28
    if off + hdr > len(data):
        raise Unparseable("truncated Mach-O header")
    ncmds, sizeofcmds = struct.unpack_from(endian + "II", data, off + 16)
    end = off + hdr + sizeofcmds
    if end > len(data):
        raise Unparseable("load commands run past the end of the file")

    pos, best = off + hdr, None
    for _ in range(ncmds):
        if pos + 8 > end:
            raise Unparseable("load command table is shorter than ncmds claims")
        cmd, cmdsize = struct.unpack_from(endian + "II", data, pos)
        # cmdsize 0 used to break out of the loop and report whatever had been
        # seen so far. A zero or oversized cmdsize is a corrupt binary, and
        # "report what we got" on a corrupt binary is a guess.
        if cmdsize < 8 or pos + cmdsize > end:
            raise Unparseable(f"bad load command size {cmdsize} at offset {pos}")
        if cmd == LC_BUILD_VERSION:
            if cmdsize < 16:
                raise Unparseable("LC_BUILD_VERSION too short to hold minos")
            found = ver(struct.unpack_from(endian + "I", data, pos + 12)[0])
        elif cmd == LC_VERSION_MIN_MACOSX:
            if cmdsize < 12:
                raise Unparseable("LC_VERSION_MIN_MACOSX too short to hold version")
            found = ver(struct.unpack_from(endian + "I", data, pos + 8)[0])
        else:
            found = None
        if found and (best is None or found > best):
            best = found
        pos += cmdsize
    return best


def minos_of(path):
    """Highest target across every slice, or None if any slice records none."""
    with open(path, "rb") as fh:
        data = fh.read()
    magic = data[:4]

    if magic in FAT32 or magic in FAT64:
        wide = magic in FAT64
        endian = "<" if magic in FAT_LE else ">"
        arch_sz = 32 if wide else 20     # fat_arch vs fat_arch_64
        if len(data) < 8:
            raise Unparseable("truncated fat header")
        nfat = struct.unpack_from(endian + "I", data, 4)[0]
        if nfat == 0:
            raise Unparseable("fat binary declares no architectures")
        if nfat > MAX_FAT_ARCHES or 8 + nfat * arch_sz > len(data):
            raise Unparseable(f"implausible fat architecture count {nfat}")
        best = None
        for i in range(nfat):
            base = 8 + i * arch_sz
            # fat_arch_64 widens `offset` and `size` to 64 bits, which is the
            # whole reason the struct exists - reading it as 32 bits lands
            # somewhere arbitrary in the file.
            off = struct.unpack_from(endian + ("Q" if wide else "I"), data, base + 8)[0]
            if off + 4 > len(data):
                raise Unparseable(f"fat slice {i} offset {off} is past the end of the file")
            found = minos_of_slice(data, off)
            # Universal binaries are only as portable as their worst slice, so
            # one slice with no recorded target makes the whole file unknown.
            if found is None:
                return None
            if best is None or found > best:
                best = found
        return best

    if magic in THIN:
        return minos_of_slice(data, 0)
    raise Unparseable(f"not a Mach-O (magic {magic.hex()})")


floor = tuple(int(p) for p in (sys.argv[1].split(".") + ["0", "0"])[:3])
too_new, unknown = [], []
for line in open(sys.argv[2], encoding="utf-8"):
    path = line.rstrip("\n")
    if not path:
        continue
    try:
        found = minos_of(path)
        reason = None if found else "records no deployment target"
    except Unparseable as exc:
        found, reason = None, str(exc)
    except (OSError, struct.error) as exc:
        found, reason = None, f"unreadable: {exc}"
    if found is None:
        unknown.append((reason, path))
    elif found > floor:
        too_new.append((".".join(str(n) for n in found), path))

print(f"UNKNOWN {len(unknown)}")
for reason, path in sorted(unknown):
    print(f"UNKNOWNFILE {path} :: {reason}")
for version, path in sorted(too_new, reverse=True):
    print(f"TOONEW {version} {path}")
PY
TOO_NEW="$(grep -c '^TOONEW ' "$MINOS_REPORT" || true)"
UNKNOWN_N="$(grep '^UNKNOWN ' "$MINOS_REPORT" | awk '{print $2}')"
if [ "$TOO_NEW" != "0" ]; then
    grep '^TOONEW ' "$MINOS_REPORT" | head -10 |
        sed "s|^TOONEW |    macOS |; s|$APP/|.../|"
    [ "$TOO_NEW" -gt 10 ] && info "    ... and $((TOO_NEW - 10)) more"
    rm -f "$MINOS_REPORT" "$MACHO_LIST"
    fail "$TOO_NEW bundled binary(ies) need a newer macOS than the $MIN_MACOS this app claims.
  Raise MIN_MACOS (and every user-facing support claim with it), or pin
  dependencies whose wheels target $MIN_MACOS or older. Do not ship this build:
  Launch Services would let these users open an app that cannot start."
fi
# A file this gate could not read is a file it cannot clear. Counting it and
# carrying on - then printing "every binary runs on macOS X" - is a gate that
# reports success over the exact cases it failed to check.
if [ "$UNKNOWN_N" != "0" ]; then
    grep '^UNKNOWNFILE ' "$MINOS_REPORT" | head -10 |
        sed "s|^UNKNOWNFILE |    |; s|$APP/|.../|"
    [ "$UNKNOWN_N" -gt 10 ] && info "    ... and $((UNKNOWN_N - 10)) more"
    rm -f "$MINOS_REPORT" "$MACHO_LIST"
    fail "$UNKNOWN_N bundled Mach-O file(s) record no readable deployment target.
  This gate cannot clear them against the macOS $MIN_MACOS floor, so it will not
  claim the payload meets it. Investigate each file above: a corrupt or
  unexpected-format binary in the bundle is itself worth knowing about."
fi
rm -f "$MINOS_REPORT"
info "all $COUNT nested Mach-O files run on macOS $MIN_MACOS or newer"

step "Signing nested binaries"
# Deepest paths first so any nested bundle is sealed before its container.
SIGNED=0
while IFS= read -r bin; do
    [ -n "$bin" ] || continue
    codesign --force --timestamp --options runtime \
             --sign "$IDENTITY" "$bin" >/dev/null 2>&1 \
        || fail "failed to sign $bin"
    SIGNED=$((SIGNED + 1))
    if [ $((SIGNED % 100)) -eq 0 ]; then info "  $SIGNED/$COUNT"; fi
done < <(awk '{print gsub(/\//,"/"), $0}' "$MACHO_LIST" | sort -rn | cut -d' ' -f2-)
info "signed $SIGNED nested binaries"
rm -f "$MACHO_LIST"

step "Sealing the bundle"
codesign --force --timestamp --options runtime \
         --sign "$IDENTITY" "$APP"

step "Verifying the signature"
codesign --verify --strict --verbose=2 "$APP"
codesign -dv --verbose=4 "$APP" 2>&1 | grep -E "^(Authority|TeamIdentifier|Identifier|CodeDirectory)" | sed 's/^/    /'

# --- 5. notarize the app -----------------------------------------------------

if [ "$NOTARIZE" = "1" ]; then
    step "Notarizing $APP_NAME.app"
    ZIP="$(mktemp -d)/$APP_NAME.zip"
    ditto -c -k --keepParent "$APP" "$ZIP"
    notarize_wait "$ZIP" "$APP_NAME.app"
    step "Stapling the app"
    xcrun stapler staple "$APP"
    xcrun stapler validate "$APP"
fi

# --- 6. disk image -----------------------------------------------------------

step "Building the disk image"
STAGE="$(mktemp -d)/dmg"
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$STAGE" \
        -ov -format UDZO -fs HFS+ "$DMG" >/dev/null
# stat, not du: du reports allocated blocks, which for this image reads ~14%
# high (99M vs the real 83 MiB) and is not the number a user sees when
# downloading it.
DMG_BYTES="$(stat -f%z "$DMG")"
info "$(basename "$DMG")  ($((DMG_BYTES / 1000000)) MB, $DMG_BYTES bytes)"

step "Signing the disk image"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"

if [ "$NOTARIZE" = "1" ]; then
    step "Notarizing the disk image"
    # Built from the already-stapled app, so the ticket travels inside it too.
    notarize_wait "$DMG" "the disk image"
    step "Stapling the disk image"
    xcrun stapler staple "$DMG"
    xcrun stapler validate "$DMG"

    step "Gatekeeper assessment"
    spctl -a -vvv -t install "$DMG" 2>&1 | sed 's/^/    /' || true
    spctl -a -vvv -t exec "$APP"    2>&1 | sed 's/^/    /' || true
fi

step "Done"
info "app: $APP"
info "dmg: $DMG"
info "sha256: $(shasum -a 256 "$DMG" | cut -d' ' -f1)"
if [ "$NOTARIZE" = "0" ]; then
    printf '\n    NOT NOTARIZED - this build still triggers Gatekeeper. Re-run without --no-notarize.\n'
fi
