# SetMaster 3 - stop script (Windows)
# Called by "Stop SetMaster 3.vbs". Stops the SetMaster 3 server - and nothing
# else. It never kills a process merely for owning the port (#181): the process
# has to prove it is SetMaster 3 first, by
#   1. answering /api/status on the port as SetMaster 3, and
#   2. reporting an instance token that matches the instance.json file inside
#      the app-data dir that same answer names, and
#   3. being (or being the parent of) a process actually listening on the port.
# If ownership cannot be proved, the port owner is reported and left alone.

[CmdletBinding()]
param(
    [switch]$Console,
    [switch]$Quiet   # suppress the pop-up dialogs (used by _reset-test.ps1, which
                     # shows its own); default off, so double-click behaviour is unchanged
)

$ErrorActionPreference = 'Stop'
$Port = if ($env:SM3_PORT) { $env:SM3_PORT } else { '8137' }

function Log([string]$msg) { if ($Console) { Write-Host $msg } }

function Show-Info([string]$msg, [int]$icon = 0x40) {
    Log $msg
    if ($Quiet) { return }
    try {
        $ws = New-Object -ComObject WScript.Shell
        [void]$ws.Popup($msg, 0, 'SetMaster 3', $icon)
    } catch { }
}

function Get-ListenerPids {
    try {
        return @(Get-NetTCPConnection -LocalPort ([int]$Port) -State Listen -ErrorAction Stop |
                 Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        # Fallback for systems without Get-NetTCPConnection: parse netstat.
        return @((netstat -ano | Select-String ":$Port\s" | ForEach-Object {
            ($_ -split '\s+')[-1]
        }) | Sort-Object -Unique | Where-Object { $_ -match '^\d+$' })
    }
}

function Test-LooksLikeSm3Server([int]$procId) {
    # Positive identification from the process itself: our server is always
    # "python -m uvicorn app.main:app". Used only for a SetMaster 3 build older
    # than the instance-token contract (i.e. mid-upgrade), never for an
    # unidentified program.
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
    if (-not $p -or -not $p.CommandLine) { return $false }
    if ($p.Name -notmatch '^pythonw?\.exe$') { return $false }
    return ($p.CommandLine -match 'uvicorn' -and $p.CommandLine -match 'app\.main:app')
}

function Get-OwnedInstance([object[]]$listeners) {
    # Returns the verified instance (pid + data dir) or $null if not provably ours.
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/status" -UseBasicParsing -TimeoutSec 3
    } catch {
        Log "Nothing answered /api/status on port $Port."
        return $null
    }
    if ($r.StatusCode -ne 200) { return $null }

    try { $status = $r.Content | ConvertFrom-Json } catch { return $null }
    if (-not $status.app_version) {
        Log "Something is serving port $Port, but it is not SetMaster 3."
        return $null
    }

    if (-not $status.instance -or -not $status.app_data_dir) {
        # An older SetMaster 3 that predates the instance-token contract: fall
        # back to identifying the server process itself.
        foreach ($listenerPid in $listeners) {
            if (Test-LooksLikeSm3Server ([int]$listenerPid)) {
                Log "Older SetMaster 3 build on port $Port - identified by its server process."
                return [pscustomobject]@{
                    ProcessId = [int]$listenerPid
                    DataDir   = 'unknown (older build)'
                }
            }
        }
        Log "Port $Port is served by something that does not identify itself as SetMaster 3."
        return $null
    }

    # The token must also be on disk in the data dir that answer names: that is
    # what proves the responder owns this machine's SetMaster 3 data.
    $file = Join-Path $status.app_data_dir 'instance.json'
    if (-not (Test-Path $file)) {
        Log "No instance file at $file - cannot prove ownership."
        return $null
    }
    try { $onDisk = Get-Content -Raw -Path $file | ConvertFrom-Json } catch { return $null }
    if (-not $onDisk.token -or $onDisk.token -ne $status.instance.token) {
        Log "Instance token mismatch between /api/status and $file."
        return $null
    }
    return [pscustomobject]@{
        ProcessId = [int]$status.instance.pid
        DataDir   = [string]$status.app_data_dir
    }
}

function Get-RootPythonw([int]$startId) {
    # uvicorn can run as a small tree of pythonw processes (a supervisor plus the
    # listening child). Walk up from a *verified* process to the top-most pythonw
    # ancestor so nothing of ours is left behind. The walk only ever ascends
    # through pythonw.exe, so it cannot wander into an unrelated program.
    $cur = $startId
    while ($true) {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
        if (-not $p) { break }
        $par = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($par -and $par.Name -eq 'pythonw.exe') { $cur = [int]$par.ProcessId } else { break }
    }
    return $cur
}

function Test-InOurTree([int]$rootId, [int]$candidateId) {
    # True when $candidateId is $rootId or one of its descendants.
    $cur = $candidateId
    for ($i = 0; $i -lt 16; $i++) {
        if ($cur -eq $rootId) { return $true }
        $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction SilentlyContinue
        if (-not $p -or -not $p.ParentProcessId) { return $false }
        $cur = [int]$p.ParentProcessId
    }
    return $false
}

# --- 1. is anything listening at all? -----------------------------------------
$listeners = Get-ListenerPids
if ($listeners.Count -eq 0) {
    Show-Info "SetMaster 3 does not appear to be running (nothing is listening on port $Port)."
    exit 0
}

# --- 2. prove the listener is ours before touching it -------------------------
$owned = Get-OwnedInstance $listeners
if (-not $owned) {
    Show-Info ("Another program is using port $Port, so SetMaster 3 was not stopped " +
               "and nothing was closed.`n`nSetMaster 3 could not be found on that port. " +
               "Close the other program yourself, or set a different port, then try again.") 0x10
    exit 1
}

$root = Get-RootPythonw $owned.ProcessId
$listenerIsOurs = $false
foreach ($listenerPid in $listeners) {
    if (Test-InOurTree $root ([int]$listenerPid)) { $listenerIsOurs = $true; break }
}
if (-not $listenerIsOurs) {
    Show-Info ("SetMaster 3 was not stopped: the program listening on port $Port is not " +
               "the SetMaster 3 process that answered, so nothing was closed.") 0x10
    exit 1
}

# --- 3. stop only our proven process tree -------------------------------------
Log "Stopping the SetMaster 3 server (PID $root, data dir $($owned.DataDir))."
& taskkill /PID $root /T /F | Out-Null
if ($LASTEXITCODE -ne 0) { Log "taskkill failed for PID $root" }

Start-Sleep -Milliseconds 500
$still = Get-ListenerPids | Where-Object { Test-InOurTree $root ([int]$_) }

if (@($still).Count -eq 0) {
    Show-Info "SetMaster 3 has been stopped. You can close any open SetMaster 3 browser tabs."
    exit 0
} else {
    Show-Info "SetMaster 3 could not be fully stopped. Open Task Manager and end the 'pythonw' (Python) process, then try again." 0x10
    exit 1
}
