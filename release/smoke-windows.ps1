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

# The second gate on the #223 class, run against the EXTRACTED artifact rather
# than the payload directory the builder happened to produce. The builder's own
# scan can only vouch for what it saw; this one vouches for what is actually in
# the zip a user downloads.
# Runs release\scan_paths.py - the same scanner both builders and the macOS
# smoke use, so all five gates agree. It searches raw bytes for the needle in
# UTF-8, UTF-16LE and UTF-16BE: the Latin-1 substring scan this replaces could
# only see one contiguous byte run, and a path held in a PE resource or an
# embedded manifest is UTF-16 by definition.
#
# Needles travel in a FILE, not argv - see the note on the bytecode probe below
# for what PowerShell 5.1 does to native-command arguments.
Step 'Checking the artifact names no build machine (#223)'
$needleFile = Join-Path $WorkDir 'needles.txt'
$needles = @(@($RepoRoot, $env:USERPROFILE) | Where-Object { $_ })
[System.IO.File]::WriteAllLines($needleFile, [string[]]$needles, [System.Text.UTF8Encoding]::new($false))
$leaks = @(& $bundledPy (Join-Path $ReleaseDir 'scan_paths.py') $payload.FullName $needleFile)
$scanRc = $LASTEXITCODE
Remove-Item -Force -ErrorAction SilentlyContinue $needleFile
if ($scanRc -gt 1) { throw "the leak scanner failed (exit $scanRc) - cannot vouch for the artifact" }
if ($leaks.Count -gt 0) {
    $leaks | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" }
    if ($leaks.Count -gt 10) { Write-Host "    ... and $($leaks.Count - 10) more" }
    throw "$($leaks.Count) file(s) in the artifact name the build machine (#223)"
}
Write-Host '    ok  no build-machine paths in the artifact (utf-8, utf-16le, utf-16be)'

# A .pyc that still records an absolute source path defeats the point even if
# the string does not happen to match this machine. Sample the bytecode and
# assert the rewritten "SetMaster3" root is what got recorded.
$pyc = @(Get-ChildItem -Recurse -File -Force `
    -Path (Join-Path $payload.FullName 'runtime\python\Lib') -Include '*.pyc') |
    Select-Object -First 1
if (-not $pyc) { throw 'no pre-compiled bytecode in the runtime - the #223 pre-compile did not run' }
# Literal here-string, and assigned before the call: a closing "@ must be the
# only thing on its line, so it cannot be followed by an argument.
#
# SINGLE quotes inside the Python source, never double. Windows PowerShell 5.1
# re-quotes an argument on its way to a native .exe by wrapping it in double
# quotes WITHOUT escaping the double quotes already inside it, so the CRT parser
# on the far side eats them: `open(sys.argv[1], "rb")` arrives at python.exe as
# `open(sys.argv[1], rb)` and dies with `NameError: name 'rb' is not defined`.
# Python exits 1, and the check below reads that as "the bytecode still names
# the build machine" - a false failure that blocks every Windows release on a
# perfectly clean artifact. Single quotes pass through the re-quoting untouched;
# newlines survive it fine, which is why the here-string itself is safe. This is
# the same convention the dependency-import check above already relies on.
$probe = @'
import sys, marshal
with open(sys.argv[1], 'rb') as fh:
    fh.read(16)
    code = marshal.load(fh)
sys.exit(0 if code.co_filename.startswith('SetMaster3') else 1)
'@
& $bundledPy -c $probe $pyc.FullName
if ($LASTEXITCODE -ne 0) { throw "bytecode still records an absolute build path (#223): $($pyc.Name)" }
Write-Host "    ok  bytecode records a relative root, not the build machine ($($pyc.Name))"

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
