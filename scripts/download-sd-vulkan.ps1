$ErrorActionPreference = "Stop"

$VERSION  = "master-829-0a565f2"
$ZIP_NAME = "sd-master-0a565f2-bin-win-vulkan-x64.zip"
$URL      = "https://github.com/leejet/stable-diffusion.cpp/releases/download/$VERSION/$ZIP_NAME"
$ROOT     = Split-Path $PSScriptRoot -Parent
$OUTDIR   = Join-Path $ROOT "sd-vulkan"
$ZIPPATH  = Join-Path $ROOT "sd-vulkan-tmp.zip"

Write-Host "[BAZA] Downloading leejet sd.exe Vulkan (~37 MB)..."
Write-Host "[BAZA] URL: $URL"

if (Test-Path $ZIPPATH) { Remove-Item $ZIPPATH -Force }
if (Test-Path $OUTDIR)  { Remove-Item $OUTDIR -Recurse -Force }

Invoke-WebRequest -Uri $URL -OutFile $ZIPPATH -UseBasicParsing

Write-Host "[BAZA] Extracting..."
Expand-Archive -Path $ZIPPATH -DestinationPath $OUTDIR -Force
Remove-Item $ZIPPATH -Force

$sdexe = Get-ChildItem $OUTDIR -Recurse -Filter "sd-cli.exe" | Select-Object -First 1
if ($null -eq $sdexe) {
    Write-Host "[BAZA] ERROR: sd-cli.exe not found. Contents:"
    Get-ChildItem $OUTDIR -Recurse | Select-Object FullName
    exit 1
}

$parent = $sdexe.DirectoryName
if ($parent -ne $OUTDIR) {
    Get-ChildItem $parent | Move-Item -Destination $OUTDIR -Force
    Remove-Item $parent -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "[BAZA] Done! sd-cli.exe path: $OUTDIR\sd-cli.exe"
Write-Host "[BAZA] Run 'npm start' to use Vulkan GPU mode."
