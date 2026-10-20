# Feature Specification: Báo cáo đẹp, trình thiết kế báo cáo trong Studio, báo cáo sự kiện alarm, vận hành thiết bị và logic

**Feature Branch**: `015-reports`

**Created**: 2026-10-20

**Status**: Draft (các quyết định tự chốt trong phiên, người dùng giao toàn quyền)

**Input**: Yêu cầu người dùng (2026-10-20), chọn cả ba: (1) **báo cáo đẹp hơn**; (2) **thiết kế báo cáo trong Studio**; (3) **báo cáo sự kiện logic/alarm**. Người dùng vừa duyệt phong cách dashboard của 014 (thẻ màu đặc, khung có tiêu đề) và chê giao diện báo cáo cũ (bảng trơn, form nhập liệu).

## Bối cảnh

Feature 010 có mẫu báo cáo ngày, ca, tháng (`reports.json`), trang `#/report/<id>` (bảng trơn), xuất CSV/XLSX/PDF trên trình duyệt (ADR-033); 012 làm PDF có dải tiêu đề, thẻ số liệu, biểu đồ ECharts SSR. Studio có editor mẫu dạng form và lưới cột. Chưa có: thẻ tổng hợp, biểu đồ trên trang web, kỳ tuần hoặc khoảng tùy chọn, báo cáo alarm, thời gian chạy và số lần bật của thiết bị, nhật ký ghi PLC của logic cho trang web.

Ràng buộc ([Constitution](../../.specify/memory/constitution.md) 2.0.2): báo cáo sinh **trên trình duyệt** (III, không tốn CPU BL335); một nơi tính cho Studio và Chrome (II, `packages/*`); hai bộ kiểm project (TS, C++) dùng chung vector; offline; test trước (VI); định dạng SemVer, project cũ mở nguyên trạng (VII); thực thi quyền ở máy chủ (013).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Xem báo cáo đẹp, cùng bố cục trên web, PDF, XLSX (Priority: P1)

Trưởng ca mở Báo cáo điện ngày: đầu trang là dải tiêu đề (tên đơn vị, tên báo cáo, kỳ), hàng **thẻ tổng hợp màu đặc** (giá trị tổng kỳ của các cột chính, độ đủ dữ liệu), **biểu đồ** trong khung có tiêu đề, rồi bảng có sọc với hàng tổng nổi bật. Xuất PDF ra cùng bố cục; XLSX có đầu bảng màu, số đúng định dạng, cố định hàng đầu, sọc và hàng tổng đậm.

**Independent Test**: e2e trang `#/report/dien-ngay` trên runtime giả: thấy thẻ, khung biểu đồ, bảng có `tr.total`; axe 0 lỗi critical/serious ở chủ đề sáng và tối; PDF trích chữ khớp ô; XLSX mở bằng `fflate` có `fill` đầu bảng và `pane` cố định.

**Acceptance Scenarios**:

1. **Given** mẫu có cột tổng (`delta`, `sum`), **When** xem, **Then** thẻ hiện giá trị dòng tổng của tối đa 4 cột đầu và thẻ "Dữ liệu đủ".
2. **Given** mẫu đặt `chart: "none"` hoặc `tiles: false`, **When** xem hay xuất, **Then** khối tương ứng không có ở web, PDF.
3. **Given** project có `theme`, **When** xem, xuất, **Then** màu theo chủ đề (PDF dark in như vivid).

### User Story 2 - Thiết kế báo cáo trong Studio kiểu IDE (Priority: P1)

Kỹ sư bấm Báo cáo → **Thêm báo cáo** → chọn mẫu sẵn (ca, ngày, tháng, năng lượng, alarm, vận hành thiết bị, logic) → editor mở với ba vùng: **Cấu trúc** (Thông tin chung, Kỳ, Thẻ tổng hợp, Biểu đồ, Cột, Chân trang), **Xem trước trực tiếp** ở giữa (cùng thành phần dựng của trang web, dữ liệu mô phỏng), **Thuộc tính** của phần đang chọn. Kéo Tag từ panel Tag vào vùng xem trước hay danh sách cột để thêm cột; chọn kiểu tổng hợp mỗi cột (trung bình, nhỏ nhất, lớn nhất, tổng, đầu, cuối, chênh lệch, đếm, thời gian ON cho BOOL), đơn vị, số lẻ; chọn kỳ (ca, ngày, tuần, tháng, khoảng tùy chọn); bật tắt thẻ và biểu đồ. Mỗi thay đổi là một bước hoàn tác (Ctrl+Z); lỗi hiện ở dock Lỗi và tại trường.

**Independent Test**: e2e Studio trên project 1.1: thêm báo cáo từ mẫu "Báo cáo ngày", kéo `METER1.KW` vào, đổi hàm, xem trước cập nhật; Ctrl+Z trả lại; đặt hàm `starts` cho mẫu bảng → dock Lỗi có `E_RPT_KIND`.

**Acceptance Scenarios**:

1. **Given** project 0.6/1.0, **When** mở editor, **Then** các tùy chọn mới (loại, tuần, khoảng, thẻ, biểu đồ, thời gian ON) bị khóa kèm lý do "cần định dạng 1.1"; phần cũ vẫn sửa được.
2. **Given** chọn một cột trong xem trước, **When** sửa nhãn, **Then** cấu trúc và thuộc tính đồng bộ, xem trước dựng lại ≤ 1 s trên dữ liệu mô phỏng.

### User Story 3 - Báo cáo alarm (Priority: P2)

Trưởng ca xem Báo cáo alarm theo ca hoặc ngày: thẻ (số lần xuất hiện, chưa xác nhận, thời gian trung bình tới xác nhận, đang còn), biểu đồ số lần theo mức ưu tiên, bảng thống kê theo mức, theo khu, **top 10 alarm xảy ra nhiều nhất**, danh sách sự kiện trong kỳ (xuất hiện, xác nhận, hết) và xuất CSV/XLSX/PDF.

**Independent Test**: Vitest `alarmReport` trên tập lần xảy ra cố định (số, trung bình, top 10, sự kiện sắp theo giờ); e2e trang với runtime giả có `alarms/history`.

### User Story 4 - Báo cáo vận hành thiết bị (Priority: P2)

Kỹ sư bảo trì xem thời gian chạy và số lần bật của bơm, quạt (Tag BOOL) theo giờ, ca hoặc ngày, có tổng kỳ, thẻ tổng giờ chạy và biểu đồ cột giờ chạy.

**Independent Test**: Vitest `equipmentReport` (giờ chạy từ tổng hợp, số lần bật từ dòng thô, hàng chưa tới, quá giới hạn dòng thô); e2e trang.

### User Story 5 - Báo cáo ghi PLC của logic (Priority: P3)

Kỹ sư xem các lần luật logic ghi PLC trong kỳ (giờ, luật, Tag, giá trị, kết quả), thống kê theo luật và theo kết quả.

**Independent Test**: gtest endpoint đọc nhật ký logic (quyền, lọc thời gian, phân trang); Vitest `logicReport`; e2e trang với runtime giả.

### Edge Cases

- Kỳ chưa tới hoặc đang chạy: hàng "chưa tới", không đóng góp tổng; thẻ dựa trên phần đã tới.
- Alarm quá nhiều: đọc tối đa 5.000 lần xảy ra; vượt thì ghi chú "chỉ hiện 5.000 lần đầu", thống kê trên phần đã đọc.
- Dòng thô quá nhiều cho số lần bật (nhóm lưu theo chu kỳ ngắn): đọc tối đa 10.000 dòng; vượt thì cột "Số lần bật" trống kèm ghi chú, giờ chạy vẫn đúng (từ tổng hợp).
- Runtime cũ không có endpoint nhật ký logic (404/501): báo "Thiết bị chưa hỗ trợ báo cáo logic".
- Người dùng không có quyền `page:alarms` (013): báo cáo alarm báo "không có quyền xem alarm" (máy chủ từ chối, 403).
- Khoảng tùy chọn: tối đa 31 ngày, từ ≤ đến; sai thì không gửi yêu cầu.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `reports.json` định dạng 1.1 (chỉ thêm, khóa tùy chọn; project 1.0 dùng khóa mới là lỗi `E_RPT_KIND`): `org` (tên đơn vị, ≤ 80); ở mẫu: `kind` (`table` mặc định, `alarm`, `equipment`, `logic`), `period` thêm `week` (thứ Hai–Chủ nhật, hàng theo ngày) và `range` (từ ngày–đến ngày ≤ 31 ngày, hàng theo ngày), `tiles` (bool, mặc định true), `chart` (`line`, `bar`, `none`; không đặt = tự chọn), hàm cột thêm `onTime` (giờ ON của BOOL, từ tổng hợp) và `starts` (số lần bật của BOOL, chỉ ở `equipment`). `group`, `columns` bắt buộc với `table`, `equipment`; cấm với `alarm`, `logic`. Hợp đồng: [plan.md](plan.md) mục Hợp đồng.
- **FR-002** Luật `E_RPT_KIND` ở cả `packages/project-schema` và `core/project-manager` trên vector chung `tests/project-vectors/v11-report-*`.
- **FR-003** Mọi phép tính báo cáo (bảng, alarm, thiết bị, logic) là hàm thuần trong `@mat/history-math`, cho ra một `ReportTable` mở rộng (thẻ, biểu đồ, bảng phụ) dùng chung cho web, Studio, CSV, XLSX, PDF.
- **FR-004** Thành phần dựng `<mat-report-view>` (ui-components) dùng chung cho trang báo cáo web và xem trước Studio: dải tiêu đề, thẻ màu đặc (bảng `--mat-tile-*`), khung biểu đồ có tiêu đề (ECharts lite nạp lười), bảng sọc, hàng tổng nổi bật, bảng phụ, chú thích dữ liệu.
- **FR-005** PDF, XLSX, CSV dựng từ cùng `ReportTable` mở rộng: PDF cùng bố cục (thẻ màu đặc, biểu đồ, bảng phụ); XLSX đầu bảng màu, sọc, hàng tổng đậm, cố định hàng đầu, bảng phụ dưới bảng chính; CSV có bảng phụ sau dòng trống.
- **FR-006** Trang `#/report/<id>`: chọn kỳ theo loại (ngày, ngày làm việc, tuần, tháng, khoảng), giữ trong đường dẫn (`?d=`, `?w=2026-W43`, `?m=`, `?from=&to=`).
- **FR-007** Studio: editor `report:<id>` ba vùng (Cấu trúc, Xem trước trực tiếp, Thuộc tính), kéo Tag, lệnh **Thêm báo cáo** từ 7 mẫu sẵn, hoàn tác qua sửa đổi `{ kind: 'reports' }` có sẵn, lỗi ở dock Lỗi.
- **FR-008** Báo cáo alarm đọc `GET /api/v1/alarms/history` (phân trang `beforeId`, ≤ 5.000 lần xảy ra); thống kê theo mức, khu, Tag nguồn (alarm), top 10, thời gian trung bình tới xác nhận.
- **FR-009** Báo cáo thiết bị: giờ chạy = tích phân BOOL của `aggregate` (như hàm `sum`), số lần bật = cạnh lên đếm trên `GET /api/v1/history/rows` (≤ 20 trang × 500 dòng).
- **FR-010** Endpoint mới `GET /api/v1/logic/events?from&to&before&limit` (runtime, C++): bản ghi audit `logic.write*` (giờ, luật từ `logic:<ruleId>`, Tag, kết quả, mã, giá trị trong `detail`), mới nhất trước, ≤ 200 mỗi trang; cookie của trang được phép, role viewer; với người dùng bị giới hạn (013) cần `page:reports` (403 `ACCESS_DENIED`). Không ghi audit `audit.read` (dữ liệu đã lọc, như các đọc khác của trang).
- **FR-011** Quyền (013): mẫu là tài nguyên `report:<id>`; mẫu `alarm`, `logic` không có Tag nên không mở thêm Tag nào cho `history(P)`.
- **FR-012** Tài liệu: `docs/user/engineer-guide.md` (thiết kế báo cáo), `operator-guide.md` (xem, xuất báo cáo mới); ảnh qua `tools/docs-screenshots.mjs`.

### Key Entities

- **ReportTable (mở rộng)**: như 010 cộng `kind`, `org`, `tiles[]` (nhãn, giá trị, đơn vị, màu), `chart` (kiểu, hạng mục, chuỗi), `sections[]` (tiêu đề, cột, hàng chữ), `notes[]`, cột chữ (`plain`).
- **Lần xảy ra alarm**: phần tử của `alarms/history` (tsActive, tsAck, tsReturn, priority, area, alarmId, text).
- **Sự kiện logic**: bản ghi audit `logic.write*`.

## Success Criteria *(mandatory)*

- **SC-001** Trang báo cáo, xem trước Studio, PDF và XLSX cho cùng số ở mọi ô (test chung trên `ReportTable`).
- **SC-002** axe 0 lỗi critical/serious trên trang báo cáo (sáng, tối) và editor Studio.
- **SC-003** Gói khởi động trang vận hành ≤ 244 KB gzip; PDF, XLSX, ECharts vẫn tải lười trong ngân sách ADR-033.
- **SC-004** TS và C++ cho cùng mã, đường dẫn trên mọi vector `v11-report-*`.
- **SC-005** Người dùng tự thiết kế một báo cáo ngày 3 cột trong Studio không cần sửa JSON (e2e).

## Assumptions

- Logo hình ảnh trên báo cáo chưa làm ở 015 (cần tệp project mới, allowlist và kiểm SVG ở cả hai bộ kiểm): dùng tên đơn vị (`org`, mặc định tên project). Mở ở tasks.
- "Luật logic bắn" chỉ đo được qua lệnh ghi PLC đã audit (`logic.write`, `.suppressed`, `throttled`); luật không ghi PLC không để lại vết, ngoài phạm vi.
- Báo cáo alarm dùng giờ thiết bị trả về; múi giờ hiển thị là `timeZone` của nhóm lưu trữ đầu tiên nếu có, không thì múi giờ trình duyệt.
- Kỳ `week` theo ISO (thứ Hai đầu tuần); kỳ `range` tối đa 31 ngày, hàng theo ngày.
- Trạng thái thiết bị trước đầu kỳ không biết: lần bật ngay tại đầu kỳ không được đếm (ghi trong chú thích báo cáo).
