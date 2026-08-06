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

# Byte-preserving 1:1 decode, so a path can be substring-searched inside a
# binary without UTF-8 decode errors mangling or dropping bytes (#223).
#
# By code page, NOT [System.Text.Encoding]::Latin1 - that static was added in
# .NET 5, and Windows PowerShell 5.1 (Ry's shell) runs on .NET Framework, where
# it does not exist. GetEncoding(28591) is the same encoding and works on both.
$Latin1 = [System.Text.Encoding]::GetEncoding(28591)

# Case-INSENSITIVE substring test. This matters and is not pedantry: Windows
# paths are case-insensitive, so a .pyc can record the repo root with a
# capitalised drive letter or directory while $RepoRoot reads it lower-case, and
# String.Contains() is ordinal case-SENSITIVE - the leak would sail straight
# through a gate that reported "clean". A fail-open in the one check whose whole
# job is to fail closed.
function Test-NamesPath([string]$haystack, [string]$needle) {
    return $haystack.IndexOf($needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}


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
# --- 3c-bis. strip the build machine out of the payload (#223) ---------------
# A .pyc records the ABSOLUTE path of the source it was compiled from, and that
# path is what appears in every traceback the user ever sees. pip compiles
# bytecode during `pip install`, so every .pyc it just wrote into runtime\python
# carries this machine's profile directory. Purging only backend\ (which is what
# this script used to do) left all of them in place - measured on the macOS
# payload for 3.0.3, 2,945 files named the builder's home directory, and this
# script installs the same way.
Step 'Pre-compiling bytecode with the build path stripped (#223)'
Get-ChildItem -Recurse -Force -Path $payload -Include '__pycache__' -Directory |
    Remove-Item -Recurse -Force
Get-ChildItem -Recurse -Force -Path $payload -Include '*.pyc' -File |
    Remove-Item -Force

# -s/-p, NOT --stripdir/--prependdir: the long forms do not exist and passing
# them fails the whole call. Do not swallow the error - a silent failure here
# ships thousands of absolute build paths to users, which is how #223 happened.
#
# unchecked-hash invalidation makes each .pyc valid regardless of the source
# file's mtime, which copying and archiving do not reliably preserve.
& $PyExe -m compileall -q -f `
    --invalidation-mode unchecked-hash `
    -s $payload -p 'SetMaster3' `
    (Join-Path $runtimeRoot 'python\Lib') `
    (Join-Path $payload 'backend')
if ($LASTEXITCODE -ne 0) { Fail 'bytecode pre-compilation failed - do not ship this build' }
$pycCount = @(Get-ChildItem -Recurse -Force -Path $payload -Include '*.pyc' -File).Count
Write-Host "    $pycCount .pyc files pre-compiled"

# pip writes the build-time interpreter path into every console-script wrapper
# it generates (uvicorn, fastapi, f2py, numpy-config, pip itself). On Windows
# these are .exe launchers with the path embedded in the binary, so unlike the
# macOS text shims they cannot simply have line 1 rewritten.
#
# They are deleted rather than repaired because nothing needs them: the .vbs
# launcher runs `python.exe -m uvicorn`, and every one of these remains reachable
# as `python.exe -m <name>`. A wrapper that only ever leaked is not worth
# carrying.
Step 'Removing console-script wrappers that name the build machine (#223)'
$scriptsDir = Join-Path $runtimeRoot 'python\Scripts'
$removed = 0
if (Test-Path $scriptsDir) {
    foreach ($shim in Get-ChildItem -File -Force -Path $scriptsDir) {
        $bytes = [System.IO.File]::ReadAllBytes($shim.FullName)
        $text  = $Latin1.GetString($bytes)
        if ((Test-NamesPath $text $RepoRoot) -or (Test-NamesPath $text $env:USERPROFILE)) {
            Remove-Item -Force $shim.FullName
            $removed++
        }
    }
}
Write-Host "    removed $removed console-script wrapper(s) that named the build machine"

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

# --- 4. leak scan, last, on the finished payload (#223) ----------------------
# tools\public-mirror\scan.py gates the SOURCE tree and cannot see any of this:
# these paths are injected by the build, not committed. So the artifact needs
# its own gate. On the .dmg path the equivalent scan has already earned itself
# once - it is what caught a compileall call failing silently.
#
# Deliberately the last thing before the zip, so it also covers release-info.json
# and anything else written after the payload was assembled.
#
# Delegated to release\scan_paths.py, which the macOS builder and both smoke
# checks also run. The PowerShell version this replaces could only find a needle
# stored as one contiguous byte run, so a path held as UTF-16 - a PE resource, an
# embedded manifest, a .NET string table, all of which are UTF-16 by definition -
# went straight past it while the gate printed "clean".
#
# Needles go through a FILE, never through argv. Windows PowerShell 5.1 re-quotes
# native-command arguments by wrapping them in double quotes without escaping the
# quotes already inside, and a path ending in a backslash then escapes the
# closing quote. Three separate defects in these two scripts have come out of
# that marshalling layer (#236, #237); a file has no marshalling layer.
Step 'Leak scan of the finished payload (#223)'
$needleFile = Join-Path $env:TEMP ("sm3-needles-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.txt')
$needles = @(@($RepoRoot, $env:USERPROFILE) | Where-Object { $_ })
[System.IO.File]::WriteAllLines($needleFile, [string[]]$needles, [System.Text.UTF8Encoding]::new($false))
$leaks = @(& $PyExe (Join-Path $ReleaseDir 'scan_paths.py') $payload $needleFile)
$scanRc = $LASTEXITCODE
Remove-Item -Force -ErrorAction SilentlyContinue $needleFile
# 0 = clean, 1 = hits. Anything else is the scanner failing, and a failed scanner
# must never read as a clean payload.
if ($scanRc -gt 1) {
    Fail "the leak scanner failed (exit $scanRc). Refusing to vouch for this payload."
}
if ($leaks.Count -gt 0) {
    $leaks | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" }
    if ($leaks.Count -gt 10) { Write-Host "    ... and $($leaks.Count - 10) more" }
    Fail "$($leaks.Count) file(s) in the payload name the build machine. Do not ship this build."
}
Write-Host '    no build-machine paths in the payload (utf-8, utf-16le, utf-16be)'

# --- 5. zip it ---------------------------------------------------------------
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
