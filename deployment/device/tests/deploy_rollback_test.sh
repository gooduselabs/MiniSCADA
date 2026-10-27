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
    mkdir -p "$d/bin" "$d/project" "$d/schemas/0.2" "$d/schemas/0.3" "$d/schemas/0.4" "$d/schemas/0.5" "$d/schemas/0.6" "$d/deployment"
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
# Feature 013 (T002, FR-001): runtime.json đang có không bị ghi đè khi nâng cấp (thiết bị đang chạy
# giữ viewerLogin của nó: không có khóa là off, có cảnh báo); bản cài mới lấy runtime.json của gói.
[ "$(cat /etc/mat-runtime/runtime.json)" = '{"port": 8080, "httpsPort": 0}' ] || fail "deploy ghi đè runtime.json đang có"
has "XEM KHÔNG CẦN ĐĂNG NHẬP" "viewerLogin off: deploy phải cảnh báo xem không cần đăng nhập"
fresh
printf '{"port": 8080, "viewerLogin": "required"}\n' > "$W/pkg-v1/deployment/runtime.json"
tar -czf "$W/v1.tar.gz" -C "$W/pkg-v1" . && (cd "$W" && sha256sum "v1.tar.gz" > "v1.tar.gz.sha256")
deploy v1 < /dev/null
grep -q '"viewerLogin": "required"' /etc/mat-runtime/runtime.json || fail "bản cài mới phải lấy runtime.json của gói (viewerLogin required)"
has "viewerLogin: required" "viewerLogin required: deploy phải báo"
hasnt "XEM KHÔNG CẦN ĐĂNG NHẬP" "viewerLogin required: không cảnh báo"
grep -q '"viewerLogin": "required"' "$SRC/deployment/config/runtime.json" || fail "deployment/config/runtime.json phải để viewerLogin required (bản cài mới)"

# Feature 011 (T051, FR-013, FR-017, FR-033): lời nhắc allowedHosts, mật khẩu 15–128 ký tự, cảnh báo SSH khi
# root đăng nhập được bằng mật khẩu (đọc sshd_config chỉ đọc; không bao giờ sửa). MAT_SSHD_CONFIG trỏ file giả;
# không có `sshd` trong PATH của container nên script đọc file.
SSHD=$W/sshd_config
export MAT_SSHD_CONFIG="$SSHD"
fresh
printf '# giả\nPermitRootLogin yes\n' > "$SSHD"
deploy v1 < /dev/null
has "allowedHosts" "thiếu lời nhắc allowedHosts"
has "mật khẩu 15–128 ký tự" "thiếu lời nhắc mật khẩu tối thiểu 15 ký tự"
has "SSH_ROOT_PASSWORD" "PermitRootLogin yes: phải cảnh báo SSH"
has "hardening.md" "cảnh báo SSH phải chỉ tài liệu gia cố"
cmp -s "$SSHD" - <<'EOF' || fail "deploy.sh không được sửa sshd_config"
# giả
PermitRootLogin yes
EOF
# Giá trị đầu tiên thắng (như sshd); PasswordAuthentication no thì root không vào được bằng mật khẩu.
printf 'PermitRootLogin prohibit-password\nPermitRootLogin yes\n' > "$SSHD"
deploy v2 < /dev/null
hasnt "SSH_ROOT_PASSWORD" "PermitRootLogin prohibit-password đứng trước: không cảnh báo"
printf 'PasswordAuthentication no\npermitrootlogin YES\n' > "$SSHD"
deploy v3 < /dev/null
hasnt "SSH_ROOT_PASSWORD" "PasswordAuthentication no: không cảnh báo"
# Dòng trong khối Match không đặt giá trị chung.
printf 'Match User x\n  PermitRootLogin yes\n' > "$SSHD"
deploy v1 < /dev/null
hasnt "SSH_ROOT_PASSWORD" "PermitRootLogin trong Match: không cảnh báo"
rm -f "$SSHD"
deploy v2 < /dev/null
hasnt "SSH_ROOT_PASSWORD" "không đọc được sshd_config: không cảnh báo"
unset MAT_SSHD_CONFIG
# Feature 011 (T100, T115): mat-updater, unit và khóa tin cậy cài bằng deploy.sh; chữ ký SHA256SUMS kiểm bằng
# mat-update-verify của gói. Cần mat-update-verify build cho kiến trúc của container (MAT_VERIFY_BIN).
for u in mat-updater.service mat-updater.path mat-updater-recover.service; do
    [ -f "$SRC/deployment/systemd/$u" ] || fail "thiếu deployment/systemd/$u"
done
U=$SRC/deployment/systemd
unit_line() { tr -d '\r' < "$U/$1" | grep -qxF "$2" || fail "$1 thiếu dòng: $2"; }
for l in 'Type=oneshot' 'ProtectSystem=strict' 'PrivateTmp=true' 'NoNewPrivileges=true' 'SystemCallFilter=@system-service' \
         'TimeoutStartSec=300' 'IPAddressAllow=localhost' 'IPAddressDeny=any'; do
    unit_line mat-updater.service "$l"
done
# rà soát lần hai T202 N-OTA3: PathExists (yêu cầu ghi trong lúc mat-updater chạy được xử lý ở lượt sau)
unit_line mat-updater.path 'PathExists=/var/lib/mat-runtime/update/request.json'
if tr -d '\r' < "$U/mat-updater.path" | grep -q '^PathChanged='; then fail "mat-updater.path còn PathChanged="; fi
unit_line mat-updater-recover.service 'Before=mat-runtime.service'
unit_line mat-updater-recover.service 'Type=oneshot'
# rà soát 011 (T062): hai unit của root bị giới hạn capability, thiết bị, namespace, SUID
for u in mat-updater.service mat-updater-recover.service; do
    for l in 'PrivateDevices=true' 'ProtectKernelLogs=true' 'ProtectClock=true' 'RestrictSUIDSGID=true' \
             'RestrictNamespaces=true' 'LockPersonality=true' 'NoNewPrivileges=true'; do
        unit_line "$u" "$l"
    done
    caps=$(tr -d '\r' < "$U/$u" | sed -n 's/^CapabilityBoundingSet=//p')
    [ -n "$caps" ] || fail "$u thiếu CapabilityBoundingSet"
    for c in CAP_SYS_ADMIN CAP_NET_ADMIN CAP_SYS_MODULE CAP_SYS_PTRACE CAP_MKNOD CAP_SYS_RAWIO CAP_SETPCAP; do
        case " $caps " in *" $c "*) fail "$u không được giữ $c" ;; esac
    done
done
grep -q 'mat-updater' "$REAL_UNIT" && fail "mat-runtime.service không được đổi vì OTA"
VERIFY_BIN=${MAT_VERIFY_BIN:-/build/x64/bin/mat-update-verify}
if [ ! -x "$VERIFY_BIN" ]; then
    # No build mounted (ci-local runs this step before the x64 build; GitHub runs it in the armhf job):
    # build only the verifier, for the container's own architecture.
    echo "deploy/rollback: dựng mat-update-verify vào /tmp/mat-verify-build"
    cmake -S "$SRC" -B /tmp/mat-verify-build -G Ninja -DCMAKE_BUILD_TYPE=Release >/dev/null &&
        cmake --build /tmp/mat-verify-build --target mat-update-verify >/dev/null ||
        fail "không dựng được mat-update-verify để thử phần OTA của deploy.sh"
    VERIFY_BIN=/tmp/mat-verify-build/bin/mat-update-verify
    [ -x "$VERIFY_BIN" ] || fail "thiếu $VERIFY_BIN sau khi dựng"
fi
pkgu() { # gói $1 có updater/ và khóa công khai thử
    pkg "$1" A
    d=$W/pkg-$1
    mkdir -p "$d/updater" "$d/deployment/keys"
    cp "$VERIFY_BIN" "$d/updater/mat-update-verify"
    tr -d '\r' < "$SRC/deployment/device/mat-updater.sh" > "$d/updater/mat-updater"
    tr -d '\r' < "$SRC/deployment/device/mat-updater-recover.sh" > "$d/updater/mat-updater-recover"
    for u in mat-updater.service mat-updater.path mat-updater-recover.service; do cp "$U/$u" "$d/deployment/"; done
    cp "$SRC/tests/update-vectors/keys-trusted/test-ec-p256.pem" "$d/deployment/keys/release-primary.pub.pem"
    tar -czf "$W/$1.tar.gz" -C "$d" .
    (cd "$W" && sha256sum "$1.tar.gz" > "$1.tar.gz.sha256")
}
fresh
rm -rf /usr/lib/mat-updater /var/lib/mat-updater
pkgu u1
deploy u1 < /dev/null
expect u1 A
for f in mat-update-verify mat-updater mat-updater-recover; do
    [ "$(stat -c %a /usr/lib/mat-updater/$f 2>/dev/null)" = 755 ] || fail "/usr/lib/mat-updater/$f phải 0755"
done
[ "$(stat -c %a /var/lib/mat-updater)" = 700 ] || fail "/var/lib/mat-updater phải 0700"
[ "$(stat -c %a /etc/mat-runtime/trusted-keys/release-primary.pem 2>/dev/null)" = 644 ] || fail "khóa tin cậy phải được cài 0644"
[ -f /etc/systemd/system/mat-updater.path ] || fail "mat-updater.path chưa cài"
has "mặc định TẮT" "deploy phải nhắc OTA mặc định tắt"
has "CẢNH BÁO: không có SHA256SUMS" "thiếu chữ ký: phải cảnh báo, vẫn cài"
# Khóa đã có thì không bị thay bằng khóa trong gói.
echo "giữ" > /etc/mat-runtime/trusted-keys/release-primary.pem
deploy u1 < /dev/null
[ "$(cat /etc/mat-runtime/trusted-keys/release-primary.pem)" = "giữ" ] || fail "deploy không được ghi đè khóa tin cậy đã có"
cp "$SRC/tests/update-vectors/keys-trusted/test-ec-p256.pem" /etc/mat-runtime/trusted-keys/release-primary.pem
# SHA256SUMS ký bằng khóa thử: đúng thì cài, sửa một dòng thì dừng.
S=$W/signed
mkdir -p "$S"
pkgu u2
cp "$W/u2.tar.gz" "$W/u2.tar.gz.sha256" "$S/"
(cd "$S" && sha256sum u2.tar.gz > SHA256SUMS)
openssl dgst -sha256 -sign "$SRC/tests/update-vectors/keys/test-ec-p256.pem" -out "$S/SHA256SUMS.sig" "$S/SHA256SUMS" ||
    fail "openssl không ký được SHA256SUMS"
sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" > "$W/log" 2>&1 < /dev/null || { cat "$W/log"; fail "deploy u2 có chữ ký đúng"; }
expect u2 A
has "chữ ký phát hành OK" "chữ ký đúng: phải báo OK"
echo "0000000000000000000000000000000000000000000000000000000000000000  khac.tar.gz" >> "$S/SHA256SUMS"
if sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "SHA256SUMS bị sửa mà deploy vẫn đạt"
fi
has "chữ ký SHA256SUMS KHÔNG hợp lệ" "SHA256SUMS bị sửa: phải báo chữ ký không hợp lệ"
expect u2 A

# Rà soát T062 F1: chữ ký kiểm bằng mat-update-verify ĐÃ CÀI (/usr/lib/mat-updater), không bằng bộ kiểm trong gói
# đang được kiểm. Gói giả mạo mang bộ kiểm luôn trả "ok" và chữ ký rác: phải bị từ chối.
S3=$W/forged
mkdir -p "$S3"
pkgu u3
printf '#!/bin/sh\nprintf "ok\\tsha256:gia\\n"\nexit 0\n' > "$W/pkg-u3/updater/mat-update-verify"
chmod 755 "$W/pkg-u3/updater/mat-update-verify"
tar -czf "$W/u3.tar.gz" -C "$W/pkg-u3" .
(cd "$W" && sha256sum u3.tar.gz > u3.tar.gz.sha256)
cp "$W/u3.tar.gz" "$W/u3.tar.gz.sha256" "$S3/"
(cd "$S3" && sha256sum u3.tar.gz > SHA256SUMS)
printf '0\002\001\001' > "$S3/SHA256SUMS.sig"
[ -x /usr/lib/mat-updater/mat-update-verify ] || fail "cần bộ kiểm đã cài cho ca này"
if sh "$SRC/deployment/device/deploy.sh" "$S3/u3.tar.gz" > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "gói mang bộ kiểm giả qua được: deploy.sh phải dùng /usr/lib/mat-updater/mat-update-verify"
fi
has "chữ ký SHA256SUMS KHÔNG hợp lệ" "gói giả mạo: phải báo chữ ký không hợp lệ"
hasnt "TIN-LẦN-ĐẦU" "đã có bộ kiểm cài sẵn: không phải lần đầu"
expect u2 A
# Ký lại SHA256SUMS cho các ca sau (ca trước đã sửa nó).
(cd "$S" && sha256sum u2.tar.gz > SHA256SUMS)
openssl dgst -sha256 -sign "$SRC/tests/update-vectors/keys/test-ec-p256.pem" -out "$S/SHA256SUMS.sig" "$S/SHA256SUMS" ||
    fail "openssl không ký được SHA256SUMS"
KID=$("$VERIFY_BIN" --key-id "$SRC/tests/update-vectors/keys-trusted/test-ec-p256.pem") || fail "không tính được keyId"
# Ghim khóa: đúng keyId thì cài; sai thì dừng; ghim mà không có chữ ký thì dừng; tham số lạ thì mã 2.
sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" --expect-key-id "$KID" > "$W/log" 2>&1 < /dev/null ||
    { cat "$W/log"; fail "deploy ghim đúng keyId phải đạt"; }
has "chữ ký phát hành OK (khóa $KID)" "chữ ký đúng: phải báo OK kèm keyId"
if sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" --expect-key-id sha256:00 > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "khóa ký khác keyId ghim mà deploy vẫn đạt"
fi
has "khác khóa ghim --expect-key-id" "ghim sai: phải nói khóa ký khác khóa ghim"
if sh "$SRC/deployment/device/deploy.sh" "$W/u1.tar.gz" --expect-key-id "$KID" > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "ghim khóa mà gói không có chữ ký: deploy phải dừng"
fi
has "expect-key-id mà không có SHA256SUMS" "ghim khóa, thiếu chữ ký: phải báo"
rc=0; sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" --la > "$W/log" 2>&1 < /dev/null || rc=$?
[ "$rc" = 2 ] || { cat "$W/log"; fail "tham số lạ: phải thoát mã 2 (được $rc)"; }
expect u2 A
# Lần cài đầu (chưa có bộ kiểm đã cài): dùng bộ kiểm của gói, kèm cảnh báo tin-lần-đầu.
rm -rf /usr/lib/mat-updater
sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" > "$W/log" 2>&1 < /dev/null || { cat "$W/log"; fail "deploy lần đầu có chữ ký"; }
has "TIN-LẦN-ĐẦU (TOFU)" "lần đầu: phải cảnh báo bộ kiểm là của chính gói"
has "chữ ký phát hành OK" "lần đầu, chữ ký đúng: phải báo OK"
[ -x /usr/lib/mat-updater/mat-update-verify ] || fail "lần đầu: phải cài bộ kiểm vào /usr/lib/mat-updater"
# Rà soát lần hai T202 N6: khóa do deploy.sh cài đi kèm keyset-seq = 0 (mat-updater từ chối keyset-seq hỏng).
[ "$(cat /etc/mat-runtime/trusted-keys/keyset-seq 2>/dev/null)" = 0 ] || fail "deploy phải tạo trusted-keys/keyset-seq = 0"
echo 17 > /etc/mat-runtime/trusted-keys/keyset-seq
deploy u1 < /dev/null
[ "$(cat /etc/mat-runtime/trusted-keys/keyset-seq)" = 17 ] || fail "deploy không được ghi đè keyset-seq đã có"

# Rà soát lần hai T202 N-OTA1: lần cài đầu có --expect-key-id thì chữ ký kiểm bằng openssl NGOÀI gói. Gói giả mạo
# mang bộ kiểm in đúng keyId ghim (và chữ ký rác) phải bị từ chối.
S5=$W/forged-pinned
mkdir -p "$S5"
pkgu u5
printf '#!/bin/sh\n[ "$1" = --key-id ] && { echo "%s"; exit 0; }\nprintf "ok\\t%s\\n"\nexit 0\n' "$KID" "$KID" > "$W/pkg-u5/updater/mat-update-verify"
chmod 755 "$W/pkg-u5/updater/mat-update-verify"
tar -czf "$W/u5.tar.gz" -C "$W/pkg-u5" .
(cd "$W" && sha256sum u5.tar.gz > u5.tar.gz.sha256)
cp "$W/u5.tar.gz" "$W/u5.tar.gz.sha256" "$S5/"
(cd "$S5" && sha256sum u5.tar.gz > SHA256SUMS)
printf '0\002\001\001' > "$S5/SHA256SUMS.sig"
fresh
rm -rf /usr/lib/mat-updater
if sh "$SRC/deployment/device/deploy.sh" "$S5/u5.tar.gz" --expect-key-id "$KID" > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "lần đầu, ghim khóa: bộ kiểm giả của gói in đúng keyId mà vẫn qua"
fi
has "openssl" "lần đầu, ghim khóa: phải kiểm bằng openssl"
has "KHÔNG hợp lệ" "lần đầu, ghim khóa, chữ ký rác: phải báo chữ ký không hợp lệ"
[ ! -e /usr/lib/mat-updater/mat-update-verify ] || fail "gói bị từ chối mà bộ kiểm của nó vẫn được cài"
[ ! -d /opt/mat-runtime ] || fail "gói bị từ chối mà vẫn được cài"
# Cùng gói giả mạo (bộ kiểm in đúng keyId) nhưng SHA256SUMS ký bằng khóa khác khóa ghim: từ chối.
openssl dgst -sha256 -sign "$SRC/tests/update-vectors/keys/test-ec-p256-other.pem" -out "$S5/SHA256SUMS.sig" "$S5/SHA256SUMS" ||
    fail "openssl không ký được SHA256SUMS"
if sh "$SRC/deployment/device/deploy.sh" "$S5/u5.tar.gz" --expect-key-id "$KID" > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "lần đầu, ghim khóa: SHA256SUMS ký bằng khóa khác mà vẫn qua"
fi
# Gói thật, chữ ký đúng, ghim đúng: cài được bằng openssl.
fresh
rm -rf /usr/lib/mat-updater
sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" --expect-key-id "$KID" > "$W/log" 2>&1 < /dev/null ||
    { cat "$W/log"; fail "lần đầu, ghim đúng keyId, chữ ký đúng: phải cài được"; }
expect u2 A
has "openssl" "lần đầu, ghim khóa: phải kiểm bằng openssl"
has "chữ ký phát hành OK (khóa $KID)" "lần đầu, ghim khóa: phải báo OK kèm keyId"
hasnt "CỦA CHÍNH GÓI." "lần đầu, ghim khóa: không dùng bộ kiểm của gói"
[ -x /usr/lib/mat-updater/mat-update-verify ] || fail "lần đầu, ghim khóa: phải cài bộ kiểm sau khi chữ ký đạt"
# Đã cài bộ kiểm nhưng trusted-keys rỗng: khóa là khóa của gói, phải cảnh báo tin-lần-đầu và áp --expect-key-id.
rm -f /etc/mat-runtime/trusted-keys/*.pem
sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" > "$W/log" 2>&1 < /dev/null || { cat "$W/log"; fail "trusted-keys rỗng, chữ ký đúng"; }
has "TIN-LẦN-ĐẦU (TOFU): /etc/mat-runtime/trusted-keys chưa có khóa" "trusted-keys rỗng: phải cảnh báo tin-lần-đầu"
rm -f /etc/mat-runtime/trusted-keys/*.pem
if sh "$SRC/deployment/device/deploy.sh" "$S/u2.tar.gz" --expect-key-id sha256:00 > "$W/log" 2>&1 < /dev/null; then
    cat "$W/log"; fail "trusted-keys rỗng: --expect-key-id sai mà deploy vẫn đạt"
fi
has "khác khóa ghim --expect-key-id" "trusted-keys rỗng: phải áp --expect-key-id"
# Feature 027 (T010): gói đóng trên Windows không giữ bit thực thi: updater/* và bin/ ở 0644 vẫn phải cài được
# (lần deploy trước báo "gói không có mat-updater").
fresh
rm -rf /usr/lib/mat-updater /var/lib/mat-updater
pkgu u7
chmod 644 "$W/pkg-u7/updater/"* "$W/pkg-u7/bin/mat-runtime"
tar -czf "$W/u7.tar.gz" -C "$W/pkg-u7" . && (cd "$W" && sha256sum "u7.tar.gz" > "u7.tar.gz.sha256")
deploy u7 < /dev/null
hasnt "gói không có mat-updater" "gói 0644: mat-updater phải được cài"
for f in mat-update-verify mat-updater mat-updater-recover; do
    [ "$(stat -c %a /usr/lib/mat-updater/$f 2>/dev/null)" = 755 ] || fail "gói 0644: /usr/lib/mat-updater/$f phải 0755"
done
echo "deploy/rollback: OK"
