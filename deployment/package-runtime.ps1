# Đóng gói mat-runtime armhf để triển khai thủ công lên BL335 (Sprint 1, T071).
# -Bin: duong dan mat-runtime armhf neu build o ngoai repo (vi du C:/build/mat-armhf-e2/armhf/bin/mat-runtime).
# Cần trước: ./deployment/toolchain/build.ps1 (armhf) và `npm run build:web` (dist-device).
# Kết quả: build/mat-runtime-armhf.tar.gz gồm bin/, web/, project/, schemas/, deployment/.
# Chặn: fixture SVG, unsafe-elements.svg, trang lab, test (T058). Script/unit được chuẩn hóa LF.
# Feature 011 (T100, T115, T117): build-info.json (version, releaseSeq, arch, commit), updater/ (mat-update-verify,
# mat-updater, mat-updater-recover: chỉ cài bằng deploy.sh, không bao giờ qua OTA), ba unit của mat-updater,
# deployment/keys/*.pub.pem (khóa công khai phát hành, nếu có), deployment/mat-sample.sh (T070).
# -VerifyBin: mat-update-verify armhf (mặc định cạnh -Bin); -ReleaseSeq: số thứ tự phát hành (đơn điệu, D36).
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param([string]$Project = 'projects/tank-demo', [string]$Bin = '', [string]$VerifyBin = '', [int]$ReleaseSeq = 1,
    [string]$Arch = 'armhf')
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/.."
$bin = if ($Bin) { $Bin } else { Join-Path $root 'build/armhf/bin/mat-runtime' }
$web = Join-Path $root 'apps/runtime-web/dist-device'
if (-not (Test-Path $bin)) { throw "Missing $bin : run deployment/toolchain/build.ps1" }
$verify = if ($VerifyBin) { $VerifyBin } else { Join-Path (Split-Path $bin) 'mat-update-verify' }
if (-not (Test-Path $verify)) { throw "Missing $verify : build the target mat-update-verify" }
if ($ReleaseSeq -lt 1) { throw "-ReleaseSeq must be >= 1" }
if (-not (Test-Path "$web/index.html")) { throw "Missing $web : run npm run build:web" }

$stage = Join-Path $root 'build/pkg'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force "$stage/bin", "$stage/schemas", "$stage/deployment" | Out-Null
Copy-Item $bin "$stage/bin/"
Copy-Item -Recurse $web "$stage/web"
Copy-Item -Recurse (Join-Path $root $Project) "$stage/project"
Copy-Item (Join-Path $root 'schemas/*.json') "$stage/schemas/"
# The frozen schema sets, one folder per format (0.1 … 0.6, and the frozen copy of 1.0; the root schemas/*.json are
# the current 1.0 set). The validator picks the set by the schemaVersion of project.json, so every folder ships:
# copying a fixed list once left 0.6 out after the root moved to 1.0 (T079 on the BL335: every 0.6 project got
# E_SCHEMA). widgets.catalog.json is required: without it the runtime cannot check a 0.3+ project.
$schemaSets = @(Get-ChildItem -Directory (Join-Path $root 'schemas') | Where-Object { $_.Name -match '^\d+\.\d+$' })
foreach ($v in '0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '1.0') {
    if (-not ($schemaSets.Name -contains $v)) { throw "Missing schemas/$v" }
}
foreach ($d in $schemaSets) {
    New-Item -ItemType Directory -Force "$stage/schemas/$($d.Name)" | Out-Null
    Copy-Item (Join-Path $d.FullName '*.json') "$stage/schemas/$($d.Name)/"
}
if (-not (Test-Path "$stage/schemas/widgets.catalog.json")) { throw "Missing schemas/widgets.catalog.json" }
if (-not (Test-Path "$stage/web/login.html")) { throw "Missing web/login.html: run npm run build:web" }
Copy-Item (Join-Path $root 'deployment/device/deploy.sh'), (Join-Path $root 'deployment/device/rollback.sh'), `
    (Join-Path $root 'deployment/systemd/mat-runtime.service'), (Join-Path $root 'deployment/config/runtime.json'), `
    (Join-Path $root 'deployment/systemd/mat-updater.service'), (Join-Path $root 'deployment/systemd/mat-updater.path'), `
    (Join-Path $root 'deployment/systemd/mat-updater-recover.service'), (Join-Path $root 'deployment/device/mat-sample.sh') `
    "$stage/deployment/"
# OTA (feature 011): the root side, installed only by deploy.sh
New-Item -ItemType Directory -Force "$stage/updater" | Out-Null
Copy-Item $verify "$stage/updater/mat-update-verify"
Copy-Item (Join-Path $root 'deployment/device/mat-updater.sh') "$stage/updater/mat-updater"
Copy-Item (Join-Path $root 'deployment/device/mat-updater-recover.sh') "$stage/updater/mat-updater-recover"
$keys = Join-Path $root 'deployment/keys'
if (Test-Path $keys) {
    $pub = Get-ChildItem -File $keys -Filter '*.pub.pem'
    if ($pub) {
        New-Item -ItemType Directory -Force "$stage/deployment/keys" | Out-Null
        $pub | Copy-Item -Destination "$stage/deployment/keys/"
    }
}
# build-info.json: what the runtime and mat-updater read (version, releaseSeq: no downgrade, D36)
$version = (Select-String -Path (Join-Path $root 'core/project-manager/project_validator.hpp') `
        -Pattern 'kRuntimeVersion = "([^"]+)"').Matches[0].Groups[1].Value
$commit = ''
try { $commit = (git -C $root rev-parse HEAD 2>$null) } catch { $commit = '' }
[ordered]@{ version = $version; releaseSeq = $ReleaseSeq; arch = $Arch; commit = "$commit"; builtAt = (Get-Date).ToUniversalTime().ToString('s') + 'Z'; release = $false } |
    ConvertTo-Json | Set-Content -Encoding ascii "$stage/build-info.json"
@"
mat-runtime 1.0.0 (Sprint 1 + 003 luu tru du lieu + 005 HTTPS, dang nhap, nap xuong + 006 Tag v1 + 007 man hinh, widget, dieu khien tren Chrome + 008 SVG, gan ket, su kien + 009 alarm ISA-18.2 + 010 lich su, bao cao + 011 bao mat, logic v2, faceplate, chan doan) - built $(Get-Date -Format s)
Huong dan: docs/deployment/mat-runtime.md trong repo.
Rollback: sh /opt/mat-runtime/deployment/rollback.sh
"@ | Set-Content -Encoding ascii "$stage/README-deploy.txt"

# LF cho file văn bản chạy trên Linux
Get-ChildItem -Recurse -File $stage -Include *.sh, *.service, *.path, *.json, *.txt, mat-updater, mat-updater-recover | ForEach-Object {
    $t = [IO.File]::ReadAllText($_.FullName)
    [IO.File]::WriteAllText($_.FullName, $t.Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}

$bad = Get-ChildItem -Recurse -File $stage | Where-Object {
    $_.Name -match 'unsafe-elements|^lab[.-]|\.map$|\.test\.' -or $_.FullName -match '[\\/]web[\\/]screens[\\/]'
}
if ($bad) { throw "Package contains forbidden files: $($bad.FullName -join ', ')" }

$out = Join-Path $root 'build/mat-runtime-armhf.tar.gz'
if (Test-Path $out) { Remove-Item $out }
# Entries owned by root and without macOS metadata: bsdtar of macOS otherwise adds ._* AppleDouble entries and
# xattrs (com.apple.provenance), and the root tar -x on the BL335 would keep the uid of the dev account.
$tarArgs = @()
if ($env:OS -ne 'Windows_NT') {
    if ((tar --version | Out-String) -match 'bsdtar') {
        $env:COPYFILE_DISABLE = '1'
        $tarArgs = @('--no-xattrs', '--no-mac-metadata', '--uid', '0', '--gid', '0', '--uname', 'root', '--gname', 'root')
    } else {
        $tarArgs = @('--owner=0', '--group=0', '--numeric-owner')
    }
}
tar @tarArgs -czf $out -C $stage .
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# deploy.sh kiểm SHA-256 trước khi giải nén (định dạng sha256sum, LF)
$hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText("$out.sha256", "$hash  mat-runtime-armhf.tar.gz`n")
Get-ChildItem -Recurse -File $stage | ForEach-Object {
    '{0,10}  {1}' -f $_.Length, $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
}
'{0,10}  {1}' -f (Get-Item $out).Length, 'mat-runtime-armhf.tar.gz (total)'
