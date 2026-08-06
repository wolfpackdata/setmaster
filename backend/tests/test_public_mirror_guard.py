"""The public mirror's `--out` guard (#232, `codex-c9a64d63`).

`build()` recreates its output directory, so `shutil.rmtree(out)` is the first
thing it does - before anything has validated `out`. The reproduction that
filed this issue pointed it at a fixture repo and watched it erase the working
tree and `.git` before dying in `git ls-files`, inside the tree it had just
deleted.

These tests import the real `build_mirror` module rather than re-implementing
its rules, and the destructive case asserts on a fixture with a sentinel file
and a `.git/` - the same shape as the original reproduction - so a regression
shows up as "the sentinel is gone", not as a subtly different error message.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MIRROR_TOOL = REPO_ROOT / "tools" / "public-mirror" / "build_mirror.py"


def _load_build_mirror():
    """Import the live module by path - it is not on sys.path as a package.

    `allow_module_level=True` is load-bearing, not defensive. This module is
    imported at collection time (`bm = _load_build_mirror()` below), and
    `tools/public-mirror/` is deliberately held back from the generated public
    mirror - so in that tree the skip *always* fires, at module scope. Without
    the flag pytest raises a collection **error** rather than skipping, which
    `build_mirror.py --verify` correctly reads as "the generated tree does not
    build", aborting the publish. That is #251: the guard test for the mirror
    made the mirror ungenerable.
    """
    if not MIRROR_TOOL.is_file():
        pytest.skip(f"{MIRROR_TOOL} not present", allow_module_level=True)
    # build_mirror does `sys.path.insert` for its own siblings (manifest, scan).
    sys.path.insert(0, str(MIRROR_TOOL.parent))
    try:
        spec = importlib.util.spec_from_file_location("_bm_under_test", MIRROR_TOOL)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(MIRROR_TOOL.parent))


bm = _load_build_mirror()


@pytest.fixture
def fake_repo(tmp_path: Path) -> Path:
    """A stand-in source tree carrying the two things worth not losing."""
    root = tmp_path / "repo"
    (root / ".git").mkdir(parents=True)
    (root / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
    (root / "backend").mkdir()
    (root / "sentinel.txt").write_text("uncommitted work\n", encoding="utf-8")
    return root


# ---------------------------------------------------------------------------
# The paths that must be refused
# ---------------------------------------------------------------------------

def test_refuses_the_repo_root_itself(fake_repo: Path):
    with pytest.raises(bm.UnsafeOutputPath, match="repository root"):
        bm.check_output_path(fake_repo, fake_repo)


def test_refuses_an_ancestor_of_the_repo(fake_repo: Path):
    with pytest.raises(bm.UnsafeOutputPath, match="contains the repository"):
        bm.check_output_path(fake_repo.parent, fake_repo)


def test_refuses_a_descendant_of_the_repo(fake_repo: Path):
    """`--out backend` would take the application source with it."""
    with pytest.raises(bm.UnsafeOutputPath, match="inside the repository"):
        bm.check_output_path(fake_repo / "backend", fake_repo)


def test_refuses_a_path_inside_the_repo_that_does_not_exist_yet(fake_repo: Path):
    """The rule is about location, not about what happens to be there now."""
    with pytest.raises(bm.UnsafeOutputPath, match="inside the repository"):
        bm.check_output_path(fake_repo / "build" / "mirror", fake_repo)


def test_refuses_a_filesystem_root(fake_repo: Path):
    root_of_fs = Path(fake_repo.anchor)
    with pytest.raises(bm.UnsafeOutputPath, match="filesystem root"):
        bm.check_output_path(root_of_fs, fake_repo)


def test_refuses_the_home_directory(fake_repo: Path):
    with pytest.raises(bm.UnsafeOutputPath, match="home directory"):
        bm.check_output_path(Path.home(), fake_repo)


def test_relative_out_is_resolved_before_comparison(fake_repo: Path, monkeypatch):
    """`--out .` from inside the repo is the exact reported typo."""
    monkeypatch.chdir(fake_repo)
    with pytest.raises(bm.UnsafeOutputPath):
        bm.check_output_path(Path("."), fake_repo)


# ---------------------------------------------------------------------------
# The paths that must still be allowed
# ---------------------------------------------------------------------------

def test_allows_a_sibling_of_the_repo(fake_repo: Path):
    bm.check_output_path(fake_repo.parent / "sm3-public", fake_repo)


def test_allows_an_unrelated_directory(fake_repo: Path, tmp_path: Path):
    elsewhere = tmp_path / "somewhere" / "else" / "sm3-public"
    elsewhere.mkdir(parents=True)
    bm.check_output_path(elsewhere, fake_repo)


# ---------------------------------------------------------------------------
# The original reproduction: nothing is deleted on the way to the refusal
# ---------------------------------------------------------------------------

def test_build_deletes_nothing_when_out_is_the_repo(fake_repo: Path):
    sentinel = fake_repo / "sentinel.txt"
    git_dir = fake_repo / ".git"
    assert sentinel.is_file() and git_dir.is_dir()

    with pytest.raises(bm.UnsafeOutputPath):
        bm.build(fake_repo, fake_repo, "0.0.0")

    # The whole point. Before the guard, both of these were gone by the time
    # build() failed - and it failed in `git ls-files`, not on the path.
    assert sentinel.is_file(), "build() deleted the source tree before refusing"
    assert git_dir.is_dir(), "build() deleted .git before refusing"
    assert sentinel.read_text(encoding="utf-8") == "uncommitted work\n"


def test_build_checks_the_path_before_touching_an_existing_output(tmp_path: Path,
                                                                  fake_repo: Path):
    """A refused `--out` that already exists keeps its contents."""
    victim = fake_repo / "nested-out"
    victim.mkdir()
    (victim / "keep.txt").write_text("do not lose me\n", encoding="utf-8")

    with pytest.raises(bm.UnsafeOutputPath):
        bm.build(victim, fake_repo, "0.0.0")

    assert (victim / "keep.txt").is_file()
