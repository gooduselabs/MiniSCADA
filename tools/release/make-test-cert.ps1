# Tạo và gỡ chứng chỉ ký mã THỬ (feature 011, T091; FR-050; contract release-signing §3).
#
#   make-test-cert.ps1 [-Json]     tạo (hoặc dùng lại nếu còn hạn > 7 ngày) chứng chỉ thử trong Cert:\CurrentUser\My
#   make-test-cert.ps1 -Remove     gỡ mọi chứng chỉ thử khỏi Cert:\CurrentUser\My (xong thì không còn gì)
#
# Chứng chỉ: CN=mAT SCADA TEST - NOT FOR RELEASE, tự ký, RSA 3072, SHA-256, EKU Code Signing, hạn 90 ngày.
# KHÔNG thêm vào kho tin cậy (Root, TrustedPublisher, CA): Get-AuthenticodeSignature báo gốc chưa tin cậy
# (NotTrusted, hoặc UnknownError "terminated in a root certificate which is not trusted" trên Windows 11), đúng kỳ vọng
# của chế độ thử. sign.ps1 -Mode test tự tìm chứng chỉ này theo chủ thể. release.ps1 -Release từ chối nó (CERT_TEST).
# -Json: dòng cuối là thông tin chứng chỉ dạng JSON một dòng (thumbprint, subject, notAfter, ekus, keyAlgorithm, ...).
# Chỉ chạy trên Windows. Mã thoát: 0 xong, 2 dùng sai hoặc không phải Windows.
param(
    [switch]$Remove,
    [switch]$Json
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"
. "$PSScriptRoot/lib/signing.ps1"

if (-not $MatIsWindows) { Write-MatError 'make-test-cert.ps1: cần kho chứng chỉ Windows, chỉ chạy trên Windows'; exit 2 }

$subject = 'CN=mAT SCADA TEST - NOT FOR RELEASE'
$store = 'Cert:\CurrentUser\My'

function Get-TestCerts {
    @(Get-ChildItem -Path $store | Where-Object { $_.Subject -eq $subject })
}

# New-SelfSignedCertificate để thêm một bản sao (chỉ khóa công khai) vào kho trung gian CA của người dùng; đó không phải
# kho tin cậy nhưng không cần thiết: gỡ để chứng chỉ thử chỉ nằm ở My.
function Remove-TestCertCopies([string]$Thumbprint) {
    foreach ($c in @(Get-ChildItem -Path 'Cert:\CurrentUser\CA' | Where-Object { $_.Thumbprint -eq $Thumbprint })) {
        Remove-Item -LiteralPath $c.PSPath
    }
}

if ($Remove) {
    $found = Get-TestCerts
    foreach ($c in $found) {
        Remove-Item -LiteralPath $c.PSPath -DeleteKey -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $c.PSPath) { Remove-Item -LiteralPath $c.PSPath }
        Remove-TestCertCopies $c.Thumbprint
        Write-Host "đã gỡ chứng chỉ thử $($c.Thumbprint)"
    }
    if ($found.Count -eq 0) { Write-Host 'không có chứng chỉ thử để gỡ' }
    exit 0
}

$cert = Get-TestCerts | Where-Object { $_.NotAfter -gt (Get-Date).AddDays(7) -and $_.HasPrivateKey } |
    Sort-Object NotAfter -Descending | Select-Object -First 1
if ($cert) {
    Write-Host "dùng lại chứng chỉ thử $($cert.Thumbprint) (hạn $($cert.NotAfter.ToString('yyyy-MM-dd')))"
} else {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -KeyAlgorithm RSA -KeyLength 3072 `
        -HashAlgorithm SHA256 -KeyExportPolicy NonExportable -CertStoreLocation $store -NotAfter (Get-Date).AddDays(90)
    Remove-TestCertCopies $cert.Thumbprint
    Write-Host "đã tạo chứng chỉ thử $($cert.Thumbprint) (hạn $($cert.NotAfter.ToString('yyyy-MM-dd')))"
}
Write-Host $MatTestBanner
Write-Host 'chứng chỉ tự ký, KHÔNG nằm trong kho tin cậy; gỡ bằng: make-test-cert.ps1 -Remove'
if ($Json) {
    ConvertTo-MatCertInfo -Certificate $cert | ConvertTo-Json -Compress -Depth 4
}
exit 0
