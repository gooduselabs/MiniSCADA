#!/bin/sh
# armhf smoke test under qemu-user, inside the toolchain image (tools/ci-local.ps1): the runtime
# built for the BL335 starts a project that logs to SQLite, writes rows, stops on SIGTERM, and its
# --check-history finds the file sound. x64 tests cannot see a fault of the 32-bit build: the SQLite
# heap overflow of 2026-10-11 (third_party/sqlite/PATCHES.md) only showed on the device.
# Feature 005 (T053): the first run makes tls/server.pem (0600) and opens HTTPS; the fingerprint of
# --cert-fingerprint is the one openssl s_client sees; a test account (random password through
# --password-stdin) signs in with curl -k and gets a token; no token → 401, engineer → audit 403,
# HTTP → 403; 5 wrong passwords lock the account; audit.db has the auth.login ok and lockout rows.
# Feature 005 (US4, T142–T146): GET /api/v1/diagnostics (viewer and above) answers with the numbers of /proc
# of the 32-bit build; --export-audit prints the whole log, the failed sign-ins, the lockout and its own
# audit.export row last, with no password.
# Usage (from /src): sh deployment/toolchain/smoke-armhf.sh [build dir, default build/armhf]
set -u
B=${1:-build/armhf}
S=$(mktemp -d /tmp/mat-smoke-XXXXXX)  # a copy: qemu-user reads the Windows bind mount badly
cp "$B/bin/mat-runtime" "$S/"
cp -r projects/tank-demo "$S/project"
cp -r schemas "$S/schemas"
mkdir -p "$S/web" "$S/data" "$S/etc"
HTTPS=18443
cat > "$S/rt.json" <<EOF
{ "port": 18099, "docroot": "$S/web", "projectDir": "$S/project", "schemasDir": "$S/schemas",
  "maxClients": 2, "simLoad": true, "threads": 4, "dataDir": "$S/data", "historianCommitMs": 1000,
  "httpsPort": $HTTPS, "usersFile": "$S/etc/users.json", "projectStoreDir": "$S/data/projects" }
EOF
QEMU="qemu-arm -L /usr/arm-linux-gnueabihf"
pid=
fail() {
  echo "armhf smoke: $1"
  cat "$S/out.log" 2>/dev/null
  [ -n "$pid" ] && kill -KILL "$pid" 2>/dev/null
  rm -rf "$S"
  exit 1
}

# Test account before the first start; the password never reaches a command line or a file.
PW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
printf '%s\n' "$PW" | $QEMU "$S/mat-runtime" --user-add smoke --role engineer --password-stdin \
  --users-file "$S/etc/users.json" --data-dir "$S/data" > "$S/user.log" 2>&1 ||
  { cat "$S/user.log"; fail "--user-add failed"; }

$QEMU "$S/mat-runtime" --config "$S/rt.json" > "$S/out.log" 2>&1 &
pid=$!  # qemu itself (not a subshell): SIGTERM reaches the runtime
i=0
until grep -q "https ok on :$HTTPS" "$S/out.log" 2>/dev/null; do
  i=$((i + 1))
  [ $i -le 60 ] || fail "HTTPS did not open on :$HTTPS"
  kill -0 $pid 2>/dev/null || fail "the runtime ended by itself"
  sleep 0.5
done

# Certificate made on the first run, owner-only.
[ -f "$S/data/tls/server.pem" ] || fail "no tls/server.pem"
mode=$(stat -c %a "$S/data/tls/server.pem")
[ "$mode" = 600 ] || fail "tls/server.pem has mode $mode, not 600"

# The fingerprint the device command prints is the one a TLS client sees.
fp_cli=$($QEMU "$S/mat-runtime" --cert-fingerprint --data-dir "$S/data" | grep "Fingerprint=")
fp_tls=$(openssl s_client -connect 127.0.0.1:$HTTPS < /dev/null 2>/dev/null |
  openssl x509 -noout -fingerprint -sha256)
[ -n "$fp_cli" ] && [ "$fp_cli" = "$fp_tls" ] ||
  fail "fingerprint differs: '$fp_cli' (--cert-fingerprint) vs '$fp_tls' (s_client)"

# Sign-in over HTTPS; the body goes through stdin, not the command line.
login=$(printf '{"user":"smoke","password":"%s"}' "$PW" |
  curl -sk --max-time 20 -H 'Content-Type: application/json' --data-binary @- \
    "https://127.0.0.1:$HTTPS/api/v1/auth/login")
echo "$login" | grep -Eq '"token":"[A-Za-z0-9_-]{20,}"' || fail "sign-in gave no token: $login"
echo "$login" | grep -q '"role":"engineer"' || fail "sign-in answer has no role: $login"
token=$(echo "$login" | sed -n 's/.*"token":"\([A-Za-z0-9_-]*\)".*/\1/p')

# Roles and refusals of the 32-bit build: no token → 401; an engineer may not read the audit (403);
# the engineering API over HTTP → 403 HTTPS_REQUIRED.
code() { curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
c=$(code "https://127.0.0.1:$HTTPS/api/v1/diagnostics")
[ "$c" = 401 ] || fail "diagnostics without a token gave $c, not 401"
c=$(code -H "Authorization: Bearer $token" "https://127.0.0.1:$HTTPS/api/v1/audit")
[ "$c" = 403 ] || fail "audit as engineer gave $c, not 403"
c=$(code "http://127.0.0.1:18099/api/v1/diagnostics")
[ "$c" = 403 ] || fail "diagnostics over HTTP gave $c, not 403"
# Diagnostics for an engineer: every block, numbers read from /proc by the armhf build.
diag=$(curl -sk --max-time 20 -H "Authorization: Bearer $token" "https://127.0.0.1:$HTTPS/api/v1/diagnostics")
for block in '"cpu":{' '"memory":{"runtimeRssBytes":[1-9]' '"disk":{' '"uptime":{' '"clients":{'   '"versions":{"api":"1.1.0"'; do
  echo "$diag" | grep -Eq "$block" || fail "diagnostics has no $block: $diag"
done
# Lockout: 5 wrong passwords, then the right one is refused with 429 AUTH_LOCKED.
for i in 1 2 3 4 5; do
  c=$(printf '{"user":"smoke","password":"%s-%s"}' "$PW" "$i" |
    code -H 'Content-Type: application/json' --data-binary @- "https://127.0.0.1:$HTTPS/api/v1/auth/login")
  [ "$c" = 401 ] || fail "wrong password $i gave $c, not 401"
done
locked=$(printf '{"user":"smoke","password":"%s"}' "$PW" |
  curl -sk --max-time 20 -H 'Content-Type: application/json' --data-binary @- \
    "https://127.0.0.1:$HTTPS/api/v1/auth/login")
echo "$locked" | grep -q '"AUTH_LOCKED"' || fail "no lockout after 5 wrong passwords: $locked"

sleep 8  # rows for the historian check below (10 s in all, as before)
kill -0 $pid 2>/dev/null || fail "the runtime ended by itself"
kill -TERM $pid
wait $pid
rc=$?
pid=
[ $rc -eq 0 ] || fail "stop exit $rc"
grep -q "historian:" "$S/out.log" || fail "no historian line"

# audit.db: the runtime closed it, so the WAL is checkpointed into the main file. No sqlite3 shell
# in the image: in the SQLite record of the row, channel, action, target (NULL: no bytes) and result
# lie next to each other, "https" "auth.login" "ok".
cat "$S/data/audit.db" "$S/data/audit.db-wal" 2>/dev/null | grep -aq "httpsauth.loginok" ||
  fail "audit.db has no auth.login ok row"
cat "$S/data/audit.db" "$S/data/audit.db-wal" 2>/dev/null | grep -aq "httpsauth.lockout" ||
  fail "audit.db has no auth.lockout row"
# The test password is nowhere in the data, the account file or the output (SC-005).
grep -rqaF "$PW" "$S/data" "$S/etc" "$S/out.log" "$S/user.log" && fail "the test password was found on disk"

$QEMU "$S/mat-runtime" --check-history --data-dir "$S/data" > "$S/check.log" 2>&1
rc=$?
cat "$S/check.log"
[ $rc -eq 0 ] || fail "--check-history exit $rc"
grep -Eq "van_hanh: [1-9][0-9]* rows" "$S/check.log" || fail "no rows written"
# --export-audit (US4-3): the whole log, oldest first; the failed sign-ins and the lockout are in it, the
# command's own audit.export row is last, and the test password is not.
$QEMU "$S/mat-runtime" --export-audit --data-dir "$S/data" > "$S/export.csv" 2> "$S/export.err" ||
  { cat "$S/export.err"; fail "--export-audit failed"; }
head -1 "$S/export.csv" | grep -q '^id,time,ts_ms,clock_ok,user,role,source,channel,action' ||
  fail "--export-audit has no header"
grep -q ',auth.login,,failed,AUTH_FAILED,' "$S/export.csv" || fail "--export-audit: no failed sign-in"
grep -q ',auth.lockout,' "$S/export.csv" || fail "--export-audit: no lockout"
tail -1 "$S/export.csv" | grep -q ',cli,cli,audit.export,' || fail "--export-audit: audit.export is not last"
grep -qaF "$PW" "$S/export.csv" && fail "the test password is in the audit export"
echo "armhf https: cert 0600, $fp_cli, sign-in token, 401/403 refusals, diagnostics, lockout, audit auth.login ok, --export-audit"
rm -rf "$S"
echo "armhf smoke: OK"
