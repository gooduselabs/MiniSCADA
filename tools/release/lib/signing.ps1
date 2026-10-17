# Hàm dùng chung của sign.ps1, verify-release.ps1, release.ps1 (feature 011, T092, T094, T098; contract
# release-signing). Nạp sau platform.ps1:
#   . "$PSScriptRoot/../lib/platform.ps1"; . "$PSScriptRoot/lib/signing.ps1"
# Chạy được trên Windows PowerShell 5.1 và PowerShell 7 (không dùng toán tử chỉ có ở 7). Phần Windows-only (signtool,
# Get-AuthenticodeSignature, kho chứng chỉ) nằm sau nhánh $MatIsWindows. Logic cổng nằm ở gate.mjs (Node).

$MatReleaseTools = Split-Path -Parent $PSScriptRoot
$MatRepoRoot = Split-Path -Parent (Split-Path -Parent $MatReleaseTools)
. (Join-Path $MatRepoRoot 'tools/lib/platform.ps1')
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { Write-Verbose 'OutputEncoding' }

$MatCodeSigningEku = '1.3.6.1.5.5.7.3.3'
$MatTestBanner = 'BẢN THỬ, KHÔNG PHÁT HÀNH'

function Get-MatNode {
    if ($env:MAT_NODE) { return $env:MAT_NODE }
    if ($MatIsWindows) { return 'node.exe' }
    return 'node'
}

function Write-MatError([string]$Text) { [Console]::Error.WriteLine($Text) }

# Chạy lệnh ngoài có chuyển hướng stderr (2>&1, 2>$null): Windows PowerShell 5.1 biến từng dòng stderr thành
# ErrorRecord và dừng script khi $ErrorActionPreference = 'Stop'. Chỉ mã thoát ($LASTEXITCODE) quyết định.
function Invoke-MatNative([scriptblock]$Body) {
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Body } finally { $ErrorActionPreference = $saved }
}

# Che giá trị của biến môi trường có tên giống bí mật (mật khẩu, PIN, token, khóa) trước khi in hay ghi log. Từ 4 ký tự
# (PIN của token thường 4–8 chữ số; rà soát T062 F5); giá trị dài thay trước để giá trị ngắn nằm trong nó không lộ phần còn lại.
function Protect-MatSecret([string]$Text) {
    if (-not $Text) { return $Text }
    $out = $Text
    $values = @(Get-ChildItem Env: | Where-Object {
            $_.Name -match '(PASS|PIN|TOKEN|SECRET|KEY|CRED)' -and $_.Value -and $_.Value.Length -ge 4 -and
            $_.Value -notmatch '^(true|false|null|test|store|command)$'
        } | ForEach-Object { $_.Value } | Sort-Object -Property Length -Descending)
    foreach ($v in $values) { $out = $out.Replace($v, '***') }
    return $out
}

# Tên chương trình của lệnh ký (từ đầu tiên, bỏ nháy, chỉ tên tệp) để ghi log thay cho cả lệnh (có thể chứa bí mật).
function Get-MatCommandProgram([string]$Command) {
    if (-not $Command) { return $null }
    $t = $Command.Trim()
    $first = if ($t.StartsWith('"')) { $t.Substring(1).Split('"')[0] } else { ($t -split '\s+')[0] }
    return (Split-Path -Leaf $first)
}

# Dòng lệnh ký với `{file}` đã thay (rà soát T062 F5, T202 N-S2). Nháy do người dùng tự đặt quanh `{file}` ("{file}"
# hay '{file}') được bỏ trước, để giá trị mở rộng luôn nằm trong đúng một cặp nháy kép: Windows "%MAT_SIGN_FILE%" (cmd
# mở rộng biến một lần), ngoài Windows "$1" (đối số vị trí của sh).
function ConvertTo-MatSignLine([string]$Command, [bool]$Windows) {
    $ref = if ($Windows) { '"%MAT_SIGN_FILE%"' } else { '"$1"' }
    return $Command.Replace('"{file}"', '{file}').Replace("'{file}'", '{file}').Replace('{file}', $ref)
}

# Đường dẫn không có ký tự đặc biệt của cmd (& | < > ^ % ! "): phòng khi -Command đặt {file} giữa một chuỗi trong nháy
# (nháy lệch làm giá trị mở rộng nằm ngoài nháy), cmd không thể hiểu tên tệp thành lệnh (T202 N-S2).
function Test-MatCmdSafePath([string]$Path) {
    return -not ($Path -match '[&|<>^%!"]')
}

function Get-MatSha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# Tách danh sách đường dẫn: "-Path a,b" qua `-File` đến dưới dạng một chuỗi; chỉ tách khi chuỗi không phải tệp có thật.
function Resolve-MatPathList([string[]]$Path) {
    $list = New-Object System.Collections.Generic.List[string]
    foreach ($p in $Path) {
        if (Test-Path -LiteralPath $p) { $list.Add((Resolve-Path -LiteralPath $p).ProviderPath); continue }
        foreach ($part in ($p -split ',')) {
            $t = $part.Trim()
            if (-not $t) { continue }
            if (-not (Test-Path -LiteralPath $t)) { throw "không có tệp: $t" }
            $list.Add((Resolve-Path -LiteralPath $t).ProviderPath)
        }
    }
    return , $list.ToArray()
}

# Thông tin chứng chỉ cho gate.mjs (cert{} của contract §2).
function ConvertTo-MatCertInfo {
    param([Parameter(Mandatory = $true)][System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate)
    $c = $Certificate
    $ekus = @()
    foreach ($ext in $c.Extensions) {
        if ($ext -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
            foreach ($o in $ext.EnhancedKeyUsages) { $ekus += $o.Value }
        }
    }
    $alg = 'other'
    $size = 0
    $oid = $c.PublicKey.Oid.Value
    if ($oid -eq '1.2.840.113549.1.1.1') {
        $alg = 'RSA'
        $k = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($c)
        if ($k) { $size = $k.KeySize }
    } elseif ($oid -eq '1.2.840.10045.2.1') {
        $alg = 'ECDSA'
        $k = [System.Security.Cryptography.X509Certificates.ECDsaCertificateExtensions]::GetECDsaPublicKey($c)
        if ($k) { $size = $k.KeySize }
    }
    $friendly = ''
    try { $friendly = $c.FriendlyName } catch { $friendly = '' }
    $chainTrusted = $null
    try {
        $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
        $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
        [void]$chain.ChainPolicy.ApplicationPolicy.Add((New-Object System.Security.Cryptography.Oid $MatCodeSigningEku))
        $chainTrusted = [bool]$chain.Build($c)
    } catch { $chainTrusted = $null }
    return [pscustomobject][ordered]@{
        thumbprint         = $c.Thumbprint
        subject            = $c.Subject
        issuer             = $c.Issuer
        friendlyName       = $friendly
        notBefore          = $c.NotBefore.ToUniversalTime().ToString('o')
        notAfter           = $c.NotAfter.ToUniversalTime().ToString('o')
        ekus               = @($ekus)
        keyAlgorithm       = $alg
        keySize            = $size
        signatureAlgorithm = $c.SignatureAlgorithm.FriendlyName
        chainTrusted       = $chainTrusted
    }
}

# Gọi gate.mjs; trả { ok, release, testBuild, failures[], warnings[] }.
function Invoke-MatGate {
    param([Parameter(Mandatory = $true)]$Info, [switch]$Release, [ValidateSet('pre', 'post', 'all', 'key')][string]$Phase = 'all')
    $tmp = Join-Path $MatTemp ('mat-gate-' + [guid]::NewGuid().ToString('N') + '.json')
    try {
        $json = ConvertTo-Json -InputObject $Info -Depth 8
        [IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding $false))
        $a = @((Join-Path $MatReleaseTools 'gate.mjs'), '--info', $tmp, '--phase', $Phase, '--json')
        if ($Release) { $a += '--release' }
        $out = & (Get-MatNode) @a
        $text = ($out | Out-String).Trim()
        if (-not $text) { throw "gate.mjs không trả kết quả (mã $LASTEXITCODE)" }
        return ($text | ConvertFrom-Json)
    } finally {
        Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
    }
}

function Get-MatTreeState([string]$BuildInfo = '', [string[]]$Ignore = @()) {
    $a = @((Join-Path $MatReleaseTools 'gate.mjs'), '--tree', $MatRepoRoot)
    if ($BuildInfo) { $a += @('--build-info', $BuildInfo) }
    if ($Ignore.Count -gt 0) { $a += @('--ignore', ($Ignore -join ',')) }
    $text = (& (Get-MatNode) @a | Out-String).Trim()
    if (-not $text -or $text -eq 'null') { return $null }
    return ($text | ConvertFrom-Json)
}

# keyId của khóa thử (tests/update-vectors/keys/*.pem): release.ps1 -Release từ chối ký bằng chúng (CERT_TEST_KEY).
function Get-MatTestKeyIds {
    $dir = Join-Path $MatRepoRoot 'tests/update-vectors/keys'
    $ids = @()
    if (Test-Path -LiteralPath $dir) {
        foreach ($f in Get-ChildItem -LiteralPath $dir -Filter '*.pem') {
            $id = (& (Get-MatNode) (Join-Path $MatReleaseTools 'sums.mjs') keyid $f.FullName | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $id) { $ids += $id }
        }
    }
    return , $ids
}

function Get-MatTimestampUrls([string[]]$Explicit) {
    if ($Explicit -and $Explicit.Count -gt 0) { return , @($Explicit | Where-Object { $_ }) }
    $f = Join-Path $MatReleaseTools 'timestamp-urls.json'
    if (-not (Test-Path -LiteralPath $f)) { return , @() }
    $j = Get-Content -Raw -LiteralPath $f | ConvertFrom-Json
    return , @($j.urls | Where-Object { $_ })
}

function Find-MatSigntool {
    if ($env:MAT_SIGNTOOL) { return $env:MAT_SIGNTOOL }
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path -LiteralPath $kits) {
        $c = Get-ChildItem -LiteralPath $kits -Directory | Where-Object { $_.Name -match '^10\.' } |
            Sort-Object { [version]$_.Name } -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
            Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        if ($c) { return $c }
    }
    return $null
}

# Chứng chỉ ký trong kho Windows: theo dấu vân tay (CurrentUser\My rồi LocalMachine\My); chế độ test không có dấu vân
# tay thì lấy chứng chỉ thử mới nhất do make-test-cert.ps1 tạo (CN chứa "mAT SCADA TEST").
function Find-MatSigningCert([string]$Thumbprint, [string]$Mode) {
    if (-not $MatIsWindows) { return $null }
    $stores = @('Cert:\CurrentUser\My', 'Cert:\LocalMachine\My')
    if ($Thumbprint) {
        $t = ($Thumbprint -replace '\s', '').ToUpperInvariant()
        foreach ($s in $stores) {
            $c = Get-ChildItem -Path $s -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $t } | Select-Object -First 1
            if ($c) { return $c }
        }
        return $null
    }
    if ($Mode -eq 'test') {
        return Get-ChildItem -Path 'Cert:\CurrentUser\My' -CodeSigningCert -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -like '*mAT SCADA TEST*' } | Sort-Object NotAfter -Descending | Select-Object -First 1
    }
    return $null
}

# Chữ ký Authenticode của tệp (chỉ Windows): signature{} của contract §2 kèm chứng chỉ người ký.
function Get-MatSignatureInfo([string]$Path, [string]$Signtool = '') {
    $s = Get-AuthenticodeSignature -LiteralPath $Path
    $status = $s.Status.ToString()
    $timestamped = ($null -ne $s.TimeStamperCertificate)
    $digest = $null
    if ($Signtool) {
        $v = (Invoke-MatNative { & $Signtool verify /pa /v $Path 2>&1 } | Out-String)
        if ($v -match 'The signature is timestamped') { $timestamped = $true }
        if ($v -match 'Hash of file \((sha\d+)\)') { $digest = $Matches[1].ToLowerInvariant() }
    }
    # NotTrusted (và UnknownError do gốc chưa tin cậy) nghĩa là chữ ký toán học đúng: kỳ vọng với chứng chỉ thử.
    $intact = ($status -eq 'Valid') -or ($status -eq 'NotTrusted') -or
        ($status -eq 'UnknownError' -and $s.StatusMessage -match 'root')
    $cert = $null
    if ($s.SignerCertificate) { $cert = ConvertTo-MatCertInfo -Certificate $s.SignerCertificate }
    return [pscustomobject][ordered]@{
        status      = $status
        message     = $s.StatusMessage
        timestamped = $timestamped
        verified    = [bool]($intact -and $null -ne $s.SignerCertificate)
        digest      = $digest
        cert        = $cert
    }
}

# Ghi thêm một mục vào signing-log.json (mảng JSON, UTF-8 không BOM; không có bí mật).
function Write-MatSigningLog([string]$LogPath, $Entry) {
    $dir = Split-Path -Parent $LogPath
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $list = New-Object System.Collections.ArrayList
    if (Test-Path -LiteralPath $LogPath) {
        $old = Get-Content -Raw -LiteralPath $LogPath | ConvertFrom-Json
        foreach ($o in @($old)) { [void]$list.Add($o) }
    }
    [void]$list.Add($Entry)
    $json = Protect-MatSecret (ConvertTo-Json -InputObject @($list.ToArray()) -Depth 8)
    [IO.File]::WriteAllText($LogPath, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
}
