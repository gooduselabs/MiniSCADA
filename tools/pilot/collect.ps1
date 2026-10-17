<#
.SYNOPSIS
  Pilot data collector: every 15 minutes reads system/info and diagnostics of one device, every hour an audit
  summary (counts per action only), and appends one JSON line to docs/pilot/data/<site>/<yyyy-mm-dd>.jsonl
  (feature 011, T189; FR-137, D38; contract test-protocols.md section 6; data-model.md section 6 "Pilot").

.DESCRIPTION
  Read-only. Logs in with a read-only account (POST /api/v1/auth/login), then GET /api/v1/system/info and
  GET /api/v1/diagnostics; hourly GET /api/v1/audit over the last hour, following "next" pages, counting records
  per "action". The audit API needs the administrator role: with a viewer account the line carries
  "audit": {"error": "FORBIDDEN"} and the sample is still written.

  No process data is collected (D38): every field of the line is picked from a fixed list. Tag names, Tag values,
  project, screen and device names, warning messages and audit targets/details never reach the file.

  Line: {"t","site","info":{version,releaseSeq,bootId,uptimeS,warnings[codes]},
         "diag":{restarts,rssMb,cpuPct,fdCount,ioWriteBytesToday,emmcLife,[emmcLifeReason],liveLagP95Ms,clients,timeSynced},
         ["audit":{from,to,total,counts{action:n}} | {error}]}
  "t" is local time with its offset; the file is named after the local date. A failed read writes nothing: the hole
  is a data gap for tools/pilot/kpi.mjs (tests/pilot-kpi/README.md).

  Password: the environment variable named by -PasswordEnv (default MAT_PILOT_PASSWORD); if empty, on Windows, the
  generic credential -CredentialTarget (default "mat-pilot/<Site>") of the Windows Credential Manager, e.g.
    cmdkey /generic:mat-pilot/site1 /user:viewer1 /pass
  The password is never printed, logged or written.

  The device certificate is self-signed (feature 005). Pass -Fingerprint (SHA-256 hex of the device certificate, as
  printed by deploy.sh and shown by Studio) to pin it: the pin is checked in the TLS validation callback of EVERY
  connection (not once at start), so a device swapped mid-run never receives the password. Over https without
  -Fingerprint the script refuses to run unless -Insecure is given (certificate not checked, warning).

.PARAMETER Insecure
  Over https, do not check the device certificate at all (lab only). Without it, -Fingerprint is required.

.PARAMETER Once
  One sample (with the audit summary unless -NoAudit), then exit: for a manual run when there is no permanent link.

.PARAMETER BaseUrl
  Override of https://<Device>:<Port> (tests use a fake http server on 127.0.0.1).

.EXAMPLE
  $env:MAT_PILOT_PASSWORD = '<password>'; pwsh tools/pilot/collect.ps1 -Site site1 -Device <bl335-vpn-ip> -User viewer1 -Once
  pwsh tools/pilot/collect.ps1 -Site bench -Device <bl335-ip> -User viewer1 -Fingerprint <sha256-hex>
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$Site,
    [Parameter(Mandatory = $true)][string]$Device,
    [Parameter(Mandatory = $true)][string]$User,
    [int]$Port = 8443,
    [string]$BaseUrl = '',
    [string]$Fingerprint = '',
    [switch]$Insecure,
    [string]$PasswordEnv = 'MAT_PILOT_PASSWORD',
    [string]$CredentialTarget = '',
    [string]$OutDir = '',
    [ValidateRange(1, 1440)][int]$IntervalMin = 15,
    [ValidateRange(1, 1440)][int]$AuditEveryMin = 60,
    [switch]$Once,
    [switch]$NoAudit
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../lib/platform.ps1"

$repoRoot = (Resolve-Path "$PSScriptRoot/../..").Path
if (-not $OutDir) { $OutDir = Join-Path $repoRoot 'docs/pilot/data' }
if (-not $CredentialTarget) { $CredentialTarget = "mat-pilot/$Site" }
$base = if ($BaseUrl) { $BaseUrl.TrimEnd('/') } else { "https://${Device}:$Port" }
$isHttps = $base.StartsWith('https://')
$isPs7 = $PSVersionTable.PSVersion.Major -ge 7

# ---------- password ----------

function Get-WindowsCredentialPassword([string]$Target) {
    if (-not ('MatPilot.CredMan' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace MatPilot {
    public static class CredMan {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct CREDENTIAL {
            public int Flags; public int Type; public string TargetName; public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
            public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
        }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
        [DllImport("advapi32.dll")]
        static extern void CredFree(IntPtr cred);
        public static string Read(string target) {
            IntPtr p;
            if (!CredRead(target, 1, 0, out p)) return null; // 1 = CRED_TYPE_GENERIC
            try {
                var c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
                if (c.CredentialBlobSize == 0) return null;
                return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
            } finally { CredFree(p); }
        }
    }
}
'@
    }
    return [MatPilot.CredMan]::Read($Target)
}

$password = [Environment]::GetEnvironmentVariable($PasswordEnv)
if (-not $password -and $MatIsWindows) { $password = Get-WindowsCredentialPassword $CredentialTarget }
if (-not $password) {
    $where = if ($MatIsWindows) { " or the generic credential '$CredentialTarget' (cmdkey /generic:$CredentialTarget /user:$User /pass)" } else { '' }
    Write-Error "no password: set the environment variable $PasswordEnv$where" -ErrorAction Continue
    exit 2
}

# ---------- TLS ----------

# Review T062 F2: the SHA-256 pin is checked by the validation callback of every TLS connection. C# (not a
# script block): the callbacks run on thread-pool threads that have no PowerShell runspace.
$pinWant = ($Fingerprint -replace '[^0-9A-Fa-f]', '').ToLowerInvariant()
if ($isHttps) {
    if ($Fingerprint -and $Insecure) {
        Write-Error 'give either -Fingerprint or -Insecure, not both' -ErrorAction Continue
        exit 2
    }
    if ($Fingerprint -and $pinWant.Length -ne 64) {
        Write-Error '-Fingerprint must be the SHA-256 of the certificate (64 hex digits, separators allowed)' -ErrorAction Continue
        exit 2
    }
    if (-not $Fingerprint -and -not $Insecure) {
        Write-Error "https without -Fingerprint: pass -Fingerprint <sha256 of the device certificate, as printed by deploy.sh> (or -Insecure to skip the check, lab only)" -ErrorAction Continue
        exit 2
    }
}
if (-not ('MatPilot.CertPin' -as [type])) {
    $pinSource = @'
using System;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
namespace MatPilot {
    public static class CertPin {
        public static string Expected = "";
        public static bool Insecure = false;
        public static int Mismatches = 0;
        public static bool Check(X509Certificate cert) {
            if (Insecure) return true;
            if (cert == null || Expected.Length != 64) { Mismatches++; return false; }
            byte[] hash;
            using (var sha = SHA256.Create()) { hash = sha.ComputeHash(cert.GetRawCertData()); }
            int diff = 0;
            for (int i = 0; i < 32; i++) diff |= hash[i] ^ Convert.ToByte(Expected.Substring(2 * i, 2), 16);
            if (diff != 0) Mismatches++;
            return diff == 0;
        }
        public static bool Callback(object sender, X509Certificate cert, X509Chain chain, SslPolicyErrors errors) {
            return Check(cert);
        }
        public static RemoteCertificateValidationCallback Delegate() {
            return new RemoteCertificateValidationCallback(Callback);
        }
    }
}
'@
    if ($isPs7) {
        $pinSource += @'
namespace MatPilot {
    public static class PinnedHttp {
        public static System.Net.Http.HttpClient Create(int timeoutS) {
            var h = new System.Net.Http.HttpClientHandler();
            h.ServerCertificateCustomValidationCallback = (m, c, ch, e) => CertPin.Check(c);
            h.UseCookies = false;
            h.AllowAutoRedirect = false;
            var c2 = new System.Net.Http.HttpClient(h);
            c2.Timeout = TimeSpan.FromSeconds(timeoutS);
            return c2;
        }
    }
}
'@
    }
    Add-Type -TypeDefinition $pinSource
}
[MatPilot.CertPin]::Expected = $pinWant
[MatPilot.CertPin]::Insecure = [bool]$Insecure
if ($isPs7) {
    $script:http = [MatPilot.PinnedHttp]::Create(30)
} elseif ($isHttps) {
    # Windows PowerShell 5.1: Invoke-WebRequest validates through ServicePointManager.
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = [MatPilot.CertPin]::Delegate()
}

function Get-TlsHint {
    if ([MatPilot.CertPin]::Mismatches -gt 0) { return " (certificate of $base does not match -Fingerprint)" }
    return ''
}

# ---------- HTTP ----------

$jsonHasDateKind = (Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')
function ConvertFrom-MatJson([string]$Text) {
    if ($jsonHasDateKind) { return $Text | ConvertFrom-Json -DateKind String }
    return $Text | ConvertFrom-Json
}

function Invoke-MatApi([string]$Method, [string]$Path, $Body = $null, [string]$Token = '') {
    if ($isPs7) { return Invoke-MatApiHttpClient $Method $Path $Body $Token }
    $headers = @{ Accept = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }
    $req = @{ Uri = "$base$Path"; Method = $Method; Headers = $headers; TimeoutSec = 30; UseBasicParsing = $true }
    if ($null -ne $Body) {
        $req['Body'] = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
        $req['ContentType'] = 'application/json'
    }
    $status = 0
    $content = ''
    try {
        $r = Invoke-WebRequest @req
        $status = [int]$r.StatusCode
        $content = if ($r.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($r.Content) } else { [string]$r.Content }
    } catch [System.Net.WebException] {
        # Windows PowerShell 5.1: a non-2xx status is an exception.
        if ($null -eq $_.Exception.Response) { throw "$Method $Path failed: $($_.Exception.Message)$(Get-TlsHint)" }
        $status = [int]$_.Exception.Response.StatusCode
    }
    $json = $null
    if ($content) { try { $json = ConvertFrom-MatJson $content } catch { $json = $null } }
    return [pscustomobject]@{ Status = $status; Json = $json }
}

# PowerShell 7: HttpClient with the pinned validation callback (Invoke-WebRequest only has -SkipCertificateCheck).
function Invoke-MatApiHttpClient([string]$Method, [string]$Path, $Body, [string]$Token) {
    $msg = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new($Method), "$base$Path")
    $null = $msg.Headers.TryAddWithoutValidation('Accept', 'application/json')
    if ($Token) { $msg.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', $Token) }
    if ($null -ne $Body) {
        $msg.Content = [System.Net.Http.ByteArrayContent]::new([Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress)))
        $msg.Content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/json')
    }
    try {
        $resp = $script:http.SendAsync($msg).GetAwaiter().GetResult()
    } catch {
        $e = $_.Exception
        while ($e.InnerException) { $e = $e.InnerException }
        throw "$Method $Path failed: $($e.Message)$(Get-TlsHint)"
    } finally {
        $msg.Dispose()
    }
    try {
        $status = [int]$resp.StatusCode
        $content = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    } finally {
        $resp.Dispose()
    }
    $json = $null
    if ($content) { try { $json = ConvertFrom-MatJson $content } catch { $json = $null } }
    return [pscustomobject]@{ Status = $status; Json = $json }
}

function Get-Prop($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -eq $p) { return $null }
    return $p.Value
}

function ConvertTo-IsoText($Value) {
    if ($Value -is [datetime]) {
        return $Value.ToString('yyyy-MM-ddTHH:mm:ss.FFFFFFFK', [Globalization.CultureInfo]::InvariantCulture)
    }
    return $Value
}

function Get-Number($Value) {
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) { return $Value }
    return $null
}

$script:token = ''
function Connect-Device {
    $r = Invoke-MatApi 'POST' '/api/v1/auth/login' ([ordered]@{ user = $User; password = $password })
    if ($r.Status -ne 200 -or -not (Get-Prop $r.Json 'token')) {
        $code = Get-Prop $r.Json 'error'
        throw "login as '$User' failed: HTTP $($r.Status) $code"
    }
    $script:token = $r.Json.token
}

function Invoke-Authed([string]$Path) {
    if (-not $script:token) { Connect-Device }
    $r = Invoke-MatApi 'GET' $Path $null $script:token
    if ($r.Status -eq 401) {
        # Session expired (idle 30 min between samples): log in again once.
        Connect-Device
        $r = Invoke-MatApi 'GET' $Path $null $script:token
    }
    return $r
}

# ---------- one sample ----------

function Get-Sample {
    $infoR = Invoke-MatApi 'GET' '/api/v1/system/info'
    if ($infoR.Status -ne 200) { throw "GET /api/v1/system/info: HTTP $($infoR.Status)" }
    $diagR = Invoke-Authed '/api/v1/diagnostics'
    if ($diagR.Status -ne 200) { throw "GET /api/v1/diagnostics: HTTP $($diagR.Status)" }
    $si = $infoR.Json
    $d = $diagR.Json

    $version = Get-Prop $si 'version'
    if (-not $version) { $version = Get-Prop $si 'runtimeVersion' }
    $bootId = Get-Prop $si 'bootId'
    if (-not $bootId) { $bootId = Get-Prop $d 'bootId' }
    $uptimeS = Get-Number (Get-Prop $d 'uptimeS')
    if ($null -eq $uptimeS) { $uptimeS = Get-Number (Get-Prop (Get-Prop $d 'uptime') 'runtimeS') }
    $warnings = @()
    foreach ($w in @(Get-Prop $si 'warnings')) {
        $c = if ($w -is [string]) { $w } else { Get-Prop $w 'code' }
        if ($c -is [string] -and $c -match '^[A-Z0-9_]{1,64}$') { $warnings += $c }
    }

    $restarts = $null
    $rs = Get-Prop $d 'restarts'
    if ($null -ne (Get-Number $rs)) { $restarts = $rs }
    elseif ($null -ne $rs) {
        $restarts = [ordered]@{
            total      = Get-Number (Get-Prop $rs 'total')
            lastReason = Get-Prop $rs 'lastReason'
            lastAt     = ConvertTo-IsoText (Get-Prop $rs 'lastAt')
        }
        $bc = Get-Prop $rs 'bootChanged'
        if ($bc -is [bool]) { $restarts['bootChanged'] = $bc }
    }
    $io = $null
    $ioSrc = Get-Prop $d 'ioWriteBytesToday'
    if ($null -ne (Get-Number $ioSrc)) { $io = $ioSrc }
    elseif ($null -ne $ioSrc) {
        $io = [ordered]@{}
        foreach ($p in $ioSrc.PSObject.Properties) {
            # Component names are fixed by the runtime (total, history, audit, ...): keep short lowercase keys only.
            if ($p.Name -match '^[a-zA-Z]{1,32}$') { $io[$p.Name] = Get-Number $p.Value }
        }
    }
    $emmc = $null
    $em = Get-Prop $d 'emmcLife'
    if ($null -ne $em) {
        $emmc = [ordered]@{
            typeA  = Get-Number (Get-Prop $em 'typeA')
            typeB  = Get-Number (Get-Prop $em 'typeB')
            preEol = Get-Number (Get-Prop $em 'preEol')
        }
    }
    $clients = Get-Prop $d 'clients'
    if ($null -eq (Get-Number $clients)) { $clients = Get-Number (Get-Prop $clients 'live') }
    $synced = Get-Prop $d 'timeSynced'
    if ($synced -isnot [bool]) { $synced = $null }

    $diag = [ordered]@{
        restarts          = $restarts
        rssMb             = Get-Number (Get-Prop $d 'rssMb')
        cpuPct            = Get-Number (Get-Prop $d 'cpuPct')
        fdCount           = Get-Number (Get-Prop $d 'fdCount')
        ioWriteBytesToday = $io
        emmcLife          = $emmc
    }
    $reason = Get-Prop $d 'emmcLifeReason'
    if ($null -eq $emmc -and $reason -is [string] -and $reason -match '^[a-z-]{1,32}$') { $diag['emmcLifeReason'] = $reason }
    $diag['liveLagP95Ms'] = Get-Number (Get-Prop $d 'liveLagP95Ms')
    $diag['clients'] = $clients
    $diag['timeSynced'] = $synced

    $rel = Get-Number (Get-Prop $si 'releaseSeq')
    return [ordered]@{
        t    = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz', [Globalization.CultureInfo]::InvariantCulture)
        site = $Site
        info = [ordered]@{
            version    = $version
            releaseSeq = $rel
            bootId     = $bootId
            uptimeS    = $uptimeS
            warnings   = $warnings
        }
        diag = $diag
    }
}

function Get-AuditSummary {
    $to = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $from = $to - [int64]$AuditEveryMin * 60000
    $counts = @{}
    $total = 0
    $before = $null
    for ($page = 0; $page -lt 100; $page++) {
        $q = "/api/v1/audit?from=$from&to=$to&limit=200"
        if ($null -ne $before) { $q += "&before=$before" }
        $r = Invoke-Authed $q
        if ($r.Status -ne 200) {
            $code = Get-Prop $r.Json 'error'
            if (-not ($code -is [string] -and $code -match '^[A-Z_]{1,64}$')) { $code = "HTTP_$($r.Status)" }
            return [ordered]@{ error = $code }
        }
        foreach ($rec in @(Get-Prop $r.Json 'records')) {
            if ($null -eq $rec) { continue }
            $a = Get-Prop $rec 'action'
            if (-not ($a -is [string] -and $a -match '^[a-z0-9._-]{1,64}$')) { $a = 'other' }
            $counts[$a] = 1 + $(if ($counts.ContainsKey($a)) { $counts[$a] } else { 0 })
            $total++
        }
        $before = Get-Number (Get-Prop $r.Json 'next')
        if ($null -eq $before) { break }
    }
    $sorted = [ordered]@{}
    foreach ($k in ($counts.Keys | Sort-Object)) { $sorted[$k] = $counts[$k] }
    return [ordered]@{ from = $from; to = $to; total = $total; counts = $sorted }
}

function Write-Sample($Line) {
    $dir = Join-Path $OutDir $Site
    $null = New-Item -ItemType Directory -Force -Path $dir
    $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) + '.jsonl')
    $text = ($Line | ConvertTo-Json -Depth 6 -Compress) + "`n"
    [System.IO.File]::AppendAllText($file, $text, [System.Text.UTF8Encoding]::new($false))
    return $file
}

function Disconnect-Device {
    if ($script:token) {
        try { $null = Invoke-MatApi 'POST' '/api/v1/auth/logout' $null $script:token } catch { Write-Verbose 'logout failed' }
        $script:token = ''
    }
}

function Invoke-Collect([bool]$WithAudit) {
    $line = Get-Sample
    if ($WithAudit) { $line['audit'] = Get-AuditSummary }
    $file = Write-Sample $line
    Write-Host "$($line.t) sample -> $file"
}

if ($isHttps -and $Insecure) { Write-Warning '-Insecure: the device certificate is not checked' }

if ($Once) {
    try {
        Invoke-Collect (-not $NoAudit)
    } catch {
        Write-Error "collect failed: $($_.Exception.Message)" -ErrorAction Continue
        exit 1
    } finally {
        Disconnect-Device
    }
    exit 0
}

# Loop: one sample every -IntervalMin on the clock (hh:00, hh:15, ...), the audit summary every -AuditEveryMin.
$lastAudit = [datetime]::MinValue
while ($true) {
    $now = Get-Date
    $withAudit = (-not $NoAudit) -and (($now - $lastAudit).TotalMinutes -ge ($AuditEveryMin - 1))
    try {
        Invoke-Collect $withAudit
        if ($withAudit) { $lastAudit = $now }
    } catch {
        # Device or network down: no line (a data gap for kpi.mjs); try again at the next slot.
        Write-Warning "collect failed: $($_.Exception.Message)"
        $script:token = ''
    }
    $slot = $IntervalMin * 60
    $epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    Start-Sleep -Seconds ([int]($slot - ($epoch % $slot)))
}
