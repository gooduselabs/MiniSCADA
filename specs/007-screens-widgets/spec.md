# Feature Specification: Màn hình v1, widget và điều khiển từ Chrome

**Feature Branch**: `007-screens-widgets`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "GĐ 3a của lộ trình v2: màn hình v1, widget và điều khiển. Mô hình màn hình v1: một màn hình gồm nhiều item xếp lớp trên cùng hệ tọa độ thiết kế (ví dụ 1920×1080): item `svg` (đồ họa, binding theo `elementUid` như hiện nay) và item `widget`; widget là phần tử HTML đặt chồng lên SVG, không nằm trong SVG vì sanitizer cấm `foreignObject`. Web runtime: nhiều màn hình, menu điều hướng, URL giữ màn hình khi F5, popup. Thư viện widget `packages/ui-components` (web component, dùng chung web runtime và Studio): hiển thị (card giá trị, nhãn, đèn báo, đồng hồ kim, thanh mức), biểu đồ thời gian thực (line, bar, pie/donut), bảng giá trị Tag sống, điều khiển (nút đặt giá trị/đảo/xung/chuyển màn hình/popup; công tắc; ô nhập setpoint có min/max và xác nhận; thanh trượt; danh sách chọn theo bảng giá trị). Điều khiển từ Chrome ghi được Tag, nên trang runtime phải chạy HTTPS và đăng nhập trên Chrome: cookie `HttpOnly; Secure; SameSite=Strict` + CSRF token, chỉ role operator trở lên mới ghi; quy trình chứng chỉ (chứng chỉ tự ký làm Chrome cảnh báo: hướng dẫn nạp chứng chỉ CA của khách hàng). Điều khiển có hộp xác nhận, trạng thái đang gửi, kết quả ACCEPTED/REJECTED/TIMEOUT/FAILED/CONFIRMED; tự khóa với viewer, khi mất kết nối hoặc quality xấu. Studio: trình bố trí màn hình (canvas zoom/pan/lưới/snap; kéo widget từ Toolbox; di chuyển, đổi cỡ, căn chỉnh, xếp lớp; inspector Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật; kéo Tag từ cây thả vào thuộc tính; xem trước bằng mô phỏng hoặc thiết bị), theo chuẩn IDE kiểu TIA Portal. Nghiệm thu: dựng dashboard ≥ 20 widget hoàn toàn trong Studio (không viết tay JSON), nạp xuống, vận hành từ Chrome; viewer không ghi được; operator ghi có xác nhận và audit; mở màn hình ≤ 2 s; 10 client cùng F5 xong ≤ 5 s; RSS ≤ 150 MB, CPU ≤ 30 %. Ngoài phạm vi: SVG import, gắn Tag cho phần tử SVG bằng inspector, animation, sự kiện giao diện (GĐ 3b); alarm (GĐ 4); biểu đồ lịch sử, báo cáo (GĐ 5); trình vẽ SVG đầy đủ (GĐ 6)."

## Bối cảnh

Sau GĐ 2 ([006](../006-tags-modbus/spec.md)), BL335 đọc và ghi PLC thật, có Tag nội bộ, Tag tính toán, bảng giá trị và API ghi Tag có audit. Nhưng người vận hành chưa dùng được gì trên Chrome ngoài **một màn hình SVG** có binding viết tay:

- trang runtime chỉ dựng màn hình đầu của project ([main.ts](../../apps/runtime-web/src/main.ts)); không có menu, không có màn hình thứ hai, không có popup;
- không có widget nào: card giá trị, đèn báo, đồng hồ, biểu đồ, bảng, nút, ô nhập setpoint đều chưa có;
- trang xem chỉ đọc, HTTP 8080, không đăng nhập; ghi Tag chỉ làm được từ Bảng theo dõi online của Studio (D2 của 006);
- Studio xem trước màn hình được ([screen-preview.ts](../../apps/studio/src/ui/editors/screen-preview.ts)) nhưng không bố trí được: không kéo thả, không đổi cỡ, Toolbox chỉ giới thiệu widget "GĐ 3a".

GĐ 3a của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.3) giải quyết các điểm này. Ràng buộc chính của [Constitution](../../.specify/memory/constitution.md) 2.0.1:

- **II:** `apps/runtime-web` chỉ hiển thị, tương tác và gọi API; widget, binding, định dạng giá trị viết một lần trong `packages/*` cho cả Studio và Chrome. Render chạy trên Chrome của client, không chạy trên BL335.
- **III:** ngân sách BL335: RSS ≤ 150 MB, CPU trung bình ≤ 30 % với 500 Tag/1 s/10 client.
- **IV:** Chrome/Chromium ≥ 120; tối đa 10 phiên live.
- **V:** không `eval`, không script tùy ý; mọi lệnh ghi Tag kiểm role, quyền, trạng thái và ghi audit; API ghi chỉ bật khi có HTTPS, đăng nhập, role, audit (đã có từ 005, 006). "Web SCADA không phải lớp an toàn": interlock ở PLC.
- **VI:** test viết trước. **VII:** schema theo SemVer có migration; YAGNI theo giai đoạn.

Phần Studio theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5 (editor Màn hình) và §9; người dùng từ chối giao diện form cơ bản, chuẩn là công cụ IDE kiểu TIA Portal. Mockup của feature này: [studio-screens.html](../../docs/architecture/mockups/studio-screens.html) (tạo ở bước plan).

**Nền chung** cho mọi story: định dạng project 0.3.0 (mô hình màn hình v1) và nâng cấp từ 0.2, thư viện `packages/ui-components`, đường dẫn dữ liệu của trang runtime. Phần này được nghiệm thu qua kịch bản 1–4 của User Story 1, FR-001…FR-012 và SC-011, SC-012. Các quyết định đã chốt và quyết định khi viết spec nằm ở mục Assumptions (D1–D40).

**Thuật ngữ:**

- **Màn hình**: một trang thiết kế gồm các item xếp lớp. Có hai loại: `screen` (mở từ menu hoặc đường dẫn) và `popup` (hộp thoại chồng lên màn hình, mở bằng hành động).
- **Item**: một phần tử trên màn hình: **item `svg`** (một file SVG đã có binding theo `elementUid`) hoặc **item `widget`** (một phần tử HTML của thư viện widget). Thứ tự item trong màn hình là thứ tự xếp lớp, đầu danh sách ở dưới cùng.
- **Hệ tọa độ thiết kế**: đơn vị của màn hình, mặc định 1920 × 1080. Vị trí và cỡ của mọi item tính theo đơn vị này; trình duyệt co cả màn hình theo cửa sổ bằng một phép co duy nhất.
- **Widget**: thành phần giao diện trong thư viện (15 loại, D10). **Widget điều khiển**: widget có thể ghi Tag (nút, công tắc, ô nhập setpoint, thanh trượt, danh sách chọn).
- **Khe Tag**: chỗ trong widget để gắn Tag (ví dụ khe `value` của card, khe `target` của nút).
- **Hành động**: việc widget làm khi người dùng thao tác: ghi giá trị, đảo, xung, chuyển màn hình, mở hoặc đóng popup. Chỉ có hành động có sẵn, không có script (Constitution V).
- **Phiên web**: phiên đăng nhập của trang runtime trên Chrome (cookie). Khác phiên của Studio (token trong header, 005).
- **Chế độ chỉ xem**: trang runtime chạy không có phiên hợp lệ hoặc qua HTTP: xem được, mọi điều khiển bị khóa.
- **BL335**: thiết bị chạy runtime, như 005, 006.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Xem dashboard nhiều màn hình trên Chrome (Priority: P1)

Người vận hành mở trang runtime trên Chrome. Họ thấy menu điều hướng bên trái (Tổng quan, Bồn nước, Bơm, nhóm Giám sát), thanh trạng thái kết nối live ở trên, và màn hình "Tổng quan": một dashboard gồm đồ họa SVG bồn và bơm làm nền, trên đó là card giá trị, đèn báo, đồng hồ kim, thanh mức, nhãn chữ, khung nền. Các giá trị cập nhật theo dữ liệu sống. Họ bấm "Bồn nước" ở menu: màn hình khác hiện ra ngay, đường dẫn trên thanh địa chỉ đổi thành `#/bon-nuoc`. Họ nhấn F5: trang vẫn ở màn hình Bồn nước. Họ bấm nút "Chi tiết bơm 1": popup mở chồng lên, nền mờ; nhấn Esc: popup đóng.

Dự án cũ (định dạng 0.1 hoặc 0.2, một màn hình SVG) vẫn chạy trên runtime mới và hiện y như trước.

**Why this priority**: đây là nền của GĐ 3a: định dạng màn hình mới, thư viện widget và trang runtime nhiều màn hình. Mọi story khác (dựng trong Studio, điều khiển, biểu đồ) cần nền này; nó cũng là phần người vận hành thấy mỗi ngày.

**Independent Test**: viết tay một project 0.3.0 mẫu (`projects/dashboard-demo`, task tạo) có 3 màn hình, 1 popup, 15 loại widget và 1 item SVG; chạy runtime x64 với nguồn Tag mô phỏng; mở bằng Chrome headless (puppeteer). Kiểm DOM, đường dẫn, kích thước, giá trị. Chạy lại với project 0.1 và 0.2 hiện có (`tank-demo`, `modbus-demo`).

**Acceptance Scenarios**:

1. **Given** project 0.2 (`modbus-demo`) và runtime 0.6, **When** mở trang runtime, **Then** kết quả hiển thị và giá trị binding giống runtime 0.5 (cùng phần tử, cùng giá trị); không có menu thừa (project một màn hình thì không hiện menu).
2. **Given** project 0.2 mở trong Studio 0.5, **When** chọn Nâng cấp lên 0.3.0 và lưu, **Then** mỗi màn hình SVG thành một màn hình có đúng một item `svg` phủ kín, cỡ màn hình bằng `viewBox` cũ, và hiển thị trên Chrome giống bản 0.2 (cùng DOM của SVG; sai lệch ảnh chụp ≤ 1 % số điểm ảnh).
3. **Given** project 0.3 có 3 màn hình, **When** mở trang, **Then**: màn hình đầu hiện trong ≤ 2 s (SC-002); menu liệt kê đúng các mục của `navigation` theo thứ tự; mục của màn hình đang mở được tô.
4. **Given** đang ở màn hình "Tổng quan", **When** bấm mục "Bồn nước", **Then** màn hình đổi, URL thành `…/#/bon-nuoc`, nút Back của Chrome quay lại "Tổng quan", F5 ở "Bồn nước" giữ nguyên màn hình đó.
5. **Given** URL có `#/khong-co`, **When** mở trang, **Then** hiện màn hình đầu kèm thông báo "Không có màn hình `khong-co`", URL được sửa về màn hình đầu.
6. **Given** màn hình thiết kế 1920 × 1080, **When** cửa sổ Chrome là 1366 × 768, 1920 × 1080 hoặc 2560 × 1440, **Then** cả màn hình co vừa khung (giữ tỉ lệ, `contain`), mọi item giữ vị trí tương đối; widget và SVG cùng tỉ lệ; đổi cỡ cửa sổ thì cập nhật ≤ 100 ms.
7. **Given** màn hình có một item SVG và các widget đặt chồng, **When** vẽ, **Then** thứ tự xếp lớp đúng thứ tự `items`; widget ở trên nhận nhấp chuột, vùng SVG không bị widget che thì nhận nhấp như cũ.
8. **Given** màn hình có 15 loại widget, **When** dữ liệu live đến, **Then** mỗi widget hiện đúng giá trị của Tag đã gắn: định dạng số theo số lẻ, đơn vị lấy từ Tag nếu không đặt, chữ và màu theo bảng giá trị của Tag.
9. **Given** Tag của một card có quality BAD (rút cáp PLC), **When** quality đổi, **Then** card hiện viền đỏ, nhãn "BAD", giá trị cuối mờ đi; lý do (ví dụ "hết thời gian chờ") hiện trong tooltip; khi cắm lại thì trở về bình thường.
10. **Given** mất kết nối WebSocket, **When** hết hạn nhận dữ liệu, **Then** mọi widget hiện trạng thái STALE (xám, nhãn "STALE") và banner kết nối hiện như hiện nay (4429, mất mạng); có lại kết nối thì widget trở về giá trị mới.
11. **Given** một nút có hành động "mở popup Bơm 1", **When** bấm, **Then** popup hiện chồng lên, nền mờ, giữ focus trong popup; Tag của popup được đăng ký thêm; nhấn Esc, bấm nút Đóng hoặc nền thì popup đóng và đăng ký Tag trở về như cũ.
12. **Given** màn hình tham chiếu 120 Tag riêng biệt, **When** mở màn hình, **Then** trang chỉ đăng ký 120 Tag (không đăng ký Tag của màn hình khác); chuyển sang màn hình khác thì đăng ký đổi theo trên cùng kết nối.
13. **Given** đã có 10 phiên live, **When** mở trang thứ 11, **Then** hiện thông báo đầy và đếm ngược như hiện nay (4429); không có màn hình nào bị dựng nửa chừng.
14. **Given** project đã kích hoạt, rồi file `.screen.json` của một màn hình bị sửa hỏng trực tiếp trên thiết bị (bộ kiểm tra chỉ chạy lúc nạp xuống nên không bắt được), **When** mở màn hình đó, **Then** màn hình đó hiện lỗi cụ thể; menu và các màn hình khác vẫn dùng được.
15. **Given** URL có `?kiosk=1`, **When** mở trang, **Then** ẩn thanh trên và menu, chỉ còn màn hình và một chấm trạng thái kết nối; đường dẫn `#/<id>` vẫn chọn màn hình.

---

### User Story 2 - Dựng màn hình trong Studio bằng trình bố trí (Priority: P1)

Kỹ sư mở project, bấm đúp "Tổng quan" trên cây. Editor Màn hình mở thành một tab: canvas có thước, lưới, zoom và pan. Kỹ sư kéo "Card giá trị" từ Toolbox bên phải thả vào canvas; widget xuất hiện dính lưới và được chọn. Họ kéo Tag `TANK01.LEVEL` từ Details (hoặc cây) thả lên widget: widget gắn Tag, tự lấy đơn vị và bảng giá trị của Tag. Họ kéo tay nắm đổi cỡ, nhấn Ctrl+D nhân bản, chọn ba card bằng Shift+nhấp rồi bấm "Căn trên" và "Phân bố đều ngang". Họ thêm đồng hồ kim, thanh mức, biểu đồ, nút, ô nhập setpoint; inspector hiện lỗi "Nút 'Bật bơm': Tag `PUMP01.STATE` là chỉ đọc" và họ sửa. Họ bấm Xem trước, chọn Mô phỏng: dashboard chạy số sống. Họ Nạp xuống BL335 và mở Chrome: dashboard giống xem trước.

**Why this priority**: nghiệm thu của GĐ 3a là "dựng dashboard ≥ 20 widget hoàn toàn trong Studio, không viết tay JSON". Không có trình bố trí thì thư viện widget không dùng được ngoài thử nghiệm.

**Independent Test**: với lớp Tauri giả và Chrome headless, một kịch bản e2e dựng dashboard ≥ 20 widget (đủ 15 loại) từ project rỗng bằng thao tác chuột và bàn phím; lưu; kiểm bằng bộ kiểm tra; nạp vào runtime x64 và mở bằng Chrome headless so với xem trước. Thử tay trên Windows 11 có bộ gõ tiếng Việt (nhập nhãn, tên).

**Acceptance Scenarios**:

1. **Given** màn hình đã mở trong editor, **When** cuộn chuột với Ctrl, bấm +, −, "Vừa khung", hoặc giữ Space rồi kéo, **Then** canvas zoom trong 10–400 % (bước nhân 1,25) và pan; thước ngang và dọc cập nhật; vị trí con trỏ hiện ở thanh trạng thái theo đơn vị thiết kế.
2. **Given** lưới bật (mặc định 10 đơn vị) và bắt dính bật, **When** kéo một widget, **Then** vị trí là bội của 10; khi cạnh hoặc tâm gần (≤ 6 điểm ảnh màn hình) cạnh hoặc tâm của item khác, hiện đường gióng và dính vào đó; giữ Alt khi kéo thì tắt bắt dính.
3. **Given** Toolbox hiện 15 loại widget theo nhóm, **When** kéo một loại thả vào canvas, **Then** widget mới có cỡ mặc định của loại, đặt tại điểm thả (dính lưới), được chọn, nằm trên cùng; Ctrl+Z bỏ nó trong một bước.
4. **Given** một widget được chọn, **When** kéo 8 tay nắm, dùng phím mũi tên (1 đơn vị; Shift: 10), hoặc nhập X, Y, Rộng, Cao trong inspector, **Then** item đổi theo; cỡ không nhỏ hơn mức tối thiểu của loại; giữ Shift khi kéo góc thì giữ tỉ lệ; một lần kéo liên tục là một bước hoàn tác.
5. **Given** chọn ≥ 2 item (Shift+nhấp, kéo khung chọn, Ctrl+A), **When** bấm Căn trái, Căn giữa, Căn phải, Căn trên, Căn giữa dọc, Căn dưới, Phân bố đều ngang hoặc dọc (≥ 3 item), Cùng rộng, Cùng cao, **Then** vị trí đổi đúng theo hình học (kiểm bằng bộ ca hình học, SC-014), một bước hoàn tác.
6. **Given** nhiều item chồng nhau, **When** bấm Đưa lên trên, Đưa xuống dưới, Lên một lớp, Xuống một lớp, hoặc kéo trong panel Lớp, **Then** thứ tự `items` đổi và canvas vẽ lại đúng; panel Lớp có mắt (ẩn) và khóa cho từng item; item khóa không chọn được trên canvas, item ẩn không vẽ trong editor và vẫn hiện trong trình duyệt trừ khi `hidden`.
7. **Given** một card đang chọn, **When** kéo Tag `TANK01.LEVEL` từ Details thả vào ô "Tag giá trị" của inspector (tab Gắn Tag), hoặc thả thẳng lên widget trên canvas, **Then** khe được gắn; inspector hiện kiểu, đơn vị, quyền R hoặc RW của Tag; đơn vị và bảng giá trị của Tag được dùng nếu widget không đặt riêng.
8. **Given** một Nút có hành động "Đặt giá trị" gắn Tag `PUMP01.STATE` (chỉ đọc), **When** kiểm tra, **Then** inspector tab Thông tin hiện lỗi ở item đó, viền đỏ trên canvas, nhấp đôi dòng lỗi thì chọn item; lưu vẫn được (lưu việc dở), Nạp xuống bị khóa cho tới khi hết lỗi.
9. **Given** đang gắn Tag, **When** thả Tag không hợp với khe (ví dụ Tag chuỗi vào khe `value` của đồng hồ kim), **Then** Studio từ chối ngay kèm lý do và không đổi gì.
10. **Given** project có màn hình "Tổng quan" và "Bơm", **When** kỹ sư thêm màn hình (loại `screen` hoặc `popup`), đổi tên, nhân bản, đặt cỡ 1280 × 720, đổi nền, đặt màn hình đầu, xóa màn hình, **Then** project cập nhật đúng; xóa màn hình mà nút hoặc mục menu đang trỏ tới thì Studio liệt kê chỗ dùng và hỏi trước khi xóa, các chỗ trỏ trở thành lỗi kiểm tra.
11. **Given** editor Điều hướng, **When** kéo sắp xếp mục, đổi tên mục, đặt màn hình đích, tạo nhóm, chọn vị trí menu (trái, trên, ẩn), **Then** `navigation` thay đổi; xem trước và Chrome theo đúng.
12. **Given** Studio ở chế độ Xem trước, **When** chọn Mô phỏng, **Then** widget chạy số sống từ mô phỏng của Studio (006) và canvas khóa chỉnh sửa; nút và ô nhập trong dashboard thử được (hộp xác nhận hiện như trên Chrome) và ghi vào mô phỏng. Chọn Thiết bị thì dùng dữ liệu của thiết bị đang Online (viền cam).
13. **Given** dashboard ≥ 20 widget vừa dựng, **When** Lưu, Kiểm tra, Nạp xuống (005), **Then** bộ kiểm tra không có lỗi; BL335 chạy; trên Chrome mọi widget hiện đúng; So sánh cho kết quả "giống" ngay sau khi Đọc lên.
14. **Given** một lần kéo, đổi cỡ, nhân bản 10 item, hoặc căn chỉnh, **When** Ctrl+Z rồi Ctrl+Y, **Then** mỗi thao tác là đúng một bước; hoàn tác tới 100 bước.
15. **Given** Ctrl+C và Ctrl+V với 3 item, **When** dán (cùng màn hình hoặc màn hình khác), **Then** item mới có id mới, lệch 20 đơn vị, giữ Tag và hành động; dán sang màn hình khác thì hành động chuyển màn hình trỏ tới màn hình không có thì báo lỗi kiểm tra.
16. **Given** người dùng chỉ có bàn phím, **When** dùng Tab để chọn item, mũi tên để dịch, Enter để mở inspector, Delete để xóa, **Then** làm được mọi việc trên (SC-015).
17. **Given** đổi tên Tag `TANK01.LEVEL` (006), **When** xác nhận, **Then** mọi khe Tag, hành động và biểu thức trong màn hình được cập nhật trong cùng một bước hoàn tác.
18. **Given** nhập tên và nhãn tiếng Việt vào inspector bằng Telex có sẵn của Windows hoặc Unikey, **When** gõ "Bơm nước số 1", **Then** ô nhận đúng chuỗi, không mất ký tự khi chuyển focus.

---

### User Story 3 - Điều khiển có kiểm soát từ Chrome (Priority: P1)

Người vận hành chưa đăng nhập: mọi nút, công tắc, ô nhập mờ đi kèm chú thích "Đăng nhập để điều khiển". Họ bấm Đăng nhập, nhập tên và mật khẩu của tài khoản operator. Thanh trên hiện tên và vai trò; điều khiển sáng lên. Họ gõ setpoint 75 vào ô `TANK01.SP` rồi Enter: hộp xác nhận hiện Tag, mô tả, giá trị hiện tại 72,5 %, giá trị mới 75 %, giới hạn 0–90 %; họ xác nhận; ô hiện "Đang gửi…", rồi `ACCEPTED`, rồi `CONFIRMED` (xanh). Quản trị viên mở Audit trong Studio: thấy ai ghi, từ IP nào, trên màn hình nào, widget nào, giá trị cũ và mới, kênh "web".

Tài khoản viewer đăng nhập được nhưng điều khiển vẫn khóa; một lệnh ghi gửi bằng công cụ khác bị từ chối và có audit. Rút cáp PLC: nút liên quan khóa vì quality xấu.

**Why this priority**: điều khiển từ Chrome là nghiệm thu thứ hai của GĐ 3a và là bề mặt tấn công mới lớn nhất của sản phẩm (cookie, CSRF, ghi xuống máy thật). Phải đúng ngay từ đầu (Constitution V).

**Independent Test**: runtime x64 với giả lập Modbus (006); tài khoản viewer, operator, engineer. Dùng Chrome headless để thao tác widget; dùng client Node để tấn công (thiếu CSRF, Origin giả, cookie trên HTTP, cookie vào API kỹ thuật, phiên hết hạn). So nhật ký giả lập với audit.

**Acceptance Scenarios**:

1. **Given** chưa có phiên, **When** mở trang, **Then** widget điều khiển khóa (mờ, không nhận nhấp), mỗi widget có chú thích lý do "Chưa đăng nhập"; thanh trên có nút Đăng nhập.
2. **Given** hộp Đăng nhập, **When** nhập đúng tài khoản operator, **Then** trong ≤ 2 s phiên được tạo; cookie `__Host-mat_sid` có `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, không có `Domain`; mật khẩu không xuất hiện trong URL, bộ nhớ trình duyệt lâu dài hay log; thanh trên hiện tên và role; điều khiển mở khóa.
3. **Given** sai mật khẩu hoặc tài khoản bị khóa, **When** đăng nhập, **Then** hộp hiện "Sai tên hoặc mật khẩu" (cùng một câu cho sai tên và sai mật khẩu) hoặc "Tài khoản bị khóa tạm, thử lại sau N phút"; sau 5 lần sai liên tiếp khóa 5 phút như 005.
4. **Given** operator đã đăng nhập, Tag RW trong giới hạn, **When** bấm nút "Bật bơm" (hành động Đặt giá trị true), **Then** hộp xác nhận hiện đúng Tag, giá trị hiện tại và mới, tài khoản; [Hủy] mặc định có focus; Hủy thì không gửi gì.
5. **Given** hộp xác nhận, **When** bấm Xác nhận, **Then** widget hiện "Đang gửi…" và khóa nhận thêm nhấp; kết quả `ACCEPTED` rồi `CONFIRMED` trong ≤ 2 s (LAN); giá trị của widget là giá trị đọc lại của Tag; audit có bản ghi nhận và kết quả.
6. **Given** ô setpoint có giới hạn 0–90 và Tag có giới hạn 0–100, **When** gõ 95, **Then** ô báo "Ngoài giới hạn 0–90" và không mở hộp xác nhận; giới hạn của widget không được rộng hơn giới hạn của Tag (kiểm tra ở Studio).
7. **Given** gõ "12,5" vào ô setpoint, **When** Enter, **Then** ô báo "Dùng dấu chấm thập phân" và không gửi (như 006 D26).
8. **Given** lệnh được `REJECTED`, `TIMEOUT` hoặc `FAILED`, **When** kết quả về, **Then** widget hiện đúng loại kết quả bằng chữ tiếng Việt, màu và icon, kèm lý do (ví dụ "Kết nối tới PLC trạm bơm đang mất", "Thiết bị trường không trả lời: không chắc đã ghi", "PLC báo lỗi 02: địa chỉ không hợp lệ"); kết quả lỗi nằm lại tới khi người dùng đóng; `TIMEOUT` có thêm câu "Kiểm tra giá trị thực trước khi thử lại".
9. **Given** tài khoản viewer, **When** đăng nhập trên Chrome, **Then** đăng nhập được, điều khiển vẫn khóa với lý do "Cần quyền operator"; **When** gửi `POST /api/v1/tags/write` bằng cookie của viewer, **Then** BL335 trả 403 `FORBIDDEN`, không gửi gì tới PLC, audit `tag.write` `denied`.
10. **Given** operator đăng nhập, **When** `POST /api/v1/tags/write` thiếu header CSRF, sai CSRF, CSRF của phiên khác, `Origin` lạ hoặc thiếu `Origin`, **Then** mọi ca bị từ chối (403 `CSRF_FAILED` hoặc `ORIGIN_MISMATCH`), không có lệnh tới PLC, có audit.
11. **Given** trang mở bằng HTTP (cổng 8080), **When** xem điều khiển, **Then** khóa kèm "Mở bằng HTTPS để điều khiển" và liên kết tới cùng địa chỉ qua HTTPS; cookie đăng nhập không bao giờ được đặt qua HTTP; gửi lệnh ghi qua HTTP: 403 `HTTPS_REQUIRED` và audit.
12. **Given** operator đăng nhập, **When** dùng cookie gọi API kỹ thuật (nạp xuống, audit, tài khoản, đọc lên, Thử kết nối), **Then** 403 `SESSION_SCOPE`; chỉ các endpoint của trang runtime nhận cookie.
13. **Given** phiên hết hạn (30 phút không thao tác, hoặc 12 giờ, hoặc đổi địa chỉ IP, hoặc quản trị đổi role hay tắt tài khoản), **When** người vận hành thao tác, **Then** widget khóa, banner "Phiên đã hết hạn, đăng nhập lại" hiện, màn hình đang xem giữ nguyên; sau khi đăng nhập lại, lệnh dở không tự gửi lại.
14. **Given** hộp xác nhận đang mở rồi phiên hết hạn, **When** bấm Xác nhận, **Then** lệnh không gửi, hiện "Phiên đã hết hạn".
15. **Given** Tag đích có quality BAD, STALE hoặc chưa có giá trị, hoặc live mất kết nối, **When** xem widget điều khiển, **Then** khóa với lý do tương ứng ("Quality BAD: hết thời gian chờ", "Mất kết nối dữ liệu"); UNCERTAIN không khóa nhưng hiện cảnh báo trong hộp xác nhận.
16. **Given** nút có hành động Xung 500 ms gắn bit lệnh `PUMP01.RUN_CMD`, **When** xác nhận, **Then** BL335 ghi true, chờ 500 ms rồi ghi false, kể cả khi trình duyệt đóng ngay sau khi gửi; kết quả `CONFIRMED` chỉ sau khi cả hai lần ghi xong (SC-010); audit ghi cả hai.
17. **Given** công tắc BOOL `PUMP01.AUTO`, **When** bật rồi bật nhanh lần nữa trong lúc đang gửi, **Then** nhấp thứ hai bị bỏ (widget khóa lúc đang gửi); khi hai operator ở hai máy cùng đảo từ `false`, lệnh đến sau bị `REJECTED` `STALE_EXPECTATION` vì giá trị hiện tại không còn là `false` (D31).
18. **Given** nút có hành động chuyển màn hình hoặc mở popup, **When** bấm khi chưa đăng nhập, **Then** vẫn chạy (không ghi Tag nên không khóa).
19. **Given** hai operator ghi cùng Tag gần như cùng lúc, **When** cả hai xác nhận, **Then** chạy theo thứ tự BL335 nhận, mỗi người thấy kết quả lệnh của mình, audit có hai bản ghi (như 006).
20. **Given** đã đăng nhập, **When** bấm Đăng xuất, **Then** phiên bị hủy trên BL335 (dùng lại cookie cũ nhận 401), cookie bị xóa, điều khiển khóa lại.
21. **Given** `viewerLogin: required`, **When** mở trang chưa đăng nhập, **Then** chỉ hiện trang đăng nhập; không có dữ liệu Tag nào được gửi (kể cả kênh live) cho tới khi đăng nhập.
22. **Given** F5 khi đang đăng nhập, **When** trang tải lại, **Then** phiên khôi phục từ cookie (không đăng nhập lại), CSRF token lấy lại qua `GET /api/v1/web/session`, widget điều khiển mở khóa sau khi có phiên.
23. **Given** phiên web và Studio cùng tài khoản, **When** đăng xuất ở trang, **Then** phiên Bearer của Studio không bị ảnh hưởng (hai phiên độc lập).

---

### User Story 4 - Biểu đồ thời gian thực và Bảng Tag sống (Priority: P2)

Người vận hành xem màn hình "Giám sát": biểu đồ đường 3 đường (mức bồn, áp suất, công suất) chạy trong cửa sổ 5 phút, di chuột thấy giá trị từng đường; biểu đồ cột so sánh 4 đồng hồ điện; biểu đồ tròn tỉ lệ điện năng theo khu vực; bảng 12 Tag có giá trị, đơn vị, quality.

**Why this priority**: biểu đồ và bảng là phần đáng giá nhất của dashboard cho người xem, nhưng đọc dữ liệu không đòi hỏi quyền hay bảo mật mới, nên xếp sau điều khiển. Đây là phần dùng thư viện biểu đồ bên ngoài (ADR-020).

**Independent Test**: Tag mô phỏng tất định (006 `@mat/tag-sim`) cho giá trị biết trước; Chrome headless đọc điểm dữ liệu của biểu đồ qua giao diện kiểm thử của widget và so với giá trị Tag lúc lấy mẫu.

**Acceptance Scenarios**:

1. **Given** biểu đồ đường 3 đường, cửa sổ 300 s, lấy mẫu 1 s, **When** chạy, **Then** trục thời gian trôi liên tục, mỗi đường có màu và kiểu nét khác nhau cùng chú giải; điểm vẽ khớp giá trị Tag lúc lấy mẫu (SC-018); trục Y tự co theo dữ liệu hoặc theo min/max đặt trước.
2. **Given** con trỏ di trên biểu đồ, **When** dừng, **Then** hiện thời điểm và giá trị từng đường tại điểm gần nhất.
3. **Given** một Tag chuyển BAD giữa chừng, **When** chạy, **Then** đường đứt đoạn ở khoảng BAD (không nối điểm cũ), và hiện lại khi Tag GOOD.
4. **Given** màn hình có 8 biểu đồ, mỗi biểu đồ 8 đường, 3.600 điểm, **When** chạy 30 phút, **Then** tab Chrome không rò bộ nhớ (SC-017) và khung hình không bị giật.
5. **Given** chuyển sang màn hình khác rồi quay lại, hoặc F5, **When** mở lại biểu đồ, **Then** dữ liệu bắt đầu lại từ lúc mở (không có lịch sử; biểu đồ lịch sử là GĐ 5); widget ghi rõ "thời gian thực" trong chú thích tuỳ chọn.
6. **Given** biểu đồ cột 6 Tag, biểu đồ tròn 5 Tag, **When** giá trị đổi, **Then** cột và cung đổi theo, nhãn và số hiện đúng; tổng của biểu đồ tròn bằng 0 hiện trạng thái rỗng (không chia cho 0); Tag âm hoặc BAD bị loại khỏi tổng và có đánh dấu.
7. **Given** bảng Tag sống 12 dòng, **When** dữ liệu đổi, **Then** giá trị, quality, thời điểm cập nhật mỗi dòng đổi theo; bấm tiêu đề cột sắp xếp tại chỗ (không đổi project); Tag có bảng giá trị hiện chữ và màu của bảng.
8. **Given** Tag của biểu đồ không tồn tại trên thiết bị, **When** mở, **Then** đường đó ghi "không có Tag" trong chú giải và không vẽ; biểu đồ còn lại chạy.

---

### User Story 5 - Chứng chỉ HTTPS và truy cập từ Chrome (Priority: P2)

Kỹ sư cài BL335 cho khách hàng. Chrome báo "Kết nối của bạn không phải là kết nối riêng tư" khi mở `https://192.168.1.110:8443`. Kỹ sư làm theo hướng dẫn: tải chứng chỉ của thiết bị về máy vận hành, so fingerprint với giá trị hiện trên thiết bị, nhập vào kho chứng chỉ gốc tin cậy của Windows; mở lại Chrome: có ổ khóa, không cảnh báo. Với khách hàng có CA riêng: kỹ sư tạo yêu cầu ký (CSR) trên BL335, nhờ CA ký, nạp chứng chỉ trả về; mọi máy trong công ty đã tin CA đó nên không phải làm gì thêm.

**Why this priority**: không có chứng chỉ tin cậy thì cookie `Secure` và hộp thoại cảnh báo của Chrome làm người vận hành bỏ dùng hoặc quen bấm "tiếp tục", phá bảo mật. Nhưng đây là việc cài đặt một lần, nên xếp sau điều khiển.

**Independent Test**: sinh chứng chỉ mới, đọc SAN bằng `openssl x509`; dựng CA thử (container), ký CSR do runtime sinh, nạp, kiểm bắt tay TLS với CA thử; Chrome headless với kho tin cậy chứa CA thử mở trang không lỗi chứng chỉ. Thử tay trên Windows 11 + Chrome với chứng chỉ thiết bị thật (⚠️🔌).

**Acceptance Scenarios**:

1. **Given** thiết bị chưa có chứng chỉ (cài mới), **When** runtime khởi động lần đầu, **Then** chứng chỉ tự ký có SAN gồm hostname (nếu hợp lệ) và địa chỉ IPv4 của mọi card mạng tại lúc sinh; Chrome (đã tin chứng chỉ này) mở bằng IP không cảnh báo.
2. **Given** thiết bị đã có chứng chỉ từ runtime 0.5 (không có SAN IP), **When** nâng cấp lên 0.6, **Then** `system/info.warnings` và `deploy.sh` nêu `TLS_NO_IP_SAN` kèm lệnh `--regen-cert`; chứng chỉ không tự đổi (đổi chứng chỉ là đổi fingerprint đã ghim ở Studio).
3. **Given** `mat-runtime --regen-cert`, **When** chạy, **Then** chứng chỉ mới có SAN IP; fingerprint đổi; Studio chặn và báo cho tới khi gỡ ghim rồi ghim lại (005); có audit.
4. **Given** Chrome mở trang đăng nhập, **When** bấm liên kết "Tải chứng chỉ của thiết bị" (`/device.crt`), **Then** tải file `.crt` chỉ chứa chứng chỉ công khai; trang đăng nhập hiện fingerprint SHA-256 để so với giá trị trên thiết bị (lệnh `--cert-fingerprint`, Studio Thiết bị).
5. **Given** chứng chỉ đã nhập vào "Trusted Root Certification Authorities" của Windows làm theo hướng dẫn, **When** mở lại Chrome, **Then** không còn cảnh báo (kiểm tay, SC-019).
6. **Given** `mat-runtime --make-csr --san 192.168.1.110,scada.nhamay.local`, **When** chạy, **Then** khóa riêng mới ở lại trên thiết bị (`0600`), CSR (PEM) in ra hoặc ghi file; không có khóa riêng nào ra ngoài.
7. **Given** chứng chỉ do CA ký cho CSR đó, **When** `--import-cert chain.pem`, **Then** runtime kiểm khóa công khai khớp khóa riêng đang giữ, chuỗi đọc được, có ít nhất một SAN trùng IP hoặc hostname của thiết bị (không thì cảnh báo, không chặn); thay thế an toàn (ghi file tạm rồi đổi tên), khởi động lại HTTPS; có audit.
8. **Given** file chứng chỉ không khớp khóa, hỏng, hoặc có khóa riêng kèm trong file gửi nhầm, **When** nhập, **Then** từ chối, chứng chỉ đang dùng không đổi.
9. **Given** thiết bị đã nhập chứng chỉ CA, **When** Studio kết nối, **Then** fingerprint khác fingerprint đã ghim: Studio chặn như 005 và hướng dẫn ghim lại (không tự tin cậy).
10. **Given** địa chỉ truy cập không có trong SAN (ví dụ DHCP đổi IP), **When** mở trang, **Then** Chrome cảnh báo `NET::ERR_CERT_COMMON_NAME_INVALID`; tài liệu hướng dẫn nêu cách khắc phục (đặt IP tĩnh hoặc sinh lại chứng chỉ kèm IP mới); `system/info.warnings` có `TLS_SAN_MISMATCH` khi địa chỉ card hiện tại không nằm trong SAN.

---

### User Story 6 - Xem trước, thử và an toàn khi vận hành nhiều client (Priority: P3)

Kỹ sư thử dashboard trong Studio bằng Mô phỏng (không cần thiết bị), rồi bằng Thiết bị (dữ liệu thật). Trước khi giao cho khách, họ chạy bài thử: 10 máy cùng F5, rút cáp PLC, tắt mạng, đổi project khi đang có người xem và người đang ghi.

**Why this priority**: là phần đo độ vững và ngân sách (Constitution III, IV) và kiểm các tình huống hỏng; cần các story trước đã chạy.

**Independent Test**: `tools/web-it.ps1` (task tạo) chạy runtime x64 và 10 phiên Chrome headless; trên BL335 cần SSH (⚠️🔌).

**Acceptance Scenarios**:

1. **Given** 10 phiên Chrome mở cùng màn hình chuẩn (20 widget, 100 Tag), **When** cả 10 cùng F5, **Then** cả 10 hiện giá trị sống trong ≤ 5 s kể từ lúc F5 (SC-003); 0 lỗi 4429 do thiết bị dựng lại phiên chậm.
2. **Given** project đổi (Nạp xuống từ Studio), **When** BL335 chạy lại, **Then** các trang đang mở tự tải lại (005), giữ màn hình đang xem theo URL; người đang mở hộp xác nhận mất hộp (không gửi gì); phiên web vẫn còn (phiên nằm trong bộ nhớ và đi qua `execv`, như 005).
3. **Given** lệnh ghi đang bay trong lúc nạp xuống, **When** BL335 `quiesce` (006), **Then** trang hiện kết quả đúng (`REJECTED` "đang nạp project" hoặc kết quả cuối của lệnh đã gửi); không có lệnh nào được gửi lại.
4. **Given** mất mạng giữa trình duyệt và BL335 ngay sau khi gửi lệnh, **When** có mạng lại, **Then** widget hỏi kết quả theo mã yêu cầu và hiện kết quả thật; không gửi lại; nếu hỏi không được trong 30 s thì hiện "Không rõ kết quả, kiểm tra giá trị thực" và giữ khóa 10 s.
5. **Given** Chrome thu nhỏ hoặc tab ẩn 10 phút, **When** hiện lại, **Then** widget cập nhật về giá trị mới nhất trong ≤ 1 s; biểu đồ đường vẫn đủ điểm theo thời gian thực (khoảng ẩn nối đúng thời gian, không dồn).
6. **Given** Studio chế độ Thiết bị, **When** thử nút ghi trong xem trước, **Then** lệnh đi qua API của Studio (token Bearer), có audit kênh `studio`, giống Bảng theo dõi (006); chế độ Mô phỏng không có audit và không tới thiết bị.
7. **Given** BL335 chạy dashboard chuẩn với 10 client trong 30 phút, **When** đo, **Then** RSS ≤ 150 MB, CPU ≤ 30 % (SC-004).

---

### Edge Cases

**Mô hình màn hình và định dạng**

- Màn hình không có item nào: hợp lệ (nền trống), cảnh báo.
- Item nằm ngoài màn hình hoàn toàn: cảnh báo `W_ITEM_OUTSIDE` (Studio hiện viền cảnh báo); một phần ngoài: cắt khi vẽ.
- Hai item cùng id, id sai dạng, loại widget không có trong danh mục, khe Tag lạ, thuộc tính sai kiểu hoặc ngoài khoảng: lỗi kiểm tra.
- Màn hình `popup` làm màn hình đầu hoặc có trong menu: lỗi. Hành động mở popup trỏ tới màn hình `screen`: lỗi. Popup mở popup: thay popup hiện tại (D12).
- Màn hình đầu bị xóa, màn hình trỏ tới không có: lỗi tham chiếu, Nạp xuống bị khóa.
- `size` bằng 0 hoặc quá lớn: lỗi; `stretch` kèm widget: cảnh báo méo (D8).
- Hai item SVG dùng chung một file SVG: hợp lệ (hai bản dựng riêng, hai Shadow DOM); trùng `elementUid` giữa hai item SVG khác file: hợp lệ vì uid tính theo item.
- Màn hình mới hơn mức hiểu (`schemaVersion` 0.4 trở lên): runtime từ chối cả gói, Studio từ chối mở (như 006 FR-005).
- Project 0.3 có màn hình tham chiếu Tag không có: lỗi `E_TAG_REF`; Tag có nhưng sai kiểu khe: lỗi `E_WIDGET_TAG_TYPE`.
- File màn hình vượt 1 MiB hoặc > 250 item: lỗi giới hạn.
- Nâng cấp project 0.2 có màn hình lỗi sẵn: giữ lỗi, báo (như 006).
- Project 0.3 nạp xuống BL335 chạy runtime 0.5: dòng Tương thích runtime khóa nạp.

**Web runtime**

- Màn hình dài (cuộn) không có trong 3a: `fit-width` và `none` có cuộn (D8); `contain` không cuộn.
- Thanh trên và menu chiếm chỗ: màn hình co trong phần còn lại; menu thu gọn thành biểu tượng khi cửa sổ < 900 điểm ảnh.
- Tag trong 2 widget cùng màn hình hoặc cả popup và màn hình mẹ: đăng ký một lần, cùng giá trị.
- Màn hình vượt 1.000 Tag riêng biệt: lỗi kiểm tra (giới hạn đăng ký của giao thức live); popup cộng vào tổng khi mở: lỗi nếu tổng > 1.000.
- Tag lạ (thiết bị báo `unknown`): widget hiện "?" khóa; không làm hỏng màn hình.
- Chrome < 120: cảnh báo như hiện nay; không đảm bảo dựng được.
- Tab ẩn: gom cập nhật tạm dừng, về lại thì áp giá trị mới nhất một lần.
- Đồng hồ máy khách sai: không ảnh hưởng (mọi thời điểm hiển thị lấy từ BL335); biểu đồ dùng thời điểm BL335 gửi.
- Cửa sổ rất nhỏ (< 480 điểm ảnh): màn hình vẫn co, chữ có thể nhỏ; không hỗ trợ thiết kế đáp ứng (mobile là GĐ 6 trở đi).
- Nội dung chữ của project có ký tự HTML (`<`, `&`, `"`): luôn hiện dạng chữ, không bao giờ là HTML.
- Chữ dài hơn widget: cắt có dấu `…`, tooltip hiện đủ.

**Điều khiển và đăng nhập**

- Hộp xác nhận mở thì Tag đổi quality hoặc project đổi: hộp báo và không cho xác nhận khi điều kiện không còn (ví dụ quality BAD); đổi giá trị hiện tại thì hộp cập nhật dòng "hiện tại".
- Hai hộp xác nhận cùng lúc: không có; một widget điều khiển có hộp mở thì mọi điều khiển khác tạm khóa.
- Nhấp đúp nhanh hoặc nhấn Enter hai lần: lệnh thứ hai bị bỏ (đang gửi). Gửi lại cùng mã yêu cầu: BL335 chỉ thực hiện một lần (006).
- Tag `RW` nhưng `access` đổi thành `R` ở project mới khi trang đang mở: trang tải lại theo project mới; lệnh đang gửi theo định nghĩa trên BL335 (006).
- Ghi giá trị bằng đúng hiện tại: vẫn gửi và audit (như 006).
- Người vận hành mở trang ở hai tab: cùng cookie, cùng phiên; đăng xuất ở tab này làm tab kia khóa ở thao tác kế tiếp.
- Hai máy khác nhau cùng đăng nhập một tài khoản: hai phiên riêng, mỗi phiên gắn IP.
- Đổi IP máy khách (DHCP, Wi-Fi chuyển mạng) giữa phiên: `SESSION_INVALID`, đăng nhập lại.
- Máy khách đứng sau NAT/proxy cùng IP: nhiều người chia IP không phải vấn đề của phiên; khóa tạm theo IP (005) có thể khóa cả nhóm khi một người gõ sai nhiều lần (ghi vào tài liệu).
- Cookie bị trình duyệt chặn (chế độ chặn cookie): đăng nhập báo "Trình duyệt chặn cookie"; trang vẫn xem được.
- Chrome chế độ ẩn danh: cookie phiên vẫn dùng được; tắt cửa sổ thì mất phiên.
- Phiên web bị thu hồi khi tài khoản bị tắt, đổi role, hoặc đổi mật khẩu (`rev` của 005).
- Mất audit (bộ nhớ đầy): mọi lệnh ghi bị từ chối `AUDIT_UNAVAILABLE`; widget hiện lỗi đó.
- `pulseMs` mà runtime dừng giữa lúc chờ: lúc khởi động ghi `interrupted` (006); tài liệu khuyến nghị bit xung do PLC tự xóa; Studio cảnh báo khi chọn hành động Xung cho Tag có `readback` bật.
- Gửi lệnh qua WebSocket: vẫn `BAD_MESSAGE` (006); trang không dùng đường này.
- Quá tần suất ghi theo phiên: `REJECTED` `RATE_LIMITED`, widget hiện "Thử lại sau N giây".
- Cổng HTTPS tắt hoặc chứng chỉ lỗi (`cert-error`): trang HTTP vẫn xem được; điều khiển khóa với lý do "HTTPS không chạy"; `system/info` báo.

**Biểu đồ**

- Tag chuỗi vào biểu đồ đường, cột hoặc tròn: lỗi kiểm tra. Tag BOOL: vẽ 0 và 1.
- Giá trị rất lớn hoặc rất nhỏ làm trục Y vô nghĩa: trục tự co bằng khoảng phân vị 0–100 % của cửa sổ; min và max cố định đặt được.
- Trang ở nền lâu: mẫu theo giờ BL335, không dồn.
- Thay đổi cỡ widget biểu đồ: vẽ lại ≤ 100 ms, không mất dữ liệu.
- Bộ nhớ: bộ đệm là mảng số có kích thước cố định cho mỗi đường (3.600 điểm); đầy thì ghi đè điểm cũ nhất.

**Studio**

- Kéo item ra ngoài canvas: bị giữ trong vùng làm việc, cho phép ra ngoài màn hình tới 200 đơn vị (cảnh báo).
- Chọn nhiều loại widget khác nhau: inspector hiện thuộc tính chung (vị trí, kích thước, khóa, ẩn) và số lượng đã chọn; sửa thuộc tính chung áp cho cả nhóm.
- Dán JSON hay văn bản từ ngoài vào canvas: bỏ qua (chỉ nhận dữ liệu do Studio sao chép).
- Xem trước Thiết bị khi chưa Online: nút bị khóa kèm lý do.
- Studio mất kết nối thiết bị trong xem trước: widget STALE như trên Chrome.
- Project 0.2 chưa nâng cấp: mở chỉ đọc (như 006 D23); xem trước vẫn dùng được.
- Hai người cùng sửa một project (hai máy): không đồng sửa; quy trình So sánh/Nạp xuống của 005.
- Màn hình 250 item trong chế độ Chọn nhiều và kéo: vẫn đạt ngân sách của SC-013.

## Requirements *(mandatory)*

### Functional Requirements

**Định dạng project 0.3.0, nâng cấp, tương thích**

- **FR-001**: Định dạng project 0.3.0 MUST mô tả màn hình bằng: `id`, `name`, `kind` (`screen` hoặc `popup`), `size` (rộng, cao; đơn vị thiết kế; mặc định 1920 × 1080), `fitMode` (`contain`, `cover`, `stretch`, `fit-width`, `none`), `background` (màu), và `items` (mảng; thứ tự là thứ tự xếp lớp, đầu mảng ở dưới cùng). Mọi file của một project MUST mang cùng `schemaVersion` ([ADR-004](../../docs/adr/004-schema-versioning.md)). Project 0.3.0 MUST cần runtime tối thiểu 0.6.0.
- **FR-002**: Item `svg` MUST có `id`, `name`, vị trí và cỡ (`x`, `y`, `width`, `height`), `svgFile`, `bindingFile`, `viewBox`, `fit` (`contain`, `cover`, `stretch`) và danh sách `elements` (`elementUid`). Binding theo `elementUid` giữ nguyên ngữ nghĩa của 0.2 (target, transform, `valueTable`). Mỗi màn hình có tối đa 8 item `svg`; `elementUid` duy nhất trong phạm vi một item.
- **FR-003**: Item `widget` MUST có `id`, `name`, `widget` (loại trong danh mục), vị trí và cỡ, `locked`, `hidden`, `props` (thuộc tính tĩnh), `tags` (khe → id Tag), `events` (sự kiện → hành động) và `security` (FR-052). Id item duy nhất trong màn hình, khớp `^[a-z][a-z0-9_]{1,31}$`.
- **FR-004**: Danh mục widget `schemas/widgets.catalog.json` MUST là nguồn duy nhất cho: danh sách 15 loại, cỡ tối thiểu và mặc định, khe Tag (tên, bắt buộc hay không, kiểu Tag cho phép, cần quyền RW hay không), thuộc tính (tên, kiểu, khoảng, mặc định), sự kiện và hành động cho phép. Bộ kiểm tra của Studio (TS) và của runtime (C++) MUST đọc cùng danh mục và cho cùng kết luận trên bộ vector chung.
- **FR-005**: `project.json` 0.3 MUST có `navigation` (tùy chọn): `position` (`left`, `top`, `hidden`; mặc định `left`) và `items` (mục menu: nhãn, màn hình đích hoặc nhóm con một cấp, biểu tượng trong bộ có sẵn). Màn hình đích MUST là màn hình `screen` (không phải `popup`). Không có `navigation` thì runtime sinh menu từ danh sách `screens` theo thứ tự, loại popup.
- **FR-006**: Runtime 0.6.x MUST nhận project 0.1.x, 0.2.x và 0.3.x. Project 0.1/0.2 MUST chạy như trên runtime 0.5: trang xem hiểu màn hình cũ như một màn hình có một item `svg`, cho cùng DOM và giá trị binding. Project có `schemaVersion` mà runtime không hiểu MUST bị từ chối cả gói kèm lý do.
- **FR-007**: Khi mở project 0.2 (từ đĩa hoặc vừa đọc lên), Studio MUST đề nghị nâng cấp lên 0.3.0, nói những gì sẽ đổi và nơi giữ bản sao lưu, cho chọn Nâng cấp, Mở chỉ đọc hoặc Hủy (như 006 FR-003). Project 0.1 MUST được nâng qua 0.2 rồi 0.3 trong cùng một lần.
- **FR-008**: Nâng cấp 0.2 → 0.3 MUST chạy trong bộ nhớ, sao lưu file gốc ngay trước lần lưu đầu vào thư mục mới, cho cùng kết quả với cùng đầu vào (cặp file mẫu), và kiểm project sau nâng cấp. Mỗi màn hình cũ MUST thành một màn hình `screen` có `size` = rộng × cao của `viewBox`, `fitMode` giữ nguyên, một item `svg` phủ kín (`x = y = 0`, `fit` = `contain`), cùng `svgFile`, `bindingFile`, `elements`; `navigation` sinh theo FR-005 khi project có ≥ 2 màn hình.
- **FR-009**: Bộ kiểm tra hai bản MUST có thêm luật 0.3.0 và cho cùng kết luận, cùng mã lỗi trên bộ vector chung cho 0.1, 0.2 và 0.3.
  - **Lỗi:**
    - id trùng, sai dạng; loại widget lạ; khe Tag hoặc thuộc tính hoặc sự kiện lạ; kiểu, khoảng sai;
    - Tag không có, sai kiểu so với khe, thiếu quyền RW cho khe ghi; giới hạn của widget rộng hơn giới hạn của Tag;
    - hành động trỏ tới màn hình hay popup không có, hay sai loại; màn hình đầu là popup; menu trỏ tới popup;
    - `elementUid` của item `svg` không có trong file SVG đã khai; file SVG hoặc binding thiếu;
    - cỡ nhỏ hơn mức tối thiểu của loại, `size` ngoài khoảng;
    - quá giới hạn của FR-010; một màn hình tham chiếu quá 1.000 Tag riêng biệt (kể cả cộng popup mà nó mở);
    - widget điều khiển có `security.minRole` = `viewer`; widget điều khiển ghi Tag có `confirm` = `none` với Tag không phải BOOL;
    - hành động ghi trỏ tới Tag `calculated`, hoặc Tag `simulation` không nhập tay.
  - **Cảnh báo (không chặn):** item ngoài màn hình; màn hình rỗng; `stretch` có widget; widget điều khiển ghi Tag không có giới hạn nhập; `confirm` = `none`; hành động xung trên Tag bật đọc lại; biểu đồ vượt 8 đường; màn hình > 500 Tag riêng biệt; widget đè lên nhau hoàn toàn.

  Runtime MUST NOT kích hoạt project có lỗi (Constitution V).
- **FR-010**: Giới hạn: ≤ 32 màn hình mỗi project (cả popup); ≤ 250 item mỗi màn hình; ≤ 8 item `svg`; ≤ 16 biểu đồ mỗi màn hình; ≤ 8 đường mỗi biểu đồ đường, ≤ 12 Tag mỗi biểu đồ cột, ≤ 8 Tag mỗi biểu đồ tròn, ≤ 50 dòng mỗi bảng Tag; `size` trong 64–4.096 × 64–2.304; ≤ 32 mục menu (một cấp nhóm); file màn hình ≤ 1 MiB (trần chung của gói).
- **FR-011**: So sánh, Đọc lên và Xem trước Nạp xuống (005) MUST hiểu đối tượng mới: màn hình, item (theo id), `navigation`. Xem trước Nạp xuống MUST có thêm: tương thích (project 0.3 cần runtime ≥ 0.6.0), số màn hình, số widget điều khiển ghi Tag, và cảnh báo khi thiết bị Online không có HTTPS (`system/info.web.https` = false).
- **FR-012**: Gói `.matscada` giữ định dạng 1.0.0; tập file của project thêm các file của item `svg`; mọi file mới là `.json`, `.svg`.

**Trang runtime trên Chrome**

- **FR-013**: Trang runtime MUST có thanh trên (tên project, màn hình hiện tại, trạng thái kết nối, người dùng), menu điều hướng theo `navigation` và vùng màn hình. Project chỉ có một màn hình không hiện menu.
- **FR-014**: Màn hình MUST được dựng theo lớp: nền, rồi các item theo thứ tự `items`. Cả màn hình nằm trong một khung kích thước `size` và được co bằng một phép co duy nhất theo `fitMode`; mọi item MUST giữ vị trí và cỡ tương đối. Vùng chứa màn hình (cả phần thừa khi `contain`) MUST dùng `background` của màn hình. Đổi cỡ cửa sổ MUST cập nhật trong ≤ 100 ms.
- **FR-015**: Trang MUST giữ màn hình đang xem trong đường dẫn (`#/<id>`), hỗ trợ nút Back/Forward của Chrome, F5 giữ màn hình, và xử lý id không tồn tại (US1 kịch bản 5). Chế độ kiosk `?kiosk=1` MUST ẩn thanh trên và menu.
- **FR-016**: Popup MUST mở chồng lên màn hình bằng hành động, có nền mờ, giữ focus trong popup, đóng bằng nút Đóng, Esc hoặc (tùy chọn) nhấp nền. Chỉ một popup tại một thời điểm; chuyển màn hình thì đóng popup.
- **FR-017**: Trang MUST đăng ký live đúng tập Tag của màn hình đang mở (cộng popup khi mở), đổi đăng ký trên cùng kết nối khi chuyển màn hình (giao thức live 1.2.0 không đổi), không đăng ký quá 1.000 Tag.
- **FR-018**: Mọi widget MUST nhận giá trị, quality và lý do từ Tag. Quy tắc hiển thị chung: BAD = viền đỏ + nhãn "BAD" + giá trị cuối mờ; STALE (mất kết nối) = xám + nhãn "STALE"; UNCERTAIN = hổ phách; lý do trong tooltip. Màu không bao giờ là tín hiệu duy nhất (luôn kèm chữ hoặc biểu tượng). Tag mà thiết bị báo không có: widget hiện "?" và khóa.
- **FR-019**: Cập nhật giao diện MUST gom theo khung hình, chỉ cập nhật widget có giá trị đổi, tạm dừng khi tab ẩn và áp giá trị mới nhất khi hiện lại (≤ 1 s).
- **FR-020**: Trang MUST tải project theo kiểu lười: `projects/active` trả bản tóm tắt (project, Tag, bảng giá trị, danh sách màn hình, `navigation`), từng màn hình và file SVG tải khi cần qua `/project/…`; màn hình đầu tải song song với danh sách. Màn hình đã mở được giữ trong trang (tối đa 8) trong lúc trang còn mở.
- **FR-021**: Trang MUST giữ hành vi của 004/005/006: cảnh báo Chrome < 120, banner kết nối (4429, mất kết nối), tự tải lại khi project đổi (giữ hash), không mở kết nối live khi thiết bị chưa có project hợp lệ, lọc nguồn `viewerAccess`.
- **FR-022**: Trang MUST NOT dùng `innerHTML`, `eval`, `new Function` hay chèn dữ liệu project dạng HTML; chữ trong `props`, tên Tag và mô tả luôn là chữ. Trang MUST chạy đúng dưới CSP hiện có của runtime (không script nội tuyến).
- **FR-023**: Lỗi của một màn hình (file hỏng, thiếu) MUST chỉ ảnh hưởng màn hình đó; menu và màn hình khác vẫn dùng được.
- **FR-024**: Tải khởi động của trang (JavaScript và CSS, trước khi mở màn hình) MUST ≤ 250 KB nén gzip; biểu đồ đường tải lười, thêm ≤ 100 KB nén. Chuỗi giao diện tiếng Việt tách file riêng.

**Thư viện widget**

- **FR-025**: `packages/ui-components` MUST chứa 15 widget dạng web component (Lit, Shadow DOM mỗi widget), dùng chung cho trang runtime và xem trước của Studio:
  - **Hiển thị:** `card` (card giá trị), `label` (nhãn chữ), `lamp` (đèn báo), `gauge` (đồng hồ kim), `level` (thanh mức), `panel` (khung nền có tiêu đề);
  - **Biểu đồ:** `line` (đường thời gian thực), `bar` (cột), `pie` (tròn/donut);
  - **Bảng:** `tag-table` (bảng Tag sống);
  - **Điều khiển:** `button`, `switch`, `setpoint` (ô nhập setpoint), `slider`, `select` (danh sách chọn theo bảng giá trị).

  Widget MUST NOT truy cập mạng hay Tauri; mọi dữ liệu vào qua giao diện `TagSource` và mọi tác động ra qua giao diện `ActionHost` do nơi chứa (trang runtime, xem trước Studio) cung cấp (Constitution II).
- **FR-026**: `card`: nhãn, giá trị (số lẻ 0–6; đơn vị của Tag nếu không đặt), chấm quality, nền; màu giá trị theo bảng giá trị của Tag hoặc đặt tay. `label`: chữ tĩnh, tùy chọn gắn Tag để hiện giá trị chữ (STRING hoặc qua bảng giá trị). `lamp`: BOOL hoặc số qua bảng giá trị, hình tròn hoặc vuông, nhãn; màu từ bảng giá trị hoặc cặp màu bật/tắt; có chữ trạng thái đi kèm.
- **FR-027**: `gauge`: min/max, kim, vùng màu theo khoảng (≤ 4 vùng), giá trị số và đơn vị. `level`: dọc hoặc ngang, min/max, màu theo khoảng, hiện % và giá trị. `panel`: khung và tiêu đề, không Tag, không nhận sự kiện.
- **FR-028**: `button`: nhãn, sự kiện `click` với một hành động (FR-033). `switch`: Tag BOOL RW; trạng thái hiện là giá trị thật đọc từ Tag, khi vừa gửi hiện "đang chuyển" tới khi đọc lại khớp hoặc hết thời gian. `setpoint`: Tag số RW; min, max, bước, số lẻ; Enter để ghi. `slider`: Tag số RW; min, max, bước; thả để ghi, giá trị thật hiện cạnh giá trị đang kéo. `select`: Tag số hoặc BOOL RW với bảng giá trị; chọn một mục để ghi.
- **FR-029**: Biểu đồ đường MUST có ≤ 8 đường, cửa sổ 10–3.600 s, chu kỳ lấy mẫu ≥ 250 ms (mặc định 1 s), trục thời gian, trục Y tự co hoặc min/max cố định, chú giải, con trỏ đọc giá trị; mỗi đường có màu và kiểu nét khác nhau; Tag BAD tạo khoảng đứt. Dữ liệu chỉ nằm trong trình duyệt, bộ đệm 3.600 điểm mỗi đường (ghi đè điểm cũ nhất), mất khi chuyển màn hình hoặc F5 (D20).
- **FR-030**: Biểu đồ cột (≤ 12 Tag, dọc hoặc ngang, min/max) và biểu đồ tròn (≤ 8 Tag số ≥ 0, donut tùy chọn, % và nhãn) MUST xử lý rỗng, BAD, âm, tổng bằng 0 như US4 kịch bản 6. Bảng Tag sống MUST hiện nhãn, giá trị (qua bảng giá trị nếu có), đơn vị, quality, thời điểm cập nhật cho ≤ 50 Tag; sắp xếp tại chỗ.
- **FR-031**: Mỗi widget MUST: có vai trò ARIA và tên truy cập (`aria-label` từ nhãn hoặc tên); cập nhật giá trị bằng vùng thông báo lịch sự (`aria-live="polite"`, giới hạn tần suất) chỉ cho kết quả điều khiển; dùng được bằng bàn phím (điều khiển); tương phản chữ ≥ 4,5:1 ở cả hai theme; dùng token màu của hệ thống thiết kế (sáng/tối).
- **FR-032**: Định dạng giá trị (số lẻ, đơn vị, bảng giá trị, chuỗi) MUST do một hàm dùng chung trong `packages/ui-components` hoặc `@mat/binding-engine`, để card, bảng, nhãn và xem trước cho cùng chữ.

**Điều khiển, đăng nhập và phiên web**

- **FR-033**: Hành động của widget MUST là một trong: `write` (đặt giá trị: Tag, giá trị), `toggle` (đảo Tag BOOL), `pulse` (xung: Tag BOOL, giá trị, thời gian 100–10.000 ms), `navigate` (màn hình), `popup` (màn hình popup), `closePopup`. Không có hành động nào khác và không có script. Hành động ghi (`write`, `toggle`, `pulse`) chỉ có ở widget điều khiển; chỉ `button` có `navigate`, `popup`, `closePopup`.
- **FR-034**: Mọi hành động ghi MUST đi qua `POST /api/v1/tags/write` của 006 trên HTTPS; MUST NOT có đường ghi mới và MUST NOT ghi qua WebSocket. Trang MUST sinh mã yêu cầu UUID v4 mỗi lần xác nhận, hỏi kết quả mỗi 200 ms tới kết quả cuối hoặc 30 s, không bao giờ tự gửi lại.
- **FR-035**: Hộp xác nhận MUST hiện: Tag, mô tả, thiết bị trường, giá trị hiện tại, giá trị mới (có đơn vị, qua bảng giá trị nếu có), giới hạn, tài khoản đang đăng nhập; nút Hủy có focus ban đầu; Enter chỉ kích hoạt nút đang có focus. `confirm` mặc định `always`; chỉ cho `none` với nút và công tắc ghi Tag BOOL (cảnh báo khi dùng); ô setpoint, thanh trượt, danh sách chọn, hành động ghi số hoặc chuỗi luôn có xác nhận.
- **FR-036**: Trạng thái và kết quả MUST hiển thị tại widget: "Đang gửi…" (widget khóa), rồi `ACCEPTED` (đang chờ đọc lại), `CONFIRMED` (xanh, tự mất sau 4 s), `REJECTED` (đỏ + lý do), `TIMEOUT` (hổ phách: "không chắc đã ghi, kiểm tra giá trị thực"), `FAILED` (đỏ + mã). Lỗi nằm lại tới khi đóng. Lý do dùng bảng mã của 006 (data-model §8, §9) dịch sang tiếng Việt. Kết quả đi vào vùng `aria-live`.
- **FR-037**: Widget điều khiển MUST tự khóa kèm lý do hiện được khi: chưa có phiên hoặc role < `security.minRole`; trang mở bằng HTTP; HTTPS không chạy; live mất kết nối (STALE); Tag đích BAD, STALE hoặc chưa có giá trị; Tag không RW hoặc không có trên thiết bị; có lệnh đang gửi của widget; có hộp xác nhận đang mở ở widget khác. UNCERTAIN không khóa nhưng hộp xác nhận cảnh báo. BL335 vẫn là lớp quyết định: khóa ở trang chỉ để tiện dùng.
- **FR-038**: Trang runtime MUST chạy được qua HTTPS (cổng `httpsPort`, mặc định 8443) với đầy đủ chức năng. Qua HTTP (8080) trang ở chế độ chỉ xem và MUST hiện liên kết sang HTTPS cùng địa chỉ. Cookie phiên MUST NOT bao giờ được đặt hay chấp nhận qua HTTP.
- **FR-039**: Đăng nhập: `GET /login` (trang tĩnh), `POST /api/v1/web/login` (tên, mật khẩu NFC như Studio). Thành công MUST đặt cookie `__Host-mat_sid` (`HttpOnly; Secure; SameSite=Strict; Path=/`, không `Domain`, không `Max-Age`) chứa token phiên mới (không nhận token do client đặt) và trả `csrfToken`, tên, role, hạn trong thân. Dùng chung tài khoản, băm Argon2id, khóa tạm (5 lần sai → 5 phút theo tên và theo IP), audit, thông báo lỗi và `AuthService` của 005.
- **FR-040**: Phiên web MUST: hết hạn sau 30 phút không thao tác (đặt được 5–480 phút bằng `webSessionIdleMin`), tối đa 12 giờ, gắn IP lúc đăng nhập, mặc định tối đa 8 phiên web đồng thời (đặt được 1–16 bằng `webMaxSessions`; nằm trong trần 32 của 005); bị hủy khi tài khoản bị tắt, đổi role hoặc đổi mật khẩu (`rev`); đi qua `execv` khi nạp xuống như phiên của 005. `POST /api/v1/web/logout` MUST hủy phiên ở BL335 và xóa cookie. `GET /api/v1/web/session` MUST trả tên, role, hạn và `csrfToken` cho phiên hợp lệ (cho F5), 401 khi không.
- **FR-041**: Mọi yêu cầu `POST` dùng cookie MUST kèm header `X-MAT-CSRF` khớp token của phiên (so hằng thời gian) và header `Origin` đúng bằng origin của trang (thiếu hay lạ: từ chối). Thất bại: 403 `CSRF_FAILED` hoặc `ORIGIN_MISMATCH`, ghi audit `access.denied` (gộp 60 s), không thực hiện gì.
- **FR-042**: Cookie phiên web MUST chỉ nhận ở các endpoint của trang runtime: `web/*`, `tags/write` và `tags/write/{id}`, `GET /api/v1/projects/active`, `/project/*`, `system/info`, `GET /api/v1/device/identity`, nâng cấp WebSocket `/api/v1/live`. Mọi API kỹ thuật còn lại (nạp xuống, đọc lên, audit, Thử kết nối, cổng serial, chẩn đoán driver, tài khoản) MUST từ chối cookie bằng 403 `SESSION_SCOPE` kể cả với tài khoản engineer hay administrator; Studio tiếp tục dùng token Bearer. Cùng một request mang cả cookie và Bearer: dùng Bearer, bỏ qua cookie.
- **FR-043**: Nâng cấp WebSocket mang cookie MUST yêu cầu header `Origin` đúng bằng origin của trang (khác ADR-006 điểm 7, nơi bỏ trống `Origin` được nhận); phiên hợp lệ được coi như phiên hợp lệ của ADR-018 (không bị lọc nguồn, kiểm lại mỗi 60 s, đóng 4401 khi hết hạn).
- **FR-044**: `viewerLogin` trong `runtime.json` MUST có hai giá trị: `off` (mặc định; trang xem và dữ liệu không cần đăng nhập, theo `viewerAccess` của ADR-018) và `required` (mọi trang, `/project/*`, `projects/active`, `system/info` ngoài mức tối thiểu và live đều cần phiên web hoặc Bearer; trang HTTP chỉ trả trang hướng dẫn mở bằng HTTPS). Đổi giá trị cần khởi động lại runtime.
- **FR-045**: Ghi từ web MUST theo đúng chuỗi kiểm của 006 FR-037 (HTTPS, phiên, role ≥ operator, Tag tồn tại, RW, giới hạn nhập, kết nối, tần suất, hàng đợi) và audit bền trước khi gửi; viewer, khách, HTTP, CSRF sai: từ chối và có audit `tag.write` `denied`. Audit của lệnh ghi từ web MUST có `channel` = `web` và (khi trang gửi) `screen` và `widget` đã phát lệnh (chỉ là gợi ý để điều tra, không dùng để cấp quyền).
- **FR-046**: API ghi (API 1.2.0, MINOR) MUST nhận thêm các trường tùy chọn trong mỗi yêu cầu: `context` (`screen`, `widget`: chuỗi ≤ 64 byte dạng id), `expect` (giá trị hiện tại mà người dùng đã thấy; chỉ cho Tag BOOL: nếu khác giá trị hiện tại của Tag thì `REJECTED` `STALE_EXPECTATION`, không có gì gửi tới PLC), và `pulseMs` (100–10.000; chỉ cho Tag BOOL RW).
- **FR-047**: Với `pulseMs`, BL335 MUST ghi `value`, chờ `pulseMs` rồi ghi giá trị ngược lại, kể cả khi trình duyệt đóng; kết quả `CONFIRMED` chỉ sau khi cả hai lần ghi xong; lần ghi trả về thất bại MUST là `FAILED` mã `PULSE_RELEASE_FAILED` kèm audit và cảnh báo đỏ ở widget "bit lệnh có thể đang ở giá trị bật". Runtime dừng giữa chừng: ghi `interrupted` lúc khởi động (như 006).
- **FR-048**: Tài khoản web MUST là tài khoản của 005 (quản lý bằng lệnh trên BL335). `viewer` đăng nhập được nhưng không điều khiển được. Không có đăng ký, quên mật khẩu hay quản lý tài khoản trên trang.
- **FR-049**: Mọi phản hồi của endpoint web MUST có `Cache-Control: no-store` và `X-Content-Type-Options: nosniff`; `Set-Cookie` MUST có đủ thuộc tính của FR-039; trang MUST NOT lưu mật khẩu, token phiên hay CSRF token trong `localStorage`, `sessionStorage` hay URL (CSRF token chỉ trong bộ nhớ của trang).
- **FR-050**: Giới hạn tần suất ghi theo phiên và toàn BL335 của 006 MUST áp cho phiên web; widget MUST hiện "Thử lại sau N giây" khi `REJECTED` `RATE_LIMITED`.
- **FR-051**: Hộp Đăng nhập MUST dùng được bằng bàn phím, không tự điền mật khẩu bằng thuộc tính mơ hồ, đặt `autocomplete` đúng (`username`, `current-password`) để trình quản lý mật khẩu của Chrome dùng được.
- **FR-052**: Mỗi widget điều khiển MUST có `security.minRole` (`operator` mặc định; `operator`, `engineer`, `administrator`) để khóa ở trang và để Studio hiện; quyết định cuối ở BL335 theo bảng quyền của 005 (ghi Tag cần operator). Không có quyền xem theo từng màn hình: dữ liệu live không lọc theo màn hình, nên đó là lớp giả (D12).

**Chứng chỉ HTTPS**

- **FR-053**: Chứng chỉ tự ký do runtime sinh MUST có SAN gồm hostname hợp lệ (nếu có) và địa chỉ IPv4 của mọi card mạng lúc sinh. Chứng chỉ sinh bởi 0.5 (không SAN IP) MUST không tự đổi; `system/info.warnings` và `deploy.sh` MUST nêu `TLS_NO_IP_SAN`; khi địa chỉ card hiện tại không có trong SAN: `TLS_SAN_MISMATCH`.
- **FR-054**: `GET /device.crt` (HTTPS, không cần đăng nhập, không bị lọc nguồn) MUST trả chứng chỉ công khai của thiết bị dạng `.crt` (PEM) và chỉ chứa chứng chỉ; trang `/login` MUST hiện fingerprint SHA-256 và liên kết tải.
- **FR-055**: Runtime MUST có lệnh `--make-csr [--san <danh sách>]` (sinh khóa mới, ghi CSR; khóa riêng chỉ nằm trên thiết bị, `0600`) và `--import-cert <file>` (kiểm khớp khóa, đọc được chuỗi, SAN có ít nhất một IP hoặc hostname của thiết bị khi không thì cảnh báo; từ chối file có khóa riêng hoặc hỏng; thay bằng ghi tạm rồi đổi tên; khởi động lại HTTPS; audit). Hai lệnh chạy bằng root, như `--regen-cert` của 005.
- **FR-056**: Tài liệu `docs/deployment/mat-runtime.md` MUST có mục HTTPS cho Chrome: cài chứng chỉ thiết bị vào kho gốc của Windows (thủ công và qua Group Policy), quy trình CA khách hàng (CSR → ký → nạp), đặt IP tĩnh hoặc sinh lại khi đổi IP, kiểm bằng Chrome, và nhắc VPN cho truy cập từ xa.
- **FR-057**: `deploy.sh` MUST in lời nhắc khi nâng lên 0.6 lần đầu: cần tài khoản operator để điều khiển trên Chrome, `TLS_NO_IP_SAN` (nếu có), `viewerLogin`.

**Studio: trình bố trí màn hình**

- **FR-058**: Editor Màn hình MUST thay xem trước màn hình của 004: canvas có thước, lưới (bật/tắt, cỡ 5–100 đơn vị), zoom 10–400 %, pan (Space+kéo, chuột giữa), Vừa khung, vị trí con trỏ trên thanh trạng thái; bắt dính lưới và đường gióng với item khác (ngưỡng 6 điểm ảnh màn hình); Alt tắt bắt dính.
- **FR-059**: Chọn MUST gồm: nhấp, Shift/Ctrl+nhấp, kéo khung chọn, Ctrl+A, Tab (duyệt theo thứ tự lớp), chọn trong panel Lớp. Item khóa không chọn được trên canvas.
- **FR-060**: Di chuyển bằng chuột và phím mũi tên (1; Shift 10); đổi cỡ bằng 8 tay nắm (Shift giữ tỉ lệ) và bằng ô số trong inspector; cỡ không nhỏ hơn mức tối thiểu của loại; sao chép, dán, nhân bản (Ctrl+C, V, D), xóa; dán tạo id mới và lệch 20 đơn vị.
- **FR-061**: Căn chỉnh MUST gồm: căn trái, giữa, phải, trên, giữa dọc, dưới; phân bố đều ngang, dọc (≥ 3 item); cùng rộng, cùng cao. Xếp lớp MUST gồm: đưa lên trên, đưa xuống dưới, lên một, xuống một, và kéo trong panel Lớp; panel Lớp có đổi tên, ẩn, khóa.
- **FR-062**: Toolbox MUST liệt kê 15 widget theo nhóm Hiển thị, Biểu đồ, Bảng, Điều khiển; kéo thả vào canvas hoặc nhấp đúp (thêm vào tâm vùng nhìn). Studio 3a MUST NOT thêm item `svg` mới (import SVG là GĐ 3b); item `svg` có sẵn di chuyển, đổi cỡ, xếp lớp, ẩn, khóa được.
- **FR-063**: Inspector MUST có các nhóm Chung, Hiển thị, Gắn Tag, Sự kiện, Bảo mật, sinh từ danh mục widget (FR-004); chọn nhiều item thì hiện thuộc tính chung. Sửa trong inspector MUST kiểm ngay và hiện lỗi theo ô.
- **FR-064**: Kéo Tag từ cây, Details hoặc Bảng Tag thả vào ô gắn Tag của inspector, hoặc thả lên widget trên canvas (gắn vào khe chính của widget), MUST gắn khe sau khi kiểm kiểu và quyền; không hợp thì từ chối kèm lý do. Gắn Tag MUST đề xuất đơn vị, bảng giá trị, min/max của Tag cho widget.
- **FR-065**: Hoàn tác và làm lại MUST tới 100 bước dùng cơ chế lịch sử của Studio; kéo hay đổi cỡ liên tục, nhân bản nhiều item, căn chỉnh là một bước.
- **FR-066**: Quản lý màn hình trên cây MUST gồm: thêm (`screen` hoặc `popup`), đổi tên, nhân bản, xóa, đặt màn hình đầu, đổi loại, đặt `size`, `fitMode`, nền. Xóa màn hình đang được tham chiếu MUST liệt kê chỗ dùng và hỏi xác nhận. Editor Điều hướng MUST sửa được `navigation` (FR-005) bằng kéo sắp xếp.
- **FR-067**: Xem trước MUST có ba chế độ như 004, 006: Tắt, Mô phỏng (SimEngine của 006), Thiết bị (dữ liệu của thiết bị Online, viền cam). Widget MUST chạy bằng cùng `@mat/ui-components` và cùng logic hiển thị của trang runtime. Điều khiển trong xem trước MUST có hộp xác nhận như trên Chrome: ở Mô phỏng ghi vào SimEngine; ở Thiết bị đi qua API Bearer của Studio (audit kênh `studio`).
- **FR-068**: Kiểm tra MUST chạy liên tục trong worker; lỗi và cảnh báo theo item MUST hiện ở tab Thông tin của inspector, viền trên canvas, và nhấp đôi chọn item. Lưu MUST được khi còn lỗi; Nạp xuống bị khóa khi còn lỗi.
- **FR-069**: Đổi tên Tag MUST cập nhật mọi khe Tag, hành động và cột của widget trong mọi màn hình (cùng một bước hoàn tác); "Dùng ở đâu" của Tag MUST liệt kê widget và màn hình.
- **FR-070**: Định dạng ghi file màn hình MUST ổn định: thứ tự khóa chuẩn, mỗi item một khối gọn, cùng đầu vào cho cùng byte (để diff và So sánh); không ghi trường bằng mặc định.
- **FR-071**: Editor MUST theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5 và §7: token màu, theme sáng/tối, ARIA cho cây, danh sách lớp, thanh công cụ; mọi lệnh có phím tắt hoặc vào được bằng bảng lệnh (Ctrl+Shift+P); di chuyển bằng bàn phím (Tab, mũi tên, Enter, Delete). Mockup [studio-screens.html](../../docs/architecture/mockups/studio-screens.html) là bố cục chuẩn.
- **FR-072**: Studio MUST chặn Nạp xuống project 0.3 lên BL335 chạy runtime < 0.6.0, và mọi chức năng Online hiện có (005, 006) MUST không hồi quy.

**Chất lượng và tài liệu**

- **FR-073**: Test viết trước (Constitution VI): vector chung TS/C++ cho validator 0.3 (≥ 120 ca; mã lỗi và cảnh báo của FR-009); cặp file nâng cấp 0.2 → 0.3; vector danh mục widget; kiểm hình học (căn chỉnh, bắt dính, đổi cỡ, phân bố); mô hình cửa sổ biểu đồ (bộ đệm vòng, đứt đoạn khi BAD, lấy mẫu); định dạng giá trị; máy trạng thái điều khiển (khóa, xác nhận, kết quả).
- **FR-074**: Test C++ MUST có: phiên web (tạo, hết hạn idle và max, IP, hủy, quota 8), CSRF và Origin, phạm vi cookie, cookie trên HTTP, nâng cấp WebSocket mang cookie (Origin bắt buộc, kiểm lại 60 s), `expect`, `pulseMs` (kể cả khi client đóng và khi runtime dừng giữa lúc chờ), `context` trong audit, SAN, `--make-csr`, `--import-cert`, `viewerLogin`.
- **FR-075**: Test tích hợp x64 (`tools/web-it.ps1`) MUST có: nhiều màn hình, F5, popup; đăng nhập, ghi từ Chrome headless; tấn công CSRF, Origin, cookie trên HTTP, cookie vào API kỹ thuật, CSWSH, cố định phiên, XSS qua `props`; 10 phiên cùng F5; đổi project khi đang xem và đang ghi; đo thời gian mở màn hình, RSS, CPU.
- **FR-076**: e2e Chrome headless (lớp Tauri giả, axe-core) MUST có: dựng dashboard ≥ 20 widget đủ 15 loại trong Studio, kéo thả, căn chỉnh, hoàn tác, xem trước, đối chiếu quy tắc studio-ux §5.
- **FR-077**: Rà soát bảo mật MUST làm trước khi đóng feature: cookie và phiên, CSRF, Origin, CSWSH, cố định phiên, XSS, clickjacking (`frame-ancestors 'none'` giữ nguyên), brute force, lộ thông tin ở `system/info` và `device.crt`, phạm vi cookie.
- **FR-078**: Mọi thư viện mới MUST rà license, phiên bản phát hành ≥ 2 tuần, ghi `third_party/LICENSES.md`; ngoài uPlot (ADR-020) không thêm thư viện nào cho runtime hay Studio.
- **FR-079**: Tài liệu MUST có: README của `packages/ui-components` (danh mục widget, khe, thuộc tính, hành động), hướng dẫn thiết kế màn hình trong `apps/studio/README.md`, mục HTTPS cho Chrome trong `docs/deployment/mat-runtime.md`, báo cáo `docs/reports/007-acceptance.md`, ADR 013, 019–022.

### Key Entities

- **Màn hình**: id, tên, loại (`screen`/`popup`), cỡ thiết kế, cách co, nền, danh sách item có thứ tự.
- **Item `svg`**: id, tên, vị trí và cỡ, file SVG, file binding, `viewBox`, cách vừa khung, danh sách `elementUid`.
- **Item `widget`**: id, tên, loại, vị trí và cỡ, khóa, ẩn, thuộc tính tĩnh, khe Tag, sự kiện và hành động, bảo mật.
- **Danh mục widget**: định nghĩa 15 loại (khe, thuộc tính, sự kiện, cỡ).
- **Điều hướng**: vị trí menu, các mục (nhãn, màn hình đích, nhóm, biểu tượng).
- **Hành động**: loại (`write`, `toggle`, `pulse`, `navigate`, `popup`, `closePopup`) và tham số.
- **Phiên web**: mã phiên (trong cookie), token CSRF, tài khoản, role, IP, thời điểm tạo và hoạt động cuối, hạn.
- **Lệnh điều khiển (phía trang)**: mã yêu cầu, widget, Tag, giá trị, trạng thái (đang gửi → kết quả của 006).
- **Chứng chỉ thiết bị**: chứng chỉ, khóa riêng (chỉ trên thiết bị), SAN, fingerprint, nguồn (tự ký hay CA).
- **Dữ liệu biểu đồ (trên trình duyệt)**: bộ đệm vòng theo đường, thời điểm và giá trị.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Nghiệm thu của lộ trình (§4.3)**

- **SC-001**: Một kỹ sư dựng dashboard ≥ 20 widget (đủ 15 loại) từ project có sẵn Tag hoàn toàn trong Studio, 0 dòng JSON viết tay; Kiểm tra không lỗi; Nạp xuống BL335; mở trên Chrome: 100 % widget hiện giá trị đúng với Tag; Đọc lên rồi So sánh cho "giống".
- **SC-002**: Mở màn hình chuẩn (20 widget, 1 item SVG, 100 Tag) ≤ 2 s từ lúc bấm menu hoặc nhập địa chỉ (bộ nhớ đệm trống) tới lúc hiện giá trị sống đầu tiên, trên Chrome ở LAN tới BL335. Chuyển giữa hai màn hình đã mở một lần ≤ 500 ms.
- **SC-003**: 10 client cùng F5 màn hình chuẩn: cả 10 hiện giá trị sống ≤ 5 s kể từ lúc F5, đo trên BL335; 0 phiên bị 4429 do dựng phiên chậm.
- **SC-004**: Trên BL335, 10 client xem màn hình chuẩn 30 phút với 500 Tag mô phỏng/1 s (tải của 006 SC-003): CPU trung bình ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence.
- **SC-005**: 100 % lệnh ghi từ web của khách, viewer, gửi qua HTTP, thiếu hoặc sai CSRF, sai Origin, và qua kênh live bị từ chối; nhật ký của giả lập cho thấy 0 lệnh tới thiết bị trường; 100 % có audit đủ trường.
- **SC-006**: Operator ghi từ Chrome: ≥ 95 % lệnh Tag ngoài hiện `CONFIRMED` ≤ 2 s sau khi xác nhận (LAN); 100 % lệnh có audit đủ trường của 006 cộng `channel` = `web` và `screen`, `widget` khi trang gửi; 0 lệnh thực hiện hai lần.

**Bảo mật**

- **SC-007**: Bộ ca tấn công (thiếu token CSRF, token sai, token của phiên khác, `Origin` lạ, thiếu `Origin`, cookie trên HTTP, cookie vào mọi API kỹ thuật, `GET` đổi trạng thái, đặt cookie phiên từ client, CSWSH không `Origin`, phiên cũ sau đăng xuất): 100 % bị từ chối, 0 thay đổi, 100 % có audit hoặc đếm theo quy tắc gộp 60 s của 005.
- **SC-008**: Phiên: hết hạn rảnh, hết hạn tối đa, đổi IP, đăng xuất, tắt tài khoản, đổi role, đổi mật khẩu: 100 % ca đúng; 0 lệnh chạy bằng phiên đã hết; cookie có đủ thuộc tính (kiểm tự động trên mọi phản hồi `Set-Cookie`).
- **SC-009**: Bộ ca khóa điều khiển (viewer, chưa đăng nhập, HTTP, HTTPS không chạy, mất live, BAD, STALE, chưa có giá trị, Tag lạ, Tag R, đang gửi, hộp xác nhận khác đang mở): 100 % ca khóa đúng và hiện đúng lý do; UNCERTAIN cảnh báo, không khóa.
- **SC-010**: Hành động xung: 20/20 lần BL335 ghi giá trị ngược lại sau `pulseMs` (sai lệch ≤ 1 chu kỳ ghi + 100 ms) khi đóng trình duyệt ngay sau khi xác nhận; 20 lần giết runtime giữa lúc chờ: 0 lệnh không có audit; mọi lệnh dở được ghi "không rõ kết quả".
- **SC-019**: Sau khi cài chứng chỉ theo hướng dẫn (Windows 11, Chrome ≥ 120), mở HTTPS bằng IP của thiết bị không có cảnh báo; với chứng chỉ do CA thử ký qua `--make-csr`/`--import-cert` cũng không có cảnh báo; 100 % ca nhập chứng chỉ sai (không khớp khóa, hỏng, có khóa riêng) bị từ chối mà chứng chỉ đang dùng không đổi. Phần thử trên Windows và BL335 thật cần người và thiết bị.
- **SC-020**: Nội dung `props` và tên chứa `<script>`, `"><img onerror>`, `javascript:`, `&lt;`: 100 % hiện dạng chữ; 0 `innerHTML` hay `eval` ở `apps/runtime-web` và `packages/ui-components` (kiểm bằng lint và grep trong CI).

**Tương thích và chất lượng**

- **SC-011**: 100 % project 0.1 và 0.2 mẫu (gồm `tank-demo`, `modbus-demo`) chạy trên runtime 0.6 cho cùng DOM và giá trị binding như runtime 0.5; 100 % nâng cấp được sang 0.3 và bản nâng cấp hợp lệ, hiển thị giống bản gốc (sai lệch ảnh chụp ≤ 1 % số điểm ảnh).
- **SC-012**: Bộ vector chung ≥ 120 ca cho validator 0.3: Studio (TS) và runtime (C++) cho cùng kết luận và mã ở 100 % ca; 100 % vector 0.1 và 0.2 hiện có giữ nguyên kết luận.
- **SC-017**: 8 biểu đồ × 8 đường × 3.600 điểm chạy 30 phút trên Chrome (máy dev): bộ nhớ tab ở phút 30 không lớn hơn phút 5 quá 100 MB; p95 thời gian vẽ mỗi khung ≤ 8 ms.
- **SC-018**: Điểm dữ liệu của biểu đồ đường khớp giá trị Tag lúc lấy mẫu ở 100 % mẫu (Tag mô phỏng tất định); khoảng đứt xuất hiện ở 100 % lần quality BAD.
- **SC-021**: Không hồi quy: mọi kiểm tra tự động của 004, 005, 006 vẫn đạt; trang xem 0.2 từ mạng riêng không đổi hành vi; Bảng theo dõi và ghi từ Studio (006) không đổi.
- **SC-022**: Trang chạy đúng trên Chrome ≥ 120 (bản ổn định hiện tại và 120 hoặc bản cũ nhất thử được); danh sách phiên bản đã thử ghi trong báo cáo.
- **SC-024**: Tải khởi động của trang ≤ 250 KB nén gzip; biểu đồ đường thêm ≤ 100 KB (đo bằng bản build thiết bị).

**Studio**

- **SC-013**: Trình bố trí: mở màn hình 250 item ≤ 1 s; kéo 100 item cùng lúc giữ trung bình ≤ 16,7 ms mỗi khung (máy dev); hoàn tác ≤ 100 ms; kiểm tra sau một lần sửa hiện lỗi ≤ 500 ms.
- **SC-014**: Bộ ca hình học (căn chỉnh 6 kiểu, phân bố đều ngang/dọc, cùng rộng/cao, bắt dính lưới, đường gióng, đổi cỡ giữ tỉ lệ, kéo nhiều item, xếp lớp): 100 % cho đúng kết quả.
- **SC-015**: Kiểm trợ năng tự động: 0 lỗi critical hoặc serious ở editor Màn hình và trang runtime, theme sáng và tối; tương phản chữ ≥ 4,5:1; 100 % lệnh dùng được chỉ bằng bàn phím.
- **SC-016**: Các editor mới đạt 100 % quy tắc studio-ux.md §5 (bảng đối chiếu từng quy tắc) và khớp bố cục của mockup `studio-screens.html`.
- **SC-023**: Một kỹ sư chưa dùng editor Màn hình làm trọn trong ≤ 15 phút, không cần tài liệu: thêm màn hình, thêm card, nút và biểu đồ, gắn Tag bằng kéo thả, xem trước bằng Mô phỏng, Nạp xuống. Không có người thử thì ghi là tự đo, như 004.

## Assumptions

### Quyết định đã chốt trước khi viết spec

Phiên chính chốt các điểm này theo lộ trình v2 (duyệt ngày 2026-10-11) và các quyết định của 006.

- **D1. GĐ 3a là một feature** (`007-screens-widgets`). Lý do: mô hình màn hình, thư viện widget, trang runtime và trình bố trí gắn chặt; tách ra thì feature nào cũng phải đổi định dạng màn hình.
- **D2. Mô hình màn hình v1:** item `svg` và item `widget` xếp lớp trên cùng hệ tọa độ thiết kế. Widget là phần tử HTML đặt chồng lên SVG, không nằm trong SVG (sanitizer cấm `foreignObject`, [ADR-007](../../docs/adr/007-screen-isolation.md): mỗi item SVG trong Shadow DOM riêng). Chốt bằng ADR-013.
- **D3. Điều khiển từ Chrome cần HTTPS và đăng nhập trên Chrome** (lộ trình §4.1, §5; D2 của 006; [ADR-018](../../docs/adr/018-viewer-source-filter.md) điều kiện xem xét lại): cookie `HttpOnly; Secure; SameSite=Strict` + CSRF token; role operator trở lên mới ghi; quy trình chứng chỉ (Master Plan §11.3).
- **D4. Ghi Tag chỉ qua `POST /api/v1/tags/write` của 006**; không thêm đường ghi, không ghi qua WebSocket.
- **D5. Không script tự do** (Constitution V): sự kiện của widget chỉ là hành động có sẵn (FR-033); biểu thức trong binding và sự kiện giao diện của phần tử SVG thuộc GĐ 3b.
- **D6. Mockup mới** `docs/architecture/mockups/studio-screens.html` tạo ở bước plan; phiên làm việc tự duyệt (người dùng giao toàn quyền).

### Quyết định khi viết spec

Các điểm dưới đây chưa được chốt trước; spec chọn phương án hợp lý nhất. Mỗi điểm là **Quyết định (người dùng giao toàn quyền 2026-10-11)**.

- **D7. Định dạng 0.3.0**, không mở rộng 0.2. Lý do: cấu trúc file màn hình đổi (từ một SVG sang danh sách item) và `project.json` thêm `navigation`; thêm trường tùy chọn vào 0.2 không biểu diễn được mà vẫn cho một đường đọc duy nhất. 0.2 → 0.3 là MINOR theo ADR-004; migration ở Studio; runtime 0.6 nhận cả ba phiên bản (FR-006); project 0.2 không nâng cấp thì mở chỉ đọc trong Studio (như 006 D23).
- **D8. Hệ tọa độ thiết kế và cách co:** màn hình có `size`; cả màn hình co bằng một phép co duy nhất (CSS transform) nên vị trí, cỡ chữ và biểu đồ co đồng đều, chuột trúng đúng. `fitMode` giữ ba giá trị của 0.2 (`contain` mặc định, `cover`, `stretch`) cộng `fit-width` (vừa chiều rộng, cuộn dọc) và `none` (100 %, cuộn). `stretch` làm méo widget: có cảnh báo. Lý do: giữ nguyên nghĩa của 0.2 để nâng cấp không đổi hình; một phép co dễ kiểm hơn bố cục đáp ứng. Bố cục đáp ứng cho điện thoại thuộc GĐ 6 trở đi.
- **D9. Thứ tự xếp lớp là thứ tự mảng `items`**, không có `z-index` riêng. Lý do: không thể có hai item cùng lớp hay lớp trùng; thao tác "đưa lên trên" là đổi thứ tự; diff rõ ràng.
- **D10. Mười lăm widget** theo nhóm của lộ trình §4.3, thêm `panel` (khung nền có tiêu đề). Lý do: dashboard 20 widget không có khung nhóm thì khó đọc; `panel` rẻ (không Tag, không sự kiện). Danh mục nằm trong `schemas/widgets.catalog.json` (FR-004).
- **D11. Điều hướng:** menu cấu hình trong `project.json` (`navigation`); đường dẫn dạng hash `#/<id>` (không cần máy chủ hỗ trợ đường dẫn con, F5 giữ nguyên, Back/Forward chạy). Không có menu thì sinh từ danh sách màn hình. Lý do: đơn giản, chạy với CivetWeb tĩnh.
- **D12. Popup:** một popup tại một thời điểm; mở popup khác thay popup hiện tại; chuyển màn hình đóng popup; popup không nằm trong URL (F5 đóng popup). **Không có quyền xem theo từng màn hình**: Tag live không lọc theo màn hình, nên "khóa màn hình theo role" chỉ là lớp giả; bảo mật xem là của `viewerAccess` và `viewerLogin` cho cả thiết bị. Lý do: Web SCADA không phải lớp an toàn (Constitution V) và tránh cảm giác an toàn giả.
- **D13. Hành động `pulse` thực hiện ở BL335** (`pulseMs` trong yêu cầu ghi), không bằng hai lệnh từ trình duyệt. Lý do: nếu trang đóng giữa hai lệnh, bit lệnh kẹt ở "bật" và máy tiếp tục chạy; BL335 giữ được nhịp ngay cả khi trình duyệt chết. Khuyến nghị vẫn là bit xung do PLC tự xóa; Studio cảnh báo khi Tag bật đọc lại (006 D15).
- **D14. Xác nhận mặc định luôn bật**; chỉ nút/công tắc ghi BOOL được tắt (cảnh báo); số, chuỗi luôn xác nhận. Nút Hủy có focus ban đầu. Lý do: lệnh ghi tác động máy thật; chi phí một lần bấm thêm thấp hơn chi phí một lần bấm nhầm.
- **D15. Khóa tự động** như FR-037: khóa khi BAD, STALE, chưa có giá trị; UNCERTAIN chỉ cảnh báo trong hộp xác nhận. Lý do: UNCERTAIN của 006 chủ yếu là "đã kẹp theo scaling", vẫn có giá trị dùng được; BAD nghĩa là giá trị cuối không đáng tin.
- **D16. Phiên web dùng chung `AuthService` và `SessionStore` của 005** với loại phiên `web`, không viết bộ xác thực thứ hai. Cookie `__Host-mat_sid` (tiền tố `__Host-` buộc `Secure`, `Path=/`, không `Domain`). CSRF dùng token theo phiên trả trong thân (không đặt trong cookie) cộng kiểm `Origin` và `SameSite=Strict`: ba lớp độc lập. Lý do: một nơi kiểm phiên và audit; token CSRF trong bộ nhớ trang không bị lộ qua cookie hay URL. Chốt bằng ADR-021.
- **D17. Phạm vi cookie hẹp** (FR-042): cookie chỉ vào endpoint của trang runtime, không vào API kỹ thuật dù tài khoản là engineer. Lý do: giảm thiệt hại của XSS hay CSRF; Studio có token Bearer riêng; kỹ sư đăng nhập trang chỉ để vận hành.
- **D18. Mặc định `viewerLogin: off`**: xem không cần đăng nhập (chế độ kiosk phổ biến ở nhà máy, Master Plan §11.3); đăng nhập chỉ để điều khiển. `required` cho nơi cần. Lý do: không phá cách dùng hiện tại; `viewerAccess` (ADR-018) vẫn chặn nguồn công cộng.
- **D19. Cổng và chuyển hướng:** HTTPS 8443 là cổng điều khiển; HTTP 8080 giữ chế độ chỉ xem (và cổng port-forward 9080 của người dùng). Không tự chuyển hướng HTTP sang HTTPS (sẽ làm hỏng kiosk dùng HTTP có chủ ý và gây cảnh báo chứng chỉ); trang HTTP hiện liên kết (ngoại lệ duy nhất: đường dẫn `/login` trên HTTP chuyển sang HTTPS). `viewerLogin: required` thì trang HTTP chỉ có hướng dẫn mở HTTPS.
- **D20. Biểu đồ thời gian thực không có lịch sử:** bộ đệm trong trình duyệt, mất khi chuyển màn hình hoặc F5. Lý do: lịch sử là GĐ 5 (đọc từ SQLite 003); lưu ở BL335 để có lịch sử tức là thêm API đọc lịch sử, ngoài phạm vi. 3.600 điểm × 8 đường × 16 biểu đồ nằm trong bộ nhớ trình duyệt, không tính vào ngân sách BL335.
- **D21. Thư viện biểu đồ:** uPlot (MIT) cho biểu đồ đường; cột và tròn tự viết bằng SVG. Chốt bằng ADR-020 (license, phiên bản ≥ 2 tuần, kích thước). Lý do: lộ trình đã chọn uPlot, GĐ 5 (biểu đồ lịch sử) dùng lại; tự viết trục thời gian, chú giải và con trỏ tốn công hơn rà một thư viện MIT không phụ thuộc.
- **D22. Widget là web component Lit trong Shadow DOM, không gọi mạng:** nhận `TagSource` và `ActionHost` từ nơi chứa. Lý do: Studio và trang runtime dùng chung một widget (Constitution II); xem trước chạy bằng mô phỏng mà không sửa widget. Chốt bằng ADR-019.
- **D23. Trình bố trí tự viết bằng Pointer Events và Lit**, không thêm interact.js hay thư viện kéo thả. Lý do: số hành vi cần (kéo, đổi cỡ, bắt dính, gióng, chọn khung, phân bố) nhỏ, cần kiểm bằng test hình học thuần; không thêm phụ thuộc. Chốt bằng ADR-022.
- **D24. Lưới mặc định 10 đơn vị, bật; đường gióng bật; ngưỡng 6 điểm ảnh màn hình.** Lý do: dashboard 1920 × 1080 xếp theo bội số 10 trông đều; ngưỡng tính theo điểm ảnh màn hình để cảm giác dính như nhau ở mọi mức zoom.
- **D25. Dữ liệu tải lười** (FR-020): `projects/active` thành bản tóm tắt cho project 0.3, màn hình tải theo yêu cầu qua `/project/`. Lý do: 32 màn hình × nhiều widget thì thân `projects/active` hàng MB; 10 client F5 cùng lúc (SC-003) chỉ cần màn hình đầu.
- **D26. Giới hạn** như FR-010. Lý do: vừa tải chuẩn 10 client; 1.000 Tag là giới hạn đăng ký live (ADR-006); 250 item dựng và kéo được trong ngân sách của SC-013; nâng khi có số đo.
- **D27. Đơn vị, bảng giá trị, min/max mặc định lấy từ Tag** nếu widget không đặt. Lý do: một chỗ khai báo; đổi đơn vị Tag thì mọi widget theo.
- **D28. Giới hạn nhập của widget không rộng hơn của Tag** (lỗi kiểm tra). Lý do: BL335 vẫn từ chối ngoài giới hạn của Tag (006); để Studio báo sớm thay vì để người vận hành gặp `REJECTED`.
- **D29. Kết quả ghi hỏi bằng HTTPS mỗi 200 ms** như Studio (006), không thêm bản tin live. Lý do: giữ giao thức live 1.2.0 không đổi (alarm GĐ 4 vẫn là 1.3.0); lệnh ghi hiếm.
- **D30. Audit của lệnh ghi từ web có `channel` = `web`** cộng `screen`, `widget` do trang gửi (≤ 64 byte, chỉ chữ id). Lý do: điều tra "ai bấm nút nào"; không dùng để phân quyền nên không cần tin.
- **D31. `expect` (so sánh rồi ghi) chỉ cho BOOL.** Lý do: đảo (`toggle`) và bật/tắt từ hai máy dễ ngược nhau; số thực có thể trôi nên so bằng sẽ báo nhầm. Người vận hành đã thấy giá trị hiện tại trong hộp xác nhận, nên lệnh phản ánh đúng điều họ thấy.
- **D32. Chứng chỉ:** tự sinh có SAN IP của card; tải `device.crt`; CSR và nhập chứng chỉ CA khách hàng bằng lệnh root. Không có ACME, không có giao diện nạp chứng chỉ qua web (bề mặt tấn công và cần quyền ghi `/var/lib`). Chứng chỉ 0.5 không SAN IP không tự đổi (đổi fingerprint làm Studio chặn kết nối). Lý do: Chrome yêu cầu SAN; làm một lần khi cài; thiết bị nhúng thường không có DNS riêng.
- **D33. Phiên web: 30 phút rảnh, 12 giờ tối đa, 8 phiên web đồng thời** (**sửa bởi feature 010, 2026-10-15: mặc định 12**; xem ADR-032: 10 client live của 003/007 không vừa trong 8 phiên khi mỗi người xem đăng nhập một lần, số đo `docs/reports/010-websessions-x64.json` cho thấy 12 phiên không tốn thêm bộ nhớ hay CPU đo được) (nằm trong 32 phiên của 005). `webSessionIdleMin` 5–480 để trạm vận hành cố định đặt dài hơn. Lý do: như 005; trạm vận hành 24/7 đặt 480.
- **D34. Quản lý tài khoản vẫn bằng lệnh trên BL335** (như 005, 006); không có giao diện đổi mật khẩu trên trang. Lý do: ngoài phạm vi; mỗi tính năng tài khoản trên web là một bề mặt tấn công.
- **D35. Studio giữ token Bearer** cho API kỹ thuật và xem trước Thiết bị; cookie chỉ cho trang runtime. Lý do: không đổi 005; hai kênh xác thực tách bạch.
- **D36. Kiosk** bằng tham số `?kiosk=1`. Lý do: màn hình treo tường không cần menu; rẻ.
- **D37. Item `svg` mới chưa thêm được trong Studio 3a**; chỉ item sinh từ nâng cấp 0.2. Lý do: nhập SVG (allowlist, gán `data-mat-uid`) là GĐ 3b (lộ trình §4.4).
- **D38. Biểu đồ không hỏi lịch sử từ BL335**; không có "zoom/pan thời gian" ở GĐ 3a (cửa sổ cố định). Lý do: D20.
- **D39. Phiên bản:** runtime 0.6.0; Studio 0.5.0; định dạng project 0.3.0; API thiết bị 1.2.0; giao thức live 1.2.0 (không đổi); gói `.matscada` 1.0.0 (không đổi); `@mat/ui-components` 0.1.0.
- **D40. Thiết bị BL335:** SSH tới BL335 không có trong phiên viết spec này (như 006 D7); các bước đo và thử trên thiết bị làm thành task ⚠️🔌, chờ người dùng cho phép SSH hoặc tự chạy lệnh của quickstart. Mọi chức năng chạy và kiểm trên x64 trước (Constitution I: nghiệm thu trên BL335 là điều kiện đóng feature).

### Giả định và phụ thuộc

- **Phụ thuộc:**
  - feature 006 xong về mã (Tag Engine, `tags/write`, bảng giá trị, lọc nguồn, Studio 0.4.0); phần chờ BL335 của 006 (RS485, đo SC-011, thử tay bộ gõ) không chặn feature này;
  - feature 005 (HTTPS, đăng nhập, audit, nạp xuống, đọc lên, so sánh), 004 (khung Studio), 003 (không đổi);
  - runtime 0.5.0; giao thức live 1.2.0; API 1.1.0.
- **Bàn thử:** giả lập Modbus (006), Chrome headless (puppeteer-core, đã có), CA thử trong container cho chứng chỉ; thử trên Chrome và Windows thật, thử với BL335 là việc của người và thiết bị.
- **Thao tác trên BL335** theo Constitution, quy trình bước 3: chỉ đọc khi kiểm; mọi thay đổi ghi vào `device-changes.md`; không đụng dịch vụ khác. SSH tới BL335 hiện cần người dùng cho phép: các bước đo SC-002, SC-003, SC-004, SC-010, thử chứng chỉ thật chờ quyền đó.
- **ADR:** 013 (mô hình màn hình v1), 019 (thư viện widget và hành động), 020 (biểu đồ thời gian thực, uPlot), 021 (đăng nhập web và chứng chỉ), 022 (trình bố trí màn hình); tất cả Proposed khi lập plan.
- **Mockup:** plan tạo `studio-screens.html` (trình bố trí; trang Chrome gồm đăng nhập, hộp xác nhận, trạng thái khóa; chú giải) trước khi viết mã giao diện; phiên làm việc tự duyệt.
- **Đo SC-023:** cần một người chưa dùng editor mới; không có thì ghi tự đo.
- **Rủi ro lộ dữ liệu và điều khiển từ xa:** trang chạy HTTPS có đăng nhập nên có thể mở từ xa; khuyến nghị VPN; port-forward HTTPS chỉ khi người dùng chọn, `viewerAccess` vẫn chặn trang với nguồn công cộng không có phiên. Router có NAT che địa chỉ nguồn vẫn như ADR-018.
- Chrome ≥ 120 (Constitution IV); Studio chạy trên Windows 10/11, thử bộ gõ trên Windows 11 (Telex có sẵn, Unikey).

## Ngoài phạm vi

- Nhập SVG, gắn Tag cho phần tử SVG bằng inspector, animation (di chuyển, co giãn, nhấp nháy, dòng chảy), sự kiện giao diện của phần tử SVG, thư viện ký hiệu (GĐ 3b).
- Alarm: banner, bảng, xác nhận alarm, số alarm trên menu (GĐ 4).
- Biểu đồ lịch sử, truy vấn lịch sử, báo cáo, xuất CSV/XLSX/PDF, zoom và pan thời gian (GĐ 5).
- Trình vẽ SVG đầy đủ, faceplate, template, ký hiệu (GĐ 6).
- Biểu thức trong binding hay trong thuộc tính widget; điều kiện `enableWhen`; interlock và logic (GĐ 3b, GĐ 6); luật sự kiện, timer, công thức (GĐ 6).
- Công thức tính trên trang, script, biểu thức của người dùng chạy trên Chrome.
- Bố cục đáp ứng cho điện thoại và máy tính bảng; ứng dụng di động.
- Quản lý tài khoản trên web hay trong Studio; đổi mật khẩu; quên mật khẩu; xác thực hai bước; đăng nhập bằng thẻ hoặc dịch vụ ngoài.
- Quyền xem theo từng màn hình (D12).
- ACME, đổi chứng chỉ qua giao diện web, thu hồi chứng chỉ (CRL, OCSP).
- Ghi nhiều Tag trong một thao tác (công thức, recipe); lập lịch ghi.
- Đa ngôn ngữ cho giao diện trang runtime (chuỗi tách file để thêm sau).
- Nhập widget từ thư viện ngoài, widget do người dùng viết, thư viện widget project.
- Docking tự do, tách đôi editor màn hình (ADR-009: xem lại khi cần).
- Nâng giới hạn 1.000 Tag mỗi màn hình hay 10 client.
