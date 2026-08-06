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

### macOS: the signed `.dmg` (#214)

The `.tar.gz` above is the *payload* format. For end users, macOS also builds a
signed and notarized disk image containing a real `SetMaster.app`:

```
./release/build-macos-dmg.sh                 # build, sign, notarize, staple
./release/build-macos-dmg.sh --no-notarize   # local iteration, signed only
```

It consumes the `.tar.gz` payload, wraps it in an app bundle whose launcher owns
the server's lifetime (Quit stops the backend), signs every nested Mach-O
individually, and notarizes and staples **twice** — the app, then the image
built from it. Result: drag to `/Applications`, launches with no Gatekeeper
prompt.

Full procedure, prerequisites and the traps that cost real time:
**`build-notes/macos-dmg-runbook.md`**. User-facing copy: `INSTALL-macos-dmg.txt`.

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
**no build-machine paths and bytecode with a relative root** (#223) → app starts
and serves the built UI → relaunch is idempotent → stop works → stop leaves an
unrelated owner of the port alone (#181). The macOS one additionally asserts both
`.command` files arrived executable (#182).

### The build machine must not ship (#223)

A `.pyc` records the **absolute path of the source it was compiled from**, and
that path is what appears in every traceback a user sees. pip writes bytecode
during `pip install`, so without intervention every payload carried the builder's
home directory — measured at **2,945 files** on the 3.0.3 macOS payload, and
`v3.0.3` shipped publicly that way.

Both builders now purge the whole payload's bytecode, recompile it with the
recorded root rewritten to `SetMaster3` (`compileall -s <payload> -p SetMaster3`),
and deal with the console-script wrappers pip stamps with the build-time
interpreter path — rewritten to `#!/usr/bin/env python3` on macOS, **deleted** on
Windows, where they are `.exe` launchers with the path embedded in the binary and
nothing needs them (`python.exe -m <name>` still works).

Then each builder **leak-scans the finished payload** and refuses to produce an
artifact if any file names the repo root or `$HOME`, and each smoke check repeats
the scan against the *extracted* artifact. Two independent gates, because
`tools/public-mirror/scan.py` structurally cannot catch this class: it gates the
**source tree**, and these paths are injected by the build rather than committed.

Note the scan looks for **this** machine, not for home directories generally.
Eight files in a macOS payload legitimately carry other people's paths — a CI
runner's home directory baked into a third-party wheel by that project's own
build farm, a pandas test fixture, a pip docstring. Those are upstream
provenance, not ours, and flagging them would make the gate un-actionable.

Both platforms run the same scanner, [`scan_paths.py`](scan_paths.py), rather
than each rolling its own. They did roll their own until v3.0.4 — `grep -rIl` on
macOS, a Latin-1 decode plus `String.IndexOf` on Windows — and the two disagreed
in different directions, which is the whole argument against having two. It
searches raw bytes for each needle re-encoded as **UTF-8, UTF-16LE and
UTF-16BE**, case-insensitively. UTF-16 is the load-bearing part: a path in a PE
resource, an embedded manifest or any UTF-16 string table has a NUL between
every character, so it is not a contiguous byte run and a plain substring search
walks straight over it while reporting the artifact clean.

> **Use `-s`/`-p`, never `--stripdir`/`--prependdir`.** The long forms do not
> exist; passing them fails the entire `compileall` call, and if that failure is
> swallowed the build ships ~3k absolute paths while printing success. This is not
> hypothetical — it is exactly how it happened.

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

- **macOS is built and partially verified** (2026-08-04). `build-macos.sh` and
  `smoke-macos.sh` executed for the first time on STEV and both passed with no
  fixes — smoke 17/17. Steps 3–6 of the checklist remain unrun, and step 3 is
  deliberately deferred into the signed-`.dmg` clean-install test rather than
  skipped, since it asserts the unsigned Gatekeeper flow that the `.dmg`
  removes. Details in `build-notes/macos-release-verification.md` (#182).
  **#182 stays open and macOS is still not a claimed supported platform** — but
  the failure it was filed for is now demonstrated fixed on hardware. Note
  `v3.0.3` shipped *before* this run, so that artifact remains unverified.
- **The `.dmg` clean-install acceptance test passed against the 3.0.4 artifact**
  (2026-08-05). `SetMaster-3.0.4-macos-arm64.dmg` — signed, notarized, stapled,
  sha256 `409d43f1…` — was served over `localhost` and downloaded through Safari
  so it carried a real `com.apple.quarantine` attribute, then installed and
  launched from a standard (non-admin) account on the **first double-click**:
  no right-click → Open, no *Privacy & Security → Open Anyway*, no Terminal, and
  the About block reporting **3.0.4**. Removing exactly those three frictions is
  what #214 existed for. This supersedes the earlier pass, which was recorded
  against the 3.0.3 artifact and therefore did not exercise the raised
  `LSMinimumSystemVersion 14.0` floor (#229) or a bundle produced by the repaired
  non-interactive notarization path (#247).
- **The test suites have never run on macOS.** `pytest`, `npm run test` and
  `npm run e2e` are Windows-verified only. Separate gap from the one above, and
  still open.
- **Signing and notarization now exist for macOS** (#214) — see the `.dmg`
  section above. The **`.tar.gz` remains unsigned**: it is a folder of
  `.command` launchers, not an app bundle, so it still needs the right-click →
  Open Gatekeeper step (macOS 15+: *Privacy & Security → Open Anyway*) that
  `INSTALL-macos.txt` documents. Users who want a frictionless install take the
  `.dmg`; the tarball stays for anyone who wants the payload directly.
