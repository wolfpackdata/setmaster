"""
Runner script to execute the playlist processing pipeline in order.
Usage: python run_all_scripts.py "C:\path\to\collection.nml" "C:\path\to\repo\"
"""
import subprocess
import sys
from pathlib import Path

VALID_REPO_NAMES = {"playlist-dev", "setmaster"}

CONFIG_FILE_FORMAT = """
  Expected format (CSV with a 'playlist_name_in_both_spotify_and_traktor' column):

    playlist_name_in_both_spotify_and_traktor
    MyPlaylist1
    MyPlaylist2
    MyPlaylist3

  Each row should contain the exact playlist name as it appears in Traktor.
"""


def validate_repo_path(repo_path_str):
    """
    Confirm the provided path ends in a recognised repository folder name.
    Returns a resolved Path on success, exits with a message on failure.
    """
    repo_path = Path(repo_path_str.rstrip("\\/"))
    if repo_path.name.lower() not in VALID_REPO_NAMES:
        print(
            f"\nERROR: The repository path must end in one of: "
            + ", ".join(f"\\{n}\\" for n in sorted(VALID_REPO_NAMES))
        )
        print(f"  Received: {repo_path_str}")
        print(
            "\nPlease browse for the correct repository folder in the SetMaster interface and try again."
        )
        sys.exit(1)
    return repo_path


def check_input_files_exist(nml_path, config_file):
    """
    Verify that required input files exist before the pipeline starts.
    """
    missing = []
    for filepath in [nml_path, str(config_file)]:
        if not Path(filepath).exists():
            missing.append(filepath)

    if missing:
        print("\nERROR: The following required input file(s) are missing:\n")
        for f in missing:
            print(f"  {f}")
            if str(f).endswith("config__traktor_playlists_to_sync.csv"):
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


def check_output_files_unlocked(output_dirs, output_static_files):
    """
    Scan all output CSVs before the pipeline runs.
    If any are open/locked, print them and return False.
    """
    locked = []

    for directory in output_dirs:
        dir_path = Path(directory)
        if dir_path.exists():
            for csv_file in dir_path.glob("*.csv"):
                if is_file_locked(csv_file):
                    locked.append(str(csv_file))

    for static_file in output_static_files:
        p = Path(static_file)
        if p.exists() and is_file_locked(p):
            locked.append(str(static_file))

    if locked:
        print("\nERROR: The following output file(s) are open (e.g. in Excel).")
        print("Please close them and re-run the pipeline:\n")
        for f in locked:
            print(f"  {f}")
        print()
        return False

    return True


def run_script(script_path, extra_args=None):
    """Run a Python script and return True on success."""
    print(f"\n{'='*80}")
    print(f"Running: {Path(script_path).name}")
    print(f"{'='*80}\n")

    cmd = [sys.executable, str(script_path)] + (extra_args or [])
    result = subprocess.run(cmd, capture_output=False, text=True)

    if result.returncode != 0:
        print(f"\nERROR: {Path(script_path).name} failed with exit code {result.returncode}")
        return False

    print(f"\nOK: {Path(script_path).name} completed successfully")
    return True


def main():
    if len(sys.argv) < 3:
        print("ERROR: Two arguments are required.")
        print('Usage: python run_all_scripts.py "C:\\path\\to\\collection.nml" "C:\\path\\to\\repo\\"')
        sys.exit(1)

    nml_path = sys.argv[1]
    repo_path = validate_repo_path(sys.argv[2])

    # Derive all paths from the validated repo root
    output_dirs = [
        repo_path / "Traktor",
        repo_path / "Joined",
    ]
    output_static_files = [
        repo_path / "traktor_spotify_playlist_compare.csv",
    ]
    config_file = repo_path / "config__traktor_playlists_to_sync.csv"
    scripts = [
        repo_path / "traktor_collection_load.py",
        repo_path / "traktor_playlists_from_collection.py",
        repo_path / "traktor_spotify_playlist_compare.py",
        repo_path / "traktor_spotify_playlist_join.py",
    ]
    nml_script = repo_path / "traktor_collection_load.py"

    print(f"Starting playlist processing pipeline...")
    print(f"Repository:      {repo_path}")
    print(f"Collection file: {nml_path}")

    if not check_input_files_exist(nml_path, config_file):
        sys.exit(1)

    if not check_output_files_unlocked(output_dirs, output_static_files):
        sys.exit(1)

    print(f"Total scripts to run: {len(scripts)}\n")

    for i, script in enumerate(scripts, 1):
        print(f"\n[{i}/{len(scripts)}] Processing: {script.name}")

        if not script.exists():
            print(f"ERROR: Script not found: {script}")
            sys.exit(1)

        extra_args = [nml_path] if script == nml_script else None
        if not run_script(script, extra_args):
            print("\nPipeline failed. Stopping execution.")
            sys.exit(1)

    print("\n" + "="*80)
    print("All scripts completed successfully!")
    print("="*80)


if __name__ == "__main__":
    main()
