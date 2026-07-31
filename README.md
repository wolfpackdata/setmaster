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

Download the release for your platform, unpack it anywhere, and double-click the
launcher. No Python, no Node, no terminal, no installer.

| Platform | Download | Launch |
|---|---|---|
| Windows | `SetMaster3-3.0.3-windows-x64.zip` | `SetMaster 3.vbs` |
| macOS (Apple silicon) | `SetMaster3-3.0.3-macos-arm64.tar.gz` | `SetMaster 3.command` |
| macOS (Intel) | `SetMaster3-3.0.3-macos-x64.tar.gz` | `SetMaster 3.command` |

Each payload bundles its own CPython runtime, so nothing needs to be installed
first. Start/stop instructions are in `READ ME FIRST.txt` inside the archive.

Every build also ships an isolated **test instance** — a second launcher with its
own data directory and port, so you can experiment against a factory-fresh copy
without touching your real sets. Both instances can run at the same time.

## What you'll need

- **Traktor Pro** (v4 was the development target) — for `collection.nml`.
- **Spotify playlist CSVs**, if you want the comparison features. Export them
  yourself with [exportify.net](https://exportify.net) and point SetMaster 3 at the
  folder. There is no Spotify API integration; the flow is file-based by design.

## Building from source

The published releases are the supported way to run this. To build anyway:

```bash
# backend — Python 3.12+
cd backend
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -e .

# frontend — Node 20+
cd ../frontend
npm ci && npm run build     # the backend serves frontend/dist

# run
cd ../backend && uvicorn app.main:app --port 8137
```

Then open `http://127.0.0.1:8137`. `release/README.md` documents the per-OS
builders that produce the self-contained artifacts above.

Tests: `pytest -q` in `backend/`, `npm run test` in `frontend/`. Some backend tests
are written against a real Traktor collection and skip cleanly when it isn't
present — that data is personal and isn't published here.

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
