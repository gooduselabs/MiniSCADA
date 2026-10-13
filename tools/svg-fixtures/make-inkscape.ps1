# Sinh 4 fixture Inkscape THẬT (feature 008, T033): chạy Inkscape CLI trên bản vẽ nguồn
# tools/svg-fixtures/src/inkscape-NN-*.src.svg, ghi:
#   tests/fixtures/svg-import/inkscape-NN-*.svg      (Inkscape SVG do Inkscape xuất)
#   tests/fixtures/svg-import/inkscape-NN-*.ref.png  (PNG tham chiếu 1200 x 800 do Inkscape xuất)
#   tests/fixtures/svg-import/inkscape-version.txt   (phiên bản thật, manifest.json chép từ đây)
# Không giả file: nếu Inkscape không chạy được thì dừng với lỗi.
param(
  # inkscape.com là bản console (đợi xong mới trả); inkscape.exe là bản GUI, trả ngay khi còn đang ghi file.
  [string]$Inkscape = 'C:\Program Files\Inkscape\bin\inkscape.com'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$src = Join-Path $PSScriptRoot 'src'
$dst = Join-Path $root 'tests\fixtures\svg-import'
if (-not (Test-Path $Inkscape)) { throw "Không tìm thấy Inkscape tại $Inkscape" }
New-Item -ItemType Directory -Force $dst | Out-Null

$version = (& $Inkscape --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or -not $version.StartsWith('Inkscape')) { throw "Inkscape không chạy được: $version" }
[IO.File]::WriteAllText((Join-Path $dst 'inkscape-version.txt'), $version + "`n", (New-Object Text.UTF8Encoding $false))
Write-Host "Phiên bản: $version"

foreach ($f in Get-ChildItem $src -Filter 'inkscape-*.src.svg' | Sort-Object Name) {
  $name = $f.Name.Replace('.src.svg', '')
  $outSvg = Join-Path $dst "$name.svg"
  $outPng = Join-Path $dst "$name.ref.png"
  & $Inkscape $f.FullName --export-type=svg --export-filename=$outSvg
  if ($LASTEXITCODE -ne 0) { throw "Xuất SVG lỗi: $name" }
  # PNG tham chiếu: nền trắng, cỡ 1200 x 800
  & $Inkscape $f.FullName --export-type=png --export-filename=$outPng -w 1200 -h 800 --export-background=white --export-background-opacity=1
  if ($LASTEXITCODE -ne 0) { throw "Xuất PNG lỗi: $name" }
  Write-Host "OK $name"
}
