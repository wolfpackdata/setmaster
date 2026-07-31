"""Stage 1 — Traktor Collection NML Parser.

Verbatim port of SM2 `traktor_collection_load.py`.
Parses a Native Instruments Traktor collection.nml file (strictly
read-only) and writes two CSVs under <work_dir>/Traktor (utf-8-sig):

- traktor_collection_tracks.csv    — one row per COLLECTION/ENTRY
- traktor_collection_playlists.csv — one row per (playlist, track)

Plumbing changes vs SM2: output paths derive from work_dir instead of the
script's own folder; a fatal XML parse error raises (SM2 printed and
exited 0, letting stage 2 crash on the missing CSVs).
"""

import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd


def parse_collection_entries(collection_element):
    """Parse all track entries from the COLLECTION element."""
    tracks = []

    for entry in collection_element.findall('ENTRY'):
        track_data = {
            'modified_date': entry.get('MODIFIED_DATE'),
            'modified_time': entry.get('MODIFIED_TIME'),
            'audio_id': entry.get('AUDIO_ID'),
            'title': entry.get('TITLE'),
            'artist': entry.get('ARTIST'),
        }

        # Parse LOCATION
        location = entry.find('LOCATION')
        if location is not None:
            track_data['volume'] = location.get('VOLUME')
            track_data['dir'] = location.get('DIR')
            track_data['file'] = location.get('FILE')
            track_data['volume_id'] = location.get('VOLUMEID')
            # Construct full path
            dir_path = location.get('DIR', '').replace('/:', '\\').replace('/', '\\')
            track_data['full_path'] = f"{location.get('VOLUME', '')}{dir_path}{location.get('FILE', '')}"
            # Store raw NML-format path to match playlist PRIMARYKEY references
            track_data['track_key'] = f"{location.get('VOLUME', '')}{location.get('DIR', '')}{location.get('FILE', '')}"

        # Parse ALBUM
        album = entry.find('ALBUM')
        if album is not None:
            track_data['album_title'] = album.get('TITLE')
            track_data['album_track'] = album.get('TRACK')
            track_data['album_of_tracks'] = album.get('OF_TRACKS')

        # Parse INFO
        info = entry.find('INFO')
        if info is not None:
            track_data['bitrate'] = info.get('BITRATE')
            track_data['genre'] = info.get('GENRE')
            track_data['comment'] = info.get('COMMENT')
            track_data['key'] = info.get('KEY')
            track_data['playcount'] = info.get('PLAYCOUNT')
            track_data['playtime'] = info.get('PLAYTIME')
            track_data['playtime_float'] = info.get('PLAYTIME_FLOAT')
            track_data['import_date'] = info.get('IMPORT_DATE')
            track_data['last_played'] = info.get('LAST_PLAYED')
            track_data['release_date'] = info.get('RELEASE_DATE')
            track_data['ranking'] = info.get('RANKING')
            track_data['filesize'] = info.get('FILESIZE')

        # Parse TEMPO
        tempo = entry.find('TEMPO')
        if tempo is not None:
            track_data['bpm'] = tempo.get('BPM')
            track_data['bpm_quality'] = tempo.get('BPM_QUALITY')

        # Parse LOUDNESS
        loudness = entry.find('LOUDNESS')
        if loudness is not None:
            track_data['peak_db'] = loudness.get('PEAK_DB')
            track_data['perceived_db'] = loudness.get('PERCEIVED_DB')
            track_data['analyzed_db'] = loudness.get('ANALYZED_DB')

        # Parse MUSICAL_KEY
        musical_key = entry.find('MUSICAL_KEY')
        if musical_key is not None:
            track_data['musical_key_value'] = musical_key.get('VALUE')

        tracks.append(track_data)

    return tracks


def parse_playlists(playlists_element, path_prefix=''):
    """Recursively parse playlist structure."""
    playlist_data = []

    for node in playlists_element.findall('NODE'):
        node_type = node.get('TYPE')
        node_name = node.get('NAME')

        # Build the full path for this node
        current_path = f"{path_prefix}/{node_name}" if path_prefix else node_name

        if node_type == 'PLAYLIST':
            # This is an actual playlist
            playlist_entry = node.find('PLAYLIST')
            if playlist_entry is not None:
                entries = playlist_entry.get('ENTRIES', '0')

                # Get all tracks in this playlist
                for entry in playlist_entry.findall('ENTRY'):
                    primarykey = entry.find('PRIMARYKEY')
                    if primarykey is not None:
                        track_key = primarykey.get('KEY')
                        # Extract the top-level folder from the path
                        # e.g. "$ROOT/RML root/playlistName" -> "RML root"
                        path_parts = current_path.split('/')
                        playlist_folder = path_parts[1] if len(path_parts) > 2 else ''

                        playlist_data.append({
                            'playlist_path': current_path,
                            'playlist_name': node_name,
                            'playlist_folder': playlist_folder,
                            'playlist_type': node_type,
                            'playlist_entries_count': entries,
                            'track_key': track_key
                        })

        elif node_type == 'FOLDER':
            # This is a folder, recurse into subnodes
            subnodes = node.find('SUBNODES')
            if subnodes is not None:
                playlist_data.extend(parse_playlists(subnodes, current_path))

    return playlist_data


def run_stage1(nml_path, work_dir):
    """Parse the Traktor collection and export the two stage-1 CSVs.

    Returns (outputs, warnings): list of written Paths and warning strings.
    Raises on a fatal error (unparseable XML, unreadable file).
    """
    nml_path = Path(nml_path)
    work_dir = Path(work_dir)
    traktor_dir = work_dir / "Traktor"
    traktor_dir.mkdir(parents=True, exist_ok=True)

    outputs = []
    warnings = []

    print(f"Reading Traktor collection from: {nml_path}")

    # Parse the XML file (collection.nml is opened read-only; never written)
    tree = ET.parse(nml_path)
    root = tree.getroot()
    print("Successfully parsed XML file")

    # Parse collection entries (tracks)
    print("\nParsing collection entries...")
    collection = root.find('COLLECTION')
    if collection is not None:
        tracks = parse_collection_entries(collection)
        print(f"Found {len(tracks)} tracks in collection")

        # Create DataFrame and save to CSV
        tracks_df = pd.DataFrame(tracks)
        tracks_csv_path = traktor_dir / "traktor_collection_tracks.csv"
        tracks_df.to_csv(tracks_csv_path, index=False, encoding='utf-8-sig')
        outputs.append(tracks_csv_path)
        print(f"Saved tracks to: {tracks_csv_path}")
    else:
        warnings.append("No COLLECTION element found in XML")
        print("No COLLECTION element found in XML")
        tracks_df = pd.DataFrame()

    # Parse playlists
    print("\nParsing playlists...")
    playlists = root.find('PLAYLISTS')
    if playlists is not None:
        playlist_data = parse_playlists(playlists)
        print(f"Found {len(playlist_data)} playlist entries")

        # Create DataFrame and save to CSV
        playlists_df = pd.DataFrame(playlist_data)

        # Add track_name by looking up titles from the collection tracks
        if not tracks_df.empty and 'track_key' in tracks_df.columns:
            track_key_to_title = tracks_df.set_index('track_key')['title'].to_dict()
            playlists_df['track_name'] = playlists_df['track_key'].map(track_key_to_title)

        playlists_csv_path = traktor_dir / "traktor_collection_playlists.csv"
        playlists_df.to_csv(playlists_csv_path, index=False, encoding='utf-8-sig')
        outputs.append(playlists_csv_path)
        print(f"Saved playlists to: {playlists_csv_path}")
    else:
        warnings.append("No PLAYLISTS element found in XML")
        print("No PLAYLISTS element found in XML")

    return outputs, warnings
