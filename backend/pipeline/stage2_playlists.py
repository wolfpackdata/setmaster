"""Stage 2 — Traktor Playlist Exporter + Track-Playlist Matrix.

Verbatim port of SM2 `traktor_playlists_from_collection.py`.

Plumbing changes vs SM2: the playlists-to-sync and exclude-prefix config
CSVs became the `playlists_to_sync` / `exclude_prefixes` list parameters
(cleaned exactly like SM2 cleaned the CSV columns: NaN/None dropped,
values stripped, empties removed); paths derive from work_dir; the root
folder name is a parameter instead of sys.argv. All matching logic,
the numeric key map, exclusion rules, column order, and sort order are
byte-identical to SM2.
"""

import os
from pathlib import Path

import pandas as pd

# Map Traktor's numeric MUSICAL_KEY value (0-23) to standard musical key names.
# 0-11 = major keys (C, Db, D, ... B), 12-23 = minor keys (Cm, Dbm, Dm, ... Bm).
MUSICAL_KEY_MAP = {
    0: 'C',    1: 'Db',   2: 'D',    3: 'Eb',   4: 'E',    5: 'F',
    6: 'Gb',   7: 'G',    8: 'Ab',   9: 'A',   10: 'Bb',  11: 'B',
    12: 'Cm',  13: 'Dbm', 14: 'Dm',  15: 'Ebm', 16: 'Em',  17: 'Fm',
    18: 'Gbm', 19: 'Gm',  20: 'Abm', 21: 'Am',  22: 'Bbm', 23: 'Bm',
}


def extract_filename_from_track_key(track_key):
    """Extract filename from track_key (text after last colon)."""
    if pd.isna(track_key):
        return None
    # Track key format: "C:/:studio/:dj sound/:tracks/:lossless/:01 Like You.m4a"
    # We want the text after the last colon
    if ':' in track_key:
        return track_key.split(':')[-1]
    return track_key


def _clean_config_list(values):
    """Replicate SM2's config-CSV cleanup on an in-memory list:
    `col.dropna().str.strip()` then drop empty strings."""
    cleaned = []
    for v in values or []:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        s = str(v).strip()
        if s != '':
            cleaned.append(s)
    return cleaned


def build_track_playlist_matrix(work_dir, root_folder_name="", exclude_prefixes=()):
    """Build a matrix of tracks vs playlists from traktor_collection_playlists.csv.

    Creates a table with fixed columns (Track Key, Import Date, Release Date,
    Last Played, Play Count, BPM, Key, Album Title, Artist Name, Track Name,
    On Root PL, On Non-Root PL) then one column per playlist (A-Z), with the
    track_name in cells where that track appears in the playlist.

    Saves the result to <work_dir>/Traktor/traktor_track_playlist_matrix.csv.
    Returns (output_path, warnings).
    """
    work_dir = Path(work_dir)
    playlists_file = work_dir / "Traktor" / "traktor_collection_playlists.csv"
    tracks_file = work_dir / "Traktor" / "traktor_collection_tracks.csv"
    output_file = work_dir / "Traktor" / "traktor_track_playlist_matrix.csv"

    warnings = []

    print("=" * 70)
    print("Building Track-Playlist Matrix")
    print("=" * 70)

    # Exclusion prefixes come in as a parameter (SM2 read them from
    # config__playlist_prefix_to_exclude.csv with dropna + strip).
    excluded_prefixes = tuple(_clean_config_list(exclude_prefixes))
    print(f"\nLoaded {len(excluded_prefixes)} exclusion prefix(es) from config")

    # Read the playlists CSV
    print(f"\nReading playlists file: {playlists_file}")
    df = pd.read_csv(playlists_file)
    print(f"Loaded {len(df)} playlist entries")

    # Read tracks CSV for artist and release_date
    print(f"Reading tracks file: {tracks_file}")
    tracks_df = pd.read_csv(tracks_file, usecols=['track_key', 'artist', 'release_date', 'bpm', 'key', 'musical_key_value', 'import_date', 'album_title', 'last_played', 'playcount'])
    tracks_df = tracks_df.drop_duplicates(subset='track_key').rename(columns={'artist': 'artist_name'})

    tracks_df['key'] = (
        tracks_df['musical_key_value']
        .dropna()
        .astype(int)
        .map(MUSICAL_KEY_MAP)
        .reindex(tracks_df.index)
        .fillna(tracks_df['key'])
    )
    tracks_df = tracks_df.drop(columns=['musical_key_value'])

    # Filter out excluded playlists
    mask_playlist = df['playlist_name'].str.lower().str.startswith(excluded_prefixes)
    excluded_count = mask_playlist.sum()
    df = df[~mask_playlist]
    print(f"Excluded {excluded_count} entries from filtered playlists")

    # Filter out tracks whose name starts with "--"
    mask_track = df['track_name'].fillna('').str.startswith('--')
    excluded_tracks = mask_track.sum()
    df = df[~mask_track]
    print(f"Excluded {excluded_tracks} entries with track names starting with '--'")

    print(f"Remaining entries: {len(df)}")

    # Pivot: for each track/playlist combination, use track_name as the cell value
    df['cell_value'] = df['track_name']
    pivot = df.pivot_table(
        index=['track_key', 'track_name'],
        columns='playlist_name',
        values='cell_value',
        aggfunc='first'
    )

    # Flatten the multi-index and reset
    pivot = pivot.reset_index()

    # Merge artist_name and release_date from tracks data
    pivot = pivot.merge(tracks_df[['track_key', 'artist_name', 'release_date', 'bpm', 'key', 'import_date', 'album_title', 'last_played', 'playcount']], on='track_key', how='left')

    # Separate playlist columns into root vs non-root using playlist_folder from source data
    root_playlists = df[df['playlist_folder'].str.lower() == root_folder_name.lower()]['playlist_name'].unique() if root_folder_name else []

    if not root_folder_name:
        msg = "No root folder name was provided; 'On Root PL' counts will be 0 for all tracks."
        warnings.append(msg)
        print("\nNote: No root folder name was provided.")
        print("  'On Root PL' counts will be 0 for all tracks.\n")
    elif len(root_playlists) == 0:
        msg = (f"Root folder '{root_folder_name}' was not found in the collection; "
               f"'On Root PL' counts will be 0 for all tracks.")
        warnings.append(msg)
        print(f"\nWarning: Root folder '{root_folder_name}' was not found in the collection.")
        print(f"  'On Root PL' counts will be 0 for all tracks.")
        print(f"  Check the Super Playlist folder name and try again.\n")

    playlist_cols = [c for c in pivot.columns if c not in ('track_key', 'track_name', 'artist_name', 'release_date', 'bpm', 'key', 'import_date', 'album_title', 'last_played', 'playcount')]
    root_cols = [c for c in playlist_cols if c in root_playlists]
    nonroot_cols = [c for c in playlist_cols if c not in root_playlists]

    pivot['root_playlist_appearances'] = pivot[root_cols].notna().sum(axis=1) if root_cols else 0
    pivot['nonroot_playlist_appearances'] = pivot[nonroot_cols].notna().sum(axis=1) if nonroot_cols else 0

    # Reorder columns: track_key, artist_name, track_name, release_date, counts, then playlist columns
    ordered_cols = ['track_key', 'import_date', 'release_date', 'last_played', 'playcount',
                    'bpm', 'key', 'album_title',
                    'artist_name', 'track_name', 'root_playlist_appearances', 'nonroot_playlist_appearances'] + sorted(root_cols + nonroot_cols)
    pivot = pivot[ordered_cols]

    # Rename fixed columns to human-readable headers
    rename_map = {
        'track_key': 'Track Key',
        'import_date': 'Import Date',
        'release_date': 'Release Date',
        'last_played': 'Last Played',
        'playcount': 'Play Count',
        'bpm': 'BPM',
        'key': 'Key',
        'album_title': 'Album Title',
        'artist_name': 'Artist Name',
        'track_name': 'Track Name',
        'root_playlist_appearances': 'On Root PL',
        'nonroot_playlist_appearances': 'On Non-Root PL',
    }
    pivot = pivot.rename(columns=rename_map)

    # Sort by Track Name for readability
    pivot = pivot.sort_values('Track Name', na_position='last').reset_index(drop=True)

    # Save to CSV
    pivot.to_csv(output_file, index=False, encoding='utf-8-sig')
    print(f"\nSaved track-playlist matrix to: {output_file}")
    print(f"  Unique tracks: {len(pivot)}")
    print(f"  Playlist columns: {len(pivot.columns) - 12}")

    return output_file, warnings


def export_playlists(work_dir, playlists_to_sync):
    """Export one CSV per configured playlist to <work_dir>/Traktor.

    Returns (outputs, warnings).
    """
    work_dir = Path(work_dir)
    playlists_file = work_dir / "Traktor" / "traktor_collection_playlists.csv"
    tracks_file = work_dir / "Traktor" / "traktor_collection_tracks.csv"
    output_dir = work_dir / "Traktor"

    outputs = []
    warnings = []

    print("=" * 70)
    print("Traktor Playlist Exporter")
    print("=" * 70)

    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Playlist names come in as a parameter (SM2 read them from
    # config__traktor_playlists_to_sync.csv with dropna + strip + non-empty).
    playlist_names = _clean_config_list(playlists_to_sync)
    print(f"Found {len(playlist_names)} playlists to export")

    # Read the playlists CSV
    print(f"\nReading playlists file: {playlists_file}")
    playlists_df = pd.read_csv(playlists_file)
    print(f"Loaded {len(playlists_df)} playlist entries")

    # Read the tracks CSV
    print(f"\nReading tracks file: {tracks_file}")
    tracks_df = pd.read_csv(tracks_file)
    print(f"Loaded {len(tracks_df)} tracks")

    print("\n" + "=" * 70)
    print("Processing playlists...")
    print("=" * 70)

    # Process each playlist
    total_exported = 0
    total_missing = 0

    for playlist_name in playlist_names:
        print(f"\n[{playlist_name}]")

        # Find all entries for this playlist (case-insensitive comparison)
        playlist_entries = playlists_df[
            playlists_df['playlist_name'].str.lower() == playlist_name.lower()
        ].copy()

        if playlist_entries.empty:
            msg = f"No entries found for playlist '{playlist_name}'"
            warnings.append(msg)
            print(f"  WARNING: {msg}")
            continue

        print(f"  Found {len(playlist_entries)} tracks in playlist")

        # Extract filenames from track_key column
        playlist_entries['extracted_filename'] = playlist_entries['track_key'].apply(
            extract_filename_from_track_key
        )

        # Match tracks and preserve order
        matched_tracks = []
        missing_tracks = []

        for idx, row in playlist_entries.iterrows():
            filename = row['extracted_filename']

            # Find matching track in tracks_df by 'file' column
            matching_track = tracks_df[tracks_df['file'] == filename]

            if not matching_track.empty:
                # Take the first match if multiple exist
                matched_tracks.append(matching_track.iloc[0])
            else:
                # Track not found
                missing_tracks.append(filename)
                warnings.append(f"[{playlist_name}] Track not found: {filename}")
                print(f"  WARNING: Track not found: {filename}")

        if missing_tracks:
            total_missing += len(missing_tracks)

        # Create output DataFrame
        if matched_tracks:
            output_df = pd.DataFrame(matched_tracks)

            # Save to CSV (overwrite if exists)
            output_filename = f"traktor_playlist_{playlist_name}.csv"
            output_path = os.path.join(output_dir, output_filename)

            # Always overwrite
            output_df.to_csv(output_path, index=False, encoding='utf-8-sig')
            outputs.append(Path(output_path))

            print(f"  OK: Exported {len(matched_tracks)} tracks to: {output_filename}")
            total_exported += 1
        else:
            msg = f"No tracks could be matched for playlist '{playlist_name}'"
            warnings.append(msg)
            print(f"  ERROR: No tracks could be matched for this playlist")

    # Summary
    print("\n" + "=" * 70)
    print("Export Summary")
    print("=" * 70)
    print(f"Playlists processed: {len(playlist_names)}")
    print(f"Playlists exported: {total_exported}")
    print(f"Total missing tracks: {total_missing}")

    return outputs, warnings


def run_stage2(work_dir, root_folder_name, playlists_to_sync, exclude_prefixes):
    """Run stage 2: per-playlist exports then the track-playlist matrix.

    Returns (outputs, warnings).
    """
    outputs, warnings = export_playlists(work_dir, playlists_to_sync)
    matrix_path, matrix_warnings = build_track_playlist_matrix(
        work_dir, root_folder_name or "", exclude_prefixes
    )
    outputs.append(matrix_path)
    warnings.extend(matrix_warnings)
    return outputs, warnings
