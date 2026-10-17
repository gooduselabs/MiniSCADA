# Sinh khóa phát hành ECDSA P-256 (feature 011, T097; FR-053; contract release-signing §5, §6).
#
#   keygen.ps1                                    chỉ in hướng dẫn
#   keygen.ps1 -OutDir <thư mục ngoài repo> [-Name release-primary,release-backup] [-NoEncrypt]
#
# Quy định: hai khóa (chính `release-primary`, dự phòng `release-backup`), sinh trên máy không nối mạng (hoặc trong
# token phần cứng nếu hỗ trợ ECDSA P-256). Khóa riêng PEM mã hóa AES-256 bằng mật khẩu mạnh: openssl tự hỏi mật khẩu
# trên bàn phím, không qua tham số hay biến môi trường. Khóa chính giữ trên token hoặc USB mã hóa của người phát hành;
# khóa dự phòng ở két của công ty ở nơi khác. Khóa riêng không bao giờ nằm trong repo, CI hay máy dev chung: script từ
# chối -OutDir nằm trong repo. Khóa công khai (`<tên>.pub.pem`) chép vào `deployment/keys/` của repo (T103, cần người).
# -NoEncrypt chỉ cho chạy thử (khóa thử bỏ đi sau khi thử); release.ps1 -Release không nhận khóa thử.
# Cần `openssl` (OpenSSL 1.1+ hoặc LibreSSL; Windows: OpenSSL của Git for Windows, hoặc trong container toolchain
# `docker run --rm -it -v <thư mục>:/keys mat-armhf openssl ...` với cùng lệnh in ở dưới).
# Mã thoát: 0 xong, 2 dùng sai hoặc thiếu openssl.
param(
    [string]$OutDir = '',
    [string[]]$Name = @('release-primary', 'release-backup'),
    [switch]$NoEncrypt
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"
. "$PSScriptRoot/lib/signing.ps1"

$guide = @'
Khóa phát hành ECDSA P-256 (contract release-signing §5):
  1. Trên máy không nối mạng: openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -pkeyopt ec_param_enc:named_curve -aes-256-cbc -out <tên>.key.pem
     (tương đương: openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -v2 aes-256-cbc -out <tên>.key.pem)
  2. Khóa công khai: openssl pkey -in <tên>.key.pem -pubout -out <tên>.pub.pem
  3. keyId: node tools/release/sums.mjs keyid <tên>.pub.pem
  4. Sinh hai khóa: release-primary (người phát hành giữ, token hoặc USB mã hóa), release-backup (két công ty, nơi khác).
  5. Chép release-primary.pub.pem và release-backup.pub.pem vào deployment/keys/ của repo (xem deployment/keys/README.md).
  6. Ký SHA256SUMS: tools/release/sign-sums.ps1 -Sums <SHA256SUMS> -Key <release-primary.key.pem>
'@
Write-Host $guide
if (-not $OutDir) { exit 0 }

$out = [IO.Path]::GetFullPath($OutDir)
$repo = [IO.Path]::GetFullPath($MatRepoRoot)
$sepChars = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$repoPrefix = $repo.TrimEnd($sepChars) + [IO.Path]::DirectorySeparatorChar
if ($out.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or $out.TrimEnd($sepChars) -ieq $repo.TrimEnd($sepChars)) {
    Write-MatError "keygen.ps1: không ghi khóa riêng vào repo ($out)"
    exit 2
}
$openssl = if ($env:MAT_OPENSSL) { $env:MAT_OPENSSL } else { 'openssl' }
if (-not (Get-Command $openssl -ErrorAction SilentlyContinue)) {
    $git = 'C:\Program Files\Git\usr\bin\openssl.exe'
    if ($MatIsWindows -and (Test-Path -LiteralPath $git)) { $openssl = $git }
    else { Write-MatError 'keygen.ps1: không có openssl (đặt MAT_OPENSSL hoặc dùng container toolchain)'; exit 2 }
}
New-Item -ItemType Directory -Force -Path $out | Out-Null
if (-not $MatIsWindows) { & chmod 700 $out }
if ($NoEncrypt) { Write-Host "$MatTestBanner (khóa không mã hóa, chỉ để chạy thử)" }

$names = @($Name | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
foreach ($n in $names) {
    $key = Join-Path $out "$n.key.pem"
    $pub = Join-Path $out "$n.pub.pem"
    if ((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $pub)) { Write-MatError "keygen.ps1: $n đã có trong $out, không ghi đè"; exit 2 }
    $a = @('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-pkeyopt', 'ec_param_enc:named_curve', '-out', $key)
    if (-not $NoEncrypt) { $a = @('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-pkeyopt', 'ec_param_enc:named_curve', '-aes-256-cbc', '-out', $key) }
    # Rà soát T062 F6: khóa riêng chỉ chủ sở hữu đọc được ngay khi openssl ghi nó (không có lúc nào nằm trên đĩa với
    # quyền mặc định). Unix: umask 077 cho tiến trình openssl. Windows: tạo tệp rỗng, bỏ quyền kế thừa, chỉ cho người
    # đang chạy (icacls), rồi openssl ghi đè nội dung (giữ ACL).
    if ($MatIsWindows) {
        [IO.File]::WriteAllBytes($key, [byte[]]@())
        $who = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
        & icacls $key /inheritance:r /grant:r "${who}:(F)" | Out-Null
        if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $key -Force; Write-MatError "keygen.ps1: icacls lỗi ($n)"; exit 2 }
        & $openssl @a
    } else {
        & /bin/sh -c 'umask 077 && exec "$@"' sh $openssl @a
    }
    if ($LASTEXITCODE -ne 0) { Write-MatError "keygen.ps1: openssl genpkey lỗi ($n)"; exit 2 }
    if (-not $MatIsWindows) { & chmod 600 $key }
    & $openssl pkey -in $key -pubout -out $pub
    if ($LASTEXITCODE -ne 0) { Write-MatError "keygen.ps1: openssl pkey -pubout lỗi ($n)"; exit 2 }
    $id = (& (Get-MatNode) (Join-Path $MatReleaseTools 'sums.mjs') keyid $pub | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { Write-MatError "keygen.ps1: $n không phải ECDSA P-256 named curve; xóa và sinh lại"; exit 2 }
    Write-Host ("{0}: khóa riêng {1}`n  khóa công khai {2}`n  keyId {3}" -f $n, $key, $pub, $id)
}
Write-Host 'Xong. Không đưa *.key.pem vào repo; chỉ *.pub.pem vào deployment/keys/.'
exit 0
