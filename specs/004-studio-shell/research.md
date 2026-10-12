# Research: Khung giao diện mới của mAT Studio

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Ngày**: 2026-10-11

Phiên bản thư viện chọn theo quy tắc "phát hành ít nhất 2 tuần trước ngày chọn" (2026-10-11), để tránh bản vừa ra chưa ai kiểm. Tra bằng `npm view <gói> time` ngày 2026-10-11.

## R1. Cách viết thành phần giao diện

- **Quyết định:** Lit 3.3.3 (BSD-3-Clause). Mỗi vùng của khung là một web component (`mat-tree`, `mat-tag-grid`…). Logic nằm trong module TS thuần, không phụ thuộc Lit.
- **Lý do:**
  - Web component dùng được cả trong Studio (WebView2) và trong trang runtime trên Chrome. GĐ 3a sẽ có `packages/ui-components` cho widget dùng chung (Constitution II), nên chọn một cách viết cho cả hai từ bây giờ.
  - Template của Lit gắn dữ liệu thành text node hoặc thuộc tính đã thoát ký tự. Lit chỉ dùng `innerHTML` cho phần tĩnh của template do lập trình viên viết, không cho dữ liệu project. Như vậy vẫn giữ được quy tắc "không innerHTML với dữ liệu project" và CSP `script-src 'self'` (Lit không cần `eval`).
  - Gói nhỏ (khoảng 5 KB nén); Studio Sprint 1 viết TS thuần nên chuyển sang dễ.
- **Bổ sung khi cài đặt (2026-10-11):** thành phần của khung Studio render vào **light DOM** (`createRenderRoot() { return this; }`), không dùng Shadow DOM, vì:
  - sprite icon `<use href="#i-…">` chỉ tham chiếu được id trong cùng cây; trong shadow root, id của document không thấy được;
  - token theme và kiểu chung (`theme/*.css`) áp thẳng, giống mockup.

  Tên lớp CSS có tiền tố theo thành phần để tránh đụng nhau. Widget dùng chung với runtime ở GĐ 3a (`packages/ui-components`) vẫn có thể dùng Shadow DOM để cách ly.
- **Đã cân nhắc:**
  - React hoặc Preact: nặng hơn, phải đưa thêm vào runtime web nếu muốn dùng chung widget.
  - TS thuần như Sprint 1: nhiều mã lặp khi giao diện lớn lên (cây, lưới, inspector, hộp thoại).
  - Svelte: cần trình biên dịch riêng, xuất web component còn hạn chế.

## R2. Bố cục khung và docking

- **Quyết định:** GĐ 1 tự dựng bố cục bằng CSS grid, như mockup:
  - thanh kéo đổi cỡ giữa các vùng;
  - thu gọn task card;
  - lưu kích thước vùng;
  - dải tab editor tự viết.

  **Chưa dùng dockview-core.** Khi cần tách đôi editor hoặc kéo panel tự do (GĐ 3a, editor màn hình) thì đánh giá lại dockview-core (MIT, bản ổn định ≥ 2 tuần lúc đó; tại 2026-10-11 là 8.3.1).
- **Lý do:**
  - Spec chỉ yêu cầu đổi cỡ, thu gọn, nhớ bố cục (FR-002); bảy vùng có vị trí cố định.
  - Một thư viện docking (khoảng 40 KB nén, có CSS và mô hình bố cục riêng) là thêm phụ thuộc mà chưa dùng tới (Constitution VII, YAGNI).
  - Tự viết thì kiểm soát được ARIA cho tab và bàn phím (FR-011).
- **Đã cân nhắc:**
  - dockview-core 8.3.1: đủ tính năng nhưng phải tùy biến theme và ARIA, và gắn bố cục vào mô hình của nó sớm.
  - golden-layout: cũ, ít bảo trì.

## R3. Lưới Tag

- **Quyết định:** tự viết lưới trên Lit, chưa ảo hóa (GĐ 1 chỉ cần ≤ 500 dòng mượt, SC-003).
  - Phần logic nằm trong module TS thuần có test, để GĐ 2 thay phần hiển thị bằng lưới ảo hóa mà giữ nguyên hành vi: chọn ô, di chuyển, sửa, xác nhận, hủy, điền xuống, tăng số tên Tag, lọc.
  - Dán từ Excel và CSV để GĐ 2.
  - Mockup đã thử dán dữ liệu dạng tab; logic dán viết sẵn có test nhưng chưa bật trong giao diện GĐ 1.
- **Lý do:** 500 dòng × 7 cột là khoảng 3.500 ô, hiển thị thẳng vẫn nhẹ. Thư viện lưới lớn (AG Grid, Tabulator, RevoGrid) để GĐ 2 so sánh khi có yêu cầu ≥ 2.000 dòng.
- **Đã cân nhắc:** dùng ngay một thư viện lưới. Hoãn vì chưa có số đo và yêu cầu GĐ 2 (dán Excel, chọn vùng nhiều ô) mới quyết định được thư viện nào.

## R4. Icon

- **Quyết định:** Fluent UI System Icons, gói `@fluentui/svg-icons` 1.1.343 (MIT, phát hành 2026-09-25).
  - Nhập từng file SVG cần dùng lúc build (`?raw` của Vite), gom thành sprite `<symbol>` trong ứng dụng.
  - Chỉ đóng gói icon được dùng; 16 px trong cây và lưới, 20 px trên thanh công cụ.
- **Lý do:** một bộ icon thống nhất, hợp giao diện Windows (studio-ux.md §7); không tải từ mạng (CSP `'self'`).
- **Đã cân nhắc:** icon tự vẽ như mockup (dùng tạm được nhưng không đồng bộ nét); Material Symbols (không hợp Windows).

## R5. Trạng thái ứng dụng, hoàn tác

- **Quyết định:**
  - **Store:** store TS thuần, gồm trạng thái và hàm hành động, cho phép đăng ký nghe thay đổi. Không dùng thư viện quản lý trạng thái.
  - **Hoàn tác** bằng snapshot của các tài liệu sửa được (`project.json`, `tags.json`): mỗi hành động sửa lưu bản trước đó, tối đa 100 bước (FR-021).
  - **Gộp bước:** gõ liên tục vào cùng một ô trong 1,2 s gộp thành một bước.
- **Lý do:** tài liệu nhỏ (project mẫu dưới 10 KB, 500 Tag khoảng 100 KB), nên 100 snapshot chỉ khoảng 10 MB trong trường hợp xấu. Snapshot đơn giản và khó sai hơn lưu thao tác ngược. Mockup dùng cách này.
- **Đã cân nhắc:**
  - lưu thao tác ngược (command pattern): tiết kiệm bộ nhớ nhưng mỗi loại sửa phải có hàm ngược kèm test;
  - Immer hoặc Redux: thêm phụ thuộc không cần.

## R6. Giữ định dạng file khi lưu

- **Quyết định:**
  - Sửa trên bản sao của đối tượng đọc từ file và chỉ gán các trường người dùng đổi. Giữ thứ tự khóa và các trường không sửa, kể cả chuỗi rỗng và khoảng trắng.
  - Ghi theo định dạng chuẩn (JSON thụt 2 dấu cách, xuống dòng cuối).
  - So chuỗi kết quả với nội dung đọc từ đĩa: giống thì không ghi.
- **Lý do:** FR-022, và sửa lỗi FR-033 của audit Sprint 1 (Studio cũ dựng lại Tag từ form nên đổi thứ tự khóa và bỏ trường rỗng). Agent mã của GĐ 0 đang sửa `project-form.ts` theo đúng hướng này; feature 004 dùng lại hàm đó.

## R7. Lưu cấu hình làm việc

- **Quyết định:**
  - **Kích thước vùng, theme, task card, nhãn giai đoạn, địa chỉ thiết bị:** lưu trong `localStorage` của WebView2 (thư mục dữ liệu của ứng dụng). Đây chỉ là tiện ích, mất thì về mặc định.
  - **Danh sách project gần đây:** do Rust giữ, ghi trong file JSON ở thư mục cấu hình của ứng dụng (`%APPDATA%\vn.com.atpro.matstudio\recent.json`). Giao diện chỉ yêu cầu "mở mục thứ N"; Rust kiểm mục có trong danh sách và thư mục còn tồn tại rồi mới đặt làm thư mục project.
- **Lý do:** FR-016 giữ quy tắc Sprint 1: giao diện không tự chọn được đường dẫn để đọc/ghi. Nếu giao diện gửi đường dẫn tùy ý, một lỗi chèn mã ở giao diện có thể đọc file ngoài project. Đường dẫn trong danh sách gần đây đều do người dùng chọn qua hộp thoại trước đó.

## R8. Hỏi khi đóng cửa sổ còn thay đổi chưa lưu

- **Quyết định:** dùng sự kiện đóng cửa sổ của Tauri 2 (`onCloseRequested`).
  - Còn thay đổi: chặn đóng, hiện hộp thoại của Studio (Lưu / Không lưu / Hủy), rồi đóng bằng lệnh hủy cửa sổ.
  - Capability thêm quyền đóng và hủy cửa sổ chính.
- **Lý do:** FR-024. Hộp thoại do Studio vẽ nên theo theme và đúng chữ tiếng Việt.

## R9. Phát hiện file bị sửa ngoài Studio

- **Quyết định:**
  - `project_read` trả nội dung kèm SHA-256 của nội dung.
  - `project_write` nhận SHA-256 mong đợi; Rust đọc lại file, so hash trước khi ghi atomic.
  - Khác thì trả lỗi `changed`, giao diện hỏi Ghi đè / Tải lại / Hủy. Ghi đè gửi lại với cờ `force`.
- **Lý do:** FR-025. So hash ngay trong lệnh ghi hẹp khoảng thời gian giữa lúc kiểm và lúc ghi, so với kiểm từ giao diện trước. Thời gian sửa file (mtime) trên NTFS có thể không đổi khi sửa nhanh, nên không dùng.
- **Phụ thuộc mới:** crate `sha2` (MIT/Apache-2.0).

## R10. Kết nối theo dõi thiết bị

- **Quyết định:** một phiên thiết bị duy nhất trong Studio (`DeviceSession`) giữ:
  - một `LiveConnection`, đăng ký mọi Tag của project;
  - một vòng hỏi `/api/v1/system/info` mỗi 5 s.

  Bảng Tag và xem trước màn hình cùng đọc giá trị từ phiên này. Chỉ chiếm 1 trong 10 phiên (FR-030).
- **Thay đổi ở package dùng chung `@mat/live-client`** (có test trước):
  - thêm `setTags(tags)` gửi lại `subscribe` khi danh sách Tag đổi (giao thức 1.0.0 cho phép đăng ký lần 2 thay đăng ký cũ);
  - đưa danh sách `unknown` của snapshot ra ngoài, để bảng Tag ghi "không có trên thiết bị".
- **Giới hạn:** `subscribe` tối đa 1.000 Tag. GĐ 1 không vượt; GĐ 2 xử lý nếu cần.
- **Lý do:** Sprint 1 mở kết nối riêng cho xem trước. Nếu bảng Tag cũng mở một kết nối thì Studio chiếm 2 phiên của thiết bị.

## R11. Xem trước bằng mô phỏng

- **Quyết định:** nguồn giá trị `SimSource` trong Studio phát cùng kiểu cập nhật (`TagUpdate`) với `LiveConnection`, nên `DomApplier` dùng y hệt.
  - Tag số: dao động hình sin trong khoảng Min–Max; thiếu Min/Max thì dùng 0–100.
  - Tag BOOL: đổi trạng thái mỗi 5 s.
  - Tag chuỗi: giữ một giá trị cố định.
  - Quality luôn `GOOD`.
- **Lý do:** FR-032 cho xem trước không cần thiết bị. Đây là dữ liệu xem trước của Studio, không phải logic runtime, nên không vi phạm Constitution II. Mô phỏng Tag cấu hình được (hằng, ramp, nhập tay…) vẫn thuộc GĐ 2.

## R12. Thanh tiêu đề

- **Quyết định:** giữ thanh tiêu đề gốc của Windows. Menu nằm ở hàng đầu trong cửa sổ, cùng hàng với chỉ báo online.
- **Lý do:** thanh tiêu đề tự vẽ (`decorations: false`) mất snap layout của Windows 11 khi rê chuột lên nút phóng to, phải tự xử lý viền đổi cỡ và DPI, và cần thêm plugin để làm lại. Mockup gộp tiêu đề với menu để gọn; trong ứng dụng thật, menu chiếm thêm khoảng 28 px.
- **Cần người dùng biết:** điểm này khác mockup. Muốn gộp như mockup thì làm sau, bằng plugin tiêu đề tự vẽ có hỗ trợ snap layout.

## R13. Chuỗi giao diện

- **Quyết định:**
  - Chuỗi tiếng Việt nằm trong `apps/studio/src/i18n/vi.ts`, là đối tượng có kiểu; lấy chuỗi bằng `t('khóa', tham số)`.
  - ESLint chặn chuỗi có chữ tiếng Việt có dấu nằm ngoài thư mục `i18n`, bằng một luật `no-restricted-syntax`.
- **Lý do:** FR-014. Luật lint bắt phần lớn chuỗi viết rải trong mã mà không cần công cụ trích chuỗi.

## R14. Kiểm thử giao diện

- **Quyết định:** ba tầng.
  1. **Vitest:** logic thuần (store, hoàn tác, giữ định dạng, cây, ánh xạ lỗi, tìm lệnh không dấu, tăng số tên Tag, `SimSource`, `DeviceSession` với socket giả). Component Lit chạy trong jsdom cho hành vi bàn phím của cây, lưới, tab.
  2. **E2E không cần Tauri:** build giao diện ở chế độ `e2e`, trong đó lớp gọi Tauri được thay bằng bản giả có project mẫu trong bộ nhớ (dựa trên `mockIPC` của `@tauri-apps/api/mocks`). puppeteer-core lái Chrome headless qua các luồng chính và chạy axe-core 4.13.0 (MPL-2.0, chỉ dùng khi phát triển; bản 4.14.0 mới 6 ngày). Chạy trong `ci-local.ps1`.
  3. **Studio thật:** WebView2 bật cổng debug, `tools/measure/studio-smoke.mjs` mở rộng, chạy tay trước nghiệm thu: thời gian mở, Tauri thật, theo dõi thiết bị.
- **Lý do:** tầng 1 và 2 chạy được trong CI không cần màn hình; tầng 3 bắt lỗi chỉ có trong WebView2 và Rust.

## R15. Phím tắt trong WebView2

- **Quyết định:**
  - Bắt phím ở `keydown` cấp tài liệu và `preventDefault` cho phím của Studio (Ctrl+S, Ctrl+F, Ctrl+P…), để WebView2 không chạy phím tắt trình duyệt.
  - Tắt phím tắt trình duyệt của WebView2 nếu Tauri cho cấu hình; ghi lại kết quả kiểm khi cài đặt.
  - Ctrl+K và Ctrl+M giống TIA Portal; Ctrl+L để dành cho Nạp xuống (005).
- **Cần kiểm khi cài đặt:** Ctrl+P (in) và F5 (tải lại trang) trong WebView2 phải bị chặn; tải lại trang làm mất thay đổi chưa lưu.

## R16. Phông chữ, theme

- **Quyết định:**
  - **Phông chữ:** Segoe UI Variable (Windows 11), dự phòng Segoe UI (Windows 10). Cascadia Mono, dự phòng Consolas, cho địa chỉ, mã lỗi, biểu thức. Không nhúng phông.
  - **Theme:** token màu lấy từ mockup, khai báo một lần trong `theme/tokens.css` cho sáng và tối. Theo hệ thống dùng `prefers-color-scheme` (WebView2 theo theme ứng dụng của Windows).
- **Lý do:** FR-012, FR-013; có sẵn trên máy kỹ sư nên không tăng dung lượng bộ cài.
