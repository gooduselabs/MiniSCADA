# Feature Specification: Bố cục màn hình theo hàng và cột, giao diện sáng đa sắc

**Feature Branch**: `012-screen-grid-layout`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Bố cục màn hình theo hàng và cột (lưới 12 cột) cho mAT Studio và trang vận hành web, kèm làm mới giao diện (bảng màu sáng đa sắc, biểu đồ, báo cáo). Nguồn yêu cầu và các quyết định đã chốt D1–D15: docs/plans/screen-grid-layout.md mục 1–9 và 11."

## Bối cảnh

Sau feature 007 (màn hình và widget) và 011 (định dạng project 1.0), màn hình của mAT SCADA đặt widget bằng **tọa độ tuyệt đối**: kỹ sư kéo thả từng widget trên canvas, mỗi widget có X, Y, rộng, cao; trang vận hành co cả màn hình theo một tỷ lệ. Người dùng nhận xét (2026-10-19):

- cách kéo thả tự do không đúng ý: muốn **một trang chia thành nhiều hàng, mỗi hàng chia cột trên lưới 12 cột** (ví dụ hàng 1 chia 3 cột 4 + 4 + 4, hàng 2 chia 8 + 4), rồi **gắn component vào từng ô**, vị trí do mình chọn ô chứ không phải kéo;
- màu sắc, biểu đồ, báo cáo "xấu, không hiện đại": muốn **sáng sủa, nhiều màu sắc hơn**, dùng thư viện tốt hơn.

Kế hoạch và 15 quyết định đã chốt (D1 đến D15) nằm ở [docs/plans/screen-grid-layout.md](../../docs/plans/screen-grid-layout.md) mục 1 đến 9 và 11. Phần đăng nhập bắt buộc và phân quyền (mục 10 của kế hoạch) là feature **013** riêng, không thuộc spec này.

Ràng buộc chính của [Constitution](../../.specify/memory/constitution.md) 2.0.2:

- **II:** Studio và trang vận hành dùng chung schema, luật kiểm và thư viện widget (`packages/*`); hai bộ kiểm (Studio và runtime) cho cùng kết quả trên vector chung.
- **III:** ngân sách BL335 không đổi (RSS ≤ 150 MB, CPU ≤ 30 % với 500 Tag, 1 s, 10 client). Phần mới chạy chủ yếu ở trình duyệt nhưng tải từ thiết bị qua LAN.
- **V:** chạy offline, không tải gì từ Internet; thư viện mới phải qua cổng giấy phép.
- **VI:** test viết trước. **VII:** định dạng theo SemVer, có nâng cấp; project cũ mở nguyên trạng.

Phần Studio theo [studio-ux.md](../../docs/architecture/studio-ux.md); chuẩn là công cụ IDE, người dùng từ chối giao diện form cơ bản.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Kỹ sư dựng màn hình theo hàng và cột trong Studio (Priority: P1)

Kỹ sư tạo màn hình mới (mặc định bố cục Lưới), thêm hàng và chọn cách chia cột (ví dụ 4 + 4 + 4), rồi gắn component vào từng ô bằng cách thả từ Toolbox vào ô hoặc chọn ô rồi chọn component. Kỹ sư đổi độ rộng cột, thứ tự hàng và ô, chiều cao hàng mà không bao giờ nhập tọa độ.

**Why this priority**: đây là yêu cầu gốc; không có nó thì không có gì để hiển thị theo kiểu mới.

**Independent Test**: trong Studio, dựng một màn hình 3 hàng (3 cột, 2 cột, 1 cột) với 6 component, lưu, mở lại, thấy đúng bố cục; không ô nhập X, Y, rộng, cao nào xuất hiện.

**Acceptance Scenarios**:

1. **Given** project định dạng 1.0 đang mở, **When** kỹ sư chọn **Thêm màn hình**, **Then** hộp chọn bố cục mặc định là **Lưới**, màn hình mới có một hàng 12 cột trống.
2. **Given** màn hình lưới, **When** kỹ sư bấm **Thêm hàng** và chọn mẫu `4+4+4`, **Then** xuất hiện hàng có 3 ô rộng bằng nhau, ô trống hiện vùng "thả component".
3. **Given** ô trống, **When** kỹ sư kéo **Thẻ giá trị** từ Toolbox thả vào ô, **Then** ô chứa component đó, component điền đầy ô, Inspector hiện các thuộc tính của component (không có nhóm vị trí và kích thước).
4. **Given** ô đã có component, **When** kỹ sư thả component khác vào, **Then** Studio hỏi thay thế; chọn Hủy thì không đổi gì.
5. **Given** hàng `4+4+4`, **When** kỹ sư kéo đường chia giữa ô 1 và ô 2 sang phải hai bậc, **Then** hàng thành `6+2+4` (bám theo 1/12), một bước hoàn tác đưa về như cũ.
6. **Given** màn hình lưới, **When** kỹ sư dùng bàn phím (không chuột) để thêm hàng, chọn ô, gắn component, đổi thứ tự, **Then** mọi thao tác trên đều làm được.
7. **Given** màn hình lưới đã lưu, **When** đóng và mở lại project, **Then** bố cục, component và binding giữ nguyên; tab Thông tin không có lỗi.

---

### User Story 2 - Trang vận hành hiển thị bố cục lưới (Priority: P1)

Người vận hành mở trang web của thiết bị; màn hình lưới hiện đúng các hàng và cột như kỹ sư dựng, component có dữ liệu sống, sự kiện và popup hoạt động như cũ. Trên màn hình hẹp (máy tính bảng dọc, điện thoại), các ô tự xếp chồng thành một cột và cuộn dọc.

**Why this priority**: bố cục chỉ có giá trị khi người vận hành thấy nó trên thiết bị thật.

**Independent Test**: nạp xuống project có màn hình lưới, mở trang vận hành ở chiều rộng 1920, 1366 và 600 điểm ảnh; so với xem trước của Studio.

**Acceptance Scenarios**:

1. **Given** project có màn hình lưới đã nạp xuống, **When** mở trang vận hành ở chiều rộng 1366, **Then** các hàng và cột hiện đúng tỷ lệ cột như trong Studio, component điền đầy ô, có giá trị sống.
2. **Given** cùng màn hình, **When** chiều rộng cửa sổ dưới 768 điểm ảnh, **Then** mỗi ô chiếm trọn chiều ngang, xếp theo thứ tự hàng rồi cột, trang cuộn dọc, không có thanh cuộn ngang.
3. **Given** component có sự kiện (ghi giá trị, chuyển màn hình, mở popup), **When** người vận hành thao tác, **Then** hành vi giống hệt màn hình tự do (xác nhận, quyền, audit không đổi).
4. **Given** project chỉ có màn hình tự do (định dạng 1.0), **When** mở trang vận hành sau khi cập nhật runtime, **Then** hiển thị không đổi so với trước.
5. **Given** runtime cũ chỉ hiểu định dạng 1.0, **When** kỹ sư nạp xuống project có màn hình lưới, **Then** Nạp xuống bị chặn kèm lời nhắc cập nhật runtime, thiết bị không chạy sai.

---

### User Story 3 - Giao diện sáng đa sắc, biểu đồ hiện đại (Priority: P2)

Người vận hành và kỹ sư thấy giao diện sáng sủa, nhiều màu: bảng màu biểu đồ 10 đến 12 màu tươi phân biệt được, card có bo góc và bóng mềm, biểu đồ cột, tròn, vành khuyên, đồng hồ có hoạt ảnh nhẹ, tooltip và chú giải rõ. Người quản trị chọn chủ đề cho project (Sáng đa sắc mặc định, Công nghiệp trầm như cũ, Tối).

**Why this priority**: người dùng đánh giá giao diện hiện tại là xấu; ảnh hưởng trực tiếp tới việc chấp nhận sản phẩm, nhưng không chặn chức năng.

**Independent Test**: mở 6 màn hình chuẩn (Tổng quan, Xu hướng, Alarm, Báo cáo, Bảng Tag, Điều khiển) ở ba chủ đề, chụp ảnh trước và sau, kiểm tương phản tự động.

**Acceptance Scenarios**:

1. **Given** project mới, **When** mở trang vận hành, **Then** chủ đề là **Sáng đa sắc**; biểu đồ nhiều chuỗi dùng màu khác nhau rõ rệt cho tới 12 chuỗi.
2. **Given** Thiết lập project, **When** chọn chủ đề **Công nghiệp trầm**, **Then** Studio và trang vận hành đổi theo, không cần sửa từng widget.
3. **Given** người dùng bật "giảm chuyển động" của hệ điều hành, **When** mở trang có biểu đồ, **Then** không có hoạt ảnh.
4. **Given** bất kỳ chủ đề nào, **When** kiểm tương phản, **Then** chữ trên nền đạt tối thiểu 4,5:1 và mỗi chuỗi biểu đồ còn phân biệt được bằng kiểu nét hoặc nhãn, không chỉ bằng màu.
5. **Given** project cũ có thuộc tính biểu đồ (`series`, giới hạn trục), **When** mở bằng bản mới, **Then** biểu đồ hiển thị đúng dữ liệu, không mất cấu hình.

---

### User Story 4 - Báo cáo PDF đẹp, có biểu đồ (Priority: P2)

Người dùng xuất báo cáo PDF có dải tiêu đề màu, logo, thẻ số liệu tổng hợp, biểu đồ (vector) và bảng kẻ xen kẽ, chân trang có số trang; chữ tiếng Việt đủ dấu. XLSX có tiêu đề màu, độ rộng cột và định dạng số hợp lý.

**Why this priority**: báo cáo là sản phẩm gửi cho quản lý; hiện chỉ có bảng thô.

**Independent Test**: xuất báo cáo ca từ mẫu có sẵn ra PDF và XLSX, mở ở trình xem phổ biến, so với mẫu thiết kế.

**Acceptance Scenarios**:

1. **Given** mẫu báo cáo có một biểu đồ và một bảng, **When** xuất PDF, **Then** PDF có biểu đồ sắc nét khi phóng to, bảng có dòng xen kẽ, số trang ở chân trang, đủ dấu tiếng Việt.
2. **Given** báo cáo nhiều trang, **When** bảng sang trang mới, **Then** tiêu đề cột lặp lại.
3. **Given** cùng báo cáo, **When** xuất XLSX, **Then** hàng tiêu đề có màu, cột có độ rộng vừa nội dung, số có định dạng theo đơn vị.

---

### User Story 5 - Chuyển màn hình tự do sang lưới (Priority: P3)

Kỹ sư có màn hình tự do cũ chọn **Chuyển sang bố cục lưới**; Studio đề xuất cách chia hàng và cột từ vị trí hiện tại, cho xem trước và chỉnh, rồi áp trong một bước hoàn tác.

**Why this priority**: hữu ích cho project có sẵn nhưng màn hình tự do vẫn được hỗ trợ (D5), nên làm sau cùng (D9).

**Independent Test**: chuyển màn hình `tank-motor` và một màn hình của `dashboard-demo`; mọi component và binding còn nguyên, thứ tự đọc từ trên xuống, trái sang phải.

**Acceptance Scenarios**:

1. **Given** màn hình tự do có 6 widget xếp thành 2 dòng, **When** chọn Chuyển sang bố cục lưới, **Then** bản xem trước có 2 hàng, độ rộng ô làm tròn theo 12 cột, không mất widget nào.
2. **Given** bản xem trước, **When** chọn Hủy, **Then** màn hình không đổi.
3. **Given** đã chuyển, **When** hoàn tác một bước, **Then** màn hình về đúng bản tự do ban đầu.

---

### Edge Cases

- Hàng có tổng độ rộng ô nhỏ hơn 12: phần còn lại để trống; lớn hơn 12: không cho lưu, báo lỗi ngay ở hàng đó.
- Ô trống: hợp lệ, hiện vùng thả ở Studio, không hiện gì ở trang vận hành (giữ chỗ).
- Xóa component trong ô: ô trở thành trống. Xóa ô hoặc hàng có component: hỏi xác nhận, component bị xóa cùng (một bước hoàn tác).
- Component tồn tại nhưng không nằm trong ô nào (do sửa tay tệp): cảnh báo, không hiển thị.
- Một component được đặt ở hai ô: lỗi.
- Hàng cao tự động chứa component có chiều cao tối thiểu khác nhau: hàng cao bằng ô cao nhất.
- Bản vẽ SVG trong ô hẹp: giữ tỷ lệ, không méo, không tràn.
- Popup dùng lưới: kích thước popup vẫn cố định, lưới nằm trong khung popup.
- Màn hình lưới có 100 hàng (giới hạn): thêm hàng thứ 101 bị từ chối kèm lý do.
- Mở project lưới bằng Studio cũ: bị từ chối là "định dạng mới hơn" (cơ chế đã có).
- Template (mẫu) chèn nhiều widget vào màn hình lưới: chèn vào ô đang chọn, hoặc báo không hỗ trợ ở bản đầu nếu template cần vị trí tự do.
- Chủ đề Tối và màu do project tự đặt cho widget: màu project đặt được giữ nguyên, các màu mặc định đổi theo chủ đề.
- Biểu đồ lịch sử 50.000 điểm trong ô nhỏ: vẫn cuộn, phóng mượt.

## Requirements *(mandatory)*

### Functional Requirements

**Mô hình bố cục**

- **FR-001**: Màn hình MUST có hai kiểu bố cục: **Tự do** (như hiện nay) và **Lưới**. Thiếu khai báo bố cục nghĩa là Tự do.
- **FR-002**: Bố cục Lưới MUST gồm danh sách **hàng**; mỗi hàng gồm danh sách **ô**; lưới có đúng **12 cột** (D1).
- **FR-003**: Mỗi ô MUST có độ rộng 1 đến 12 cột, có thể có khoảng trống phía trước (offset), căn lề (đầu, giữa, cuối, kéo giãn) và chiều cao tối thiểu; tổng offset và độ rộng các ô của một hàng MUST không quá 12.
- **FR-004**: Mỗi hàng MUST có chiều cao **tự động** (theo nội dung) hoặc một số điểm ảnh cố định (D8), và khoảng cách giữa ô.
- **FR-005**: Mỗi ô MUST chứa không hoặc một component (D3); component được ô **tham chiếu** theo mã định danh, danh sách component của màn hình giữ nguyên dạng một danh sách phẳng (D2).
- **FR-006**: Component trong màn hình Lưới MUST không mang vị trí và kích thước tuyệt đối; component trong màn hình Tự do MUST có đủ như hiện nay.
- **FR-007**: Lưới MUST không lồng nhau ở bản này (D7); muốn nhóm thì dùng widget Khung nhóm.
- **FR-008**: Popup MUST dùng được bố cục Lưới (D6); kích thước khung popup vẫn cố định.
- **FR-009**: Giới hạn: tối đa 100 hàng mỗi màn hình, 12 ô mỗi hàng.

**Định dạng và tương thích**

- **FR-010**: Project dùng bố cục Lưới MUST ghi định dạng **1.1.0** và runtime tối thiểu tương ứng; project 1.0 MUST mở, kiểm, nạp xuống như cũ.
- **FR-011**: Studio MUST có bước nâng cấp 1.0 → 1.1 chỉ đổi phiên bản và runtime tối thiểu, có sao lưu trước lần lưu đầu (như các bước nâng cấp hiện có); không tự đổi bố cục màn hình cũ.
- **FR-012**: Bộ kiểm của Studio và của runtime MUST áp cùng luật bố cục và cho cùng kết quả trên bộ vector chung; mã lỗi mới: độ rộng hoặc offset sai, số cột khác 12, ô trỏ component không có, component ở hai ô, component màn hình Lưới có vị trí tuyệt đối, vượt giới hạn; cảnh báo: component không nằm trong ô nào.
- **FR-013**: Runtime không hiểu 1.1 MUST bị chặn ở bước Nạp xuống kèm lời nhắc (cơ chế cổng phiên bản đã có).
- **FR-014**: Mọi chức năng đang làm việc theo component (binding, sự kiện, đổi tên Tag, so sánh với thiết bị, Đọc lên, nhân bản màn hình, nhập lại SVG, điều hướng) MUST hoạt động với màn hình Lưới.

**Studio: trình soạn bố cục Lưới**

- **FR-015**: Thêm màn hình MUST cho chọn bố cục, mặc định **Lưới** (D5).
- **FR-016**: Studio MUST cho **Thêm hàng** kèm mẫu chia cột: 12, 6+6, 4+4+4, 3+3+3+3, 8+4, 4+8, 3+6+3, và nhập tay (tổng ≤ 12).
- **FR-017**: Studio MUST cho gắn component vào ô bằng: thả từ Toolbox vào ô (ô được làm nổi khi rê vào), chọn ô rồi chọn component trong Toolbox, hoặc menu chuột phải **Gắn component…**. MUST không có thao tác đặt theo tọa độ tự do trong màn hình Lưới.
- **FR-018**: Thả vào ô đã có component MUST hỏi thay thế.
- **FR-019**: Studio MUST cho đổi độ rộng ô bằng kéo đường chia (bám theo 1/12) và bằng ô nhập ở Inspector; đổi thứ tự hàng và ô bằng kéo tay nắm và bằng nút lên, xuống.
- **FR-020**: Inspector MUST có thuộc tính của hàng (chiều cao, khoảng cách), của ô (độ rộng, offset, căn lề, chiều cao tối thiểu), và của component (các tab hiện có, bỏ vị trí và kích thước).
- **FR-021**: Mọi thao tác MUST là một bước hoàn tác; Lưu theo quy tắc hiện có (sao lưu bản gốc).
- **FR-022**: Mọi thao tác MUST làm được bằng bàn phím; vùng thả và ô có nhãn cho trình đọc màn hình.
- **FR-023**: Xem trước MUST dùng cùng cách hiển thị với trang vận hành, có chọn chiều rộng xem trước 1920, 1366 và 600 điểm ảnh; chế độ Tắt, Mô phỏng, Thiết bị giữ nguyên.
- **FR-024**: Màn hình Tự do MUST giữ trình soạn hiện có, không đổi hành vi.

**Trang vận hành**

- **FR-025**: Trang vận hành MUST hiển thị màn hình Lưới đúng tỷ lệ cột, component điền đầy ô, cuộn dọc khi dài, không co cả màn hình theo một tỷ lệ.
- **FR-026**: Dưới chiều rộng 768 điểm ảnh, các ô MUST xếp chồng thành một cột theo thứ tự hàng rồi ô (D4), không có cuộn ngang.
- **FR-027**: Dữ liệu sống, sự kiện, popup, xác nhận, quyền ghi và audit MUST hoạt động như màn hình Tự do.
- **FR-028**: Bản vẽ SVG trong ô MUST giữ tỷ lệ theo khung nhìn của nó.

**Giao diện sáng đa sắc (GĐ 7 của kế hoạch)**

- **FR-029**: Studio và trang vận hành MUST có bộ màu mới **Sáng đa sắc** làm mặc định cho project mới, và giữ **Công nghiệp trầm** (giao diện hiện tại) cùng **Tối** làm chủ đề chọn được (D12); project cũ giữ giao diện hiện tại cho tới khi người dùng đổi.
- **FR-030**: Chủ đề MUST chọn ở Thiết lập project và áp cho mọi widget không có màu do project đặt riêng.
- **FR-031**: Bảng màu biểu đồ MUST có 10 đến 12 màu phân biệt được, kèm bảng màu tuần tự và phân kỳ cho bản đồ nhiệt; mỗi chuỗi MUST còn phân biệt được bằng kiểu nét hoặc nhãn.
- **FR-032**: Chữ trên mọi nền MUST đạt tương phản ≥ 4,5:1 ở mọi chủ đề, kiểm tự động.
- **FR-033**: Biểu đồ cột, tròn, vành khuyên, đồng hồ MUST được vẽ lại với hoạt ảnh vào nhẹ, tooltip, chú giải rõ; hoạt ảnh MUST tắt khi người dùng bật giảm chuyển động.
- **FR-034**: Biểu đồ xu hướng thời gian thực và lịch sử MUST có giao diện mới (màu, lưới, chú giải, tooltip) và giữ hiệu năng hiện có với tới 50.000 điểm.
- **FR-035**: Widget Thẻ giá trị MUST có tùy chọn đường xu hướng nhỏ (sparkline) và chỉ báo tăng giảm.
- **FR-036**: Phông chữ dùng chung MUST đi kèm sản phẩm (không tải từ Internet), hiển thị đủ dấu tiếng Việt, có phông dự phòng (D14).
- **FR-037**: Cấu hình hiện có của widget biểu đồ MUST giữ nguyên ý nghĩa; chỉ cách vẽ đổi.

**Báo cáo**

- **FR-038**: Báo cáo PDF MUST có mẫu mới: dải tiêu đề, logo (tùy chọn), thẻ số liệu, biểu đồ vector, bảng kẻ xen kẽ có lặp tiêu đề cột khi sang trang, số trang ở chân trang, phông đủ dấu tiếng Việt (D13).
- **FR-039**: Báo cáo XLSX MUST có hàng tiêu đề màu, độ rộng cột theo nội dung, định dạng số theo đơn vị.

**Chuyển đổi (P3)**

- **FR-040**: Studio MUST có lệnh **Chuyển sang bố cục lưới** cho màn hình Tự do: đề xuất hàng và cột từ vị trí hiện tại, xem trước, chỉnh, áp hoặc hủy, một bước hoàn tác; không tự chạy (D9).

**Thư viện và đóng gói**

- **FR-041**: Mọi thư viện và phông mới MUST nằm trong gói sản phẩm, qua cổng giấy phép và có trong danh sách thành phần phần mềm (SBOM).
- **FR-042**: Mã của biểu đồ MUST chỉ tải khi trang có widget cần nó.

### Key Entities *(include if feature involves data)*

- **Bố cục (Layout)**: thuộc một màn hình hoặc popup; kiểu (Tự do hoặc Lưới), số cột (12), khoảng cách, lề, danh sách hàng.
- **Hàng (Row)**: mã định danh, chiều cao (tự động hoặc số điểm ảnh), khoảng cách, danh sách ô theo thứ tự.
- **Ô (Cell)**: mã định danh, độ rộng (1 đến 12 cột), offset, căn lề, chiều cao tối thiểu, tham chiếu tới không hoặc một component.
- **Component (Item)**: như hiện nay (widget hoặc bản vẽ SVG, thuộc tính, Tag gắn, sự kiện, bảo mật); trong màn hình Lưới không có vị trí và kích thước tuyệt đối.
- **Chủ đề (Theme)**: thuộc project; tên chủ đề (Sáng đa sắc, Công nghiệp trầm, Tối) quyết định bảng màu, phông, bo góc, bóng.
- **Mẫu báo cáo (Report template)**: như hiện nay, thêm phần trình bày (tiêu đề, logo, thẻ số liệu, biểu đồ).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Kỹ sư dựng một màn hình 3 hàng (3 cột, 2 cột, 1 cột) với 6 component trong **≤ 3 phút**, không nhập bất kỳ tọa độ nào.
- **SC-002**: Cùng một màn hình Lưới hiển thị giống nhau ở xem trước Studio và trang vận hành ở chiều rộng 1920 và 1366 (cùng số hàng, cùng tỷ lệ cột, sai khác vị trí ≤ 2 điểm ảnh); dưới 768 điểm ảnh 100 % ô xếp chồng, không cuộn ngang.
- **SC-003**: 100 % project định dạng 1.0 hiện có (vector chung và project mẫu) mở, kiểm, nạp xuống với kết quả không đổi.
- **SC-004**: Hai bộ kiểm cho cùng kết quả trên 100 % ca của bộ vector bố cục (ít nhất 40 ca mới); 10.000 cấu hình bố cục hỏng ngẫu nhiên không làm bộ kiểm hay trang vận hành dừng bất thường.
- **SC-005**: Trang vận hành có màn hình Lưới 12 widget, 500 Tag, 10 client, cập nhật 1 giây: CPU thiết bị không tăng so với màn hình Tự do tương đương; CPU trình duyệt ≤ 30 % trên máy văn phòng.
- **SC-006**: Dung lượng mã tải lần đầu của trang vận hành tăng **≤ 400 KB** (nén) so với bản hiện tại; trang không có biểu đồ không tải mã biểu đồ.
- **SC-007**: Ở cả ba chủ đề, 100 % cặp chữ và nền đạt tương phản ≥ 4,5:1 (kiểm tự động); biểu đồ 12 chuỗi phân biệt được từng chuỗi.
- **SC-008**: Người dùng duyệt bảng ảnh chụp trước và sau của 6 màn hình chuẩn và mẫu báo cáo PDF (đạt khi người dùng chấp nhận).
- **SC-009**: Báo cáo PDF mẫu có biểu đồ mở đúng ở ba trình xem phổ biến, hiển thị đủ dấu tiếng Việt, biểu đồ không vỡ hạt khi phóng 400 %.
- **SC-010**: Chuyển một màn hình Tự do 20 widget sang Lưới giữ 100 % widget và binding, xong trong ≤ 1 phút kể cả chỉnh.

## Assumptions

- Quyết định D1 đến D15 của kế hoạch đã chốt ngày 2026-10-19 theo cột Đề xuất: 12 cột cố định; ô tham chiếu component; một component mỗi ô; xếp chồng tự động dưới 768 điểm ảnh, chưa có breakpoint riêng; giữ chế độ Tự do, màn hình mới mặc định Lưới; popup dùng được lưới; không lưới lồng; chiều cao hàng tự động hoặc số điểm ảnh; công cụ chuyển đổi bán tự động làm sau cùng; thư viện biểu đồ hỗn hợp chốt sau khảo sát đo đạc; giữ khung giao diện hiện có và thiết kế lại bộ màu; mặc định Sáng đa sắc; báo cáo PDF có biểu đồ; phông tự chứa; giao diện làm song song với bố cục.
- Đăng nhập bắt buộc và phân quyền theo người dùng (kế hoạch mục 10) thuộc feature 013, không thuộc spec này; phần bảo mật của component (vai trò tối thiểu cho lệnh ghi) giữ nguyên.
- Trình vẽ SVG (đồ họa bên trong một bản vẽ) không đổi.
- Lựa chọn thư viện cụ thể (biểu đồ, bảng màu nguồn, phông) do bước khảo sát trong plan quyết định, theo ràng buộc kích thước, hiệu năng, giấy phép, offline ở FR-041, FR-042, SC-005, SC-006.
- Máy vận hành dùng trình duyệt Chrome hoặc Edge bản hiện hành (như các feature trước).
- Định dạng 1.1.0 dùng chung với feature 013 nếu hai feature giao cùng đợt.
