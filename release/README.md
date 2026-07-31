# `release/` — clean-machine release builders

Before this existed, the launchers required `backend/.venv` and `frontend/dist`,
neither of which is tracked, and the repo had no installer — so the "first public
release" could not start on a clean machine at all, while telling users to
"reinstall SetMaster 3" with no installation path to reinstall from. That was
Codex finding `codex-5d98d235` (P0) / issue #179.

These builders produce a **self-contained artifact per OS**: unpack it and
double-click a launcher. The user needs **no Python, no Node, no terminal**.

## What a payload contains

```
SetMaster3-<version>-<target>/
    READ ME FIRST.txt      end-user start/stop instructions
    launchers/             the double-click start/stop launchers
    backend/app/           FastAPI app
    backend/pipeline/      ported SM2 pipeline
    frontend/dist/         built UI (served by the backend)
    runtime/python/        self-contained CPython + locked dependencies
    release-info.json      version, git commit, runtime, build time, build host
```

The layout is the one the launchers already assume (`launchers/` beside
`backend/` and `frontend/`), plus `runtime/`. The launchers prefer
`runtime/python` and fall back to a developer `backend/.venv`, so the same
launcher files work in a checkout and in a release.

A **virtualenv is not a portable runtime** — `pyvenv.cfg` points at an absolute
base Python — so the payload ships a relocatable
[python-build-standalone](https://github.com/astral-sh/python-build-standalone)
CPython with the locked dependencies installed into it, not a copied `.venv`.
The smoke checks fail the artifact if a `backend/.venv` ever appears in it.

## Building

Per-OS by design: the bundled CPython is an OS-specific build, and the macOS
executable bits cannot be produced from Windows.

| Host | Command | Artifact |
|---|---|---|
| Windows | `powershell -ExecutionPolicy Bypass -File release\build-windows.ps1` | `release/dist/SetMaster3-<version>-windows-x64.zip` |
| macOS | `./release/build-macos.sh [macos-arm64\|macos-x64]` | `release/dist/SetMaster3-<version>-<target>.tar.gz` |

macOS ships a `.tar.gz`, not a `.zip`, because it preserves the executable bit
on the `.command` launchers — a launcher that arrives non-executable is the
failure in #182.

Useful flags: `-SkipNpmCi` / `SM3_SKIP_NPM_CI=1` (reuse `node_modules`),
`-OfflineRuntime` (require the cached runtime tarball), `-OutputDir` /
`SM3_RELEASE_OUT`.

## Smoke-testing an artifact (do this before releasing)

The acceptance check runs against the **extracted artifact**, never a developer
checkout, and always as an **isolated test instance** (its own port and data
dir), so a real SetMaster 3 on the default port is untouched:

```
powershell -ExecutionPolicy Bypass -File release\smoke-windows.ps1 -Zip release\dist\SetMaster3-<version>-windows-x64.zip
./release/smoke-macos.sh release/dist/SetMaster3-<version>-macos-arm64.tar.gz
```

Both assert: payload self-contained → bundled runtime imports every dependency →
app starts and serves the built UI → relaunch is idempotent → stop works → stop
leaves an unrelated owner of the port alone (#181). The macOS one additionally
asserts both `.command` files arrived executable (#182).

## Reproducibility

- `runtime.json` pins the python-build-standalone release, per-target asset and
  **sha256**; a download that does not match is a hard failure.
- `requirements.txt` pins every runtime dependency to the version installed in
  `backend/.venv` — i.e. what the test suites and the golden-master pipeline
  comparison actually ran against. Runtime only: no pytest/httpx.
- `release-info.json` inside the payload records the app version, git commit,
  runtime, build time and build host, so an artifact maps back to a commit.
- `release/.cache/` (downloaded runtimes) and `release/dist/` (artifacts) are
  git-ignored.

Bumping the bundled Python or a dependency is deliberate: edit the pin, refresh
the sha256 from that release's `SHA256SUMS`, rebuild, re-run the repo suites and
the artifact smoke check.

## Still open

- **macOS artifacts are unbuilt and unverified.** No Mac was available in the
  #179/#182 round, so `build-macos.sh` / `smoke-macos.sh` have never been
  executed. The pass that earns the platform claim is written out step by step in
  `build-notes/macos-release-verification.md` (#182). **`v3.0.3` releases in this
  state deliberately** (Ry, 2026-07-30): Windows is verified end to end and macOS
  ships **unverified**, not as a claimed supported platform, with whatever the
  pass turns up landing in a later patch release.
- **No signing or notarization.** First launch on macOS needs the
  right-click → Open Gatekeeper step (macOS 15+: *Privacy & Security → Open
  Anyway*), which `INSTALL-macos.txt` documents. Code signing needs an Apple
  Developer ID and is a separate decision.
