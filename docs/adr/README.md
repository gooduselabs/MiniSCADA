# Architecture Decision Records (ADR)

Quyết định kiến trúc của mAT SCADA (Constitution, mục "Quy trình phát triển", điểm 4). Mỗi ADR gồm: Trạng thái, Ngày, Bối cảnh, Các phương án, Quyết định, Hệ quả, Số đo/bằng chứng, Điều kiện xem xét lại. Số đo lấy từ [../reports/](../reports/).

| ADR | Quyết định | Trạng thái |
|---|---|---|
| [001](001-web-server.md) | CivetWeb là máy chủ web mặc định; đã so sánh với Drogon trên BL335 | Accepted (CivetWeb mặc định) |
| [002](002-commercial-os.md) | OS bản thương mại: Buildroot hay Ubuntu 20.04 có vá | **Proposed** (thiếu dữ kiện BSP/spike) |
| [003](003-element-uid.md) | `elementUid` bất biến, tách khỏi `id` SVG | Accepted (nguyên tắc); Proposed (thuật toán import lại) |
| [004](004-schema-versioning.md) | SemVer cho schema, migration ở Studio, validator hai phía | Accepted (nguyên tắc); Proposed (quy tắc tương thích chi tiết) |
| [005](005-resource-budget.md) | Xác nhận ngân sách tài nguyên bằng số đo | Accepted một phần (nhiều chỉ số chưa đo) |
| [006](006-live-protocol-v1.md) | Giao thức live 1.0.0, hàng đợi 256 KB/phiên, kiểm Origin, 4429 tự thử lại sau 30 s | Accepted (Sprint 1) |
| [007](007-screen-isolation.md) | Mỗi màn hình SVG trong Shadow DOM riêng | Accepted (Sprint 1) |
| [008](008-data-logging.md) | Lưu trữ Tag bằng SQLite trên thiết bị; chuyển tiếp chính xác một lần qua `mat_forward_state`; client DB nạp động; bí mật trên thiết bị; ước tính ghi chỉ cảnh báo | Accepted (feature 003; đã đo trên BL335 ngày 2026-10-11, còn cắt điện thật) |
| [009](009-studio-ui-stack.md) | Studio dùng Lit; bố cục tự dựng, chưa dùng docking; lưới tự viết chưa ảo hóa; icon Fluent; thanh tiêu đề gốc của Windows | **Accepted** (feature 004, 2026-10-11) |
| [010](010-device-discovery-https.md) | Tìm thiết bị bằng UDP broadcast trong subnet (cổng 8446, chống khuếch đại); HTTPS bằng Mbed TLS 3.6 trên context riêng 8443; chứng chỉ tự sinh; Studio kết nối qua Rust, ghim SHA-256 | **Accepted** (feature 005, 2026-10-12; số đo BL335 chờ SSH) |
| [011](011-auth-roles-audit.md) | Argon2id; tài khoản trong `users.json` do lệnh root quản lý; token bearer; khóa tạm theo tài khoản và IP; 4 role; audit SQLite riêng `synchronous=FULL` (ngoại lệ đã chấp thuận) | **Accepted** (feature 005, 2026-10-12; số đo BL335 chờ SSH) |
| [012](012-project-package-deploy.md) | Gói `.matscada` (ZIP tập con, digest theo nội dung); kho project tách khỏi runtime; kích hoạt bằng `state.json` + `execv`, tự rollback; giao thức live 1.1.0 | **Accepted** (feature 005, 2026-10-12; số đo BL335 chờ SSH) |
| [014](014-driver-sdk-modbus.md) | Driver SDK (kênh → thiết bị trường → Tag, một luồng mỗi kênh, gộp tham lam, tách khi exception 02/03); Modbus TCP/RTU tự viết; giả lập Node và pty trong CI; cổng serial qua `DevicePolicy=closed` | **Proposed** (feature 006) |
| [015](015-expression-language.md) | Ngôn ngữ biểu thức kiểu C, không script; số thực 64 bit không FMA, `round` nửa ra xa 0; bytecode hai bản TS/C++; bảng giá trị cấm chồng; bộ sinh mô phỏng tất định (sin tự viết, băm theo bộ đếm); vector chung | **Proposed** (feature 006) |
| [016](016-studio-grid-ime.md) | Lưới ảo hóa tự viết trên Lit; một `textarea` luôn giữ focus để nhận chữ từ bộ gõ (Telex TSF, Unikey); thay phần lưới của ADR-009 | **Proposed** (feature 006) |
| [017](017-tag-engine-v1.md) | Tag Engine v1 trên vòng tick (cùng delta, một lần khóa); định dạng project 0.2.0; ghi Tag qua HTTPS có audit FULL và mã yêu cầu bền; SQLite `HAVE_FDATASYNC`; Tag giữ qua mất điện ghi tại chỗ | **Proposed** (feature 006) |
| [018](018-viewer-source-filter.md) | Phần không cần đăng nhập mặc định chỉ phục vụ mạng riêng (`viewerAccess`); kênh live của Studio mang phiên, mã đóng 4401 | **Proposed** (feature 006) |

Phê duyệt chính thức của Tech Lead được ghi cùng quyết định Go/No-Go (tasks T034). Trạng thái ở trên là trạng thái của bản nháp ADR.
