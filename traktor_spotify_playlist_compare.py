"""
Traktor vs Spotify Playlist Comparison
Compares playlist files between Traktor and Exportify (Spotify) directories.
"""

import os
import re
import unicodedata
import pandas as pd
from pathlib import Path


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


def compare_playlists():
    """
    Compare playlist files between Traktor and Exportify directories.
    Returns a DataFrame with comparison results.
    """

    # Directory paths
    traktor_dir = r"C:\studio\rmldata\playlist-dev\Traktor"
    spotify_dir = r"C:\studio\rmldata\playlist-dev\Exportify"
    output_file = r"C:\studio\rmldata\playlist-dev\traktor_spotify_playlist_compare.csv"

    print("="*70)
    print("Traktor vs Spotify Playlist Comparison")
    print("="*70)

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

    print("\n" + "="*70)
    print("Comparison Results")
    print("="*70)

    # Summary statistics
    both_count = len(df[df['status'] == 'both'])
    traktor_only_count = len(df[df['status'] == 'traktor_only'])
    spotify_only_count = len(df[df['status'] == 'spotify_only'])

    print(f"\nIn both directories:      {both_count}")
    print(f"Traktor only:             {traktor_only_count}")
    print(f"Spotify/Exportify only:   {spotify_only_count}")
    print(f"Total unique playlists:   {len(df)}")

    # Show samples
    if traktor_only_count > 0:
        print("\nSample playlists in Traktor only:")
        print(df[df['status'] == 'traktor_only']['traktor_filename'].head(5).to_string(index=False))

    if spotify_only_count > 0:
        print("\nSample playlists in Spotify only:")
        print(df[df['status'] == 'spotify_only']['spotify_filename'].head(5).to_string(index=False))

    if both_count > 0:
        print("\nSample playlists in both:")
        sample_both = df[df['status'] == 'both'][['traktor_filename', 'spotify_filename']].head(5)
        print(sample_both.to_string(index=False))

    print("\n" + "="*70)
    print(f"Comparison saved to: {output_file}")
    print("="*70)

    return df


def main():
    """Main function."""
    compare_playlists()


if __name__ == "__main__":
    main()
