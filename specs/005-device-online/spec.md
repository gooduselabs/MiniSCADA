# Feature Specification: Làm việc với thiết bị từ Studio

**Feature Branch**: `005-device-online`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Làm việc với thiết bị từ Studio: GĐ 1 của lộ trình v2, phần thiết bị (phần khung Studio là feature 004). Kỹ sư tìm BL335 trong LAN bằng hộp thoại "Thiết bị trong mạng" (Studio gửi gói tìm; thiết bị trả lời tên, model, MAC, IP, phiên bản runtime, project đang chạy và digest, trạng thái, cổng HTTPS, fingerprint chứng chỉ; chỉ trả lời nguồn cùng subnet, giới hạn tần suất, gói trả lời nhỏ để chống khuếch đại, tắt được trong cấu hình thiết bị, không chứa bí mật; tìm xong trong ≤ 3 s); thêm thiết bị theo địa chỉ IP:cổng khi khác subnet hoặc qua WAN. Thiết bị chạy HTTPS bằng chứng chỉ tự sinh; lần kết nối đầu Studio hiện fingerprint để kỹ sư xác nhận rồi ghim, chứng chỉ đổi thì Studio chặn và cảnh báo. Đăng nhập, phân quyền, audit: tài khoản cục bộ trên thiết bị, mật khẩu băm chậm có salt; role viewer, operator, engineer, administrator; khóa tạm sau 5 lần sai; mật khẩu quản trị đặt bằng lệnh trên thiết bị lúc cài, không qua mạng; mọi đăng nhập, nạp xuống, đọc lên, khôi phục ghi audit trên thiết bị (ai, lúc nào, từ đâu, kết quả), có thời hạn lưu. Gói project .matscada (ZIP có manifest, checksum từng file; chặn ZIP bomb, path traversal; tối đa 50 MB; không chứa bí mật), project tách khỏi gói runtime. Nạp xuống: Studio hiện bước xem trước (kết quả kiểm tra, khác biệt so với thiết bị, ảnh hưởng như số client sẽ tải lại, dung lượng; có lỗi thì khóa, có cảnh báo thì phải xác nhận), rồi tiến trình từng bước (gửi, kiểm tra trên thiết bị bằng validator C++, sao lưu, kích hoạt, kiểm tra sức khỏe, tự rollback khi lỗi), rồi kết quả; giữ 3 bản trước để khôi phục; mất điện giữa lúc kích hoạt thì thiết bị khởi động với bản hợp lệ. Đọc lên: tải gói đang chạy về thành project mới hoặc để so sánh; đọc lên ngay sau nạp xuống cho digest giống hệt. So sánh máy này với thiết bị: theo digest từng file rồi theo đối tượng (Tag, nhóm lưu trữ, màn hình, binding), ký hiệu = ≠ + - trên cây project; đọc lên từng phần được chọn. Chẩn đoán cơ bản: CPU, RAM, dung lượng, thời gian chạy, số client. Chế độ Online của Studio (004) chuyển sang kết nối có đăng nhập: viền cam, trạng thái ở thanh dưới. Ràng buộc: Constitution V 2.0.0 (API nạp xuống chỉ bật khi đã có HTTPS, đăng nhập, phân quyền, audit; gói tìm thiết bị không chứa bí mật), III (ngân sách BL335: đo RSS/CPU sau khi thêm HTTPS, đăng nhập, tìm thiết bị), VII (deploy atomic). Ngoài phạm vi: ghi Tag (GĐ 2), quản lý tài khoản trong Studio (GĐ 1 tạo tài khoản bằng lệnh trên thiết bị), cập nhật runtime qua mạng (GĐ 6), bắt buộc đăng nhập cho trang xem runtime trên Chrome (giữ như hiện tại tới khi có ghi Tag). Quyết định tạm theo mặc định, chờ người dùng xác nhận: làm việc từ xa bằng thêm địa chỉ thủ công qua VPN hoặc port-forward, luôn HTTPS + đăng nhập (lộ trình mục 7, quyết định 5)."

## Bối cảnh

Hôm nay project được đưa lên BL335 bằng tay: đóng gói chung với runtime (`package-runtime.ps1`), chép bằng SSH, chạy `deploy.sh`. Studio không biết thiết bị nào đang chạy gì, không đọc project về được. Runtime phục vụ web không có đăng nhập, và đang mở ra Internet qua port-forward.

Ngày 2026-10-10 người dùng yêu cầu Studio tìm BL335 trong mạng, đọc project đang chạy về, cấu hình rồi nạp xuống. Ngày 2026-10-11 người dùng duyệt [lộ trình v2](../../docs/plans/roadmap-v2.md). GĐ 1 gồm hai feature:

- **004:** khung Studio, kết nối theo dõi chỉ đọc.
- **005 (feature này):** tìm thiết bị, HTTPS, đăng nhập và audit, gói project, nạp xuống, đọc lên, so sánh.

Constitution 2.0.0, nguyên tắc V: API nạp xuống project qua mạng chỉ được bật khi đã có HTTPS, đăng nhập, phân quyền theo role và audit; gói trả lời tìm thiết bị không chứa bí mật. Vì vậy phần bảo mật đi trước phần nạp xuống trong feature này.

Luồng giao diện (Thiết bị trong mạng, Nạp xuống, So sánh) đã có trong [mockup bản 1](../../docs/architecture/mockups/studio-shell.html) và [studio-ux.md](../../docs/architecture/studio-ux.md) §6.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Tìm thiết bị và kết nối có đăng nhập (Priority: P1)

Quản trị viên cài runtime lên BL335 và đặt mật khẩu tài khoản quản trị bằng lệnh trên thiết bị. Sau đó tạo tài khoản cho kỹ sư.

Kỹ sư mở hộp thoại Thiết bị trong mạng; Studio liệt kê các BL335 trả lời trong vài giây, kèm phiên bản runtime, project đang chạy, trạng thái. Kỹ sư chọn một thiết bị và bấm Online.

- **Lần đầu:** Studio hiện fingerprint chứng chỉ để so với fingerprint in trên thiết bị, rồi ghim.
- **Đăng nhập:** kỹ sư đăng nhập; Studio vào chế độ Online có viền cam, thanh trạng thái hiện thiết bị, tài khoản và role.
- **Thiết bị ở xa** (khác subnet, qua VPN): thêm theo địa chỉ.

**Why this priority**: Mọi thao tác với thiết bị (nạp xuống, đọc lên, so sánh) cần biết thiết bị nào và cần đăng nhập. Constitution V yêu cầu xác thực có trước khi bật nạp xuống.

**Independent Test**: Cài runtime mới lên thiết bị thử, đặt mật khẩu quản trị, tạo tài khoản kỹ sư. Từ Studio tìm thấy thiết bị, ghim chứng chỉ, đăng nhập, xem trạng thái thiết bị (phiên bản runtime, project, số phiên; chẩn đoán đầy đủ thuộc User Story 4). Thử sai mật khẩu 5 lần, thử thiếu quyền, thử chứng chỉ bị đổi.

**Acceptance Scenarios**:

1. **Given** hai BL335 trong cùng LAN, **When** mở Thiết bị trong mạng, **Then** trong ≤ 3 s cả hai hiện với tên, địa chỉ, phiên bản runtime, project (tên, phiên bản), trạng thái. Chọn một dòng hiện thêm model, MAC, cổng HTTPS, fingerprint.
2. **Given** thiết bị ở subnet khác, **When** thêm theo địa chỉ IP:cổng, **Then** Studio kết nối được và lưu thiết bị vào danh sách đã dùng.
3. **Given** lần đầu kết nối, **When** chọn Online, **Then** Studio hiện fingerprint SHA-256 đầy đủ; chỉ khi kỹ sư xác nhận mới ghim và đi tiếp.
4. **Given** thiết bị đã ghim, chứng chỉ bị đổi (tạo lại hoặc giả mạo), **When** kết nối, **Then** Studio chặn, hiện fingerprint cũ và mới, nói rõ nguy cơ. Chỉ gỡ ghim khi người dùng xác nhận rõ.
5. **Given** tài khoản engineer, **When** đăng nhập đúng, **Then** vào Online; thanh trạng thái hiện tài khoản và role; thiết bị ghi audit đăng nhập thành công kèm địa chỉ nguồn.
6. **Given** sai mật khẩu 5 lần liên tiếp, **When** thử lần 6 (kể cả đúng mật khẩu), **Then** bị từ chối "tài khoản tạm khóa" trong 5 phút; mọi lần sai ghi audit. Thông báo không cho biết sai tên hay sai mật khẩu.
7. **Given** chưa đăng nhập hoặc tài khoản viewer, **When** gọi thao tác cần quyền engineer (nạp xuống, đọc lên), **Then** thiết bị trả "chưa đăng nhập" hoặc "không đủ quyền" và ghi audit.
8. **Given** đang Online, **When** phiên hết hạn vì không thao tác, **Then** Studio hỏi đăng nhập lại, không mất việc đang sửa.
9. **Given** thiết bị đặt tắt tìm thiết bị trong cấu hình, **When** quét, **Then** thiết bị không trả lời; thêm theo địa chỉ vẫn được.

---

### User Story 2 - Nạp xuống an toàn (Priority: P1)

Kỹ sư sửa project trên máy, bấm Nạp xuống. Studio hiện bước xem trước:

- kết quả kiểm tra;
- tương thích runtime;
- project đang chạy sẽ bị thay, kèm tóm tắt khác biệt;
- số client đang xem sẽ tải lại;
- dung lượng.

Có lỗi thì không nạp được; có cảnh báo thì phải đánh dấu đã đọc. Sau khi bấm, Studio hiện từng bước trên thiết bị: nhận gói, kiểm gói, kiểm project, sao lưu, kích hoạt, kiểm tra sức khỏe. Hỏng ở bước nào thì thiết bị giữ hoặc quay về bản cũ, Studio nói lý do. Kỹ sư khôi phục được bản trước bằng một lệnh.

**Why this priority**: Đây là lý do chính người dùng cần Studio làm việc với thiết bị: thay quy trình chép tay bằng SSH. Phải an toàn ngay từ đầu vì project điều khiển màn hình vận hành.

**Independent Test**: Nạp xuống project mẫu đã sửa; kiểm client trên Chrome tự tải lại. Nạp một gói hỏng: bị từ chối, bản cũ chạy tiếp. Gây lỗi kiểm tra sức khỏe: tự quay về. Khôi phục bản trước. Giết tiến trình hoặc cắt điện ở từng bước rồi khởi động lại.

**Acceptance Scenarios**:

1. **Given** project còn lỗi, **When** mở Nạp xuống, **Then** dòng Kiểm tra project báo lỗi, nút Nạp xuống bị khóa, có lối mở danh sách lỗi.
2. **Given** project hợp lệ có cảnh báo, **When** xem trước, **Then** thấy đủ các dòng: kiểm tra, tương thích runtime, thay project đang chạy (phiên bản cũ → mới, mở So sánh được), client sẽ tải lại, dung lượng, ảnh hưởng tới lưu trữ dữ liệu; phải đánh dấu "đã đọc cảnh báo" mới nạp được.
3. **Given** đã bấm Nạp xuống, **When** thiết bị chạy, **Then** Studio hiện từng bước và kết quả cuối (thời gian, phiên bản đang chạy, số client đã tải lại); client Chrome đang xem tự tải lại trong ≤ 10 s.
4. **Given** gói bị hỏng hoặc độc hại (vượt 50 MiB, nén quá tỉ lệ, đường dẫn thoát thư mục, checksum sai, file ngoài manifest, chứa bí mật), **When** gửi lên, **Then** thiết bị từ chối kèm lý do, bản đang chạy không đổi, audit ghi lần từ chối.
5. **Given** project mới làm runtime không khởi động hoặc không phục vụ được, **When** kiểm tra sức khỏe thất bại, **Then** thiết bị tự quay về bản trước; Studio hiện lý do và trạng thái "đã quay về bản X".
6. **Given** đã nạp xuống thành công, **When** chọn Khôi phục bản trước, **Then** thiết bị chạy lại bản trước qua cùng chuỗi kiểm tra; danh sách bản lưu hiện phiên bản, digest, thời điểm, người nạp.
7. **Given** đang nạp xuống, **When** máy khác cũng nạp xuống cùng thiết bị, **Then** máy thứ hai nhận "thiết bị đang bận" kèm ai, từ đâu, từ lúc nào.
8. **Given** mất điện (hoặc tiến trình bị giết) ở bất kỳ bước nào, **When** thiết bị khởi động lại, **Then** thiết bị chạy một bản hợp lệ (bản mới đã kích hoạt xong, hoặc bản cũ), không bao giờ chạy bản dở dang.
9. **Given** project yêu cầu runtime mới hơn thiết bị, **When** xem trước, **Then** dòng Tương thích runtime báo lỗi và khóa nạp xuống.

---

### User Story 3 - Đọc lên và so sánh (Priority: P2)

Kỹ sư mới nhận một trạm, chưa có project trên máy: chọn thiết bị trong Thiết bị trong mạng, bấm "Đọc lên thành project mới", được thư mục project đầy đủ để mở trong Studio.

Kỹ sư khác đang có project trên máy, muốn biết thiết bị đang chạy khác gì: mở So sánh, thấy từng đối tượng giống, khác, chỉ có trên máy hay chỉ có trên thiết bị. Kỹ sư lấy về phần chọn hoặc nạp xuống phần khác.

**Why this priority**: Cần cho bảo trì (máy kỹ sư không còn bản project) và tránh ghi đè nhầm. Xếp sau US1, US2 vì nạp xuống an toàn quan trọng hơn.

**Independent Test**: Nạp xuống một project rồi đọc lên ngay: digest giống hệt. Sửa project trên máy, mở So sánh: đúng các mục khác. Lấy về một mục từ thiết bị: thành sửa đổi chưa lưu, hoàn tác được.

**Acceptance Scenarios**:

1. **Given** vừa nạp xuống gói có digest D, **When** đọc lên, **Then** gói đọc lên có digest đúng bằng D.
2. **Given** thiết bị được cài bằng gói runtime theo cách cũ, **When** đọc lên, **Then** vẫn nhận được project đang chạy đầy đủ.
3. **Given** chọn "Đọc lên thành project mới", **When** chọn thư mục, **Then** project được giải nén với cùng kiểm tra an toàn như thiết bị; Studio mở project đó và kết luận kiểm tra giống thiết bị.
4. **Given** project trên máy khác thiết bị (thêm một Tag, đổi một deadband, đổi một binding), **When** mở So sánh, **Then** bảng hiện đúng các dòng ≠, +, -, = theo đối tượng (Tag, thiết lập project, nhóm lưu trữ, màn hình và binding); chọn dòng hiện khác biệt từng trường; cây project khi Online có cùng ký hiệu.
5. **Given** một dòng khác được chọn, **When** "Đọc lên phần chọn", **Then** phần đó từ thiết bị vào project trên máy thành sửa đổi chưa lưu, hoàn tác được.

---

### User Story 4 - Chẩn đoán và audit (Priority: P3)

Kỹ sư Online thấy thiết bị đang khỏe hay không: CPU, RAM, dung lượng còn trống, thời gian chạy, số client. Quản trị viên xem được ai đã đăng nhập, ai đã nạp xuống, khi nào, từ đâu.

**Why this priority**: Hữu ích khi vận hành và cần để điều tra sự cố, nhưng không chặn nạp xuống hay đọc lên.

**Independent Test**: Online với tài khoản engineer, kiểm các số chẩn đoán với lệnh hệ thống trên thiết bị. Đăng nhập administrator, xem audit gồm các thao tác của các story trên.

**Acceptance Scenarios**:

1. **Given** đang Online, **When** mở tab Chẩn đoán, **Then** thấy CPU (trung bình 1 phút), RAM của runtime và của hệ thống, dung lượng trống của phân vùng dữ liệu, thời gian chạy, số client, cập nhật ít nhất 5 s một lần.
2. **Given** tài khoản administrator, **When** mở Audit, **Then** thấy bản ghi mới nhất trước, lọc được theo thời gian, tài khoản, hành động; tài khoản khác không xem được.
3. **Given** nhiều thao tác trong ngày, **When** quản trị viên xuất audit bằng lệnh trên thiết bị, **Then** nhận đủ bản ghi kể cả đăng nhập thất bại và truy cập bị từ chối.

---

### Edge Cases

- Máy kỹ sư có nhiều card mạng (Ethernet, Wi-Fi, VPN): chọn card để quét. Card VPN thường không đi broadcast: Studio gợi ý Thêm theo địa chỉ.
- Thiết bị chạy runtime cũ, chưa có tìm thiết bị và HTTPS: không hiện khi quét. Thêm theo địa chỉ thì Studio báo "runtime cần cập nhật để nạp xuống" và chỉ theo dõi chỉ đọc như feature 004.
- Hai thiết bị trùng tên: phân biệt bằng MAC và địa chỉ.
- Ai đó trong LAN giả làm thiết bị và trả lời gói tìm: kết nối vẫn phải qua bước ghim fingerprint. Thiết bị đã ghim mà fingerprint khác thì bị chặn.
- Gói tìm thiết bị bị dùng để khuếch đại tấn công: thiết bị chỉ trả lời nguồn cùng subnet, giới hạn tần suất, gói trả lời không lớn hơn gói hỏi.
- Mạng rớt giữa lúc gửi gói: thiết bị bỏ gói dở trong vùng tạm, bản đang chạy không đổi; Studio cho thử lại.
- Phân vùng dữ liệu đầy giữa lúc nhận gói: từ chối, dọn vùng tạm, bản đang chạy không đổi.
- Không ghi được audit (bộ nhớ hỏng hoặc đầy): thiết bị từ chối thao tác thay đổi (nạp xuống, khôi phục) và báo lý do.
- Đồng hồ thiết bị sai (RTC không đọc được sau mất điện): thời hạn phiên tính theo đồng hồ đơn điệu; audit ghi kèm cờ "giờ chưa đồng bộ" khi chưa có NTP.
- Phiên hết hạn giữa lúc nạp xuống: thao tác đã bắt đầu chạy tới cùng; kết quả ghi audit dưới tài khoản đã bắt đầu.
- Tài khoản bị tắt khi đang Online: thao tác kế tiếp bị từ chối, Studio về Offline.
- Project lưu trữ dữ liệu (feature 003) đổi nhóm hoặc cột: `history.db` được giữ, cột mới áp theo luật của 003.

## Requirements *(mandatory)*

### Functional Requirements

**Tìm thiết bị**

- **FR-001**: Studio MUST gửi yêu cầu tìm thiết bị trên card mạng người dùng chọn và hiện danh sách thiết bị trả lời trong ≤ 3 s; MUST có nút Tìm lại.
- **FR-002**: Thiết bị MUST trả lời:
  - tên, model, MAC, địa chỉ;
  - phiên bản runtime;
  - project đang chạy (mã, tên, phiên bản, digest);
  - trạng thái (đang chạy, chưa có project, project lỗi, đang kích hoạt bản mới);
  - cổng HTTPS, fingerprint chứng chỉ.

  Gói trả lời MUST NOT chứa mật khẩu, khóa, token, tên tài khoản hay bất kỳ bí mật nào (Constitution V).
- **FR-003**: Thiết bị MUST chỉ trả lời nguồn cùng subnet với card nhận được yêu cầu; MUST giới hạn tần suất trả lời theo từng nguồn và tổng; kích thước gói trả lời MUST NOT vượt kích thước gói hỏi.
- **FR-004**: Tìm thiết bị MUST tắt được trong cấu hình thiết bị; mặc định bật.
- **FR-005**: Studio MUST cho thêm thiết bị theo địa chỉ (IP hoặc tên, cổng HTTPS) và nhớ danh sách thiết bị đã dùng trên máy kỹ sư, kèm fingerprint đã ghim.

**HTTPS và ghim chứng chỉ**

- **FR-006**: Thiết bị MUST tự sinh khóa và chứng chỉ riêng ở lần chạy đầu (không dùng chung giữa các thiết bị). Khóa MUST chỉ tiến trình runtime đọc được, và MUST giữ qua khởi động lại và cập nhật runtime.
- **FR-007**: Mọi API kỹ thuật (đăng nhập, nạp xuống, đọc lên, khôi phục, chẩn đoán chi tiết, audit) MUST chỉ phục vụ qua HTTPS; gọi qua HTTP MUST bị từ chối.
- **FR-008**: Lần đầu Studio kết nối một thiết bị, Studio MUST hiện fingerprint SHA-256 đầy đủ và chỉ ghim khi người dùng xác nhận. Các lần sau Studio MUST tự kiểm. Fingerprint khác thì MUST chặn kết nối, hiện fingerprint cũ và mới; chỉ gỡ ghim khi người dùng xác nhận rõ.
- **FR-009**: Thiết bị MUST có lệnh in fingerprint (để so khi ghim) và lệnh tạo lại chứng chỉ (ghi audit).

**Tài khoản, quyền, audit**

- **FR-010**: Thiết bị MUST có tài khoản cục bộ: tên, role (viewer, operator, engineer, administrator), trạng thái (bật, tắt, tạm khóa). Mật khẩu MUST lưu dạng băm chậm có salt riêng từng tài khoản; mật khẩu MUST NOT được lưu thô, ghi log, ghi audit hay trả về.
- **FR-011**: Tạo tài khoản, đặt hoặc đổi mật khẩu, đổi role, tắt tài khoản, mở khóa MUST làm bằng lệnh trên thiết bị (cần quyền quản trị hệ điều hành), không qua mạng ở GĐ 1. Lúc cài, chưa có tài khoản administrator nào thì quy trình triển khai MUST yêu cầu đặt mật khẩu administrator:
  - chạy có terminal tương tác: MUST hỏi mật khẩu và tạo tài khoản ngay;
  - chạy không có terminal (script tự động): MUST in rõ bước bắt buộc kèm lệnh cần chạy, rồi đi tiếp.

  Chưa có tài khoản nào thì mọi đăng nhập MUST bị từ chối, và thiết bị MUST báo "cần tạo tài khoản quản trị" cho Studio.
- **FR-012**: Đăng nhập MUST tạo phiên có hạn: hết hạn sau 30 phút không thao tác, tối đa 12 giờ. Đăng xuất MUST hủy phiên. Phiên MUST gắn với địa chỉ nguồn lúc đăng nhập: request mang phiên đó từ địa chỉ nguồn khác MUST bị từ chối. Mã phiên MUST chỉ nằm trong bộ nhớ của Studio, MUST NOT ghi ra đĩa hay đưa vào giao diện. Giới hạn đã biết: hai máy sau cùng một NAT có cùng địa chỉ nguồn, thiết bị không phân biệt được (research R9).
- **FR-013**: Sai mật khẩu 5 lần liên tiếp MUST khóa tạm 5 phút, theo tài khoản và theo địa chỉ nguồn. Thông báo lỗi MUST NOT cho biết sai tên tài khoản hay sai mật khẩu.
- **FR-014**: Quyền theo role:
  - viewer: Online, xem, chẩn đoán;
  - operator: như viewer ở GĐ 1 (ghi Tag thuộc GĐ 2);
  - engineer: thêm đọc lên, nạp xuống, khôi phục, so sánh;
  - administrator: thêm xem và xuất audit.

  Chưa đăng nhập MUST trả "chưa đăng nhập"; thiếu quyền MUST trả "không đủ quyền". Cả hai MUST ghi audit.
- **FR-015**: Thiết bị MUST ghi audit cho:
  - đăng nhập thành công, thất bại, bị khóa; đăng xuất;
  - nạp xuống (bắt đầu, kết quả, digest cũ → mới), đọc lên, khôi phục;
  - tạo lại chứng chỉ, thay đổi tài khoản;
  - truy cập bị từ chối.

  Mỗi bản ghi: thời điểm, tài khoản, địa chỉ nguồn, hành động, đối tượng, kết quả. Audit MUST bền: thao tác đã báo thành công thì bản ghi không mất khi mất điện. Audit MUST có thời hạn lưu (mặc định 365 ngày) và trần dung lượng. Không ghi được audit thì thiết bị MUST từ chối thao tác thay đổi.
- **FR-016**: Administrator MUST xem được audit trong Studio (mới nhất trước, lọc theo thời gian, tài khoản, hành động) và xuất được bằng lệnh trên thiết bị.

**Gói project**

- **FR-017**: Gói `.matscada` MUST gồm:
  - manifest: định dạng gói, mã, tên, phiên bản project, phiên bản runtime tối thiểu, thời điểm tạo, công cụ tạo, danh sách file kèm SHA-256 và kích thước;
  - các file project.

  Digest của gói MUST tính từ manifest đã chuẩn hóa, không phụ thuộc cách nén, để đọc lên và nạp xuống so được với nhau.
- **FR-018**: Thiết bị MUST kiểm gói trước và trong khi giải nén vào vùng tạm:
  - tối đa 50 MiB nén, có giới hạn tổng sau giải nén, tỉ lệ nén và số file;
  - đường dẫn an toàn: không tuyệt đối, không `..`, không liên kết, chỉ loại file cho phép;
  - checksum từng file; không có file ngoài manifest;
  - không chứa bí mật.

  Sai MUST bị từ chối kèm lý do; bản đang chạy MUST NOT bị ảnh hưởng.
- **FR-019**: Project MUST tách khỏi gói runtime: nạp project không đổi runtime; cập nhật runtime (vẫn bằng gói runtime) giữ project đang chạy.

**Nạp xuống**

- **FR-020**: Studio MUST hiện bước xem trước gồm:
  - kiểm tra project: lỗi thì khóa nạp, cảnh báo thì phải xác nhận;
  - tương thích runtime;
  - project đang chạy và tóm tắt khác biệt, mở được So sánh;
  - số client đang kết nối sẽ tải lại;
  - dung lượng gói;
  - ảnh hưởng tới lưu trữ dữ liệu (nhóm, cột thay đổi).
- **FR-021**: Thiết bị MUST chạy tuần tự:
  1. nhận gói vào vùng tạm;
  2. kiểm gói (FR-018);
  3. kiểm project bằng bộ kiểm tra của runtime;
  4. sao lưu bản đang chạy;
  5. kích hoạt atomic;
  6. kiểm tra sức khỏe (runtime phục vụ project mới, trả lời trong thời hạn).

  Bước nào lỗi thì MUST dừng và giữ bản cũ; lỗi sau khi kích hoạt MUST tự quay về bản trước. Studio MUST hiện tiến trình từng bước và kết quả.
- **FR-022**: Mỗi thời điểm, một thiết bị MUST chỉ chạy một thao tác nạp xuống hoặc khôi phục. Yêu cầu thứ hai MUST nhận "thiết bị đang bận" kèm ai, từ đâu, từ lúc nào.
- **FR-023**: Kích hoạt MUST chịu được mất điện: sau khi khởi động lại, thiết bị MUST chạy một bản hợp lệ (bản mới đã kích hoạt xong, hoặc bản cũ), không bao giờ bản dở dang.
- **FR-024**: Thiết bị MUST giữ 3 bản trước (cấu hình được 1–10). Studio MUST cho khôi phục bản trước bằng một lệnh (engineer), chạy cùng chuỗi kiểm tra sức khỏe. Danh sách bản lưu MUST có phiên bản, digest, thời điểm, người nạp.
- **FR-025**: Client trình duyệt đang xem MUST tự tải lại project mới sau khi kích hoạt, trong ≤ 10 s.
- **FR-026**: Đổi project MUST giữ dữ liệu lưu trữ (`history.db` của feature 003). Nhóm và cột mới áp dụng theo luật của feature 003.

**Đọc lên và so sánh**

- **FR-027**: Đọc lên (engineer) MUST trả gói đang chạy; digest MUST khớp gói đã nạp. Thiết bị cài bằng gói runtime theo cách cũ MUST vẫn đọc lên được project đang chạy.
- **FR-028**: Studio MUST đọc lên thành project mới (thư mục chọn bằng hộp thoại, giải nén với cùng kiểm tra an toàn như thiết bị) hoặc để so sánh với project đang mở.
- **FR-029**: So sánh MUST:
  - so theo digest từng file trước, rồi theo đối tượng: Tag (theo tên, từng trường), thiết lập project, nhóm lưu trữ, màn hình và binding (theo phần tử, thuộc tính);
  - hiện ký hiệu = ≠ + - trong hộp thoại và trên cây project khi Online;
  - cho xem khác biệt từng trường.
- **FR-030**: Studio MUST đọc lên từng phần được chọn trong So sánh vào project đang mở, thành sửa đổi chưa lưu, hoàn tác được.

**Online và chẩn đoán**

- **FR-031**: Chế độ Online của feature 004 MUST chuyển sang kết nối có đăng nhập qua HTTPS. Thanh trạng thái MUST hiện tài khoản và role. Phiên hết hạn thì Studio MUST hỏi đăng nhập lại và MUST NOT làm mất việc đang sửa.
- **FR-032**: Thiết bị MUST cung cấp chẩn đoán cơ bản: CPU (trung bình 1 phút), RAM của runtime và của hệ thống, dung lượng trống của phân vùng dữ liệu, thời gian chạy, số client. Studio hiện trong tab Chẩn đoán, cập nhật ít nhất 5 s một lần.
- **FR-033**: Trang xem runtime trên Chrome và API chỉ đọc mà trang này dùng MUST giữ như hiện tại (không cần đăng nhập) cho tới GĐ 2, khi có ghi Tag.

**Tài nguyên, tương thích, kiểm thử**

- **FR-034**: Sau khi thêm HTTPS, đăng nhập, tìm thiết bị, RSS và CPU của runtime trên BL335 MUST vẫn trong ngân sách (Constitution III), đo khi rảnh và khi nạp xuống.
- **FR-035**: Studio MUST làm việc được với thiết bị runtime cũ ở chế độ theo dõi chỉ đọc (feature 004) và báo cần cập nhật runtime để nạp xuống.
- **FR-036**: Test MUST viết trước (Constitution VI) cho:
  - đọc và kiểm gói (ZIP bomb, đường dẫn, checksum, manifest, bí mật);
  - máy trạng thái nạp xuống (lỗi ở từng bước, quay về);
  - băm và kiểm mật khẩu, khóa tạm, phiên, quyền theo role, audit;
  - trả lời tìm thiết bị (subnet, tần suất, kích thước);
  - so sánh theo đối tượng;
  - ghim fingerprint phía Studio.

  MUST có test tích hợp x64: nạp xuống đầu-cuối, giết tiến trình ở từng bước, tìm thiết bị trong mạng thử.

### Key Entities

- **Bản ghi tìm thấy**: thông tin thiết bị trả lời gói tìm (FR-002) và thời điểm nhận; chỉ sống trong hộp thoại.
- **Thiết bị đã dùng**: lưu trên máy kỹ sư. Gồm tên, địa chỉ, cổng HTTPS, fingerprint đã ghim, thời điểm ghim, tài khoản dùng gần nhất (không có mật khẩu).
- **Chứng chỉ thiết bị**: khóa và chứng chỉ tự sinh, fingerprint SHA-256, thời điểm tạo.
- **Tài khoản**: tên, role, trạng thái, mật khẩu đã băm, salt, số lần sai liên tiếp, thời điểm hết khóa tạm.
- **Phiên**: tài khoản, địa chỉ nguồn, thời điểm tạo, thời điểm thao tác cuối, hạn.
- **Bản ghi audit**: thời điểm (kèm cờ giờ chưa đồng bộ), tài khoản, địa chỉ nguồn, hành động, đối tượng, kết quả, chi tiết (ví dụ digest cũ/mới).
- **Gói project**: manifest (FR-017), các file, digest.
- **Bản project trên thiết bị**: bản đang chạy và tối đa 3 bản trước. Mỗi bản: digest, phiên bản, thời điểm, người nạp, trạng thái (đang chạy, dự phòng).
- **Thao tác nạp xuống**: các bước, bước hiện tại, kết quả, lý do lỗi, người thực hiện; chỉ một thao tác cùng lúc trên một thiết bị.
- **Kết quả so sánh**: danh sách đối tượng với trạng thái = ≠ + - và khác biệt từng trường.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Trong LAN, Studio tìm thấy BL335 trong ≤ 3 s ở 10/10 lần quét. Thiết bị qua VPN hoặc port-forward thêm được bằng địa chỉ và đăng nhập được.
- **SC-002**: Đọc lên ngay sau nạp xuống cho digest giống hệt ở 10/10 lần, với ít nhất 3 project khác nhau.
- **SC-003**: 100 % gói trong bộ vector gói hỏng và độc hại của contract gói `.matscada` (§9: ZIP bomb, đường dẫn thoát thư mục, cấu trúc ZIP lạ, checksum sai, file ngoài manifest, vượt 50 MiB, chứa bí mật…) bị từ chối; bản đang chạy không đổi; mỗi lần từ chối có audit.
- **SC-004**: Giết tiến trình hoặc cắt điện ở từng bước của nạp xuống, tổng ≥ 20 lần trên x64 và ≥ 3 lần cắt điện thật trên BL335: 100 % lần khởi động lại chạy bản hợp lệ.
- **SC-005**: Chưa đăng nhập và thiếu quyền bị từ chối ở 100 % thao tác kỹ thuật, đều có audit. Sai 5 lần thì khóa tạm. Mật khẩu không xuất hiện trong log, audit hay phản hồi nào (kiểm bằng tìm chuỗi mật khẩu thử trên toàn bộ log và dữ liệu thiết bị).
- **SC-006**: Nạp xuống project mẫu (< 1 MB) qua LAN, kể cả kiểm tra sức khỏe, xong trong ≤ 15 s; client Chrome đang xem tự tải lại trong ≤ 10 s sau khi kích hoạt.
- **SC-007**: Trên BL335, so với runtime 0.3.0: RSS khi rảnh tăng ≤ 10 MB, CPU trung bình khi rảnh tăng ≤ 2 điểm phần trăm; tải chuẩn (500 Tag, 10 client) vẫn trong ngân sách Constitution III. Một lần đăng nhập mất ≤ 1 s trên BL335.
- **SC-008**: Mọi chức năng của feature 004 và Sprint 1 vẫn đạt; trang xem trên Chrome không đổi hành vi.
- **SC-009**: Một kỹ sư làm trọn vòng tìm thiết bị → Online → sửa project → nạp xuống → So sánh cho kết quả "giống" trong ≤ 5 phút, không cần tài liệu.

## Assumptions

- Quyết định 5 của lộ trình (làm việc từ xa) theo mặc định, chờ người dùng xác nhận: thêm thiết bị theo địa chỉ qua VPN hoặc port-forward; luôn HTTPS và đăng nhập; khuyến nghị VPN, đóng port-forward khi không cần.
- Trang xem runtime trên Chrome giữ HTTP và không cần đăng nhập tới GĐ 2 (FR-033), vì chưa có thao tác ghi. Ghi Tag ở GĐ 2 sẽ kéo theo HTTPS và đăng nhập cho trang này.
- Mỗi project một thiết bị; Studio chạy trên Windows.
- Tài khoản quản lý bằng lệnh trên thiết bị ở GĐ 1; quản lý trong Studio làm sau.
- "Nháy LED thiết bị" không làm cho tới khi xác nhận BL335 có LED điều khiển được.
- Cập nhật runtime vẫn bằng gói runtime và `deploy.sh` (SSH); cập nhật qua mạng thuộc GĐ 6.
- Thông số băm mật khẩu chọn ở plan sao cho một lần đăng nhập trên BL335 ≤ 1 s (SC-007), theo khuyến nghị hiện hành.
- Thời hạn audit mặc định 365 ngày, đổi được trong cấu hình thiết bị.
- Thử trên BL335 (cài runtime mới, tạo tài khoản, cắt điện) chỉ làm khi người dùng cho phép rõ (Constitution, quy trình bước 3).
- Phụ thuộc:
  - feature 004 (khung Studio, chế độ Online, cây project);
  - runtime 0.3.0 (validator C++, `deploy.sh`, lưu trữ dữ liệu);
  - giao thức live 1.0.0 cho trang xem.
