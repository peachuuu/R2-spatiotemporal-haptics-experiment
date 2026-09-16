# One-command integrated launcher: starts the Spirit Ruins game (3001) and the
# R2 experiment system (5173), waits for both health checks, opens the
# experiment entry, and cleans up only the processes it started.
#
# Optional parameters (used by the integration test loop):
#   -ExperimentProjectPath <dir>   defaults to <repository>\experiment-system
#   -GameProjectPath <dir>         defaults to <repository>\game
#   -NoOpen                        skip opening the browser; after both health
#                                  checks pass, stop both servers and exit
#                                  (smoke-test mode)
param(
    [string]$ExperimentProjectPath = "",
    [string]$GameProjectPath = "",
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
# Console output is UTF-8 (the CMD entry sets chcp 65001); this also keeps
# redirected logs readable instead of falling back to the OEM codepage.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot "integrated-helpers.ps1")

$RepositoryRoot = Split-Path $PSScriptRoot -Parent
if ([string]::IsNullOrWhiteSpace($ExperimentProjectPath)) { $ExperimentProjectPath = Join-Path $RepositoryRoot "experiment-system" }
if ([string]::IsNullOrWhiteSpace($GameProjectPath)) { $GameProjectPath = Join-Path $RepositoryRoot "game" }

$ExperimentUrl = "http://localhost:5173"
$GameUrl = "http://localhost:3001"
$LogDir = Join-Path $RepositoryRoot "logs"
$ExperimentLog = Join-Path $LogDir "experiment.log"
$ExperimentErrLog = Join-Path $LogDir "experiment.err.log"
$GameLog = Join-Path $LogDir "game.log"
$GameErrLog = Join-Path $LogDir "game.err.log"
$HealthTimeoutSeconds = 120

$ownedProcesses = @()

function Fail-And-Cleanup {
    param([string]$Message)
    Write-Host ""
    Write-Host "启动失败：$Message" -ForegroundColor Red
    Write-Host "日志位置：" -ForegroundColor Yellow
    Write-Host "  实验系统: $ExperimentLog / $ExperimentErrLog"
    Write-Host "  游戏系统: $GameLog / $GameErrLog"
    foreach ($ownedPid in $ownedProcesses) { Stop-OwnedProcess -ProcessId $ownedPid }
    exit 1
}

try {
    # 1. Node and project directories.
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Fail-And-Cleanup "未找到 Node.js。请安装 Node.js（>= 22.13.0）并加入 PATH。"
    }
    foreach ($dir in @($ExperimentProjectPath, $GameProjectPath)) {
        if (-not (Test-Path (Join-Path $dir "package.json"))) {
            Fail-And-Cleanup "项目目录不存在或缺少 package.json：$dir"
        }
    }

    # 2. Dependencies; install visibly on first run.
    $projects = @(
        @{ Dir = $ExperimentProjectPath; Name = "实验系统 (experiment-system)" },
        @{ Dir = $GameProjectPath; Name = "游戏系统 (SpiritRuins-Experiment/web)" }
    )
    foreach ($project in $projects) {
        if (-not (Test-Path (Join-Path $project.Dir "node_modules"))) {
            Write-Host "首次运行：正在为 $($project.Name) 安装依赖（npm ci，可能需要几分钟）…"
            Push-Location $project.Dir
            try {
                npm ci
                if ($LASTEXITCODE -ne 0) {
                    Fail-And-Cleanup "$($project.Name) 依赖安装失败（npm ci 退出码 $LASTEXITCODE）。请查看该目录的 npm 日志。"
                }
            }
            finally {
                Pop-Location
            }
        }
    }

    # 3. Port collision detection (before starting anything).
    foreach ($portInfo in @(@{ Port = 5173; Name = "实验系统 5173" }, @{ Port = 3001; Name = "游戏系统 3001" })) {
        if (Test-TcpPort -Port $portInfo.Port) {
            Fail-And-Cleanup "端口 $($portInfo.Port)（$($portInfo.Name)）已被其他进程占用。若是此前启动的 R2 服务，请运行仓库根目录的 stop-experiment.cmd 后重新启动；该命令不会关闭未知进程。"
        }
    }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

    # 4. Start both dev servers hidden; keep exact PIDs for cleanup.
    Write-Host "正在启动实验系统 ($ExperimentUrl) 与游戏系统 ($GameUrl) …"
    $experiment = Start-Process -FilePath "npm.cmd" `
        -ArgumentList "run", "dev", "--", "--port", "5173", "--strictPort" `
        -WorkingDirectory $ExperimentProjectPath -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $ExperimentLog -RedirectStandardError $ExperimentErrLog
    $ownedProcesses += $experiment.Id

    $game = Start-Process -FilePath "npm.cmd" `
        -ArgumentList "run", "dev" `
        -WorkingDirectory $GameProjectPath -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $GameLog -RedirectStandardError $GameErrLog
    $ownedProcesses += $game.Id

    # 5. Health polling with a bounded deadline (no fixed sleeps).
    Write-Host "等待健康检查…"
    $experimentReady = Wait-Http -Url $ExperimentUrl -TimeoutSeconds $HealthTimeoutSeconds
    if (-not $experimentReady) {
        Fail-And-Cleanup "实验系统 $ExperimentUrl 在 $HealthTimeoutSeconds 秒内未就绪。"
    }
    $gameReady = Wait-Http -Url $GameUrl -TimeoutSeconds $HealthTimeoutSeconds
    if (-not $gameReady) {
        Fail-And-Cleanup "游戏系统 $GameUrl 在 $HealthTimeoutSeconds 秒内未就绪。"
    }

    Write-Host "两服务已就绪：" -ForegroundColor Green
    Write-Host "  实验系统: $ExperimentUrl   （被试唯一入口）"
    Write-Host "  游戏系统: $GameUrl   （仅作为 iframe 被嵌入，勿直接打开）"

    if ($NoOpen) {
        # Smoke-test mode: prove both services came up, then clean up quietly.
        Write-Host "无浏览器冒烟启动成功，正在停止两个服务…"
        foreach ($ownedPid in $ownedProcesses) { Stop-OwnedProcess -ProcessId $ownedPid }
        exit 0
    }

    # 6. Open the participant entry point.
    Start-Process $ExperimentUrl
    Write-Host "已打开 $ExperimentUrl。关闭本窗口或按 Ctrl+C 将停止两个服务。"

    # 7. Block until the experiment server exits or the operator interrupts,
    #    then clean up only the processes this script started.
    $experiment.WaitForExit()
    Write-Host "实验系统进程已退出，正在停止游戏服务…"
}
finally {
    foreach ($ownedPid in $ownedProcesses) { Stop-OwnedProcess -ProcessId $ownedPid }
}
