# Natural-Language Prompt Bar — DEFERRED (not in build #1)

**Status (decided by Ry, 2026-07-06): future feature. Do not implement in build #1.** Build #1 mimics the SetMaster 2 prototype; the NL prompt bar is a later update and will be specified with Ry at a later date. This file is intentionally a placeholder until then.

## Instruction to the coding agent

- Do **not** build the NL prompt bar, any LLM/Claude integration, or any query-interpretation layer in build #1.
- Do **not** render the bar's UI on S3 (`03-ui-design.md` §6.7 is visual reference only, deferred).
- **Do** preserve the architectural seam it will plug into: S3's **unified filter + sort state** (`track-playlist-matrix.md` §4) must remain a single serializable state object that the drawer, column filters, and breadcrumb all read/write. The NL feature, when specified, will emit into that same state. No other accommodation is needed now.

### Seam already in place: the deterministic keyword layer (issue #24, ruling R7)

Post-build-1 issue #24 added a **deterministic keyword query parser** (`frontend/src/screens/matrix/searchQuery.ts`, `parseSearch()`) that sits between the #15 raw search box and the filter predicates: it turns clauses like `BPM=120,125`, `Keys=Cm,Gm`, `Released past 2 years` into the same predicates the drawer/column filters use. It is deliberately **self-contained** (ruling R7 / decision D-041): clauses filter invisibly from the raw box, are **not** mirrored into `applied.columns` or the drawer, and the raw string (`applied.search`) stays the single source of truth. This is explicitly **not** the NL bar — no LLM, no `applied`-state mirroring. It is the pragmatic keyword layer; the NL bar remains the future feature that will emit **into** the unified state (lighting drawer lines and column headers). When the NL bar is specified the two can coexist: `parseSearch` is a pure `string → { contains, clauses }` function the NL layer may reuse or supersede, and both ultimately drive the one serializable filter/sort object.

## Material to draw on when this gets spec'd

- Kyle's concrete NL-query use cases: `docs/sources/04-kyle-advice-web-app.md` (never-played "blanks", genre/playlist + unplayed, play-count, BPM-range, key-match filters).
- Canonical example query (walkthrough §8): *"tracks 128 BPM or greater in C minor, newest release first."*
- Visual spec sketch: `planning/03-ui-design.md` §6.7 (deferred with this feature).
- Kyle's "bring your own Claude" distribution note — relevant to how the LLM dependency is packaged.
