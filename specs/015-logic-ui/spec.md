# Feature Specification: Sơ đồ khối cho editor Logic (015)

**Feature Branch**: `015-logic-ui`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description (2026-10-20): "Giao diện trang Logic" — làm lại editor Logic trong Studio cho trực quan hơn: **sơ đồ khối** (kiểu FBD, khối nối dây như TIA Portal / Node-RED) thay vì chỉ bảng luật. Giữ bảng cũ.

## Bối cảnh

Editor Logic của 011 (ADR-037) là một bảng theo nhóm (Luật, Timer, Counter, Cộng dồn, Giờ chạy, Lịch, Ghi PLC) với Inspector ở khung dưới, Thử logic (mô phỏng bằng `@mat/logic-engine`) và cột trạng thái sống khi Online. Bảng không cho thấy **luồng dữ liệu**: Tag nào vào luật nào, đầu ra timer đi đâu, luật nào ghi xuống PLC. Người dùng từ chối giao diện form cơ bản (studio-ux.md: chuẩn IDE kiểu TIA Portal).

Ràng buộc (Constitution 2.0.2): II (luật kiểm ở Studio và runtime cùng kết quả: không thêm luật kiểm riêng của giao diện), V (không script, mọi ghi PLC vẫn qua `writes` khai báo), VI (test trước), VII (định dạng có phiên bản: **không đổi `logic.json`**).

## Quyết định đã chốt

- **D1.** Sơ đồ là **một khung nhìn** của đúng mô hình `logic.json` 1.x; mọi sửa trên sơ đồ là sửa `logic.json` qua đường `logicSet` có hoàn tác sẵn có. Không khóa mới, không đổi schema, runtime C++ không đổi.
- **D2.** Vị trí khối lưu ở **tệp phụ của Studio** `logic.layout.json` (cùng thư mục, tên `<tên logic>.layout.json`), không thuộc tập file project (`projectFiles`) nên không vào gói `.matscada`, không nạp xuống, runtime không đọc. Thiếu hay hỏng thì Studio tự sắp xếp. Sửa vị trí là sửa đổi `logicLayoutSet` (một bước hoàn tác), lưu cùng lúc với project.
- **D3.** AND, OR, NOT, so sánh là **cổng suy ra từ cây cú pháp** của biểu thức ADR-015 (`&&`, `||`, `!`, `<` `<=` `>` `>=` `==` `!=`); phần khác (số học, hàm, `?:`) là nút "Biểu thức". Cổng không có id riêng, đi theo khối dùng nó. Palette có AND/OR/NOT/So sánh: thả vào một cổng vào thì bọc biểu thức của cổng đó (`(x) && true`, `!(x)`…).
- **D4.** **Nối dây** = sửa biểu thức: kéo từ cổng ra (Tag hoặc đầu ra khối) tới cổng vào thay đúng đoạn nguồn của cổng vào đó bằng id Tag; kéo từ cổng ↑/↓ của luật tới mục Ghi PLC thêm hành động `write` (giá trị cho phép đầu tiên), tới Tag đích thêm `setTag` (`true`). Xóa dây: bỏ toán hạng khỏi AND/OR (còn một thì gộp), cổng vào của khối thành rỗng (ô bắt buộc) hoặc `null` (ô tùy chọn), dây hành động thì bỏ hành động.
- **D5.** **Kiểm lỗi** chỉ dùng validator TS sẵn có (`checkLogic`, cùng vector với C++): lỗi theo `/rules/i/when`… tô đỏ cổng vào và dây tới nó; lỗi của khối (E_LOGIC_CYCLE, E_LOGIC_SELF_TRIGGER, E_LOGIC_ID…) tô đỏ viền khối; danh sách ở tab Thông tin như cũ. Khi kéo dây, cổng khác kiểu (BOOL ↔ số) mờ đi — chỉ là gợi ý; thả vẫn được và validator báo E_LOGIC_TYPE.
- **D6.** **Giá trị sống**: khi tab Thử logic mở dùng chung `LogicSim` của bảng Thử logic; khi Online dùng giá trị sống của phiên (`readValue`) và `GET /api/v1/logic` (trạng thái, số lần bắn). Dây BOOL TRUE màu xanh lá, dây số có nhãn giá trị, khối vừa bắn nhấp nháy, timer hiện thời gian còn lại.
- **D7.** Khung nhìn mặc định là **Sơ đồ**; nút "Sơ đồ / Bảng" ở thanh công cụ, lựa chọn nhớ theo máy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Xem luồng logic trên sơ đồ (Priority: P1)

Kỹ sư mở Logic, thấy Tag đầu vào bên trái, cổng AND/so sánh, khối luật/timer/counter/… ở giữa, Ghi PLC và Tag đích bên phải, nối bằng dây.

**Independent Test**: project trạm bơm (pumpLogic): sơ đồ có nút cho 2 luật, timer, counter, cộng dồn, giờ chạy, lịch, mục Ghi PLC; cổng `>` cho `TANK01.LEVEL > 80`; cổng AND cho luật mức thấp; dây từ `LOGIC.DAY.Q` của Lịch vào AND.

**Acceptance Scenarios**:
1. **Given** logic.json không có tệp layout, **When** mở Sơ đồ, **Then** khối tự sắp xếp trái sang phải theo phụ thuộc, không chồng nhau.
2. **Given** sơ đồ, **When** bấm "Bảng", **Then** thấy bảng cũ; bấm "Sơ đồ" quay lại.

### User Story 2 - Sửa trên sơ đồ (Priority: P1)

Kéo khối từ task card vào sơ đồ (thêm ở chỗ thả), kéo khối để dời (căn lưới 16 px), kéo cổng để nối dây, chọn khối để sửa ở Inspector cũ, Tự sắp xếp, zoom/pan, mini-map.

**Acceptance Scenarios**:
1. **Given** sơ đồ, **When** kéo nút Timer từ task card vào sơ đồ, **Then** có timer mới ở vị trí thả (căn lưới), được chọn, Inspector hiện nó; Ctrl+Z bỏ cả khối và vị trí trong một bước.
2. **Given** Tag `PUMP01.RUN`, **When** kéo cổng ra của nó vào cổng `in` của timer, **Then** `in` = `PUMP01.RUN` (một bước hoàn tác).
3. **Given** cổng ↑ của luật, **When** kéo vào mục Ghi PLC, **Then** luật có thêm hành động `write`.
4. **Given** khối được chọn, **When** kéo nó, **Then** vị trí ghi vào `logic.layout.json`, `logic.json` không đổi.

### User Story 3 - Giá trị sống khi Thử logic và Online (Priority: P2)

**Acceptance Scenarios**:
1. **Given** Thử logic, mức đặt tay 85, chạy, **When** nhìn sơ đồ, **Then** dây ra của cổng `> 80` xanh lá (TRUE), cổng ra của Tag mức có nhãn `85`, luật vừa bắn nhấp nháy; timer đang đếm hiện "còn x s".
2. **Given** Online với runtime 1.0, **When** sơ đồ mở, **Then** khối hiện chip trạng thái (OK/THROTTLED/…) và số lần bắn.

### User Story 4 - Lỗi trên sơ đồ (Priority: P2)

**Acceptance Scenarios**:
1. **Given** `when` đọc Tag không có, **Then** cổng vào `when` và viền khối đỏ, dòng E_LOGIC_TAG_REF ở Thông tin; nhấp đúp dòng lỗi chọn khối trên sơ đồ.
2. **Given** nối Tag FLOAT32 vào cổng BOOL, **Then** E_LOGIC_TYPE (hoặc E_LOGIC_EXPR) đỏ ở cổng đó.
3. **Given** vòng (A đọc đầu ra B, B đọc đầu ra A), **Then** cả hai khối viền đỏ (E_LOGIC_CYCLE).

### User Story 5 - Bàn phím và trợ năng (Priority: P2)

Tab chuyển khối theo thứ tự; mũi tên dịch khối 16 px (Shift: 64 px; các lần dịch liên tiếp của cùng khối gộp một bước hoàn tác); Delete xóa; Ctrl+D nhân bản; Enter mở Inspector (focus ô Id); `+`/`-` zoom, `0` vừa khung. Sơ đồ là `role="application"` có nhãn; mỗi khối là `role="button"` có nhãn đầy đủ (loại, id, trạng thái, lỗi). axe 0 critical/serious ở hai theme.

### Edge Cases

- Biểu thức không parse được: cổng vào hiện chữ gốc, đỏ (lỗi E_LOGIC_EXPR của validator), không cổng suy ra.
- Tag đầu vào cũng là đầu ra của khối khác: dây đi thẳng từ cổng ra của khối đó (không có nút Tag).
- 550 khối (giới hạn FR-095): vẽ dưới 200 ms, kéo thả mượt (chỉ vẽ lại khi đổi).
- Project chỉ đọc: không kéo, không nối; xem và chọn được.
- Đổi id khối: vị trí đi theo id mới. Xóa khối: vị trí bị bỏ.

## Requirements *(mandatory)*

- **FR-001** Khung nhìn Sơ đồ / Bảng trong editor Logic; Sơ đồ mặc định; nhớ lựa chọn.
- **FR-002** Nút khối cho đủ 7 nhóm với cổng vào (ô biểu thức) và cổng ra (Tag đầu ra; ↑/↓ của luật); nút Tag đầu vào; nút Tag đích của setTag/toggle; cổng suy ra AND/OR/NOT/so sánh/biểu thức.
- **FR-003** Thêm khối bằng kéo từ task card (vị trí thả), menu Thêm khối, Insert; dời khối (lưới 16 px); Tự sắp xếp; zoom (25–200 %), pan, Vừa khung, mini-map.
- **FR-004** Nối dây và xóa dây theo D4; mọi thao tác một bước hoàn tác.
- **FR-005** Lỗi của validator hiện trên sơ đồ theo D5; không luật kiểm mới.
- **FR-006** Giá trị sống theo D6.
- **FR-007** Bàn phím và ARIA theo US5.
- **FR-008** Vị trí lưu theo D2; `logic.json` và gói nạp xuống không đổi.

## Success Criteria

- **SC-001** Vitest model (đồ thị, sắp xếp, nối/xóa dây, layout) và giao diện xanh; e2e `logic-diagram.e2e.mjs` xanh; e2e `logic.e2e.mjs` cũ xanh.
- **SC-002** axe 0 critical/serious ở sơ đồ (thường, thử logic, lỗi) hai theme.
- **SC-003** Ảnh tài liệu `eng-logic-so-do.png`, `eng-logic-so-do-thu.png`, `eng-logic-so-do-loi.png`.
