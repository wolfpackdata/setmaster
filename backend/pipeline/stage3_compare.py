"""Stage 3 — Traktor vs Spotify Playlist Comparison.

Verbatim port of SM2 `traktor_spotify_playlist_compare.py`.
Compares playlist *filenames* (not track contents) between
<work_dir>/Traktor (excluding traktor_collection_*; the
traktor_playlist_ prefix is stripped from the normalized name) and the
Exportify directory. Writes <work_dir>/traktor_spotify_playlist_compare.csv.

Plumbing changes vs SM2: the Exportify directory is a parameter (SM2
hardcoded ./Exportify next to the script); a missing/empty Exportify
folder raises ExportifyDirError instead of print-and-return (SM2's
runner then crashed in stage 4 on the missing compare CSV — the port
fails the stage cleanly at its true cause instead).
"""

import os
import re
import unicodedata
from pathlib import Path

import pandas as pd


class ExportifyDirError(Exception):
    """Raised when the Exportify folder is missing or empty."""


def normalize_filename(filename):
    """
    Normalize filename for comparison by:
    - Removing file extension
    - Removing spaces and punctuation
    - Converting to lowercase
    """
    # Remove file extension
    name = os.path.splitext(filename)[0]

    # Transliterate accented characters to ASCII equivalents (e.g. é -> e)
    name = unicodedata.normalize('NFKD', name)
    name = name.encode('ascii', 'ignore').decode('ascii')

    # Remove "original mix" phrase (case-insensitive)
    name = re.sub(r'original\s+mix', '', name, flags=re.IGNORECASE)

    # Remove all spaces and punctuation (keep only alphanumeric)
    name = re.sub(r'[^a-zA-Z0-9]', '', name)

    # Convert to lowercase
    name = name.lower()

    return name


def get_playlist_files(directory, exclude_prefix=None):
    """
    Get all CSV files from a directory and return a dictionary
    mapping normalized names to original filenames.

    Args:
        directory: Directory to scan for CSV files
        exclude_prefix: Optional prefix to exclude files (e.g., "traktor_collection_")
    """
    playlist_dict = {}

    if not os.path.exists(directory):
        print(f"WARNING: Directory does not exist: {directory}")
        return playlist_dict

    files = [f for f in os.listdir(directory) if f.endswith('.csv')]

    # Filter out files with the excluded prefix if specified
    if exclude_prefix:
        files = [f for f in files if not f.startswith(exclude_prefix)]

    for filename in files:
        normalized = normalize_filename(filename)
        playlist_dict[normalized] = filename

    return playlist_dict


def run_stage3(work_dir, exportify_dir):
    """
    Compare playlist files between Traktor and Exportify directories.
    Writes the compare CSV and returns (outputs, warnings).
    Raises ExportifyDirError if the Exportify folder is missing or empty.
    """
    work_dir = Path(work_dir)
    traktor_dir = work_dir / "Traktor"
    spotify_dir = Path(exportify_dir)
    output_file = work_dir / "traktor_spotify_playlist_compare.csv"

    warnings = []

    print("=" * 70)
    print("Traktor vs Spotify Playlist Comparison")
    print("=" * 70)

    # Validate Exportify folder before proceeding
    if not spotify_dir.exists():
        raise ExportifyDirError(
            f"Exportify folder not found at: {spotify_dir}. "
            "Please create the folder and add your Spotify CSV exports before running."
        )
    if not any(spotify_dir.iterdir()):
        raise ExportifyDirError(
            f"Exportify folder is empty: {spotify_dir}. "
            "Please add your Spotify CSV exports to the Exportify folder before running."
        )

    # Get files from both directories
    print(f"\nScanning Traktor directory: {traktor_dir}")
    traktor_files = get_playlist_files(traktor_dir, exclude_prefix="traktor_collection_")
    print(f"Found {len(traktor_files)} CSV files (excluding 'traktor_collection_*' files)")

    print(f"\nScanning Exportify directory: {spotify_dir}")
    spotify_files = get_playlist_files(spotify_dir)
    print(f"Found {len(spotify_files)} CSV files")

    # For Traktor files, remove the "traktor_playlist_" prefix from normalized names
    print("\nNormalizing Traktor filenames (removing 'traktor_playlist_' prefix)...")
    traktor_normalized = {}
    for norm_name, orig_name in traktor_files.items():
        # Remove "traktorplaylist" prefix from the normalized name
        cleaned_name = norm_name.replace('traktorplaylist', '', 1)
        traktor_normalized[cleaned_name] = orig_name

    # Get all unique playlist names
    all_playlists = set(traktor_normalized.keys()) | set(spotify_files.keys())

    print(f"\nTotal unique playlist names: {len(all_playlists)}")

    # Build comparison data
    comparison_data = []

    for playlist_name in sorted(all_playlists):
        in_traktor = playlist_name in traktor_normalized
        in_spotify = playlist_name in spotify_files

        # Determine status
        if in_traktor and in_spotify:
            status = 'both'
        elif in_traktor:
            status = 'traktor_only'
        else:
            status = 'spotify_only'

        comparison_data.append({
            'playlist_name_normalized': playlist_name,
            'traktor_filename': traktor_normalized.get(playlist_name, ''),
            'spotify_filename': spotify_files.get(playlist_name, ''),
            'in_traktor': in_traktor,
            'in_spotify': in_spotify,
            'status': status
        })

    # Create DataFrame
    df = pd.DataFrame(comparison_data)

    # Save to CSV with human-readable column headers
    df.rename(columns={
        'playlist_name_normalized': 'Playlist Name',
        'traktor_filename': 'Traktor Filename',
        'spotify_filename': 'Spotify Filename',
        'in_traktor': 'In Traktor',
        'in_spotify': 'In Spotify',
        'status': 'Status'
    }).to_csv(output_file, index=False, encoding='utf-8-sig')

    # Summary statistics
    both_count = len(df[df['status'] == 'both'])
    traktor_only_count = len(df[df['status'] == 'traktor_only'])
    spotify_only_count = len(df[df['status'] == 'spotify_only'])

    print(f"\nIn both directories:      {both_count}")
    print(f"Traktor only:             {traktor_only_count}")
    print(f"Spotify/Exportify only:   {spotify_only_count}")
    print(f"Total unique playlists:   {len(df)}")

    print(f"\nComparison saved to: {output_file}")

    return [output_file], warnings
