#!/bin/sh
# Khôi phục bản mat-runtime trước (/opt/mat-runtime.prev, và unit systemd trước nếu có) rồi
# khởi động lại dịch vụ. Dùng (root): sh rollback.sh — bản hỏng giữ ở /opt/mat-runtime.failed.
set -eu
ROOT=/opt/mat-runtime
PREV=$ROOT.prev
FAILED=$ROOT.failed
UNIT=/etc/systemd/system/mat-runtime.service
log() { echo "[rollback] $*"; }

if [ ! -d "$PREV" ]; then
    log "không có $PREV (lần cài đầu): dừng dịch vụ"
    systemctl stop mat-runtime || true
    exit 1
fi
if [ -f "$UNIT.prev" ]; then
    log "khôi phục unit trước"
    mv "$UNIT.prev" "$UNIT"
    systemctl daemon-reload
fi
rm -rf "$FAILED"
[ -d "$ROOT" ] && mv "$ROOT" "$FAILED"
mv "$PREV" "$ROOT"
systemctl restart mat-runtime
sleep 2
log "đã khôi phục bản trước: $(systemctl is-active mat-runtime)"
