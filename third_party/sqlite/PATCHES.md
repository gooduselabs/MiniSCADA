# Thay đổi so với bản gốc SQLite 3.54.0

> **Cờ build, không phải bản vá (feature 006 T007, 2026-10-12):** `CMakeLists.txt` biên dịch SQLite với `HAVE_FDATASYNC=1`: mọi lần đồng bộ của `audit.db` và `history.db` là `fdatasync`, không phải `fsync` (độ bền không đổi, byte ghi mỗi commit `synchronous=FULL` giảm khoảng một nửa, ADR-017 điểm 5, research R15). Test: `core/historian/tests/sqlite_sync_test.cpp`.

`sqlite3.c` là amalgamation 3.54.0 (`SQLITE_SOURCE_ID` 2026-10-09 15:46:58 be8d059e…), public domain. Dự án chỉ sửa một chỗ, có đánh dấu `mat-runtime patch` trong mã.

## 1. `sqlite3VdbeMakeReady`: tràn heap trên máy 32-bit (2026-10-11)

**Hiện tượng:** `mat-runtime` trên BL335 (armhf) dừng với `free(): invalid pointer` ngay khi mở `history.db`. AddressSanitizer bản armhf chạy trên thiết bị báo `heap-buffer-overflow` (ghi 16 byte ngay sau vùng 1028 byte) ở `memset(p->apCsr, …)`, khi chuẩn bị câu lệnh đầu tiên (`PRAGMA journal_mode=WAL; …`).

**Nguyên nhân:** phần trống cuối mảng opcode được tính là `ROUNDDOWN8((nOpAlloc - nOp) * sizeof(Op))`, trong khi phần đã dùng là `n = ROUND8P(sizeof(Op) * nOp)`:

- Trên máy 32-bit, `sizeof(Op)` = 20 và `ROUND8P` làm tròn `n` lên tới 4 byte.
- Phần đã dùng cộng phần trống vì vậy có thể vượt vùng đã cấp. Thanh ghi, tham số và con trỏ cursor được đặt ra ngoài vùng nhớ, ghi đè header của chunk kế tiếp.
- Trên máy 64-bit, `sizeof(Op)` = 24 và `ROUND8P` không làm gì, nên lỗi không bao giờ lộ. Mọi test x64 của dự án đều không thấy được.

**Sửa:** phần trống là số byte vùng cấp còn lại sau `n`, làm tròn xuống: `ROUNDDOWN8(nOpAlloc*sizeof(Op) - n)`, bằng 0 nếu không còn.

**Kiểm:**

- `deployment/toolchain/smoke-armhf.sh` (bước `armhf smoke (qemu)` của `tools/ci-local.ps1`) chạy runtime armhf dưới qemu-user với project có lưu trữ. Trước khi sửa, bước này dừng y như trên thiết bị; sau khi sửa thì chạy đạt.
- Bản ASan armhf chạy trên BL335 không còn báo lỗi.

**Khi nâng SQLite:** kiểm lại đoạn này trong bản mới. Nếu bản gốc đã sửa thì bỏ patch; dù thế nào cũng giữ bước smoke armhf.
