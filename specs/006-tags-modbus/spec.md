# Feature Specification: Tag v1, Modbus TCP/RTU, Tag tính toán và ghi Tag có kiểm soát

**Feature Branch**: `006-tags-modbus`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "GĐ 2 của lộ trình v2, làm thành một feature: Tag, driver nền tảng, tính toán, ghi Tag. Thiết bị: Tag v1 trong định dạng project 0.2.0 (Studio nâng cấp project 0.1 và giữ bản sao lưu; runtime 0.5.x nhận cả 0.1.x và 0.2.x; bộ kiểm tra TS và C++ cho cùng kết luận) gồm loại, địa chỉ, kiểu dữ liệu, scaling, deadband, thứ tự byte/word, quyền R/RW, giới hạn nhập, đơn vị, bảng giá trị; Tag Engine v1; driver SDK (kênh → thiết bị → Tag, nhóm quét nhanh/thường/chậm, gộp thanh ghi, thời gian chờ, thử lại, kết nối lại có backoff, hàng đợi ghi ưu tiên hơn đọc, chẩn đoán); Modbus TCP và Modbus RTU tự viết, không dùng libmodbus; Tag nội bộ (tùy chọn giữ qua mất điện, ghi eMMC có gom) và Tag tính toán bằng biểu thức (+ − × ÷ %, so sánh, logic, ? :, min, max, abs, round, clamp, text(tag, bảng)), không script; bảng giá trị (giá trị hoặc khoảng → chữ và màu). Ghi Tag chỉ từ Bảng theo dõi online của Studio, qua API HTTPS có đăng nhập của feature 005; role tối thiểu operator; audit ai, lúc nào, IP, Tag, giá trị cũ và mới, kết quả; kết quả ACCEPTED, REJECTED, TIMEOUT, FAILED, CONFIRMED. Cổng RS485 của BL335 chưa xác nhận: chọn được cổng serial, tốc độ, khung, chế độ RS485 khi kernel hỗ trợ. Studio theo chuẩn IDE (TIA Portal): editor Kết nối có nút thử kết nối; Bảng Tag dạng lưới (thêm hàng loạt, điền xuống, dán từ Excel, CSV, lọc, lỗi theo ô, ảo hóa ≥ 2.000 dòng, gõ ký tự đầu là sửa ô kể cả với bộ gõ IME); Bảng giá trị; Tag tính toán (gợi ý tên Tag, kiểm biểu thức khi gõ); Bảng theo dõi online có ghi và xác nhận; trang chẩn đoán driver; mô phỏng trong Studio không cần thiết bị, dùng chung package bộ sinh và biểu thức. Trang xem trên Chrome vẫn chỉ đọc, HTTP 8080, không đăng nhập. Ngoài phạm vi: widget và màn hình v1, đăng nhập trên Chrome (GĐ 3a); SVG import (GĐ 3b); alarm (GĐ 4); biểu đồ lịch sử, báo cáo (GĐ 5); driver S7, MC, FINS, MQTT, OPC UA (các đợt driver sau); logic v2: timer, counter, luật sự kiện (GĐ 6)."

## Bối cảnh

Sau GĐ 1 ([004](../004-studio-shell/spec.md), [005](../005-device-online/spec.md)), kỹ sư đã có Studio kiểu IDE, tìm được BL335, đăng nhập qua HTTPS, nạp xuống, đọc lên và so sánh project. Nhưng runtime chưa làm được việc của một SCADA:

- nguồn Tag duy nhất là Mock Tag (bồn + bơm, 500 Tag `SIM.*`); định dạng project 0.1 chỉ nhận `source.kind = "mock"`;
- không đọc được PLC nào, không ghi được Tag nào;
- không có Tag nội bộ hay Tag tính toán: bộ kiểm tra trả `E_TRANSFORM_UNSUPPORTED` cho biểu thức;
- đổi giá trị thành chữ chỉ có ở phía hiển thị (`discreteMap` của binding).

GĐ 2 của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.2) giải quyết các điểm này. Ràng buộc chính của [Constitution](../../.specify/memory/constitution.md) 2.0.1:

- **II:** mọi Tag đi qua Tag Engine; trình duyệt không truy cập PLC; driver chỉ phát cập nhật giá trị và kết quả ghi; biểu thức có hai bản dùng chung bộ vector.
- **III:** ngân sách BL335: RSS ≤ 150 MB, CPU trung bình ≤ 30 % với 500 Tag/1 s/10 client, ghi eMMC ≤ 2 GB/ngày.
- **V:** không script; mọi lệnh ghi được kiểm quyền và ghi audit; API ghi Tag chỉ bật khi đã có HTTPS, đăng nhập, role, audit (đã có từ 005).
- **VI:** test viết trước.
- **VII:** schema theo SemVer, có migration; driver chỉ phát hành khi có số đo trên BL335, có giả lập trong CI, đã rà license.

Phần Studio theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5 và §9: lưới cho Tag và Bảng giá trị, form Kết nối, Tag tính toán, Bảng theo dõi, chẩn đoán driver, mô phỏng. Người dùng từ chối giao diện dạng form cơ bản; chuẩn là công cụ kiểu IDE như TIA Portal. Feature 004 còn một hạn chế ([004-acceptance](../../docs/reports/004-acceptance.md) §3): với bộ gõ Telex có sẵn của Windows (TSF), phải nhấn F2 trước khi gõ vào ô của Bảng Tag. Lưới mới phải sửa điểm này.

BL335 có `ttyAS0`, `ttyAS2`–`ttyAS5`, `ttyS0`–`ttyS3`, `ttyUSB0`–`ttyUSB3` ([device-profile](../../docs/reports/device-profile.md)); `ttyAS0` đang là console của hệ điều hành. Chưa biết cổng nào nối với đầu RS485 và chiều truyền được điều khiển thế nào.

**Nền chung** cho mọi story: định dạng project 0.2.0 và nâng cấp từ 0.1, Tag Engine v1, driver SDK. Phần này được nghiệm thu qua kịch bản 1–2 của User Story 1, FR-001…FR-008 và SC-009. Các quyết định đã chốt và quyết định khi viết spec nằm ở mục Assumptions (D1–D32).

**Thuật ngữ:**

- **BL335**: thiết bị chạy runtime. Spec 005 gọi là "thiết bị".
- **Kênh**: một đường truyền tới thiết bị trường: một kết nối Modbus TCP, hoặc một cổng serial chạy Modbus RTU. Trên cây project nằm ở mục Kết nối.
- **Thiết bị trường**: PLC, biến tần, đồng hồ đo… mà BL335 đọc/ghi qua một kênh. Với Modbus là một unit ID hoặc một slave.
- **Loại Tag:**
  - **Tag ngoài**: lấy từ thiết bị trường qua driver;
  - **Tag nội bộ**: chỉ có trong BL335;
  - **Tag tính toán**: giá trị là kết quả của một biểu thức;
  - **Tag mô phỏng**: giá trị từ bộ sinh mô phỏng; chạy cả trên BL335.
- **Chế độ Mô phỏng của Studio**: chạy mọi Tag ngay trong Studio, không cần BL335. Khác với Tag mô phỏng.
- **Bảng theo dõi**: bảng Tag để theo dõi và ghi giá trị, như Watch table của TIA Portal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đọc Tag thật qua Modbus TCP (Priority: P1)

Kỹ sư mở project tank-demo (định dạng 0.1). Studio đề nghị nâng cấp lên 0.2.0 và giữ bản sao lưu. Trên cây project, kỹ sư thêm một kênh Modbus TCP tới PLC của trạm bơm và một thiết bị trường (unit ID 1).

Khi đang Online, kỹ sư bấm Thử kết nối. BL335 kết nối tới PLC và đọc thử một địa chỉ; Studio hiện thời gian trả lời, giá trị thô và cách hiểu theo từng thứ tự byte.

Trong Bảng Tag, kỹ sư thêm hàng loạt 50 Tag (tên và địa chỉ tự tăng), chọn kiểu, nhóm quét, scaling; ô sai được đánh dấu ngay. Kỹ sư nạp xuống:

- Bảng Tag và Bảng theo dõi hiện giá trị sống và quality;
- màn hình trên Chrome chạy bằng dữ liệu PLC;
- rút cáp PLC thì Tag chuyển BAD; cắm lại thì Tag tự có giá trị.

**Why this priority**: Đọc được PLC thật là lý do có SCADA. Mọi story khác (ghi, tính toán, chẩn đoán) cần Tag ngoài và nền chung (định dạng 0.2.0, Tag Engine v1, driver SDK).

**Independent Test**: Chạy giả lập Modbus TCP có đủ kiểu dữ liệu và thứ tự byte (trong CI, hoặc trên máy khác khi thử với BL335). Nâng cấp project mẫu, thêm kênh và Tag, nạp xuống. So giá trị ở Bảng theo dõi và trên Chrome với giả lập. Dừng giả lập, rút cáp, tiêm exception, rồi khôi phục.

**Acceptance Scenarios**:

1. **Given** project 0.1, **When** mở trong Studio, **Then** Studio đề nghị nâng cấp lên 0.2.0, nói những gì sẽ đổi và nơi giữ bản sao lưu, cho chọn Nâng cấp, Mở chỉ đọc hoặc Hủy.
2. **Given** đã chọn Nâng cấp, **When** lưu lần đầu, **Then**:
   - mọi file gốc được sao lưu trước khi ghi;
   - project sau nâng cấp hợp lệ; Tag mock thành Tag mô phỏng với cùng tín hiệu;
   - nạp xuống BL335 chạy runtime 0.5 thì giá trị Tag giống hệt bản 0.1.
3. **Given** Online với role engineer, cấu hình kênh chưa nạp xuống, **When** bấm Thử kết nối, **Then**:
   - trong ≤ tổng thời gian chờ đã đặt + 2 s, Studio báo kết nối được (kèm thời gian trả lời) hoặc không (từ chối kết nối, hết thời gian chờ, không tới được mạng);
   - kênh đang chạy không bị ảnh hưởng;
   - BL335 ghi audit.
4. **Given** Thử kết nối có đọc thử HR100, 2 thanh ghi, **When** PLC trả lời, **Then** Studio hiện giá trị thô dạng hex, và giá trị theo INT32, UINT32, FLOAT32 ở cả 4 thứ tự byte. PLC trả exception thì Studio hiện mã và nghĩa.
5. **Given** 500 Tag ở nhóm quét thường (1 s), giả lập đổi mọi giá trị mỗi giây, **When** chạy, **Then** Bảng theo dõi và trang xem trên Chrome hiện giá trị khớp giả lập, trễ ≤ 1 chu kỳ quét + 1 s; chẩn đoán báo chu kỳ thực khoảng 1 s.
6. **Given** các Tag có địa chỉ liền nhau, **When** quét, **Then** nhật ký của giả lập cho thấy yêu cầu đã được gộp, mỗi yêu cầu ≤ 125 thanh ghi, không Tag nào bị tách qua hai yêu cầu.
7. **Given** đang chạy với cấu hình mặc định, **When** rút cáp PLC hoặc tắt giả lập, **Then** Tag của PLC đó chuyển BAD trong ≤ 2 chu kỳ quét, kèm lý do; trang xem áp quy tắc quality xấu; lưu trữ (003) ghi ô rỗng. **When** cắm lại, **Then** Tag tự có giá trị GOOD, không cần khởi động lại runtime.
8. **Given** một Tag trỏ tới địa chỉ PLC không có, nằm giữa một yêu cầu gộp, **When** PLC trả exception 02, **Then** chỉ Tag đó BAD ("địa chỉ không hợp lệ"); các Tag khác của yêu cầu có giá trị GOOD từ lượt quét sau.
9. **Given** PLC lưu FLOAT32 theo thứ tự CDAB và Tag đặt đúng CDAB, **When** đọc, **Then** giá trị khớp giả lập. Đặt ABCD thì giá trị sai, và đọc thử ở kịch bản 4 cho thấy thứ tự đúng.
10. **Given** Tag INT16 có scaling thô 0–27648 → 0–100 % và deadband 0,5, **When** PLC có giá trị thô 13824, **Then** Tag là 50,0 %. Giá trị kỹ thuật đổi không quá 0,5 % so với giá trị đã phát thì client không nhận cập nhật.
11. **Given** Bảng Tag, **When** thêm hàng loạt 50 Tag FLOAT32 với mẫu tên `TT_01` và địa chỉ bắt đầu HR100, **Then** có `TT_01`…`TT_50` ở HR100, HR102, …, HR198; một lần Ctrl+Z bỏ cả 50 Tag.
12. **Given** 50 dòng chép từ Excel, trong đó 2 ô kiểu dữ liệu sai, **When** dán vào Bảng Tag, **Then** 50 dòng được thêm; 2 ô sai có viền đỏ kèm lý do và nằm trong tab Thông tin.
13. **Given** một ô Mô tả đang được chọn, bộ gõ Telex có sẵn của Windows đang bật, **When** gõ "Mức nước", **Then** ô vào chế độ sửa ngay từ ký tự đầu và chứa đúng "Mức nước", không cần F2.

---

### User Story 2 - Ghi Tag có kiểm soát từ Bảng theo dõi (Priority: P1)

Người vận hành đăng nhập vào Studio bằng tài khoản operator, mở Bảng theo dõi "Vận hành", nhập setpoint mới 75 cho `TANK01.SP` rồi chọn Ghi. Hộp xác nhận hiện Tag, thiết bị trường, giá trị hiện tại, giá trị mới, đơn vị, giới hạn. Người vận hành xác nhận; dòng đó hiện `ACCEPTED`, rồi `CONFIRMED` khi BL335 đọc lại đúng giá trị. Quản trị viên mở audit, thấy ai ghi, lúc nào, từ đâu, giá trị cũ và mới.

Tài khoản viewer không ghi được. Tag chỉ đọc, giá trị ngoài giới hạn, PLC mất kết nối: đều bị từ chối trước khi có gì gửi tới PLC.

**Why this priority**: Điều khiển là nửa còn lại của SCADA và là nghiệm thu của GĐ 2. Ghi Tag tác động lên máy thật, nên kiểm quyền, kiểm giới hạn và audit phải đúng ngay từ đầu (Constitution V).

**Independent Test**: Với giả lập, tạo tài khoản viewer, operator, engineer. Ghi mỗi kiểu dữ liệu. Thử ngoài giới hạn, Tag chỉ đọc, PLC mất kết nối, PLC trả exception, PLC không trả lời. Cho hai Studio cùng ghi. Giết runtime giữa lúc ghi. So nhật ký của giả lập với audit.

**Acceptance Scenarios**:

1. **Given** operator đang Online, Tag RW, giá trị trong giới hạn nhập, **When** xác nhận ghi, **Then** dòng hiện `ACCEPTED` rồi `CONFIRMED` trong ≤ 2 s (LAN); PLC có đúng giá trị; Bảng theo dõi hiện giá trị đọc lại.
2. **Given** tài khoản viewer, **When** mở Bảng theo dõi, **Then** lệnh Ghi bị khóa kèm lý do. **When** gửi lệnh ghi bằng công cụ khác, **Then** BL335 trả "không đủ quyền", không gửi gì tới PLC, audit ghi tài khoản, IP, Tag, giá trị yêu cầu.
3. **Given** Tag R hoặc Tag tính toán, **When** ghi, **Then** `REJECTED` "Tag chỉ đọc", có audit.
4. **Given** giới hạn nhập 0–90, **When** nhập 95, **Then** Studio đánh dấu ô và không cho ghi. Lệnh gửi bằng công cụ khác bị `REJECTED` "ngoài giới hạn"; không có gì gửi tới PLC.
5. **Given** PLC đang mất kết nối, **When** ghi, **Then** `REJECTED` "kết nối xấu" ngay; khi kết nối có lại, BL335 không gửi lệnh đó.
6. **Given** PLC trả exception cho lệnh ghi, **When** ghi, **Then** `FAILED` kèm mã exception và nghĩa.
7. **Given** PLC nhận yêu cầu ghi mà không trả lời, **When** hết thời gian chờ, **Then** `TIMEOUT` "không chắc đã ghi"; BL335 không tự gửi lại; Bảng theo dõi hiện giá trị đọc được ở lượt quét sau.
8. **Given** hai operator ở hai máy ghi cùng một Tag gần như cùng lúc, **When** cả hai xác nhận, **Then**:
   - hai lệnh chạy theo thứ tự BL335 nhận;
   - mỗi người thấy kết quả lệnh của mình;
   - PLC giữ giá trị của lệnh sau;
   - audit có hai bản ghi, giá trị cũ đúng với từng lệnh.
9. **Given** administrator, **When** mở Audit (005) và lọc theo Tag, **Then** mỗi lệnh ghi có thời điểm, tài khoản, role, IP, Tag, kênh và thiết bị trường, giá trị cũ, giá trị mới, kết quả, lý do.
10. **Given** Studio mất mạng ngay sau khi gửi lệnh, **When** có mạng lại, **Then** Studio lấy kết quả theo mã yêu cầu và không tự gửi lại; BL335 không thực hiện một mã yêu cầu hai lần.
11. **Given** phiên đăng nhập đã hết hạn, **When** ghi, **Then** Studio hỏi đăng nhập lại; sau khi đăng nhập, lệnh không tự gửi lại, người vận hành phải xác nhận lại.
12. **Given** đang có lệnh ghi trong hàng đợi, **When** kỹ sư khác nạp xuống project mới, **Then**:
    - lệnh đã gửi chạy tới khi có kết quả;
    - lệnh chưa gửi bị `FAILED` và không được gửi;
    - lệnh mới trong lúc kích hoạt bị `REJECTED`;
    - mọi kết quả có audit.

---

### User Story 3 - Modbus RTU qua RS485 (Priority: P2)

Kỹ sư thêm kênh Modbus RTU: chọn cổng serial trong danh sách BL335 báo về (cổng trên bo hoặc bộ chuyển USB–RS485), đặt 9600 bit/s, 8 bit dữ liệu, parity chẵn, 1 bit dừng, bật chế độ RS485. Trên kênh có ba đồng hồ điện (slave 1, 2, 3). Kỹ sư thử kết nối từng đồng hồ, tạo Tag, nạp xuống. Khi một đồng hồ mất điện, chỉ Tag của nó BAD; hai đồng hồ còn lại vẫn đọc đúng nhịp.

**Why this priority**: Đồng hồ điện, biến tần, bộ điều khiển nhiệt thường chỉ có RS485. Xếp sau US1 vì Modbus TCP phổ biến hơn với PLC, và cổng RS485 của BL335 chưa xác nhận; thử thật cần bộ chuyển và người ở cạnh thiết bị.

**Independent Test**: Trong CI: cặp cổng serial ảo, giả lập slave RTU, tiêm lỗi (CRC sai, không trả lời, byte rác). Trên BL335: một thiết bị RS485 thật qua bộ chuyển, có người ở cạnh thiết bị.

**Acceptance Scenarios**:

1. **Given** Online với role engineer, **When** mở danh sách cổng của kênh RTU, **Then** thấy từng cổng: tên, loại (trên bo, USB), đang được kênh nào hay hệ điều hành dùng, có chế độ RS485 hay không (nếu biết).
2. **Given** ba slave, slave 2 mất điện, **When** chạy, **Then**:
   - sau 3 lần hỏng liên tiếp, slave 2 vào trạng thái tạm ngưng, Tag của nó BAD;
   - slave 1 và 3 giữ chu kỳ quét;
   - slave 2 có điện lại thì Tag có giá trị trong ≤ 15 s.
3. **Given** khung trả lời sai CRC, **When** BL335 nhận, **Then** khung bị bỏ và được đếm; Tag không nhận giá trị từ khung hỏng.
4. **Given** kênh chọn cổng console của hệ điều hành, hoặc cổng đã có kênh khác dùng, **When** kiểm tra hoặc chạy, **Then** có lỗi nêu rõ cổng đang được ai dùng; BL335 không chiếm cổng; các kênh khác vẫn chạy.
5. **Given** bật chế độ RS485 trên cổng mà kernel không hỗ trợ, **When** kênh chạy, **Then** kênh báo "cổng không có chế độ RS485 của kernel, cần bộ chuyển tự đổi chiều" và vẫn mở cổng ở chế độ thường.
6. **Given** nhóm quét nhanh (250 ms) có 200 thanh ghi ở 9600 bit/s, **When** kiểm tra project, **Then** có cảnh báo thời gian quét ước tính vượt chu kỳ, kèm con số.
7. **Given** một thiết bị RS485 thật trên BL335, **When** đọc rồi ghi một tham số RW, **Then** giá trị khớp màn hình của thiết bị; lệnh ghi `CONFIRMED`.

---

### User Story 4 - Tag nội bộ, Tag tính toán và bảng giá trị (Priority: P2)

Kỹ sư tạo Tag nội bộ `TANK01.SP_HI`, giữ qua mất điện, làm ngưỡng cho người vận hành chỉnh. Kỹ sư tạo các Tag tính toán:

- `TANK01.VOLUME = TANK01.LEVEL * 12.5`;
- `TANK01.HIGH = TANK01.LEVEL > TANK01.SP_HI`;
- `PUMP01.STATE_TEXT = text(PUMP01.STATE, TrangThaiBom)`.

Bảng giá trị `TrangThaiBom`: 0 → "Dừng" màu xám, 1 → "Chạy" màu xanh lá, 2 → "Lỗi" màu đỏ.

Khi gõ biểu thức, Studio gợi ý tên Tag, báo lỗi ngay tại chỗ, cho xem trước kết quả. Trên BL335, Tag tính toán cập nhật theo đầu vào. Màn hình trên Chrome đổi màu theo bảng giá trị.

**Why this priority**: Không có tính toán và bảng giá trị thì mỗi phép đổi đơn vị, mỗi trạng thái dạng chữ đều phải sửa chương trình PLC. Xếp sau US1, US2 vì cần đọc và ghi trước.

**Independent Test**: Chạy bộ vector biểu thức chung ở cả hai bản. Dùng project mẫu có đủ ba loại trên giả lập: đổi đầu vào rồi kiểm Tag tính toán; giết tiến trình rồi kiểm Tag giữ qua mất điện; trong Studio, kiểm gợi ý, báo lỗi, xem trước.

**Acceptance Scenarios**:

1. **Given** ô biểu thức, **When** gõ "tank01.le", **Then** Studio gợi ý `TANK01.LEVEL` (không phân biệt hoa thường). Gõ tên hàm thì Studio hiện cú pháp của hàm.
2. **Given** biểu thức sai (thiếu ngoặc, Tag không có, cộng chuỗi với số, toán hạng logic là số), **When** ngừng gõ, **Then** trong ≤ 500 ms chỗ sai được gạch dưới đúng vị trí, kèm lý do.
3. **Given** Tag A dùng B và B dùng A, **When** kiểm tra, **Then** cả Studio và BL335 báo vòng tham chiếu kèm đường vòng; BL335 không kích hoạt project.
4. **Given** một đầu vào đổi, **When** BL335 tính lại, **Then** Tag tính toán tới client cùng lần gửi dữ liệu sống với đầu vào, hoặc lần gửi ngay sau; Tag tính toán phụ thuộc nhau không lộ giá trị trung gian.
5. **Given** `A / B` với B = 0, **When** tính, **Then** Tag BAD "chia cho 0"; B khác 0 thì Tag GOOD trở lại.
6. **Given** `OK1 ? PLC1.TEMP : PLC2.TEMP`, PLC1 mất kết nối và `OK1` = false, **When** tính, **Then** Tag GOOD với giá trị của `PLC2.TEMP`. Một đầu vào đã thực sự dùng mà BAD thì Tag BAD.
7. **Given** `PUMP01.STATE` = 1, **When** xem, **Then** Bảng theo dõi hiện "Chạy" màu xanh lá; binding màu theo `TrangThaiBom` cho cùng màu trên Chrome và trong xem trước của Studio.
8. **Given** bảng giá trị có hai khoảng chồng nhau, **When** kiểm tra, **Then** ô chồng bị đánh dấu lỗi kèm lý do.
9. **Given** Tag giữ qua mất điện vừa được ghi giá trị 42, **When** sau hơn một cửa sổ gom, tiến trình bị giết hoặc BL335 mất điện, **Then** sau khởi động lại Tag là 42.
10. **Given** bản project mới đổi kiểu một Tag giữ qua mất điện, **When** xem trước Nạp xuống, **Then** có dòng liệt kê Tag sẽ về giá trị đầu; Tag cùng tên, cùng kiểu giữ nguyên giá trị.
11. **Given** bộ vector biểu thức chung, **When** chạy ở Studio và ở runtime, **Then** giá trị, kiểu, quality và mã lỗi giống nhau ở mọi ca.
12. **Given** Tag `TANK02.LEVEL` chỉ được dùng ở hai biểu thức và một bảng theo dõi, **When** đổi tên thành `TANK02.LVL`, **Then** Studio liệt kê ba chỗ sẽ đổi; xác nhận thì cả ba đổi theo, không còn lỗi tham chiếu; một lần Ctrl+Z trả lại tên cũ ở mọi chỗ.

---

### User Story 5 - Chẩn đoán driver (Priority: P3)

Một đồng hồ điện thỉnh thoảng mất số liệu. Kỹ sư vào Online, mở Chẩn đoán driver:

- kênh RTU đang chạy;
- đồng hồ số 3 có nhiều lần hết thời gian chờ và khung sai CRC;
- chu kỳ thực của nhóm thường là 1,8 s, so với 1 s đã đặt.

Danh sách Tag xấu cho biết lý do từng Tag; nhấp đúp thì tới Tag đó trong Bảng Tag.

**Why this priority**: Cần khi chạy thử và khi bảo trì, nhưng không chặn việc đọc và ghi.

**Independent Test**: Tiêm từng loại lỗi vào giả lập (hết thời gian chờ, exception từng mã, CRC, rớt kết nối, trả lời chậm); so số đếm ở trang chẩn đoán với số lỗi đã tiêm.

**Acceptance Scenarios**:

1. **Given** Online với role viewer trở lên, **When** mở Chẩn đoán driver, **Then** thấy cây kênh › thiết bị trường kèm trạng thái và số liệu, cập nhật ít nhất 2 s một lần.
2. **Given** tiêm 10 lần hết thời gian chờ, **When** xem, **Then** trong ≤ 5 s số đếm tăng đúng 10; lỗi gần nhất có thời điểm.
3. **Given** kênh không kịp chu kỳ, **When** xem, **Then** chu kỳ thực hiện cạnh chu kỳ đặt, có dấu quá tải.
4. **Given** trang đã mở 10 phút, **When** xem số đếm, **Then** thấy cả số đếm từ lúc runtime chạy và phần tăng thêm từ lúc mở trang.
5. **Given** có Tag BAD, **When** nhấp đúp một dòng trong danh sách Tag xấu, **Then** Bảng Tag mở và chọn đúng Tag đó.
6. **Given** chưa đăng nhập, **When** gọi chẩn đoán driver, **Then** BL335 trả "chưa đăng nhập" và ghi audit.

---

### User Story 6 - Mô phỏng trong Studio (Priority: P3)

Kỹ sư chưa có PLC hay BL335, bật Mô phỏng trên thanh công cụ:

- Tag ngoài chạy theo bộ sinh đã đặt (mức bồn dạng sin, bơm bật/tắt);
- Tag nội bộ có giá trị đầu;
- Tag tính toán được tính ngay trong Studio.

Bảng theo dõi, Bảng Tag và xem trước màn hình chạy bằng các giá trị này. Kỹ sư gõ giá trị tay vào Bảng theo dõi để thử biểu thức. Studio không gửi gì ra mạng.

**Why this priority**: Rút ngắn thời gian làm project; cho thử biểu thức, bảng giá trị và màn hình trước khi tới hiện trường. Không cần cho trạm đang chạy.

**Independent Test**: Studio trên máy không có mạng. Bật Mô phỏng với project mẫu có đủ bốn loại Tag; so giá trị bộ sinh và Tag tính toán với bộ vector chung; theo dõi mạng để kiểm không có gói tin nào gửi đi.

**Acceptance Scenarios**:

1. **Given** Studio Offline, **When** bật Mô phỏng, **Then** trong ≤ 1 s mọi chỗ hiện giá trị đều dùng mô phỏng; có dấu "MÔ PHỎNG" rõ ràng, khác viền cam của Online; không có gói tin nào ra mạng.
2. **Given** Tag có bộ sinh hằng, ramp, sin, ngẫu nhiên, bật/tắt, nhập tay, **When** chạy, **Then** giá trị theo đúng tham số và khớp bộ vector chung với BL335.
3. **Given** chế độ Mô phỏng, **When** ghi giá trị tay vào một Tag từ Bảng theo dõi, **Then** Tag đổi ngay, không cần đăng nhập, không có audit, dòng ghi rõ "mô phỏng"; Tag tính toán phụ thuộc cập nhật trong ≤ 1 s.
4. **Given** Tag ngoài chưa có cấu hình mô phỏng, **When** bật Mô phỏng, **Then** Tag số có giá trị ngẫu nhiên trong khoảng hiển thị, Tag BOOL bật/tắt theo chu kỳ.
5. **Given** đang Online, **When** bật Mô phỏng, **Then** Studio hỏi rồi chuyển sang Offline trước; Online và Mô phỏng không chạy cùng lúc.

---

### Edge Cases

**Giao thức và thiết bị trường**

- **Exception:**
  - 01 (mã hàm không hỗ trợ, ví dụ thiết bị trường không có mã 06): Tag BAD, kèm gợi ý đặt "luôn dùng mã 16";
  - 06 (thiết bị trường bận): thử lại theo số lần cấu hình rồi mới BAD;
  - 0A, 0B qua cổng nối Modbus TCP–RTU: chỉ thiết bị trường phía sau BAD, kênh vẫn chạy.
- **Giới hạn mỗi yêu cầu:** vùng liền nhau dài hơn 125 thanh ghi (hoặc giới hạn nhỏ hơn của thiết bị trường) được tách thành nhiều yêu cầu. Một Tag chuỗi dài hơn giới hạn một lần đọc là lỗi kiểm tra, vì đọc qua hai yêu cầu có thể cho giá trị không nhất quán.
- **Hết thời gian chờ khi đọc:** Tag của yêu cầu BAD ngay sau khi hết số lần thử (FR-026); Modbus TCP đóng kết nối rồi kết nối lại (FR-027).
- **Phản hồi lạ:** đến sau khi đã hết thời gian chờ, sai mã giao dịch, sai unit ID, sai độ dài: bị bỏ và được đếm; không bao giờ gán nhầm cho yêu cầu khác.
- **Kết nối:**
  - thiết bị trường tự đóng kết nối khi rảnh: kết nối lại ngay một lần trước khi tính là lỗi;
  - PLC đã đủ số kết nối cho phép nên từ chối: Thử kết nối báo "PLC từ chối kết nối (có thể đã đủ số kết nối)";
  - mất gói trên mạng: TCP tự truyền lại; mất nhiều thì thành hết thời gian chờ, như rút cáp.
- **RTU:**
  - bộ chuyển RS485 vọng lại byte vừa gửi: tùy chọn bỏ phần vọng lại;
  - khung thiếu byte, thừa byte, nhiễu: bị bỏ và được đếm;
  - một thiết bị trường không trả lời làm chậm cả bus: thiết bị đó vào trạng thái tạm ngưng (FR-027).
- **Số:**
  - số thực 32/64 bit có 4 thứ tự byte/word; NaN hoặc vô cực đọc từ PLC: BAD "giá trị không hợp lệ";
  - số nguyên 64 bit lớn hơn 2^53: hiển thị và ghi đủ chính xác; dùng trong biểu thức thì mất chính xác (cảnh báo khi kiểm tra).
- **Chuỗi:** dừng ở byte 0 đầu tiên; số byte lẻ thì đệm byte 0; byte không phải UTF-8 hợp lệ được thay bằng ký tự thay thế.
- **Bit trong thanh ghi:** đọc cùng lúc với thanh ghi chứa nó. Tag RW mà thiết bị trường chưa có cách ghi bit: lỗi kiểm tra.
- **Hai Tag cùng địa chỉ** (ví dụ một FLOAT32 và hai INT16 của nó): đọc một lần, cập nhật cả hai.
- **Lệch 1 khi đánh số:** địa chỉ dạng 40001 hay HR0, gốc 0 hay gốc 1: Studio luôn hiện mã hàm và offset thật gửi đi.
- **Kênh hoặc thiết bị trường bị tắt** trong project: không có lưu lượng; Tag BAD "đã tắt".

**Ghi Tag**

- Ghi khi mất kết nối: `REJECTED` ngay, không xếp hàng chờ gửi sau.
- Mất kết nối sau `ACCEPTED`, trước khi gửi: `FAILED` "chưa gửi"; chắc chắn chưa ghi.
- Đã gửi lệnh ghi mà hết thời gian chờ: `TIMEOUT`, không tự gửi lại (FR-028).
- Nạp xuống project mới khi đang có lệnh ghi: lệnh đã gửi chạy tới cùng, lệnh chưa gửi bị hủy, lệnh mới bị từ chối (FR-042; US2, kịch bản 12).
- Bấm Ghi hai lần, hoặc Studio gửi lại sau khi mất mạng: cùng mã yêu cầu, BL335 chỉ thực hiện một lần.
- Hai người ghi cùng Tag: chạy theo thứ tự nhận (US2, kịch bản 8).
- **Tag lệnh xung** (PLC tự xóa bit ngay sau khi nhận): tắt "đọc lại sau khi ghi"; khi đó `CONFIRMED` theo phản hồi của thiết bị trường, Studio ghi rõ "thiết bị xác nhận, không đọc lại". Nếu vẫn bật đọc lại thì kết quả là `FAILED` "đọc lại khác", kèm giá trị đọc được.
- Mất điện hoặc runtime bị giết giữa lúc ghi: sau khởi động lại, bản ghi audit của lệnh dở có kết quả "không rõ kết quả"; BL335 không gửi lại lệnh.
- Phiên hết hạn, tài khoản bị tắt hay bị hạ role giữa chừng: lệnh kế tiếp bị từ chối như 005; lệnh đã `ACCEPTED` chạy tới cùng, kết quả ghi dưới tài khoản đã gửi lệnh.
- Không ghi được audit (bộ nhớ đầy hay hỏng): mọi lệnh ghi bị từ chối, như thao tác thay đổi của 005.
- Gõ "12,5": Studio báo phải dùng dấu chấm thập phân, không đoán; tránh "1,000" bị hiểu thành 1 hay 1000.
- Ghi đúng bằng giá trị hiện tại: vẫn gửi, vẫn có audit.
- Project trên máy khác project trên BL335: hộp xác nhận dùng định nghĩa Tag trên BL335 (quyền, giới hạn, đơn vị, scaling) và cảnh báo khác biệt. Tag không có trên BL335 thì không ghi được.
- Vượt giới hạn tần suất ghi: `REJECTED` "quá tần suất"; các lần từ chối giống nhau trong 60 s có thể gộp thành một bản ghi audit kèm số lần.

**Biểu thức, Tag nội bộ, bảng giá trị**

- Chia cho 0, chia lấy dư cho 0, tràn thành vô cực, NaN, kết quả ngoài khoảng của kiểu Tag: BAD kèm lý do; tự hết khi đầu vào hợp lệ trở lại.
- Tự tham chiếu, vòng gián tiếp qua nhiều Tag, chuỗi phụ thuộc dài hơn 16 tầng: lỗi kiểm tra.
- Lúc khởi động, đầu vào chưa có giá trị: Tag tính toán BAD "chưa có giá trị" cho tới khi đủ đầu vào.
- Làm tròn nửa: `round(2.5)` = 3 và `round(-2.5)` = −3 ở cả hai bản.
- Đổi tên Tag đang được biểu thức dùng: Studio cập nhật mọi tham chiếu (FR-047). Xóa Tag đó: biểu thức báo lỗi tham chiếu.
- Giá trị không khớp mục nào của bảng giá trị: dùng mục mặc định; không có mục mặc định thì chữ rỗng, không màu.
- Mất điện giữa lúc lưu Tag giữ qua mất điện: giữ bản lưu trước đó. Bản lưu không đọc được: dùng giá trị đầu, báo trong chẩn đoán, giữ file hỏng để điều tra.
- Đồng hồ BL335 sai sau mất điện (RTC không đọc được): giá trị giữ qua mất điện không phụ thuộc giờ; thời điểm trong audit có cờ giờ chưa đồng bộ như 005.

**Studio**

- **Bộ gõ:** gõ bằng Telex có sẵn của Windows hoặc Unikey vào ô đang chọn: ký tự đầu bắt đầu sửa ô, chữ được ghép đúng. Nhấn Esc giữa lúc đang ghép chữ: hủy sửa, ô giữ nội dung cũ. Enter lúc bộ gõ đang ghép chữ thuộc về bộ gõ, không xác nhận ô.
- **Dán từ Excel:**
  - nhiều cột hơn lưới: cột thừa bị bỏ và Studio báo số cột bỏ; ít cột hơn: các ô còn lại giữ nguyên;
  - dòng đầu là tiêu đề: bỏ qua nếu khớp tên cột;
  - ô có công thức: lấy giá trị;
  - số có dấu phẩy thập phân của Excel tiếng Việt: đổi theo lựa chọn dấu thập phân; ô mơ hồ báo lỗi.
- **CSV:** đọc đúng file có BOM, file dùng dấu chấm phẩy, ô trong ngoặc kép có xuống dòng. Tên Tag trùng trong file: các dòng trùng báo lỗi, không áp.
- Dán hay nhập làm vượt 2.000 Tag: từ chối phần vượt, báo số dòng bị bỏ.
- Hoàn tác một lần dán 2.000 dòng: một bước.
- **Bảng Tag Online với 2.000 Tag:** chỉ nhận giá trị sống cho các dòng đang hiện, để không vượt giới hạn mỗi lần đăng ký của kênh dữ liệu sống (khoảng 1.000 Tag).
- **Project 0.1:**
  - chọn Mở chỉ đọc: vẫn kiểm tra, xem trước, nạp xuống nguyên trạng cho BL335 chạy runtime cũ;
  - nâng cấp gặp file không đọc được: không đổi gì, báo lý do.
- Project 0.2 nạp xuống BL335 chạy runtime 0.4: dòng Tương thích runtime khóa nạp, nói cần cập nhật runtime.
- Bảng theo dõi có Tag mà BL335 không có: dòng ghi "không có trên thiết bị", không ghi được.

## Requirements *(mandatory)*

### Functional Requirements

**Định dạng project 0.2.0, nâng cấp, tương thích**

- **FR-001**: Định dạng project 0.2.0 MUST mô tả được kênh, thiết bị trường, nhóm quét, Tag v1 (FR-009), bảng giá trị và bảng theo dõi. Mọi file của một project MUST mang cùng `schemaVersion` ([ADR-004](../../docs/adr/004-schema-versioning.md)). Project 0.2.0 MUST cần runtime tối thiểu 0.5.0.
- **FR-002**: Runtime 0.5.x MUST nhận project 0.1.x và 0.2.x. Project 0.1.x MUST chạy như trên runtime 0.4.0: Tag mock là Tag mô phỏng với cùng tín hiệu và cùng giá trị. Project có `schemaVersion` mà runtime không hiểu MUST bị từ chối cả gói, kèm lý do.
- **FR-003**: Khi mở project 0.1 (từ đĩa hoặc vừa đọc lên), Studio MUST đề nghị nâng cấp lên 0.2.0, nói những gì sẽ đổi và nơi giữ bản sao lưu, cho chọn Nâng cấp, Mở chỉ đọc hoặc Hủy. Ở chế độ chỉ đọc, Studio MUST cho xem, kiểm tra, xem trước, nạp xuống nguyên trạng, và MUST NOT cho sửa.
- **FR-004**: Nâng cấp MUST:
  - chạy trong bộ nhớ; file trên đĩa chỉ đổi khi lưu;
  - ngay trước lần lưu đầu, sao lưu toàn bộ file gốc vào một thư mục mới (không ghi đè bản sao lưu cũ) và hiện đường dẫn;
  - cho cùng kết quả với cùng đầu vào (kiểm bằng cặp file mẫu cũ/mới);
  - kiểm project sau nâng cấp; có lỗi thì giữ nguyên file gốc và báo lý do.
- **FR-005**: Studio MUST từ chối mở project có `schemaVersion` mới hơn mức Studio hiểu, nói phiên bản Studio cần, và MUST NOT ghi gì vào project đó.
- **FR-006**: Bộ kiểm tra hai bản (Studio và runtime) MUST có thêm luật của 0.2.0, và MUST cho cùng kết luận, cùng mã lỗi trên bộ vector chung cho cả 0.1 và 0.2.
  - **Lỗi:**
    - tên trùng; tham chiếu tới kênh, thiết bị trường, nhóm quét, bảng giá trị, Tag trong biểu thức không tồn tại;
    - địa chỉ sai cú pháp; vùng không hợp với kiểu hoặc quyền (vùng chỉ đọc mà RW); offset ngoài 0–65535; Tag không vừa một lần đọc của thiết bị trường, hoặc Tag RW không vừa một lần ghi;
    - scaling, deadband, giới hạn nhập không hợp với kiểu; Tag mô phỏng RW với bộ sinh khác nhập tay; bit trong thanh ghi RW khi thiết bị trường chưa có cách ghi bit;
    - biểu thức sai cú pháp, sai kiểu, có vòng tham chiếu, vượt giới hạn của FR-020;
    - bảng giá trị có mục chồng nhau, màu sai, chữ quá dài;
    - kênh serial dùng cổng ngoài danh sách cho phép, hoặc hai kênh dùng chung một cổng;
    - vượt giới hạn số lượng (Assumptions, D12).
  - **Cảnh báo (không chặn):**
    - Tag RW không có giới hạn nhập;
    - thời gian chờ × (số lần thử + 1) lớn hơn chu kỳ của nhóm quét, tức phát hiện mất kết nối chậm hơn 2 chu kỳ;
    - ước tính thời gian quét RTU vượt chu kỳ, kèm con số;
    - ghi bit bằng đọc-sửa-ghi;
    - Tag tính toán dùng số nguyên 64 bit;
    - bảng theo dõi tham chiếu Tag không có.

  Runtime MUST NOT kích hoạt project có lỗi (Constitution V).
- **FR-007**: Đọc lên và So sánh của 005 MUST hiểu các đối tượng mới: kênh, thiết bị trường, nhóm quét, bảng giá trị, bảng theo dõi, và Tag theo từng trường mới. Khi so project 0.2 trên máy với project 0.1 trên BL335, Studio MUST nâng cấp bản của BL335 trong bộ nhớ trước khi so, và nói rõ điều đó.
- **FR-008**: Xem trước Nạp xuống (005) MUST có thêm:
  - tương thích: project 0.2 cần runtime ≥ 0.5.0; BL335 chạy runtime thấp hơn thì khóa nạp và nói cần cập nhật runtime;
  - kết nối: kênh và thiết bị trường thêm, bớt, đổi; kênh nào sẽ kết nối lại;
  - Tag giữ qua mất điện sẽ về giá trị đầu (đổi kiểu, bỏ giữ, bị xóa).

**Tag v1 và Tag Engine**

- **FR-009**: Mỗi Tag MUST có:
  - tên (duy nhất, quy tắc tên như 0.1), loại (ngoài, nội bộ, tính toán, mô phỏng), kiểu dữ liệu (10 kiểu như 0.1), mô tả, đơn vị, khoảng hiển thị;
  - quyền R hoặc RW (mặc định R), giới hạn nhập (tùy chọn);
  - bảng giá trị, deadband (Tag số), cấu hình mô phỏng: đều tùy chọn.

  Thêm theo loại:
  - **Tag ngoài:** kênh và thiết bị trường, địa chỉ, nhóm quét (mặc định thường), scaling (tùy chọn), thứ tự byte/word (mặc định theo thiết bị trường), độ dài chuỗi, đọc lại sau khi ghi (mặc định bật);
  - **Tag nội bộ:** giá trị đầu; giữ qua mất điện (mặc định tắt);
  - **Tag tính toán:** biểu thức; luôn R;
  - **Tag mô phỏng:** bộ sinh và tham số (FR-022).
- **FR-010**: Mỗi Tag MUST có quality GOOD, UNCERTAIN hoặc BAD. Quality khác GOOD MUST có lý do, ví dụ:
  - chưa có giá trị; đã tắt; mất kết nối; hết thời gian chờ;
  - thiết bị trường báo lỗi (mã exception và nghĩa);
  - giá trị không hợp lệ (NaN, vô cực); đã giới hạn theo scaling;
  - đầu vào xấu; chia cho 0; tràn kiểu.

  Tag chuyển BAD MUST giữ giá trị cuối kèm quality BAD, để trang xem và lưu trữ áp quy tắc quality xấu đang có.
- **FR-011**: Scaling tuyến tính hai điểm (thô min/max → kỹ thuật min/max), chỉ cho Tag số:
  - đọc: giá trị kỹ thuật là số thực. Tùy chọn kẹp theo khoảng: giá trị thô ngoài khoảng thô thì giá trị kỹ thuật bị kẹp ở cận gần nhất, quality UNCERTAIN, lý do "đã giới hạn theo scaling";
  - ghi: đổi ngược về kiểu thô (làm tròn như `round` nếu kiểu thô là số nguyên); kết quả ngoài khoảng của kiểu thô MUST bị `REJECTED`.
- **FR-012**: Deadband của Tag số: giá trị mới chỉ được phát tới client, lưu trữ và Tag tính toán khi lệch so với giá trị đã phát lớn hơn deadband. Đổi quality MUST luôn được phát. Deadband 0 là phát mọi thay đổi.
- **FR-013**: Kiểu dữ liệu trên Modbus:
  - BOOL: coil, discrete input, hoặc bit 0–15 của một thanh ghi;
  - số 16 bit chiếm 1 thanh ghi, 32 bit chiếm 2, 64 bit chiếm 4;
  - số 32 và 64 bit MUST có 4 thứ tự: chuẩn Modbus (ABCD: word cao trước, byte cao trước), đảo word (CDAB), đảo byte trong word (BADC), đảo cả hai (DCBA). Với 64 bit, "đảo word" đảo thứ tự cả 4 word;
  - STRING:
    - độ dài tính theo byte; thứ tự byte trong thanh ghi chọn được;
    - đọc tới byte 0 đầu tiên, giải mã UTF-8, byte lỗi thay bằng ký tự thay thế;
    - ghi mã hóa UTF-8, đệm byte 0; dài hơn độ dài khai báo MUST bị `REJECTED`.

  Phép đổi giữa giá trị thô và giá trị Tag MUST có bộ vector chung cho runtime và Studio. Studio dùng phép đổi này khi hiện kết quả đọc thử.
- **FR-014**: Bit trong thanh ghi MUST được đọc cùng lúc với thanh ghi chứa nó. Ghi chỉ được khi thiết bị trường có đặt cách ghi bit:
  - ghi có mặt nạ (mã hàm 22);
  - hoặc đọc-sửa-ghi, kèm cảnh báo: PLC có thể đổi thanh ghi giữa hai bước và bị ghi đè.
- **FR-015**: Địa chỉ Modbus MUST nhận hai dạng, theo gốc đánh số (0 hoặc 1) của thiết bị trường:
  - vùng + offset, ví dụ HR100, IR5, C12, DI0;
  - dạng Modicon 5 hoặc 6 chữ số, ví dụ 40101, 400101.

  Cạnh ô địa chỉ, Studio MUST hiện mã hàm, offset thật gửi đi và số thanh ghi Tag chiếm.
- **FR-016**: Mọi giá trị Tag MUST đi qua Tag Engine:
  - đọc: driver → Tag Engine → client, lưu trữ (003), Tag tính toán;
  - ghi: yêu cầu → Tag Engine → driver.

  Trình duyệt và Studio MUST NOT nói chuyện trực tiếp với thiết bị trường (Constitution II). Lưu trữ của 003 MUST nhận Tag mọi loại theo cùng luật (Tag không GOOD ghi ô rỗng).
- **FR-017**: Có ba nhóm quét nhanh, thường, chậm, chu kỳ đặt theo project (mặc định 250 ms, 1 s, 5 s; cho phép 100 ms–60 s). Khi kênh không kịp chu kỳ, BL335 MUST NOT dồn yêu cầu: lượt trễ bị bỏ, chu kỳ thực được báo trong chẩn đoán.
- **FR-018**: Tag nội bộ có giá trị đầu khi khởi động; ở GĐ 2 chỉ đổi khi có lệnh ghi. Với Tag giữ qua mất điện:
  - giá trị đổi được lưu gom, tối đa một lần mỗi cửa sổ gom (mặc định 5 s, cấu hình trên BL335 trong 1–60 s);
  - sau khởi động lại hay mất điện, Tag MUST có giá trị đã lưu cuối cùng; chỉ thay đổi trong cửa sổ gom cuối có thể mất;
  - mất điện giữa lúc lưu MUST NOT làm hỏng bản lưu trước đó. Bản lưu không đọc được thì dùng giá trị đầu, báo trong chẩn đoán, giữ file hỏng;
  - nạp project mới hay khôi phục bản trước: Tag cùng tên, cùng kiểu, vẫn giữ qua mất điện thì giữ giá trị; Tag khác về giá trị đầu.
- **FR-019**: Tag tính toán:
  - MUST được tính lại khi một đầu vào đổi giá trị hoặc quality, và lúc khởi động;
  - Tag tính toán phụ thuộc nhau MUST được tính theo thứ tự phụ thuộc trong cùng một lượt. Giá trị mới MUST tới client cùng lần gửi dữ liệu sống với đầu vào, hoặc lần gửi ngay sau;
  - quality là quality xấu nhất của các đầu vào thực sự được dùng; nhánh không được tính của `? :`, `&&`, `||` không tính;
  - lỗi khi tính (chia cho 0, tràn, NaN, ngoài khoảng của kiểu Tag) MUST cho BAD kèm lý do.
- **FR-020**: Biểu thức MUST chỉ gồm các thành phần dưới đây (không script, Constitution V):
  - số, `true`/`false`, chuỗi trong ngoặc kép, tên Tag, tên bảng giá trị (chỉ trong `text`);
  - `+ − × ÷ %` (gõ là `+ - * / %`), đổi dấu; so sánh `== != < <= > >=`; logic và, hoặc, phủ định (`&&`, `||`, `!`); `? :`; ngoặc;
  - hàm `min`, `max`, `abs`, `round`, `clamp`, `text(giá trị, bảng)`.

  Ngữ nghĩa MUST giống nhau ở hai bản, chốt bằng bộ vector chung:
  - số là số thực 64 bit; BOOL trong phép số là 1 hoặc 0; toán hạng của phép logic MUST là BOOL;
  - `round` làm tròn nửa ra xa số 0, có tham số số chữ số lẻ; `%` mang dấu của số bị chia;
  - chuỗi chỉ dùng với `==`, `!=` và làm kết quả;
  - kết quả gán vào Tag số nguyên được làm tròn như `round`.

  Giới hạn: ≤ 1.000 ký tự; lồng ≤ 32 mức; ≤ 32 Tag đầu vào; chuỗi phụ thuộc ≤ 16 tầng.
- **FR-021**: Bảng giá trị có tên duy nhất. Mỗi mục là một giá trị (số hoặc BOOL) hoặc một khoảng `từ ≤ x < đến` (được bỏ trống một đầu), kèm chữ (≤ 64 ký tự) và màu (tùy chọn). Có thể có mục mặc định. Các mục MUST NOT chồng nhau. Bảng giá trị dùng cho `text()`, cho hiển thị trong Studio, và cho binding màn hình (FR-054).
- **FR-022**: Tag mô phỏng có các bộ sinh:
  - hằng; ramp (từ, tới, thời gian); sin (tâm, biên độ, chu kỳ);
  - ngẫu nhiên (khoảng, chu kỳ đổi, hạt giống); bật/tắt (chu kỳ, tỉ lệ bật);
  - nhập tay (chỉ đổi khi có lệnh ghi).

  Giá trị MUST là hàm xác định của thời gian và tham số, giống nhau ở BL335 và Studio (bộ vector chung). Tag mock của 0.1 giữ tín hiệu cũ.

**Driver SDK (chung mọi driver)**

- **FR-023**: Mô hình kênh → thiết bị trường → Tag MUST chung cho mọi driver. Driver nhận cấu hình; phát giá trị và quality, kết quả ghi, số liệu chẩn đoán; và MUST NOT làm gì khác (không ghi DB, không gửi gì tới client). Modbus TCP, Modbus RTU và nguồn Tag mô phỏng MUST cắm vào Tag Engine theo cùng mô hình, và MUST đạt cùng bộ test chuẩn cho driver.
- **FR-024**: Tag cùng thiết bị trường, cùng vùng, cùng nhóm quét MUST được gộp thành ít yêu cầu nhất, sao cho:
  - mỗi yêu cầu không vượt giới hạn giao thức (125 thanh ghi, 2.000 bit) và giới hạn đặt cho thiết bị trường;
  - khoảng trống giữa hai Tag được gộp không vượt mức đặt cho thiết bị trường (mặc định 10 thanh ghi hoặc 64 bit; 0 là chỉ gộp địa chỉ liền nhau);
  - không Tag nào bị tách qua hai yêu cầu.
- **FR-025**: Khi thiết bị trường trả exception 02 hoặc 03 cho một yêu cầu gộp, driver MUST tách nhỏ để tìm Tag gây lỗi. Chỉ Tag đó BAD kèm mã. Trong lúc tách, các Tag khác giữ giá trị và quality đang có, rồi có giá trị mới từ lượt quét sau. Cách tách MUST được nhớ tới khi kết nối lại hoặc đổi project.
- **FR-026**: Thời gian chờ trả lời và số lần thử lại đặt theo thiết bị trường. Mặc định: Modbus TCP chờ 1 s, không thử lại; RTU chờ 1 s, thử lại 1 lần. Yêu cầu đọc hỏng (hết thời gian chờ, mất kết nối, khung hỏng, exception khác 02 và 03) sau khi hết số lần thử: mọi Tag của yêu cầu MUST BAD ngay, kèm lý do. Với cấu hình mặc định và nhóm quét thường, Tag MUST BAD trong ≤ 2 chu kỳ quét kể từ lúc mất kết nối.
- **FR-027**: Kết nối lại:
  - Modbus TCP: đóng kết nối sau khi hết thời gian chờ hoặc gặp lỗi giao thức; kết nối lại với khoảng chờ tăng dần có ngẫu nhiên, từ 1 s tới tối đa 10 s (đặt được 1–60 s); không cần khởi động lại runtime;
  - RTU: thiết bị trường có 3 yêu cầu liên tiếp không nhận được trả lời hợp lệ (hết thời gian chờ hoặc khung hỏng) thì vào trạng thái tạm ngưng, chỉ được hỏi thử mỗi 10 s. Trả lời exception vẫn là trả lời hợp lệ. Thiết bị trường khác trên cùng kênh MUST giữ chu kỳ.
- **FR-028**: Hàng đợi ghi:
  - lệnh ghi MUST đi trước các yêu cầu đọc đang chờ trên cùng kênh; lệnh ghi cùng Tag theo thứ tự nhận;
  - mỗi lệnh MUST được gửi tối đa một lần: driver MUST NOT tự gửi lại lệnh đã gửi mà hết thời gian chờ;
  - lệnh ghi MUST NOT được giữ lại để gửi khi kết nối có lại.
- **FR-029**: Số liệu chẩn đoán, đếm từ lúc runtime chạy:
  - **kênh:** trạng thái (đã tắt, đang kết nối, đã kết nối, lỗi); lỗi gần nhất và thời điểm; số lần kết nối lại;
  - **thiết bị trường:** trạng thái (hoạt động, tạm ngưng, lỗi, đã tắt); số yêu cầu thành công; số lần hết thời gian chờ; exception theo mã; khung hỏng (CRC, sai định dạng, sai mã giao dịch); thời gian trả lời trung bình và lớn nhất; chu kỳ thực của từng nhóm quét so với chu kỳ đặt; số lệnh ghi theo kết quả;
  - **Tag:** quality, lý do, thời điểm cập nhật cuối.

**Modbus TCP**

- **FR-030**: Cấu hình:
  - **kênh Modbus TCP:** địa chỉ (IP hoặc tên máy), cổng (mặc định 502), thời gian chờ kết nối, khoảng nghỉ giữa hai yêu cầu (mặc định 0), bật/tắt;
  - **thiết bị trường:** unit ID 0–255 (mặc định 1), gốc đánh số, giới hạn mỗi lần đọc, khoảng trống tối đa để gộp, thứ tự byte/word mặc định, thời gian chờ, số lần thử lại, thời hạn ghi, bật/tắt;
  - **cách ghi của thiết bị trường:** thanh ghi đơn bằng mã 06 hay luôn mã 16; coil đơn bằng mã 05 hay luôn mã 15; cách ghi bit trong thanh ghi (FR-014).

  Nhiều thiết bị trường MUST dùng chung kết nối của kênh, như khi đi qua cổng nối Modbus TCP–RTU.
- **FR-031**: Driver MUST dùng mã hàm 01, 02, 03, 04, 05, 06, 15, 16, và 22 khi được đặt. Mỗi exception 01–0B MUST được hiện bằng mã kèm nghĩa tiếng Việt, ví dụ "02: địa chỉ không hợp lệ". Exception 0A, 0B MUST chỉ làm thiết bị trường liên quan BAD, không ngắt kênh.
- **FR-032**: Driver MUST chỉ nhận phản hồi đúng mã giao dịch, unit ID, mã hàm và độ dài. Phản hồi trễ hoặc sai MUST bị bỏ và được đếm. Dữ liệu sai định dạng hay cố ý độc hại MUST NOT làm runtime dừng hoặc treo, và MUST NOT đưa giá trị sai vào Tag (có test fuzz).

**Modbus RTU**

- **FR-033**: Kênh Modbus RTU gồm:
  - cổng serial; tốc độ 1.200–115.200 bit/s; 7 hoặc 8 bit dữ liệu; parity (không, chẵn, lẻ); 1 hoặc 2 bit dừng;
  - chế độ RS485; bỏ phần vọng lại (tùy chọn);
  - khoảng lặng giữa hai khung: tự tính theo tốc độ, tối thiểu theo chuẩn Modbus, đặt lại được;
  - bật/tắt.

  Thiết bị trường có địa chỉ slave 1–247 và các trường như FR-030. Không có ghi broadcast (địa chỉ 0).
- **FR-034**: Khung RTU MUST được kiểm CRC. Khung sai CRC, thiếu hay thừa byte MUST bị bỏ, được đếm, và MUST NOT cập nhật Tag.
- **FR-035**: Cổng serial:
  - MUST thuộc danh sách cổng cho phép trên BL335; project MUST NOT khiến runtime mở file hay thiết bị khác;
  - mỗi cổng chỉ một kênh;
  - cổng đang được hệ điều hành (ví dụ console) hay chương trình khác dùng: kênh MUST ở trạng thái lỗi với lý do "cổng đang được … dùng", và MUST NOT chiếm cổng; các kênh khác vẫn chạy;
  - chế độ RS485 được yêu cầu mà kernel không hỗ trợ: kênh MUST có cảnh báo "cổng không có chế độ RS485 của kernel" trong chẩn đoán, và chạy ở chế độ thường (cho bộ chuyển tự đổi chiều).

  BL335 MUST báo danh sách cổng cho Studio (role engineer): tên, loại (trên bo, USB), đang được kênh nào hay hệ điều hành dùng, có chế độ RS485 hay không nếu biết.

**Ghi Tag**

- **FR-036**: Ghi Tag MUST chỉ đi qua kết nối HTTPS có đăng nhập của 005, cùng chuỗi kiểm (HTTPS → phiên → role → audit) và cùng bảng quyền duy nhất. Role tối thiểu:
  - ghi Tag: operator;
  - xem chẩn đoán driver: viewer;
  - xem danh sách cổng serial, Thử kết nối: engineer.

  Ở GĐ 2, MUST NOT ghi được qua cổng HTTP, qua kênh dữ liệu sống, hay từ trang xem trên Chrome.
- **FR-037**: BL335 MUST kiểm mỗi lệnh ghi theo thứ tự dưới đây, và trả `REJECTED` kèm lý do ở điều kiện đầu tiên không đạt:
  1. đã đăng nhập, phiên còn hạn, đủ role (lỗi theo 005);
  2. Tag tồn tại, có quyền RW, không phải Tag tính toán;
  3. giá trị đúng kiểu, không phải NaN hay vô cực;
  4. trong giới hạn nhập, khoảng của kiểu, khoảng thô sau scaling, độ dài chuỗi;
  5. với Tag ngoài: kênh ở trạng thái đã kết nối và thiết bị trường ở trạng thái hoạt động (FR-029);
  6. trong giới hạn tần suất (FR-041); hàng đợi ghi chưa đầy;
  7. BL335 không đang đổi project;
  8. bản ghi audit lúc nhận đã được lưu bền.

  Qua hết thì trả `ACCEPTED`. Khi `REJECTED`, MUST NOT có gì gửi tới thiết bị trường.
- **FR-038**: Kết quả cuối của lệnh đã `ACCEPTED`:
  - `TIMEOUT`: đã gửi mà không có trả lời trong thời gian chờ, nên không chắc đã ghi; hoặc thiết bị trường đã nhận lệnh ghi nhưng lần đọc lại không có trả lời (lý do nói rõ trường hợp nào);
  - `FAILED`, một trong ba trường hợp:
    - thiết bị trường báo lỗi (mã exception);
    - lệnh không gửi được: mất kết nối trước khi gửi, còn trong hàng đợi khi hết thời hạn ghi (mặc định 5 s), hay project đổi;
    - đọc lại khác giá trị đã ghi (kèm giá trị đọc được);
  - `CONFIRMED`: đọc lại khớp giá trị thô đã ghi. Ngoài ra:
    - Tag tắt "đọc lại sau khi ghi": `CONFIRMED` khi thiết bị trường trả lời thành công; Studio MUST ghi rõ "thiết bị xác nhận, không đọc lại";
    - Tag nội bộ và Tag mô phỏng nhập tay: `CONFIRMED` khi giá trị đã được áp.

  Sau `CONFIRMED`, Tag MUST mang giá trị đọc lại ngay (không xét deadband), không đợi lượt quét sau.
- **FR-039**: Mỗi lệnh ghi MUST có audit gồm: thời điểm (kèm cờ giờ chưa đồng bộ), tài khoản, role, địa chỉ nguồn, mã yêu cầu, Tag, kênh và thiết bị trường, giá trị cũ (lúc nhận), giá trị mới (kèm giá trị thô khi có scaling), kết quả, lý do.
  - Bản ghi lúc nhận MUST được lưu bền trước khi lệnh được gửi tới thiết bị trường; kết quả cuối MUST được ghi thêm sau.
  - Lệnh đã có bản ghi lúc nhận mà chưa có kết quả khi runtime dừng (mất điện, bị giết) MUST được ghi "không rõ kết quả" khi khởi động lại.
  - Lệnh bị từ chối MUST có audit kèm Tag và giá trị yêu cầu. Các lần từ chối giống nhau trong 60 s MAY gộp thành một bản ghi có số lần, như truy cập bị từ chối của 005.
  - Administrator MUST lọc được audit theo Tag trong Studio.
- **FR-040**: Mỗi lệnh ghi MUST mang mã yêu cầu do Studio sinh. BL335 MUST nhớ mã yêu cầu ít nhất 10 phút, và MUST NOT thực hiện hai lần cùng một mã; gửi lại cùng mã thì nhận kết quả của lần trước. Hai người ghi cùng Tag: chạy theo thứ tự nhận, mỗi người nhận kết quả của lệnh mình.
- **FR-041**: BL335 MUST giới hạn tần suất ghi, đặt được trong cấu hình thiết bị. Mặc định:
  - mỗi phiên: tối đa 10 lệnh gửi liền nhau, trung bình ≤ 20 lệnh/phút;
  - toàn BL335: tối đa 20 lệnh gửi liền nhau, trung bình ≤ 30 lệnh/phút.

  Plan chốt mặc định cuối cùng theo số đo ghi eMMC trên BL335 để đạt SC-011, và không cao hơn các mức trên.
- **FR-042**: Từ lúc BL335 bắt đầu kích hoạt project mới:
  - lệnh ghi mới MUST bị `REJECTED` (đang đổi project);
  - lệnh đã gửi MUST được chờ tới khi có kết quả hoặc hết thời gian chờ;
  - lệnh chưa gửi MUST bị hủy thành `FAILED` và MUST NOT được gửi.

  Mọi kết quả MUST có audit.

**Studio**

- **FR-043**: Cây project MUST có:
  - Kết nối: kênh › thiết bị trường, kèm số Tag; chấm trạng thái khi Online;
  - Tag: Bảng Tag, Tag tính toán;
  - Bảng giá trị: từng bảng;
  - Bảng theo dõi: từng bảng;
  - Chẩn đoán driver.

  Các mục này bỏ nhãn giai đoạn. Thêm, đổi tên, nhân bản, xóa MUST làm được bằng menu chuột phải, bằng phím và bằng bảng lệnh. Vùng Details MUST liệt kê Tag của nút đang chọn và cho kéo Tag sang Bảng theo dõi hoặc ô biểu thức.
- **FR-044**: Editor Kết nối là form chia nhóm theo loại kênh và thiết bị trường: có giá trị mặc định, trợ giúp ngay dưới ô, lỗi tại ô. Nút Thử kết nối:
  - chạy trên BL335 (cần Online, role engineer) với cấu hình đang sửa, chưa cần nạp xuống. Offline thì nút bị khóa kèm lý do. Studio MUST NOT tự kết nối tới thiết bị trường;
  - MUST chỉ đọc và MUST NOT làm gián đoạn kênh đang chạy. Cổng serial đang do một kênh chạy với cùng thông số: thử qua kênh đó. Khác thông số: báo cổng đang bận;
  - cho kết quả trong ≤ tổng thời gian chờ đã đặt (chờ kết nối và chờ trả lời) + 2 s: kết nối được hay không, lý do, thời gian trả lời;
  - tùy chọn đọc một địa chỉ: hiện giá trị thô (hex) và cách hiểu theo các kiểu ở cả 4 thứ tự byte, hoặc mã exception và nghĩa;
  - mỗi lúc chỉ một lần thử trên một BL335, tối đa 10 lần/phút; MUST có audit.
- **FR-045**: Bảng Tag là lưới:
  - **cột:** theo loại Tag; chọn cột, chọn bộ cột có sẵn (Tag ngoài, nội bộ, tính toán, mô phỏng, tất cả), nhớ lựa chọn;
  - **trình sửa ô:** danh sách chọn cho loại, kiểu, kênh, thiết bị trường, nhóm quét, bảng giá trị; ô địa chỉ có gợi ý cú pháp và hiện offset thật (FR-015);
  - **gõ thẳng:** gõ ký tự đầu MUST bắt đầu sửa ô đang chọn, kể cả qua bộ gõ có ghép chữ (Telex có sẵn của Windows, Unikey). Ô nhận đúng chữ đã gõ: không mất, không lặp ký tự, không cần F2. F2, Enter, nhấp đúp vẫn dùng được;
  - **thêm hàng loạt:** số dòng, mẫu tên có số tăng, địa chỉ bắt đầu và bước (mặc định bằng số thanh ghi của kiểu), kiểu, kênh, thiết bị trường, nhóm quét;
  - **điền xuống** (Ctrl+D) và **kéo điền:** tên tăng số; địa chỉ tăng theo số thanh ghi của kiểu; ô khác chép nguyên;
  - **chọn vùng** nhiều ô: gõ một giá trị rồi áp cho cả vùng; xóa cả vùng;
  - **dán từ Excel:** nhiều dòng, nhiều cột; tạo dòng mới khi dán quá dòng cuối; số đọc theo lựa chọn dấu thập phân như khi nhập CSV; ô sai bị đánh dấu lỗi, phần còn lại vẫn được dán. Chép ra Excel giữ đúng cột;
  - **nhập CSV:** có xem trước; khớp cột theo tiêu đề; thêm mới và cập nhật theo tên, không xóa Tag; chọn được dấu phân cách cột và dấu thập phân (mặc định theo thiết lập vùng của Windows); lỗi theo dòng và ô;
  - **xuất CSV:** mọi cột; mở trong Excel đúng tiếng Việt;
  - **lọc** theo từng cột, tìm, sắp xếp;
  - **lỗi theo ô:** viền đỏ; lý do khi trỏ chuột hoặc focus; liệt kê ở tab Thông tin; nhấp đúp tới đúng ô;
  - **hoàn tác:** mỗi thao tác hàng loạt (thêm, điền, dán, nhập) là một bước;
  - **ảo hóa:** đạt SC-012 với 2.000 dòng (giới hạn Tag);
  - **khi Online:** cột giá trị sống, quality và lý do; chỉ nhận giá trị sống cho các dòng đang hiện.
- **FR-046**: Lưới của Bảng giá trị và Bảng theo dõi MUST có cùng cách chọn ô, gõ thẳng (kể cả qua bộ gõ), sao chép, dán, hoàn tác như Bảng Tag.
- **FR-047**: Đổi tên Tag MUST cập nhật mọi tham chiếu trong project (biểu thức, bảng theo dõi, nhóm lưu trữ, binding), sau khi người dùng xem danh sách chỗ sẽ đổi. Cả lần đổi là một bước hoàn tác. Inspector cho Tag MUST:
  - hiện mọi thuộc tính theo nhóm và cho sửa;
  - có "Dùng ở đâu", tính cả biểu thức và bảng theo dõi;
  - với Tag tính toán: liệt kê các Tag đầu vào.
- **FR-048**: Editor Bảng giá trị gồm:
  - lưới mục: giá trị hoặc khoảng, chữ, màu (ô màu và bộ chọn màu); mục mặc định;
  - ô thử: nhập một giá trị, thấy chữ và màu tương ứng;
  - lỗi theo ô: chồng nhau, màu sai, chữ quá dài;
  - "Dùng ở đâu".
- **FR-049**: Editor biểu thức của Tag tính toán:
  - tô màu cú pháp; gợi ý tên Tag (theo một phần tên, không phân biệt hoa thường), tên hàm kèm cú pháp, tên bảng giá trị;
  - kiểm khi gõ: lỗi hiện ≤ 500 ms sau khi ngừng gõ, gạch dưới đúng vị trí, có lý do (cú pháp, tên không có, sai kiểu, vòng tham chiếu kèm đường vòng);
  - xem trước kết quả với giá trị mô phỏng hoặc giá trị sống của đầu vào, kèm giá trị từng đầu vào; dùng bộ tính dùng chung với runtime (cùng bộ vector).
- **FR-050**: Bảng theo dõi:
  - **lưu trữ:** nhiều bảng, lưu trong project (có trong gói, đọc lên và so sánh được); runtime chỉ kiểm, không dùng khi chạy;
  - **thêm Tag:** gõ tên (có gợi ý), dán danh sách tên, kéo từ Details hoặc Bảng Tag;
  - **cột:** tên; định dạng hiển thị (thập phân, hex, nhị phân, BOOL; số chữ số lẻ); giá trị sống; quality và lý do; thời điểm; chữ và màu theo bảng giá trị; giá trị ghi (lưu cùng bảng, không tự ghi khi mở);
  - **ghi:** chọn một hay nhiều dòng rồi chọn lệnh Ghi. Hộp xác nhận liệt kê từng Tag: thiết bị trường, giá trị hiện tại, giá trị mới đã hiểu, đơn vị, giới hạn. Chỉ ghi khi người dùng xác nhận rõ; Enter trong ô MUST NOT ghi. Mỗi dòng hiện kết quả và thời điểm;
  - **khóa ghi:** Studio MUST khóa lệnh Ghi và nói lý do khi chưa Online có đăng nhập, role thấp hơn operator, Tag R hoặc tính toán, giá trị sai hoặc ngoài giới hạn, kết nối xấu, Tag không có trên BL335;
  - **số:** dùng dấu chấm thập phân; gõ dấu phẩy thì báo tại ô, kèm gợi ý;
  - **khác project:** project trên máy khác project trên BL335 thì hộp xác nhận MUST dùng định nghĩa Tag trên BL335 (quyền, giới hạn, đơn vị, scaling) và cảnh báo khác biệt.
- **FR-051**: Trang Chẩn đoán driver (Online, role viewer trở lên) gồm:
  - cây kênh › thiết bị trường có trạng thái;
  - số liệu của FR-029, kèm phần tăng thêm từ lúc mở trang;
  - chu kỳ thực cạnh chu kỳ đặt, có dấu quá tải;
  - danh sách Tag xấu kèm lý do; nhấp đúp tới Tag;
  - cập nhật ít nhất 2 s một lần.
- **FR-052**: Mô phỏng trong Studio:
  - bật/tắt từ thanh công cụ và bảng lệnh; không cần BL335; MUST NOT gửi gì tới BL335 hay thiết bị trường;
  - có dấu "MÔ PHỎNG" rõ ràng, khác viền cam của Online. Online và Mô phỏng MUST NOT chạy cùng lúc: bật cái này thì Studio hỏi rồi tắt cái kia;
  - nguồn giá trị theo loại Tag:
    - Tag có cấu hình mô phỏng (kể cả Tag loại mô phỏng): chạy theo cấu hình đó;
    - Tag ngoài chưa có cấu hình: Tag số ngẫu nhiên trong khoảng hiển thị, BOOL bật/tắt theo chu kỳ, chuỗi rỗng;
    - Tag nội bộ: giá trị đầu;
    - Tag tính toán: tính bằng bộ tính của Studio;
  - Bảng theo dõi ghi được vào mô phỏng: không cần đăng nhập, không audit, có nhãn mô phỏng;
  - Bảng Tag, Bảng theo dõi, xem trước biểu thức và xem trước màn hình dùng chung nguồn mô phỏng; nguồn này thay chế độ Mô phỏng của xem trước ở 004;
  - bộ sinh, bộ tính biểu thức, bảng giá trị MUST nằm trong package dùng chung (Constitution II), cùng bộ vector với runtime.
- **FR-053**: Mọi lệnh mới MUST có trong menu và bảng lệnh, và dùng được chỉ bằng bàn phím. Editor mới MUST theo theme, màu trạng thái, tương phản, ARIA của 004 (FR-011, FR-012 của 004) và các quy tắc lưới, form của studio-ux.md §5.

**Trang xem và binding**

- **FR-054**: Binding màn hình MUST tham chiếu được một bảng giá trị (theo tên, hoặc bảng giá trị của Tag) để đổi giá trị thành chữ hoặc màu. Trang xem trên Chrome và xem trước của Studio MUST cho cùng kết quả (dùng chung package). Ở GĐ 2 binding vẫn viết trong JSON; sửa bằng giao diện thuộc GĐ 3b.
- **FR-055**: Trang xem trên Chrome MUST giữ chỉ đọc, qua HTTP, không cần đăng nhập (FR-033 của 005, nay kéo dài tới GĐ 3a). Trang này MUST NOT có đường ghi nào, và hiện Tag mọi loại như Tag hiện nay.
- **FR-055a**: Trang xem nay hiện dữ liệu PLC thật mà không cần đăng nhập. Vì vậy BL335 MUST mặc định chỉ phục vụ phần không cần đăng nhập cho địa chỉ nguồn trong mạng riêng, trên cả hai cổng HTTP và HTTPS. Phần không cần đăng nhập gồm: file của trang xem, API chỉ đọc, kênh dữ liệu sống không kèm phiên.
  - **Mạng riêng:** 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (VPN kiểu Tailscale), 169.254.0.0/16, 127.0.0.0/8, và với IPv6: fc00::/7, fe80::/10, ::1.
  - **Nguồn khác:** MUST nhận 403 kèm hướng dẫn dùng VPN, và được đếm trong chẩn đoán. Không ghi audit từng lần, để không tốn ghi eMMC.
  - **Kênh dữ liệu sống của Studio:** khi đang Online, MUST gửi kèm phiên đăng nhập (token, chỉ qua HTTPS có ghim chứng chỉ). Kênh có phiên hợp lệ không bị lọc theo nguồn, nên Studio ở xa qua port-forward vẫn theo dõi được.
  - **API kỹ thuật có đăng nhập** của 005 (kể cả `device/identity`, `auth/*`) không bị lọc theo nguồn.
  - **Cấu hình thiết bị:** đổi được thành `any` (mở cho mọi nguồn, chỉ nên dùng khi demo) hoặc `off` (tắt trang xem).
  - Khi đặt `any`, `system/info`, thanh trạng thái của Studio và script triển khai MUST hiện cảnh báo.

**Tài nguyên, triển khai, kiểm thử**

- **FR-056**: Runtime MUST giữ ngân sách Constitution III trên BL335: RSS ≤ 150 MB, CPU trung bình ≤ 30 % ở tải chuẩn (SC-003, SC-004). Lượng ghi eMMC của audit ghi Tag và của Tag giữ qua mất điện MUST được đo trên BL335 (SC-011).
- **FR-057**: Gói triển khai MUST cấp cho dịch vụ quyền dùng các cổng serial cho phép mà vẫn giữ sandbox hiện có. Mọi thay đổi trên BL335 MUST được ghi vào `docs/reports/device-changes.md` kèm cách hoàn tác.
- **FR-058**: Test MUST được viết trước (Constitution VI) cho:
  - bộ tính biểu thức hai bản, bảng giá trị, bộ sinh mô phỏng, phép đổi thô ↔ giá trị (scaling, thứ tự byte, chuỗi): đều có vector chung;
  - gộp yêu cầu và tách khi có exception; mã hóa và giải mã khung Modbus TCP và RTU; CRC; xử lý exception;
  - máy trạng thái của lệnh ghi; kiểm quyền và giới hạn; giới hạn tần suất; mã yêu cầu; audit ghi Tag;
  - lưu Tag giữ qua mất điện;
  - nâng cấp 0.1 → 0.2 (cặp file mẫu); bộ kiểm tra 0.2 (vector chung);
  - mô hình lưới: dán, điền, nhập CSV, gõ qua bộ gõ.
- **FR-059**: Test tích hợp MUST có:
  - giả lập Modbus TCP chạy trong CI; cặp cổng serial ảo và giả lập RTU trong CI;
  - tiêm lỗi: hết thời gian chờ, exception, CRC, rớt kết nối, trả lời chậm, dữ liệu rác;
  - ghi đầu-cuối có audit; giết tiến trình giữa lúc ghi và giữa lúc lưu Tag giữ qua mất điện;
  - bàn thử với PLC thật và thiết bị RS485 thật.
- **FR-060**: Modbus TCP và RTU MUST được tự viết, không dùng libmodbus. Công cụ thử dùng trong CI MUST được rà license. Trước khi phát hành, mỗi driver MUST có báo cáo (Constitution VII, lộ trình §4.8): model và firmware đã thử, license, mức đọc/ghi, phần cứng thử, RAM/CPU đo trên BL335, giả lập trong CI.

### Key Entities

- **Kênh**: loại (Modbus TCP, Modbus RTU), tham số đường truyền (FR-030, FR-033), bật/tắt; chứa các thiết bị trường; có trạng thái khi chạy.
- **Thiết bị trường**: thuộc một kênh. Gồm unit ID hoặc địa chỉ slave, gốc đánh số, giới hạn mỗi lần đọc, khoảng trống gộp, thứ tự byte/word mặc định, thời gian chờ, số lần thử, thời hạn ghi, cách ghi, bật/tắt; có trạng thái khi chạy.
- **Nhóm quét**: nhanh, thường, chậm; chu kỳ đặt theo project; chu kỳ thực đo theo từng thiết bị trường.
- **Tag v1**: các thuộc tính của FR-009. Khi chạy có giá trị, quality, lý do, thời điểm cập nhật.
- **Bảng giá trị**: tên; các mục (giá trị hoặc khoảng, chữ, màu); mục mặc định.
- **Biểu thức**: văn bản, các Tag đầu vào, kiểu kết quả; thuộc một Tag tính toán.
- **Cấu hình mô phỏng**: bộ sinh và tham số; thuộc một Tag.
- **Bảng theo dõi**: tên; các dòng (Tag, định dạng hiển thị, giá trị ghi).
- **Yêu cầu ghi**: mã yêu cầu, tài khoản, role, địa chỉ nguồn, Tag, giá trị mới, giá trị cũ, thời điểm nhận, trạng thái (`REJECTED`, hoặc `ACCEPTED` rồi `TIMEOUT` | `FAILED` | `CONFIRMED`), lý do, giá trị đọc lại.
- **Chẩn đoán**: số liệu theo kênh, thiết bị trường, nhóm quét, Tag (FR-029); đếm từ lúc runtime chạy.
- **Giá trị giữ qua mất điện**: tên Tag, kiểu, giá trị, thời điểm lưu.
- **Cổng serial**: tên, loại, đang được ai dùng, có chế độ RS485 hay không. Do BL335 báo.
- **Bản sao lưu nâng cấp**: thư mục, thời điểm, phiên bản định dạng gốc.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Thiết bị và driver**

- **SC-001**: Với ≥ 1 PLC thật qua Modbus TCP trên bàn thử, Tag của mọi kiểu dùng được (BOOL coil, bit trong thanh ghi, INT16, UINT16, INT32, UINT32, FLOAT32, FLOAT64, STRING) khớp 100 % với giá trị xem bằng phần mềm lập trình PLC. Ghi thử mỗi kiểu RW đều `CONFIRMED`, và PLC có đúng giá trị.
- **SC-002**: Với ≥ 1 thiết bị RS485 thật qua Modbus RTU trên BL335: giá trị đọc khớp màn hình của thiết bị; ghi một tham số RW `CONFIRMED`; chạy 30 phút có ≥ 99 % lượt quét thành công.
- **SC-003**: Trên BL335, chạy ≥ 30 phút với 500 Tag nhóm 1 s qua Modbus TCP (giả lập ở máy khác, mọi Tag đổi mỗi giây) và 10 client xem đủ 500 Tag: CPU trung bình ≤ 30 %, RSS ≤ 150 MB, chu kỳ thực trung bình trong 1 s ± 10 %, 0 lần mất sequence ở client.
- **SC-004**: Thêm 200 Tag tính toán (2–5 đầu vào mỗi Tag) và 100 Tag nội bộ vào tải của SC-003: vẫn trong ngân sách; ở 100 % lần đổi đầu vào, Tag tính toán tới client cùng lần gửi dữ liệu sống với đầu vào, hoặc lần gửi ngay sau.
- **SC-005**: Rút cáp PLC 10 lần và tắt PLC 10 lần, với cấu hình mặc định và nhóm quét thường:
  - 20/20 lần Tag BAD trong ≤ 2 chu kỳ quét;
  - cắm lại hoặc bật lại: 20/20 lần Tag GOOD trong ≤ 12 s, không khởi động lại runtime.
- **SC-006**: Quyền và audit:
  - 100 % lệnh ghi của viewer, của người chưa đăng nhập, gửi qua HTTP, gửi qua kênh dữ liệu sống bị từ chối; nhật ký của giả lập cho thấy 0 lệnh tới thiết bị trường;
  - 100 % lệnh ghi (nhận, từ chối, kết quả) có audit đủ trường của FR-039;
  - giết runtime 20 lần giữa lúc ghi: 0 lệnh tới thiết bị trường mà không có bản ghi audit lúc nhận; mọi lệnh dở được ghi "không rõ kết quả".
- **SC-007**: Bộ ca thử ghi có ít nhất một ca cho mỗi kết quả và mỗi lý do của FR-037, FR-038: 100 % ca cho đúng kết quả và lý do; 0 lệnh bị thực hiện hai lần. Trong LAN, ≥ 95 % lệnh ghi Tag ngoài hiện `CONFIRMED` trong Studio ≤ 2 s sau khi xác nhận.
- **SC-008**: Bộ vector biểu thức chung có ≥ 300 ca, gồm chia cho 0, `%`, làm tròn nửa, tràn, NaN, chuỗi, quality qua `? :`, sai kiểu, vòng tham chiếu. Studio và runtime cho cùng giá trị, kiểu, quality và mã lỗi ở 100 % ca. Các bộ vector đổi thô ↔ giá trị, bộ sinh mô phỏng và bảng giá trị cũng giống nhau 100 % ở hai bản.
- **SC-009**: Định dạng và tương thích:
  - 100 % vector kiểm tra 0.1 hiện có và vector 0.2 mới cho cùng kết luận và mã lỗi ở hai bản;
  - 100 % project 0.1 mẫu (gồm tank-demo) nâng cấp được; bản nâng cấp hợp lệ và trên runtime 0.5 cho cùng giá trị Tag như bản 0.1;
  - project 0.1 chạy trên runtime 0.5 qua toàn bộ kiểm tra tự động của Sprint 1 và 003.
- **SC-010**: Qua 20 lần giết tiến trình và ≥ 3 lần cắt điện thật (cần người ở cạnh thiết bị): 100 % lần, Tag giữ qua mất điện có giá trị đã đổi trước cửa sổ gom cuối; 0 lần bản lưu bị hỏng.
- **SC-011**: Đo trên BL335 khi ghi liên tục ở tần suất tối đa mặc định: lượng ghi eMMC do audit ghi Tag và Tag giữ qua mất điện, quy ra ngày, ≤ 1 GB/ngày (ngân sách tổng 2 GB/ngày, Constitution III).

**Studio**

- **SC-012**: Bảng Tag 2.000 dòng:
  - mở ≤ 1 s; di chuyển ô và cuộn ≤ 50 ms mỗi bước; gõ ≤ 100 ms mỗi phím;
  - lỗi do một lần sửa hiện tại ô ≤ 1 s;
  - dán 2.000 dòng × 10 cột từ Excel, kể cả kiểm tra, ≤ 5 s;
  - xuất rồi nhập lại CSV cho project không khác gì (So sánh cho kết quả "giống").
- **SC-013**: Với Telex có sẵn của Windows và với Unikey, ở mọi lưới mới: 20/20 lần chọn ô rồi gõ thẳng "Mức nước bồn 1" cho đúng chuỗi đó, không cần F2.
- **SC-014**: Thử kết nối cho đúng kết quả và lý do ở 100 % ca thử (kết nối được, bị từ chối, hết thời gian chờ, không tới mạng, exception), mỗi ca trong ≤ tổng thời gian chờ đã đặt + 2 s; kênh đang chạy không mất lượt quét nào.
- **SC-015**: Với 2.000 Tag, gợi ý tên Tag hiện ≤ 200 ms sau mỗi phím. 100 % ca trong bộ biểu thức lỗi được báo đúng vị trí và lý do ≤ 500 ms sau khi ngừng gõ.
- **SC-016**: Tiêm từng loại lỗi vào giả lập (hết thời gian chờ, exception từng mã, CRC, rớt kết nối, trả lời chậm): 100 % loại lỗi hiện đúng ở Chẩn đoán driver trong ≤ 5 s; số đếm khớp số lỗi đã tiêm.
- **SC-017**: Studio trên máy không có mạng chạy project mẫu có đủ bốn loại Tag ở chế độ Mô phỏng: giá trị bộ sinh và Tag tính toán khớp vector chung 100 %; theo dõi mạng thấy 0 gói tin gửi đi.
- **SC-018**: Các editor mới đạt 100 % quy tắc lưới và form của studio-ux.md §5 (bảng đối chiếu từng quy tắc). Kiểm trợ năng tự động: 0 lỗi critical hoặc serious ở theme sáng và tối. Tương phản chữ ≥ 4,5:1. 100 % lệnh mới dùng được chỉ bằng bàn phím.
- **SC-019**: Một kỹ sư chưa dùng các editor mới làm trọn trong ≤ 10 phút, không cần tài liệu: thêm kênh Modbus TCP, Thử kết nối, tạo 20 Tag bằng thêm hàng loạt hoặc dán, nạp xuống, xem giá trị trong Bảng theo dõi, ghi một setpoint có xác nhận.

**Chất lượng chung**

- **SC-020**: Modbus TCP, Modbus RTU và nguồn Tag mô phỏng đạt 100 % bộ test chuẩn cho driver. Test fuzz khung Modbus chạy ≥ 1 giờ không dừng, không treo, không đưa giá trị sai vào Tag. Các giả lập chạy trong CI.
- **SC-021**: Không hồi quy: mọi kiểm tra tự động của 004 và 005 vẫn đạt; với project 0.1, trang xem trên Chrome không đổi hành vi khi xem từ mạng riêng.
- **SC-022**: Với cấu hình mặc định:
  - từ một địa chỉ nguồn công cộng (thử trong mạng Docker dùng dải tài liệu, ví dụ 203.0.113.0/24): 100 % yêu cầu tới trang xem, API chỉ đọc và kênh dữ liệu sống không kèm phiên nhận 403;
  - kênh dữ liệu sống của Studio kèm phiên hợp lệ vẫn chạy từ cùng nguồn đó;
  - từ mạng riêng, mọi thứ chạy như trước;
  - đặt `any` thì nguồn công cộng xem lại được, và có cảnh báo ở `system/info`.

## Assumptions

### Quyết định đã chốt trước khi viết spec

Phiên làm việc chính chốt các điểm này ngày 2026-10-11, khi người dùng giao toàn quyền quyết định. Thứ tự và độ ưu tiên của các user story theo gợi ý của phiên chính.

- **D1. GĐ 2 là một feature** (`006-tags-modbus`), không chia hai như GĐ 1. Lý do: định dạng 0.2.0, Tag Engine v1 và driver SDK gắn chặt với nhau; tách ra thì feature nào cũng phải đổi định dạng project.
- **D2. Ghi Tag chỉ từ Bảng theo dõi online của Studio**, qua API HTTPS có đăng nhập của 005: token Bearer, cùng cổng kiểm `auth_gate` (HTTPS → phiên → role → audit), bảng quyền một chỗ, audit. Role tối thiểu operator; viewer bị từ chối và có audit.
  - Trang xem trên Chrome giữ chỉ đọc, HTTP 8080, không đăng nhập, như FR-033 của 005. Lý do: ở GĐ 2 trang này không ghi được gì.
  - Đăng nhập trên Chrome (cookie `HttpOnly; Secure; SameSite=Strict` + CSRF, quy trình nạp chứng chỉ CA của khách hàng) chuyển sang GĐ 3a, khi widget điều khiển trên web ghi được Tag.
  - Bước plan sửa lộ trình: §4.1 (ghi chú cookie "để GĐ 2"), §4.2 (ghi Tag chỉ từ Studio), §5 (trang runtime chạy HTTPS từ GĐ 3a). Không sửa spec 005 vì đang implement; FR-033 của 005 ghi "cho tới GĐ 2", spec này kéo dài tới GĐ 3a.
- **D3. Modbus TCP và RTU tự viết; không dùng libmodbus** (LGPL-2.1, phải link động). Lý do: giao thức đơn giản; tự kiểm soát việc gộp yêu cầu, thời gian, chẩn đoán (lộ trình §4.8 khuyến nghị tự viết).
- **D4. Không script tự do** (Constitution V). "Logic" của GĐ 2 chỉ gồm biểu thức của Tag tính toán và bảng giá trị. Biểu thức có hai bản: runtime (C++) và Studio (TS, để xem trước), chạy cùng bộ vector.
- **D5. Định dạng 0.2.0, nâng cấp từ 0.1 trong Studio.** Mở project 0.1 thì Studio đề nghị nâng cấp và giữ bản sao lưu. Runtime 0.5.x nhận cả 0.1.x và 0.2.x; project 0.1 được hiểu như Tag mô phỏng, như hiện nay. Bộ kiểm tra TS và C++ cho cùng kết luận.
- **D6. Tag nội bộ giữ qua mất điện được ghi eMMC có gom**, trong ngân sách ghi (Constitution III). Có thể mất thay đổi trong cửa sổ gom gần nhất (mặc định 5 s).
- **D7. Cổng RS485 trên BL335 chưa xác nhận**: chưa biết cổng nào nối RS485 và cách điều khiển chiều truyền. Plan kiểm chỉ đọc qua SSH. Spec yêu cầu chọn được cổng serial, tốc độ, khung, và chế độ RS485 khi kernel hỗ trợ. Thử RS485 thật cần bộ chuyển và người ở cạnh thiết bị (xem phụ thuộc).
  - Ngày 2026-10-11, lệnh SSH chỉ đọc tới BL335 bị công cụ của phiên làm việc chặn. Bước kiểm này chờ người dùng cho phép SSH, hoặc người dùng tự chạy các lệnh kiểm do plan đưa ra.
- **D8. Kết quả ghi:**
  - `ACCEPTED`: đã nhận vào hàng đợi;
  - `REJECTED`: sai quyền, Tag chỉ đọc, ngoài giới hạn, kết nối xấu…;
  - `TIMEOUT`;
  - `FAILED`: thiết bị trường báo lỗi;
  - `CONFIRMED`: đọc lại khớp.

  Audit ghi ai, lúc nào, IP, Tag, giá trị cũ và mới, kết quả. D15 và D16 làm rõ thêm.
- **D9. Mô phỏng trong Studio** dùng chung package bộ sinh mô phỏng và bộ tính biểu thức, chạy không cần thiết bị.

### Quyết định khi viết spec

Các điểm dưới đây chưa được chốt trước; spec chọn phương án hợp lý nhất. Mỗi điểm là **Quyết định (người dùng giao toàn quyền 2026-10-11)**.

- **D10. Thử kết nối chạy trên BL335**, chỉ đọc, cần role engineer, có audit. Studio không kết nối trực tiếp tới thiết bị trường. Lý do: mạng PLC thường chỉ tới được từ BL335 (BL335 có hai cổng Ethernet); Constitution II; chỉ có một đường truy cập thiết bị trường.
- **D11. Tên gọi** "BL335", "thiết bị trường", "Tag ngoài" (mục Bối cảnh). Lý do: spec 005 gọi BL335 là "thiết bị"; dùng cùng từ cho PLC sẽ gây nhầm.
- **D12. Giới hạn số lượng:**
  - ≤ 2.000 Tag mỗi project (như 0.1); ≤ 500 Tag tính toán; ≤ 500 Tag giữ qua mất điện, chuỗi giữ ≤ 256 byte;
  - ≤ 16 kênh; ≤ 64 thiết bị trường, ≤ 32 mỗi kênh;
  - ≤ 256 bảng giá trị, ≤ 256 mục mỗi bảng;
  - ≤ 32 bảng theo dõi, ≤ 200 dòng mỗi bảng.

  Lý do: vừa ngân sách BL335 và tải chuẩn 500 Tag; nâng khi có số đo.
- **D13. Mặc định thời gian:**
  - nhóm quét 250 ms, 1 s, 5 s;
  - Modbus TCP chờ 1 s, không thử lại; RTU chờ 1 s, thử lại 1 lần;
  - kết nối lại từ 1 s, tăng dần tới 10 s;
  - RTU tạm ngưng thiết bị trường sau 3 lần hỏng, hỏi thử mỗi 10 s;
  - thời hạn ghi 5 s; khoảng trống gộp 10 thanh ghi hoặc 64 bit.

  Lý do: đạt "BAD trong ≤ 2 chu kỳ" ở nhóm thường; gần mặc định của các SCADA phổ biến.
- **D14. Quyền mặc định là R**; Tag tính toán luôn R. Lý do: ghi xuống máy phải là quyết định có chủ ý.
- **D15. Đọc lại sau khi ghi mặc định bật.** Tag lệnh xung (PLC tự xóa bit sau khi nhận) tắt đọc lại; khi đó `CONFIRMED` nghĩa là thiết bị trường đã trả lời thành công, và Studio ghi rõ. Lý do: với bit lệnh tự xóa, đọc lại luôn khác; báo `FAILED` sẽ khiến người vận hành bấm lại và máy chạy hai lần.
- **D16. `TIMEOUT` nghĩa là không có trả lời trong thời gian chờ**: hoặc lệnh ghi không có trả lời (không chắc đã ghi), hoặc lệnh ghi đã được nhận nhưng lần đọc lại không có trả lời; lý do nói rõ trường hợp nào. Lệnh không gửi được là `FAILED`. BL335 không tự gửi lại lệnh đã gửi, và không giữ lệnh chờ kết nối có lại. Lý do: tránh tác động hai lần, hoặc tác động muộn khi tình trạng máy đã khác.
- **D17. Ghi bit trong thanh ghi mặc định không cho**; bật bằng ghi có mặt nạ (mã 22) hoặc đọc-sửa-ghi (có cảnh báo). Lý do: đọc-sửa-ghi không nguyên tử.
- **D18. Chuỗi trên Modbus mã hóa UTF-8, kết thúc bằng byte 0.** Lý do: tương thích ASCII; vẫn chứa được tiếng Việt nếu thiết bị trường lưu UTF-8.
- **D19. Ngữ nghĩa biểu thức** theo FR-019, FR-020: số thực 64 bit, BOOL là 1/0 trong phép số, phép logic cần BOOL, làm tròn nửa ra xa số 0, quality theo nhánh đã tính, lỗi khi tính cho BAD. Lý do:
  - hai bản phải ra cùng kết quả; hàm làm tròn có sẵn của TS và C++ khác nhau với số âm;
  - `? :` dùng được để chọn nguồn dự phòng khi một PLC mất kết nối.
- **D20. Bảng giá trị** dùng khoảng nửa mở, cấm chồng nhau, có mục mặc định, chỉ ánh xạ số và BOOL. Lý do: không mơ hồ ở biên.
- **D21. Cấu hình mô phỏng nằm trong định nghĩa Tag.** Tag loại mô phỏng chạy cả trên BL335; chế độ Mô phỏng của Studio dùng cấu hình này cho mọi Tag. Lý do: một chỗ khai báo; đi theo project, đọc lên và so sánh được; thử được màn hình trên BL335 khi chưa có PLC.
- **D22. Bảng theo dõi lưu trong project** và có trong gói; runtime chỉ kiểm. Lý do: đọc lên luôn đầy đủ (research R12 của 005).
- **D23. Project 0.1 không nâng cấp thì mở chỉ đọc**, vẫn nạp xuống nguyên trạng được. Lý do: chỉ một đường sửa project; vẫn bảo trì được trạm chạy runtime cũ.
- **D24. Nâng cấp chạy trong bộ nhớ; sao lưu ngay trước lần lưu đầu.** Lý do: đóng mà không lưu thì project gốc không đổi gì.
- **D25. Binding tham chiếu được bảng giá trị** (viết trong JSON ở GĐ 2). Biểu thức trong binding vẫn chưa hỗ trợ (GĐ 3b). Lý do: lộ trình §4.2 nêu binding SVG là một nơi dùng bảng giá trị; trang xem có lợi ngay.
- **D26. Dấu thập phân khi gõ là dấu chấm**; dán và nhập CSV theo lựa chọn dấu thập phân. Lý do: "1,000" mơ hồ, nguy hiểm khi ghi setpoint.
- **D27. Một Bảng Tag**, không có thư mục hay nhiều bảng Tag; dùng lọc và sắp xếp. Lý do: YAGNI.
- **D28. Số đếm chẩn đoán tính từ lúc runtime chạy**, không có lệnh đặt lại; Studio hiện thêm phần tăng từ lúc mở trang. Lý do: không cần API thay đổi trạng thái; vẫn đủ để điều tra.
- **D29. Giới hạn tần suất ghi** (FR-041). Lý do: mỗi lệnh ghi cần ít nhất một lần ghi bền vào audit (`synchronous=FULL`, Constitution 2.0.1); không giới hạn thì một phiên có thể làm mòn eMMC. Ở GĐ 2, Tag nội bộ chỉ đổi khi có lệnh ghi, nên giới hạn này cũng chặn lượng ghi của Tag giữ qua mất điện.
- **D30. Online và Mô phỏng loại trừ nhau.** Lý do: không để nhầm giá trị mô phỏng với giá trị thật.
- **D31. Unit ID 0–255 cho Modbus TCP, slave 1–247 cho RTU; không ghi broadcast.** Lý do: lệnh broadcast không có trả lời nên không xác nhận được.
- **D32. Đổi tên Tag cập nhật mọi tham chiếu** (004 chưa làm). Lý do: biểu thức và bảng theo dõi làm số tham chiếu tăng nhiều; TIA Portal cũng làm vậy.
- **D33. Phần không cần đăng nhập mặc định chỉ phục vụ mạng riêng** (FR-055a; phiên chính chốt khi duyệt spec).
  - Lý do: từ GĐ 2, trang xem hiện dữ liệu PLC thật mà chưa có đăng nhập (đăng nhập trên Chrome ở GĐ 3a). Port-forward cổng HTTP sẽ đưa dữ liệu sản xuất ra Internet.
  - Lọc theo nguồn chặn được trường hợp này mà không đổi gì với người dùng trong LAN hay qua VPN.
  - Kênh dữ liệu sống của Studio gửi kèm phiên đăng nhập. Đây là thay đổi so với 005: Rust trước đây không gửi token cho kênh này. Nhờ vậy Online từ xa vẫn chạy.
  - Đặt `any` để mở lại cho mọi nguồn, dùng khi demo; có cảnh báo.

### Giả định và phụ thuộc

- **Phụ thuộc:**
  - feature 005 xong: HTTPS, đăng nhập, role, audit, nạp xuống, đọc lên, so sánh, Online;
  - feature 004 (khung Studio); feature 003 (lưu trữ, không đổi);
  - runtime 0.4.0; giao thức live 1.1.0.
- Tài khoản vẫn quản lý bằng lệnh trên BL335 như 005.
- **Bàn thử:**
  - giả lập Modbus TCP chạy trong container trên máy dev và CI; cặp cổng serial ảo cho RTU;
  - ≥ 1 PLC có Modbus TCP và ≥ 1 thiết bị RS485 kèm bộ chuyển: người dùng cung cấp; cần danh sách phần cứng có sẵn (lộ trình §6);
  - thử RS485 thật và cắt điện thật cần người ở cạnh BL335.
- **Thao tác trên BL335** (kiểm cổng serial, quyền dùng cổng, deploy) theo Constitution, quy trình bước 3:
  - chỉ đọc khi kiểm; mọi thay đổi ghi vào `device-changes.md`; không đụng các dịch vụ khác đang chạy trên BL335;
  - một dịch vụ khác có thể đang giữ cổng serial: plan kiểm trước;
  - SSH tới BL335 hiện cần người dùng cho phép (D7). Các bước trên BL335 của feature này (kiểm cổng, đo SC-003/SC-004/SC-011, SC-002, SC-010) chờ quyền đó.
- **ADR:** driver SDK (lộ trình §8 dự kiến số 014); ngôn ngữ biểu thức; mở lại [ADR-009](../../docs/adr/009-studio-ui-stack.md) để chọn lưới ảo hóa (tự viết hay dùng thư viện) và cách nhận chữ từ bộ gõ.
- **Mockup:** plan cập nhật mockup cho các editor mới (Kết nối, Bảng Tag, Bảng giá trị, Tag tính toán, Bảng theo dõi, Chẩn đoán driver) trước khi code; phiên làm việc tự duyệt (người dùng giao toàn quyền).
- **Đo SC-019:** cần một người chưa dùng các editor mới; không có thì ghi là tự đo, như 004.
- **Rủi ro lộ dữ liệu:** trang xem không đăng nhập nay hiện dữ liệu PLC thật. Spec giảm rủi ro bằng FR-055a (D33): mặc định chỉ phục vụ mạng riêng. Tài liệu triển khai giữ khuyến nghị của 005: dùng VPN, đóng port-forward 9080 khi không cần xem từ xa. Hiện người dùng xem bản demo qua port-forward 9080. Sau khi cập nhật runtime 0.5, muốn giữ cách xem này thì phải đặt `any`; script triển khai in lời nhắc.
- **Phiên bản:** runtime 0.5.0; phiên bản Studio, API thiết bị và giao thức live chốt ở plan.
- Studio chạy trên Windows 10/11; thử bộ gõ trên Windows 11 với Telex có sẵn và Unikey.

## Ngoài phạm vi

- Widget, màn hình v1, nhiều màn hình, điều khiển từ trang web (GĐ 3a).
- Đăng nhập trên Chrome; HTTPS bắt buộc cho trang xem; cookie + CSRF; quy trình chứng chỉ CA của khách hàng (GĐ 3a).
- SVG import; gắn Tag và sự kiện bằng inspector; biểu thức trong binding (GĐ 3b).
- Alarm (GĐ 4). Biểu đồ lịch sử, báo cáo, editor lưu trữ (GĐ 5).
- Driver S7, MC/SLMP, FINS, MQTT, OPC UA và các đợt driver sau (lộ trình §4.8). Modbus ASCII, Modbus RTU qua TCP, Modbus UDP. BL335 làm Modbus slave.
- Logic v2: timer, counter, luật sự kiện, cộng dồn, lịch (GĐ 6); lệnh ghi từ logic xuống PLC.
- Ghi từ Bảng Tag, từ trang xem, hay từ công cụ nào khác ngoài Studio.
- Bắt khung truyền (frame trace); đặt lại bộ đếm chẩn đoán.
- Nhiều bảng Tag hay thư mục Tag; Tag mảng hay cấu trúc; nhập Tag từ file của phần mềm PLC.
- Bảng giá trị đa ngôn ngữ, theo bit, hay ánh xạ từ chuỗi.
- Quản lý tài khoản trong Studio.
- Nâng giới hạn 2.000 Tag.
