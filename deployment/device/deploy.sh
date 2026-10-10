#!/bin/sh
# Triển khai mat-runtime trên BL335 theo chuỗi Constitution VII (bản thủ công Sprint 1):
#   checksum -> stage -> validate -> backup -> activate -> health check -> (rollback tự động khi lỗi)
# Dùng (root): sh deploy.sh /tmp/mat-deploy/mat-runtime-armhf.tar.gz
#   (cần file <tarball>.sha256 cạnh gói; MAT_SKIP_CHECKSUM=1 để bỏ qua khi biết rõ lý do)
# Lần đầu cũng cài user hệ thống `matscada`, /etc/mat-runtime/runtime.json và unit systemd
# (không ghi đè config đã có). Mọi thay đổi phải được ghi vào docs/reports/device-changes.md.
set -eu

TARBALL=${1:?Usage: sh deploy.sh <mat-runtime-armhf.tar.gz>}
ROOT=/opt/mat-runtime
NEW=$ROOT.new
PREV=$ROOT.prev
UNIT=/etc/systemd/system/mat-runtime.service
HERE=$(cd "$(dirname "$0")" && pwd)
log() { echo "[deploy] $*"; }

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

# 2. validate bằng user không đặc quyền (không đụng bản đang chạy nếu project lỗi)
log "validate project"
if ! runuser -u matscada -- "$NEW/bin/mat-runtime" --check-project \
    --project-dir "$NEW/project" --schemas-dir "$NEW/schemas" >/tmp/mat-check-project.json 2>&1; then
    cat /tmp/mat-check-project.json
    log "project KHÔNG hợp lệ: dừng, giữ nguyên bản đang chạy"
    rm -rf "$NEW"
    exit 1
fi

# Lần đầu: config; unit mới thì giữ bản cũ để rollback
if [ ! -f /etc/mat-runtime/runtime.json ]; then
    log "cài /etc/mat-runtime/runtime.json"
    install -D -m 644 "$NEW/deployment/runtime.json" /etc/mat-runtime/runtime.json
fi
if ! cmp -s "$NEW/deployment/mat-runtime.service" "$UNIT"; then
    log "cài/cập nhật $UNIT"
    rm -f "$UNIT.prev"
    [ -f "$UNIT" ] && cp -p "$UNIT" "$UNIT.prev"
    install -m 644 "$NEW/deployment/mat-runtime.service" "$UNIT"
    systemctl daemon-reload
    systemctl enable mat-runtime >/dev/null 2>&1
fi

# 3. backup + 4. activate
if [ -d "$ROOT" ]; then
    log "backup $ROOT -> $PREV"
    rm -rf "$PREV"
    mv "$ROOT" "$PREV"
fi
mv "$NEW" "$ROOT"
log "activate: restart mat-runtime"
systemctl restart mat-runtime

# 5. health check: project phải active trong 15 s
PORT=$(sed -n 's/.*"port"[^0-9]*\([0-9]*\).*/\1/p' /etc/mat-runtime/runtime.json | head -1)
PORT=${PORT:-8080}
i=0
while [ $i -lt 15 ]; do
    sleep 1
    i=$((i + 1))
    if wget -qO- "http://127.0.0.1:$PORT/api/v1/system/info" 2>/dev/null | grep -q '"status":"active"'; then
        log "health check OK sau ${i} s: $(wget -qO- http://127.0.0.1:$PORT/api/v1/system/info)"
        exit 0
    fi
done
log "health check THẤT BẠI: rollback"
journalctl -u mat-runtime -n 20 --no-pager || true
sh "$HERE/rollback.sh"
exit 1
