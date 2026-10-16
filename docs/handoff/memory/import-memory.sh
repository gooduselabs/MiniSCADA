#!/usr/bin/env bash
# Nhập memory của Claude Code cho dự án mAT SCADA vào máy hiện tại.
# Chạy từ thư mục gốc của repo (hoặc truyền đường dẫn repo làm tham số 1):
#   bash docs/handoff/memory/import-memory.sh
#   bash docs/handoff/memory/import-memory.sh --force      # ghi đè file đã có
# Hoạt động trên macOS, Linux và Git Bash (Windows).
#
# Memory của Claude Code nằm ở:  ~/.claude/projects/<đường dẫn dự án, mọi ký tự không phải chữ/số
# đổi thành '-'>/memory/   (ví dụ /Users/ten/MiniSCADA -> -Users-ten-MiniSCADA).
set -euo pipefail

FORCE=0
REPO=""
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    *) REPO="$a" ;;
  esac
done
REPO="${REPO:-$(pwd)}"
REPO="$(cd "$REPO" && pwd)"
SRC="$REPO/docs/handoff/memory"
[ -f "$SRC/MEMORY.md" ] || { echo "Không thấy $SRC/MEMORY.md: chạy script từ thư mục gốc của repo." >&2; exit 1; }

ENC="$(printf '%s' "$REPO" | sed 's/[^A-Za-z0-9]/-/g')"
DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/$ENC/memory"
mkdir -p "$DEST"

n=0
for f in "$SRC"/*.md; do
  b="$(basename "$f")"
  if [ -e "$DEST/$b" ] && [ "$FORCE" != 1 ]; then
    echo "bỏ qua (đã có): $b   (dùng --force để ghi đè)"
    continue
  fi
  cp "$f" "$DEST/$b"
  n=$((n+1))
  echo "đã chép: $b"
done

echo
echo "Xong: $n file vào $DEST"
echo
echo "Việc còn lại (làm tay, bản gốc nằm ngoài repo vì repo công khai):"
echo "  Chép file bl335-ssh-access.md GỐC (có địa chỉ và mật khẩu thiết bị) đè lên"
echo "  $DEST/bl335-ssh-access.md"
echo "  (chuyển bằng AirDrop, USB hoặc trình quản lý mật khẩu; đừng đưa qua git)."
echo "Rồi mở Claude Code trong $REPO và dán nội dung docs/handoff/PROMPT.md."
