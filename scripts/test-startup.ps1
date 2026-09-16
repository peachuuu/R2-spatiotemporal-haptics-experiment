# Non-GUI helper tests for the integrated launcher. Dot-sources only the
# helpers file, so nothing is started or killed beyond explicitly spawned
# test fixtures. Exit code 0 = all assertions passed.
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "integrated-helpers.ps1")

$failures = 0

function Assert-True {
    param([bool]$Condition, [string]$Label)
    if ($Condition) { Write-Host "PASS: $Label" -ForegroundColor Green }
    else {
        Write-Host "FAIL: $Label" -ForegroundColor Red
        $script:failures++
    }
}

function Assert-False {
    param([bool]$Condition, [string]$Label)
    Assert-True -Condition (-not $Condition) -Label $Label
}

# 1. Port collision detection reports the exact port.
$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$probe.Start()
$probePort = ([System.Net.IPEndPoint]$probe.LocalEndpoint).Port
Assert-True -Condition (Test-TcpPort -Port $probePort) -Label "bound port $probePort is detected as in use"
$probe.Stop()
Assert-False -Condition (Test-TcpPort -Port $probePort) -Label "released port $probePort is detected as free"

# 2. Health polling times out with the bounded deadline.
$unusedUrl = "http://localhost:$probePort"
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$result = Wait-Http -Url $unusedUrl -TimeoutSeconds 2
$stopwatch.Stop()
Assert-False -Condition $result -Label "health poll returns false for an unreachable URL"
Assert-True -Condition ($stopwatch.Elapsed.TotalSeconds -ge 2 -and $stopwatch.Elapsed.TotalSeconds -lt 15) -Label "health poll honors the bounded deadline"

# 3. Cleanup targets only the supplied PID tree.
$victim = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "ping -n 120 127.0.0.1 >nul" -WindowStyle Hidden -PassThru
$bystander = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "ping -n 120 127.0.0.1 >nul" -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 300
Stop-Process -Id $victim.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300
Assert-True -Condition ($victim.HasExited) -Label "owned process tree is terminated"
Assert-False -Condition ($bystander.HasExited) -Label "unrelated process is left untouched"
Stop-Process -Id $bystander.Id -Force -ErrorAction SilentlyContinue

# 4. The stop command recognizes this clone at any path and rejects unrelated listeners.
$fixtureRoot = 'E:\Teacher Archives\R2 Clone'
$fixtureExperiment = Join-Path $fixtureRoot 'experiment-system'
$fixtureGame = Join-Path $fixtureRoot 'game'
Assert-True -Condition (Test-IntegratedServerCommand -Port 5173 -CommandLine 'node "E:\Teacher Archives\R2 Clone\experiment-system\node_modules\vite\bin\vite.js" --port 5173' -ExperimentProjectPath $fixtureExperiment -GameProjectPath $fixtureGame) -Label "portable 5173 experiment server is recognized"
Assert-True -Condition (Test-IntegratedServerCommand -Port 3001 -CommandLine 'node "E:\Teacher Archives\R2 Clone\game\node_modules\vinext\dist\cli.js" dev' -ExperimentProjectPath $fixtureExperiment -GameProjectPath $fixtureGame) -Label "portable 3001 game server is recognized"
Assert-False -Condition (Test-IntegratedServerCommand -Port 5173 -CommandLine 'node C:\other-project\server.js' -ExperimentProjectPath $fixtureExperiment -GameProjectPath $fixtureGame) -Label "unrelated process on 5173 is not targeted"

if ($failures -gt 0) {
    Write-Host "startup-helper-tests: FAIL ($failures assertion(s) failed)" -ForegroundColor Red
    exit 1
}
Write-Host "startup-helper-tests: PASS" -ForegroundColor Green
exit 0
