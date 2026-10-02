# Qwen2.5-VL 7B — модель для режима Vision (понимает фото)
# Run: npm run download:vlm-model   (сначала нужен npm run download:vlm — это CLI)
#
# Два файла, оба обязательны: сама модель (Q4_K_M, ~4.4 GB) и vision-энкодер
# mmproj (Q8_0, ~0.8 GB). Без mmproj картинки не читаются.
# Имена файлов фиксированы — их ждёт vlmEngine.cjs (dir 'Qwen2.5-VL-7B').

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "node_modules\electron\dist\resources\Qwen2.5-VL-7B"
$base = "https://huggingface.co/ggml-org/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "Target: $dest"

$files = @(
  @{
    Name = "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf"
    Url  = "$base/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf"
    MinBytes = 3500000000
  },
  @{
    Name = "mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf"
    Url  = "$base/mmproj-Qwen2.5-VL-7B-Instruct-Q8_0.gguf"
    MinBytes = 600000000
  }
)

function Download-File($item) {
  $out = Join-Path $dest $item.Name
  if (Test-Path $out) {
    $len = (Get-Item $out).Length
    if ($len -ge $item.MinBytes) {
      Write-Host ("[skip] {0} ({1} GB)" -f $item.Name, [math]::Round($len / 1GB, 2))
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
  Write-Host ("  OK {0} GB" -f [math]::Round((Get-Item $out).Length / 1GB, 2))
}

foreach ($f in $files) { Download-File $f }

Write-Host ""
Write-Host "Done. Files in Qwen2.5-VL-7B:"
Get-ChildItem $dest | ForEach-Object {
  Write-Host ("  {0}  {1} GB" -f $_.Name, [math]::Round($_.Length / 1GB, 2))
}
Write-Host "Next: npm start  (режим Vision)"
