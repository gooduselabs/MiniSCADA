# Feature Specification: Khung giao diện mới của mAT Studio

**Feature Branch**: `004-studio-shell`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Khung giao diện mới của mAT Studio: GĐ 1 của lộ trình v2, phần Studio. Phần làm việc với thiết bị (tìm thiết bị, HTTPS, đăng nhập, nạp xuống, đọc lên, so sánh) là feature riêng 005. Thay trang form 5 tab của Sprint 1 bằng khung kiểu IDE theo docs/architecture/studio-ux.md và mockup docs/architecture/mockups/studio-shell.html. Khung gồm: thanh tiêu đề và menu, thanh công cụ, cây project (Bắt đầu, Thiết lập project, thiết bị BL335 với Tag, Lưu trữ, Màn hình; mục của giai đoạn sau hiện nhãn giai đoạn), vùng Details, editor dạng tab có dấu chưa lưu, inspector (Thuộc tính, Thông tin, Chẩn đoán), task card (Toolbox, Thư viện, Công cụ online, Tìm), thanh trạng thái (thiết bị, số lỗi và cảnh báo), theme sáng/tối/theo hệ thống, bảng lệnh Ctrl+Shift+P, phím tắt giống TIA Portal, kéo đổi cỡ các vùng và nhớ bố cục, dùng được hoàn toàn bằng bàn phím. Chuyển toàn bộ chức năng Sprint 1 sang khung mới, không mất chức năng nào: mở thư mục project; sửa thiết lập project; bảng Tag (sửa tại ô, thêm/xóa dòng, điền xuống, hoàn tác/làm lại, lọc); kiểm tra liên tục bằng bộ kiểm tra dùng chung với runtime, nhấp vào lỗi để tới đúng ô hoặc mục; lưu theo định dạng chuẩn; xem trước màn hình bằng dữ liệu mô phỏng hoặc dữ liệu sống từ thiết bị; kiểm tra kết nối thiết bị theo địa chỉ nhập tay; mở web thiết bị; thông tin môi trường. Thêm: xem cấu hình lưu trữ (logging.json, chỉ đọc) và trạng thái lưu trữ của thiết bị; chế độ theo dõi khi kết nối thiết bị (viền cam; giá trị sống và quality trong bảng Tag; tab Chẩn đoán với CPU, RAM, số client, trạng thái lưu trữ). Chế độ này chỉ đọc qua API hiện có của runtime, chưa đăng nhập (đăng nhập thuộc 005), và chiếm 1 trong 10 phiên của thiết bị. Lưu được cả khi project còn lỗi để lưu việc làm dở; mọi thao tác đóng gói hay nạp xuống bị chặn khi còn lỗi. Chuỗi giao diện tiếng Việt tách file riêng để thêm tiếng Anh sau. Ngoài phạm vi: tìm thiết bị, HTTPS, đăng nhập, nạp xuống, đọc lên, so sánh (005); lưới Tag kiểu Excel đầy đủ (dán từ Excel, CSV, ≥ 2.000 dòng) và Tag tính toán (GĐ 2); editor màn hình kéo thả và widget (GĐ 3a); gắn Tag cho phần tử SVG bằng giao diện và sự kiện (GĐ 3b); editor lưu trữ (GĐ 5). Ràng buộc: Constitution II (Studio và runtime dùng chung packages, Studio không chứa logic runtime riêng), V (không eval, không innerHTML với dữ liệu project, CSP chặt), VI (test trước). Quyết định đã có: lộ trình v2 được duyệt ngày 2026-10-11; mockup bản 1 chờ người dùng duyệt bố cục và màu (màu nhấn petrol tạm thời, chờ màu thương hiệu)."

## Bối cảnh

Studio Sprint 1 là một trang form 5 tab (Cấu hình, Kiểm tra, Thiết bị, Xem trước, Giới thiệu). Người dùng chê giao diện này "quá xấu, quá cơ bản" (2026-10-10) và muốn học cách tổ chức của TIA Portal. Ngày 2026-10-11 người dùng phản hồi "giao diện vẫn vậy" và duyệt [lộ trình v2](../../docs/plans/roadmap-v2.md) (Phương án B, Constitution 2.0.0).

Lộ trình v2 chia GĐ 1 thành hai feature:

- **004 (feature này):** khung Studio mới và chuyển các chức năng Sprint 1 sang. Không phụ thuộc thiết bị, không đổi runtime, không đổi định dạng project.
- **005:** làm việc với thiết bị: tìm thiết bị trong LAN, HTTPS, đăng nhập và audit, nạp xuống, đọc lên, so sánh.

Định hướng giao diện nằm ở [studio-ux.md](../../docs/architecture/studio-ux.md). Bố cục và màu chốt bằng [mockup tương tác bản 1](../../docs/architecture/mockups/studio-shell.html), đang chờ người dùng duyệt.

Kết nối tới thiết bị trong feature này chỉ **đọc**, qua hai giao diện runtime đã có: thông tin hệ thống (`/api/v1/system/info`) và dữ liệu sống (giao thức live 1.0.0). Trang runtime trên Chrome cũng dùng đúng hai giao diện này. Chưa có đăng nhập; khi 005 thêm đăng nhập, phần kết nối chuyển sang kết nối có xác thực.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Kỹ sư làm việc trong khung kiểu IDE (Priority: P1)

Kỹ sư mở Studio, thấy tab Bắt đầu với project gần đây và tác vụ nhanh. Mở thư mục project, cây project hiện cấu trúc: thiết lập project, thiết bị, Tag, lưu trữ, màn hình. Nhấp một mục để mở editor trong tab; nhiều tab mở cùng lúc. Inspector bên dưới hiện thuộc tính của đối tượng đang chọn. Thanh trạng thái cho biết thiết bị và số lỗi. Kỹ sư kéo đổi cỡ các vùng, đổi theme, gọi bảng lệnh. Lần mở sau, bố cục được giữ nguyên.

**Why this priority**: Đây là thứ người dùng phàn nàn trực tiếp. Mọi editor của các giai đoạn sau (Kết nối, Alarm, Màn hình…) nằm trong khung này, nên phải có khung trước.

**Independent Test**: Mở `projects/tank-demo`, đi qua mọi mục trên cây, mở ba tab, kéo đổi cỡ các vùng, đổi theme tối, đóng rồi mở lại Studio. Làm lại toàn bộ chỉ bằng bàn phím.

**Acceptance Scenarios**:

1. **Given** Studio vừa mở, chưa có project, **When** kỹ sư nhìn vào cửa sổ, **Then** tab Bắt đầu hiện project gần đây và tác vụ nhanh; lệnh cần project (Lưu, Kiểm tra…) bị vô hiệu và tooltip nói lý do.
2. **Given** mở project mẫu, **When** cây project hiện ra, **Then** có Thiết lập project, thiết bị BL335 (tên, địa chỉ đã nhập), Tag › Bảng Tag mặc định (số Tag), Lưu trữ (số nhóm), Màn hình › Tổng quan (đánh dấu màn hình đầu). Mục của giai đoạn sau (Kết nối, Tag tính toán, Bảng giá trị, Alarm, Báo cáo, Người dùng và quyền, Thư viện project) có nhãn giai đoạn và mở ra trang giải thích.
3. **Given** tab Bảng Tag đang mở, **When** nhấp lại mục Bảng Tag trên cây, **Then** Studio chuyển tới tab có sẵn, không mở tab trùng.
4. **Given** kỹ sư đã kéo đổi cỡ cây, inspector, task card, **When** đóng rồi mở lại Studio, **Then** bố cục giữ nguyên; lệnh "Đặt lại bố cục" đưa về mặc định.
5. **Given** bất kỳ editor nào, **When** nhấn Ctrl+Shift+P và gõ "bang tag" (không dấu), **Then** bảng lệnh hiện "Mở Bảng Tag mặc định"; Enter mở đúng tab.
6. **Given** theme sáng, **When** chọn theme tối hoặc theo hệ thống, **Then** mọi vùng đổi ngay, không cần khởi động lại, và lựa chọn được nhớ.
7. **Given** chỉ dùng bàn phím, **When** kỹ sư chuyển giữa cây, editor, inspector, task card và thanh trạng thái, **Then** mọi vùng và mọi lệnh đều tới được, focus luôn thấy rõ.

---

### User Story 2 - Sửa project với kiểm tra liên tục (Priority: P1)

Kỹ sư sửa thiết lập project và bảng Tag ngay trong khung mới. Mỗi lần sửa, Studio kiểm lại bằng đúng bộ kiểm tra của runtime. Ô sai có viền đỏ; tab Thông tin liệt kê lỗi kèm file, vị trí, lý do; nhấp đúp vào lỗi thì nhảy tới đúng ô. Hoàn tác, làm lại, lưu như một công cụ soạn thảo thông thường. Lưu được cả khi còn lỗi để giữ việc làm dở; Studio nói rõ thiết bị sẽ từ chối project lỗi.

**Why this priority**: Đây là chức năng Sprint 1 người dùng đang có; khung mới mà mất nó thì không dùng được. Kiểm tra liên tục và nhảy tới chỗ sai là khác biệt lớn nhất so với form cũ.

**Independent Test**: Mở project mẫu. Sửa Max của một Tag nhỏ hơn Min, theo tab Thông tin tới đúng ô, sửa lại, hoàn tác, làm lại, lưu. So file lưu với file gốc và kiểm bằng công cụ dòng lệnh của runtime.

**Acceptance Scenarios**:

1. **Given** bảng Tag đang mở, **When** sửa Max nhỏ hơn Min rồi xác nhận, **Then** trong ≤ 1 s ô Min và Max có viền đỏ, tab Thông tin có lỗi `E_TAG_RANGE` kèm file và vị trí, thanh trạng thái tăng số lỗi.
2. **Given** tab Thông tin có lỗi trỏ vào một ô, **When** nhấp đúp hoặc Enter trên dòng lỗi, **Then** Studio mở editor chứa ô đó, chọn ô và vào chế độ sửa.
3. **Given** đã sửa nhiều chỗ ở nhiều editor, **When** nhấn Ctrl+Z rồi Ctrl+Y, **Then** sửa đổi được hoàn tác và làm lại theo đúng thứ tự, ở bất kỳ editor nào.
4. **Given** chỉ sửa tên project, **When** lưu, **Then** chỉ `project.json` được ghi; `tags.json` không bị ghi lại; thứ tự khóa và các trường không sửa giữ nguyên.
5. **Given** project còn lỗi, **When** lưu, **Then** file được ghi, Studio báo "còn N lỗi: thiết bị sẽ từ chối project này" và các lệnh đóng gói, nạp xuống bị khóa.
6. **Given** còn thay đổi chưa lưu, **When** đóng cửa sổ hoặc mở project khác, **Then** Studio hỏi Lưu / Không lưu / Hủy.
7. **Given** một file của project bị sửa bên ngoài Studio sau khi mở, **When** lưu, **Then** Studio hỏi Ghi đè / Tải lại / Hủy, không ghi đè âm thầm.
8. **Given** các vector kiểm tra dùng chung (`tests/project-vectors`), **When** mở từng vector trong Studio, **Then** kết luận hợp lệ/không hợp lệ và tập mã lỗi giống công cụ dòng lệnh của runtime.

---

### User Story 3 - Xem trước màn hình và theo dõi thiết bị (Priority: P2)

Kỹ sư mở màn hình Tổng quan và xem trước bằng giá trị mô phỏng, không cần thiết bị. Khi nhập địa chỉ BL335 và kết nối theo dõi, khung làm việc có viền cam, thanh trạng thái hiện thiết bị, bảng Tag có thêm cột giá trị sống và quality, xem trước màn hình chạy bằng dữ liệu thật. Tab Chẩn đoán hiện trạng thái thiết bị và lưu trữ. Ngắt theo dõi thì trả phiên cho thiết bị ngay.

**Why this priority**: Sprint 1 đã có xem trước sống và kiểm kết nối; khung mới phải giữ. Theo dõi giá trị ngay trong bảng Tag (như chế độ monitor của TIA Portal) có ích ngay cả khi chưa có nạp xuống. Xếp sau US1, US2 vì cần thiết bị để kiểm đầy đủ.

**Independent Test**: Mở màn hình Tổng quan ở chế độ Mô phỏng khi không có thiết bị. Sau đó kết nối tới BL335 (hoặc runtime x64 trong Docker), kiểm cột giá trị sống, xem trước bằng dữ liệu thiết bị, rút mạng rồi cắm lại, ngắt theo dõi.

**Acceptance Scenarios**:

1. **Given** không có thiết bị, **When** chọn xem trước Mô phỏng, **Then** màn hình chạy với giá trị tự sinh trong khoảng Min–Max của từng Tag (Tag BOOL bật/tắt theo chu kỳ).
2. **Given** địa chỉ thiết bị sai hoặc thiết bị tắt, **When** kết nối, **Then** trong ≤ 3 s Studio báo không kết nối được, nói rõ lý do, giao diện không treo.
3. **Given** địa chỉ đúng, **When** kết nối theo dõi (Ctrl+K), **Then** vùng làm việc có viền cam; thanh trạng thái hiện tên, địa chỉ, phiên bản runtime, trạng thái project trên thiết bị; bảng Tag có cột giá trị sống và quality ngay sau cột tên.
4. **Given** đang theo dõi, project trên máy có Tag mà thiết bị không có, **When** nhìn bảng Tag, **Then** Tag đó ghi "không có trên thiết bị" thay vì giá trị.
5. **Given** đang theo dõi, **When** mất mạng tới thiết bị, **Then** giá trị chuyển sang trạng thái mất kết nối (không giữ giá trị cũ như còn tốt), Studio tự kết nối lại khi có mạng.
6. **Given** thiết bị đã đủ 10 phiên, **When** kết nối theo dõi, **Then** Studio báo thiết bị đầy và tự thử lại sau 30 s.
7. **Given** đang theo dõi, **When** ngắt (Ctrl+M) hoặc đóng Studio, **Then** thiết bị thấy số phiên giảm 1 trong ≤ 2 s.
8. **Given** đang theo dõi, **When** mở tab Chẩn đoán, **Then** thấy phiên bản runtime và giao thức, số phiên/tối đa, trạng thái project, trạng thái lưu trữ (số dòng, dung lượng) và từng DB ngoài (trạng thái, số dòng chờ, độ trễ, lỗi gần nhất). Thông tin thiết bị chưa cung cấp (CPU, RAM, thời gian chạy) hiện "chưa có".
9. **Given** bất kỳ lúc nào, **When** chọn "Mở web thiết bị", **Then** trang runtime mở trong trình duyệt mặc định.

---

### User Story 4 - Xem cấu hình lưu trữ (Priority: P3)

Kỹ sư mở mục Lưu trữ trên cây để xem cấu hình lưu dữ liệu (feature 003) mà không phải mở file JSON: các nhóm, chế độ ghi, Tag và deadband, thời hạn, DB ngoài, ước tính ghi eMMC. Lỗi cấu hình lưu trữ hiện trong tab Thông tin như mọi lỗi khác.

**Why this priority**: Lưu trữ đã chạy trên thiết bị nhưng Studio chưa có chỗ xem. Editor sửa đầy đủ thuộc GĐ 5; xem chỉ đọc đủ để kỹ sư kiểm cấu hình.

**Independent Test**: Mở project mẫu, mở Lưu trữ, đối chiếu từng giá trị với `logging.json`. Sửa tay `logging.json` cho sai một Tag, kiểm lỗi hiện trong tab Thông tin.

**Acceptance Scenarios**:

1. **Given** project mẫu có 2 nhóm lưu trữ, **When** mở Lưu trữ, **Then** thấy cả 2 nhóm với chế độ, khoảng ghi, Tag và deadband, thời hạn, đích gửi; kết nối DB ngoài hiện loại, máy chủ, bảng, chế độ TLS và không có mật khẩu.
2. **Given** cấu hình có cảnh báo (ví dụ TLS không xác thực máy chủ, vượt ngân sách ghi), **When** mở Lưu trữ, **Then** cảnh báo hiện ngay cạnh mục liên quan và trong tab Thông tin.
3. **Given** project không có cấu hình lưu trữ, **When** mở Lưu trữ, **Then** Studio nói project chưa lưu dữ liệu và chỉ tới tài liệu cấu hình.

---

### Edge Cases

- Thư mục không có `project.json` hoặc JSON hỏng: Studio vẫn mở, cây hiện phần đọc được, tab Thông tin báo `E_FILE_MISSING` / `E_JSON` như runtime.
- Project có 500 Tag: mở bảng, cuộn, sửa vẫn mượt (lưới ảo hóa cho ≥ 2.000 dòng thuộc GĐ 2).
- Cửa sổ thu nhỏ tới mức tối thiểu (960 × 600): task card và Details tự thu gọn, không có vùng nào bị che mất nội dung không cuộn được.
- Thiết bị chạy project khác project đang mở: thanh trạng thái báo "thiết bị đang chạy project khác (tên, phiên bản)"; theo dõi vẫn hiện giá trị cho các Tag trùng tên.
- Thiết bị chạy runtime cũ không có khối lưu trữ trong thông tin hệ thống: Chẩn đoán ghi "thiết bị không báo trạng thái lưu trữ", không lỗi.
- Thiết bị từ chối kết nối dữ liệu sống (Origin, phiên bản giao thức không tương thích): báo đúng lý do, không thử lại liên tục.
- Đổi theme của Windows khi Studio đang chạy ở chế độ theo hệ thống: Studio đổi theo.
- Hoàn tác sau khi lưu: vẫn hoàn tác được; tab hiện lại dấu chưa lưu.
- Sửa nhanh liên tục: kiểm tra không làm chậm việc gõ; kết quả kiểm tra luôn ứng với nội dung mới nhất.
- Tên Tag đổi trong bảng khi màn hình đang dùng Tag đó: Thông tin báo `E_REF_TAG` ở binding liên quan (Studio không tự đổi theo trong feature này).

## Requirements *(mandatory)*

### Functional Requirements

**Khung cửa sổ**

- **FR-001**: Cửa sổ chính MUST có: thanh tiêu đề kèm menu (Project, Sửa, Xem, Online, Công cụ, Trợ giúp), thanh công cụ, cây project, vùng Details, vùng editor dạng tab, inspector (Thuộc tính, Thông tin, Chẩn đoán), task card (Toolbox, Thư viện, Công cụ online, Tìm), thanh trạng thái. Bố cục theo mockup đã duyệt.
- **FR-002**: Kỹ sư MUST kéo đổi cỡ được cây, Details, inspector, task card và thu gọn được task card. Bố cục và theme MUST được nhớ qua các lần mở; MUST có lệnh "Đặt lại bố cục".
- **FR-003**: Tab Bắt đầu MUST hiện: tối đa 10 project gần đây (mở bằng một lần nhấp; mục không còn tồn tại thì báo và cho bỏ khỏi danh sách), tác vụ nhanh (mở project, kiểm tra, kết nối thiết bị), và chức năng nào thuộc giai đoạn nào của lộ trình.
- **FR-004**: Cây project MUST dựng từ các file project: Thiết lập project; thiết bị (tên, địa chỉ đã nhập); Tag › Bảng Tag mặc định (số Tag); Lưu trữ (số nhóm); Màn hình › từng màn hình (đánh dấu màn hình đầu). Mục của giai đoạn sau MUST hiện kèm nhãn giai đoạn, mở ra trang nói chức năng làm gì và ở giai đoạn nào; nhãn giai đoạn tắt được.
- **FR-005**: Mở một mục trên cây MUST mở editor trong tab mới hoặc chuyển tới tab đã mở. Tab và tiêu đề cửa sổ MUST có dấu khi còn thay đổi chưa lưu. Đóng tab MUST NOT làm mất thay đổi chưa lưu.
- **FR-006**: Inspector › Thuộc tính MUST hiện thuộc tính của đối tượng đang chọn (Tag, phần tử màn hình, nhóm lưu trữ, project). Với Tag, MUST hiện "Dùng ở đâu": phần tử màn hình và thuộc tính gắn với Tag đó, nhóm lưu trữ có Tag đó.
- **FR-007**: Với phần tử màn hình, inspector MUST hiện các binding (thuộc tính, Tag, cách đổi giá trị) ở dạng chỉ đọc. Sửa binding bằng giao diện thuộc GĐ 3b.
- **FR-008**: Thanh trạng thái MUST hiện: trạng thái thiết bị (không kết nối, hoặc đang theo dõi kèm tên, địa chỉ, phiên bản runtime, trạng thái project trên thiết bị); số lỗi và cảnh báo (nhấp vào mở tab Thông tin); tiến trình của thao tác dài.
- **FR-009**: Bảng lệnh (Ctrl+Shift+P) MUST tìm được mọi lệnh có trong menu theo tên, gõ có dấu hay không dấu đều khớp, hiện phím tắt, chạy lệnh bằng Enter.
- **FR-010**: Phím tắt MUST gồm: Ctrl+S lưu, Ctrl+Z hoàn tác, Ctrl+Y làm lại, Ctrl+F tìm, Ctrl+Shift+P bảng lệnh, Ctrl+D điền xuống, F2 sửa ô, F7 kiểm tra, Ctrl+K kết nối theo dõi, Ctrl+M ngắt (Ctrl+K/Ctrl+M giống TIA Portal). Ctrl+L để dành cho Nạp xuống (005).
- **FR-011**: Mọi lệnh và mọi vùng MUST dùng được chỉ bằng bàn phím. Cây, lưới, tab MUST điều hướng bằng phím mũi tên theo mẫu ARIA tương ứng; focus MUST luôn thấy rõ.
- **FR-012**: MUST có theme sáng, tối, theo hệ thống, đổi tức thì. Màu trạng thái cố định trong cả Studio: xanh lá là tốt, hổ phách là cảnh báo, đỏ là lỗi, xanh dương là thông tin, cam là đang kết nối thiết bị, xám là không kết nối. Màu MUST NOT là tín hiệu duy nhất (luôn kèm icon hoặc chữ). Tương phản chữ MUST ≥ 4,5:1 ở cả hai theme.
- **FR-013**: Màu nhấn MUST khai báo ở một chỗ để đổi sang màu thương hiệu mà không sửa từng thành phần.
- **FR-014**: Chuỗi giao diện tiếng Việt MUST nằm trong file chuỗi riêng, không viết rải trong mã, để thêm tiếng Anh sau.
- **FR-015**: Studio MUST tôn trọng chế độ giảm hiệu ứng của Windows; chuyển động ≤ 150 ms.

**Project, kiểm tra, lưu**

- **FR-016**: Studio MUST mở thư mục project qua hộp thoại của hệ điều hành và chỉ đọc/ghi trong thư mục đã chọn (giữ FR-037 của Sprint 1).
- **FR-017**: Studio MUST kiểm tra project bằng bộ kiểm tra dùng chung với runtime sau mỗi thay đổi, không cần bấm nút; kết quả ứng với nội dung mới nhất. Lệnh Kiểm tra (F7) MUST đọc lại các file trên đĩa và kiểm toàn bộ.
- **FR-018**: Tab Thông tin MUST liệt kê lỗi và cảnh báo với mã, file, vị trí, lý do. Nhấp đúp hoặc Enter MUST mở editor liên quan và chọn đúng ô hoặc trường. Ô lỗi MUST có viền đỏ và cho xem lý do khi trỏ chuột hoặc focus.
- **FR-019**: Editor Thiết lập project MUST cho sửa tên, phiên bản, màn hình đầu, số client tối đa (1–10); mã project và runtime tối thiểu chỉ đọc. Mỗi ô có dòng trợ giúp; lỗi hiện ngay tại ô.
- **FR-020**: Bảng Tag MUST có các cột tên, kiểu, nguồn (chỉ đọc), đơn vị, Min, Max, mô tả và cho:
  - chọn ô, di chuyển bằng phím mũi tên và Tab;
  - sửa bằng nhấp đúp, F2, Enter hoặc gõ thẳng; Enter xác nhận, Esc hủy;
  - thêm dòng (tên tự tăng số, ví dụ `TANK02.LEVEL` → `TANK03.LEVEL`), xóa dòng;
  - điền xuống (Ctrl+D; cột tên tự tăng số);
  - lọc theo tên và mô tả.
- **FR-021**: Hoàn tác và làm lại MUST áp dụng cho mọi sửa đổi project (Tag, thiết lập), ít nhất 100 bước, qua mọi editor.
- **FR-022**: Lưu (Ctrl+S) MUST ghi mọi file đã đổi theo định dạng chuẩn (JSON thụt 2 dấu cách, xuống dòng ở cuối), MUST NOT ghi lại file không đổi, MUST giữ thứ tự khóa và các trường không sửa (khắc phục FR-033 của audit Sprint 1).
- **FR-023**: Studio MUST cho lưu cả khi project còn lỗi hoặc cảnh báo. Khi còn lỗi, Studio MUST nói rõ thiết bị sẽ từ chối project và MUST khóa mọi lệnh đóng gói, nạp xuống. Đây là thay đổi so với FR-033 của Sprint 1 (chặn lưu): lưu việc làm dở không nguy hiểm vì thiết bị và bước nạp xuống vẫn chặn project lỗi (Constitution V).
- **FR-024**: Khi còn thay đổi chưa lưu, đóng cửa sổ hoặc mở project khác MUST hỏi Lưu / Không lưu / Hủy.
- **FR-025**: Trước khi ghi, nếu file trên đĩa đã bị sửa bên ngoài kể từ lúc đọc, Studio MUST hỏi Ghi đè / Tải lại / Hủy và MUST NOT ghi đè âm thầm.
- **FR-026**: Editor Lưu trữ MUST hiện cấu hình lưu trữ ở dạng chỉ đọc:
  - từng nhóm: tên, chế độ, chu kỳ hoặc khoảng ghi, Tag và deadband, thời hạn, đích gửi;
  - từng kết nối DB ngoài: loại, máy chủ, bảng, chế độ TLS (không có mật khẩu, vì mật khẩu không nằm trong project);
  - ước tính ghi eMMC theo cùng công thức với bộ kiểm tra.

**Thiết bị (chỉ đọc)**

- **FR-027**: Studio MUST cho nhập và ghi nhớ địa chỉ thiết bị (IP hoặc tên, cổng) và kiểm kết nối như Sprint 1. Không kết nối được thì MUST báo trong ≤ 3 s, nói rõ lý do, không treo giao diện.
- **FR-028**: Khi kết nối theo dõi:
  - vùng làm việc MUST có viền cam; thanh trạng thái và nút trên cây MUST hiện trạng thái thiết bị;
  - bảng Tag MUST có cột giá trị sống và quality ngay sau cột tên;
  - Tag mà thiết bị không có MUST ghi "không có trên thiết bị";
  - mất kết nối thì giá trị MUST chuyển sang trạng thái mất kết nối, và Studio MUST tự kết nối lại.
- **FR-029**: Tab Chẩn đoán MUST hiện mọi thông tin thiết bị cung cấp, cập nhật ít nhất 5 s một lần khi đang theo dõi:
  - phiên bản runtime và giao thức, số phiên trên tối đa, trạng thái project;
  - lưu trữ: trạng thái, số dòng, dung lượng;
  - từng DB ngoài: trạng thái, số dòng chờ, độ trễ, lỗi gần nhất.

  Thông tin thiết bị chưa cung cấp (CPU, RAM, thời gian chạy; thêm ở 005) MUST hiện "chưa có".
- **FR-030**: Kết nối theo dõi chiếm 1 trong 10 phiên của thiết bị. Thiết bị đầy thì Studio MUST báo rõ và tự thử lại sau 30 s (giữ hành vi Sprint 1). Ngắt theo dõi hoặc đóng Studio MUST trả phiên ngay.
- **FR-031**: Feature này MUST NOT ghi gì xuống thiết bị. Lệnh nạp xuống, đọc lên, so sánh hiện trên menu nhưng bị khóa với ghi chú "có ở feature 005".
- **FR-032**: Xem trước màn hình MUST có ba chế độ:
  - Tắt;
  - Mô phỏng: giá trị tự sinh trong khoảng Min–Max của từng Tag, Tag BOOL bật/tắt theo chu kỳ; chỉ để xem trước, không thay mô phỏng Tag của GĐ 2;
  - Thiết bị: dữ liệu sống.

  Xem trước MUST dùng cùng package hiển thị, binding và dữ liệu sống với runtime web (Constitution II). MUST có phóng to, thu nhỏ, vừa khung, và nhấp chọn phần tử để xem thuộc tính, binding trong inspector.
- **FR-033**: Studio MUST mở trang runtime của thiết bị trong trình duyệt mặc định (chỉ `http(s)://`).
- **FR-034**: Trợ giúp › Giới thiệu MUST hiện phiên bản Studio và môi trường chạy (thay tab Giới thiệu cũ).

**An toàn và kiểm thử**

- **FR-035**: Studio MUST giữ các ràng buộc an toàn của Sprint 1: không thực thi mã từ dữ liệu project, không chèn dữ liệu project vào giao diện dưới dạng HTML, chính sách nội dung chặt (chỉ chạy mã của Studio), chỉ đọc/ghi trong thư mục project, chỉ kết nối tới địa chỉ thiết bị do người dùng nhập (Constitution V).
- **FR-036**: Studio MUST NOT có logic runtime riêng. Kiểm tra, hiển thị màn hình, binding, dữ liệu sống, ước tính lưu trữ dùng các package chung với runtime (Constitution II).
- **FR-037**: Test MUST được viết trước cho phần logic không phụ thuộc giao diện (Constitution VI):
  - mô hình project, sửa đổi, hoàn tác/làm lại;
  - lưu giữ thứ tự khóa;
  - dựng cây project từ file;
  - ánh xạ lỗi tới editor và ô;
  - tìm lệnh không dấu.

  MUST có test giao diện tự động đi qua các luồng chính, kiểm bàn phím và trợ năng cơ bản.

### Key Entities

- **Không gian làm việc**: kích thước các vùng, task card mở hay thu, theme, project gần đây, địa chỉ thiết bị đã nhập. Lưu cục bộ trên máy kỹ sư, không nằm trong project.
- **Project đang mở**: nội dung các file project (`project.json`, `tags.json`, `logging.json`, màn hình, binding), trạng thái chưa lưu từng file, dấu thời gian đọc từ đĩa, lịch sử hoàn tác.
- **Kết quả kiểm tra**: danh sách lỗi và cảnh báo (mã, file, vị trí trong file, lý do, mức), mỗi mục ánh xạ tới editor và ô hoặc trường.
- **Kết nối theo dõi**: địa chỉ thiết bị, thông tin hệ thống mới nhất, phiên dữ liệu sống (Tag đã đăng ký, Tag thiết bị không có, trạng thái kết nối).
- **Lệnh**: tên hiển thị, phím tắt, nhóm menu, điều kiện bật (ví dụ cần project, cần kết nối thiết bị) và lý do khi bị khóa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100 % chức năng Studio của Sprint 1 (FR-032 tới FR-037 của `specs/002-vertical-slice`) làm được trong khung mới, theo bảng đối chiếu từng chức năng.
- **SC-002**: Một kỹ sư chưa dùng Studio mới mở project mẫu, sửa một Tag lỗi theo chỉ dẫn của tab Thông tin, lưu, và xem trước màn hình bằng mô phỏng trong ≤ 3 phút, không cần hướng dẫn.
- **SC-003**: Lỗi do một lần sửa hiện tại ô và trên thanh trạng thái trong ≤ 1 s. Với project 500 Tag, gõ trong ô không có độ trễ nhận thấy được (≤ 100 ms mỗi phím).
- **SC-004**: Studio mở tới tab Bắt đầu trong ≤ 3 s; mở project mẫu tới cây đầy đủ trong ≤ 2 s.
- **SC-005**: 100 % lệnh trong menu dùng được chỉ bằng bàn phím. Kiểm trợ năng tự động không có lỗi mức nghiêm trọng ở cửa sổ chính và các editor. Tương phản chữ ≥ 4,5:1 ở cả hai theme.
- **SC-006**: Trên bộ vector kiểm tra dùng chung, kết luận của Studio trùng 100 % với công cụ dòng lệnh của runtime. File do Studio lưu được runtime chấp nhận, và diff chỉ chứa phần đã sửa.
- **SC-007**: Khi theo dõi, giá trị trong bảng Tag lệch so với trang runtime trên Chrome không quá 1 s. Sau khi ngắt theo dõi, thiết bị báo số phiên giảm trong ≤ 2 s.
- **SC-008**: Người dùng duyệt giao diện bản build (đối chiếu với mockup đã duyệt) trước khi đóng feature.

## Assumptions

- Mockup bản 1 là chuẩn bố cục. Điều người dùng muốn đổi khi duyệt mockup được cập nhật vào spec này trước khi lập plan.
- Màu nhấn petrol là tạm thời (quyết định 6 của lộ trình); đổi sang màu thương hiệu chỉ cần đổi một chỗ (FR-013).
- Cho lưu khi project còn lỗi (FR-023) là đề xuất của mockup; người dùng xác nhận khi duyệt mockup.
- Mỗi project có một thiết bị; cây project chừa chỗ cho nhiều thiết bị sau này.
- Feature này không đổi runtime, không đổi định dạng project hay schema; chỉ đọc `logging.json`.
- Kết nối theo dõi dùng giao diện mở hiện có của runtime (thông tin hệ thống, dữ liệu sống). Từ feature 005, kết nối này cần đăng nhập.
- Máy kỹ sư chạy Windows 10/11, màn hình từ 1366 × 768; cửa sổ Studio tối thiểu 960 × 600.
- Bộ cài vẫn theo cách của Sprint 1 (NSIS, WebView2 kèm theo).
- Ngăn xếp giao diện (thư viện thành phần, docking, lưới, icon) chốt ở plan bằng ADR-009.
- Phụ thuộc: bộ kiểm tra, hiển thị SVG, binding, client dữ liệu sống và ước tính lưu trữ trong `packages/*`; giao thức live 1.0.0 và `/api/v1/system/info` của runtime 0.3.0.
