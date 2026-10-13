# Feature Specification: Hoàn thiện và pilot, trình vẽ SVG đầy đủ, logic v2

**Feature Branch**: `011-pilot-hardening`

**Created**: 2026-10-13

**Status**: Draft (đã qua `/speckit-analyze` 2026-10-13; xem checklists/requirements.md)

**Input**: User description: "GĐ 6 của lộ trình v2 (§4.7): hoàn thiện và pilot; trình vẽ SVG đầy đủ; logic v2. Hoàn thiện và pilot (Master Plan Sprint 7): kiểm tải (nhiều client, nhiều Tag), soak 7 ngày (rò bộ nhớ, ghi eMMC, tuổi thọ), mất điện 100 lần, review bảo mật tổng (SAST, `cargo audit`, `npm audit`, rà license toàn bộ third_party), xử lý toàn bộ phát hiện Medium còn tồn từ 005, 006, 007 (allowlist Host chống DNS rebinding, khóa đăng nhập theo tên gây DoS, xung kill -9 để bit lệnh bật, gateway Modbus TCP nhiều unit, `persist()` giữ mutex khi fsync, file thừa trong gói làm lệch digest, và các mục khác), bộ cài Studio ký số Authenticode (quy trình và kiểm bằng chứng chỉ thử vì máy dev không có chứng chỉ ký thật), cập nhật runtime qua mạng có xác thực, atomic, rollback (OTA, role administrator) hoặc quy trình thủ công được hỗ trợ (chốt phương án), tài liệu người dùng (kỹ sư, vận hành, quản trị), huấn luyện, hồ sơ pilot (kế hoạch, tiêu chí vào/ra, nhật ký sự cố). Trình vẽ SVG đầy đủ (Master Plan Sprint 3): sửa phần tử bên trong SVG (đường, hình chữ nhật, ellipse, văn bản), group, snap, undo/redo 100 bước, layers; faceplate và template. Logic v2: luật sự kiện (khi điều kiện đúng thì đặt Tag), timer, counter, cộng dồn lưu lượng, giờ chạy, lịch; không script tự do (Constitution V); lệnh ghi từ logic xuống PLC khai báo rõ và có audit. Mảng sau pilot ghi thành kế hoạch, không làm ở đây: thông báo alarm ngoài, recipe, API dữ liệu ra (REST, MQTT), giao diện mobile, image Buildroot. Nghiệm thu pilot: tiêu chí đo được (uptime, sự cố, độ trễ, ghi eMMC, tuổi thọ) và các điều cần người hoặc khách hàng. Phiên bản: runtime 1.0.0, Studio 1.0.0."

## Bối cảnh

Sau GĐ 3a ([007](../007-screens-widgets/spec.md)) sản phẩm có đủ chuỗi đầu-cuối: BL335 đọc và ghi PLC qua Modbus, có Tag tính toán, đăng nhập, audit, nạp xuống, màn hình nhiều widget và điều khiển từ Chrome. GĐ 3b, 4, 5 thêm importer SVG, alarm, lưu trữ và báo cáo (các feature riêng). Trước khi giao cho khách hàng còn ba khoảng trống:

1. **Chưa chứng minh được độ bền và độ an toàn khi vận hành thật.** Các báo cáo nghiệm thu của [005](../../docs/reports/005-acceptance.md), [006](../../docs/reports/006-acceptance.md), [007](../../docs/reports/007-security-review.md) còn để mở các phát hiện Medium (khóa đăng nhập theo tên gây DoS, không có allowlist `Host`, xung `pulseMs` bị kill -9 để bit lệnh bật, gateway Modbus TCP nhiều unit mất dữ liệu của thiết bị khỏe, `persist()` giữ mutex khi fsync, gói có file thừa làm lệch digest, cạn worker HTTPS, SSH root bằng mật khẩu). Chưa có số đo soak 7 ngày, mất điện 100 lần, tải 1.000 Tag, `cargo audit`, `npm audit`, rà license toàn bộ. Bộ cài Studio chưa có chữ ký số; việc cập nhật runtime vẫn là chép tay bằng SSH root.
2. **Trình vẽ SVG mới có import và gắn Tag** (GĐ 3b): người dùng vẫn phải vẽ bằng Inkscape rồi nhập; không sửa được hình, không có group, lớp, hoàn tác, faceplate. Master Plan Sprint 3 dự kiến một trình sửa SVG đầy đủ ngay từ đầu; lộ trình v2 dời về GĐ 6 (Constitution VII).
3. **Chưa có logic.** Muốn "khi mức bồn thấp quá 10 giây thì bật bơm", "đếm số lần khởi động", "cộng dồn lưu lượng theo ngày", "giờ chạy bơm", "bật theo lịch" phải viết trong PLC. Tag tính toán (006) chỉ cho ra giá trị, không có trạng thái, thời gian hay lệnh ghi.

GĐ 6 của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.7) giải quyết cả ba. Ràng buộc chính của [Constitution](../../.specify/memory/constitution.md) 2.0.1:

- **I:** mọi thứ phải xác nhận trên BL335 thật; riêng GĐ này nghiệm thu bằng số đo thật (soak, mất điện, pilot).
- **III:** ngân sách RSS ≤ 150 MB, CPU ≤ 30 %, ghi eMMC ≤ 2 GB/ngày. Logic và OTA phải nằm trong ngân sách.
- **V (NON-NEGOTIABLE):** không `eval`, không script tùy ý: logic là luật khai báo. Mọi lệnh ghi có kiểm quyền và audit; nạp xuống và cập nhật qua mạng chỉ khi có HTTPS, đăng nhập, role, audit. "Web SCADA không phải lớp an toàn": interlock ở PLC.
- **VI:** test viết trước; báo cáo trung thực, mục chưa đo ghi rõ "chưa đo".
- **VII:** SemVer có migration; deploy atomic; YAGNI theo giai đoạn.

**Thuật ngữ:**

- **Pilot**: chạy sản phẩm ở một hoặc hai site thật của khách hàng, kèm bàn thử nội bộ, ít nhất 30 ngày, theo [kế hoạch pilot](contracts/test-protocols.md) §5 và tiêu chí vào/ra.
- **Soak**: chạy liên tục dưới tải chuẩn để lộ rò bộ nhớ, ghi eMMC bất thường, lỗi tích lũy. Soak 7 ngày là mốc vào pilot; 30 ngày là bàn thử song song với pilot.
- **Sự cố S1…S4**: S1 mất dữ liệu, ghi sai xuống PLC, hỏng DB hoặc không khởi động được; S2 mất chức năng chính có cách tránh; S3 lỗi chức năng phụ; S4 thẩm mỹ, đề nghị.
- **OTA**: cập nhật runtime qua mạng từ Studio: gói `.matupdate` có chữ ký, kiểm, thay thế atomic, tự quay về nếu lỗi (ADR-035).
- **Luật (rule)**: khai báo "khi điều kiện đúng (giữ ≥ N ms) thì làm các hành động có sẵn". **Khối logic**: timer, counter, cộng dồn lưu lượng (totalizer), giờ chạy, lịch. Mọi đầu ra của khối là **Tag logic** (Tag nội bộ chỉ đọc với bên ngoài).
- **Ghi từ logic** (device write): hành động của luật ghi xuống Tag của thiết bị trường (PLC). Phải khai báo trong danh sách `writes`, có giới hạn tần suất và audit.
- **Lệnh SVG** (command): một thay đổi tài liệu SVG có đảo ngược được (đặt thuộc tính, thêm nút, xóa nút, chuyển nút); mỗi thao tác của người dùng là một lệnh hoặc một lô lệnh.
- **Lớp (layer)**: nhóm `g` cấp một của SVG do người dùng đặt tên; **Template**: mẫu có tham số dùng lại cho nhiều bản sao, bung ra khi lưu; **Faceplate**: màn hình popup có tham số, dùng cho nhiều thiết bị cùng loại (ví dụ một popup cho 40 bơm).
- **BL335**, **Studio**, **runtime**: như 005, 006, 007.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rà soát bảo mật tổng và xử lý mọi phát hiện còn tồn (Priority: P1)

Tech Lead mở bảng tổng hợp các phát hiện còn mở của 005, 006, 007: 18 mục Medium và Low rẻ. Với mỗi mục có một test đỏ rồi xanh hoặc một bằng chứng, và một dòng trong báo cáo. Trên máy dev, `cargo audit`, `npm audit`, rà license toàn bộ, `cppcheck` và `clang-tidy` chạy, kết quả có phân loại. Kẻ tấn công trong LAN dựng trang `evil.example` trỏ DNS về 192.168.1.110 để đọc dữ liệu xem: runtime trả 421 vì tên `evil.example` không có trong danh sách cho phép; người dùng truy cập bằng IP hay qua port-forward vẫn vào bình thường. Kẻ tấn công thử 1.000 mật khẩu sai với tên `kysu` từ một máy: máy đó bị khóa, nhưng kỹ sư thật ở máy khác đăng nhập `kysu` vẫn được ngay. Xung `pulseMs` đang chờ thì runtime bị `kill -9`: khởi động lại, runtime tự nhả bit lệnh và ghi audit. Gateway Modbus TCP nhiều unit có một thiết bị câm: các thiết bị còn lại vẫn đọc bình thường.

**Why this priority**: giao cho khách hàng một hệ thống điều khiển máy mà còn Medium chưa xử lý là không chấp nhận được; đây cũng là điều kiện vào pilot (Master Plan Sprint 7: "không còn lỗi blocker/critical", review bảo mật).

**Independent Test**: bộ test đơn vị và tích hợp x64 (GoogleTest, `tools/device-it.ps1`, `tools/web-it.ps1`, `tools/driver-it.ps1`, giả lập Modbus có gateway nhiều unit); công cụ kiểm tra tĩnh chạy trong container; không cần BL335 trừ phần đo RAM của giới hạn kết nối.

**Acceptance Scenarios**:

1. **Given** runtime 1.0 chạy và `Host: evil.example` trên HTTP 8080, HTTPS 8443 và nâng cấp WebSocket, **When** gửi yêu cầu, **Then** 421 `HOST_NOT_ALLOWED`, không dữ liệu nào trả về, có audit gộp 60 s.
2. **Given** `Host` là địa chỉ IPv4 hay IPv6 bất kỳ (IP của thiết bị, IP công cộng qua port-forward) hoặc `localhost`, tên máy của thiết bị, hoặc tên trong `allowedHosts`, **When** gửi yêu cầu, **Then** nhận bình thường; mọi hành vi của 007 giữ nguyên.
3. **Given** 5 lần sai mật khẩu `kysu` từ IP A, **When** đăng nhập `kysu` từ IP B với mật khẩu đúng, **Then** thành công trong ≤ 2 s; IP A bị khóa 5 phút cho tài khoản đó; sau 20 lần sai từ IP A (mọi tên) thì IP A bị khóa mọi đăng nhập 5 phút.
4. **Given** đăng nhập thành công của `kysu` ở IP A, **When** IP A trước đó có 4 lần sai với tên `admin`, **Then** bộ đếm của `admin` không bị xóa (không còn lỗ hổng "một tài khoản hợp lệ xóa bộ đếm sai của mọi tên").
5. **Given** xung 500 ms đang chờ trên bit lệnh `PUMP01.RUN_CMD`, **When** `kill -9` runtime rồi khởi động lại, **Then** khi kênh nối lại, runtime ghi giá trị nhả, audit ghi `tag.write` nguồn `pulse-recovery` và bit lệnh về `false` trong ≤ 10 s; nếu kênh không nối được, trạng thái `PULSE_STUCK` hiện trong `system/info.warnings` và Studio.
6. **Given** gateway Modbus TCP có unit 1, 2, 3 và unit 2 không trả lời, **When** chạy 1.000 chu kỳ quét, **Then** Tag của unit 1 và 3 giữ GOOD với độ trễ ≤ 1 chu kỳ; Tag của unit 2 là BAD sau timeout; kết nối TCP không bị đóng.
7. **Given** `persist()` của pipeline nạp xuống chậm (fsync giả 500 ms), **When** đọc trạng thái, **Then** `GET /api/v1/projects/active` trả lời ≤ 50 ms (mutex không giữ trong lúc fsync).
8. **Given** gói `.matscada` chứa file không được manifest hay project tham chiếu, **When** nạp xuống hoặc mở bằng Studio, **Then** bị từ chối `E_PACKAGE_EXTRA_FILE` ở cả Studio, bộ kiểm tra C++ và kiểm gói; không còn tình huống `HEALTH_TIMEOUT` do lệch digest.
9. **Given** một máy mở 40 kết nối TLS im lặng, **When** máy khác đăng nhập, **Then** đăng nhập vẫn trả lời ≤ 2 s vì mỗi nguồn bị giới hạn số kết nối (`maxConnPerSource`).
10. **Given** `cargo audit`, `npm audit`, rà license, `cppcheck`, `clang-tidy`, fuzz, **When** chạy toàn bộ, **Then** báo cáo `docs/reports/011-security-review.md` liệt kê từng phát hiện kèm xử lý; không còn Critical hay High mở, không còn Medium mở ngoài mục chờ người ghi rõ.
11. **Given** SSH root bằng mật khẩu còn bật trên BL335, **When** `system/info` tính cảnh báo, **Then** có `SSH_ROOT_PASSWORD` và tài liệu gia cố nêu cách tắt (việc đổi cấu hình thiết bị chờ người dùng).

---

### User Story 2 - Tải, soak 7 ngày và mất điện 100 lần trên BL335 (Priority: P1)

Kỹ sư QA chạy bộ công cụ: một máy tạo 10 client xem 500 rồi 1.000 Tag; bộ lấy mẫu trên thiết bị ghi RSS, CPU, số FD, ghi đĩa mỗi 60 giây; sau 7 ngày báo cáo cho thấy RSS không tăng, ghi eMMC từng ngày dưới 2 GB, không khởi động lại. Rồi bộ điều khiển nguồn cắt điện BL335 100 lần ở thời điểm ngẫu nhiên và 10 lần ở mỗi điểm nhạy cảm (đang nạp xuống, đang cập nhật, đang ghi lịch sử, đang xung, đang lưu trạng thái logic); sau mỗi lần thiết bị lên lại trong ≤ 90 giây, `mat-runtime --check-data` báo mọi cơ sở dữ liệu nguyên vẹn, mọi lệnh ghi đã trả `ACCEPTED` đều có dòng audit.

**Why this priority**: Master Plan Sprint 7 và §14.5 đòi các số đo này; không có chúng không thể chấp nhận độ bền của thiết bị chạy không người trực. Constitution I: nghiệm thu trên BL335 thật.

**Independent Test**: toàn bộ công cụ chạy trước trên x64 (tải ngắn trong Docker; soak gia tốc 24 giờ; kill -9 100 vòng như bước tiền kiểm). Phần BL335 là task ⚠️🔌: cần SSH, 7 ngày thiết bị, bộ điều khiển nguồn (relay hoặc ổ cắm thông minh) và người ở cạnh khi cắt điện.

**Acceptance Scenarios**:

1. **Given** project chuẩn 500 Tag tính toán và mô phỏng, 10 client xem (Chrome headless hoặc `tools/load-tester`) trong 4 giờ, **When** đo trên BL335, **Then** CPU trung bình ≤ 30 %, đỉnh ≤ 60 %, RSS ≤ 150 MB, 0 mất sequence, client thứ 11 nhận 4429 ở 100 % lần thử.
2. **Given** 1.000 Tag, 10 client, **When** đo, **Then** CPU trung bình báo cáo và so với mục tiêu thử nghiệm ≤ 50 % (Master Plan §6.2); không đạt thì có báo cáo giới hạn kèm phương án, không che giấu.
3. **Given** 10 client cùng F5 màn hình 250 item 50 lần liên tiếp, **When** đo, **Then** mọi lần cả 10 client có dữ liệu sống ≤ 5 s.
4. **Given** soak 7 ngày dưới tải chuẩn, **When** hết 7 ngày, **Then**: 0 lần khởi động lại ngoài kế hoạch; độ dốc RSS (hồi quy tuyến tính sau 24 giờ đầu) ≤ 0,5 MB/ngày và RSS lớn nhất ≤ 150 MB; số FD và số luồng không tăng quá 5 %; mỗi ngày ghi eMMC (từ `/proc/<pid>/io` cộng `audit`, log) ≤ 2 GB; tmpfs ≤ 64 MB; không có lỗi `mmc`/`ext4` trong `dmesg`.
5. **Given** thiết bị mất điện đột ngột 100 lần (thời điểm ngẫu nhiên), **When** cấp điện lại, **Then** 100/100 lần runtime phục vụ lại ≤ 90 s, `--check-data` đạt 100 %, project đang chạy hợp lệ, 0 lệnh `ACCEPTED` thiếu audit, `retain/` đọc được.
6. **Given** cắt điện có chủ đích 10 lần ở mỗi điểm: giữa các bước nạp xuống, giữa các bước OTA, khi `history.db` ghi dày, khi xung đang chờ, khi lưu trạng thái logic, **When** khởi động lại, **Then** luôn là bản cũ hoặc bản mới hoàn chỉnh; không DB nào hỏng; xung được nhả (US1); trạng thái logic mất tối đa một chu kỳ lưu.
7. **Given** cắt mạng của 10 client 50 lần, **When** mạng có lại, **Then** 100 % client tự nối lại ≤ 35 s, không rò slot (client 11 vẫn nhận 4429 đúng, client mới vào được khi có chỗ).
8. **Given** báo cáo `011-load.md`, `011-soak.md`, `011-powercut.md`, **When** đọc, **Then** mỗi số có nguồn dữ liệu thô (`docs/reports/011-*.json`), điều kiện đo, và các mục chưa đo ghi rõ lý do.
9. **Given** chỉ số tuổi thọ eMMC (`EXT_CSD` life time estimate) đọc đầu và cuối soak, **When** tính, **Then** báo cáo nêu tốc độ ghi, ước tính tuổi thọ theo công thức của contract §3 và các giả định (hệ số khuếch đại ghi, TBW của datasheet); thiếu datasheet thì nói rõ "chưa tính được tuổi thọ tuyệt đối".

---

### User Story 3 - Bộ cài Studio có chữ ký số và gói phát hành tin cậy được (Priority: P1)

Người phát hành chạy `tools/release/release.ps1 -Release`. Script build, ký `mat-studio.exe`, bộ cài và trình gỡ bằng Authenticode SHA-256 có dấu thời gian, kiểm lại chữ ký, tính `SHA256SUMS` rồi ký file này, sinh SBOM và báo cáo license, và đặt tất cả vào `release/1.0.0/`. Trên máy dev không có chứng chỉ thật, cùng quy trình chạy được ở chế độ thử với chứng chỉ tự ký: chữ ký toán học hợp lệ, chuỗi tin cậy báo "chưa tin cậy" đúng như kỳ vọng, chỉnh một byte thì báo hỏng; chế độ `-Release` từ chối chứng chỉ thử.

**Why this priority**: Master Plan §11.9, §14.6: bộ cài ký số để tránh cảnh báo SmartScreen; khách hàng công nghiệp thường chặn file không ký. Không có chứng chỉ thật trên máy dev nên quy trình và cổng kiểm phải đúng trước, việc mua chứng chỉ là điều cần người.

**Independent Test**: dựng bộ cài thật (NSIS), ký bằng chứng chỉ thử tạo trong kho `CurrentUser\My`, kiểm bằng `Get-AuthenticodeSignature` và `signtool verify`; thử 12 ca hỏng. Không thay đổi kho tin cậy của Windows. Phần chứng chỉ thật và SmartScreen là task ⚠️🔌.

**Acceptance Scenarios**:

1. **Given** chứng chỉ thử (`CN=mAT SCADA TEST - NOT FOR RELEASE`), **When** chạy `sign.ps1` trên `mat-studio.exe`, bộ cài `.exe`, `uninstall.exe`, **Then** cả ba có chữ ký SHA-256, `Get-AuthenticodeSignature` báo `NotTrusted` (chữ ký đúng, gốc chưa tin) và dấu vân tay đúng chứng chỉ thử.
2. **Given** bộ cài đã ký, **When** sửa một byte của bộ cài hoặc của `mat-studio.exe` trong gói rồi kiểm, **Then** `HashMismatch` và script kiểm trả lỗi.
3. **Given** `release.ps1 -Release`, **When** chứng chỉ ký là chứng chỉ thử, tự ký, hết hạn, không có EKU Code Signing, hoặc thiếu dấu thời gian, **Then** từ chối, không tạo thư mục phát hành.
4. **Given** `release.ps1` thành công, **When** kiểm thư mục `release/<ver>/`, **Then** có bộ cài, gói runtime `.tar.gz`, gói cập nhật `.matupdate`, `SHA256SUMS` và `SHA256SUMS.sig` (ECDSA P-256), `sbom.cdx.json`, `licenses.md`, `RELEASE-NOTES.md`; kiểm lại chữ ký và băm: đạt 100 %.
5. **Given** `docs/release/signing.md`, **When** người phát hành đọc, **Then** biết: loại chứng chỉ nên mua (OV hay EV, khóa trên token phần cứng), ai giữ, cách ký trên máy ký, ký qua dịch vụ ký đám mây (lệnh ngoài), gia hạn, thu hồi, xử lý khi lộ khóa, và việc dấu thời gian là bắt buộc.
6. **Given** chứng chỉ thật ⚠️🔌 và máy Windows 10 và 11 sạch, **When** cài bộ cài, **Then** Windows hiện nhà phát hành đúng; kết quả SmartScreen ghi nguyên văn vào báo cáo (không cam kết hết cảnh báo ngay: uy tín SmartScreen do Microsoft quyết định).

---

### User Story 4 - Cập nhật runtime qua mạng có xác thực, atomic, rollback (Priority: P2)

Quản trị viên mở Thiết bị trong Studio, chọn "Cập nhật runtime", chọn file `mat-runtime-1.0.1.matupdate`. Studio tải lên qua HTTPS; thiết bị kiểm chữ ký, băm, tương thích và cho xem kế hoạch: "1.0.0 → 1.0.1, project hiện tại tương thích, dịch vụ ngừng ≈ 20 s". Quản trị viên nhập lại mật khẩu và xác nhận. Thiết bị chuyển sang bản mới, chạy kiểm tra sức khỏe 60 giây; nếu lỗi tự quay về bản cũ. Studio hiện kết quả và audit có dòng `system.update`. Quy trình chép tay bằng `deploy.sh` vẫn hoạt động và là đường khôi phục.

**Why this priority**: không có OTA thì mỗi lần cập nhật cần SSH root (một tồn tại Medium), mỗi site pilot phải có người tới tận nơi; nhưng pilot vẫn chạy được bằng quy trình thủ công, nên xếp P2.

**Independent Test**: runtime x64 trong Docker với `mat-updater` giả lập thư mục cài; bộ ≥ 25 gói xấu; kill ở từng bước. Trên BL335 (⚠️🔌): thử bản thật armhf, thử mất điện giữa bước.

**Acceptance Scenarios**:

1. **Given** OTA bật (`update.enabled: true`, có khóa tin cậy), gói hợp lệ, tài khoản administrator, **When** tải lên và xác nhận kèm mật khẩu, **Then** `committed`, `system/info.version` là bản mới, project và dữ liệu không đổi, audit ghi `system.update.accepted` và `system.update.committed`.
2. **Given** OTA tắt (mặc định), **When** gọi endpoint, **Then** 404 `UPDATE_DISABLED` và không có gì bị nhận.
3. **Given** tài khoản engineer, operator, viewer, không đăng nhập, HTTP, hoặc cookie web, **When** gọi API cập nhật, **Then** 403 hoặc 401 và audit; không file nào được ghi vào thư mục tạm.
4. **Given** 25 loại gói xấu (chữ ký sai, khóa lạ, manifest sửa, file sửa, thiếu file, file thừa, đường dẫn `..`, đường dẫn tuyệt đối, liên kết tượng trưng, tar bomb, quá lớn, kiến trúc sai, `releaseSeq` thấp hơn bản đang chạy, `projectFormatMax` thấp hơn project, cắt ngang gói, trùng id cập nhật, v.v.), **When** gửi, **Then** 100 % bị từ chối đúng mã, bản đang chạy và dữ liệu không đổi.
5. **Given** bản mới không khởi động được hoặc không qua kiểm tra sức khỏe, **When** hết hạn 60 s, **Then** tự quay về bản cũ (`rolled-back`) ≤ 90 s kể từ khi chuyển, audit ghi lý do.
6. **Given** `kill -9` hoặc cắt điện ở mỗi bước (nhận, kiểm, đưa vào thư mục chờ, chuyển, khởi động, kiểm sức khỏe, xác nhận), **When** khởi động lại, **Then** luôn là bản cũ hoặc bản mới hoàn chỉnh; không trạng thái nửa vời (40 lần thử).
7. **Given** đang nạp xuống project hoặc đang có cập nhật khác, **When** gửi cập nhật, **Then** 409 `DEVICE_BUSY` (cùng khóa với nạp xuống).
8. **Given** quản trị viên chọn "Quay về bản trước", **When** xác nhận, **Then** thiết bị chạy lại bản `.prev` hợp lệ và có audit; không có bản trước thì lệnh bị từ chối.
9. **Given** gói chứa danh sách khóa mới ký bởi khóa cũ (xoay khóa), **When** áp dụng, **Then** khóa mới được tin cậy và khóa cũ bị thu hồi nếu gói ghi rõ; khóa không có chữ ký của khóa đang tin cậy bị từ chối.
10. **Given** quy trình thủ công, **When** người cài dùng `deploy.sh` với gói và `SHA256SUMS.sig`, **Then** vẫn chạy như 0.6; có thể kiểm chữ ký bằng `mat-update-verify` trước khi cài.

---

### User Story 5 - Logic v2: luật sự kiện, timer, counter, cộng dồn, giờ chạy, lịch (Priority: P2)

Kỹ sư mở nút Logic trên cây project, tạo luật "Bơm tự bật khi mức thấp": điều kiện `TANK01.LEVEL < 20`, giữ 10 giây, thì ghi `PUMP01.RUN_CMD = true`; khi `TANK01.LEVEL > 80` thì ghi `false`. Họ khai báo `PUMP01.RUN_CMD` trong danh sách ghi cho phép, đặt tối thiểu 30 s giữa hai lệnh, tối đa 20 lệnh mỗi giờ. Họ thêm bộ đếm số lần khởi động bơm, cộng dồn lưu lượng `FLOW01` (m³/h) thành tổng m³ theo ngày (đặt về 0 lúc 00:00 bằng lịch), giờ chạy bơm, và lịch "bơm hoạt động 06:00–18:00 từ thứ Hai đến thứ Bảy". Họ chạy Mô phỏng ngay trong Studio và xem đường thời gian của đầu ra. Khi Nạp xuống, hộp xác nhận liệt kê "Logic sẽ tự động ghi 1 Tag xuống PLC: PUMP01.RUN_CMD". Trên BL335, `logic.writes` mặc định tắt nên lệnh chỉ ghi audit "bị chặn"; quản trị bật bằng cấu hình sau khi chấp nhận. Mỗi lệnh ghi thật đều có audit với tên luật và giá trị điều kiện.

**Why this priority**: là giá trị lớn nhất của GĐ 6 cho khách hàng (bỏ bớt logic trong PLC), nhưng nó là bề mặt rủi ro mới (máy ghi xuống PLC không có người bấm), nên làm sau bảo mật và độ bền.

**Independent Test**: bộ vector chung ≥ 200 ca (chuỗi thời gian vào, đầu ra và hành động mong đợi) cho cả hai bản cài (TS cho mô phỏng Studio, C++ cho runtime); giả lập Modbus (006) kiểm lệnh ghi và audit; kill -9, mất điện giả lập cho trạng thái giữ.

**Acceptance Scenarios**:

1. **Given** luật `when: TANK01.LEVEL < 20`, `hold: 10000`, `onRise: write PUMP.RUN_CMD=true`, **When** mức xuống 19 trong 9,9 s rồi lên 25, **Then** không có lệnh; **When** xuống 19 trong ≥ 10 s, **Then** đúng một lệnh ghi `true` (không lặp lại khi điều kiện vẫn đúng, trừ khi đặt `repeatMs`).
2. **Given** Tag đầu vào của luật có quality BAD, **When** đánh giá, **Then** luật ở trạng thái `SUSPENDED`, không hành động nào chạy, không tạo cạnh giả; khi GOOD lại, luật tiếp tục từ trạng thái cũ (không bắn lại cạnh).
3. **Given** runtime khởi động khi điều kiện đã đúng, **When** chạy, **Then** mặc định không bắn hành động (cần một cạnh sau lần đánh giá đầu); `fireOnStart: true` mới bắn.
4. **Given** `ton`, `tof`, `tp` với `pt` 5 s, **When** chạy chuỗi vào, **Then** đầu ra `q` và thời gian trôi `et` đúng bảng chân trị của contract (sai lệch ≤ 1 chu kỳ quét).
5. **Given** counter `up`, `reset`, `preset 100`, **When** 250 cạnh lên, **Then** `value` = 250 (không bị `reset` giả), `reached` = true từ cạnh 100; `reset` về 0; kill -9 rồi khởi động: giá trị còn (mất tối đa một chu kỳ lưu 60 s), không giảm.
6. **Given** totalizer nguồn `FLOW01` 36 m³/h hằng, đơn vị gốc m³/h, **When** chạy 1 giờ mô phỏng, **Then** tổng 36 m³ ± 0,1 %; Tag BAD hoặc khoảng trống > `maxGapMs` không cộng thêm và được đếm vào `gapSeconds`; dưới `cutoff` coi là 0.
7. **Given** khối giờ chạy trên `PUMP01.RUN`, **When** bơm chạy 3 giờ 20 phút, **Then** `hours` = 3,333 (± 0,01), `starts` đúng số cạnh lên; `serviceEveryHours` đặt thì `due` bật khi vượt.
8. **Given** lịch thứ Hai–thứ Bảy 06:00–18:00, ngoại lệ 2026-12-25 tắt, **When** chạy qua 00:00, 06:00, 18:00, ngày ngoại lệ, và khi giờ hệ thống chưa đồng bộ, **Then** đầu ra đúng ở mọi ca; chưa đồng bộ giờ thì đầu ra BAD `TIME_NOT_SYNCED` và các luật phụ thuộc `SUSPENDED`.
9. **Given** luật ghi Tag của thiết bị không có trong `writes`, hoặc Tag chỉ đọc, hoặc giá trị ngoài `allowed`, **When** kiểm tra, **Then** lỗi `E_LOGIC_WRITE_UNDECLARED` hoặc `E_LOGIC_WRITE_TARGET` hoặc `E_LOGIC_WRITE_VALUE` ở cả Studio và runtime; Nạp xuống bị chặn; project lỗi không kích hoạt.
10. **Given** ghi từ logic hợp lệ và `logic.writes: "on"`, **When** luật bắn, **Then** lệnh đi qua cùng chuỗi kiểm của 006 (Tag RW, giới hạn, kết nối, tần suất, hàng đợi) với audit bền **trước** khi gửi; bản ghi có `actor` = `logic:<ruleId>`, `channel` = `logic`, giá trị cũ và mới, và tối đa 8 giá trị đầu vào của điều kiện.
11. **Given** `logic.writes: "off"` (mặc định), **When** luật bắn, **Then** 0 lệnh tới thiết bị trường; audit `logic.write.suppressed` (gộp 60 s); đầu ra Tag logic vẫn cập nhật; `system/info` và Studio hiện "Logic: ghi PLC tắt".
12. **Given** luật ghi quá `minIntervalMs`, `maxPerHour` hoặc tổng `logic.maxWritesPerMin` (mặc định 20), **When** vượt, **Then** lệnh bị `REJECTED` `RATE_LIMITED`, có audit gộp, trạng thái luật `THROTTLED`, cảnh báo trong `system/info.warnings`.
13. **Given** quản trị viên bấm "Dừng ghi của logic" trong Studio, **When** xác nhận, **Then** `POST /api/v1/logic/writes {"enabled": false}` có hiệu lực ngay và giữ qua khởi động lại; bật lại chỉ làm được bằng cấu hình `runtime.json` (root) và khởi động lại dịch vụ.
14. **Given** Tag logic (ví dụ `LOGIC.PUMP01.HOURS`), **When** operator hoặc API ghi trực tiếp, **Then** `REJECTED` `OWNED_BY_LOGIC`; Bảng theo dõi của Studio hiện chỉ đọc.
15. **Given** hai khối đọc đầu ra của nhau trong cùng chu kỳ (vòng phụ thuộc), hoặc luật đọc Tag logic do chính hành động của nó đặt, **When** kiểm tra, **Then** lỗi `E_LOGIC_CYCLE` hoặc `E_LOGIC_SELF_TRIGGER` kèm đường đi của vòng.
16. **Given** 200 luật, 100 timer, 100 counter, 50 totalizer, 50 giờ chạy, 50 lịch, 500 Tag, 10 client, **When** đo trên BL335, **Then** CPU thêm ≤ 3 điểm phần trăm và RSS thêm ≤ 5 MB.
17. **Given** project có logic, **When** Studio chạy Mô phỏng, **Then** bản TS của engine cho cùng đầu ra như bản C++ trên cùng chuỗi vào (vector chung); đường thời gian đầu vào/đầu ra hiện trong bảng Thử logic.

---

### User Story 6 - Trình vẽ SVG đầy đủ (Priority: P2)

Kỹ sư bấm đúp một ký hiệu SVG trên cây hoặc chọn "Mới: SVG trống". Editor SVG mở thành một tab: canvas có thước, lưới, lớp, công cụ Chọn, Hình chữ nhật, Ellipse, Đường thẳng, Đa tuyến, Văn bản. Họ vẽ một thân bơm (hình chữ nhật bo góc), cánh quạt (ellipse và đường), nhãn "P-01" (văn bản), chọn tất cả rồi Nhóm, đặt tên lớp "Bơm", kéo nhóm bắt dính vào lưới và vào cạnh của bồn. Họ đổi màu, viền, độ dày bằng inspector; nhấn Ctrl+Z 100 lần đều hoàn tác đúng; tắt Studio đột ngột, mở lại thì nhận lại bản tự lưu. Phần tử đã gắn Tag (GĐ 3b) giữ nguyên `data-mat-uid` khi sửa, nên binding còn nguyên.

**Why this priority**: là phần Master Plan Sprint 3 bị dời về GĐ 6. Không có nó người dùng phải mở Inkscape cho mọi chỉnh sửa nhỏ; nhưng đây không phải điều kiện pilot nên xếp P2.

**Independent Test**: kiểm bằng hàm thuần (hình học, lệnh, tuần tự hóa) có bảng ca; round-trip ≥ 20 fixture (Inkscape, Illustrator, CorelDRAW, transform lồng); e2e Chrome headless với lớp Tauri giả; thử tay trên Windows với bộ gõ cho văn bản tiếng Việt.

**Acceptance Scenarios**:

1. **Given** công cụ Hình chữ nhật, **When** kéo trên canvas giữ Shift, **Then** tạo `<rect>` hình vuông, dính lưới 10 đơn vị, được chọn, một bước hoàn tác; bo góc `rx` sửa được trong inspector; Ellipse (giữ Shift là hình tròn), Đường thẳng (giữ Shift khóa góc 15°), Đa tuyến (nhấp từng điểm, Enter kết thúc, đóng kín thành đa giác), Văn bản (nhấp rồi gõ; nhập Telex, Unikey đúng).
2. **Given** một phần tử đang chọn, **When** kéo 8 tay nắm, xoay bằng tay nắm xoay, hoặc nhập X, Y, Rộng, Cao, Góc trong inspector, **Then** hình học đổi đúng: với `rect`, `ellipse`, `line`, `polyline`, `polygon` độ lớn được ghi vào thuộc tính hình học (không dồn vào `transform`); với `g`, `path`, `text` ghi vào `transform` ma trận; kết quả đúng cả khi cha có `transform` lồng nhau (xoay, co, nghiêng).
3. **Given** chọn ≥ 2 phần tử, **When** Nhóm (Ctrl+G), Bỏ nhóm (Ctrl+Shift+G), vào nhóm (nhấp đúp), thoát nhóm (Esc), **Then** cấu trúc `g` đổi đúng; bỏ nhóm bake `transform` của nhóm vào con mà không đổi hình hiển thị; `data-mat-uid` của con giữ nguyên, nhóm mới có uid mới.
4. **Given** bắt dính bật, **When** kéo, **Then** dính lưới, dính cạnh và tâm của phần tử khác (≤ 6 điểm ảnh), dính điểm đầu cuối của đường, dính góc 15°; hiện đường gióng; giữ Alt tắt; bộ ca hình học thuần cho đúng 100 %.
5. **Given** panel Lớp, **When** tạo, đổi tên, đổi thứ tự, ẩn (mắt), khóa, xóa, chuyển phần tử sang lớp khác, **Then** cấu trúc `g[data-mat-layer]` đổi đúng; lớp khóa không chọn được trên canvas; ẩn/khóa chỉ là trạng thái soạn thảo, không đổi file SVG và không vào gói.
6. **Given** Căn trái/giữa/phải/trên/giữa dọc/dưới, Phân bố đều, Cùng rộng, Cùng cao, Đưa lên trên/xuống dưới, **When** áp dụng cho phần tử trong cùng hay khác nhóm, **Then** kết quả đúng hình học trong hệ tọa độ của tài liệu.
7. **Given** 100 thao tác khác loại, **When** Ctrl+Z 100 lần rồi Ctrl+Y 100 lần, **Then** trạng thái đảo đúng từng bước; thao tác kéo liên tục là một bước; bước thứ 101 làm bước cũ nhất rời ngăn xếp; thao tác dán nhiều phần tử là một bước.
8. **Given** phần tử có binding (GĐ 3b), **When** sửa hình, di chuyển, đổi cỡ, đổi màu, **Then** `data-mat-uid` giữ nguyên và binding còn; xóa phần tử có binding thì cảnh báo và liệt kê binding sẽ mất, hoàn tác khôi phục cả binding; nhân bản và dán cấp uid mới và không sao chép binding (tùy chọn "kèm binding").
9. **Given** dán văn bản SVG từ clipboard hệ thống chứa `<script>`, `onclick`, `foreignObject`, `href` ngoài, **When** dán, **Then** bộ lọc allowlist trên DOM đã parse loại phần tử và thuộc tính không cho phép, hiện thông báo đã loại gì; editor không bao giờ tạo nút ngoài allowlist.
10. **Given** tài liệu 2.000 phần tử, **When** kéo một phần tử, **Then** ≤ 16,7 ms mỗi khung (p95); mở tài liệu 20.000 nút ≤ 3 s; vượt giới hạn (5 MB, 20.000 nút, độ sâu 32) thì lệnh bị từ chối kèm lý do.
11. **Given** Studio bị tắt đột ngột khi đang sửa, **When** mở lại project, **Then** hộp "Khôi phục bản tự lưu" hiện, phục hồi trạng thái mất không quá 30 s gần nhất.
12. **Given** file SVG nhập từ Inkscape, Illustrator, CorelDRAW (≥ 20 fixture), **When** mở rồi lưu không sửa, **Then** kết quả tuần tự hóa chuẩn tắc (canonical) giống nhau ở hai lần lưu liên tiếp, mọi `data-mat-uid` giữ, ảnh dựng lại sai khác ≤ 1 % điểm ảnh so với bản gốc.
13. **Given** `path` có đoạn Bézier hoặc cung, **When** chọn, **Then** di chuyển, đổi cỡ, xoay, đổi màu được; sửa nút bị khóa kèm lý do "Đường cong: chỉ sửa được trong Inkscape"; `path` chỉ gồm M, L, H, V, Z (tuyệt đối hoặc tương đối) thì sửa, thêm, xóa nút được.
14. **Given** người dùng dựng ký hiệu "bơm" từ đầu bằng hình chữ nhật, ellipse, đường, văn bản, nhóm rồi gắn Tag (GĐ 3b), **When** nạp xuống, **Then** Chrome hiển thị giống Studio.

---

### User Story 7 - Faceplate và template (Priority: P3)

Kỹ sư có 20 bơm giống nhau. Họ chọn nhóm "ký hiệu bơm + đèn + giá trị dòng" làm template `bom` có tham số `prefix` (Tag), `title`; thêm 20 bản sao với `prefix` = `PUMP01…PUMP20`. Sửa template một lần, "Cập nhật mọi bản sao": cả 20 đổi. Họ làm một faceplate: màn hình popup "Chi tiết bơm" có tham số `prefix`; nút "Chi tiết" của mỗi bơm mở popup đó với `prefix` tương ứng. Một popup cho 20 bơm; Studio kiểm tra cả 20 chỗ gọi, runtime thay chuỗi lúc mở.

**Why this priority**: tiết kiệm công sức khi project lớn (hàng chục thiết bị cùng loại) nhưng không chặn pilot; làm sau trình vẽ.

**Independent Test**: bộ vector chung (validator TS và C++) cho tham số hóa; e2e dựng 20 bản sao; runtime x64 và Chrome headless cho popup có tham số.

**Acceptance Scenarios**:

1. **Given** template `bom` (tham số `prefix`: kiểu `tagPrefix`, `title`: chuỗi), **When** thêm bản sao với `prefix=PUMP07`, **Then** các item được bung vào màn hình với Tag `PUMP07.RUN`, `PUMP07.FLOW`, id ổn định `pump7.lamp`; file màn hình chứa item thường (runtime không đổi); mỗi item mang chú thích `tpl` (không ảnh hưởng runtime).
2. **Given** sửa template (thêm một nhãn), **When** "Cập nhật mọi bản sao", **Then** cả 20 bản có nhãn mới, vị trí và cỡ riêng của từng bản giữ nguyên, tham số giữ; hoàn tác là một bước.
3. **Given** tham số `prefix` dẫn tới Tag không tồn tại, **When** kiểm tra, **Then** lỗi `E_TEMPLATE_TAG_REF` kèm tên bản sao và tên tham số.
4. **Given** popup có tham số `prefix` dùng `{prefix}` trong khe Tag (ví dụ `{prefix}.RUN`), **When** nút của bơm 7 mở popup với `args: {prefix: "PUMP07"}`, **Then** Chrome hiển thị giá trị của `PUMP07.RUN`; đóng rồi mở với `PUMP08` thì hiện `PUMP08.RUN`; đăng ký Tag đổi theo.
5. **Given** 20 chỗ gọi popup có tham số, **When** kiểm tra ở Studio và runtime, **Then** cả hai bung đủ 20 tổ hợp và kiểm từng Tag (tồn tại, kiểu, RW cho khe ghi); thiếu `args` hay `args` thừa là lỗi `E_POPUP_ARGS`.
6. **Given** tham số chỉ là chuỗi thay thế (không biểu thức, không điều kiện), **When** kiểm tra, **Then** mọi chuỗi có ký tự ngoài `[A-Za-z0-9_.]` trong giá trị tham số kiểu `tagPrefix` bị từ chối (chống chèn ký tự, Constitution V).

---

### User Story 8 - Tài liệu người dùng, huấn luyện và hồ sơ pilot (Priority: P1)

Một kỹ sư mới của khách hàng đọc **Hướng dẫn kỹ sư** và dựng được project đầu tiên không cần hỏi: tạo Tag, kết nối Modbus, vẽ màn hình, gắn Tag, logic, nạp xuống. Người vận hành đọc **Hướng dẫn vận hành** (một trang tóm tắt): đăng nhập, xem, điều khiển, hiểu STALE/BAD, làm gì khi mất kết nối. Quản trị viên đọc **Hướng dẫn quản trị**: cài đặt, chứng chỉ, tài khoản, backup, cập nhật, gia cố, chẩn đoán, sự cố thường gặp. Có giáo trình huấn luyện ba nhóm (vận hành 2 giờ, kỹ sư 1 ngày, quản trị nửa ngày) kèm bài thực hành và bài kiểm. Hồ sơ pilot gồm kế hoạch, tiêu chí vào/ra, mẫu nhật ký sự cố và mẫu biên bản nghiệm thu.

**Why this priority**: không có tài liệu và huấn luyện thì khách hàng không tự vận hành được, pilot không có ý nghĩa; Master Plan Sprint 7 liệt kê rõ.

**Independent Test**: người chưa dùng hệ thống thực hiện bảng tác vụ trong từng hướng dẫn (⚠️🔌 cần người); kiểm tự động liên kết, khối lệnh và danh mục mã lỗi.

**Acceptance Scenarios**:

1. **Given** ba hướng dẫn trong `docs/user/`, **When** chạy `tools/docs-check.mjs`, **Then** 0 liên kết hỏng, mọi lệnh CLI nêu trong tài liệu có trong `--help` hiện hành, mọi mã lỗi của API có trong `docs/user/error-codes.md`.
2. **Given** bảng tác vụ của Hướng dẫn kỹ sư (≥ 12 tác vụ), **When** một kỹ sư chưa biết hệ thống làm theo tài liệu, **Then** hoàn thành ≥ 90 % tác vụ mà không hỏi người (⚠️🔌 cần người; không có người thử thì ghi "tự đo").
3. **Given** giáo trình huấn luyện, **When** đọc, **Then** có mục tiêu, thời lượng, bài thực hành có kết quả mong đợi, bài kiểm thực hành có tiêu chí đạt cho từng nhóm.
4. **Given** hồ sơ pilot, **When** đọc, **Then** có: phạm vi, site và điều kiện, vai trò, lịch, tiêu chí vào, tiêu chí ra đo được, mức sự cố S1–S4 và thời hạn phản hồi, mẫu nhật ký sự cố, quy trình thu thập số liệu, mẫu biên bản nghiệm thu, danh sách việc cần khách hàng.

---

### User Story 9 - Nghiệm thu pilot và phát hành 1.0.0 (Priority: P1)

Hai site chạy bản `1.0.0-rc.N` ít nhất 30 ngày; bàn thử nội bộ chạy song song. Mỗi tuần công cụ thu `system/diagnostics` và tính KPI. Cuối kỳ, Tech Lead đối chiếu từng tiêu chí ra: uptime tiến trình ≥ 99,9 %, 0 sự cố S1, tối đa 2 sự cố S2 đều có giải pháp, độ trễ phía thiết bị p95 ≤ 500 ms, ghi eMMC ≤ 2 GB mỗi ngày, tuổi thọ ước tính ≥ 5 năm, khách hàng ký biên bản. Đạt thì gắn tag `1.0.0`, ký và phát hành; không đạt thì ghi báo cáo giới hạn và kế hoạch.

**Why this priority**: là nghiệm thu của GĐ 6 và của toàn bộ lộ trình v2 (Master Plan: Pilot & Release).

**Independent Test**: công cụ tính KPI chạy trên dữ liệu thử (`tests/pilot-kpi/` có bộ dữ liệu mẫu và kết quả mong đợi); phần pilot thật là task ⚠️🔌 (khách hàng, người, thiết bị, thời gian).

**Acceptance Scenarios**:

1. **Given** dữ liệu `system/diagnostics` thu mỗi 15 phút, **When** chạy `tools/pilot/kpi.mjs`, **Then** ra bảng uptime, số lần khởi động lại (và nguyên nhân), RSS, CPU, ghi đĩa mỗi ngày, `liveLagP95Ms`, chỉ số tuổi thọ eMMC, số sự cố theo mức; khớp bộ dữ liệu mẫu 100 %.
2. **Given** kết thúc pilot, **When** đối chiếu tiêu chí ra ([contracts/test-protocols.md](contracts/test-protocols.md) §5), **Then** mỗi tiêu chí có số đo, nguồn và kết luận Đạt, Không đạt hoặc Chưa đo; chỉ khi mọi tiêu chí bắt buộc Đạt mới gắn `1.0.0`.
3. **Given** một sự cố S1 xảy ra trong pilot, **When** xử lý, **Then** đồng hồ pilot dừng và chỉ tính lại sau khi sửa và qua hồi quy (quy tắc "đồng hồ pilot" của kế hoạch).
4. **Given** biên bản nghiệm thu, **When** khách hàng ký (⚠️🔌), **Then** hồ sơ lưu ở `docs/pilot/` kèm danh sách hạn chế còn lại; không có biên bản thì ghi "chưa nghiệm thu bởi khách hàng".
5. **Given** quyết định Go/No-Go cuối, **When** tính các mục Definition of Done của Master Plan §14.6, **Then** mỗi mục có bằng chứng hoặc ghi "chưa đạt" kèm lý do; trạng thái cuối cập nhật vào roadmap §4.7.

---

### Edge Cases

**An toàn và bảo mật**

- `Host` có cổng (`192.168.1.110:8443`), IPv6 trong ngoặc (`[fe80::1]:8080`), hoa thường, dấu chấm cuối (`bl335.local.`), thiếu hoàn toàn (HTTP/1.0): quy tắc của contract §1; thiếu `Host` trên HTTP/1.1 là 400; HTTP/1.0 thiếu `Host` chấp nhận chỉ khi nguồn là loopback.
- Hai tên máy trỏ về cùng IP, DDNS đổi IP: tên phải có trong `allowedHosts`; IP literal không bao giờ cần.
- Khóa (tên, IP) có chiếm bộ nhớ: tối đa 4.096 cặp, vượt thì đẩy cặp cũ nhất; khóa mất khi khởi động lại (như 005) nhưng nhật ký audit giữ.
- Đồng hồ hệ thống nhảy (NTP) khi đang khóa hoặc đang đo xung: dùng đồng hồ monotonic cho mọi hạn.
- Nhật ký xung: đĩa đầy hoặc không ghi được: lệnh xung bị từ chối `PULSE_JOURNAL_FAILED` trước khi ghi giá trị bật (không bao giờ bật mà không có bản ghi nhả).
- Hai xung cùng một Tag chồng nhau: lệnh sau bị `REJECTED` `PULSE_IN_PROGRESS` (006/007 giữ hành vi), nhật ký chỉ một mục mỗi Tag.
- Gateway TCP: phản hồi muộn của yêu cầu đã timeout đến sau yêu cầu mới: bỏ theo `transactionId`, không gán nhầm cho yêu cầu khác.
- Gói có file thừa là `.mat-backup/`, `.mat-editor/`, thư mục ẩn của hệ điều hành: Studio phải loại khi đóng gói; runtime từ chối.
- Thiết bị thiếu `lsblk`/`mmc` (không đọc được tuổi thọ eMMC): `emmcLife` là `null` kèm lý do; báo cáo ghi "không hỗ trợ".

**Độ bền và đo lường**

- Soak bị gián đoạn vì mất điện của phòng thử: ghi nhận, đồng hồ soak chạy lại từ đầu hoặc nối tiếp có chú thích (không cộng dồn che giấu); số ngày hợp lệ là số ngày liên tục.
- Bộ lấy mẫu làm tăng ghi eMMC: nó chỉ ghi tmpfs, quay vòng ≤ 8 MB; số đo ghi đĩa loại trừ nó.
- Cắt điện làm hỏng bộ điều khiển nguồn chứ không phải thiết bị: lần đó bỏ, ghi chú.
- Mạng phòng thử cắt giữa 7 ngày: không dừng soak; bộ lấy mẫu lưu cục bộ trên tmpfs và thu bù (`/run`, mất khi cắt điện: chấp nhận, ghi chú).

**Phát hành và cập nhật**

- Chứng chỉ hết hạn giữa hai bản phát hành: chữ ký cũ vẫn hợp lệ nhờ dấu thời gian; bản mới cần chứng chỉ mới.
- Khóa phát hành lộ: quy trình thu hồi (contract `release-signing.md` §6): xoay khóa bằng gói keyset ký bởi khóa dự phòng, thông báo khách hàng.
- OTA khi ổ đĩa đầy: kiểm chỗ trống trước (≥ 3 lần kích thước gói), từ chối `INSUFFICIENT_SPACE`.
- OTA nâng lên bản có `projectFormatMax` thấp hơn project đang chạy: từ chối `PROJECT_INCOMPATIBLE`.
- Mất kết nối giữa lúc tải gói lên: phần đã nhận bị xóa, khóa nhả; không có gói dở nào được dùng.
- Studio 1.0 với runtime 0.6 (cũ): Studio hiện "thiết bị chưa hỗ trợ cập nhật/logic" và ẩn chức năng tương ứng, không lỗi.

**Logic**

- Điều kiện luật dùng Tag chuỗi hoặc kiểu sai: lỗi kiểm tra (`E_LOGIC_TYPE`).
- Thời gian giữ (`hold`) và `pt` nhỏ hơn chu kỳ quét: bị làm tròn lên chu kỳ quét, validator cảnh báo.
- Chia cho 0 trong biểu thức: giá trị lỗi của biểu thức (006), điều kiện là `unknown` → luật `SUSPENDED`.
- Totalizer: dt lớn bất thường (runtime bị treo): khoảng đó không cộng (> `maxGapMs`), đếm vào `gapSeconds`.
- Đồng hồ hệ thống nhảy: totalizer, timer, giờ chạy dùng đồng hồ monotonic; chỉ lịch dùng giờ thực.
- Counter tràn số: dừng ở giá trị lớn nhất của kiểu (INT64) và đặt cờ `overflow`, không quay vòng.
- Khởi động khi retain hỏng: counter và totalizer về 0, cảnh báo `LOGIC_RETAIN_LOST`, audit.
- Hai luật ghi cùng Tag ngược nhau trong cùng chu kỳ: thứ tự theo `id` luật (ổn định), validator cảnh báo `W_LOGIC_WRITE_CONFLICT`.
- Nạp xuống project có logic mới trong lúc đang đếm: counter/totalizer có `id` giữ nguyên thì giữ giá trị; `id` mới thì bắt đầu từ 0; id bị xóa thì bỏ.

**Trình vẽ SVG**

- Phần tử có `transform` kiểu `matrix` cùng `skewX`: bake vào hình học chỉ khi chính xác (ma trận không nghiêng); còn lại giữ `transform` và cảnh báo khi đổi cỡ không đều.
- Văn bản dùng phông không có trên Chrome của khách: danh sách phông an toàn (`sans-serif`, `serif`, `monospace`, `Arial`, `Segoe UI`, `Roboto`); phông khác cảnh báo.
- `use`/`symbol`: chọn được như một khối; sửa nội dung `symbol` chỉ ở chế độ "Sửa ký hiệu" (tùy chọn P3, không bắt buộc).
- Nested `svg`, `mask`, `filter`, `pattern`: giữ nguyên hiển thị, không sửa sâu (Master Plan §7.3), cảnh báo.
- Dán rất lớn (> 5 MB, > 20.000 nút): từ chối trước khi parse sâu.
- Hai người sửa cùng SVG (một trong Studio, một chỉnh bằng Inkscape): Studio phát hiện file đổi trên đĩa (mtime và băm) và hỏi nạp lại hay giữ; không ghi đè im lặng.

**Template và faceplate**

- Xóa template đang có bản sao: liệt kê bản sao, hỏi "giữ dạng item thường" hay hủy.
- Popup có tham số mà item đang mở popup khác: thay popup hiện tại (007 D12), tham số mới.
- `args` chứa chuỗi dài hơn 64 byte hoặc ký tự lạ: lỗi kiểm tra.

## Requirements *(mandatory)*

### Functional Requirements

**Chung và phiên bản**

- **FR-001**: Phiên bản mục tiêu MUST là: runtime **1.0.0**, Studio **1.0.0**, định dạng project **1.0.0**, gói `.matupdate` **1.0.0**, API thiết bị bước MINOR kế tiếp của bản hiện hành lúc bắt đầu làm (ghi ở plan), giao thức live không đổi, gói `.matscada` không đổi. Các bản dựng trong feature MUST mang hậu tố `-rc.N`; gắn `1.0.0` chỉ ở quyết định Go/No-Go (US9). Lý do ở D2.
- **FR-002**: Runtime 1.0 MUST nhận project 0.1, 0.2, 0.3 và 1.0.0 (và các định dạng trung gian của GĐ 3b, 4, 5 nếu có) với kết quả như trước; Studio 1.0 MUST nâng cấp chúng lên 1.0.0 có sao lưu và có migration kiểm bằng cặp file. Ma trận tương thích Studio ↔ runtime ↔ định dạng MUST ghi ở `docs/user/admin-guide.md`.
- **FR-003**: Mọi kiểm tra tự động của feature 003 đến 010 MUST vẫn đạt (hồi quy), kể cả vector chung C++ ↔ TS, `ci-local.ps1`, `device-it`, `driver-it`, `web-it`.
- **FR-004**: Mã mới MUST NOT dùng `eval`, `new Function`, `innerHTML`, script tùy ý; logic MUST là dữ liệu khai báo (Constitution V). Lint hiện có (`apps/runtime-web`, `packages/ui-components`) MUST mở rộng cho `apps/studio/src/ui/svg/`, `apps/studio/src/ui/logic/`, `packages/logic-engine/`.
- **FR-005**: Ngân sách (Constitution III) MUST giữ ở cấu hình chuẩn kèm logic: RSS ≤ 150 MB, CPU ≤ 30 %, ghi eMMC ≤ 2 GB/ngày, SQLite cache ≤ 32 MB, tmpfs ≤ 64 MB; phần vượt phải có số đo và ADR.
- **FR-006**: Mọi mã lỗi và cảnh báo mới MUST có test, thông điệp tiếng Việt, và dòng trong `docs/user/error-codes.md` (sinh bằng `tools/gen-error-codes.mjs` từ danh mục mã trong mã nguồn).
- **FR-007**: Mọi thao tác trên BL335 MUST theo Constitution (quy trình bước 3): chỉ khi người dùng cho phép; ghi vào `docs/reports/device-changes.md` kèm cách hoàn tác; không đụng `atscada-*`, `piano-edtech-*`; không khởi động lại hay cắt điện nếu không có người đồng ý và ở cạnh; không ghi mật khẩu vào repo.
- **FR-008**: `runtime.json` MUST có thêm các khóa (mặc định an toàn, kiểm giá trị): `allowedHosts` (mảng chuỗi, mặc định rỗng), `hostCheck` (`strict` mặc định, `off`), `maxConnPerSource` (mặc định 24, 4 đến 64), `maxConcurrentLogins` (2, 1 đến 4), `pulseRecovery` (`on` mặc định, `off`), `update` (`enabled` mặc định `false`, `maxPackageMiB` 64, `trustedKeysDir`), `logic` (`writes` mặc định `off`, `maxWritesPerMin` 20, `flushS` 60, `scanMs` 100), `tzOffsetMin` (420: UTC+7). Mô tả đầy đủ ở [contracts/device-api-011.md](contracts/device-api-011.md) §6.
- **FR-009**: `GET /api/v1/system/diagnostics` MUST thêm các trường KPI: `uptimeS`, `restarts` (kèm nguyên nhân gần nhất), `rssMb`, `rssPeakMb`, `cpuPct` (trung bình 5 phút), `fdCount`, `threads`, `ioWriteBytesToday` (theo thành phần), `emmcLife` (`typeA`, `typeB`, `null` khi không đọc được), `liveLagP95Ms` (p95 từ lúc Tag Engine commit tới lúc ghi khung WebSocket, cửa sổ 5 phút), `clients`, `timeSynced`. Role tối thiểu viewer (như 005); không lộ bí mật.
- **FR-010**: `GET /api/v1/system/info.warnings` MUST thêm: `HOST_CHECK_OFF`, `SSH_ROOT_PASSWORD`, `PULSE_STUCK`, `LOGIC_WRITES_OFF`, `LOGIC_THROTTLED`, `LOGIC_RETAIN_LOST`, `UPDATE_ROLLED_BACK`, `TIME_NOT_SYNCED`, `UPDATE_KEYS_MISSING` (khi OTA bật mà không có khóa tin cậy).

**US1: bảo mật và xử lý phát hiện tồn**

- **FR-011**: Runtime MUST kiểm `Host` của mọi yêu cầu HTTP, HTTPS và nâng cấp WebSocket theo contract §1: chấp nhận khi `Host` là địa chỉ IPv4/IPv6 literal (bất kỳ), `localhost`, tên máy của thiết bị (và `<tên>.local`), hoặc có trong `allowedHosts`; còn lại trả 421 `HOST_NOT_ALLOWED` không kèm dữ liệu. `hostCheck: off` tắt kiểm và MUST sinh cảnh báo `HOST_CHECK_OFF`.
- **FR-012**: Kiểm `Origin == scheme://Host` của ADR-006 và 021 MUST giữ; kiểm `Host` chạy trước mọi xử lý khác (trước đăng nhập, trước phục vụ file). Ca bị từ chối MUST ghi audit `access.denied` gộp theo cửa sổ 60 s của 005, kèm giá trị `Host` đã cắt ở 64 byte.
- **FR-013**: `deploy.sh`, `docs/deployment/mat-runtime.md` MUST nhắc cách thêm tên miền vào `allowedHosts` khi khách hàng truy cập bằng tên (DDNS, DNS nội bộ); `GET /device/identity` MUST trả danh sách tên và IP đang được chấp nhận để Studio hiện.
- **FR-014**: Khóa đăng nhập MUST theo cặp (tên tài khoản, IP nguồn): 5 lần sai liên tiếp khóa cặp đó 5 phút; lặp lại nhân đôi tới tối đa 60 phút (không bao giờ khóa vĩnh viễn). Khóa theo tên thuần túy (không IP) MUST bị bỏ. Tài khoản bị khóa ở IP A MUST đăng nhập được từ IP B nếu không bị khóa ở B.
- **FR-015**: Khóa theo IP MUST giữ: 20 lần sai (mọi tên) trong 10 phút từ một IP khóa mọi đăng nhập từ IP đó 5 phút. Đăng nhập thành công MUST chỉ xóa bộ đếm của cặp (tên, IP) tương ứng, không xóa bộ đếm IP hay bộ đếm tên khác.
- **FR-016**: Số lần kiểm mật khẩu Argon2id chạy đồng thời MUST giới hạn bằng `maxConcurrentLogins` (mặc định 2); vượt thì 429 `LOGIN_BUSY` kèm `Retry-After` (bảo vệ CPU, không khóa ai). Phát hiện tấn công phân tán (≥ 50 lần sai trong 10 phút trên cùng một tên từ ≥ 5 IP) MUST ghi audit `auth.distributed_attack` (gộp 10 phút) mà không khóa tài khoản.
- **FR-017**: Lệnh root `--user-unlock <tên>` và `--user-unlock-all` MUST xóa khóa trong bộ nhớ qua tệp yêu cầu hoặc khởi động lại dịch vụ; mật khẩu mới (`--user-add`, `--user-passwd`) MUST dài ≥ 10 ký tự (tài khoản cũ không bị ép).
- **FR-018**: Xung `pulseMs` MUST ghi **nhật ký xung** (`<dataDir>/pulse.journal`, fsync) gồm mã yêu cầu, Tag, giá trị nhả, giờ nhả (monotonic và đồng hồ thực) **trước** khi ghi giá trị bật; không ghi được nhật ký thì từ chối lệnh `FAILED` `PULSE_JOURNAL_FAILED` và không ghi gì xuống thiết bị. Mục bị xóa khỏi nhật ký khi lệnh nhả đã được thiết bị xác nhận.
- **FR-019**: Khi khởi động, nếu `pulseRecovery: on` và nhật ký còn mục, runtime MUST ghi giá trị nhả của từng mục ngay khi kênh tương ứng nối được (thử lại mỗi 5 s, tối đa 10 phút), ghi audit `tag.write` với nguồn `pulse-recovery` và kết quả; hết hạn mà chưa nhả được thì ghi audit `FAILED`, giữ mục và hiện cảnh báo `PULSE_STUCK` (Studio hiện chip đỏ ở Bảng theo dõi).
- **FR-020**: `releasePulse` MUST NOT ngủ trên luồng xung; việc nhả MUST được hẹn lại theo thời điểm khi hàng đợi driver đầy (R-6 của 007).
- **FR-021**: Driver Modbus TCP chuẩn (có MBAP) MUST cô lập timeout theo thiết bị (unit id): timeout của một yêu cầu chỉ làm Tag của yêu cầu đó (và thiết bị đó) thành BAD với lý do; kết nối giữ nguyên; phản hồi đến muộn MUST bị bỏ theo `transactionId`. Kết nối chỉ bị đóng khi lỗi socket, lỗi khung, hoặc ≥ 3 timeout liên tiếp trên ≥ 2 thiết bị khác nhau. RTU qua TCP (không MBAP) và RTU nối tiếp giữ hành vi cũ.
- **FR-022**: Thiết bị bị timeout MUST bị backoff riêng (tăng dần 1 s đến 30 s) và thử lại khi hết backoff, không làm chậm chu kỳ quét của thiết bị khác quá 1 chu kỳ.
- **FR-023**: `persist()` của pipeline nạp xuống và của kho trạng thái liên quan MUST sao chụp trạng thái dưới mutex rồi ghi và fsync ngoài mutex (tuần tự hóa bằng khóa ghi riêng và số thứ tự); lỗi `writeOp` MUST làm thao tác thất bại `PERSIST_FAILED` trước khi kích hoạt (không chỉ ghi log).
- **FR-024**: Kiểm gói và kiểm project (TS và C++) MUST từ chối file không được `manifest.json` và project tham chiếu: `E_PACKAGE_EXTRA_FILE`; ngoại lệ có tên (`.mat-backup/`, `.mat-editor/`) MUST bị Studio loại khi đóng gói và bị runtime từ chối nếu có. Digest gói và digest project MUST tính trên cùng tập file. Vector chung `tests/package-vectors` MUST thêm ≥ 10 ca.
- **FR-025**: Mỗi IP nguồn MUST bị giới hạn số kết nối đồng thời tới runtime (HTTP, HTTPS, WebSocket cộng chung) bằng `maxConnPerSource`; vượt thì đóng kết nối mới ngay. `httpsThreads` và `maxConnPerSource` MUST được cấu hình sao cho một nguồn không thể chiếm quá 60 % worker; số này ghi trong tài liệu và đo trên BL335.
- **FR-026**: Nhấp trong 400 ms đầu sau khi hộp xác nhận mở MUST bị bỏ qua (S-L3 của 007); `ChartWindow` MUST xử lý đồng hồ nguồn lùi (đặt lại cửa sổ khi lùi > 2 s, bỏ mẫu lùi nhỏ hơn) (R-8); các mục Low rẻ của 005 đến 007 (`users.json` mặc định quyền, giới hạn độ dài tên trong gói discovery, độ sâu biểu thức, người nghe widget ném lỗi, `setInterval` không dọn, `#poll` bỏ qua 403/5xx) MUST xử lý theo bảng ở plan, mỗi mục một test.
- **FR-027**: Toàn bộ phụ thuộc MUST được rà: `cargo audit` (Cargo.lock của Studio), `npm audit` (cả `--omit=dev` và đầy đủ), rà license mọi gói của `package-lock.json`, `Cargo.lock` và `third_party/` (ghi `third_party/LICENSES.md` và `licenses.md` của bản phát hành), CVE của thư viện vendored (CivetWeb, Mbed TLS, SQLite, miniz, argon2, nlohmann, valijson) theo phiên bản. Không GPL/LGPL link tĩnh; LGPL chỉ nạp động (Constitution).
- **FR-028**: SAST MUST chạy `cppcheck` và `clang-tidy` (`bugprone-*`, `cert-*`, `clang-analyzer-security.*`, `concurrency-*`) trên `core/`, `server/`, `drivers/` trong container toolchain, và ESLint với bộ quy tắc bảo mật hiện có trên mọi mã TS; mỗi phát hiện MUST có phân loại (sửa, ngoại lệ có lý do và nhận xét trong mã, hoặc dương tính giả).
- **FR-029**: Fuzz MUST chạy ≥ 1 giờ cho mỗi mục tiêu dưới ASan và UBSan: Modbus TCP và RTU (có từ 006), trình đọc gói `.matscada`, parser project JSON, bộ đọc `.matupdate`, parser biểu thức và `logic.json`, bộ lọc SVG (TS, fuzz bằng bộ sinh tất định); 0 sự cố; kho mầm lưu trong `tests/fuzz-corpus/`.
- **FR-030**: `ci-local.ps1` MUST có thêm: bước `ctest` đầy đủ dưới ASan và UBSan (còn nợ từ 006), bước `audit` (cargo audit, npm audit; bỏ qua có thông báo khi không có mạng), bước SAST (cppcheck, clang-tidy), bước `docs-check`. Bước không chạy được MUST in "BỎ QUA: lý do", không báo xanh.
- **FR-031**: Mô hình mối đe dọa (`docs/architecture/threat-model.md`) MUST được cập nhật cho toàn sản phẩm: giao diện (HTTP, HTTPS, WebSocket, UDP discovery, CLI root, gói, file project, cổng serial, DB ngoài, Tauri IPC, OTA, logic), tài sản, kẻ tấn công, biện pháp, rủi ro còn lại; mỗi phát hiện Medium trở lên của review MUST ánh xạ tới một dòng.
- **FR-032**: Review bảo mật MUST do hai agent độc lập (`security-auditor`, `code-reviewer`) trên `git diff <mốc 007>..HEAD` cộng bằng chứng động (`web-it`, `device-it`, `driver-it`); báo cáo `docs/reports/011-security-review.md` MUST có bảng phát hiện với mức, nguồn, xử lý, bằng chứng; không còn Critical hoặc High mở; Medium mở chỉ cho phép khi chờ người (ghi rõ ai, làm gì, vì sao).
- **FR-033**: Hướng dẫn gia cố thiết bị MUST có (`docs/deployment/hardening.md`): SSH chỉ khóa công khai và `PermitRootLogin prohibit-password`, đóng port-forward 9080 và 22 ra Internet, VPN, giới hạn kết nối theo nguồn bằng `nft` (`ct count`), đặt `viewerLogin: required` khi mở ra ngoài LAN, IP tĩnh, đồng bộ NTP, quyền tập tin. Việc áp lên BL335 MUST là task ⚠️🔌 chờ người dùng đồng ý (đổi sshd có thể làm mất truy cập).
- **FR-034**: `system/info.warnings` MUST có `SSH_ROOT_PASSWORD` khi `/etc/ssh/sshd_config` (và `sshd_config.d/*`) cho phép đăng nhập root bằng mật khẩu (đọc chỉ-đọc; không đọc được thì không cảnh báo).
- **FR-035**: Mọi phát hiện Medium của 005, 006, 007 MUST có dòng trong bảng truy vết ở plan (mục "Phát hiện tồn") với trạng thái: đã sửa kèm test, đã đóng từ trước kèm bằng chứng, hoặc chờ người; không có dòng nào để "ghi nhận".
- **FR-036**: Studio MUST hiện chip cảnh báo từ `system/info.warnings` mới (US1) trong thanh trạng thái và trang Thiết bị với văn bản hướng dẫn hành động; không chặn thao tác.

**US2: tải, soak, mất điện**

- **FR-037**: Bộ lấy mẫu `mat-sample` (script sh, chạy trên thiết bị, chỉ đọc) MUST ghi mỗi 60 s một dòng JSON vào tmpfs (`/run/mat-sample/`, quay vòng ≤ 8 MB): thời gian, RSS và HWM, CPU (jiffies), FD, luồng, `/proc/<pid>/io`, kích thước `*.db`/`-wal`, dung lượng đĩa và tmpfs, nhiệt độ, `mmc` life time khi có; công cụ thu `tools/soak/collect.ps1` kéo về máy dev mỗi giờ (SSH hoặc `system/diagnostics`).
- **FR-038**: Công cụ tải `tools/load-tester` MUST mở rộng: 500 và 1.000 Tag, 10 client WebSocket kèm client 11, F5 đồng loạt 50 vòng, màn hình 250 item/300 đến 500 phần tử SVG qua Chrome headless, cắt mạng 50 lần; xuất JSON theo mẫu của `docs/reports/011-load.md`.
- **FR-039**: Soak MUST gồm: soak gia tốc x64 24 giờ (Docker) làm tiền kiểm, soak BL335 7 ngày (⚠️🔌), soak bàn thử 30 ngày song song với pilot (⚠️🔌); tiêu chí đạt ở US2-4; kết quả MUST kèm đồ thị RSS, ghi đĩa, FD theo thời gian.
- **FR-040**: `mat-runtime --check-data` MUST kiểm chỉ đọc, ≤ 30 s: `PRAGMA integrity_check` (quick) cho `history.db`, `audit.db`, `projects/` (digest khớp `state.json`), `retain/`, `pulse.journal`, `logic-state`; trả mã thoát 0 (nguyên vẹn), 1 (cảnh báo phục hồi được), 2 (hỏng); in JSON.
- **FR-041**: Bộ điều khiển nguồn (`tools/powercut/powercut.mjs`) MUST hỗ trợ ổ cắm HTTP (Tasmota), rơ-le USB nối tiếp và chế độ tay (nhắc người rút); chu trình: cắt ở thời điểm (ngẫu nhiên hoặc theo sự kiện từ nhật ký), chờ 5 s, cấp điện, chờ dịch vụ ≤ 90 s, chạy `--check-data` và kiểm audit; ghi JSON từng vòng. Điều kiện cắt có chủ đích: giữa các bước nạp xuống, giữa các bước OTA, khi `history.db` ghi dày, khi xung đang chờ, khi lưu trạng thái logic (≥ 10 lần mỗi điểm).
- **FR-042**: Kiểm audit sau cắt điện MUST đối chiếu nhật ký của bộ phát lệnh (mỗi lệnh ghi `ACCEPTED` kèm mã yêu cầu) với `audit.db`: 0 lệnh `ACCEPTED` thiếu audit.
- **FR-043**: Tiền kiểm mất điện trên x64 MUST chạy 100 vòng `kill -9` ngẫu nhiên và ở các điểm nhạy cảm (Docker) kèm `--check-data`; báo cáo MUST nêu hạn chế (không mô phỏng mất bản ghi chưa fsync) và không thay thế phần cắt điện thật.
- **FR-044**: Báo cáo `011-load.md`, `011-soak.md`, `011-powercut.md` MUST ghi: phiên bản, cấu hình, điều kiện, số đo, dữ liệu thô (`docs/reports/011-*.json`), kết luận theo tiêu chí, và các mục chưa đo.
- **FR-045**: Số đo ghi eMMC MUST phân theo thành phần (history, audit, retain, logic, log, project, SQLite WAL) bằng `/proc/<pid>/io` và kích thước tệp; tuổi thọ eMMC MUST đọc từ `EXT_CSD` (`DEVICE_LIFE_TIME_EST_TYP_A/B`, `PRE_EOL_INFO`) khi có; công thức ước tính ở contract `test-protocols.md` §3.
- **FR-046**: Kết luận ngân sách (Master Plan §6): mỗi chỉ tiêu MUST là Đạt, hoặc Không đạt kèm báo cáo giới hạn và phương án (không che giấu).

**US3: bộ cài ký số và phát hành**

- **FR-047**: Bộ cài Studio (NSIS), `mat-studio.exe` và trình gỡ cài đặt MUST ký Authenticode `SHA256` kèm dấu thời gian RFC 3161 (`/tr`, `/td sha256`) khi phát hành. Chữ ký MUST kiểm lại ngay sau khi ký và sau khi chép vào thư mục phát hành.
- **FR-048**: `tools/release/sign.ps1` MUST có ba chế độ: `store` (chứng chỉ theo dấu vân tay trong kho Windows hoặc token phần cứng), `command` (lệnh ngoài cho dịch vụ ký đám mây, nhận đường dẫn file), `test` (chứng chỉ tự ký thử). Khóa riêng và mật khẩu MUST NOT nằm trong repo hay log. Tauri `bundle.windows.signCommand` MUST gọi script này.
- **FR-049**: `release.ps1 -Release` MUST từ chối khi chứng chỉ là chứng chỉ thử (chuỗi `TEST` trong chủ thể), tự ký, hết hạn trong 30 ngày tới, thiếu EKU Code Signing (1.3.6.1.5.5.7.3.3), hoặc thiếu dấu thời gian sau khi ký; lỗi MUST dừng trước khi tạo `release/<ver>/`.
- **FR-050**: Chế độ thử MUST dùng chứng chỉ do `tools/release/make-test-cert.ps1` tạo trong `Cert:\CurrentUser\My` (không thêm vào kho tin cậy, không cần quyền admin) và có lệnh gỡ; kiểm bằng `Get-AuthenticodeSignature` (`NotTrusted` đúng kỳ vọng) và `signtool verify /pa /v`.
- **FR-051**: Bộ kiểm chữ ký `tools/release/verify-release.ps1` MUST chạy 12 ca hỏng (sửa 1 byte ở bộ cài, ở `mat-studio.exe`, xóa chữ ký, đổi chứng chỉ, bỏ dấu thời gian, đổi `SHA256SUMS`, sửa `SHA256SUMS.sig`, sai khóa công khai, v.v.) và MUST từ chối cả 12.
- **FR-052**: Thư mục phát hành `release/<ver>/` MUST gồm: bộ cài, `mat-runtime-armhf.tar.gz` (+ `.sha256`), `*.matupdate`, `SHA256SUMS`, `SHA256SUMS.sig` (ECDSA P-256 qua `openssl dgst -sha256 -sign`), `sbom.cdx.json` (CycloneDX 1.5, sinh bằng `tools/release/sbom.mjs` từ `package-lock.json`, `Cargo.lock`, `third_party/LICENSES.md`, không thêm phụ thuộc), `licenses.md`, `RELEASE-NOTES.md`, `build-info.json` (mã commit, phiên bản công cụ, ngày dựng).
- **FR-053**: Khóa ký phát hành (ECDSA P-256) MUST do người phát hành giữ ngoại tuyến (token hoặc máy ký không nối mạng); runtime chỉ chứa khóa công khai (`/etc/mat-runtime/trusted-keys/*.pem`, root, 0644). Phải có 2 khóa: chính và dự phòng; quy trình xoay và thu hồi ở contract `release-signing.md` §6.
- **FR-054**: `docs/release/signing.md` MUST mô tả: loại chứng chỉ (OV/EV, khóa trên phần cứng theo quy định của CA/Browser Forum), nơi mua và chi phí tham khảo là điều cần người, ai giữ, quy trình ký từng bước, dấu thời gian, gia hạn, thu hồi, lộ khóa, và hạn chế của SmartScreen.
- **FR-055**: `docs/release/process.md` MUST có quy trình phát hành và danh mục kiểm (checklist): CI xanh, hồi quy, báo cáo, ký, kiểm lại, cài thử trên Windows 10 và 11 sạch và trên BL335, ghi chú phát hành, lưu trữ artefact và khóa, số phiên bản và thẻ git.
- **FR-056**: Studio MUST hiện trạng thái chữ ký của chính nó ở "Giới thiệu" (đọc qua lệnh Tauri chỉ-đọc: người ký và dấu vân tay hoặc "chưa ký" cho bản dev); không tự cập nhật (D34).

**US4: OTA**

- **FR-057**: Gói cập nhật `.matupdate` MUST theo [contracts/update-package.md](contracts/update-package.md): phong bì gồm `update.json` (manifest), `update.sig` (ECDSA P-256, DER, trên SHA-256 của byte `update.json`), `payload.tar.gz`; manifest có `format`, `product`, `version`, `releaseSeq`, `arch`, `minFromVersion`, `projectFormatMax`, `payloadSha256`, `files[]` (đường dẫn, băm, kích thước, mode), `updaterRequired`, `notes`.
- **FR-058**: OTA MUST mặc định tắt (`update.enabled: false`). Khi tắt, mọi endpoint cập nhật MUST trả 404 `UPDATE_DISABLED`. Bật cần root sửa `runtime.json`, có ít nhất một khóa trong `trustedKeysDir`, và khởi động lại dịch vụ.
- **FR-059**: API cập nhật MUST chỉ nhận qua HTTPS, phiên Bearer (không cookie web: `SESSION_SCOPE`), role `administrator`, và ghi audit bền trước khi nhận byte đầu: `system.update.accepted`/`rejected`/`committed`/`rolled-back`/`manual-rollback`. Bước áp dụng MUST đòi nhập lại mật khẩu (xác thực lại, D35).
- **FR-060**: Tải lên MUST giới hạn `maxPackageMiB` (mặc định 64), chống slowloris (tốc độ tối thiểu, hạn tổng), ghi vào `<dataDir>/update/incoming/` với mode 0600 và dọn khi lỗi; chỉ một cập nhật tại một thời điểm, dùng chung khóa với nạp xuống (`DEVICE_BUSY`).
- **FR-061**: Kiểm gói MUST thực hiện đủ và theo thứ tự: kích thước, đọc phong bì có giới hạn, chữ ký trên manifest bằng khóa tin cậy (từ chối khóa lạ), `payloadSha256`, danh sách `files[]` (đường dẫn tương đối sạch, không `..`, không tuyệt đối, không liên kết, không thiết bị, không file thừa hay thiếu, tổng giải nén ≤ 128 MiB và tỉ lệ nén ≤ 20), `product` và `arch`, `releaseSeq` > bản đang chạy (chống hạ cấp, D36), `minFromVersion`, `projectFormatMax` ≥ định dạng project đang chạy, chỗ trống ≥ 3 lần kích thước.
- **FR-062**: Runtime (không đặc quyền) MUST chỉ kiểm sơ bộ và đặt gói đã qua kiểm vào `<dataDir>/update/ready/` cùng tệp yêu cầu; việc thay thế do `mat-updater` (root, oneshot, kích hoạt bởi `mat-updater.path`) thực hiện, kiểm lại toàn bộ trên bản sao thuộc root trước khi làm bất cứ điều gì (không tin kiểm của runtime, tránh TOCTOU).
- **FR-063**: `mat-updater` MUST thay thế atomic theo cùng bố cục với `deploy.sh` (`/opt/mat-runtime.new` → đổi tên, giữ `/opt/mat-runtime.prev`), ghi trạng thái từng bước vào `<dataDir>/update/ops/<id>.json` (fsync) trước mỗi bước, chạy kiểm tra sức khỏe 60 s (tiến trình sống, HTTP và HTTPS trả lời, `system/info` đúng phiên bản và digest project), tự quay về `.prev` khi lỗi, và ghi `last.json`. Runtime mới MUST ghi audit `system.update.committed` hay `rolled-back` ở lần khởi động đầu sau cập nhật.
- **FR-064**: Dữ liệu (`/var/lib/mat-runtime`), project, cấu hình `/etc/mat-runtime`, chứng chỉ, tài khoản MUST không bị cập nhật động tới; `runtime.json` mới MUST tương thích ngược (khóa lạ bị bỏ qua có cảnh báo).
- **FR-065**: Có API: `POST /api/v1/system/update` (tải lên), `GET /api/v1/system/update` (trạng thái, kế hoạch), `POST /api/v1/system/update/apply` (xác nhận, kèm mật khẩu), `POST /api/v1/system/update/cancel`, `POST /api/v1/system/update/rollback` (quay về `.prev`), chi tiết ở [contracts/device-api-011.md](contracts/device-api-011.md) §3.
- **FR-066**: Khóa tin cậy MUST xoay được bằng gói `keyset` (manifest `kind: "keyset"`) ký bởi khóa đang tin cậy; thêm khóa mới và tùy chọn thu hồi khóa; root cũng có `--trust-key add|remove|list`.
- **FR-067**: Quy trình thủ công MUST giữ và được hỗ trợ: `deploy.sh` kiểm `SHA256SUMS` và chữ ký bằng `mat-update-verify` khi có (cảnh báo, không chặn, khi thiếu chữ ký để giữ khả năng khôi phục); là đường cài lần đầu, cập nhật `mat-updater` và khôi phục khi OTA hỏng.
- **FR-068**: Studio MUST có luồng "Cập nhật runtime" (task card trong trang Thiết bị, chỉ hiện với administrator và thiết bị báo hỗ trợ): chọn file, tải lên có tiến trình, bước xem kế hoạch (phiên bản, tương thích, thời gian ngừng ước tính, người ký), xác nhận kèm mật khẩu, theo dõi trạng thái qua nối lại, bước kết quả (thành công hoặc đã quay về và lý do), nút "Quay về bản trước".
- **FR-069**: `mat-update-verify` MUST là tệp thực thi nhỏ độc lập (Mbed TLS: SHA-256, ECDSA P-256), dùng chung cho `mat-updater`, `deploy.sh` và `release.ps1` (kiểm lại); đọc phong bì có giới hạn kích thước cố định; không phụ thuộc phần còn lại của runtime.
- **FR-070**: Thời gian ngừng phục vụ của một cập nhật hợp lệ MUST ≤ 30 s ở x64 và được đo trên BL335; toàn bộ cập nhật (nhận, kiểm, chuyển, kiểm sức khỏe) ≤ 120 s với gói ≤ 5 MB.
- **FR-071**: Sau cập nhật, phiên Bearer và phiên web MUST còn nếu `auth-state.json` đọc được như qua `execv` của 005; nếu không, đăng nhập lại; không bao giờ phiên bị nâng quyền.
- **FR-072**: Gói MAY chứa `updater/` mới (để cập nhật `mat-updater`): MUST bị từ chối (`UPDATER_MANUAL_ONLY`) trên đường OTA; chỉ cài được bằng `deploy.sh` (D5, ADR-035).

**US5: logic v2**

- **FR-073**: Project 1.0.0 MUST có tệp tùy chọn `logic.json` (schema `schemas/logic.schema.json`, kèm trong `project.json` mục `logic: "logic.json"`), ≤ 512 KiB, gồm `rules`, `timers`, `counters`, `totalizers`, `runhours`, `schedules`, `writes` theo [contracts/logic-engine.md](contracts/logic-engine.md). Không có tệp này thì runtime hoạt động như 0.6.
- **FR-074**: Logic MUST là dữ liệu khai báo; điều kiện và giá trị dùng ngôn ngữ biểu thức của 006 (ADR-015) không cộng thêm hàm có trạng thái; không vòng lặp, không hàm người dùng, không đệ quy, không truy cập mạng, tệp, giờ (trừ khối lịch).
- **FR-075**: Giới hạn: ≤ 200 luật, 100 timer, 100 counter, 50 totalizer, 50 giờ chạy, 50 lịch, 100 mục `writes`, mỗi luật ≤ 8 hành động, độ dài biểu thức theo 006; vượt là `E_LOGIC_LIMIT`.
- **FR-076**: Engine MUST đánh giá theo thứ tự phụ thuộc (sắp xếp tô-pô) trên cùng vòng tick của Tag Engine với chu kỳ `logic.scanMs` (mặc định 100 ms, tối thiểu 50), dùng đồng hồ monotonic cho mọi thời gian trôi; vòng phụ thuộc là `E_LOGIC_CYCLE`, luật đọc Tag logic do chính hành động của nó đặt là `E_LOGIC_SELF_TRIGGER`.
- **FR-077**: Luật MUST có ngữ nghĩa theo contract §2: `when`, `hold` ms, `onRise`, `onFall`, `repeatMs`, `fireOnStart` (mặc định `false`), cạnh được xác định sau khi điều kiện giữ ổn định `hold`; điều kiện `unknown` (Tag BAD/STALE/chưa có giá trị, biểu thức lỗi) đưa luật vào `SUSPENDED` (không hành động, không cạnh giả, tiếp tục từ trạng thái cũ khi hết).
- **FR-078**: Hành động MUST là một trong: `setTag` (đặt Tag logic hoặc Tag nội bộ, không audit), `write` (ghi Tag thiết bị qua `writes`), `pulse` (xung qua `writes`, cùng nhật ký xung), `toggle` (đảo Tag BOOL nội bộ). Không hành động nào khác.
- **FR-079**: Mỗi mục `writes` MUST khai báo `id`, `tag` (Tag thiết bị RW), `allowed` (danh sách giá trị hoặc `min`/`max`), `minIntervalMs` (≥ 1.000), `maxPerHour` (≥ 1); mọi hành động `write`/`pulse` MUST tham chiếu một mục `writes` và giá trị MUST nằm trong `allowed`; vi phạm là `E_LOGIC_WRITE_UNDECLARED`, `E_LOGIC_WRITE_TARGET`, `E_LOGIC_WRITE_VALUE`.
- **FR-080**: Ghi từ logic MUST đi qua `WriteCoordinator` (006) với cùng chuỗi kiểm (Tag RW, giới hạn, kết nối, hàng đợi), audit bền (`synchronous=FULL`) **trước** khi gửi, `actor` = `logic:<ruleId>`, `channel` = `logic`, giá trị cũ/mới, kết quả, và ≤ 8 giá trị đầu vào của điều kiện (đã cắt); không có đường ghi riêng ngoài `WriteCoordinator`.
- **FR-081**: Ghi từ logic MUST bị giới hạn: `minIntervalMs` và `maxPerHour` theo mục `writes`, và `logic.maxWritesPerMin` (mặc định 20, 1 đến 60) toàn thiết bị; vượt MUST `REJECTED` `RATE_LIMITED`, trạng thái luật `THROTTLED`, cảnh báo `LOGIC_THROTTLED`, audit gộp theo 60 s. Ngân sách ghi audit MUST nằm trong ngoại lệ FULL của Constitution (ở mức tối đa 20 lệnh/phút: ≈ 0,9 GB/ngày, nằm trong 2 GB/ngày).
- **FR-082**: `logic.writes` mặc định `off`: ở `off`, hành động `write`/`pulse` MUST NOT gửi gì tới thiết bị trường, MUST ghi audit `logic.write.suppressed` (gộp 60 s) và cảnh báo `LOGIC_WRITES_OFF`; Tag logic và hành động `setTag` vẫn chạy. Bật chỉ bằng `runtime.json` (root) rồi khởi động lại.
- **FR-083**: `POST /api/v1/logic/writes {"enabled": false}` (administrator, HTTPS, audit) MUST dừng ngay mọi ghi từ logic và giữ qua khởi động lại (`<dataDir>/logic-state.json`); `GET /api/v1/logic` MUST trả trạng thái từng luật và khối (`OK`, `SUSPENDED`, `THROTTLED`, `DISABLED`, lý do, lần bắn cuối).
- **FR-084**: Tag logic (đầu ra của khối) MUST là Tag nội bộ chỉ đọc với bên ngoài: ghi qua API, Bảng theo dõi hay widget MUST bị `REJECTED` `OWNED_BY_LOGIC`; id MUST duy nhất toàn project (va chạm là `E_LOGIC_TAG_COLLISION`), đề xuất tiền tố `LOGIC.`.
- **FR-085**: Timer MUST gồm `ton`, `tof`, `tp` (đầu vào BOOL, `pt` ms; đầu ra `q`, tùy chọn `et`); bảng chân trị ở contract §3; `pt` nhỏ hơn `scanMs` được làm tròn lên và cảnh báo.
- **FR-086**: Counter MUST có `up` (cạnh lên), `down` tùy chọn, `reset`, `preset`, đầu ra `value` (INT64) và `reached`; cạnh dùng đồng hồ quét (cạnh nằm giữa hai lần quét không bị bỏ nếu Tag có dấu thời gian: giới hạn ghi ở contract §4); tràn dừng ở giá trị tối đa và đặt `overflow`.
- **FR-087**: Totalizer MUST tích phân hình thang tốc độ dòng theo thời gian monotonic: nguồn Tag số, `rateUnit` (`s`, `min`, `h`, `d`), hệ số, `cutoff` (dưới ngưỡng coi là 0), `maxGapMs` (khoảng trống hay Tag BAD không cộng, tính vào `gapSeconds`), `reset` (cạnh lên), `rolloverAt` tùy chọn; đầu ra `total` (FLOAT64) và `gapSeconds`. Sai số ≤ 0,1 % với dòng hằng và quét đều.
- **FR-088**: Giờ chạy MUST đếm thời gian `run` đúng (monotonic) và số lần khởi động: đầu ra `hours`, `starts`, `due` (khi đặt `serviceEveryHours`), `reset` bảo dưỡng; không bao giờ giảm trừ khi `reset`.
- **FR-089**: Lịch MUST gồm các khung hằng tuần (`days` 1 đến 7, `from`, `to` kiểu `HH:MM`, được phép qua nửa đêm), ngoại lệ theo ngày (`date`, `mode` `on`/`off`), múi giờ cố định theo `tzOffsetMin` (không DST, không tzdata); đầu ra BOOL; khi `timeSynced` là false, đầu ra BAD `TIME_NOT_SYNCED` và luật phụ thuộc `SUSPENDED`.
- **FR-090**: Counter, totalizer, giờ chạy MUST giữ qua tắt máy bằng `RetainStore` (006): ghi mỗi `logic.flushS` giây (mặc định 60) khi có thay đổi và khi dừng có kiểm soát; mất tối đa một chu kỳ ghi; không bao giờ phục hồi giá trị nhỏ hơn giá trị đã ghi trước đó (trừ reset); retain hỏng thì về 0 kèm `LOGIC_RETAIN_LOST` và audit; Studio và validator MUST ước tính ghi đĩa/ngày của retain và cảnh báo khi > 100 MB/ngày.
- **FR-091**: Nạp xuống project có logic mới MUST giữ giá trị khối theo `id` (khối cùng `id` giữ, `id` mới bắt đầu từ 0, `id` bị xóa thì bỏ); hộp xem trước Nạp xuống MUST liệt kê "Logic sẽ tự động ghi N Tag xuống PLC" kèm danh sách và trạng thái `logic.writes` của thiết bị đích; audit `project.deploy` MUST ghi số mục `writes` và digest của `logic.json`.
- **FR-092**: Hai bản engine (TS `packages/logic-engine`, C++ `core/logic`) MUST dùng chung bộ vector `tests/logic-vectors/` (≥ 200 ca: chuỗi (t, đầu vào) → (đầu ra, hành động)), cho cùng kết luận 100 %; mô phỏng trong Studio dùng bản TS (Constitution II).
- **FR-093**: Validator (TS và C++, vector chung) MUST kiểm toàn bộ mã lỗi `E_LOGIC_*` của contract §11 (kiểu, tham chiếu Tag, giới hạn, vòng, ghi chưa khai báo, trùng id) và cảnh báo `W_LOGIC_*`.
- **FR-094**: Editor Logic trong Studio MUST theo chuẩn IDE kiểu TIA Portal (studio-ux.md): nút Logic trên cây project (nhóm: Luật, Timer, Counter, Cộng dồn, Giờ chạy, Lịch, Ghi PLC), tab editor có bảng khối, inspector theo loại, ô nhập biểu thức có gợi ý và kiểm khi gõ (dùng lại `expression-input`), danh sách lỗi, bảng **Thử logic** (chạy mô phỏng, đường thời gian đầu vào/đầu ra, đặt giá trị tay, tua nhanh ×1/×10/×100), chip trạng thái "Ghi PLC: tắt/bật" ở thiết bị Online; mockup `docs/architecture/mockups/studio-logic.html` MUST xong và được duyệt trước khi viết giao diện.
- **FR-095**: Hiệu năng: 200 luật + 100 timer + 100 counter + 50 totalizer + 50 giờ chạy + 50 lịch ở 500 Tag MUST thêm ≤ 3 điểm phần trăm CPU và ≤ 5 MB RSS trên BL335; một vòng quét ≤ 5 ms trên BL335 (đo, ghi số).
- **FR-096**: Studio MUST hiện trạng thái logic của thiết bị Online (từng luật OK/SUSPENDED/THROTTLED và lý do) và cảnh báo khi `logic.writes` của thiết bị là `off` trong khi project có ghi từ logic.

**US6: trình vẽ SVG**

- **FR-097**: Editor SVG MUST là một editor tab mới của Studio (cây project: mục "Đồ họa SVG"; lệnh "Sửa trong trình vẽ" ở menu ngữ cảnh của item `svg` hoặc nhấp đúp tệp SVG trên cây mở nó; nhấp đúp item `svg` trên canvas vẫn là "Vào đồ họa" của feature 008; "Mới: SVG trống" tạo file với `viewBox` chọn được), dùng mô hình tài liệu chuẩn tắc (`DrawDoc`) từ importer của GĐ 3b; MUST NOT sửa tài liệu bằng cách đặt `innerHTML`.
- **FR-098**: Mọi thay đổi tài liệu MUST đi qua **lệnh** đảo ngược được (đặt thuộc tính, đặt văn bản, chèn nút, xóa nút, chuyển nút); lịch sử hoàn tác ≥ 100 bước (hằng `SVG_UNDO_DEPTH` = 100), không chụp lại toàn bộ DOM; thao tác kéo liên tục và thao tác nhiều phần tử là một bước (gộp lệnh).
- **FR-099**: Công cụ tạo MUST có: Chọn, Hình chữ nhật (`rect`, bo góc `rx`, `ry`), Ellipse (`ellipse`, `circle` khi giữ Shift), Đường thẳng (`line`), Đa tuyến/Đa giác (`polyline`, `polygon`), Văn bản (`text` một dòng); phần tử tạo ra MUST nằm trong allowlist của sanitizer và nhận `data-mat-uid` mới.
- **FR-100**: Hình học MUST đúng với `transform` lồng nhau: tính ma trận tích lũy, đổi cỡ và xoay trong hệ tọa độ của tài liệu rồi quy về hệ của cha; với `rect`, `ellipse`, `circle`, `line`, `polyline`, `polygon`, độ lớn MUST ghi vào thuộc tính hình học khi chính xác (ma trận không nghiêng, xoay bội 90° hoặc đồng dạng), ngược lại ghi `transform`; với `g`, `path`, `text`, `use` ghi `transform`. Làm tròn tối đa 3 chữ số thập phân.
- **FR-101**: Có thể chọn một, nhiều (Shift, khung chọn, Ctrl+A), chọn sâu vào nhóm (nhấp đúp, Ctrl+nhấp); có tay nắm đổi cỡ 8 hướng, tay nắm xoay, nhập số trong inspector; phím mũi tên dịch 1 đơn vị (Shift: 10).
- **FR-102**: Nhóm và bỏ nhóm MUST đúng hình học: bỏ nhóm bake `transform` của nhóm vào con (khi chính xác) hoặc đẩy xuống làm `transform` của con, không đổi hiển thị; `data-mat-uid` của con MUST giữ nguyên, nhóm mới có uid mới; nhóm rỗng MUST tự bị xóa.
- **FR-103**: Bắt dính MUST có: lưới (mặc định 10), cạnh và tâm của phần tử khác (≤ 6 điểm ảnh màn hình), điểm đầu cuối của đường/đa tuyến, góc 15° khi vẽ đường và xoay (Shift); đường gióng hiện khi dính; Alt tắt tạm; bật tắt từng loại trong thanh công cụ.
- **FR-104**: Căn chỉnh (6 kiểu), phân bố đều ngang/dọc, cùng rộng, cùng cao, và xếp lớp (đưa lên/xuống trên cùng, lên/xuống một bậc) MUST đúng trong hệ tọa độ tài liệu cho cả phần tử khác nhóm; bộ ca hình học thuần có bảng kết quả mong đợi.
- **FR-105**: **Lớp**: lớp là `<g data-mat-layer="<tên>">` cấp một; có panel Lớp (tạo, đổi tên, sắp xếp, chuyển phần tử sang lớp, xóa lớp kèm hỏi); mắt (ẩn) và khóa là trạng thái soạn thảo lưu ở `<project>/.mat-editor/svg-state.json` (không vào gói, không vào digest), không đổi file SVG; lớp khóa không chọn được.
- **FR-106**: Inspector MUST có: Chung (id, tên hiển thị, lớp), Hình học (X, Y, Rộng, Cao, Góc, bo góc, bán kính), Hiển thị (tô, viền, độ dày, nét đứt, đầu mút, độ mờ, `visibility`), Văn bản (nội dung, phông trong danh sách an toàn, cỡ, in đậm, nghiêng, canh), và tab Gắn Tag của GĐ 3b; giá trị màu qua bộ chọn màu với mã hex; tô gradient có sẵn được giữ, chỉnh gradient ngoài phạm vi (D23).
- **FR-107**: Đường (`path`) chỉ gồm lệnh M, L, H, V, Z (tuyệt đối và tương đối) MUST sửa được nút (kéo, thêm, xóa, đóng/mở); `path` có C, S, Q, T, A MUST chỉ di chuyển, đổi cỡ, xoay, đổi màu và hiện lý do khóa sửa nút; đa tuyến, đa giác sửa điểm trực tiếp.
- **FR-108**: Văn bản MUST sửa tại chỗ (hộp nhập trên canvas), nhận chữ từ bộ gõ tiếng Việt (Telex TSF, Unikey) qua `textarea` giữ focus như ADR-016; chỉ `text` một dòng; `tspan` có sẵn sửa được nội dung nhưng không tạo mới.
- **FR-109**: Sao chép/cắt/dán trong tài liệu và giữa các tài liệu MUST cấp `data-mat-uid` mới và không sao chép binding (trừ tùy chọn "kèm binding"); dán từ clipboard hệ thống (SVG dạng chữ) MUST đi qua allowlist trên DOM đã parse (không regex), giới hạn 5 MB, 20.000 nút, độ sâu 32, và báo những gì đã loại.
- **FR-110**: Sửa phần tử MUST giữ `data-mat-uid` và binding; xóa phần tử có binding MUST cảnh báo và liệt kê binding; hoàn tác MUST khôi phục cả phần tử lẫn binding (lệnh xóa binding đi cùng lô lệnh).
- **FR-111**: Tuần tự hóa MUST chuẩn tắc: thứ tự thuộc tính ổn định, số theo quy tắc làm tròn của FR-100, không chèn thuộc tính lạ, giữ nguyên phần tử và thuộc tính không sửa (kể cả phần tử không cho sửa sâu: `mask`, `filter`, `pattern`, nested `svg`); mở rồi lưu không sửa hai lần liên tiếp cho cùng byte; mọi `data-mat-uid` giữ.
- **FR-112**: Tự lưu MUST ghi bản sao hoạt động mỗi 30 s khi có thay đổi vào `<project>/.mat-editor/autosave/` (ghi tạm rồi đổi tên); mở lại project sau tắt đột ngột MUST đề nghị khôi phục; lưu thật xóa bản tự lưu; bản tự lưu không vào gói.
- **FR-113**: Studio MUST phát hiện file SVG đổi trên đĩa trong khi đang mở (so mtime và băm) và hỏi "Nạp lại" hoặc "Giữ bản đang sửa"; không ghi đè im lặng.
- **FR-114**: Hiệu năng: tài liệu 2.000 phần tử, kéo một phần tử p95 ≤ 16,7 ms mỗi khung; mở tài liệu 20.000 nút ≤ 3 s; hoàn tác một bước ≤ 100 ms; chọn bằng khung trên 2.000 phần tử ≤ 50 ms.
- **FR-115**: Trợ năng: mọi lệnh editor SVG dùng được bằng bàn phím (Tab qua phần tử, mũi tên dịch, Enter vào nhóm, Delete, phím tắt), axe-core 0 lỗi critical/serious, tương phản ≥ 4,5:1 hai theme.
- **FR-116**: Mockup `docs/architecture/mockups/studio-svg-draw.html` MUST xong và được duyệt trước khi viết giao diện editor SVG; bố cục theo studio-ux.md §5 (Toolbox công cụ dọc bên trái, canvas có thước, Lớp và Thuộc tính bên phải).
- **FR-117**: Fixture MUST có ≥ 20 file SVG (Inkscape, Illustrator, CorelDRAW, ký hiệu tay, transform lồng nhau nhiều tầng, đơn vị khác px, `style` nội tuyến, gradient, `use`/`symbol`) trong `tests/svg-editor-fixtures/` kèm kết quả mong đợi (canonical, số nút, uid).
- **FR-118**: Giới hạn có chủ đích (D23) MUST được nêu trong giao diện và tài liệu: không có bút vẽ Bézier tự do, phép toán boolean, bộ lọc, mặt nạ, văn bản trên đường, nhiều dòng.

**US7: faceplate và template**

- **FR-119**: Template MUST nằm ở `templates/<id>.template.json` (schema `schemas/template.schema.json`): `id`, `name`, `params[]` (`name`, `kind`: `tagPrefix`, `string`, `number`, `color`; `default`), `items[]` (cùng lược đồ item của 007, id tương đối, Tag viết bằng `{param}` hoặc `{prefix}.SUFFIX`), kích thước.
- **FR-120**: Bản sao (instance) MUST được **bung khi lưu**: màn hình lưu các item thường với id `<instanceId>.<itemId>`, Tag đã thay giá trị tham số, và chú thích tùy chọn `tpl: {inst, tid, rid}` (schema cho phép, runtime và widget bỏ qua); runtime MUST NOT đổi để hỗ trợ template.
- **FR-121**: "Cập nhật mọi bản sao" MUST bung lại từ template hiện tại giữ riêng cho từng bản: vị trí, cỡ, giá trị tham số và id; xóa item thêm tay trong bản sao là không phép (item mang `tpl` bị ghi đè); là một bước hoàn tác.
- **FR-122**: Tham số kiểu `tagPrefix` MUST khớp `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$` (≤ 64 byte); kiểu `string` ≤ 128 byte, thay vào nhãn; kiểu `number`, `color` kiểm giá trị; mọi giá trị MUST đi qua kiểm tra như thuộc tính thường; Tag đã thay MUST tồn tại và đúng kiểu khe (`E_TEMPLATE_TAG_REF`).
- **FR-123**: Faceplate MUST là màn hình `kind: "popup"` có `params[]` (cùng kiểu và luật FR-122); khe Tag và nhãn của nó dùng `{param}`; hành động `popup` MUST có `args` (đối tượng tên → chuỗi) khớp đúng bộ tham số; `E_POPUP_ARGS` khi thiếu, thừa, sai kiểu.
- **FR-124**: Cả hai validator MUST bung mọi chỗ gọi popup có tham số (tổ hợp `args` tĩnh) và kiểm từng Tag (tồn tại, kiểu, RW cho khe ghi, giới hạn); số tổ hợp tối đa 1.000 mỗi popup; vector chung ≥ 30 ca.
- **FR-125**: Runtime (`@mat/ui-components`, trang) MUST thay `{param}` bằng `args` khi mở popup (phép thay chuỗi thuần, không biểu thức), đăng ký Tag đã thay, và hủy khi đóng; mở popup khác thay popup hiện tại; không thể dùng tham số để tạo Tag ngoài tập đã được validator bung (kiểm lúc chạy: Tag không có trong danh sách của dự án thì widget hiện lỗi, không đăng ký).
- **FR-126**: Studio MUST có: tạo template từ vùng chọn ("Tạo template…" chọn tham số), thư viện template của project (cây), thêm bản sao bằng kéo thả hoặc hộp thoại tham số, danh sách bản sao và "Cập nhật mọi bản sao", "Bung thành item thường" (xóa chú thích `tpl`), tạo faceplate từ màn hình popup và hộp thoại `args` ở action Mở popup.
- **FR-127**: Mockup nằm trong `studio-svg-draw.html` (cảnh "Template") và `studio-screens.html` bổ sung ghi chú; được duyệt cùng mockup SVG.

**US8: tài liệu, huấn luyện**

- **FR-128**: Tài liệu người dùng bằng tiếng Việt MUST có: `docs/user/engineer-guide.md` (tạo project, Tag và kết nối, màn hình và widget, trình vẽ SVG, template và faceplate, logic, nạp xuống, đọc lên, chẩn đoán, xử lý lỗi), `docs/user/operator-guide.md` (≤ 6 trang: đăng nhập, xem, điều khiển, trạng thái BAD/STALE/UNCERTAIN, alarm theo GĐ 4, việc cần làm khi lỗi, ai gọi), `docs/user/admin-guide.md` (cài đặt, chứng chỉ, tài khoản, backup và khôi phục, cập nhật OTA và thủ công, gia cố, chẩn đoán, KPI, sự cố thường gặp, ma trận phiên bản), `docs/user/error-codes.md`, `docs/user/glossary.md`.
- **FR-129**: Mỗi hướng dẫn MUST có bảng tác vụ kiểm tra được (mục tiêu, các bước, kết quả mong đợi); Hướng dẫn kỹ sư ≥ 12 tác vụ, vận hành ≥ 6, quản trị ≥ 10.
- **FR-130**: `tools/docs-check.mjs` MUST kiểm: liên kết nội bộ, tham chiếu tệp, lệnh CLI nêu trong khối mã so với `--help` của `mat-runtime` và các script, mã lỗi trong tài liệu so với danh mục mã, tiêu đề lặp; chạy trong `ci-local.ps1`.
- **FR-131**: Giáo trình huấn luyện MUST ở `docs/training/` cho ba nhóm: vận hành (2 giờ), kỹ sư (1 ngày), quản trị (nửa ngày), mỗi nhóm có mục tiêu, lịch, bài thực hành với dữ liệu mẫu (`projects/training-demo`), bài kiểm thực hành và tiêu chí đạt, phiếu đánh giá, tệp hướng dẫn người dạy.
- **FR-132**: Hồ sơ pilot MUST ở `docs/pilot/`: `plan.md` (phạm vi, site, vai trò, lịch, rủi ro), `criteria.md` (vào/ra đo được), `incident-log.md` (mẫu, mức S1 đến S4, hạn phản hồi và xử lý), `weekly-report.md` (mẫu), `acceptance-minutes.md` (biên bản), `customer-checklist.md` (việc cần khách hàng: site, mạng, PLC, người, thời gian), `data-handling.md` (dữ liệu thu thập chỉ kỹ thuật, không dữ liệu cá nhân, lưu ở đâu, bao lâu).
- **FR-133**: Studio MUST có nút "Trợ giúp" mở đúng mục tài liệu (liên kết tương đối trong gói cài hoặc mở trình duyệt tới `docs/` đã nhúng); tài liệu đi kèm bộ cài (thư mục `docs/` dạng HTML tĩnh, sinh bằng script không phụ thuộc mới) và kiểm không có liên kết ra ngoài.
- **FR-134**: Kế hoạch cho mảng sau pilot MUST nằm ở `docs/plans/post-1.0-backlog.md`: thông báo alarm ngoài (email, Telegram/Zalo), recipe, API dữ liệu ra (REST, MQTT), giao diện mobile, image Buildroot, các đợt driver; mỗi mảng có mục tiêu, phụ thuộc, hướng thiết kế, rủi ro, ước lượng, điều kiện bắt đầu; không có mã.
- **FR-135**: Báo cáo nghiệm thu `docs/reports/011-acceptance.md` MUST theo mẫu của 005 đến 007 (bảng SC, kết quả, hạn chế còn lại, việc chờ người), và `docs/reports/011-fr-matrix.md` ánh xạ FR → task → bằng chứng.

**US9: pilot**

- **FR-136**: Kế hoạch pilot MUST có ít nhất một site thật của khách hàng (mục tiêu hai) và một bàn thử nội bộ chạy song song, thời gian ≥ 30 ngày liên tục (đồng hồ pilot; D29), bản phần mềm `1.0.0-rc.N` cố định trong kỳ trừ bản vá được phép theo quy tắc ở `criteria.md`.
- **FR-137**: Công cụ thu dữ liệu `tools/pilot/collect.ps1` MUST lấy `system/diagnostics`, `system/info` và `audit` tóm tắt mỗi 15 phút (từ máy trong cùng VPN hoặc LAN) và lưu JSON dòng ở `docs/pilot/data/<site>/<ngày>.jsonl` (không có dữ liệu quy trình của khách), có thể chạy bằng tay khi không có đường mạng thường xuyên.
- **FR-138**: `tools/pilot/kpi.mjs` MUST tính KPI từ dữ liệu thu: uptime tiến trình, số lần khởi động lại và nguyên nhân, RSS và CPU (trung bình, p95, lớn nhất), ghi đĩa mỗi ngày theo thành phần, `liveLagP95Ms`, chỉ số tuổi thọ eMMC đầu/cuối, số sự cố theo mức; kiểm bằng bộ dữ liệu mẫu `tests/pilot-kpi/` (≥ 6 kịch bản kể cả thiếu dữ liệu, khởi động lại giữa kỳ, đồng hồ nhảy).
- **FR-139**: Tiêu chí ra MUST đo được và có ngưỡng (contract §5): (1) uptime tiến trình ≥ 99,9 % (≤ 43 phút ngừng ngoài kế hoạch mỗi 30 ngày; không tính thiết bị mất nguồn do site, tính cả lỗi runtime), (2) 0 sự cố S1, ≤ 2 sự cố S2 mở và đều có cách tránh, 0 S1/S2 chưa phân tích nguyên nhân, (3) `liveLagP95Ms` ≤ 500 ms và đo đầu-cuối Chrome ≤ chu kỳ quét + 500 ms ở ≥ 3 lần đo, (4) ghi eMMC ≤ 2 GB mỗi ngày (mọi ngày) và tuổi thọ ước tính ≥ 5 năm, chỉ số `EXT_CSD` tăng ≤ 1 bậc trong kỳ, (5) 0 hỏng cơ sở dữ liệu sau mọi lần mất điện của site và của lab, (6) 0 Critical/High và 0 Medium mở, (7) nghiệm thu của khách hàng, (8) huấn luyện: ≥ 2 người vận hành và ≥ 1 kỹ sư của khách đạt bài kiểm, (9) chức năng: 100 % tác vụ đại diện (≥ 10, do khách hàng chọn) làm được, (10) ngân sách: RSS ≤ 150 MB, CPU trung bình ≤ 30 % theo tuần, tmpfs ≤ 64 MB. Mười tiêu chí này tương ứng X1 đến X11 của contract (X8 chức năng, X9 huấn luyện, X10 nghiệm thu, X11 ngân sách; X7 gộp bảo mật và audit).
- **FR-140**: Tiêu chí vào pilot MUST gồm: US1, US2 (x64 xong, BL335 có ít nhất soak 7 ngày và 100 lần cắt điện hoặc có báo cáo giới hạn được Tech Lead chấp thuận), US3 (cài thử bằng chứng chỉ thật hoặc có quyết định ghi rõ chạy pilot với bản chưa ký), US4 (OTA đạt kiểm lab) hoặc quyết định dùng quy trình thủ công, US8 (tài liệu, huấn luyện) xong; hồi quy xanh; bản rc ký và có SBOM.
- **FR-141**: Quy trình sự cố MUST gồm: ghi vào `incident-log.md` trong 1 ngày làm việc, phân mức, phản hồi (S1 4 giờ, S2 1 ngày làm việc, S3 5 ngày, S4 tùy), phân tích nguyên nhân (bắt buộc cho S1, S2), bản vá qua hồi quy trước khi triển khai (OTA hoặc thủ công), và quy tắc đồng hồ pilot (S1 dừng và tính lại; S2 ghi chú).
- **FR-142**: Quyết định Go/No-Go cuối MUST dựa trên bảng tiêu chí, có chữ ký của Tech Lead ghi vào `docs/reports/011-go-no-go.md`, kèm đối chiếu Definition of Done của Master Plan §14.6 từng dòng; Go thì gắn `1.0.0` (Studio, runtime, định dạng, gói), ký, phát hành, cập nhật roadmap §4.7, Constitution (nếu có điều chỉnh) và ADR 035 đến 038 chuyển Accepted.
- **FR-143**: Mọi mục chờ người hoặc khách hàng (⚠️🔌) MUST được liệt kê một chỗ (`docs/pilot/customer-checklist.md` và mục "Việc chờ" của báo cáo nghiệm thu) kèm ai, làm gì, cần gì, chặn task nào.

### Key Entities

- **Phát hiện bảo mật**: nguồn, mức, mô tả, xử lý, test hoặc bằng chứng, trạng thái.
- **Danh sách tên cho phép (`allowedHosts`)**: tên miền do quản trị đặt; IP literal luôn được nhận.
- **Khóa đăng nhập**: khóa theo cặp (tên, IP) và theo IP; bộ đếm, thời điểm hết hạn (monotonic).
- **Nhật ký xung**: mục (mã yêu cầu, Tag, giá trị nhả, hạn nhả), nằm trong `pulse.journal`.
- **Mẫu đo (sample)**: dòng JSON 60 s của `mat-sample`.
- **Kết quả vòng mất điện**: số thứ tự, điểm cắt, thời gian lên lại, kết quả `--check-data`, kết quả đối chiếu audit.
- **Bộ phát hành (release)**: phiên bản, bộ cài đã ký, gói runtime, gói cập nhật, `SHA256SUMS` và chữ ký, SBOM, license, ghi chú.
- **Chứng chỉ ký**: loại (thử, OV, EV, đám mây), dấu vân tay, hạn, nơi lưu; **Khóa phát hành**: ECDSA P-256 (chính, dự phòng), khóa công khai nằm trên thiết bị.
- **Gói cập nhật** (`.matupdate`): manifest, chữ ký, payload; **Thao tác cập nhật**: id, bước, trạng thái, kết quả.
- **Luật, Timer, Counter, Totalizer, Giờ chạy, Lịch, Ghi cho phép (`writes`)**: các khối của `logic.json`; **Tag logic**: đầu ra của khối.
- **Tài liệu SVG (`DrawDoc`)**, **Lệnh SVG**, **Lớp**, **Trạng thái soạn thảo**, **Bản tự lưu**.
- **Template** (tham số, item), **Bản sao template**, **Faceplate** (popup có tham số), **Đối số (`args`)**.
- **Bộ KPI pilot**, **Sự cố** (mức, thời điểm, nguyên nhân, xử lý), **Biên bản nghiệm thu**.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Bảo mật và xử lý phát hiện tồn (US1)**

- **SC-001**: Bảng truy vết (plan, "Phát hiện tồn") có 100 % mục Medium của 005, 006, 007 ở trạng thái "đã sửa kèm test" hoặc "đã đóng kèm bằng chứng" hoặc "chờ người" (ghi rõ); 0 mục "ghi nhận".
- **SC-002**: Bộ ca `Host` (≥ 16 ca: tên lạ, IP, IPv6, cổng, hoa thường, dấu chấm cuối, thiếu Host, hai Host, rebinding giả lập qua DNS thử, WebSocket, HTTPS) cho đúng kết luận 100 %; 0 hồi quy của 007 (SC-005 đến SC-009 của 007 vẫn đạt).
- **SC-003**: Bộ ca khóa đăng nhập (≥ 14 ca: khóa theo cặp, khóa IP, xóa bộ đếm, đồng thời, `Retry-After`, phân tán, CLI mở khóa, mật khẩu ngắn): 100 % đúng; người dùng hợp lệ ở IP khác đăng nhập ≤ 2 s trong khi một IP khác đang bị khóa; tấn công 1.000 lần sai từ một IP bị chặn sau ≤ 20 lần.
- **SC-004**: Xung kill -9 (x64): 20/20 vòng, bit lệnh về giá trị nhả ≤ 10 s sau khi kênh nối lại, audit `pulse-recovery` có đủ trường; 20/20 vòng nhật ký không ghi được thì lệnh bị từ chối và 0 bit được bật. Trên BL335: cắt điện giữa xung 10 lần (⚠️🔌) bit về nhả sau khi lên lại.
- **SC-005**: Gateway nhiều unit: 1.000 chu kỳ với một unit câm: Tag của unit khỏe GOOD ở 100 % chu kỳ; 0 lần đóng kết nối do timeout đơn lẻ; phản hồi muộn bị bỏ đúng ở 100 % ca (10.000 ca ngẫu nhiên).
- **SC-006**: File thừa: ≥ 10 vector mới, TS và C++ cùng kết luận 100 %; 0 tình huống `HEALTH_TIMEOUT` do lệch digest trong 30 lần nạp xuống thử.
- **SC-007**: `persist()` ngoài mutex: với fsync giả 500 ms, `GET projects/active` p99 ≤ 50 ms; lỗi ghi giả (ENOSPC) làm thao tác thất bại `PERSIST_FAILED` ở 100 % ca và không kích hoạt.
- **SC-008**: Giới hạn kết nối: 40 kết nối TLS im lặng từ một IP không làm đăng nhập từ IP khác chậm quá 2 s; một IP không giữ quá `maxConnPerSource` kết nối; RAM tăng ≤ 1 MB (đo BL335 ⚠️🔌).
- **SC-009**: Công cụ: `cargo audit` và `npm audit` 0 Critical/High không có chấp nhận ghi lý do; rà license: 100 % thành phần có license đã biết, 0 GPL/LGPL link tĩnh; `cppcheck` và `clang-tidy` 0 phát hiện chưa phân loại mức error/warning bảo mật; fuzz ≥ 1 giờ mỗi mục tiêu (7 mục tiêu) 0 sự cố.
- **SC-010**: Báo cáo `011-security-review.md`: 0 Critical, 0 High mở; Medium mở chỉ là mục chờ người; hồi quy bộ 30 ca tấn công web của 007 vẫn 100 %.

**Độ bền và tải (US2)**

- **SC-011**: BL335, 500 Tag × 10 client × 4 giờ: CPU trung bình ≤ 30 %, đỉnh ≤ 60 %, RSS ≤ 150 MB, 0 mất sequence; client 11 nhận 4429 ở 100 % lần thử; 50 vòng 10 client F5 màn hình 250 item: mọi vòng ≤ 5 s.
- **SC-012**: BL335, 1.000 Tag × 10 client × 1 giờ: CPU trung bình báo cáo, mục tiêu ≤ 50 %, RSS ≤ 150 MB; không đạt thì có báo cáo giới hạn kèm phương án.
- **SC-013**: Soak 7 ngày BL335: 0 khởi động lại ngoài kế hoạch; độ dốc RSS ≤ 0,5 MB/ngày (hồi quy sau 24 giờ đầu), RSS lớn nhất ≤ 150 MB; FD, luồng không tăng quá 5 %; ghi eMMC mỗi ngày ≤ 2 GB; tmpfs ≤ 64 MB; 0 lỗi `mmc`/`ext4` trong `dmesg`.
- **SC-014**: Mất điện BL335: 100/100 vòng ngẫu nhiên phục vụ lại ≤ 90 s, `--check-data` đạt 100 %, 0 lệnh `ACCEPTED` thiếu audit; ≥ 10 vòng mỗi điểm nhạy cảm (5 điểm) luôn bản cũ hoặc bản mới hoàn chỉnh, 0 DB hỏng.
- **SC-015**: Cắt mạng 50 lần với 10 client: 100 % nối lại ≤ 35 s, 0 slot rò.
- **SC-016**: Tuổi thọ eMMC: báo cáo có tốc độ ghi/ngày theo thành phần và ước tính tuổi thọ ≥ 5 năm theo công thức của contract, hoặc ghi "chưa tính được" kèm thứ còn thiếu (datasheet); ngày ghi lớn nhất ≤ 2 GB.

**Phát hành (US3, US4)**

- **SC-017**: Ký thử: 100 % ba tệp (exe, setup, uninstall) có chữ ký SHA-256 đúng, kiểm `NotTrusted` đúng kỳ vọng với chứng chỉ thử; 12/12 ca hỏng bị từ chối; 100 % ca cổng `-Release` (chứng chỉ thử, tự ký, hết hạn, sai EKU, thiếu dấu thời gian) bị từ chối.
- **SC-018**: `release.ps1` một lệnh sinh đủ 9 mục của FR-052 trong ≤ 30 phút (không tính `ci-local`); kiểm lại chữ ký và băm 100 %; SBOM có 100 % gói của `package-lock.json` và `Cargo.lock`.
- **SC-019**: Chứng chỉ thật trên Windows 10 và 11 sạch (⚠️🔌): nhà phát hành hiện đúng; kết quả SmartScreen ghi nguyên văn; không có chứng chỉ thật thì mục này ghi "chưa đo", không phải "đạt".
- **SC-020**: OTA: 20/20 cập nhật hợp lệ thành công trong lab (x64), mỗi lần dịch vụ ngừng ≤ 30 s, toàn bộ ≤ 120 s; 100 % của ≥ 25 gói xấu bị từ chối đúng mã, bản chạy và dữ liệu không đổi.
- **SC-021**: OTA bền: 40 lần kill -9 hoặc cắt giữa 8 bước (5 lần mỗi bước): luôn bản cũ hoặc bản mới hoàn chỉnh; lỗi sức khỏe giả: 100 % tự quay về ≤ 90 s; 0 trạng thái kẹt ở lần khởi động tiếp theo.
- **SC-022**: OTA bảo mật: 100 % ca sai quyền, sai kênh (HTTP, cookie web), sai khóa, hạ cấp, thiếu mật khẩu xác nhận bị từ chối và có audit; OTA tắt: 100 % endpoint 404; không có tệp nào được ghi ngoài `update/` trước khi gói qua kiểm.
- **SC-023**: Trên BL335 (⚠️🔌) ít nhất 10 cập nhật OTA thật (armhf), 5 lần cắt điện giữa bước; kết quả như SC-020, SC-021.

**Logic (US5)**

- **SC-024**: Vector chung `tests/logic-vectors/` ≥ 200 ca: TS và C++ cùng kết luận ở 100 % ca; mỗi mã `E_LOGIC_*` có ít nhất một ca đúng và một ca sai.
- **SC-025**: Độ chính xác: timer sai ≤ 1 chu kỳ quét + 20 ms; totalizer dòng hằng 1 giờ sai ≤ 0,1 %; counter 10.000 cạnh sai 0; giờ chạy sai ≤ 0,01 giờ trên 24 giờ mô phỏng; lịch đúng 100 % (≥ 40 ca: nửa đêm, ngoại lệ, chưa đồng bộ giờ, đổi `tzOffsetMin`).
- **SC-026**: Bền: 100 vòng `kill -9`: giá trị counter, totalizer, giờ chạy mất ≤ một chu kỳ ghi (`flushS`), không bao giờ giảm, không quay vòng; 0 lần ghi PLC hai lần cho cùng một cạnh; retain hỏng giả: 100 % về 0 kèm cảnh báo và audit.
- **SC-027**: Ghi từ logic: 100 % lệnh có audit đủ trường (luật, Tag, cũ/mới, điều kiện) trước khi gửi (kiểm bằng nhật ký giả lập Modbus); `logic.writes: off`: 0 lệnh tới thiết bị; vượt giới hạn tần suất: 100 % bị chặn; ghi Tag không khai báo: 100 % bị validator từ chối ở cả hai bản.
- **SC-028**: Tải logic trên BL335 (⚠️🔌): thêm ≤ 3 điểm phần trăm CPU, ≤ 5 MB RSS, vòng quét ≤ 5 ms ở cấu hình tối đa; x64 đo trước.
- **SC-029**: Một kỹ sư dựng được luật "bơm tự bật" (điều kiện, giữ, ghi có khai báo), một counter, một totalizer, một lịch trong Studio, chạy Mô phỏng, Nạp xuống trong ≤ 25 phút không cần tài liệu (người thử; không có người thì "tự đo").

**Trình vẽ SVG (US6) và template (US7)**

- **SC-030**: Round-trip ≥ 20 fixture: 100 % mở, lưu không sửa hai lần cho cùng byte, uid giữ 100 %, ảnh dựng lại sai khác ≤ 1 % điểm ảnh so với gốc.
- **SC-031**: Bộ ca hình học thuần (≥ 150 ca: transform lồng 3 tầng, xoay/nghiêng/co, bake và không bake, nhóm/bỏ nhóm, bắt dính 4 loại, căn chỉnh, phân bố, đổi cỡ giữ tỉ lệ, sửa nút đa giác) đúng 100 %, sai số ≤ 0,001 đơn vị.
- **SC-032**: Hoàn tác: kiểm thuộc tính trên 1.000 chuỗi lệnh ngẫu nhiên có hạt cố định: hoàn tác hết cho đúng trạng thái đầu và làm lại hết cho đúng trạng thái cuối, 100 %; độ sâu 100 bước kiểm riêng; hoàn tác một bước ≤ 100 ms.
- **SC-033**: Hiệu năng (máy dev): 2.000 phần tử kéo p95 ≤ 16,7 ms mỗi khung; mở 20.000 nút ≤ 3 s; chọn khung ≤ 50 ms.
- **SC-034**: An toàn: fuzz lệnh editor 100.000 chuỗi và 10 ca dán SVG độc: 100 % kết quả nằm trong allowlist; 0 `innerHTML`/`eval` (lint); 0 mất binding ngoài ý muốn trong ca sửa.
- **SC-035**: Tự lưu: kill Studio 20 lần giữa lúc sửa: ≥ 95 % lần khôi phục đủ trong 30 s gần nhất, 0 lần hỏng file chính; thử tay bộ gõ và trợ năng ⚠️🔌.
- **SC-036**: Một kỹ sư dựng ký hiệu "bơm" từ đầu (rect, ellipse, line, text, group) và gắn Tag trong ≤ 20 phút (người thử; không có thì "tự đo").
- **SC-037**: Template và faceplate: một template 20 bản sao: sửa một lần, "Cập nhật mọi bản sao" đúng 20/20; một faceplate dùng cho 20 bơm: validator bung 20 tổ hợp, runtime hiện đúng giá trị của Tag thay thế; vector chung ≥ 30 ca TS = C++ 100 %; 0 thay đổi trong mã phục vụ file của runtime cho template (kiểm bằng diff).

**Tài liệu và pilot (US8, US9)**

- **SC-038**: `docs-check` 0 lỗi; bảng tác vụ: người chưa biết hệ thống làm được ≥ 90 % tác vụ không cần hỏi (⚠️🔌 cần người; không có người thì ghi "tự đo, chưa có người thử").
- **SC-039**: Huấn luyện: ≥ 2 người vận hành và ≥ 1 kỹ sư của khách đạt bài kiểm thực hành (⚠️🔌 khách hàng); số liệu và nhận xét lưu ở `docs/pilot/`.
- **SC-040**: Pilot ≥ 30 ngày: uptime tiến trình ≥ 99,9 %; 0 sự cố S1; ≤ 2 S2 mở và đều có cách tránh; `liveLagP95Ms` ≤ 500 ms; ghi eMMC ≤ 2 GB mỗi ngày; tuổi thọ ước tính ≥ 5 năm (⚠️🔌: cần site, thiết bị và thời gian; chưa chạy thì "chưa đo").
- **SC-041**: Biên bản nghiệm thu của khách hàng đã ký (⚠️🔌 khách hàng); `kpi.mjs` khớp bộ dữ liệu mẫu 100 %.
- **SC-042**: Hồi quy: `ci-local.ps1` xanh gồm các bước mới (ASan ctest, audit, SAST, docs-check); mọi kiểm tra của 003 đến 010 vẫn đạt; đường xem 0.6 từ mạng riêng và quy trình nạp xuống 005 không đổi hành vi (so cặp trước/sau).
- **SC-043**: Quyết định Go/No-Go có đủ bằng chứng cho từng dòng Definition of Done (Master Plan §14.6) và từng SC của spec này: mỗi SC ghi Đạt, Không đạt hoặc Chưa đo; gắn `1.0.0` chỉ khi mọi tiêu chí bắt buộc Đạt.

## Assumptions

### Quyết định đã chốt trước khi viết spec

- **D1. GĐ 6 là một feature** (`011-pilot-hardening`) gồm 9 user story giao được riêng. Lý do: cùng một mốc phát hành 1.0.0 và cùng bộ tiêu chí pilot; các story chạm tới ít file chung (đo, bảo mật, phát hành tách khỏi Studio). Giảm rủi ro: mỗi story có mốc commit, báo cáo và nghiệm thu riêng, tách thành feature riêng được nếu trễ; thứ tự giao theo ưu tiên P1 → P3.
- **D2.** Studio, runtime, định dạng project, gói cập nhật cùng **1.0.0** (Quyết định, người dùng giao toàn quyền 2026-10-11). Lý do: (a) 1.0.0 là lời hứa tương thích SemVer đầu tiên: định dạng project, API thiết bị và gói không phá vỡ trong dòng 1.x, điều khách hàng pilot cần; (b) mốc phát hành thương mại đầu tiên theo Master Plan §15 chỉ sau pilot, nên số 1.0.0 chỉ được gắn khi Go/No-Go đạt, bản trong lúc làm là `1.0.0-rc.N`; (c) hai thành phần cùng số để ma trận hỗ trợ đơn giản (cùng MAJOR thì tương thích); (d) giao thức live giữ nguyên số riêng (đã có đường tương thích 1.x).
- **D3.** Constitution 2.0.1; roadmap v2 đã duyệt 2026-10-11; mọi quyết định mới dưới đây là "Quyết định (người dùng giao toàn quyền 2026-10-11)".
- **D4.** Thiết bị đích BL335; thông tin truy cập ở memory, không vào repo; SSH tới BL335 không có trong phiên viết spec: các bước đo và thử trên thiết bị là task ⚠️🔌 (như 006 D7, 007 D40).

### Quyết định khi viết spec

Mỗi điểm là **Quyết định (người dùng giao toàn quyền 2026-10-11)**.

- **D5. OTA: làm, mặc định tắt; quy trình thủ công vẫn được hỗ trợ.** Phương án chọn: gói `.matupdate` có chữ ký ECDSA P-256, nhận qua HTTPS bởi role administrator, thay thế bởi `mat-updater` nhỏ chạy bằng root, tự quay về khi lỗi. Lý do: (a) pilot có site ở xa: không có OTA thì mỗi bản vá cần SSH root (một phát hiện Medium tồn tại là SSH root bằng mật khẩu) hoặc người tới tận nơi; có OTA thì tắt được SSH mật khẩu; (b) hạ tầng đã có (nạp xuống atomic, bố cục `.prev`, health check, phiên administrator); (c) chữ ký làm gói tin cậy được dù kênh bị chiếm. Rủi ro: thành phần root mới. Giảm: mặc định tắt, bề mặt tối thiểu (xác thực ở runtime không đặc quyền, kiểm lại ở root trên bản sao), ≥ 25 gói xấu, kill/cắt điện 40 lần, kiểm bằng fuzz. Phương án loại: **chỉ thủ công** (không giải quyết site xa, giữ rủi ro SSH root); **runtime tự thay chính mình** (phải cấp quyền ghi `/opt` cho `matscada`, phá `ProtectSystem=strict` và `ReadOnlyPaths`); **A/B phân vùng** (cần image Buildroot, ngoài phạm vi; ghi vào kế hoạch sau pilot). ADR-035.
- **D6. Chữ ký gói cập nhật dùng ECDSA P-256 + SHA-256**, không dùng Ed25519. Lý do: Mbed TLS 3.6.7 (đã có) kiểm P-256 sẵn; thêm thư viện cho Ed25519 là thêm phụ thuộc và rà license; `openssl` và Node ký P-256 được trên máy dev.
- **D7. Authenticode bằng `signtool` (Windows SDK 26100, đã có trên máy dev)** với ba chế độ ký (kho/token, lệnh ngoài, thử). Lý do: CA/Browser Forum yêu cầu khóa chứng chỉ ký mã nằm trên phần cứng từ 2023 nên không có tệp PFX phát hành để lưu trong CI; dịch vụ ký đám mây dùng lệnh ngoài. Máy dev không có chứng chỉ thật nên quy trình và cổng kiểm làm trước, kiểm bằng chứng chỉ thử; mua chứng chỉ là việc của công ty (⚠️🔌).
- **D8. Allowlist `Host`: IP literal luôn nhận, tên miền phải khai.** Lý do: DNS rebinding dùng tên miền của kẻ tấn công; IP literal không rebinding được; nên port-forward và NAT (khách dùng IP công cộng) không vỡ, khách dùng tên miền khai một lần. Phương án loại: danh sách IP cố định (vỡ NAT); tự học tên (kẻ tấn công học được).
- **D9. Khóa đăng nhập theo cặp (tên, IP) cộng khóa IP, bỏ khóa theo tên thuần túy**; giới hạn kiểm Argon2 đồng thời; phát hiện tấn công phân tán chỉ ghi audit. Lý do: khóa theo tên cho phép bất kỳ ai khóa tài khoản kỹ sư (DoS, S-M1); phân tán nhiều IP vào một tên bị chặn bởi chi phí Argon2 (~0,3 s/lần trên BL335 một luồng, tối đa 2 đồng thời) và mật khẩu ≥ 10 ký tự. Phương án loại: CAPTCHA (không có), khóa vĩnh viễn (DoS).
- **D10. Nhật ký xung rồi nhả khi khởi động.** Lý do: bit lệnh bật dài là nguy hiểm hơn một lần nhả sớm; giá trị nhả là trạng thái nghỉ do chính người thiết kế xung khai báo. Giới hạn nói thẳng: tắt điện lâu thì bit vẫn bật suốt thời gian đó, PLC phải có bộ hẹn giờ tự nhả (tài liệu).
- **D11. Gateway Modbus TCP: giữ kết nối khi timeout đơn lẻ, bỏ phản hồi muộn theo `transactionId`.** Lý do: MBAP có transaction id nên phân biệt được; RTU qua TCP không phân biệt nên giữ cách cũ.
- **D12. `persist()` ngoài mutex; file thừa bị từ chối** (đổi hành vi so với 005, chấp nhận vì Studio chuẩn không sinh file thừa; gói cũ thừa file được Studio nâng cấp sạch).
- **D13. Soak 7 ngày là điều kiện vào pilot (Master Plan §6.4: 7 ngày cho MVP), 30 ngày chạy ở bàn thử trong pilot.** Lý do: 30 ngày chặn lịch quá lâu; pilot 30 ngày đã là soak thật.
- **D14. Cắt điện 100 lần cần bộ điều khiển nguồn** (ổ cắm HTTP hoặc rơ-le USB do người cung cấp) để chạy tự động và lặp lại được; chế độ tay là dự phòng. Tiền kiểm x64 bằng `kill -9` 100 vòng nêu rõ không thay thế.
- **D15. SAST bằng `cppcheck` và `clang-tidy` trong container toolchain**; không dùng Semgrep hay CodeQL (cần mạng hoặc tài khoản, và thêm công cụ cần rà). `cargo audit`, `npm audit` cần mạng: task đánh dấu 🌐; không có mạng thì báo "chưa chạy".
- **D16. SBOM tự sinh CycloneDX 1.5** bằng script không phụ thuộc mới. Lý do: tránh thêm gói chỉ để sinh SBOM; dữ liệu có sẵn ở `package-lock.json`, `Cargo.lock`, `LICENSES.md`.
- **D17. Logic là dữ liệu khai báo** `logic.json`, hai bản engine (TS cho mô phỏng, C++ cho runtime) dùng chung bộ vector (Constitution II). Không ngôn ngữ ladder hay script. Lý do: Constitution V; kiểm được bằng validator; ba nhóm người dùng (vận hành, kỹ sư PLC) hiểu bảng khối.
- **D18. Ghi PLC từ logic: khai báo `writes`, giới hạn tần suất, audit bền, mặc định tắt ở `runtime.json`, công tắc dừng cho administrator.** Lý do: máy tự ghi xuống PLC là bề mặt rủi ro lớn nhất của GĐ này; bật phải là quyết định cố ý của người có quyền root trên thiết bị; dừng khẩn cấp phải nhanh và không cần root. Interlock an toàn vẫn ở PLC. Tác nhân ghi là `logic:<id>`, được ủy quyền bởi người nạp xuống (role engineer) và danh sách `writes`; cần PATCH Constitution (D22).
- **D19. Luật: BAD → `SUSPENDED`, `fireOnStart: false`, `hold` thay timer rời.** Lý do: tránh ghi do dữ liệu xấu và do khởi động lại; bắn lại sau mất điện sẽ ghi lặp xuống PLC.
- **D20. Lịch dùng múi giờ cố định (`tzOffsetMin`, mặc định UTC+7), không DST/tzdata.** Lý do: thị trường Việt Nam không có DST; BL335 không đảm bảo có tzdata; giờ chưa đồng bộ thì BAD thay vì đoán.
- **D21. Counter, totalizer, giờ chạy giữ bằng `RetainStore`, ghi mỗi 60 s** (đặt được). Lý do: nằm trong ngân sách eMMC, mất tối đa 60 s là chấp nhận được và ghi rõ; ngăn mòn eMMC.
- **D22. Trước khi viết mã ghi từ logic và OTA, chạy `/speckit-constitution` đề xuất PATCH 2.0.2**: (a) làm rõ nguyên tắc V: lệnh ghi do luật logic đã triển khai khởi tạo được ủy quyền bởi người nạp xuống và danh sách `writes`, và lệnh nhả xung dở khi khởi động là phần của lệnh xung đã được ủy quyền và audit từ đầu, vẫn qua chuỗi kiểm và audit; (b) thêm "cập nhật runtime qua mạng" vào danh sách chức năng chỉ bật khi có HTTPS, đăng nhập, role, audit. Không đổi nguyên tắc nào. Constitution Check của plan ghi "đạt có điều kiện" tới khi PATCH được duyệt (task T004).
- **D23. Phạm vi trình vẽ SVG:** chọn, hình chữ nhật, ellipse, đường thẳng, đa tuyến/đa giác, văn bản một dòng, nhóm, lớp, căn chỉnh, bắt dính, hoàn tác 100, sửa nút `path` chỉ gồm M L H V Z. Ngoài: bút Bézier, boolean, bộ lọc, mặt nạ, trình sửa gradient, văn bản nhiều dòng hay trên đường, sửa `symbol`. Lý do: Master Plan §7.5 giới hạn có chủ đích ("không làm công cụ vẽ path tự do"; Inkscape cho hình phức tạp); mục tiêu GĐ 6 là sửa phần tử trong SVG (đường, chữ nhật, ellipse, văn bản) và bố cục, không thay Inkscape.
- **D24. Hoàn tác bằng lệnh đảo ngược 100 bước**, gộp lô; Master Plan §7.4 cấm chụp lại toàn bộ DOM.
- **D25. Trạng thái soạn thảo (khóa, ẩn lớp, đường gióng) ở `<project>/.mat-editor/` ngoài gói**, để SVG sạch và digest không đổi vì thao tác giao diện.
- **D26. Tự lưu 30 s**, ghi tạm rồi đổi tên; khôi phục khi mở lại (Master Plan Sprint 3).
- **D27. Template bung khi lưu; faceplate là popup có tham số thay chuỗi lúc chạy.** Lý do: template thuần không đòi runtime đổi (Constitution II), còn faceplate cần thay lúc chạy vì mục đích là một popup cho N thiết bị; tham số chỉ là chuỗi thay thế, validator bung mọi tổ hợp nên không thể tạo Tag ngoài tập đã kiểm.
- **D28. Mảng sau pilot không làm ở đây:** thông báo alarm ngoài (email, Telegram, Zalo), recipe, API dữ liệu ra (REST, MQTT), giao diện mobile, image Buildroot, các đợt driver. Ghi thành kế hoạch `docs/plans/post-1.0-backlog.md` (FR-134).
- **D29. Pilot ≥ 30 ngày, 1 đến 2 site cộng bàn thử nội bộ; tiêu chí ra số hóa ở FR-139.** Lý do: Master Plan §15 và §6.4 (30 ngày trước bản thương mại); 99,9 % uptime tiến trình tương đương ≤ 43 phút/30 ngày; mất nguồn do site loại trừ vì không do sản phẩm gây.
- **D30. Tuổi thọ eMMC ước tính bằng TBW của datasheet chia ghi mỗi ngày nhân hệ số khuếch đại ghi giả định 5** (bi quan), cộng đọc `EXT_CSD`; thiếu datasheet thì chỉ báo chỉ số. Ngưỡng ≥ 5 năm. Cần người: datasheet chip eMMC của BL335.
- **D31. Tài liệu bằng tiếng Việt, 3 nhóm đối tượng, kiểm bằng bảng tác vụ và công cụ `docs-check`.**
- **D32. Mức Low của review chỉ xử lý các mục rẻ có test** (FR-026); mục Low khác ghi hạn chế có chủ ý.
- **D33. Cổng phát hành `-Release`**: từ chối chứng chỉ thử, tự ký, sắp hết hạn, thiếu EKU, thiếu dấu thời gian.
- **D34. Studio không tự cập nhật** (không kênh cập nhật nào ra Internet); người dùng cài bản mới từ bộ cài ký số. Lý do: Studio chạy trong mạng công nghiệp thường cách ly; thêm kênh tự cập nhật là thêm bề mặt.
- **D35. Áp dụng OTA đòi nhập lại mật khẩu** (xác thực lại) ngoài phiên Bearer. Lý do: thao tác đặc quyền cao nhất; token bị đánh cắp không đủ.
- **D36. Chống hạ cấp bằng `releaseSeq` đơn điệu** trong manifest; hạ cấp chỉ bằng "Quay về bản trước" hoặc thủ công.
- **D37. Khóa ký phát hành ECDSA ngoại tuyến, hai khóa (chính, dự phòng); xoay bằng gói keyset ký bởi khóa đang tin cậy.**
- **D38. Dữ liệu pilot chỉ là số đo kỹ thuật** (không dữ liệu quy trình hay cá nhân của khách); hợp đồng bảo mật dữ liệu với khách hàng là việc của công ty (⚠️🔌).

### Giả định và phụ thuộc

- **Phụ thuộc về mã:** 003 đến 007 (đã xong về mã); feature [008](../008-svg-import-binding/spec.md) (GĐ 3b: importer `@mat/svg-import`, allowlist `sanitizeSvg`, `data-mat-uid`, thư viện ký hiệu, gắn Tag và sự kiện cho phần tử SVG; cần cho US6 và US7), [009](../009-alarms/spec.md) (GĐ 4: alarm) và [010](../010-history-reports/spec.md) (GĐ 5: lưu trữ, biểu đồ lịch sử, báo cáo) là các feature riêng; phiên bản định dạng trung gian của chúng ghi ở plan (008: 0.4.0; 009: 0.5.0; 010 chưa có). US1, US2, US3, US4, US5 không phụ thuộc GĐ 3b, 4, 5; US6 và US7 cần GĐ 3b; US9 cần GĐ 4 và 5 xong hoặc hồ sơ pilot ghi rõ phạm vi giảm.
- **Thứ tự giao:** P1 (US1, US2 x64, US3, US8) → US2 BL335 → US4 → US5 → US6 → US7 → US9; vào pilot sau P1 và US4 (FR-140); US5 đến US7 có thể đến trong lúc pilot dưới dạng bản rc qua OTA, với điều kiện chạy lại hồi quy; `1.0.0` đòi tất cả.
- **Bàn thử:** Docker (toolchain `mat-armhf`, x64), giả lập Modbus có gateway nhiều unit (`tools/modbus-sim`), `tools/load-tester`, Chrome headless, `signtool` (Windows SDK 26100), `openssl` trong container, bộ điều khiển nguồn (⚠️🔌 người cung cấp).
- **Thao tác trên BL335** theo Constitution, quy trình bước 3: chỉ đọc khi kiểm; mọi thay đổi ghi vào `device-changes.md`; không đụng `atscada-*`, `piano-edtech-*`; không tự khởi động lại hay cắt điện.
- **Cần người, khách hàng, mạng (⚠️🔌 hoặc 🌐):** quyền SSH tới BL335; 7 ngày thiết bị; bộ điều khiển nguồn và người ở cạnh khi cắt điện; chứng chỉ ký mã thật (mua), máy Windows 10 và 11 sạch; datasheet eMMC; site pilot, PLC thật, đường VPN, người vận hành và kỹ sư của khách để huấn luyện và ký biên bản; người thử chưa biết hệ thống cho SC-029, SC-036, SC-038; Internet cho `cargo audit`, `npm audit`, cơ sở dữ liệu CVE; thử tay bộ gõ và trình đọc màn hình.
- **Rủi ro:** phạm vi rất lớn (9 story): giảm bằng thứ tự ưu tiên, mốc nhỏ và khả năng tách feature (D1); không có site pilot: pilot chạy ở bàn thử và 1.0.0 không gắn (không giả "đạt"); thiếu chứng chỉ ký: bản rc không ký có điều kiện (FR-140); OTA gây hỏng thiết bị từ xa: mặc định tắt, thử lab nhiều, đường thủ công còn nguyên.
- Chrome ≥ 120 (Constitution IV); Studio chạy trên Windows 10/11.

## Ngoài phạm vi và kế hoạch cho sau pilot

Không làm trong feature này (ghi thành kế hoạch ở `docs/plans/post-1.0-backlog.md`, FR-134):

| Mảng | Hướng dự kiến | Phụ thuộc | Điều kiện bắt đầu |
|---|---|---|---|
| Thông báo alarm ngoài (email SMTP, Telegram, Zalo OA) | Dịch vụ gửi trong runtime, hàng đợi lưu bền (store-and-forward), bí mật lưu trên thiết bị, giới hạn tần suất, nhóm nhận theo mức ưu tiên | GĐ 4 (alarm), đường ra Internet của site | Khách hàng pilot yêu cầu và có đường ra Internet |
| Recipe (bộ giá trị đặt) | Công thức đặt nhiều Tag một lần, xác nhận, audit một lô, quyền `engineer` hoặc `operator` theo công thức | US5 (ghi có khai báo), audit lô | Có khách hàng cần (đồ uống, dệt, hóa chất) |
| API dữ liệu ra (REST, MQTT) | REST chỉ đọc có token riêng và role `api`, MQTT publish (Paho, TLS) theo nhóm Tag | GĐ 5 (lịch sử), quản lý token | Có hệ thống ngoài cần nhận dữ liệu |
| Giao diện mobile | Bố cục đáp ứng, cảm ứng, kiosk; Chrome Android ≥ 120 | GĐ 3a, thử trên 1 tablet | Có nhu cầu thực địa |
| Image Buildroot | Rootfs chỉ đọc, A/B phân vùng, OTA kiểu A/B (thay phần thay thế thư mục của ADR-035), BSP của nhà sản xuất | Quyết định OS (Master Plan §11.1), ADR-035 | Trước bản thương mại số lượng lớn |
| Đợt driver 2 đến 4 (S7, MC/SLMP, FINS, MQTT, OPC UA, REST, EtherNet/IP, BACnet) | Theo roadmap §4.8 và khách hàng thực tế | Driver SDK (006) | Chốt theo khách hàng |
| Soak 30 ngày trước thương mại | Tiếp tục ở bàn thử | US2 | Chạy trong pilot |
| Quyền xem theo màn hình, nhiều ngôn ngữ giao diện, đa người dùng nâng cao | Theo 007 "Ngoài phạm vi" | | |
| Bút Bézier, boolean, bộ lọc, sửa gradient, văn bản nhiều dòng | Sau 1.0; hoặc dùng Inkscape | US6 | Có phản hồi từ pilot |
| Studio tự cập nhật, kênh phát hành | D34 | Hạ tầng phát hành | Khi cần |
