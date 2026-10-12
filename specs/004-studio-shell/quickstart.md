# Quickstart: kiểm khung Studio mới

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

## 1. Chuẩn bị (máy dev Windows)

- Node và npm như repo; Rust 1.99 MSVC; Visual Studio có C++.
- Ổ D: gần đầy, nên đặt thư mục build Rust trên C:

  ```powershell
  $env:CARGO_TARGET_DIR = 'C:\build\mat-studio'
  ```

- `npm install` ở gốc repo.

## 2. Chạy Studio khi phát triển

```powershell
npm run studio:dev
```

Mở `projects/tank-demo` bằng Project › Mở project…

## 3. Test tự động

```powershell
npm test -w @mat/studio          # logic + component (Vitest, jsdom)
npm test -w @mat/live-client     # setTags, unknown
npm run e2e -w @mat/studio       # Chrome headless + axe-core, lớp Tauri giả
cd apps/studio/src-tauri; cargo test   # project_fs (hash, changed), recent
./tools/ci-local.ps1             # toàn bộ, gồm bước e2e Studio
```

Mong đợi: mọi test xanh; e2e báo 0 lỗi console và 0 vi phạm axe mức `critical` hoặc `serious` ở cửa sổ chính và các editor.

## 4. Kiểm tay (khớp user story)

| # | Làm | Mong đợi | Spec |
|---|---|---|---|
| 1 | Mở Studio lần đầu | Tab Bắt đầu; lệnh cần project bị khóa kèm lý do | US1-1 |
| 2 | Mở `projects/tank-demo` | Cây đủ mục, có số Tag, số nhóm lưu trữ; mục giai đoạn sau có nhãn | US1-2 |
| 3 | Kéo đổi cỡ cây và inspector, đóng rồi mở lại | Bố cục giữ nguyên; Xem › Đặt lại bố cục về mặc định | US1-4 |
| 4 | Ctrl+Shift+P, gõ "bang tag", Enter | Mở Bảng Tag | US1-5 |
| 5 | Trong Bảng Tag, sửa Max của TANK01.LEVEL thành -1 | Ô đỏ ≤ 1 s, Thông tin có `E_TAG_RANGE`, thanh trạng thái "1 lỗi" | US2-1 |
| 6 | Nhấp đúp lỗi trong Thông tin | Ô Max được chọn, đang sửa | US2-2 |
| 7 | Ctrl+Z, Ctrl+Y | Hoàn tác và làm lại đúng thứ tự | US2-3 |
| 8 | Chỉ sửa tên project, Ctrl+S, `git diff projects/tank-demo` | Chỉ `project.json` đổi, đúng một dòng | US2-4 |
| 9 | Để lại một lỗi, Ctrl+S | Lưu được; thông báo thiết bị sẽ từ chối; Nạp xuống bị khóa | US2-5 |
| 10 | Sửa `tags.json` bằng Notepad trong lúc Studio đang mở, rồi lưu từ Studio | Hỏi Ghi đè / Tải lại / Hủy | US2-7 |
| 11 | Đóng cửa sổ khi còn thay đổi | Hỏi Lưu / Không lưu / Hủy | US2-6 |
| 12 | Mở Màn hình › Tổng quan, Xem trước: Mô phỏng | Màn hình chạy không cần thiết bị | US3-1 |
| 13 | Nhập địa chỉ sai rồi Ctrl+K | Báo không kết nối được trong ≤ 3 s, không treo | US3-2 |
| 14 | Nhập địa chỉ thiết bị thật rồi Ctrl+K | Viền cam; cột giá trị sống và quality; Tag thiết bị không có ghi "không có trên thiết bị" | US3-3, US3-4 |
| 15 | Rút mạng 30 s rồi cắm lại | Giá trị chuyển trạng thái mất kết nối, rồi tự có lại | US3-5 |
| 16 | Ctrl+M | Thiết bị báo số phiên giảm 1 trong ≤ 2 s (`system/info`) | US3-7, SC-007 |
| 17 | Mở Lưu trữ | Đúng 2 nhóm và giá trị như `logging.json`, có ước tính ghi | US4-1 |
| 18 | Làm lại bước 1–17 chỉ bằng bàn phím | Làm được hết | US1-7, SC-005 |

Địa chỉ thiết bị: dùng LAN (`192.168.1.110:8080`) hoặc địa chỉ từ xa đang dùng. Theo dõi chỉ đọc qua web; không SSH, không đổi gì trên thiết bị.

## 5. Đối chiếu chức năng Sprint 1 (SC-001)

| Sprint 1 (`specs/002-vertical-slice`) | Ở khung mới |
|---|---|
| FR-032 mở project, kiểm tra, xem kết quả | Project › Mở…, Thông tin, thanh trạng thái |
| FR-033 sửa cấu hình project và Tag | Thiết lập project, Bảng Tag (nay lưu được cả khi lỗi, FR-023) |
| FR-034 địa chỉ thiết bị, kiểm kết nối | Online › Thiết bị…, thanh trạng thái, Chẩn đoán |
| FR-035 xem trước sống | Màn hình › Xem trước: Thiết bị |
| FR-036 mở web thiết bị | Online › Mở web thiết bị, task card Công cụ online |
| FR-037 quyền tối thiểu | Không đổi: Rust kiểm đường dẫn, danh sách gần đây do Rust giữ |
| Tab Giới thiệu | Trợ giúp › Giới thiệu |
| Tóm tắt lưu trữ ở tab Thiết bị (feature 003) | Chẩn đoán và editor Lưu trữ |

## 6. Bộ cài

```powershell
$env:CARGO_TARGET_DIR = 'C:\build\mat-studio'; npm run studio:build
```

Bộ cài: `C:\build\mat-studio\release\bundle\nsis\`. Sau khi build, chạy `node tools/measure/studio-smoke.mjs <host:port>` với Studio bật cổng debug của WebView2:

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
```

Công cụ đo thời gian mở (SC-004) và đi qua luồng theo dõi.

## 7. Kết quả kiểm (2026-10-11)

Chi tiết: [docs/reports/004-acceptance.md](../../docs/reports/004-acceptance.md).

- **Test tự động:** Vitest 534 test, e2e 5 file 110 kiểm (Chrome headless, lớp Tauri giả), `cargo test` 23/23.
- **Studio thật** (`studio-smoke.mjs --exe`, bản 0.2.0):
  - mở tới tab Bắt đầu 1,2 s; mở project mẫu 38 ms;
  - F5, Ctrl+P bị chặn;
  - 0 lỗi console và CSP, kể cả khi xem trước màn hình.
- **500 Tag** (`perf.e2e.mjs`, Chrome headless): mũi tên tối đa 22 ms; gõ khoảng 11 ms mỗi phím; từ sửa tới khi lỗi hiện 280 ms.
- **Bảng §4:**
  - bước 1–13 và 17 kiểm bằng e2e;
  - bước 14–16 kiểm với runtime giả; với BL335 thật thì làm ở T075;
  - bước 18 kiểm một phần bằng e2e; chạy tay toàn bộ cùng T086.
