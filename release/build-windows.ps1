# SetMaster 3 - Windows release builder (#179)
#
# Produces a clean-machine artifact: a zip that needs nothing preinstalled on the
# user's PC (no Python, no Node, no Traktor tooling). Run it from a developer
# checkout on Windows:
#
#     powershell -ExecutionPolicy Bypass -File release\build-windows.ps1
#
# Payload layout - deliberately the layout the launchers already assume, with the
# bundled runtime added beside it:
#
#     SetMaster3-<version>-windows-x64\
#         launchers\          double-click start/stop (what the user runs)
#         backend\app\        FastAPI app
#         backend\pipeline\   ported SM2 pipeline
#         frontend\dist\      built UI, served by the backend
#         runtime\python\     self-contained CPython + locked dependencies
#         release-info.json   version, commit, runtime, build time
#
# Reproducible: the CPython build and every dependency version are pinned
# (release\runtime.json, release\requirements.txt) and the runtime download is
# verified against its published sha256.

[CmdletBinding()]
param(
    # Skip `npm ci` (use the existing node_modules) - faster local rebuilds.
    [switch]$SkipNpmCi,
    # Reuse an already-downloaded runtime tarball from release\.cache.
    [switch]$OfflineRuntime,
    [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$ReleaseDir = $PSScriptRoot
$RepoRoot   = Split-Path -Parent $ReleaseDir
$Target     = 'windows-x64'
$CacheDir   = Join-Path $ReleaseDir '.cache'
if (-not $OutputDir) { $OutputDir = Join-Path $ReleaseDir 'dist' }

function Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail([string]$msg) { throw $msg }

# --- 0. inputs ---------------------------------------------------------------
$versionLine = Select-String -Path (Join-Path $RepoRoot 'backend\app\__init__.py') `
                             -Pattern 'APP_VERSION\s*=\s*"([^"]+)"'
if (-not $versionLine) { Fail "Could not read APP_VERSION from backend\app\__init__.py" }
$Version = $versionLine.Matches[0].Groups[1].Value

$runtimeCfg = Get-Content -Raw (Join-Path $ReleaseDir 'runtime.json') | ConvertFrom-Json
$targetCfg  = $runtimeCfg.targets.$Target
if (-not $targetCfg) { Fail "release\runtime.json has no target '$Target'" }

$commit = try { (& git -C $RepoRoot rev-parse --short HEAD).Trim() } catch { 'unknown' }
$name    = "SetMaster3-$Version-$Target"
$payload = Join-Path $OutputDir $name

Step "SetMaster 3 $Version ($commit) -> $name"

# --- 1. build the UI ---------------------------------------------------------
Step 'Building the UI (frontend\dist)'
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Fail 'npm is required to build the UI. Install Node.js and re-run.'
}
Push-Location (Join-Path $RepoRoot 'frontend')
try {
    if (-not $SkipNpmCi) {
        & npm ci
        if ($LASTEXITCODE -ne 0) { Fail 'npm ci failed' }
    }
    & npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed' }
} finally { Pop-Location }
if (-not (Test-Path (Join-Path $RepoRoot 'frontend\dist\index.html'))) {
    Fail 'frontend\dist\index.html is missing after the build'
}

# --- 2. fetch + verify the self-contained CPython ----------------------------
Step "Fetching CPython $($runtimeCfg.python_version) ($Target)"
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
$tarball = Join-Path $CacheDir $targetCfg.asset
if (-not (Test-Path $tarball)) {
    if ($OfflineRuntime) { Fail "-OfflineRuntime was given but $tarball is not cached" }
    $url = "$($runtimeCfg.base_url)/$($targetCfg.asset)"
    Write-Host "    downloading $url"
    Invoke-WebRequest -Uri $url -OutFile $tarball -UseBasicParsing
}
$actual = (Get-FileHash -Algorithm SHA256 -Path $tarball).Hash.ToLower()
if ($actual -ne $targetCfg.sha256.ToLower()) {
    Fail "Runtime checksum mismatch for $($targetCfg.asset)`n  expected $($targetCfg.sha256)`n  actual   $actual"
}
Write-Host '    sha256 verified'

# --- 3. assemble the payload -------------------------------------------------
Step 'Assembling the payload'
if (Test-Path $payload) { Remove-Item -Recurse -Force $payload }
New-Item -ItemType Directory -Force -Path $payload | Out-Null

# 3a. runtime: extract, then flatten the tarball's top-level "python" dir
$runtimeRoot = Join-Path $payload 'runtime'
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
& tar -xzf $tarball -C $runtimeRoot
if ($LASTEXITCODE -ne 0) { Fail "tar failed to extract $tarball" }
$PyExe  = Join-Path $runtimeRoot 'python\python.exe'
$PyWExe = Join-Path $runtimeRoot 'python\pythonw.exe'
if (-not (Test-Path $PyExe)) { Fail "Extracted runtime has no python.exe at $PyExe" }

# 3b. locked dependencies, installed into the bundled runtime itself
Step 'Installing locked dependencies into the bundled runtime'
& $PyExe -m pip install --no-cache-dir --no-warn-script-location `
    -r (Join-Path $ReleaseDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { Fail 'pip install into the bundled runtime failed' }
& $PyExe -c "import fastapi, uvicorn, pandas, numpy, openpyxl, regex, multipart; print('    runtime imports OK')"
if ($LASTEXITCODE -ne 0) { Fail 'the bundled runtime cannot import the app dependencies' }

# 3c. application code, UI bundle and launchers
Step 'Copying application files'
$copies = @(
    @{ From = 'backend\app';      To = 'backend\app' },
    @{ From = 'backend\pipeline'; To = 'backend\pipeline' },
    @{ From = 'frontend\dist';    To = 'frontend\dist' },
    @{ From = 'launchers';        To = 'launchers' }
)
foreach ($c in $copies) {
    $src = Join-Path $RepoRoot $c.From
    if (-not (Test-Path $src)) { Fail "Missing source path: $src" }
    $dst = Join-Path $payload $c.To
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -Recurse -Force $src $dst
}
# launcher internals a user should not double-click are still needed by the .vbs
Get-ChildItem -Recurse -Force -Path $payload -Include '__pycache__' -Directory |
    Remove-Item -Recurse -Force
Get-ChildItem -Recurse -Force -Path (Join-Path $payload 'backend') -Include '*.pyc' -File |
    Remove-Item -Force

# 3d. provenance
$info = [ordered]@{
    app_version    = $Version
    git_commit     = $commit
    target         = $Target
    python_version = $runtimeCfg.python_version
    pbs_release    = $runtimeCfg.pbs_release
    built_at       = (Get-Date).ToString('o')
    built_on       = "$([System.Environment]::OSVersion.VersionString)"
}
$info | ConvertTo-Json | Set-Content -Path (Join-Path $payload 'release-info.json') -Encoding utf8
Copy-Item (Join-Path $ReleaseDir 'INSTALL-windows.txt') (Join-Path $payload 'READ ME FIRST.txt') -Force

# --- 4. zip it ---------------------------------------------------------------
Step 'Creating the zip'
$zip = Join-Path $OutputDir "$name.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $payload -DestinationPath $zip -CompressionLevel Optimal
$zipHash = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
$sizeMb  = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Write-Host ''
Write-Host "Artifact : $zip" -ForegroundColor Green
Write-Host "Size     : $sizeMb MB"
Write-Host "SHA256   : $zipHash"
Write-Host "Payload  : $payload"
Write-Host ''
Write-Host 'Smoke-test the artifact before releasing it:' -ForegroundColor Yellow
Write-Host "    powershell -ExecutionPolicy Bypass -File release\smoke-windows.ps1 -Zip `"$zip`""
