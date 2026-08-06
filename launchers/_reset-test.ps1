# SetMaster 3 - reset the TEST instance (Windows)
# Called by "Reset test instance.vbs".
#
# Empties the test copy of SetMaster 3 so the next start is factory-fresh: it
# stops the test instance, then deletes that copy's data folder. The real
# SetMaster 3 data folder is never touched.
#
# Safety rules, most important first (#122):
#   1. The folder is HARD-CODED below (%APPDATA%\SetMaster3-test) and is
#      deliberately NOT a parameter. A reset that can be pointed at another
#      folder is a data-loss bug waiting to happen.
#   2. It refuses unless the last part of the resolved path is exactly
#      "SetMaster3-test", and refuses outright if that path is a junction or
#      symlink - PowerShell 5.1's Remove-Item -Recurse can follow a reparse
#      point and delete what it points at rather than the link.
#   3. It refuses if something answering on the test port reports a different
#      data folder, because that is not the test instance.
#   4. $env:SM3_DATA_DIR is ignored on purpose, so a stray environment variable
#      cannot redirect the delete.

[CmdletBinding()]
param(
    [switch]$Console,
    [switch]$Quiet   # suppress the pop-up dialogs (used by the automated launcher
                     # checks); default off, so double-click behaviour is unchanged
)

$ErrorActionPreference = 'Stop'

# --- hard-coded identity of the test instance ----------------------------
$TestPort    = '8140'
$TestDirName = 'SetMaster3-test'
$ProdDirName = 'SetMaster3'
$Title       = 'SetMaster 3 (test instance)'

function Log([string]$msg) { if ($Console) { Write-Host $msg } }

function Show-Dialog([string]$msg, [int]$icon = 0x40) {
    Log $msg
    if ($Quiet) { return }
    try {
        $ws = New-Object -ComObject WScript.Shell
        [void]$ws.Popup($msg, 0, $Title, $icon)
    } catch { }
}

function Stop-Reset([string]$msg) {
    # Every refusal path ends here: say why, change nothing, exit non-zero.
    Show-Dialog $msg 0x10   # 0x10 = error icon
    exit 1
}

function Test-Confirmed {
    # This script does NOT ask for confirmation itself, on purpose. When there is
    # no interactive desktop to draw on, WScript.Shell's Popup does not fail - it
    # returns 6 ("Yes") without ever showing a dialog, so a prompt here would
    # silently approve its own delete. The prompt therefore lives in
    # "Reset test instance.vbs", which sets SM3_RESET_CONFIRMED=1 for this
    # process only once the user has actually clicked Yes.
    #
    # No handshake, no delete: running this script directly deletes nothing.
    # The automated launcher checks set the same variable deliberately.
    return ($env:SM3_RESET_CONFIRMED -eq '1')
}

# --- 1. work out the folder, then prove it is the right one --------------
$AppData = $env:APPDATA
if ([string]::IsNullOrWhiteSpace($AppData)) {
    Stop-Reset "The test instance could not be reset: Windows did not report an AppData folder, so there is nothing safe to delete."
}

$TestDataDir = Join-Path $AppData $TestDirName
$ProdDataDir = Join-Path $AppData $ProdDirName

# Guard A: the last part of the path must be exactly "SetMaster3-test".
if ((Split-Path -Leaf $TestDataDir) -ne $TestDirName) {
    Stop-Reset "The test instance was NOT reset: the folder to delete did not look like the test folder.`n`n$TestDataDir`n`nNothing was deleted."
}

# Guard B: never the production folder, whatever the paths resolved to.
if ($TestDataDir -eq $ProdDataDir) {
    Stop-Reset "The test instance was NOT reset: the test folder and your real SetMaster 3 folder came out the same.`n`n$TestDataDir`n`nNothing was deleted."
}

if (-not (Test-Path -LiteralPath $TestDataDir)) {
    Show-Dialog "The test instance is already empty - there is nothing to reset.`n`nStarting 'SetMaster 3 (test instance)' will create a fresh, empty copy.`n`nYour real SetMaster 3 data was not touched."
    exit 0
}

$TestItem = Get-Item -LiteralPath $TestDataDir -Force

# Guard C: a junction/symlink would let a delete escape to another folder.
if ($TestItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    Stop-Reset "The test instance was NOT reset: `n`n$TestDataDir`n`nis a shortcut (junction or symbolic link) to somewhere else, and deleting it could remove the wrong files. Nothing was deleted."
}

# Guard D: it must be a folder, not a file someone left with that name.
if (-not $TestItem.PSIsContainer) {
    Stop-Reset "The test instance was NOT reset: `n`n$TestDataDir`n`nis a file, not a folder. Nothing was deleted."
}

# Guard E: whatever is serving the test port must agree it owns this folder.
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$TestPort/api/status" -UseBasicParsing -TimeoutSec 3
    $status = $r.Content | ConvertFrom-Json
    if ($status.app_data_dir) {
        $serving = [IO.Path]::GetFullPath($status.app_data_dir).TrimEnd('\')
        $target  = [IO.Path]::GetFullPath($TestDataDir).TrimEnd('\')
        if ($serving -ne $target) {
            Stop-Reset ("The test instance was NOT reset. SetMaster 3 is answering on port $TestPort, " +
                        "but it is using this data folder:`n`n$serving`n`nnot the test folder:`n`n$target`n`n" +
                        "That may be your real SetMaster 3 on the wrong port. Nothing was deleted.")
        }
    }
} catch {
    # Nothing answering on the test port is the normal case - carry on.
}

# --- 2. refuse unless the user has actually confirmed --------------------
if (-not (Test-Confirmed)) {
    Stop-Reset ("The test instance was NOT reset, because nothing confirmed the delete.`n`n" +
                "Double-click 'Reset test instance.vbs' instead - it asks you first.`n`nNothing was deleted.")
}

# --- 3. stop the test instance so its files are not in use ---------------
$stopPs1 = Join-Path $PSScriptRoot '_stop.ps1'
if (Test-Path -LiteralPath $stopPs1) {
    Log "Stopping the test instance on port $TestPort ..."
    $savedPort = $env:SM3_PORT
    try {
        $env:SM3_PORT = $TestPort
        & $stopPs1 -Quiet -Console:$Console
    } catch {
        Log "Stop script reported: $_"
    } finally {
        if ($null -eq $savedPort) { Remove-Item Env:SM3_PORT -ErrorAction SilentlyContinue }
        else { $env:SM3_PORT = $savedPort }
    }
}

# --- 4. delete the folder (retry: the server may still be letting go) ----
Log "Deleting $TestDataDir ..."
$deleted = $false
for ($i = 0; $i -lt 10; $i++) {
    try {
        Remove-Item -LiteralPath $TestDataDir -Recurse -Force
        $deleted = $true
        break
    } catch {
        Start-Sleep -Milliseconds 300
    }
}

if (-not $deleted -or (Test-Path -LiteralPath $TestDataDir)) {
    Stop-Reset ("The test instance could not be fully reset - some of its files are still in use.`n`n$TestDataDir`n`n" +
                "Close any SetMaster 3 test windows, run 'Stop SetMaster 3 (test instance).vbs', then try again.`n`n" +
                "Your real SetMaster 3 data was not touched.")
}

Show-Dialog ("The test copy of SetMaster 3 has been reset.`n`nThe next time you start 'SetMaster 3 (test instance)' it will be a fresh, " +
             "empty SetMaster 3.`n`nYour real SetMaster 3 data was not touched.")
exit 0
