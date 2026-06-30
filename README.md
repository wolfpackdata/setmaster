# RML Data — DJ Playlist Sync & Analytics Pipeline

A Python ETL pipeline for DJs managing large music libraries across **Traktor Pro 4** and **Spotify**. Extracts your Traktor collection, exports playlists, compares and joins them against Spotify exports, and produces a full **track-playlist matrix** for analysis — all in one command.

Interface is Excel workbook "RML SetMaster Public V##.XLSM", download from this repository.

---

## What It Does

```
Traktor collection.nml (XML)
    ↓  Stage 1 — Load
Tracks CSV + Playlists CSV
    ↓  Stage 2 — Export & Matrix
Individual Playlist CSVs + Track-Playlist Matrix
    ↓  Stage 3 — Compare
Traktor vs. Spotify Playlist Comparison Report
    ↓  Stage 4 — Join
Side-by-Side Joined CSVs (Spotify ↔ Traktor)
```

| Stage | Script | Output |
|-------|--------|--------|
| 1 — Load | `traktor_collection_load.py` | `traktor_collection_tracks.csv`, `traktor_collection_playlists.csv` |
| 2 — Export & Matrix | `traktor_playlists_from_collection.py` | 30 individual playlist CSVs, `traktor_track_playlist_matrix.csv` |
| 3 — Compare | `traktor_spotify_playlist_compare.py` | `traktor_spotify_playlist_compare.csv` |
| 4 — Join | `traktor_spotify_playlist_join.py` | `Joined/joined_*.csv` (one per playlist) |

---

## Quick Start

### Requirements

- Python 3.8+
- pandas >= 2.3.2

```bash
pip install -r requirements.txt
```

### Run the Full Pipeline

```bash
python run_all_scripts.py "C:\path\to\collection.nml" "C:\path\to\this\repo\" --playlist-arg "RML"
```

| Argument | Description |
|----------|-------------|
| `collection.nml` | Path to your Traktor library file (usually in `Documents\Native Instruments\Traktor\`) |
| `repo path` | Path to this repository folder |
| `--playlist-arg` | Root folder name in Traktor to classify tracks as "root" vs. sub-playlist |

The pipeline logs everything to `log_most_recent.txt` and validates that no output files are open in Excel before writing.

### Run Individual Stages

```bash
python traktor_collection_load.py "C:\path\to\collection.nml"
python traktor_playlists_from_collection.py "RML"
python traktor_spotify_playlist_compare.py
python traktor_spotify_playlist_join.py
```

### Excel UI (SetMaster)

Open `setmaster/RML SetMaster Public 2.67.xlsm` — the workbook provides a no-code UI that invokes the pipeline via VBA macros. Configure your Traktor path and root folder name in the sheet, then click Run.

---

## Project Structure

```
rmldata/
├── playlist-dev/                          # Primary working directory
│   ├── run_all_scripts.py                 # Orchestrator — runs all 4 stages
│   ├── traktor_collection_load.py         # Stage 1: Parse collection.nml → CSV
│   ├── traktor_playlists_from_collection.py  # Stage 2: Export playlists + matrix
│   ├── traktor_spotify_playlist_compare.py   # Stage 3: Compare playlist lists
│   ├── traktor_spotify_playlist_join.py      # Stage 4: Fuzzy-join tracks
│   ├── run_local.py                       # Dev runner (edit NML_PATH inside)
│   ├── publish_to_setmaster.py            # Publish scripts to production folder
│   ├── config__traktor_playlists_to_sync.csv
│   ├── config__playlist_prefix_to_exclude.csv
│   ├── requirements.txt
│   ├── Traktor/                           # Output: extracted Traktor data
│   ├── Exportify/                         # Input: Spotify playlist CSVs (via Exportify)
│   ├── Joined/                            # Output: joined comparison CSVs
│   └── Help/                              # Setup & macro documentation images
│
└── setmaster/                             # Production copy (published via publish_to_setmaster.py)
    ├── RML SetMaster Public 2.67.xlsm    # Excel UI
    └── (same scripts and config templates)
```

---

## Configuration

### `config__traktor_playlists_to_sync.csv`

Lists the playlists to export from Traktor and compare against Spotify. Playlist names must match exactly in both platforms.

```csv
playlist_name_in_both_spotify_and_traktor
discoCosmic
ignition
vibeNRoll
...
```

### `config__playlist_prefix_to_exclude.csv`

Playlists whose names start with these prefixes are excluded from the track-playlist matrix (useful for hiding WIP or collab folders).

```csv
playlist_prefixes_exclude
wip___
album_
zzz
...
```

---

## Output Details

### `Traktor/traktor_collection_tracks.csv`
All tracks in your Traktor library — title, artist, BPM, musical key, import date, play count, loudness, file path, and 25+ more fields.

### `Traktor/traktor_track_playlist_matrix.csv`
One row per unique track. Columns include track metadata plus one column per playlist (1 if the track appears, 0 if not), plus counts for root-playlist appearances vs. sub-playlist appearances. Great for pivot-table analysis in Excel.

### `Traktor/traktor_playlist_<name>.csv`
One file per configured playlist, containing the full track metadata for that playlist's contents.

### `Joined/joined_<playlist>.csv`
Side-by-side comparison of each track in a playlist as it exists in Spotify vs. Traktor. Each track gets a presence flag:

| Flag | Meaning |
|------|---------|
| `Yes-Trak-Playlist` | Track is in both the Spotify playlist and the Traktor playlist |
| `Not-Trak-Playlist / Yes-Trak-Collection` | In Spotify + your Traktor collection, but not in this Traktor playlist |
| `Not-Trak-Collection` | Only in Spotify — not found in Traktor at all |
| `Not-Spotify / Yes-Trak-Playlist` | Only in Traktor playlist — not in Spotify |

---

## Spotify Export Setup

This pipeline reads Spotify playlists exported as CSV files using [Exportify](https://github.com/watsonbox/exportify). Drop the exported CSVs into the `Exportify/` directory. File names must match the playlist names in `config__traktor_playlists_to_sync.csv` (case-insensitive, punctuation-tolerant).

---

## How Track Matching Works

Traktor and Spotify use different identifiers, so matching is done by normalized track name:

1. Strip accents and punctuation
2. Lowercase everything
3. Remove common remix/edit suffixes (`remix`, `mix`, `edit`, `original`, etc.)
4. Drop featuring artist clauses (`feat`, `ft`, `with`)

A left join from Spotify → Traktor is performed on the normalized name. Unmatched tracks are flagged accordingly.

---

## Publishing to Production

To push your latest scripts and config templates (without any CSV data) to the `setmaster/` folder:

```bash
python publish_to_setmaster.py
```

Config CSVs are copied with headers only (no data rows) so the production folder ships clean.

---

## Dependencies

| Library | Purpose |
|---------|---------|
| `pandas` | All CSV I/O and data manipulation |
| `xml.etree.ElementTree` | Parsing Traktor's collection.nml XML |
| `unicodedata`, `re` | Track name normalization for fuzzy matching |
| `hashlib` | Deduplicating tracks by audio ID |

---

## Tested With

- Traktor Pro 4
- Python 3.12
- Exportify CSV export format (as of 2025)
