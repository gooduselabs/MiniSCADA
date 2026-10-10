# Feature Specification: Vertical slice trên thiết bị (Sprint 1)

**Feature Branch**: `002-vertical-slice`

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "Sprint 1 — Vertical slice trên thiết bị (Master Plan §13): schema v0 (project, screen, binding, tag; schemaVersion SemVer; elementUid), package dùng chung (svg-renderer, binding-engine direct/discreteMap/linearScale, live-client), runtime web hiển thị 1 màn hình bồn nước + motor theo Mock Tag trong Shadow DOM, runtime C++ thay PoC (Mock Tag, WebSocket snapshot/delta/heartbeat, giới hạn 10 phiên, hàng đợi gửi 256 KB/client + resync_required, kiểm Origin, CSP cho SVG), deploy thủ công lên BL335 bằng systemd. Nghiệm thu: 10 tab Chrome trên các máy khác nhau, tab 11 nhận thông báo đầy, rút/cắm mạng tự reconnect và resync; RSS ≤ 150 MB, CPU TB ≤ 30% (500 Tag/1 s/10 client)."

## Bối cảnh

Sprint 0 đã chứng minh BL335 đủ sức (7/7 tiêu chí Go/No-Go đạt, chờ Tech Lead duyệt T034) bằng một **PoC**. Sprint 1 thay PoC bằng runtime thật đầu tiên, chạy end-to-end trên thiết bị (Constitution I): dữ liệu Tag giả lập → máy chủ trên BL335 → Chrome hiển thị màn hình SVG có animation. Định dạng project/screen/binding được viết tay theo schema v0; Studio sinh định dạng này ở các Sprint sau.

Việc mang sang từ Sprint 0 bắt buộc làm trong Sprint này: hàng đợi gửi giới hạn theo client + `resync_required` + test client chậm (ADR-001); giữ cách tuần tự hóa "snapshot + đăng ký" với bộ phát delta (đã sửa race ở Sprint 0); T058 (kiểm Origin cho kết nối dữ liệu sống, chính sách bảo mật nội dung cho file màn hình, không triển khai fixture độc hại).

## Clarifications

### Session 2026-10-10

- Q: Tab nhận 4429 (đầy) có tự thử lại không? → A: Có. Tự thử lại sau 30 s, hiện đếm ngược và nút "Thử lại ngay" (theo Master Plan §10.2; contract Sprint 0 và `live.ts` phải sửa theo).
- Người dùng ủy quyền cho Claude tự chốt các câu hỏi còn lại theo hướng "hoàn thiện", và yêu cầu thêm: **có Studio để cấu hình** và **truy cập được thiết bị qua web**. Các quyết định:
- Q: Máy chủ C++ có kiểm đầy đủ JSON Schema không? → A: Có. Kiểm đầy đủ schema + tham chiếu + phiên bản bằng thư viện C++ có license phù hợp (rà license theo Constitution); chạy chung bộ test vector với phía TypeScript.
- Q: Kịch bản đo ngân sách "500 Tag/1 s/10 client" là gì? → A: Trường hợp xấu nhất: 10 client mỗi client đăng ký **đủ 500 Tag** (công cụ tải), Mock đổi toàn bộ 500 Tag mỗi 1 s. Nghiệm thu chức năng bằng 10 tab Chrome (chỉ đăng ký Tag của màn hình) làm riêng.
- Q: Mock Tag của bồn + motor diễn biến thế nào? → A: Mô phỏng tất định có quan hệ nhân quả: motor chạy thì mức bồn tăng, mức ≥ 90 % thì motor dừng và bồn xả dần, mức ≤ 10 % thì motor chạy lại (chu kỳ khoảng 60 s); có một Tag định kỳ chuyển chất lượng BAD để minh họa quy tắc chất lượng xấu. Thêm 500 Tag `SIM.*` cho đo tải.
- Q: "Studio config" gồm những gì trong Sprint 1? → A: Studio tối thiểu (không có trình vẽ — canvas là Sprint 3): mở thư mục project viết tay, kiểm tra bằng **cùng** bộ kiểm tra dùng chung, sửa cấu hình project qua form (tên, phiên bản, màn hình đầu vào, `maxClients`, danh sách Tag), lưu lại file hợp lệ, cấu hình địa chỉ thiết bị, xem trước màn hình với dữ liệu sống từ thiết bị bằng **cùng** package của runtime, và nút "Mở web thiết bị" mở trình duyệt mặc định. Đẩy project lên thiết bị từ Studio: ngoài phạm vi (Sprint 6); Sprint 1 copy thủ công.
- Q: Truy cập web thiết bị ở đâu? → A: `http://<IP-BL335>:8080/` (mặc định 8080, cấu hình được; không chạy root nên không dùng cổng 80). Kiểm Origin: chấp nhận cùng origin + danh sách cấu hình được, mặc định gồm origin của Studio để Studio xem trước được. Phiên xem trước của Studio tính là 1 trong 10 phiên.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Người vận hành xem màn hình bồn nước + motor sống từ BL335 (Priority: P1)

Người vận hành mở Chrome trên một máy trong LAN, nhập địa chỉ BL335 và thấy màn hình "bồn nước + motor": mức nước trong bồn lên xuống theo Tag mức, motor đổi màu chạy/dừng và quay khi chạy, các giá trị số hiển thị cập nhật. Không cần cài gì trên máy client.

**Why this priority**: Đây là lát cắt dọc cốt lõi chứng minh kiến trúc (Tag → máy chủ → trình duyệt → SVG động) chạy được trên thiết bị thật. Mọi Sprint sau xây trên nó.

**Independent Test**: Triển khai runtime lên BL335, mở 1 tab Chrome, quan sát màn hình thay đổi theo Mock Tag trong ít nhất 1 phút; đối chiếu giá trị hiển thị với giá trị Tag máy chủ báo.

**Acceptance Scenarios**:

1. **Given** runtime đang chạy trên BL335 với project mẫu "bồn nước + motor", **When** người vận hành mở trang runtime trên Chrome trong LAN, **Then** màn hình hiển thị đầy đủ và bắt đầu cập nhật theo Tag trong ≤ 2 s.
2. **Given** màn hình đang mở, **When** Tag mức bồn đổi giá trị, **Then** mức nước hiển thị đổi theo tỉ lệ (0 % → bồn rỗng, 100 % → đầy, giá trị ngoài khoảng bị kẹp về biên) trong ≤ chu kỳ cập nhật + 500 ms.
3. **Given** màn hình đang mở, **When** Tag trạng thái motor chuyển chạy ↔ dừng, **Then** màu motor đổi theo bảng ánh xạ và cánh quạt quay khi chạy, đứng yên khi dừng.
4. **Given** một Tag có chất lượng không tốt (BAD/UNCERTAIN/STALE), **When** màn hình hiển thị Tag đó, **Then** phần tử liên quan hiển thị theo quy tắc chất lượng xấu đã khai báo trong binding (hoặc mặc định trung tính) để người vận hành không nhầm với dữ liệu sống.

---

### User Story 2 - Giới hạn 10 phiên và thông báo khi đầy (Priority: P1)

Mười người ở mười máy (hoặc tab) khác nhau cùng xem màn hình. Người thứ 11 mở trang và thấy thông báo rõ ràng "Hệ thống đã đạt tối đa 10 kết nối", trong khi 10 người kia không bị gián đoạn. Khi một người đóng tab hoặc mất mạng, chỗ được giải phóng cho người khác.

**Why this priority**: Giới hạn 10 client là ràng buộc cứng của sản phẩm (Constitution IV) và là tiêu chí nghiệm thu Sprint.

**Independent Test**: Mở 10 tab Chrome trên các máy khác nhau tới BL335, mở tab thứ 11; kiểm bằng công cụ tải (10 + 1 client, kiểm giải phóng slot).

**Acceptance Scenarios**:

1. **Given** đang có 10 phiên dữ liệu sống, **When** tab thứ 11 mở trang, **Then** tab đó hiển thị thông báo đầy (mã MAX_CLIENTS_REACHED, mã đóng 4429) và 10 phiên còn lại không mất cập nhật nào (không mất sequence).
2. **Given** 10 phiên đang mở, **When** một tab đóng bình thường, **Then** slot được giải phóng ngay và một tab mới kết nối được.
3. **Given** 10 phiên đang mở, **When** một client im lặng (mất mạng, treo) quá 15 s, **Then** máy chủ đóng phiên đó (mã 4408) và giải phóng slot.
4. **Given** tab đang hiển thị thông báo đầy, **When** 30 s trôi qua (trang hiển thị đếm ngược) hoặc người dùng bấm "Thử lại ngay", **Then** tab kết nối lại; nếu đã có slot trống thì vào được và hiển thị dữ liệu sống, nếu vẫn đầy thì hiện lại thông báo và bắt đầu đếm ngược 30 s mới (Master Plan §10.2; thay quy tắc "không thử lại khi 4429" của contract Sprint 0).

---

### User Story 3 - Tự kết nối lại và đồng bộ lại sau sự cố mạng (Priority: P1)

Người vận hành rút cáp mạng máy client (hoặc mạng chập chờn) rồi cắm lại. Trong lúc mất kết nối, màn hình cho thấy dữ liệu đã cũ (STALE, giữ giá trị cuối). Khi mạng trở lại, trang tự kết nối lại, nhận ảnh chụp đầy đủ mới và tiếp tục cập nhật — không cần tải lại trang.

**Why this priority**: Là tiêu chí nghiệm thu của Sprint; trong nhà máy mạng chập chờn là bình thường, dữ liệu cũ hiển thị như dữ liệu sống là rủi ro vận hành.

**Independent Test**: Trên 1 máy client, rút cáp ≥ 30 s rồi cắm lại; quan sát trạng thái STALE, thời gian khôi phục và giá trị sau khôi phục so với máy chủ.

**Acceptance Scenarios**:

1. **Given** màn hình đang cập nhật, **When** client mất kết nối với máy chủ, **Then** trong ≤ 15 s mọi giá trị hiển thị chuyển sang trạng thái STALE (giữ giá trị cuối, có dấu hiệu nhìn thấy được) và trang hiển thị trạng thái "mất kết nối".
2. **Given** client đang mất kết nối, **When** mạng trở lại, **Then** trang tự kết nối lại (thời gian chờ tăng dần 1 s → 30 s có ngẫu nhiên hóa), nhận ảnh chụp mới và hiển thị giá trị hiện hành; trạng thái STALE biến mất.
3. **Given** client phát hiện mất một bản tin cập nhật (sequence nhảy), **When** điều đó xảy ra, **Then** client tự lấy ảnh chụp mới; không bao giờ hiển thị trạng thái ghép từ cập nhật thiếu.

---

### User Story 4 - Client chậm không làm hại client khác và thiết bị (Priority: P2)

Một máy client yếu hoặc mạng chậm không đọc kịp dữ liệu. Máy chủ không để dữ liệu chờ gửi cho client đó phình vô hạn: khi vượt 256 KB, máy chủ báo `resync_required` rồi đóng phiên; client đó tự kết nối lại và đồng bộ lại. Chín client còn lại vẫn nhận đúng nhịp.

**Why this priority**: Rủi ro đã biết từ Sprint 0 (ADR-001: PoC ghi đồng bộ, một client nghẽn có thể chặn cả bộ phát). Bắt buộc Sprint 1 nhưng người vận hành ít thấy trực tiếp.

**Independent Test**: Công cụ tải mở 9 client bình thường + 1 client ngừng đọc; đo nhịp delta của 9 client và RSS máy chủ; xác nhận client chậm nhận `resync_required` và bị đóng.

**Acceptance Scenarios**:

1. **Given** 9 client bình thường và 1 client ngừng đọc, **When** dữ liệu chờ gửi cho client chậm vượt 256 KB, **Then** máy chủ gửi `resync_required` (nếu gửi được) và đóng phiên đó, giải phóng slot.
2. **Given** tình huống trên, **When** đo nhịp cập nhật của 9 client còn lại, **Then** không client nào mất sequence và khoảng cách giữa hai cập nhật không tăng quá 1 chu kỳ gom so với khi không có client chậm.
3. **Given** tình huống trên kéo dài 10 phút, **When** đo bộ nhớ máy chủ, **Then** bộ nhớ không tăng theo thời gian (bị chặn bởi giới hạn hàng đợi).

---

### User Story 5 - Kỹ sư viết tay project theo schema v0 và runtime kiểm tra trước khi chạy (Priority: P2)

Kỹ sư dự án viết tay các file mô tả project, Tag, màn hình và binding theo schema v0 (có phiên bản). Runtime kiểm tra các file này trước khi phục vụ; file sai schema, sai phiên bản hoặc tham chiếu không tồn tại thì runtime từ chối và báo lỗi rõ ràng, không chạy nửa vời.

**Why this priority**: Schema v0 là hợp đồng giữa Runtime và Studio sau này (Constitution II, ADR-004); kiểm tra ở runtime là yêu cầu an toàn (Constitution V). Không cần cho người vận hành thấy trực tiếp nên P2.

**Independent Test**: Chạy bộ test schema với tập file mẫu hợp lệ và không hợp lệ; khởi động runtime với project sai và xem nó từ chối.

**Acceptance Scenarios**:

1. **Given** project mẫu viết tay hợp lệ, **When** chạy bộ kiểm tra, **Then** mọi file qua kiểm tra.
2. **Given** binding tham chiếu `elementUid` không có trong màn hình, Tag không có trong danh sách Tag, đích binding ngoài allowlist, hoặc kiểu transform không hỗ trợ, **When** kiểm tra, **Then** báo lỗi chỉ rõ file, vị trí và lý do.
3. **Given** project có `schemaVersion` không tương thích với runtime (v0: khác `0.1.x`, theo ADR-004), **When** runtime khởi động, **Then** runtime từ chối kích hoạt project và ghi lỗi rõ ràng; trang hiển thị "không có project hợp lệ" thay vì màn hình hỏng.
4. **Given** bộ kiểm tra dùng chung giữa phía trình duyệt/công cụ và phía máy chủ, **When** cùng một file được kiểm ở hai nơi, **Then** kết luận hợp lệ/không hợp lệ giống nhau.

---

### User Story 6 - Triển khai và vận hành runtime trên BL335 như một dịch vụ (Priority: P2)

Kỹ sư triển khai copy thư mục runtime lên BL335, cài thành dịch vụ hệ thống chạy bằng user không đặc quyền, giới hạn bộ nhớ; dịch vụ tự khởi động lại khi lỗi và khi thiết bị khởi động lại. Mọi thay đổi trên thiết bị được ghi vào nhật ký thay đổi thiết bị.

**Why this priority**: Cần để nghiệm thu trên thiết bị thật; deploy atomic/OTA là Sprint 6, ở đây chỉ thủ công.

**Independent Test**: Làm theo hướng dẫn deploy trên BL335; khởi động lại thiết bị; kill tiến trình; kiểm dịch vụ tự lên lại và trang hoạt động.

**Acceptance Scenarios**:

1. **Given** gói runtime đã build cho armhf, **When** kỹ sư làm theo hướng dẫn deploy, **Then** dịch vụ chạy dưới user không đặc quyền với giới hạn bộ nhớ 300 MB, và trang runtime truy cập được từ LAN.
2. **Given** dịch vụ đang chạy, **When** tiến trình bị kết thúc bất thường hoặc thiết bị khởi động lại, **Then** dịch vụ tự chạy lại và client tự kết nối lại.
3. **Given** bất kỳ thay đổi nào trên thiết bị (file, user, service), **When** thực hiện, **Then** có một mục tương ứng trong `docs/reports/device-changes.md` (kèm cách hoàn tác).
4. **Given** gói triển khai, **When** kiểm tra nội dung, **Then** không chứa fixture SVG độc hại (`unsafe-elements.svg`) hay file thử nghiệm không cần thiết.
5. **Given** dịch vụ đang chạy, **When** người dùng gõ `http://<IP-BL335>:8080/` trên Chrome bất kỳ máy nào trong LAN, **Then** trang runtime mở được; `http://<IP-BL335>:8080/api/v1/system/info` cho biết phiên bản, số phiên, trạng thái project.

---

### User Story 7 - Kỹ sư cấu hình project và xem trước bằng Studio (Priority: P3)

Kỹ sư dự án mở Studio trên Windows, chọn thư mục project viết tay. Studio kiểm tra project bằng đúng bộ kiểm tra mà runtime dùng và liệt kê lỗi nếu có. Kỹ sư sửa cấu hình project qua form (tên, phiên bản, màn hình đầu vào, số client tối đa, danh sách Tag), lưu lại; nhập địa chỉ thiết bị, xem trước màn hình với dữ liệu sống từ BL335, và bấm "Mở web thiết bị" để mở trang runtime trong trình duyệt.

**Why this priority**: Người dùng yêu cầu có Studio để cấu hình ngay từ Sprint 1. Studio dùng lại package chung, nên đây cũng là bằng chứng cho Constitution II (Studio và Runtime dùng chung schema và hiển thị). Trình vẽ là Sprint 3, nên story này chỉ gồm cấu hình và xem trước, xếp sau các story trên thiết bị.

**Independent Test**: Cài Studio trên Windows, mở project mẫu, sửa một trường, lưu, kiểm lại bằng công cụ dòng lệnh; nhập IP BL335, xem trước màn hình động; bấm mở web.

**Acceptance Scenarios**:

1. **Given** project mẫu hợp lệ, **When** mở trong Studio, **Then** Studio hiển thị thông tin project, danh sách màn hình/Tag và trạng thái "hợp lệ".
2. **Given** project có lỗi (ví dụ binding trỏ tới Tag không tồn tại), **When** mở trong Studio, **Then** Studio liệt kê lỗi với file, vị trí, lý do — giống hệt kết luận của runtime.
3. **Given** kỹ sư sửa cấu hình qua form, **When** nhập giá trị không hợp lệ (ví dụ `maxClients` = 11, phiên bản không theo SemVer), **Then** Studio báo lỗi ngay và không cho lưu; khi hợp lệ thì lưu ra file vẫn qua bộ kiểm tra và giữ nguyên các trường không sửa.
4. **Given** địa chỉ thiết bị đã nhập và runtime đang chạy, **When** mở xem trước, **Then** màn hình hiển thị và chạy theo Mock Tag giống trang runtime trên Chrome; khi thiết bị đầy 10 phiên thì xem trước hiển thị thông báo đầy.
5. **Given** địa chỉ thiết bị đã nhập, **When** bấm "Mở web thiết bị", **Then** trình duyệt mặc định mở trang runtime của thiết bị.
6. **Given** địa chỉ thiết bị sai hoặc thiết bị tắt, **When** xem trước hoặc kiểm kết nối, **Then** Studio báo "không kết nối được" rõ ràng, không treo.

### Edge Cases

- Client gửi bản tin không hợp lệ (JSON hỏng, `type` lạ, đăng ký Tag không tồn tại, bản tin quá lớn): máy chủ trả `error` có mã, không crash, không ảnh hưởng phiên khác; bản tin vượt giới hạn kích thước thì đóng phiên đó.
- Kết nối dữ liệu sống từ Origin không được phép (trang web khác trong trình duyệt người dùng): máy chủ từ chối trước khi chiếm slot.
- Đăng ký lại (subscribe lần 2) trên cùng phiên: hành vi phải xác định (thay thế đăng ký cũ và gửi ảnh chụp mới, hoặc báo lỗi) — không để client chờ vô hạn.
- Delta đến trước snapshot, hoặc delta tham chiếu Tag không có trong ảnh chụp: client bỏ qua và không hiển thị trạng thái ghép.
- 10 client cùng tải lại trang một lúc (cold load): hoàn tất ≤ 5 s, không client nào bị timeout.
- Một slot đang "treo" (TCP nửa mở) khi client 11 đến: client 11 vẫn bị từ chối cho tới khi slot hết hạn 15 s; sau đó kết nối được.
- File SVG màn hình chứa script/handler sự kiện/tham chiếu ngoài: bị loại bỏ trước khi hiển thị; nếu lọt, chính sách bảo mật nội dung của trình duyệt vẫn chặn thực thi khi file được mở trực tiếp.
- Binding trỏ tới phần tử không còn trong SVG (SVG bị vẽ lại): bộ kiểm tra báo lỗi; runtime không hiển thị binding đó và ghi cảnh báo.
- Hai màn hình/symbol có class hoặc id trùng nhau: không ảnh hưởng lẫn nhau (mỗi màn hình cách ly).
- Giá trị Tag ngoài khoảng của `linearScale`, NaN, null, sai kiểu (chuỗi cho Tag số): kẹp về biên hoặc áp quy tắc chất lượng xấu; không ném lỗi làm dừng cập nhật các binding khác.
- Tab ẩn (người dùng chuyển tab): animation lặp tạm dừng để tiết kiệm CPU client; khi hiện lại, trạng thái đúng với giá trị mới nhất.
- Đồng hồ máy chủ/client lệch nhau: phát hiện STALE dựa trên thời gian nhận ở client, không dựa vào timestamp máy chủ.

## Requirements *(mandatory)*

### Functional Requirements

**Schema v0 (định dạng project viết tay)**

- **FR-001**: Hệ thống MUST định nghĩa schema v0 có kiểm tra máy được cho bốn loại tài liệu: project (manifest), screen, binding, tag (danh sách định nghĩa Tag). Mỗi tài liệu MUST có trường `schemaVersion` theo SemVer (ADR-004).
- **FR-002**: Screen MUST tham chiếu tới file SVG và khai báo các phần tử có thể bind bằng `elementUid` (định dạng theo ADR-003, ví dụ `el_pump_01`); binding MUST neo vào `elementUid`, không neo vào `id` SVG.
- **FR-003**: Binding MUST giới hạn đích trong allowlist của Master Plan §8.2; Sprint 1 MUST hỗ trợ ít nhất: `style.fill`, `style.stroke`, `style.opacity`, `style.visibility`, `text.content`, `transform.rotate`, `geometry.levelPercent`. Đích khác bị bộ kiểm tra từ chối.
- **FR-004**: Binding MUST hỗ trợ ba kiểu transform: `direct`, `discreteMap` (bảng ánh xạ giá trị → kết quả, có giá trị mặc định), `linearScale` (khoảng vào → khoảng ra, có kẹp). Các kiểu khác (`rangeMap`, `format`, `expression`) bị từ chối ở v0 với thông báo "chưa hỗ trợ".
- **FR-005**: Binding MUST hỗ trợ khai báo hành vi khi chất lượng Tag không phải GOOD (`onBadQuality`), với mặc định an toàn khi không khai báo.
- **FR-006**: Tag MUST có id, kiểu dữ liệu (theo §8.1) và metadata hiển thị tối thiểu (đơn vị, khoảng giá trị nếu là số).
- **FR-007**: Bộ kiểm tra project MUST kiểm: đúng schema, phiên bản tương thích (theo ADR-004; v0 chấp nhận đúng `0.1.x`, xem contracts/project-format.md), ID duy nhất, mọi tham chiếu (screen → SVG, binding → `elementUid`, binding → Tag) tồn tại, kiểu Tag phù hợp với transform, `maxClients ≤ 10`, không có path traversal trong đường dẫn file. Lỗi MUST chỉ rõ file, vị trí, lý do.
- **FR-008**: Bộ kiểm tra MUST có hai bản cài đặt: TypeScript (dùng chung cho Studio, runtime web và công cụ dòng lệnh) và C++ (trong máy chủ), cả hai kiểm **đầy đủ** JSON Schema cùng các luật của FR-007. Cùng một bộ test vector (file hợp lệ/không hợp lệ) MUST chạy với cả hai bản và cho cùng kết luận. Thư viện bên thứ ba MUST được rà license.

**Package dùng chung (Constitution II)**

- **FR-009**: Logic hiển thị SVG, áp binding và client dữ liệu sống MUST nằm trong các package dùng chung, độc lập với ứng dụng runtime web; Studio dùng lại ngay trong Sprint này (FR-035). Ứng dụng runtime web chỉ ghép các package, hiển thị và giao tiếp máy chủ.
- **FR-010**: Package hiển thị SVG MUST lọc SVG bằng allowlist trên DOM đã parse (không regex), loại script, handler sự kiện, tham chiếu ngoài, `foreignObject`, ảnh liên kết; và MUST đặt mỗi màn hình trong vùng cách ly riêng (Shadow DOM) để class/id không đụng nhau. Bộ lọc là bản tối thiểu mang từ Sprint 0; importer đầy đủ là Sprint 2.
- **FR-011**: Package binding MUST chỉ cập nhật phần tử khi giá trị hiển thị thực sự đổi, gom cập nhật trong một khung hình, và tạm dừng animation lặp khi tab ẩn. Quay motor MUST quay quanh tâm hình của phần tử.
- **FR-012**: Package client dữ liệu sống MUST: bỏ delta trước snapshot; phát hiện mất sequence và lấy snapshot mới; coi máy chủ mất khi im lặng > 15 s; đánh dấu mọi Tag STALE (giữ giá trị cuối) khi mất kết nối; kết nối lại với backoff 1 s → 30 s có jitter; xử lý `resync_required`; khi nhận 4429 thì không dùng backoff thường mà chờ cố định 30 s (có đếm ngược, cho phép thử lại ngay theo yêu cầu người dùng) rồi thử lại (US2 kịch bản 4); gửi phản hồi heartbeat để giữ phiên.
- **FR-013**: Mã hiện có ở `apps/runtime-web/src` (client dữ liệu sống, binding thử, bộ lọc, nhận diện nguồn SVG) MUST được chuyển vào package tương ứng cùng với test của nó; test cũ MUST tiếp tục chạy xanh.

**Runtime web**

- **FR-014**: Runtime web MUST tải project đang hoạt động từ máy chủ, hiển thị màn hình đầu vào (entry screen), đăng ký đúng tập Tag mà binding của màn hình cần (không đăng ký "tất cả"), và áp binding theo cập nhật.
- **FR-015**: Runtime web MUST hiển thị trạng thái kết nối (đang kết nối / trực tuyến / mất kết nối / đầy) và thông báo đầy bằng tiếng Việt như Master Plan §10.2.
- **FR-016**: Project mẫu MUST gồm một màn hình "bồn nước + motor" viết tay thể hiện ít nhất: mức bồn (level), màu motor theo trạng thái (đổi màu), motor quay khi chạy (quay), một giá trị số dạng chữ.

**Runtime máy chủ (`mat-runtime`, thay PoC)**

- **FR-017**: Máy chủ MUST phục vụ runtime web và file project đã kiểm tra; file tĩnh nén sẵn, có kiểm tra cache (ETag/Cache-Control) như PoC.
- **FR-018**: Máy chủ MUST có nguồn Tag giả lập (Mock Tag provider) sinh: (a) các Tag của project mẫu theo mô phỏng tất định — motor chạy thì mức bồn tăng, mức ≥ 90 % thì motor dừng và bồn xả, mức ≤ 10 % thì motor chạy lại (chu kỳ khoảng 60 s); một Tag định kỳ chuyển chất lượng BAD rồi trở lại GOOD; (b) 500 Tag `SIM.T0001…SIM.T0500` đổi giá trị mỗi 1 s để đo ngân sách. Nguồn Tag MUST đi qua một ranh giới tương đương Tag Engine để driver thật thay thế được ở Sprint sau.
- **FR-019**: Máy chủ MUST cài giao thức dữ liệu sống `hello`/`subscribe`/`unsubscribe`/`snapshot`/`delta`/`heartbeat`/`error`/`resync_required` theo protocol 1.0.0 (`specs/002-vertical-slice/contracts/live-ws.md`, mở rộng từ contract Sprint 0 cho subscribe theo danh sách Tag), delta gom mỗi 100–250 ms, chỉ chứa Tag client đã đăng ký và đã đổi; `hello` MUST chứa phiên bản giao thức (quyết định mở từ ADR-004 điểm 7).
- **FR-020**: Việc gửi snapshot và đăng ký vào bộ phát delta MUST được tuần tự hóa sao cho client không bao giờ thấy khoảng trống sequence ngay sau snapshot (giữ bản sửa race Sprint 0); kiểm bằng ≥ 100 lần đăng ký liên tiếp: 0 mất sequence.
- **FR-021**: Quản lý phiên MUST giới hạn tối đa 10 phiên (cấu hình 1–10; giá trị > 10 bị bỏ qua kèm cảnh báo), từ chối phiên vượt bằng `error MAX_CLIENTS_REACHED` + mã đóng 4429, đóng phiên im lặng > 15 s bằng mã 4408, heartbeat máy chủ mỗi 5 s.
- **FR-022**: Mỗi phiên MUST có hàng đợi gửi riêng giới hạn 256 KB; ghi tới một client không được chặn bộ phát hay client khác; vượt giới hạn → `resync_required` rồi đóng phiên, giải phóng slot.
- **FR-023**: Máy chủ MUST kiểm Origin của yêu cầu nâng cấp kết nối dữ liệu sống: chỉ chấp nhận cùng origin với máy chủ và danh sách bổ sung cấu hình được (mặc định gồm origin của Studio); từ chối trước khi chiếm slot. Yêu cầu không có Origin (công cụ tải, client không phải trình duyệt) được chấp nhận vì không mang cookie trình duyệt; ghi rõ quyết định này trong contract.
- **FR-024**: Máy chủ MUST gửi chính sách bảo mật nội dung chặn script cho mọi file của project được phục vụ (`/project/**`, gồm SVG màn hình) và cho trang runtime.
- **FR-025**: Máy chủ MUST chạy bộ kiểm tra project (FR-007) khi khởi động; project không hợp lệ thì không kích hoạt, ghi lỗi và trả trạng thái lỗi qua `/api/v1/system/info`.
- **FR-026**: `/api/v1/system/info` MUST trả phiên bản runtime, phiên bản giao thức, số phiên hiện tại, giới hạn, số lần từ chối, số lần đóng do client chậm, thời gian chạy, trạng thái project.
- **FR-027**: Logic quản lý phiên và hàng đợi MUST độc lập với thư viện web server (đã có ở `core/session-manager`), có unit test không cần mạng.

**Triển khai**

- **FR-028**: MUST có hướng dẫn và file dịch vụ để deploy thủ công lên BL335 theo đúng chuỗi của Constitution VII, làm bằng tay hoặc bằng script: stage (giải nén vào thư mục mới) → validate (`mat-runtime --check-project`) → backup (giữ bản trước) → activate (đổi tên, khởi động lại dịch vụ) → health check (`/api/v1/system/info`) → rollback (lệnh có sẵn); các điều kiện khác: user không đặc quyền, `MemoryMax=300M`, tự khởi động lại khi lỗi và khi boot; lắng nghe cổng 8080 mặc định (cấu hình được); gói chỉ chứa file cần thiết (không fixture độc hại). Trước khi deploy MUST kiểm cổng chưa bị dịch vụ khác chiếm.
- **FR-029**: Mọi thay đổi trên BL335 MUST được ghi vào `docs/reports/device-changes.md` kèm cách hoàn tác. Không tắt/sửa dịch vụ của sản phẩm cũ (ví dụ `atscada-admin-recover.timer`) trừ khi người dùng yêu cầu rõ.

**Studio (cấu hình và xem trước, không có trình vẽ)**

- **FR-032**: Studio MUST mở một thư mục project viết tay, kiểm tra bằng bộ kiểm tra TypeScript dùng chung (FR-008) và hiển thị kết quả (hợp lệ hoặc danh sách lỗi có file, vị trí, lý do).
- **FR-033**: Studio MUST cho sửa cấu hình project qua form: tên, phiên bản project, màn hình đầu vào, `maxClients` (1–10), danh sách Tag (thêm/sửa/xóa id, kiểu, đơn vị, khoảng). Studio MUST kiểm trước khi lưu, không lưu file không hợp lệ, giữ nguyên các trường không sửa và định dạng JSON ổn định (diff gọn).
- **FR-034**: Studio MUST cho nhập và ghi nhớ địa chỉ thiết bị, kiểm kết nối (đọc `/api/v1/system/info`) và hiển thị phiên bản, số phiên, trạng thái project của thiết bị.
- **FR-035**: Studio MUST xem trước màn hình đầu vào với dữ liệu sống từ thiết bị bằng **cùng** package hiển thị SVG, binding và client dữ liệu sống của runtime web (không có logic hiển thị riêng). Xem trước dùng SVG và binding của project **trên máy Windows** (cho phép kiểm thay đổi trước khi copy), còn Tag lấy từ thiết bị.
- **FR-036**: Studio MUST có nút "Mở web thiết bị" mở trang runtime của thiết bị trong trình duyệt mặc định của hệ điều hành.
- **FR-037**: Quyền của Studio MUST tối thiểu: chỉ đọc/ghi trong thư mục project người dùng chọn, logic ứng dụng chỉ chủ động kết nối tới địa chỉ thiết bị đã nhập, mở URL ngoài chỉ với `http(s)://`. Chính sách bảo mật nội dung của Studio cho phép `connect-src http: ws:` (không giới hạn host vì IP do người dùng nhập; biện minh ở Complexity Tracking của plan) nhưng giữ `script-src 'self'`.

**Chất lượng**

- **FR-030**: Test MUST được viết trước mã cho: schema/bộ kiểm tra (cả TS và C++), binding, client dữ liệu sống, quản lý phiên/hàng đợi, Mock Tag provider, logic form cấu hình của Studio (Constitution VI). MUST có test tích hợp cho dữ liệu sống, giới hạn 10 + 1 client, client chậm, giải phóng slot.
- **FR-031**: Quy trình kiểm tra cục bộ (`tools/ci-local.ps1`: format, build armhf, build x64 + test, lint, test web, build web) MUST xanh trước khi đóng Sprint.

### Key Entities

- **Project (manifest)**: định danh, tên, phiên bản project, `schemaVersion`, `minRuntimeVersion`, màn hình đầu vào, danh sách màn hình, file Tag, `maxClients`.
- **Screen**: id, tên, file SVG, viewBox, kiểu co giãn, nền, file binding, danh sách `elementUid` khai báo (ánh xạ tới phần tử trong SVG).
- **Binding set**: theo screen; mỗi mục gồm `elementUid` và danh sách binding (id, đích trong allowlist, nguồn Tag, transform, `onBadQuality`).
- **Tag definition**: id, kiểu dữ liệu, đơn vị, khoảng giá trị, mô tả; nguồn giả lập cho Sprint 1.
- **Tag value (live)**: id, giá trị, chất lượng (GOOD/BAD/UNCERTAIN/STALE), timestamp nguồn/máy chủ (epoch ms UTC), revision.
- **Device connection (Studio)**: địa chỉ thiết bị (host, cổng) do kỹ sư nhập, lưu trong cấu hình cục bộ của Studio, không nằm trong project.
- **Live session**: một kết nối dữ liệu sống của một tab (hoặc phiên xem trước của Studio); tập Tag đã đăng ký, sequence, hàng đợi gửi (≤ 256 KB), thời điểm nhận cuối, Origin.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 10 tab Chrome trên ít nhất 2 máy khác nhau cùng xem màn hình bồn nước + motor từ BL335 liên tục ≥ 10 phút; mọi tab cập nhật đúng theo Mock Tag, 0 mất sequence không được khôi phục.
- **SC-002**: Tab thứ 11 nhận thông báo đầy trong ≤ 2 s; 10 tab còn lại không bị gián đoạn (0 mất sequence trong lúc đó).
- **SC-003**: Rút mạng client ≥ 30 s rồi cắm lại: STALE hiển thị trong ≤ 15 s sau khi mất; sau khi có mạng, màn hình hiển thị giá trị hiện hành trong ≤ 30 s, không cần tải lại trang. Slot của client mất mạng được giải phóng trong ≤ 20 s.
- **SC-004**: Màn hình mở và hiển thị dữ liệu sống trong ≤ 2 s (LAN, PC văn phòng); độ trễ Tag → hiển thị ≤ chu kỳ cập nhật + 500 ms.
- **SC-005**: Trên BL335 với 500 Tag đổi mỗi 1 s và 10 client mỗi client đăng ký đủ 500 Tag (trường hợp xấu nhất, bằng công cụ tải): RSS `mat-runtime` ≤ 150 MB, CPU trung bình ≤ 30 % và đỉnh ≤ 60 % trong ≥ 5 phút đo (dùng `tools/measure/sample.sh`).
- **SC-006**: Test client chậm: 9 client bình thường không mất sequence, client chậm bị đóng với `resync_required` khi hàng đợi vượt 256 KB; RSS không tăng trong 10 phút.
- **SC-007**: 10 client cùng tải lại trang: tất cả hiển thị dữ liệu sống trong ≤ 5 s, không timeout.
- **SC-008**: Bộ test vector schema: 100 % file hợp lệ được chấp nhận và 100 % file không hợp lệ bị từ chối ở cả hai phía, kết luận giống nhau.
- **SC-009**: Kết nối dữ liệu sống từ Origin lạ bị từ chối 100 %; file SVG màn hình mở trực tiếp không thực thi được script (kiểm bằng fixture có script).
- **SC-010**: Dịch vụ tự chạy lại trong ≤ 10 s sau khi tiến trình bị kill và sau khi BL335 khởi động lại.
- **SC-011**: `tools/ci-local.ps1` xanh toàn bộ khi đóng Sprint.
- **SC-012**: Trên Windows, kỹ sư mở project mẫu trong Studio, sửa và lưu cấu hình, xem trước màn hình sống từ BL335 và mở web thiết bị trong ≤ 5 phút mà không cần sửa file bằng tay; file lưu từ Studio được runtime chấp nhận.
- **SC-013**: Trang runtime truy cập được tại `http://<IP-BL335>:8080/` từ mọi máy Chrome trong LAN sau khi deploy và sau khi khởi động lại thiết bị.

## Assumptions

- Chưa có xác thực/đăng nhập/ghi Tag ở Sprint 1 (Sprint 5); runtime chỉ đọc. Vì vậy chỉ dùng trong LAN tin cậy; kiểm Origin và CSP là lớp giảm thiểu tối thiểu.
- Chưa có Tag Engine thật/driver Modbus (Sprint 2 song song); chỉ có Mock Tag provider. Project mẫu được đặt sẵn trên thiết bị cùng gói runtime, chưa có deploy package `.matscada` (Sprint 6).
- Chỉ một screen; chưa có điều hướng, popup, action, expression, alarm.
- Studio Sprint 1 không vẽ/chỉnh SVG, không sửa binding qua giao diện (binding vẫn viết tay; Sprint 4), không đẩy project lên thiết bị (Sprint 6). Bộ cài Studio tiếp tục theo cách đóng gói đã kiểm ở Sprint 0 (NSIS, WebView2 offline).
- Định dạng delta tiếp tục theo contract Sprint 0 (gọn theo chỉ số Tag) trừ khi plan chứng minh cần đổi; mọi thay đổi ghi vào contract mới của feature này.
- Cảnh báo mở trùng tab (BroadcastChannel) và đặt chỗ slot cho quản trị: ngoài phạm vi Sprint 1.
- "Các máy khác nhau" cho SC-001: tối thiểu 2 máy vật lý trong LAN, phân bổ 10 tab giữa các máy; nếu có thêm máy thì dùng thêm. Ghi rõ cấu hình thực tế trong báo cáo.
- Hành vi subscribe lần 2 trên cùng phiên: mặc định thay thế đăng ký cũ và gửi snapshot mới (chốt trong plan/contract).
- Các vấn đề treo của Sprint 0 (T034 duyệt Go/No-Go, T036 SVG Illustrator/CorelDRAW thật, giới hạn 20.000 node, ngưỡng RAM OS 200/250 MB, timer `atscada-admin-recover`) không chặn Sprint 1; số đo CPU trên BL335 đã bao gồm tải nền của timer đó.
- Mọi số đo thực hiện trên BL335 thật (192.168.1.110); chưa đo thì báo cáo ghi "chưa đo".
