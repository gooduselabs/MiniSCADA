#!/bin/sh
# Test of mat-updater (feature 011 T108; SC-021; FR-062, FR-063; contracts/update-package.md §4, §5)
# on a fake tree (MAT_OPT_ROOT), with a fake systemctl and a fake system/info, the real
# mat-update-verify and the packages of tests/update-vectors/out/updater/ (node
# tools/release/make-update.mjs --vectors --test --out, on the host). In a throw-away container:
#   docker run --rm -v "<repo>:/src" -v "<build>:/build" mat-armhf sh -c \
#     "tr -d '\r' < /src/deployment/device/tests/updater_test.sh > /tmp/t.sh && sh /tmp/t.sh"
# MAT_VERIFY_BIN: mat-update-verify of the container's architecture (default /build/x64/bin/...).
# Cases: the 8 steps of a good update; the package changed after the runtime's check (TOCTOU);
# the tar listing against files[]; a failed health check rolls back (≤ 90 s); a failed self-check
# stops before the switch; a strange request.json is ignored; one run per 5 minutes; .failed keeps
# one copy; keyset; manual rollback; kill -9 at 5 points of each step S1–S8 then recover: always
# the old or the new tree, complete (40 cases).
set -u
[ -f /.dockerenv ] || { echo "chỉ chạy trong container dùng một lần"; exit 2; }
SRC=/src
[ -f "$SRC/deployment/device/mat-updater.sh" ] || SRC=$(cd "$(dirname "$0")/../../.." && pwd)
UPDATER_SRC=$SRC/deployment/device/mat-updater.sh
VERIFY_BIN=${MAT_VERIFY_BIN:-/build/x64/bin/mat-update-verify}
case $(uname -m) in aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; armv7l) ARCH=armhf ;; *) ARCH=$(uname -m) ;; esac
PKGS=$SRC/tests/update-vectors/out/updater/$ARCH
[ -f "$PKGS/v101.matupdate" ] || { echo "thiếu $PKGS: chạy node tools/release/make-update.mjs --vectors --test --out"; exit 2; }
[ -x "$VERIFY_BIN" ] || { echo "thiếu $VERIFY_BIN: build mat-update-verify"; exit 2; }
[ -f "$UPDATER_SRC" ] || { echo "FAIL: thiếu deployment/device/mat-updater.sh"; exit 1; }

W=$(mktemp -d)
pass=0
failures=0
ok() { pass=$((pass + 1)); }
fail() { echo "FAIL: $*"; failures=$((failures + 1)); }
check() { if eval "$2"; then ok; else fail "$1"; fi; }

R=$W/root
ROOT=$R/opt/mat-runtime
DATA=$R/var/lib/mat-runtime
UPD=$DATA/update
STATE=$R/var/lib/mat-updater
ETC=$R/etc/mat-runtime
SVC=$W/svc

# fake systemctl: the service is "active" while $SVC/active exists and the tree has its binary
mkdir -p "$W/bin"
cat > "$W/bin/systemctl" <<EOF
#!/bin/sh
[ "\$1" = --no-block ] && { echo "\$*" >> "$SVC/queued"; exit 0; }
case "\$1" in
stop) rm -f "$SVC/active"; echo stop >> "$SVC/log" ;;
start) echo start >> "$SVC/log"; [ -x "$ROOT/bin/mat-runtime" ] || exit 1; touch "$SVC/active" ;;
is-active) [ -f "$SVC/active" ] ;;
*) exit 0 ;;
esac
EOF
# fake system/info: from the tree's build-info.json; BROKEN never answers
cat > "$W/bin/fetch" <<EOF
#!/bin/sh
[ -f "$SVC/active" ] || exit 4
grep -q BROKEN "$ROOT/build-info.json" && exit 4
v=\$(sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$ROOT/build-info.json")
s=\$(sed -n 's/.*"releaseSeq":\([0-9]*\).*/\1/p' "$ROOT/build-info.json")
echo "{\"runtimeVersion\":\"\$v\",\"releaseSeq\":\$s,\"project\":{\"digest\":\"sha256:abc\",\"status\":\"active\"}}"
EOF
chmod +x "$W/bin/systemctl" "$W/bin/fetch"
cp "$UPDATER_SRC" "$W/mat-updater"
tr -d '\r' < "$UPDATER_SRC" > "$W/mat-updater"

export MAT_OPT_ROOT=$R MAT_SYSTEMCTL=$W/bin/systemctl MAT_VERIFY=$VERIFY_BIN MAT_RUNUSER="" \
    MAT_FETCH=$W/bin/fetch MAT_HEALTH_S=4 MAT_STABLE_S=1 MAT_SLEEP=true MAT_RATE_S=0

# The installed tree 1.0.0 (releaseSeq 10), its project and scripts, the trusted key.
reset() {
    rm -rf "$R" "$SVC"
    mkdir -p "$ROOT/bin" "$ROOT/web" "$ROOT/project" "$ROOT/deployment" "$UPD/incoming" "$UPD/ready" \
        "$UPD/ops" "$ETC/trusted-keys" "$SVC"
    printf '#!/bin/sh\ncase "$1" in --self-check) exit 0 ;; esac\necho "mat-runtime 1.0.0"\n' > "$ROOT/bin/mat-runtime"
    chmod 755 "$ROOT/bin/mat-runtime"
    echo '<p>1.0.0</p>' > "$ROOT/web/index.html"
    echo '{"version":"1.0.0","releaseSeq":10}' > "$ROOT/build-info.json"
    echo '{"name":"demo"}' > "$ROOT/project/project.json"
    echo 'deploy' > "$ROOT/deployment/deploy.sh"
    cp "$SRC/tests/update-vectors/keys-trusted/test-ec-p256.pem" "$ETC/trusted-keys/release-primary.pem"
    echo '{"port": 8080, "httpsPort": 0, "update": {"enabled": true, "maxPackageMiB": 64}}' > "$ETC/runtime.json"
    touch "$SVC/active"
}
# What the runtime leaves for mat-updater after a verified package and an apply (S2, S3).
request() { # $1 package, $2 op (apply), $3 id
    id=${3:-upd_00000000000000a1}
    cp "$PKGS/$1" "$UPD/ready/$id.matupdate"
    sha=$(sha256sum "$UPD/ready/$id.matupdate" | cut -d' ' -f1)
    echo "{\"updateId\":\"$id\",\"op\":\"${2:-apply}\",\"sha256\":\"$sha\",\"user\":\"admin1\"}" > "$UPD/request.json"
}
version() { sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$1/build-info.json" 2>/dev/null; }
result() { sed -n 's/.*"result":"\([^"]*\)".*/\1/p' "$UPD/last.json" 2>/dev/null; }
run() { sh "$W/mat-updater" "$@" > "$W/out.log" 2>&1; }
# with a bound: 124 when mat-updater hangs (review 011 T062: a FIFO planted by matscada)
run_bounded() { timeout -k 5 30 sh "$W/mat-updater" "$@" > "$W/out.log" 2>&1; }
# The tree is complete: build-info and the binary say the same version, every file of the
# manifest of that version is there.
complete() { # $1 dir
    v=$(version "$1")
    [ -n "$v" ] && [ -x "$1/bin/mat-runtime" ] && [ -f "$1/web/index.html" ] && [ -d "$1/project" ] &&
        { grep -q "$v" "$1/bin/mat-runtime" || return 1; } && [ ! -d "$R/opt/mat-runtime.new" ]
}

# ---------------------------------------------------------------- 1. the 8 steps of a good update
reset
request v101.matupdate
run
check "good: committed ($(cat "$W/out.log" | tail -3))" '[ "$(result)" = committed ]'
check "good: tree 1.0.1" '[ "$(version "$ROOT")" = 1.0.1 ]'
check "good: .prev 1.0.0" '[ "$(version "$ROOT.prev")" = 1.0.0 ]'
check "good: complete" 'complete "$ROOT"'
check "good: project and deployment kept" '[ -f "$ROOT/project/project.json" ] && [ -f "$ROOT/deployment/deploy.sh" ]'
check "good: modes" '[ "$(stat -c %a "$ROOT/bin/mat-runtime")" = 755 ] && [ "$(stat -c %a "$ROOT/web/index.html")" = 644 ]'
check "good: request consumed, ready cleaned" '[ ! -f "$UPD/request.json" ] && [ -z "$(ls "$UPD/ready")" ]'
check "good: root state at S8" 'grep -q "\"step\":8" "$STATE/ops/upd_00000000000000a1.json"'
check "good: last.json not yet audited" 'grep -q "\"audited\":false" "$UPD/last.json"'
check "good: service active" '[ -f "$SVC/active" ]'
check "good: stop then start" '[ "$(tr "\n" " " < "$SVC/log")" = "stop start " ]'

# ---------------------------------------------------------------- 2. TOCTOU: changed after the runtime's check
reset
request v101.matupdate
cp "$PKGS/v102.matupdate" "$UPD/ready/upd_00000000000000a1.matupdate"
run
check "toctou: refused" '[ "$(result)" = failed ] && grep -q sha256 "$UPD/last.json"'
check "toctou: tree untouched" '[ "$(version "$ROOT")" = 1.0.0 ] && [ ! -d "$ROOT.prev" ] && [ ! -f "$SVC/log" ]'

# a bad package that the runtime would never pass (a link in the payload): verify refuses again
reset
request v101.matupdate
cp "$SRC/tests/update-vectors/bad/10-link.matupdate" "$UPD/ready/upd_00000000000000a1.matupdate"
sha=$(sha256sum "$UPD/ready/upd_00000000000000a1.matupdate" | cut -d' ' -f1)
echo "{\"updateId\":\"upd_00000000000000a1\",\"op\":\"apply\",\"sha256\":\"$sha\"}" > "$UPD/request.json"
run
check "link: refused by mat-update-verify" '[ "$(result)" = failed ] && grep -q "UPDATE_PACKAGE_INVALID" "$UPD/last.json"'
check "link: tree untouched" '[ "$(version "$ROOT")" = 1.0.0 ] && [ ! -d "$ROOT.new" ]'

# ---------------------------------------------------------------- 2b. what matscada may plant (review 011 T062)
# the package is a FIFO: refused at once, never a blocked read
reset
request v101.matupdate
rm -f "$UPD/ready/upd_00000000000000a1.matupdate"
mkfifo "$UPD/ready/upd_00000000000000a1.matupdate"
run_bounded
rc=$?
check "fifo package: no hang (rc $rc)" '[ $rc != 124 ] && [ $rc != 137 ]'
check "fifo package: refused" '[ "$(result)" = failed ] && grep -q UPDATE_NOT_FOUND "$UPD/last.json"'
check "fifo package: tree untouched" '[ "$(version "$ROOT")" = 1.0.0 ] && [ ! -d "$ROOT.prev" ] && [ ! -f "$SVC/log" ]'
# the package is a symbolic link (to a valid package): refused
reset
request v101.matupdate
mv "$UPD/ready/upd_00000000000000a1.matupdate" "$W/elsewhere.matupdate"
ln -s "$W/elsewhere.matupdate" "$UPD/ready/upd_00000000000000a1.matupdate"
run
check "link package: refused" '[ "$(result)" = failed ] && grep -q UPDATE_NOT_FOUND "$UPD/last.json"'
check "link package: tree untouched" '[ "$(version "$ROOT")" = 1.0.0 ] && [ ! -d "$ROOT.prev" ]'
rm -f "$W/elsewhere.matupdate"
# larger than maxPackageMiB: refused while copying (bounded), before its digest and mat-update-verify
reset
echo '{"port": 8080, "httpsPort": 0, "update": {"enabled": true, "maxPackageMiB": 1}}' > "$ETC/runtime.json"
id=upd_00000000000000a1
{ cat "$PKGS/v101.matupdate"; head -c 1100000 /dev/zero; } > "$UPD/ready/$id.matupdate"
sha=$(sha256sum "$UPD/ready/$id.matupdate" | cut -d' ' -f1)
echo "{\"updateId\":\"$id\",\"op\":\"apply\",\"sha256\":\"$sha\",\"user\":\"admin1\"}" > "$UPD/request.json"
cat > "$W/bin/verify-spy" <<EOF
#!/bin/sh
touch "$W/verify-called"
exec "$VERIFY_BIN" "\$@"
EOF
chmod +x "$W/bin/verify-spy"
rm -f "$W/verify-called"
MAT_VERIFY=$W/bin/verify-spy run
check "too large: refused" '[ "$(result)" = failed ] && grep -q UPDATE_TOO_LARGE "$UPD/last.json"'
check "too large: mat-update-verify never ran" '[ ! -f "$W/verify-called" ]'
check "too large: tree untouched" '[ "$(version "$ROOT")" = 1.0.0 ] && [ ! -d "$ROOT.prev" ]'
# request.json is a FIFO: no hang, nothing done
reset
mkfifo "$UPD/request.json"
run_bounded
rc=$?
check "fifo request: no hang (rc $rc)" '[ $rc != 124 ] && [ $rc != 137 ]'
check "fifo request: nothing done" '[ ! -f "$UPD/last.json" ] && [ "$(version "$ROOT")" = 1.0.0 ]'
# a file name that is not ASCII (UTF-8, allowed by files[]): the listing matches files[]
reset
request utf8.matupdate
run
check "utf-8 name: committed ($(tail -2 "$W/out.log" | tr '\n' ' '))" '[ "$(result)" = committed ]'
check "utf-8 name: file in place" '[ -f "$ROOT/web/sơ-đồ.svg" ]'

# ---------------------------------------------------------------- 3. the tar listing against files[]
reset
request v101.matupdate
cat > "$W/bin/verify-liar" <<EOF
#!/bin/sh
"$VERIFY_BIN" "\$@" | grep -v '^file	web/index.html'
EOF
chmod +x "$W/bin/verify-liar"
MAT_VERIFY=$W/bin/verify-liar run
check "listing: a file not in files[] is refused" '[ "$(result)" = failed ] && grep -q FILE_LIST "$UPD/last.json"'
check "listing: tree untouched" '[ "$(version "$ROOT")" = 1.0.0 ] && [ ! -d "$ROOT.new" ]'

# ---------------------------------------------------------------- 4. health fails: back to .prev
reset
request broken.matupdate
t0=$(date +%s)
run
t1=$(date +%s)
check "health: rolled back" '[ "$(result)" = rolled-back ]'
check "health: old tree runs" '[ "$(version "$ROOT")" = 1.0.0 ] && [ -f "$SVC/active" ] && complete "$ROOT"'
check "health: .failed kept" '[ "$(version "$ROOT.failed")" = 1.0.3 ]'
check "health: within 90 s" '[ $((t1 - t0)) -le 90 ]'
# a second broken update: still one .failed
request broken.matupdate apply upd_00000000000000a2
run
check ".failed: one copy" '[ "$(ls -d "$R"/opt/mat-runtime.failed* | wc -l)" = 1 ]'

# ---------------------------------------------------------------- 5. self-check fails: no switch
reset
request selfcheck-fail.matupdate
run
check "self-check: refused" '[ "$(result)" = failed ] && grep -q SELF_CHECK_FAILED "$UPD/last.json"'
check "self-check: no switch, no stop" '[ "$(version "$ROOT")" = 1.0.0 ] && [ ! -d "$ROOT.new" ] && [ ! -f "$SVC/log" ]'

# ---------------------------------------------------------------- 6. strange request.json
for bad in '{"updateId":"upd_1","op":"apply","sha256":"00"}' \
    '{"updateId":"../../etc/x","op":"apply","sha256":"0000000000000000000000000000000000000000000000000000000000000000"}' \
    '{"updateId":"upd_00000000000000a1","op":"rm -rf","sha256":"x"}' \
    'not json at all'; do
    reset
    cp "$PKGS/v101.matupdate" "$UPD/ready/upd_00000000000000a1.matupdate"
    printf '%s\n' "$bad" > "$UPD/request.json"
    run
    check "request ignored: $bad" '[ ! -f "$UPD/last.json" ] && [ "$(version "$ROOT")" = 1.0.0 ] && [ ! -f "$UPD/request.json" ]'
done

# ---------------------------------------------------------------- 7. one run every 5 minutes
reset
request v101.matupdate
MAT_RATE_S=300 run
request v102.matupdate apply upd_00000000000000a2
MAT_RATE_S=300 run
check "rate: second run refused" '[ "$(result)" = failed ] && grep -q RATE_LIMITED "$UPD/last.json" && [ "$(version "$ROOT")" = 1.0.1 ]'

# ---------------------------------------------------------------- 8. keyset
reset
request keyset-add.matupdate keyset
run
check "keyset: committed ($(tail -2 "$W/out.log" | tr '\n' ' '))" '[ "$(result)" = committed ]'
check "keyset: two keys" '[ "$(ls "$ETC/trusted-keys"/*.pem | wc -l)" = 2 ]'
check "keyset: no restart, tree untouched" '[ ! -f "$SVC/log" ] && [ "$(version "$ROOT")" = 1.0.0 ]'
check "keyset: modes" '[ "$(stat -c %a "$ETC/trusted-keys")" = 755 ] && [ -z "$(find "$ETC/trusted-keys" -name "*.pem" ! -perm 644)" ]'
check "keyset: releaseSeq kept (011 review K1)" '[ "$(cat "$ETC/trusted-keys/keyset-seq")" = 15 ]'
# replay of the same signed keyset package (a removed key could come back): refused
rm -f "$ETC/trusted-keys"/*.pem
cp "$SRC/tests/update-vectors/keys-trusted/test-ec-p256.pem" "$ETC/trusted-keys/release-primary.pem"
request keyset-add.matupdate keyset upd_00000000000000a9
run
check "keyset: replay refused (011 review K1)" '[ "$(result)" = failed ] && grep -q UPDATE_DOWNGRADE "$UPD/last.json" && [ "$(ls "$ETC/trusted-keys"/*.pem | wc -l)" = 1 ]'
# the copy of the installed keys fails (review 011 T062): refused, the installed set untouched
reset
mkdir "$ETC/trusted-keys/odd.pem"
request keyset-add.matupdate keyset
run
check "keyset: a failed copy refuses ($(tail -1 "$W/out.log"))" '[ "$(result)" = failed ] && grep -q KEYSET_KEY "$UPD/last.json"'
check "keyset: a failed copy keeps the set" '[ -d "$ETC/trusted-keys/odd.pem" ] && [ -f "$ETC/trusted-keys/release-primary.pem" ] && [ ! -f "$ETC/trusted-keys/keyset-seq" ] && [ ! -d "$ETC/trusted-keys.new" ]'

# ---------------------------------------------------------------- 9. manual rollback
reset
request v101.matupdate
run
echo '{"updateId":"upd_00000000000000b1","op":"rollback","sha256":"","user":"admin1"}' > "$UPD/request.json"
run
check "rollback: committed" '[ "$(result)" = committed ] && grep -q "\"op\":\"rollback\"" "$UPD/last.json"'
check "rollback: 1.0.0 runs, 1.0.1 is .prev" '[ "$(version "$ROOT")" = 1.0.0 ] && [ "$(version "$ROOT.prev")" = 1.0.1 ]'
reset
echo '{"updateId":"upd_00000000000000b2","op":"rollback","sha256":""}' > "$UPD/request.json"
run
check "rollback: no .prev refused" '[ "$(result)" = failed ] && grep -q UPDATE_NO_PREVIOUS "$UPD/last.json"'

# ---------------------------------------------------------------- 10. kill -9 at each step, then recover
# S1–S3 belong to the runtime: what it may leave when killed (5 shapes each); then S4–S8 in mat-updater.
kill_case() { # $1 label
    run --recover
    # the boot: systemd starts the runtime, then a queued health check runs
    "$W/bin/systemctl" start mat-runtime
    if [ -f "$STATE/resume" ]; then run; fi
    v=$(version "$ROOT")
    if { [ "$v" = 1.0.0 ] || [ "$v" = 1.0.1 ]; } && complete "$ROOT" && [ ! -d "$ROOT.new" ] &&
        [ ! -f "$UPD/request.json" ] && [ -z "$(ls "$UPD/incoming" "$UPD/ready" 2>/dev/null | grep -v ':$' | grep -v '^$')" ] &&
        ! grep -lq '"result":null' "$STATE"/ops/*.json 2>/dev/null; then
        ok
    else
        fail "kill $1: tree ${v:-none}, $(ls "$R/opt" | tr '\n' ' '), $(ls "$UPD/ready" "$UPD/incoming" 2>/dev/null | tr '\n' ' ')"
    fi
}
for n in 1 2 3 4 5; do
    reset; head -c 3000 "$PKGS/v101.matupdate" > "$UPD/incoming/upd_00000000000000c$n.part"
    [ $n -gt 2 ] && echo '{"step":1,"name":"receiving"}' > "$UPD/ops/upd_00000000000000c$n.json"
    kill_case "S1:$n"
    reset; cp "$PKGS/v101.matupdate" "$UPD/ready/upd_00000000000000c$n.matupdate"
    [ $n -gt 1 ] && echo '{"step":2,"name":"verified"}' > "$UPD/ops/upd_00000000000000c$n.json"
    [ $n -gt 3 ] && head -c 100 "$PKGS/v101.matupdate" > "$UPD/incoming/upd_00000000000000d$n.part"
    kill_case "S2:$n"
    reset; request v101.matupdate "apply" "upd_00000000000000c$n"
    [ $n -gt 2 ] && echo '{"step":3,"name":"requested"}' > "$UPD/ops/upd_00000000000000c$n.json"
    [ $n = 5 ] && echo '{"broken' > "$UPD/request.json"
    kill_case "S3:$n"
done
for s in S4 S5 S6 S7 S8; do
    for n in 1 2 3 4 5; do
        reset
        pkg=v101.matupdate
        # the rollback points of S7 (5, 6) and point 3 need a version that fails its health check
        case "$s:$n" in S7:3 | S7:5) pkg=broken.matupdate ;; esac
        request $pkg
        MAT_TEST_KILL=$s:$n run
        if [ "$pkg" = broken.matupdate ]; then
            # the broken tree may be the one left: recover finishes the rollback through its health check
            :
        fi
        kill_case "$s:$n"
    done
done

echo "updater_test: $pass passed, $failures failed"
rm -rf "$W"
[ $failures = 0 ]
