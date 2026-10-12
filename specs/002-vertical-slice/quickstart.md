# Quickstart — kiểm chứng Sprint 1 (vertical slice)

Hướng dẫn chạy để chứng minh feature hoạt động end-to-end. Chi tiết giao thức xem [contracts/](contracts/), dữ liệu xem [data-model.md](data-model.md). Thông tin SSH tới BL335 nằm trong memory, **không** ghi vào repo.

## 0. Điều kiện

- Máy dev Windows: Docker Desktop, Node (workspace npm đã `npm ci`), Go, Chrome ≥ 120. Rust MSVC để build Studio (`CARGO_TARGET_DIR=C:\build\mat-studio`).
- BL335 (`192.168.1.110`) đang bật. User `matscada` do `deploy.sh` tạo ở lần cài đầu.
- Ổ D: còn ≥ 500 MB (xóa `build/armhf`, `build/x64` cũ nếu thiếu).

## 1. Kiểm tra cục bộ (phải xanh)

```powershell
./tools/ci-local.ps1
```

Kết quả mong đợi `ci-local: ALL STEPS PASSED`. Lệnh gồm: clang-format, build armhf, build x64 + ctest (GoogleTest: session/queue, live hub, mock provider, validator C++ chạy `tests/project-vectors`), Go (load-tester), lint, typecheck, Vitest (4 package + runtime-web + studio), build web.

## 2. Kiểm project mẫu bằng CLI

```powershell
node tools/project-validator/validate.mjs projects/tank-demo      # → {"valid":true,...}, exit 0
node tools/project-validator/validate.mjs tests/project-vectors/invalid-ref-tag   # → E_REF_TAG, exit 1
```

## 3. Chạy x64 cục bộ (tùy chọn, trước khi lên thiết bị)

```powershell
./deployment/toolchain/run-x64.ps1    # container chạy mat-runtime x64 trên cổng 8080 với projects/tank-demo
```

Mở `http://localhost:8080/`: bồn nước lên xuống, motor đổi màu và quay. `http://localhost:8080/api/v1/system/info` trả `project.status = "active"`.

## 4. Đóng gói và deploy lên BL335

```powershell
./deployment/toolchain/build.ps1                  # armhf
npm run build:web
./deployment/package-runtime.ps1                  # → build/mat-runtime-armhf.tar.gz + .sha256; báo lỗi nếu gói có fixture/lab
```

Trên BL335, làm theo [docs/deployment/mat-runtime.md §3](../../docs/deployment/mat-runtime.md) (BL335 không có `sudo`: lệnh chạy trong phiên SSH `root`):
1. Kiểm cổng: `ss -ltnp | grep ':8080 '`. Nếu `mat-poc` đang giữ cổng thì `systemctl disable --now mat-poc`.
2. Chép gói **kèm file `.sha256`** và hai script lên thiết bị rồi chạy `sh deploy.sh <gói>`: kiểm SHA-256 → stage → `--check-project` (user `matscada`) → lần đầu cài user, `runtime.json`, unit → backup `.prev` → activate → health check → tự rollback khi lỗi. Rollback tay: `sh /opt/mat-runtime/deployment/rollback.sh`.

Ghi từng thay đổi vào `docs/reports/device-changes.md` kèm cách hoàn tác.

Mong đợi: `systemctl status mat-runtime` = active; `curl http://192.168.1.110:8080/api/v1/system/info` trả `project.status = "active"`.

## 5. Nghiệm thu chức năng (Chrome thật)

| # | Bước | Mong đợi | Spec |
|---|---|---|---|
| 1 | Mở `http://192.168.1.110:8080/` trên 1 máy | Màn hình hiển thị và chạy trong ≤ 2 s; mức bồn khớp `TANK01.LEVEL`; motor xanh + quay khi chạy, xám khi dừng; chữ nhiệt độ hiển thị `--` khoảng 5 s mỗi 20 s (`TANK01.TEMP` BAD) | US1, SC-004 |
| 2 | Mở tổng 10 tab trên ≥ 2 máy, để ≥ 10 phút | Mọi tab cập nhật; badge "Trực tuyến"; không có mất sequence chưa khôi phục (xem bộ đếm debug `?debug=1`) | SC-001 |
| 3 | Mở tab 11 | Thông báo "Hệ thống đã đạt tối đa 10 kết nối…" và đếm ngược 30 s; 10 tab kia không gián đoạn | US2, SC-002 |
| 4 | Đóng 1 tab trong 10, chờ tab 11 đếm hết (hoặc bấm "Thử lại ngay") | Tab 11 vào được | US2-2, US2-4 |
| 5 | Rút cáp 1 máy ≥ 30 s | Trong ≤ 15 s: giá trị xám/STALE và badge "Mất kết nối"; `system/info.clients` giảm trong ≤ 20 s | US3, SC-003 |
| 6 | Cắm lại | Trong ≤ 30 s: tự kết nối, giá trị hiện hành, hết STALE, không tải lại trang | US3, SC-003 |
| 7 | Chuyển tab ẩn rồi hiện lại | Motor ngừng quay khi ẩn, quay đúng trạng thái khi hiện | FR-011 |
| 8 | Bấm F5 đồng thời trên 10 tab | Tất cả hiển thị dữ liệu sống trong ≤ 5 s | SC-007 |

Ghi cấu hình thực tế (số máy, Chrome, mạng) và kết quả vào `docs/reports/sprint1-acceptance.md`.

## 6. Tải, client chậm, Origin, race (công cụ tải từ máy dev)

```powershell
cd tools/load-tester
go run . -host 192.168.1.110 -clients 10 -extra 1 -tags sim -duration 300 -out ../../docs/reports/sprint1-load.json
go run . -host 192.168.1.110 -clients 9 -slow 1 -extra 0 -duration 600 -out ../../docs/reports/sprint1-slow.json
go run . -host 192.168.1.110 -origin http://evil.example -clients 1          # → 403, clients không tăng
go run . -host 192.168.1.110 -resub 100 -tags demo -out ../../docs/reports/sprint1-resub.json
go run . -host 192.168.1.110 -slot-test
```

Song song trên BL335: `sh sample.sh sprint1-10c-500tag 300 $(pidof mat-runtime) > /tmp/sprint1-budget.csv`, sau đó copy về `docs/reports/sprint1-budget.csv`.

Mong đợi:
- Lần chạy 1: 10 client 0 mất sequence, client 11 nhận 4429.
- `sprint1-budget.csv`: RSS ≤ 150 MB, CPU TB ≤ 30 %, đỉnh ≤ 60 % (SC-005).
- Client chậm (`-slow`: ngừng đọc hẳn sau snapshot): máy chủ bỏ phiên sau khoảng 10 s ghi quá hạn, `system/info.writeFailedTotal` tăng 1, `clients` giảm ngay; 9 client còn lại 0 mất sequence; RSS phẳng (SC-006). `resync_required` + 4409 chỉ xảy ra khi client vẫn đọc nhưng chậm hơn tốc độ dữ liệu (ví dụ resub 500 Tag qua đường chậm).
- Resub (5 Tag `demo`): 0 mất sequence (FR-020). Với 500 Tag (`-tags sim`, mặc định) qua Internet, máy chủ đóng 4409 vì băng thông không kịp.
- Slot-test: 4408 sau khoảng 15 s.

## 7. Bảo mật

- `curl -I http://192.168.1.110:8080/project/screens/tank-motor.svg` → có `Content-Security-Policy: default-src 'none'; … sandbox`.
- `curl -I http://192.168.1.110:8080/screens/unsafe-elements.svg` → 404 (không có trong gói).
- Chạy x64 với project test có SVG chứa `<script>`; mở thẳng URL `/project/...` trên Chrome: script không chạy (SC-009).

## 8. Khả năng phục hồi dịch vụ

- `kill -9 $(pidof mat-runtime)` (phiên SSH `root`): dịch vụ lên lại trong ≤ 10 s, các tab tự kết nối lại.
- `reboot` (cần người dùng cho phép rõ): sau khi boot, trang truy cập được, không cần thao tác gì (SC-010, SC-013).

## 9. Studio

```powershell
$env:CARGO_TARGET_DIR='C:\build\mat-studio'; npm run studio:build
```

Cài bộ cài NSIS trong `C:\build\mat-studio\release\bundle\nsis\`, rồi:
1. "Mở project", chọn `projects/tank-demo`: trạng thái "Hợp lệ", liệt kê 1 screen và các Tag.
2. Đổi `maxClients` thành 11: báo lỗi, nút Lưu bị khóa. Đổi thành 8 rồi Lưu: chỉ dòng `maxClients` thay đổi; CLI validate vẫn hợp lệ. Kiểm bằng `git diff projects/tank-demo` khi thư mục này không còn thay đổi chưa commit; nếu còn, chép `project.json` ra trước khi sửa rồi so bằng `fc.exe /n <bản chép> projects\tank-demo\project.json`.
3. Nhập thiết bị `192.168.1.110:8080` rồi "Kiểm tra kết nối": hiển thị phiên bản, số phiên, project.
4. "Xem trước": màn hình chạy giống trên Chrome (chiếm 1 slot).
5. "Mở web thiết bị": trình duyệt mặc định mở `http://192.168.1.110:8080/`.
6. Nhập IP sai: báo "Không kết nối được", Studio không treo.

Đo tổng thời gian các bước 1–5 (SC-012 ≤ 5 phút). Hoàn tác thay đổi `maxClients` sau khi thử.
