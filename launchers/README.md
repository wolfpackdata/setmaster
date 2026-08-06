# Starting SetMaster 3

SetMaster 3 runs on your own computer. There is no website to visit and no
account to create. You start it with a double-click, and it opens in your normal
web browser. Everything stays on your machine.

You do **not** need to use a terminal or type any commands.

---

## Windows

### To start SetMaster 3
Double-click **`SetMaster 3.vbs`**.

- Nothing much seems to happen for a few seconds while it starts up. That is
  normal.
- Then SetMaster 3 opens automatically in your default web browser.
- If SetMaster 3 is already running, double-clicking again simply brings the app
  back up in the browser. It will **not** start a second copy.

> **Tip:** Right-click `SetMaster 3.vbs` and choose *Send to → Desktop (create
> shortcut)* to get a handy shortcut on your desktop. You can rename the
> shortcut to just "SetMaster 3".

### To stop SetMaster 3
Double-click **`Stop SetMaster 3.vbs`**. A small message confirms when it has
stopped. You can then close any SetMaster 3 browser tabs.

You don't *have* to stop it - it uses very little of your computer while idle,
and it stops on its own when you shut the computer down. Stopping it is only
needed if you want to free things up or restart it fresh.

**It only ever stops SetMaster 3.** If some other program happens to be using
SetMaster 3's address, the Stop launcher tells you so and leaves that program
running - it will never close something that isn't SetMaster 3.

### If the normal launcher doesn't work
Double-click **`SetMaster 3 (troubleshoot).cmd`** instead. This one keeps a
black window open so you can read what is happening and see any error message.
The first time you ever run it, it may spend a minute building the app's screens
before opening the browser. Closing that black window does **not** stop the app;
use `Stop SetMaster 3.vbs` for that.

---

## macOS

> **Most Mac users want the app, not these launchers.** SetMaster ships as a
> signed, notarized **`.dmg`** — drag it to Applications and open it like any
> other Mac app, with no security prompts and no terminal. **To stop it,
> right-click its icon in the Dock and choose Quit.** Setup and everything else
> is in `INSTALL-macos-dmg.txt`.
>
> The `.command` launchers below are the **unsigned `.tar.gz`** payload, kept for
> anyone who wants the folder directly. They still need the one-time Gatekeeper
> step described here, which the `.dmg` removes.

### To start SetMaster 3
Double-click **`SetMaster 3.command`**.

- **First time only:** SetMaster 3 isn't signed by an Apple-registered developer,
  so macOS may warn that the file is from an "unidentified developer" and refuse
  to open it. **Right-click** the file, choose **Open**, then click **Open** in
  the dialog. On **macOS 15 and later** you may instead need to open **System
  Settings → Privacy & Security** and click **Open Anyway**. Either way it's a
  one-time step, and no terminal is involved.
- The launchers **arrive ready to run** — you never need to make them executable.
  If double-clicking does nothing at all, the unpacking tool discarded file
  permissions: unpack the original `.tar.gz` again by double-clicking it in
  Finder.
- SetMaster 3 then opens automatically in your default web browser. Running it
  again while it's already up just re-opens the browser.

### To stop SetMaster 3
Double-click **`Stop SetMaster 3.command`**.

As on Windows, it only ever stops SetMaster 3: if another program is using
SetMaster 3's address, it says so and leaves that program alone.

---

## Trying things out safely - the test copy

Sometimes you want to try something without any risk to your real sets and
notes: importing an unfamiliar file, seeing what a button does, or testing that
a backup actually restores. SetMaster 3 comes with a **test copy** for exactly
that.

The test copy is a second, completely empty SetMaster 3. It keeps its own sets,
notes and settings in its own separate folder, so **nothing you do in it can
touch your real data**. Both can run at the same time, side by side.

### Starting, stopping and emptying it

Double-click these exactly like the normal launchers:

| What you want | Windows | macOS |
|---|---|---|
| Start the test copy | `SetMaster 3 (test instance).vbs` | `SetMaster 3 (test instance).command` |
| Stop the test copy | `Stop SetMaster 3 (test instance).vbs` | `Stop SetMaster 3 (test instance).command` |
| Empty it and start over | `Reset test instance.vbs` | `Reset test instance.command` |

The first time you start it, the test copy is a brand-new, empty SetMaster 3 -
no sets, no notes, no imported playlists. Starting or stopping it never affects
your real SetMaster 3, and stopping your real SetMaster 3 never affects it.

**Emptying it:** the reset launcher asks you to confirm, then throws away
everything in the test copy so the next start is fresh again. It can only ever
delete the test copy's own folder - that folder is fixed inside the script and
cannot be pointed anywhere else, so it can never reach your real data. If
anything looks even slightly wrong, it refuses and deletes nothing.

### Important: the two look identical

Same screens, same layout, same everything. Before you do anything that changes
or deletes data, check which one you are actually in:

- **Look at the address bar.** `http://127.0.0.1:8137` is your **real**
  SetMaster 3. `http://127.0.0.1:8140` is the **test copy**.
- **Or open Settings.** It shows the data folder that tab is using: a path
  ending in `SetMaster3` is the real one, `SetMaster3-test` is the test copy.

> **Careful:** **"Restore from backup" replaces whatever is in the tab you are
> looking at.** It has no idea which copy is which - restoring while you're in
> the real tab replaces your real sets, notes and settings. Check the address
> bar first, every single time. The same goes for anything else destructive:
> it happens to the tab you're in, not the one you meant.

---

## Good to know

- **Your data is safe.** Sets, notes, formatting and settings are saved
  automatically and are never affected by starting or stopping the app.
- **You don't need Traktor® to use SetMaster 3.** Preparing sets is what it is
  mainly for, and the set editor works with no collection loaded at all - start a
  set and type. Reading a Traktor® collection is a second, optional half that
  adds the collection and comparison screens.
- **SetMaster 3 never changes your Traktor collection.** It only reads
  `collection.nml`; it never writes to it or to any Native Instruments® file.
- **It works fully offline.** SetMaster 3 makes no internet connections.
- **The address bar shows** `http://127.0.0.1:8137` - that "127.0.0.1" means the
  app is running on *your own computer*, not on a website. (`8140` is the test
  copy - see above.)
- **Bookmark it** if you like: the address stays the same every time.

## For a technical person (optional)

The launchers assume the standard layout where this `launchers/` folder sits
next to `backend/` and `frontend/`. They run
`python -m uvicorn app.main:app --port 8137` completely hidden, preferring the
Python bundled into a release payload (`runtime/python/`, self-contained) and
falling back to a developer checkout's `backend/.venv` — so the same launcher
files work in both. The backend serves the built UI from `frontend/dist`. Set
`SM3_PORT` (and `SM3_DATA_DIR`) before launching to run an isolated instance.

That is exactly how the test copy works: its launchers set both **for that one
process only** (`SM3_PORT=8140`, `SM3_DATA_DIR` pointing at `SetMaster3-test`)
and then hand over to the normal start/stop logic, so there is only one copy of
that logic to maintain. **Never set either variable globally** — a Windows
user/system environment variable, or an `export` in `~/.zshrc`. Doing so
silently redirects the *normal* launcher too, so "real" SetMaster 3 would
quietly open the test copy's data. Server logs are per-port
(`SetMaster3-server-<port>.log` in `%TEMP%` on Windows, `setmaster3-<port>.log`
beside the launchers on macOS), so the two instances never overwrite each
other's.

`Reset test instance` refuses unless the folder it resolved is a real directory
whose name ends in `SetMaster3-test`, is not a junction or symlink, and is not
claimed by an instance reporting a different data dir; `SM3_DATA_DIR` is ignored
there on purpose. The confirmation prompt lives in the double-click wrapper
rather than the script, because `WScript.Shell`'s `Popup` returns "Yes" without
drawing anything when there is no interactive desktop — the script itself
deletes nothing unless the wrapper passes `SM3_RESET_CONFIRMED=1`.

Release payloads are built by `release/build-windows.ps1` /
`release/build-macos.sh` and verified by the matching `release/smoke-*` scripts —
see `release/README.md`.

The stop scripts never kill by port. The server publishes its identity - PID plus
a per-process token - in `<app-data dir>/instance.json` and in `GET /api/status`;
the stopper terminates a process only when the token matches in both places and
that process (or its parent) is the one listening. Anything else is reported and
left running.
