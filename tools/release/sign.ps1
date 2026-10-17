# Ký Authenticode các tệp của bộ cài Studio (feature 011, T092; FR-047, FR-048, FR-049; contract release-signing §1, §2).
#
#   sign.ps1 -Path <tệp[,tệp...]> [-Mode store|command|test] [-Thumbprint <sha1>] [-Command "<lệnh> {file}"]
#            [-Timestamp <url[,url...]>] [-LogPath <signing-log.json>] [-Release] [-CheckOnly]
#
# store    signtool sign /fd SHA256 /sha1 <thumbprint> /tr <tsa> /td SHA256 (chứng chỉ trong kho Windows hoặc token phần
#          cứng; mã PIN do trình điều khiển token hỏi, không qua tham số).
# command  chạy lệnh ngoài (dịch vụ ký đám mây). `{file}` không bao giờ được ghép thẳng vào chuỗi lệnh (rà soát T062 F5):
#          ngoài Windows thay bằng "$1" và đường dẫn là đối số vị trí (`sh -c "<lệnh>" sh <tệp>`); Windows thay bằng
#          "%MAT_SIGN_FILE%" và đường dẫn qua biến môi trường đó. Bí mật của lệnh lấy từ biến môi trường của người chạy,
#          không đặt trong -Command. Đầu ra của lệnh được che bí mật rồi mới in; log chỉ ghi tên chương trình ký.
# test     như store với chứng chỉ thử (make-test-cert.ps1, CN chứa TEST), dấu thời gian không bắt buộc.
# Mặc định lấy từ biến môi trường (Tauri signCommand chỉ truyền -Path): MAT_SIGN_MODE (mặc định test),
# MAT_SIGN_THUMBPRINT, MAT_SIGN_COMMAND, MAT_SIGNING_LOG, MAT_SIGN_RELEASE=1 (như -Release).
# URL dấu thời gian: -Timestamp, không có thì tools/release/timestamp-urls.json; thử tối đa ba lần qua các URL.
# Mỗi tệp: in dấu vân tay, chủ thể, hạn, URL dấu thời gian; kiểm lại bằng Get-AuthenticodeSignature và
# `signtool verify /pa /v`; ghi một mục vào signing-log.json (không có bí mật). Cổng -Release: gate.mjs.
# -CheckOnly: chỉ tìm chứng chỉ và chạy cổng pha "pre" (release.ps1 gọi trước khi dựng), không ký.
# Ngoài Windows chỉ chạy được chế độ command (không kiểm lại được chữ ký: in BỎ QUA; -Release thì từ chối).
# Mã thoát: 0 xong, 1 cổng từ chối hoặc ký lỗi, 2 dùng sai hoặc thiếu công cụ.
param(
    [string[]]$Path = @(),
    [string]$Mode = '',
    [string]$Thumbprint = '',
    [string]$Command = '',
    [string[]]$Timestamp = @(),
    [string]$LogPath = '',
    [switch]$Release,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"
. "$PSScriptRoot/lib/signing.ps1"

if (-not $Mode) { $Mode = if ($env:MAT_SIGN_MODE) { $env:MAT_SIGN_MODE } else { 'test' } }
if (-not $Thumbprint -and $env:MAT_SIGN_THUMBPRINT) { $Thumbprint = $env:MAT_SIGN_THUMBPRINT }
if (-not $Command -and $env:MAT_SIGN_COMMAND) { $Command = $env:MAT_SIGN_COMMAND }
if (-not $LogPath) { $LogPath = if ($env:MAT_SIGNING_LOG) { $env:MAT_SIGNING_LOG } else { Join-Path (Get-MatBuildDir 'release-signing') 'signing-log.json' } }
$isRelease = $Release.IsPresent -or ($env:MAT_SIGN_RELEASE -eq '1')

function Stop-Usage([string]$Text) { Write-MatError "sign.ps1: $Text"; exit 2 }

if (@('store', 'command', 'test') -notcontains $Mode) { Stop-Usage "chế độ lạ '$Mode' (store, command, test)" }
if ($Mode -eq 'command' -and -not $Command) { Stop-Usage 'chế độ command cần -Command "<lệnh> {file}" (hoặc MAT_SIGN_COMMAND)' }
if ($Mode -eq 'command' -and $Command -notmatch '\{file\}') { Stop-Usage '-Command phải có {file}' }
if ($Mode -ne 'command' -and -not $MatIsWindows) { Stop-Usage "chế độ $Mode cần signtool, chỉ chạy trên Windows" }
if (-not $CheckOnly -and $Path.Count -eq 0) { Stop-Usage 'cần -Path <tệp>' }
$files = @()
if (-not $CheckOnly) {
    try { $files = Resolve-MatPathList $Path } catch { Stop-Usage $_.Exception.Message }
}

if (-not $isRelease) { Write-Host $MatTestBanner }
$tree = $null
if ($isRelease) { $tree = Get-MatTreeState }
$tsUrls = Get-MatTimestampUrls $Timestamp
$signtool = $null
$certInfo = $null

if ($Mode -ne 'command') {
    $signtool = Find-MatSigntool
    if (-not $signtool) { Stop-Usage 'không tìm thấy signtool.exe (Windows SDK; hoặc đặt MAT_SIGNTOOL)' }
    $cert = Find-MatSigningCert -Thumbprint $Thumbprint -Mode $Mode
    if (-not $cert) {
        Stop-Usage ($(if ($Thumbprint) { "không có chứng chỉ $Thumbprint trong Cert:\CurrentUser\My, Cert:\LocalMachine\My" } else { 'không có chứng chỉ thử: chạy tools/release/make-test-cert.ps1 hoặc truyền -Thumbprint' }))
    }
    if ($Mode -eq 'store' -and -not $Thumbprint) { Stop-Usage 'chế độ store cần -Thumbprint' }
    $certInfo = ConvertTo-MatCertInfo -Certificate $cert
    Write-Host ("chứng chỉ: {0}`n  chủ thể: {1}`n  hạn: {2}" -f $certInfo.thumbprint, $certInfo.subject, $certInfo.notAfter)
    $pre = Invoke-MatGate -Info ([pscustomobject]@{ cert = $certInfo; tree = $tree; signature = $null }) -Release:$isRelease -Phase pre
    foreach ($w in @($pre.warnings)) { if ($w) { Write-Host "CẢNH BÁO: $w" } }
    if (-not $pre.ok) {
        foreach ($f in @($pre.failures)) { Write-MatError ("TỪ CHỐI {0}: {1}" -f $f.code, $f.message) }
        exit 1
    }
    if ($isRelease -and $tsUrls.Count -eq 0) {
        Write-MatError 'TỪ CHỐI NO_TIMESTAMP: chưa có URL dấu thời gian (-Timestamp hoặc tools/release/timestamp-urls.json)'
        exit 1
    }
} elseif ($CheckOnly) {
    Write-Host 'chế độ command: chứng chỉ chỉ biết sau khi ký; cổng chạy sau mỗi lần ký'
}
if ($CheckOnly) { Write-Host 'sign.ps1 -CheckOnly: qua'; exit 0 }

$failed = $false
foreach ($file in $files) {
    $leaf = Split-Path -Leaf $file
    Write-Host "ký: $leaf ($Mode)"
    $usedTs = $null
    if ($Mode -eq 'command') {
        if ($MatIsWindows) {
            # Qua tệp .cmd tạm: tránh cách Windows PowerShell 5.1 trích dẫn lại đối số có nháy kép. Đường dẫn qua biến
            # môi trường MAT_SIGN_FILE: cmd mở rộng "%MAT_SIGN_FILE%" một lần, trong nháy kép (& | < > ^ % là chữ thường;
            # tên tệp Windows không chứa nháy kép).
            if (-not (Test-MatCmdSafePath $file)) {
                Write-MatError "sign.ps1: tên tệp có ký tự đặc biệt của cmd (& | < > ^ % ! `"), không ký: $leaf"
                exit 1
            }
            $line = ConvertTo-MatSignLine -Command $Command -Windows $true
            $cmdFile = Join-Path $MatTemp ('mat-sign-' + [guid]::NewGuid().ToString('N') + '.cmd')
            [IO.File]::WriteAllText($cmdFile, "@echo off`r`nsetlocal DisableDelayedExpansion`r`nchcp 65001 >nul`r`n$line`r`nexit /b %ERRORLEVEL%`r`n", (New-Object System.Text.UTF8Encoding $false))
            $env:MAT_SIGN_FILE = $file
            try { $out = Invoke-MatNative { & cmd.exe /d /c $cmdFile 2>&1 }; $code = $LASTEXITCODE } finally {
                Remove-Item -LiteralPath $cmdFile -ErrorAction SilentlyContinue
                Remove-Item Env:MAT_SIGN_FILE -ErrorAction SilentlyContinue
            }
        } else {
            # Đường dẫn là đối số vị trí $1 của sh: không bao giờ được shell phân tích như lệnh.
            $line = ConvertTo-MatSignLine -Command $Command -Windows $false
            $out = Invoke-MatNative { & /bin/sh -c $line sh $file 2>&1 }
            $code = $LASTEXITCODE
        }
        foreach ($l in @($out)) { Write-Host ('  ' + (Protect-MatSecret ([string]$l))) }
        if ($code -ne 0) { Write-MatError "sign.ps1: lệnh ký trả mã $code cho $leaf"; exit 1 }
    } else {
        $base = @('sign', '/fd', 'SHA256', '/sha1', $certInfo.thumbprint, '/d', 'mAT SCADA Studio', '/du', 'https://www.atpro.com.vn')
        $signed = $false
        $urls = @($tsUrls)
        if ($urls.Count -eq 0 -and $Mode -eq 'store' -and -not $isRelease) {
            Write-Host 'CẢNH BÁO: ký không có dấu thời gian (chưa cấu hình URL)'
        }
        $attempts = if ($urls.Count -gt 0) { 3 } else { 1 }
        for ($i = 0; $i -lt $attempts -and -not $signed; $i++) {
            $a = @($base)
            if ($urls.Count -gt 0) {
                $usedTs = $urls[$i % $urls.Count]
                $a += @('/tr', $usedTs, '/td', 'SHA256')
            }
            $out = Invoke-MatNative { & $signtool @a $file 2>&1 }
            foreach ($l in @($out)) { Write-Host ('  ' + (Protect-MatSecret ([string]$l))) }
            $signed = ($LASTEXITCODE -eq 0)
            if (-not $signed -and $usedTs) { Write-Host "  thử lại (dấu thời gian $usedTs lỗi)"; Start-Sleep -Seconds 2 }
        }
        if (-not $signed) { Write-MatError "sign.ps1: signtool lỗi với $leaf"; exit 1 }
        if ($usedTs) { Write-Host "  dấu thời gian: $usedTs" }
    }

    # Kiểm lại sau khi ký.
    if ($MatIsWindows) {
        $st = $signtool
        if (-not $st) { $st = Find-MatSigntool }
        $sig = Get-MatSignatureInfo -Path $file -Signtool $st
        $info = $certInfo
        if ($Mode -eq 'command') { $info = $sig.cert }
        if ($Mode -ne 'command' -and $sig.cert -and $sig.cert.thumbprint -ne $certInfo.thumbprint) {
            $sig.verified = $false
            $sig.message = "người ký $($sig.cert.thumbprint) khác chứng chỉ đã chọn"
        }
        $phase = if ($Mode -eq 'command') { 'all' } else { 'post' }
        $verifyRec = [ordered]@{ status = $sig.status; timestamped = $sig.timestamped; message = $sig.message }
    } else {
        Write-Host '  BỎ QUA: kiểm lại chữ ký Authenticode (Get-AuthenticodeSignature) chỉ có trên Windows'
        $sig = [pscustomobject]@{ status = 'skipped'; timestamped = $null; verified = $null; digest = $null }
        $info = $certInfo
        $phase = 'post'
        $verifyRec = [ordered]@{ status = 'skipped'; timestamped = $null; message = 'không phải Windows' }
    }
    $gate = Invoke-MatGate -Info ([pscustomobject]@{ cert = $info; tree = $tree; signature = $sig }) -Release:$isRelease -Phase $phase
    foreach ($w in @($gate.warnings)) { if ($w) { Write-Host "  CẢNH BÁO: $w" } }
    if ($info) { Write-Host ("  người ký: {0} ({1}), hạn {2}" -f $info.subject, $info.thumbprint, $info.notAfter) }

    $entry = [ordered]@{
        time         = (Get-Date).ToUniversalTime().ToString('o')
        file         = $leaf
        sha256       = (Get-MatSha256 $file)
        mode         = $Mode
        release      = [bool]$isRelease
        thumbprint   = $(if ($info) { $info.thumbprint } else { $null })
        subject      = $(if ($info) { $info.subject } else { $null })
        notAfter     = $(if ($info) { $info.notAfter } else { $null })
        timestampUrl = $usedTs
        command      = $(if ($Mode -eq 'command') { Get-MatCommandProgram $Command } else { $null })
        verify       = $verifyRec
        gate         = [ordered]@{ ok = [bool]$gate.ok; codes = @(@($gate.failures) | ForEach-Object { $_.code }) }
    }
    Write-MatSigningLog -LogPath $LogPath -Entry ([pscustomobject]$entry)
    if (-not $gate.ok) {
        foreach ($f in @($gate.failures)) { Write-MatError ("TỪ CHỐI {0}: {1} ({2})" -f $f.code, $f.message, $leaf) }
        $failed = $true
    }
}
Write-Host "signing-log: $LogPath"
if ($failed) { exit 1 }
exit 0
