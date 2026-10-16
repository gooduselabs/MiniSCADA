#!/bin/sh
# Test deploy.sh + rollback.sh (Constitution VII, review R-16) với lệnh hệ thống giả, trong container
# dùng một lần (ghi vào /opt, /etc của container):
#   docker run --rm -v "<repo>:/src" mat-armhf sh -c "tr -d '\r' < deployment/device/tests/deploy_rollback_test.sh > /tmp/t.sh && sh /tmp/t.sh"
# Kiểm: unit .prev luôn đi cặp với /opt/mat-runtime.prev, nên rollback trả về đúng cặp binary + unit.
set -eu
[ -f /.dockerenv ] || { echo "chỉ chạy trong container dùng một lần"; exit 2; }

SRC=$(cd "$(dirname "$0")/../../.." 2>/dev/null && pwd)
[ -f "$SRC/deployment/device/deploy.sh" ] || SRC=/src
W=$(mktemp -d)
STUBS=$W/stubs
mkdir -p "$STUBS"
fail() { echo "FAIL: $*"; exit 1; }

# Unit thật (feature 005, T048): thêm RuntimeDirectory cho /run/mat-runtime (phiên đi qua execv);
# sandbox giữ nguyên: không netlink (địa chỉ card lấy bằng ioctl, research R2), không capability.
REAL_UNIT=$SRC/deployment/systemd/mat-runtime.service
unit_has() { tr -d '\r' < "$REAL_UNIT" | grep -qxF "$1"; }
for l in 'RuntimeDirectory=mat-runtime' 'RuntimeDirectoryMode=0700' 'CapabilityBoundingSet=' \
         'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX' \
         'ReadOnlyPaths=/opt/mat-runtime /etc/mat-runtime' 'NoNewPrivileges=true'; do
    unit_has "$l" || fail "unit thiếu dòng: $l"
done
if grep -v '^[[:space:]]*#' "$REAL_UNIT" | grep -q 'AF_NETLINK'; then fail "unit cho phép AF_NETLINK"; fi
if grep -Eq '^[[:space:]]*(AmbientCapabilities|CapabilityBoundingSet)=[^[:space:]]' "$REAL_UNIT"; then
    fail "unit cấp capability"
fi

# Lệnh hệ thống giả: systemctl/journalctl/useradd không làm gì, sleep không chờ, runuser chạy lệnh
# sau "--", wget trả system/info với project active (cổng HTTPS của feature 005 trả lời, trừ khi có
# file $W/https-down), id matscada coi như đã có.
for c in systemctl journalctl useradd sleep; do printf '#!/bin/sh\nexit 0\n' > "$STUBS/$c"; done
printf '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n' > "$STUBS/runuser"
cat > "$STUBS/wget" <<EOF
#!/bin/sh
case "\$*" in *https://*) [ -f "$W/https-down" ] && exit 4 ;; esac
echo '{"project":{"status":"active"}}'
EOF
printf '#!/bin/sh\nexit 0\n' > "$STUBS/id"
chmod +x "$STUBS"/*
export PATH="$STUBS:$PATH"

# Binary giả: --check-project hợp lệ, và các lệnh của feature 005 mà deploy.sh gọi sau health check:
# --cert-fingerprint; --user-list theo đúng cột của lệnh thật (tên, role, bật/tắt, lần đổi cuối;
# server/tests/user_cli_test.cpp kiểm định dạng này); --user-add ghi lại lời gọi và có terminal hay
# không. Trạng thái trong $FAKE: file admin (bật/tắt) = có tài khoản administrator, user-add-rc = mã
# thoát của --user-add.
FAKE=$W/fake
export FAKE
mkdir -p "$FAKE"
FAKE_BIN=$W/fake-mat-runtime
cat > "$FAKE_BIN" <<'EOF'
#!/bin/sh
case " $* " in
*" --cert-fingerprint "*) echo "SHA256 Fingerprint=AB:CD:EF:01" ;;
*" --user-list "*)
    if [ -f "$FAKE/list-fails" ]; then echo "không đọc được file tài khoản: giả" >&2; exit 6; fi
    if [ -f "$FAKE/admin" ]; then
        echo "TÊN    ROLE           TRẠNG THÁI  ĐỔI LẦN CUỐI (UTC)"
        echo "admin  administrator  $(cat "$FAKE/admin")         2026-10-20T03:00:00Z"
    else
        echo "chưa có tài khoản nào: tạo tài khoản quản trị bằng mat-runtime --user-add <tên> --role administrator"
    fi ;;
*" --user-add "*)
    if [ -t 0 ]; then echo "tty $*" >> "$FAKE/user-add"; else echo "notty $*" >> "$FAKE/user-add"; fi
    rc=$(cat "$FAKE/user-add-rc" 2>/dev/null || echo 0)
    if [ "$rc" = 0 ]; then echo "bật" > "$FAKE/admin"; fi
    exit "$rc" ;;
*) echo '{"valid":true}' ;;
esac
EOF
chmod +x "$FAKE_BIN"

# Gói phiên bản $1 với unit $2.
pkg() {
    d=$W/pkg-$1
    mkdir -p "$d/bin" "$d/project" "$d/schemas/0.2" "$d/schemas/0.3" "$d/schemas/0.4" "$d/schemas/0.5" "$d/deployment"
    echo '{"widgets":[]}' > "$d/schemas/widgets.catalog.json"
    cp "$FAKE_BIN" "$d/bin/mat-runtime"
    echo "$1" > "$d/VERSION"
    echo "unit-$2" > "$d/deployment/mat-runtime.service"
    echo '{"port": 8080}' > "$d/deployment/runtime.json"
    tar -czf "$W/$1.tar.gz" -C "$d" .
    (cd "$W" && sha256sum "$1.tar.gz" > "$1.tar.gz.sha256")
}
deploy() { sh "$SRC/deployment/device/deploy.sh" "$W/$1.tar.gz" > "$W/log" 2>&1 || { cat "$W/log"; fail "deploy $1"; }; }
UNIT=/etc/systemd/system/mat-runtime.service
expect() { # <bản đang chạy> <unit đang dùng>
    [ "$(cat /opt/mat-runtime/VERSION)" = "$1" ] || fail "đang chạy $(cat /opt/mat-runtime/VERSION), cần $1"
    [ "$(cat $UNIT)" = "unit-$2" ] || fail "unit $(cat $UNIT), cần unit-$2"
}

rm -rf /opt/mat-runtime /opt/mat-runtime.prev /opt/mat-runtime.new /opt/mat-runtime.failed /etc/mat-runtime
mkdir -p /etc/systemd/system
rm -f "$UNIT" "$UNIT.prev"

pkg v1 A; pkg v2 B; pkg v3 B; pkg v4 C
deploy v1; expect v1 A
deploy v2; expect v2 B
[ "$(cat $UNIT.prev)" = "unit-A" ] || fail "deploy đổi unit phải giữ unit cũ trong .prev"
# Deploy không đổi unit: .prev cũ (unit-A, của v1) không còn đi cặp với /opt/mat-runtime.prev (v2).
deploy v3; expect v3 B
[ ! -e "$UNIT.prev" ] || fail ".prev lỗi thời ($(cat $UNIT.prev)) còn sau deploy không đổi unit"
sh "$SRC/deployment/device/rollback.sh" > "$W/log" 2>&1 || { cat "$W/log"; fail "rollback"; }
expect v2 B
# Deploy đổi unit sau đó: rollback trả cả binary lẫn unit trước.
deploy v4; expect v4 C
sh "$SRC/deployment/device/rollback.sh" > "$W/log" 2>&1 || { cat "$W/log"; fail "rollback"; }
expect v2 B

# Deploy dừng giữa chừng: dọn bản backup cũ lỗi (hoặc mất điện) khi unit không đổi. .prev của unit
# phải còn nguyên, vẫn đi cặp với /opt/mat-runtime.prev, để rollback tay trả đúng cặp (review GĐ 0).
rm -rf /opt/mat-runtime /opt/mat-runtime.prev /opt/mat-runtime.new /opt/mat-runtime.failed
rm -f "$UNIT" "$UNIT.prev"
deploy v1; deploy v2; expect v2 B
REALRM=$(command -v rm)
FAILRM=$W/failrm
mkdir -p "$FAILRM"
printf '#!/bin/sh\n[ "$1" = "-rf" ] && [ "$2" = "/opt/mat-runtime.prev" ] && { echo "rm giả: lỗi" >&2; exit 1; }\nexec %s "$@"\n' "$REALRM" > "$FAILRM/rm"
chmod +x "$FAILRM/rm"
if PATH="$FAILRM:$PATH" sh "$SRC/deployment/device/deploy.sh" "$W/v3.tar.gz" > "$W/log" 2>&1; then
    cat "$W/log"; fail "deploy v3 phải dừng khi không dọn được bản backup cũ"
fi
expect v2 B
[ "$(cat $UNIT.prev 2>/dev/null)" = "unit-A" ] || fail "deploy dừng giữa chừng làm mất unit đi cặp với bản backup v1"
sh "$SRC/deployment/device/rollback.sh" > "$W/log" 2>&1 || { cat "$W/log"; fail "rollback"; }
expect v1 A

# Feature 005 (T049): sau health check, deploy.sh in fingerprint và lo tài khoản quản trị đầu tiên.
fresh() { # cài lần đầu, chưa có tài khoản nào
    rm -rf /opt/mat-runtime /opt/mat-runtime.prev /opt/mat-runtime.new /opt/mat-runtime.failed /etc/mat-runtime
    rm -f "$UNIT" "$UNIT.prev" "$W/https-down"
    rm -rf "$FAKE"
    mkdir -p "$FAKE"
}
has() { grep -qF "$1" "$W/log" || { cat "$W/log"; fail "$2"; }; }
hasnt() { if grep -qF "$1" "$W/log"; then cat "$W/log"; fail "$2"; fi; }
# deploy trên terminal: script(1) cho deploy.sh một pty làm stdin; log vẫn vào $W/log.
deploy_tty() {
    script -qec "sh $SRC/deployment/device/deploy.sh $W/$1.tar.gz > $W/log 2>&1" /dev/null \
        < /dev/null > /dev/null || { cat "$W/log"; fail "deploy $1 (có terminal)"; }
}
adds() { grep -c "^$1 --user-add admin --role administrator" "$FAKE/user-add" 2>/dev/null || true; }

# Không có terminal (script tự động): in bước bắt buộc kèm lệnh rồi đi tiếp; deploy vẫn đạt.
fresh
deploy v1 < /dev/null
expect v1 A
has "SHA256 Fingerprint=AB:CD:EF:01" "deploy phải in fingerprint của chứng chỉ HTTPS"
has "GHI LẠI fingerprint" "thiếu lời nhắc ghi lại fingerprint để so khi ghim"
has "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng" "không có terminal: thiếu bước bắt buộc"
has "/opt/mat-runtime/bin/mat-runtime --user-add admin --role administrator" "bước bắt buộc phải kèm lệnh"
[ ! -e "$FAKE/user-add" ] || fail "không có terminal mà vẫn chạy --user-add"

# Có terminal: chạy --user-add admin --role administrator ngay, trên terminal (hỏi mật khẩu).
fresh
deploy_tty v1
expect v1 A
[ "$(adds tty)" = 1 ] || { cat "$FAKE/user-add" 2>/dev/null; fail "có terminal: phải chạy --user-add admin trên terminal"; }
hasnt "BƯỚC BẮT BUỘC" "có terminal và đã tạo được admin: không in bước bắt buộc"
# Đã có administrator đang bật: không hỏi, không in bước bắt buộc.
deploy_tty v2
expect v2 B
[ "$(adds tty)" = 1 ] || fail "đã có administrator mà vẫn chạy --user-add"
has "đã có tài khoản administrator đang bật" "thiếu thông báo đã có administrator"
hasnt "BƯỚC BẮT BUỘC" "đã có administrator: không in bước bắt buộc"
# Administrator bị tắt không tính.
echo "tắt" > "$FAKE/admin"
deploy v3 < /dev/null
has "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng" "administrator bị tắt không được tính"

# Mật khẩu bị từ chối (mã 2): hỏi lại, tối đa 3 lần, rồi in bước bắt buộc; deploy vẫn đạt.
fresh
echo 2 > "$FAKE/user-add-rc"
deploy_tty v1
expect v1 A
[ "$(adds tty)" = 3 ] || { cat "$FAKE/user-add"; fail "mật khẩu bị từ chối: phải hỏi lại, tối đa 3 lần"; }
has "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng" "hỏi 3 lần không được: thiếu bước bắt buộc"
# Lỗi khác (mã 5: không ghi được audit): không hỏi lại.
fresh
echo 5 > "$FAKE/user-add-rc"
deploy_tty v1
[ "$(adds tty)" = 1 ] || { cat "$FAKE/user-add"; fail "lỗi khác mật khẩu: không hỏi lại"; }
has "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng" "--user-add lỗi: thiếu bước bắt buộc"
# Không đọc được danh sách tài khoản (users.json hỏng, mã 6): không hỏi dù có terminal; lỗi của
# lệnh hiện trong log; in bước bắt buộc; deploy vẫn đạt.
fresh
touch "$FAKE/list-fails"
deploy_tty v1
expect v1 A
has "không đọc được file tài khoản: giả" "lỗi của --user-list phải hiện trong log deploy"
has "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng" "--user-list lỗi: thiếu bước bắt buộc"
[ ! -e "$FAKE/user-add" ] || fail "--user-list lỗi mà vẫn chạy --user-add"

# Health check gồm cổng HTTPS (mặc định 8443): không trả lời thì rollback về bản trước.
fresh
deploy v1 < /dev/null
touch "$W/https-down"
if sh "$SRC/deployment/device/deploy.sh" "$W/v2.tar.gz" > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "cổng HTTPS không trả lời mà deploy vẫn đạt"
fi
expect v1 A
has "cổng HTTPS 8443 không trả lời" "health check phải nói cổng HTTPS không trả lời"
# httpsPort = 0 (HTTPS tắt): không kiểm cổng HTTPS, không có fingerprint để in.
echo '{"port": 8080, "httpsPort": 0}' > /etc/mat-runtime/runtime.json
deploy v2 < /dev/null
expect v2 B
has "HTTPS tắt (httpsPort = 0)" "httpsPort = 0: phải báo HTTPS tắt"
hasnt "SHA256 Fingerprint" "httpsPort = 0: không in fingerprint"
rm -f "$W/https-down"
echo "deploy/rollback: OK"
