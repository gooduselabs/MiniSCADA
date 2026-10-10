# Feature Specification: Kiểm chứng nền tảng (Sprint 0)

**Feature Branch**: `001-platform-validation`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Sprint 0 — Kiểm chứng nền tảng cho mAT SCADA trên BL335 (Allwinner T113-i, ARM 32-bit, RAM 1 GB): thu thập thông tin thiết bị, dựng công cụ build chéo, đo baseline, PoC máy chủ web phục vụ file tĩnh + đẩy 500 Tag giả lập/giây tới 10 client, công cụ kiểm thử tải, khung monorepo + CI, khởi tạo Studio desktop, bộ SVG mẫu, ADR; ra quyết định Go/No-Go."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Biết chắc thiết bị đủ sức chạy sản phẩm (Priority: P1)

Tech Lead cần biết BL335 có phù hợp làm thiết bị đích hay không trước khi đầu tư 18–20 tuần phát triển. Đội ngũ thu thập hồ sơ phần cứng/OS của thiết bị, đo mức tài nguyên khi máy rảnh và chạy được một chương trình thử do đội tự biên dịch trên máy phát triển.

**Why this priority**: Nếu thiết bị không chạy được chương trình tự biên dịch hoặc RAM nền quá lớn thì toàn bộ kế hoạch phải đổi hướng (đổi OS/phần cứng). Đây là rủi ro lớn nhất và rẻ nhất để loại bỏ sớm.

**Independent Test**: Có thể kiểm tra riêng: tạo báo cáo hồ sơ thiết bị, biên dịch chương trình thử, chạy trên BL335 và ghi số đo RAM/CPU khi rảnh.

**Acceptance Scenarios**:

1. **Given** BL335 đang bật và truy cập được qua mạng LAN, **When** đội thực hiện bộ kiểm tra thiết bị (kiến trúc, phiên bản OS/thư viện, bộ nhớ, ổ lưu trữ, cổng nối tiếp, đồng hồ thực, nhiệt độ), **Then** có một hồ sơ thiết bị được lưu trong tài liệu của dự án.
2. **Given** máy phát triển có bộ công cụ build chéo, **When** biên dịch và chạy một chương trình C++17 thử trên BL335, **Then** chương trình chạy đúng, không lỗi tương thích.
3. **Given** thiết bị ở trạng thái rảnh sau khi khởi động, **When** đo RAM đang dùng, **Then** kết quả được ghi lại và so với ngưỡng Go/No-Go.

---

### User Story 2 - Chứng minh 10 client xem dữ liệu sống mượt, client thứ 11 bị từ chối (Priority: P1)

Kỹ sư kiểm thử chạy một chương trình thử trên BL335 phục vụ một trang tĩnh và đẩy dữ liệu giả lập 500 Tag mỗi giây. Công cụ tải mô phỏng 10 người xem đồng thời và một người thứ 11; đo mức dùng RAM/CPU của thiết bị.

**Why this priority**: Đây là yêu cầu cốt lõi của sản phẩm (tối đa 10 client) và là cơ sở để chọn công nghệ máy chủ web giữa hai ứng viên.

**Independent Test**: Chạy công cụ tải với 10 rồi 11 client, đối chiếu kết quả kết nối và số đo tài nguyên.

**Acceptance Scenarios**:

1. **Given** chương trình thử đang chạy trên BL335, **When** 10 client kết nối và đăng ký nhận dữ liệu 500 Tag, **Then** cả 10 nhận cập nhật đều đặn mỗi giây.
2. **Given** đã có 10 client đang kết nối, **When** client thứ 11 cố kết nối, **Then** nó bị từ chối kèm thông báo "đã đạt tối đa", và 10 client còn lại không bị gián đoạn.
3. **Given** một client trong 10 ngắt kết nối, **When** sau thời gian chờ quy định, **Then** một client mới kết nối được.
4. **Given** hai ứng viên máy chủ web được thử cùng kịch bản, **When** so sánh RAM/CPU, **Then** có số liệu đủ để chọn một ứng viên.

---

### User Story 3 - Mở màn hình SVG nhanh trên Chrome từ thiết bị (Priority: P2)

Người vận hành mở trình duyệt Chrome trên máy trong LAN, truy cập địa chỉ BL335 và thấy màn hình SVG (bồn, motor, van, ống...) hiển thị đầy đủ.

**Why this priority**: Xác nhận chuỗi phục vụ trang → Chrome hiển thị đạt tốc độ yêu cầu với dữ liệu SVG thực tế từ nhiều phần mềm vẽ.

**Independent Test**: Mở từng SVG mẫu từ BL335 trên Chrome và đo thời gian hiển thị.

**Acceptance Scenarios**:

1. **Given** bộ ≥ 10 SVG mẫu (tạo từ Inkscape, Illustrator, CorelDRAW) đặt trên BL335, **When** mở từng file bằng Chrome trong LAN, **Then** mỗi màn hình hiển thị đầy đủ trong ≤ 2 giây.

---

### User Story 4 - Khung dự án và công cụ phát triển sẵn sàng (Priority: P2)

Đội phát triển có một kho mã thống nhất, quy trình kiểm tra tự động (định dạng, test, build trên máy thường và trên ARM) và ứng dụng Studio khởi tạo cài được trên Windows không cần Internet.

**Why this priority**: Là nền cho mọi Sprint sau; nhưng không chặn quyết định Go/No-Go về thiết bị nên xếp sau.

**Independent Test**: Chạy quy trình kiểm tra tự động trên kho mã mới; cài bộ cài Studio thử trên máy Windows 10 và Windows 11 không có mạng.

**Acceptance Scenarios**:

1. **Given** kho mã theo cấu trúc trong Master Plan mục 5, **When** chạy quy trình kiểm tra tự động, **Then** lint, test và build (máy thường + ARM) đều chạy được.
2. **Given** một máy Windows 10/11 không có Internet, **When** cài bộ cài Studio thử, **Then** Studio khởi động và hiển thị cửa sổ chính.

---

### User Story 5 - Quyết định Go/No-Go có hồ sơ (Priority: P1)

Tech Lead nhận báo cáo đo đạc tổng hợp cùng các ADR (máy chủ web, hệ điều hành thương mại, định danh đối tượng, schema/versioning, ngân sách tài nguyên) và đưa ra quyết định Go hoặc No-Go.

**Why this priority**: Là đầu ra nghiệm thu của Sprint 0.

**Independent Test**: Đối chiếu báo cáo với bảng tiêu chí; mỗi tiêu chí có số đo và kết luận Đạt/Không đạt.

**Acceptance Scenarios**:

1. **Given** đã hoàn tất các số đo, **When** lập bảng Go/No-Go, **Then** mỗi tiêu chí có giá trị đo thực tế, ngưỡng, kết luận và biện pháp nếu không đạt.
2. **Given** báo cáo và ADR, **When** Tech Lead duyệt, **Then** quyết định Go/No-Go được ghi nhận.

---

### Edge Cases

- Thiết bị mất kết nối mạng hoặc khởi động lại giữa lúc đo: số đo phải đo lại, không dùng kết quả dở dang.
- Client chậm hoặc ngừng đọc dữ liệu: không được làm chậm hoặc làm tăng RAM của các client khác.
- Một trình duyệt mở nhiều tab: mỗi tab tính một client.
- Client thứ 11 liên tục thử lại: không chiếm slot và không làm tăng tải thiết bị đáng kể.
- File SVG lớn/phức tạp hoặc có phần tử không hỗ trợ: hiển thị được hoặc báo rõ, không làm treo trình duyệt.
- Thiết bị không có đồng hồ thực/Internet: ghi nhận trong hồ sơ, không chặn đo đạc.
- Một tiêu chí Go/No-Go không đạt: báo cáo nêu rõ biện pháp thay thế thay vì bỏ qua.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Đội MUST lập hồ sơ thiết bị BL335 gồm kiến trúc CPU, bản OS/thư viện nền, RAM, dung lượng và kiểu phân vùng lưu trữ, cổng nối tiếp, đồng hồ thực, nhiệt độ, thông tin tuổi thọ bộ nhớ lưu trữ nếu đọc được.
- **FR-002**: Đội MUST có quy trình dựng công cụ build chéo cho BL335 lặp lại được, và biên dịch được chương trình C++17 chạy đúng trên thiết bị.
- **FR-003**: Đội MUST đo và ghi lại RAM/CPU của thiết bị ở trạng thái rảnh (baseline).
- **FR-004**: Chương trình thử MUST phục vụ file tĩnh và đẩy dữ liệu giả lập 500 Tag mỗi giây tới các client đã đăng ký.
- **FR-005**: Chương trình thử MUST giới hạn tối đa 10 client đồng thời; client thứ 11 MUST bị từ chối kèm mã/thông báo xác định, không ảnh hưởng 10 client còn lại.
- **FR-006**: Slot của client mất kết nối MUST được giải phóng sau thời gian chờ định trước (mặc định 15 giây).
- **FR-007**: Hai ứng viên máy chủ web (CivetWeb, Drogon) MUST được thử cùng một kịch bản và so sánh bằng số đo RAM/CPU.
- **FR-008**: Công cụ tải MUST mô phỏng 10 client hợp lệ cộng 1 client dư và xuất kết quả: số kết nối thành công/bị từ chối, độ trễ cập nhật, số cập nhật bị mất.
- **FR-009**: Kho mã MUST có cấu trúc thư mục theo Master Plan mục 5 và quy trình kiểm tra tự động (định dạng, test, build máy thường và ARM).
- **FR-010**: Studio desktop MUST được khởi tạo và có bộ cài thử cài được offline trên Windows 10 và 11.
- **FR-011**: Đội MUST chuẩn bị ≥ 10 file SVG mẫu thực tế (bồn, motor, van, ống, đồng hồ, icon, nhóm lồng nhau, gradient, clipPath, use) từ ≥ 3 phần mềm vẽ.
- **FR-012**: Đội MUST viết các ADR: máy chủ web, hệ điều hành thương mại, định danh đối tượng, schema/versioning, ngân sách tài nguyên.
- **FR-013**: Đội MUST lập bảng Go/No-Go với giá trị đo, ngưỡng, kết luận và biện pháp nếu không đạt cho từng tiêu chí.
- **FR-014**: Mọi thao tác thay đổi trên BL335 (cài, xóa, sửa cấu hình) MUST được ghi lại trong nhật ký công việc để có thể hoàn tác.

### Key Entities

- **Hồ sơ thiết bị**: thông số phần cứng/OS của BL335 tại một thời điểm.
- **Số đo (Measurement)**: giá trị RAM/CPU/thời gian, gắn kịch bản, thời điểm, phiên bản chương trình thử.
- **Kịch bản tải**: số client, số Tag, chu kỳ cập nhật, thời lượng.
- **Tiêu chí Go/No-Go**: tên, ngưỡng, giá trị đo, kết luận, biện pháp nếu không đạt.
- **ADR**: quyết định kiến trúc, bối cảnh, phương án, hệ quả.
- **SVG mẫu**: file, phần mềm nguồn, đặc điểm kiểm thử.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Chương trình C++17 tự biên dịch chạy trên BL335 không lỗi tương thích.
- **SC-002**: RAM hệ điều hành khi rảnh ≤ 250 MB.
- **SC-003**: Với 10 client và 500 Tag/giây, bộ nhớ chương trình thử ≤ 60 MB và CPU trung bình ≤ 30%.
- **SC-004**: Client thứ 11 bị từ chối đúng trong 100% lần thử; 10 client còn lại không mất dữ liệu trong lúc đó.
- **SC-005**: ≥ 10 SVG mẫu mở trên Chrome từ BL335 hiển thị đầy đủ trong ≤ 2 giây mỗi màn hình (LAN 100 Mbps, PC văn phòng).
- **SC-006**: Studio cài và khởi động được trên Windows 10 và Windows 11 không có Internet.
- **SC-007**: Báo cáo đo đạc, 5 ADR được duyệt và quyết định Go/No-Go được ghi nhận.

## Assumptions

- BL335 chạy image phát triển Ubuntu 20.04 (kernel 5.4) đúng như thiết bị hiện có; hệ điều hành thương mại sẽ chốt qua ADR ở cuối sprint.
- Người dùng cuối dùng Chrome/Chromium ≥ 120; các trình duyệt khác ngoài phạm vi.
- Dữ liệu Tag trong Sprint 0 là giả lập; chưa kết nối PLC thật; chưa có đăng nhập, phân quyền, lưu trữ lịch sử.
- Đội ngũ và thời lượng theo Master Plan mục 2 (2 tuần).
- Thiết bị truy cập được qua SSH trong LAN; thông tin truy cập lưu ngoài kho mã.
- Một số công cụ có thể cần cài thêm trên máy phát triển (Docker/toolchain, cmake); sẽ xử lý ở bước lập kế hoạch.
- Ngoài phạm vi: SVG importer/sanitizer đầy đủ, editor, binding, animation, deploy, driver thật.
