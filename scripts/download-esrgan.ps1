# Real-ESRGAN ncnn Vulkan — апскейл изображений ×4
# Run: npm run download:esrgan
#
# 45 MB: exe + все .param/.bin модели. Ставим в
# node_modules/electron/dist/resources/Real-ESRGAN-ncnn-vulkan — оттуда его
# берёт upscaleEngine.cjs. Апскейл необязателен: без него всё остальное
# приложение работает, просто кнопка «Увеличить ×4» не найдёт движок.

$ErrorActionPreference = "Stop"
$root    = Split-Path -Parent $PSScriptRoot
$dest    = Join-Path $root "node_modules\electron\dist\resources\Real-ESRGAN-ncnn-vulkan"
$version = "v0.2.5.0"
$zipName = "realesrgan-ncnn-vulkan-20220424-windows.zip"
$url     = "https://github.com/xinntao/Real-ESRGAN/releases/download/$version/$zipName"
$zipPath = Join-Path $env:TEMP $zipName

if (Test-Path (Join-Path $dest "realesrgan-ncnn-vulkan.exe")) {
  Write-Host "[skip] realesrgan-ncnn-vulkan.exe already present"
  exit 0
}

Write-Host "[download] $zipName (~45 MB)"
Write-Host "  $url"
Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $dest -Force
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

$exe = Get-ChildItem $dest -Recurse -Filter "realesrgan-ncnn-vulkan.exe" | Select-Object -First 1
if (-not $exe) { throw "realesrgan-ncnn-vulkan.exe not found in archive" }

# В архиве всё лежит в подпапке — поднимаем наверх, движок ищет exe и models/ рядом.
$parent = $exe.DirectoryName
if ($parent -ne $dest) {
  Get-ChildItem $parent | Move-Item -Destination $dest -Force
  Remove-Item $parent -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "[ok] Done. Files in Real-ESRGAN-ncnn-vulkan:"
Get-ChildItem $dest | ForEach-Object { Write-Host ("  {0}" -f $_.Name) }
