# Đóng gói mat-runtime armhf để triển khai thủ công lên BL335 (Sprint 1, T071).
# -Bin: duong dan mat-runtime armhf neu build o ngoai repo (vi du C:/build/mat-armhf-e2/armhf/bin/mat-runtime).
# Cần trước: ./deployment/toolchain/build.ps1 (armhf) và `npm run build:web` (dist-device).
# Kết quả: build/mat-runtime-armhf.tar.gz gồm bin/, web/, project/, schemas/, deployment/.
# Chặn: fixture SVG, unsafe-elements.svg, trang lab, test (T058). Script/unit được chuẩn hóa LF.
# (Thông báo in ra không dấu: Windows PowerShell 5.1 đọc file .ps1 không BOM theo codepage ANSI.)
param([string]$Project = 'projects/tank-demo', [string]$Bin = '')
$ErrorActionPreference = 'Stop'
$root = Resolve-Path "$PSScriptRoot/.."
$bin = if ($Bin) { $Bin } else { Join-Path $root 'build/armhf/bin/mat-runtime' }
$web = Join-Path $root 'apps/runtime-web/dist-device'
if (-not (Test-Path $bin)) { throw "Missing $bin : run deployment/toolchain/build.ps1" }
if (-not (Test-Path "$web/index.html")) { throw "Missing $web : run npm run build:web" }

$stage = Join-Path $root 'build/pkg'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force "$stage/bin", "$stage/schemas", "$stage/deployment" | Out-Null
Copy-Item $bin "$stage/bin/"
Copy-Item -Recurse $web "$stage/web"
Copy-Item -Recurse (Join-Path $root $Project) "$stage/project"
Copy-Item (Join-Path $root 'schemas/*.json') "$stage/schemas/"
# The frozen 0.1 schemas (feature 006): the validator picks the set by the schemaVersion of project.json.
New-Item -ItemType Directory -Force "$stage/schemas/0.1" | Out-Null
Copy-Item (Join-Path $root 'schemas/0.1/*.json') "$stage/schemas/0.1/"
# The frozen 0.2 schemas and the widget catalog (feature 007): without widgets.catalog.json the runtime
# cannot check a 0.3 project, so the package is not made without it.
New-Item -ItemType Directory -Force "$stage/schemas/0.2" | Out-Null
Copy-Item (Join-Path $root 'schemas/0.2/*.json') "$stage/schemas/0.2/"
# The frozen 0.3 schemas (feature 008): schemas/*.json are the 0.4 ones.
New-Item -ItemType Directory -Force "$stage/schemas/0.3" | Out-Null
Copy-Item (Join-Path $root 'schemas/0.3/*.json') "$stage/schemas/0.3/"
if (-not (Test-Path "$stage/schemas/widgets.catalog.json")) { throw "Missing schemas/widgets.catalog.json" }
if (-not (Test-Path "$stage/web/login.html")) { throw "Missing web/login.html: run npm run build:web" }
Copy-Item (Join-Path $root 'deployment/device/deploy.sh'), (Join-Path $root 'deployment/device/rollback.sh'), `
    (Join-Path $root 'deployment/systemd/mat-runtime.service'), (Join-Path $root 'deployment/config/runtime.json') `
    "$stage/deployment/"
@"
mat-runtime 0.8.0 (Sprint 1 + 003 luu tru du lieu + 005 HTTPS, dang nhap, nap xuong + 006 Tag v1 + 007 man hinh, widget, dieu khien tren Chrome + 008 SVG, gan ket, su kien + 009 alarm ISA-18.2) - built $(Get-Date -Format s)
Huong dan: docs/deployment/mat-runtime.md trong repo.
Rollback: sh /opt/mat-runtime/deployment/rollback.sh
"@ | Set-Content -Encoding ascii "$stage/README-deploy.txt"

# LF cho file văn bản chạy trên Linux
Get-ChildItem -Recurse -File $stage -Include *.sh, *.service, *.json, *.txt | ForEach-Object {
    $t = [IO.File]::ReadAllText($_.FullName)
    [IO.File]::WriteAllText($_.FullName, $t.Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}

$bad = Get-ChildItem -Recurse -File $stage | Where-Object {
    $_.Name -match 'unsafe-elements|^lab[.-]|\.map$|\.test\.' -or $_.FullName -match '[\\/]web[\\/]screens[\\/]'
}
if ($bad) { throw "Package contains forbidden files: $($bad.FullName -join ', ')" }

$out = Join-Path $root 'build/mat-runtime-armhf.tar.gz'
if (Test-Path $out) { Remove-Item $out }
tar -czf $out -C $stage .
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# deploy.sh kiểm SHA-256 trước khi giải nén (định dạng sha256sum, LF)
$hash = (Get-FileHash $out -Algorithm SHA256).Hash.ToLower()
[IO.File]::WriteAllText("$out.sha256", "$hash  mat-runtime-armhf.tar.gz`n")
Get-ChildItem -Recurse -File $stage | ForEach-Object {
    '{0,10}  {1}' -f $_.Length, $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
}
'{0,10}  {1}' -f (Get-Item $out).Length, 'mat-runtime-armhf.tar.gz (total)'
