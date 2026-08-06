"""The generated public README must document an install that provides the
commands it then tells you to run (#265, `PUBLIC-ACCEPT-001`).

The v3.0.4 public-repository acceptance check returned `BLOCK` on exactly one
thing: the README said `pip install -e .` and, twenty lines later, `pytest -q`.
`pytest` lives in the `dev` extra, so the documented setup did not provide the
documented test command, and the first thing a contributor does failed with
`pytest: command not found` - which reads as a broken repository rather than a
missing extra.

Two properties are pinned here, because the fix has two ways to go wrong:

1. **Coverage.** If the README documents a command, the install it documents has
   to provide it. Checked against `pyproject.toml` rather than a hardcoded name,
   so moving `pytest` between extras updates the expectation automatically.
2. **The quoting.** `pip install -e .[dev]` fails under zsh - the macOS default
   shell - with `no matches found`, because the brackets glob. A README that
   documents the extra but unquoted trades one first-five-minutes failure for
   another.

`tools/public-mirror/` is deliberately held back from the generated mirror, so
this module skips there - with `allow_module_level=True`, which is #251's lesson:
a bare module-scope `pytest.skip()` raises a collection *error*, and `--verify`
correctly reads that as "the generated tree does not build".
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = REPO_ROOT / "tools" / "public-mirror" / "templates" / "README.md.tmpl"
PYPROJECT = REPO_ROOT / "backend" / "pyproject.toml"

if not TEMPLATE.is_file():
    pytest.skip(f"{TEMPLATE} not present", allow_module_level=True)

README = TEMPLATE.read_text(encoding="utf-8")


def _extras_providing(command: str) -> set[str]:
    """Which optional-dependency extras ship a distribution named `command`.

    Close enough for the tools this README documents, whose distribution name
    and console script agree (`pytest` -> `pytest`). A dependency spec looks
    like `pytest>=8`, so split on the first specifier character.
    """
    data = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    extras = data.get("project", {}).get("optional-dependencies", {})
    return {
        name
        for name, specs in extras.items()
        if any(re.split(r"[<>=!~\[; ]", s.strip(), maxsplit=1)[0] == command for s in specs)
    }


def test_readme_documents_installing_the_extra_that_provides_pytest():
    if "pytest" not in README:
        pytest.skip("the public README no longer documents pytest")

    extras = _extras_providing("pytest")
    assert extras, (
        "pytest is not in any optional-dependency extra in backend/pyproject.toml. "
        "If it moved into the base dependencies this test is obsolete; if it was "
        "dropped, the README should stop documenting `pytest -q`."
    )

    installs = re.findall(r"pip install -e [^\n]*", README)
    assert installs, "the public README documents pytest but no `pip install -e` at all"

    covered = [line for line in installs if any(f"[{extra}]" in line for extra in sorted(extras))]
    assert covered, (
        "The public README tells the reader to run `pytest`, but every "
        f"`pip install -e` line it documents omits the extra that provides it "
        f"(one of {sorted(extras)}). Following the README exactly ends in "
        "`pytest: command not found` - this is #265 / PUBLIC-ACCEPT-001, the one "
        "finding that blocked the v3.0.4 publish.\n"
        f"Lines found: {installs}"
    )


def test_readme_quotes_the_extra_so_zsh_does_not_glob_it():
    """`pip install -e .[dev]` is `no matches found` under the macOS default shell."""
    unquoted = [
        line
        for line in re.findall(r"pip install -e [^\n]*", README)
        if re.search(r"pip install -e\s+(?![\"'])\S*\[", line)
    ]
    assert not unquoted, (
        "A `pip install -e` line documents an extra without quoting it. zsh - the "
        "default shell on every supported Mac - expands the brackets as a glob and "
        'fails with `no matches found`. Write it as `pip install -e ".[dev]"`.\n'
        f"Offending lines: {unquoted}"
    )
