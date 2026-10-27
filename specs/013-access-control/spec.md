# Feature Specification: Đăng nhập bắt buộc, phân quyền theo người dùng và trang Quản trị trên web

**Feature Branch**: `013-access-control`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Phải có trang login, chưa login là phải vào trang login trước; phân quyền theo user, gán quyền cho các trang, component; trên giao diện web có phần quản lý tài khoản với admin và phân quyền." Nguồn và các quyết định đã chốt D16–D26: [docs/plans/screen-grid-layout.md](../../docs/plans/screen-grid-layout.md) mục 10 và 11.

## Bối cảnh

Trang vận hành đã có đăng nhập qua HTTPS (phiên cookie HttpOnly, CSRF, khóa tạm khi sai 5 lần, audit), nhưng:

- xem mặc định **không cần đăng nhập** (`viewerLogin: off`); khi bật `required`, trang chưa đăng nhập chỉ hiện thông báo "cần đăng nhập" chứ không đưa về trang đăng nhập;
- quyền chỉ theo **4 vai trò cố định** (viewer, operator, engineer, administrator); lệnh ghi có vai trò tối thiểu; **không** có quyền theo trang, theo component, theo từng người hay nhóm;
- tài khoản chỉ tạo được bằng **dòng lệnh trên thiết bị** qua SSH; không có trang quản trị.

Người dùng (2026-10-19) yêu cầu: (1) chưa đăng nhập thì mọi đường vào dẫn tới trang đăng nhập; (2) quản trị viên cấp quyền **xem từng trang** và **xem hoặc thao tác từng component** cho **từng người dùng hoặc nhóm**; (3) quản trị viên làm tất cả việc này **ngay trên trang web**, không SSH, không mở Studio, không nạp lại project.

Ràng buộc của [Constitution](../../.specify/memory/constitution.md) 2.0.2:

- **V (an toàn, offline):** thực thi quyền ở **máy chủ** cho mọi đường dữ liệu; ẩn trên giao diện không phải là bảo mật. Không tải gì từ Internet.
- **III:** ngân sách BL335 không đổi (RSS ≤ 150 MB, CPU ≤ 30 % với 500 Tag, 1 s, 10 client).
- **II:** luật kiểm project ở Studio và runtime cho cùng kết quả trên vector chung.
- **VI:** test viết trước; **VII:** định dạng theo SemVer, project cũ mở nguyên trạng.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mọi người phải đăng nhập trước khi xem (Priority: P1)

Người vận hành mở địa chỉ thiết bị (hoặc một liên kết trực tiếp tới một màn hình) khi chưa đăng nhập; trang đăng nhập hiện ra; sau khi đăng nhập đúng, người đó vào thẳng trang đã định mở. Hết phiên do để rảnh thì quay lại trang đăng nhập, đăng nhập lại về đúng chỗ cũ.

**Why this priority**: là điều kiện của mọi quyền theo người dùng; không biết ai đang xem thì không phân quyền được.

**Independent Test**: với project bật đăng nhập bắt buộc, mở `/#/bom-1` khi chưa có phiên → thấy trang đăng nhập; đăng nhập → thấy màn hình Bơm 1; gọi thẳng các địa chỉ dữ liệu (project, màn hình, dữ liệu sống, lịch sử, báo cáo, alarm) không có phiên → bị từ chối, không có dữ liệu.

**Acceptance Scenarios**:

1. **Given** project có đăng nhập bắt buộc và chưa có phiên, **When** mở bất kỳ trang nào qua HTTPS, **Then** trình duyệt tới trang đăng nhập, kèm địa chỉ cần quay lại.
2. **Given** đang ở trang đăng nhập với địa chỉ quay lại `/#/bom-1`, **When** đăng nhập đúng, **Then** mở màn hình Bơm 1; địa chỉ quay lại trỏ ra ngoài thiết bị (ví dụ `https://evil.example`) thì bị bỏ, mở trang đầu.
3. **Given** chưa có phiên, **When** gọi thẳng địa chỉ dữ liệu, **Then** máy chủ trả từ chối (401) và không có Tag, giá trị, cấu hình màn hình nào trong phản hồi.
4. **Given** project bắt buộc đăng nhập, **When** mở bằng HTTP, **Then** trang chỉ báo "cần mở bằng HTTPS" kèm liên kết, không hiện dữ liệu.
5. **Given** phiên hết do rảnh, **When** người dùng thao tác, **Then** về trang đăng nhập với địa chỉ quay lại là trang đang xem.
6. **Given** thiết bị đang để `viewerLogin: off`, **When** nâng cấp runtime, **Then** cách xem không đổi; trang Quản trị cảnh báo rõ "xem không cần đăng nhập".
7. **Given** bản cài mới, **Then** mặc định đăng nhập bắt buộc.

---

### User Story 2 - Quản trị viên quản lý tài khoản trên trang web (Priority: P1)

Quản trị viên đăng nhập trang web, mở mục **Quản trị**, thêm người dùng, đặt vai trò, gán nhóm, tắt và mở tài khoản, mở khóa tạm, đặt lại mật khẩu; tạo, đổi tên, xóa nhóm. Không cần SSH, không mở Studio.

**Why this priority**: yêu cầu trực tiếp của người dùng; không có thì không ai gán được quyền theo người.

**Independent Test**: admin tạo người dùng `vh3` (operator, nhóm "Ca A") trên web, đăng xuất, `vh3` đăng nhập được ngay; admin tắt `vh3`, phiên đang mở của `vh3` bị đăng xuất; mọi thao tác có dòng nhật ký.

**Acceptance Scenarios**:

1. **Given** đăng nhập là administrator, **Then** menu có mục **Quản trị**; vai trò khác không có mục này và gọi thẳng API quản trị thì bị 403 và ghi nhật ký.
2. **Given** tab Người dùng, **When** thêm người dùng với mật khẩu 15 đến 128 ký tự (hoặc bấm sinh ngẫu nhiên, mật khẩu hiện một lần), **Then** người đó đăng nhập được ngay; mật khẩu sai quy tắc bị từ chối kèm lý do.
3. **Given** một người dùng đang có phiên, **When** admin đổi vai trò, nhóm, tắt tài khoản hoặc đặt lại mật khẩu, **Then** mọi phiên của người đó bị hủy ngay (D23).
4. **Given** chỉ còn một administrator đang bật, **When** admin xóa, tắt hoặc hạ vai trò người đó, **Then** bị từ chối "phải còn ít nhất một quản trị viên".
5. **Given** thao tác nhạy cảm (đặt lại mật khẩu, hạ vai trò, xóa người dùng, xóa nhóm), **When** admin xác nhận, **Then** phải nhập lại mật khẩu của chính mình.
6. **Given** tab Nhóm, **When** xóa nhóm còn thành viên hoặc còn trong quy tắc quyền, **Then** bị chặn kèm danh sách nơi đang dùng.
7. **Given** bất kỳ người dùng đã đăng nhập, **When** mở **Đổi mật khẩu của tôi** và nhập đúng mật khẩu cũ, **Then** đổi được; các phiên khác của người đó bị hủy.
8. **Given** tab Nhật ký, **Then** thấy đăng nhập, từ chối quyền, thay đổi quản trị gần đây (ai, lúc nào, giá trị cũ và mới, không có mật khẩu).
9. Dòng lệnh `mat-runtime --user-*` vẫn dùng được và đọc cùng dữ liệu (khôi phục khi mất admin).

---

### User Story 3 - Phân quyền xem theo trang (Priority: P1)

Admin mở tab **Quyền theo trang**, thấy ma trận trang × (nhóm, người dùng, vai trò); tích ô để cho xem. Người không được xem một trang thì trang đó không có trong menu, gõ địa chỉ trực tiếp ra "không có quyền", và **dữ liệu của trang đó không tới trình duyệt của họ**.

**Why this priority**: phần cốt lõi của "phân quyền theo user".

**Independent Test**: người `vh1` (nhóm Ca A) được xem Tổng quan, không được xem Bảo trì; menu của `vh1` không có Bảo trì; mở `/#/bao-tri` ra trang "không có quyền"; theo dõi luồng dữ liệu sống của `vh1` không thấy Tag chỉ dùng ở Bảo trì; lịch sử và báo cáo không trả Tag đó.

**Acceptance Scenarios**:

1. **Given** không có quy tắc cho trang, **Then** dùng mặc định của project (mọi người đã đăng nhập được xem trừ khi project đặt vai trò tối thiểu cao hơn).
2. **Given** quy tắc trang Bảo trì chỉ cho nhóm "Bảo trì", **When** `vh1` (không thuộc nhóm) tải cấu hình màn hình Bảo trì, **Then** máy chủ trả 403 và ghi nhật ký.
3. **Given** như trên, **When** `vh1` đăng ký dữ liệu sống của Tag chỉ dùng ở Bảo trì (gửi tay qua kết nối dữ liệu), **Then** máy chủ không gửi giá trị của Tag đó.
4. **Given** như trên, **When** `vh1` truy vấn lịch sử hoặc báo cáo có Tag đó, **Then** Tag đó bị loại (hoặc từ chối nếu chỉ hỏi Tag đó).
5. Trang hệ thống (Alarm, Lịch sử, Báo cáo, Bảng theo dõi) phân quyền như màn hình; administrator luôn xem được mọi trang hệ thống và Quản trị.
6. "Đặt cho nhiều trang" và "Sao chép quyền từ trang khác" áp một lần cho nhiều trang.
7. Quyền chỉ **thu hẹp**: người có vai trò viewer trong nhóm được phép vẫn không ghi được.

---

### User Story 4 - Phân quyền xem và thao tác theo component (Priority: P2)

Admin mở tab **Quyền theo component**, chọn một màn hình, thấy **xem trước màn hình** và danh sách component; bấm một component để đặt **Ai được xem** và **Ai được thao tác**; thấy ngay danh sách những người thấy và thao tác được. Người thiếu quyền xem thì component bị ẩn; thiếu quyền thao tác thì component hiện khóa kèm lý do; lệnh ghi gửi tay vẫn bị máy chủ từ chối.

**Why this priority**: tinh hơn quyền theo trang; cần US3 trước.

**Independent Test**: nút "Chạy bơm" chỉ cho nhóm Quản đốc thao tác: `vh1` thấy nút khóa với chú thích "cần quyền"; `vh1` gửi lệnh ghi bằng `curl` có phiên và CSRF hợp lệ → bị từ chối, có dòng nhật ký; thẻ "Chi phí điện" chỉ cho Quản đốc xem: `vh1` không thấy thẻ, không nhận giá trị Tag của nó.

**Acceptance Scenarios**:

1. **Given** component có quyền xem chỉ cho nhóm X, **When** người ngoài nhóm mở màn hình, **Then** component không hiển thị (ô lưới để trống) và Tag chỉ component đó dùng không tới trình duyệt.
2. **Given** component điều khiển (nút, công tắc, ô đặt giá trị, thanh trượt, chọn danh sách) có quyền thao tác chỉ cho nhóm Y, **When** người ngoài nhóm xem, **Then** component hiện khóa có biểu tượng và chú thích "cần quyền thao tác".
3. **Given** như trên, **When** người đó gửi lệnh ghi trực tiếp, **Then** máy chủ từ chối, ghi nhật ký "thiếu quyền thao tác".
4. **Given** component chỉ hiển thị (thẻ giá trị, biểu đồ), **Then** trang Quản trị không cho đặt quyền thao tác.
5. **Given** kỹ sư đặt mặc định trong project (`view`, `operate` theo vai trò tối thiểu), **When** chưa có quy tắc trên thiết bị, **Then** dùng mặc định đó.
6. **Given** admin bật **Xem với tư cách** người dùng X, **Then** thấy màn hình đúng như X thấy (ẩn, khóa), chỉ đọc, có dòng nhật ký.

---

### User Story 5 - Quy tắc quyền sống qua cập nhật project (Priority: P3)

Kỹ sư nạp xuống phiên bản project mới; quy tắc của trang và component còn giữ nguyên định danh vẫn áp dụng; quy tắc trỏ tới trang hoặc component đã bị xóa hay đổi định danh được trang Quản trị báo là **mồ côi** và cho dọn.

**Independent Test**: có quy tắc cho màn hình `bao-tri` và nút `chay-bom`; nạp project mới đã đổi tên nút thành `chay-bom-1`: quy tắc của `bao-tri` còn hiệu lực, quy tắc `chay-bom` hiện mồ côi; bấm Dọn thì mất; nút mới dùng mặc định của project.

**Acceptance Scenarios**:

1. Nạp project không xóa quy tắc của tài nguyên còn định danh.
2. Quy tắc mồ côi không cấp quyền cho tài nguyên nào khác.
3. Nhóm hoặc người dùng bị xóa thì bị gỡ khỏi mọi quy tắc (kèm nhật ký).

### Edge Cases

- Kho quyền trên thiết bị hỏng hoặc sai định dạng: runtime vẫn chạy, chỉ administrator vào được (và mọi người khác bị từ chối), trang Quản trị báo lỗi và cho khôi phục bản sao trước.
- Hai admin sửa cùng lúc: thay đổi sau dựa trên phiên bản cũ bị từ chối "dữ liệu đã đổi, tải lại" (không ghi đè lặng lẽ).
- Người dùng thuộc nhiều nhóm: được quyền nếu **bất kỳ** người nhận nào khớp (nhóm, chính mình, vai trò, `*`) và vai trò đủ mức.
- Màn hình được xem nhưng mọi component bị ẩn: trang hiện trống kèm "không có nội dung bạn được xem".
- Popup: quyền theo popup như trang; nút mở popup mà người dùng không xem được popup thì khóa.
- Tag dùng ở cả trang được xem và trang bị cấm: vẫn gửi (vì được xem ở trang được phép).
- Tag tính toán / logic dùng Tag bị cấm làm đầu vào: chỉ lọc theo Tag mà component trên trang dùng trực tiếp; đầu vào gián tiếp không lộ giá trị.
- Bộ đếm giới hạn tần suất của API quản trị, thân yêu cầu quá lớn, JSON sai: từ chối trước khi xử lý.
- Thiết bị không còn administrator nào (sửa tay tệp): dòng lệnh vẫn tạo được.
- Trang mở ở nhiều thẻ: đăng xuất hoặc hủy phiên ở một thẻ thì thẻ khác về trang đăng nhập ở lần gọi kế tiếp.

## Requirements *(mandatory)*

### Functional Requirements

**Đăng nhập bắt buộc**

- **FR-001**: Thiết bị có chế độ xem `required` (mặc định cho bản cài mới) và `off` (thiết bị đang chạy giữ giá trị hiện có khi nâng cấp). Chế độ là cấu hình của thiết bị (`runtime.json`, khóa `viewerLogin` có sẵn), không thuộc project. Khi `required`, mọi trang, cấu hình project, màn hình, dữ liệu sống, lịch sử, báo cáo, alarm cần phiên hợp lệ.
- **FR-002**: Trang vận hành chưa có phiên chuyển tới trang đăng nhập kèm địa chỉ quay lại; chỉ nhận địa chỉ quay lại là đường dẫn nội bộ của trang vận hành (chống chuyển hướng mở).
- **FR-003**: Hết phiên (rảnh hoặc quá thời gian tối đa, hoặc bị hủy) → trang về đăng nhập với địa chỉ quay lại là trang đang xem.
- **FR-004**: Khi `required`, HTTP chỉ hiện thông báo và liên kết HTTPS, không trả dữ liệu.
- **FR-005**: Mọi người dùng đã đăng nhập đổi được mật khẩu của mình (nhập mật khẩu cũ; quy tắc 15–128 ký tự); đổi xong hủy các phiên khác của người đó.
- **FR-006**: Trang Quản trị và chẩn đoán thiết bị trong Studio hiện rõ chế độ xem đang là `off` (cảnh báo "xem không cần đăng nhập").

**Người dùng và nhóm**

- **FR-010**: Người dùng có tên, vai trò (một trong 4 vai trò), nhóm (0..n), trạng thái bật/tắt, thời điểm đăng nhập cuối; dữ liệu cũ thiếu nhóm được hiểu là không nhóm.
- **FR-011**: Nhóm có định danh ổn định, tên hiển thị; tạo, đổi tên, xóa (chặn khi còn thành viên hoặc còn trong quy tắc).
- **FR-012**: Thêm, tắt, mở, mở khóa tạm, đổi vai trò, gán nhóm, đặt lại mật khẩu, xóa người dùng; mật khẩu sinh ngẫu nhiên hiện đúng một lần.
- **FR-013**: Không cho xóa, tắt, hạ vai trò administrator cuối cùng đang bật.
- **FR-014**: Đổi vai trò, nhóm, trạng thái, mật khẩu của một người → hủy ngay mọi phiên của người đó (D23).
- **FR-015**: Thao tác nhạy cảm đòi nhập lại mật khẩu của admin.
- **FR-016**: Dòng lệnh trên thiết bị tiếp tục quản lý người dùng trên cùng dữ liệu.

**Mô hình quyền**

- **FR-020**: Tài nguyên phân quyền: màn hình, popup, trang hệ thống (Alarm, Lịch sử, Báo cáo, Bảng theo dõi), component (định danh `màn hình/id item`). Hai mức: `view` (mọi tài nguyên), `operate` (chỉ component điều khiển).
- **FR-021**: Người nhận trong quy tắc: `group:<id>`, `user:<tên>`, `role:<vai trò>`, `*` (mọi người đã đăng nhập).
- **FR-022**: Quyền hiệu lực = (khớp ít nhất một người nhận của quy tắc, hoặc không có quy tắc và mặc định project cho phép) **và** vai trò đạt mức tối thiểu của mức đó (`view`: viewer, `operate`: operator, cộng mức tối thiểu khai trong project). Quyền không bao giờ vượt vai trò.
- **FR-023**: Component nằm trên trang không được xem thì cũng không được xem; component điều khiển không được xem thì không được thao tác.
- **FR-024**: Project khai mặc định ở item: vai trò tối thiểu để xem và để thao tác (mở rộng khối bảo mật hiện có của lệnh ghi). Quy tắc quyền, người dùng, nhóm **không** nằm trong project.
- **FR-025**: administrator luôn xem được mọi trang hệ thống và trang Quản trị; quy tắc không làm mất quyền đó.
- **FR-026**: Quy tắc trỏ tới tài nguyên không có trong project đang chạy là mồ côi: không có hiệu lực, được báo, dọn được.

**Thực thi ở máy chủ**

- **FR-030**: Tải cấu hình màn hình hoặc popup không được xem → 403, ghi nhật ký. Danh sách điều hướng chỉ gồm trang được xem. Cấu hình màn hình được xem trả về không gồm component bị ẩn (hoặc đánh dấu ẩn mà không có Tag của nó).
- **FR-031**: Dữ liệu sống chỉ gửi Tag thuộc tập được phép của phiên (Tag mà component được xem trên trang được xem dùng). Tập tính lại khi đăng nhập, khi nạp project, khi quy tắc đổi.
- **FR-032**: Lịch sử, báo cáo chỉ trả Tag thuộc tập được phép; alarm chỉ hiện alarm của Tag thuộc tập được phép (D21: chưa phân theo nhóm alarm).
- **FR-033**: Lệnh ghi kiểm `operate` của component gửi lệnh, cộng mọi kiểm hiện có (vai trò, giới hạn, xác nhận); thiếu quyền → từ chối và ghi nhật ký.
- **FR-034**: API quản trị chỉ administrator, chỉ HTTPS, có CSRF, giới hạn tần suất, giới hạn kích thước thân, kiểm cú pháp trước khi xử lý; mọi thao tác ghi nhật ký (người sửa, giá trị cũ và mới, không có mật khẩu hoặc mã băm).
- **FR-035**: Mọi từ chối quyền, đăng nhập thành công và thất bại, thay đổi người dùng, nhóm, quy tắc vào nhật ký kiểm toán.
- **FR-036**: Kho quyền có phiên bản định dạng, ghi nguyên tử, giữ bản trước; hỏng thì chỉ administrator vào được (an toàn mặc định) và trang Quản trị cho khôi phục.
- **FR-037**: Sửa đồng thời: mỗi thay đổi mang phiên bản dữ liệu; lệch thì từ chối "dữ liệu đã đổi".

**Trang Quản trị**

- **FR-040**: Mục Quản trị chỉ hiện với administrator; tab Người dùng, Nhóm, Quyền theo trang, Quyền theo component, Nhật ký.
- **FR-041**: Quyền theo trang là ma trận trang × người nhận, có "đặt cho nhiều trang", "sao chép từ trang khác".
- **FR-042**: Quyền theo component có xem trước màn hình (bấm component để chọn) và danh sách component; hiện "ai thấy, ai thao tác được" tính theo đúng luật của máy chủ.
- **FR-043**: Xem với tư cách người dùng X: chỉ đọc, không gửi lệnh ghi, ghi nhật ký.
- **FR-044**: Giao diện theo bộ giao diện của 012 (chủ đề, phông), tiếng Việt, dùng được bằng bàn phím, không có vi phạm khả năng truy cập mức critical/serious.

**Định dạng project**

- **FR-050**: Định dạng 1.1 (cùng dòng với 012, thêm khóa tùy chọn): item có `security.view` và `security.operate` mức vai trò tối thiểu (`minRole` cũ là bí danh của `operate`); màn hình có `security.view`. Luật kiểm `E_SECURITY_LEVEL` (mức vai trò sai) và `E_SECURITY_ITEM` (mức `operate` ở widget chỉ hiển thị) ở cả Studio và runtime, vector chung.
- **FR-051**: Project 1.0 và 1.1 không có khóa mới mở nguyên trạng, hành vi không đổi.

### Key Entities

- **Người dùng**: tên (định danh), vai trò, nhóm, bật/tắt, mật khẩu băm, khóa tạm, đăng nhập cuối.
- **Nhóm**: định danh, tên hiển thị, thành viên (suy từ người dùng).
- **Quy tắc quyền**: tài nguyên, mức (`view`/`operate`), danh sách người nhận.
- **Kho quyền**: phiên bản định dạng, phiên bản dữ liệu (tăng mỗi lần ghi), nhóm, quy tắc.
- **Tài nguyên**: màn hình, popup, trang hệ thống, component; suy từ project đang chạy.
- **Tập Tag được phép**: theo phiên, suy từ quyền hiệu lực.
- **Dòng nhật ký kiểm toán**: thời điểm, người, hành động, đối tượng, giá trị cũ và mới, kết quả, địa chỉ.

## Success Criteria *(mandatory)*

- **SC-001**: 100 % địa chỉ dữ liệu (danh sách kiểm kê ở plan) trả từ chối khi không có phiên trên project `required`; 0 byte giá trị Tag trong phản hồi.
- **SC-002**: Đăng nhập từ liên kết trực tiếp về đúng trang trong 1 bước; 0 chuyển hướng ra ngoài thiết bị với 20 dạng địa chỉ quay lại độc hại.
- **SC-003**: Admin tạo người dùng, gán nhóm, phân quyền một trang và một component trong dưới 3 phút, không SSH, không Studio, không nạp lại project; có hiệu lực trong dưới 2 giây.
- **SC-004**: Với mọi ca trong bộ kiểm thử tấn công (thiếu quyền xem trang, xem component, thao tác, gọi API quản trị bằng vai trò thấp, CSRF, leo thang qua sửa chính mình, xóa admin cuối), 100 % bị từ chối và có nhật ký.
- **SC-005**: Bắt luồng dữ liệu sống của người không được xem: 0 giá trị Tag bị cấm trong 10 phút.
- **SC-006**: 500 Tag, 1 s, 10 client đăng nhập với quyền khác nhau: CPU runtime x64 tăng không quá 10 % so với không phân quyền; vẫn trong ngân sách BL335.
- **SC-007**: Mọi test hiện có xanh; project 1.0 và 1.1 không khóa mới cho kết quả kiểm và hiển thị như trước.

## Assumptions

- Số người dùng trên một thiết bị nhỏ (≤ 200), số nhóm ≤ 50, số quy tắc ≤ 5.000.
- Quyền tính theo Tag mà component dùng trực tiếp (binding); Tag nội bộ của logic không lộ ra trang.
- Bản đầu không phân alarm theo nhóm (D21) và không làm giao diện quản trị trong Studio (D22, 8.6 sau). **8.6 đã làm (2026-10-26, feature 027, `specs/027-studio-admin/`):** Studio có nhóm editor "Người dùng và quyền" gọi đúng API quản trị của spec này bằng Bearer của phiên Online (mọi route `/api/v1/admin/*` vốn nhận Bearer administrator, có test); dữ liệu vẫn ở thiết bị (ADR-042); mô hình và lớp gọi API dùng chung với trang Quản trị web qua gói `@mat/admin-model`.
- Hiệu lực ngay = hủy phiên của người bị đổi; người khác giữ phiên, quyền mới áp ở lần tải trang kế.
- Thử trên runtime x64 (Docker) và Chrome; BL335 thật do người dùng chạy (không reboot, không cắt điện).
