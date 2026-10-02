# Qwen3.5 0.8B (Q4_K_M, ~507 MB) — встроенная текстовая модель HC AI
# Run: npm run download:llm
#
# Файл кладём под именем qwen-3.5-0.8b.gguf: именно его ждёт main.cjs
# (dir 'qwen-3.5-0.8b', file 'qwen-3.5-0.8b.gguf').
# Подойдёт любой GGUF с arch=qwen35 и квантованием Q4_K_M — размер может
# отличаться на десяток мегабайт, это нормально.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "node_modules\electron\dist\resources\qwen-3.5-0.8b"
$name = "qwen-3.5-0.8b.gguf"
$url  = "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf"
$minBytes = 400000000

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "Target: $dest"

$out = Join-Path $dest $name
if (Test-Path $out) {
  $len = (Get-Item $out).Length
  if ($len -ge $minBytes) {
    Write-Host ("[skip] {0} ({1} MB)" -f $name, [math]::Round($len / 1MB))
    Write-Host "Next: npm start"
    exit 0
  }
  Write-Host "[resume] $name incomplete, re-downloading"
  Remove-Item $out -Force -ErrorAction SilentlyContinue
}

Write-Host "[download] $name"
Write-Host "  $url"
$tmp = "$out.part"
if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
Move-Item -Force $tmp $out

Write-Host ("  OK {0} MB" -f [math]::Round((Get-Item $out).Length / 1MB))
Write-Host "Next: npm start"
