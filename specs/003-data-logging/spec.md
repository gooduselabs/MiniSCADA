# Feature Specification: Lưu trữ dữ liệu Tag trên thiết bị và chuyển tiếp sang DB ngoài

**Feature Branch**: `003-data-logging`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Lưu trữ dữ liệu Tag (historian) trên mat-runtime (BL335). Người dùng cấu hình các nhóm lưu trữ trong project (file JSON, viết tay ở đợt này; editor Studio ở giai đoạn sau): mỗi nhóm có danh sách Tag, chế độ ghi theo chu kỳ (mỗi N giây) hoặc theo thay đổi (deadband từng Tag, khoảng ghi tối thiểu và tối đa), thời hạn lưu theo số ngày. Mỗi lần ghi tạo một dòng dạng bảng rộng (một cột thời gian, mỗi Tag một cột; Tag quality xấu ghi rỗng). Runtime ghi vào SQLite trên thiết bị trước, tự xóa bản ghi cũ hơn thời hạn, có trần dung lượng để bảo vệ thiết bị. Tùy chọn chuyển tiếp từng nhóm sang một hoặc nhiều DB ngoài: MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB. Bảng ở DB ngoài là bảng rộng, runtime tự tạo bảng và tự thêm cột khi project thêm Tag; cột thời gian theo giờ địa phương cấu hình được (mặc định UTC+7). Khi DB ngoài mất kết nối, dữ liệu vẫn nằm trong SQLite và được gửi bù khi có lại kết nối, không trùng dòng. Mật khẩu/token DB ngoài lưu trên thiết bị, không nằm trong project. Validator hai bản (TS cho Studio, C++ cho runtime) kiểm cấu hình lưu trữ và cảnh báo (không chặn) khi ước tính ghi eMMC vượt 2 GB/ngày. Trạng thái lưu trữ và chuyển tiếp (số dòng, dung lượng, trạng thái từng DB ngoài, độ trễ gửi bù, lỗi gần nhất) hiện trong /api/v1/system/info. Ngoài phạm vi đợt này: biểu đồ lịch sử, báo cáo, API truy vấn lịch sử cho trình duyệt, editor lưu trữ trong Studio (giai đoạn 5 của lộ trình v2). Quyết định đã chốt với người dùng: bảng rộng, giờ địa phương UTC+7, hỗ trợ cả 4 DB ngoài, tần suất do người dùng cấu hình."

## Bối cảnh

Sau Sprint 1, runtime chỉ hiển thị giá trị hiện hành và không lưu lại gì. Ngày 2026-10-10 người dùng yêu cầu lưu dữ liệu Tag:

- tần suất ghi do người dùng cấu hình;
- trên thiết bị dùng SQLite, tự xóa bản ghi cũ theo số ngày;
- ghi thêm sang DB của khách hàng (MySQL, SQL Server, …) để làm báo cáo.

Constitution 1.1.0 (nguyên tắc VII) đưa tính năng này vào phạm vi với các điều kiện:

- SQLite là nơi ghi đầu tiên, có thời hạn lưu và trần dung lượng;
- DB ngoài là tùy chọn; DB ngoài lỗi không được làm dừng runtime hay làm mất dữ liệu đã lưu;
- secret nằm trên thiết bị;
- vượt ngân sách ghi eMMC chỉ cảnh báo, không chặn.

Đợt này làm **phần thiết bị và cấu hình**. Cấu hình viết tay bằng JSON (Constitution I: runtime trước, editor sau). Biểu đồ lịch sử, báo cáo, API truy vấn lịch sử cho trình duyệt và editor lưu trữ trong Studio thuộc giai đoạn 5 của [lộ trình v2](../../docs/plans/roadmap-v2.md).

Nguồn Tag hiện vẫn là Mock Tag. Khi có driver thật (giai đoạn 2), lưu trữ chạy y hệt vì chỉ đọc giá trị qua Tag Engine.

Hai đặc điểm của BL335 ảnh hưởng tới thiết kế ([device-profile](../../docs/reports/device-profile.md)):

- chỉ có một phân vùng 6,8 GB, còn trống khoảng 6,1 GB;
- RTC không đọc được (`hwclock` timeout). Sau khi mất điện, đồng hồ có thể sai cho tới khi NTP đồng bộ.

## Clarifications

### Session 2026-10-10

- Q: Tần suất ghi do ai quyết định? → A: Người dùng cấu hình theo từng nhóm (theo chu kỳ hoặc theo thay đổi). Ước tính ghi eMMC vượt ngân sách 2 GB/ngày chỉ cảnh báo, không chặn.
- Q: Xóa dữ liệu cũ trên thiết bị thế nào? → A: Tự xóa bản ghi cũ hơn số ngày cấu hình cho từng nhóm, kèm trần dung lượng bảo vệ thiết bị.
- Q: Ghi sang những DB ngoài nào? → A: MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB; cả bốn trong đợt này.
- Q: Dạng bảng ở DB ngoài? → A: Bảng rộng: mỗi dòng là một thời điểm, mỗi Tag một cột. Runtime tự thêm cột khi project thêm Tag.
- Q: Cột thời gian theo giờ nào? → A: Giờ địa phương, độ lệch cấu hình được theo kết nối, mặc định UTC+7. SQLite trên thiết bị lưu UTC.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lưu dữ liệu Tag trên thiết bị theo cấu hình (Priority: P1)

Kỹ sư dự án khai báo các nhóm lưu trữ trong project, ví dụ nhóm "vận hành" ghi mỗi khi giá trị đổi và nhóm "báo cáo ca" ghi mỗi phút, rồi nạp project lên thiết bị. Runtime ghi các dòng dữ liệu vào bộ lưu trữ trên thiết bị. Mỗi dòng gồm thời điểm và giá trị của từng Tag trong nhóm. Thiết bị khởi động lại hay được nạp bản runtime mới thì dữ liệu cũ vẫn còn.

**Why this priority**: Đây là nền của mọi tính năng lịch sử (gửi DB ngoài, biểu đồ, báo cáo). Riêng nó đã có giá trị: dữ liệu vận hành được giữ lại trên thiết bị.

**Independent Test**: Thêm vào project mẫu hai nhóm (chu kỳ 1 s và theo thay đổi), chạy ≥ 10 phút. Xuất dữ liệu từng nhóm bằng lệnh xuất trên thiết bị, rồi đối chiếu số dòng, thời điểm và giá trị với Mock Tag.

**Acceptance Scenarios**:

1. **Given** nhóm theo chu kỳ 60 s, **When** chạy 10 phút, **Then** có 10 dòng (±1 ở đầu và cuối); mỗi dòng ở giây 0 của phút (± 250 ms); mỗi Tag một cột.
2. **Given** nhóm theo thay đổi, deadband 0,5 cho Tag mức bồn, **When** mức đổi 0,3 rồi đổi thêm 0,4 (tổng 0,7 so với giá trị đã ghi), **Then** không có dòng sau lần đổi 0,3, có dòng sau lần đổi thứ hai.
3. **Given** nhóm theo thay đổi có khoảng ghi tối thiểu 1 s, **When** Tag đổi 10 lần trong 1 s, **Then** giây đó có tối đa 1 dòng và dòng đó mang giá trị mới nhất.
4. **Given** nhóm theo thay đổi có khoảng ghi tối đa 60 s, **When** Tag không đổi trong 5 phút, **Then** vẫn có một dòng mỗi 60 s.
5. **Given** một Tag của nhóm có chất lượng không tốt, **When** ghi dòng, **Then** cột của Tag đó rỗng, các cột khác vẫn có giá trị.
6. **Given** đã có dữ liệu lưu, **When** thiết bị khởi động lại hoặc runtime được nạp bản mới hay khôi phục bản trước, **Then** dữ liệu cũ vẫn còn và việc ghi tiếp tục.
7. **Given** project không có cấu hình lưu trữ, **When** runtime chạy, **Then** runtime không ghi gì và mọi chức năng khác như cũ.

---

### User Story 2 - Tự xóa dữ liệu cũ và bảo vệ bộ nhớ thiết bị (Priority: P1)

Kỹ sư đặt thời hạn lưu cho từng nhóm, ví dụ 30 ngày. Runtime tự xóa dòng cũ hơn thời hạn. Dù cấu hình ghi dày đến đâu, dữ liệu lưu trữ không bao giờ làm đầy bộ nhớ thiết bị.

**Why this priority**: Người dùng yêu cầu trực tiếp. BL335 dùng eMMC 8 GB; đầy bộ nhớ có thể làm hỏng hệ điều hành.

**Independent Test**: Chạy với dữ liệu giả lập đã cũ, thời hạn lưu ngắn và trần dung lượng nhỏ; quan sát việc xóa và trạng thái.

**Acceptance Scenarios**:

1. **Given** nhóm có thời hạn 7 ngày và có dữ liệu cũ 10 ngày, **When** đợt dọn chạy (lúc khởi động và ít nhất mỗi giờ), **Then** không còn dòng nào cũ hơn 7 ngày; dòng mới hơn còn nguyên.
2. **Given** dung lượng lưu trữ chạm trần cấu hình trên thiết bị, **When** ghi tiếp, **Then** runtime xóa dòng cũ nhất (bất kể nhóm) để giữ dưới trần và ghi nhận sự kiện trong trạng thái.
3. **Given** dung lượng trống của thiết bị xuống dưới ngưỡng an toàn, **When** tới lượt ghi, **Then** runtime tạm dừng ghi, báo trong trạng thái, các chức năng khác vẫn chạy; khi có chỗ trống lại thì ghi tiếp.
4. **Given** đợt dọn đang xóa nhiều dòng, **When** người vận hành đang xem màn hình, **Then** màn hình vẫn cập nhật đúng nhịp, không gián đoạn quá 1 s.

---

### User Story 3 - Ghi sang DB của khách hàng (Priority: P1)

Kỹ sư khai báo kết nối tới DB của khách hàng (MySQL/MariaDB, SQL Server, PostgreSQL hoặc InfluxDB) và chọn nhóm nào gửi đi đâu. Mật khẩu hoặc token nhập trên thiết bị. Runtime tự tạo bảng rộng (cột thời gian theo giờ địa phương, mỗi Tag một cột) rồi chuyển từng dòng sang. Khách hàng làm báo cáo trên bảng này bằng công cụ quen thuộc (Excel, Power BI, …).

**Why this priority**: Người dùng yêu cầu trực tiếp. Đây là cầu nối sang hệ thống báo cáo và MES có sẵn của khách hàng.

**Independent Test**: Với mỗi loại DB (máy chủ thử), cấu hình một nhóm gửi tới đó; sau 10 phút so dữ liệu ở DB ngoài với dữ liệu trên thiết bị.

**Acceptance Scenarios**:

1. **Given** kết nối hợp lệ và DB ngoài chưa có bảng, **When** runtime khởi động với nhóm gửi tới đích này, **Then** bảng được tạo với cột thời gian và một cột cho mỗi Tag, kiểu cột phù hợp kiểu Tag.
2. **Given** đang chạy bình thường, **When** một dòng được ghi trên thiết bị, **Then** dòng tương ứng có ở DB ngoài trong ≤ 10 s; cột thời gian là giờ địa phương của thời điểm ghi (mặc định UTC+7).
3. **Given** project mới thêm Tag vào nhóm, **When** nạp project, **Then** bảng ngoài có thêm cột; dòng cũ để rỗng ở cột mới. Cột của Tag bị bỏ khỏi nhóm được giữ nguyên và rỗng từ đó.
4. **Given** đích là InfluxDB, **When** gửi, **Then** mỗi dòng thành một điểm dữ liệu, mỗi Tag có giá trị là một trường (Tag chất lượng xấu bỏ qua), thời điểm đúng tới mili giây.
5. **Given** mật khẩu chưa nhập trên thiết bị (hoặc nhập sai), **When** runtime kết nối, **Then** đích này báo "thiếu bí mật" (hoặc "lỗi xác thực"); dữ liệu vẫn lưu trên thiết bị; các đích khác không bị ảnh hưởng.
6. **Given** một nhóm gửi tới hai đích, **When** một đích lỗi, **Then** đích kia vẫn nhận đủ dữ liệu.

---

### User Story 4 - Mất kết nối DB ngoài không mất và không trùng dữ liệu (Priority: P2)

Mạng tới máy chủ DB của khách hàng mất từ vài phút tới vài ngày. Runtime vẫn lưu trên thiết bị. Khi kết nối lại, runtime gửi bù đủ các dòng còn thiếu theo đúng thứ tự, không gửi trùng; màn hình vận hành không bị ảnh hưởng.

**Why this priority**: Mạng nhà máy chập chờn là bình thường; báo cáo ca thiếu hoặc trùng dòng là lỗi nghiêm trọng với khách hàng. Xếp P2 vì cần US3 trước.

**Independent Test**: Dừng máy chủ DB 30 phút trong lúc đang ghi rồi bật lại; so số dòng và thời điểm ở hai phía.

**Acceptance Scenarios**:

1. **Given** DB ngoài mất kết nối 30 phút, **When** kết nối lại, **Then** trong ≤ 10 phút mọi dòng của 30 phút đó có ở DB ngoài, đúng thứ tự, không trùng.
2. **Given** runtime hoặc thiết bị khởi động lại (kể cả mất điện) giữa lúc gửi bù, **When** chạy lại, **Then** việc gửi bù tiếp tục từ chỗ dừng: không trùng, không thiếu dòng còn trên thiết bị.
3. **Given** DB ngoài trả lời rất chậm hoặc treo, **When** runtime đang chạy, **Then** việc ghi trên thiết bị và cập nhật màn hình vận hành không bị chậm.
4. **Given** mất kết nối lâu hơn thời hạn lưu trên thiết bị, **When** dòng cũ bị xóa trước khi kịp gửi, **Then** trạng thái của đích đó báo số dòng đã mất.

---

### User Story 5 - Cấu hình được kiểm trước khi chạy, có cảnh báo dung lượng ghi (Priority: P2)

Kỹ sư viết cấu hình lưu trữ. Studio và runtime kiểm bằng cùng luật, báo lỗi chỉ rõ file, vị trí, lý do: Tag không tồn tại, tên cột trùng, chu kỳ ngoài giới hạn, có mật khẩu trong project, … Khi ước tính ghi vượt ngân sách eMMC, công cụ cảnh báo kèm con số nhưng vẫn cho lưu và chạy.

**Why this priority**: Constitution V (validator hai phía, runtime không kích hoạt project lỗi) và VII (vượt ngân sách chỉ cảnh báo).

**Independent Test**: Chạy bộ vector hợp lệ/không hợp lệ ở cả hai bản; mở trong Studio một project vượt ngân sách.

**Acceptance Scenarios**:

1. **Given** cấu hình tham chiếu Tag không tồn tại, trùng id nhóm, trùng tên cột sau chuẩn hóa, trỏ tới đích không tồn tại, đặt deadband cho Tag không phải số, chu kỳ ngoài khoảng cho phép, hoặc vượt giới hạn số Tag, **When** kiểm, **Then** báo lỗi có mã, file, vị trí, lý do; hai bản cho cùng kết luận.
2. **Given** cấu hình có trường mật khẩu hoặc token, **When** kiểm, **Then** bị từ chối với lỗi "không được để secret trong project".
3. **Given** cấu hình có ước tính ghi > 2 GB/ngày (ví dụ 500 Tag ghi mỗi 100 ms), **When** kiểm trong Studio, **Then** hiện cảnh báo kèm ước tính MB/ngày và vẫn cho lưu; runtime vẫn chạy và báo cảnh báo trong trạng thái.
4. **Given** dung lượng cần để giữ đủ thời hạn lưu vượt trần mặc định, **When** kiểm, **Then** cảnh báo rằng dữ liệu sẽ bị xóa sớm hơn thời hạn.

---

### User Story 6 - Theo dõi lưu trữ và kiểm dữ liệu trên thiết bị (Priority: P3)

Kỹ sư xem trạng thái lưu trữ qua trang thông tin hệ thống của thiết bị và tab Thiết bị của Studio: số dòng, dung lượng, lần dọn gần nhất, trạng thái từng DB ngoài, số dòng chờ gửi, độ trễ, lỗi gần nhất. Khi cần, kỹ sư xuất dữ liệu một nhóm trong một khoảng thời gian ra CSV bằng lệnh trên thiết bị.

**Why this priority**: Phục vụ vận hành và hỗ trợ hiện trường. Đợt này chưa có giao diện lịch sử nên cần một cách kiểm dữ liệu.

**Independent Test**: Gây lỗi một DB ngoài và xem trạng thái đổi; chạy lệnh xuất CSV.

**Acceptance Scenarios**:

1. **Given** runtime đang ghi và gửi, **When** đọc trang thông tin hệ thống, **Then** thấy các chỉ số nêu trên; không có mật khẩu, token, tên người dùng hay địa chỉ máy chủ DB.
2. **Given** một đích lỗi, **When** xem tab Thiết bị trong Studio, **Then** thấy đích đó ở trạng thái lỗi kèm lý do ngắn.
3. **Given** đã có dữ liệu lưu, **When** chạy lệnh xuất với tên nhóm và khoảng thời gian, **Then** nhận CSV có dòng tiêu đề (thời gian theo giờ địa phương, mỗi Tag một cột) khớp dữ liệu trên thiết bị.

### Edge Cases

- **Đồng hồ sai.** RTC của BL335 không đọc được; sau mất điện, giờ có thể lùi về 1970 cho tới khi NTP đồng bộ. Khi đồng hồ chưa hợp lệ (sớm hơn mốc tối thiểu), runtime không ghi dòng và báo "đồng hồ chưa hợp lệ"; đồng hồ hợp lệ lại thì ghi tiếp. Khi đồng hồ nhảy lùi hoặc tiến lúc đang hợp lệ: runtime không ghi bù hàng loạt cho khoảng bị nhảy qua (mỗi nhóm ghi tối đa 1 dòng mỗi lượt) và tiếp tục nhịp ghi theo đồng hồ mới; nếu đồng hồ lùi thì dòng mới có thể mang thời điểm sớm hơn dòng trước, và trạng thái ghi nhận một lần "đồng hồ nhảy".
- **File lưu trữ hỏng** (không mở được): đổi tên giữ lại để điều tra, tạo file mới, báo lỗi; runtime vẫn chạy.
- **Đầy đĩa hoặc lỗi ghi đĩa:** tạm dừng ghi, báo lỗi, thử lại định kỳ; runtime không dừng.
- **Đổi kiểu một Tag đang được lưu** (ví dụ số → chuỗi): trên thiết bị vẫn ghi được. Ở DB ngoài, nếu cột hiện có không chứa được kiểu mới thì đích đó báo lỗi; runtime không tự sửa hay xóa cột.
- **Bỏ nhóm khỏi project hoặc đổi tên bảng:** dữ liệu cũ trên thiết bị được giữ và vẫn áp thời hạn lưu cuối cùng đã biết; bảng ở DB ngoài không bị xóa.
- **Tài khoản DB ngoài không có quyền tạo/sửa bảng:** nếu quản trị DB đã tạo sẵn bảng đủ cột thì vẫn gửi được; nếu thiếu cột thì đích báo lỗi quyền.
- **Tên Tag có dấu chấm** (`TANK01.LEVEL`): tên cột được chuẩn hóa thành `TANK01_LEVEL` và đặt lại được. Hai Tag trùng tên cột sau chuẩn hóa (không phân biệt hoa thường) là lỗi cấu hình.
- **Giá trị đặc biệt:** số nguyên 64 bit giữ đủ độ chính xác ở DB ngoài; NaN và vô cực ghi rỗng; chuỗi dài hơn giới hạn cột bị cắt và số lần cắt được đếm.
- **Nhiều nhóm cùng tới hạn ghi** tại một thời điểm: mỗi nhóm một dòng, không chặn lẫn nhau.
- **Nạp project mới trong lúc đang gửi bù:** dữ liệu đã lưu không mất; việc gửi bù tiếp tục theo cấu hình mới.
- **Hai thiết bị cùng ghi vào một bảng** ở DB ngoài: ngoài phạm vi đợt này (ghi trong tài liệu); mỗi thiết bị dùng tên bảng riêng.
- **Khách hàng ở múi giờ khác:** đặt độ lệch giờ theo từng kết nối.

## Requirements *(mandatory)*

### Functional Requirements

**Cấu hình (trong project, viết tay ở đợt này)**

- **FR-001**: Project MAY có một file cấu hình lưu trữ, khai báo trong manifest. Không có file thì runtime không lưu trữ; project hiện có vẫn hợp lệ mà không cần sửa.
- **FR-002**: Cấu hình MUST gồm danh sách nhóm lưu trữ. Mỗi nhóm có: id duy nhất, tên hiển thị, danh sách Tag (1–200), chế độ ghi, thời hạn lưu theo số ngày (1–3650), danh sách đích chuyển tiếp (có thể rỗng), tên bảng (mặc định suy từ id nhóm, đặt lại được).
- **FR-003**: Chế độ **theo chu kỳ** MUST nhận chu kỳ từ 100 ms tới 24 h. Chu kỳ chia hết cho một ngày thì dòng được căn theo đồng hồ giờ địa phương: chu kỳ 60 s ghi ở giây 0 mỗi phút, chu kỳ 1 h ghi ở phút 0.
- **FR-004**: Chế độ **theo thay đổi** MUST ghi một dòng khi ít nhất một Tag của nhóm đổi vượt deadband:
  - Tag số: deadband tuyệt đối theo từng Tag, mặc định 0 (mọi thay đổi);
  - Tag BOOL và chuỗi: mọi thay đổi;
  - chất lượng chuyển giữa tốt và không tốt cũng tính là thay đổi.

  Kèm theo: khoảng ghi tối thiểu (mặc định 1 s) và khoảng ghi tối đa tùy chọn (ghi dòng định kỳ dù không có thay đổi).
- **FR-005**: Mỗi Tag trong nhóm MUST có tên cột. Mặc định chuẩn hóa từ id Tag (ký tự không phải chữ, số, gạch dưới đổi thành gạch dưới), đặt lại được. Tên cột MUST duy nhất trong nhóm (không phân biệt hoa thường) và không trùng tên cột hệ thống.
- **FR-006**: Cấu hình MUST cho khai báo kết nối DB ngoài, gồm: id, loại (MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB), địa chỉ, cổng, tên DB (với InfluxDB: tổ chức và bucket), tên người dùng, chế độ mã hóa đường truyền (tắt / ưu tiên / bắt buộc / bắt buộc có kiểm chứng chỉ), độ lệch giờ cho cột thời gian (mặc định +07:00). Cấu hình MUST NOT chứa mật khẩu hay token.
- **FR-007**: Mật khẩu và token MUST được nhập trên thiết bị, vào một kho bí mật chỉ dịch vụ runtime đọc được, theo id kết nối; tài liệu MUST hướng dẫn cách nhập. Thiếu bí mật, hoặc file bí mật cho người khác đọc, thì đích báo trạng thái "thiếu bí mật"; phần còn lại chạy bình thường.

**Ghi trên thiết bị**

- **FR-008**: Mỗi lần ghi MUST tạo một dòng gồm thời điểm (UTC, độ phân giải mili giây) và giá trị hiện hành của từng Tag trong nhóm. Tag có chất lượng khác GOOD, hoặc số NaN/vô cực, ghi rỗng.
- **FR-009**: Dữ liệu MUST nằm trong vùng dữ liệu bền của thiết bị, ngoài thư mục cài runtime. Nạp bản runtime mới, khôi phục bản trước hay khởi động lại thiết bị MUST NOT làm mất dữ liệu.
- **FR-010**: Runtime MUST NOT ghi dòng khi đồng hồ hệ thống chưa hợp lệ (sớm hơn một mốc tối thiểu cố định trong bản runtime). Runtime MUST báo trạng thái "đồng hồ chưa hợp lệ" và tự ghi tiếp khi đồng hồ hợp lệ.
- **FR-011**: Mất điện bất kỳ lúc nào MUST NOT làm hỏng dữ liệu đã lưu. Phần có thể mất giới hạn trong khoảng gom ghi: mặc định ≤ 5 s, cấu hình được trên thiết bị, tối đa 60 s.
- **FR-012**: Khi project thay đổi:
  - thêm Tag vào nhóm: nơi lưu trên thiết bị có thêm cột, dòng cũ để rỗng;
  - bỏ Tag khỏi nhóm: cột được giữ lại;
  - bỏ nhóm: dữ liệu được giữ lại và tiếp tục áp thời hạn lưu cuối cùng đã biết.
- **FR-013**: Lỗi lưu trữ (đĩa đầy, lỗi ghi, file hỏng) MUST NOT làm dừng runtime hay việc cập nhật màn hình. Runtime báo lỗi và thử lại định kỳ; file hỏng được đổi tên giữ lại rồi tạo file mới.

**Thời hạn lưu và bảo vệ thiết bị**

- **FR-014**: Runtime MUST xóa dòng cũ hơn thời hạn lưu của nhóm, lúc khởi động và ít nhất mỗi giờ, theo từng phần nhỏ để việc ghi và cập nhật màn hình không bị gián đoạn quá 1 s.
- **FR-015**: Runtime MUST giữ tổng dung lượng lưu trữ dưới trần cấu hình trên thiết bị (mặc định 2 GB). Khi vượt, runtime xóa dòng cũ nhất trên mọi nhóm cho tới khi xuống dưới 90 % trần, và ghi nhận sự kiện.
- **FR-016**: Runtime MUST tạm dừng ghi khi dung lượng trống của thiết bị dưới ngưỡng an toàn (mặc định 500 MB), báo trạng thái, và ghi tiếp khi có chỗ.

**Chuyển tiếp sang DB ngoài**

- **FR-017**: Mỗi dòng của nhóm MUST được chuyển tới mọi đích của nhóm theo đúng thứ tự ghi:
  - MySQL/MariaDB, SQL Server, PostgreSQL: mỗi dòng đúng một lần, không trùng, kể cả sau khởi động lại hay mất điện;
  - InfluxDB: gửi lại một dòng không tạo bản trùng (cùng thời điểm thì ghi đè).
- **FR-018**: Runtime MUST tự tạo bảng rộng nếu chưa có: cột thời gian theo giờ địa phương của kết nối, một cột cho mỗi Tag, kiểu ánh xạ từ kiểu Tag, giữ nguyên độ chính xác 64 bit. Runtime MUST tự thêm cột còn thiếu khi cấu hình đổi, và MUST NOT xóa hay đổi kiểu cột có sẵn. Với InfluxDB: mỗi dòng thành một điểm (measurement là tên bảng), mỗi Tag có giá trị là một trường, thời điểm theo UTC.
- **FR-019**: Khi đích lỗi hoặc mất kết nối, dòng MUST nằm lại trên thiết bị và được gửi bù khi có kết nối lại. Runtime thử lại với khoảng chờ tăng dần, tối đa 60 s. Tốc độ gửi bù đủ để bù 30 phút dữ liệu của một nhóm ghi mỗi 1 s trong ≤ 10 phút.
- **FR-020**: Lỗi, độ trễ hay tình trạng treo của DB ngoài MUST NOT làm chậm việc ghi trên thiết bị, cập nhật màn hình hay các đích khác.
- **FR-021**: Dòng bị xóa trên thiết bị (do thời hạn lưu hay trần dung lượng) trước khi kịp gửi tới một đích MUST được đếm và báo trong trạng thái của đích đó.
- **FR-022**: Thiết bị thiếu thư viện client cho một loại DB thì đích loại đó báo lỗi "chưa cài client", phần còn lại chạy bình thường.

**Kiểm tra cấu hình (Constitution V)**

- **FR-023**: Bộ kiểm tra hai bản (TS cho Studio và công cụ, C++ cho runtime) MUST kiểm cấu hình lưu trữ:
  - đúng schema;
  - id nhóm và id kết nối duy nhất;
  - Tag và đích được tham chiếu có tồn tại;
  - tên bảng và tên cột hợp lệ, không trùng;
  - deadband chỉ dùng cho Tag số;
  - nằm trong giới hạn chu kỳ, số Tag, số nhóm, thời hạn;
  - không chứa secret.

  Lỗi chỉ rõ file, vị trí, lý do. Bộ vector dùng chung cho hai bản và hai bản cho cùng kết luận.
- **FR-024**: Bộ kiểm tra MUST cảnh báo (không chặn) khi ước tính ghi eMMC vượt 2 GB/ngày, và khi dung lượng cần để giữ đủ thời hạn lưu vượt trần mặc định; cảnh báo kèm con số ước tính. Studio MUST cho lưu project khi chỉ còn các cảnh báo này.
- **FR-025**: Runtime MUST từ chối kích hoạt project có cấu hình lưu trữ lỗi, như với mọi lỗi kiểm tra khác.

**Trạng thái và công cụ**

- **FR-026**: `/api/v1/system/info` MUST có trạng thái lưu trữ:
  - bật hay tắt, trạng thái đồng hồ, số nhóm;
  - tổng số dòng đã ghi từ lúc khởi động;
  - dung lượng đang dùng và trần;
  - lần dọn gần nhất và số dòng đã xóa;
  - cho mỗi đích (theo id kết nối): trạng thái (đang kết nối, hoạt động, lỗi, thiếu client, thiếu bí mật), số dòng chờ gửi, độ trễ (tuổi của dòng cũ nhất chưa gửi), số dòng đã gửi, số dòng đã mất, lỗi gần nhất.

  Không trường nào chứa secret, tên người dùng hay địa chỉ máy chủ DB.
- **FR-027**: Studio MUST hiển thị tóm tắt trạng thái lưu trữ ở tab Thiết bị.
- **FR-028**: Runtime MUST có lệnh chạy trên thiết bị để xuất dữ liệu một nhóm trong một khoảng thời gian ra CSV (thời gian theo giờ địa phương).

**Triển khai và vận hành**

- **FR-029**: Gói triển khai và hướng dẫn MUST:
  - cấp cho dịch vụ một vùng dữ liệu ghi được mà vẫn giữ sandbox hiện có;
  - giữ dữ liệu lưu trữ và kho bí mật qua deploy và rollback;
  - ghi mọi thay đổi trên BL335 vào `docs/reports/device-changes.md`.
- **FR-030**: Thư viện client của DB ngoài MUST được rà license (Constitution). Thư viện LGPL chỉ được nạp động. Runtime MUST chạy được khi thiết bị không có các thư viện này.

**Chất lượng**

- **FR-031**: Test MUST viết trước mã (Constitution VI) cho:
  - quyết định ghi: chu kỳ, theo thay đổi, deadband, khoảng tối thiểu/tối đa, đồng hồ không hợp lệ;
  - ghi, dọn, trần dung lượng;
  - ánh xạ kiểu và câu lệnh cho từng loại DB;
  - gửi bù không trùng;
  - bộ kiểm tra cấu hình (hai bản, vector chung).

  MUST có test tích hợp với máy chủ thật của cả bốn loại DB (chạy trong container trên máy dev).
- **FR-032**: `tools/ci-local.ps1` MUST xanh. Số đo trên BL335 khi bật lưu trữ MUST nằm trong ngân sách Constitution III.

### Key Entities

- **Cấu hình lưu trữ**: một file trong project, gồm danh sách nhóm và danh sách kết nối.
- **Nhóm lưu trữ**: id, tên, chế độ (theo chu kỳ, theo thay đổi), tham số thời gian, thời hạn lưu, danh sách Tag lưu, danh sách đích, tên bảng.
- **Tag lưu**: Tag được tham chiếu, tên cột, deadband, độ dài tối đa (với Tag chuỗi).
- **Kết nối DB ngoài**: id, loại, địa chỉ, DB hoặc bucket, người dùng, chế độ mã hóa, độ lệch giờ.
- **Bí mật thiết bị**: mật khẩu hoặc token theo id kết nối; chỉ có trên thiết bị.
- **Dòng lưu trữ**: nhóm, thời điểm UTC, giá trị từng Tag (hoặc rỗng).
- **Trạng thái gửi**: cho mỗi cặp nhóm × đích, dòng cuối cùng chắc chắn đã gửi.
- **Trạng thái lưu trữ**: các chỉ số ở FR-026.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Trên BL335, chạy ≥ 30 phút với một nhóm 500 Tag theo chu kỳ 1 s, thêm một nhóm theo thay đổi, và 10 client xem màn hình:
  - ≥ 99,9 % số dòng kỳ vọng có trên thiết bị;
  - 0 mất sequence ở client;
  - RSS runtime ≤ 150 MB, CPU trung bình ≤ 30 %.
- **SC-002**: ≥ 99 % dòng theo chu kỳ nằm trong ± 250 ms quanh thời điểm lý thuyết đã căn theo đồng hồ.
- **SC-003**: Thay đổi vượt deadband thành dòng trong ≤ khoảng ghi tối thiểu + 1 s; thay đổi nằm trong deadband không tạo dòng.
- **SC-004**: Với mỗi loại trong bốn loại DB, trong lần chạy 10 phút:
  - bảng được tạo tự động;
  - dòng có ở DB ngoài ≤ 10 s sau khi ghi trên thiết bị;
  - giá trị và thời điểm (giờ địa phương) khớp 100 % với dữ liệu trên thiết bị.
- **SC-005**: Đích mất kết nối 30 phút rồi có lại: sau ≤ 10 phút đủ 100 % dòng, 0 trùng. Khởi động lại runtime 3 lần giữa lúc gửi bù: vẫn 0 trùng, 0 thiếu.
- **SC-006**: Sau mỗi đợt dọn, 0 dòng nào cũ hơn thời hạn + 1 giờ; trong lúc dọn, màn hình không gián đoạn quá 1 s.
- **SC-007**: Dung lượng lưu trữ không vượt trần quá 5 %. Dung lượng trống của thiết bị không xuống dưới ngưỡng an toàn vì lưu trữ.
- **SC-008**: 10 lần dừng đột ngột tiến trình khi đang ghi và ≥ 3 lần cắt điện thật (người dùng làm): lần nào dữ liệu cũng mở được, không hỏng; mỗi lần mất ≤ khoảng gom ghi.
- **SC-009**: Bộ vector cấu hình lưu trữ: 100 % file hợp lệ được nhận, 100 % file lỗi bị từ chối ở cả hai bản với cùng mã lỗi; cảnh báo ghi eMMC xuất hiện đúng ở mẫu vượt ngân sách.
- **SC-010**: Secret không xuất hiện lần nào trong project, trang thông tin hệ thống, log hay Studio.
- **SC-011**: `tools/ci-local.ps1` xanh; test tích hợp với cả bốn loại DB đạt.

## Assumptions

- **Chưa có đăng nhập** (giai đoạn 1 của lộ trình v2). `/api/v1/system/info` công khai, nên trạng thái lưu trữ không chứa secret, tên người dùng hay địa chỉ DB. Bí mật nhập qua SSH ở đợt này; Studio quản lý bí mật sau khi có đăng nhập.
- **Máy chủ DB do khách hàng chuẩn bị:** máy chủ, DB và tài khoản có quyền INSERT, thêm CREATE/ALTER nếu muốn runtime tự tạo bảng. Runtime không tạo DB hay tài khoản.
- **Độ lệch giờ cố định theo kết nối** (Việt Nam không đổi giờ mùa hè). Múi giờ có quy tắc giờ mùa hè chưa hỗ trợ ở đợt này.
- **Mỗi thiết bị ghi vào bảng riêng** ở DB ngoài; nhiều thiết bị chung một bảng nằm ngoài phạm vi.
- **Giới hạn:** tối đa 32 nhóm; 200 Tag mỗi nhóm, trong đó tối đa 64 Tag chuỗi; độ dài chuỗi mặc định 255 ký tự. Số cột vừa giới hạn của cả bốn DB. Riêng giới hạn kích thước dòng của MySQL được xử lý bằng cách lưu chuỗi dạng `TEXT` (contracts/external-schema.md).
- **Đồng hồ hợp lệ** nghĩa là không sớm hơn một mốc tối thiểu cố định trong bản runtime. Đồng bộ giờ do hệ điều hành (NTP) đảm nhiệm.
- **Nguồn Tag** hiện là Mock; driver thật (giai đoạn 2) dùng chung đường ghi này.
- **Ngoài phạm vi đợt này:**
  - biểu đồ lịch sử, báo cáo, API truy vấn lịch sử, editor lưu trữ trong Studio (giai đoạn 5);
  - chế độ ghi theo Tag kích hoạt;
  - bảng tổng hợp (min/max/avg);
  - nhiều thiết bị ghi vào một bảng.
- **Thư viện client DB ngoài trên BL335:** cài bằng gói hệ điều hành hoặc kèm gói runtime (chốt trong plan). Cài lên thiết bị cần người dùng cho phép (Constitution, quy trình 3).
- **Số đo** lấy trên BL335 thật; mục nào chưa đo thì ghi "chưa đo".
