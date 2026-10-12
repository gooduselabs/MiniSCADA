# Research: Tag v1, Modbus TCP/RTU, Tag tính toán và ghi Tag có kiểm soát

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Ngày**: 2026-10-11

Phase 0 của plan. Mỗi mục gồm **Quyết định**, **Lý do**, **Phương án khác đã xét**.

- **Quyền quyết định.** Người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11. Chỗ spec để ngỏ, plan chọn phương án tốt nhất và ghi **Quyết định (người dùng giao toàn quyền 2026-10-11)**.
- **Phiên bản thư viện:** theo quy tắc của [ADR-009](../../docs/adr/009-studio-ui-stack.md), chỉ chọn bản phát hành ít nhất 2 tuần trước ngày chọn, tức trước 2026-09-27. Tra ngày 2026-10-11 bằng `npm view` và PyPI (bảng ở R25).
- **Số đo thiết bị** lấy từ `docs/reports/`. SSH tới BL335 bị chặn trong phiên này. Mọi bước cần BL335 được ghi thành lệnh chỉ đọc cho người dùng tự chạy ([quickstart.md](quickstart.md) §8), hoặc thành task ⚠️🔌 làm sau khi có quyền.
- **Thí nghiệm trong scratchpad** (không vào repo), ngày 2026-10-11:
  - đo byte ghi xuống thiết bị khối của một lần ghi Tag (audit) và một lần lưu Tag giữ qua mất điện, trên ext4 mới tạo (loop device, `mkfs.ext4 -b 4096`, `relatime`, giống `/dev/mmcblk0p5` của BL335), trong container `mat-armhf` x64, kernel WSL2 6.6;
  - kiểm mặc định dấu phẩy động của toolchain;
  - ước kích thước `tags.json` 2.000 Tag.

  Kết quả dùng ở R2, R15, R16, R17.

**Mốc so sánh** (runtime 0.3.0 trên BL335, [003-acceptance.md](../../docs/reports/003-acceptance.md); 005 chưa đo trên BL335):

| Chỉ số | Giá trị |
|---|---|
| Tải chuẩn (500 Tag/1 s, 10 client, lưu trữ), 30 phút | RSS tối đa 13,7 MB; CPU toàn hệ thống trung bình 11,7 %, p95 20,9 % |
| CPU rảnh của hệ thống | 7,25 %, gồm timer `atscada-*` của sản phẩm cũ |
| Phần cứng | Cortex-A7 2 nhân, VFPv4; RAM 993 MB; eMMC, `/` ext4 `rw,relatime`; kernel 5.4.61 (BSP Allwinner); systemd 245; có `python3` |
| Cổng serial ([device-profile](../../docs/reports/device-profile.md)) | `ttyAS0` (console, `serial-getty@ttyAS0` đang chạy), `ttyAS2`–`ttyAS5`, `ttyS0`–`ttyS3`, `ttyUSB0`–`ttyUSB3`. Card `usb0` 192.168.225.25 là kiểu địa chỉ của modem 4G (Quectel ở chế độ ECM): `ttyUSB0`–`3` rất có thể là cổng AT/diag của modem, không phải bộ chuyển RS485 |

## R1. Định dạng project 0.2.0: các file

- **Quyết định:**
  - **Giữ các file của 0.1, thêm ba loại file mới.** Mọi file đều mang `schemaVersion: "0.2.0"`.

    | File | Nội dung | Trỏ tới từ `project.json` |
    |---|---|---|
    | `project.json` | như 0.1, cộng 3 khóa mới (dòng dưới) | |
    | `tags.json` | Tag v1 (R2), vẫn là một Bảng Tag duy nhất (D27) | `tagFile` (như 0.1) |
    | `connections.json` (mới) | chu kỳ ba nhóm quét; kênh › thiết bị trường | `connectionFile` (tùy chọn; vắng thì không có kênh) |
    | `value-tables/<tên>.json` (mới) | mỗi bảng giá trị một file | `valueTables: ["TrangThaiBom", …]` |
    | `watch-tables/<id>.json` (mới) | mỗi bảng theo dõi một file | `watchTables: ["van-hanh", …]` |
    | `logging.json`, `screens/*` | như 0.1; binding thêm transform `valueTable` (FR-054) | như 0.1 |

  - Một file cho mỗi bảng giá trị và mỗi bảng theo dõi, như màn hình. Tên file lấy từ tên bảng (bảng giá trị) hoặc id (bảng theo dõi), nên luôn là đường dẫn an toàn.
  - **Phiên bản:**
    - Mọi file của project 0.2.x mang **đúng cùng chuỗi** `schemaVersion` của `project.json` (FR-001).
    - Project 0.1.x giữ luật cũ (mỗi file `0.1.x`), để vector 0.1 hiện có không đổi kết luận (SC-009).
    - Trộn 0.1 và 0.2 trong một project là `E_SCHEMA_VERSION`.
  - **`minRuntimeVersion` của project 0.2.x phải ≥ `0.5.0`.** Thấp hơn là lỗi mới `E_MIN_RUNTIME`. Runtime 0.5 có `kRuntimeVersion = "0.5.0"`, nên `E_RUNTIME_TOO_OLD` giữ nguyên nghĩa.
  - **Schema:** `schemas/*.schema.json` thành bản 0.2.0, thêm `connections.schema.json`, `value-table.schema.json`, `watch-table.schema.json`. Bản 0.1 đóng băng ở `schemas/0.1/*.schema.json`. Bộ kiểm tra chọn bộ schema theo `schemaVersion` của `project.json`.
  - **Gói `.matscada` không đổi định dạng (1.0.0).** File mới đều là `.json`, sâu ≤ 2 cấp, theo luật đường dẫn của [contract gói](../005-device-online/contracts/matscada-package.md). Chỉ tập file của project (`projectFiles()`, `LoadedProject::files()`) thêm `connectionFile`, `value-tables/*.json`, `watch-tables/*.json`. Vector `files`, `digest` của `tests/project-vectors` cập nhật theo.
  - **So sánh của 005 (FR-007):** `compare.ts` thêm kind `channel`, `field-device`, `value-table`, `watch-table`; Tag so theo từng trường của Tag v1 (R2). Khóa: id kênh, id thiết bị trường, tên bảng giá trị, id bảng theo dõi.
- **Lý do:**
  - **Tách file theo loại:** đọc lên, so sánh và diff git rõ theo đối tượng.
  - **Một file mỗi bảng giá trị:** giới hạn D12 (256 bảng × 256 mục, mỗi mục tới khoảng 120 byte) có thể tới vài MB. Gộp một file sẽ vượt trần 1 MiB mỗi file JSON của bộ kiểm tra và của gói 005. Tách file thì mỗi file ≤ khoảng 30 KB; số file vẫn dưới trần 1.024 entry của gói.
  - **`connections.json` một file:** ≤ 16 kênh, ≤ 64 thiết bị trường: nhỏ.
  - **ADR-004** (một `schemaVersion` cho cả bộ, migration chỉ ở Studio, validator hai phía): giữ nguyên. Thêm file và thêm trường là MINOR 0.1 → 0.2. Vì MAJOR = 0, runtime và Studio vẫn phải hiểu đúng MINOR (luật hiện tại `^0\.1\.\d+$` thành `^0\.(1|2)\.\d+$`).
  - **Không đổi định dạng gói:** 005 đang implement, đổi gói là đổi contract đang làm.
- **Phương án khác đã xét:**
  - **Mọi thứ trong `tags.json`** (kênh, bảng giá trị, bảng theo dõi): một file lớn, vượt 1 MiB với 2.000 Tag (R2); diff khó đọc.
  - **Một file `value-tables.json` cho mọi bảng:** vượt trần 1 MiB ở giới hạn D12. Hạ D12 thì đổi spec.
  - **Nâng trần mỗi file JSON lên 4 MiB:** phải đổi contract gói 1.0.0 của 005 (Rust, C++), và RAM đỉnh khi parse tăng khoảng 4 lần.
  - **Đánh phiên bản riêng cho từng loại file:** ADR-004 điểm 2 chọn một phiên bản cho cả bộ; tách ra chỉ khi có vòng đời riêng (điều kiện xem xét lại của ADR-004).

## R2. Tag v1 trong `tags.json`

- **Quyết định** (chi tiết: [data-model.md](data-model.md) §1, [contracts/project-format-0.2.md](contracts/project-format-0.2.md) §3):
  - **Trường chung:** `id`, `kind` (`external` | `internal` | `calculated` | `simulation`), `type` (10 kiểu như 0.1), `description`, `unit`, `min`/`max` (khoảng hiển thị, như 0.1), `access` (`R` | `RW`, mặc định `R`), `limits` (giới hạn nhập: `min`, `max`, hoặc `maxLength` cho STRING), `valueTable`, `deadband` (Tag số), `sim` (cấu hình mô phỏng).
  - **Theo loại:**
    - `external`: `source { device, address, scanGroup?, rawType?, byteOrder?, stringLength?, stringByteOrder?, readback? }`, `scaling { rawMin, rawMax, engMin, engMax, clamp? }`. Tag tham chiếu thiết bị trường bằng id; id thiết bị trường duy nhất trong project, nên không cần id kênh.
    - `internal`: `initial`, `retain` (mặc định `false`).
    - `calculated`: `expression`; luôn `R`.
    - `simulation`: `sim` bắt buộc.
  - **`type` là kiểu giá trị của Tag** (thứ mà client, lưu trữ, biểu thức và binding thấy). **`source.rawType` là kiểu trên thiết bị trường**, mặc định bằng `type`.
    - Có `scaling` thì `type` phải là `FLOAT32` hoặc `FLOAT64` và `rawType` là kiểu số. Ví dụ US1-10: thô `INT16` 0–27648 → `FLOAT32` 0–100 %.
    - Lý do tách hai trường: lưu trữ (003) tạo cột DB theo `type`. Nếu `type` là `INT16` mà giá trị đã scaling là 50,5, cột `SMALLINT` của MySQL sẽ cắt mất phần lẻ.
  - **Định dạng ghi của Studio:**
    - mỗi Tag một dòng JSON gọn, phần ngoài vẫn thụt 2 dấu cách; khóa theo thứ tự chuẩn;
    - không ghi trường bằng mặc định (`access: "R"`, `scanGroup: "normal"`, `byteOrder` bằng của thiết bị trường, `rawType` bằng `type`, `readback: true`);
    - Studio hiện mức dùng của `tags.json` so với trần 1 MiB, cảnh báo từ 85 %.
- **Lý do:**
  - **Số đo kích thước** (2.000 Tag, script trong scratchpad):

    | Tag | Thụt 2 dấu cách | Mỗi Tag một dòng |
    |---|---|---|
    | Thường gặp: tên, kiểu, mô tả ngắn, đơn vị, thiết bị trường, địa chỉ | 471 KiB | 315 KiB (161 byte/Tag) |
    | Đủ mọi trường tùy chọn, mô tả 60 ký tự tiếng Việt | 1.634 KiB | 1.039 KiB (532 byte/Tag); bỏ trường mặc định còn khoảng 950 KiB |
    | Đủ mọi trường, mô tả 200 ký tự | 2.052 KiB | 1.457 KiB |

    Ghi thụt lề như 004 thì 2.000 Tag đầy đủ vượt trần 1 MiB. Mỗi Tag một dòng, bỏ trường mặc định thì vừa trần ở cấu hình đầy đủ thường gặp. Diff git cũng theo đúng từng Tag.
  - **Giới hạn còn lại:** khoảng 1.400 Tag nếu điền mọi trường và mô tả dài 200 ký tự. Bộ kiểm tra vẫn báo `E_JSON` "File lớn hơn 1 MB" như hiện nay; Studio báo trước từ 85 %.
  - **Tham chiếu thiết bị trường bằng id duy nhất:** bớt một cột trong Bảng Tag; đổi kênh của thiết bị trường không phải sửa Tag.
- **Phương án khác đã xét:**
  - **`type` là kiểu thô, giá trị scaling luôn là số thực:** client và lưu trữ phải biết "Tag INT16 có scaling thì thật ra là số thực". Lỗi lặng ở cột DB ngoài.
  - **Chia Tag ra nhiều file** (`tagFiles`) khi vượt 1 MiB: giữ đủ 2.000 Tag mọi cấu hình, nhưng thêm luật, thêm đường so sánh, và Tag nhảy file khi chèn. Để dành làm 0.3.0 nếu project thật chạm trần (điều kiện xem xét lại của ADR-017).
  - **Nâng trần riêng cho `tags.json`:** cùng vấn đề đổi contract gói của 005 như R1.

## R3. Nâng cấp 0.1 → 0.2 trong Studio; runtime 0.5 nhận 0.1

- **Quyết định:**
  - **Hàm thuần `migrate01to02(files) → files`** ở `packages/project-schema/src/migrate.ts`, chạy trong bộ nhớ (FR-004, D24). Thuật toán:
    1. Kiểm bản 0.1 bằng bộ kiểm tra 0.1. Project lỗi vẫn nâng cấp được, nhưng Studio báo trước rằng bản nâng cấp sẽ còn lỗi (lưu việc làm dở vẫn được, như 004).
    2. `project.json`: `schemaVersion` → `"0.2.0"`; `minRuntimeVersion` → `max(cũ, "0.5.0")`. Không thêm `connectionFile`, `valueTables`, `watchTables` khi chưa có nội dung.
    3. `tags.json`: mỗi Tag `{ id, type, description?, unit?, min?, max?, source: { kind: "mock", signal } }` thành `{ id, kind: "simulation", type, description?, unit?, min?, max?, sim: { kind: "legacy", signal } }`. Giữ thứ tự Tag; khóa theo thứ tự chuẩn của 0.2.
    4. `logging.json`, `screens/*.screen.json`, file binding: chỉ đổi `schemaVersion`.
    5. Kiểm bản 0.2 bằng bộ kiểm tra 0.2. Có lỗi **mới**, tức lỗi mà bản 0.1 không có (không nên xảy ra), thì không áp, giữ nguyên bản gốc, báo lý do (FR-004).

    **Quyết định (người dùng giao toàn quyền 2026-10-11):** lỗi đã có từ bản 0.1 được mang sang, không chặn nâng cấp. Đọc FR-004 theo nghĩa đen (có lỗi là không nâng cấp) thì project đang làm dở không bao giờ nâng cấp được, mà chế độ chỉ đọc (FR-003) lại không cho sửa: người dùng bị kẹt.
  - **Tất định:** cùng đầu vào cho cùng chuỗi byte (định dạng ghi của R2). Kiểm bằng cặp file mẫu `tests/migration-vectors/<ca>/{before,after}/`, gồm `tank-demo`, mọi project hợp lệ của `tests/project-vectors` và các ca biên (Tag có `signal` lạ, thiếu `min`/`max`, có `logging.json`, nhiều màn hình).
  - **Tín hiệu lạ** (ví dụ `signal` mà 004 sinh từ tên Tag): giữ nguyên `legacy`. Runtime 0.5 cho BAD như runtime 0.4 (`MockTagProvider` không biết tín hiệu đó). Nhờ vậy "giá trị giống hệt bản 0.1" (US1-2, SC-009) đúng cả với Tag này.
  - **Sao lưu** (FR-004): ngay trước lần lưu đầu sau nâng cấp, lệnh Rust mới `project_backup` chép mọi file của tập file 0.1 vào thư mục mới `.mat-backup/0.1.0-<UTC yyyyMMddTHHmmssZ>/` trong thư mục project, giữ đường dẫn tương đối. Lệnh kiểm SHA-256 sau khi chép, không bao giờ ghi đè thư mục đã có, và trả đường dẫn để Studio hiện.
  - **Hộp thoại khi mở project 0.1** (FR-003): Nâng cấp, Mở chỉ đọc, Hủy. Hộp thoại liệt kê thay đổi (số Tag mock thành Tag mô phỏng `legacy`, runtime tối thiểu 0.5.0, các file sẽ ghi lại) và nơi giữ bản sao lưu.
    - **Mở chỉ đọc:** Studio dùng đường của 004 (mô hình 0.1), khóa mọi lệnh sửa; vẫn kiểm tra, xem trước, Mô phỏng (bộ sinh `legacy`, R18), Nạp xuống nguyên trạng.
  - **Project mới hơn mức Studio hiểu** (`schemaVersion` 0.3+ hay 1.x): từ chối mở, nói phiên bản Studio cần, không ghi gì (FR-005).
  - **Đọc lên và So sánh** (FR-007): bản trên BL335 là 0.1, bản trên máy là 0.2 thì Studio chạy `migrate01to02` trên bản của BL335 trong bộ nhớ trước khi so, và hiện dòng "Bản trên thiết bị là 0.1, đã nâng cấp trong bộ nhớ để so".
  - **Runtime 0.5 nhận 0.1.x** (FR-002, D5): bộ nạp C++ dịch Tag 0.1 sang mô hình Tag v1 trong bộ nhớ (`kind = simulation`, bộ sinh `legacy`). Bộ sinh `legacy` chính là `MockTagProvider` hiện có, giữ nguyên thuật toán và hằng số, nên giá trị giống hệt runtime 0.4; test so từng giá trị của hai bản trên cùng chuỗi thời điểm. Đây không phải migration gói: file trên đĩa và digest giữ nguyên (ADR-004 điểm 4–5).
  - **Runtime 0.4 gặp gói 0.2:** từ chối cả gói (`E_SCHEMA_VERSION`, `E_RUNTIME_TOO_OLD`). Xem trước Nạp xuống của Studio khóa nạp từ trước, nhờ dòng Tương thích runtime (FR-008).
- **Lý do:**
  - ADR-004 điểm 5: migration chỉ ở Studio, hàm thuần, kiểm bằng cặp file mẫu.
  - Đặt hàm trong package dùng chung: Studio, test và CLI `tools/project-validator` (`--migrate`, để sinh project mẫu) dùng cùng một mã.
  - Thư mục sao lưu nằm trong thư mục project: lớp Rust của 004 chỉ cho ghi trong thư mục project. `.mat-backup` không thuộc tập file nên không vào gói, không vào digest.
- **Phương án khác đã xét:**
  - **Runtime tự nâng cấp 0.1 khi nạp:** trái ADR-004; digest đổi so với gói đã nạp, đọc lên không còn giống hệt (SC-002 của 005).
  - **Sao lưu ra thư mục cạnh thư mục project:** cần thêm quyền ghi ngoài thư mục project cho Rust.
  - **Migration chuyển Tag mock thành bộ sinh mới** (sin, bật/tắt): giá trị khác bản 0.1, trái US1-2. Chuyển sang bộ sinh mới là việc người dùng làm sau, trong Bảng Tag.

## R4. Bộ kiểm tra 0.2: luật, mã lỗi, vector chung

- **Quyết định** (danh sách đủ: [contracts/project-format-0.2.md](contracts/project-format-0.2.md) §7):
  - **Hai bản** như hiện nay: `packages/project-schema` (TS) và `core/project-manager` (C++). Chọn luật theo `schemaVersion`. Nhánh 0.1 giữ nguyên mã và kết luận.
  - **Mã lỗi mới, dùng chung hai bản:**
    - phiên bản, số lượng: `E_MIN_RUNTIME`, `E_LIMIT`;
    - tên và tham chiếu: `E_DUP_ID`, `E_REF_DEVICE`, `E_REF_TABLE`;
    - địa chỉ Modbus: `E_ADDR_SYNTAX`, `E_ADDR_AREA`, `E_ADDR_RANGE`, `E_ADDR_READ_LIMIT`, `E_ADDR_WRITE_LIMIT`, `E_BIT_WRITE`;
    - thuộc tính Tag: `E_SCALING`, `E_DEADBAND`, `E_LIMITS`, `E_TAG_ACCESS`, `E_SIM`, `E_INITIAL`, `E_RETAIN`;
    - biểu thức: `E_EXPR_SYNTAX`, `E_EXPR_UNKNOWN_TAG`, `E_EXPR_UNKNOWN_TABLE`, `E_EXPR_UNKNOWN_FUNC`, `E_EXPR_ARITY`, `E_EXPR_TYPE`, `E_EXPR_CYCLE`, `E_EXPR_DEPTH`, `E_EXPR_LIMIT`;
    - bảng giá trị: `E_VT_OVERLAP`, `E_VT_RANGE`, `E_VT_TEXT`;
    - cổng serial: `E_SERIAL_PORT`, `E_SERIAL_SHARED`.
  - **Cảnh báo mới** (không chặn): `W_WRITE_NO_LIMITS`, `W_DETECT_SLOW`, `W_RTU_SCAN_TIME` (kèm ước tính ms), `W_BIT_RMW`, `W_EXPR_INT64`, `W_WATCH_REF`, `W_ADDR_MODICON_BASE0`.
  - **Luật chỉ có ở runtime:** `E_SERIAL_NOT_ALLOWED` (cổng ngoài danh sách cho phép của BL335 đó, R13). Giống `E_RUNTIME_TOO_OLD`, luật này phụ thuộc thiết bị nên không nằm trong vector chung; có test riêng ở C++. Khi Online, Studio kiểm trước bằng danh sách cổng của BL335.
  - **Biểu thức được miễn trần 1.024 byte chung của chuỗi** (kiểm trước schema, chống `std::regex` đệ quy). Trường `expression` có trần riêng 4.096 byte và ≤ 1.000 ký tự (`E_EXPR_LIMIT`). Trường này không có `pattern` trong schema nên không chạy regex.
  - **Vị trí lỗi trong biểu thức:** `Issue` thêm `span: [đầu, cuối)` (chỉ số ký tự Unicode, tính trên chuỗi biểu thức) để Studio gạch dưới. Vector so tập mã như hiện nay; vector biểu thức so cả `span` (R17).
  - **Vector:**
    - `tests/project-vectors/` giữ 82 ca 0.1 hiện có, không đổi kết luận;
    - thêm ca `v02-*`: ít nhất một ca cho mỗi mã và mỗi cảnh báo mới, cộng ca hợp lệ đủ bốn loại Tag;
    - `vectors.test.ts` và GoogleTest đọc cùng thư mục.
- **Lý do:** FR-006, SC-009; cùng cách đã dùng từ Sprint 1 (contracts/project-format.md của 002) và 003 (`E_LOG_*`).
- **Phương án khác đã xét:**
  - **Chỉ kiểm ở runtime:** Studio phải báo lỗi tại ô ngay khi sửa (FR-045).
  - **Một bộ kiểm tra viết bằng TS, runtime gọi Node:** BL335 không có Node; Constitution V yêu cầu runtime tự kiểm.

## R5. Tag Engine v1: luồng, hàng đợi, một lượt tính

- **Quyết định:**
  - **Luồng:**

    | Luồng | Số | Việc |
    |---|---|---|
    | Kênh (driver) | 1 mỗi kênh đang bật, ≤ 16 | vào/ra của kênh (`poll()` trên một socket hoặc một cổng serial), lịch đọc, hàng đợi ghi; đẩy `TagUpdate`, `WriteResult` vào hộp nhận của engine |
    | Engine | 1: vòng tick chính của `main.cpp` (`deltaPeriodMs`, mặc định 250 ms) | mỗi lượt gọi `engine.step(now)` rồi `hub.tick()` |
    | Ghi audit kết quả | 1 | ghi bản ghi kết quả của lệnh ghi (`synchronous=FULL`, R15), để engine không chờ `fsync` |
    | Lưu Tag giữ qua mất điện | 1 | gom và ghi file (R16) |
    | Có sẵn | CivetWeb (HTTP 24, HTTPS 8), historian, tìm thiết bị, hàng đợi gửi của 10 phiên live | không đổi |

  - **Hộp nhận của engine:** vector được khóa bằng mutex; driver nối thêm, engine tráo cả vector ra (swap) ở đầu lượt. Không giới hạn kích thước: mỗi kênh đọc tối đa vài trăm Tag mỗi chu kỳ. Driver gửi giá trị đã giải mã theo `rawType` (`TagScalar`) kèm quality và lý do.
  - **Một lượt `engine.step(now)`:**
    1. lấy hộp nhận: cập nhật từ driver, kết quả ghi, lệnh đặt Tag nội bộ;
    2. Tag ngoài: scaling, kiểm NaN/vô cực, deadband (R6) → giá trị phát hành mới;
    3. Tag mô phỏng: bộ sinh tính theo `now` (R18);
    4. Tag tính toán: duyệt **một lần** theo thứ tự tô-pô đã tính sẵn lúc nạp project. Chỉ tính Tag có đầu vào đổi (giá trị hoặc quality) trong lượt này; kết quả đổi thì đánh dấu đổi cho Tag phía sau;
    5. ghi cả lượt vào `TagStore` dưới **một lần khóa** (`TagStore::applyBatch`, mới): lưu trữ (003) và live hub không bao giờ thấy trạng thái nửa chừng, như đầu vào mới đi cùng kết quả tính cũ;
    6. đánh dấu Tag giữ qua mất điện đã đổi; chuyển kết quả ghi cho bộ điều phối ghi (R14).
  - **"Cùng lần gửi dữ liệu sống"** (FR-019, SC-004): `hub.tick()` chạy ngay sau `engine.step()` trên cùng luồng, lấy tập Tag đổi bằng `takeDirty()` như hiện nay. Đầu vào và Tag tính toán phụ thuộc vào nó luôn nằm trong cùng một delta. Tag tính toán phụ thuộc nhau tính trong cùng lượt, nên client không thấy giá trị trung gian (US4-4). Trường hợp "lần gửi ngay sau" của spec chỉ còn là dư địa nếu sau này engine tách luồng.
  - **Lúc khởi động:** lượt đầu tính mọi Tag tính toán; đầu vào chưa có giá trị thì BAD `NO_VALUE` (Edge case). Tag ngoài BAD `NO_VALUE` tới lần đọc đầu. Tag nội bộ lấy giá trị đã lưu (R16) hoặc `initial`.
  - **Đổi project:** vẫn bằng `execv` của 005: tiến trình mới dựng lại engine. Trước khi `execv`, bộ điều phối ghi dừng nhận lệnh và chờ lệnh đang gửi (FR-042, R14); kho Tag giữ qua mất điện ghi ngay phần còn chờ.
  - **`MockTagProvider`** thành bộ sinh `legacy` của driver mô phỏng (R18): giữ nguyên thuật toán và hằng số, chỉ đổi chỗ phát giá trị (qua `EngineSink` thay vì `TagStore::set`). Tải thử `SIM.*` (`simLoad`) giữ nguyên.
- **Lý do:**
  - Vòng tick hiện có đã là nơi nối nguồn dữ liệu với live hub (`provider.step(); hub.tick();` trong `server/main.cpp`). Chạy engine trên chính luồng đó cho FR-019 mà không cần đồng bộ thêm.
  - Một lần khóa cho cả lượt giữ nhất quán giữa các Tag; luồng historian lấy mẫu mỗi 100 ms đọc `snapshot` cũng nhất quán.
  - **Chi phí** (ước tính, đo ở task ⚠️🔌): 500 cập nhật/s cộng 200 Tag tính toán × 2–5 đầu vào, mỗi biểu thức vài chục lệnh bytecode, tổng dưới 1 ms CPU mỗi giây.
- **Phương án khác đã xét:**
  - **Engine có luồng riêng, chu kỳ riêng:** phải đồng bộ với `hub.tick()` để giữ "cùng lần gửi", và thêm một luồng chỉ để chờ.
  - **Driver ghi thẳng vào `TagStore` như `MockTagProvider`:** không có chỗ cho deadband và scaling chung, Tag tính toán phải đọc lại store, live hub có thể lấy delta giữa chừng.
  - **Tính lại Tag tính toán bằng sự kiện ngay khi một đầu vào đổi** (đệ quy): lộ giá trị trung gian khi hai đầu vào đổi cùng lượt; khó chặn vòng.

## R6. Scaling, deadband, quality và lý do

- **Quyết định:**
  - **Scaling** (FR-011), chỉ cho Tag số:
    - đọc: `eng = engMin + (raw − rawMin) × (engMax − engMin) / (rawMax − rawMin)`, số thực 64 bit. Có `clamp` thì giá trị thô ngoài [rawMin, rawMax] cho giá trị kỹ thuật bị kẹp ở cận gần nhất, quality UNCERTAIN, lý do `CLAMPED`;
    - ghi: phép ngược. Kiểu thô là số nguyên thì làm tròn nửa ra xa số 0 (cùng hàm `round` của biểu thức, R17). Ngoài khoảng của kiểu thô thì `REJECTED` `OUT_OF_RAW_RANGE`;
    - công thức nằm trong `@mat/tag-codec` (TS) và `core/tag-engine/scaling` (C++), có vector chung `tests/codec-vectors/scaling.json`.
  - **Deadband** (FR-012), Tag số kể cả Tag tính toán, đơn vị kỹ thuật:
    - phát hành khi `|mới − đã phát| > deadband`, hoặc quality đổi, hoặc lý do đổi; deadband 0 là phát mọi thay đổi;
    - riêng giá trị đọc lại sau ghi luôn phát, không xét deadband (FR-038);
    - "đã phát" là giá trị trong `TagStore`, cũng là thứ Tag tính toán và lưu trữ đọc.
  - **Quality và lý do** (FR-010): quality `GOOD`, `UNCERTAIN`, `BAD`. Khác GOOD thì có mã lý do trong danh mục cố định ([data-model.md](data-model.md) §6), ví dụ:
    - chung: `NO_VALUE`, `DISABLED`;
    - kết nối: `DISCONNECTED`, `TIMEOUT`, `DEVICE_SUSPENDED`;
    - thiết bị trường: `EXCEPTION_01`…`EXCEPTION_0B`;
    - giá trị: `INVALID_VALUE` (NaN, vô cực), `CLAMPED`, `BAD_FRAME`;
    - Tag tính toán: `INPUT_BAD`, `DIV_ZERO`, `MOD_ZERO`, `OVERFLOW`, `NOT_A_NUMBER`, `OUT_OF_RANGE`, `CLAMP_RANGE`;
    - Tag giữ qua mất điện: `RETAIN_LOST` (UNCERTAIN, bản lưu hỏng).

    Giá trị cuối được giữ khi Tag chuyển BAD (FR-010); lưu trữ ghi ô rỗng như 003.
  - **Lý do đi tới client** qua giao thức live 1.2.0 (R20), và có trong chẩn đoán driver.
  - **Số nguyên 64 bit:** `TagStore` giữ `int64_t`/`uint64_t` đúng như hiện nay; JSON gửi dạng chuỗi thập phân (contract của live 1.0). Trong biểu thức thì thành số thực 64 bit, có cảnh báo `W_EXPR_INT64` (Edge case).
- **Lý do:** scaling và deadband là việc chung của mọi driver, nên đặt ở engine, không ở từng driver (Constitution II: driver chỉ phát giá trị).
- **Phương án khác đã xét:**
  - **Deadband theo phần trăm khoảng:** spec dùng đơn vị kỹ thuật (US1-10: 0,5 với Tag đơn vị %).
  - **Lý do dạng chuỗi tiếng Việt từ runtime:** nặng, khó dịch; mã ngắn và Studio dịch theo `i18n` (như mã lỗi API của 005).

## R7. Driver SDK (ADR-014)

- **Quyết định** (contract: [contracts/modbus-driver.md](contracts/modbus-driver.md) §1):
  - **Mô hình chung kênh → thiết bị trường → Tag** (FR-023). Một đối tượng `Driver` cho mỗi kênh, sống trong luồng của kênh:

    ```cpp
    namespace mat::drv {
    class EngineSink {                       // engine cấp, driver chỉ gọi hai hàm này
     public:
        virtual void publish(std::vector<TagUpdate>&& updates) = 0;
        virtual void writeDone(WriteResult&& result) = 0;
    };
    class Driver {
     public:
        virtual void start(EngineSink& sink) = 0;          // tạo luồng của kênh
        virtual void stop() = 0;                           // dừng, join; sau đó không phát gì
        virtual bool enqueueWrite(WriteCommand cmd) = 0;   // false: hàng đợi đầy
        virtual LinkState linkState(uint32_t device) const = 0;  // đọc nguyên tử, cho FR-037 bước 5
        virtual void diagnostics(DriverDiag& out) const = 0;     // số đếm FR-029
        virtual TestOutcome test(const TestRequest& req) = 0;    // Thử kết nối qua kênh đang chạy (cổng serial)
    };
    }
    ```

    - Driver nhận cấu hình (kênh, thiết bị trường, danh sách Tag đã phân giải: chỉ số Tag, địa chỉ, kiểu thô, thứ tự byte, nhóm quét, đọc lại sau ghi, cách ghi).
    - Driver không ghi DB, không gửi gì tới client, không biết `TagStore` (Constitution II). Giá trị phát ra đã giải mã theo kiểu thô; scaling và deadband do engine làm.
  - **Driver trong GĐ 2:** `modbus-tcp`, `modbus-rtu`, `simulation` (bộ sinh R18 và `legacy`). Driver `simulation` không có kênh hay luồng riêng: engine gọi `step(now)` của nó ở mỗi lượt. Nó vẫn chỉ phát qua `EngineSink` và chạy cùng bộ test chuẩn.
  - **Bộ test chuẩn cho driver** (FR-023, SC-020): bộ test kiểu `TYPED_TEST_SUITE` của GoogleTest trong `drivers/sdk/tests/driver_conformance.hpp`, chạy với mọi driver trên backend giả:
    - phát `NO_VALUE` tới lần đọc đầu;
    - giá trị khớp backend;
    - backend hỏng thì BAD có lý do trong ≤ 2 chu kỳ, có lại thì GOOD;
    - đủ các kết quả ghi;
    - kênh hoặc thiết bị trường tắt thì BAD `DISABLED`, không có lưu lượng;
    - `stop()` xong thì không phát gì nữa.
  - **Lịch đọc trong một kênh:**
    - mỗi (thiết bị trường, nhóm quét) có một "vòng" gồm các yêu cầu đã gộp (R8);
    - vòng thứ k đến hạn ở `t0 + k × chu kỳ`. Luồng kênh chọn việc theo thứ tự: lệnh ghi trong hàng đợi trước (FR-028), rồi yêu cầu đọc có hạn sớm nhất (earliest deadline first);
    - **không dồn lượt** (FR-017): vòng đến hạn khi vòng trước còn đang chạy thì bắt đầu ngay sau đó; trễ hơn một chu kỳ thì bỏ các lượt đã lỡ và đếm "quá tải";
    - **chu kỳ thực** = khoảng giữa hai lần bắt đầu vòng liên tiếp; chẩn đoán báo trung bình và lớn nhất của 60 s gần nhất.
  - **Một luồng mỗi kênh, không dùng event loop chung.** Tối đa 16 luồng kênh; stack mỗi luồng đặt 256 KiB (`pthread_attr_setstacksize`).
  - **Chẩn đoán** (FR-029): số đếm nguyên tử trong driver, đếm từ lúc runtime chạy, không đặt lại (D28). HTTP handler đọc bản chụp (R20).
- **Lý do:**
  - Modbus là hỏi-đáp tuần tự: RTU bắt buộc một yêu cầu một lúc trên bus; Modbus TCP qua cổng nối TCP–RTU cũng tuần tự. Mỗi kênh một luồng với `poll()` trên một fd cho mã thẳng, dễ test, và cô lập kênh chậm: một đồng hồ RS485 không trả lời không làm chậm kênh TCP.
  - Lịch theo hạn sớm nhất xen kẽ tự nhiên ba nhóm quét và các thiết bị trường trên cùng kênh.
  - 16 luồng × 256 KiB stack ảo; phần thật sự chạm tới chỉ vài chục KiB (ước tính, đo ở task ⚠️🔌).
- **Phương án khác đã xét:**
  - **Một luồng `poll()` cho mọi kênh:** ít luồng hơn, nhưng mỗi kênh thành một máy trạng thái không chặn (kết nối không chặn, đọc từng phần, bộ hẹn giờ). Khoảng lặng RTU cần hẹn giờ chính xác cho từng kênh. Phức tạp hơn nhiều mà không lợi gì ở ≤ 16 kênh.
  - **Nhiều yêu cầu đồng thời trên một kết nối Modbus TCP** (dùng mã giao dịch): nhiều PLC và cổng nối không hỗ trợ; 500 Tag/1 s chỉ cần khoảng 8 yêu cầu/s.
  - **Thư viện driver có sẵn** (libmodbus): D3, LGPL-2.1.

## R8. Gộp yêu cầu và tách khi có exception 02/03

- **Quyết định:**
  - **Gộp** (FR-024): với mỗi (thiết bị trường, vùng, nhóm quét), mỗi Tag là một khoảng `[đầu, cuối)` theo thanh ghi (vùng HR, IR) hoặc theo bit (C, DI). Bit trong thanh ghi chiếm cả thanh ghi chứa nó.
    1. Sắp khoảng theo `đầu`, rồi `cuối`.
    2. Mở khối với khoảng đầu tiên. Với mỗi khoảng kế tiếp `r`:
       - nếu `r.đầu − khối.cuối ≤ maxGap` và `max(khối.cuối, r.cuối) − khối.đầu ≤ maxLen` thì nới khối;
       - không thì đóng khối, mở khối mới bằng `r`.
       Khoảng chồng hoặc trùng nhau (hai Tag cùng địa chỉ) luôn vào cùng khối, và được đọc một lần.
    3. `maxLen` = min(giới hạn giao thức: 125 thanh ghi, 2.000 bit; giới hạn đặt cho thiết bị trường). `maxGap` mặc định 10 thanh ghi hoặc 64 bit; 0 là chỉ gộp địa chỉ liền nhau.
    4. Khoảng dài hơn `maxLen` là lỗi kiểm tra `E_ADDR_READ_LIMIT`, nên không Tag nào bị tách qua hai yêu cầu.
  - **Tối ưu:** thuật toán tham lam này cho số khối ít nhất. Mọi cách chia hợp lệ đều gồm các đoạn liên tiếp của danh sách đã sắp. Khối tham lam luôn kết thúc muộn nhất có thể, nên đổi một cách chia tối ưu về cách chia tham lam không làm tăng số khối.
  - **Test:**
    - ca viết tay của US1-6 (50 FLOAT32 liền nhau → 1 yêu cầu 100 thanh ghi; 130 thanh ghi → 2 yêu cầu);
    - test thuộc tính với Tag sinh ngẫu nhiên (hạt giống cố định), kiểm:
      - mỗi Tag nằm trọn trong đúng một khối;
      - khối ≤ `maxLen`, khoảng trống ≤ `maxGap`;
      - với ≤ 8 Tag, số khối bằng kết quả vét cạn.
  - **Tách khi exception 02 hoặc 03** (FR-025, US1-8):
    - khối có ≥ 2 Tag bị 02/03 thì chia đôi tại **khoảng trống lớn nhất** giữa hai Tag liền nhau; không có khoảng trống thì chia tại ranh giới Tag gần giữa nhất. Hai nửa đọc ở lượt sau;
    - khối chỉ còn 1 Tag bị 02/03 thì Tag đó BAD `EXCEPTION_02`/`EXCEPTION_03`; khối một Tag này vẫn đọc mỗi lượt để tự hết khi PLC sửa;
    - trong lúc tách, Tag của khối giữ giá trị và quality đang có;
    - kế hoạch đã tách được nhớ tới khi kết nối lại hoặc đổi project, rồi gộp lại từ đầu;
    - với khối n Tag, Tag lỗi được cô lập sau tối đa ⌈log₂ n⌉ lượt (≤ 7 lượt với 125 Tag).
  - **Test tách:** thiết bị trường giả có tập địa chỉ không tồn tại (một Tag lỗi, nhiều Tag lỗi, lỗ trong khoảng trống giữa hai Tag hợp lệ). Kiểm: hội tụ đúng tập Tag lỗi trong số lượt đã nói; Tag tốt GOOD từ lượt sau khi tách xong.
- **Lý do:**
  - Chia tại khoảng trống lớn nhất trước vì lỗi 02 hay gặp nhất là do "lỗ" trong bảng thanh ghi của PLC, nằm trong khoảng trống mà việc gộp đã đọc qua.
  - Tách nhị phân nhanh hơn nhiều so với đọc từng Tag: đọc từng Tag tốn tới 125 yêu cầu, quá chậm ở 9.600 bit/s.
- **Phương án khác đã xét:**
  - **Gặp lỗi thì đọc từng Tag một lượt:** cô lập trong một lượt, nhưng một lượt đó có thể dài hàng chục giây trên RTU.
  - **Không gộp qua khoảng trống** (`maxGap = 0` làm mặc định): an toàn với PLC có lỗ, nhưng tăng số yêu cầu. Spec chọn mặc định 10 (D13), và việc tách xử lý PLC có lỗ.

## R9. Thời gian chờ, thử lại, kết nối lại, tạm ngưng

- **Quyết định** (mặc định theo D13; bảng đủ: [contracts/modbus-driver.md](contracts/modbus-driver.md) §5):
  - **Thời gian chờ trả lời và số lần thử lại** đặt theo thiết bị trường: Modbus TCP 1 s, không thử lại; RTU 1 s, thử lại 1 lần.
    - Chỉ yêu cầu **đọc** được thử lại; lệnh ghi không bao giờ (FR-028).
    - Hết số lần thử: mọi Tag của yêu cầu BAD ngay, lý do `TIMEOUT` (FR-026).
  - **Modbus TCP:**
    - chờ kết nối mặc định 3 s;
    - hết thời gian chờ trả lời hoặc lỗi giao thức thì đóng kết nối; mọi Tag của kênh BAD `DISCONNECTED`;
    - kết nối lại sau `d_n = max(1 s, min(max, 2^n s) × (1 − 0,2 × u))`, `u` ngẫu nhiên đều trong [0, 1), `max` mặc định 10 s (1–60 s). Dãy: 1; 1,6–2; 3,2–4; 6,4–8; 8–10; 8–10… giây;
    - thấy kết nối đã bị phía kia đóng (thiết bị trường tự đóng khi rảnh) lúc sắp gửi: kết nối lại ngay một lần, rồi mới tính là lỗi;
    - lệnh ghi chưa gửi mà gặp kết nối đã đóng: kết nối lại ngay một lần rồi gửi (chưa gửi nên không phải "gửi lại"). Đã gửi mà mất kết nối trước khi có trả lời: `TIMEOUT`, không gửi lại;
    - bị từ chối kết nối (`ECONNREFUSED`), hoặc bị đóng ngay sau khi kết nối mà chưa trả lời gì: lý do `REFUSED`, Thử kết nối báo "PLC từ chối kết nối (có thể đã đủ số kết nối)".
  - **RTU:**
    - thiết bị trường có 3 yêu cầu liên tiếp không nhận được trả lời hợp lệ (hết thời gian chờ, khung hỏng) thì vào **tạm ngưng**: Tag BAD `DEVICE_SUSPENDED`; chỉ hỏi thử một yêu cầu (khối đầu tiên của nhóm thường) mỗi 10 s;
    - trả lời exception vẫn là trả lời hợp lệ (FR-027);
    - thiết bị trường khác trên cùng kênh giữ chu kỳ, vì thiết bị tạm ngưng không còn chiếm bus.
  - **Exception 06** (thiết bị trường bận): thử lại theo số lần cấu hình, rồi mới BAD. **0A, 0B** (cổng nối): chỉ thiết bị trường đó BAD, kênh vẫn chạy (FR-031).
  - **Ước tính thời gian phát hiện** (FR-026, SC-005):
    - Modbus TCP, nhóm thường 1 s, chờ 1 s, không thử lại: yêu cầu đầu tiên sau khi rút cáp hết hạn sau 1 s → Tag của nó BAD và kênh đóng → mọi Tag BAD. Tổng ≤ khoảng 2 s, tức ≤ 2 chu kỳ;
    - cắm lại: chờ kết nối lại ≤ 10 s, cộng thời gian kết nối và lần đọc đầu (≤ 1 s) → GOOD trong ≤ khoảng 11 s (SC-005: ≤ 12 s).

    Cảnh báo `W_DETECT_SLOW` khi `chờ × (thử lại + 1)` lớn hơn chu kỳ của nhóm quét.
- **Lý do:**
  - **Ngẫu nhiên kiểu trừ bớt (tối đa −20 %)** giữ trần 10 s đúng nghĩa đen. Vẫn tránh được nhiều kênh hay nhiều BL335 cùng kết nối lại một lúc khi switch hay PLC khởi động lại.
  - **Nhân lên tới 1,2 lần** sẽ cho 12 s ở trần, chạm sát SC-005.
- **Phương án khác đã xét:**
  - **"Full jitter"** (0 tới trần): có lần chờ gần 0, dễ dội yêu cầu kết nối vào PLC đang khởi động.
  - **Thử lại lệnh ghi khi hết thời gian chờ:** trái FR-028 và D16 (tác động hai lần).

## R10. Modbus TCP và RTU tự viết: khung, CRC, khoảng lặng, vọng lại

- **Quyết định** (byte chính xác: [contracts/modbus-driver.md](contracts/modbus-driver.md) §2–§4):
  - **Lớp mã hóa thuần, không I/O** (`drivers/modbus/pdu.*`, `mbap.*`, `rtu_frame.*`): hàm `encodeRequest(req) → bytes` và `parseResponse(req, bytes) → Response | DecodeError`. Có vector chung `tests/modbus-vectors/frames/*.json`.
  - **Mã hàm:** 01, 02, 03, 04 (đọc); 05, 06, 15, 16, 22 (ghi). Giới hạn của giao thức: đọc thanh ghi 1–125, đọc bit 1–2.000, ghi nhiều thanh ghi 1–123, ghi nhiều coil 1–1.968.
  - **Kiểm phản hồi** (FR-032). Một phản hồi chỉ được nhận khi khớp đủ:
    - TCP: mã giao dịch, mã giao thức 0, trường độ dài, unit ID;
    - RTU: địa chỉ slave, CRC;
    - mã hàm (hoặc mã hàm | 0x80 với exception);
    - byte count đúng với số lượng đã hỏi; phản hồi kiểu "nhắc lại" của 05, 06, 15, 16, 22 khớp đúng trường của yêu cầu.

    Sai bất kỳ điểm nào: bỏ, đếm vào số khung hỏng theo loại (`crc`, `format`, `tid`, `unit`, `length`), và không cập nhật Tag nào.
  - **Mã giao dịch:** mỗi kết nối bắt đầu từ một số ngẫu nhiên, tăng 1 mỗi yêu cầu (quay vòng sau 65.535). Mỗi kết nối chỉ có một yêu cầu đang chờ, nên phản hồi mang mã khác luôn là phản hồi trễ của yêu cầu cũ: bỏ và đếm, tiếp tục chờ phản hồi đúng tới hết hạn.
  - **CRC-16/MODBUS** của RTU: đa thức 0xA001 (dạng đảo của 0x8005), giá trị đầu 0xFFFF, byte thấp gửi trước. Vector có ví dụ chuẩn `01 03 00 00 00 0A` → CRC `C5 CD`.
  - **Khoảng lặng RTU** (FR-033):
    - một ký tự = 1 bit start + các bit dữ liệu + bit parity (nếu có) + các bit stop;
    - t3.5 = 3,5 ký tự khi tốc độ ≤ 19.200 bit/s, cố định 1,75 ms khi lớn hơn (Modbus over Serial Line v1.02 §2.5.1.1). Ví dụ 9.600 bit/s 8E1 (11 bit): 4,0 ms;
    - trước mỗi lần gửi: chờ đủ khoảng lặng kể từ byte cuối nhận được, rồi `tcflush(TCIFLUSH)` để bỏ rác còn lại;
    - `silenceMs` đặt lại được, không nhỏ hơn mức của chuẩn.
  - **Nhận khung RTU theo độ dài mong đợi**, không đo t1.5 giữa hai ký tự:
    - biết mã hàm và byte count thì biết độ dài khung: 5 + n với 01–04 (n = byte count); 8 với 05, 06, 15, 16; 10 với 22; 5 với exception;
    - đọc tới đủ độ dài. Hai byte cách nhau quá `max(t3.5, gapFloor)` (gapFloor mặc định 20 ms) mà chưa đủ thì là khung thiếu byte;
    - đủ độ dài rồi vẫn chờ thêm một khoảng lặng: có byte thừa thì cả khung bị bỏ (FR-034).
  - **Bỏ phần vọng lại** (tùy chọn `dropEcho`): sau khi gửi N byte, đọc N byte đầu và so với byte đã gửi. Khác thì đếm `echoMismatch` và coi như khung hỏng.
  - **Chế độ RS485 của kernel:**
    - `ioctl(TIOCSRS485)` với `SER_RS485_ENABLED | SER_RS485_RTS_ON_SEND`, trễ 0;
    - lỗi `ENOTTY` hoặc `EINVAL` thì ghi cảnh báo `RS485_UNSUPPORTED` vào chẩn đoán và chạy chế độ thường, cho bộ chuyển tự đổi chiều (FR-035, US3-5).
- **Lý do:**
  - **Không đo t1.5 trên Linux:** tầng tty gom byte, và bộ chuyển USB có latency timer tới 16 ms. Đo khoảng cách giữa hai ký tự từ user space sẽ cắt nhầm khung. Đọc theo độ dài là cách các master Modbus trên Linux hay dùng.
  - **Mã giao dịch bắt đầu ngẫu nhiên:** phản hồi trễ của kết nối trước (qua cổng nối) ít khả năng trùng mã.
- **Phương án khác đã xét:**
  - **libmodbus** (LGPL-2.1): D3.
  - **Tách khung RTU chỉ bằng khoảng lặng:** sai với bộ chuyển USB như trên.
  - **Điều khiển chiều truyền bằng RTS hoặc GPIO từ user space:** trễ không đoán được, dễ cắt byte cuối. Kernel hoặc bộ chuyển tự đổi chiều làm tốt hơn.

## R11. Fuzz test khung Modbus

- **Quyết định:**
  - **Image toolchain không có clang** (chỉ có `clang-format`), nên không có libFuzzer. Fuzz bằng **bộ sinh ngẫu nhiên tất định chạy trong GoogleTest** (`drivers/modbus/tests/modbus_fuzz_test.cpp`):
    - **hạt giống:** khung hợp lệ trong `tests/modbus-vectors/frames/`;
    - **đột biến:** lật bit, chèn, xóa, cắt cụt, nhân đôi byte; sửa trường độ dài, byte count, mã giao dịch, unit ID, CRC; thêm rác trước hoặc sau khung;
    - **PRNG:** splitmix64; hạt giống in ra khi lỗi để lặp lại được.
  - **Hai đích:**
    1. hàm giải mã thuần (MBAP, PDU, khung RTU);
    2. máy trạng thái nhận của driver trên transport giả: byte tới từng mảnh, có trễ và mất kết nối.
  - **Bất biến:**
    - không dừng, không treo: mỗi đầu vào xử lý trong hạn;
    - ASan + UBSan không báo gì: build x64 với `-fsanitize=address,undefined` (GCC 9 có sẵn), cờ CMake mới `MAT_SANITIZE=ON`;
    - giá trị chỉ vào Tag khi phản hồi khớp yêu cầu. Bộ so tham chiếu dựng từ yêu cầu và vùng nhớ của giả lập, so với Tag nhận được: không bao giờ sai.
  - **Thời lượng:** 60 s trong `ctest` thường (`MAT_FUZZ_SECONDS`); **≥ 1 giờ** khi nghiệm thu (SC-020) bằng `tools/fuzz-modbus.ps1 -Seconds 3600`.
  - **Tùy chọn:** cùng hàm `fuzzOneInput(data, size)` có thêm điểm vào `LLVMFuzzerTestOneInput` cho libFuzzer. Chỉ build khi trình biên dịch là clang (runner GitHub có sẵn); không bắt buộc trong CI.
- **Lý do:** không phải thêm khoảng 400 MB clang vào image (ổ D: máy dev còn ít chỗ). ASan và UBSan của GCC bắt lỗi bộ nhớ, là thứ fuzz cần tìm. Đầu vào có cấu trúc sinh từ vector bù phần nào việc thiếu hướng dẫn theo độ phủ.
- **Phương án khác đã xét:**
  - **Thêm clang và libFuzzer vào image:** fuzz theo độ phủ mạnh hơn, nhưng image lớn hơn, CI lâu hơn. Để làm tùy chọn trên runner.
  - **AFL++:** cần build riêng, chạy lâu; không hợp với CI hiện có.

## R12. Giả lập trong CI và cặp cổng serial ảo

- **Quyết định:**
  - **Giả lập Modbus TCP tự viết bằng Node, không phụ thuộc gói nào** (`tools/modbus-sim/`, chạy bằng Node ≥ 22 như các công cụ của `tools/measure`):
    - **phục vụ:** nhiều unit ID trên một cổng; vùng nhớ khai trong file JSON (C, DI, IR, HR); kịch bản đổi giá trị (mọi thanh ghi đổi mỗi giây cho SC-003, bộ đếm, hình sin);
    - **tiêm lỗi** qua API điều khiển HTTP JSON trên cổng riêng: không trả lời N yêu cầu, exception theo mã và vùng địa chỉ, trả lời chậm, đóng kết nối, sai mã giao dịch, sai unit ID, sai độ dài, byte rác, từ chối kết nối (giả lập "đủ số kết nối");
    - **nhật ký** mỗi yêu cầu (JSONL: thời điểm, unit, mã hàm, địa chỉ, số lượng), để kiểm việc gộp (US1-6) và kiểm "0 lệnh tới thiết bị trường" (SC-006);
    - **bộ mã hóa riêng**, viết độc lập với bản C++, cùng qua vector `tests/modbus-vectors/frames/`. Lỗi đối xứng (hai phía cùng hiểu sai) bị bắt bởi vector lấy từ tài liệu chuẩn Modbus và bởi bàn thử PLC thật (SC-001).
  - **Chạy ở đâu:**
    - CI GitHub: job `test-x64` (runner có Node);
    - máy dev: `tools/driver-it.ps1` dựng mạng Docker gồm runtime x64 (image toolchain) và giả lập (`node:24-slim`, ghim digest);
    - bàn thử với BL335: chạy giả lập trên một máy Windows trong LAN (SC-003).
  - **RTU trong CI:**
    - test C++ tạo **cặp pty bằng `openpty()`**: driver mở đầu slave (`/dev/pts/N`) như một cổng serial thường;
    - **slave RTU giả lập chạy trong một luồng của test**, trên đầu master. Mã hóa của slave dùng lớp mã hóa chung, nhưng mọi khung đều được kiểm bằng vector CRC và vector khung chuẩn;
    - tiêm lỗi: CRC sai, không trả lời, byte rác, thiếu hoặc thừa byte, vọng lại, trả lời chậm;
    - không cần `socat` hay module kernel.
  - **pty và RS485:** pty không có `TIOCSRS485`, ioctl trả `ENOTTY`. Chính điều này kiểm được đường dự phòng của US3-5 ("cổng không có chế độ RS485 của kernel"). `tcsetattr` trên pty nhận tốc độ và khung nhưng không mô phỏng thời gian truyền; khoảng lặng được kiểm bằng đồng hồ giả trong unit test.
- **Lý do:**
  - Giả lập tự viết cho toàn quyền tiêm lỗi ở mức byte và có nhật ký từng yêu cầu. Thư viện có sẵn phải viết thêm framer mới tiêm được lỗi CRC hay sai mã giao dịch.
  - Viết bằng ngôn ngữ khác bản C++ để có hai bản mã hóa độc lập. Node đã là công cụ của repo; không thêm gói nên không phải rà license.
- **Phương án khác đã xét:**
  - **pymodbus 3.15.0** (BSD-3-Clause, 2026-08-13; bản 3.16.0 ra ngày 2026-10-11, chưa đủ 2 tuần): cần Python ≥ 3.10, image toolchain Ubuntu 20.04 chỉ có 3.8. Tiêm lỗi CRC hay mã giao dịch vẫn phải tự viết framer. Giữ làm công cụ so chéo bằng tay khi cần.
  - **jsmodbus 5.0.0** (MIT, 2026-09-14), **modbus-serial 8.0.25** (ISC): chủ yếu là client; phần server không tiêm lỗi được ở mức byte.
  - **diagslave** (freeware, đóng nguồn): không sửa được; license không rõ cho CI.
  - **`socat` tạo cặp pty:** thêm một tiến trình phải quản lý; `openpty()` gọn hơn.
  - **Module kernel `tty0tty`:** cần quyền nạp module.

## R13. Cổng serial và RS485 trên BL335; sandbox

- **Quyết định:**
  - **Chưa biết cổng nào nối RS485 (D7).** Plan đưa danh sách lệnh chỉ đọc cho người dùng chạy ([quickstart.md](quickstart.md) §8). Các lệnh không mở cổng serial, trừ một lệnh `TIOCGRS485` được đánh dấu riêng. Kết quả quyết định:
    - danh sách cổng cho phép mặc định;
    - có cần luật udev đổi nhóm của cổng không;
    - tên nhóm thiết bị cho `DeviceAllow`;
    - kernel có hỗ trợ RS485 không.
  - **Danh sách cổng cho phép** (`serialPorts` trong `runtime.json`, chỉ root sửa):
    - mặc định `["ttyAS*"]`, tự loại cổng console;
    - bộ chuyển USB phải thêm tên rõ, nên dùng tên ổn định `/dev/serial/by-id/usb-…`;
    - **không** mặc định `ttyUSB*`: `ttyUSB0`–`3` của BL335 rất có thể là modem 4G. Mở chúng, nhất là kèm `TIOCEXCL`, có thể phá chương trình đang dùng modem;
    - project chỉ được dùng tên dạng `ttyXXXn`, `/dev/serial/by-id/…` hoặc `/dev/serial/by-path/…` (`E_SERIAL_PORT`, kiểm tĩnh ở cả hai bản); cổng ngoài danh sách của BL335 là `E_SERIAL_NOT_ALLOWED` (chỉ runtime). Project không bao giờ khiến runtime mở file khác (FR-035).
  - **Liệt kê cổng** (`GET /api/v1/serial/ports`, role engineer), chỉ đọc `/sys` và `/proc`, không mở cổng:
    - tên, đường dẫn, tên `by-id` nếu có;
    - loại: `onboard` (thiết bị platform) hoặc `usb` (đường dẫn `device` nằm dưới `usb`), kèm VID:PID, tên sản phẩm, driver (`ftdi_sio`, `ch341`, `cp210x`, `option`…);
    - cổng 8250 có `type` = 0 (không có phần cứng) bị ẩn;
    - có trong danh sách cho phép không.
  - **Ai đang dùng cổng:**
    - **console:** `/proc/consoles` và `/sys/class/tty/console/active`;
    - **getty:** có `/etc/systemd/system/getty.target.wants/serial-getty@<cổng>.service`;
    - **kênh của runtime:** biết sẵn;
    - **chương trình khác:** file khóa kiểu UUCP `/run/lock/LCK..<cổng>`; lúc mở thật thì `TIOCEXCL`/`flock` trả `EBUSY`.

    Runtime chạy bằng `matscada` nên không đọc được `/proc/<pid>/fd` của tiến trình root. Chương trình không tạo file khóa thì không bị thấy trước; khi đó kênh báo lỗi lúc mở.
  - **Mở cổng** (driver RTU, Thử kết nối):
    - từ chối ngay cổng console hoặc có getty: "cổng đang được hệ điều hành dùng (console)";
    - `open(O_RDWR|O_NOCTTY|O_NONBLOCK|O_CLOEXEC)`, rồi `ioctl(TIOCEXCL)` và `flock(LOCK_EX|LOCK_NB)`. Bận thì kênh lỗi "cổng đang được chương trình khác dùng", không chiếm cổng, các kênh khác vẫn chạy (US3-4);
    - termios thô (`cfmakeraw`, `CLOCAL|CREAD`, `VMIN = VTIME = 0`), rồi chế độ RS485 như R10.
  - **Trường RS485 trong danh sách cổng:**
    - `enabled`: `TIOCGRS485` thấy cờ đang bật;
    - `supported` / `unsupported`: chỉ khi Studio yêu cầu dò (`?probe=1`), với cổng cho phép và đang rảnh. Runtime mở cổng, đặt lại đúng cấu hình đang có bằng `TIOCSRS485`; `ENOTTY` nghĩa là không có;
    - `unknown`: các trường hợp còn lại.

    Lý do: trên kernel 5.4, `TIOCGRS485` luôn thành công, kể cả khi driver không hỗ trợ RS485.
  - **Sandbox của unit** (FR-057). **Quyết định (người dùng giao toàn quyền 2026-10-11):**

    ```ini
    # Cổng serial (feature 006): thay PrivateDevices=true bằng giới hạn thiết bị tường minh
    PrivateDevices=false
    DevicePolicy=closed
    DeviceAllow=char-ttyAS rw
    DeviceAllow=char-ttyUSB rw
    DeviceAllow=char-ttyACM rw
    SupplementaryGroups=dialout
    ```

    - Phần sandbox khác giữ nguyên: `CapabilityBoundingSet=` rỗng, `NoNewPrivileges`, `ProtectSystem=strict`, `SystemCallFilter=@system-service` (không có `@raw-io`), `RestrictAddressFamilies`…
    - `DevicePolicy=closed` chỉ cho các thiết bị giả chuẩn (`/dev/null`, `/dev/zero`, `/dev/full`, `/dev/random`, `/dev/urandom`) cộng các nhóm liệt kê. Thiết bị khối và `/dev/mem` vẫn bị cgroup chặn, giống tác dụng của `PrivateDevices`. Runtime lấy số ngẫu nhiên bằng `getrandom` (005), không cần thiết bị nào khác.
    - `SupplementaryGroups` không sửa `/etc/group`.
    - Tên nhóm `char-ttyAS` lấy từ `/proc/devices`; phải xác nhận trên BL335.
    - Thay đổi unit ghi vào `docs/reports/device-changes.md` kèm cách hoàn tác.
  - **Phương án dự phòng**, nếu BL335 không có controller `devices` (`/proc/cgroups`) hoặc tên nhóm khác:
    - giữ `PrivateDevices=true`, thêm `BindPaths=-/dev/<cổng>` và `DeviceAllow=/dev/<cổng> rw` cho từng cổng trong danh sách cho phép, qua drop-in do `deploy.sh` sinh;
    - đổi lại: bộ chuyển USB cắm sau khi dịch vụ đã chạy thì phải khởi động lại dịch vụ.
  - **Quyền file:** nếu `/dev/ttyAS*` không thuộc nhóm `dialout`, mode `0660`, thì cần luật udev `/etc/udev/rules.d/60-mat-serial.rules`. Đây là thay đổi trên BL335 (ghi `device-changes.md`), chỉ làm khi người dùng cho phép.
- **Lý do:**
  - `PrivateDevices=true` tạo `/dev` riêng không có thiết bị thật. Bind thêm từng nút chạy được với cổng cố định, nhưng không thấy bộ chuyển USB cắm nóng, cũng không thấy liên kết `/dev/serial/by-id`.
  - `DevicePolicy=closed` cộng `DeviceAllow` theo nhóm major giữ đúng tính chất an toàn cần có: cgroup chặn đĩa và bộ nhớ, chỉ cho tty. Danh sách cho phép của runtime là lớp thứ hai.
- **Phương án khác đã xét:**
  - **Chạy dịch vụ bằng root hoặc thêm capability:** trái Constitution V.
  - **Cho `matscada` vào nhóm `dialout` bằng `usermod`:** sửa `/etc/group`; `SupplementaryGroups` làm được mà không đụng file hệ thống.
  - **Mặc định cho mọi `ttyUSB*`:** rủi ro với modem như trên.

## R14. Ghi Tag: API, máy trạng thái, mã yêu cầu, giới hạn tần suất

- **Quyết định** (contract: [contracts/device-api-1.1.md](contracts/device-api-1.1.md) §3; máy trạng thái: [data-model.md](data-model.md) §8):
  - **`POST /api/v1/tags/write`** (HTTPS, có phiên):
    - thân `{ "requests": [ { "requestId": "<uuid v4>", "tag": "TANK01.SP", "value": 75 } ] }`, 1–16 yêu cầu mỗi lần (ghi nhiều dòng của Bảng theo dõi);
    - `value`: số, boolean hoặc chuỗi JSON. INT64/UINT64 ngoài ±2^53 phải gửi dạng chuỗi thập phân;
    - trả **200** `{ "results": [ { "requestId", "status": "ACCEPTED" | "REJECTED", "reason"?, … } ] }`. Mỗi yêu cầu xét độc lập, theo thứ tự trong mảng;
    - lỗi cả lô: 401/403 của chuỗi kiểm của 005, 400, 413, 503 `AUDIT_UNAVAILABLE`. Khi thân đọc được, phản hồi vẫn kèm `results` với từng yêu cầu `REJECTED`.
  - **Kiểm theo thứ tự FR-037**, dừng ở điều kiện đầu tiên không đạt:
    1. phiên còn hạn, role ≥ operator;
    2. Tag tồn tại, `RW`, không phải Tag tính toán;
    3. đúng kiểu, hữu hạn;
    4. giới hạn nhập, khoảng của kiểu, khoảng thô sau scaling, độ dài chuỗi;
    5. Tag ngoài: kênh đã kết nối và thiết bị trường đang hoạt động (đọc trạng thái nguyên tử của driver);
    6. tần suất; hàng đợi chưa đầy;
    7. không đang đổi project;
    8. ghi bền bản ghi audit lúc nhận (R15).

    Đạt hết thì đưa lệnh vào hàng đợi của kênh và trả `ACCEPTED`.
  - **Hỏi kết quả bằng HTTPS, không đẩy qua live:** `GET /api/v1/tags/write/{requestId}`, hoặc `GET /api/v1/tags/write?ids=a,b,…` (≤ 16 mã). Studio hỏi mỗi 200 ms tới khi có kết quả cuối, tối đa 30 s.
    - Chỉ tài khoản đã gửi lệnh (hoặc administrator) xem được kết quả; tài khoản khác nhận 404 `NO_SUCH_REQUEST`.
    - Request hỏi định kỳ này không làm mới hạn phiên (quy tắc của 005).
  - **Máy trạng thái:**
    - `ACCEPTED` → gửi;
    - không trả lời → `TIMEOUT` (`WRITE_TIMEOUT`);
    - exception → `FAILED` (`DEVICE_EXCEPTION`, kèm mã);
    - trả lời đúng:
      - tắt đọc lại → `CONFIRMED` (`NO_READBACK`; Studio ghi "thiết bị xác nhận, không đọc lại");
      - bật đọc lại → đọc ngay, ưu tiên như lệnh ghi: khớp giá trị thô → `CONFIRMED`; khác → `FAILED` (`READBACK_MISMATCH`, kèm giá trị đọc được); không trả lời → `TIMEOUT` (`READBACK_TIMEOUT`);
    - chưa gửi mà mất kết nối, quá thời hạn ghi (mặc định 5 s) hoặc đổi project → `FAILED` (`NOT_SENT_*`);
    - Tag nội bộ, Tag mô phỏng nhập tay: `CONFIRMED` (`APPLIED`) khi engine đã áp ở lượt kế tiếp (≤ 250 ms).

    Sau `CONFIRMED`, Tag mang ngay giá trị đọc lại, không xét deadband (FR-038).
  - **Bit trong thanh ghi:** ghi có mặt nạ (mã 22, `AND = ~(1 << b)`, `OR = v << b`), hoặc đọc-sửa-ghi (đọc ưu tiên, sửa bit, ghi bằng 06 hoặc 16). Cả hai đều đọc lại để xác nhận.
  - **Mã yêu cầu** (FR-040), UUID v4 do Studio sinh mỗi lần người dùng xác nhận:
    - **lệnh đã `ACCEPTED`:** nhớ trong bảng `tag_write_request` của `audit.db`, cùng giao dịch với bản ghi audit lúc nhận (R15). Giữ ≥ 15 phút thời gian chạy, kể cả qua `execv` hay khởi động lại; tối đa 4.096 dòng;
    - **lệnh bị `REJECTED`:** chỉ nhớ trong RAM 10 phút (LRU 1.024). Lệnh bị từ chối chưa từng chạy, nên quên nó sau khởi động lại vẫn giữ đúng "không thực hiện hai lần";
    - **gửi lại cùng mã, cùng nội dung:** trả kết quả của lần trước (`duplicate: true`), không chạy lại, không thêm audit;
    - **cùng mã, khác nội dung:** `REJECTED` `REQUEST_ID_CONFLICT`.
  - **Giới hạn tần suất** (FR-041): token bucket theo đồng hồ đơn điệu, hai tầng (theo phiên, toàn BL335):
    - chỉ yêu cầu đã qua bước 1–5 mới tiêu token; bước 7 hay 8 lỗi thì hoàn token;
    - **mặc định tạm**, chốt lại theo số đo trên BL335 (R15):

      | Tầng | Liền nhau (dung lượng) | Trung bình | Mức trần của spec |
      |---|---|---|---|
      | Mỗi phiên | 10 | 20 lệnh/phút | 10; 20/phút |
      | Toàn BL335 | 20 | **20 lệnh/phút** | 20; 30/phút |

    - vượt: `REJECTED` `RATE_LIMITED`, kèm `retryAfterMs`.
  - **Hàng đợi ghi:** 16 lệnh mỗi kênh, 64 lệnh toàn BL335. Lệnh cùng Tag chạy theo thứ tự nhận (FIFO của kênh). Hai người ghi cùng Tag: chạy theo thứ tự nhận, mỗi người hỏi kết quả theo mã của mình (US2-8).
  - **Đổi project** (FR-042): trước bước `activate` của chuỗi nạp xuống (005), bộ điều phối ghi chạy `quiesce(deadline)`:
    - từ chối lệnh mới (`PROJECT_CHANGING`);
    - lệnh chưa gửi thành `FAILED` `NOT_SENT_PROJECT_CHANGE`;
    - chờ lệnh đang gửi xong, tối đa `2 × thời gian chờ lớn nhất + 1 s`, trần 25 s;
    - ghi audit mọi kết quả, rồi mới cho chuỗi nạp xuống đi tiếp.

    Đây là một móc mới trong `deploy_pipeline` của 005.
  - **Ghi qua đường khác** (FR-036, SC-006):
    - `tags/write` trên cổng HTTP: 403 `HTTPS_REQUIRED`;
    - bản tin `{"type":"write"}` trên kênh live: `error` `BAD_MESSAGE` như mọi loại không hỗ trợ;
    - trang xem không có đường ghi nào;
    - cả ba đều ghi audit `tag.write` kết quả `denied` (gộp 60 s), kèm Tag và giá trị khi đọc được thân.
- **Lý do:**
  - Hỏi kết quả qua HTTPS dùng lại chuỗi kiểm và phiên của 005. Kết quả gắn với từng tài khoản, không lộ qua kênh live dùng chung (kênh này có thể không có phiên).
  - Hỏi mỗi 200 ms trong LAN chỉ thêm ≤ 200 ms vào thời gian thấy `CONFIRMED` (SC-007: ≤ 2 s). Request đi trên kết nối keep-alive nên không phải bắt tay TLS lại.
  - Lưu mã yêu cầu cùng giao dịch audit nên chống chạy hai lần đúng cả sau `execv` (nạp xuống) hay mất điện, mà không thêm lần `fsync` nào (R15).
- **Phương án khác đã xét:**
  - **Đẩy kết quả qua kênh live:** kênh live công khai trong mạng riêng; phải ràng kết quả với phiên và thêm loại bản tin. Giữ live chỉ đọc (FR-036).
  - **`POST` chờ (long-poll) tới kết quả cuối:** giữ một worker HTTPS (chỉ có 8) tới vài giây; Studio không hiện được `ACCEPTED` sớm.
  - **Nhớ mã yêu cầu chỉ trong RAM:** sau `execv`, Studio gửi lại cùng mã thì lệnh chạy lần hai.

## R15. Audit ghi Tag, phục hồi sau mất điện, ngân sách eMMC

- **Quyết định:**
  - **Dùng `AuditLog` của 005** (`audit.db`, WAL, `synchronous=FULL`, Constitution 2.0.1). Thêm vào danh mục action:
    - `tag.write`: kết quả `started` (lúc nhận), `ok` (`CONFIRMED`), `failed` (`FAILED`, `TIMEOUT`), `denied` (`REJECTED`), `interrupted` (không rõ kết quả);
    - `driver.test`: Thử kết nối.

    Mã chính xác nằm ở cột `code` (`CONFIRMED`, `WRITE_TIMEOUT`, `READBACK_MISMATCH`, `RATE_LIMITED`…). Không thêm giá trị mới cho cột `result`: cột này có ràng buộc `CHECK` của 005, và SQLite không sửa được `CHECK` mà không dựng lại bảng.
  - **`tag.write` `denied` thuộc loại bị gộp 60 s và giới hạn 10 dòng/phút** (`auditLimited` của 005): spam lệnh bị từ chối không làm mòn eMMC.
  - **Nội dung** (FR-039): `target` = id Tag; `detail` JSON ≤ 1 KiB gồm `requestId`, kênh, thiết bị trường, giá trị cũ lúc nhận (giá trị, quality), giá trị mới, giá trị thô khi có scaling, giá trị đọc lại, mã exception, lý do. Tài khoản, role, nguồn, cờ giờ chưa đồng bộ đã có cột riêng.
  - **Lọc theo Tag** (FR-039): `GET /api/v1/audit` thêm tham số `target`. **Không thêm chỉ mục** `(target, ts_ms)`: theo số đo dưới đây, chỉ mục này tốn thêm 5,4 KB mỗi lần ghi Tag. Truy vấn đi qua chỉ mục `audit_action_ts` có sẵn rồi lọc `target`; ước dưới 0,5 s một trang trên BL335 với trần 64 MiB (đo ở task ⚠️🔌).
  - **Bảng `tag_write_request` trong `audit.db`** (`request_id` khóa chính, `started_id`, `result_id`, `ts_ms`, `boot`; `WITHOUT ROWID`):
    - giao dịch 1: bản ghi `started` + chèn dòng;
    - giao dịch 2: bản ghi kết quả + gán `result_id`;
    - dọn dòng cũ theo lô mỗi 10 phút, trong một giao dịch.

    `user_version` của `audit.db` lên 2; mở DB cũ thì tạo bảng (`CREATE TABLE IF NOT EXISTS`).
  - **Phục hồi lúc khởi động** (FR-039, SC-006):
    - trước khi nhận lệnh ghi nào, mọi dòng có `result_id` NULL nhận một bản ghi `interrupted` (`code` `UNKNOWN_OUTCOME`, chi tiết chép từ bản ghi lúc nhận), trong một giao dịch;
    - runtime không gửi lại lệnh nào;
    - chết giữa lúc phục hồi thì lần sau làm lại; có kiểm `result_id` nên không trùng.
  - **Build SQLite với `HAVE_FDATASYNC=1`.** **Quyết định (người dùng giao toàn quyền 2026-10-11)**; cần phiên chính duyệt vì sửa `CMakeLists.txt` dùng chung với 003 và 005:
    - không có cờ này, bản amalgamation gọi `fsync` thay cho `fdatasync`; mỗi commit kéo theo một lần ghi nhật ký ext4 chỉ để cập nhật `mtime`;
    - `fdatasync` vẫn ghi mọi metadata cần để đọc lại dữ liệu, kể cả kích thước file khi WAL lớn lên. Đây là cấu hình mặc định khi build SQLite bằng `configure` trên Linux;
    - độ bền khi mất điện không đổi.
  - **Mặc định giới hạn tần suất toàn BL335: 20 lệnh/phút** (thấp hơn trần 30 của spec), chờ số đo trên BL335.
- **Số đo** (thí nghiệm trong scratchpad; ext4 trên loop device, x64; đếm byte ghi xuống thiết bị khối, gồm dữ liệu, WAL, nhật ký ext4, checkpoint; mỗi ca 1.000 lần sau 300 lần làm nóng):

  | Một lần ghi Tag = 2 giao dịch FULL | `fsync` (build hiện tại) | `fdatasync` |
  |---|---|---|
  | Chỉ 2 dòng audit (3 chỉ mục của 005) | 46,3 KB | 21,6 KB |
  | + bảng mã yêu cầu | | 24,1 KB (**chọn**) |
  | + chỉ mục `(target, ts_ms)` | | 27,0 KB |
  | + cả hai | 54,6 KB | 29,8 KB |

  **Ước tính SC-011** (≤ 1 GB/ngày cho audit ghi Tag cộng Tag giữ qua mất điện) khi ghi liên tục ở tần suất toàn BL335 R lệnh/phút; Tag giữ qua mất điện lưu tối đa một lần mỗi cửa sổ 5 s (R16):

  | R | Audit, `fdatasync`, 24,1 KB/lệnh | Tag giữ qua mất điện, 4,1 KB/lần | Tổng | Nếu giữ `fsync` (khoảng 49 KB/lệnh) |
  |---|---|---|---|---|
  | 30/phút | 1,04 GB | 0,07 GB | **1,11 GB ✗** | 2,2 GB ✗ |
  | 20/phút | 0,69 GB | 0,07 GB | **0,77 GB ✓** | 1,5 GB ✗ |
  | 10/phút | 0,35 GB | 0,06 GB | 0,41 GB ✓ | 0,77 GB ✓ |

  - **Công thức chốt** sau khi đo trên BL335: `R = min(30, ⌊1 GB / ((B_audit + B_retain) × 1.440)⌋)`, B đo bằng `/sys/block/mmcblk0/stat` (task ⚠️🔌).
  - **Nếu không bật `fdatasync`:** mặc định phải hạ xuống 10 lệnh/phút.
  - **Dung lượng audit:** mỗi lần ghi Tag tốn khoảng 0,9 KB trong `audit.db` (2 dòng và chỉ mục). Trần 64 MiB giữ khoảng 70.000 lần ghi; ghi liên tục ở mức trần thì audit chỉ giữ được vài ngày. Tài liệu triển khai nói rõ và gợi ý nâng `auditMaxMB` (8–1024, khóa của 005).
- **Lý do:** FR-039 buộc bản ghi lúc nhận phải bền trước khi gửi tới thiết bị trường, nên mỗi lệnh có ít nhất một commit FULL. Bản ghi kết quả cũng FULL, vì Constitution 2.0.1 áp FULL cho mọi giao dịch của `audit.db`. Ba cách giảm byte ghi đã được đo: `fdatasync`, bỏ chỉ mục thừa, bảng mã yêu cầu nhỏ.
- **Phương án khác đã xét:**
  - **Gộp kết quả vào bản ghi lúc nhận bằng `UPDATE`:** ít trang hơn, nhưng audit không còn chỉ-thêm; FR-039 nói "ghi thêm".
  - **Bản ghi kết quả chạy `synchronous=NORMAL`:** cần ngoại lệ ngược với Constitution 2.0.1; mất điện có thể mất kết quả đã báo cho người vận hành.
  - **Tìm lệnh dở bằng `json_extract` trên `detail`** (không có bảng mã yêu cầu): rẻ hơn 2,5 KB mỗi lệnh, nhưng không chống chạy hai lần sau `execv`, và phải quét audit lúc khởi động.

## R16. Tag giữ qua mất điện

- **Quyết định:**
  - **Hai file ghi tại chỗ, cấp sẵn dung lượng**, trong `<dataDir>/retain/`: `retain-a.bin` và `retain-b.bin`, mỗi file 512 KiB, ghi đầy số 0 và `fsync` một lần lúc tạo.
    - Mỗi file: phần đầu 64 byte (magic `MATRET01`, phiên bản định dạng, **thế hệ** u64, CRC32), rồi chuỗi bản ghi `[độ dài][số thứ tự][các mục][CRC32]`.
    - Mỗi mục là (id Tag, mã kiểu, giá trị). Bản ghi đầu của mỗi thế hệ là ảnh chụp đầy đủ; các bản ghi sau chỉ chứa Tag đổi trong cửa sổ.
  - **Mỗi lần lưu:** `pwrite` bản ghi mới vào ngay sau bản ghi cuối (vẫn trong dung lượng đã cấp), rồi `fdatasync`. Kích thước file không đổi, nên ext4 không phải ghi metadata.
  - **Nén lại:** file đang dùng còn chỗ dưới 2 lần bản ghi lớn nhất thì ghi ảnh chụp đầy đủ vào file kia:
    1. ghi thân, `fdatasync`;
    2. ghi phần đầu với thế hệ + 1, `fdatasync`;
    3. từ đó nối bản ghi vào file mới.

    Mất điện ở bước 1 hay 2: phần đầu của file mới chưa hợp lệ hoặc thế hệ còn cũ, nên lúc khởi động vẫn chọn file cũ còn nguyên vẹn.
  - **Lúc khởi động:**
    - chọn file có thế hệ hợp lệ cao nhất, phát lại bản ghi tới bản ghi hỏng đầu tiên. Bản ghi cuối bị cắt dở thì bị bỏ: chỉ mất thay đổi của cửa sổ cuối (FR-018);
    - file mới hỏng mà file cũ tốt: dùng file cũ, chẩn đoán báo `RETAIN_FALLBACK`;
    - cả hai hỏng: dùng giá trị đầu; Tag giữ qua mất điện UNCERTAIN `RETAIN_LOST`; đổi tên hai file thành `*.corrupt-<thời điểm>` để điều tra (giữ tối đa 3 bộ); chẩn đoán báo.
  - **Cửa sổ gom** (`retainWindowS`, mặc định 5, 1–60, trong `runtime.json`): luồng lưu ghi khi có Tag đổi và đã qua ≥ 1 cửa sổ kể từ lần ghi trước. Một Tag đổi luôn được ghi trong ≤ 1 cửa sổ (US4-9).
  - **Đổi project, khôi phục bản trước** (FR-018): giữ giá trị của Tag cùng id, cùng `type`, vẫn `retain`; Tag khác về `initial`. Có Tag bị bỏ thì nén lại ngay, để giá trị cũ không còn nằm trong file. Trước `execv` của nạp xuống, luồng lưu ghi ngay phần còn chờ.
  - **Giới hạn:** ≤ 500 Tag giữ qua mất điện, chuỗi ≤ 256 byte (D12). Ảnh chụp lớn nhất khoảng 165 KB, vừa file 512 KiB.
- **Số đo** (cùng thí nghiệm của R15):

  | Cách lưu | Byte ghi xuống thiết bị mỗi lần lưu |
  |---|---|
  | File tạm + `fsync` + `rename` + `fsync` thư mục, 1 KiB | 65,6 KB |
  | Như trên, 24 KiB | 86,1 KB |
  | **Bản ghi 64 byte ghi tại chỗ + `fdatasync`** | **4,1 KB (chọn)** |
  | Hai khe A/B, mỗi lần ghi cả ảnh chụp 1 KiB | 4,1 KB |
  | Hai khe A/B, mỗi lần ghi cả ảnh chụp 24 KiB | 24,6 KB |

  Tối đa một lần lưu mỗi 5 s, tức 17.280 lần/ngày: 4,1 KB × 17.280 ≈ 71 MB/ngày. Cách file tạm + `rename` sẽ là 1,1–1,5 GB/ngày, một mình đã vượt SC-011.
- **Lý do:** FR-018 (mất điện giữa lúc lưu không làm hỏng bản trước) và SC-011. Nối bản ghi nhỏ giữ chi phí mỗi lần lưu ở một khối 4 KiB, bất kể có bao nhiêu Tag giữ qua mất điện.
- **Phương án khác đã xét:**
  - **File tạm + `rename`** (gợi ý của đề bài): an toàn, đơn giản, nhưng tốn gấp 16–21 lần byte ghi (bảng trên).
  - **SQLite:** `NORMAL` có thể mất nhiều hơn một cửa sổ khi mất điện (WAL chỉ đồng bộ lúc checkpoint); `FULL` cần ngoại lệ thứ ba của Constitution.
  - **Hai khe A/B, mỗi lần ghi cả ảnh chụp:** đơn giản hơn, nhưng với 500 Tag mỗi lần lưu tới khoảng 40 KB (0,7 GB/ngày ở mức trần).

## R17. Ngôn ngữ biểu thức (ADR-015)

- **Quyết định** (contract đầy đủ: [contracts/expression-language.md](contracts/expression-language.md)):
  - **Ngữ pháp** (EBNF ở contract §2). Thứ tự ưu tiên từ thấp tới cao:

    | Mức | Toán tử | Kết hợp |
    |---|---|---|
    | 1 | `c ? a : b` | phải |
    | 2 | `\|\|` | trái |
    | 3 | `&&` | trái |
    | 4 | `==` `!=` | **không kết hợp**: `a == b == c` là lỗi cú pháp |
    | 5 | `<` `<=` `>` `>=` | **không kết hợp**: `a < b < c` là lỗi cú pháp |
    | 6 | `+` `-` | trái |
    | 7 | `*` `/` `%` | trái |
    | 8 | `-` `!` (một ngôi) | phải |
    | 9 | số, `true`, `false`, chuỗi, tên Tag, `(…)`, gọi hàm | |

    - Số thập phân dạng `12`, `12.5`, `1.5e3` (không có `.5`, `5.`, số hex);
    - chuỗi trong ngoặc kép, chỉ hai chuỗi thoát `\"` và `\\`;
    - tên Tag theo luật id của 0.1 (`TANK01.LEVEL`); `true`, `false` là từ khóa;
    - hàm viết thường: `min`, `max` (2–16 tham số), `abs`, `round(x)`, `round(x, n)` (n là số nguyên 0–9 viết thẳng), `clamp(x, lo, hi)`, `text(x, TênBảng)` (tham số thứ hai là tên bảng giá trị);
    - không có biến, gán, vòng lặp, gọi hàm khác, truy cập thuộc tính: không có script (Constitution V, D4).
  - **Kiểu:** `number`, `bool`, `string`. Tag số là `number`, `BOOL` là `bool`, `STRING` là `string`.
    - BOOL trong phép số là 1 hoặc 0;
    - toán hạng của `&&`, `||`, `!` và điều kiện của `?:` phải là `bool`; số ở đó là lỗi kiểu (US4-2);
    - chuỗi chỉ dùng với `==`, `!=`, nhánh của `?:` và làm kết quả;
    - nhánh của `?:` cùng kiểu, hoặc trộn `number` với `bool` (thành `number`).
  - **Kết quả gán vào Tag** theo `type` của Tag tính toán:
    - `number` vào Tag số nguyên: làm tròn như `round`; ngoài khoảng của kiểu: BAD `OUT_OF_RANGE`;
    - vào `FLOAT32`: làm tròn về số thực 32 bit; vượt thì BAD `OVERFLOW`;
    - `bool` vào Tag số là 1/0, vào `BOOL` giữ nguyên;
    - `number` vào `BOOL`, hay `string` vào Tag không phải `STRING`: lỗi kiểu khi kiểm (`E_EXPR_TYPE`);
    - `-0` được chuẩn hóa thành `0`.
  - **Ngữ nghĩa số** (giống hệt ở hai bản):
    - số thực nhị phân 64 bit IEEE 754, làm tròn về gần nhất, **không gộp nhân-cộng (FMA)**. Bản C++ build các module biểu thức, bộ sinh và phép đổi giá trị với `-ffp-contract=off`. Kiểm ngày 2026-10-11: GCC 9 của toolchain mặc định `-ffp-contract=fast` (cả x64 lẫn armhf). Hiện chưa sinh FMA, vì armhf mặc định `vfpv3-d16` và x64 không bật `-mfma`, nhưng chỉ cần thêm `-mfpu=neon-vfpv4` là kết quả có thể khác bản TS;
    - `round(x)` = nửa ra xa số 0: `r = trunc(x); nếu |x − r| ≥ 0,5 thì r += sign(x)`. Phép `x − trunc(x)` chính xác với mọi số thực 64 bit. Không dùng `Math.round` của JS (làm tròn nửa về phía +∞) hay `std::round` (đúng nghĩa nhưng mỗi bản một hàm);
    - `round(x, n)` = `round(x × 10^n) / 10^n` tính bằng số thực 64 bit (10^n chính xác với n ≤ 9). Hệ quả có chủ ý, ghi trong contract và có vector: `round(1.005, 2)` = 1, vì 1.005 × 100 = 100,49999999999999;
    - `%` mang dấu số bị chia, như `fmod` của C và `%` của JS, cả hai đều chính xác;
    - `/` hoặc `%` cho 0: BAD `DIV_ZERO`, `MOD_ZERO`, kiểm trước khi chia; ra ±∞: BAD `OVERFLOW`; ra NaN: BAD `NOT_A_NUMBER`; `clamp` với `lo > hi`: BAD `CLAMP_RANGE`;
    - chuỗi so bằng nhau theo byte UTF-8, không chuẩn hóa Unicode.
  - **Quality** (FR-019, D19):
    - quality của kết quả là quality xấu nhất (GOOD < UNCERTAIN < BAD) của các đầu vào **thực sự được nạp** khi tính. Nhánh không tính của `?:`, `&&`, `||` không đóng góp (US4-6);
    - gặp đầu vào BAD thì dừng: kết quả BAD, lý do `NO_VALUE` nếu đầu vào đó chưa có giá trị, không thì `INPUT_BAD`. Giá trị cuối được giữ (FR-010).
  - **Giới hạn** (FR-020):
    - ≤ 1.000 ký tự và ≤ 4.096 byte;
    - mức lồng ≤ 32, tính theo độ sâu đệ quy của parser: ngoặc, gọi hàm, nhánh `?:`, toán tử một ngôi. Chuỗi toán tử hai ngôi được parse bằng vòng lặp, không tính vào mức lồng, nên `a + b + … + z` dài bao nhiêu cũng được;
    - ≤ 32 Tag đầu vào khác nhau;
    - chuỗi phụ thuộc giữa các Tag tính toán ≤ 16 tầng (`E_EXPR_DEPTH`).

    Mọi lỗi kiểm có vị trí `span` (chỉ số ký tự Unicode) để gạch dưới.
  - **Cài đặt hai bản cùng cấu trúc:** bộ tách từ → parser đệ quy xuống → cây cú pháp → kiểm kiểu → biên dịch ra bytecode cho máy ngăn xếp (ngăn xếp tối đa 64) → máy chạy có theo dõi quality.
    - TS: `packages/expression` (`@mat/expression`), dùng ở Studio (kiểm khi gõ, xem trước, Mô phỏng) và bộ kiểm tra TS;
    - C++: `core/expression` (`mat_expression`), dùng ở Tag Engine và bộ kiểm tra C++.

    `&&`, `||`, `?:` biên dịch thành lệnh nhảy, nên tính lười giống hệt nhau.
  - **Bộ vector chung** `tests/expression-vectors/*.json`, **≥ 300 ca** (SC-008):
    - nhóm: số học, `%`, làm tròn nửa, tràn, NaN, so sánh, logic, `?:` và quality, hàm, `text`, chuỗi, gán vào từng kiểu Tag, lỗi cú pháp kèm `span`, lỗi kiểu kèm `span`, giới hạn;
    - vòng tham chiếu và độ sâu là luật mức project, nằm ở `tests/project-vectors/v02-*`;
    - mỗi ca: biểu thức, các Tag đầu vào (kiểu, giá trị, quality, lý do), bảng giá trị, kiểu của Tag kết quả, kết quả mong đợi (`value`, `quality`, `reason`) hoặc lỗi (`code`, `span`);
    - số ghi theo dạng ngắn nhất đọc lại đúng; giá trị đặc biệt ghi dạng chuỗi `"NaN"`, `"Infinity"`, `"-Infinity"`;
    - so giá trị bằng từng bit.

    Ca sinh tự động do `generate.mjs` tính kết quả bằng **một bộ tính tham chiếu viết riêng** (duyệt cây trực tiếp, không dùng mã của package), để vector không tự xác nhận chính nó. Ca biên viết tay ghi sẵn kết quả. Vitest và GoogleTest chạy cùng bộ.
- **Lý do:**
  - Không kết hợp ở phép so sánh: `0 < x < 10` không có nghĩa như người dùng nghĩ, nên báo lỗi rõ thay vì tính sai.
  - Bytecode cho cùng thứ tự tính ở hai bản, chạy nhanh với 200 Tag tính toán, và không đệ quy sâu khi tính.
  - Vector so từng bit, cộng việc tắt FMA và tự viết `round`, là điều kiện để "100 % ca giống nhau" (SC-008) đúng trên mọi CPU.
- **Phương án khác đã xét:**
  - **Thư viện parser JS** (jsep 1.4.0, MIT): chỉ có bản TS; bản C++ vẫn phải tự viết với cùng ngữ pháp, nên hai bản dễ lệch nhau.
  - **Cú pháp kiểu Excel** (`IF(…)`, `AND(…)`): spec đã chốt `? :`, `&&`, `||`.
  - **Số thập phân (decimal):** khớp trực giác hơn với `round(1.005, 2)`, nhưng chậm và phải tự viết ở hai bản; spec chốt số thực 64 bit.
  - **Tính trực tiếp trên cây:** đơn giản hơn, nhưng đệ quy theo độ sâu của cây; chuỗi `a+b+…` dài thì cây sâu.

## R18. Bảng giá trị và bộ sinh mô phỏng

- **Quyết định** (contract: [contracts/value-tables-simulation.md](contracts/value-tables-simulation.md)):
  - **Bảng giá trị** (FR-021, D20):
    - **mục:** một giá trị (số, hoặc BOOL coi là 1/0) hoặc một khoảng nửa mở `from ≤ x < to`, bỏ trống được một đầu; kèm `text` (≤ 64 ký tự Unicode) và `color` tùy chọn `#RRGGBB`. Có `default` tùy chọn;
    - **chồng nhau là lỗi** (`E_VT_OVERLAP`): hai giá trị bằng nhau (kể cả `true` với `1`), giá trị nằm trong khoảng, hai khoảng giao nhau. Không chồng nên mỗi đầu vào khớp tối đa một mục; thứ tự mục không ảnh hưởng kết quả;
    - **tra:** NaN hay không khớp mục nào thì dùng `default`; không có `default` thì chữ rỗng, không màu;
    - **dùng ở:** `text()` của biểu thức (C++ và TS), Studio (Bảng theo dõi, Bảng Tag, xem trước) và binding (FR-054, D25). Binding 0.2 thêm transform `{ "kind": "valueTable", "table"?: "<tên>", "output": "text" | "color" }`; vắng `table` thì dùng bảng của Tag. Mục không có màu thì binding màu không áp, phần tử giữ màu gốc;
    - **vector chung** `tests/value-table-vectors/*.json`: bảng, đầu vào, kết quả (`text`, `color`, mục khớp). TS dùng ở `@mat/expression` và `binding-engine`; C++ ở `core/expression`.
  - **Bộ sinh mô phỏng** (FR-022, D21), `t` = thời gian UTC tính bằng ms (đồng hồ hệ thống ở BL335, `Date.now()` ở Studio), chu kỳ là số nguyên ms ≥ 100:

    | Bộ sinh | Tham số | Giá trị |
    |---|---|---|
    | `const` | `value` | `value` |
    | `ramp` | `from`, `to`, `periodMs` | `from + (to − from) × ((t mod T) / T)` (răng cưa) |
    | `sine` | `center`, `amplitude`, `periodMs`, `phase` (vòng, 0–1) | `center + amplitude × sinTurns(frac((t mod T) / T + phase))` |
    | `random` | `min`, `max`, `periodMs`, `seed` (u32) | `min + (max − min) × u(seed, ⌊t / T⌋)` |
    | `square` | `periodMs`, `duty` (0–1) | bật khi `(t mod T) < duty × T`: BOOL `true`/`false`, Tag số 1/0 |
    | `manual` | `initial` | chỉ đổi khi có lệnh ghi |
    | `legacy` | `signal` | tín hiệu của `MockTagProvider` (chỉ từ nâng cấp 0.1) |

    - **`sinTurns(f)` tự viết** ở cả hai bản: đưa f về [0, 1/8] bằng phép trừ chính xác (Sterbenz) theo quãng tám, rồi tính đa thức hệ số cố định theo Horner, không FMA. Không gọi `std::sin` hay `Math.sin`: hai hàm này có thể khác nhau một ulp, nên không bảo đảm vector giống từng bit.
    - **`u(seed, k)` là hàm băm theo bộ đếm**, chỉ dùng phép toán nguyên 32 bit: `h = mix(seed ^ 0x9E3779B9); h = mix(h ^ k_lo); h = mix(h ^ k_hi)`, với `mix` là "lowbias32" (Chris Wellons, public domain); `u = (h >>> 8) / 2^24`, đúng chính xác trong số thực 64 bit. TS dùng `Math.imul` và `>>> 0`.
    - **Đổi về kiểu Tag:** số nguyên làm tròn như `round`; `FLOAT32` làm tròn 32 bit (`Math.fround`, ép kiểu `float`); `sine`, `ramp`, `random` cho Tag BOOL là `E_SIM`.
    - **Chạy ở BL335:** driver `simulation`, mỗi lượt engine (250 ms). Ở Studio: chế độ Mô phỏng, cũng 250 ms. Cùng `t` thì cùng giá trị.
    - **`legacy`:** ở BL335 là `MockTagProvider`, giữ nguyên thuật toán (có trạng thái: bồn đầy rồi cạn, bơm bật tắt). Ở Studio là bản port TS chạy từ lúc bật Mô phỏng, chỉ cho project 0.1 mở chỉ đọc. Bộ sinh này không thuộc yêu cầu "giống từng bit" của vector chung, vì spec chỉ yêu cầu giữ tín hiệu cũ (FR-022); bản TS kiểm với sai số 1e-9.
    - **Tag ngoài chưa có cấu hình mô phỏng**, trong Mô phỏng của Studio (FR-052): Tag số `random` trong khoảng hiển thị (thiếu thì 0–100), đổi mỗi 2 s, hạt giống băm từ id Tag; BOOL `square` 10 s, 50 %; STRING rỗng.
    - **Vector chung** `tests/sim-vectors/*.json`: (bộ sinh, tham số, kiểu Tag, `t`) → giá trị, gồm biên chu kỳ, `t` rất lớn (năm 2100), pha, hạt giống.
- **Lý do:**
  - Hàm băm theo bộ đếm thay PRNG có trạng thái (xorshift, splitmix): giá trị là hàm của thời gian, truy cập ngẫu nhiên theo `t`, không phụ thuộc lúc bắt đầu hay số lượt đã chạy. Nhờ vậy BL335 và Studio cho cùng giá trị ở cùng thời điểm.
  - Chỉ dùng phép nguyên 32 bit: splitmix64 cần phép nguyên 64 bit, mà JS phải dùng `BigInt` (chậm) mới làm được.
  - Khoảng nửa mở và cấm chồng: không mơ hồ ở biên (D20).
- **Phương án khác đã xét:**
  - **xorshift32 có trạng thái:** dãy phụ thuộc số lần gọi; BL335 và Studio bắt đầu ở lúc khác nhau nên ra dãy khác.
  - **Làm tròn đầu ra `sine` về vài chữ số để che sai khác ulp:** vẫn lệch ở ca nằm đúng nửa; không bảo đảm 100 %.
  - **Bảng giá trị cho phép chồng, mục đầu thắng:** dễ cấu hình nhầm; spec cấm (FR-021).

## R19. Lọc nguồn cho phần không đăng nhập (FR-055a, ADR-018)

- **Quyết định:**
  - **Phần không cần đăng nhập** (bị lọc), trên cả HTTP 8080 và HTTPS 8443: `/`, `/index.html`, `/assets/*`, `/project/*`, `GET /api/v1/system/info`, `GET /api/v1/projects/active`, `/api/v1/live` không kèm phiên.
  - **Không bị lọc:**
    - API kỹ thuật của 005 và 006, kể cả `device/identity`, `auth/*`;
    - mọi request HTTPS kèm phiên hợp lệ (`Authorization: Bearer`, phiên còn hạn và đúng IP lúc đăng nhập), kể cả `system/info` và `/api/v1/live`.
  - **Mạng riêng:**
    - IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16, 127.0.0.0/8;
    - IPv6: fc00::/7, fe80::/10, ::1;
    - địa chỉ IPv4 ánh xạ (`::ffff:a.b.c.d`) xét như IPv4.

    Hàm thuần `isPrivateSource(addr)` có vector test.
  - **`viewerAccess`** trong `runtime.json`:
    - `private` (mặc định);
    - `any`: mọi nguồn; có cảnh báo;
    - `off`: trang xem, `projects/active` và live không kèm phiên bị từ chối với mọi nguồn trừ loopback. `system/info` vẫn theo luật `private`, vì script triển khai và kiểm tra sức khỏe của 005 gọi nó qua `127.0.0.1`.
  - **Bị từ chối:**
    - **403**, đường dẫn trang: trang HTML ngắn tiếng Việt "Trang xem chỉ mở trong mạng nội bộ. Hãy kết nối qua VPN…";
    - đường dẫn API: JSON `{ "error": "SOURCE_NOT_ALLOWED" | "VIEWER_OFF", "message" }`;
    - nâng cấp WebSocket: 403 trước khi lấy slot, như kiểm `Origin` hiện nay (ADR-006).

    Đếm `viewer.blockedTotal`, `viewer.lastBlockedAt` (chẩn đoán của 005). **Không ghi audit từng lần** (FR-055a).
  - **Cảnh báo khi `any`:** `system/info.device.viewerAccess = "any"` kèm `warnings: ["VIEWER_PUBLIC"]`; thanh trạng thái của Studio hiện cảnh báo màu hổ phách; `deploy.sh` in lời nhắc mỗi lần cài.
  - **Cập nhật từ runtime < 0.5:** `deploy.sh` in lời nhắc: "Từ runtime 0.5, trang xem chỉ phục vụ mạng riêng. Đang xem qua port-forward 9080 thì đặt `viewerAccess: any` (chỉ khi demo), hoặc dùng VPN."
  - **Kênh live của Studio kèm phiên** (D33):
    - `live.rs` (005) thêm header `Authorization: Bearer <token>` vào request nâng cấp WebSocket khi đã đăng nhập thiết bị đó, chỉ trên `wss`, với cờ `sensitive` của `HeaderValue`. Cách làm: `url.into_client_request()`, thêm header, rồi `client_async_with_config(request, …)`;
    - `CivetLiveTransport::onConnect` gọi một hàm kiểm phiên được tiêm vào (`SessionPeek`): có `Authorization` mà không phải TLS thì 403 `HTTPS_REQUIRED`; phiên hợp lệ thì nhận, bất kể nguồn. Kiểm phiên kiểu "nhìn" (peek), không làm mới hạn;
    - phiên live được nhận nhờ token, từ nguồn không thuộc mạng riêng: kiểm lại mỗi 60 s, phiên hết hạn hoặc bị thu hồi thì đóng bằng mã **4401** (giao thức live 1.2.0, R20). Studio gặp 4401 thì hỏi đăng nhập lại như `SESSION_EXPIRED`.
  - **Studio theo dõi chỉ đọc theo địa chỉ** (chế độ của 004, HTTP không đăng nhập) từ nguồn công cộng sẽ nhận 403. Studio ánh xạ thành lỗi `viewer-private`: "Thiết bị chỉ phục vụ trang xem trong mạng riêng; hãy Online (đăng nhập)".
  - **Test SC-022:** kịch bản `driver-it -Scenario source`:
    - mạng Docker riêng dùng dải tài liệu 203.0.113.0/24: client có địa chỉ công cộng;
    - mọi đường dẫn bị lọc trả 403; live kèm phiên vẫn chạy; đặt `any` thì xem được và `system/info` có cảnh báo;
    - từ mạng 172.x của Docker (mạng riêng), mọi thứ như cũ.
- **Lý do:**
  - Lọc theo nguồn chặn đúng trường hợp port-forward 9080 ra Internet, mà không đổi gì với người dùng trong LAN hay qua VPN (D33).
  - Phiên đi kèm kênh live giữ được Online từ xa qua port-forward HTTPS.
  - Không audit từng lần để bot quét Internet không làm mòn eMMC.
- **Giới hạn ghi trong tài liệu triển khai:** router port-forward có SNAT (masquerade) khiến mọi nguồn trông như địa chỉ LAN của router. Khi đó lọc không có tác dụng; cần VPN hoặc tắt SNAT.
- **Phương án khác đã xét:**
  - **Bắt đăng nhập trên Chrome ngay ở GĐ 2:** thuộc GĐ 3a (D2): cần cookie, CSRF, quy trình chứng chỉ CA.
  - **Danh sách mạng do người dùng cấu hình:** dễ cấu hình sai; ba giá trị `private`, `any`, `off` đủ cho GĐ 2. Thêm sau nếu khách hàng có LAN dùng địa chỉ công cộng.
  - **Ghi audit mỗi request bị chặn:** bot quét làm ngập audit.

## R20. Giao thức live 1.2.0, API thiết bị 1.1.0

- **Quyết định:**
  - **Giao thức live 1.2.0** (MINOR theo ADR-006: thêm trường và một mã đóng; contract [live-protocol-1.2.md](contracts/live-protocol-1.2.md)):
    - snapshot: mỗi Tag thêm `reason` khi quality khác GOOD;
    - delta: phần tử thêm vị trí thứ tư là mã lý do, chỉ khi quality khác GOOD: `[i, v, "BAD", "TIMEOUT"]`;
    - request nâng cấp được kèm `Authorization: Bearer` (chỉ HTTPS);
    - mã đóng 4401 `SESSION_ENDED`.

    Client 1.1 đọc delta bằng `const [index, value, q] = entry` và bỏ qua khóa lạ, nên không hỏng. Alarm của GĐ 4 sẽ là 1.3.0, thay cho 1.2.0 mà lộ trình dự kiến.
  - **API thiết bị 1.1.0** (MINOR: thêm endpoint và thêm trường; contract [device-api-1.1.md](contracts/device-api-1.1.md)):
    - mới: `tags/write`, kết quả ghi, `drivers/diagnostics`, `drivers/test`, `serial/ports`, tham số `target` của `audit`;
    - `device/identity.features` thêm `tag-write`, `drivers`, `serial-ports`;
    - `system/info.device` thêm `viewerAccess`, `warnings`;
    - `projects/active` thêm `valueTables` (chỉ bảng mà binding dùng tới), `connections` (chỉ id và tên, không có địa chỉ IP hay tham số cổng).
  - **Studio đọc định nghĩa Tag trên BL335** cho hộp xác nhận ghi (FR-050: "dùng định nghĩa Tag trên BL335") bằng `GET /api/v1/projects/active` qua `device_get`. Operator không có quyền tải gói (chỉ engineer), nên không dùng đường đọc lên.
- **Lý do:**
  - Lý do của quality đi theo dữ liệu sống, nên Bảng Tag và Bảng theo dõi hiện ngay, không phải hỏi thêm (FR-045, FR-050).
  - Lý do chỉ gửi khi khác GOOD, nên băng thông gần như không đổi ở tải chuẩn: mọi Tag GOOD.
- **Phương án khác đã xét:**
  - **Studio hỏi lý do qua HTTPS mỗi 2 s:** trễ tới 2 s, thêm tải cho BL335, hai nguồn dữ liệu cho cùng một ô.
  - **Bản tin mới `reasons` tách riêng:** thêm loại bản tin và thêm việc ghép theo sequence.

## R21. Studio: lưới ảo hóa và nhận chữ từ bộ gõ (ADR-016)

- **Quyết định:**
  - **Tự viết lưới ảo hóa trên Lit** (`apps/studio/src/ui/grid/mat-grid.ts`), không thêm thư viện:
    - dòng cao cố định (24 px gọn, 28 px thoáng): chỉ vẽ các dòng trong khung nhìn cộng 10 dòng đệm mỗi phía; không ảo hóa cột (≤ khoảng 25 cột);
    - ARIA `role="grid"`, `aria-rowcount`, `aria-rowindex`; tiêu đề và cột tên dính khi cuộn;
    - logic là TS thuần (mở rộng `grid-model.ts` của 004): chọn ô, chọn vùng, sửa, điền xuống, kéo điền, dán, nhập/xuất CSV, thêm hàng loạt, hoàn tác theo lô. Dùng chung cho Bảng Tag, Bảng giá trị, Bảng theo dõi, xem trước nhập CSV và thêm hàng loạt.
  - **Nhận chữ từ bộ gõ: một `<textarea>` duy nhất luôn giữ focus khi lưới được focus.**
    - Ô nhập nằm đúng trên ô đang chọn. Ở chế độ di chuyển, ô nhập rỗng, trong suốt (`caret-color: transparent`). Bộ gõ (TSF) luôn có một phần tử nhập liệu để ghép chữ, và cửa sổ gợi ý của bộ gõ hiện đúng chỗ.
    - **`compositionstart`**, hoặc **`beforeinput`/`input`** có chữ, khi đang ở chế độ di chuyển: chuyển sang chế độ sửa **ngay trên chính phần tử đó**: hiện ô nhập, bắt đầu sửa với nội dung trống. Không dời focus, không gán lại `value`, nên ký tự đầu không mất và không lặp. Đây là điểm sửa hạn chế Telex/TSF của 004: phím đầu của Telex tới dưới dạng `key = "Process"`, keyCode 229, mà khi đó focus đang ở bảng (không nhập liệu được).
    - **Unikey** gửi phím thật (Backspace rồi ký tự có dấu): ký tự đầu đã vào ô nhập, nên Backspace của Unikey xóa đúng trong ô.
    - **Đang ghép chữ** (`isComposing`, hoặc giữa `compositionstart` và `compositionend`): Enter, Tab, mũi tên thuộc về bộ gõ, lưới bỏ qua. **Esc khi đang ghép:** ghi nhận "hủy"; sau `compositionend` thì hủy sửa, trả nội dung cũ (Edge case của spec).
    - **Phím của lưới ở chế độ di chuyển** (mũi tên, Tab, Enter, F2, Delete, Ctrl+D, Ctrl+Z/Y, Shift+mũi tên, Ctrl+A) xử lý ở `keydown` và `preventDefault`. Phím `Process` không bao giờ bị chặn.
    - **Sao chép, cắt, dán:** sự kiện `copy`, `cut`, `paste` của chính ô nhập (`clipboardData` dạng TSV), không cần quyền clipboard.
    - **ARIA:** ô nhập có `aria-activedescendant` trỏ tới ô đang chọn (thuộc tính này hợp lệ với `textbox` theo ARIA 1.2) và `aria-label` "<cột>, dòng <n>: <giá trị>".
  - **Ô danh sách chọn** (kiểu, thiết bị trường, nhóm quét, bảng giá trị): gõ chữ mở danh sách có lọc ngay trong cùng ô nhập (combobox), cũng qua bộ gõ.
  - **Kiểm project trong Web Worker** (`validate.worker.ts`, worker module do Vite đóng gói, `worker-src 'self'`): chống trễ khi gõ với 2.000 Tag và 500 biểu thức. Kết quả cũ bị bỏ theo số thế hệ. Mục tiêu: lỗi hiện ≤ 1 s sau một lần sửa (SC-012).
  - **Đo SC-012** (Chrome headless, e2e như 004): mở 2.000 dòng ≤ 1 s; mỗi bước di chuyển hay cuộn ≤ 50 ms; mỗi phím ≤ 100 ms; dán 2.000 × 10 kể cả kiểm tra ≤ 5 s. Kiểm lại tay trên WebView2.
  - **Thử bộ gõ** (SC-013), trên Windows 11 với Telex có sẵn (TSF) và Unikey (chế độ Telex), ở Bảng Tag, Bảng giá trị, Bảng theo dõi và ô biểu thức:
    - 20 lần mỗi lưới: chọn ô rồi gõ thẳng "Mức nước bồn 1";
    - thêm các ca Esc giữa lúc ghép, Enter giữa lúc ghép, gõ ở ô danh sách chọn;
    - ghi kết quả vào `docs/reports/006-acceptance.md`.

    Cần người gõ trên Windows: phiên chính hoặc người dùng. Trước khi làm lưới thật, làm một bản thử (spike) HTML trong mockup để thử Telex sớm (plan, mục "Thứ tự làm").
- **Lý do:**
  - Vấn đề bộ gõ nằm ở việc *phần tử nào giữ focus khi phím đầu tới*, không ở việc vẽ lưới. Thư viện lưới phổ biến hoặc không xử lý, hoặc xử lý bằng tùy chọn riêng (Handsontable có `imeFastEdit` chính vì vấn đề này).
  - Dòng cao cố định thì tính dòng nào cần vẽ chỉ là vài phép chia; không cần thư viện ảo hóa.
  - Giữ logic ở `grid-model.ts`: test của 004 vẫn dùng được, và ADR-009 đã chừa sẵn chỗ thay phần hiển thị ở GĐ 2.
- **Phương án khác đã xét** (tra ngày 2026-10-11; bản ≥ 2 tuần tuổi; kích thước là gói npm giải nén, chỉ để so):

  | Thư viện | Bản, license | Loại vì |
  |---|---|---|
  | Handsontable | 18.1.1 (2026-09-15), license riêng: chỉ miễn phí cho mục đích phi thương mại | **license không phù hợp** |
  | AG Grid Community | 36.2.0 (2026-09-16), MIT, khoảng 21 MB | chọn vùng và dán từ clipboard thuộc bản Enterprise (license thương mại); nặng |
  | RevoGrid | 4.28.1 (2026-09-22), MIT, khoảng 7 MB | mang runtime Stencil; chưa rõ hành vi phím đầu với bộ gõ; khó gắn vào `grid-model` và theme của 004 |
  | Tabulator | 6.5.3 (2026-09-15), MIT, khoảng 28 MB | mô hình DOM riêng; trợ năng và bộ gõ chưa rõ |
  | @tanstack/virtual-core | 3.17.11 (2026-09-14), MIT | chỉ ảo hóa, không giúp phần bộ gõ; dòng cao cố định không cần |
  | @lit-labs/virtualizer | 2.1.1 (2025-07-11), BSD-3-Clause | thiết kế cho danh sách; lưới 2 chiều với cột dính phải tự làm thêm |

  **ADR-009 không sửa.** ADR-016 thay phần "lưới tự viết chưa ảo hóa" của ADR-009 (điều kiện xem xét lại "≥ 2.000 dòng" của ADR-009 đã tới).

## R22. Studio: editor mới, Mô phỏng, đổi tên Tag, dữ liệu sống

- **Quyết định:**
  - **Cây project** (FR-043): bỏ nhãn GĐ của Kết nối, Tag, Bảng giá trị, Bảng theo dõi, Chẩn đoán driver. Thêm, đổi tên, nhân bản, xóa có ở menu chuột phải, phím (Insert, F2, Ctrl+Shift+D, Delete) và bảng lệnh.
  - **Editor Kết nối** (FR-044): form chia nhóm theo loại kênh và thiết bị trường, theo studio-ux §5. Có panel Thử kết nối:
    - gọi `POST /api/v1/drivers/test` qua lệnh Rust `device_post`;
    - hiện thời gian, mã kết quả, giá trị thô hex;
    - bảng cách hiểu (INT16/UINT16 với 1 thanh ghi; INT32, UINT32, FLOAT32 ở 4 thứ tự với 2 thanh ghi; thêm 64 bit với 4 thanh ghi), tính bằng `@mat/tag-codec`;
    - danh sách cổng serial (`GET /api/v1/serial/ports`).
  - **Bảng Tag** (FR-045): trên `mat-grid`, bộ cột theo loại Tag, nhớ lựa chọn trong thiết lập của Studio. Cạnh ô địa chỉ hiện mã hàm, offset thật và số thanh ghi, tính bằng `@mat/tag-codec` (FR-015). Thêm hàng loạt có hộp thoại xem trước.
  - **CSV** (FR-045):
    - **đọc:** theo RFC 4180, có BOM, dấu phân cách `,` `;` hoặc tab, ô trong ngoặc kép có xuống dòng;
    - **dấu thập phân:** mặc định theo vùng của Windows (`Intl.NumberFormat`); ô mơ hồ (như `1,000` khi dấu thập phân là `,`) báo lỗi;
    - **xuất:** UTF-8 có BOM, dấu phân cách `;` khi dấu thập phân là `,`. Ô chữ bắt đầu bằng `= + - @`, tab, CR được thêm `'` phía trước (như `--export-history` của 003); khi nhập thì bỏ đúng một `'` ở những ô đó, nên xuất rồi nhập lại không đổi gì (SC-012).
  - **Editor Tag tính toán** (FR-049): ô biểu thức là `textarea` phủ lên một lớp `pre` tô màu (vẫn nhập liệu gốc, nên dùng được với bộ gõ). Gợi ý tên Tag, hàm, bảng giá trị; kiểm sau 200 ms ngừng gõ. Xem trước kết quả với giá trị mô phỏng hoặc giá trị sống, kèm giá trị từng đầu vào.
  - **Editor Bảng giá trị** (FR-048): `mat-grid` cho các mục (giá trị hoặc khoảng, chữ, màu với ô màu và bộ chọn màu `<input type="color">`), dòng mục mặc định, ô thử (gõ một giá trị, thấy chữ và màu theo `lookup` của `@mat/expression`), lỗi theo ô (`E_VT_OVERLAP`, `E_VT_RANGE`, `E_VT_TEXT`, màu sai).
  - **"Dùng ở đâu"** (FR-047, FR-048): `model/xref.ts` của 004 mở rộng thêm tham chiếu trong biểu thức (theo token), bảng theo dõi, binding `valueTable` và `valueTable` của Tag. Inspector của Tag tính toán liệt kê các Tag đầu vào.
  - **Lệnh và trợ năng** (FR-053): mọi lệnh mới có trong menu, bảng lệnh (Ctrl+Shift+P) và phím tắt; theme, màu trạng thái, ARIA theo 004; bảng đối chiếu quy tắc lưới và form của studio-ux §5 nằm trong báo cáo nghiệm thu (SC-018).
  - **Bảng theo dõi** (FR-050): lưới có cột giá trị ghi. Lệnh Ghi (menu, bảng lệnh, Ctrl+Shift+Enter; Enter trong ô không ghi) mở hộp xác nhận theo định nghĩa Tag trên BL335 (R20), có dòng cảnh báo khi khác project trên máy. Sau đó:
    - `device_post /api/v1/tags/write`;
    - dòng hiện `ACCEPTED`, rồi hỏi mỗi 200 ms tới kết quả cuối;
    - mất mạng: tiếp tục hỏi theo mã khi có mạng lại, không gửi lại (US2-10);
    - phiên hết hạn: hỏi đăng nhập lại; lệnh không tự gửi lại (US2-11).
  - **Chẩn đoán driver** (FR-051): hỏi `GET /api/v1/drivers/diagnostics` mỗi 2 s; Studio giữ bản đầu khi mở trang để hiện "tăng thêm từ lúc mở". Nhấp đúp Tag xấu thì mở Bảng Tag và chọn Tag đó (cơ chế `takeReveal` của 004).
  - **Chế độ Mô phỏng** (FR-052, D30): `model/sim-engine.ts` thay `sim-source.ts` của 004:
    - mỗi 250 ms: bộ sinh (`@mat/tag-sim`), rồi Tag tính toán (`@mat/expression`, cùng thứ tự tô-pô như runtime), phát `TagUpdate` cho Bảng Tag, Bảng theo dõi, xem trước màn hình và xem trước biểu thức;
    - ghi tay từ Bảng theo dõi áp ngay, nhãn "mô phỏng", không đăng nhập, không audit;
    - Online và Mô phỏng loại trừ nhau; dấu "MÔ PHỎNG" dùng màu riêng (tím), khác viền cam của Online;
    - không mở kết nối mạng nào (SC-017).
  - **Đổi tên Tag** (FR-047, D32): hàm thuần `renameTag(project, from, to)` trong `packages/project-schema`:
    - tìm tham chiếu trong biểu thức (đổi theo token của parser, giữ nguyên định dạng), bảng theo dõi, nhóm lưu trữ, binding;
    - trả danh sách chỗ sẽ đổi để Studio hiện; xác nhận thì áp mọi file trong **một** bước hoàn tác.

    Mô hình tài liệu của 004 mở rộng thêm các file mới (`connections.json`, bảng giá trị, bảng theo dõi) và sửa theo đối tượng.
  - **Đăng ký dữ liệu sống** (`model/live-subscriptions.ts`): hợp các Tag cần (dòng đang hiện của Bảng Tag, mọi dòng của Bảng theo dõi đang mở, Tag của xem trước màn hình), đăng ký lại sau 300 ms yên lặng.
    - Vượt 1.000 Tag (giới hạn một `subscribe`) thì ưu tiên Bảng theo dõi, rồi xem trước, rồi Bảng Tag.
    - Bảng Tag 2.000 dòng chỉ nhận giá trị cho các dòng đang hiện (Edge case).
  - **Lệnh Rust mới hoặc mở rộng** (contract [tauri-commands-006.md](contracts/tauri-commands-006.md)):
    - `device_post` (danh sách đường dẫn cho phép);
    - `device_get` thêm đường dẫn;
    - `live_open` gửi phiên;
    - `project_backup`;
    - `project_write` tạo thư mục con thiếu (`value-tables/`, `watch-tables/`) trong thư mục project;
    - `project_remove` xóa file bảng đã bỏ, có kiểm hash.
  - **Mockup:** trước khi code giao diện, cập nhật `docs/architecture/mockups/studio-tags.html` (bản mới, theo kiểu `studio-shell.html`) với: Bảng Tag 2.000 dòng có cột sống, Kết nối và Thử kết nối, Bảng giá trị, Tag tính toán, Bảng theo dõi kèm hộp xác nhận, Chẩn đoán driver, Mô phỏng, hộp thoại nâng cấp 0.1. Mockup này cũng là bản thử bộ gõ (R21). Phiên làm việc tự duyệt (người dùng giao toàn quyền).
- **Lý do:** studio-ux §5 và §9; Constitution II (logic dùng chung nằm trong `packages/*`, Studio chỉ hiển thị); giữ cách làm của 004 và 005.
- **Phương án khác đã xét:**
  - **Ô biểu thức bằng `contenteditable` tô màu trực tiếp:** dễ lỗi với bộ gõ và với việc hoàn tác của trình duyệt.
  - **Editor code đầy đủ** (CodeMirror, Monaco): nặng; Monaco cần worker và CSP rộng hơn.
  - **Mô phỏng chạy trong Web Worker:** 2.000 Tag mỗi 250 ms là việc nhẹ; worker thêm việc truyền dữ liệu qua lại.

## R23. Ngân sách BL335 (Constitution III)

- **Ước tính** (đo ở task ⚠️🔌, tải của SC-003 và SC-004):

  | Phần mới | RSS | CPU |
  |---|---|---|
  | Định nghĩa Tag v1 (2.000 Tag), bytecode 500 biểu thức, kế hoạch đọc | khoảng 1–2 MB | 0 khi rảnh |
  | 16 luồng kênh (stack 256 KiB, chạm vài chục KiB), bộ đệm khung | < 1 MB | |
  | Modbus TCP 500 Tag/1 s (khoảng 8 yêu cầu/s sau khi gộp) | | < 0,5 điểm |
  | Engine: 500 cập nhật/s + 200 Tag tính toán (2–5 đầu vào) | | < 0,5 điểm |
  | Live: thêm khoảng 40 % delta cho 10 client vì Tag tính toán | vài trăm KB hàng đợi | +2–3 điểm |
  | Luồng audit và luồng lưu Tag giữ qua mất điện | < 0,2 MB | `fdatasync` theo tần suất ghi |

  **Tổng:** RSS khoảng 16–20 MB (ngân sách 150 MB); CPU hệ thống khoảng 15–18 % (ngân sách 30 %), tính từ mốc 11,7 % của 003.
- **Ghi eMMC:** R15, R16. Tải chuẩn không ghi Tag: 0. Ghi liên tục ở mức trần 20 lệnh/phút: khoảng 0,77 GB/ngày (SC-011 ≤ 1 GB). Cộng lưu trữ của 003 (khoảng 0,8 GB/ngày ở cấu hình nặng) và audit đăng nhập của 005 (≤ 0,15 GB/ngày khi bị tấn công) thì tổng có thể sát 2 GB/ngày ở trường hợp xấu nhất mọi thứ cùng lúc. Báo cáo nghiệm thu ghi rõ.
- **Kế hoạch đo** (task ⚠️🔌, dùng `tools/measure/sample.sh` qua `ssh … sh -s`, không ghi file trên thiết bị):
  1. rảnh 10 phút với 0.4.0 rồi 0.5.0, cùng project `tank-demo`;
  2. SC-003: 500 Tag Modbus TCP từ giả lập trên máy Windows trong LAN, 10 client, 30 phút;
  3. SC-004: thêm 200 Tag tính toán và 100 Tag nội bộ;
  4. SC-011: ghi liên tục ở mức trần 1 giờ, đếm byte ghi bằng `/sys/block/mmcblk0/stat`, quy ra ngày; chốt mặc định tần suất theo công thức R15;
  5. SC-002: 30 phút RTU với thiết bị RS485 thật (cần người ở cạnh thiết bị).

  Kết quả ghi `docs/reports/006-acceptance.md`. Vượt ngân sách thì cần ADR (Constitution III).

## R24. Mô hình mối đe dọa (STRIDE)

Phạm vi: ghi Tag, Thử kết nối, danh sách cổng serial, driver, biểu thức, lọc nguồn. Phần của 005 (đăng nhập, gói, nạp xuống) giữ nguyên.

| Thành phần | Mối đe dọa | Giảm thiểu | Rủi ro còn lại |
|---|---|---|---|
| Ghi Tag | **S/E:** ghi không có quyền | HTTPS + phiên + role operator + audit trước khi gửi (Constitution V); một bảng quyền | Tài khoản operator bị lộ |
| | **T:** sửa giá trị trên đường truyền | TLS có ghim (005) | |
| | **R:** chối đã ghi | Audit FULL lúc nhận và lúc có kết quả, kèm IP, tài khoản, giá trị cũ, giá trị mới | Người có root sửa được audit |
| | **D:** ngập lệnh ghi, mòn eMMC, nghẽn bus | Token bucket theo phiên và toàn BL335; hàng đợi có trần; từ chối thì gộp audit | Operator hợp lệ vẫn ghi được ở mức trần |
| | **E:** ghi qua HTTP, qua live, từ trang xem | Không có đường; đều bị từ chối và có audit (SC-006) | |
| | **T:** chạy lặp một lệnh (gửi lại) | Mã yêu cầu lưu bền cùng audit; không tự gửi lại | |
| | Tác động vật lý | Giới hạn nhập, Tag R mặc định, hộp xác nhận, đọc lại; interlock ở PLC (Constitution V) | Giá trị hợp lệ nhưng sai về công nghệ |
| Thử kết nối | **E/I:** dùng BL335 dò mạng nhà máy (kết nối tới host:cổng tùy ý) | Chỉ engineer; một lần một lúc; ≤ 10/phút; audit; chỉ gửi một yêu cầu đọc Modbus, không gửi byte tùy ý | Engineer dò được các cổng TCP mở |
| Cổng serial | **E:** project mở file hay thiết bị khác | Tên cổng theo mẫu cố định; danh sách cho phép do root sửa; `DevicePolicy=closed` | |
| | **D:** chiếm cổng của hệ điều hành hay modem | Không mở console, getty; `ttyUSB*` không có trong danh sách mặc định; `TIOCEXCL` chỉ sau khi mở được | Chương trình không tạo file khóa |
| Driver | **T/D:** PLC hay kẻ giả mạo gửi khung độc | Kiểm chặt từng phản hồi; trần độ dài; fuzz ≥ 1 giờ với ASan/UBSan | |
| | **S:** máy khác trong mạng PLC giả làm PLC | Ngoài phạm vi: Modbus không có xác thực. Khuyến nghị tách mạng PLC (BL335 có hai cổng Ethernet) | |
| Biểu thức | **E:** chèn mã | Không `eval`; ngữ pháp đóng, không có hàm tùy ý (Constitution V) | |
| | **D:** biểu thức nặng | Giới hạn độ dài, mức lồng, số đầu vào, độ sâu phụ thuộc; không có vòng lặp | |
| Trang xem | **I:** lộ dữ liệu PLC ra Internet | Mặc định chỉ mạng riêng (FR-055a); cảnh báo khi `any` | Router có SNAT; người dùng đặt `any` |
| Kênh live kèm phiên | **I:** lộ token | Chỉ gửi qua `wss` có ghim; token qua HTTP thì 403; header đánh dấu nhạy cảm | |

## R25. Thư viện và công cụ: phiên bản, license

Chỉ đề xuất. Plan không sửa `package.json`, `Cargo.toml`, `CMakeLists.txt` hay `third_party/`.

- **Runtime:** không thêm thư viện. Modbus, biểu thức, bộ sinh, lưu Tag giữ qua mất điện đều tự viết (D3, D4). Đổi một cờ build của SQLite đã vendored: `HAVE_FDATASYNC=1` (R15).
- **Studio, TS:** không thêm phụ thuộc. Lưới, ô biểu thức, CSV tự viết.
- **Studio, Rust:** không thêm crate; `tokio-tungstenite` (đã có) dùng thêm `IntoClientRequest` để gắn header.
- **Package mới trong repo** (workspace, không xuất bản): `@mat/expression`, `@mat/tag-codec`, `@mat/tag-sim`.
- **Công cụ test:** `tools/modbus-sim` (Node, không phụ thuộc); image `node:24-slim` (MIT) cho kịch bản Docker, ghim digest.
- **Đã xét, không dùng:**

  | Thành phần | Bản (ngày) | License | Vì sao không dùng |
  |---|---|---|---|
  | libmodbus | | LGPL-2.1 | D3 |
  | pymodbus | 3.15.0 (2026-08-13) | BSD-3-Clause | R12 |
  | jsmodbus / modbus-serial | 5.0.0 / 8.0.25 | MIT / ISC | R12 |
  | jsep | 1.4.0 (2024-11-05) | MIT | R17 |
  | Handsontable | 18.1.1 | riêng (phi thương mại) | R21 |
  | AG Grid Community | 36.2.0 | MIT | R21 |
  | RevoGrid, Tabulator | 4.28.1, 6.5.3 | MIT | R21 |

Không có thành phần GPL hay LGPL nào được thêm.
