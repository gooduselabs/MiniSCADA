# Quickstart — Kiểm chứng Sprint 0

Hướng dẫn chạy để chứng minh từng tiêu chí. Hợp đồng: [contracts/live-ws.md](contracts/live-ws.md), mô hình dữ liệu: [data-model.md](data-model.md).

## Điều kiện
- Docker Desktop đang chạy (hoặc WSL2 Ubuntu 20.04); Node ≥ 24; Go ≥ 1.26.
- BL335 truy cập được qua SSH (192.168.1.110); thông tin đăng nhập lấy từ memory, không đưa vào repo.
- Máy dev và BL335 cùng LAN; Chrome ≥ 120.

## 1. Hồ sơ thiết bị (SC-001/002)
Chạy `tools/measure/device-profile.sh` qua SSH, không cần chép lên thiết bị: `ssh root@192.168.1.XXX 'sh -s' < tools/measure/device-profile.sh > docs/reports/device-profile.md`.
Kỳ vọng: armv7l, glibc 2.31, RAM ~1 GB.

## 2. Build chéo (SC-001)
`./deployment/toolchain/build.ps1` (dựng image `mat-armhf` nếu chưa có, rồi build trong container → `build/armhf/bin/`). Không dùng `cmake --preset`: CMake 3.16 của Ubuntu 20.04 không hỗ trợ preset.
Chép `build/armhf/bin/hello-armhf` lên `/tmp` của thiết bị, `chmod +x`, chạy → in `C++ standard 201703, machine=armv7l, kernel=5.4.61`, thoát mã 0; xóa file sau khi chạy.

## 3. Baseline OS rảnh (SC-002)
Sau khi khởi động ≥ 5 phút, không chạy gì khác trên thiết bị: `ssh root@192.168.1.XXX 'sh -s baseline 300' < tools/measure/sample.sh > baseline.csv`. Kỳ vọng RAM đang dùng ≤ 250 MB.

## 4. PoC + 10 client (SC-003/004)
1. Chạy PoC trên thiết bị: `./mat-poc --port 8080 --docroot ./web --max-clients 10` (binary từ `build/armhf/bin/mat-poc`).
2. Trên máy dev: `build/load-tester.exe --host 192.168.1.110 --port 8080 --clients 10 --extra 1 --duration 300 --out kq.json` (build bằng `go build` trong `tools/load-tester`).
3. Song song trên thiết bị: `sample.sh poc 300 <pid của mat-poc>` (qua SSH như mục 3, thêm pid; thiếu pid thì cột RSS trống).
Kỳ vọng: 10 client nhận delta đều; client 11 nhận `MAX_CLIENTS_REACHED`, close 4429; RSS ≤ 60 MB; CPU ≤ 30%.
Lặp với bản Drogon để so sánh.

## 5. Giải phóng slot (FR-006)
Tự động: `build/load-tester.exe --host 192.168.1.110 --port 8080 --slot-test` (9 client + 1 client im lặng giữ đủ 10 slot; probe @5 s phải bị 4429, probe @30 s phải được nhận, client im lặng nhận 4408; in `SLOT TEST: pass=true`). Thủ công: ngắt 1 client không đóng sạch, đợi > 15 s, client mới được nhận.

## 6. SVG trên Chrome (SC-005)
1. `npm run build:web` → `apps/runtime-web/dist` (chép SVG mẫu từ `tests/fixtures/svg/` và nén sẵn `.gz`).
2. 🔌 ⚠️ Chép `dist/` lên thiết bị làm docroot của `mat-poc` (ví dụ `/root/matpoc/web`) và chạy `mat-poc --docroot <thư mục>`; ghi vào `docs/reports/device-changes.md`.
3. Mở `http://192.168.1.110:8080/` bằng Chrome ≥ 120 → "Đo tất cả"; hoặc đo tự động (Chrome headless trên máy dev):
   `node tools/measure/svg-load.mjs http://192.168.1.110:8080/ --runs 3 --out docs/reports/svg-load.json`.

Kỳ vọng ≤ 2 s mỗi màn hình (tải không cache, LAN 100 Mbps). Trang thử cũng nhận delta WS và đổi màu phần tử có `data-tag`; mở 11 tab thì tab thứ 11 báo 4429.

## 7. Studio (SC-006)
Cần Visual Studio (hoặc Build Tools) có thành phần C++ MSVC + Windows SDK. `$env:CARGO_TARGET_DIR = 'C:uildmat-studio'; npm run studio:build` → bộ cài NSIS (nhúng WebView2 offline); cài trên máy Windows 10 và 11 không Internet; mở được cửa sổ chính. Quy trình chi tiết: [studio-install.md](../../docs/reports/studio-install.md).

## 8. Tổng hợp (SC-007)
Điền bảng Go/No-Go trong `docs/reports/go-no-go.md`; 5 ADR trong `docs/adr/`.
