# Kiem tich hop x64 cua feature 007 (specs/007-screens-widgets T049, T073, T085, T094, T133; quickstart §3).
# Dung: ./tools/web-it.ps1 -Scenario control,locks,attack,session,expect,pulse [-Rounds 20] [-Keep] [-NoBuild]
#        [-BuildDir C:\build\mat-x64-<ten>]
#   control:      ghi tung loai Tag bang phien web (cookie + CSRF): moi ket qua, 0 lenh gui hai lan, audit channel web + context.
#   locks:        viewer, chua dang nhap, HTTP, Tag chi doc, mat ket noi PLC: khoa va ly do dung, 0 lenh toi gia lap.
#   attack:       30 ca tan cong cua contracts/web-session.md §5 (A26, A27 o attack-accounts, A28 o session28).
#   gate:         cong xem theo nguon mang va viewerLogin (off / required): /login, assets/login-*, device.crt khong bi loc;
#                 nguon cong cong 403 khi viewerAccess private; required: 302 /login, du lieu 401, WebSocket 401, phien thi vao duoc.
#   attack-accounts: A26 (khoa tam), A27 (quota 8 phien) - doi trang thai tai khoan: chay rieng.
#   session:      vong doi phien, thuoc tinh cookie, touch, logout, loi dang nhap; session28 = A28 (doi mat khau bang CLI).
#   expect:       hai client cung dao false -> true: mot CONFIRMED, mot STALE_EXPECTATION.
#   pulse:        -Rounds xung 500 ms, dong trang ngay sau ACCEPTED; pulse-kill: kill -9 giua luc cho xung.
#   screens, widgets, chrome-control, f5x10, open: Chrome that (puppeteer-core) vao runtime x64 qua 127.0.0.1:18443;
#                 open dung project tests/web-it/projects/big-250 (SC-002); f5x10 la 10 phien F5 cung luc (SC-003).
#   charts:       8 bieu do duong x 8 duong, 3.600 s, lay mau 250 ms, chay -Seconds (mac dinh 300): bo nho tab, p95 khung hinh.
#   full:         client thu 11 (maxClients 10): banner Day, khong dung nua chung, thu lai duoc khi co cho.
#   deploy-live:  nap xuong khi 10 trang dang xem va 1 lenh xung dang cho: trang tu tai lai giu man hinh, phien con, lenh co dong ket qua.
#   cert:         chung chi moi co SAN IP; device.crt khong co khoa; CA thu ky CSR -> nhap -> client TLS nghiem ngat tin;
#                 nhap chung chi sai bi tu choi, chung chi cu con nguyen.
#   compat:       tank-demo (0.1) va modbus-demo (0.2) chay nhu cu tren trang moi; ban nang cap 0.3 cho cung cau truc DOM
#                 (uid va ten thuoc tinh cua phan tu SVG gan binding; SC-011, khong co anh chup tu runtime 0.5).
#   bundle:       build trang runtime, cong kich thuoc <= 250 KB gzip, khong eval (apps/runtime-web/scripts/package-web.mjs);
#                 feature 008: @mat/svg-import khong co trong goi cua trang (SC-022). Ket qua: docs/reports/008-bundle-x64.json.
#   feature 008 (specs/008-svg-import-binding T084, T107, T108; ket qua docs/reports/008-<kich ban>-x64.json):
#   svg:          project svg-demo: moi dich binding doi dung theo Tag (gia lap Modbus tat dinh), DOM va kieu hien thi giong ban "xem truoc"
#                 (cung <mat-screen>/DomApplier chay tren runtime gia, cung gia tri Tag), SC-006.
#   svg-events:   nhap phan tu SVG -> xac nhan -> ghi -> CONFIRMED; audit channel web, context.widget = elementUid; khoa; 30 ca tan cong
#                 cua 007 voi lenh mang context cua phan tu SVG; xung dong trinh duyet ngay (bit tra ve), SC-013.
#   open-svg:     man hinh chuan 3b (3.000 phan tu, 30 binding, 10 hoat anh, 5 su kien, 100 Tag) va 40 item svg: tu luc mo trang toi gia tri song.
#   f5x10-svg:    10 phien F5 cung luc tren man hinh chuan 3b.
#   load-svg:     10 trang Chrome xem man hinh chuan 3b + 500 Tag mo phong/1 s trong -Seconds: CPU, RSS cua mat-runtime, mat sequence.
#   compat (008): them anh chup <= 0,5 % giua project goc va ban nang cap; so x64 loopback KHONG thay so BL335 (T123, T124).
#   -Isolated:    rig rieng (project docker w3b-it, mang 172.30.37/203.0.37, cong 28080/28443/28503) de chay song song voi rig khac.
#   history-10:   (010, T091) 10 phien Chrome cung F5 man hinh 4 bieu do lich su: du lieu <= 10 s, 0 mat live, 0 mat sequence;
#                 mac dinh chay tren runtime gia (khong docker); dat MAT_IT_BASE=https://127.0.0.1:18443 de chay x64 that.
#   reports:      (010, T105) e2e bao cao tren runtime gia: 100% o khop history-ref, CSV/XLSX/PDF khop man hinh.
# Mang, container: tests/web-it/compose.yaml. Mat khau thu sinh ngau nhien moi lan chay (--password-stdin), khong ghi file.
# Ket qua: docs/reports/007-<scenario>-x64.json. Don khi dung -Keep: docker compose -f tests/web-it/compose.yaml -p mat-web-it down -v
# (Thong bao in ra khong dau: Windows PowerShell 5.1 doc file .ps1 khong BOM theo codepage ANSI.)
param(
    [ValidateSet('control', 'locks', 'attack', 'attack-accounts', 'gate', 'session', 'session28', 'expect', 'pulse', 'pulse-kill', 'screens', 'widgets', 'chrome-control', 'f5x10', 'full', 'deploy-live', 'open', 'charts', 'cert', 'compat', 'bundle', 'svg', 'svg-events', 'open-svg', 'f5x10-svg', 'load-svg', 'uid-roundtrip', 'compare-tank', 'history-10', 'reports')][string[]]$Scenario = @('control'),
    [int]$Rounds = 20,
    [int]$Seconds = 300,
    [switch]$Keep,
    [string]$BuildDir = '',
    [switch]$NoBuild,
    [switch]$Isolated,
    [int]$Slot = 0
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
$root = (Resolve-Path "$PSScriptRoot/..").Path
. "$PSScriptRoot/lib/platform.ps1"
if (-not $BuildDir) { $BuildDir = Get-MatBuildDir 'mat-x64-e2' }
$compose = "$root/tests/web-it/compose.yaml"
$utf8 = New-Object Text.UTF8Encoding $false
$project = 'mat-web-it'
# -Isolated: rig rieng; moi slot la mot rig (compare-tank can hai rig cung luc: slot 0 va 1)
function Use-Slot([int]$n) {
    $script:project = 'w3b-it' + $(if ($n -gt 0) { "$n" } else { '' })
    $env:MAT_IT_LAN = "172.30.$(37 + $n)"
    $env:MAT_IT_PUB = "203.0.$(37 + $n)"
    $env:MAT_IT_HTTP_PORT = "$(28080 + 10 * $n)"
    $env:MAT_IT_HTTPS_PORT = "$(28443 + 10 * $n)"
    $env:MAT_IT_SIM_PORT = "$(28503 + 10 * $n)"
    $script:rt = "$($script:project)-rt-1"
    $script:client = "$($script:project)-client-1"
}
if ($Isolated) { Use-Slot $Slot }
$rt = "$project-rt-1"
$client = "$project-client-1"
$bin = '/build/x64/bin/mat-runtime'

function New-Secret([int]$Length) {
    $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $bytes = New-Object byte[] $Length
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Wait-Until([scriptblock]$Cond, [int]$TimeoutS, [string]$What) {
    $deadline = (Get-Date).AddSeconds($TimeoutS)
    while ((Get-Date) -lt $deadline) {
        $v = & $Cond
        if ($v) { return $v }
        Start-Sleep -Milliseconds 500
    }
    throw "timeout waiting for $What"
}

function Build-Runtime {
    docker build -q -t mat-armhf "$root/deployment/toolchain" | Out-Null
    if ($LASTEXITCODE) { throw 'docker build failed' }
    New-Item -ItemType Directory -Force $BuildDir | Out-Null
    $bname = if ($Isolated) { @('--name', 'w3b-build') } else { @() }
    docker run --rm @bname -v "${root}:/src" -v "${BuildDir}:/build" mat-armhf sh -c 'cmake -S . -B /build/x64 -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null && cmake --build /build/x64 --target mat-runtime -j 2'
    if ($LASTEXITCODE) { throw 'build failed' }
}

function Build-Web {
    Push-Location $root
    npm run build -w '@mat/runtime-web' 2>&1 | Out-Host
    $rc = $LASTEXITCODE
    Pop-Location
    if ($rc) { throw 'runtime-web build failed (size gate or build error)' }
}

function Start-Rig([string]$ProjectPath, [string]$Map) {
    $env:MAT_IT_BUILD = $BuildDir
    $env:MAT_IT_PROJECT = $ProjectPath
    $env:MAT_IT_MAP = "/src/tools/modbus-sim/maps/$Map.json"
    docker compose -f $compose -p $project down -v *> $null
    Start-Sleep -Seconds 4 # cho cong loopback duoc giai phong han truoc khi mo rig moi
    Write-Host "starting rt ($ProjectPath), sim ($Map) and the Node client..."
    docker compose -f $compose -p $project up -d 2>&1 | Out-Null
    if ($LASTEXITCODE) { throw 'compose up failed' }
    Wait-Until {
        docker exec $rt grep -q 'https ok on :8443' /logs/runtime.log 2>$null
        $LASTEXITCODE -eq 0
    } 60 'rt HTTPS' | Out-Null
}

function Stop-Rig {
    if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    Remove-Item Env:MAT_IT_PW_ADMIN, Env:MAT_IT_PW_KYSU1, Env:MAT_IT_PW_VH1, Env:MAT_IT_PW_VH2, Env:MAT_IT_PW_XEM1, Env:MAT_IT_BUILD, Env:MAT_IT_PROJECT, Env:MAT_IT_MAP -ErrorAction SilentlyContinue
}

function New-Accounts {
    $env:MAT_IT_PW_ADMIN = New-Secret 24
    $env:MAT_IT_PW_KYSU1 = New-Secret 24
    $env:MAT_IT_PW_VH1 = New-Secret 24
    $env:MAT_IT_PW_VH2 = New-Secret 24
    $env:MAT_IT_PW_XEM1 = New-Secret 24
    foreach ($a in @(@('admin', 'administrator', 'MAT_IT_PW_ADMIN'), @('kysu1', 'engineer', 'MAT_IT_PW_KYSU1'), @('vh1', 'operator', 'MAT_IT_PW_VH1'), @('vh2', 'operator', 'MAT_IT_PW_VH2'), @('xem1', 'viewer', 'MAT_IT_PW_XEM1'))) {
        $out = docker exec -e $a[2] $rt sh /src/tests/device-it/add-user.sh $a[0] $a[1] $a[2] 2>&1
        if ($LASTEXITCODE) { throw "--user-add $($a[0]) failed: $out" }
    }
}

function Get-Fingerprint {
    $line = docker exec $rt $bin --cert-fingerprint --data-dir /data | Select-String 'Fingerprint='
    if (-not $line) { throw '--cert-fingerprint failed' }
    return ($line.ToString() -replace '^.*=', '' -replace ':', '').ToLower()
}

# Restarts the runtime (the supervision loop starts it again): memory state (locks, sessions) is clean.
function Restart-Runtime {
    $before = [int](docker exec $rt sh -c "grep -c 'https ok on :8443' /logs/runtime.log")
    docker exec $rt sh -c 'kill -TERM $(cat /run/mat-runtime.pid)' | Out-Null
    Wait-Until { [int](docker exec $rt sh -c "grep -c 'https ok on :8443' /logs/runtime.log") -gt $before } 60 'rt restart' | Out-Null
    Start-Sleep -Milliseconds 1500
}

function Invoke-Client([string[]]$ClientArgs, [string]$Fp) {
    $out = docker exec -e MAT_IT_PW_ADMIN -e MAT_IT_PW_KYSU1 -e MAT_IT_PW_VH1 -e MAT_IT_PW_VH2 -e MAT_IT_PW_XEM1 `
        $client node --no-warnings /src/tests/web-it/web-it.mjs @ClientArgs --fp $Fp
    $line = ($out | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "client $ClientArgs wrote no result: $out" }
    return $line | ConvertFrom-Json
}

function Invoke-Browser([string]$Name, [string[]]$Extra = @()) {
    $out = node "$root/tests/web-it/browser.mjs" $Name @Extra 2>&1
    $line = ($out | Where-Object { "$_".Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) {
        # Chrome không khởi động được (hiếm, khi máy dev đang bận): thử lại một lần
        Start-Sleep -Seconds 5
        $out = node "$root/tests/web-it/browser.mjs" $Name @Extra 2>&1
        $line = ($out | Where-Object { "$_".Trim().StartsWith('{') } | Select-Object -Last 1)
    }
    if (-not $line) { throw "browser $Name wrote no result: $($out -join ' ')" }
    return $line | ConvertFrom-Json
}

# Chay mot script Node tren may dev (khong trong container) va doc dong JSON cuoi cung.
function Invoke-Host([string]$Script, [string[]]$Extra = @()) {
    $out = node "$root/$Script" @Extra 2>&1
    $line = ($out | Where-Object { "$_".Trim().StartsWith('{') } | Select-Object -Last 1)
    if (-not $line) { throw "$Script wrote no result: $($out -join ' ')" }
    return $line | ConvertFrom-Json
}

function Write-Result([string]$Name, $Result, [string]$Prefix = '007') {
    $json = $Result | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText("$root/docs/reports/$Prefix-$Name-x64.json", $json + "`n", $utf8)
    $bad = @($Result.checks | Where-Object { -not $_.pass })
    Write-Host ("{0}: {1} checks, {2} failed" -f $Name, @($Result.checks).Count, $bad.Count)
    foreach ($b in $bad) { Write-Host ("  FAIL {0}: {1}" -f $b.name, $b.detail) -ForegroundColor Red }
    if ($Result.measures) { Write-Host ("  measures: " + ($Result.measures | ConvertTo-Json -Depth 4 -Compress)) }
    if ($Result.pass) { Write-Host "$Name scenario PASS" -ForegroundColor Green }
    else { Write-Host "$Name scenario FAILED" -ForegroundColor Red }
}

function Add-Check([System.Collections.ArrayList]$List, [string]$Name, [bool]$Pass, [string]$Detail = '') {
    [void]$List.Add([pscustomobject]@{ name = $Name; pass = $Pass; detail = $Detail })
}

# Certificate scenario (US5, SC-019 x64): the CLI is driven from here, a strict TLS client in the container checks.
function Invoke-CertScenario {
    $c = New-Object System.Collections.ArrayList
    $info = docker exec $rt $bin --cert-info --data-dir /data 2>&1 | Out-String
    Add-Check $c 'cert-info: shows the IP SAN of the cards and the host name' (($info -match '172\.30\.7\.10') -and ($info -match 'rt')) $info.Trim()
    Add-Check $c 'cert-info: no private key in the output' (-not ($info -match 'PRIVATE KEY')) ''
    $text = docker exec $client node --no-warnings -e "const https=require('https');https.get('https://rt:8443/device.crt',{rejectUnauthorized:false},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>console.log(JSON.stringify({s:r.statusCode,t:r.headers['content-type'],d:r.headers['content-disposition'],b})))})"
    $o = $text | ConvertFrom-Json
    Add-Check $c 'device.crt: 200 application/x-x509-ca-cert, attachment' (($o.s -eq 200) -and ($o.t -match 'x-x509-ca-cert') -and ($o.d -match 'attachment')) "$($o.s) $($o.t) $($o.d)"
    Add-Check $c 'device.crt: exactly one CERTIFICATE block and never a key' ((([regex]::Matches($o.b, 'BEGIN CERTIFICATE')).Count -eq 1) -and -not ($o.b -match 'PRIVATE KEY')) ''
    $san = 'IP:127.0.0.1,IP:172.30.7.10,DNS:rt,DNS:mat.test'
    docker exec $rt sh -c "rm -rf /tmp/ca && mkdir /tmp/ca && cd /tmp/ca && openssl ecparam -name prime256v1 -genkey -noout -out ca.key && openssl req -x509 -new -key ca.key -sha256 -out ca.pem -days 30 -subj '/CN=MAT Test CA' >/dev/null 2>&1" | Out-Null
    $mk = docker exec $rt $bin --make-csr --san '127.0.0.1,172.30.7.10,rt,mat.test' --out /tmp/ca/mat.csr --data-dir /data 2>&1 | Out-String
    Add-Check $c 'make-csr: request written (the key stays on the device)' ($mk -match 'mat.csr') $mk.Trim()
    $sign = docker exec $rt sh -c "cd /tmp/ca && printf 'subjectAltName=$san\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n' > ext.cnf && openssl x509 -req -in mat.csr -CA ca.pem -CAkey ca.key -sha256 -CAcreateserial -out leaf.pem -days 30 -extfile ext.cnf 2>&1 && cat leaf.pem ca.pem > chain.pem" 2>&1 | Out-String
    Add-Check $c 'the test CA signs the request' ($sign -match 'Signature ok') $sign.Trim()
    $oldFp = Get-Fingerprint
    docker exec $rt sh -c "cd /tmp/ca && openssl req -x509 -newkey rsa:2048 -nodes -keyout other.key -out other.pem -days 30 -subj '/CN=other' >/dev/null 2>&1" | Out-Null
    $badOut = docker exec $rt $bin --import-cert /tmp/ca/other.pem --data-dir /data 2>&1 | Out-String
    $badRc = $LASTEXITCODE
    Add-Check $c 'import of a certificate that does not match the pending key: refused' ($badRc -ne 0) "rc=$badRc $($badOut.Trim())"
    docker exec $rt sh -c "cd /tmp/ca && cat ca.key leaf.pem > withkey.pem" | Out-Null
    $kOut = docker exec $rt $bin --import-cert /tmp/ca/withkey.pem --data-dir /data 2>&1 | Out-String
    Add-Check $c 'import of a file that holds a private key: refused' ($LASTEXITCODE -ne 0) $kOut.Trim()
    docker exec $rt sh -c "printf 'garbage' > /tmp/ca/junk.pem" | Out-Null
    $jOut = docker exec $rt $bin --import-cert /tmp/ca/junk.pem --data-dir /data 2>&1 | Out-String
    Add-Check $c 'import of a corrupt file: refused' ($LASTEXITCODE -ne 0) $jOut.Trim()
    Add-Check $c 'the old certificate is untouched after every refusal' ((Get-Fingerprint) -eq $oldFp) ''
    $imp = docker exec $rt $bin --import-cert /tmp/ca/chain.pem --data-dir /data 2>&1 | Out-String
    Add-Check $c 'import of the CA-signed chain: accepted' ($LASTEXITCODE -eq 0) $imp.Trim()
    Restart-Runtime
    $newFp = Get-Fingerprint
    Add-Check $c 'the fingerprint changed to the imported certificate' ($newFp -ne $oldFp) ''
    $info2 = docker exec $rt $bin --cert-info --data-dir /data 2>&1 | Out-String
    Add-Check $c 'cert-info names the test CA as issuer, and the SAN' (($info2 -match 'MAT Test CA') -and ($info2 -match 'mat\.test')) $info2.Trim()
    $caPem = (docker exec $rt cat /tmp/ca/ca.pem) -join "`n"
    $js = "const tls=require('tls');const s=tls.connect({host:'rt',port:8443,ca:process.env.CA,servername:'rt'},()=>{console.log(JSON.stringify({ok:s.authorized,err:s.authorizationError||null}));s.end()});s.on('error',e=>{console.log(JSON.stringify({ok:false,err:e.code}));});"
    $v = docker exec -e "CA=$caPem" $client node --no-warnings -e $js | ConvertFrom-Json
    Add-Check $c 'strict TLS client with the test CA as trust anchor: certificate valid for host rt (no warning)' ($v.ok -eq $true) "$($v.err)"
    $v2 = docker exec $client node --no-warnings -e "const tls=require('tls');const s=tls.connect({host:'rt',port:8443,servername:'rt'},()=>{console.log(JSON.stringify({ok:s.authorized}));s.end()});s.on('error',e=>{console.log(JSON.stringify({ok:false}));});" | ConvertFrom-Json
    Add-Check $c 'without the CA the same client refuses the certificate (the CA is what makes it trusted)' ($v2.ok -eq $false) ''
    return [pscustomobject]@{ scenario = 'cert'; checks = $c.ToArray(); measures = @{ oldFp = $oldFp.Substring(0, 12); newFp = $newFp.Substring(0, 12) }; pass = -not (@($c | Where-Object { -not $_.pass }).Count) }
}

$failed = @()
$compat8 = @{}
try {
    # history-10 va reports (feature 010) chay tren runtime gia (khong docker) tru khi dat MAT_IT_BASE (runtime x64 that).
    $only010 = -not [bool]($Scenario | Where-Object { $_ -notin @('history-10', 'reports') })
    if (-not $NoBuild -and -not $only010) { Build-Runtime }
    $needWeb = $Scenario | Where-Object { $_ -in @('screens', 'widgets', 'chrome-control', 'f5x10', 'open', 'bundle', 'svg', 'svg-events', 'open-svg', 'f5x10-svg', 'load-svg', 'compat') }
    $needMain = $Scenario | Where-Object { $_ -in @('control', 'locks', 'attack', 'attack-accounts', 'gate', 'session', 'session28', 'expect', 'pulse', 'pulse-kill', 'screens', 'widgets', 'chrome-control', 'f5x10', 'full', 'deploy-live', 'cert', 'charts') }
    $needBig = $Scenario | Where-Object { $_ -in @('open', 'charts') }
    if (-not $NoBuild -and ($needWeb -or $needMain)) { Build-Web }
    if ($Scenario -contains 'history-10' -or $Scenario -contains 'reports') {
        if (-not $NoBuild -and -not $env:MAT_IT_BASE) {
            Push-Location "$root/apps/runtime-web"
            npx vite build --mode e2e | Out-Null
            Pop-Location
        }
        if ($Scenario -contains 'history-10') {
            # 10 phien Chrome cung F5 man hinh 4 bieu do lich su (T091); ghi docs/reports/010-history-10-{fake,x64}.json
            Write-Host '--- history-10'
            $h10 = @("$root/tests/web-it/browser-010.mjs", 'history-10')
            if ($env:MAT_IT_BASE) { $h10 += @('--base', $env:MAT_IT_BASE) }
            node @h10
            if ($LASTEXITCODE -ne 0) { $failed += 'history-10' }
        }
        if ($Scenario -contains 'reports') {
            # e2e bao cao (T105) tren runtime gia: 100% o khop history-ref, CSV/XLSX/PDF khop man hinh
            Write-Host '--- reports'
            Push-Location "$root/apps/runtime-web"
            node tests/e2e/run.mjs reports
            $rc = $LASTEXITCODE
            Pop-Location
            if ($rc -ne 0) { $failed += 'reports' }
        }
    }
    if ($Scenario -contains 'bundle') {
        Write-Host '--- bundle'
        # package-web.mjs is run here again on the built folder: it fails over 250 KB gzip or when eval / innerHTML is found
        Push-Location "$root/apps/runtime-web"
        $bundleOut = node scripts/package-web.mjs 2>&1 | Out-String
        $bundleRc = $LASTEXITCODE
        Pop-Location
        Write-Host $bundleOut
        $startup = [regex]::Match($bundleOut, 'KH.I.*?\(JS\+CSS\):\s+([\d.,]+) KB').Groups[1].Value
        # feature 008 (SC-022): the importer package must not be in the page bundle (checked here again, independently of package-web.mjs)
        $traces = @(Get-ChildItem "$root/apps/runtime-web/dist-device", "$root/apps/runtime-web/dist" -Recurse -Filter *.js | Select-String -Pattern 'E_IMPORT_|W_IMPORT_|C_ENTITY|C_SWITCH|importSvg|matchSvg' -List | ForEach-Object { $_.Path })
        $deps = Get-Content "$root/apps/runtime-web/package.json" -Raw
        $checks = @(
            [pscustomobject]@{ name = 'startup JS+CSS <= 250 KB gzip, no eval / new Function / innerHTML (package-web.mjs exit 0)'; pass = ($bundleRc -eq 0); detail = "exit $bundleRc, startup $startup KB" },
            [pscustomobject]@{ name = '@mat/svg-import is not in the page bundle (no importer traces in dist-device or dist js)'; pass = ($traces.Count -eq 0); detail = "$($traces.Count) file(s) with traces" },
            [pscustomobject]@{ name = 'apps/runtime-web does not depend on @mat/svg-import'; pass = ($deps -notmatch 'svg-import'); detail = '' }
        )
        $ok = -not (@($checks | Where-Object { -not $_.pass }).Count)
        $r = [pscustomobject]@{ scenario = 'bundle'; checks = $checks; measures = @{ startupKB = $startup }; pass = $ok }
        Write-Result 'bundle' $r '008'
    }
    node "$root/tests/web-it/make-projects.mjs" | Out-Null
    $order = @('control', 'locks', 'expect', 'pulse', 'session', 'attack', 'screens', 'widgets', 'chrome-control', 'f5x10', 'full', 'cert', 'pulse-kill', 'gate', 'deploy-live', 'attack-accounts', 'session28')
    $todo = @($order | Where-Object { $Scenario -contains $_ })
    if ($todo.Count) {
        Start-Rig '/src/projects/dashboard-demo' 'modbus-demo'
        New-Accounts
        foreach ($s in $todo) {
            Write-Host "--- $s"
            Restart-Runtime
            $fp = Get-Fingerprint
            if ($s -in @('screens', 'widgets', 'chrome-control', 'f5x10', 'full')) {
                $res = Invoke-Browser $s
            }
            elseif ($s -eq 'deploy-live') {
                $res = Invoke-Browser $s @('--fp', $fp)
            }
            elseif ($s -eq 'cert') {
                $res = Invoke-CertScenario
            }
            elseif ($s -eq 'gate') {
                $a = Invoke-Client @('gate', '--mode', 'private') $fp
                docker exec $rt sh -c "printf -- '--viewer-login
required
' > /data/extra-args" | Out-Null
                Restart-Runtime
                $b = Invoke-Client @('gate', '--mode', 'required') (Get-Fingerprint)
                docker exec $rt sh -c 'rm -f /data/extra-args' | Out-Null
                $checks = @($a.checks) + @($b.checks)
                $res = [pscustomobject]@{ scenario = 'gate'; checks = $checks; measures = @{}; pass = -not (@($checks | Where-Object { -not $_.pass }).Count) }
            }
            elseif ($s -eq 'attack-accounts') {
                $a = Invoke-Client @('attack-accounts', '--part', 'lock') $fp
                Restart-Runtime
                $b = Invoke-Client @('attack-accounts', '--part', 'quota') (Get-Fingerprint)
                $checks = @($a.checks) + @($b.checks)
                $res = [pscustomobject]@{ scenario = 'attack-accounts'; checks = $checks; measures = @{}; pass = -not (@($checks | Where-Object { -not $_.pass }).Count) }
            }
            elseif ($s -eq 'session28') {
                $a = Invoke-Client @('session', '--step', 'prep28') $fp
                $env:MAT_IT_PW_VH1_NEW = New-Secret 24
                $null = docker exec -e MAT_IT_PW_VH1_NEW $rt sh -c "printf '%s\n' `"`$MAT_IT_PW_VH1_NEW`" | $bin --user-passwd vh1 --password-stdin --users-file /etc/mat-runtime/users.json --data-dir /data" 2>&1
                $pwdRc = $LASTEXITCODE
                Start-Sleep -Seconds 2
                $b = Invoke-Client @('session', '--step', 'check28') $fp
                Remove-Item Env:MAT_IT_PW_VH1_NEW -ErrorAction SilentlyContinue
                $checks = @($a.checks) + @($b.checks) + @([pscustomobject]@{ name = 'CLI --user-passwd succeeded'; pass = ($pwdRc -eq 0); detail = "rc=$pwdRc" })
                $res = [pscustomobject]@{ scenario = 'session28'; checks = $checks; measures = @{}; pass = -not (@($checks | Where-Object { -not $_.pass }).Count) }
            }
            else {
                $a = @($s)
                if ($s -in @('pulse', 'pulse-kill')) { $a += @('--rounds', "$(if ($s -eq 'pulse-kill' -and -not $PSBoundParameters.ContainsKey('Rounds')) { 5 } else { $Rounds })") }
                $res = Invoke-Client $a $fp
            }
            Write-Result $s $res
            if (-not $res.pass) { $failed += $s }
        }
        if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    }
    # feature 008 (T084, T107, T108): mỗi kịch bản một rig riêng (project, giả lập Modbus), kết quả docs/reports/008-<tên>-x64.json
    $svgRuns = @('svg', 'svg-events', 'open-svg', 'f5x10-svg', 'load-svg') | Where-Object { $Scenario -contains $_ }
    if ($svgRuns) { node "$root/tests/web-it/make-svg-projects.mjs" | Out-Host }
    foreach ($s in $svgRuns) {
        Write-Host "--- $s"
        $stepMap = @{
            'svg' = @(@('/src/projects/svg-demo', 'main'), @('/src/tests/web-it/out/spin-tr', 'spin'))
            'svg-events' = ,@('/src/projects/svg-demo', '')
            'open-svg' = @(@('/src/tests/web-it/out/std-3b', 'std'), @('/src/tests/web-it/out/svg-40', '40'))
            'f5x10-svg' = ,@('/src/tests/web-it/out/std-3b', '')
            'load-svg' = ,@('/src/tests/web-it/out/load-3b', '')
        }
        $steps = $stepMap[$s]
        $checks = @()
        $measures = @{}
        foreach ($st in $steps) {
            Start-Rig $st[0] 'modbus-demo'
            New-Accounts
            Restart-Runtime
            $fp = Get-Fingerprint
            if ($s -eq 'svg') { $part = Invoke-Browser 'svg' @('--part', $st[1]) }
            elseif ($s -eq 'svg-events') {
                $a = Invoke-Client @('svg-attack') $fp
                $checks += @($a.checks)
                $measures['attack'] = $a.measures
                Restart-Runtime
                $part = Invoke-Browser 'svg-events' @('--fp', (Get-Fingerprint))
                # A26, A27 (khóa tạm, quota phiên) và A28 (đổi mật khẩu bằng CLI hủy phiên): không mang lệnh ghi, chạy như 007; đổi trạng thái tài khoản nên ở cuối
                Restart-Runtime
                $c1 = Invoke-Client @('attack-accounts', '--part', 'lock') (Get-Fingerprint)
                Restart-Runtime
                $c2 = Invoke-Client @('attack-accounts', '--part', 'quota') (Get-Fingerprint)
                Restart-Runtime
                $fp28 = Get-Fingerprint
                $c3 = Invoke-Client @('session', '--step', 'prep28') $fp28
                $env:MAT_IT_PW_VH1_NEW = New-Secret 24
                $null = docker exec -e MAT_IT_PW_VH1_NEW $rt sh -c "printf '%s\n' `"`$MAT_IT_PW_VH1_NEW`" | $bin --user-passwd vh1 --password-stdin --users-file /etc/mat-runtime/users.json --data-dir /data" 2>&1
                $pwdRc = $LASTEXITCODE
                Start-Sleep -Seconds 2
                $c4 = Invoke-Client @('session', '--step', 'check28') $fp28
                Remove-Item Env:MAT_IT_PW_VH1_NEW -ErrorAction SilentlyContinue
                $checks += @($c1.checks) + @($c2.checks) + @($c3.checks) + @($c4.checks) + @([pscustomobject]@{ name = 'A28: CLI --user-passwd succeeded'; pass = ($pwdRc -eq 0); detail = "rc=$pwdRc" })
            }
            elseif ($s -eq 'open-svg') { $part = Invoke-Browser 'open-svg' @('--which', $st[1]) }
            elseif ($s -eq 'f5x10-svg') { $part = Invoke-Browser 'f5x10-svg' }
            else { $part = Invoke-Browser 'load-svg' @('--seconds', "$Seconds", '--client', $client) }
            $checks += @($part.checks)
            foreach ($k in $part.measures.PSObject.Properties) { $measures[$k.Name] = $k.Value }
        }
        $name = @{ 'svg' = 'svg'; 'svg-events' = 'svg-events'; 'open-svg' = 'open'; 'f5x10-svg' = 'f5x10'; 'load-svg' = 'load' }[$s]
        $res = [pscustomobject]@{ scenario = $s; checks = $checks; measures = $measures; pass = -not (@($checks | Where-Object { -not $_.pass }).Count) }
        Write-Result $name $res '008'
        if (-not $res.pass) { $failed += $s }
        if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    }
    if ($Scenario -contains 'uid-roundtrip') {
        # T103 (FR-029): Nap xuong (POST /project/deployments) roi Doc len (GET /project/package) qua API cua Studio, roi uid-roundtrip.mjs
        Write-Host '--- uid-roundtrip'
        Start-Rig '/src/projects/dashboard-demo' 'modbus-demo'
        New-Accounts
        Restart-Runtime
        $res = Invoke-Host 'tests/web-it/roundtrip-svg.mjs' @('--fp', (Get-Fingerprint))
        Write-Result 'uid-roundtrip' $res '008'
        if (-not $res.pass) { $failed += 'uid-roundtrip' }
        if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    }
    if ($Scenario -contains 'compare-tank') {
        # T095: tank-demo goc (slot 0) va ban dung lai bang Studio (slot 1) tren hai runtime x64, so dich binding bang compare-tank.mjs
        Write-Host '--- compare-tank'
        $rb = "$root/tests/web-it/out/rebuilt-tank"
        if (Test-Path $rb) { Remove-Item -Recurse -Force $rb }
        $env:MAT_REBUILD_OUT = $rb
        Push-Location "$root/apps/studio"
        npm run build:e2e 2>&1 | Out-Host
        node tests/e2e/run.mjs rebuild-tank 2>&1 | Out-Host
        Pop-Location
        Remove-Item Env:MAT_REBUILD_OUT -ErrorAction SilentlyContinue
        $cmp = New-Object System.Collections.ArrayList
        Add-Check $cmp 'Studio e2e rebuild-tank wrote the rebuilt project' (Test-Path "$rb/project.json") $rb
        Use-Slot 0
        Start-Rig '/src/projects/tank-demo' 'modbus-demo'
        Restart-Runtime
        $pj0 = $project
        Use-Slot 1
        Start-Rig '/src/tests/web-it/out/rebuilt-tank' 'modbus-demo'
        Restart-Runtime
        Start-Sleep -Seconds 10
        $cout = "$root/tests/web-it/out/compare-tank.json"
        $log = node "$root/tools/svg-demo/compare-tank.mjs" --baseline 'https://127.0.0.1:28443/' --rebuilt 'https://127.0.0.1:28453/' --out $cout 2>&1
        $log | Out-Host
        if (Test-Path $cout) {
            $cj = Get-Content -Raw $cout | ConvertFrom-Json
            foreach ($r in $cj.results) { Add-Check $cmp $r.name ([bool]$r.pass) "$($r.detail)" }
        }
        else { Add-Check $cmp 'compare-tank.mjs wrote a result' $false ($log -join ' ') }
        $res = [pscustomobject]@{ scenario = 'compare-tank'; checks = $cmp.ToArray(); measures = @{ samples = $cj.samples; tolerancePoints = $cj.tol }; pass = -not (@($cmp | Where-Object { -not $_.pass }).Count) }
        Write-Result 'compare-tank' $res '008'
        if (-not $res.pass) { $failed += 'compare-tank' }
        if (-not $Keep) {
            docker compose -f $compose -p $project down -v *> $null
            docker compose -f $compose -p $pj0 down -v *> $null
        }
    }
    if ($Scenario -contains 'compat') {
        # 007 (cau truc DOM: cu va ban nang cap) va 008 T107 SC-011 (so voi trang truoc 008: phan tu dich, gia tri binding, anh chup <= 0,5 %)
        Write-Host '--- compat'
        $cc = New-Object System.Collections.ArrayList
        $cdir = "$root/tests/web-it/out/compat"
        New-Item -ItemType Directory -Force $cdir | Out-Null
        $oldDist = (node "$root/tests/web-it/build-old-web.mjs" 'C:/build/w3b-old' | Select-Object -Last 1)
        Add-Check $cc 'old page (parent of the first 008 commit = 007, runtime 0.6) built from git' (Test-Path "$oldDist/index.html") $oldDist
        $httpsNow = if ($env:MAT_IT_HTTPS_PORT) { $env:MAT_IT_HTTPS_PORT } else { '18443' }
        foreach ($name in @('tank-demo', 'modbus-demo', 'dashboard-demo')) {
            $up = "$cdir/$name"
            if (Test-Path $up) { Remove-Item -Recurse -Force $up }
            node "$root/tools/project-validator/validate.mjs" --migrate "$root/projects/$name" --write $up | Out-Null
            Add-Check $cc "${name}: upgraded to 0.4 by the migration" (Test-Path "$up/project.json") ''
            $snaps = @()
            foreach ($src in @("/src/projects/$name", "/src/tests/web-it/out/compat/$name")) {
                $tag = if ($src -like "*/projects/*") { "old" } else { "0.4" }
                Start-Rig $src 'modbus-demo'
                New-Accounts
                Restart-Runtime
                # cong HTTPS cua may dev co the chua san sang ngay sau khi rig khoi dong (loi "Failed to fetch"): cho toi khi tra ve 200
                Wait-Until { (& $MatCurl -k -s -o $MatNull -w '%{http_code}' "https://127.0.0.1:$httpsNow/") -eq '200' } 60 'HTTPS tren may dev' | Out-Null
                # dashboard-demo (0.3) dung widget, khong co phan tu data-mat-uid: chi so voi trang truoc 008
                if ($name -ne 'dashboard-demo') {
                    $r = Invoke-Browser 'compat' @('--out', "$cdir/snap.json")
                    if (-not $r.pass) {
                        # trang khong dung kip tren rig vua dung (hiem, khong lap lai khi chay tay): thu lai mot lan va ghi vao bao cao
                        $compat8["retried $name $tag"] = ($r.checks | Where-Object { -not $_.pass } | ForEach-Object { $_.detail }) -join ' | '
                        Start-Sleep -Seconds 5
                        $r = Invoke-Browser 'compat' @('--out', "$cdir/snap.json")
                    }
                    foreach ($ck in $r.checks) { Add-Check $cc "${name} [$tag]: $($ck.name)" ([bool]$ck.pass) "$($ck.detail)" }
                    $snaps += (Get-Content -Raw "$cdir/snap.json")
                }
                if ($tag -eq 'old') {
                    $c8 = Invoke-Host 'tests/web-it/compat-008.mjs' @('--project', $name, '--old-dist', $oldDist, '--base', "https://127.0.0.1:$httpsNow")
                    foreach ($ck in $c8.checks) { Add-Check $cc "${name} [vs trang truoc 008]: $($ck.name)" ([bool]$ck.pass) "$($ck.detail)" }
                    $compat8[$name] = $c8.measures
                }
            }
            if ($snaps.Count -eq 2) { Add-Check $cc "${name}: old project and its 0.4 upgrade give the same SVG elements and attributes" ($snaps[0] -eq $snaps[1]) "$($snaps[0].Length) / $($snaps[1].Length) bytes" }
        }
        $res = [pscustomobject]@{ scenario = 'compat'; checks = $cc.ToArray(); measures = $compat8; pass = -not (@($cc | Where-Object { -not $_.pass }).Count) }
        Write-Result 'compat' $res '008'
        if (-not $res.pass) { $failed += 'compat' }
        if (-not $Keep) { docker compose -f $compose -p $project down -v *> $null }
    }
    if ($needBig) {
        Start-Rig '/src/tests/web-it/projects/big-250' 'modbus-demo'
        New-Accounts
        Restart-Runtime
        foreach ($b in @('open', 'charts') | Where-Object { $Scenario -contains $_ }) {
            Write-Host "--- $b"
            $res = if ($b -eq 'charts') { Invoke-Browser 'charts' @('--seconds', "$Seconds") } else { Invoke-Browser $b }
            Write-Result $b $res
            if (-not $res.pass) { $failed += $b }
        }
    }
}
finally {
    Stop-Rig
}
if ($failed.Count) {
    Write-Host ("FAILED: " + ($failed -join ', ')) -ForegroundColor Red
    exit 1
}
Write-Host 'web-it: all scenarios passed' -ForegroundColor Green
exit 0
