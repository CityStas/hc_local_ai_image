# Moondream 2 GGUF (F16, ~3.7 GB) — ggml-org/moondream2-20250414-GGUF
# Run: npm run download:moondream
# Требует также: npm run download:vlm  (llama-mtmd-cli)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "node_modules\electron\dist\resources\moondream2"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "Target: $dest"
Write-Host "NOTE: Q4_K_M для Moondream2 в публичных HF-репо нет. Только F16 (~3.7 GB)."
Write-Host "bartowski/moondream2-GGUF мёртв (401). Используем ggml-org."

$files = @(
  @{
    Name = "moondream2-text-model-f16_ct-vicuna.gguf"
    Url  = "https://huggingface.co/ggml-org/moondream2-20250414-GGUF/resolve/main/moondream2-text-model-f16_ct-vicuna.gguf"
    MinBytes = 2500000000
  },
  @{
    Name = "moondream2-mmproj-f16-20250414.gguf"
    Url  = "https://huggingface.co/ggml-org/moondream2-20250414-GGUF/resolve/main/moondream2-mmproj-f16-20250414.gguf"
    MinBytes = 800000000
  }
)

function Download-File($item) {
  $out = Join-Path $dest $item.Name
  if (Test-Path $out) {
    $len = (Get-Item $out).Length
    if ($len -ge $item.MinBytes) {
      $gb = [math]::Round($len / 1GB, 2)
      Write-Host "[skip] $($item.Name) ($gb GB)"
      return
    }
    Write-Host "[resume] $($item.Name) incomplete, re-downloading"
    Remove-Item $out -Force -ErrorAction SilentlyContinue
  }
  Write-Host "[download] $($item.Name)"
  Write-Host "  $($item.Url)"
  $tmp = "$out.part"
  if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  Invoke-WebRequest -Uri $item.Url -OutFile $tmp -UseBasicParsing
  Move-Item -Force $tmp $out
  $gb = [math]::Round((Get-Item $out).Length / 1GB, 2)
  Write-Host "  OK $gb GB"
}

foreach ($f in $files) { Download-File $f }

Write-Host ""
Write-Host "Done. Moondream2 files:"
Get-ChildItem $dest | ForEach-Object {
  $gb = [math]::Round($_.Length / 1GB, 2)
  Write-Host ("  {0}  {1} GB" -f $_.Name, $gb)
}
Write-Host "Next: npm start  (выбери модель moondream2 в Vision)"
