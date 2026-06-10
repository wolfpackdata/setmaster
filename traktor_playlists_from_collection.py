"""
Traktor Playlist Exporter
Exports individual playlist CSV files from Traktor collection based on config file.
"""

import pandas as pd
import os
from pathlib import Path


def extract_filename_from_track_key(track_key):
    """Extract filename from track_key (text after last colon)."""
    if pd.isna(track_key):
        return None
    # Track key format: "C:/:studio/:dj sound/:tracks/:lossless/:01 Like You.m4a"
    # We want the text after the last colon
    if ':' in track_key:
        return track_key.split(':')[-1]
    return track_key


def build_track_playlist_matrix():
    """Build a matrix of tracks vs playlists from traktor_collection_playlists.csv.

    Creates a table with:
      - Column 1: unique track_key
      - Column 2: artist_name
      - Column 3: track_name
      - Column 4: release_date
      - Column 5: root_playlist_appearances (playlists in the "RML root" folder)
      - Column 6: nonroot_playlist_appearances (playlists in any other folder)
      - Column 7+: one column per unique playlist_name, with the track_name
        in cells where that track appears in the playlist.

    Saves the result to traktor_track_playlist_matrix.csv.
    """

    playlists_file = r"C:\studio\rmldata\playlist-dev\Traktor\traktor_collection_playlists.csv"
    tracks_file = r"C:\studio\rmldata\playlist-dev\Traktor\traktor_collection_tracks.csv"
    output_file = r"C:\studio\rmldata\playlist-dev\Traktor\traktor_track_playlist_matrix.csv"

    print("="*70)
    print("Building Track-Playlist Matrix")
    print("="*70)

    # Playlist name prefixes to exclude from the matrix
    excluded_prefixes = ('album_', 'tyler_', 'halim_', 'bui_', 'adam_', 'zzz','sm_','wip___bui')

    # Read the playlists CSV
    print(f"\nReading playlists file: {playlists_file}")
    df = pd.read_csv(playlists_file)
    print(f"Loaded {len(df)} playlist entries")

    # Read tracks CSV for artist and release_date
    print(f"Reading tracks file: {tracks_file}")
    tracks_df = pd.read_csv(tracks_file, usecols=['track_key', 'artist', 'release_date', 'bpm', 'key', 'musical_key_value', 'import_date', 'album_title', 'last_played', 'playcount'])
    tracks_df = tracks_df.drop_duplicates(subset='track_key').rename(columns={'artist': 'artist_name'})

    # Map Traktor's numeric MUSICAL_KEY value (0-23) to standard musical key names.
    # 0-11 = major keys (C, Db, D, ... B), 12-23 = minor keys (Cm, Dbm, Dm, ... Bm).
    _key_map = {
        0: 'C',    1: 'Db',   2: 'D',    3: 'Eb',   4: 'E',    5: 'F',
        6: 'Gb',   7: 'G',    8: 'Ab',   9: 'A',   10: 'Bb',  11: 'B',
        12: 'Cm',  13: 'Dbm', 14: 'Dm',  15: 'Ebm', 16: 'Em',  17: 'Fm',
        18: 'Gbm', 19: 'Gm',  20: 'Abm', 21: 'Am',  22: 'Bbm', 23: 'Bm',
    }
    tracks_df['key'] = (
        tracks_df['musical_key_value']
        .dropna()
        .astype(int)
        .map(_key_map)
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

    # Separate playlist columns into RML root vs non-root using playlist_folder from source data
    root_playlists = df[df['playlist_folder'] == 'RML root']['playlist_name'].unique()
    playlist_cols = [c for c in pivot.columns if c not in ('track_key', 'track_name', 'artist_name', 'release_date', 'bpm', 'key', 'import_date', 'album_title', 'last_played', 'playcount')]
    root_cols = [c for c in playlist_cols if c in root_playlists]
    nonroot_cols = [c for c in playlist_cols if c not in root_playlists]

    pivot['root_playlist_appearances'] = pivot[root_cols].notna().sum(axis=1) if root_cols else 0
    pivot['nonroot_playlist_appearances'] = pivot[nonroot_cols].notna().sum(axis=1) if nonroot_cols else 0

    # Reorder columns: track_key, artist_name, track_name, release_date, counts, then playlist columns
    ordered_cols = ['track_key', 'import_date','release_date','last_played','playcount',
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

    return pivot


def main():
    """Main function to export playlist CSV files."""

    # File paths
    config_file = r"C:\studio\rmldata\playlist-dev\config__traktor_playlists_to_sync.csv"
    playlists_file = r"C:\studio\rmldata\playlist-dev\Traktor\traktor_collection_playlists.csv"
    tracks_file = r"C:\studio\rmldata\playlist-dev\Traktor\traktor_collection_tracks.csv"
    output_dir = r"C:\studio\rmldata\playlist-dev\Traktor"

    print("="*70)
    print("Traktor Playlist Exporter")
    print("="*70)

    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Read the config file (playlist names to sync)
    print(f"\nReading config file: {config_file}")
    config_df = pd.read_csv(config_file)
    playlist_names = config_df['playlist_name'].dropna().tolist()
    print(f"Found {len(playlist_names)} playlists to export")

    # Read the playlists CSV
    print(f"\nReading playlists file: {playlists_file}")
    playlists_df = pd.read_csv(playlists_file)
    print(f"Loaded {len(playlists_df)} playlist entries")

    # Read the tracks CSV
    print(f"\nReading tracks file: {tracks_file}")
    tracks_df = pd.read_csv(tracks_file)
    print(f"Loaded {len(tracks_df)} tracks")

    print("\n" + "="*70)
    print("Processing playlists...")
    print("="*70)

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
            print(f"  WARNING: No entries found for playlist '{playlist_name}'")
            continue

        print(f"  Found {len(playlist_entries)} tracks in playlist")

        # Extract filenames from track_key column (5th column, index 4)
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
                print(f"  WARNING: Track not found: {filename}")

        if missing_tracks:
            total_missing += len(missing_tracks)

        # Create output DataFrame
        if matched_tracks:
            output_df = pd.DataFrame(matched_tracks)

            # Save to CSV (overwrite if exists)
            output_filename = f"traktor_playlist_{playlist_name}.csv"
            output_path = os.path.join(output_dir, output_filename)

            # Check if file exists to provide appropriate messaging
            file_exists = os.path.exists(output_path)

            # Always overwrite
            output_df.to_csv(output_path, index=False, encoding='utf-8-sig')

            if file_exists:
                print(f"  OK: Overwritten {len(matched_tracks)} tracks to: {output_filename}")
            else:
                print(f"  OK: Exported {len(matched_tracks)} tracks to: {output_filename}")
            total_exported += 1
        else:
            print(f"  ERROR: No tracks could be matched for this playlist")

    # Summary
    print("\n" + "="*70)
    print("Export Summary")
    print("="*70)
    print(f"Playlists processed: {len(playlist_names)}")
    print(f"Playlists exported: {total_exported}")
    print(f"Total missing tracks: {total_missing}")

    if total_missing > 0:
        print(f"\nWARNING: {total_missing} tracks could not be matched")
        print("  Check the output above for details")
    else:
        print("\nAll tracks matched successfully!")

    print("\n" + "="*70)
    print(f"Output directory: {output_dir}")
    print("="*70)

    # Build the track-playlist matrix
    build_track_playlist_matrix()


if __name__ == "__main__":
    main()
