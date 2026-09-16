# Testable helpers for the integrated launcher. Dot-sourced by both
# start-integrated.ps1 and test-startup.ps1; contains no top-level side effects.

function Test-TcpPort {
    param([int]$Port)
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $connect = $client.BeginConnect([System.Net.IPAddress]::Loopback, $Port, $null, $null)
        if (-not $connect.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($connect)
        return $true
    }
    catch {
        return $false
    }
    finally {
        $client.Dispose()
    }
}

function Wait-Http {
    param(
        [string]$Url,
        [int]$TimeoutSeconds
    )
    # Invoke-WebRequest routes through WinINET and can stall on system proxy
    # resolution; HttpClient with proxies disabled polls localhost reliably.
    Add-Type -AssemblyName System.Net.Http
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(3)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = $client.GetAsync($Url).Result
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        }
        catch {
            # Keep polling until the deadline.
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Stop-OwnedProcess {
    param([int]$ProcessId)
    if (-not $ProcessId) { return }
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return }
    # Kill only the process tree rooted at the owned PID; never touch other Node processes.
    # taskkill can write an error record even when the PID has just exited.
    # Keep cleanup best-effort and never let that mask the actual launcher error.
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Test-IntegratedServerCommand {
    param(
        [int]$Port,
        [string]$CommandLine,
        [string]$ExperimentProjectPath,
        [string]$GameProjectPath
    )

    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
    $normalized = $CommandLine.ToLowerInvariant()
    $experimentPath = [System.IO.Path]::GetFullPath($ExperimentProjectPath).TrimEnd('\').ToLowerInvariant()
    $gamePath = [System.IO.Path]::GetFullPath($GameProjectPath).TrimEnd('\').ToLowerInvariant()
    switch ($Port) {
        5173 {
            return $normalized.Contains($experimentPath) -and
                ($normalized.Contains('vite') -or $normalized.Contains('npm.cmd run dev'))
        }
        3001 {
            return $normalized.Contains($gamePath) -and
                ($normalized.Contains('vinext') -or $normalized.Contains('npm.cmd run dev'))
        }
        default { return $false }
    }
}

function Get-IntegratedServerListener {
    param(
        [int]$Port,
        [string]$ExperimentProjectPath,
        [string]$GameProjectPath
    )
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    foreach ($listener in $listeners) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
        if ($null -eq $process) { continue }
        [pscustomobject]@{
            Port        = $Port
            ProcessId   = [int]$listener.OwningProcess
            CommandLine = [string]$process.CommandLine
            IsR2Server  = (Test-IntegratedServerCommand -Port $Port -CommandLine $process.CommandLine -ExperimentProjectPath $ExperimentProjectPath -GameProjectPath $GameProjectPath)
        }
    }
}

function Stop-IntegratedServers {
    param(
        [string]$ExperimentProjectPath,
        [string]$GameProjectPath,
        [switch]$WhatIf
    )
    $results = @()
    foreach ($port in @(5173, 3001)) {
        $listeners = @(Get-IntegratedServerListener -Port $port -ExperimentProjectPath $ExperimentProjectPath -GameProjectPath $GameProjectPath)
        if ($listeners.Count -eq 0) {
            $results += [pscustomobject]@{ Port = $port; Status = 'not-running'; ProcessId = $null; CommandLine = $null }
            continue
        }
        foreach ($listener in $listeners) {
            if (-not $listener.IsR2Server) {
                $results += [pscustomobject]@{ Port = $port; Status = 'unknown-process'; ProcessId = $listener.ProcessId; CommandLine = $listener.CommandLine }
                continue
            }
            if ($WhatIf) {
                $results += [pscustomobject]@{ Port = $port; Status = 'would-stop'; ProcessId = $listener.ProcessId; CommandLine = $listener.CommandLine }
                continue
            }
            $stopped = Stop-OwnedProcess -ProcessId $listener.ProcessId
            $results += [pscustomobject]@{ Port = $port; Status = $(if ($stopped) { 'stopped' } else { 'stop-failed' }); ProcessId = $listener.ProcessId; CommandLine = $listener.CommandLine }
        }
    }
    return $results
}
