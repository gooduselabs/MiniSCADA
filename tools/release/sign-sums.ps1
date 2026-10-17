# Ký SHA256SUMS bằng khóa phát hành ECDSA P-256 (feature 011, T097; FR-052, FR-053; contract release-signing §5).
#
#   sign-sums.ps1 -Sums <SHA256SUMS> -Key <khóa riêng PEM> -Keys <thư mục khóa công khai tin cậy> [-Out <SHA256SUMS.sig>]
#                 [-Release]
#
# Ký bằng `openssl dgst -sha256 -sign` (openssl hỏi mật khẩu khóa trên bàn phím; mật khẩu không qua tham số, biến môi
# trường hay log). Không có openssl thì (chỉ chế độ thử) dùng `node tools/release/sums.mjs sign` cho khóa không mã hóa.
# Sau khi ký kiểm lại bằng `mat-update-verify` (-Verifier) hoặc bản Node cùng mã thoát, in keyId của khóa đã ký.
# -Release: từ chối khóa nằm trong repo và khóa thử (keyId của tests/update-vectors/keys/*.pem): CERT_TEST_KEY.
# Mã thoát: 0 xong, 1 từ chối hoặc kiểm lại lỗi, 2 dùng sai.
param(
    [string]$Sums = '',
    [string]$Key = '',
    [string]$Keys = '',
    [string]$Out = '',
    [string]$Verifier = '',
    [switch]$Release
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"
. "$PSScriptRoot/lib/signing.ps1"

if (-not $Sums -or -not (Test-Path -LiteralPath $Sums)) { Write-MatError 'sign-sums.ps1: cần -Sums <SHA256SUMS>'; exit 2 }
if (-not $Key -or -not (Test-Path -LiteralPath $Key)) { Write-MatError 'sign-sums.ps1: cần -Key <khóa riêng PEM>'; exit 2 }
if (-not $Keys -or -not (Test-Path -LiteralPath $Keys)) { Write-MatError 'sign-sums.ps1: cần -Keys <thư mục khóa công khai>'; exit 2 }
if (-not $Out) { $Out = "$Sums.sig" }
$keyFull = [IO.Path]::GetFullPath($Key)
$repoPrefix = [IO.Path]::GetFullPath($MatRepoRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if ($Release -and $keyFull.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Write-MatError "TỪ CHỐI CERT_TEST_KEY: khóa phát hành nằm trong repo ($keyFull)"
    exit 1
}

$openssl = if ($env:MAT_OPENSSL) { $env:MAT_OPENSSL } else { 'openssl' }
$hasOpenssl = [bool](Get-Command $openssl -ErrorAction SilentlyContinue)
if (-not $hasOpenssl -and $MatIsWindows -and (Test-Path -LiteralPath 'C:\Program Files\Git\usr\bin\openssl.exe')) {
    $openssl = 'C:\Program Files\Git\usr\bin\openssl.exe'; $hasOpenssl = $true
}
if ($hasOpenssl) {
    & $openssl dgst -sha256 -sign $Key -out $Out $Sums
    if ($LASTEXITCODE -ne 0) { Write-MatError 'sign-sums.ps1: openssl dgst -sign lỗi'; exit 1 }
    Write-Host "đã ký bằng openssl: $Out"
} elseif (-not $Release) {
    & (Get-MatNode) (Join-Path $MatReleaseTools 'sums.mjs') sign --key $Key --in $Sums --out $Out
    if ($LASTEXITCODE -ne 0) { Write-MatError 'sign-sums.ps1: ký bằng Node lỗi'; exit 1 }
} else {
    Write-MatError 'sign-sums.ps1 -Release: cần openssl'
    exit 2
}

# Kiểm lại.
if ($Verifier) {
    & $Verifier $Sums --sig $Out --keys $Keys
    $code = $LASTEXITCODE
    $keyId = ''
} else {
    $r = (& (Get-MatNode) (Join-Path $MatReleaseTools 'sums.mjs') verify $Sums --sig $Out --keys $Keys --json | Out-String).Trim() | ConvertFrom-Json
    $code = $r.code
    $keyId = $r.keyId
}
if ($code -ne 0) { Write-MatError "sign-sums.ps1: kiểm lại chữ ký lỗi (mã $code)"; Remove-Item -LiteralPath $Out -ErrorAction SilentlyContinue; exit 1 }
if ($keyId) {
    Write-Host "keyId: $keyId"
    if ((Get-MatTestKeyIds) -contains $keyId) {
        if ($Release) {
            Remove-Item -LiteralPath $Out -ErrorAction SilentlyContinue
            Write-MatError "TỪ CHỐI CERT_TEST_KEY: $keyId là khóa thử (tests/update-vectors/keys/)"
            exit 1
        }
        Write-Host "$MatTestBanner (ký bằng khóa thử)"
    }
}
exit 0
