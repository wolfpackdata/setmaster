"""Regression tests for the release gates in `release/` (#223, #229).

These gates are shell and PowerShell, and they only ever run on a release
machine during a release - which is the worst possible moment to discover one of
them has been fail-open the whole time. Three separate defects have already been
found in them by execution rather than review, so the parsers get pinned here,
in the suite that runs on every change.

The Mach-O tests deliberately extract the **exact** embedded parser out of
`release/build-macos-dmg.sh` rather than keeping a copy: a copy would keep
passing after the real script drifted away from it, which is precisely the
failure mode being defended against. They run on any OS - the parser is pure
byte-shuffling over synthetic fixtures, so it needs no Mach and no Mac.
"""

from __future__ import annotations

import re
import struct
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
DMG_BUILDER = REPO_ROOT / "release" / "build-macos-dmg.sh"
SCAN_PATHS = REPO_ROOT / "release" / "scan_paths.py"


# ---------------------------------------------------------------------------
# Extracting the live parser out of the shell script
# ---------------------------------------------------------------------------

def _heredocs() -> list[str]:
    text = DMG_BUILDER.read_text(encoding="utf-8")
    return re.findall(r"<<'PY'\n(.*?)\nPY\n", text, re.S)


def _block(marker: str) -> str:
    """The embedded python block containing `marker`, keyed by content.

    By content and not by index: a new heredoc added above these would silently
    renumber them and the tests would start pinning the wrong code.
    """
    blocks = [b for b in _heredocs() if marker in b]
    if len(blocks) != 1:
        pytest.fail(
            f"expected exactly one embedded python block containing {marker!r} in "
            f"{DMG_BUILDER.name}, found {len(blocks)}"
        )
    return blocks[0]


@pytest.fixture(scope="module")
def discovery_block() -> str:
    return _block("MAGIC = {")


@pytest.fixture(scope="module")
def minos_block() -> str:
    return _block("LC_VERSION_MIN_MACOSX")


# ---------------------------------------------------------------------------
# Synthetic Mach-O fixtures
# ---------------------------------------------------------------------------

LC_BUILD_VERSION = 0x32
MH_MAGIC_64 = b"\xcf\xfa\xed\xfe"
FAT_MAGIC = b"\xca\xfe\xba\xbe"
FAT_MAGIC_64 = b"\xca\xfe\xba\xbf"
CPU_ARM64 = 0x0100000C


def _enc_ver(major: int, minor: int = 0, patch: int = 0) -> int:
    return (major << 16) | (minor << 8) | patch


def thin(minos: tuple[int, int] | None = None, *, ncmds_override: int | None = None) -> bytes:
    """A minimal 64-bit thin Mach-O, optionally carrying LC_BUILD_VERSION."""
    cmds, n = b"", 0
    if minos is not None:
        cmds = struct.pack(
            "<IIIIII", LC_BUILD_VERSION, 24, 1, _enc_ver(*minos), _enc_ver(15, 0), 0
        )
        n = 1
    if ncmds_override is not None:
        n = ncmds_override
    header = struct.pack(
        "<4sIIIIIII", MH_MAGIC_64, CPU_ARM64, 0, 2, n, len(cmds), 0, 0
    )
    return header + cmds


def _fat(slices: list[bytes], *, wide: bool) -> bytes:
    magic = FAT_MAGIC_64 if wide else FAT_MAGIC
    arch_size = 32 if wide else 20
    header = magic + struct.pack(">I", len(slices))
    offset = len(header) + arch_size * len(slices)
    arches, body = b"", b""
    for chunk in slices:
        if wide:
            arches += struct.pack(">IIQQII", CPU_ARM64, 0, offset, len(chunk), 12, 0)
        else:
            arches += struct.pack(">IIIII", CPU_ARM64, 0, offset, len(chunk), 12)
        body += chunk
        offset += len(chunk)
    return header + arches + body


def fat32(slices: list[bytes]) -> bytes:
    return _fat(slices, wide=False)


def fat64(slices: list[bytes]) -> bytes:
    return _fat(slices, wide=True)


# ---------------------------------------------------------------------------
# Running the extracted blocks
# ---------------------------------------------------------------------------

def _run_discovery(block: str, tree: Path) -> set[str]:
    out = subprocess.run(
        [sys.executable, "-c", block, str(tree)],
        capture_output=True, text=True, check=True,
    )
    return {Path(line).name for line in out.stdout.splitlines() if line.strip()}


def _run_minos(block: str, floor: str, files: dict[str, Path], tmp_path: Path) -> dict:
    listing = tmp_path / "_macho-list.txt"
    listing.write_text("\n".join(str(p) for p in files.values()), encoding="utf-8")
    out = subprocess.run(
        [sys.executable, "-c", block, floor, str(listing)],
        capture_output=True, text=True, check=True,
    )
    lines = out.stdout.splitlines()
    return {
        "unknown": int(next(l for l in lines if l.startswith("UNKNOWN ")).split()[1]),
        "unknown_files": {
            Path(l[len("UNKNOWNFILE "):].split(" :: ")[0]).name
            for l in lines if l.startswith("UNKNOWNFILE ")
        },
        "too_new": {
            Path(l.split(" ", 2)[2]).name for l in lines if l.startswith("TOONEW ")
        },
    }


# ---------------------------------------------------------------------------
# The floor gate
# ---------------------------------------------------------------------------

@pytest.fixture
def macho_tree(tmp_path: Path) -> dict[str, Path]:
    fixtures = {
        "thin-11": thin((11, 0)),
        "thin-15": thin((15, 0)),
        "thin-no-version": thin(None),
        "thin-malformed": thin((15, 0), ncmds_override=99),
        "fat32-15": fat32([thin((15, 0))]),
        "fat64-15": fat64([thin((15, 0))]),
        "fat64-11": fat64([thin((11, 0))]),
        "fat64-mixed": fat64([thin((11, 0)), thin((15, 0))]),
    }
    tree = tmp_path / "bundle"
    tree.mkdir()
    written = {}
    for name, data in fixtures.items():
        path = tree / name
        path.write_bytes(data)
        written[name] = path
    return written


def test_discovery_finds_every_macho_width(discovery_block, macho_tree, tmp_path):
    """FAT64 must be discovered: undiscovered means unchecked AND unsigned."""
    found = _run_discovery(discovery_block, tmp_path / "bundle")
    assert found == set(macho_tree), (
        "the Mach-O walk missed a binary. A file absent here is absent from both "
        "the deployment-floor check and the innermost-first signing loop."
    )


def test_discovery_ignores_non_macho(discovery_block, tmp_path):
    """The walk must stay magic-gated.

    This is what makes failing closed on UNKNOWN safe: only files whose magic
    says Mach-O reach the floor check, so an ordinary .py or .dylib-adjacent
    text file cannot fail the build.
    """
    tree = tmp_path / "mixed"
    tree.mkdir()
    (tree / "script.sh").write_bytes(b"#!/bin/sh\necho hello\n")
    (tree / "data.json").write_bytes(b'{"a": 1}\n')
    (tree / "empty").write_bytes(b"")
    (tree / "real").write_bytes(thin((11, 0)))
    assert _run_discovery(discovery_block, tree) == {"real"}


@pytest.mark.parametrize("name", ["thin-15", "fat32-15", "fat64-15", "fat64-mixed"])
def test_binary_needing_a_newer_macos_fails_the_floor(minos_block, macho_tree, tmp_path, name):
    """Anything above the floor is TOONEW, in every container format.

    `fat64-15` is the #229 delta regression: it used to be invisible, so a
    universal binary requiring macOS 15 passed a 14.0 floor unchallenged.
    `fat64-mixed` pins that one bad slice condemns the whole file.
    """
    report = _run_minos(minos_block, "14.0", macho_tree, tmp_path)
    assert name in report["too_new"]


@pytest.mark.parametrize("name", ["thin-11", "fat64-11"])
def test_binary_meeting_the_floor_passes(minos_block, macho_tree, tmp_path, name):
    report = _run_minos(minos_block, "14.0", macho_tree, tmp_path)
    assert name not in report["too_new"]
    assert name not in report["unknown_files"]


@pytest.mark.parametrize("name", ["thin-no-version", "thin-malformed"])
def test_unreadable_target_is_reported_as_unknown(minos_block, macho_tree, tmp_path, name):
    """A file whose target cannot be established must be named, not silently counted."""
    report = _run_minos(minos_block, "14.0", macho_tree, tmp_path)
    assert name in report["unknown_files"]
    assert report["unknown"] == len(report["unknown_files"])


def test_the_builder_fails_the_build_on_unknown_targets():
    """The shell must act on UNKNOWN, not just print it.

    The parser reporting `UNKNOWN 3` is worth nothing if the script goes on to
    announce that every binary meets the floor - which is exactly what it did
    before this test existed.
    """
    text = DMG_BUILDER.read_text(encoding="utf-8")
    assert 'UNKNOWN_N="$(grep' in text, "the builder no longer reads the UNKNOWN count"
    guard = text.split('UNKNOWN_N="$(grep', 1)[1]
    assert re.search(r'if \[ "\$UNKNOWN_N" != "0" \]', guard), \
        "the builder does not branch on a non-zero UNKNOWN count"
    unknown_branch = guard.split('if [ "$UNKNOWN_N" != "0" ]', 1)[1].split("\nfi\n", 1)[0]
    assert "fail " in unknown_branch, \
        "the UNKNOWN branch does not call fail - the build would continue"


# ---------------------------------------------------------------------------
# The artifact path scanner
# ---------------------------------------------------------------------------

# Synthetic build roots. They are deliberately not this machine's real paths,
# and the POSIX one uses the `you` placeholder that tools/public-mirror/scan.py
# exempts - these fixtures ship to the public mirror, and a test fixture that
# looks like a real home directory trips the mirror's own leak scan.
WIN_NEEDLE = r"C:\builder\checkout"
MAC_NEEDLE = "/Users/you/checkout"


def _run_scan(tree: Path, needles: list[str], tmp_path: Path) -> tuple[int, list[str]]:
    needle_file = tmp_path / "_needles.txt"
    needle_file.write_text("\n".join(needles), encoding="utf-8")
    out = subprocess.run(
        [sys.executable, str(SCAN_PATHS), str(tree), str(needle_file)],
        capture_output=True, text=True,
    )
    return out.returncode, [l for l in out.stdout.splitlines() if l.strip()]


@pytest.mark.parametrize(
    "label,encoder",
    [
        ("ascii", lambda s: s.encode("ascii")),
        ("utf-8", lambda s: s.encode("utf-8")),
        ("utf-16le", lambda s: s.encode("utf-16-le")),
        ("utf-16be", lambda s: s.encode("utf-16-be")),
        ("utf-16le-with-bom", lambda s: s.encode("utf-16")),
    ],
)
@pytest.mark.parametrize("needle", [WIN_NEEDLE, MAC_NEEDLE])
def test_planted_path_is_found_in_every_encoding(tmp_path, label, encoder, needle):
    """The positive controls. UTF-16 is the whole point of the shared scanner.

    A PE resource, an embedded manifest and a .NET string table are all UTF-16,
    so a build path that reaches one of them has a NUL between every character
    and is invisible to a contiguous substring search.
    """
    tree = tmp_path / "payload"
    tree.mkdir()
    (tree / "planted.bin").write_bytes(b"\x00\x01padding" * 8 + encoder(needle) + b"tail")
    rc, hits = _run_scan(tree, [WIN_NEEDLE, MAC_NEEDLE], tmp_path)
    assert rc == 1, f"{label}: scanner reported the tree clean"
    assert len(hits) == 1 and "planted.bin" in hits[0]


def test_planted_path_is_found_inside_binary_noise(tmp_path):
    """Real leaks arrive embedded in a .pyc or an .exe, not in a text file."""
    tree = tmp_path / "payload"
    tree.mkdir()
    noise = bytes(range(256)) * 8
    (tree / "blob.pyc").write_bytes(noise + WIN_NEEDLE.encode("utf-16-le") + noise)
    rc, hits = _run_scan(tree, [WIN_NEEDLE], tmp_path)
    assert rc == 1 and len(hits) == 1


@pytest.mark.parametrize(
    "variant",
    [r"c:\builder\checkout", r"C:\BUILDER\CHECKOUT", r"C:\Builder\Checkout"],
)
def test_matching_is_case_insensitive(tmp_path, variant):
    """Windows paths are case-insensitive and so is the macOS default filesystem.

    A .pyc can record a different capitalisation than the repo root reads, which
    is a fail-open in the one check whose whole job is to fail closed (#236).
    """
    tree = tmp_path / "payload"
    tree.mkdir()
    (tree / "planted.txt").write_bytes(variant.encode("utf-8"))
    rc, _ = _run_scan(tree, [WIN_NEEDLE], tmp_path)
    assert rc == 1


def test_clean_tree_is_reported_clean(tmp_path):
    """The negative control. A gate that always fires is as useless as one that never does."""
    tree = tmp_path / "payload"
    tree.mkdir()
    (tree / "a.txt").write_bytes(b"nothing sensitive here\n")
    (tree / "b.bin").write_bytes(bytes(range(256)) * 16)
    (tree / "near-miss.txt").write_bytes(b"C:\\builder\\checkou\n")  # one char short
    nested = tree / "deep" / "deeper"
    nested.mkdir(parents=True)
    (nested / "c.py").write_bytes(b"print('hello')\n")
    rc, hits = _run_scan(tree, [WIN_NEEDLE, MAC_NEEDLE], tmp_path)
    assert rc == 0 and hits == []


def test_scanner_refuses_to_report_clean_on_a_missing_tree(tmp_path):
    """A mistyped payload path must not read as a clean artifact.

    os.walk over a directory that is not there yields nothing at all, so the
    natural implementation returns "no hits" - which every caller reads as
    permission to ship.
    """
    rc, _ = _run_scan(tmp_path / "does-not-exist", [WIN_NEEDLE], tmp_path)
    assert rc == 2


def test_scanner_refuses_to_report_clean_on_an_empty_tree(tmp_path):
    """Same failure one step later: the directory exists but holds no files."""
    tree = tmp_path / "empty"
    (tree / "nested").mkdir(parents=True)
    rc, _ = _run_scan(tree, [WIN_NEEDLE], tmp_path)
    assert rc == 2


def test_scanner_refuses_to_report_clean_with_no_needles(tmp_path):
    """Fail closed on a caller bug.

    An empty needle list would otherwise scan nothing, find nothing, and hand
    back a confident exit 0 - a gate that passes because it never ran.
    """
    tree = tmp_path / "payload"
    tree.mkdir()
    (tree / "a.txt").write_bytes(b"x")
    rc, _ = _run_scan(tree, [], tmp_path)
    assert rc == 2


def test_every_release_script_uses_the_shared_scanner():
    """No call site may keep its own private implementation.

    The gates diverged because there were five of them written three ways; the
    fix only holds if they stay converged.
    """
    for name in (
        "build-macos.sh", "smoke-macos.sh", "build-macos-dmg.sh",
        "build-windows.ps1", "smoke-windows.ps1",
    ):
        text = (REPO_ROOT / "release" / name).read_text(encoding="utf-8")
        assert "scan_paths.py" in text, f"{name} does not run the shared scanner"
        # Comments are stripped first: these files explain at length why they no
        # longer grep, and the explanation must not read as the thing itself.
        code = [l for l in text.splitlines() if not l.lstrip().startswith("#")]
        assert not any("grep -rIl" in l for l in code), \
            f"{name} still runs the old grep-based scan"


def test_notarytool_output_is_never_piped_into_an_early_exiting_reader():
    """`notarytool | awk ... exit` / `| head` is a SIGPIPE trap (#247).

    A reader that exits early closes the pipe while notarytool is still
    writing, so notarytool takes SIGPIPE; under the script's `set -euo
    pipefail` that becomes exit 141 and kills the build. It is a race decided
    by notarytool's output buffering, which differs between a TTY and a file -
    so it passed interactively for months and then failed every single time the
    build was logged or run in the background, moments *after* the submission
    had gone live at Apple.

    The rule is capture-then-parse: assign the output to a shell variable
    first, and only then pipe that variable into awk/sed. This test pins the
    call sites rather than the behaviour, because the behaviour needs Apple.
    """
    text = (REPO_ROOT / "release" / "build-macos-dmg.sh").read_text(encoding="utf-8")
    code = [l for l in text.splitlines() if not l.lstrip().startswith("#")]

    # `||` is not a pipe. Blank it out before looking for a real one, or every
    # `|| fail ...` guard on the same line reads as an offender.
    offenders = [
        l.strip() for l in code
        if "notarytool" in l and "|" in l.replace("||", "")
    ]
    assert not offenders, (
        "notarytool output is piped directly into another process; capture it "
        "into a variable first (#247):\n  " + "\n  ".join(offenders)
    )
