# Rà soát bảo mật feature 007 (T138, FR-077)

Ngày: 2026-10-13. Người rà: agent `agent-protocols:security-auditor` (chỉ đọc mã) và agent `agent-protocols:code-reviewer` (năm trục), cộng bằng chứng động của `tools/web-it.ps1` trên runtime x64 thật (`docs/reports/007-*-x64.json`). Phạm vi: phiên và cookie, CSRF, `Origin`, `Sec-Fetch-Site`, WebSocket có cookie, cố định phiên, phạm vi cookie, brute force, XSS, clickjacking, `system/info`, `device.crt`, `/login`, `pulseMs` và `expect`, CSR và nhập chứng chỉ, `viewerLogin`, `/project/*`.

**Kết luận:** 0 phát hiện Critical, 0 High do người rà mã nêu. Hai phát hiện High của review code (bài kiểm `bundle` luôn đạt, kiểm kill-9 xung có thể đạt khi rỗng) là lỗi của chính bộ test, đã sửa. Ba Medium về khả dụng và Host header được ghi nhận kèm quyết định bên dưới. Thêm một lỗi chức năng tìm ra khi chạy trên runtime thật (không phải do người rà): `httpsThreads` quá nhỏ làm 4 trang cùng mở mất 15 s (đã sửa).

## 1. Bằng chứng động (web-it, x64)

| Kịch bản | Kết quả | Tệp |
|---|---|---|
| `attack` | 30 ca của contracts/web-session.md §5: A1-A25 và A30 ở kịch bản này (37 kiểm), A26 và A27 ở `attack-accounts`, A28 ở `session28`, A29 (XSS qua props) ở `runtime-web` e2e (`control.e2e.mjs`, `confirmText`; nhãn XSS ở `screens.e2e.mjs`) và `widgets`; mọi ca bị từ chối đúng mã, **0 lệnh ghi tới giả lập Modbus** | `007-attack-x64.json`, `007-attack-accounts-x64.json`, `007-session28-x64.json` |
| `gate` | nguồn công cộng: `/login`, `assets/login-*`, `/device.crt` mở, `/` và dữ liệu 403 khi `viewerAccess: private`; `viewerLogin: required`: 302 `/login`, dữ liệu 401, WebSocket 401, có phiên thì vào được | `007-gate-x64.json` |
| `control`, `locks`, `session`, `expect`, `pulse` | xem báo cáo nghiệm thu | `007-*-x64.json` |

Ghi chú: contract §5 ghi A21 và A22 là `SESSION_INVALID` / "401"; runtime trả `SESSION_EXPIRED` cho token không có trong kho (A21a, A22). Cả hai đều 401, không có phiên: không phải lỗ hổng, chỉ lệch tên mã so với bảng (đã ghi ở `docs/deployment/mat-runtime.md`).

## 2. Phát hiện và xử lý

| # | Nguồn | Mức | Phát hiện | Xử lý |
|---|---|---|---|---|
| S-L1 | auditor | Low | Header `Authorization: Bearer mats_…` bất kỳ làm `web/login` và `web/logout` bỏ qua kiểm `Origin` (nhánh Bearer chạy trước `checkCookie`). Trình duyệt không khai thác được (header tùy biến cần preflight, không có CORS) nhưng lệch ADR-021 điểm 3 | **Đã sửa** (`server/http/auth_gate.cpp`: `webEntry` luôn đi nhánh cookie). Test viết trước: `WebGate.LoginAndLogoutKeepTheOriginCheckWhateverTheAuthorizationHeader` đỏ rồi xanh |
| S-L5 | auditor | Low | `projectUrl` của trang không loại đoạn `.` và `..` | **Đã sửa** (`apps/runtime-web/src/project-store.ts`, test mới) |
| R-4 | reviewer | Medium | `ProjectStore.open()` lần hai: kết quả tải màn hình của project cũ, xong muộn, vào cache của project mới và xóa nhầm yêu cầu mới | **Đã sửa** (thế hệ `#gen`); test đỏ rồi xanh |
| R-5 | reviewer | Medium | `mat-screen` dùng lại phần tử của item cùng id và loại khi đổi sang màn hình khác: trạng thái nội bộ (đang chuyển, controller đang gửi) rò sang màn hình mới | **Đã sửa** (`packages/ui-components/src/screen/mat-screen.ts`: slot gắn với id màn hình); test đỏ rồi xanh |
| R-1 | reviewer | High (test) | `web-it -Scenario bundle` gán cứng `pass = $true` và không chạy khi `-NoBuild` | **Đã sửa**: chạy `package-web.mjs` và lấy mã thoát |
| R-2 | reviewer | High (test) | `pulse-kill` đạt khi rỗng (không lệnh nào được nhận) và không đọc bit lệnh sau kill | **Đã sửa**: yêu cầu số lệnh nhận bằng số vòng, `interrupted` ≥ số lệnh, ghi bit lệnh sau kill vào số đo |
| R-9 | reviewer | Medium (test) | `expect`: kiểm "không gì tới thiết bị trường" chấp nhận 1 hoặc 2 lệnh | **Đã sửa**: mốc ngay trước lệnh của client B, yêu cầu đúng 0 lệnh ghi |
| F-1 | web-it (động) | High (chức năng) | `httpsThreads` = 8: mỗi WebSocket live và mỗi kết nối keep-alive rảnh (15 s) giữ một worker; 4 trang cùng mở: dữ liệu sống sau 15,6 s | **Đã sửa**: mặc định 40, giới hạn 4-64 (`server/config.*`, `web_contexts.hpp`); sau sửa 10 trang F5 cùng lúc: tối đa 0,54 s. Số đo RAM trên BL335 chờ T150/T151 |
| F-2 | web-it (động) | High (chức năng) | `/project/*` không phục vụ `*.bindings.json` của item `svg` (test C++ lại khẳng định "không phục vụ"): item `svg` của project 0.3 không có binding trên runtime thật (e2e dùng runtime giả nên không thấy) | **Đã sửa** (`LoadedProject::allowlist()` gồm `bindingFile`; `startup_test.cpp` sửa theo). `bindingFile` đã qua `isSafeRelPath`, chỉ có Tag id, không mở rộng bề mặt |
| S-M1 | auditor | Medium | Khóa theo **tên** tài khoản cho phép DoS đăng nhập: 5 lần sai (từ bất kỳ nguồn) khóa tên đó 5 phút với mọi nguồn; lặp lại thì khóa vĩnh viễn | **Chấp nhận, có điều kiện**: thiết kế của 005 (ADR-018), phiên đang mở không ảnh hưởng, Studio và `kysu` vẫn đăng nhập bằng tên khác. Đề xuất cho GĐ sau: khóa theo cặp (tên, IP) cộng ngưỡng toàn cục chậm. Chưa đổi vì đổi hành vi xác thực của 005 cần ADR riêng và chạy lại bộ test 005 |
| S-M2 | auditor | Medium | Không có allowlist `Host`: HTTP 8080 và WebSocket nhận `Origin == "http://" + Host` với `Host` do client đặt: DNS rebinding đọc được dữ liệu xem (đã mở cho LAN theo `viewerLogin: off`). HTTPS không bị (SAN, cookie `__Host-`) | **Ghi nhận, chưa sửa**: allowlist cần danh sách tên/IP cấu hình được, vỡ trường hợp port-forward và NAT của khách. Giảm nhẹ: `viewerLogin: required` (khuyến nghị khi mở ra ngoài LAN) chặn dữ liệu cho khách. Đưa vào danh sách việc còn mở của ADR-021 |
| S-M3 | auditor | Medium | Cạn worker HTTPS (40): máy LAN mở nhiều kết nối TLS im lặng giữ worker tới 10 s | **Ghi nhận**: giảm nhẹ bằng 40 worker (trước 8); đề xuất giới hạn kết nối theo nguồn ở tường lửa (`nft ct count`). Chưa đo trên BL335 |
| S-L2 | auditor | Low | Cookie phiên xuất hiện hai lần: `logout` chỉ xóa cookie phía trình duyệt, phiên server sống tới hết hạn rảnh | Ghi nhận (điều kiện khai thác cần dịch vụ HTTPS khác cùng IP); phiên hết hạn rảnh sau 30 phút |
| S-L3 | auditor | Low | Có thể nhấp đôi xuyên hộp xác nhận (suy đoán) | Ghi nhận; hộp xác nhận mở với focus ở nút Hủy; đề xuất bỏ qua nhấp trong 400 ms đầu (việc của GĐ sau) |
| S-L4 | auditor | Low | `props.confirm = 'none'` cho ghi BOOL một cú nhấp | Có sẵn cảnh báo `W_CONFIRM_NONE` của validator; không chặn (quyết định thiết kế FR-035) |
| S-L6 / R-3 | cả hai | Medium | Xung `pulseMs`: kill -9 hoặc mất điện giữa chờ để lại bit lệnh BẬT; khởi động lại chỉ ghi `interrupted` (`detail.pulse = "pending"`) | **Chấp nhận theo research R17**; web-it `pulse-kill` ghi bit lệnh sau kill vào số đo; hướng dẫn: PLC phải tự xóa bit xung (watchdog). T153 thử trên thiết bị |
| R-6 | reviewer | Medium | `releasePulse` ngủ tối đa 5 x 100 ms trên luồng xung duy nhất khi hàng đợi driver đầy: xung ngắn khác trễ tới 500 ms | Ghi nhận (hiếm: cần hàng đợi driver đầy); đề xuất hẹn lại thay vì ngủ |
| R-8 | reviewer | Medium | `ChartWindow` bỏ mẫu có `t < last`; đồng hồ nguồn chỉnh lùi thì biểu đồ đứng im | Ghi nhận cho GĐ sau |
| R-7 | reviewer | Medium | RAM/DoS của `httpsThreads` = 40 | Xem F-1, S-M3 |
| R-10, R-11, R-12, R-13, R-14 | reviewer | Low/Nit | Người nghe widget ném lỗi chặn người sau; `#poll` bỏ qua 403/5xx; cache danh mục theo `schemasDir`; `setInterval` không dọn; vector có màn hình lỗi schema xen kẽ | Ghi nhận, không ảnh hưởng an toàn |

Phát hiện Info: `/assets/*.svg` không có CSP riêng (chỉ tệp build đáng tin); không `Referrer-Policy`; vân tay hiển thị trên `/login` đi cùng kênh TLS chưa tin cậy (cần đối chiếu với nhãn trên thiết bị).

## 3. Đã kiểm, không thấy vấn đề (đọc mã)

So sánh hằng thời gian của CSRF và băm token; sinh token bằng `getrandom` (không đường lùi yếu); cố định phiên (login luôn tạo token mới); đua phiên (khóa `s.mu`, `rev` đọc trước băm); không có token, CSRF hay mật khẩu trong audit và log; `auth-state.json` (0600, `O_NOFOLLOW`, đọc một lần rồi xóa, gắn bootId); cookie đủ `Secure; HttpOnly; SameSite=Strict; Path=/`, tiền tố `__Host-`, không `Domain`; `cookieAllowed` mặc định `false`; WebSocket có cookie đòi `Origin` khớp trước khi cấp slot và kiểm lại phiên mỗi phút; giới hạn kích thước thân, `chunked` bị 411, độ sâu JSON; `expect`, `pulseMs`, `context` kiểm kiểu và khoảng; CLI chứng chỉ (`O_EXCL|O_NOFOLLOW`, 0600, từ chối khối khóa riêng); `/device.crt` kiểm hai lần không có khóa; không `innerHTML`, `eval`, `unsafeHTML` (ESLint SC-020); màu qua danh sách trắng; CSRF token chỉ trong biến riêng của module.

## 4. Chưa kiểm

Hành vi động của S-M1, S-M3, S-L3 trên BL335; cấu hình port-forward thật; `recoverTagWrites` đọc chưa đủ; `svg-renderer/sanitize.ts` ngoài phần đầu; CVE của CivetWeb và Mbed TLS.
