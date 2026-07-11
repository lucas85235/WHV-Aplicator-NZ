# Watchdog: mantem Chrome(debug) + 'npm run live' de pe a noite toda.
# Reinicia o live se morrer OU travar (heartbeat velho). NAO reinicia se estiver
# em estado humano (PAST-GATE/PAYMENT/PAID) - la voce esta no controle.
# Uso: npm run watchdog   (ou powershell -ExecutionPolicy Bypass -File scripts\watchdog.ps1)
$ErrorActionPreference = "Continue"
$root = "C:\Users\lucas\Documents\Projects\WHV-Aplicator"
$statusFile = Join-Path $root "artifacts\status.json"
$liveLog = Join-Path $root "artifacts\live.log"
$wdLog = Join-Path $root "artifacts\watchdog.log"
$staleSec = 300
$humanStates = @("PAST-GATE", "PAYMENT", "PAID")

New-Item -ItemType Directory -Force -Path (Join-Path $root "artifacts") | Out-Null
function WLog($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; $line; Add-Content -Path $wdLog -Value $line }

WLog "watchdog iniciado"
# build 1x
Push-Location $root; & npx tsc 2>&1 | Out-Null; Pop-Location

function CdpUp { try { Invoke-RestMethod "http://127.0.0.1:9222/json/version" -TimeoutSec 3 | Out-Null; return $true } catch { return $false } }
function LiveProc { Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'index\.js live' } }
function StartLive {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'index\.js live' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c node dist\src\index.js live >> `"$liveLog`" 2>&1" -WorkingDirectory $root -WindowStyle Minimized
  WLog "LIVE (re)iniciado"
}

while ($true) {
  # 1) Chrome/CDP de pe?
  if (-not (CdpUp)) {
    WLog "CDP down -> reabrindo Chrome"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $root "scripts\open-chrome.ps1") | Out-Null
    Start-Sleep -Seconds 3
  }

  # 2) estado do live
  $state = "?"; $ageSec = 999999
  if (Test-Path $statusFile) {
    try {
      $st = Get-Content $statusFile -Raw | ConvertFrom-Json
      $state = "$($st.state)"
      $ageSec = [int]((Get-Date).ToUniversalTime() - ([datetime]$st.iso).ToUniversalTime()).TotalSeconds
    } catch { }
  }
  $alive = [bool](LiveProc)

  if ($humanStates -contains $state) {
    WLog "estado=$state (voce no controle) - nao mexo. live_alive=$alive"
  }
  elseif (-not $alive -or $ageSec -gt $staleSec) {
    WLog "PROBLEMA: alive=$alive state=$state age=${ageSec}s -> reiniciando live"
    StartLive
    Start-Sleep -Seconds 6
  }
  else {
    WLog "ok: state=$state age=${ageSec}s alive=$alive"
  }

  Start-Sleep -Seconds 60
}
