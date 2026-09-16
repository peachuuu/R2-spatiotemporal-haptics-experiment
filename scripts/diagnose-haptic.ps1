# Real-device diagnostic for COM5: replays protocol v2 command sequence and logs every reply.
# Usage:
#   Stage 1 (no stimulation, safe):  powershell -File diagnose-haptic.ps1
#   Stage 2 (plays sth.g01.unlock once, glove must be worn):
#                                     powershell -File diagnose-haptic.ps1 -WithStimulation
# Close the R2 experiment page first (COM5 must be free).
param(
  [string]$Port = "COM5",
  [switch]$WithStimulation
)
$ErrorActionPreference = "Stop"

# ---------- protocol v2 ----------
$RSP = @{ 0x81 = "HELLO_ACK"; 0x82 = "STATUS"; 0x83 = "ARMED"; 0x84 = "CALIBRATION_APPLIED"; 0x85 = "CALIBRATION_STARTED"; 0x86 = "PREPARED"; 0x87 = "STARTED"; 0x88 = "COMPLETE"; 0x89 = "STOPPED"; 0x8A = "ERROR" }
$STATE = @{ 0 = "?"; 1 = "SAFE"; 2 = "ARMED_IDLE"; 3 = "PREPARING"; 4 = "PREPARED"; 5 = "SCHEDULED"; 6 = "PLAYING" }

function Get-Crc16([byte[]]$Bytes) {
  [uint32]$crc = 0xffff
  foreach ($b in $Bytes) {
    $crc = $crc -bxor (([uint32]$b) -shl 8)
    for ($i = 0; $i -lt 8; $i++) {
      if (($crc -band 0x8000) -ne 0) { $crc = ((($crc -shl 1) -bxor 0x1021) -band 0xffff) } else { $crc = (($crc -shl 1) -band 0xffff) }
    }
  }
  return [uint16]$crc
}

function New-Frame([byte]$Op, [uint32]$Txn, [byte[]]$Payload) {
  $len = if ($null -eq $Payload) { 0 } else { $Payload.Length }
  $head = New-Object System.Collections.Generic.List[byte]
  foreach ($b in @([byte]0x52, [byte]0x32, [byte]1, $Op)) { $head.Add($b) }
  foreach ($s in @(0, 8, 16, 24)) { $head.Add([byte](($Txn -shr $s) -band 0xff)) }
  $head.Add([byte]($len -band 0xff)); $head.Add([byte](($len -shr 8) -band 0xff))
  if ($len -gt 0) { foreach ($b in $Payload) { $head.Add($b) } }
  $crc = Get-Crc16 $head.ToArray()
  $head.Add([byte]($crc -band 0xff)); $head.Add([byte](($crc -shr 8) -band 0xff))
  return $head.ToArray()
}

function Read-Frames($Port, [int]$WaitMs) {
  $buf = New-Object System.Collections.Generic.List[byte]
  $frames = @()
  $limit = (Get-Date).AddMilliseconds($WaitMs)
  while ((Get-Date) -lt $limit) {
    $n = $Port.BytesToRead
    if ($n -gt 0) {
      for ($i = 0; $i -lt $n; $i++) { $buf.Add([byte]$Port.ReadByte()) }
    }
    while ($buf.Count -ge 12) {
      if ($buf[0] -ne 0x52 -or $buf[1] -ne 0x32) { $buf.RemoveAt(0); continue }
      $plen = [int]$buf[8] -bor ([int]$buf[9] -shl 8)
      $total = 12 + $plen
      if ($buf.Count -lt $total) { break }
      $frame = $buf.GetRange(0, $total).ToArray()
      $crcCalc = Get-Crc16 $frame[0..($total - 3)]
      $crcGot = [uint16]($frame[$total - 2] -bor ([int]$frame[$total - 1] -shl 8))
      if ($crcCalc -ne $crcGot) { $buf.RemoveAt(0); continue }
      $frames += ,$frame
      $buf.RemoveRange(0, $total)
    }
    Start-Sleep -Milliseconds 20
  }
  $rawHex = ($buf | ForEach-Object { $_.ToString("X2") }) -join " "
  Write-Host ("  [raw] {0} bytes: {1}" -f $buf.Count, $rawHex)
  Write-Output -NoEnumerate $frames
}

function Print-Frame([byte[]]$f) {
  $op = [int]$f[3]
  $txn = [BitConverter]::ToUInt32($f, 4)
  $plen = [BitConverter]::ToUInt16($f, 8)
  $pl = @()
  if ($plen -gt 0) { $pl = $f[10..(9 + $plen)] }
  $hex = ($pl | ForEach-Object { $_.ToString("X2") }) -join " "
  $name = if ($RSP.ContainsKey($op)) { $RSP[$op] } else { ("0x{0:X2}" -f $op) }
  $extra = ""
  if ($op -eq 0x81 -and $plen -ge 4) { $extra = "fw v$($pl[0]).$($pl[1]) sampleTable v$($pl[2]) flags=$($pl[3])" }
  elseif ($op -eq 0x82 -and $plen -ge 5) {
    $idLen = [int]$pl[3]; $id = ""
    if ($idLen -gt 0 -and $plen -ge (4 + $idLen)) { $id = [System.Text.Encoding]::ASCII.GetString($pl[4..(3 + $idLen)]) }
    $st = if ($STATE.ContainsKey([int]$pl[0])) { $STATE[[int]$pl[0]] } else { $pl[0] }
    $extra = "state=$st armed=$($pl[1]) voltageCode=$($pl[2]) prepared='$id' fault=$($pl[$plen-1])"
  }
  elseif ($op -eq 0x86 -and $plen -ge 5) {
    $dur = [BitConverter]::ToUInt32($pl, $plen - 4)
    $id = [System.Text.Encoding]::ASCII.GetString($pl[0..($plen - 5)])
    $extra = "sample='$id' duration=${dur}us"
  }
  elseif ($op -eq 0x87 -and $plen -ge 4) { $extra = "deviceStartTick=$([BitConverter]::ToUInt32($pl, 0))" }
  elseif ($op -eq 0x88 -and $plen -ge 5) {
    $dur = [BitConverter]::ToUInt32($pl, $plen - 4)
    $id = [System.Text.Encoding]::ASCII.GetString($pl[0..($plen - 5)])
    $extra = "sample='$id' duration=${dur}us"
  }
  elseif ($op -eq 0x8A -and $plen -ge 1) {
    $msg = if ($plen -gt 1) { [System.Text.Encoding]::ASCII.GetString($pl[1..($plen - 1)]) } else { "" }
    $extra = "errCode=$($pl[0]) msg='$msg'"
  }
  Write-Host ("  <- {0} txn={1} payload[{2}]: {3} {4}" -f $name, $txn, $plen, $hex, $extra)
}

function Send-Cmd($Port, [uint32]$Txn, [byte]$Op, [byte[]]$Payload, [int]$WaitMs, [string]$Label) {
  $f = New-Frame $Op $Txn $Payload
  $Port.Write($f, 0, $f.Length)
  $frames = Read-Frames $Port $WaitMs
  Write-Host ("== {0} (op=0x{1:X2} txn={2}) -> {3} frame(s)" -f $Label, $Op, $Txn, $frames.Count)
  foreach ($fr in $frames) { Print-Frame $fr }
  Write-Output -NoEnumerate $frames
}

# ---------- main ----------
$sp = [System.IO.Ports.SerialPort]::new($Port, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
$sp.DtrEnable = $true; $sp.RtsEnable = $true
$sp.ReadTimeout = 100; $sp.WriteTimeout = 1200
$txn = [uint32]7001
try {
  $sp.Open()
  Start-Sleep -Milliseconds 6000
  Write-Output "--- STAGE 1: handshake and status (no stimulation) ---"
  # 打开 CDC 会复位手套芯片;像浏览器端一样,HELLO 最多重试 3 次。
  $helloOk = $false
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $txn += 1; $frames = Send-Cmd $sp $txn 1 $null 2500 ("HELLO attempt " + $attempt)
    foreach ($fr in $frames) {
      if (($fr -is [byte[]]) -and $fr.Length -ge 4 -and $fr[3] -eq 0x81) { $helloOk = $true }
    }
    if ($helloOk) { break }
    Start-Sleep -Milliseconds 800
  }
  if (-not $helloOk) { Write-Output "HANDSHAKE FAILED: no HELLO_ACK after 3 attempts" }
  $txn += 1; Send-Cmd $sp $txn 2 $null 2000 "GET_STATUS" | Out-Null
  $txn += 1; Send-Cmd $sp $txn 3 $null 3000 "ARM" | Out-Null
  $txn += 1; Send-Cmd $sp $txn 2 $null 2000 "GET_STATUS after ARM" | Out-Null
  $txn += 1; Send-Cmd $sp $txn 4 @([byte]0, [byte]100) 2000 "SET_CALIBRATION(region0, level100, store only)" | Out-Null
  $txn += 1; Send-Cmd $sp $txn 2 $null 2000 "GET_STATUS after set" | Out-Null

  if ($WithStimulation) {
    Write-Output "--- STAGE 2: sample playback (real discharge!) ---"
    $id = [System.Text.Encoding]::ASCII.GetBytes("sth.g01.unlock")
    $txn += 1; Send-Cmd $sp $txn 6 $id 3000 "PREPARE sth.g01.unlock" | Out-Null
    $txn += 1; Send-Cmd $sp $txn 2 $null 2000 "GET_STATUS after PREPARE" | Out-Null
    $d = @([byte]0xF4, [byte]0x01, [byte]0, [byte]0)  # 500ms little-endian
    $txn += 1; Send-Cmd $sp $txn 7 $d 3500 "COMMIT_AFTER(500ms) [DISCHARGE]" | Out-Null
    $txn += 1; Send-Cmd $sp $txn 2 $null 2000 "GET_STATUS after playback" | Out-Null
  }

  $txn += 1; Send-Cmd $sp $txn 8 $null 2000 "STOP (safe off)" | Out-Null
  $txn += 1; Send-Cmd $sp $txn 2 $null 2000 "GET_STATUS after STOP (voltageCode should persist)" | Out-Null
  Write-Output "=== DIAG DONE ==="
}
catch { Write-Output "COM5_DIAG_ERROR: $($_.Exception.Message)" }
finally { if ($sp.IsOpen) { $sp.Close() }; $sp.Dispose() }
