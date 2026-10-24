# Đóng gói mAT OPC DA Bridge thành ZIP (spec 021 T031): exe release, config mẫu, README, SHA256SUMS.
#   package.ps1 [-OutDir C:\build\opcda-dist] [-TargetDir C:\build\opcda-target] [-Sign]
# -Sign: ký Authenticode bằng tools/release/sign.ps1 chế độ test (chứng chỉ thử từ make-test-cert.ps1); không ký thật.
param(
    [string]$OutDir = 'C:\build\opcda-dist',
    [string]$TargetDir = 'C:\build\opcda-target',
    [switch]$Sign
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$env:CARGO_TARGET_DIR = $TargetDir
if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '2' }
Push-Location $root
try { cargo build --release --offline; if ($LASTEXITCODE) { throw 'cargo build failed' } } finally { Pop-Location }
$version = (Select-String -Path "$root/Cargo.toml" -Pattern '^version = "(.+)"').Matches[0].Groups[1].Value
$name = "mat-opcda-bridge-$version-windows-x64"
$stage = Join-Path $OutDir $name
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item "$TargetDir/release/mat-opcda-bridge.exe", "$root/config.example.json", "$root/README.md" $stage
if ($Sign) {
    & pwsh -NoProfile -File "$root/../release/sign.ps1" -Mode test -Path (Join-Path $stage 'mat-opcda-bridge.exe')
    if ($LASTEXITCODE) { throw 'sign failed' }
}
$sums = Get-ChildItem $stage -File | Sort-Object Name | ForEach-Object {
    '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
Set-Content -Path (Join-Path $stage 'SHA256SUMS') -Value $sums -Encoding ascii
$zip = Join-Path $OutDir "$name.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path "$stage/*" -DestinationPath $zip
Write-Host "OK: $zip"
