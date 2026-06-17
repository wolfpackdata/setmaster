"""
Runner script to execute the playlist processing pipeline in order.
Usage: python run_all_scripts.py "C:\path\to\collection.nml" "C:\path\to\repo\"
       python run_all_scripts.py "C:\path\to\collection.nml" "C:\path\to\repo\" --playlist-arg "My Label"
"""
import argparse
import datetime
import subprocess
import sys
from pathlib import Path

VALID_REPO_NAMES = {"playlist-dev", "setmaster"}


class _Tee:
    """Write to multiple streams simultaneously (console + log file)."""
    def __init__(self, *streams):
        self._streams = streams

    def write(self, text):
        for s in self._streams:
            s.write(text)
            s.flush()

    def flush(self):
        for s in self._streams:
            s.flush()

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
    """Run a Python script, streaming output through print() so the tee captures it."""
    print(f"\n{'='*80}")
    print(f"Running: {Path(script_path).name}")
    print(f"{'='*80}\n")

    # -u forces unbuffered output from child scripts so lines appear in real time
    cmd = [sys.executable, "-u", str(script_path)] + (extra_args or [])
    process = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    for line in process.stdout:
        print(line, end="")
    process.wait()

    if process.returncode != 0:
        print(f"\nERROR: {Path(script_path).name} failed with exit code {process.returncode}")
        return False

    print(f"\nOK: {Path(script_path).name} completed successfully")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Execute the playlist processing pipeline in order."
    )
    parser.add_argument("nml_path", help="Path to the Traktor collection .nml file")
    parser.add_argument("repo_path", help="Path to the repository root folder")
    parser.add_argument(
        "--playlist-arg",
        default=None,
        dest="playlist_arg",
        help='Root folder name passed to traktor_playlists_from_collection.py (e.g. "RML root"). '
             'Omit or leave blank to skip root-playlist classification in the matrix output.',
    )
    args = parser.parse_args()

    nml_path = args.nml_path
    repo_path = validate_repo_path(args.repo_path)

    # Open log file and write a header (header goes to log only, not console)
    log_path = repo_path / "log_most_recent.txt"
    log_file = open(log_path, "w", encoding="utf-8")
    started_at = datetime.datetime.now()
    playlist_arg_display = args.playlist_arg if args.playlist_arg else "(not specified)"
    log_file.write(
        f"Pipeline Run Log\n"
        f"{'='*80}\n"
        f"Started:         {started_at.strftime('%Y-%m-%d %H:%M:%S')}\n"
        f"Repository:      {repo_path}\n"
        f"Collection file: {nml_path}\n"
        f"Root folder arg: {playlist_arg_display}\n"
        f"{'='*80}\n\n"
    )
    log_file.flush()

    # From here on, all print() output goes to both the console and the log file
    original_stdout = sys.stdout
    sys.stdout = _Tee(original_stdout, log_file)

    try:
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
        playlist_script = repo_path / "traktor_playlists_from_collection.py"

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

            if script == nml_script:
                extra_args = [nml_path]
            elif script == playlist_script:
                extra_args = [args.playlist_arg or ""]
            else:
                extra_args = None
            if not run_script(script, extra_args):
                print("\nPipeline failed. Stopping execution.")
                sys.exit(1)

        print("\n" + "="*80)
        print("All scripts completed successfully!")
        print("="*80)

    finally:
        sys.stdout = original_stdout
        ended_at = datetime.datetime.now()
        elapsed = ended_at - started_at
        log_file.write(
            f"\n{'='*80}\n"
            f"Ended:   {ended_at.strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"Elapsed: {str(elapsed).split('.')[0]}\n"
        )
        log_file.close()
        print(f"\nLog saved to: {log_path}")


if __name__ == "__main__":
    main()
