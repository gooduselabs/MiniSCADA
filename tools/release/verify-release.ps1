# Kiểm lại thư mục phát hành và chạy 12 ca hỏng (feature 011, T094; FR-047, FR-051; contract release-signing §8).
#
#   verify-release.ps1 -Dir release/<ver> [-Keys deployment/keys] [-Thumbprint <sha1>] [-StudioExe <mat-studio.exe>]
#                      [-Verifier <mat-update-verify>] [-AllowMissing installer,...] [-BreakCases] [-OtherKeys <thư mục>]
#                      [-OtherThumbprint <sha1>] [-Release]
#
# Windows: kiểm Authenticode của bộ cài (*-setup.exe) và mat-studio.exe (-StudioExe): toàn vẹn, người ký đúng
# -Thumbprint, có dấu thời gian (chế độ phát hành: trạng thái Valid). -BreakCases chạy ca 1–5 trên bản sao tạm:
# sửa 1 byte bộ cài, sửa 1 byte mat-studio.exe, gỡ chữ ký (signtool remove /s), ký lại bằng chứng chỉ khác
# (-OtherThumbprint, không có thì tạo chứng chỉ tự ký tạm trong Cert:\CurrentUser\My rồi xóa), bỏ dấu thời gian (ký
# lại không /tr; chỉ khi khóa ký dùng được không cần PIN, tức chứng chỉ thử).
# Mọi nơi: tools/release/verify-release.mjs (SHA256SUMS và chữ ký, băm, tệp thừa/thiếu, .sha256, .matupdate, SBOM,
# build-info; ca 6–12). Ngoài Windows phần Authenticode in "BỎ QUA" và không tính là đạt; -Release ngoài Windows bị
# từ chối. Mã thoát: 0 đạt, 1 có lỗi, 2 dùng sai.
param(
    [string]$Dir = '',
    [string]$Keys = '',
    [string]$Thumbprint = '',
    [string]$StudioExe = '',
    [string]$Verifier = '',
    [string]$AllowMissing = '',
    [switch]$BreakCases,
    [string]$OtherKeys = '',
    [string]$OtherThumbprint = '',
    [switch]$Release
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"
. "$PSScriptRoot/lib/signing.ps1"

if (-not $Dir -or -not (Test-Path -LiteralPath $Dir)) { Write-MatError 'verify-release.ps1: cần -Dir <thư mục phát hành>'; exit 2 }
$Dir = (Resolve-Path -LiteralPath $Dir).ProviderPath
if (-not $Keys) { $Keys = Join-Path $MatRepoRoot 'deployment/keys' }
if (-not $Release) { Write-Host $MatTestBanner }
$failed = $false

function Write-Case([int]$Id, [string]$Name, [bool]$Rejected, [string]$Got) {
    $tag = if ($Rejected) { 'từ chối' } else { 'KHÔNG bị từ chối' }
    Write-Host ("ca {0} {1}: {2} → {3}" -f $Id, $tag, $Name, $Got)
}

function Copy-Flip([string]$Src, [string]$Dst) {
    Copy-Item -LiteralPath $Src -Destination $Dst -Force
    $b = [IO.File]::ReadAllBytes($Dst)
    $i = [Math]::Min(4096, [int]($b.Length / 2))
    $b[$i] = $b[$i] -bxor 1
    [IO.File]::WriteAllBytes($Dst, $b)
}

$allowList = @($AllowMissing -split ',' | Where-Object { $_ })
if ($MatIsWindows) {
    $signtool = Find-MatSigntool
    $targets = @(Get-ChildItem -LiteralPath $Dir -Filter '*-setup.exe' | ForEach-Object { $_.FullName })
    if ($StudioExe) { $targets += (Resolve-Path -LiteralPath $StudioExe).ProviderPath }
    foreach ($t in $targets) {
        $s = Get-MatSignatureInfo -Path $t -Signtool $signtool
        $leaf = Split-Path -Leaf $t
        $problems = @()
        if (-not $s.verified) { $problems += "trạng thái $($s.status)" }
        if ($Thumbprint -and $s.cert -and $s.cert.thumbprint -ne $Thumbprint.ToUpperInvariant()) { $problems += "người ký $($s.cert.thumbprint) khác $Thumbprint" }
        if ($Release -and $s.status -ne 'Valid') { $problems += "chế độ phát hành cần Valid, có $($s.status)" }
        if ($Release -and -not $s.timestamped) { $problems += 'NO_TIMESTAMP' }
        if ($problems.Count -gt 0) { Write-MatError ("LỖI Authenticode {0}: {1}" -f $leaf, ($problems -join '; ')); $failed = $true }
        else {
            $who = if ($s.cert) { "$($s.cert.subject) ($($s.cert.thumbprint))" } else { '?' }
            Write-Host ("OK  Authenticode {0}: {1}, dấu thời gian {2}, {3}" -f $leaf, $s.status, $s.timestamped, $who)
        }
    }
    if ($targets.Count -eq 0) {
        if ($Release -or $allowList -notcontains 'installer') { Write-MatError 'LỖI ARTIFACT_MISSING: không có bộ cài *-setup.exe'; $failed = $true }
        else { Write-Host 'BỎ QUA: không có bộ cài để kiểm Authenticode (được phép ở chế độ thử)' }
    }

    if ($BreakCases) {
        $work = Join-Path $MatTemp ('mat-break-ps-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Force -Path $work | Out-Null
        try {
            $setup = $targets | Where-Object { $_ -like '*-setup.exe' } | Select-Object -First 1
            $orig = $null
            if ($setup) { $orig = Get-MatSignatureInfo -Path $setup }
            # Ca 1, 2: sửa 1 byte.
            foreach ($c in @(@(1, 'sửa 1 byte của bộ cài', $setup), @(2, 'sửa 1 byte của mat-studio.exe', $StudioExe))) {
                if (-not $c[2]) { Write-Host ("ca {0} BỎ QUA: {1} (không có tệp)" -f $c[0], $c[1]); continue }
                $p = Join-Path $work ("case{0}.exe" -f $c[0])
                Copy-Flip $c[2] $p
                $st = (Get-AuthenticodeSignature -LiteralPath $p).Status.ToString()
                Write-Case $c[0] $c[1] ($st -eq 'HashMismatch') $st
                if ($st -ne 'HashMismatch') { $failed = $true }
            }
            if ($setup -and $signtool) {
                # Ca 3: gỡ chữ ký.
                $p3 = Join-Path $work 'case3.exe'
                Copy-Item -LiteralPath $setup -Destination $p3
                & $signtool remove /s $p3 | Out-Null
                $st = (Get-AuthenticodeSignature -LiteralPath $p3).Status.ToString()
                Write-Case 3 'gỡ chữ ký của bộ cài' ($st -eq 'NotSigned') $st
                if ($st -ne 'NotSigned') { $failed = $true }
                # Ca 4: ký lại bằng chứng chỉ khác.
                $p4 = Join-Path $work 'case4.exe'
                Copy-Item -LiteralPath $p3 -Destination $p4
                $tmpCert = $null
                $other = $OtherThumbprint
                if (-not $other) {
                    $tmpCert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=mAT SCADA TEST - OTHER (verify-release case 4)' `
                        -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(1)
                    $other = $tmpCert.Thumbprint
                }
                try {
                    & $signtool sign /fd SHA256 /sha1 $other $p4 | Out-Null
                    $s4 = Get-MatSignatureInfo -Path $p4
                    $expect = if ($Thumbprint) { $Thumbprint.ToUpperInvariant() } elseif ($orig -and $orig.cert) { $orig.cert.thumbprint } else { '' }
                    $got = if ($s4.cert) { $s4.cert.thumbprint } else { 'không có' }
                    $rej = ($got -ne $expect)
                    Write-Case 4 'thay chữ ký bằng chữ ký của chứng chỉ khác' $rej ("người ký $got, cần $expect")
                    if (-not $rej) { $failed = $true }
                } finally {
                    if ($tmpCert) { Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $tmpCert.Thumbprint) -ErrorAction SilentlyContinue }
                }
                # Ca 5: bỏ dấu thời gian (ký lại không /tr bằng cùng chứng chỉ; cần khóa không hỏi PIN).
                if ($orig -and $orig.cert -and ($orig.cert.subject -match 'TEST')) {
                    $p5 = Join-Path $work 'case5.exe'
                    Copy-Item -LiteralPath $p3 -Destination $p5
                    & $signtool sign /fd SHA256 /sha1 $orig.cert.thumbprint $p5 | Out-Null
                    $s5 = Get-MatSignatureInfo -Path $p5 -Signtool $signtool
                    Write-Case 5 'bỏ dấu thời gian' (-not $s5.timestamped) ("timestamped = $($s5.timestamped) → NO_TIMESTAMP ở chế độ phát hành")
                    if ($s5.timestamped) { $failed = $true }
                } else {
                    Write-Host 'ca 5 BỎ QUA: bỏ dấu thời gian cần ký lại bằng chứng chỉ thử (chứng chỉ thật nằm trên token, cần PIN)'
                }
            } else {
                foreach ($i in 3, 4, 5) { Write-Host "ca $i BỎ QUA: cần bộ cài và signtool" }
            }
        } finally {
            Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    if ($Release) {
        Write-MatError 'verify-release.ps1 -Release: kiểm Authenticode cần Windows (Get-AuthenticodeSignature, signtool)'
        $failed = $true
    }
    Write-Host 'BỎ QUA: kiểm chữ ký Authenticode của bộ cài và mat-studio.exe chỉ chạy trên Windows'
    if ($BreakCases) {
        foreach ($i in 1..5) { Write-Host "ca $i BỎ QUA: Authenticode chỉ chạy trên Windows" }
    }
    if ($allowList -notcontains 'installer') { $allowList += 'installer' }
}

$a = @((Join-Path $MatReleaseTools 'verify-release.mjs'), '--dir', $Dir, '--keys', $Keys)
if ($Verifier) { $a += @('--verifier', $Verifier) }
if ($Release) { $a += '--release' } elseif ($allowList.Count -gt 0) { $a += @('--allow-missing', ($allowList -join ',')) }
if ($BreakCases) { $a += '--break-cases'; if ($OtherKeys) { $a += @('--other-keys', $OtherKeys) } }
$out = Invoke-MatNative { & (Get-MatNode) @a 2>&1 }
$code = $LASTEXITCODE
foreach ($l in @($out)) { Write-Host ([string]$l) }
if ($code -ne 0) { $failed = $true }

if ($failed) { Write-MatError 'verify-release: KHÔNG ĐẠT'; exit 1 }
Write-Host 'verify-release: đạt'
exit 0
