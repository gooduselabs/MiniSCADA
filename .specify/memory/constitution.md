<!--
Sync Impact Report (2026-10-11, lần 2)
- Version: 2.0.0 → 2.0.1 (PATCH). Thêm một ngoại lệ có giới hạn vào quy tắc SQLite đã có; không đổi,
  thêm hay bỏ nguyên tắc nào, không đổi phạm vi. Cùng loại với 1.1.0 → 1.1.1 (ngoại lệ thứ nhất).
- Lý do: câu hỏi 1 của plan feature 005 (specs/005-device-online/plan.md, ADR-011). Ngày 2026-10-11
  người dùng duyệt giao diện Studio và giao toàn quyền quyết định cho phiên làm việc ("tôi giao bạn
  toàn quyền quyết định"); phiên làm việc chấp thuận ngoại lệ `synchronous=FULL` cho `audit.db`.
- Mục sửa: "Ràng buộc công nghệ", gạch "DB: SQLite WAL": "ngoại lệ duy nhất" thành danh sách hai
  ngoại lệ (mốc gửi historian giữ nguyên; thêm audit), câu dẫn ADR thêm ADR-011.
- Mục thêm/bỏ: không.
- Tài liệu phụ thuộc:
  ⚠ docs/adr/011-auth-roles-audit.md: mục ngoại lệ Constitution → "đã chấp thuận, Constitution 2.0.1".
  ⚠ specs/005-device-online/plan.md: Constitution Check (Ràng buộc công nghệ ✅), Complexity Tracking,
     câu hỏi 1 → đã trả lời.
  ⚠ specs/005-device-online/tasks.md: T012 ghi câu trả lời; T025 được bật `synchronous=FULL`.
  ✅ specs/002, specs/003, specs/004: không phụ thuộc ngoại lệ mới.
  ✅ .specify/templates/*: không phụ thuộc nội dung quy tắc SQLite.
- TODO: không.
-->
<!--
Sync Impact Report (2026-10-11)
- Version: 1.1.1 → 2.0.0 (MAJOR). Nguyên tắc VII được định nghĩa lại: bỏ giới hạn MVP "không
  alarm/trend, không driver ngoài Mock/Modbus"; phạm vi theo lộ trình v2. Đây là thay đổi không
  tương thích ngược về phạm vi, nên là MAJOR.
- Lý do: người dùng duyệt lộ trình v2 (docs/plans/roadmap-v2.md), Phương án B "SCADA trước, trình
  vẽ sau", ngày 2026-10-11 ("làm v2 đi chứ").
- Nguyên tắc sửa:
  - VII "Đơn giản và có phiên bản" (giữ tên): phạm vi theo giai đoạn GĐ 0–6; alarm, lưu trữ và
    biểu đồ lịch sử, báo cáo, widget, ghi Tag, driver ngoài Modbus vào phạm vi theo thứ tự giai
    đoạn; trình vẽ SVG tự do dời về GĐ 6; điều kiện phát hành driver. Giữ nguyên SemVer + migration,
    deploy atomic và các điều kiện lưu trữ dữ liệu Tag (2026-10-10).
  - V "An toàn và bảo mật mặc định": thêm điều về HTTPS, đăng nhập, role, audit trước khi bật API
    nạp xuống và ghi Tag; gói tìm thiết bị không chứa bí mật.
- Mục sửa: dòng "Nguồn gốc" (lộ trình v2 thay Master Plan §0, §12.2, §13, §15); "Quy trình phát
  triển" bước 2 (giai đoạn của lộ trình v2 thay Sprint của Master Plan).
- Mục thêm/bỏ: không.
- Tài liệu phụ thuộc:
  ✅ mAT_SCADA_Master_Plan.md: đầu tài liệu và §0, §12.2, §13, §15 có ghi chú "thay bởi lộ trình v2".
  ✅ CLAUDE.md: thêm lộ trình v2 cạnh dòng "Kế hoạch tổng thể".
  ✅ docs/plans/roadmap-v2.md: đã cập nhật trạng thái và mục 7.
  ✅ specs/002-vertical-slice, specs/003-data-logging: giữ nguyên vì là lịch sử; Constitution Check
     của chúng theo version lúc làm.
  ✅ .specify/templates/*: không phụ thuộc nội dung nguyên tắc V, VII.
- TODO: không.
- Sửa đổi trước, cũng chưa commit: 1.1.0 → 1.1.1 (2026-10-10, PATCH), ngoại lệ `synchronous=FULL`
  cho giao dịch xóa mốc gửi (`mat_forward_mark`); tài liệu phụ thuộc của lần đó đã cập nhật.
-->

# mAT SCADA Constitution

Nguồn gốc: rút ra từ `mAT_SCADA_Master_Plan.md` (10/10/2026). Lộ trình v2 (`docs/plans/roadmap-v2.md`, người dùng duyệt ngày 2026-10-11) thay các mục §0, §12.2, §13, §15 của Master Plan. Khi xung đột, Constitution này thắng; thay đổi phải qua mục Governance.

## Core Principles

### I. Vertical slice trên thiết bị thật trước
Runtime phải chạy trên BL335 (Allwinner T113-i, armhf, 1 GB RAM) và Chrome ngay từ Sprint 1 với JSON viết tay. Editor Studio được xây sau để sinh đúng định dạng runtime đã chạy ổn định. Mỗi tính năng phải được xác nhận trên thiết bị thật, không chỉ trên x64.

### II. Ranh giới kiến trúc (BẮT BUỘC)
- Browser không truy cập PLC trực tiếp; mọi Tag đi qua Tag Engine.
- Studio và Runtime dùng chung schema, expression, animation semantic (package `packages/*`). `apps/studio` không chứa logic runtime riêng; `apps/runtime-web` chỉ hiển thị, tương tác và gọi API.
- Render SVG/animation chạy trên Chrome của client, không chạy trên BL335. BL335 không cài môi trường đồ họa.
- `core/` không include code UI, không parse SVG để render. Driver chỉ phát `TagUpdate`/`WriteResult`, không ghi DB tùy ý.
- Expression engine có hai bản (TS, C++) dùng chung bộ test vector JSON.

### III. Ngân sách tài nguyên là ràng buộc cứng
RAM OS idle ≤ 200 MB; `mat-runtime` ≤ 150 MB RSS (`MemoryMax=300M`); SQLite cache ≤ 32 MB; tmpfs ≤ 64 MB. CPU: 500 Tag/1 s/10 client trung bình ≤ 30%. Ghi eMMC ≤ 2 GB/ngày. Thay đổi làm vượt ngân sách phải có số đo và ADR.

### IV. Giới hạn Chrome và 10 client
Chỉ hỗ trợ Chrome/Chromium ≥ 120. Tối đa 10 phiên WebSocket đồng thời (giới hạn cứng, client 11 nhận `MAX_CLIENTS_REACHED`, close code 4429). `maxClients` của project không được vượt giới hạn runtime.

### V. An toàn và bảo mật mặc định (NON-NEGOTIABLE)
- Không `eval`/`new Function`; không script tùy ý trong project.
- SVG import dùng allowlist trên DOM đã parse (không regex); có giới hạn kích thước/node/độ sâu.
- Mọi lệnh ghi Tag: backend kiểm role/quyền/trạng thái và ghi audit. Web SCADA không phải lớp an toàn; interlock ở PLC.
- API nạp xuống project qua mạng và API ghi Tag chỉ được bật khi đã có HTTPS, đăng nhập, phân quyền theo role và audit. Gói trả lời tìm thiết bị trong LAN không chứa bí mật.
- Package: chống ZIP bomb, path traversal, checksum, schema validation; không chứa secret plaintext.
- Validator chạy ở cả Studio và Runtime; Runtime không kích hoạt project nếu validation thất bại.

### VI. Test-First và kiểm chứng
Logic (sanitizer, binding, expression, session manager, schema) viết test trước (Vitest/GoogleTest). Có test tích hợp cho WebSocket, giới hạn client, deploy/rollback. Báo cáo kết quả trung thực: test fail hoặc bước bị bỏ qua phải được nêu rõ.

### VII. Đơn giản và có phiên bản
Phạm vi sản phẩm theo lộ trình v2 (`docs/plans/roadmap-v2.md`, Phương án B, người dùng duyệt ngày 2026-10-11). Sản phẩm làm theo giai đoạn GĐ 0–6; mỗi giai đoạn giao một lát dùng được đầu-cuối: thiết bị, Studio và web.
- YAGNI: chỉ làm tính năng của giai đoạn đang làm. Kéo tính năng của giai đoạn sau lên trước cần quyết định của người dùng và phải ghi vào lộ trình (như feature 003).
- Alarm, lưu trữ và biểu đồ lịch sử, báo cáo, widget, ghi Tag và driver ngoài Modbus nằm trong phạm vi, theo thứ tự giai đoạn.
- Trình vẽ SVG tự do dời về GĐ 6. Trước đó người dùng vẽ bằng công cụ ngoài, rồi import và gắn Tag trong Studio.
- Driver mới chỉ được phát hành khi có số đo RAM/CPU trên BL335, có giả lập chạy trong CI và đã rà soát license.
- Schema theo SemVer, có migration. Deploy atomic: stage → validate → backup → activate → health check → rollback.

Lưu trữ dữ liệu Tag nằm trong phạm vi (quyết định của người dùng ngày 2026-10-10), với các điều kiện:
- Lưu theo nhóm Tag do người dùng cấu hình (theo chu kỳ hoặc theo thay đổi). Ngân sách ghi eMMC ở nguyên tắc III áp dụng cho cấu hình chuẩn; cấu hình của người dùng vượt ngân sách thì validator PHẢI cảnh báo kèm ước tính, KHÔNG chặn.
- SQLite trên thiết bị là nơi ghi đầu tiên và PHẢI có thời hạn lưu theo số ngày (tự xóa bản ghi cũ) cùng trần dung lượng bảo vệ thiết bị.
- Chuyển tiếp sang MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB là tùy chọn: bảng rộng (mỗi Tag một cột), thời gian theo giờ địa phương cấu hình được (mặc định UTC+7). DB ngoài lỗi hoặc mất kết nối KHÔNG được làm dừng runtime, KHÔNG được làm mất bản ghi đã nằm trong SQLite.
- Mật khẩu/token của DB ngoài lưu trên thiết bị, không nằm trong project (nguyên tắc V). Thư viện client có license LGPL chỉ được nạp động.

## Ràng buộc công nghệ

- Backend C++17, CMake + Ninja, cross-toolchain `arm-linux-gnueabihf`; web server CivetWeb (mặc định) hoặc Drogon theo benchmark.
- Studio: Tauri 2 + TypeScript + Vite (Windows 10/11). SVG gốc + SVG.js, interact.js. Test: Vitest, Playwright, GoogleTest.
- DB: SQLite WAL, `synchronous=NORMAL`. Log thường ghi tmpfs; chỉ lỗi nghiêm trọng và audit ghi eMMC.
  - Hai ngoại lệ chạy `synchronous=FULL`:
    1. **Mốc gửi của historian** (người dùng chấp thuận ngày 2026-10-10): giao dịch xóa mốc gửi (bảng `mat_forward_mark` trong `history.db`), mỗi đích và bảng một lần sau mỗi lần khởi động. Lý do: mất điện ngay sau khi xóa mốc mà WAL chưa đồng bộ thì mốc cũ quay lại sau khi dòng đã gửi vượt qua nó, và lần chạy sau gửi trùng sang DB ngoài. Lượng ghi thêm không đáng kể so với ngân sách eMMC (nguyên tắc III).
    2. **Audit** (chấp thuận ngày 2026-10-11, người dùng giao toàn quyền quyết định; feature 005, `docs/adr/011-auth-roles-audit.md`): mọi giao dịch ghi của `audit.db`. Lý do: dòng audit của thao tác bảo mật (đăng nhập, nạp xuống, khôi phục, tài khoản) phải còn sau khi mất điện ngay sau thao tác, và thao tác thay đổi chỉ chạy sau khi dòng audit của nó đã commit. Lượng ghi nhỏ: đăng nhập sai và truy cập bị từ chối gộp theo 60 s, tối đa 10 dòng/phút; khi bị tấn công liên tục ước tối đa khoảng 150 MB/ngày, nằm trong ngân sách eMMC 2 GB/ngày (nguyên tắc III). `audit.db` có trần 64 MiB và thời hạn 365 ngày.
  - Mọi giao dịch khác giữ `NORMAL`. Thêm ngoại lệ mới phải có lý do và ADR (xem `docs/adr/008-data-logging.md`, `docs/adr/011-auth-roles-audit.md`).
- Rà soát license mọi thư viện/driver (LGPL link động).
- Format: clang-format, ESLint, Prettier bắt buộc trong CI.

## Quy trình phát triển (Spec-Driven)

1. Quy trình Spec Kit: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`. Spec nằm trong `specs/<NNN-feature>/`.
2. Mỗi giai đoạn của lộ trình v2 tương ứng một hoặc vài feature spec; tiêu chí nghiệm thu của giai đoạn là acceptance criteria của các spec đó.
3. Thao tác trên thiết bị BL335 (SSH, xóa file, đổi service) chỉ thực hiện khi người dùng yêu cầu rõ; xem thông tin truy cập trong memory, **không ghi mật khẩu vào repo**.
4. Quyết định kiến trúc ghi vào `docs/adr/`.

## Governance

Constitution thay thế mọi thực hành khác. Sửa đổi cần ghi lý do, cập nhật version, và rà soát lại các spec/plan bị ảnh hưởng. Mọi plan phải qua "Constitution Check" trước khi implement; vi phạm phải được biện minh trong mục Complexity Tracking.

**Version**: 2.0.1 | **Ratified**: 2026-10-10 | **Last Amended**: 2026-10-11
