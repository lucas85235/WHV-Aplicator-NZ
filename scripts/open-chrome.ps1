# Abre um Chrome dedicado com debugging (porta 9222) pro bot anexar via CDP.
# Uso:  npm run open   (ou)   powershell -ExecutionPolicy Bypass -File scripts\open-chrome.ps1
$ErrorActionPreference = "Stop"

$port       = 9222
$profileDir = "C:\Users\lucas\whv-chrome"
$loginUrl   = "https://online.immi.gov.au/lusc/login"

# 1) achar o chrome.exe
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Write-Host "Chrome nao encontrado." -ForegroundColor Red; exit 1 }
Write-Host "Chrome: $chrome" -ForegroundColor DarkGray

# 2) ja tem algo escutando na porta?
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($listening) {
  Write-Host "Porta $port ja em uso - reaproveitando a sessao existente." -ForegroundColor Yellow
} else {
  New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
  Write-Host "Abrindo Chrome com debugging na porta $port..." -ForegroundColor Cyan
  Start-Process -FilePath $chrome -ArgumentList @(
    "--remote-debugging-port=$port",
    "--user-data-dir=$profileDir",
    "--no-first-run",
    "--no-default-browser-check",
    $loginUrl
  )
}

# 3) esperar o endpoint CDP responder
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2
    Write-Host ""
    Write-Host "OK! CDP ativo -> $($r.Browser)" -ForegroundColor Green
    $ok = $true
    break
  } catch { }
}
if (-not $ok) {
  Write-Host "Chrome abriu mas o CDP nao respondeu na porta $port." -ForegroundColor Red
  Write-Host "Feche TODAS as janelas do Chrome e rode de novo." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "AGORA faca LOGIN manual no ImmiAccount nesse Chrome." -ForegroundColor White
Write-Host "Depois, em outra janela do terminal, rode:  npm run rehearsal" -ForegroundColor White
