#!/bin/sh
# Triển khai mat-runtime trên BL335 theo chuỗi Constitution VII (bản thủ công Sprint 1):
#   checksum -> stage -> validate -> backup -> activate -> health check -> (rollback tự động khi lỗi)
#   Health check gồm cả cổng HTTPS (feature 005). Đạt thì in fingerprint chứng chỉ HTTPS, và tạo
#   tài khoản quản trị đầu tiên nếu chưa có (có terminal: hỏi mật khẩu; không có: in bước bắt buộc).
# Dùng (root): sh "$D/deploy.sh" "$D/mat-runtime-armhf.tar.gz" [--expect-key-id sha256:<hex>], với D=$(mktemp -d)
#   chứa gói, deploy.sh, rollback.sh (cần file <tarball>.sha256 cạnh gói; MAT_SKIP_CHECKSUM=1 để bỏ qua khi biết rõ
#   lý do). --expect-key-id ghim khóa ký SHA256SUMS (keyId in bởi `node tools/release/sums.mjs keyid <pub.pem>`):
#   khi có, bắt buộc có SHA256SUMS + .sig và khóa ký phải đúng keyId này.
# Lần đầu cũng cài user hệ thống `matscada`, /etc/mat-runtime/runtime.json và unit systemd
# (không ghi đè config đã có). Mọi thay đổi phải được ghi vào docs/reports/device-changes.md.
set -eu

log() { echo "[deploy] $*"; }
TARBALL=${1:?Usage: sh deploy.sh <mat-runtime-armhf.tar.gz> [--expect-key-id <keyId>]}
shift
EXPECT_KEY_ID=
while [ $# -gt 0 ]; do
    case $1 in
    --expect-key-id)
        [ $# -ge 2 ] && [ -n "$2" ] || { log "--expect-key-id cần một keyId"; exit 2; }
        EXPECT_KEY_ID=$2
        shift 2 ;;
    *) log "tham số lạ: $1"; exit 2 ;;
    esac
done
ROOT=/opt/mat-runtime
NEW=$ROOT.new
PREV=$ROOT.prev
UNIT=/etc/systemd/system/mat-runtime.service
HERE=$(cd "$(dirname "$0")" && pwd)

# 0. checksum của gói (Constitution V)
if [ "${MAT_SKIP_CHECKSUM:-0}" != "1" ]; then
    if [ ! -f "$TARBALL.sha256" ]; then
        log "thiếu $TARBALL.sha256: dừng (MAT_SKIP_CHECKSUM=1 để bỏ qua)"
        exit 1
    fi
    expected=$(cut -d' ' -f1 "$TARBALL.sha256")
    actual=$(sha256sum "$TARBALL" | cut -d' ' -f1)
    if [ "$expected" != "$actual" ]; then
        log "SHA-256 không khớp: dừng"
        exit 1
    fi
    log "SHA-256 OK"
fi

# User hệ thống (cần trước bước validate để không chạy binary mới bằng root)
if ! id matscada >/dev/null 2>&1; then
    log "tạo user hệ thống matscada (không đăng nhập)"
    useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin matscada
fi

# 1. stage
log "stage -> $NEW"
rm -rf "$NEW"
mkdir -p "$NEW"
tar -xzf "$TARBALL" -C "$NEW"
chown -R root:root "$NEW"
chmod -R u=rwX,go=rX "$NEW"
chmod 755 "$NEW/bin/mat-runtime"

# Feature 011 (T100, FR-067, ADR-035): chữ ký phát hành. Có SHA256SUMS và SHA256SUMS.sig cạnh gói thì
# kiểm chữ ký (khóa tin cậy: /etc/mat-runtime/trusted-keys nếu đã có, lần đầu thì khóa công khai trong gói)
# và băm của gói trong SHA256SUMS; sai thì dừng. Thiếu thì chỉ cảnh báo: deploy.sh là đường cài lần đầu và
# đường khôi phục khi OTA hỏng (trừ khi có --expect-key-id: khi đó bắt buộc có chữ ký).
# Rà soát T062 F1: bộ kiểm là /usr/lib/mat-updater/mat-update-verify đã cài, không bao giờ là binary của chính
# gói đang được kiểm (gói giả mạo mang bộ kiểm luôn trả "ok"). Chỉ lần cài đầu (chưa có bộ kiểm đã cài) mới
# dùng bộ kiểm của gói, kèm cảnh báo tin-lần-đầu (TOFU): ghim khóa bằng --expect-key-id, hoặc so tay.
INSTALLED_VERIFY=/usr/lib/mat-updater/mat-update-verify
PKGDIR=$(cd "$(dirname "$TARBALL")" && pwd)
if [ -f "$PKGDIR/SHA256SUMS" ] && [ -f "$PKGDIR/SHA256SUMS.sig" ]; then
    KEYS_CHECK=/etc/mat-runtime/trusted-keys
    ls "$KEYS_CHECK"/*.pem >/dev/null 2>&1 || KEYS_CHECK=$NEW/deployment/keys
    if [ -x "$INSTALLED_VERIFY" ]; then
        VERIFY=$INSTALLED_VERIFY
    else
        VERIFY=$NEW/updater/mat-update-verify
        if [ ! -x "$VERIFY" ]; then
            log "chưa cài mat-update-verify và gói không có updater/mat-update-verify: không kiểm được SHA256SUMS.sig: dừng"
            rm -rf "$NEW"
            exit 1
        fi
        log "CẢNH BÁO TIN-LẦN-ĐẦU (TOFU): chưa có $INSTALLED_VERIFY, chữ ký được kiểm bằng mat-update-verify CỦA CHÍNH GÓI."
        log "    Gói giả mạo qua được bước này. Chỉ cài gói lấy từ nguồn tin cậy; ghim khóa: --expect-key-id <keyId>"
        log "    (keyId công bố của khóa phát hành), hoặc so SHA256SUMS với bản công bố trước khi cài."
    fi
    if ! OUT=$("$VERIFY" "$PKGDIR/SHA256SUMS" --sig "$PKGDIR/SHA256SUMS.sig" --keys "$KEYS_CHECK" --sig-only); then
        log "chữ ký SHA256SUMS KHÔNG hợp lệ (khóa $KEYS_CHECK, bộ kiểm $VERIFY): dừng, giữ nguyên bản đang chạy"
        rm -rf "$NEW"
        exit 1
    fi
    SIGNER=$(printf '%s\n' "$OUT" | awk -F '\t' '$1 == "ok" { print $2; exit }')
    if [ -n "$EXPECT_KEY_ID" ] && [ "$SIGNER" != "$EXPECT_KEY_ID" ]; then
        log "khóa ký SHA256SUMS ($SIGNER) khác khóa ghim --expect-key-id ($EXPECT_KEY_ID): dừng"
        rm -rf "$NEW"
        exit 1
    fi
    NAME=$(basename "$TARBALL")
    WANT=$(awk -v n="$NAME" '$2 == n || $2 == "*" n { print $1 }' "$PKGDIR/SHA256SUMS")
    if [ -z "$WANT" ] || [ "$WANT" != "$(sha256sum "$TARBALL" | cut -d' ' -f1)" ]; then
        log "$NAME không có trong SHA256SUMS hoặc băm khác: dừng"
        rm -rf "$NEW"
        exit 1
    fi
    log "chữ ký phát hành OK (khóa $SIGNER)"
elif [ -n "$EXPECT_KEY_ID" ]; then
    log "--expect-key-id mà không có SHA256SUMS và SHA256SUMS.sig cạnh gói: dừng"
    rm -rf "$NEW"
    exit 1
else
    log "CẢNH BÁO: không có SHA256SUMS và SHA256SUMS.sig cạnh gói: không kiểm được chữ ký phát hành (vẫn cài)"
fi

# Feature 007: danh mục widget là nguồn duy nhất của luật kiểm project 0.3; thiếu nó runtime không
# kiểm được project 0.3/0.6 (schemas/0.2 cần cho project 0.2, schemas/0.3, 0.4, 0.5 cho project 0.3, 0.4, 0.5; gốc schemas/ là 0.6):
# dừng, giữ nguyên bản đang chạy.
if [ ! -f "$NEW/schemas/widgets.catalog.json" ]; then
    log "gói thiếu schemas/widgets.catalog.json: dừng, giữ nguyên bản đang chạy"
    rm -rf "$NEW"
    exit 1
fi
for v in 0.3 0.4 0.5; do
    if [ ! -d "$NEW/schemas/$v" ]; then
        log "gói thiếu schemas/$v: dừng, giữ nguyên bản đang chạy"
        rm -rf "$NEW"
        exit 1
    fi
done
if [ ! -d "$NEW/schemas/0.2" ]; then
    log "gói thiếu schemas/0.2: dừng, giữ nguyên bản đang chạy"
    rm -rf "$NEW"
    exit 1
fi

# 2. validate bằng user không đặc quyền (không đụng bản đang chạy nếu project lỗi)
log "validate project"
# kết quả vào file tạm tên ngẫu nhiên: root không ghi theo một symlink ai đó đặt sẵn trong /tmp
CHECK_OUT=$(mktemp)
if ! runuser -u matscada -- "$NEW/bin/mat-runtime" --check-project \
    --project-dir "$NEW/project" --schemas-dir "$NEW/schemas" >"$CHECK_OUT" 2>&1; then
    cat "$CHECK_OUT"
    rm -f "$CHECK_OUT"
    log "project KHÔNG hợp lệ: dừng, giữ nguyên bản đang chạy"
    rm -rf "$NEW"
    exit 1
fi
rm -f "$CHECK_OUT"

# Lần đầu: config
if [ ! -f /etc/mat-runtime/runtime.json ]; then
    log "cài /etc/mat-runtime/runtime.json"
    install -D -m 644 "$NEW/deployment/runtime.json" /etc/mat-runtime/runtime.json
fi

# 3. backup
if [ -d "$ROOT" ]; then
    log "backup $ROOT -> $PREV"
    rm -rf "$PREV"
    mv "$ROOT" "$PREV"
fi
# Unit đi cặp với bản backup, nên chỉ đổi .prev sau khi đã backup (deploy dừng trước đó thì cặp
# $PREV + $UNIT.prev cũ còn nguyên). Đổi unit: giữ unit đang dùng làm .prev. Không đổi: .prev cũ là
# unit của lần deploy trước nữa, xóa để rollback giữ unit hiện tại (review R-16).
if ! cmp -s "$NEW/deployment/mat-runtime.service" "$UNIT"; then
    log "cài/cập nhật $UNIT"
    rm -f "$UNIT.prev"
    [ -f "$UNIT" ] && cp -p "$UNIT" "$UNIT.prev"
    install -m 644 "$NEW/deployment/mat-runtime.service" "$UNIT"
    systemctl daemon-reload
    systemctl enable mat-runtime >/dev/null 2>&1
else
    rm -f "$UNIT.prev"
fi

# 4. activate
mv "$NEW" "$ROOT"
log "activate: restart mat-runtime"
systemctl restart mat-runtime

# 5. health check: trong 15 lần thử, project phải active, và (feature 005) cổng HTTPS phải trả lời
# khi httpsPort khác 0 (mặc định 8443): một request thật qua TLS. Chứng chỉ tự ký nên không kiểm CA;
# fingerprint in ở bước 6 để so khi ghim trong Studio.
CONF=/etc/mat-runtime/runtime.json
PORT=$(sed -n 's/.*"port"[^0-9]*\([0-9]*\).*/\1/p' "$CONF" | head -1)
PORT=${PORT:-8080}
HTTPS_PORT=$(sed -n 's/.*"httpsPort"[^0-9]*\([0-9]*\).*/\1/p' "$CONF" | head -1)
HTTPS_PORT=${HTTPS_PORT:-8443}
https_up() {
    [ "$HTTPS_PORT" = 0 ] && return 0
    wget -q -T 2 -t 1 --no-check-certificate -O- "https://127.0.0.1:$HTTPS_PORT/api/v1/system/info" >/dev/null 2>&1
}
i=0
ok=0
why="project chưa active"
while [ $i -lt 15 ]; do
    sleep 1
    i=$((i + 1))
    if wget -qO- "http://127.0.0.1:$PORT/api/v1/system/info" 2>/dev/null | grep -q '"status":"active"'; then
        if https_up; then
            ok=1
            break
        fi
        why="cổng HTTPS $HTTPS_PORT không trả lời"
    fi
done
if [ $ok = 0 ]; then
    log "health check THẤT BẠI ($why): rollback"
    journalctl -u mat-runtime -n 20 --no-pager || true
    sh "$HERE/rollback.sh"
    exit 1
fi
log "health check OK sau ${i} s: $(wget -qO- http://127.0.0.1:$PORT/api/v1/system/info)"

# Lời nhắc bản 0.7.0 (feature 008, FR-066): runtime nhận project định dạng 0.4 (đồ họa SVG, hoạt ảnh, sự kiện từ
# phần tử SVG). Project 0.4 chỉ chạy từ runtime 0.7.0; quay lại bản cũ bằng rollback.sh thì project 0.4 đang chạy bị
# runtime cũ từ chối, phải nạp lại project 0.3 từ Studio. Phần tử SVG có sự kiện ghi chịu cùng luật quyền, xác nhận và
# audit như widget (kênh web, context.widget = UID phần tử).
log "runtime 0.7.0: nhận project 0.4 (SVG); quay lại bản cũ thì cần nạp lại project 0.3 từ Studio"

# 6. Sau khi đạt (feature 005, contract device-config §5). Bước này không làm deploy thất bại.
BIN=$ROOT/bin/mat-runtime

# Feature 011 (T100, T115; ADR-035): cập nhật qua mạng. mat-updater, mat-update-verify và ba unit chỉ cài
# bằng deploy.sh (không bao giờ qua OTA); khóa công khai của gói vào /etc/mat-runtime/trusted-keys khi thư
# mục chưa có khóa nào (root, 0644). OTA vẫn TẮT tới khi root đặt "update": {"enabled": true} trong
# runtime.json và khởi động lại.
install_updater() {
    U=$ROOT/updater
    if [ ! -x "$U/mat-update-verify" ] || [ ! -f "$U/mat-updater" ]; then
        log "gói không có mat-updater: bỏ qua phần cập nhật qua mạng"
        return 0
    fi
    install -d -m 755 /usr/lib/mat-updater
    for f in mat-update-verify mat-updater mat-updater-recover; do
        install -m 755 "$U/$f" "/usr/lib/mat-updater/$f.tmp" && mv -f "/usr/lib/mat-updater/$f.tmp" "/usr/lib/mat-updater/$f"
    done
    install -d -m 700 /var/lib/mat-updater
    install -d -m 755 /etc/mat-runtime/trusted-keys
    if ! ls /etc/mat-runtime/trusted-keys/*.pem >/dev/null 2>&1; then
        for k in "$ROOT"/deployment/keys/*.pub.pem; do
            [ -f "$k" ] || continue
            install -m 644 "$k" "/etc/mat-runtime/trusted-keys/$(basename "$k" .pub.pem).pem"
            log "cài khóa tin cậy $(basename "$k" .pub.pem): $(/usr/lib/mat-updater/mat-update-verify --key-id "$k")"
        done
    fi
    ls /etc/mat-runtime/trusted-keys/*.pem >/dev/null 2>&1 ||
        log "chưa có khóa tin cậy: OTA sẽ báo UPDATE_KEYS_MISSING (thêm bằng mat-runtime --trust-key add)"
    for u in mat-updater.service mat-updater.path mat-updater-recover.service; do
        install -m 644 "$ROOT/deployment/$u" "/etc/systemd/system/$u"
    done
    if command -v systemd-analyze >/dev/null 2>&1; then
        systemd-analyze verify /etc/systemd/system/mat-updater.service /etc/systemd/system/mat-updater.path \
            /etc/systemd/system/mat-updater-recover.service || log "systemd-analyze verify báo lỗi ở unit của mat-updater"
    fi
    systemctl daemon-reload
    systemctl enable mat-updater.path mat-updater-recover.service >/dev/null 2>&1
    systemctl start mat-updater.path
    log "mat-updater đã cài (/usr/lib/mat-updater); cập nhật qua mạng mặc định TẮT (update.enabled)"
}
install_updater
# Fingerprint của chứng chỉ HTTPS: Studio hiện nó ở lần Online đầu, kỹ sư so trước khi ghim.
if [ "$HTTPS_PORT" = 0 ]; then
    log "HTTPS tắt (httpsPort = 0): Studio chỉ theo dõi qua HTTP, không đăng nhập hay nạp xuống được"
elif FP=$(runuser -u matscada -- "$BIN" --cert-fingerprint 2>&1); then
    log "chứng chỉ HTTPS của thiết bị: $FP"
    log "GHI LẠI fingerprint trên: lần đầu Online, Studio hiện fingerprint để ghim; so đủ từng cặp ký tự rồi mới xác nhận"
else
    log "không đọc được fingerprint của chứng chỉ HTTPS: $FP"
fi
# Tài khoản quản trị đầu tiên (FR-011). --user-list in mỗi tài khoản một dòng: tên, role, bật/tắt, ...
# Chưa có administrator đang bật: có terminal thì hỏi mật khẩu ngay (mã 2 = mật khẩu bị từ chối,
# cho nhập lại, tối đa 3 lần); không có terminal (script tự động) thì in bước bắt buộc rồi đi tiếp.
# Trang xem vẫn chạy; mọi đăng nhập bị từ chối tới khi có tài khoản.
required_step() {
    log "BƯỚC BẮT BUỘC: tạo tài khoản quản trị bằng lệnh sau (root, trên terminal của thiết bị):"
    log "    $BIN --user-add admin --role administrator"
    log "(đã có tài khoản thì bật lại hoặc đổi role: --user-enable <tên>, --user-role <tên> administrator)"
    log "Chưa có tài khoản administrator đang bật thì Studio không đăng nhập được; trang xem vẫn chạy."
}
if ! USERS=$("$BIN" --user-list); then  # lỗi và cảnh báo của lệnh tự in ra (stderr)
    log "không đọc được danh sách tài khoản (lỗi ở trên)"
    required_step
elif printf '%s\n' "$USERS" | awk '$2 == "administrator" && $3 == "bật" { f = 1 } END { exit !f }'; then
    log "đã có tài khoản administrator đang bật"
elif [ -t 0 ]; then
    log "chưa có tài khoản administrator: tạo tài khoản admin (mật khẩu 15–128 ký tự, nhập hai lần)"
    tries=1
    until "$BIN" --user-add admin --role administrator; do
        rc=$?
        if [ "$rc" != 2 ] || [ $tries -ge 3 ]; then
            required_step
            break
        fi
        tries=$((tries + 1))
        log "nhập lại (lần $tries/3)"
    done
else
    required_step
fi

# Lời nhắc lần đầu lên 0.6 (feature 007, contracts/device-config-007.md §3). Deploy không tự đổi chứng
# chỉ, tài khoản hay runtime.json; người chạy ghi các việc dưới vào docs/reports/device-changes.md.
log "--- Từ 0.6: điều khiển trên Chrome ---"
log "Điều khiển trên Chrome cần tài khoản operator: $BIN --user-add <tên> --role operator"
if [ "$HTTPS_PORT" != 0 ]; then
    CERT_INFO=$(runuser -u matscada -- "$BIN" --cert-info 2>/dev/null || true)
    if [ -n "$CERT_INFO" ] && ! printf '%s\n' "$CERT_INFO" | grep -q 'IP:'; then
        log "TLS_NO_IP_SAN: chứng chỉ không có địa chỉ IP trong SAN, Chrome sẽ báo lỗi chứng chỉ khi mở bằng IP."
        log "    Xử lý: $BIN --regen-cert (đổi fingerprint, Studio phải ghim lại) hoặc --make-csr rồi --import-cert"
        log "    (CA của khách hàng). Hướng dẫn cài chứng chỉ cho Chrome: docs/deployment/mat-runtime.md"
    fi
fi
log "viewerLogin: mặc định off (xem không cần đăng nhập); đặt required trong /etc/mat-runtime/runtime.json nếu muốn"
# Feature 011 (FR-013): kiểm Host chống DNS rebinding. Mở bằng IP luôn được; mở bằng tên khác tên máy cần khai.
log "--- Từ 1.0: kiểm tên trong tiêu đề Host ---"
log "Mở bằng IP, localhost, $(hostname) hoặc $(hostname).local: không cần làm gì."
log "Mở bằng tên miền (DNS nội bộ, DDNS): thêm tên vào \"allowedHosts\" của /etc/mat-runtime/runtime.json rồi"
log "    systemctl restart mat-runtime; chưa thêm thì trình duyệt nhận 421 HOST_NOT_ALLOWED."
# Feature 011 (FR-017, ADR-011): mật khẩu mới 15–128 ký tự; tài khoản có sẵn không bị ép đổi.
log "Tài khoản: mật khẩu 15–128 ký tự khi tạo hay đổi (--user-add, --user-passwd); tài khoản cũ có mật khẩu"
log "    ngắn hơn vẫn đăng nhập được, nên đổi: $BIN --user-passwd <tên>"
log "Khóa đăng nhập theo (tên, IP): mở cho một tên $BIN --user-unlock <tên>, mọi tên --user-unlock-all"

# Feature 011 (FR-034, research R12): cảnh báo khi root đăng nhập SSH được bằng mật khẩu. Chỉ đọc cấu hình,
# KHÔNG bao giờ sửa sshd (có thể làm mất đường vào thiết bị). Có `sshd -T` thì dùng giá trị hiệu lực của sshd;
# không thì đọc file chính như sshd: giá trị đầu tiên thắng, dòng trong khối Match không đặt giá trị chung
# (Include không theo; runtime đọc đủ và báo SSH_ROOT_PASSWORD trong system/info). Không đọc được: không báo.
SSHD_CONFIG=${MAT_SSHD_CONFIG:-/etc/ssh/sshd_config}
ssh_values() { # in "<permitrootlogin> <passwordauthentication>" (chữ thường)
    if [ -z "${MAT_SSHD_CONFIG:-}" ] && command -v sshd >/dev/null 2>&1 && T=$(sshd -T 2>/dev/null); then
        printf '%s\n' "$T" | awk '
            tolower($1) == "permitrootlogin" && p == "" { p = tolower($2) }
            tolower($1) == "passwordauthentication" && a == "" { a = tolower($2) }
            END { print (p == "" ? "prohibit-password" : p), (a == "" ? "yes" : a) }'
        return 0
    fi
    [ -r "$SSHD_CONFIG" ] || return 1
    tr -d '\r' < "$SSHD_CONFIG" | awk '
        { sub(/#.*/, ""); k = tolower($1) }
        k == "" { next }
        k == "match" { m = 1; next }
        m { next }
        k == "permitrootlogin" && p == "" { p = tolower($2) }
        k == "passwordauthentication" && a == "" { a = tolower($2) }
        END { print (p == "" ? "prohibit-password" : p), (a == "" ? "yes" : a) }'
}
if V=$(ssh_values); then
    set -- $V
    if [ "$1" = yes ] && [ "$2" != no ]; then
        log "CẢNH BÁO SSH_ROOT_PASSWORD: sshd cho root đăng nhập bằng mật khẩu (PermitRootLogin yes)."
        log "    Làm theo docs/deployment/hardening.md: cài khóa SSH, thử đăng nhập bằng khóa, rồi mới đặt"
        log "    PermitRootLogin prohibit-password. deploy.sh không tự sửa sshd (tránh mất đường vào thiết bị)."
    fi
fi
exit 0
