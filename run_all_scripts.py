"""
Runner script to execute the playlist processing pipeline in order.
Usage: python run_all_scripts.py "C:\path\to\collection.nml"
"""
import subprocess
import sys
from pathlib import Path

# Output directories and static files that will be written by the pipeline
OUTPUT_DIRS = [
    r"C:\studio\rmldata\playlist-dev\Traktor",
    r"C:\studio\rmldata\playlist-dev\Joined",
]
OUTPUT_STATIC_FILES = [
    r"C:\studio\rmldata\playlist-dev\traktor_spotify_playlist_compare.csv",
]

CONFIG_FILE = r"C:\studio\rmldata\playlist-dev\config__traktor_playlists_to_sync.csv"

CONFIG_FILE_FORMAT = """
  Expected format (CSV with a 'playlist_name' column):

    playlist_name
    MyPlaylist1
    MyPlaylist2
    MyPlaylist3

  Each row should contain the exact playlist name as it appears in Traktor.
"""


def check_input_files_exist(nml_path):
    """
    Verify that required input files exist before the pipeline starts.
    If any are missing, print a clear message and return False.
    """
    input_files = [nml_path, CONFIG_FILE]
    missing = []

    for filepath in input_files:
        if not Path(filepath).exists():
            missing.append(filepath)

    if missing:
        print("\nERROR: The following required input file(s) are missing:\n")
        for f in missing:
            print(f"  {f}")
            if f.endswith("config__traktor_playlists_to_sync.csv"):
                print(CONFIG_FILE_FORMAT)
        return False

    return True


def is_file_locked(filepath):
    """Return True if the file is locked (e.g. open in Excel)."""
    try:
        with open(filepath, 'a'):
            pass
        return False
    except PermissionError:
        return True


def check_output_files_unlocked():
    """
    Scan all output CSVs before the pipeline runs.
    If any are open/locked, print them and return False.
    """
    locked = []

    for directory in OUTPUT_DIRS:
        dir_path = Path(directory)
        if dir_path.exists():
            for csv_file in dir_path.glob("*.csv"):
                if is_file_locked(csv_file):
                    locked.append(str(csv_file))

    for static_file in OUTPUT_STATIC_FILES:
        p = Path(static_file)
        if p.exists() and is_file_locked(p):
            locked.append(static_file)

    if locked:
        print("\nERROR: The following output file(s) are open (e.g. in Excel).")
        print("Please close them and re-run the pipeline:\n")
        for f in locked:
            print(f"  {f}")
        print()
        return False

    return True


# Define the scripts to run in order
SCRIPTS = [
    r"C:\studio\rmldata\playlist-dev\traktor_collection_load.py",
    r"C:\studio\rmldata\playlist-dev\traktor_playlists_from_collection.py",
    r"C:\studio\rmldata\playlist-dev\traktor_spotify_playlist_compare.py",
    r"C:\studio\rmldata\playlist-dev\traktor_spotify_playlist_join.py",
]

# traktor_collection_load.py is the only script that needs the NML path
NML_SCRIPT = r"C:\studio\rmldata\playlist-dev\traktor_collection_load.py"


def run_script(script_path, extra_args=None):
    """Run a Python script and return the result."""
    print(f"\n{'='*80}")
    print(f"Running: {Path(script_path).name}")
    print(f"{'='*80}\n")

    cmd = [sys.executable, script_path] + (extra_args or [])
    result = subprocess.run(cmd, capture_output=False, text=True)

    if result.returncode != 0:
        print(f"\nERROR: {Path(script_path).name} failed with exit code {result.returncode}")
        return False

    print(f"\nOK: {Path(script_path).name} completed successfully")
    return True


def main():
    """Run all scripts in sequence."""
    if len(sys.argv) < 2:
        print("ERROR: No collection path provided.")
        print("Usage: python run_all_scripts.py \"C:\\path\\to\\collection.nml\"")
        sys.exit(1)

    nml_path = sys.argv[1]
    print(f"Starting playlist processing pipeline...")
    print(f"Collection file: {nml_path}")

    if not check_input_files_exist(nml_path):
        sys.exit(1)

    if not check_output_files_unlocked():
        sys.exit(1)

    print(f"Total scripts to run: {len(SCRIPTS)}\n")

    for i, script in enumerate(SCRIPTS, 1):
        print(f"\n[{i}/{len(SCRIPTS)}] Processing: {Path(script).name}")

        if not Path(script).exists():
            print(f"ERROR: Script not found: {script}")
            sys.exit(1)

        extra_args = [nml_path] if script == NML_SCRIPT else None
        if not run_script(script, extra_args):
            print("\nPipeline failed. Stopping execution.")
            sys.exit(1)

    print("\n" + "="*80)
    print("All scripts completed successfully!")
    print("="*80)


if __name__ == "__main__":
    main()
