# Download llama-mtmd-cli (Vulkan) for BAZA image-to-text (Moondream 2)
# Run from baza_light_v0: npm run download:vlm
# Модель Moondream 2 качается отдельно: npm run download:moondream

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$mtmdDir = Join-Path $root "llama-mtmd"

New-Item -ItemType Directory -Force -Path $mtmdDir | Out-Null

# --- llama.cpp Vulkan (pinned) ---
$tag = "b10679"
$zipName = "llama-$tag-bin-win-vulkan-x64.zip"
$zipUrl = "https://github.com/ggml-org/llama.cpp/releases/download/$tag/$zipName"
$zipPath = Join-Path $env:TEMP $zipName
$extractTmp = Join-Path $env:TEMP "llama-mtmd-extract-$tag"

$needMtmd = -not (Test-Path (Join-Path $mtmdDir "llama-mtmd-cli.exe"))
if ($needMtmd) {
  Write-Host "[download] $zipName"
  Write-Host "  $zipUrl"
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
  if (Test-Path $extractTmp) { Remove-Item -Recurse -Force $extractTmp }
  Expand-Archive -Path $zipPath -DestinationPath $extractTmp -Force

  $cli = Get-ChildItem -Path $extractTmp -Recurse -Filter "llama-mtmd-cli.exe" | Select-Object -First 1
  if (-not $cli) { throw "llama-mtmd-cli.exe not found in zip" }

  $binDir = $cli.Directory.FullName
  # exe + dll рядом
  Copy-Item -Force (Join-Path $binDir "*") -Destination $mtmdDir
  Write-Host "[ok] llama-mtmd-cli -> $mtmdDir"
  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $extractTmp -ErrorAction SilentlyContinue
} else {
  Write-Host "[skip] llama-mtmd-cli.exe already present"
}

Write-Host ""
Write-Host "Done."
Write-Host "  CLI:  $mtmdDir"
Write-Host "Model: npm run download:moondream"
