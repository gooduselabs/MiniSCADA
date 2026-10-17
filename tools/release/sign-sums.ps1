# Ký SHA256SUMS bằng khóa phát hành ECDSA P-256 (feature 011, T097; FR-052, FR-053; contract release-signing §5).
#
#   sign-sums.ps1 -Sums <SHA256SUMS> -Key <khóa riêng PEM> -Keys <thư mục khóa công khai tin cậy> [-Out <SHA256SUMS.sig>]
#                 [-Release]
#
# Ký bằng `openssl dgst -sha256 -sign` (openssl hỏi mật khẩu khóa trên bàn phím; mật khẩu không qua tham số, biến môi
# trường hay log). Không có openssl thì (chỉ chế độ thử) dùng `node tools/release/sums.mjs sign` cho khóa không mã hóa.
# Sau khi ký kiểm lại bằng `mat-update-verify` (-Verifier, nếu có) và luôn bằng bản Node cùng mã thoát (cho keyId của
# khóa công khai kiểm được chữ ký), in keyId; keyId qua cổng gate.mjs pha key.
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

# Kiểm lại: bằng -Verifier (mat-update-verify) nếu có, rồi LUÔN bằng bản Node để biết keyId của khóa công khai kiểm
# được chữ ký (rà soát T062 F3: trước đây có -Verifier thì bỏ qua kiểm khóa thử). keyId và keyId của khóa thử vào cổng
# gate.mjs (pha key): -Release thì khóa thử hoặc không biết keyId là CERT_TEST_KEY.
function Stop-SignSums([string]$Text) {
    Write-MatError $Text
    Remove-Item -LiteralPath $Out -ErrorAction SilentlyContinue
    exit 1
}
if ($Verifier) {
    Invoke-MatNative { & $Verifier $Sums --sig $Out --keys $Keys }
    if ($LASTEXITCODE -ne 0) { Stop-SignSums "sign-sums.ps1: kiểm lại chữ ký bằng $Verifier lỗi (mã $LASTEXITCODE)" }
}
$text = (Invoke-MatNative { & (Get-MatNode) (Join-Path $MatReleaseTools 'sums.mjs') verify $Sums --sig $Out --keys $Keys --json } | Out-String).Trim()
$r = $null
try { $r = $text | ConvertFrom-Json } catch { $r = $null }
if (-not $r -or $r.code -ne 0) {
    $c = if ($r) { $r.code } else { '?' }
    Stop-SignSums "sign-sums.ps1: kiểm lại chữ ký lỗi (mã $c)"
}
$keyId = [string]$r.keyId
if ($keyId) { Write-Host "keyId: $keyId" }
$testIds = Get-MatTestKeyIds  # mảng (hàm trả `, $ids`: không bọc thêm bằng @())
$gate = Invoke-MatGate -Info ([pscustomobject]@{ releaseKey = [pscustomobject]@{ keyId = $keyId }; testKeyIds = $testIds }) -Release:$Release -Phase key
if (-not $gate.ok) {
    foreach ($f in @($gate.failures)) { Write-MatError ("TỪ CHỐI {0}: {1}" -f $f.code, $f.message) }
    Stop-SignSums 'sign-sums.ps1: khóa ký bị cổng từ chối'
}
if ($testIds -contains $keyId) { Write-Host "$MatTestBanner (ký bằng khóa thử)" }
exit 0
