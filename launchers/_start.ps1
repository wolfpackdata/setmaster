# SetMaster 3 - start script (Windows)
# Called by "SetMaster 3.vbs" (hidden, no console) and by
# "SetMaster 3 (troubleshoot).cmd" (visible console with logs).
#
# What it does, in order:
#   1. If SetMaster 3 is already serving on the port, just open the browser (idempotent).
#   2. Verify the bundled Python environment and the built UI exist.
#   3. Start the backend as a windowless background process (pythonw.exe).
#   4. Wait until the server answers, then open the default browser at the app.
#
# It never edits collection.nml or any user file; it only launches the app.

[CmdletBinding()]
param(
    [switch]$Console,   # also print progress to the console (used by the .cmd launcher)
    [switch]$Build      # if the UI bundle is missing, try to build it (needs Node/npm)
)

$ErrorActionPreference = 'Stop'

# --- paths ---------------------------------------------------------------
# launchers/ sits at the repo/package root, next to backend/ and frontend/.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $RepoRoot 'backend'
$Dist     = Join-Path $RepoRoot 'frontend\dist'
$Frontend = Join-Path $RepoRoot 'frontend'

# Python, in preference order: the runtime bundled into a release payload
# (runtime\python\, self-contained - a user's machine needs nothing installed),
# then a developer checkout's virtualenv. pythonw.exe first: it has no console.
$PyCandidates = @(
    (Join-Path $RepoRoot 'runtime\python\pythonw.exe'),
    (Join-Path $RepoRoot 'runtime\python\python.exe'),
    (Join-Path $Backend  '.venv\Scripts\pythonw.exe'),
    (Join-Path $Backend  '.venv\Scripts\python.exe')
)
$PyW = $null
foreach ($candidate in $PyCandidates) {
    if (Test-Path $candidate) { $PyW = $candidate; break }
}

# Port is fixed at the SM3 default 8137; $env:SM3_PORT overrides for advanced use.
$Port = if ($env:SM3_PORT) { $env:SM3_PORT } else { '8137' }
$Url  = "http://127.0.0.1:$Port/"

function Log([string]$msg) {
    if ($Console) { Write-Host $msg }
}

function Show-Error([string]$msg) {
    # A blocking dialog so a non-programmer actually sees what went wrong,
    # even when we were launched hidden with no console.
    Log "ERROR: $msg"
    try {
        $ws = New-Object -ComObject WScript.Shell
        [void]$ws.Popup($msg, 0, 'SetMaster 3', 0x10)  # 0x10 = error icon
    } catch { }
}

function Test-Ready {
    # True only when *SetMaster 3* answers on the port (checks for app_version),
    # so we never mistake some other program's port for ours.
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/status" `
                -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200 -and $r.Content -match 'app_version')
    } catch {
        return $false
    }
}

# --- 1. already running? (idempotent relaunch) ---------------------------
if (Test-Ready) {
    Log "SetMaster 3 is already running - opening the browser."
    Start-Process $Url
    exit 0
}

# --- 2. environment checks ----------------------------------------------
if (-not $PyW) {
    Show-Error "SetMaster 3 is not fully installed: its Python was not found at`n`n$RepoRoot\runtime\python`n`nPlease reinstall SetMaster 3."
    exit 1
}

if (-not (Test-Path (Join-Path $Dist 'index.html'))) {
    if ($Build -and (Get-Command npm -ErrorAction SilentlyContinue)) {
        Log "The app UI is not built yet - building it now (this can take a minute)..."
        Push-Location $Frontend
        try {
            & npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm build failed" }
        } catch {
            Pop-Location
            Show-Error "SetMaster 3's UI could not be built automatically.`n`nRun 'npm install' then 'npm run build' inside the frontend folder, or reinstall SetMaster 3."
            exit 1
        }
        Pop-Location
    } else {
        Show-Error "SetMaster 3's UI bundle is missing (frontend\dist).`n`nUse 'SetMaster 3 (troubleshoot).cmd' to build it, or reinstall SetMaster 3."
        exit 1
    }
}

# --- 3. start the backend (windowless, detached) -------------------------
# pythonw.exe has no console, so its stdout/stderr are redirected to a log file.
# This is required: uvicorn's logger writes to stderr, and under pythonw an
# un-redirected stderr is None, which crashes startup. The log also gives a
# non-programmer (and support) something to read when things go wrong.
Log "Starting the SetMaster 3 backend on port $Port ..."
$LogFile = Join-Path $env:TEMP "SetMaster3-server-$Port.log"
$uvArgs = @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port',$Port)
Start-Process -FilePath $PyW -ArgumentList $uvArgs -WorkingDirectory $Backend `
    -WindowStyle Hidden -RedirectStandardOutput $LogFile -RedirectStandardError "$LogFile.err"

# --- 4. wait for readiness, then open the browser ------------------------
$ready = $false
for ($i = 0; $i -lt 60; $i++) {   # up to ~30s
    if (Test-Ready) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    Show-Error "SetMaster 3's backend did not start within 30 seconds.`n`nPort $Port may already be in use by another program.`nRun 'Stop SetMaster 3.vbs' - it will tell you whether the port belongs to`nSetMaster 3 (and stop it) or to something else (which it leaves running,`nfor you to close yourself). 'SetMaster 3 (troubleshoot).cmd' shows details.`n`nTechnical log: $LogFile.err"
    exit 1
}

Log "SetMaster 3 is ready - opening $Url"
Start-Process $Url
exit 0
