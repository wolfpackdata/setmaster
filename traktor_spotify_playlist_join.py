"""
Traktor-Spotify Playlist Join Script
Reads Traktor and Spotify playlist CSVs, joins them based on track matching,
and outputs combined comparison files.
"""

import pandas as pd
import os
import hashlib
import unicodedata
from pathlib import Path


def clean_track_name(track_name):
    """
    Clean track name for matching (replicates SQL trackjoin logic).

    Applies transformations:
    - Convert to lowercase
    - Replace punctuation with spaces
    - Remove common terms (remix, mix, edit, etc.)
    - Take only text before ' feat'
    - Normalize whitespace
    """
    if pd.isna(track_name):
        return ''

    # Transliterate accented/special characters to ASCII equivalents
    # First handle characters that don't decompose via NFKD (e.g. ı → i, ø → o, ł → l)
    _manual_map = str.maketrans('ıİøØłŁðÐþÞæÆœŒß', 'iIoOlLdDtTaAoOs')
    cleaned = str(track_name).translate(_manual_map)
    cleaned = unicodedata.normalize('NFKD', cleaned)
    cleaned = cleaned.encode('ascii', 'ignore').decode('ascii')

    # Convert to lowercase and trim
    cleaned = cleaned.lower().strip()

    # Replace punctuation with spaces
    replacements = {
        '-': ' ',
        ',': ' ',
        '/': '',
        '(': '',
        ')': '',
        '[': '',
        ']': ''
    }
    for old, new in replacements.items():
        cleaned = cleaned.replace(old, new)

    # Remove common terms
    terms_to_remove = [
        ' remix',
        'original mix',
        'original',
        'extended mix',
        'extended',
        'remastered',
        'dub',
        'mix',
        'vocal',
        ' edit'
    ]
    for term in terms_to_remove:
        cleaned = cleaned.replace(term, '')

    # Normalize multiple spaces to single space
    while '  ' in cleaned:
        cleaned = cleaned.replace('  ', ' ')

    # Take only text before ' feat'
    cleaned = cleaned.split(' feat')[0].strip()

    return cleaned


def format_traktor_key(key):
    """
    Format Traktor musical key to standardized format.
    Replicates the SQL CASE statement for key formatting.
    """
    if pd.isna(key) or key == '':
        return ''

    key = str(key).strip()

    # Key mapping dictionary (from SQL CASE statement)
    key_map = {
        'Gmin': 'Gm', 'Gmaj': 'G', 'Gm': 'Gm', 'Gbmin': 'Gbm', 'Gbmaj': 'Gb', 'Gbm': 'Gbm', 'Gb': 'Gb',
        'G#m': 'G#m', 'G#': 'G#', 'G': 'G', 'Fmin': 'Fm', 'Fmaj': 'F', 'Fm': 'Fm', 'F#min': 'F#m', 'F#m': 'F#m',
        'F': 'F', 'Emin': 'Em', 'Emaj': 'E', 'Em': 'Em', 'Ebmin': 'Ebm', 'Ebmaj': 'Eb', 'Ebm': 'Ebm', 'Eb': 'Eb',
        'E': 'E', 'Dmin': 'Dm', 'Dmaj': 'D', 'Dm': 'Dm', 'Dbmin': 'Dbm', 'Dbmaj': 'Db', 'Dbm': 'Dbm', 'Db': 'Db',
        'D#min': 'D#m', 'D#maj': 'D#', 'D#m': 'D#m', 'D#': 'D#', 'D': 'D', 'Cmin': 'Cm', 'Cmaj': 'C', 'Cm': 'Cm',
        'C#min': 'C#m', 'C#maj': 'C#', 'C#m': 'C#m', 'C#': 'C#', 'C': 'C', 'Bmin': 'Bm', 'Bmaj': 'B', 'Bm': 'Bm',
        'Bbmin': 'Bbm', 'Bbmaj': 'Bb', 'Bbm': 'Bbm', 'Bb': 'Bb', 'B': 'B', 'Amin': 'Am', 'Amaj': 'A', 'Am': 'Am',
        'Abmin': 'Abm', 'Abmaj': 'Ab', 'Abm': 'Abm', 'Ab': 'Ab', 'A#min': 'A#m', 'A#maj': 'A#', 'A#m': 'A#m', 'A': 'A',
        '1m': 'Bbm', '1d': 'Bb', '2M': 'F#', '2d': 'F#m', '3m': 'C#m', '3d': 'Db', '4m': 'G#m', '4d': 'Ab',
        '5m': 'Ebm', '5d': 'Eb', '6m': 'Bbm', '7M': 'F', '7D': 'F#', '8M': 'C', '8d': 'Cm', '9m': 'Gm',
        '9d': 'G', '10m': 'Dm', '10d': 'D', '11M': 'A', '11D': 'A#', '12M': 'E', '12d': 'Em'
    }

    return key_map.get(key, key)


def process_spotify_playlist(spotify_file):
    """
    Process Spotify playlist CSV to match SQL spotify_playlist table structure.
    """
    # Read Spotify CSV
    df = pd.read_csv(spotify_file, encoding='utf-8-sig')

    # Rename columns to match expected names (handle Exportify format)
    column_mapping = {
        'Track URI': 'track_uri',
        'Track Name': 'track_name',
        'Album Name': 'album_name',
        'Artist Name(s)': 'artist_names',
        'Release Date': 'release_date',
        'Duration (ms)': 'duration_ms',
        'Popularity': 'popularity',
        'Explicit': 'explicit',
        'Added By': 'added_by',
        'Added At': 'added_at',
        'Genres': 'genres',
        'Record Label': 'record_label',
        'Danceability': 'danceability',
        'Energy': 'energy',
        'Key': 'trackkey',
        'Loudness': 'loudness',
        'Mode': 'mode',
        'Speechiness': 'speechiness',
        'Acousticness': 'acousticness',
        'Instrumentalness': 'instrumentalness',
        'Liveness': 'liveness',
        'Valence': 'valence',
        'Tempo': 'tempo',
        'Time Signature': 'time_signature'
    }
    df.rename(columns=column_mapping, inplace=True)

    # Create trackjoin field
    df['trackjoin'] = df['track_name'].apply(clean_track_name)

    # Create track_left_of_feat field
    df['track_left_of_feat'] = df['track_name'].fillna('').str.lower().str.replace('(', '').str.replace(')', '').str.split(' feat').str[0]

    # Group by track_name and artist_names (similar to SQL GROUP BY)
    grouped = df.groupby(['track_name', 'artist_names'], dropna=False).agg({
        'trackjoin': 'first',
        'track_left_of_feat': 'first',
        'release_date': 'max',
        'added_at': 'max',
        'album_name': 'max',
        'trackkey': 'max',
        'genres': 'max',
        'tempo': 'max',
        'popularity': 'max',
        'energy': 'max',
        'danceability': 'max',
        'track_uri': 'max'
    }).reset_index()

    # Convert tempo to decimal
    grouped['tempo'] = pd.to_numeric(grouped['tempo'], errors='coerce')

    return grouped


def process_traktor_playlist(traktor_file):
    """
    Process Traktor playlist CSV to match SQL trak_playlist_prod table structure.
    """
    # Read Traktor CSV
    df = pd.read_csv(traktor_file, encoding='utf-8-sig')

    # Create hash_id from audio_id (SHA1)
    df['hash_id'] = df['audio_id'].apply(lambda x: hashlib.sha1(str(x).encode()).hexdigest() if pd.notna(x) else None)

    # Extract relevant fields (with type conversion for safety)
    df['title'] = df['title'].astype(str).str.strip()
    df['artist'] = df['artist'].astype(str)
    df['file_name'] = df['file'].astype(str).str.strip()
    df['album_title'] = df['album_title'].astype(str).str.strip() if 'album_title' in df.columns else ''
    df['genre'] = df['genre'].astype(str).str.strip() if 'genre' in df.columns else ''
    df['bpm'] = pd.to_numeric(df['bpm'], errors='coerce')
    df['key'] = df['key'].astype(str).str.strip() if 'key' in df.columns else ''

    # Create file_path (simplified - just use full_path if available)
    if 'full_path' in df.columns:
        df['file_path'] = df['full_path']
    else:
        df['file_path'] = df['volume'].fillna('') + df['dir'].fillna('').str.replace(':', '') + df['file'].fillna('')

    # Handle dates
    for date_col in ['import_date', 'last_played', 'release_date']:
        if date_col in df.columns:
            df[date_col] = pd.to_datetime(df[date_col], errors='coerce')

    # Group by hash_id and aggregate (similar to SQL CTEs)
    # Get max values for main fields
    grouped = df.groupby('hash_id', dropna=False).agg({
        'title': 'max',
        'artist': 'max',
        'file_path': 'max',
        'file_name': 'max',
        'album_title': lambda x: x[x.notna() & (x != '')].max() if any(x.notna() & (x != '')) else '',
        'genre': lambda x: '|'.join(sorted(set([str(v) for v in x if pd.notna(v) and str(v) != '']))) if any(x.notna() & (x != '')) else '',
        'key': lambda x: '|'.join(sorted(set([str(v) for v in x if pd.notna(v) and str(v) != '']))) if any(x.notna() & (x != '')) else '',
        'bpm': 'max',
        'import_date': 'max',
        'last_played': 'max',
        'release_date': 'max'
    }).reset_index()

    # Rename album_title to release_name to match SQL
    grouped.rename(columns={'album_title': 'release_name', 'key': 'trackkey'}, inplace=True)

    # Create trackjoin field
    grouped['trackjoin'] = grouped['title'].apply(clean_track_name)

    return grouped


def join_playlists(spotify_df, traktor_df, traktor_collection_df=None):
    """
    Join Spotify and Traktor playlists, replicating SQL join logic.
    Creates the compare_playlist_prod table structure.

    Args:
        spotify_df: Processed Spotify playlist dataframe
        traktor_df: Processed Traktor playlist dataframe
        traktor_collection_df: Processed full Traktor collection dataframe (optional)
    """
    # Rename trackjoin before merge to preserve both values
    spotify_work = spotify_df.copy()
    traktor_work = traktor_df.copy()

    spotify_work['spotify_trackjoin'] = spotify_work['trackjoin']
    traktor_work['trak_trackjoin'] = traktor_work['trackjoin']

    # Left join: Spotify to Traktor
    sfy_left = spotify_work.merge(
        traktor_work,
        left_on='spotify_trackjoin',
        right_on='trak_trackjoin',
        how='left',
        suffixes=('', '_trak')
    )

    # Left join collection file paths to sfy_left using trackjoin
    # This allows Spotify tracks not in the playlist to still get collection file paths
    if traktor_collection_df is not None:
        # Get trackjoin and file_path from collection
        collection_for_spotify = traktor_collection_df[['trackjoin', 'file_path']].copy()
        collection_for_spotify.rename(columns={'trackjoin': 'spotify_trackjoin_for_collection'}, inplace=True)

        # Left join to sfy_left using spotify_trackjoin (since trak_trackjoin will be NaN for unmatched tracks)
        sfy_left = sfy_left.merge(
            collection_for_spotify,
            left_on='spotify_trackjoin',
            right_on='spotify_trackjoin_for_collection',
            how='left',
            suffixes=('', '_collection')
        )

        # Use collection file_path only if playlist file_path is missing
        if 'file_path_collection' in sfy_left.columns:
            sfy_left['file_path'] = sfy_left['file_path'].fillna(sfy_left['file_path_collection'])
            sfy_left.drop(columns=['file_path_collection', 'spotify_trackjoin_for_collection'], inplace=True)

    # Left join: Traktor to Spotify (to get Traktor-only tracks)
    trak_left = traktor_work.merge(
        spotify_work,
        left_on='trak_trackjoin',
        right_on='spotify_trackjoin',
        how='left',
        suffixes=('', '_sfy')
    )
    # Filter for Traktor-only (where Spotify trackjoin is null)
    trak_left = trak_left[trak_left['spotify_trackjoin'].isna()].copy()
    trak_left['spotify_trackjoin'] = ''

    # Left join collection file paths to trak_left using hash_id
    if traktor_collection_df is not None and 'hash_id' in trak_left.columns:
        # Get only hash_id and file_path from collection
        collection_paths = traktor_collection_df[['hash_id', 'file_path']].copy()
        # Left join to trak_left
        trak_left = trak_left.merge(
            collection_paths,
            on='hash_id',
            how='left',
            suffixes=('', '_collection')
        )
        # Rename file_path_collection to file_path if needed
        if 'file_path_collection' in trak_left.columns:
            trak_left['file_path'] = trak_left['file_path_collection']
            trak_left.drop(columns=['file_path_collection'], inplace=True)

    # Ensure columns align before union
    # Get all columns from sfy_left
    all_cols = list(sfy_left.columns)

    # Add missing columns to trak_left with empty/null values
    for col in all_cols:
        if col not in trak_left.columns:
            trak_left[col] = None if col in ['release_date', 'added_at', 'import_date', 'last_played', 'release_date_trak'] else ''

    # Reorder trak_left columns to match sfy_left
    trak_left = trak_left[all_cols]

    # Union the two dataframes
    combined = pd.concat([sfy_left, trak_left], ignore_index=True)

    # Create presence_flag
    def get_presence_flag(row):
        has_spotify = pd.notna(row.get('spotify_trackjoin', '')) and row.get('spotify_trackjoin', '') != ''
        has_traktor = pd.notna(row.get('trak_trackjoin', '')) and row.get('trak_trackjoin', '') != ''
        has_collection_path = pd.notna(row.get('file_path', '')) and row.get('file_path', '') != ''

        if has_spotify and has_traktor:
            return 'Yes-Trak-Playlist'
        elif has_spotify and not has_traktor and has_collection_path:
            return 'Not-Trak-Playlist / Yes-Trak-Collection'
        elif has_spotify and not has_traktor:
            return 'Not-Trak-Collection'
        elif not has_spotify and has_traktor:
            return 'Not-Spotify / Yes-Trak-Playlist'
        else:
            return ''

    combined['presence_flag'] = combined.apply(get_presence_flag, axis=1)

    # Create collated artist and track fields
    combined['artist_collate'] = combined.apply(
        lambda row: row['artist_names'] if pd.notna(row.get('artist_names')) else row.get('artist', ''),
        axis=1
    )
    combined['track_collate'] = combined.apply(
        lambda row: row['track_name'] if pd.notna(row.get('track_name')) else row.get('title', ''),
        axis=1
    )

    # Format Traktor key
    combined['key_formatted'] = combined.apply(
        lambda row: format_traktor_key(row.get('trackkey_trak', row.get('trackkey', ''))),
        axis=1
    )

    # Create final output columns matching compare_playlist_prod
    output_df = pd.DataFrame({
        'presence_flag': combined['presence_flag'],
        'spotify_trackjoin': combined.get('spotify_trackjoin', '').fillna(''),
        'trak_trackjoin': combined.get('trak_trackjoin', '').fillna(''),
        'artist_collate': combined['artist_collate'].fillna(''),
        'track_collate': combined['track_collate'].fillna(''),
        'trak_collection_file_paths': combined.get('file_path', '').fillna(''),  # Populated from full collection
        'spotify_track_name': combined.get('track_name', '').fillna(''),
        'traktor_title': combined.get('title', '').fillna(''),
        'spotify_artists': combined.get('artist_names', '').fillna(''),
        'traktor_artists': combined.get('artist', '').fillna(''),
        'spotify_album_name': combined.get('album_name', '').fillna(''),
        'traktor_release_name': combined.get('release_name', '').fillna(''),
        'spotify_bpm': combined.get('tempo', '').fillna(''),
        'traktor_bpm': combined.get('bpm', '').fillna(''),
        'spotify_trackkey': combined.get('trackkey', '').fillna(''),
        'traktor_trackkey': combined.apply(
            lambda row: row.get('trackkey_trak', row.get('trackkey', '')),
            axis=1
        ).fillna(''),
        'spotify_uri': combined.get('track_uri', '').fillna(''),
        'key_formatted': combined['key_formatted'].fillna('')
    })

    # Sort by track_collate
    output_df = output_df.sort_values('track_collate').reset_index(drop=True)

    return output_df


def main():
    """Main function to process all playlist pairs."""

    # File paths
    mapping_file = r"C:\studio\rmldata\playlist-dev\traktor_spotify_playlist_compare.csv"
    traktor_full_collection_file = r"C:\studio\rmldata\playlist-dev\Traktor\traktor_collection_tracks.csv"
    traktor_dir = r"C:\studio\rmldata\playlist-dev\Traktor"
    spotify_dir = r"C:\studio\rmldata\playlist-dev\Exportify"
    output_dir = r"C:\studio\rmldata\playlist-dev\Joined"

    print("="*70)
    print("Traktor-Spotify Playlist Join Tool")
    print("="*70)

    # Create output directory if it doesn't exist
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    # Read mapping file
    print(f"\nReading mapping file: {mapping_file}")
    mapping_df = pd.read_csv(mapping_file, encoding='utf-8-sig')

    # Filter to only rows with status 'both'
    mapping_df = mapping_df[mapping_df['Status'] == 'both'].copy()

    print(f"Found {len(mapping_df)} playlist pairs to process")

    # Process full Traktor collection
    print(f"\nProcessing full Traktor collection: {traktor_full_collection_file}")
    try:
        traktor_collection_df = process_traktor_playlist(traktor_full_collection_file)
        print(f"  Loaded {len(traktor_collection_df)} unique tracks from collection")
    except Exception as e:
        print(f"  WARNING: Failed to process collection file: {str(e)}")
        print(f"  Continuing without collection file paths...")
        traktor_collection_df = None

    print("\n" + "="*70)
    print("Processing playlist pairs...")
    print("="*70)

    success_count = 0
    error_count = 0

    for idx, row in mapping_df.iterrows():
        playlist_name = row['Playlist Name']
        traktor_filename = row['Traktor Filename']
        spotify_filename = row['Spotify Filename']

        print(f"\n[{playlist_name}]")

        traktor_path = os.path.join(traktor_dir, traktor_filename)
        spotify_path = os.path.join(spotify_dir, spotify_filename)

        # Check if files exist
        if not os.path.exists(traktor_path):
            print(f"  ERROR: Traktor file not found: {traktor_filename}")
            error_count += 1
            continue

        if not os.path.exists(spotify_path):
            print(f"  ERROR: Spotify file not found: {spotify_filename}")
            error_count += 1
            continue

        try:
            # Process playlists
            print(f"  Reading Traktor: {traktor_filename}")
            traktor_df = process_traktor_playlist(traktor_path)
            print(f"    Loaded {len(traktor_df)} unique tracks")

            print(f"  Reading Spotify: {spotify_filename}")
            spotify_df = process_spotify_playlist(spotify_path)
            print(f"    Loaded {len(spotify_df)} unique tracks")

            # Join playlists
            print(f"  Joining playlists...")
            joined_df = join_playlists(spotify_df, traktor_df, traktor_collection_df)
            print(f"    Combined {len(joined_df)} total rows")

            # Calculate match stats
            matched = len(joined_df[joined_df['presence_flag'] == 'Yes-Trak-Playlist'])
            spotify_only = len(joined_df[joined_df['presence_flag'] == 'Not-Trak-Collection'])
            traktor_only = len(joined_df[joined_df['presence_flag'] == 'Not-Spotify / Yes-Trak-Playlist'])

            print(f"    Matches: {matched} | Spotify-only: {spotify_only} | Traktor-only: {traktor_only}")

            # Save to CSV
            output_filename = f"joined_{playlist_name}.csv"
            output_path = os.path.join(output_dir, output_filename)
            joined_df.to_csv(output_path, index=False, encoding='utf-8-sig')

            print(f"  [OK] Saved to: {output_filename}")
            success_count += 1

        except Exception as e:
            print(f"  ERROR: Failed to process playlist pair: {str(e)}")
            error_count += 1

    # Summary
    print("\n" + "="*70)
    print("Processing Summary")
    print("="*70)
    print(f"Playlist pairs processed: {len(mapping_df)}")
    print(f"Successful: {success_count}")
    print(f"Errors: {error_count}")
    print(f"\nOutput directory: {output_dir}")
    print("="*70)


if __name__ == "__main__":
    main()
