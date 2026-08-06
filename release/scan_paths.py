#!/usr/bin/env python3
"""Does this release payload name the machine that built it? (#223)

    python3 scan_paths.py <tree> <needles-file>

`<needles-file>` is UTF-8, one needle per line, blanks ignored. Every file under
`<tree>` is read as raw bytes and searched for each needle in each encoding
below. One line per matching file goes to stdout; the exit code is 1 if there
was any hit and 0 if the tree is clean, so a caller can gate on either.

Why this file exists at all
---------------------------
There are five places that ask this question - both builders, both artifact
smoke checks, and the .dmg builder - and until now they asked it three different
ways: `grep -rIl --binary-files=text` on macOS, a Latin-1 decode plus
`String.IndexOf` on Windows, and a second copy of the grep in the .dmg path.
Three implementations of one security gate is three chances to be subtly wrong,
and they *were* subtly wrong in different directions: the Windows one was
case-sensitive until #236, and none of them could see UTF-16 at all. A single
scanner that every caller shares is one thing to get right and one thing to test.

Encodings
---------
A path is a leak whatever encoding it happens to be stored in, and a Windows PE
resource, an embedded manifest, or a .NET string table stores text as UTF-16.
In UTF-16 every ASCII character is followed (LE) or preceded (BE) by a NUL byte,
so the needle is not a contiguous byte run and a plain substring search steps
straight over it. Searching the same needle re-encoded per encoding is what
closes that: the scan is byte-oriented, so it never has to decode - and never
has to guess the encoding of - the file it is scanning.

Case
----
Matching is case-INSENSITIVE over the ASCII range, on both platforms. Windows
paths are case-insensitive outright - a .pyc can record the build root with a
capitalised drive letter or directory while the root itself reads lower-case -
and the macOS default filesystem is case-insensitive too, so a case-sensitive
gate is a fail-open on both platforms rather than one. The fold
is applied identically to needle and haystack *after* encoding - `bytes.lower()`
maps only A-Z, and in UTF-16 each ASCII character's byte folds independently of
its NUL - so an exact-case non-ASCII path still matches. Only a *case variant*
of a non-ASCII character is missed, which needs a build account whose name is
non-ASCII and recorded in two different cases.
"""

from __future__ import annotations

import os
import sys

# (codec, label). UTF-8 subsumes ASCII, so plain ASCII paths are covered by it.
ENCODINGS: tuple[tuple[str, str], ...] = (
    ("utf-8", "utf-8"),
    ("utf-16-le", "utf-16le"),
    ("utf-16-be", "utf-16be"),
)


def probes(needles: list[str]) -> list[tuple[bytes, str, str]]:
    """(folded needle bytes, encoding label, original needle) for every pairing."""
    out: list[tuple[bytes, str, str]] = []
    for needle in needles:
        if not needle:
            continue
        for codec, label in ENCODINGS:
            try:
                # Encode first, fold second, so the haystack's bytes.lower()
                # is the exact same transform applied to the same bytes.
                encoded = needle.encode(codec).lower()
            except UnicodeEncodeError:
                continue
            if encoded:
                out.append((encoded, label, needle))
    return out


def scan_tree(tree: str, needles: list[str]) -> tuple[list[tuple[str, str, str]], int]:
    """(hits, files scanned). A hit is (path, encoding label, needle)."""
    found: list[tuple[str, str, str]] = []
    scanned = 0
    tests = probes(needles)
    if not tests:
        return found, scanned

    for dirpath, _dirnames, filenames in os.walk(tree):
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            # Symlinks carry no bytes of their own. A target inside the tree is
            # scanned in its own right; one outside is not payload content.
            # `grep -r` (as opposed to -R) skips them for the same reason.
            if os.path.islink(path):
                continue
            try:
                with open(path, "rb") as fh:
                    data = fh.read()
            except OSError as exc:
                # A file the gate cannot read is a file it cannot vouch for.
                found.append((path, "unreadable", str(exc)))
                continue
            scanned += 1
            hay = data.lower()
            for encoded, label, needle in tests:
                if encoded in hay:
                    found.append((path, label, needle))
                    break

    return found, scanned


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    tree, needles_file = argv[1], argv[2]

    # Every one of these refusals exists because exit 0 from this script is read
    # as "this artifact is safe to publish". A scan that did not happen must
    # never be able to say that: a mistyped payload path would otherwise walk an
    # empty directory, find nothing, and hand back a confident all-clear.
    if not os.path.isdir(tree):
        print(f"scan_paths: {tree!r} is not a directory - nothing was scanned", file=sys.stderr)
        return 2

    with open(needles_file, encoding="utf-8") as fh:
        needles = [line.strip() for line in fh if line.strip()]
    if not needles:
        print("scan_paths: no needles supplied - refusing to report clean", file=sys.stderr)
        return 2

    hits, scanned = scan_tree(tree, needles)
    if not scanned:
        print(f"scan_paths: no readable files under {tree!r} - refusing to report clean",
              file=sys.stderr)
        return 2

    for path, label, _needle in hits:
        print(f"{path}  [{label}]")
    return 1 if hits else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
