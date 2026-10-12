# Quickstart: kiểm chứng 005 Làm việc với thiết bị

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · Định dạng và giá trị mong đợi: [contracts/](contracts/)

Các kịch bản đi từ máy dev tới BL335. Script ghi "(task tạo)" chưa có, sẽ được thêm khi làm tasks. Mục nào chưa làm được thì ghi "chưa đo" trong báo cáo nghiệm thu `docs/reports/005-acceptance.md`.

## 0. Chuẩn bị (máy dev Windows)

- Docker Desktop đang chạy (image toolchain `mat-armhf`).
- `npm install` ở gốc repo.
- Rust 1.99 MSVC và Visual Studio C++ (`ring` cần trình biên dịch C). Ổ D: còn khoảng 4 GB, nên đặt thư mục build Rust trên C::

  ```powershell
  $env:CARGO_TARGET_DIR = 'C:\build\mat-studio'
  ```

## 1. Test tự động

```powershell
./deployment/toolchain/test-x64.ps1                 # GoogleTest: auth, audit, package, store, discovery, TLS
npm test -w @mat/project-schema                     # digest, tập file, so sánh (vector chung)
npm test -w @mat/live-client                        # 1012, hello.project.digest
npm test -w @mat/runtime-web                        # tải lại khi digest đổi
npm test -w @mat/studio                             # DeviceSession online, luồng Nạp xuống, mock-device
npm run e2e -w @mat/studio                          # Chrome headless, lớp Tauri giả
cd apps/studio/src-tauri; cargo test --lib          # ghim, ZIP, digest, gói tìm thiết bị (vector chung)
./tools/ci-local.ps1                                # toàn bộ, gồm armhf smoke
```

**Mong đợi:**

- Mọi test xanh. Có các bộ test mới (FR-036):
  - đọc và kiểm gói: mọi vector trong `tests/package-vectors/` cho đúng mã lỗi ở cả C++ và Rust;
  - máy trạng thái nạp xuống: lỗi ở từng bước, rollback;
  - băm và kiểm mật khẩu, khóa tạm, phiên (hết hạn, IP khác, `rev` đổi), bảng quyền theo role, audit (gộp, trần, thời hạn);
  - trả lời tìm thiết bị: subnet, tần suất, kích thước (`tests/discovery-vectors/`);
  - so sánh theo đối tượng;
  - ghim fingerprint phía Studio (`PinnedVerifier` từ chối chứng chỉ khác và chữ ký bắt tay sai).
- Vector digest `digest-basic` cho đúng `sha256:c337083b…e119` ở cả TS, Rust, C++.

## 2. Runtime x64 có HTTPS

```powershell
npm run build:web
./deployment/toolchain/run-x64.ps1 -HttpsPort 8443   # tham số mới (task tạo); runtime chạy với
                                                     # --users-file /tmp/mat-etc/users.json --data-dir /tmp/mat-data
docker exec -it mat-runtime-x64 /src/build/x64/bin/mat-runtime --user-add admin --role administrator `
    --users-file /tmp/mat-etc/users.json --data-dir /tmp/mat-data   # audit vào audit.db của runtime
docker exec mat-runtime-x64 /src/build/x64/bin/mat-runtime --cert-fingerprint --data-dir /tmp/mat-data
curl.exe -s http://localhost:8080/api/v1/system/info
```

**Mong đợi:**

- `system/info` có `device.https = "ok"`, `device.httpsPort = 8443`, `project.digest` bắt đầu bằng `sha256:`.
- Lần chạy đầu sinh `server.pem`; chạy lại container thì fingerprint không đổi.
- `curl.exe -sk https://localhost:8443/api/v1/diagnostics` trả 401 `AUTH_REQUIRED`.
- `curl.exe -s http://localhost:8080/api/v1/diagnostics` trả 403 `HTTPS_REQUIRED`, và audit có `access.denied` (FR-007).

Thử nhanh API có ghim fingerprint, không cần Studio:

```powershell
node tools/measure/device-api.mjs https://localhost:8443 --fingerprint <fp> --user admin   # (task tạo)
```

Script đăng nhập, đo thời gian, gọi chẩn đoán, nạp xuống một gói, đọc lên, so digest (SC-002).

## 3. Tích hợp x64 (`tools/device-it.ps1`, task tạo)

| Kịch bản | Lệnh | Mong đợi | Spec |
|---|---|---|---|
| Nạp xuống đầu-cuối | `-Scenario deploy` | 3 project khác nhau, mỗi project nạp xuống rồi đọc lên 10 lần: digest giống hệt 30/30 | SC-002, US2-3 |
| Gói hỏng, độc | `-Scenario packages` | 100 % vector độc bị từ chối đúng mã; `state.json` và bản đang chạy không đổi; mỗi lần có audit `project.deploy failed` | SC-003, US2-4 |
| Giết tiến trình ở từng bước | `-Scenario kill -Rounds 24` | `kill -9` ngẫu nhiên trong 6 bước × 4 lần: lần khởi động sau luôn chạy bản cũ hoặc bản mới hoàn chỉnh; `--project-status` không còn `pending` sau ≤ 20 s | SC-004 (phần x64), FR-023 |
| Kiểm tra sức khỏe lỗi | `-Scenario health` | project làm runtime chết khi khởi động (cờ test): sau 2 lần thì tự quay về; kết quả `rolled-back` | US2-5 |
| Bận | `-Scenario busy` | hai lần nạp xuống cùng lúc: lần hai 409 `DEVICE_BUSY` kèm người, nguồn, thời điểm | US2-7 |
| Tìm thiết bị | `-Scenario discovery` | mạng Docker riêng, 2 runtime + 1 client: client thấy cả hai trong ≤ 3 s; nguồn khác subnet không được trả lời; gói trả lời ≤ gói hỏi; tắt `discoveryEnabled` thì im lặng | SC-001 (x64), FR-003, FR-004 |
| Đăng nhập | `-Scenario auth` | sai 5 lần thì khóa 5 phút (cả khi mật khẩu đúng); chưa đăng nhập 401, viewer 403, đều có audit | SC-005, US1-6, US1-7 |
| Tìm mật khẩu thử | `-Scenario secrets` | tìm chuỗi mật khẩu thử trong mọi log, `audit.db`, `projects/`, `/run/mat-runtime`: không thấy | SC-005 |
| Client tải lại | `-Scenario reload` | 10 tab Chrome headless mở trang xem; nạp xuống: mọi tab tải lại project mới trong ≤ 10 s | SC-006 (x64), FR-025 |
| HTTPS im lặng | `-Scenario tls-idle` | 8 kết nối TCP vào 8443 không gửi gì: CPU runtime tăng ≤ 2 điểm; bị đóng sau ≤ 11 s. 8 kết nối TLS gửi một request rồi im: bị đóng sau 15 s (keep-alive, ADR-010) | research R4 |

## 4. armhf trên qemu

`./tools/ci-local.ps1` (bước `armhf smoke`), mở rộng `smoke-armhf.sh`: runtime armhf sinh chứng chỉ ở lần chạy đầu, mở 8443, đăng nhập được bằng tài khoản thử, nạp xuống `tank-demo` và chạy lại bằng `execv`.

**Mong đợi:** `armhf smoke: OK`. Bước này bắt lỗi chỉ có ở bản 32 bit (như lỗi SQLite của 003).

`execv` một binary ARM bên trong container cần binfmt của máy chủ Docker:
- Docker Desktop đã đăng ký sẵn.
- GitHub CI cài `qemu-user-static` bằng apt của Ubuntu trên runner. Gói này đăng ký binfmt cờ `F`, nên container dùng được.
- Không dùng action ngoài (analyze C5, chốt 2026-10-11).

## 5. Studio với runtime x64

```powershell
npm run studio:dev
```

| # | Làm | Mong đợi | Spec |
|---|---|---|---|
| 1 | Online › Thiết bị trong mạng… | Hiện card mạng; card VPN mờ kèm gợi ý; quét xong ≤ 3 s | US1-1, FR-001 |
| 2 | Thêm theo địa chỉ `localhost:8443` | Thiết bị vào danh sách đã lưu | US1-2, FR-005 |
| 3 | Chọn thiết bị, Online lần đầu | Hiện đủ 64 ký tự fingerprint, khớp `--cert-fingerprint`; chưa xác nhận thì không đi tiếp | US1-3, FR-008 |
| 4 | Xác nhận, đăng nhập `kysu1` (engineer) | Viền cam; thanh trạng thái có `kysu1 · engineer`; audit có `auth.login ok` kèm IP | US1-5 |
| 5 | `--regen-cert` trong container, rồi Online lại | Studio chặn, hiện fingerprint cũ và mới, nói rõ nguy cơ; gỡ ghim chỉ khi xác nhận rõ | US1-4 |
| 6 | Sửa một Tag, để Studio rảnh 30 phút | Studio hỏi đăng nhập lại; Tag vừa sửa vẫn còn, chưa lưu | US1-8, FR-031 |
| 7 | Sửa Max của một Tag thành lỗi, Ctrl+L | Dòng Kiểm tra project báo lỗi; nút Nạp xuống khóa; mở được danh sách lỗi | US2-1 |
| 8 | Sửa lại hợp lệ có cảnh báo lưu trữ, Ctrl+L | Đủ các dòng xem trước; phải đánh dấu "đã đọc cảnh báo" | US2-2 |
| 9 | Nạp xuống | Tiến trình 6 bước; kết quả: thời gian, phiên bản, số client đã báo tải lại; trang xem tự tải lại | US2-3 |
| 10 | Khôi phục bản trước | Danh sách bản có phiên bản, digest, thời điểm, người nạp; chạy lại chuỗi kiểm tra | US2-6 |
| 11 | Đọc lên thành project mới, chọn thư mục rỗng | Project mở được; kiểm tra cho kết luận giống thiết bị | US3-3 |
| 12 | Thêm một Tag, đổi một deadband, đổi một binding; mở So sánh | Đúng các dòng `+`, `≠`; cây project có cùng ký hiệu; chọn dòng hiện khác biệt từng trường | US3-4 |
| 13 | Đọc lên phần chọn | Thành sửa đổi chưa lưu; Ctrl+Z hoàn tác được | US3-5 |
| 14 | Mở tab Chẩn đoán | CPU, RAM, dung lượng, thời gian chạy, số client; cập nhật ≤ 5 s | US4-1 |
| 15 | Đăng nhập `admin`, mở Audit; đăng nhập `kysu1`, mở Audit | Admin thấy bản ghi mới nhất trước, lọc được; `kysu1` bị từ chối | US4-2 |
| 16 | Thêm thiết bị chạy runtime 0.3.0 | Báo "runtime cần cập nhật để nạp xuống"; theo dõi chỉ đọc như 004 | FR-035 |

Tường lửa Windows (máy dev, không cần thiết bị): chạy bước 1 với tường lửa mặc định trên Windows 10 và Windows 11. Ghi lại Windows có hiện hộp thoại cho phép không, và gói trả lời có tới không (research R3).

**Giới hạn của máy dev hiện tại** (analyze C4, ghi 2026-10-11): Docker Desktop dùng NAT nên broadcast của Studio không tới container, và máy dev ở xa BL335. Vì vậy bước 1 (tìm qua broadcast) và hành vi tường lửa Windows được kiểm theo ba cách:
1. Logic: unit test (vector của contract discovery) và kịch bản `device-it` `discovery` với client Linux trong mạng Docker riêng.
2. Giao diện: bản giả `mock-device` trên máy dev.
3. Đường đi thật Windows → LAN → BL335: T162, cần một máy Windows đặt cùng LAN với BL335 và người tại chỗ (Q4).

Bước 2–16 chạy được trên máy dev với runtime x64.

## 6. BL335 ⚠️🔌 (cần người dùng cho phép rõ, ghi `docs/reports/device-changes.md`)

| # | Việc | Ghi chú | Spec |
|---|---|---|---|
| 1 | Kiểm chỉ đọc trước khi cài | phiên bản, dung lượng, RAM trống | |
| 2 | `deploy.sh` gói 0.4.0 | project đang chạy được nhận vào kho (`project.adopt`); in fingerprint; đặt mật khẩu `admin` qua TTY | FR-011, FR-019, FR-027 |
| 3 | `--auth-bench`: chốt tham số Argon2id | mục tiêu 0,3–0,8 s; ghi số vào ADR-011 | SC-007 |
| 4 | Đo RSS, CPU khi rảnh 10 phút (0.3.0 rồi 0.4.0) và tải chuẩn 30 phút cộng Studio Online | `tools/measure/sample.sh` qua `ssh … sh -s` | SC-007, FR-034 |
| 5 | 20 lần đăng nhập | ≤ 1 s mỗi lần | SC-007 |
| 6 | Tìm thiết bị 10/10 lần trong LAN | **cần một máy Windows trong cùng LAN với BL335** (máy dev đang ở xa) | SC-001 |
| 7 | Thêm theo địa chỉ qua VPN hoặc port-forward, đăng nhập | theo quyết định 5 | SC-001 |
| 8 | 10 lần nạp xuống project < 1 MB, đọc lên ngay sau đó, 3 project | ≤ 15 s mỗi lần; digest giống hệt; client tải lại ≤ 10 s | SC-002, SC-006 |
| 9 | ≥ 3 lần cắt điện thật ở các bước `activate`, `health` | **cần người ở cạnh thiết bị** | SC-004 |
| 10 | Tìm chuỗi mật khẩu thử trên thiết bị | `grep -r` trong `/var/lib/mat-runtime`, `/etc/mat-runtime`, journal | SC-005 |
| 11 | Vòng đầy đủ tìm → Online → sửa → nạp xuống → So sánh "giống" | một kỹ sư, không xem tài liệu, ≤ 5 phút | SC-009 |

Không làm trên thiết bị khi chưa được cho phép. Kết quả ghi `docs/reports/005-acceptance.md`; lệnh hoàn tác của từng thay đổi ghi `device-changes.md`.
