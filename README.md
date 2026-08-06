# SetMaster 3

**A DJ set-preparation and catalog-analysis tool that runs entirely on your own machine.**

SetMaster 3 does two jobs:

1. **Set preparation** — a structured editor for writing out a set as transition
   rows: track order, hot-cue numbers, EQ and level moves, timing, and mix notes,
   worked out before you perform rather than improvised at the decks.
2. **Catalog analysis** — reads your Traktor® collection and cross-references it
   against Spotify® playlists exported as CSV, to answer the two questions a DJ
   library actually raises: *what do I own but haven't organized?* and *what's on
   my playlists that I don't own?* It also supports compound filtering and sorting
   across the whole collection, which Traktor® itself can't do.

**The first job doesn't depend on the second.** Set preparation is SetMaster 3's
primary function and it works on its own — you can install it, never load a
collection, never export a Spotify® playlist, and still use it for every set you
play. Traktor® is not required. Writing a set in a purpose-built transition-row
editor beats a spreadsheet or a notes file whether or not you ever turn on the
catalog tools; those are a second, optional half that layers on top.

It is a rebuild of a private Excel/VBA + Python tool that had been in professional
use for several years. Version 3 replaces the spreadsheet with a local web app so
it runs on macOS as well as Windows.

---

> **Not affiliated with Native Instruments or Spotify.** SetMaster 3 is independent
> fan software. Traktor® and Native Instruments® are trademarks of Native
> Instruments GmbH; Spotify® is a trademark of Spotify AB. No trademarked logos or
> assets are used or distributed here, and neither company endorses this project.
>
> **Your Traktor® collection is never modified.** SetMaster 3 opens
> `collection.nml` strictly read-only and never writes to it or to any other Native
> Instruments file. This is a hard architectural constraint, not a setting.

---

## Design principles

- **Fully offline.** A local backend process plus a browser UI on `localhost`. No
  cloud, no hosted services, no accounts, no telemetry, no external API calls. Your
  library never leaves your machine.
- **Single user.** No auth, no multi-tenancy, no permissions model. It's your tool
  on your computer.
- **Read-only where it counts.** Traktor® files are inputs, never outputs.
- **Your data survives.** Sets, notes, formatting, and configuration persist across
  every pipeline re-run; the merge is written to fail safe rather than regenerate
  and drop.

## Installing

No Python, no Node, no terminal, no installer to run.

| Platform | Download | Install | Launch |
|---|---|---|---|
| macOS (Apple silicon) | `SetMaster-3.0.4-macos-arm64.dmg` | Drag **SetMaster** to Applications | Open it from Applications |
| Windows | `SetMaster3-3.0.4-windows-x64.zip` | Unpack anywhere | `SetMaster 3.vbs` |

The macOS build is **signed and notarized by Apple**, so it opens normally — no
right-click-to-open, no *Privacy & Security* detour, no terminal commands. It
needs **Apple silicon and macOS 14 (Sonoma) or later**; Intel Macs are not
supported. Every Apple silicon Mac can run Sonoma, so if yours is on something
older, the free OS update is all that is needed.

Each build bundles its own CPython runtime, so nothing needs to be installed
first.

### Stopping SetMaster — right-click the Dock icon and choose Quit

**On macOS, when you're done for the day: right-click (or Control-click) the
SetMaster icon in the Dock and choose Quit.** That shuts down the part of
SetMaster that runs in the background.

Two things that surprise people, because neither is obvious:

- **Closing the browser tab does not stop it.** The tab is a window onto
  SetMaster, not SetMaster itself. Quitting your browser doesn't stop it either.
- **The Dock icon is how you know it's still running.** If SetMaster is in the
  Dock, it's up — and clicking that icon brings the tab straight back.

Leaving it running is harmless: it idles at almost nothing and only ever listens
on your own machine. On Windows, use the **Stop SetMaster 3** launcher.

Every build also ships an isolated **test instance** — a second launcher with its
own data directory and port, so you can experiment against a factory-fresh copy
without touching your real sets. Both instances can run at the same time.

## What you'll need

**To prepare sets: nothing.** Unpack it, launch it, start writing. The set editor
needs no collection, no playlist export, and no configuration — every field is
yours to type, and nothing is auto-filled from a library.

The catalog-analysis half is the part with inputs, and both of them are optional:

- **Traktor Pro** (v4 was the development target) — for `collection.nml`. Only the
  collection and comparison screens use it; without one they show an empty state
  and the rest of the app works normally. Loading a collection also gives the set
  editor track-name suggestions as you type, which is a convenience, not a
  requirement.
- **Spotify playlist CSVs**, if you want the comparison features. Export them
  yourself with [exportify.net](https://exportify.net) and point SetMaster 3 at the
  folder. There is no Spotify API integration; the flow is file-based by design.

## Building from source

The published releases are the supported way to run this. To build anyway:

```bash
# backend — Python 3.12+
cd backend
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -e ".[dev]"     # just `pip install -e .` if you won't run the tests

# frontend — Node 20+
cd ../frontend
npm ci && npm run build     # the backend serves frontend/dist

# run
cd ../backend && uvicorn app.main:app --port 8137
```

Then open `http://127.0.0.1:8137`. `release/README.md` documents the per-OS
builders that produce the self-contained artifacts above.

Tests: `pytest -q` in `backend/`, `npm run test` in `frontend/`. `pytest` comes
from the `dev` extra above — quote it as `".[dev]"`, or zsh reads the brackets as
a glob and reports `no matches found`. Some backend tests are written against a
real Traktor collection and skip cleanly when it isn't present — that data is
personal and isn't published here.

## Architecture

```
frontend/     React 18 + TypeScript + Vite — the UI, served as static files
backend/app/  FastAPI — HTTP surface, persistence, settings
backend/pipeline/  the analysis engine: reads collection.nml + Exportify CSVs,
                   emits the track–playlist matrix and comparison tables
launchers/    double-click start/stop launchers per OS
release/      clean-machine release builders (bundled CPython + locked deps)
planning/     the specification this was built from
```

The engine/presentation seam is deliberate: the pipeline computes analysis data
and the UI only renders it. Matching and normalization heuristics in
`backend/pipeline/` are ported verbatim from the previous version — years of
accumulated fixes against real-world messy metadata, kept behavior-identical and
guarded by golden-master tests.

## The specification

`planning/` holds the full spec package the build worked from: product overview
and acceptance criteria, data model and invariants, UI design, and per-feature
behavior — with the decision log that resolved every open question before any code
was written.

It's published because it's a more honest picture of how the project was built
than the source alone. It also documents features that were deliberately **not**
built, and why.

## About this repository

This is a **published mirror**, regenerated from a private development repository
at each release. That has a few consequences worth knowing:

- **Issues are welcome** — bug reports and feature requests are read and acted on.
- **Pull requests can't be merged**, since development happens elsewhere. Please
  open an issue instead.
- **History starts at the current release.** Each published version is a single
  commit; the granular development history isn't part of this mirror.
- **`#N` references in code comments** point at the private issue tracker. They're
  kept because they explain *why* the code is shaped the way it is, but the links
  won't resolve from here.

## License

MIT — see [LICENSE](LICENSE).
