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

Phê duyệt chính thức của Tech Lead được ghi cùng quyết định Go/No-Go (tasks T034). Trạng thái ở trên là trạng thái của bản nháp ADR.
