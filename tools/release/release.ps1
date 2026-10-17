# Dựng thư mục phát hành release/<ver>/ (feature 011, T098; FR-047 đến FR-055, SC-017, SC-018; contract release-signing §7).
#
#   release.ps1 [-Release] [-SkipCi] [-Version 1.0.0-rc.3] [-SigningKey <khóa ECDSA riêng>] [-Keys <thư mục khóa công khai>]
#               [-SignMode store|command|test] [-Thumbprint <sha1>] [-Verifier <mat-update-verify>]
#               [-RuntimeBin <mat-runtime armhf>] [-RuntimeTarball <mat-runtime-armhf.tar.gz có sẵn>]
#               [-Skip ci,studio,runtime,update] [-OutDir <thư mục>] [-Force]
#
# Chín bước, dừng ở lỗi đầu tiên (bước 6 chạy sau 7 và 8 để SHA256SUMS phủ cả SBOM, licenses.md, RELEASE-NOTES.md và
# build-info.json):
#   1 cổng điều kiện: cây git sạch, phiên bản đồng nhất (build-info.mjs versions), chứng chỉ ký (sign.ps1 -CheckOnly),
#     khóa phát hành không phải khóa thử, releaseSeq;
#   2 tools/ci-local.ps1;  3 dựng Studio (npm run studio:build, CARGO_TARGET_DIR=<build root>/mat-studio), ký, kiểm;
#   4 gói runtime armhf (deployment/package-runtime.ps1) và .sha256;  5 .matupdate (make-update.mjs, T106/T117);
#   7 sbom.mjs → sbom.cdx.json, license-report.mjs → licenses.md;  8 RELEASE-NOTES.md, build-info.json;
#   6 SHA256SUMS, SHA256SUMS.sig (sign-sums.ps1);  9 verify-release.ps1 (cả 12 ca hỏng).
# Làm trong thư mục tạm <build root>/release-staging/<ver>; chỉ khi mọi bước đạt mới chuyển sang release/<ver>/
# (cổng từ chối thì không tạo release/<ver>/). -Release: không cho -Skip/-SkipCi, cần Windows, chứng chỉ thật, URL dấu
# thời gian, khóa phát hành (-SigningKey, -Keys) và ghi releaseSeq vào release/releaseSeq.txt khi xong.
# Chế độ thử (mặc định): in "BẢN THỬ, KHÔNG PHÁT HÀNH", build-info.json.release = false; bước không chạy được ở máy
# này (Studio ngoài Windows, .matupdate khi chưa có make-update.mjs, ...) in "BỎ QUA: lý do" và ghi vào build-info
# `skipped`, không báo là đạt. Không có -SigningKey thì sinh khóa thử ngoài repo (<build root>/release-test-key).
# Thời gian từng bước ghi ở <build root>/release-staging/<ver>.steps.json.
param(
    [switch]$Release,
    [switch]$SkipCi,
    [string]$Version = '',
    [string]$SigningKey = '',
    [string]$Keys = '',
    [string]$SignMode = '',
    [string]$Thumbprint = '',
    [string]$Verifier = '',
    [string]$RuntimeBin = '',
    [string]$RuntimeTarball = '',
    [string[]]$Skip = @(),
    [string]$OutDir = '',
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"
. "$PSScriptRoot/lib/signing.ps1"

$node = Get-MatNode
$root = $MatRepoRoot
$skipList = @($Skip | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if ($SkipCi) { $skipList += 'ci' }
if (-not $SignMode) { $SignMode = if ($env:MAT_SIGN_MODE) { $env:MAT_SIGN_MODE } else { 'test' } }
$skipped = New-Object System.Collections.Generic.List[string]
$steps = New-Object System.Collections.Generic.List[object]
$t0 = Get-Date

function Stop-Release([string]$Code, [string]$Text) {
    Write-MatError ("TỪ CHỐI {0}: {1}" -f $Code, $Text)
    Write-MatError 'release.ps1: dừng; release/<ver>/ không được tạo'
    exit 1
}
function Invoke-ReleaseStep([string]$Id, [string]$Name, [scriptblock]$Body) {
    Write-Host "`n=== bước $Id. $Name ===" -ForegroundColor Cyan
    $s = Get-Date
    $global:LASTEXITCODE = 0
    $script:stepState = 'ok'
    # Dòng "STATE:<kết quả>" do bước trả về là kết quả của bước; mọi đầu ra khác in ngay.
    & $Body | ForEach-Object {
        if ($_ -is [string] -and $_.StartsWith('STATE:')) { $script:stepState = $_.Substring(6) } else { Write-Host $_ }
    }
    $state = $script:stepState
    $sec = [Math]::Round(((Get-Date) - $s).TotalSeconds, 1)
    $steps.Add([pscustomobject][ordered]@{ step = $Id; name = $Name; result = [string]$state; seconds = $sec })
    Write-Host ("--- bước {0}: {1} ({2} s)" -f $Id, $state, $sec)
}
function Skip-Step([string]$Key, [string]$Reason) {
    if ($Release) { Stop-Release 'SKIP_NOT_ALLOWED' "bước $Key không chạy được: $Reason" }
    Write-Host "BỎ QUA: $Reason"
    $skipped.Add($Key)
    return 'STATE:BỎ QUA'
}

if ($Release) {
    if ($skipList.Count -gt 0) { Stop-Release 'SKIP_NOT_ALLOWED' "-Release không cho bỏ bước ($($skipList -join ','))" }
    if (-not $MatIsWindows) { Stop-Release 'NOT_WINDOWS' 'phát hành cần Windows (signtool, Authenticode, bộ cài NSIS)' }
    if (-not $SigningKey -or -not $Keys) { Stop-Release 'NO_RELEASE_KEY' '-Release cần -SigningKey và -Keys (deployment/keys)' }
} else {
    Write-Host $MatTestBanner -ForegroundColor Yellow
}

# Phiên bản.
$verJson = (Invoke-MatNative { & $node (Join-Path $MatReleaseTools 'build-info.mjs') versions --root $root 2>$null } | Out-String).Trim() | ConvertFrom-Json
if (-not $Version) { $Version = $verJson.version }
$stage = Get-MatBuildDir (Join-Path 'release-staging' $Version)
if (-not $OutDir) { $OutDir = Join-Path $root 'release' }
$final = Join-Path $OutDir $Version
$seqFile = Join-Path $OutDir 'releaseSeq.txt'
if ((Test-Path -LiteralPath $final) -and -not ($Force -and -not $Release)) {
    Stop-Release 'EXISTS' "$final đã có (chế độ thử: -Force để thay)"
}
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$env:MAT_SIGNING_LOG = Join-Path $stage 'signing-log.json'
$env:MAT_SIGN_MODE = $SignMode
$env:MAT_SIGN_RELEASE = $(if ($Release) { '1' } else { '0' })
if ($Thumbprint) { $env:MAT_SIGN_THUMBPRINT = $Thumbprint }
$releaseKeyId = $null
$testKeyDir = $null

Invoke-ReleaseStep 1 'cổng điều kiện' {
    $tree = Get-MatTreeState
    if (-not $tree) { if ($Release) { Stop-Release 'DIRTY_TREE' 'không đọc được git' } else { Write-Host 'CẢNH BÁO: không đọc được git' } }
    elseif ($tree.dirty) {
        if ($Release) { Stop-Release 'DIRTY_TREE' 'cây git có thay đổi chưa commit' }
        Write-Host 'CẢNH BÁO: cây git có thay đổi chưa commit (chế độ thử)'
    }
    $v = (Invoke-MatNative { & $node (Join-Path $MatReleaseTools 'build-info.mjs') versions --root $root --expect $Version 2>$null } | Out-String).Trim() | ConvertFrom-Json
    if (-not $v.consistent) {
        if ($Release) { Stop-Release 'VERSION_MISMATCH' ($v.mismatches -join '; ') }
        foreach ($m in $v.mismatches) { Write-Host "CẢNH BÁO: phiên bản lệch: $m" }
    } else { Write-Host "phiên bản $Version đồng nhất" }
    $script:releaseSeq = [int](& $node (Join-Path $MatReleaseTools 'build-info.mjs') next-seq --file $seqFile | Out-String).Trim()
    Write-Host "releaseSeq: $script:releaseSeq"
    if ($MatIsWindows -and $skipList -notcontains 'studio') {
        $a = @('-File', (Join-Path $MatReleaseTools 'sign.ps1'), '-Mode', $SignMode, '-CheckOnly')
        if ($Release) { $a += '-Release' }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass @a
        if ($LASTEXITCODE -ne 0) { Stop-Release 'CERT' 'sign.ps1 -CheckOnly từ chối chứng chỉ' }
    } elseif (-not $MatIsWindows) {
        Write-Host 'BỎ QUA: kiểm chứng chỉ Authenticode (chỉ Windows)'
    }
    # Khóa phát hành ECDSA.
    if (-not $SigningKey) {
        $script:testKeyDir = Get-MatBuildDir 'release-test-key'
        if (Test-Path -LiteralPath $script:testKeyDir) { Remove-Item -LiteralPath $script:testKeyDir -Recurse -Force }
        $id = (& $node (Join-Path $MatReleaseTools 'sums.mjs') genkey --out-dir $script:testKeyDir --name dryrun | Out-String).Trim()
        $script:SigningKey = Join-Path $script:testKeyDir 'dryrun.key.pem'
        $script:Keys = $script:testKeyDir
        $script:releaseKeyId = $id
        Write-Host "khóa thử sinh tại chỗ (ngoài repo): $script:testKeyDir, keyId $id"
    } else {
        $pubs = @(Get-ChildItem -LiteralPath $Keys -Filter '*.pem')
        if ($pubs.Count -eq 0) { Stop-Release 'NO_RELEASE_KEY' "không có khóa công khai trong $Keys" }
    }
}

Invoke-ReleaseStep 2 'ci-local.ps1' {
    if ($skipList -contains 'ci') { return (Skip-Step 'ci' 'ci-local.ps1 (-SkipCi hoặc -Skip ci)') }
    & (Join-Path $root 'tools/ci-local.ps1')
    if ($LASTEXITCODE -ne 0) { Stop-Release 'CI' "ci-local.ps1 mã $LASTEXITCODE" }
}

Invoke-ReleaseStep 3 'dựng, ký và kiểm Studio' {
    if ($skipList -contains 'studio') { return (Skip-Step 'studio' 'dựng Studio (-Skip studio)') }
    if (-not $MatIsWindows) { return (Skip-Step 'studio' 'bộ cài NSIS và Authenticode chỉ dựng được trên Windows') }
    $env:CARGO_TARGET_DIR = Get-MatBuildDir 'mat-studio'
    Push-Location $root
    try { & npm.cmd run studio:build; $code = $LASTEXITCODE } finally { Pop-Location }
    if ($code -ne 0) { Stop-Release 'STUDIO_BUILD' "npm run studio:build mã $code" }
    $bundle = Join-Path $env:CARGO_TARGET_DIR 'release/bundle/nsis'
    $setup = Get-ChildItem -LiteralPath $bundle -Filter '*-setup.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $setup) { Stop-Release 'STUDIO_BUILD' "không thấy bộ cài trong $bundle" }
    $exe = Join-Path $env:CARGO_TARGET_DIR 'release/mat-studio.exe'
    # Tauri ký qua bundle.windows.signCommand (T093). Chưa cấu hình thì ký bộ cài ở đây (trình gỡ bên trong chưa ký).
    $s = Get-AuthenticodeSignature -LiteralPath $setup.FullName
    if ($s.Status.ToString() -eq 'NotSigned') {
        Write-Host 'CẢNH BÁO: bộ cài chưa ký (chưa có signCommand, T093): ký bộ cài bằng sign.ps1'
        $a = @('-File', (Join-Path $MatReleaseTools 'sign.ps1'), '-Mode', $SignMode, '-Path', $setup.FullName)
        if ($Release) { $a += '-Release' }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass @a
        if ($LASTEXITCODE -ne 0) { Stop-Release 'SIGN' 'sign.ps1 từ chối hoặc lỗi' }
    }
    Copy-Item -LiteralPath $setup.FullName -Destination $stage
    $script:studioExe = $exe
}

Invoke-ReleaseStep 4 'gói runtime armhf' {
    if ($RuntimeTarball) {
        if (-not (Test-Path -LiteralPath $RuntimeTarball)) { Stop-Release 'RUNTIME' "không có $RuntimeTarball" }
        if ($Release) { Stop-Release 'RUNTIME' '-Release dựng gói runtime từ mã nguồn, không nhận -RuntimeTarball' }
        Copy-Item -LiteralPath $RuntimeTarball -Destination (Join-Path $stage 'mat-runtime-armhf.tar.gz')
        $h = Get-MatSha256 (Join-Path $stage 'mat-runtime-armhf.tar.gz')
        [IO.File]::WriteAllText((Join-Path $stage 'mat-runtime-armhf.tar.gz.sha256'), "$h  mat-runtime-armhf.tar.gz`n")
        Write-Host "CẢNH BÁO: dùng gói runtime dựng sẵn $RuntimeTarball (chế độ thử)"
        $skipped.Add('runtime-prebuilt')
        return 'STATE:gói dựng sẵn'
    }
    if ($skipList -contains 'runtime') { return (Skip-Step 'runtime' 'gói runtime (-Skip runtime)') }
    $a = @{}
    if ($RuntimeBin) { $a.Bin = $RuntimeBin }
    & (Join-Path $root 'deployment/package-runtime.ps1') @a
    if ($LASTEXITCODE -ne 0) { Stop-Release 'RUNTIME' "package-runtime.ps1 mã $LASTEXITCODE" }
    Copy-Item -LiteralPath (Join-Path $root 'build/mat-runtime-armhf.tar.gz'), (Join-Path $root 'build/mat-runtime-armhf.tar.gz.sha256') -Destination $stage
}

Invoke-ReleaseStep 5 'gói .matupdate' {
    $mk = Join-Path $MatReleaseTools 'make-update.mjs'
    if ($skipList -contains 'update') { return (Skip-Step 'update' '.matupdate (-Skip update)') }
    if (-not (Test-Path -LiteralPath $mk)) { return (Skip-Step 'update' '.matupdate: chưa có tools/release/make-update.mjs (T106, T117)') }
    $tgz = Join-Path $stage 'mat-runtime-armhf.tar.gz'
    if (-not (Test-Path -LiteralPath $tgz)) { return (Skip-Step 'update' '.matupdate: không có gói runtime') }
    & $node $mk --runtime $tgz --version $Version --release-seq $script:releaseSeq --key $SigningKey --out $stage
    if ($LASTEXITCODE -ne 0) { Stop-Release 'MATUPDATE' "make-update.mjs mã $LASTEXITCODE" }
}

Invoke-ReleaseStep 7 'SBOM và license' {
    & $node (Join-Path $MatReleaseTools 'sbom.mjs') --out (Join-Path $stage 'sbom.cdx.json') --version $Version
    if ($LASTEXITCODE -ne 0) { Stop-Release 'SBOM' "sbom.mjs mã $LASTEXITCODE" }
    & $node (Join-Path $MatReleaseTools 'license-report.mjs') --out (Join-Path $stage 'licenses.md')
    if ($LASTEXITCODE -ne 0) { Stop-Release 'LICENSE' 'license-report.mjs: thành phần bị cấm hoặc không rõ license' }
}

Invoke-ReleaseStep 8 'RELEASE-NOTES.md và build-info.json' {
    $notes = Join-Path $root "docs/release/notes/$Version.md"
    if (Test-Path -LiteralPath $notes) { Copy-Item -LiteralPath $notes -Destination (Join-Path $stage 'RELEASE-NOTES.md') }
    elseif ($Release) { Stop-Release 'NOTES' "thiếu $notes" }
    else {
        [IO.File]::WriteAllText((Join-Path $stage 'RELEASE-NOTES.md'), "# mAT SCADA $Version`n`n$MatTestBanner. Chưa có docs/release/notes/$Version.md.`n", (New-Object System.Text.UTF8Encoding $false))
        Write-Host "CẢNH BÁO: chưa có docs/release/notes/$Version.md, ghi ghi chú giữ chỗ"
    }
    if (-not $script:releaseKeyId) {
        $script:releaseKeyId = (Invoke-MatNative { & $node (Join-Path $MatReleaseTools 'sums.mjs') keyid $SigningKey 2>$null } | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { $script:releaseKeyId = $null }  # khóa có mật khẩu: keyId biết sau khi ký (bước 6)
    }
    $a = @((Join-Path $MatReleaseTools 'build-info.mjs'), 'write', '--root', $root, '--out', (Join-Path $stage 'build-info.json'),
        '--version', $Version, '--release-seq', [string]$script:releaseSeq, '--sign-mode', $SignMode, '--skipped', ($skipped -join ','))
    if ($Release) { $a += '--release' }
    if ($Thumbprint) { $a += @('--thumbprint', $Thumbprint) }
    if ($script:releaseKeyId) { $a += @('--release-key-id', $script:releaseKeyId) }
    $ts = Get-MatTimestampUrls @()
    if ($ts.Count -gt 0) { $a += @('--timestamp-url', $ts[0]) }
    & $node @a
    if ($LASTEXITCODE -ne 0) { Stop-Release 'BUILD_INFO' 'build-info.mjs lỗi' }
}

Invoke-ReleaseStep 6 'SHA256SUMS và chữ ký' {
    & $node (Join-Path $MatReleaseTools 'sums.mjs') make --dir $stage
    if ($LASTEXITCODE -ne 0) { Stop-Release 'SUMS' 'sums.mjs make lỗi' }
    $a = @('-Sums', (Join-Path $stage 'SHA256SUMS'), '-Key', $SigningKey, '-Keys', $Keys)
    if ($Verifier) { $a += @('-Verifier', $Verifier) }
    if ($Release) { $a += '-Release' }
    & (Join-Path $MatReleaseTools 'sign-sums.ps1') @a
    if ($LASTEXITCODE -ne 0) { Stop-Release 'SUMS_SIGN' 'sign-sums.ps1 từ chối hoặc lỗi' }
}

Invoke-ReleaseStep 9 'verify-release.ps1 và 12 ca hỏng' {
    $a = @{ Dir = $stage; Keys = $Keys; BreakCases = $true }
    if ($Verifier) { $a.Verifier = $Verifier }
    if ($Thumbprint) { $a.Thumbprint = $Thumbprint }
    if ($script:studioExe -and (Test-Path -LiteralPath $script:studioExe)) { $a.StudioExe = $script:studioExe }
    if ($Release) { $a.Release = $true }
    else {
        $allow = @()
        if ($skipped -contains 'studio') { $allow += 'installer' }
        if ($skipped -contains 'update') { $allow += 'matupdate' }
        if ($skipped -contains 'runtime') { $allow += @('runtime', 'runtimeSha') }
        if ($allow.Count -gt 0) { $a.AllowMissing = ($allow -join ',') }
    }
    & (Join-Path $MatReleaseTools 'verify-release.ps1') @a
    if ($LASTEXITCODE -ne 0) { Stop-Release 'VERIFY' 'verify-release.ps1 không đạt' }
}

# Chuyển staging sang release/<ver>/.
if (Test-Path -LiteralPath $final) { Remove-Item -LiteralPath $final -Recurse -Force }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
Copy-Item -LiteralPath $stage -Destination $final -Recurse
if ($Release) { [IO.File]::WriteAllText($seqFile, "$script:releaseSeq`n") }
$total = [Math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
$summary = [pscustomobject][ordered]@{
    version = $Version; release = [bool]$Release; releaseSeq = $script:releaseSeq; seconds = $total
    platform = $(if ($MatIsWindows) { 'windows' } else { 'non-windows' }); skipped = @($skipped); steps = @($steps)
    files = @(Get-ChildItem -LiteralPath $final -File | ForEach-Object { [pscustomobject]@{ name = $_.Name; bytes = $_.Length } })
}
$stepsFile = "$stage.steps.json"
[IO.File]::WriteAllText($stepsFile, (ConvertTo-Json -InputObject $summary -Depth 6), (New-Object System.Text.UTF8Encoding $false))
Write-Host "`n=== tóm tắt ==="
foreach ($s in $steps) { Write-Host ("bước {0} {1}: {2} ({3} s)" -f $s.step, $s.name, $s.result, $s.seconds) }
Write-Host "tổng: $total s → $final"
Write-Host "chi tiết: $stepsFile"
if ($skipped.Count -gt 0) { Write-Host ("BỎ QUA: {0} (bản thử chưa đủ 9 mục của FR-052)" -f ($skipped -join ', ')) }
if (-not $Release) { Write-Host $MatTestBanner -ForegroundColor Yellow }
exit 0
