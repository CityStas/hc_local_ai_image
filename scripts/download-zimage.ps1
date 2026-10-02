# Z-Image-Turbo — download 3 files for stable-diffusion.cpp (leejet)
# Run: npm run download:zimage

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "node_modules\electron\dist\resources\z-image-turbo"

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Write-Host "Target: $dest"

$files = @(
  @{
    Name = "ae.safetensors"
    Url  = "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/resolve/main/vae/diffusion_pytorch_model.safetensors"
    MinBytes = 150000000
  },
  @{
    Name = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    Url  = "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
    MinBytes = 2000000000
  },
  @{
    Name = "z_image_turbo-Q4_K.gguf"
    Url  = "https://huggingface.co/leejet/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K.gguf"
    MinBytes = 4000000000
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
  $len = (Get-Item $out).Length
  $gb = [math]::Round($len / 1GB, 2)
  Write-Host "  OK $gb GB"
}

foreach ($f in $files) {
  Download-File $f
}

Write-Host ""
Write-Host "Done. Files in z-image-turbo:"
Get-ChildItem $dest | ForEach-Object {
  $gb = [math]::Round($_.Length / 1GB, 2)
  Write-Host ("  {0}  {1} GB" -f $_.Name, $gb)
}
Write-Host "Next: npm start"
