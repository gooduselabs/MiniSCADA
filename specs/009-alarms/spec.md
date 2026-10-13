# Feature Specification: Alarm (cảnh báo) theo ISA-18.2

**Feature Branch**: `009-alarms`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "GĐ 4 của lộ trình v2: alarm. Định nghĩa: alarm số (bit bật/tắt); alarm ngưỡng HH/H/L/LL có deadband và trễ bật/tắt; alarm mất kết nối/quality. Lớp alarm (mức ưu tiên, màu, nhấp nháy, cần xác nhận, âm thanh); nhóm/khu vực; nội dung có chèn giá trị. Trạng thái theo ISA-18.2 (có và chưa xác nhận → đã xác nhận → hết; shelving/suppress ở mức tối thiểu hợp lý). Xác nhận cần role operator và ghi audit (SQLite FULL; đã có). Alarm log trong SQLite, có thời hạn lưu, trong ngân sách ghi eMMC (Constitution III), chịu mất điện (không hỏng log). Đẩy alarm qua WebSocket (giao thức live 1.3.0, tương thích ngược; live hiện 1.2.0). Web: banner alarm; bảng alarm đang có (lọc, sắp xếp, xác nhận, xác nhận tất cả); lịch sử alarm (khoảng thời gian, lọc, xuất CSV); số alarm trên menu; widget alarm cho `@mat/ui-components`. Studio: editor Bảng Alarm, Lớp Alarm trên cây project (đang là mục khóa 'GĐ 4'); thử alarm bằng mô phỏng; định dạng project 0.5.0 + migration từ 0.4; chuỗi tiếng Việt. Nghiệm thu: 200 alarm; alarm hiện ≤ 1 s sau khi điều kiện đúng (cộng trễ cấu hình); mất điện không hỏng alarm log; RSS ≤ 150 MB, CPU ≤ 30 %. Ngoài phạm vi: thông báo ngoài (email, Telegram, Zalo), recipe (GĐ 6 trở đi)."

## Bối cảnh

Sau GĐ 3a ([007](../007-screens-widgets/spec.md)), người vận hành xem dashboard nhiều màn hình trên Chrome và điều khiển có kiểm soát, nhưng **không có gì báo cho họ khi máy có sự cố**: một bồn đầy, một bơm quá dòng, một PLC rút cáp chỉ hiện ra khi họ tình cờ nhìn đúng card. SCADA không có alarm thì chưa dùng thật được trong nhà máy. Cụ thể hiện nay:

- không có định nghĩa alarm nào trong project: Studio chỉ có mục khóa "GĐ 4" ở cây project ([tree.ts](../../apps/studio/src/model/tree.ts): `alarm`, `alarmList`, `alarmClasses`); runtime không có mô-đun nào đánh giá điều kiện;
- Tag có `quality` và `reason` (006) nhưng không ai theo dõi để báo; widget chỉ tô màu BAD trên card;
- `audit.db` (011) đã bền khi mất điện (`synchronous=FULL`) và có role `operator`, nhưng chưa có hành động xác nhận alarm;
- giao thức live 1.2.0 chỉ mang Tag; `apps/runtime-web` chưa có banner hay trang alarm; menu chưa có số đếm;
- lịch sử nằm ở `history.db` (003, 008) là bảng rộng theo Tag, không hợp để lưu "sự kiện" có vòng đời.

GĐ 4 của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.5) giải quyết các điểm này bằng một feature (D1). Ràng buộc chính của [Constitution](../../.specify/memory/constitution.md) 2.0.1:

- **II:** `core/` không chứa giao diện; `apps/runtime-web` chỉ hiển thị và gọi API; Studio và runtime dùng chung schema và logic ở `packages/*`: động cơ alarm có **hai bản** (C++ cho thiết bị, TS cho mô phỏng trong Studio) với bộ vector chung, như biểu thức ([ADR-015](../../docs/adr/015-expression-language.md)).
- **III:** BL335: RSS ≤ 150 MB, CPU trung bình ≤ 30 % với 500 Tag/1 s/10 client; ghi eMMC ≤ 2 GB/ngày. Alarm không được làm vượt: mọi cơ chế chống "bão alarm" nằm trong thiết kế, không để người dùng tự chịu.
- **IV:** tối đa 10 phiên live; alarm đi chung kênh live, không mở kết nối thêm.
- **V:** xác nhận là thao tác của người vận hành: backend kiểm role, ghi audit **trước** khi áp dụng; không `eval`; chuỗi do project cung cấp chỉ vào DOM bằng `textContent`; web SCADA không phải lớp an toàn (interlock ở PLC; alarm là thông tin cho người, không điều khiển máy).
- **VI:** test viết trước; có test tích hợp mất điện và tải. **VII:** schema theo SemVer có migration; YAGNI theo giai đoạn: thông báo ngoài, recipe, logic v2 không làm ở đây.
- **Ngoại lệ SQLite:** Constitution 2.0.1 cho hai ngoại lệ `synchronous=FULL` (mốc gửi historian, `audit.db`). Feature này **không xin ngoại lệ thứ ba**: `alarm.db` chạy `NORMAL`; tính bền của xác nhận do `audit.db` đảm nhận; thiết kế để mất điện chỉ có thể đẩy trạng thái về phía **an toàn** (chưa xác nhận), không bao giờ tạo xác nhận giả (D13, D14).

Phần Studio theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5 (lưới), §7, §9; người dùng từ chối giao diện form cơ bản, chuẩn là công cụ IDE kiểu TIA Portal. Mockup của feature này: `docs/architecture/mockups/studio-alarms.html` (task tạo và tự duyệt trước khi viết giao diện).

**Thuật ngữ:**

- **Alarm (định nghĩa)**: một mục cấu hình trong project: loại (`digital`, `limit`, `quality`), Tag hoặc thiết bị theo dõi, điều kiện, trễ, lớp, khu vực, nội dung.
- **Alarm (phiên bản, instance)**: đơn vị mà động cơ đánh giá. Alarm `digital` và `quality` có một instance (id = id định nghĩa). Alarm `limit` có tối đa bốn instance, mỗi ngưỡng một cái, id dạng `TANK_LEVEL.HH`.
- **Lần xảy ra (occurrence)**: một vòng đời của instance từ lúc bật tới lúc hết (và được xác nhận hết, nếu lớp yêu cầu). Mỗi lần xảy ra có mã tăng dần, bền, lưu ở `alarm.db`.
- **Lớp alarm**: nhóm tính chất dùng chung: mức ưu tiên, màu, nhấp nháy, cần xác nhận hay không, cần xác nhận khi hết hay không, âm thanh.
- **Khu vực**: nhãn nhóm alarm theo vị trí hay công đoạn (một cấp, phẳng); dùng để lọc.
- **Trạng thái** theo ISA-18.2 (D8): `ACTIVE_UNACK` (đang có, chưa xác nhận), `ACTIVE_ACK` (đang có, đã xác nhận), `RTN_UNACK` (đã hết, chưa xác nhận hết), và bình thường (không có lần xảy ra mở). Cộng hai cờ độc lập: **shelved** (tạm ẩn do người vận hành) và **disabled** (ngừng đánh giá do kỹ sư).
- **Banner alarm**: dải trên cùng của trang runtime luôn hiện alarm chưa xác nhận ưu tiên cao nhất và số lượng.
- **BL335**: thiết bị chạy runtime, như 005 đến 007.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Thấy alarm và xác nhận trên Chrome (Priority: P1)

Ca đêm. Bồn B1 đầy: mức nước vượt ngưỡng H 80 % rồi HH 90 %. Trên Chrome, dải banner ở đầu trang chuyển đỏ và nhấp nháy: "Khẩn cấp · Bồn B1 mức rất cao: 91.2 % (> 90) · 2 chưa xác nhận"; trình duyệt phát tiếng còi (nếu người vận hành đã bật âm thanh). Mục "Alarm" trên menu hiện số `2` đỏ. Người vận hành bấm banner: trang "Alarm" mở, bảng liệt kê các alarm đang có, xếp theo mức ưu tiên rồi thời điểm; hàng chưa xác nhận nhấp nháy theo lớp. Họ chọn hàng HH, bấm **Xác nhận** (có tác dụng ngay, không hộp, không lý do): hàng thôi nhấp nháy, tiếng còi ngừng, banner cập nhật "1 chưa xác nhận". Mực nước hạ xuống: hàng H chuyển "Đã hết, chưa xác nhận"; họ bấm **Xác nhận tất cả**: bảng xóa các hàng đã hết, số trên menu về 0, banner ẩn.

Người xem không đăng nhập (viewer, trong mạng riêng) thấy cùng bảng và banner nhưng các nút xác nhận bị khóa kèm lý do "Cần đăng nhập với role operator".

**Why this priority**: đây là lý do tồn tại của GĐ 4: người vận hành biết có sự cố và phản hồi. Mọi story khác phục vụ hoặc dựa vào luồng này.

**Independent Test**: project 0.5.0 mẫu (`projects/alarm-demo`, task tạo) có 12 alarm (số, ngưỡng, quality) trên Tag mô phỏng của 006 (bộ sinh tất định); chạy runtime x64; Chrome headless (puppeteer). Kiểm DOM của banner, bảng, menu, tiếng (giả `AudioContext`), thời gian từ lúc đổi Tag tới lúc DOM đổi. Đăng nhập operator và viewer bằng tài khoản thử sinh ngẫu nhiên.

**Acceptance Scenarios**:

1. **Given** alarm `TANK_B1_LEVEL.H` (ngưỡng 80, deadband 2, trễ bật 3 s) và Tag mức nước đang 70, **When** Tag lên 85 rồi giữ, **Then** sau 3 s (± 250 ms của chu kỳ tick) alarm xuất hiện ở trạng thái `ACTIVE_UNACK` trên Chrome không quá 1 s sau mốc đó (SC-003); không xuất hiện trước mốc 3 s.
2. **Given** alarm đang `ACTIVE_UNACK` lớp có `blink`, **When** vẽ bảng, **Then** hàng nhấp nháy (đổi nền xen kẽ theo chu kỳ 1 s); khi hệ điều hành bật "giảm chuyển động" thì thay bằng viền đậm tĩnh; trạng thái luôn có chữ và biểu tượng, không chỉ màu (SC-012).
3. **Given** operator đã đăng nhập, **When** bấm Xác nhận trên một hàng `ACTIVE_UNACK`, **Then** trạng thái thành `ACTIVE_ACK` ở mọi client đang mở trong ≤ 500 ms (LAN), `audit.db` có dòng `alarm.ack` (người, role, kênh `web`, alarm, mã lần xảy ra) đã commit trước khi trạng thái đổi (SC-006).
4. **Given** hai alarm `ACTIVE_UNACK` và bộ lọc khu vực "Bồn", **When** bấm Xác nhận tất cả, **Then** chỉ các alarm trong bộ lọc và đã hiện trên màn hình lúc bấm được xác nhận (alarm bật sau lúc bấm giữ nguyên chưa xác nhận); một dòng audit `alarm.ack` ghi số lượng và danh sách rút gọn.
5. **Given** alarm `ACTIVE_ACK`, **When** điều kiện hết (sau deadband và trễ tắt), **Then** nếu lớp không yêu cầu xác nhận khi hết thì alarm biến mất khỏi bảng "đang có" và vào lịch sử; nếu lớp yêu cầu (`ackReturn`) thì thành `RTN_UNACK` đến khi được xác nhận.
6. **Given** alarm `ACTIVE_UNACK` và điều kiện hết trước khi ai xác nhận, **When** lớp yêu cầu xác nhận, **Then** alarm thành `RTN_UNACK` (vẫn hiện, không nhấp nháy mạnh), cho tới khi có người xác nhận; lớp không yêu cầu xác nhận (`requiresAck` = false) thì alarm hiện như thông tin và tự mất khi hết.
7. **Given** nhiều alarm chưa xác nhận, **When** nhìn banner, **Then** banner hiện alarm có mức ưu tiên cao nhất, trong cùng mức thì mới nhất, kèm tổng số chưa xác nhận và số theo mức; bấm "Xác nhận" trên banner chỉ xác nhận alarm đang hiện ở banner.
8. **Given** viewer hoặc khách, **When** mở trang Alarm, **Then** bảng, banner, số đếm hiện đủ; nút Xác nhận, Tạm ẩn khóa kèm lý do; gọi thẳng API xác nhận bị từ chối (SC-007).
9. **Given** người vận hành chưa từng bật âm thanh, **When** có alarm mới có lớp `sound`, **Then** trang hiện chỉ báo "Âm thanh đang tắt, bấm để bật" (Chrome không cho phát tiếng trước khi có thao tác người dùng); sau khi bật, tiếng phát theo lớp; bấm "Tắt tiếng" dừng tiếng của các alarm hiện có nhưng không xác nhận alarm nào (FR-067).
10. **Given** mất kết nối WebSocket, **When** hết hạn nhận dữ liệu, **Then** banner đổi sang "Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ" và bảng mờ đi; có lại kết nối thì nhận snapshot mới và trạng thái khớp thiết bị (không còn hàng cũ).
11. **Given** trang Alarm mở ở hai Chrome, **When** một bên xác nhận, **Then** bên kia cập nhật ≤ 500 ms; hai bên bấm xác nhận cùng lúc thì một lần xác nhận có hiệu lực và lần kia nhận "đã được xác nhận" (không lỗi, không dòng audit trùng cho cùng lần xảy ra).
12. **Given** project không có alarm nào, **When** mở trang, **Then** không hiện banner, không có mục Alarm trên menu; trang chạy y như project 0.4 của 3b trên runtime 0.7.

---

### User Story 2 - Định nghĩa alarm và lớp alarm trong Studio, thử bằng mô phỏng, nạp xuống (Priority: P1)

Kỹ sư mở project, ở cây chọn **Alarm → Lớp alarm**: bảng bốn lớp mặc định (Khẩn cấp, Quan trọng, Nhỏ, Lưu ý) với màu, nhấp nháy, cần xác nhận, âm thanh; họ thêm lớp "An toàn nước" màu tím. Ở **Alarm → Danh sách alarm** họ thấy lưới kiểu Excel: mỗi dòng một alarm (id, tên, loại, Tag, ngưỡng, deadband, trễ bật, trễ tắt, lớp, khu vực, nội dung, bật/tắt). Họ nhấp phải vào Tag `TANK01.LEVEL` ở cây, chọn "Tạo alarm cho Tag…": hộp thoại có bốn ô ngưỡng LL, L, H, HH, deadband, trễ, lớp gợi ý theo ngưỡng; bấm Tạo sinh một dòng với bốn ngưỡng. Họ dán 30 dòng từ Excel (bồn, bơm, nhiệt độ). Dòng sai (ngưỡng không tăng dần, Tag không có) viền đỏ, chi tiết ở tab Thông tin. Họ bấm **Thử alarm**: panel mô phỏng hiện danh sách alarm theo mô phỏng 006 (Tag ramp qua ngưỡng); họ thấy alarm bật đúng thời điểm sau trễ, xác nhận thử, thấy hết theo deadband. Họ Kiểm tra, Nạp xuống BL335; trên Chrome alarm hoạt động như thử.

**Why this priority**: không có định nghĩa thì không có alarm; theo Constitution I, Studio sinh đúng định dạng runtime đã chạy. Có thể kiểm độc lập với giao diện vận hành bằng project viết tay, nhưng giá trị người dùng chỉ có khi kỹ sư tự dựng được.

**Independent Test**: e2e Chrome headless (lớp Tauri giả, axe-core): mở project 0.3 của 007, nâng cấp 0.5.0, dựng 200 alarm (dán CSV, wizard "Tạo alarm cho Tag"), lớp, khu vực; Kiểm tra không lỗi; Thử alarm cho kết quả khớp bộ vector (SC-017); Nạp xuống runtime x64 và Đọc lên cho "giống".

**Acceptance Scenarios**:

1. **Given** project 0.4 (của 3b; hoặc 0.3 của 007, đi qua 0.4 trong cùng một lần) mở trong Studio 0.7, **When** chọn Nâng cấp lên 0.5.0, **Then** hộp thoại nói đổi gì (chỉ đổi phiên bản, nâng runtime tối thiểu, thêm nơi chứa alarm trống), nơi giữ bản sao lưu; kết quả là cùng nội dung, chỉ khác `schemaVersion` và `minRuntimeVersion` (SC-015); mục Alarm trên cây mở khóa.
2. **Given** cây project, **When** mở **Alarm → Lớp alarm**, **Then** có bốn lớp mặc định (ID `critical`, `major`, `minor`, `advisory`) cho project mới; sửa được tên, ưu tiên (1 đến 4), màu (8 màu thiết kế), nhấp nháy, cần xác nhận, cần xác nhận khi hết, âm thanh (4 kiểu); xóa lớp đang dùng liệt kê chỗ dùng và hỏi xác nhận.
3. **Given** bảng Tag có `TANK01.LEVEL` (FLOAT, 0 đến 100 %), **When** chọn "Tạo alarm cho Tag…" và nhập H = 80, HH = 90, deadband 2, trễ bật 3 s, **Then** sinh một alarm `limit` với ngưỡng H và HH, lớp theo gợi ý (HH → `critical`, H → `minor`), nội dung mặc định có chèn giá trị; lưu được và Kiểm tra không lỗi.
4. **Given** bảng 200 dòng, **When** dán 50 dòng từ Excel hoặc kéo điền (Ctrl+D), **Then** áp dụng như lưới Tag của 006 (ADR-016): lỗi theo ô, chi tiết ở tab Thông tin, một bước hoàn tác.
5. **Given** ngưỡng sai thứ tự (H = 90, HH = 80), Tag không có, loại Tag không hợp (alarm số trên Tag FLOAT), lớp không có, nội dung có thẻ lạ `{abc}`, **When** Kiểm tra, **Then** mỗi lỗi có mã `E_ALARM_*` và vị trí (alarm, ô), Nạp xuống bị khóa (FR-013).
6. **Given** nội dung `"{name} cao: {value:1} {unit} (ngưỡng {limit})"`, **When** bấm Xem trước nội dung, **Then** hiện ví dụ với giá trị mẫu; thẻ không hợp thì báo.
7. **Given** project có alarm, **When** bấm **Thử alarm**, **Then** panel dựng danh sách alarm chạy bằng động cơ TS và SimEngine; đổi Tag mô phỏng sang "Nhập tay" cho phép đẩy giá trị qua ngưỡng; xác nhận thử và tạm ẩn thử hoạt động; kết quả (thời điểm bật, tắt, trạng thái) khớp động cơ C++ trên bộ vector chung (SC-017).
8. **Given** thiết bị Online, **When** mở **Alarm → Danh sách alarm**, **Then** thêm cột trạng thái sống (từ live 1.3.0, viền cam); sửa định nghĩa không đổi gì trên thiết bị cho tới khi Nạp xuống.
9. **Given** project 0.5.0 có alarm, **When** Nạp xuống BL335 chạy runtime 0.7 (của 3b) hoặc cũ hơn, **Then** dòng Tương thích runtime khóa nạp với lý do "cần runtime ≥ 0.8.0" (FR-014).
10. **Given** Studio đổi tên một Tag đang có alarm, **When** xác nhận, **Then** `tag` của alarm cập nhật cùng một bước hoàn tác; "Dùng ở đâu" của Tag liệt kê alarm.
11. **Given** Studio mở bằng Windows có bộ gõ Telex hoặc Unikey, **When** gõ tên alarm và nội dung có dấu trong lưới, **Then** chữ vào đúng như ở lưới Tag (ADR-016).

---

### User Story 3 - Động cơ alarm đúng, bền khi khởi động lại và mất điện (Priority: P1)

Kỹ sư triển khai 200 alarm lên BL335. Điều kiện đúng thì alarm bật sau trễ cấu hình; đúng sai chập chờn quanh ngưỡng không sinh bão alarm nhờ deadband, trễ và cơ chế tự cách ly; Tag mất tín hiệu thì alarm quality bật, các alarm ngưỡng của Tag đó giữ nguyên trạng thái (không báo giả "hết"). Cắt điện giữa lúc nhiều alarm đang có: bật lại, file alarm log nguyên vẹn, các alarm còn đúng điều kiện vẫn được hiển thị, không alarm nào bị coi là đã xác nhận nếu chưa có ai xác nhận. Kỹ sư vô hiệu một alarm hỏng cảm biến (cần role engineer, có audit); người vận hành tạm ẩn alarm gây phiền 1 giờ kèm lý do.

**Why this priority**: tính đúng và tính bền là toàn bộ giá trị của alarm; alarm sai hoặc mất sau mất điện còn tệ hơn không có.

**Independent Test**: bộ vector chung `tests/alarm-vectors/` (≥ 60 ca: chuỗi điều kiện theo thời gian → chuỗi chuyển trạng thái) chạy ở C++ và TS; test đơn vị bảng trạng thái ISA; `tools/alarm-it.ps1` trên runtime x64: độ trễ, quality, bão alarm, `kill -9` 100 lần với kiểm `integrity_check`; mô phỏng khởi động lại giữa các trạng thái.

**Acceptance Scenarios**:

1. **Given** alarm `limit` H = 80, deadband 2, Tag đi 79 → 81 → 79 → 77, **When** đánh giá, **Then** bật khi ≥ 80 (sau trễ bật), vẫn còn ở 79 (trong deadband), hết khi < 78 (sau trễ tắt); với L ngược lại (bật khi ≤ ngưỡng, hết khi > ngưỡng + deadband).
2. **Given** điều kiện đúng 2 s rồi sai khi trễ bật là 3 s, **When** đánh giá, **Then** không có lần xảy ra nào (trễ bật bị đặt lại); tương tự điều kiện sai ngắn hơn trễ tắt thì alarm không hết.
3. **Given** alarm `digital` trên BOOL `PUMP1.FAULT` (kích khi `true`), **When** Tag đổi, **Then** bật hoặc hết theo trễ; trên Tag số nguyên thì khác 0 là `true`; trên chuỗi hoặc FLOAT là lỗi kiểm tra.
4. **Given** Tag của alarm `limit` có quality BAD, **When** đánh giá, **Then** trạng thái instance giữ nguyên (không bật, không hết), cờ `inputBad` = true hiện trong dữ liệu; quality trở lại GOOD thì đánh giá tiếp từ giá trị mới, bộ đếm trễ bắt đầu lại; UNCERTAIN vẫn đánh giá bình thường.
5. **Given** alarm `quality` trên Tag (hoặc thiết bị) và PLC rút cáp, **When** Tag BAD quá trễ bật (mặc định 0 s), **Then** alarm "mất tín hiệu" bật kèm `reason` (ví dụ `TIMEOUT`); khi nối lại thì hết; alarm quality cho **thiết bị** bật khi mọi Tag của thiết bị đó đều không GOOD.
6. **Given** instance `ACTIVE_ACK`, **When** điều kiện hết rồi đúng lại, **Then** lần xảy ra mới `ACTIVE_UNACK` (mã mới); lần cũ đã đóng trong lịch sử.
7. **Given** alarm bật rồi hết 5 lần trong 60 s, **When** lần bật thứ 5 trong 60 s xảy ra, **Then** engine tự cách ly alarm 30 phút ("chập chờn", ghi audit hệ thống `alarm.shelve` do `system`); lần bật thứ 5 là dòng tổng kết trong lịch sử (mang số lần bật gộp, các lần bật sau trong đợt cách ly không có dòng riêng); sau 30 phút tự hết cách ly; số lần ngưỡng cấu hình theo lớp (FR-035, SC-019).
8. **Given** runtime khởi động lại (kể cả `kill -9`), **When** nạp project và đọc `alarm.db`, **Then** các lần xảy ra đang mở được dựng lại với trạng thái đã commit; mỗi alarm đánh giá lại với Tag hiện tại: còn đúng điều kiện thì giữ (không chạy lại trễ bật, không tạo lần xảy ra mới), đã sai thì hết sau trễ tắt; Tag chưa có giá trị tin cậy thì giữ nguyên tới khi có.
9. **Given** cắt điện ngay sau một lần xác nhận, **When** bật lại, **Then** `audit.db` có dòng xác nhận (FULL); `alarm.db` có thể chưa có xác nhận đó (NORMAL): trạng thái alarm quay về `ACTIVE_UNACK` (hướng an toàn) và người vận hành xác nhận lại; **không bao giờ** có alarm ở `ACTIVE_ACK` mà `audit.db` không có dòng xác nhận tương ứng (SC-008).
10. **Given** người vận hành tạm ẩn alarm (shelve) 1 giờ kèm lý do, **When** alarm bật trong lúc đó, **Then** không hiện ở banner, không còn tiếng, không tính vào số trên menu; hiện ở tab "Tạm ẩn" kèm thời gian còn lại; hết hạn mà điều kiện còn đúng thì trở thành `ACTIVE_UNACK` mới (có tiếng, có banner); `alarm.shelve` có trong audit.
11. **Given** kỹ sư vô hiệu (disable) một alarm có lý do, **When** nạp lại project hoặc khởi động lại, **Then** alarm vẫn bị vô hiệu cho tới khi bật lại; trong lúc vô hiệu không đánh giá, lần xảy ra đang mở được đóng với dấu "vô hiệu".
12. **Given** project được nạp xuống mới (alarm bị xóa, thêm, đổi ngưỡng), **When** kích hoạt, **Then** lần xảy ra của alarm đã xóa được đóng (dấu "đổi cấu hình"); alarm đổi định nghĩa được đánh giá lại từ đầu mà giữ lần xảy ra mở nếu điều kiện còn đúng; alarm mới đánh giá từ đầu.
13. **Given** 200 alarm cùng bật trong một tick, **When** đẩy tới 10 client, **Then** mỗi client nhận trọn vẹn không tràn hàng đợi 256 KB (không 4409), CPU và RSS trong ngân sách (SC-011, SC-018).
14. **Given** đồng hồ thiết bị chưa đồng bộ (RTC không chạy, về 1970), **When** alarm bật, **Then** lần xảy ra mang cờ `clockOk` = false và hiện "giờ chưa đồng bộ"; thứ tự vẫn đúng theo mã tăng dần; thời hạn lưu không xóa dòng nào trong lúc đồng hồ không hợp lệ (như `audit.db`).

---

### User Story 4 - Lịch sử alarm: tra cứu theo khoảng thời gian, lọc, xuất CSV (Priority: P2)

Quản đốc sáng hôm sau mở trang "Lịch sử alarm", chọn khoảng "Hôm qua 18:00 → hôm nay 06:00", khu vực "Bồn", mức ưu tiên ≥ Quan trọng. Bảng liệt kê từng lần xảy ra: thời điểm bật, thời điểm xác nhận và người xác nhận, thời điểm hết, thời lượng, giá trị lúc bật, nội dung. Họ sắp theo thời lượng, tìm chữ "B1", bấm **Xuất CSV**: tải về file mở bằng Excel đúng tiếng Việt, đúng bộ lọc.

**Why this priority**: tra cứu sự cố là nhu cầu thứ hai sau phản ứng tức thời; không chặn vận hành.

**Independent Test**: tạo 100.000 lần xảy ra trong `alarm.db` (công cụ thử), truy vấn qua API và Chrome headless; kiểm số dòng, thứ tự, bộ lọc, thời gian, CSV.

**Acceptance Scenarios**:

1. **Given** lịch sử có lần xảy ra, **When** chọn khoảng thời gian (mặc định 24 giờ gần nhất; tối đa 366 ngày), **Then** bảng liệt kê các lần xảy ra **bắt đầu** trong khoảng, mới nhất trước, phân trang 100 dòng.
2. **Given** các bộ lọc khu vực, lớp, mức ưu tiên (từ mức đó trở lên), trạng thái cuối (đã xác nhận, hết, đóng do cấu hình), alarm id và ô tìm chữ trong nội dung, id alarm và tên khu vực, **When** áp dụng, **Then** chỉ dòng khớp hiện; bộ lọc kết hợp bằng AND; tìm chữ không phân biệt hoa thường và dấu tiếng Việt (SC-013).
3. **Given** bảng đã lọc, **When** bấm Xuất CSV, **Then** tải file `alarm-history-<từ>-<đến>.csv` mã hóa UTF-8 có BOM, dấu phân cách `,`, tiêu đề tiếng Việt, thời gian ISO 8601 có múi giờ; mọi dòng khớp bộ lọc (tới 100.000 dòng; vượt thì cảnh báo và cắt, nói rõ số dòng bị cắt).
4. **Given** nội dung alarm có ký tự đầu là `=`, `+`, `-`, `@` hoặc tab, **When** xuất CSV, **Then** ô được vô hiệu hóa bằng dấu `'` ở đầu và dấu nháy kép theo RFC 4180; mở bằng Excel không chạy công thức (SC-020).
5. **Given** lần xảy ra chưa hết, **When** nhìn lịch sử, **Then** cột "Hết" trống và trạng thái "Đang có"; hàng không tự cập nhật trừ khi bấm Tải lại hoặc bật "Theo dõi" (cập nhật khi có thay đổi).
6. **Given** truy vấn khoảng lớn, **When** nhập, **Then** server giới hạn mỗi trang ≤ 500 dòng và trang thứ hai lấy bằng `beforeId` (không dùng OFFSET); người dùng không thể buộc quét toàn bộ bảng bằng một lần gọi.
7. **Given** viewer không đăng nhập (mạng riêng), **When** mở Lịch sử, **Then** xem và xuất được (đọc); khách ngoài mạng riêng bị lọc nguồn như các API đọc khác (ADR-018).

---

### User Story 5 - Widget alarm trong màn hình và số alarm trên dashboard (Priority: P2)

Kỹ sư kéo widget **Bảng alarm** từ Toolbox vào màn hình "Tổng quan", đặt bộ lọc khu vực "Bồn", chọn cột, và kéo thêm widget **Số alarm** (đèn có số, nhấp nháy khi có chưa xác nhận) vào góc. Trong Studio xem trước ở chế độ Mô phỏng, hai widget phản ứng với alarm mô phỏng. Trên Chrome, bảng alarm nhúng cho phép xác nhận ngay tại dashboard.

**Why this priority**: dashboard là nơi người vận hành nhìn cả ngày; nhưng banner và trang Alarm (US1) đã đủ dùng, nên P2.

**Independent Test**: dựng màn hình có hai widget trong Studio (e2e), xem trước Mô phỏng; nạp xuống runtime x64 và kiểm DOM trong Chrome headless; vector danh mục widget (catalog 0.4.0).

**Acceptance Scenarios**:

1. **Given** Toolbox, **When** mở nhóm "Alarm", **Then** có `alarm-list` (Bảng alarm) và `alarm-count` (Số alarm); danh mục `widgets.catalog.json` 0.4.0 mô tả khe, thuộc tính, cỡ tối thiểu; validator hai bản cho cùng kết luận trên vector.
2. **Given** `alarm-list` với thuộc tính `areas` = ["Bồn"], `minPriority` = `minor`, `columns` = [thời gian, ưu tiên, nội dung, giá trị, trạng thái], `maxRows` = 8, **When** chạy, **Then** hiện đúng tập alarm đang có thỏa bộ lọc, đúng cột; nút Xác nhận mỗi hàng khả dụng với operator, khóa với viewer.
3. **Given** `alarm-count` hiển thị số chưa xác nhận trong khu vực, **When** có alarm mới, **Then** đèn đổi màu theo mức ưu tiên cao nhất, nhấp nháy theo lớp, số cập nhật ≤ 1 s; bấm vào chuyển tới màn hình hoặc trang Alarm đã đặt (`target`).
4. **Given** widget alarm không có nguồn (xem trước Tắt), **When** vẽ, **Then** hiện trạng thái trống "Không có dữ liệu alarm", không lỗi.
5. **Given** widget alarm, **When** kiểm DOM, **Then** không dùng `innerHTML`; nội dung alarm do project cung cấp chỉ vào bằng `textContent` (SC-020).
6. **Given** dashboard 20 widget của 007 cộng hai widget alarm, **When** mở, **Then** vẫn ≤ 2 s (007 SC-002).

---

### User Story 6 - Vận hành an toàn: quyền, audit, nhiều client, tương thích và ngân sách (Priority: P3)

Quản trị viên kiểm tra: viewer không xác nhận được, operator xác nhận có audit, engineer vô hiệu có audit, tấn công CSRF vào API xác nhận bị chặn; 10 client cùng mở trang Alarm khi 200 alarm bật; Chrome cũ (trang 1.2.0) mở cùng thiết bị 1.3.0 vẫn chạy; ghi eMMC của alarm nằm trong ngân sách.

**Why this priority**: bao trùm các tiêu chí phi chức năng; làm sau khi luồng chính chạy nhưng bắt buộc trước khi đóng feature.

**Independent Test**: `tools/alarm-it.ps1` kịch bản `auth`, `attack`, `storm`, `compat`, `budget`; đo trên BL335 ở task ⚠️🔌.

**Acceptance Scenarios**:

1. **Given** bộ ca tấn công vào `POST /api/v1/alarms/ack`, `shelve`, `unshelve`, `disable`, `enable` (thiếu hoặc sai CSRF, `Origin` lạ, cookie trên HTTP, phiên cookie gọi endpoint kỹ thuật, `GET` đổi trạng thái, role thấp, phiên hết hạn), **When** chạy, **Then** 100 % bị từ chối, 0 thay đổi trạng thái, audit hoặc đếm theo quy tắc gộp 60 s (SC-007).
2. **Given** `audit.db` không ghi được (đầy, hỏng), **When** operator xác nhận, **Then** nhận 503 `AUDIT_UNAVAILABLE`, trạng thái alarm không đổi (không xác nhận khi chưa audit), giao diện hiện lý do.
3. **Given** client trang 1.2.0 (hoặc `@mat/live-client` 1.2.0) và thiết bị 1.3.0, **When** kết nối, **Then** nhận Tag y như cũ, không nhận bản tin alarm, không lỗi (SC-015); client 1.3.0 với thiết bị 1.2.0: banner và trang Alarm hiện "Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)".
4. **Given** 200 alarm, 500 Tag mô phỏng/1 s, 10 client, 30 phút trên BL335, **When** đo, **Then** CPU trung bình ≤ 30 %, RSS ≤ 150 MB, phần alarm thêm không quá 3 điểm phần trăm CPU và 4 MB RSS; ghi eMMC của `alarm.db` trong tải chuẩn ≤ 25 MB/ngày và trong tải bão ≤ 0,1 GB/ngày (SC-009, SC-011).
5. **Given** `alarm.db` hỏng (kiểm `integrity_check` lỗi lúc khởi động), **When** runtime khởi động, **Then** đổi tên thành `alarm.db.corrupt-<epoch>`, tạo file mới, ghi audit `alarm.purged` kèm lý do, chạy tiếp; alarm hiện đánh giá lại từ điều kiện (như `history.db` của 003).
6. **Given** đĩa gần đầy (dưới `minFreeBytes`), **When** ghi `alarm.db`, **Then** dừng ghi lịch sử mới, **động cơ vẫn chạy** và hiện alarm trong RAM (đánh dấu `logPaused` ở `system/info`), tiếp tục khi đủ chỗ; không bao giờ làm dừng runtime.

---

### Edge Cases

**Định nghĩa và định dạng**

- Alarm `limit` không có ngưỡng nào, ngưỡng không tăng dần `LL < L < H < HH` (chỉ xét các ngưỡng có mặt), deadband âm hoặc lớn hơn khoảng giữa hai ngưỡng kề nhau: lỗi kiểm tra.
- Alarm số trên Tag FLOAT hoặc chuỗi, alarm ngưỡng trên Tag BOOL hay chuỗi, Tag không có, `device` không có: lỗi kiểm tra.
- Hai alarm cùng id, id sai dạng, lớp hoặc khu vực không có, mẫu `text` quá 200 ký tự (kết quả chèn quá dài thì cắt ở runtime) hoặc có thẻ lạ, trễ ngoài khoảng 0 đến 24 giờ: lỗi kiểm tra.
- Quá 500 instance (đếm cả ngưỡng): lỗi giới hạn; trên 200 instance: cảnh báo `W_ALARM_COUNT_HIGH` (mức nghiệm thu là 200, trên đó chưa đo).
- Lớp `critical` mà `requiresAck` = false: cảnh báo `W_ALARM_NO_ACK_CRITICAL`; ngưỡng analog có deadband 0 và cả hai trễ 0: cảnh báo `W_ALARM_CHATTER_RISK`.
- Xóa Tag đang có alarm: lỗi tham chiếu; xóa lớp, khu vực đang dùng: hỏi xác nhận kèm danh sách.
- Project 0.5 tới runtime < 0.8.0: từ chối cả gói; project 0.6 trở lên: runtime 0.8 từ chối, Studio 0.7 từ chối mở (như 006 FR-005).
- Alarm dùng Tag tính toán (006): hợp lệ; mọi điều kiện phức hơn (nhiều Tag, biểu thức) làm bằng Tag tính toán rồi đặt alarm số trên nó; alarm không có biểu thức riêng (D6).

**Đánh giá và trạng thái**

- Giá trị NaN hoặc vô cực của Tag FLOAT: coi như quality BAD cho alarm `limit` (giữ nguyên trạng thái).
- Ngưỡng bị vượt ngay lúc khởi động (Tag chưa từng có giá trị thấp): bật sau trễ như thường; lần xảy ra đầu tiên mang cờ `startup` = true để lọc dễ.
- Tag nhảy qua cả H và HH trong một tick: cả hai instance bật (mỗi instance độc lập, D7); bảng xếp HH trước.
- Hạ từ HH xuống dưới H một lần: cả hai hết; hạ từ HH xuống giữa H và HH: HH hết, H giữ.
- Xác nhận alarm đã hết hoặc đã xác nhận: không lỗi (idempotent), trả `ALREADY_ACKED`/`NOT_ACTIVE`; xác nhận kèm mã lần xảy ra cũ (alarm đã hết rồi bật lại): `STALE`, không xác nhận lần mới.
- Điều kiện hết đúng lúc người dùng bấm xác nhận: kết quả theo thứ tự động cơ xử lý (một luồng); không có đường đua dữ liệu; cả hai kết quả đều hợp lệ trạng thái.
- Alarm `ACTIVE_UNACK` bị shelve: vào `shelved`; `ack` bị từ chối `SHELVED`; unshelve khi còn đúng điều kiện: lại `ACTIVE_UNACK` (D11).
- Shelve vượt tối đa 8 giờ hoặc không có lý do: từ chối `SHELVE_RANGE`; shelve alarm không tồn tại: `ALARM_NOT_FOUND`.
- Alarm bị tự cách ly do chập chờn rồi người dùng unshelve sớm: hợp lệ, đếm chập chờn bắt đầu lại.
- Vô hiệu (disable) alarm đang `ACTIVE_UNACK`: lần xảy ra đóng, dòng audit `alarm.disable`; không cần xác nhận.
- Thay project khi alarm đang bật: xem US3 kịch bản 12; thay project mà alarm giữ id nhưng đổi loại hoặc Tag: coi như alarm mới, đóng lần cũ.
- Tag của thiết bị bị loại khỏi project: alarm `device` đánh giá lại với tập Tag mới; thiết bị không còn Tag: alarm không bao giờ bật, cảnh báo.
- Hai alarm cùng ngưỡng lớp khác nhau: hợp lệ, độc lập.
- Đồng hồ nhảy lùi, đồng bộ NTP giữa chừng: thời điểm là **mã tăng dần** + giờ treo tường; trễ và thời hạn đo bằng đồng hồ đơn điệu; hiển thị cảnh báo khi giờ nhảy trong lúc có lần xảy ra mở.

**Lưu trữ**

- `alarm.db` bị khóa hoặc ghi lỗi tạm: bộ đệm tối đa 5.000 thay đổi; quá thì bỏ thay đổi **lịch sử** cũ nhất (đếm `droppedChanges` ở `system/info`); trạng thái trong RAM và việc hiển thị không bị ảnh hưởng.
- Quá thời hạn lưu (mặc định 180 ngày) hoặc quá trần (mặc định 64 MiB): xóa lần xảy ra **đã đóng** cũ nhất theo mẻ; không bao giờ xóa lần đang mở; ghi `alarm.purged` (như `audit.db`).
- Lịch sử tới 100.000 dòng với chỉ mục: truy vấn trong ngân sách (SC-013); truy vấn lớn không chặn vòng tick (một kết nối chỉ đọc riêng, như `HistoryReader`).
- Dung lượng `alarm.db` tăng mỗi lần ghi quá lớn do trang SQLite: dùng trang 4 KiB mặc định, đo lại (ADR-028); không dùng `VACUUM` tự động.

**Giao thức và web**

- Client nhận `alarmDelta` với `sequence` đứt: gửi `resync_required` như tag; client xin lại snapshot.
- Hàng đợi gửi đầy vì client chậm: dồn thay đổi alarm theo instance (giữ bản mới nhất); vẫn đầy thì cơ chế 4409 hiện có.
- Client mới đăng ký `subscribeAlarms` lần thứ hai trên cùng phiên: thay bản đăng ký, nhận snapshot mới.
- Tab ẩn: trang vẫn nhận alarm; tiếng chỉ phát khi người dùng đã bật; tab ẩn không hiện nhấp nháy CSS (trình duyệt tự giảm), tiêu đề tab hiện `(2) Alarm` để người vận hành thấy (FR-066).
- Nội dung alarm do project cung cấp có HTML hay `<script>`: hiển thị nguyên văn như chữ; CSV chống công thức (US4 kịch bản 4).
- Trình duyệt chặn âm thanh: hiện chỉ báo, không lỗi console lặp.
- Nhiều phiên cùng một operator: cùng xác nhận được; lần đầu có hiệu lực, còn lại `ALREADY_ACKED`.
- Giờ hiển thị theo múi giờ của trình duyệt; CSV ghi ISO 8601 kèm độ lệch.

**Studio**

- Lưới có 200 dòng, dán 500 dòng: ảo hóa như ADR-016; vượt 500 instance: lỗi giới hạn, không dán hết.
- Thử alarm khi project có lỗi: chạy với các alarm hợp lệ và báo alarm bị bỏ qua.
- Studio 0.7 mở project 0.5 mà alarm tham chiếu Tag của thiết bị khác chưa nạp: lỗi tham chiếu như Tag thường.
- Sửa alarm khi Online: cảnh báo khác biệt với thiết bị, không tự đẩy.

## Requirements *(mandatory)*

### Functional Requirements

**Định nghĩa alarm và định dạng project 0.5.0**

- **FR-001**: Định dạng project 0.5.0 MUST thêm hai file tùy chọn: `alarms.json` (`schemaVersion`, `areas`, `alarms`) và `alarm-classes.json` (`schemaVersion`, `classes`), khai trong `project.json` theo cách `logging` đang khai. Mọi file của project MUST mang cùng `schemaVersion` ([ADR-004](../../docs/adr/004-schema-versioning.md)). Project 0.5.0 MUST cần runtime tối thiểu 0.8.0. Project không có hai file này vẫn hợp lệ ở 0.5.0. Định dạng 0.5.0 nối tiếp 0.4.0 của 3b (specs/008).
- **FR-002**: Mỗi định nghĩa alarm MUST có `id` (`^[A-Za-z][A-Za-z0-9_]{1,47}$`, duy nhất), `type` (`digital`, `limit`, `quality`), `class` (tham chiếu lớp; với `limit` thì mỗi ngưỡng có `class` riêng), `area` (tùy chọn, tham chiếu khu vực), `name` (1 đến 80 ký tự, hiển thị), `text` (nội dung, tùy chọn; FR-005), `enabled` (mặc định `true`).
- **FR-003**: Alarm `digital` MUST có `tag` (kiểu BOOL hoặc số nguyên) và `trigger` (`true` hoặc `false`; số nguyên khác 0 là `true`), cùng `onDelayMs`, `offDelayMs`.
- **FR-004**: Alarm `limit` MUST có `tag` (kiểu số), `limits` gồm một đến bốn ngưỡng `HH`, `H`, `L`, `LL` (mỗi ngưỡng có `value`, `class`, `text` tùy chọn), `deadband` (≥ 0, dùng chung), `onDelayMs`, `offDelayMs`. Các ngưỡng có mặt MUST thỏa `LL < L < H < HH`; `deadband` MUST nhỏ hơn khoảng cách tới ngưỡng kề trong cùng phía. Mỗi ngưỡng MUST là một instance độc lập (id `<id>.<ngưỡng>`).
- **FR-005**: Nội dung `text` MUST hỗ trợ thẻ chèn `{name}`, `{tag}`, `{value}`, `{value:N}` (N số lẻ, 0 đến 6), `{unit}`, `{limit}`, `{limitName}`, `{area}`, `{reason}`; thẻ lạ là lỗi kiểm tra; tối đa 200 ký tự sau khi chèn (cắt có dấu `…`). Không có `text` thì động cơ dùng nội dung mặc định theo loại và ngưỡng (D9). Giá trị chèn là giá trị **lúc bật** (D10).
- **FR-006**: Alarm `quality` MUST có đúng một trong `tag` hoặc `device` (tham chiếu thiết bị trường của 006), cùng `on` (`bad`: chỉ BAD; `notGood`: BAD hoặc UNCERTAIN; mặc định `bad`), `onDelayMs`, `offDelayMs`. Với `device`, điều kiện đúng khi **mọi** Tag đọc từ thiết bị đó thỏa `on` (có ít nhất một Tag).
- **FR-007**: Lớp alarm MUST có `id` (`^[a-z][a-z0-9_]{1,31}$`), `name` (1 đến 40), `priority` (`critical`, `major`, `minor`, `advisory`), `color` (một trong tám màu thiết kế: `red`, `orange`, `amber`, `blue`, `purple`, `teal`, `gray`, `green`), `blink` (bool), `requiresAck` (bool), `ackReturn` (bool, chỉ có nghĩa khi `requiresAck`), `sound` (`none`, `beep`, `double`, `siren`), `chatterLimit` (số lần bật trong 60 s trước khi tự cách ly; 0 là tắt; mặc định 5). Tối đa 16 lớp; MUST có ít nhất một lớp khi có alarm.
- **FR-008**: Khu vực MUST có `id` (`^[a-z0-9][a-z0-9-]{0,31}$`) và `name` (1 đến 40); tối đa 64; phẳng một cấp. Alarm không khu vực thuộc "Chung".
- **FR-009**: Giới hạn MUST được kiểm: ≤ 500 instance mỗi project (ngưỡng tính riêng), ≤ 16 lớp, ≤ 64 khu vực, `alarms.json` ≤ 512 KiB; vượt là lỗi giới hạn. Trên 200 instance là cảnh báo `W_ALARM_COUNT_HIGH`.
- **FR-010**: Trễ `onDelayMs`, `offDelayMs` MUST là số nguyên từ 0 đến 86.400.000 (ms); giao diện nhập bằng giây. Độ phân giải thực tế là chu kỳ tick của engine (≤ 250 ms).
- **FR-011**: Bộ kiểm tra hai bản (TS cho Studio, C++ cho runtime) MUST có luật 0.5.0 và cho cùng kết luận, cùng mã trên bộ vector chung (`tests/project-vectors/`, ca `v05-*`).
  - **Lỗi (`E_ALARM_*`):**
    - id trùng, sai dạng; loại lạ; Tag, thiết bị, lớp, khu vực không có; kiểu Tag không hợp với loại; `trigger`, `on` lạ;
    - ngưỡng không tăng dần, không có ngưỡng nào, deadband sai, trễ ngoài khoảng;
    - nội dung quá dài, thẻ lạ; trường lạ; quá giới hạn của FR-009; lớp trùng, trường lớp sai.
  - **Cảnh báo (`W_ALARM_*`):** `W_ALARM_COUNT_HIGH`, `W_ALARM_NO_ACK_CRITICAL`, `W_ALARM_CHATTER_RISK`, `W_ALARM_DEVICE_EMPTY` (thiết bị không có Tag).
- **FR-012**: Studio MUST nâng cấp project 0.4.x (định dạng của 3b, specs/008) lên 0.5.0 trong bộ nhớ: đổi `schemaVersion` mọi file và nâng `minRuntimeVersion` của `project.json` lên ít nhất 0.8.0 (runtime cũ hơn không đọc được `schemaVersion` 0.5), giữ nguyên mọi nội dung khác, không tạo file alarm rỗng; sao lưu file gốc ngay trước lần lưu đầu vào thư mục mới; cùng đầu vào cho cùng kết quả (cặp file mẫu); hộp thoại có Nâng cấp, Mở chỉ đọc, Hủy (như 006 FR-003, 007 FR-007). Project 0.1, 0.2 và 0.3 MUST được nâng qua các bước trung gian (0.1 → 0.2 → 0.3 → 0.4 → 0.5, trong đó 0.3 → 0.4 là của 3b) trong cùng một lần.
- **FR-013**: Nạp xuống MUST bị khóa khi còn lỗi `E_ALARM_*`; cảnh báo `W_ALARM_*` không chặn (Constitution VII 1.1.0 cho cấu hình của người dùng).
- **FR-014**: Runtime 0.8.x MUST nhận project 0.1.x đến 0.5.x; từ chối cả gói project có `schemaVersion` mới hơn 0.5 (tức 0.6 trở lên). Studio MUST chặn Nạp xuống project 0.5 có alarm lên BL335 chạy runtime < 0.8.0 (cột Tương thích runtime). Project 0.3 và 0.4 (của 3b) chạy trên runtime 0.8 y như trên runtime 0.6 và 0.7.

**Động cơ alarm (đánh giá, trễ, deadband, quality)**

- **FR-015**: Runtime MUST có mô-đun `core/alarm` (C++17) gồm động cơ thuần (không I/O, thời gian tiêm vào), bộ định dạng nội dung và lưu trữ `alarm_store`; `core/` MUST không chứa mã giao diện (Constitution II). Hàm `AlarmEngine::step(nowMonoMs, nowEpochMs, tags)` MUST chạy trên luồng tick **sau** `TagEngine::step` trong mỗi chu kỳ và chỉ đọc Tag mà alarm tham chiếu.
- **FR-016**: Mô-đun `packages/alarm-engine` (TS, `@mat/alarm-engine`) MUST cài cùng ngữ nghĩa cho mô phỏng trong Studio; hai bản MUST cho cùng chuỗi chuyển trạng thái trên bộ vector chung `tests/alarm-vectors/` (≥ 60 ca) (Constitution II, SC-004).
- **FR-017**: Điều kiện `limit` MUST dùng trễ (hysteresis): ngưỡng cao `H`, `HH` bật khi giá trị ≥ ngưỡng, hết khi giá trị < ngưỡng − deadband; ngưỡng thấp `L`, `LL` bật khi ≤ ngưỡng, hết khi > ngưỡng + deadband. Giá trị trong vùng deadband giữ nguyên điều kiện hiện có.
- **FR-018**: Trễ bật MUST đo từ lúc điều kiện **liên tục** đúng; điều kiện sai trước hạn đặt lại bộ đếm (không có lần xảy ra). Trễ tắt MUST đo từ lúc điều kiện liên tục sai; đúng lại trước hạn đặt lại và alarm giữ trạng thái. Trễ đo bằng đồng hồ đơn điệu.
- **FR-019**: Khi Tag có `quality` BAD hoặc giá trị không hữu hạn, các alarm `digital` và `limit` MUST giữ nguyên trạng thái và bộ đếm trễ, đặt cờ `inputBad`; khi quality trở lại, bộ đếm trễ MUST bắt đầu lại từ giá trị mới. Quality UNCERTAIN MUST được đánh giá như GOOD (D16). Tag chưa từng có giá trị (`known` = false) MUST được coi như `inputBad` với alarm `digital` và `limit`; với alarm `quality` MUST giữ nguyên (chưa bật) cho tới khi có giá trị đầu tiên, để khởi động không sinh alarm mất tín hiệu giả (D44).
- **FR-020**: Alarm `quality` MUST bật khi quality thỏa `on` quá trễ bật; `reason` của Tag (006) MUST được giữ vào lần xảy ra và vào thẻ `{reason}`.
- **FR-021**: Mỗi tick, động cơ MUST xử lý ≤ 500 instance trong ≤ 2 ms trên BL335 (ước tính; đo ở SC-011) và không cấp phát bộ nhớ trong đường nóng khi không có thay đổi.
- **FR-022**: Khi khởi động, động cơ MUST dựng lại lần xảy ra mở từ `alarm.db` rồi đánh giá lại (US3 kịch bản 8): điều kiện còn đúng thì giữ nguyên lần xảy ra (không chạy lại trễ bật, không sinh lần mới); điều kiện sai thì hết sau trễ tắt; chưa có giá trị tin cậy thì giữ nguyên.
- **FR-023**: Khi kích hoạt project mới, động cơ MUST so định nghĩa theo `id` instance và dấu vân tay điều kiện (loại, Tag hoặc thiết bị, ngưỡng, `trigger`, `on`): giống thì giữ lần xảy ra mở; khác hoặc bị xóa thì đóng lần xảy ra với dấu `config`; mới thì đánh giá từ đầu. Lớp, khu vực, nội dung đổi không đóng lần xảy ra, chỉ áp dụng cho trạng thái hiển thị tiếp theo; riêng lớp đổi từ `requiresAck` sang không: `ACTIVE_UNACK` thành `ACTIVE_ACK`, `RTN_UNACK` thành `NORMAL`.
- **FR-024**: Thời gian MUST gồm giờ treo tường (ms UTC), cờ `clockOk` (như `audit.db`), và mã lần xảy ra tăng dần bền. Thứ tự sự kiện MUST dựa trên mã và `sequence`, không dựa trên giờ treo tường.
- **FR-025**: Bộ định dạng nội dung MUST có hai bản (C++, TS) cùng vector (`tests/alarm-vectors/`, nhóm `text-*`); số lẻ theo `{value:N}` làm tròn nửa ra xa 0 như biểu thức (ADR-015); giá trị BOOL hiện `Bật`/`Tắt` hoặc theo bảng giá trị của Tag nếu có (006).
- **FR-026**: Động cơ MUST không gọi mạng, không ghi đĩa và không giữ khóa của `TagStore` lâu hơn một lần `snapshot`; ghi `alarm.db` do luồng riêng (FR-043); gửi live do `LiveHub` (FR-052).

**Trạng thái ISA-18.2, xác nhận, tạm ẩn, vô hiệu**

- **FR-027**: Mỗi instance MUST có đúng một trong các trạng thái `NORMAL`, `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK`, theo bảng chuyển trạng thái ở [data-model.md](data-model.md) §5 (D8):
  - `NORMAL` → `ACTIVE_UNACK` khi bật, nếu lớp `requiresAck`; không thì `ACTIVE_ACK` (thông tin, không cần xác nhận);
  - `ACTIVE_UNACK` → `ACTIVE_ACK` khi xác nhận; → `RTN_UNACK` khi hết, nếu lớp `requiresAck`; → `NORMAL` khi hết nếu lớp không `requiresAck`;
  - `ACTIVE_ACK` → `NORMAL` khi hết, trừ khi lớp `ackReturn`: → `RTN_UNACK`;
  - `RTN_UNACK` → `NORMAL` khi xác nhận; → `ACTIVE_UNACK` (lần xảy ra **mới**) khi điều kiện đúng lại.
- **FR-028**: Xác nhận MUST yêu cầu role `operator` trở lên; MUST có thể xác nhận một hay nhiều lần xảy ra bằng cặp (`id`, `occurrence`) và "tất cả" với `upToRevision` (số `revision` toàn cục của động cơ trong bản tin cuối mà trang đã vẽ; D42; US1 kịch bản 4). Kết quả theo từng mục: `ACKED`, `ALREADY_ACKED`, `NOT_ACTIVE`, `STALE`, `SHELVED`, `NOT_FOUND`.
- **FR-029**: Xác nhận MUST ghi audit `alarm.ack` (SQLite FULL) và **commit trước** khi áp dụng vào động cơ; audit không ghi được thì MUST trả 503 `AUDIT_UNAVAILABLE` và không đổi trạng thái (Constitution V). Xác nhận hàng loạt MUST ghi **một** dòng audit: `target` là chuỗi bộ lọc, `detail` có `count` và tối đa 10 id đầu (≤ 1 KiB).
- **FR-030**: Xác nhận MUST ghi người (`ack_user`) và thời điểm vào lần xảy ra trong `alarm.db`.
- **FR-031**: Tạm ẩn (shelve) MUST cần role `operator`, `reason` (1 đến 120 ký tự) và `durationS` (60 đến 28.800, tức 1 phút đến 8 giờ; mặc định giao diện 3.600). Instance đang shelved MUST tiếp tục được đánh giá và ghi lịch sử, nhưng không hiện ở banner, không tiếng, không tính vào số chưa xác nhận trên menu; hiện ở tab "Tạm ẩn". Hết hạn (đồng hồ đơn điệu) hoặc `unshelve` mà điều kiện còn đúng thì MUST thành `ACTIVE_UNACK`: alarm đã `ACTIVE_ACK` mà lớp `requiresAck` quay lại `ACTIVE_UNACK` cùng mã lần xảy ra (có tiếng, có banner); alarm bật trong lúc tạm ẩn là lần xảy ra mới. Shelve MUST ghi audit `alarm.shelve` và `alarm.unshelve` (kể cả tự hết hạn, do `system`).
- **FR-032**: Vô hiệu (disable) MUST cần role `engineer` trở lên, `reason` bắt buộc, chỉ qua phiên Bearer (không cookie, FR-091); instance disabled MUST không được đánh giá, lần xảy ra mở MUST đóng với dấu `disabled`; trạng thái disabled MUST bền qua khởi động lại và qua nạp project mới (khớp `id`) cho tới `enable`. Ghi audit `alarm.disable`, `alarm.enable`.
- **FR-033**: Tạm ẩn MUST bền qua khởi động lại (giữ thời gian còn lại theo giờ treo tường nếu `clockOk`, ngược lại hết hạn khi khởi động); vô hiệu MUST bền (bảng `alarm_override`). Khi khởi động, runtime MUST đối chiếu `alarm_override` với các dòng `alarm.shelve`, `alarm.unshelve`, `alarm.disable`, `alarm.enable` mới nhất của `audit.db` (FULL) và áp lại lệnh nào bị mất do cắt điện trước khi `alarm.db` kịp commit, để lệnh người dùng đã được audit không biến mất.
- **FR-034**: Động cơ MUST giới hạn tối đa 50 alarm shelved **do người vận hành** cùng lúc (tự cách ly do chập chờn không tính, D47) (người dùng nhận `SHELVE_RANGE` kèm lý do), để tránh dùng shelve che hỏng hệ thống alarm.
- **FR-035**: Động cơ MUST tự cách ly (shelve hệ thống 30 phút, lý do "chập chờn") instance có số lần bật trong 60 s ≥ `chatterLimit` của lớp (mặc định 5); lần bật thứ `chatterLimit` là dòng tổng kết (mang số lần bật gộp `repeat_count`), các lần bật sau trong đợt cách ly không có dòng riêng; hết hạn thì tự gỡ. Cơ chế này MUST có trong bộ vector.
- **FR-036**: Lần xảy ra MUST có các cờ: `startup` (bật ngay sau khởi động), `inputBad` lúc bật, `closedBy` (`return`, `config`, `disabled`, `restart-lost`, `chatter`): chỉ tập hợp này.

**Alarm log (`alarm.db`)**

- **FR-037**: Alarm log MUST nằm trong SQLite `<dataDir>/alarm.db` riêng, tách khỏi `history.db` và `audit.db` (D12), WAL, `synchronous=NORMAL` (không xin thêm ngoại lệ Constitution), `cache_size` ≤ 2 MiB, quyền `0600`.
- **FR-038**: Bảng `alarm_occurrence` MUST có một dòng cho mỗi lần xảy ra: mã (`id` tăng dần), `alarm_id`, `ts_active_ms`, `clock_ok`, `ts_ack_ms`, `ack_user`, `ts_return_ms`, `ts_return_ack_ms`, `return_ack_user`, `fingerprint` (dấu vân tay điều kiện, FR-023), `closed` (0 hoặc 1), `priority`, `class`, `area`, `text`, `value_active`, `quality_active`, `reason`, cờ (FR-036). Bảng `alarm_override` giữ shelve và disable. Bảng `alarm_meta` giữ phiên bản lược đồ ([data-model.md](data-model.md) §3). Bảng MUST có thêm `text_fold` (nội dung đã bỏ dấu và hạ chữ, ghi lúc chèn, để tìm chữ không phân biệt dấu) và `repeat_count` (số lần bật gộp của dòng tổng kết chập chờn, `closedBy` = `chatter`).
- **FR-039**: Ghi MUST gom và chạy ở luồng riêng: commit mỗi `alarmCommitMs` (mặc định 2.000 ms) hoặc đủ 200 thay đổi; khi tốc độ thay đổi cao (> 5 thay đổi/s kéo dài 10 s) cửa sổ commit MUST giãn dần tới `alarmCommitMaxMs` (mặc định 30.000 ms) rồi co lại khi tốc độ hạ (giữ ngân sách ghi khi bão, D14); MUST không bao giờ chặn luồng tick. Bộ đệm tối đa 5.000 thay đổi; quá thì xử lý như mục Edge Cases "Lưu trữ".
- **FR-040**: Thời hạn lưu MUST theo ngày (`alarmRetentionDays`, mặc định 180, 1 đến 3.650) và trần dung lượng (`alarmMaxBytes`, mặc định 64 MiB); xóa **chỉ** lần xảy ra đã đóng, theo mẻ ≤ 1.000 dòng, mỗi giờ một lượt (và khi vượt trần); thời hạn không xóa khi đồng hồ không hợp lệ; ghi audit `alarm.purged` kèm số dòng.
- **FR-041**: Khi mở `alarm.db` không qua `integrity_check` (chỉ kiểm lúc khởi động khi dấu "tắt không sạch" bật, hoặc khi SQLite báo lỗi hỏng), runtime MUST đổi tên thành `alarm.db.corrupt-<epoch>`, tạo mới, ghi audit và chạy tiếp (cùng cách của `history.db`, 003). Mất điện MUST không làm hỏng file (kiểm SC-008). Runtime MUST có lệnh `mat-runtime --alarm-db-check` (chỉ đọc, chạy bằng `runuser -u matscada --`, in `integrity_check` và số dòng) vì BL335 có thể không có công cụ `sqlite3` (D46).
- **FR-042**: Ngân sách ghi MUST được kiểm: tải chuẩn (200 alarm, 20 lần xảy ra mỗi giờ) ≤ 25 MB/ngày; tải bão (200 alarm chập chờn liên tục) ≤ 0,1 GB/ngày nhờ FR-035; đo byte ghi thực của tiến trình (`/proc/<pid>/io`) trên BL335 (SC-009).
- **FR-043**: Khi đĩa dưới `minFreeBytes` (như `history.db`), việc ghi lịch sử MUST tạm dừng, động cơ và hiển thị MUST tiếp tục; `system/info` MUST có `alarms.logState` (`running`, `paused`, `error`).
- **FR-044**: Truy vấn lịch sử MUST dùng kết nối SQLite chỉ đọc riêng, không chặn ghi và không chặn tick; có chỉ mục `(ts_active_ms)`, `(alarm_id, ts_active_ms)`, `(priority, ts_active_ms)`; lần xảy ra đang mở có chỉ mục riêng (một phần) để dựng lại nhanh. Hai chỉ mục phụ `(alarm_id, ts_active_ms)` và `(priority, ts_active_ms)` MAY bỏ nếu spike T006 cho thấy ngân sách ghi không đạt (khi đó lọc dùng quét theo `ts_active_ms`).

**Giao thức live 1.3.0 và API**

- **FR-045**: Giao thức live MUST lên 1.3.0 (MINOR, [ADR-006](../../docs/adr/006-live-protocol-v1.md)): thêm bản tin client `subscribeAlarms`, `unsubscribeAlarms`; bản tin server `alarmSnapshot`, `alarmDelta`; trường `features` trong `hello`. Không đổi bản tin hiện có. Client 1.2.0 MUST chạy y như cũ (SC-015).
- **FR-046**: Sau `subscribeAlarms`, máy chủ MUST gửi `alarmSnapshot` (mọi instance không ở `NORMAL`, đang shelved hoặc `disabled`, kèm `classes`, `areas`, `counts`, `sequence`; chia lô ≤ 100 hàng bằng `part`/`parts` khi nhiều hơn); từ đó mỗi lần có thay đổi MUST gửi `alarmDelta` (các instance đổi và các instance biến mất, `counts` mới, `sequence` + 1) trong ≤ 1 tick sau thay đổi.
- **FR-047**: Mỗi bản tin alarm MUST mang `revision` toàn cục của động cơ (tăng khi có thay đổi) và mỗi instance mang `rev` (revision lần đổi cuối); `sequence` của alarm trên live MUST đơn điệu theo từng phiên; đứt thì client xin lại snapshot bằng `subscribeAlarms`; máy chủ MAY gửi `resync_required` (có sẵn). Khi hàng đợi gửi của phiên gần đầy, `alarmDelta` MUST được dồn theo instance (bản mới nhất thắng), không bị bỏ.
- **FR-048**: Bản tin alarm MUST mang cùng quyền như dữ liệu Tag (ai đọc được live thì đọc được alarm); xác nhận **không** qua WebSocket, chỉ REST (như ghi Tag, 007 D4); bản tin `ack` trên live nhận `error` `BAD_MESSAGE` và ghi audit `alarm.ack` denied `LIVE_ACK_NOT_ALLOWED` (gộp 60 s).
- **FR-049**: Khi project không có alarm, `hello.features` MUST không có `alarms`; `subscribeAlarms` MUST nhận `alarmSnapshot` rỗng (không lỗi).
- **FR-050**: API thiết bị lên 1.3.0 (MINOR): `GET /api/v1/alarms` (danh sách hiện có + lớp + khu vực + đếm), `GET /api/v1/alarms/history`, `POST /api/v1/alarms/ack`, `POST /api/v1/alarms/shelve`, `POST /api/v1/alarms/unshelve`, `POST /api/v1/alarms/disable`, `POST /api/v1/alarms/enable`; `system/info` thêm khối `alarms`. Mã lỗi gồm `AUDIT_UNAVAILABLE` (503), `ALARM_LOG_UNAVAILABLE` (503), `BAD_QUERY` (400), `ALARM_NOT_FOUND` (404), `ALARM_DISABLED` (409), `SHELVE_RANGE` (422), `RATE_LIMITED` (429), `ALARM_TIMEOUT` (504, xác nhận chờ động cơ quá hạn). Chi tiết: [contracts/device-api-1.3.md](contracts/device-api-1.3.md).
- **FR-051**: Bảng quyền MUST khai: `GET alarms`, `GET alarms/history` cho viewer (theo luật nguồn của ADR-018, cookie được); `ack`, `shelve`, `unshelve` cần `operator`, cookie được, CSRF, `Origin`; `disable`, `enable` cần `engineer`, **không** cookie (`cookieAllowed` = false). Mọi endpoint mới MUST khai tường minh.
- **FR-052**: `LiveHub` MUST nhận sự kiện từ động cơ qua hàng đợi không khóa nhanh (một chiều: động cơ đẩy, hub rút); động cơ MUST không chờ hub; hub MUST không giữ khóa Tag khi gửi.
- **FR-053**: `GET /api/v1/alarms/history` MUST nhận `from`, `to` (ms UTC), `alarmId`, `area`, `class`, `priority`, `state` (`active`, `acked`, `closed`, `all`), `q` (chữ tìm), `limit` (≤ 500), `beforeId`; trả các lần xảy ra mới nhất trước với `nextBeforeId`; khoảng `to − from` ≤ 366 ngày; tham số sai trả 400 `BAD_QUERY`. Lần xảy ra có `clock_ok` = false (giờ chưa đồng bộ, gần 1970) MUST không lọt vào kết quả theo khoảng thời gian; chúng chỉ hiện khi tham số `unsynced=1` (bỏ qua `from`, `to`, sắp theo mã giảm dần; giao diện có ô "Gồm lần xảy ra khi giờ chưa đồng bộ"; D45). Khi đang có một truy vấn lịch sử từ cùng nguồn hoặc tải đang cao, máy chủ MUST trả 503 `ALARM_HISTORY_BUSY` kèm `Retry-After`.
- **FR-054**: Mọi tham số MUST đi vào SQLite bằng tham số ràng buộc; `q` MUST thoát ký tự `%`, `_`, `\`; độ dài `q` ≤ 80; `q` khớp trên nội dung, id alarm và tên khu vực (cột đã bỏ dấu `text_fold`).

**Web (apps/runtime-web)**

- **FR-055**: Trang runtime MUST có **banner alarm** ở đầu trang (mọi màn hình): hiện alarm chưa xác nhận ưu tiên cao nhất (kế đó mới nhất), nội dung, tổng chưa xác nhận và số theo mức; màu và nhấp nháy theo lớp; bấm banner mở trang Alarm; có nút Xác nhận cho alarm đang hiện (operator). Không có alarm chưa xác nhận thì banner ẩn (US1).
- **FR-056**: Trang runtime MUST có trang **Alarm** (`#/alarms`): bảng alarm đang có (trạng thái khác `NORMAL`, kể cả `RTN_UNACK`), tab "Đang có", "Tạm ẩn"; cột: thời gian bật, ưu tiên, khu vực, nội dung, giá trị lúc bật, trạng thái, người xác nhận; **lọc** theo khu vực, lớp, mức ưu tiên, trạng thái, chữ tìm; **sắp xếp** theo mọi cột (mặc định: ưu tiên rồi thời gian giảm dần); chọn nhiều hàng; **Xác nhận** hàng chọn; **Xác nhận tất cả** (theo bộ lọc đang hiện, FR-028); Tạm ẩn (hộp có lý do và thời lượng).
- **FR-057**: Menu điều hướng MUST có mục "Alarm" (kèm "Lịch sử alarm") khi project có alarm: số chưa xác nhận hiện thành huy hiệu, màu theo mức ưu tiên cao nhất chưa xác nhận, `aria-label` đọc được ("3 alarm chưa xác nhận"); tab trình duyệt MUST có tiền tố số đếm `(3)` khi có chưa xác nhận.
- **FR-058**: Trạng thái alarm MUST luôn có chữ và biểu tượng cùng màu; mức ưu tiên có hình riêng; tương phản chữ ≥ 4,5:1 ở cả hai theme; nhấp nháy MUST tôn trọng `prefers-reduced-motion` (đổi sang viền đậm tĩnh) và tối đa 1 Hz (không nhấp nháy nhanh hơn 3 lần/giây, tránh kích động co giật).
- **FR-059**: Âm thanh MUST do trang tạo bằng Web Audio (không tải file, không tài nguyên ngoài), theo `sound` của lớp: phát lặp khi có alarm `ACTIVE_UNACK` của lớp đó, ngừng khi mọi alarm của lớp đã xác nhận hoặc người dùng bấm "Tắt tiếng" (chỉ tắt tiếng, không xác nhận, tới khi có alarm mới). Mặc định tắt; chỉ báo bật nằm ở thanh trên; lựa chọn lưu `localStorage` bọc `try/catch`.
- **FR-060**: Trang Lịch sử (`#/alarm-history`) MUST có: chọn khoảng thời gian (mặc định 24 giờ; có nhanh "1 giờ, 8 giờ, 24 giờ, 7 ngày, 30 ngày" và tùy chọn), bộ lọc như FR-053, sắp xếp cột trên trang đã tải, phân trang bằng `beforeId`, chế độ "Theo dõi", **Xuất CSV** (FR-061).
- **FR-061**: CSV MUST do trình duyệt sinh (không tốn CPU BL335): lấy từng trang 500 dòng theo bộ lọc tới tối đa 100.000 dòng, UTF-8 có BOM, RFC 4180, tiêu đề tiếng Việt, thời gian ISO 8601 có độ lệch, ô **chuỗi** bắt đầu bằng `=`, `+`, `-`, `@`, tab, CR được thêm `'` ở đầu (ô số hữu hạn, như giá trị âm, giữ nguyên là số); vượt 100.000 dòng thì báo và cắt.
- **FR-062**: Nội dung alarm, tên, khu vực, lớp do project cung cấp MUST chỉ vào DOM bằng `textContent` hoặc thuộc tính an toàn; lint cấm `innerHTML` đã có từ 007 (T008) áp cho mã mới.
- **FR-063**: Trang MUST đăng ký `subscribeAlarms` ngay khi có phiên live và khi kết nối lại; mất kết nối thì bảng mờ và banner báo (US1 kịch bản 10); thiết bị giao thức 1.2.0 (không có `features.alarms`) thì hiện "chưa hỗ trợ (runtime < 0.8.0)", còn thiết bị 1.3.0 mà project không có alarm thì không hiện banner và menu (phân biệt bằng `protocolVersion` của `hello`).
- **FR-064**: Nút Xác nhận và Tạm ẩn MUST khóa kèm lý do khi viewer, khách, qua HTTP, mất kết nối, hoặc `writeBlocked` của phiên (cùng cơ chế `ActionHost` của 007); trạng thái "đang gửi" và kết quả theo mục (FR-028) MUST hiện; lỗi 401/403 MUST dẫn tới hộp đăng nhập của 007 mà không mất bộ lọc.
- **FR-065**: Trang MUST hiện lỗi thiết bị rõ ràng: `AUDIT_UNAVAILABLE`, `STALE`, `SHELVE_RANGE`, 429; thông báo bằng tiếng Việt từ bảng chuỗi.
- **FR-066**: Bảng alarm MUST cập nhật bằng so khớp theo `id` instance (không dựng lại toàn bảng), tối đa một lần dựng mỗi khung hình; 200 hàng cập nhật liên tục không làm khung hình quá 16,7 ms trung bình trên Chrome máy phát triển.
- **FR-067**: Mọi chuỗi giao diện mới MUST nằm trong bảng chuỗi tiếng Việt (`i18n/vi.ts` của Studio; `apps/runtime-web/src/i18n/vi.ts` của trang), không chuỗi cứng trong mã (lint, SC-024).

**Widget alarm (`@mat/ui-components`)**

- **FR-068**: Danh mục widget `schemas/widgets.catalog.json` MUST lên 0.4.0 và thêm nhóm "Alarm" với `alarm-list` và `alarm-count`. `alarm-list`: thuộc tính `areas`, `classes`, `minPriority`, `states`, `columns`, `maxRows`, `showAck` (bool); không có khe Tag. `alarm-count`: thuộc tính `areas`, `minPriority`, `mode` (`unacked`, `active`), `target` (thuộc tính đối tượng: màn hình hoặc trang Alarm, không phải sự kiện); không có khe Tag. Hai validator MUST cho cùng kết luận trên vector (`tests/widget-catalog-vectors/`).
- **FR-069**: Widget MUST không gọi mạng ([ADR-019](../../docs/adr/019-widget-library.md)): nhận `AlarmSource` (mới: `snapshot()`, `subscribe(onChange)`, `counts()`, `classes()`, `areas()`, `now()`, `status()`) và `ActionHost` mở rộng (`ackAlarms`, `shelveAlarm`, `unshelveAlarm`) từ nơi chứa. Trang runtime cấp bản dựa trên live 1.3.0; xem trước Studio cấp bản dựa trên `@mat/alarm-engine`.
- **FR-070**: `alarm-list` MUST dùng chung thành phần bảng với trang Alarm (FR-056) để một cách hiển thị; `alarm-count` MUST cập nhật ≤ 1 s sau thay đổi.
- **FR-071**: Màn hình có widget alarm mà project 0.5.0 không có alarm nào: hợp lệ, widget hiện "Không có alarm cấu hình".
- **FR-072**: Widget alarm MUST tôn trọng FR-058, FR-059 (âm thanh chỉ do trang lo, không phải widget), FR-062.

**Studio**

- **FR-073**: Mục **Alarm** của cây project MUST mở khóa, gồm **Danh sách alarm** và **Lớp alarm** (và **Khu vực** trong trang Danh sách alarm dạng bảng phụ bên phải); `tree.ts`, `vi.ts` MUST bỏ trạng thái `phase: 'p4'`.
- **FR-074**: Editor **Danh sách alarm** MUST là lưới ảo hóa theo ADR-016 và [studio-ux.md](../../docs/architecture/studio-ux.md) §5: cột id, tên, loại, Tag hoặc thiết bị, điều kiện (`trigger` của alarm số, `on` của alarm quality), ngưỡng (HH, H, L, LL), deadband, trễ bật, trễ tắt, lớp, khu vực, nội dung, bật/tắt; sửa tại ô; lỗi theo ô; điền xuống (Ctrl+D), dán từ Excel, nhập và xuất CSV; lọc, tìm, chọn cột; ≥ 2.000 dòng mượt (giới hạn 500 instance chỉ là giới hạn nội dung, không phải giới hạn lưới). Lớp và nội dung riêng từng ngưỡng sửa qua cửa sổ nhỏ của ô ngưỡng (cột Lớp, Nội dung của dòng là mặc định). Khi Online thêm cột trạng thái sống.
- **FR-075**: Lệnh "Tạo alarm cho Tag…" (menu chuột phải ở cây, ở Bảng Tag, ở bảng alarm) MUST mở hộp thoại tạo nhanh: loại (số, ngưỡng, quality), ngưỡng, deadband, trễ, lớp gợi ý, khu vực; tạo trong một bước hoàn tác; gợi ý ngưỡng theo `min`/`max` của Tag nếu có (LL, L, H, HH ở 10/20/80/90 % của khoảng đó), nhưng người dùng quyết định; lớp và nội dung riêng từng ngưỡng sửa qua cửa sổ nhỏ của ô ngưỡng.
- **FR-076**: Editor **Lớp alarm** MUST sửa các trường FR-007 trong lưới và có panel xem trước (màu, nhấp nháy, biểu tượng, tiếng thử bằng Web Audio); mỗi project mới có bốn lớp mặc định `critical`, `major`, `minor`, `advisory`.
- **FR-077**: Khu vực MUST thêm, đổi tên, xóa (có liệt kê nơi dùng và hỏi xác nhận) và dùng làm bộ lọc.
- **FR-078**: Kiểm tra MUST chạy liên tục trong worker; lỗi theo ô, chi tiết ở tab Thông tin, nhảy tới; lưu được khi còn lỗi; Nạp xuống bị khóa (FR-013).
- **FR-079**: Nội dung MUST có ô nhập có **Xem trước nội dung** (FR-005) và gợi ý thẻ khi gõ `{`.
- **FR-080**: **Thử alarm** MUST có panel chạy `@mat/alarm-engine` với SimEngine (006): bảng alarm đang có như trang Alarm; điều khiển tốc độ (1×, 5×, 20×, dùng đồng hồ ảo cho trễ); đẩy giá trị Tag nhập tay; xác nhận và tạm ẩn thử; bật/tắt từng alarm; hiện nhật ký chuyển trạng thái (thời điểm ảo, lý do). Kết quả MUST khớp động cơ C++ trên bộ vector chung (SC-017).
- **FR-081**: Xem trước màn hình ở chế độ Mô phỏng MUST cấp `AlarmSource` cho widget alarm (FR-069); chế độ Thiết bị cấp từ live của thiết bị Online (chỉ đọc, ghi trong Studio chỉ qua Bảng theo dõi như 006).
- **FR-082**: Đổi tên Tag MUST cập nhật `tag` của alarm; xóa Tag đang có alarm MUST liệt kê và hỏi; "Dùng ở đâu" của Tag MUST liệt kê alarm.
- **FR-083**: Tab So sánh MUST so alarm và lớp theo đối tượng (id), không theo dòng JSON ([studio-ux.md](../../docs/architecture/studio-ux.md) §6).
- **FR-084**: Định dạng ghi `alarms.json`, `alarm-classes.json` MUST ổn định (thứ tự khóa chuẩn, không ghi trường bằng mặc định, mỗi alarm một khối gọn) để diff và So sánh.
- **FR-085**: Studio MUST có thư viện nâng cấp 0.4 → 0.5 (FR-012) và hiển thị mục Alarm với số lỗi trên nhãn cây.
- **FR-086**: Editor MUST theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5, §7 (token màu, theme sáng tối, ARIA, phím tắt, bảng lệnh) và mockup `studio-alarms.html`; mockup phải xong và được duyệt (ghi ngày) trước khi viết giao diện (task chặn).
- **FR-087**: Mọi chức năng Online hiện có của 005 đến 007 MUST không hồi quy; Studio 0.7.0.

**Bảo mật, audit, tương thích, ngân sách, chất lượng**

- **FR-088**: Mọi hành động đổi trạng thái alarm của người dùng (xác nhận, tạm ẩn, gỡ tạm ẩn, vô hiệu, bật lại) MUST kiểm role ở backend và ghi audit **trước** khi áp dụng; audit gồm người, role, kênh (`web`, `https`), alarm, mã lần xảy ra, kết quả. `alarm.ack` của người dùng bị từ chối MUST đi qua cơ chế gộp 60 s (tối đa 10 dòng/phút, như `access.denied`).
- **FR-089**: Danh sách hành động audit MUST thêm `alarm.ack`, `alarm.shelve`, `alarm.unshelve`, `alarm.disable`, `alarm.enable`, `alarm.purged` (đổi `kAuditActions` từ 27 lên 33; không cần migration lược đồ vì cột `action` không có ràng buộc); `audit.db` giữ nguyên lược đồ.
- **FR-090**: Ghi audit của alarm MUST giữ trong ngân sách của `audit.db` (64 MiB, 365 ngày): xác nhận hàng loạt là một dòng; tự cách ly và tự hết hạn là dòng của `system`, bị gộp khi vượt 10 dòng/phút.
- **FR-091**: Cookie MUST không vào API kỹ thuật: `disable`, `enable` có `cookieAllowed` = false; `ack`, `shelve`, `unshelve` cho cookie kèm CSRF và `Origin` như `tags/write` (007 FR-040 đến FR-043).
- **FR-092**: `system/info` MUST có khối `alarms` (số instance, số đang có, số chưa xác nhận, số shelved, `logState`, `droppedChanges`, kích thước `alarm.db`, thời gian đánh giá tick lớn nhất 1 phút); `/api/v1/diagnostics` giữ nguyên.
- **FR-093**: Ngân sách MUST được đo trên BL335 (task ⚠️🔌): CPU ≤ 30 %, RSS ≤ 150 MB với 200 alarm, 500 Tag, 10 client (SC-011); phần alarm thêm ≤ 3 điểm % CPU và ≤ 4 MB RSS.
- **FR-094**: Test viết trước (Constitution VI): vector chung C++ ↔ TS (`tests/alarm-vectors/`, ≥ 60 ca; `tests/project-vectors/` ca `v05-*` ≥ 60; `tests/widget-catalog-vectors/` thêm hai widget); cặp file nâng cấp 0.4 → 0.5; bảng trạng thái ISA (mọi cặp trạng thái × sự kiện); test lưu trữ (WAL, dựng lại, thời hạn, trần, hỏng, đĩa đầy); test live (snapshot, delta, dồn, tương thích 1.2.0); test API (quyền, audit trước, STALE, idempotent).
- **FR-095**: Test tích hợp x64 MUST có `tools/alarm-it.ps1`: độ trễ end-to-end, quality, bão alarm, `kill -9` 100 lần, khởi động lại giữa trạng thái, 10 client, tấn công; kết quả `docs/reports/009-<kịch bản>-x64.json`.
- **FR-096**: e2e Chrome headless (axe-core) MUST có: banner, trang Alarm, menu, lịch sử, CSV, widget; e2e Studio: dựng 200 alarm, Thử alarm, nâng cấp, So sánh.
- **FR-097**: Rà soát bảo mật trước khi đóng feature: quyền và audit của alarm, CSRF, XSS qua nội dung, công thức CSV, truy vấn lịch sử (SQL injection, tải), tràn bộ đệm bản tin, lộ thông tin ở `system/info`.
- **FR-098**: Không thêm thư viện ngoài nào (runtime hay Studio); nếu bắt buộc: bản phát hành ≥ 2 tuần, rà license, ghi `third_party/LICENSES.md`.
- **FR-099**: Tài liệu MUST có: ADR 027 đến 030, README của `packages/alarm-engine`, mục Alarm trong `apps/studio/README.md` và `docs/deployment/mat-runtime.md` (cấu hình `alarmRetentionDays`, `alarmMaxBytes`, `alarmCommitMs`, `alarmCommitMaxMs`), hướng dẫn vận hành alarm (xác nhận, tạm ẩn), báo cáo `docs/reports/009-acceptance.md`.
- **FR-100**: Phiên bản: runtime 0.8.0, Studio 0.7.0, định dạng project 0.5.0, API thiết bị 1.3.0, giao thức live 1.3.0, `@mat/ui-components` 0.3.0, `@mat/alarm-engine` 0.1.0, danh mục widget 0.4.0, gói `.matscada` 1.0.0 (không đổi).

### Key Entities

- **Alarm (định nghĩa)**: id, tên, loại, Tag hoặc thiết bị, điều kiện (trigger, ngưỡng, deadband), trễ bật/tắt, lớp (theo ngưỡng), khu vực, nội dung, bật/tắt.
- **Instance**: đơn vị đánh giá; id; trạng thái ISA; cờ `shelved`, `disabled`, `inputBad`; bộ đếm trễ (trong RAM).
- **Lần xảy ra (occurrence)**: mã, instance, thời điểm bật, xác nhận (người, giờ), hết, xác nhận hết, giá trị lúc bật, quality lúc bật, nội dung đã chèn, lớp, khu vực, cờ, `closedBy`.
- **Lớp alarm**: id, tên, ưu tiên, màu, nhấp nháy, cần xác nhận, cần xác nhận khi hết, âm thanh, ngưỡng chập chờn.
- **Khu vực**: id, tên.
- **Shelve / Override**: instance, loại (`shelve`, `disable`), người, lý do, bắt đầu, hết hạn.
- **Bản tin alarm (live)**: `alarmSnapshot`, `alarmDelta`, `counts`, `sequence`.
- **Truy vấn lịch sử**: khoảng, bộ lọc, trang.
- **Định dạng project 0.5.0**: bản sau 0.4.0 của 3b; thêm `alarms.json`, `alarm-classes.json`, `navigation.alarms`; nâng `minRuntimeVersion` ≥ 0.8.0; nâng cấp 0.4 → 0.5 chỉ đổi `schemaVersion` và `minRuntimeVersion`.
- **Dòng audit alarm**: hành động, người, role, kênh, đích, kết quả, chi tiết.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Nghiệm thu của lộ trình (§4.5)**

- **SC-001**: Một kỹ sư dựng 200 alarm (gồm ba loại, ≥ 4 lớp, ≥ 5 khu vực) từ project có sẵn Tag hoàn toàn trong Studio (dán CSV, "Tạo alarm cho Tag…", kéo điền), 0 dòng JSON viết tay; Kiểm tra không lỗi; Nạp xuống BL335; mở Chrome: 100 % alarm đúng trạng thái; Đọc lên rồi So sánh cho "giống".
- **SC-002**: Với 200 alarm chạy trên BL335 và Tag mô phỏng tất định, 100 % chuỗi chuyển trạng thái khớp kỳ vọng của bộ vector (200 alarm, ba loại, các kịch bản ngưỡng, trễ, quality, xác nhận).
- **SC-003**: Alarm hiện trên Chrome ≤ 1 s kể từ lúc điều kiện đúng cộng trễ cấu hình (p95 ≤ 1.000 ms, p99 ≤ 1.250 ms trên 100 lần; đo từ lúc Tag đổi tới lúc DOM đổi): x64 (đo) và BL335 ⚠️🔌.
- **SC-004**: Hai bản động cơ (C++ và TS) cho cùng chuỗi chuyển trạng thái, cùng thời điểm ảo và cùng nội dung chèn, trên 100 % của ≥ 60 ca vector chung.
- **SC-005**: 100 % cặp (trạng thái × sự kiện) của bảng ISA có test; trạng thái ngoài bảng không thể tới.
- **SC-006**: Operator xác nhận: ≥ 99 % lệnh làm mọi client thấy trạng thái mới ≤ 500 ms (LAN); 100 % lệnh có audit đủ trường, commit trước khi trạng thái đổi; 0 xác nhận nào khi audit lỗi; 0 xác nhận hai lần cho một lần xảy ra.
- **SC-007**: Bộ ca tấn công (US6 kịch bản 1): 100 % bị từ chối, 0 thay đổi trạng thái, 100 % có audit hoặc được đếm theo quy tắc gộp.
- **SC-008**: Mất điện: 100 lần `kill -9` (x64, đang ghi, đang xác nhận) và ≥ 10 lần cắt điện thật trên BL335 ⚠️🔌 (người ở cạnh): 100 % `PRAGMA integrity_check` = `ok`; 0 trường hợp `ACTIVE_ACK` mà `audit.db` không có xác nhận tương ứng; mọi alarm còn đúng điều kiện hiện lại ≤ 5 s sau khi runtime khởi động xong.
- **SC-009**: Ghi eMMC của alarm (byte thật từ `/proc/<pid>/io` trừ phần Tag và audit): tải chuẩn ≤ 25 MB/ngày; tải bão ≤ 0,1 GB/ngày; tổng ghi của runtime vẫn ≤ 2 GB/ngày (Constitution III); vì `/proc/<pid>/io` không tách theo file, phần của alarm đo bằng hiệu hai lần chạy cùng tải (có và không alarm).
- **SC-010**: Thời hạn lưu: lần xảy ra đã đóng quá hạn bị xóa trong ≤ 1 giờ 100 % (đồng hồ hợp lệ); trần dung lượng giữ file ≤ trần + 5 %; không bao giờ xóa lần xảy ra đang mở; dọn không làm khung live giãn quá 250 ms.
- **SC-011**: BL335 với 200 alarm, 500 Tag mô phỏng/1 s, 10 client xem trang Alarm, 30 phút: CPU trung bình ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence; phần alarm thêm ≤ 3 điểm % CPU và ≤ 4 MB RSS ⚠️🔌 (x64 đo tham khảo).

**Web và widget**

- **SC-012**: e2e Chrome headless + axe-core cho banner, trang Alarm, menu, lịch sử, widget: 0 vi phạm axe mức serious/critical ở hai theme; mọi trạng thái có chữ và biểu tượng; giảm chuyển động chạy đúng; tương phản chữ ≥ 4,5:1.
- **SC-013**: Lịch sử: truy vấn 100.000 lần xảy ra có bộ lọc khoảng + khu vực + ưu tiên ≤ 1 s (x64), ≤ 2 s (BL335 ⚠️🔌); tìm chữ không phân biệt dấu đúng 100 % ca mẫu; xuất CSV 50.000 dòng ≤ 10 s trên Chrome và mở bằng Excel đúng tiếng Việt (kiểm tay, ghi rõ nếu chưa làm).
- **SC-014**: Dashboard 20 widget của 007 cộng `alarm-list` và `alarm-count` mở ≤ 2 s (007 SC-002); `alarm-count` cập nhật ≤ 1 s; hai widget có trong vector danh mục, hai validator đồng ý 100 %.
- **SC-015**: Tương thích: client 1.2.0 với thiết bị 1.3.0 chạy y như cũ (0 bản tin alarm gửi tới, 0 lỗi); client 1.3.0 với thiết bị 1.2.0 hiện "chưa hỗ trợ"; project 0.3 và 0.4 (của 3b) chạy trên runtime 0.8 cho cùng kết quả như runtime 0.6 và 0.7; migration 0.4 → 0.5 chỉ đổi `schemaVersion` và `minRuntimeVersion` (so byte sau khi chuẩn hóa).

**Studio**

- **SC-016**: Bảng 200 dòng mở ≤ 1 s, sửa ô tới lúc hiện lỗi/hết lỗi ≤ 500 ms; 2.000 dòng cuộn mượt (trung bình khung ≤ 16,7 ms); đối chiếu quy tắc studio-ux §5 và §7 ghi ở `docs/reports/009-sc016.md`; axe 0 vi phạm.
- **SC-017**: "Thử alarm" cho cùng thời điểm bật, tắt, trạng thái và nội dung như động cơ C++ trên 100 % của bộ vector (cùng đồng hồ ảo).
- **SC-018**: Bão alarm: 200 alarm bật trong một tick, 10 client: 0 phiên bị 4409, mọi client nhận đủ trạng thái ≤ 1 s, hàng đợi gửi cao nhất ≤ 50 % của 256 KB; client chậm không làm chậm tick (độ trễ tick tối đa không tăng quá 5 ms).
- **SC-019**: Chập chờn: alarm dao động 20 lần/phút bị tự cách ly đúng ở lần bật thứ `chatterLimit`; DB nhận đúng `chatterLimit` dòng mỗi chu kỳ 30 phút (dòng cuối là dòng tổng kết); số lần gộp (`repeat_count`) đúng.
- **SC-020**: Bảo mật nội dung: 0 thực thi script từ nội dung alarm (bộ mẫu XSS ≥ 20 chuỗi, vào DOM bằng `textContent`); 100 % ô CSV nguy hiểm bị vô hiệu hóa (bộ mẫu ≥ 30 chuỗi); 0 lần dùng `innerHTML` trong mã mới (lint).
- **SC-021**: Shelve: alarm shelved không có banner, tiếng, huy hiệu; hết hạn đúng ± 1 s (đồng hồ đơn điệu); bền qua khởi động lại; 50 shelve cùng lúc là giới hạn; 100 % ca có audit.
- **SC-022**: Phủ test: mọi FR có ít nhất một test hoặc bước kiểm tay (`docs/reports/009-fr-matrix.md`, kiểm bằng `/speckit-analyze`); mọi task test chạy đỏ trước khi cài (ghi trong tasks).
- **SC-023**: Khả dụng: một kỹ sư chưa dùng editor mới làm trọn kịch bản (tạo lớp, tạo alarm cho Tag, thử bằng mô phỏng, nạp xuống) ≤ 10 phút không cần tài liệu; không có người thì ghi "tự đo" kèm các chỗ vấp (như 004, 007).
- **SC-024**: 100 % chuỗi giao diện mới nằm trong bảng i18n tiếng Việt; lint không báo chuỗi cứng; ví dụ nội dung mặc định đọc tự nhiên (rà soát tay).

## Assumptions

### Quyết định đã chốt trước khi viết spec

Lấy từ lộ trình v2 (duyệt 2026-10-11), Constitution 2.0.1 và các feature 003 đến 007.

- **D1. GĐ 4 là một feature** (`009-alarms`; 008 là GĐ 3b). Lý do: động cơ, lưu trữ, giao thức, trang web, widget và editor gắn chặt; tách ra thì feature nào cũng phải đổi định dạng và giao thức.
- **D2. Trạng thái theo ISA-18.2**, xác nhận cần role `operator` và ghi audit (SQLite FULL, có sẵn từ 005): theo lộ trình §4.5.
- **D3. Alarm log ở SQLite có thời hạn lưu**, ngân sách ghi eMMC theo Constitution III, chịu mất điện.
- **D4. Giao thức live 1.3.0 tương thích ngược** (lộ trình §4.5; 006 đã dành số 1.3.0 cho alarm).
- **D5. Ngoài phạm vi**: thông báo ngoài (email, Telegram, Zalo), recipe, logic v2 (lộ trình §4.7).

### Quyết định khi viết spec

Các điểm dưới đây chưa được chốt trước; spec chọn phương án hợp lý nhất. Mỗi điểm là **Quyết định (người dùng giao toàn quyền 2026-10-11)**.

- **D6. Ba loại alarm, không có biểu thức riêng.** `digital`, `limit`, `quality` đúng như lộ trình. Điều kiện phức hơn (nhiều Tag, so sánh) làm bằng Tag tính toán của 006 rồi đặt alarm số trên đó. Lý do: tái dùng ngôn ngữ biểu thức đã có (ADR-015) thay vì thêm một cách đánh giá thứ hai; giữ động cơ alarm nhỏ, kiểm bằng vector được.
- **D7. Mỗi ngưỡng là một instance độc lập** (`TANK_LEVEL.H`, `.HH`), thay vì một instance có "mức" thay đổi. Lý do: máy trạng thái ISA áp dụng đồng nhất cho mọi instance; mỗi ngưỡng có lớp, xác nhận, lịch sử riêng; test đơn giản. Chi phí: HH và H cùng hiện khi vượt cả hai (bảng xếp theo ưu tiên nên HH ở trên). Đếm giới hạn 500 và mức nghiệm thu 200 tính theo instance.
- **D8. Bốn trạng thái ISA** (`NORMAL`, `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK`) cộng hai cờ `shelved`, `disabled`. Lớp có hai núm: `requiresAck` (alarm thông tin không cần xác nhận khi `false`) và `ackReturn` (xác nhận khi hết, mặc định `false`). Lý do: đúng khung ISA-18.2 nhưng không thêm "out-of-service do thiết kế" và "suppressed by design" (chỉ `disabled` do kỹ sư), "đủ tối thiểu hợp lý" theo yêu cầu.
- **D9. Nội dung mặc định tiếng Việt theo loại và ngưỡng:** số: `{name}`; `HH`: `{name} rất cao: {value} {unit} (ngưỡng {limit})`; `H`: `{name} cao: …`; `L`: `{name} thấp: …`; `LL`: `{name} rất thấp: …`; quality: `{name}: mất tín hiệu ({reason})`. Lý do: kỹ sư không phải gõ nội dung cho hàng trăm alarm.
- **D10. Giá trị chèn là giá trị lúc bật**, được chụp một lần và lưu vào lần xảy ra; giá trị sống hiện ở widget Tag riêng nếu cần. Lý do: nội dung là bản ghi sự cố, phải ổn định khi xem lại lịch sử; không cần đăng ký Tag thêm cho trang Alarm.
- **D11. Shelve** (tạm ẩn) **do operator**, tối đa 8 giờ, lý do bắt buộc, tối đa 50 cùng lúc; hết hạn thì alarm còn đúng điều kiện **bật lại như lần mới** (có tiếng). **Disable** (vô hiệu) **do engineer** qua Bearer, bền. Hai thứ này là toàn bộ "shelving/suppress": đủ cho vận hành mà không dựng kho "quản lý thay đổi alarm" của ISA đầy đủ. Lý do: shelving rộng rãi là nguồn gốc nhiều sự cố; hạn chế bằng thời gian, lý do và audit.
- **D12. `alarm.db` riêng**, không dùng chung `history.db` (khác chu kỳ ghi, khác thời hạn, hỏng riêng không mất lịch sử Tag) và không dùng `audit.db` (audit là nhật ký bảo mật có ngoại lệ FULL, không để chung với dữ liệu vận hành nhiều hơn). Lý do: cô lập hỏng, thời hạn và trần riêng, truy vấn riêng.
- **D13. `alarm.db` chạy `synchronous=NORMAL`; không xin ngoại lệ Constitution thứ ba.** Độ bền của hành động quan trọng (xác nhận, tạm ẩn, vô hiệu) nằm ở `audit.db` FULL ghi **trước**. Lý do: mất điện chỉ làm lần xảy ra quay về **chưa xác nhận** (an toàn: nhắc người vận hành xác nhận lại), không tạo xác nhận giả; trong khi `FULL` cho mọi lần bật/hết tăng ghi eMMC và đòi sửa Constitution.
- **D14. Hai hướng mất mát khi mất điện được chấp nhận** (ghi rõ để nghiệm thu): (a) bản ghi bật/hết trong ≤ `alarmCommitMs` cuối có thể mất khỏi lịch sử, nhưng trạng thái được dựng lại từ điều kiện Tag lúc khởi động (lần xảy ra mới với cờ `startup`); (b) xác nhận cuối quay về chưa xác nhận. Không có hướng nào tạo trạng thái sai nguy hiểm.
- **D15. Tự cách ly khi chập chờn** (mặc định 5 lần bật trong 60 s thì cách ly 30 phút) thay vì giới hạn tốc độ ghi toàn cục. Lý do: nguyên nhân bão alarm gần như luôn là một vài alarm chập chờn; xử lý ở nguồn giữ cả màn hình lẫn ngân sách eMMC; tuân theo khuyến nghị ISA-18.2 về chattering alarm.
- **D16. Quality BAD giữ nguyên trạng thái** của alarm số và ngưỡng (không bật, không hết), alarm `quality` mới là nơi báo mất tín hiệu. Lý do: tránh vừa báo "hết" giả khi PLC rút cáp, vừa tránh báo "bật" giả; một sự cố một báo cáo (ISA khuyến nghị alarm không sinh từ dữ liệu xấu).
- **D17. Khởi động lại giữ lần xảy ra mở nếu điều kiện còn đúng**, không chạy lại trễ bật. Lý do: trễ đã trôi qua trước khi tắt; khởi động lại không phải lý do làm người vận hành bị báo lại vô ích (và vẫn quay về chưa xác nhận nếu xác nhận chưa kịp commit, D14).
- **D18. Đẩy qua live 1.3.0 bằng đăng ký riêng** (`subscribeAlarms`) thay vì trộn vào `delta` của Tag. Lý do: tương thích ngược sạch (client cũ không đăng ký thì không nhận), snapshot có cấu trúc riêng (lớp, khu vực, đếm), `sequence` riêng để phát hiện đứt không ảnh hưởng Tag. Xác nhận chỉ qua REST (như ghi Tag, 007 D4) để một đường kiểm quyền.
- **D19. Xác nhận bằng cặp (`id`, `occurrence`) và "tất cả" bằng `upToRevision`.** Lý do: người vận hành chỉ xác nhận cái họ đã thấy; alarm mới bật giữa lúc nhìn và lúc bấm không bị xác nhận oan (yêu cầu cơ bản của ISA/EEMUA 191).
- **D20. Lịch sử là bảng lần xảy ra** (`alarm_occurrence`, một dòng một lần, cập nhật tại chỗ khi xác nhận, hết), không phải nhật ký sự kiện. Lý do: ít dòng và ít chỉ mục hơn nhật ký sự kiện (bật, xác nhận, hết, xác nhận hết là bốn dòng); truy vấn và CSV tự nhiên theo lần xảy ra; sự kiện của người dùng đã có ở `audit.db`.
- **D21. Thời gian hiển thị theo múi giờ của trình duyệt;** CSV ghi ISO 8601 kèm độ lệch. Lý do: Chrome của nhà máy đặt giờ địa phương; tránh thêm cài đặt múi giờ ở thiết bị (historian 003 có `utcOffset` cho DB ngoài, là chuyện khác).
- **D22. CSV sinh trên trình duyệt**, tối đa 100.000 dòng (như tinh thần lộ trình §4.6: báo cáo sinh ở trình duyệt để không tốn CPU BL335). Chống công thức Excel (`'` đầu ô). UTF-8 có BOM để Excel đọc đúng tiếng Việt.
- **D23. Âm thanh tổng hợp bằng Web Audio** (không file âm thanh, không tải tài nguyên): bốn kiểu `none`, `beep`, `double`, `siren`. Mặc định tắt vì chính sách tự phát của Chrome; người vận hành bật bằng một nhấp. Lý do: không thêm tài nguyên tĩnh, không bản quyền, kiểm DOM được.
- **D24. Tám màu thiết kế** (token) thay vì màu tự do. Lý do: mỗi màu có biến thể theo theme sáng/tối đã kiểm tương phản; "màu không bao giờ là tín hiệu duy nhất" ([studio-ux.md](../../docs/architecture/studio-ux.md) §7) nên kèm biểu tượng theo mức ưu tiên.
- **D25. Nhấp nháy tối đa 1 Hz và tôn trọng `prefers-reduced-motion`.** Lý do: an toàn co giật (WCAG 2.3.1) và khả dụng.
- **D26. Banner và trang Alarm là phần dựng sẵn của trang runtime**, không phải màn hình của project; mục menu "Alarm" tự thêm khi project có alarm (có thể tắt bằng `navigation.alarms: false` ở 0.5.0; project không có `navigation` vẫn có menu tối thiểu chứa Alarm). Lý do: mọi project đều cần; không bắt kỹ sư dựng lại ở mỗi project. Widget `alarm-list`, `alarm-count` cho ai muốn nhúng vào dashboard (US5).
- **D27. Hai widget** (`alarm-list`, `alarm-count`) thay vì một. Lý do: một là bảng, một là chỉ báo nhỏ có số; thuộc tính khác hẳn, gộp làm inspector rối.
- **D28. Định dạng project lên 0.5.0 (MINOR), không mở rộng 0.4.** Lý do: thêm hai file tùy chọn và đổi yêu cầu runtime tối thiểu (0.8.0); theo ADR-004 đổi yêu cầu runtime là đổi MINOR; migration 0.4 → 0.5 chỉ đổi `schemaVersion` và nâng `minRuntimeVersion` (không có dữ liệu để chuyển). **Quyết định (người dùng giao toàn quyền 2026-10-11):** định dạng 0.5.0 vì 3b (specs/008) dùng 0.4.0; 010 dùng 0.6.0; runtime 0.8.0 và Studio 0.7.0 nằm giữa 3b (0.7.0, 0.6.0) và 010 (0.9.0, 0.8.0). Toàn bộ tài liệu của feature dùng `0.5.0` như một hằng số tập trung (task T002), và mã dùng hằng `kProjectFormatAlarms` / `PROJECT_FORMAT_ALARMS` thay vì chuỗi rải rác; công cụ `tools/renumber-alarm-format.mjs` giữ làm phương án dự phòng nếu thứ tự phát hành đổi nữa.
- **D29. Phiên bản:** runtime 0.8.0 (3b dùng 0.7.0, 010 dùng 0.9.0), Studio 0.7.0 (3b 0.6.0, 010 0.8.0), API thiết bị 1.3.0, live 1.3.0, `@mat/ui-components` 0.3.0 (3b dùng 0.2.0), danh mục widget 0.4.0 (3b không đổi danh mục; 010 dùng 0.5.0). Các số này là hằng tập trung như D28, đối chiếu lại với `specs/008` và `specs/010` `plan.md` ở T002.
- **D30. Động cơ alarm chạy trên luồng tick**, sau `TagEngine::step`, đọc Tag qua `snapshot` một lần mỗi tick (≤ 200 Tag). Không luồng riêng cho động cơ (đơn giản, thứ tự rõ, không khóa mới); chỉ ghi `alarm.db` ở luồng riêng. Lý do: 200 instance × 4 phép so mỗi 250 ms là không đáng kể; thứ tự "Tag cập nhật rồi mới đánh giá" đúng nhất khi cùng luồng.
- **D31. Không có `acknowledge` trên WebSocket, không có "xác nhận từ Studio" trong feature này.** Studio Online chỉ xem trạng thái; xác nhận từ Studio (kênh `studio`) thuộc về sau nếu cần. Lý do: YAGNI; người vận hành dùng Chrome.
- **D32. Một cấp khu vực, phẳng.** Lý do: lọc đủ dùng; cây khu vực nhiều cấp là thêm phức tạp cho lưới và bộ lọc; xem lại khi có khách cần.
- **D33. `device` trong alarm `quality`** (mọi Tag của thiết bị không GOOD) thay vì thêm API trạng thái kết nối riêng cho động cơ. Lý do: dùng đúng dữ liệu đã có từ Tag Engine (quality, reason của 006); không thêm đường dữ liệu; đủ cho "mất kết nối PLC".
- **D34. Giới hạn 500 instance** (nghiệm thu ở 200). Lý do: ngân sách tick ≤ 2 ms; 500 là mức an toàn có đo; trên 200 cảnh báo vì chưa đo ngân sách đầy đủ trên BL335.
- **D35. Không cần đăng nhập để xem alarm** (viewer trong mạng riêng, theo `viewerAccess` của ADR-018) nhưng xác nhận, tạm ẩn cần đăng nhập. Lý do: giống Tag; alarm là thông tin; tuân theo bảng quyền hiện có.
- **D36. Mô phỏng trong Studio dùng bản TS của động cơ với đồng hồ ảo**, không chạy runtime. Lý do: giữ Studio độc lập thiết bị; kiểm tương đương bằng vector chung (Constitution II).
- **D37. Lược đồ `alarm.db` có `alarm_meta.schema`** và migration nội bộ theo số nguyên; thêm cột tùy chọn không cần migration. Lý do: runtime nâng cấp tại chỗ không được làm mất lịch sử.
- **D38. Không có ưu tiên "tắt tiếng toàn cục" trên thiết bị:** âm thanh hoàn toàn ở trình duyệt từng người; mỗi máy tự bật hoặc tắt. Lý do: không có loa trên BL335; mỗi vị trí vận hành khác nhau.
- **D39. Hai mức thử:** tự động trên x64 (động cơ, lưu trữ, giao thức, trang) và đo trên BL335 ở task ⚠️🔌 (độ trễ, ngân sách, cắt điện thật). Lý do: như 005 đến 007; SSH không có trong phiên viết kế hoạch.
- **D40. Mockup tạo và tự duyệt trước giao diện Studio mới** (`studio-alarms.html`), như D6 của 007.
- **D41. Số thập phân trong nội dung alarm dùng dấu chấm** (`91.2`), không nhóm hàng nghìn, cùng quy tắc `formatValue` của widget (007). Lý do: một quy tắc cho cả trang; C++ không phụ thuộc `locale` của hệ thống (bộ vector tất định).
- **D42. `revision` toàn cục của động cơ** (số nguyên tăng khi có thay đổi dữ liệu alarm; mỗi instance có `rev`) và `upToRevision` thay cho `upToSequence`. Lý do: `sequence` trên live là số của từng phiên, REST không có phiên; "Xác nhận tất cả" cần một mốc toàn cục để chỉ xác nhận cái người dùng đã thấy (D19).
- **D43. Tự cách ly chập chờn 30 phút** (thay vì 10), cộng cửa sổ commit thích ứng tới `alarmCommitMaxMs` khi tốc độ thay đổi cao. Lý do: ước tính (research R9) cho thấy 10 phút cố định vượt ngân sách 0,1 GB/ngày ở tải bão; 30 phút đưa về khoảng 0,04 GB/ngày; mức tải chuẩn nới lên 25 MB/ngày vì mỗi lần xảy ra chạm nhiều trang chỉ mục (vẫn nhỏ so với 2 GB/ngày). Spike T006 xác nhận bằng số đo.
- **D44. Tag chưa có giá trị khi khởi động** (`known` = false): alarm `digital` và `limit` coi như dữ liệu xấu (giữ nguyên); alarm `quality` chưa bật cho tới khi có giá trị đầu tiên. Lý do: khởi động không được sinh một loạt "mất tín hiệu" giả trước khi driver kịp đọc; mất kết nối thật vẫn bật vì driver đánh BAD có `reason`.
- **D45. Lần xảy ra khi giờ chưa đồng bộ không nằm trong truy vấn theo khoảng thời gian**, chỉ hiện khi bật `unsynced=1`. Lý do: giờ gần 1970 làm sai khoảng; thứ tự vẫn đúng theo mã (FR-024).
- **D46. Lệnh `mat-runtime --alarm-db-check`** chỉ đọc để kiểm `alarm.db` trên thiết bị không có `sqlite3`. Lý do: SC-008 cần `integrity_check` sau mỗi lần cắt điện; cùng kiểu `--export-audit` của 005.
- **D47. Tự cách ly do chập chờn không tính vào giới hạn 50 alarm shelved của người vận hành** (FR-034). Lý do: một bão chập chờn lớn không được chiếm hết chỗ tạm ẩn mà người vận hành cần; số tự cách ly bị giới hạn tự nhiên bởi số instance (≤ 500) và hiện riêng ở `system/info.alarms`.

### Giả định và phụ thuộc

- Phụ thuộc 006: Tag Engine (`TagStore`, `quality`, `reason`), Tag tính toán, `SimEngine`, lưới ADR-016, `audit` (`write_audit`), `write_coordinator`.
- Phụ thuộc 007: `<mat-screen>`, `TagSource`, `ActionHost`, danh mục widget, phiên web (cookie, CSRF), trang runtime shell và menu, Toolbox và inspector sinh từ danh mục, lint DOM.
- Phụ thuộc 008 (GĐ 3b, [specs/008-svg-import-binding](../008-svg-import-binding/spec.md)): định dạng project 0.4 (0.4.0, `schemas/0.3/` đã đóng băng, `migrate03to04`, vector `v04-*`) là nền của 0.5.0; `@mat/ui-components` 0.2.0 là nền của 0.3.0; runtime 0.7.0 và Studio 0.6.0 là nền của 0.8.0 và 0.7.0. Hai feature cùng sửa các file chung (validator, `schemas/project.schema.json`, `protocol-version.json`, cây Studio, shell runtime-web); 009 làm sau khi 008 có mã (hoặc gộp bằng thêm khối).
- Phụ thuộc 005: `AuthService`, role, `audit.db`, nạp xuống và Tương thích runtime.
- Phụ thuộc 003: `HistoryReader` (mẫu kết nối chỉ đọc), cơ chế tách file hỏng, `minFreeBytes`.
- Chrome ≥ 120 (Constitution IV); Web Audio; `prefers-reduced-motion`.
- BL335: RTC không chạy; đồng hồ có thể về 1970 sau mất điện (đã có `clockOk`).
- Không có SSH tới BL335 trong phiên viết kế hoạch; mọi đo trên thiết bị là task ⚠️🔌.
- Giả định tải: 200 alarm; dưới 20 lần xảy ra mỗi giờ khi bình thường; bão: 200 alarm cùng chập chờn.
- Dự án 0.2, 0.3 và 0.4 hiện có (`tank-demo`, `modbus-demo`, `dashboard-demo`, và các dự án 0.4 của 3b) vẫn chạy.

## Ngoài phạm vi

- Thông báo ngoài: email, Telegram, Zalo, SMS, còi/đèn nối rơ-le (GĐ 6 trở đi).
- Recipe, logic v2 (luật sự kiện, timer, công thức), điều kiện alarm bằng biểu thức tự do (làm bằng Tag tính toán).
- Quản lý thay đổi alarm theo ISA-18.2 đầy đủ (hồ sơ hợp lý hóa alarm, "suppressed by design" theo điều kiện vận hành, "alarm flood" tự động ẩn theo trạng thái nhà máy, hệ thống chỉ số KPI alarm).
- Xác nhận từ Studio, xác nhận qua WebSocket, xác nhận hai bước, chữ ký điện tử cho xác nhận (21 CFR Part 11).
- Báo cáo alarm theo ca, thống kê (top alarm hay xảy ra, MTTA), biểu đồ alarm (GĐ 5).
- Khu vực nhiều cấp, lớp theo điều kiện, nội dung đa ngôn ngữ, âm thanh do người dùng cung cấp.
- Lưu trữ alarm sang DB ngoài (MySQL, SQL Server, PostgreSQL, InfluxDB); chuyển tiếp như historian của 003.
- Phân quyền xem alarm theo khu vực; xác nhận theo khu vực.
- Nâng giới hạn 500 instance hay 10 client.
- Bố cục điện thoại cho trang Alarm.
