# ADR-017: Tag Engine v1, định dạng project 0.2.0, ghi Tag có kiểm soát, Tag giữ qua mất điện

- **Trạng thái:** Proposed (feature 006, plan ngày 2026-10-11; người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11). Mặc định giới hạn tần suất ghi là tạm, chốt theo số đo eMMC trên BL335 (SC-011). Cờ build `HAVE_FDATASYNC=1` của SQLite đã bật (phiên chính duyệt 2026-10-11, T007).
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/006-tags-modbus](../../specs/006-tags-modbus/plan.md), research R1–R6, R14–R16, R23, R24; contracts [project-format-0.2.md](../../specs/006-tags-modbus/contracts/project-format-0.2.md), [device-api-1.1.md](../../specs/006-tags-modbus/contracts/device-api-1.1.md), [device-config.md](../../specs/006-tags-modbus/contracts/device-config.md); Constitution II, III, V, VII; [ADR-004](004-schema-versioning.md), [ADR-008](008-data-logging.md), [ADR-011](011-auth-roles-audit.md), [ADR-012](012-project-package-deploy.md), [ADR-014](014-driver-sdk-modbus.md).

## Bối cảnh

Runtime 0.4 chỉ có Tag mock (định dạng 0.1). GĐ 2 thêm Tag ngoài, nội bộ, tính toán, mô phỏng; scaling, deadband; ghi Tag có quyền và audit; Tag giữ qua mất điện.

Ràng buộc:

- **Constitution V:** ghi Tag chỉ khi đã có HTTPS, đăng nhập, role, audit (có từ 005).
- **Constitution III:** ghi eMMC ≤ 2 GB/ngày; SC-011: audit ghi Tag cộng Tag giữ qua mất điện ≤ 1 GB/ngày ở tần suất tối đa mặc định.
- **Constitution 2.0.1:** mọi giao dịch của `audit.db` chạy `synchronous=FULL`.
- **Đã có:** `TagStore` và live hub chạy trên một vòng tick; đổi project bằng `execv` (ADR-012).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| File mới | mọi thứ trong `tags.json`; một file mỗi loại; **một file mỗi loại, mỗi bảng giá trị và bảng theo dõi một file** | như chọn (vượt trần 1 MiB nếu gộp) |
| Kiểu khi có scaling | `type` là kiểu thô; **`type` là kiểu giá trị, thêm `rawType`** | `type` + `rawType` (cột DB của 003 theo `type`) |
| Nơi tính | luồng riêng; **trên vòng tick, ngay trước `hub.tick()`** | vòng tick: Tag tính toán luôn cùng delta với đầu vào |
| Ghi vào `TagStore` | từng Tag; **cả lượt dưới một lần khóa** | một lần khóa |
| Kết quả ghi | đẩy qua live; long-poll; **hỏi bằng HTTPS mỗi 200 ms** | hỏi bằng HTTPS |
| Mã yêu cầu | RAM; **bảng trong `audit.db`, cùng giao dịch với bản ghi lúc nhận** | `audit.db` |
| Byte ghi mỗi lệnh | `fsync` (build hiện tại, 46–55 KB); **`fdatasync`** (22–30 KB) | `HAVE_FDATASYNC=1` |
| Tag giữ qua mất điện | file tạm + `rename` (66–86 KB mỗi lần lưu); SQLite; A/B ảnh chụp; **nhật ký ghi tại chỗ trong file cấp sẵn + nén A/B** | nhật ký tại chỗ (4,1 KB mỗi lần lưu) |

## Quyết định

1. **Định dạng 0.2.0** (MINOR theo ADR-004):
   - mọi file mang cùng `schemaVersion`;
   - thêm `connections.json`, `value-tables/<tên>.json`, `watch-tables/<id>.json`;
   - Tag v1 (`kind`, `type` + `rawType`, `access`, `limits`, `deadband`, `valueTable`, `sim`…), Studio ghi mỗi Tag một dòng;
   - `minRuntimeVersion` ≥ 0.5.0; gói `.matscada` giữ 1.0.0.
2. **Nâng cấp 0.1 → 0.2 chỉ ở Studio** (hàm thuần, cặp file mẫu, sao lưu `.mat-backup/` trước lần lưu đầu). Runtime 0.5 hiểu 0.1 bằng cách đọc Tag mock thành Tag mô phỏng `legacy` trong bộ nhớ, không sửa file.
3. **Tag Engine v1:**
   - luồng kênh đẩy cập nhật vào hộp nhận;
   - mỗi lượt của vòng tick: scaling, kiểm NaN, deadband, bộ sinh, Tag tính toán theo thứ tự tô-pô một lần, ghi `TagStore` dưới một lần khóa, rồi `hub.tick()`;
   - quality kèm mã lý do.
4. **Ghi Tag:**
   - `POST /api/v1/tags/write` (operator), kiểm theo thứ tự FR-037;
   - audit `started` lưu bền (FULL) và mã yêu cầu trong cùng giao dịch, trước khi gửi tới thiết bị trường;
   - kết quả cuối ghi bằng một luồng riêng; lệnh dở được ghi `interrupted` lúc khởi động;
   - giới hạn tần suất bằng token bucket. Mặc định tạm: mỗi phiên dồn được 10 lệnh, trung bình 20 lệnh/phút; toàn BL335 dồn được 20 lệnh, trung bình 20 lệnh/phút (spec cho tới 30);
   - `quiesce` trước `execv` khi nạp xuống.
5. **SQLite build với `HAVE_FDATASYNC=1`** (áp cho `audit.db` và `history.db`): độ bền không đổi, byte ghi mỗi commit FULL giảm khoảng một nửa.
6. **Tag giữ qua mất điện:**
   - hai file 512 KiB cấp sẵn; mỗi lần lưu `pwrite` một bản ghi có CRC rồi `fdatasync`;
   - nén sang file kia khi đầy (thân trước, phần đầu thế hệ + 1 sau);
   - cửa sổ gom 5 s; giữ giá trị theo (id, kiểu) khi đổi project.

## Hệ quả

- **Tốt:**
  - Đủ cơ chế của GĐ 2 trong ngân sách: ước tính 0,77 GB/ngày ở mức trần 20 lệnh/phút, so với 1 GB của SC-011.
  - Không chạy lệnh hai lần, kể cả qua `execv` và mất điện.
  - Lưu trữ (003) và live luôn thấy trạng thái nhất quán.
  - Project 0.1 chạy y như runtime 0.4.
- **Xấu:**
  - Mặc định toàn BL335 (20 lệnh/phút) thấp hơn trần 30 của spec, chờ số đo.
  - Trần 64 MiB của `audit.db` chỉ giữ khoảng 70.000 lần ghi.
  - `tags.json` vẫn có trần 1 MiB: khoảng 1.400 Tag nếu điền mọi trường và mô tả 200 ký tự.
  - Thêm một móc vào chuỗi nạp xuống của 005, và đổi schema `audit.db` (phiên bản 2).
  - Cờ `HAVE_FDATASYNC` chạm `CMakeLists.txt` dùng chung.

## Số đo / bằng chứng

- **Thí nghiệm ngày 2026-10-11** (scratchpad; ext4 mới trên loop device, x64, kernel 6.6; đếm byte ghi xuống thiết bị khối gồm cả nhật ký ext4 và checkpoint):

  | Ca | `fsync` | `fdatasync` |
  |---|---|---|
  | Một lần ghi Tag: 2 dòng audit (3 chỉ mục của 005), 2 giao dịch FULL | 46,3 KB | 21,6 KB |
  | + bảng mã yêu cầu (chọn) | | 24,1 KB |
  | + chỉ mục `(target, ts_ms)` (không chọn) | | 27,0 KB |
  | + cả hai | 54,6 KB | 29,8 KB |
  | Lưu Tag giữ qua mất điện: file tạm + `rename`, 1 KiB / 24 KiB | 65,6 / 86,1 KB | |
  | Lưu Tag giữ qua mất điện: bản ghi 64 byte tại chỗ (chọn) | | 4,1 KB |

- **Kích thước `tags.json`**, 2.000 Tag đủ mọi trường, mô tả 60 ký tự: thụt lề 1.634 KiB; mỗi Tag một dòng 1.039 KiB, bỏ trường mặc định còn khoảng 950 KiB.
- **Đã bật `HAVE_FDATASYNC=1` (T007, 2026-10-12):** `core/historian/tests/sqlite_sync_test.cpp` (liên kết `-Wl,--wrap=fsync,--wrap=fdatasync`) đếm lời gọi trên DB WAL `synchronous=FULL`, 10 commit và một checkpoint: trước khi bật 12 lần `fsync`, 0 `fdatasync` (đỏ); sau khi bật 0 `fsync`, mọi lần đồng bộ là `fdatasync` (xanh). 156 test của 003, 005 liên quan (audit, lưu trữ, kho project) xanh trên x64.
- **Chưa đo, làm ở task ⚠️🔌:** byte ghi thật trên eMMC của BL335 (`/sys/block/mmcblk0/stat`, SC-011), RSS/CPU (SC-003, SC-004), cắt điện thật (SC-010).

## Điều kiện xem xét lại

- Số đo trên BL335 khác thí nghiệm: chốt lại `tagWriteGlobalPerMin` theo công thức của research R15 (không quá 30).
- Project thật chạm trần 1 MiB của `tags.json`: chia Tag ra nhiều file (0.3.0).
- Logic v2 (GĐ 6) cho Tag nội bộ đổi theo luật: lượng lưu Tag giữ qua mất điện không còn bị giới hạn tần suất ghi chặn; xem lại cửa sổ gom.
- Ghi từ trang web (GĐ 3a): thêm đường cookie + CSRF cho cùng API ghi.
