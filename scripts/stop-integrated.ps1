# Safely stop only the two local R2 development services. This script never
# kills a listener unless both its port and command line match the R2 projects.
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot "integrated-helpers.ps1")

$RepositoryRoot = Split-Path $PSScriptRoot -Parent
$ExperimentProjectPath = Join-Path $RepositoryRoot "experiment-system"
$GameProjectPath = Join-Path $RepositoryRoot "game"

$results = @(Stop-IntegratedServers -ExperimentProjectPath $ExperimentProjectPath -GameProjectPath $GameProjectPath -WhatIf:$DryRun)
foreach ($result in $results) {
    switch ($result.Status) {
        'not-running' { Write-Host "端口 $($result.Port)：未运行。" }
        'would-stop' { Write-Host "端口 $($result.Port)：将停止 R2 服务（PID $($result.ProcessId)）。" -ForegroundColor Yellow }
        'stopped' { Write-Host "端口 $($result.Port)：已停止 R2 服务（PID $($result.ProcessId)）。" -ForegroundColor Green }
        'unknown-process' { Write-Host "端口 $($result.Port)：发现未知占用进程（PID $($result.ProcessId)），为避免误关闭，未处理。" -ForegroundColor Yellow }
        default { Write-Host "端口 $($result.Port)：停止失败（PID $($result.ProcessId)）。" -ForegroundColor Red }
    }
}

if ($DryRun) { Write-Host "这是预演；没有停止任何进程。" }
