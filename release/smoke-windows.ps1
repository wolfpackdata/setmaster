# SetMaster 3 - clean-machine smoke check for a Windows release artifact (#179)
#
# Extracts the built zip somewhere neutral and runs the launcher acceptance
# check against THAT payload - not against a developer checkout - proving the
# artifact starts, serves the UI, relaunches idempotently, and stops safely with
# nothing but the zip present.
#
#     powershell -ExecutionPolicy Bypass -File release\smoke-windows.ps1 `
#         -Zip release\dist\SetMaster3-3.0.2-windows-x64.zip
#
# It runs as an isolated test instance (its own port and data dir), so a real
# SetMaster 3 running on the default port is left completely alone.

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Zip,
    [int]$Port = 8139,
    [string]$WorkDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ReleaseDir = $PSScriptRoot
$RepoRoot   = Split-Path -Parent $ReleaseDir

function Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

if (-not (Test-Path $Zip)) { throw "Artifact not found: $Zip" }
if (-not $WorkDir) { $WorkDir = Join-Path $env:TEMP ("sm3-smoke-" + [guid]::NewGuid().ToString('N').Substring(0, 8)) }

Step "Extracting $Zip"
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
Expand-Archive -Path $Zip -DestinationPath $WorkDir -Force

$payload = Get-ChildItem -Directory $WorkDir | Select-Object -First 1
if (-not $payload) { throw "The artifact contained no payload folder" }
$launcherDir = Join-Path $payload.FullName 'launchers'
if (-not (Test-Path (Join-Path $launcherDir 'SetMaster 3.vbs'))) {
    throw "No launchers\SetMaster 3.vbs inside the artifact"
}

# The payload must be self-sufficient: bundled runtime, UI bundle, app code.
Step 'Checking the payload is self-contained'
$required = @(
    'runtime\python\python.exe',
    'runtime\python\pythonw.exe',
    'backend\app\main.py',
    'backend\pipeline',
    'frontend\dist\index.html',
    'release-info.json'
)
foreach ($rel in $required) {
    $p = Join-Path $payload.FullName $rel
    if (-not (Test-Path $p)) { throw "Artifact is incomplete - missing $rel" }
    Write-Host "    ok  $rel"
}
if (Test-Path (Join-Path $payload.FullName 'backend\.venv')) {
    throw "Artifact ships a developer virtualenv (backend\.venv) - it must ship runtime\python instead"
}
$bundledPy = Join-Path $payload.FullName 'runtime\python\python.exe'
& $bundledPy -c "import fastapi, uvicorn, pandas, numpy, openpyxl, regex, multipart; print('    ok  bundled runtime imports every dependency')"
if ($LASTEXITCODE -ne 0) { throw 'the bundled runtime cannot import the app dependencies' }

Step "Running the launcher acceptance check against the artifact (port $Port)"
$dataDir = Join-Path $WorkDir 'appdata'
$env:SM3_LAUNCHER_DIR = $launcherDir
$env:SM3_PORT         = "$Port"
$env:SM3_DATA_DIR     = $dataDir
try {
    Push-Location (Join-Path $RepoRoot 'frontend')
    try {
        & node 'e2e\check-launcher.mjs'
        $checkExit = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    Remove-Item Env:SM3_LAUNCHER_DIR, Env:SM3_PORT, Env:SM3_DATA_DIR -ErrorAction SilentlyContinue
}

Write-Host ''
if ($checkExit -eq 0) {
    Write-Host "ARTIFACT SMOKE CHECK PASSED  ($Zip)" -ForegroundColor Green
    Write-Host "Extracted payload kept at: $($payload.FullName)"
    exit 0
} else {
    Write-Host "ARTIFACT SMOKE CHECK FAILED  ($Zip)" -ForegroundColor Red
    Write-Host "Extracted payload kept for inspection at: $($payload.FullName)"
    exit 1
}
