# Feature Specification: Lưu trữ nâng cao, truy vấn lịch sử, biểu đồ lịch sử và báo cáo

**Feature Branch**: `010-history-reports`

**Created**: 2026-10-13

**Status**: Draft

**Input**: User description: "GĐ 5 của lộ trình v2: lưu trữ dữ liệu, biểu đồ lịch sử, báo cáo (roadmap §4.6, phần còn lại sau feature 003). Nhóm lưu trữ: thêm chế độ kết hợp (theo thay đổi nhưng ít nhất N giây ghi một lần) và theo Tag kích hoạt; bảng tổng hợp 1 phút và 1 giờ (min, max, avg, last). API truy vấn có giảm điểm (tối đa N điểm mỗi đường: LTTB hoặc min/max theo cửa sổ), xuất CSV, HTTPS và đăng nhập (viewer đọc), giới hạn tải để giữ ngân sách BL335 (truy vấn 24 giờ ≤ 2 s). Ước tính ghi eMMC: Studio và validator mở rộng cho chế độ mới, cảnh báo hoặc chặn theo ngân sách. Web: biểu đồ lịch sử (nhiều đường, chọn khoảng, zoom/pan, con trỏ đọc giá trị); bar/pie trên số tổng hợp (điện năng theo ca, theo ngày); báo cáo theo mẫu ngày/ca/tháng (min, max, avg, tổng, cuối) xuất CSV, XLSX, PDF sinh trên trình duyệt để không tốn CPU BL335, thư viện phải rà license, tuổi, kích thước; bảng dữ liệu lịch sử; widget cho `@mat/ui-components`. Studio: editor lưu trữ hiện ước tính ghi khi sửa; editor mẫu báo cáo. Tùy chọn chốt sau: chuyển tiếp MQTT. Nghiệm thu: 200 Tag lưu theo thay đổi trong 7 ngày nằm trong ngân sách ghi; truy vấn 24 giờ ≤ 2 s; mất điện 100 lần không hỏng DB (trên x64 dùng kill -9 hàng loạt)."

## Bối cảnh

Sau [003](../003-data-logging/spec.md), BL335 đã ghi dữ liệu Tag vào SQLite (bảng rộng, WAL, thời hạn lưu, trần dung lượng), chuyển tiếp chính xác một lần sang MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB, và có validator hai bản kèm ước tính ghi eMMC. Sau [007](../007-screens-widgets/spec.md), trang Chrome có widget và đăng nhập bằng cookie. Nhưng dữ liệu lưu **chưa ai đọc được từ trình duyệt**:

- không có API đọc lịch sử; chỉ có lệnh `--export-history` chạy trên thiết bị;
- biểu đồ của 007 là thời gian thực, bộ đệm trong trình duyệt, mất khi F5 (D20 của 007);
- không có báo cáo; muốn có điện năng theo ca phải viết SQL trên DB ngoài;
- chưa có chế độ ghi theo Tag kích hoạt (ví dụ ghi một dòng mỗi mẻ) và chưa có bảng tổng hợp, nên đọc 24 giờ của một nhóm 200 Tag phải quét hàng chục MB;
- Studio chỉ **xem** cấu hình lưu trữ ([logging-view.ts](../../apps/studio/src/ui/editors/logging-view.ts), "Editor sửa lưu trữ có ở GĐ 5").

GĐ 5 của [lộ trình v2](../../docs/plans/roadmap-v2.md) (§4.6) làm phần còn lại. Phát hiện khi đọc mã và spec 003 (ghi lại để không làm thừa): chế độ **kết hợp** (theo thay đổi nhưng ít nhất N giây ghi một lần) **đã có** từ 003 dưới dạng `onChange` kèm `maxIntervalMs` (FR-004 của 003). Việc còn lại của chế độ này là đặt tên và hiển thị trong Studio, không thêm giá trị `mode` mới (D2).

Ràng buộc chính của [Constitution](../../.specify/memory/constitution.md) 2.0.1:

- **II:** trình duyệt không truy cập DB; mọi truy vấn qua `mat-runtime`. Studio và runtime dùng chung schema, ước tính, tính toán tổng hợp (`packages/*`); `core/` không có mã giao diện.
- **III:** ngân sách BL335: RSS ≤ 150 MB, SQLite cache ≤ 32 MB, CPU trung bình ≤ 30 % với 500 Tag/1 s/10 client, ghi eMMC ≤ 2 GB/ngày. Truy vấn lịch sử là tải mới phải nằm trong ngân sách.
- **V:** API đọc dữ liệu qua mạng cần HTTPS và đăng nhập; không SQL tự do; tham số truy vấn kiểm theo allowlist; không `eval`.
- **VI:** test viết trước. **VII:** vượt ngân sách ghi **chỉ cảnh báo, không chặn** (điều kiện lưu trữ 2026-10-10); schema theo SemVer có migration; SQLite WAL `synchronous=NORMAL`.

Phần Studio theo [studio-ux.md](../../docs/architecture/studio-ux.md) §5 (editor Lưới và Form) và §9; chuẩn là công cụ IDE kiểu TIA Portal, người dùng từ chối giao diện form cơ bản.

**Thuật ngữ:**

- **Nhóm lưu trữ**: như 003 (bảng rộng `log_<table>`, mỗi dòng một thời điểm).
- **Dòng thô**: một dòng của `log_<table>`. **Bảng tổng hợp**: số liệu min, max, đầu, cuối, tích phân theo từng Tag và từng cửa sổ 1 phút hoặc 1 giờ, nằm trong `history.db`; mỗi hàng của bảng là một **bucket** (cửa sổ tổng hợp).
- **Tín hiệu giữ**: giá trị của một Tag được coi là không đổi từ dòng thô này tới dòng thô kế tiếp. Mọi số tổng hợp tính trên tín hiệu giữ (D4).
- **Giảm điểm**: rút dữ liệu về tối đa N điểm mỗi đường để vẽ; `minmax` (mỗi cửa sổ thời gian giữ điểm nhỏ nhất và lớn nhất) hoặc `lttb` (Largest-Triangle-Three-Buckets).
- **Mẫu báo cáo**: cấu hình trong `reports.json` (nhóm, Tag, hàm, kiểu kỳ ngày/ca/tháng). **Báo cáo**: kết quả của một mẫu cho một kỳ cụ thể, dựng trên trình duyệt.
- **Chế độ chỉ xem**, **phiên web**, **widget**, **BL335**: như 007.

## Clarifications

### Session 2026-10-13

Người dùng giao toàn quyền quyết định cho phiên làm việc (2026-10-11, "decide, self-evaluate, finish v2"). Mọi điểm chưa rõ được chọn phương án hợp lý nhất và ghi ở mục Assumptions (D1–D36), mỗi điểm kèm lý do.

- Q: "Chặn theo ngân sách" nghĩa là gì khi Constitution VII cấm chặn? → A: Không chặn lưu hay chạy. Validator cảnh báo kèm con số; Studio bắt xác nhận rõ ràng khi nạp xuống một cấu hình vượt ngân sách (chặn mềm); runtime hiển thị ghi eMMC đo thực nhưng không tự giảm dữ liệu (D18).
- Q: Chuyển tiếp MQTT có làm không? → A: Không, ngoài phạm vi (D21).
- Q: Chế độ kết hợp là chế độ mới? → A: Không; là `onChange` có `maxIntervalMs` (D2).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ghi theo Tag kích hoạt và dùng chế độ kết hợp (Priority: P1)

Kỹ sư khai báo nhóm "mẻ trộn" ghi một dòng mỗi khi bit `BATCH.DONE` chuyển từ 0 lên 1, và nhóm "áp suất" ghi khi giá trị đổi hơn 0,2 bar nhưng ít nhất mỗi 60 s một dòng (chế độ kết hợp). Runtime ghi đúng theo cấu hình; Studio gọi chế độ thứ hai là "Kết hợp".

**Why this priority**: là phần còn thiếu của "Nhóm lưu trữ" trong lộ trình và là nền để biểu đồ lịch sử phân biệt "không đổi" với "mất dữ liệu" (nhịp tim 60 s). Giá trị độc lập: dữ liệu theo mẻ nằm trong SQLite và DB ngoài.

**Independent Test**: unit test hàm quyết định ghi với đồng hồ giả (`sampler_test`), rồi chạy runtime x64 với `projects/history-demo` (task tạo) và Tag mô phỏng tạo cạnh lên/xuống; xuất CSV bằng `--export-history`.

**Acceptance Scenarios**:

1. **Given** nhóm `trigger` với `edge: rising` trên Tag BOOL, **When** Tag chuyển 0 → 1 ba lần cách nhau 5 s, **Then** có đúng 3 dòng, mỗi dòng trong ≤ 1,1 s kể từ cạnh và mang giá trị hiện hành của mọi Tag trong nhóm lúc đó; chuyển 1 → 0 không tạo dòng.
2. **Given** `edge: both`, **When** Tag lên rồi xuống, **Then** có hai dòng, dòng thứ hai ghi trạng thái lúc xuống.
3. **Given** `edge: active` với `periodMs` 10 000, **When** Tag bật liên tục 35 s, **Then** có dòng lúc bật và các dòng ở 10, 20, 30 s; thôi ghi khi Tag tắt; còn một dòng khi tắt.
4. **Given** Tag kích hoạt số (`threshold` 50), **When** giá trị vượt 50, **Then** tính là bật; giá trị không nhảy qua ngưỡng thì không tạo cạnh; Tag quality xấu thì tính là tắt và không tạo dòng.
5. **Given** Tag kích hoạt nhấp nháy mỗi 200 ms, **When** chạy 10 s, **Then** số dòng không vượt 1 dòng mỗi `minIntervalMs`.
6. **Given** nhóm `onChange` có `maxIntervalMs` 60 000 (Kết hợp), **When** Tag không đổi 5 phút, **Then** có dòng mỗi 60 s (±250 ms); khi đổi vượt deadband có dòng ngay (sau `minIntervalMs`) và bộ đếm 60 s tính lại từ dòng đó.
7. **Given** cấu hình trigger sai (Tag kích hoạt kiểu chuỗi, thiếu `periodMs` khi `active`, Tag không có), **When** kiểm, **Then** lỗi `E_LOG_TRIGGER` hoặc `E_LOG_REF_TAG` ở cả hai validator với cùng mã.
8. **Given** project cũ có `logging.json` 0.1.0, **When** chạy trên runtime 0.9.0, **Then** chạy y như trước; nhóm `trigger` chỉ có ở 0.2.0.

---

### User Story 2 - Bảng tổng hợp 1 phút và 1 giờ trên thiết bị (Priority: P1)

Với nhóm bật `aggregates`, runtime ghi thêm, cho từng Tag số hoặc BOOL, số liệu mỗi phút và mỗi giờ: nhỏ nhất, lớn nhất, giá trị đầu, giá trị cuối, tích phân theo thời gian (suy ra trung bình và tổng) và số mẫu. Số liệu có sau khi dòng thô đã bị xóa theo thời hạn ngắn hơn, và cho phép đọc 24 giờ hay 30 ngày chỉ trong vài chục KB.

**Why this priority**: nền của truy vấn nhanh (≤ 2 s cho 24 giờ), của bar/pie và của báo cáo (điện năng theo ca, giờ chạy).

**Independent Test**: bộ vector tổng hợp dùng chung TS và C++ (đồng hồ giả, chuỗi dòng cho trước, kết quả bucket cho trước), rồi chạy x64 với dữ liệu mô phỏng tất định và so với tính tay từ dòng thô (`--verify-aggregates`).

**Acceptance Scenarios**:

1. **Given** nhóm cyclic 1 s, Tag giá trị 10 trong 30 s đầu của phút rồi 20 trong 30 s sau, **When** hết phút, **Then** bucket phút có min 10, max 20, đầu 10, cuối 20, trung bình 15 (±0,01), số mẫu 60.
2. **Given** Tag BOOL bật 15 phút trong một giờ, **When** hết giờ, **Then** bucket giờ có tích phân 0,25 giờ (giờ chạy) và trung bình 0,25.
3. **Given** nhóm `onChange` mà Tag không đổi cả giờ, **When** hết giờ, **Then** bucket giờ vẫn có (min = max = đầu = cuối = giá trị giữ, tích phân đủ 1 giờ); không có "lỗ" trong chuỗi bucket.
4. **Given** Tag có quality xấu 10 phút giữa giờ, **When** hết giờ, **Then** 10 phút đó không tính vào tích phân và thời lượng; min, max chỉ tính phần tốt; Tag xấu cả giờ thì không có bucket.
5. **Given** bộ đếm kWh tăng đều, **When** tính chênh lệch (cuối − đầu) của 24 bucket giờ rồi cộng, **Then** bằng (cuối bucket cuối − đầu bucket đầu) chính xác, không mất phần tăng giữa hai bucket (D4).
6. **Given** runtime bị `kill -9` giữa phút, **When** chạy lại, **Then** bucket phút dở được dựng lại từ dòng thô còn lại, không trùng, không thiếu bucket nào ngoài phần mất theo khoảng gom ghi (≤ 5 s); bucket giờ dở dựng lại từ bucket phút.
7. **Given** nhóm đã có dữ liệu thô 3 ngày rồi bật `aggregates`, **When** chạy, **Then** runtime tự dựng bucket cho 3 ngày đó ở nền (mỗi lượt ≤ 20 ms), không làm màn hình live gián đoạn quá 1 s; trạng thái hiện tiến độ.
8. **Given** thời hạn dòng thô 2 ngày và thời hạn bucket phút 31 ngày, **When** sau 10 ngày, **Then** dòng thô cũ hơn 2 ngày bị xóa còn bucket phút 10 ngày vẫn còn; trần dung lượng xóa dòng thô trước, rồi bucket phút, rồi bucket giờ.
9. **Given** thiết bị có `history.db` của 003 (schema 1), **When** chạy runtime 0.9.0, **Then** DB nâng lên schema 2 chỉ bằng thêm bảng (không viết lại dữ liệu), dòng thô cũ còn nguyên.

---

### User Story 3 - API truy vấn lịch sử có giảm điểm và giới hạn tải (Priority: P1)

Trình duyệt (và công cụ bên thứ ba có tài khoản viewer) hỏi dữ liệu lịch sử qua HTTPS: danh mục nhóm và Tag, chuỗi thời gian có giảm điểm, số tổng hợp theo cửa sổ, các dòng cho bảng dữ liệu, xuất CSV. Runtime tự chọn bảng thô hay bảng tổng hợp để trả lời nhanh, và từ chối hay xếp hàng khi quá tải để không làm hỏng vận hành.

**Why this priority**: không có API này thì không có biểu đồ, bảng hay báo cáo; ngân sách (≤ 2 s cho 24 giờ) quyết định thiết kế.

**Independent Test**: client Node (`tools/web-it`) gọi API trên runtime x64 với DB dựng sẵn (`historian_tool fill` mở rộng); đo thời gian và so dữ liệu với đối chiếu tính từ dòng thô; chạy lại trên BL335 (⚠️🔌).

**Acceptance Scenarios**:

1. **Given** viewer đã đăng nhập qua HTTPS, **When** `GET /api/v1/history/catalog`, **Then** nhận danh sách nhóm (id, tên, chế độ, múi giờ, khoảng thời gian có dữ liệu thô và tổng hợp) và Tag (id, cột, kiểu, đơn vị, có tổng hợp hay không).
2. **Given** nhóm 200 Tag có tổng hợp, **When** `series` cho 8 Tag, 24 giờ, `maxPoints` 1000, `res=auto`, **Then** trả ≤ 1000 điểm mỗi đường từ bảng phút, trong ≤ 2 s trên BL335 (SC-006), kèm `res`, `scannedRows`, `elapsedMs`.
3. **Given** `res=raw` mà ước tính quét quá 64 MiB, **When** gọi, **Then** 422 `SCAN_LIMIT` trong ≤ 200 ms kèm gợi ý thu hẹp khoảng hay dùng `auto`; không quét.
4. **Given** nhóm không bật tổng hợp, 24 giờ, **When** `auto`, **Then** trả bằng chọn mẫu theo cửa sổ (`decimate`) với `approximate: true`, không quét cả bảng, vẫn ≤ 2 s.
5. **Given** giảm điểm `minmax`, **When** dữ liệu có một gai, **Then** gai nằm trong đầu ra (mọi cực trị của mỗi cửa sổ được giữ); `lttb` giữ hình dạng theo chuẩn thuật toán (vector chung).
6. **Given** runtime tắt 2 giờ giữa khoảng truy vấn, **When** gọi, **Then** `gaps` chứa khoảng đó và biểu đồ ngắt nét; ô NULL (quality xấu) thành `null`.
7. **Given** 3 truy vấn đồng thời khi giới hạn là 2, **When** gọi, **Then** truy vấn thứ ba nhận 429 `BUSY` kèm `Retry-After` trong ≤ 100 ms; hai truy vấn kia chạy bình thường; màn hình live không gián đoạn quá 1 s (SC-009).
8. **Given** gọi qua HTTP, không đăng nhập, phiên hết hạn, tên nhóm hay Tag không có, tham số lạ, `from ≥ to`, chuỗi giống SQL, **When** gọi, **Then** bị từ chối đúng mã (403 `HTTPS_REQUIRED`, 401, 404, 400) và không chạm DB.
9. **Given** `export.csv` 24 giờ của nhóm 50 Tag, **When** tải, **Then** nhận CSV phát dần (không dựng cả file trong RAM), cột thời gian theo giờ địa phương của nhóm, UTF-8 có BOM, kèm audit `history.export`; quá giới hạn hàng thì 422 `EXPORT_TOO_LARGE` trước khi gửi.
10. **Given** `rows` (cho bảng dữ liệu) với `after` là `seq` cuối của trang trước, **When** gọi liên tiếp, **Then** duyệt hết khoảng thời gian không trùng, không sót, mỗi trang ≤ 500 dòng.

---

### User Story 4 - Biểu đồ lịch sử và bảng dữ liệu lịch sử trên Chrome (Priority: P1)

Người vận hành mở màn hình "Sản xuất" có biểu đồ lịch sử 4 đường (mức bồn, áp suất, công suất, nhiệt độ), chọn "24 giờ qua", kéo chuột chọn vùng để phóng to, kéo để dịch, di con trỏ đọc giá trị từng đường tại thời điểm, bấm đúp để về khoảng ban đầu. Họ mở trang "Lịch sử" chọn Tag và khoảng tự do, và xem bảng dữ liệu theo trang, xuất CSV.

**Why this priority**: là phần người dùng thấy của giai đoạn; nghiệm thu "biểu đồ lịch sử: nhiều đường, chọn khoảng, zoom/pan, con trỏ".

**Independent Test**: Chrome headless (puppeteer-core, đã có) với runtime x64 và DB dựng sẵn; đọc điểm dữ liệu qua giao diện kiểm thử của widget; ảnh chụp so khớp; thử tay trên Chrome và Windows 11.

**Acceptance Scenarios**:

1. **Given** widget `history-trend` 4 đường, khoảng "24 giờ qua", **When** màn hình mở, **Then** biểu đồ hiện ≤ 2,5 s trong LAN (SC-012) với trục thời gian theo giờ địa phương của nhóm, mỗi đường có màu, kiểu nét và chú giải khác nhau; đường không có Tag trong nhóm báo "không có trong nhóm".
2. **Given** kéo chọn một vùng, **When** thả, **Then** biểu đồ phóng vào vùng đó và gọi lại API với độ phân giải mịn hơn (≤ 1,5 s, SC-012); Shift+kéo hoặc kéo bằng chuột giữa dịch khoảng; cuộn chuột phóng/thu quanh con trỏ; bấm đúp về khoảng ban đầu.
3. **Given** con trỏ di trên biểu đồ, **When** dừng, **Then** hiện thời điểm (giờ địa phương) và giá trị mỗi đường tại điểm gần nhất (đúng 100 %, SC-013); với bảng tổng hợp hiện thêm min, max của bucket.
4. **Given** có quãng runtime tắt hoặc Tag BAD, **When** vẽ, **Then** đường ngắt đúng quãng đó (SC-014), không nối điểm cũ.
5. **Given** khoảng kết thúc ở "bây giờ" và bật "theo dõi", **When** chờ, **Then** biểu đồ cập nhật mỗi 10 s mà không nháy và không tải lại toàn bộ.
6. **Given** người xem chưa đăng nhập hoặc trang chạy HTTP, **When** mở màn hình, **Then** widget hiện "Đăng nhập để xem lịch sử" kèm nút (không lỗi trắng); khi API trả `BUSY` thì hiện "Thiết bị đang bận" và tự thử lại sau với khoảng chờ tăng dần có ngẫu nhiên; màn hình khác không bị ảnh hưởng.
7. **Given** màn hình có 4 biểu đồ lịch sử và 10 client cùng mở, **When** F5, **Then** mọi biểu đồ có dữ liệu ≤ 10 s, không client nào mất kết nối live (SC-009); trình duyệt gom yêu cầu tối đa 2 đồng thời mỗi trang.
8. **Given** widget `history-table`, **When** mở, **Then** hiện dòng mới nhất trước, 100 dòng mỗi trang, bấm Trang sau/trước duyệt tiếp, sắp xếp cũ/mới, chọn khoảng, cột thời gian giờ địa phương, Tag có bảng giá trị hiện chữ và màu của bảng (007), nút "Xuất CSV" gọi `export.csv`.
9. **Given** trang `#/history` (có sẵn khi có lưu trữ), **When** chọn nhóm, chọn Tag (≤ 16), chọn khoảng, **Then** vẽ biểu đồ như widget; đường dẫn chứa lựa chọn để chia sẻ và F5 giữ nguyên.
10. **Given** nhóm tắt lưu trữ hoặc project không có `logging.json`, **When** mở widget lịch sử, **Then** hiện "Chưa bật lưu trữ" thay vì lỗi; validator Studio đã báo từ trước.

---

### User Story 5 - Báo cáo ngày, ca, tháng xuất CSV, XLSX, PDF (Priority: P2)

Quản lý chọn mục "Báo cáo điện năng" trong menu, chọn ngày 2026-10-12, nhấn Xem. Trang hiện bảng theo giờ (24 dòng) hoặc theo ca (3 dòng) hoặc theo ngày của tháng (31 dòng) cho các Tag đã chọn, mỗi Tag có cột min, max, trung bình, tổng, cuối theo mẫu, thêm dòng tổng cuối bảng. Họ bấm CSV, XLSX hoặc PDF để tải về; việc dựng file chạy trên trình duyệt.

**Why this priority**: nghiệm thu của giai đoạn (báo cáo ngày/ca/tháng xuất ba định dạng). P2 vì cần US2 và US3.

**Independent Test**: bộ dữ liệu 31 ngày dựng sẵn từ Tag mô phỏng tất định; báo cáo tính độc lập bằng chương trình đối chiếu từ dòng thô; đọc lại XLSX bằng bộ đọc trong test, trích chữ từ PDF; thử mở bằng Excel và Acrobat là việc của người.

**Acceptance Scenarios**:

1. **Given** mẫu `ngay` (kỳ ngày, hàng theo giờ) với Tag điện năng (`delta`), công suất (`avg`, `max`), **When** xem ngày D, **Then** 24 hàng + dòng tổng; mỗi ô khớp tính từ dòng thô (sai lệch ≤ 1e-6 tương đối, SC-015).
2. **Given** mẫu `ca` với 3 ca 8 giờ bắt đầu 06:00 (06–14, 14–22, 22–06), **When** xem ngày D, **Then** 3 hàng; ca 22–06 lấy dữ liệu qua nửa đêm đúng; ngày không đủ dữ liệu hiện ô trống kèm cảnh báo "thiếu dữ liệu X %" (X theo tổng thời lượng biết).
3. **Given** mẫu `thang`, **When** xem tháng 10-2026, **Then** 31 hàng theo ngày giờ địa phương + dòng tổng của tháng (hợp từ các ngày, đúng cho min, max, đầu, cuối, tích phân).
4. **Given** bấm CSV, **When** tải xong, **Then** file UTF-8 có BOM, dấu phẩy, thời gian giờ địa phương, số theo dấu chấm thập phân, tên cột tiếng Việt đúng dấu; giống từng ô trên màn hình (SC-016).
5. **Given** bấm XLSX, **When** mở, **Then** một sheet, tiêu đề mẫu, hàng đầu cố định, số là số (không phải chữ), cột có độ rộng hợp lý, đọc lại bằng bộ đọc trong test khớp 100 % ô.
6. **Given** bấm PDF, **When** mở, **Then** khổ A4 ngang hoặc dọc theo mẫu, tiêu đề, kỳ, người xuất, giờ xuất, bảng chia trang có lặp hàng tiêu đề, chữ tiếng Việt có dấu đúng (trích chữ khớp 100 % ô).
7. **Given** BL335 đang chạy, **When** dựng báo cáo tháng 12 cột, **Then** BL335 chỉ phục vụ yêu cầu `aggregate`; CPU tăng thêm ≤ 5 điểm phần trăm trong lúc tải (SC-017); việc dựng file không gọi BL335.
8. **Given** viewer, **When** xem báo cáo, **Then** xem và tải được (đọc dữ liệu); chưa đăng nhập thì bị chuyển tới đăng nhập; HTTP thì hiện hướng dẫn mở HTTPS.
9. **Given** mẫu tham chiếu Tag không có tổng hợp hoặc nhóm không bật tổng hợp, **When** kiểm, **Then** lỗi `E_RPT_NO_AGG` ở cả hai validator (báo cáo chỉ đọc từ bảng tổng hợp, D13).

---

### User Story 6 - Biểu đồ cột và tròn trên số tổng hợp (Priority: P2)

Màn hình "Điện năng" có biểu đồ cột điện năng theo ca của 7 ngày gần nhất và biểu đồ tròn tỉ lệ điện năng của 5 khu vực trong ngày hôm nay; cập nhật mỗi phút.

**Why this priority**: nghiệm thu nêu "bar/pie trên số tổng hợp (điện năng theo ca, theo ngày)". Dùng lại `aggregate` của US3 nên P2.

**Independent Test**: dữ liệu dựng sẵn; kiểm DOM của widget qua giao diện kiểm thử và đối chiếu số.

**Acceptance Scenarios**:

1. **Given** `history-bar` với `fn: delta`, `bucket: shift`, 3 ca, `period: last7d`, **When** mở, **Then** 21 cột nhóm theo ca, nhãn ngày + ca, giá trị khớp báo cáo cùng thời kỳ (cùng hàm tính, SC-015).
2. **Given** `history-pie` 5 Tag, `fn: delta`, `period: today`, **When** mở, **Then** 5 cung theo tỉ lệ, nhãn và phần trăm; Tag âm hoặc thiếu dữ liệu bị loại và đánh dấu; tổng bằng 0 hiện trạng thái rỗng.
3. **Given** `period: thisShift`, **When** sang ca mới, **Then** widget tự chuyển kỳ ở lần làm mới kế tiếp (≤ 60 s).
4. **Given** thiết bị bận hoặc chưa đăng nhập, **When** mở, **Then** hiện trạng thái như US4 kịch bản 6.

---

### User Story 7 - Studio: editor Lưu trữ có ước tính ghi khi sửa (Priority: P2)

Kỹ sư mở "Lưu trữ" trong cây project. Cột trái là danh sách nhóm (lưới), phần giữa là lưới Tag của nhóm đang chọn (kéo Tag từ cây thả vào, sửa cột, deadband, bật tổng hợp từng Tag), phía dưới là inspector (chế độ Chu kỳ, Thay đổi, Kết hợp, Kích hoạt; chu kỳ; khoảng ghi; thời hạn lưu; đích; tổng hợp). Một khung "Ước tính ghi" luôn hiện: MB/ngày của từng nhóm và tổng, so với ngân sách 2 GB/ngày, số ngày lưu được trong trần dung lượng, và thay đổi ngay khi sửa. Nạp xuống một cấu hình vượt ngân sách phải qua hộp xác nhận.

**Why this priority**: nghiệm thu "editor lưu trữ hiện ước tính ghi ngay khi sửa". Cần US1, US2 (cấu hình), nên P2.

**Independent Test**: e2e trên Chrome headless với lớp Tauri giả; kịch bản dựng cấu hình hoàn toàn trong editor rồi kiểm bằng bộ kiểm tra và so với ước tính của validator.

**Acceptance Scenarios**:

1. **Given** project có nhóm 200 Tag FLOAT32 chu kỳ 1 s, **When** đổi chu kỳ sang 100 ms, **Then** ≤ 100 ms sau, khung ước tính hiện > 2 GB/ngày màu cảnh báo kèm con số, `W_LOG_WRITE_BUDGET`, và gợi ý (tăng chu kỳ, chuyển sang Kết hợp, bớt Tag); vẫn lưu được.
2. **Given** chế độ Kết hợp hoặc Kích hoạt, **When** nhập `expectedRowsPerDay`, **Then** ước tính dùng số đó (ghi "theo dự kiến") thay cận trên; để trống thì ghi "cận trên".
3. **Given** online với thiết bị, **When** bấm "Dùng số đo", **Then** `expectedRowsPerDay` của từng nhóm lấy từ số dòng đo 24 giờ gần nhất của thiết bị (nếu có) và hiện so sánh ước tính với ghi eMMC đo.
4. **Given** cấu hình vượt ngân sách, **When** bấm Nạp xuống, **Then** hộp thoại nêu con số và nhóm gây ra; phải chọn "Tôi hiểu, vẫn nạp" mới tiếp tục; cấu hình vượt 4 lần ngân sách (`W_LOG_WRITE_EXTREME`) cần gõ lại tên project; Hủy không đổi gì (chặn mềm theo Constitution VII).
5. **Given** project có `logging.json` 0.1.0, **When** mở, **Then** Studio đề nghị nâng lên 0.2.0 (chỉ đổi `schemaVersion`), chỉ đọc cho tới khi nâng (như 006 D23).
6. **Given** sửa một ô, **When** hợp lệ hay lỗi, **Then** viền đỏ theo ô, chi tiết ở tab Thông tin, kiểm tra ≤ 500 ms; Tag bị đổi tên ở Bảng Tag thì tham chiếu trong nhóm đổi theo (cùng cơ chế của 006).
7. **Given** Nhóm có bật tổng hợp, **When** xem ước tính, **Then** tách dòng "Tổng hợp" (ghi và dung lượng) khỏi "Dòng thô".

---

### User Story 8 - Studio: editor Mẫu báo cáo (Priority: P2)

Kỹ sư mở "Báo cáo" trong cây project, tạo mẫu "Điện năng theo ca": chọn nhóm, chọn loại kỳ (Ngày, Ca, Tháng), số ca và giờ bắt đầu, thêm các cột bằng cách kéo Tag từ cây, chọn hàm cho từng cột (min, max, avg, tổng, đầu, cuối, chênh lệch, số mẫu), đặt nhãn, đơn vị, số chữ số lẻ, khổ giấy. Khung xem trước dựng báo cáo mẫu bằng dữ liệu mô phỏng tất định hoặc dữ liệu thật từ thiết bị, và thử xuất CSV, XLSX, PDF.

**Why this priority**: nghiệm thu "editor mẫu báo cáo". Cần US5 nên P2.

**Independent Test**: e2e Chrome headless: dựng ba mẫu (ngày, ca, tháng) hoàn toàn trong editor, 0 dòng JSON viết tay; kiểm bằng bộ kiểm tra; nạp vào runtime x64 và mở báo cáo trên Chrome headless.

**Acceptance Scenarios**:

1. **Given** project có nhóm với tổng hợp, **When** thêm mẫu mới, **Then** Studio chỉ cho chọn nhóm có `aggregates` và Tag có `aggregate` ≠ false; hàm không hợp với kiểu Tag bị mờ (BOOL không có `sum` kiểu năng lượng thì vẫn có "giờ chạy" = tích phân).
2. **Given** mẫu `ca`, **When** đặt 3 ca bắt đầu 06:00, **Then** xem trước hiện 3 hàng, nhãn "Ca 1 06:00–14:00"; số ca không chia hết 24 giờ bị từ chối ngay (D14).
3. **Given** đang sửa mẫu, **When** thay hàm hoặc thứ tự cột, **Then** xem trước đổi ≤ 300 ms (dữ liệu mô phỏng) và validator báo lỗi theo ô.
4. **Given** online, **When** chọn "Dữ liệu thiết bị" và một ngày, **Then** xem trước dùng `aggregate` thật qua phiên Studio (token Bearer), so được với trang Chrome.
5. **Given** thêm màn hình trong Studio, **When** mở Toolbox, **Then** có nhóm "Lịch sử" với 4 widget (US4, US6) kéo thả được; menu `navigation` thêm được mục "Báo cáo".

---

### User Story 9 - Nghiệm thu ngân sách và độ bền (Priority: P2)

Kỹ sư chạy nhóm 200 Tag lưu theo thay đổi trong 7 ngày trên BL335 và đo: ghi eMMC thực, kích thước DB, thời gian truy vấn 24 giờ, CPU và RSS khi có 10 client và truy vấn đồng thời. Trên x64, bộ kiểm tra giết tiến trình 100 lần liên tục khi ghi, tổng hợp và truy vấn; trên BL335 người cắt điện thật 100 lần.

**Why this priority**: là tiêu chí nghiệm thu của lộ trình. Làm sau các story chức năng nhưng bắt buộc để đóng giai đoạn.

**Independent Test**: kịch bản `tools/historian-it.ps1 -Scenario kill100` (x64) và `quickstart.md` §9–§11 trên BL335.

**Acceptance Scenarios**:

1. **Given** 200 Tag onChange (cấu hình chuẩn, kèm tổng hợp) chạy ≥ 24 giờ trên BL335 (và dữ liệu 7 ngày dựng sẵn bằng `fill`), **When** đọc `write_bytes` của runtime, **Then** ghi ≤ 2 GB/ngày (SC-022) và ước tính nằm trong ±30 % số đo (SC-025).
2. **Given** DB 7 ngày của nhóm đó, **When** truy vấn 24 giờ 8 đường, **Then** ≤ 2 s (SC-006).
3. **Given** 100 lần `kill -9` ngẫu nhiên trong khi ghi, tổng hợp, truy vấn và gửi bù, **When** mở lại, **Then** `integrity_check` = ok cả 100 lần, `--verify-aggregates` không thấy bucket trùng hay lệch (SC-005, SC-023).
4. **Given** người cắt điện BL335 100 lần (⚠️🔌), **When** khởi động lại, **Then** 0 lần hỏng DB; nếu chưa làm được ghi "chưa đo".

### Edge Cases

**Ghi và tổng hợp**

- **Đồng hồ nhảy hay chưa hợp lệ:** như 003; bucket không tạo khi đồng hồ chưa hợp lệ; nhảy lùi làm bộ cộng dồn đóng bucket hiện tại và khởi động lại tín hiệu giữ (không dựng "bucket tương lai"); nhảy tiến quá một bucket thì các bucket bị nhảy qua không có dòng (lỗ, hiển thị là khoảng trống).
- **Tag quality xấu trong khi tín hiệu giữ:** dòng NULL kết thúc tín hiệu giữ; cho tới dòng tốt kế tiếp không có số.
- **Trigger nhấp nháy quá nhanh hoặc xung ngắn hơn 100 ms:** có thể bị bỏ sót (lấy mẫu mỗi 100 ms); xung ≥ 300 ms luôn được ghi; tài liệu nêu rõ; dùng Tag có bit chốt ở PLC cho xung ngắn.
- **Tag kích hoạt không thuộc nhóm:** hợp lệ; cũng không cần có trong danh sách Tag ghi; nếu bị xóa khỏi project thì `E_LOG_REF_TAG`.
- **Bật tổng hợp trên nhóm toàn Tag chuỗi:** `E_LOG_AGG`.
- **Đổi múi giờ hay `timeZone` của nhóm:** bucket lưu theo UTC nên không đổi; chỉ cách hiển thị và căn kỳ báo cáo đổi.
- **Tắt tổng hợp rồi bật lại:** bucket cũ giữ tới hết thời hạn; khoảng thời gian tắt được dựng bù từ dòng thô nếu còn.
- **Hết dung lượng:** trần xóa dòng thô trước, rồi bucket phút, rồi bucket giờ (D25); trạng thái ghi từng loại.
- **DB schema 2 mở bằng runtime cũ (rollback):** runtime 0.8 bỏ qua bảng lạ, chạy bình thường; dữ liệu tổng hợp không được cập nhật trong thời gian đó và được dựng bù khi nâng lại.

**Truy vấn**

- **Khoảng rỗng, tương lai, trước dữ liệu:** trả mảng rỗng với `coverage`; không lỗi.
- **Khoảng lớn (nhiều năm) mà tổng hợp phút hết hạn:** tự dùng bảng giờ; không có gì thì rỗng.
- **Dữ liệu thô đã bị xóa mà tổng hợp còn:** `auto` dùng tổng hợp; `raw` rỗng kèm `coverage`.
- **Nhóm nhiều Tag:** giới hạn 200 Tag mỗi nhóm của 003 giữ nguyên; nhiều nhóm vẫn hỏi được từng nhóm (mỗi yêu cầu một nhóm).
- **Hai Tag cùng cột sau chuẩn hóa:** đã chặn ở 003.
- **DB hỏng hoặc đang thay file hỏng:** 503 `HISTORY_UNAVAILABLE`; runtime tiếp tục.
- **Trình duyệt đóng giữa truy vấn:** runtime hủy truy vấn (bộ tiến trình SQLite kiểm cờ), trả luồng.
- **Truy vấn kéo dài làm WAL phình:** thời hạn 10 s và giới hạn 2 truy vấn giữ phạm vi; kiểm tra tự động trạng thái checkpoint.
- **HTTP kiosk không đăng nhập (`viewerLogin: off`):** widget lịch sử hiện "Đăng nhập để xem lịch sử"; muốn kiosk xem lịch sử phải đăng nhập tài khoản viewer một lần (D10).
- **Tag không còn trong project nhưng còn dữ liệu cũ:** có trong `catalog` với cờ `orphan`; vẫn truy vấn được.

**Web và báo cáo**

- **Múi giờ trình duyệt khác thiết bị:** mọi hiển thị theo `timeZone` của nhóm (giờ địa phương thiết bị), không theo trình duyệt (FR-039).
- **Báo cáo kỳ chưa kết thúc (ngày hôm nay):** hàng của kỳ chưa trọn có nhãn "đang chạy", số tính đến lúc làm mới.
- **Ca qua nửa đêm, tháng có 28–31 ngày, năm nhuận:** đúng theo lịch; không có giờ mùa hè (độ lệch cố định, 003).
- **Dữ liệu rất lớn (tháng × 24 Tag × 8 hàm):** giới hạn 24 cột và 500 hàng mỗi báo cáo; vượt thì lỗi kiểm tra.
- **Thư viện PDF/XLSX không tải được (mạng đứt, cache lỗi):** CSV vẫn dùng được; nút PDF/XLSX báo lỗi cụ thể.
- **Tên file chứa ký tự cấm trên Windows:** làm sạch tên (`Báo-cáo-điện-2026-10-12.pdf`).
- **Hàng triệu điểm vào biểu đồ:** không bao giờ; API giới hạn 5.000 điểm mỗi đường.

**Studio**

- **Ước tính khi thiếu loại Tag hay Tag tham chiếu lỗi:** bỏ Tag đó khỏi tổng và ghi "chưa tính n Tag"; không ném lỗi.
- **Project chỉ đọc (0.1 chưa nâng):** editor mở chỉ đọc, ước tính vẫn hiện.
- **Sửa tên Tag đã dùng trong mẫu báo cáo hay widget:** đổi theo như 006.

## Requirements *(mandatory)*

### Functional Requirements

**Cấu hình lưu trữ 0.2 (`logging.json`)**

- **FR-001**: Schema `logging.json` MUST lên `0.2.0` (MINOR, thêm trường tùy chọn và giá trị `trigger` của `mode`). Runtime 0.9.0 MUST nhận `0.1.x` và `0.2.x`. Studio MUST có migration 0.1 → 0.2 (chỉ đổi `schemaVersion`). Runtime cũ gặp 0.2 MUST từ chối bằng `E_SCHEMA_VERSION`.
- **FR-002**: Chế độ **kết hợp** MUST là `mode: "onChange"` kèm `maxIntervalMs`; không thêm giá trị `mode`. Mô hình dữ liệu, sampler và hành vi giữ như 003; Studio MUST gọi tổ hợp này là "Kết hợp" và có test sampler riêng cho tổ hợp (D2).
- **FR-003**: Chế độ `trigger` MUST có `trigger` gồm `tagId`, `edge` (`rising`, `falling`, `both`, `active`), `threshold` (số, mặc định 0). `periodMs` (100 … 86.400.000) bắt buộc khi `edge` là `active` và cấm với giá trị khác. `minIntervalMs` (mặc định 1000) áp dụng cho mọi `edge`; `maxIntervalMs` cấm.
- **FR-004**: Trạng thái **bật** của Tag kích hoạt MUST là: BOOL = giá trị đúng; số = giá trị > `threshold`. Quality khác GOOD MUST là "tắt" và không tạo cạnh. Cạnh MUST được xác định bằng so sánh với lần lấy mẫu trước (100 ms); lúc runtime bắt đầu không có cạnh, riêng `active` bắt đầu ghi theo `periodMs` nếu Tag đang bật.
- **FR-005**: Dòng của nhóm `trigger` MUST chứa giá trị hiện hành của mọi Tag trong nhóm tại lúc ghi, với quy tắc ô rỗng của 003; với `active` còn một dòng khi chuyển từ bật sang tắt. Xung của Tag kích hoạt kéo dài ≥ 300 ms MUST luôn thành dòng; xung ngắn hơn 100 ms có thể bị bỏ sót và tài liệu MUST nêu rõ.
- **FR-006**: Nhóm `onChange` và `trigger` MAY có `expectedRowsPerDay` (1 … 864.000.000/100) dùng **chỉ** cho ước tính ghi (FR-055); không đổi hành vi ghi.
- **FR-007**: Nhóm MAY có `aggregates` gồm `minuteRetentionDays` (1 … 365, mặc định 31) và `hourRetentionDays` (1 … 3650, mặc định 730); Tag trong nhóm MAY có `aggregate` (bool, mặc định `true` cho Tag số và BOOL; `true` cho Tag chuỗi là lỗi). Có `aggregates` thì cả hai độ phân giải được ghi cùng nhau (D5).
- **FR-008**: Hai validator (TS cho Studio, C++ cho runtime) MUST kiểm cấu hình mới bằng cùng luật và cùng mã: `E_LOG_TRIGGER` (Tag kích hoạt là chuỗi, trường không hợp với `edge` hay `mode`), `E_LOG_AGG` (`aggregates` mà không có Tag số/BOOL có tổng hợp, `aggregate:true` cho Tag chuỗi); luật cũ của 003 giữ nguyên; Tag kích hoạt không có trong `tags.json` báo `E_LOG_REF_TAG`. Vector dùng chung MUST bổ sung (SC-021).

**Bảng tổng hợp trên thiết bị**

- **FR-009**: Với mỗi Tag có tổng hợp, runtime MUST ghi theo cửa sổ 1 phút và 1 giờ căn theo mốc UTC (bội số của 60 000 ms và 3 600 000 ms): `n` (số dòng thô trong cửa sổ), `min`, `max`, `first`, `last`, `sumw` (tích phân giá trị × mili giây) và `wms` (số mili giây có giá trị). Trung bình = `sumw / wms`; tổng tích phân = `sumw / 3 600 000` (đơn vị × giờ) (contracts/history-db.md).
- **FR-010**: Số tổng hợp MUST tính trên **tín hiệu giữ** (D4): giá trị của một dòng giữ nguyên tới dòng kế hoặc hết cửa sổ; `first` là giá trị tại đầu cửa sổ (kể cả giá trị mang từ cửa sổ trước), `last` là giá trị cuối cửa sổ; `min`, `max` tính trên mọi giá trị có mặt trong cửa sổ. Tín hiệu giữ MUST bị ngắt (không mang sang) khi: ô NULL (quality xấu), runtime khởi động lại, đồng hồ không hợp lệ hoặc nhảy, ghi bị tạm dừng.
- **FR-011**: Chỉ Tag kiểu số và BOOL (0/1) được tổng hợp; Tag chuỗi MUST NOT.
- **FR-012**: Bucket phút đã đóng MUST được ghi trong **cùng giao dịch** với dòng thô của lượt commit; bucket giờ MUST được ghép từ bucket phút khi giờ đóng (min của min, max của max, `first` của phút đầu, `last` của phút cuối, cộng `sumw`, `wms`, `n`) và ghi trong giao dịch của lượt commit đó.
- **FR-013**: Sau khởi động lại hoặc khi file được thay do hỏng, runtime MUST dựng lại bucket phút còn dở từ dòng thô còn lại và bucket giờ dở từ bucket phút, không tạo bucket trùng (khóa chính) và không bỏ bucket đã trọn.
- **FR-014**: Nhóm bật tổng hợp mà đã có dòng thô chưa tổng hợp MUST được dựng bù ở nền, mỗi lượt bảo trì ≤ 20 ms, trong phạm vi thời hạn bucket; tiến độ MUST hiện trong `system/info`.
- **FR-015**: Thời hạn lưu của bucket phút và bucket giờ MUST được áp riêng (`minuteRetentionDays`, `hourRetentionDays`) bằng cùng cơ chế dọn từng phần nhỏ của 003. Trần dung lượng MUST xóa theo thứ tự dòng thô cũ nhất, rồi bucket phút cũ nhất, rồi bucket giờ cũ nhất, và trạng thái MUST ghi số hàng đã xóa theo loại.
- **FR-016**: `history.db` MUST được nâng lên schema 2 (`mat_meta.schema = 2`) bằng thêm bảng và cột, không viết lại bảng dữ liệu, trong một giao dịch; mở lại DB schema 1 hay 2 đều thành công; runtime 0.8 mở DB schema 2 vẫn chạy.
- **FR-017**: Runtime MUST ghi dấu thời gian chạy (`mat_runs`: lúc bắt đầu mỗi lần chạy và lần sống cuối, cập nhật tối đa mỗi 60 s) để API suy ra **khoảng không chạy** (`gaps`); dấu MUST không làm tăng ghi eMMC quá 20 MB/ngày.

**API truy vấn lịch sử (API thiết bị 1.4.0)**

- **FR-018**: Mọi endpoint `history/*` MUST yêu cầu HTTPS và phiên hợp lệ với role từ `viewer` (Bearer cho công cụ và Studio; cookie `__Host-mat_sid` cho trang Chrome, vì chỉ đọc), kiểm `Sec-Fetch-Site` cho `GET` bằng cookie, theo thứ tự kiểm của `AuthGate` (005, 007). Qua HTTP: 403 `HTTPS_REQUIRED`; không có nhánh nào cho truy cập không đăng nhập (D10). Chỉ có `GET`.
- **FR-019**: `GET /api/v1/history/catalog` MUST trả danh sách nhóm và Tag lưu (id, tên, chế độ, `timeZone`, kiểu, đơn vị lấy từ Tag, có tổng hợp hay không, khoảng thời gian có dữ liệu thô và tổng hợp) cùng các giới hạn của API (`limits`), không có thông tin đích chuyển tiếp.
- **FR-020**: `GET /api/v1/history/series` MUST trả chuỗi thời gian của ≤ 16 Tag của một nhóm trong `[from, to)` (epoch ms UTC), tối đa `maxPoints` điểm mỗi đường (10 … 5000, mặc định 1000), theo `res` (`auto`, `raw`, `1m`, `1h`) và `reduce` (`minmax` mặc định, `lttb`, `decimate`); thân trả về dạng cột (`t[]`, `v[]`) mỗi đường, `null` cho ô rỗng.
- **FR-021**: `res=auto` MUST chọn nguồn theo quy tắc: cửa sổ giảm điểm `w = (to − from) / (maxPoints / 2)`; `w ≥ 3 600 000` và bảng giờ phủ khoảng → giờ; `w ≥ 60 000` và bảng phút phủ → phút; ngược lại thô nếu ước tính quét ≤ 64 MiB; nếu vượt mà có tổng hợp thì dùng tổng hợp; nếu vượt mà không có thì `decimate` kèm `approximate: true`. Phản hồi MUST nêu nguồn đã dùng.
- **FR-022**: Giảm điểm MUST giữ các tính chất: `minmax` giữ cực tiểu và cực đại của từng cửa sổ và điểm đầu, cuối khoảng, theo thứ tự thời gian; `lttb` theo thuật toán chuẩn (cố định điểm đầu, cuối); không bao giờ vượt `maxPoints`; tất định (cùng dữ liệu cho cùng kết quả). Khi nguồn là bảng tổng hợp, mỗi bucket thành một điểm với `avg`, `min`, `max` (chọn bằng `fields`).
- **FR-023**: Phản hồi `series` MUST có `gaps` (các khoảng `[a, b]` runtime không chạy theo `mat_runs`, trong phạm vi truy vấn) và `coverage` (khoảng dữ liệu có thực của nguồn đã dùng); ô NULL của dòng thô MUST thành `null`.
- **FR-024**: `GET /api/v1/history/aggregate` MUST trả theo cửa sổ cố định `bucketMs` (bội số của 60 000, 60 000 … 2 678 400 000) và `offsetMs` (căn cửa sổ theo giờ địa phương), tối đa 5.000 cửa sổ và 16 Tag; mỗi cửa sổ có `n`, `min`, `max`, `first`, `last`, `sumw`, `wms` (đã ghép từ bảng giờ khi `bucketMs` và `offsetMs` là bội số của giờ, ngược lại từ bảng phút) cùng `avg`, `sum` suy ra (cùng hàm với `history-math`).
- **FR-025**: `GET /api/v1/history/rows` MUST trả tối đa 500 dòng thô mỗi lần, theo thứ tự `asc` hoặc `desc`, phân trang bằng `after` (`seq`) (khóa chính, không trùng, không sót), kèm `next`.
- **FR-026**: `GET /api/v1/history/export.csv` MUST phát CSV từng khối (không dựng cả file trong RAM) cho dòng thô hoặc tổng hợp phút/giờ, thời gian theo giờ địa phương của nhóm, UTF-8 có BOM (`bom=0` để bỏ), tối đa 500.000 dòng; vượt thì 422 `EXPORT_TOO_LARGE` trước khi gửi byte nào; ghi audit `history.export` (tài khoản, nhóm, khoảng, số dòng, kết quả).
- **FR-027**: Runtime MUST giới hạn tải: tối đa 2 truy vấn `series`/`aggregate`/`rows` đồng thời và 1 xuất CSV trong toàn thiết bị, 1 yêu cầu đang chạy mỗi phiên; vượt thì 429 `BUSY` + `Retry-After`; ước tính quét thô > 64 MiB thì 422 `SCAN_LIMIT` (không quét); hạn 10 s mỗi truy vấn (503 `QUERY_TIMEOUT`) và 120 s cho xuất CSV; ngắt kết nối thì hủy truy vấn.
- **FR-028**: Truy vấn MUST dùng kết nối SQLite chỉ đọc riêng (`query_only`, cache 4 MiB mỗi kết nối, tối đa 3 kết nối), luồng ưu tiên thấp (nice +10), không chặn writer của historian; tổng cache SQLite toàn tiến trình MUST giữ ≤ 32 MiB.
- **FR-029**: Mọi tham số MUST kiểm chặt (số nguyên, chuỗi theo allowlist); tên nhóm và Tag MUST được tra từ `catalog` hiện hành; không chuỗi nào từ client được ghép vào câu lệnh SQL (tên bảng và cột chỉ lấy từ cấu hình đã kiểm); lỗi theo bảng mã của contract (400, 401, 403, 404, 422, 429, 503).
- **FR-030**: Truy vấn thường MUST không ghi audit nhưng được đếm (`system/info`); xuất CSV MUST ghi audit. Phản hồi MUST có `Cache-Control: no-store`.
- **FR-031**: `system/info` MUST thêm vào khối `historian`: `query` (số truy vấn, bị từ chối, đang chạy, p95 thời gian, lỗi gần nhất), `aggregates` (tiến độ dựng bù, số hàng theo độ phân giải), `io` (ghi eMMC đo thực, FR-057) và theo nhóm số dòng/ngày đo được; không có secret hay thông tin đích. `runtime.json` MUST có tùy chọn `historyMaxConcurrent` (1 … 4, mặc định 2), `historyQueryTimeoutMs` (1000 … 30000, mặc định 10000), `historyMaxScanMiB` (8 … 256, mặc định 64), `historyReaderCacheKiB` (1024 … 8192, mặc định 4096) và `historyApi` (bool, mặc định `true`; `false` tắt toàn bộ `history/*`).

**Web (Chrome)**

- **FR-032**: Thư viện widget MUST thêm bốn widget `history-trend`, `history-table`, `history-bar`, `history-pie` vào danh mục (nhóm `history`), dùng chung cho Studio và Chrome (Constitution II), không gọi mạng trực tiếp: nhận `HistorySource` do nơi chứa cấp (như `TagSource` của 007).
- **FR-033**: `history-trend` MUST có: ≤ 8 đường, hai trục Y (trái/phải) tùy chọn mỗi đường, chọn khoảng (cài sẵn 1 giờ, 8 giờ, 24 giờ, 7 ngày, 30 ngày, hôm nay, hôm qua; tùy chọn khoảng tự do), phóng bằng kéo chọn và cuộn chuột, dịch bằng Shift+kéo hoặc nút giữa, bấm đúp về khoảng gốc, con trỏ đọc giá trị mỗi đường, bật/tắt từng đường ở chú giải, vùng min–max khi dữ liệu từ tổng hợp, nét bậc thang cho nhóm theo thay đổi, ngắt nét ở `gaps` và `null`; bàn phím: mũi tên dịch con trỏ, `+`/`-` phóng, `Home` về gốc.
- **FR-034**: Widget MUST gọi lại API khi khoảng đổi (trễ 250 ms sau thao tác), với `maxPoints` = min(2.000, 2 × bề rộng vùng vẽ theo điểm ảnh), hủy yêu cầu đang bay khi có yêu cầu mới, giữ bộ nhớ đệm các khoảng đã tải, tối đa 2 yêu cầu đồng thời mỗi trang qua một hàng đợi dùng chung, tự thử lại khi `BUSY` với khoảng chờ tăng dần có ngẫu nhiên (1 → 2 → 4 → 8 s, tối đa 30 s); chế độ "theo dõi" làm mới mỗi 10 s khi khoảng kết thúc ở "bây giờ".
- **FR-035**: Widget MUST hiện trạng thái rõ: đang tải, "Đăng nhập để xem lịch sử" (kèm nút, khi chưa có phiên hoặc qua HTTP), "Thiết bị đang bận", "Chưa bật lưu trữ", "Không có dữ liệu trong khoảng", "Tag không có trong nhóm", lỗi mạng; không bao giờ trắng trang hay ném lỗi ra màn hình khác.
- **FR-036**: Trang runtime MUST có trang tích hợp `#/history` (hiện khi `catalog` có nhóm và phiên hợp lệ): chọn nhóm, ≤ 16 Tag, khoảng; lựa chọn nằm trong đường dẫn (F5 và chia sẻ giữ nguyên).
- **FR-037**: `history-table` MUST hiện dòng thô theo trang (mặc định 100 dòng, ≤ 500) bằng `rows`, sắp xếp cũ/mới, chọn khoảng, cột thời gian theo giờ địa phương, định dạng giá trị theo Tag (số chữ số, đơn vị, bảng giá trị), nút Xuất CSV bằng `export.csv`.
- **FR-038**: `history-bar` MUST hiện giá trị hàm (`fn` ∈ `sum`, `avg`, `min`, `max`, `first`, `last`, `delta`, `count`) theo cửa sổ (`bucket`: `hour`, `shift`, `day`) của ≤ 4 Tag trong kỳ (`period`: `last24h`, `last7d`, `last30d`, `today`, `yesterday`, `thisShift`, `lastShift`, `thisMonth`, `lastMonth`; `thisShift` và `lastShift` chỉ với `bucket: shift`); `history-pie` MUST hiện tỉ lệ `fn` ∈ (`sum`, `delta`, `avg`) của ≤ 8 Tag trong kỳ, loại Tag âm hoặc thiếu và đánh dấu, trạng thái rỗng khi tổng bằng 0; cả hai làm mới mỗi 60 s và dùng cùng hàm tính với báo cáo (`history-math`).
- **FR-039**: Mọi thời gian hiển thị (trục, con trỏ, bảng, báo cáo, CSV) MUST theo độ lệch `timeZone` của nhóm lưu trữ (mặc định +07:00), không theo múi giờ trình duyệt; dùng hàm định dạng chung của `history-math`, không dùng `Date` cục bộ.
- **FR-040**: Project MAY có `reportsFile` (`reports.json`, schema 0.1.0) và `navigation` MAY có mục `report` trỏ một mẫu; trang runtime MUST dựng trang báo cáo `#/report/<id>` gồm chọn kỳ (ngày, ca, tháng), nút Xem, bảng kết quả, nút CSV, XLSX, PDF, trạng thái như FR-035.
- **FR-041**: Tính toán báo cáo MUST nằm trong `packages/history-math` (TS thuần, dùng chung trang runtime và xem trước của Studio): hàng theo giờ cho kỳ ngày, theo ca (số ca chia hết 24 giờ, bắt đầu `shiftStart`), theo ngày cho kỳ tháng; dòng tổng hợp bằng ghép cửa sổ (min của min, max của max, `first` đầu, `last` cuối, cộng `sumw`, `wms`, `n`); hàm: `min`, `max`, `avg`, `sum` (tích phân), `first`, `last`, `delta` (= `last − first`), `count`.
- **FR-042**: Tệp báo cáo MUST dựng hoàn toàn trên trình duyệt (BL335 chỉ phục vụ `aggregate`): CSV (UTF-8 BOM; hai kiểu: chuẩn dùng dấu phẩy phân tách và dấu chấm thập phân; Excel vi-VN dùng dấu chấm phẩy phân tách và dấu phẩy thập phân), XLSX (một sheet, số là số, hàng tiêu đề cố định) và PDF (A4, chữ tiếng Việt đúng, lặp hàng tiêu đề khi sang trang); giới hạn 24 cột và 500 hàng mỗi báo cáo; tên file đã làm sạch; ô chuỗi bắt đầu bằng `=`, `+`, `-` hoặc `@` MUST được thêm dấu `'` đứng đầu ở CSV và XLSX để chống chèn công thức (ô số không đổi).
- **FR-043**: Thư viện ngoài cho XLSX và PDF MUST được rà license (MIT, Apache-2.0, BSD hoặc tương đương), tuổi phát hành ≥ 14 ngày, lỗ hổng đã biết, kích thước nén; tải lười (chỉ khi bấm xuất) và không tính vào tải khởi động của trang (SC-024 của 007); ghi `third_party/LICENSES.md` và ADR-033.
- **FR-044**: `schemas/widgets.catalog.json` MUST thêm bốn widget với khe, thuộc tính, ràng buộc; hai validator MUST kiểm tham chiếu: nhóm có tồn tại (`E_WIDGET_HISTORY_GROUP`), Tag thuộc nhóm (`E_WIDGET_HISTORY_TAG`), Tag cho `history-bar`/`history-pie` có tổng hợp (`E_WIDGET_HISTORY_AGG`); `report` của `navigation` phải có (`E_NAV_REPORT`).
- **FR-045**: Widget và trang MUST đạt quy tắc trợ năng và an toàn của 007 (FR của 007: không `innerHTML` với dữ liệu, không `eval`, tương phản ≥ 4,5:1, theme sáng/tối, dùng được bằng bàn phím); tên Tag, nhãn và dữ liệu hiện dạng chữ.

**Studio**

- **FR-046**: Studio MUST có editor **Lưu trữ** có sửa được (thay `logging-view.ts` chỉ đọc), theo studio-ux §5: lưới nhóm, lưới Tag của nhóm (kéo Tag từ cây thả vào, điền xuống, dán từ Excel, lỗi theo ô), inspector (chế độ Chu kỳ, Thay đổi, Kết hợp, Kích hoạt; chu kỳ và khoảng; thời hạn lưu; đích; tổng hợp và thời hạn của chúng; `expectedRowsPerDay`), form Kết nối DB ngoài (không có mật khẩu). Hoàn tác/làm lại như các editor khác.
- **FR-047**: Editor MUST hiện khung **Ước tính ghi** cập nhật ≤ 100 ms sau mỗi sửa: MB/ngày của từng nhóm, tách "Dòng thô" và "Tổng hợp", tổng so với ngân sách 2 GB/ngày (thanh và số), dung lượng cần, số ngày giữ được trong trần 2 GB, nhãn "cận trên" hay "theo dự kiến"; dùng đúng hàm `estimateLogging` của `@mat/project-schema` (cùng hằng số với C++; Constitution II).
- **FR-048**: Khi cấu hình có `W_LOG_WRITE_BUDGET` hoặc `W_LOG_SIZE_CAP`, Studio MUST vẫn cho lưu; nút Nạp xuống MUST hiện hộp xác nhận nêu con số và nhóm gây ra, yêu cầu chọn "Tôi hiểu, vẫn nạp"; với `W_LOG_WRITE_EXTREME` yêu cầu gõ lại tên project (chặn mềm, D18). Hủy không đổi gì.
- **FR-049**: Khi online, editor MUST hiện số đo của thiết bị (`system/info`: ghi eMMC 24 giờ, số dòng/ngày từng nhóm) cạnh ước tính và nút "Dùng số đo" điền `expectedRowsPerDay`.
- **FR-050**: Editor MUST nhận project có `logging.json` 0.1.0 ở chế độ chỉ đọc và đề nghị nâng 0.2.0 (FR-001).
- **FR-051**: Studio MUST có editor **Mẫu báo cáo** (lưới cột + form chung + xem trước): chọn nhóm có tổng hợp, loại kỳ (Ngày, Ca, Tháng), ca (số ca, giờ bắt đầu), cột (kéo Tag từ cây, hàm, nhãn, đơn vị, số chữ số lẻ), khổ giấy và hướng, tiêu đề, chân trang; lỗi theo ô.
- **FR-052**: Xem trước MUST dựng báo cáo bằng `history-math` với dữ liệu mô phỏng tất định (`@mat/tag-sim`) hoặc dữ liệu thật qua phiên Studio khi online; MUST thử xuất CSV, XLSX, PDF.
- **FR-053**: Toolbox của editor Màn hình MUST có nhóm "Lịch sử" với bốn widget; inspector sinh từ danh mục; `navigation-editor` MUST thêm được mục báo cáo.
- **FR-054**: Kiểm tra sau mỗi lần sửa ≤ 500 ms (như 007); lưu được cả khi còn lỗi (như 004); mọi chuỗi giao diện qua `i18n`.

**Ước tính ghi eMMC và ngân sách**

- **FR-055**: Ước tính MUST mở rộng cho chế độ mới theo công thức ở contracts/logging-config-0.2.md (cùng hằng số và thứ tự tính ở TS và C++): `trigger` và `onChange` dùng `min(cận trên theo khoảng ghi tối thiểu, expectedRowsPerDay)`; tổng hợp tính theo số Tag có tổng hợp; kết quả tách thô và tổng hợp; số ngày giữ được trong trần.
- **FR-056**: Cảnh báo MUST giữ `W_LOG_WRITE_BUDGET` (> 2 GiB/ngày) và `W_LOG_SIZE_CAP` (> 2 GiB cần để giữ đủ thời hạn) với công thức mở rộng, thêm `W_LOG_WRITE_EXTREME` (> 8 GiB/ngày). Mọi cảnh báo MUST không chặn lưu, nạp xuống hay chạy (Constitution VII), và hiện trong `historian.warnings`.
- **FR-057**: Runtime MUST đo ghi eMMC thực của chính nó (`write_bytes` của `/proc/self/io`, lấy mẫu mỗi 60 s, cửa sổ trượt 1 giờ và 24 giờ) và đưa vào `system/info`; không tự giảm hay bỏ dữ liệu vì số đo.

**Độ bền, tài nguyên, triển khai**

- **FR-058**: Mất điện hay `kill -9` bất kỳ lúc nào MUST NOT làm hỏng `history.db` (gồm bảng tổng hợp); phần mất giới hạn trong khoảng gom ghi; sau mở lại không có bucket trùng, và bucket thiếu chỉ ở khoảng mất đó.
- **FR-059**: Khi có tổng hợp, 10 client live và 2 truy vấn đồng thời, runtime MUST giữ RSS ≤ 150 MB, CPU trung bình ≤ 30 %, 0 mất sequence và khoảng trống live ≤ 1 s (Constitution III, IV).
- **FR-060**: Gói triển khai và tài liệu MUST: giữ `history.db` qua deploy và rollback; không đổi sandbox; mọi thay đổi trên BL335 ghi vào `docs/reports/device-changes.md` kèm cách hoàn tác; `docs/deployment/mat-runtime.md` cập nhật (truy vấn, giới hạn, đo ghi).
- **FR-061**: Lệnh CLI MUST mở rộng: `--export-history` thêm `--res raw|1m|1h`; `--verify-aggregates <nhóm>` (so bucket với dòng thô, báo trùng/lệch/thiếu); `--history-stats` (số hàng, dung lượng theo bảng).
- **FR-062**: Test MUST viết trước mã (Constitution VI): sampler trigger, bộ cộng dồn tổng hợp (vector chung TS/C++), giảm điểm (`minmax`, `lttb`, `decimate`), chọn nguồn, giới hạn tải, kiểm tham số, ghép cửa sổ, báo cáo, xuất CSV, XLSX, PDF, validator hai bản; test tích hợp HTTPS với đăng nhập; `tools/ci-local.ps1` MUST xanh.
- **FR-063**: ADR 031–034 MUST ghi các quyết định chính (Proposed); lộ trình §4.6 cập nhật trạng thái; không sửa mã sản phẩm ngoài các task của feature này.
- **FR-064**: Nghiệm thu trên BL335 (SC-006, SC-009, SC-022, SC-023, SC-025) MUST chạy bằng task ⚠️🔌 chờ người dùng cho phép SSH và, riêng cắt điện, người ở cạnh thiết bị; mục chưa đo MUST ghi "chưa đo" kèm lý do (Constitution VI).

### Key Entities

- **Nhóm lưu trữ (0.2)**: như 003 cộng `mode` `trigger`, `trigger`, `expectedRowsPerDay`, `aggregates`.
- **Tag lưu (0.2)**: như 003 cộng `aggregate`.
- **Bucket tổng hợp**: cho mỗi cột (Tag) của nhóm, độ phân giải (phút/giờ) và thời điểm bắt đầu: `n`, `min`, `max`, `first`, `last`, `sumw`, `wms`.
- **Dấu chạy**: các lần runtime chạy (bắt đầu, sống cuối) để biết khoảng không chạy.
- **Truy vấn lịch sử**: nhóm, Tag, khoảng, độ phân giải, giảm điểm, giới hạn điểm.
- **Mẫu báo cáo**: id, tên, nhóm, kiểu kỳ, ca, cột (Tag, hàm, nhãn, đơn vị, chữ số lẻ), khổ giấy, tiêu đề.
- **Báo cáo**: kết quả một mẫu cho một kỳ: hàng (giờ, ca hay ngày), ô, dòng tổng, tỉ lệ thiếu dữ liệu.
- **Widget lịch sử**: `history-trend`, `history-table`, `history-bar`, `history-pie`.
- **Ước tính ghi**: số liệu từ `estimateLogging`: ghi/ngày và dung lượng, tách thô và tổng hợp, cảnh báo.
- **Số đo ghi eMMC**: `write_bytes` 1 giờ và 24 giờ của runtime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

**Nghiệm thu của lộ trình (§4.6)**

- **SC-022**: 200 Tag lưu theo thay đổi (cấu hình chuẩn: một nhóm, tổng hợp bật, 10 client live) chạy ≥ 24 giờ trên BL335 cho `write_bytes` ≤ 2 GiB/ngày, và DB dựng sẵn 7 ngày cùng cấu hình nằm trong trần dung lượng; chạy thật 7 ngày liên tục là mục tùy chọn (⚠️🔌), nếu chưa chạy ghi "chưa đo".
- **SC-006**: Truy vấn `series` 24 giờ, 8 đường, `maxPoints` 1000, `res=auto`, trên DB 7 ngày của nhóm 200 Tag: p95 ≤ 2 s trên BL335 với 10 client live (cache nguội và nóng, 20 lần mỗi loại); không bật tổng hợp thì dùng `decimate` và cũng p95 ≤ 2 s.
- **SC-023**: 100 lần `kill -9` (x64, tự động, khi đang ghi, tổng hợp, truy vấn, gửi bù) và 100 lần cắt điện thật trên BL335 (người làm; chưa làm thì "chưa đo"): `integrity_check` = ok 100 %, 0 bucket trùng.

**Cấu hình và tổng hợp**

- **SC-001**: Trigger: 100 % cạnh hợp lệ của xung ≥ 300 ms, cách cạnh trước ≥ `minIntervalMs`, thành đúng một dòng trong ≤ 1,1 s (cạnh đến sớm hơn thì hoãn tới hết `minIntervalMs`); số dòng mỗi `minIntervalMs` không vượt 1; kết hợp: ≥ 1 dòng mỗi `maxIntervalMs` ± 250 ms.
- **SC-002**: Bộ vector tổng hợp (≥ 40 ca: dòng đều, thưa, NULL, nhảy giờ, qua nửa đêm, khởi động lại, BOOL, số lớn) cho cùng kết quả ở TS và C++ ở 100 % ca, sai lệch ≤ 1e-9 tương đối.
- **SC-003**: Ghép bucket (phút → giờ, giờ → ngày) bằng trực tiếp tính từ dòng thô ở 100 % bucket của bộ dữ liệu 31 ngày mô phỏng (sai lệch ≤ 1e-9 tương đối; `first`, `last`, `min`, `max`, `n` đúng tuyệt đối).
- **SC-004**: Tổng hợp 200 Tag thêm ≤ 80 MB/ngày ghi eMMC (ca xấu nhất: mọi Tag đổi giá trị mỗi giây; trần 40 MB ban đầu bị đổi theo số đo x64, ADR-031) (đo `write_bytes`, so cấu hình tắt tổng hợp) và ≤ 3 điểm phần trăm CPU trên BL335.
- **SC-005**: Sau 100 lần `kill -9`, `--verify-aggregates` báo 0 bucket trùng, 0 bucket lệch quá dung sai, và bucket thiếu chỉ nằm trong khoảng ≤ khoảng gom ghi cuối mỗi lần.

**API và truy vấn**

- **SC-007**: Truy vấn thô 1 giờ, 16 đường: p95 ≤ 1 s trên BL335; truy vấn vượt `SCAN_LIMIT` bị từ chối ≤ 200 ms; `rows` mỗi trang ≤ 500 ms.
- **SC-008**: Giảm điểm: `minmax` giữ 100 % cực trị của mỗi cửa sổ (kiểm bằng bộ vector và dữ liệu có gai); `lttb` khớp bộ vector tham chiếu; không bao giờ vượt `maxPoints`; kết quả tất định.
- **SC-009**: Với 10 client live xem màn hình chuẩn, 2 truy vấn đồng thời liên tục 10 phút và 1 truy vấn thứ ba: CPU trung bình ≤ 30 %, RSS ≤ 150 MB, 0 mất sequence, khoảng trống live lớn nhất ≤ 1 s, truy vấn thứ ba nhận 429 ≤ 100 ms.
- **SC-010**: Bộ ca tấn công và sai tham số (HTTP, không phiên, phiên hết hạn, cookie sang API khác, tên nhóm/Tag lạ, chuỗi giống SQL ở mọi tham số, số tràn, `from ≥ to`, `maxPoints` ngoài khoảng, nhóm của người khác): 100 % bị từ chối đúng mã, 0 truy vấn tới SQLite với đầu vào của client, 0 thông tin đích chuyển tiếp trong phản hồi.
- **SC-011**: Xuất CSV 24 giờ nhóm 50 Tag (86.400 dòng) ≤ 15 s trên BL335 khi có 10 client live, RSS thêm ≤ 10 MB; CSV mở đúng tiếng Việt và giờ +07:00 trong Excel (thử tay, người).

**Web**

- **SC-012**: Biểu đồ lịch sử 4 đường 24 giờ: từ lúc mở màn hình tới khi vẽ ≤ 2,5 s trong LAN tới BL335; phóng/dịch gọi lại và vẽ ≤ 1,5 s; p95 thời gian khung hình ≤ 16 ms với 8 đường × 2.000 điểm (Chrome máy dev).
- **SC-013**: Giá trị con trỏ đọc khớp dữ liệu API ở 100 % điểm kiểm (giá trị, thời điểm, giờ địa phương).
- **SC-014**: 100 % khoảng không chạy và 100 % khoảng NULL vẽ thành đoạn ngắt, 0 đoạn nối qua khoảng đó.
- **SC-015**: Báo cáo ngày, ca, tháng của bộ dữ liệu 31 ngày: 100 % ô khớp chương trình đối chiếu độc lập tính từ dòng thô (sai lệch ≤ 1e-6 tương đối); `history-bar` và `history-pie` cùng số với báo cáo cùng kỳ.
- **SC-016**: CSV, XLSX, PDF của cùng báo cáo khớp 100 % ô với bảng trên màn hình (CSV so chuỗi; XLSX đọc lại bằng bộ đọc trong test; PDF trích chữ), chữ tiếng Việt đúng dấu; mở bằng Excel, Acrobat và Chrome là thử tay của người.
- **SC-017**: Dựng báo cáo tháng 12 cột, 31 hàng ≤ 5 s trên máy dev (xem + từng định dạng); trong lúc tải, CPU BL335 tăng thêm ≤ 5 điểm phần trăm; 0 yêu cầu tới BL335 trong lúc dựng file.
- **SC-018**: Thư viện XLSX/PDF: license MIT/Apache-2.0/BSD; phát hành ≥ 14 ngày; 0 lỗ hổng đã biết chưa vá (tra cứu ngày làm); chunk nén gzip ≤ 1,2 MB cho PDF và ≤ 60 KB cho XLSX; tải khởi động của trang không đổi (≤ 250 KB gzip, SC-024 của 007).
- **SC-024**: Không hồi quy: mọi kiểm tra tự động của 003, 004, 005, 006, 007 vẫn đạt; trang xem không phụ thuộc lịch sử khi không dùng widget lịch sử.

**Studio**

- **SC-019**: Khung ước tính cập nhật ≤ 100 ms với 32 nhóm × 200 Tag; số hiển thị bằng đúng `estimateLogging`; 0 sai khác giữa Studio, validator TS và validator C++ trên bộ vector ước tính; chặn mềm hoạt động ở 100 % ca (có cảnh báo thì hộp xác nhận hiện, Hủy không nạp).
- **SC-020**: Một kỹ sư dựng nhóm lưu trữ (đủ 4 chế độ, có tổng hợp) và ba mẫu báo cáo (ngày, ca, tháng) hoàn toàn trong Studio, 0 dòng JSON viết tay, Kiểm tra không lỗi, nạp xuống runtime x64 và mở trên Chrome; làm trọn ≤ 20 phút (tự đo nếu không có người thử, như 004).
- **SC-021**: Bộ vector chung cho validator `logging` 0.2, `reports` 0.1, widget lịch sử, `navigation` ≥ 80 ca mới: Studio (TS) và runtime (C++) cho cùng kết luận và mã ở 100 % ca; 100 % vector 0.1 hiện có giữ nguyên kết luận.
- **SC-025**: Ước tính ghi và số đo `write_bytes` cho hồ sơ chuẩn (200 Tag onChange với `expectedRowsPerDay` bằng số đo) chênh ≤ 30 % (x64 và BL335); nếu lệch hơn thì ghi hệ số hiệu chỉnh vào ADR-034.

## Assumptions

### Quyết định đã chốt trước khi viết spec

Từ lộ trình v2 (duyệt 2026-10-11) và 003, 007.

- Vượt ngân sách ghi chỉ cảnh báo (Constitution VII, 2026-10-10); SQLite WAL `synchronous=NORMAL`; bảng rộng và giờ địa phương UTC+7 mặc định (003); biểu đồ thời gian thực dùng uPlot (ADR-020).
- Báo cáo sinh trên trình duyệt (roadmap §4.6); API đọc cần HTTPS và đăng nhập (roadmap §5, Constitution V).
- Runtime 0.9.0, Studio 0.8.0 (người dùng, 2026-10-13).

### Quyết định khi viết spec

Các điểm dưới đây chưa được chốt; spec chọn phương án hợp lý nhất. Mỗi điểm là **Quyết định (người dùng giao toàn quyền 2026-10-11)**.

- **D1. Một feature** (`010-history-reports`) cho cả thiết bị, API, web và Studio. Lý do: tổng hợp, API, widget và editor gắn chặt (định dạng cấu hình, bảng tổng hợp, báo cáo cùng dùng); tách ra thì feature nào cũng phải đổi schema `logging`. Đổi lại, thứ tự story cho phép giao dần: US1–US3 là thiết bị và API, US4–US6 là web, US7–US8 là Studio, US9 nghiệm thu.
- **D2. Kết hợp = `onChange` + `maxIntervalMs`; không thêm `mode`.** Lý do: 003 đã có, thêm giá trị mới tạo hai cách viết cùng một hành vi. Việc làm: tên hiển thị "Kết hợp" trong Studio, test riêng, tài liệu.
- **D3. Chế độ `trigger`** gồm bốn `edge` (`rising`, `falling`, `both`, `active`), Tag kích hoạt BOOL hoặc số với `threshold`; xung < 100 ms có thể bị bỏ sót. Lý do: phủ các nhu cầu thật (mẻ, tuần hoàn khi máy chạy) với một cấu trúc nhỏ; lấy mẫu 100 ms là nhịp sẵn có của historian, không thêm luồng. Giữ cạnh theo Tag engine (bản sửa) thuộc việc sau nếu cần.
- **D4. Tổng hợp tính trên tín hiệu giữ.** Lý do: nhóm theo thay đổi có dòng thưa; trung bình số học các dòng sai. Tích phân theo thời gian cho điện năng (kW → kWh), giờ chạy (BOOL), lưu lượng tích lũy; `first` mang từ cửa sổ trước để `delta` cộng đúng qua bucket (bộ đếm kWh).
- **D5. Cả hai độ phân giải ghi cùng nhau; giờ ghép từ phút.** Lý do: ghép chính xác (min/max/đầu/cuối/tích phân kết hợp được), chỉ cần một bộ cộng dồn chạy trên dòng thô; không đọc lại dòng thô để dựng giờ.
- **D6. Chỉ Tag số và BOOL được tổng hợp.** Lý do: min/max/tích phân vô nghĩa với chuỗi.
- **D7. Thời hạn mặc định:** bucket phút 31 ngày, bucket giờ 730 ngày. Lý do: dung lượng mỗi dòng bucket khoảng 64 byte; 200 Tag × 1.440 × 64 ≈ 18 MB/ngày cho phút, 0,3 MB/ngày cho giờ; 31 ngày phủ một kỳ báo cáo tháng và hai năm dữ liệu giờ chỉ cỡ 220 MB.
- **D8. Bảng rộng thô giữ nguyên; truy vấn dài đọc bảng tổng hợp.** Lý do: một dòng thô của 200 Tag dài khoảng 1,8 KB; 24 giờ ở 1 dòng/giây là khoảng 150 MB quét, không đạt 2 s trên eMMC. Bảng tổng hợp cho 24 giờ là 1.440 hàng mỗi Tag. Đổi lại: nhóm không bật tổng hợp phải dùng `decimate` (chọn mẫu bằng tra cứu chỉ mục, `approximate`) cho khoảng dài.
- **D9. Giảm điểm mặc định `minmax`, tùy chọn `lttb`, dự phòng `decimate`.** Lý do: `minmax` chạy một lượt, bộ nhớ O(1) mỗi đường, không bao giờ mất gai (quan trọng với SCADA); LTTB đẹp hơn nhưng đọc hết điểm vào bộ nhớ. Tự viết cả ba (C++), không thêm thư viện.
- **D10. Chỉ HTTPS và đăng nhập, role từ viewer; không có nhánh cho HTTP kiosk.** Lý do: lịch sử là khối dữ liệu lớn và nhạy cảm hơn giá trị sống; yêu cầu của người dùng ("HTTPS + đăng nhập (viewer đọc)"). Cookie được dùng cho trang Chrome vì chỉ đọc (kiểm `Sec-Fetch-Site`, không cần CSRF cho `GET`); cookie vẫn không vào API kỹ thuật.
- **D11. Giới hạn tải:** 2 truy vấn đồng thời, 1 xuất CSV, 1 yêu cầu mỗi phiên, hạn 10 s, quét thô ≤ 64 MiB, ≤ 16 Tag, ≤ 5.000 điểm, ≤ 500.000 dòng CSV. Lý do: BL335 1 GB RAM, 2 nhân; cache đọc 3 × 4 MiB giữ trong 32 MiB; số liệu là điểm xuất phát, đo ở SC-006, SC-009 rồi chỉnh bằng `runtime.json`.
- **D12. CSV phát dần từ máy chủ cho dòng thô; báo cáo dựng CSV trên trình duyệt.** Lý do: CSV dòng thô có thể lớn (500.000 dòng) nên phải phát dần; báo cáo là bảng nhỏ đã tổng hợp.
- **D13. Báo cáo chỉ đọc bảng tổng hợp, không đọc dòng thô.** Lý do: một báo cáo tháng từ dòng thô là hàng trăm MB. Nhóm không bật tổng hợp thì không có báo cáo (`E_RPT_NO_AGG`); người dùng bật tổng hợp.
- **D14. Ca chia đều 24 giờ** (2, 3, 4, 6, 8, 12 ca) với giờ bắt đầu đặt được. Lý do: phủ ca 8 giờ và 12 giờ phổ biến; ca không đều cần ghép phút (nhiều dữ liệu) và để sau nếu khách hàng cần. Kỳ tháng tính theo ngày giờ địa phương; tháng = ghép các ngày (không thêm tham số lịch ở máy chủ).
- **D15. Múi giờ cố định theo `logging.json`** (Việt Nam không đổi giờ mùa hè). Bucket giờ căn theo UTC nên báo cáo theo giờ địa phương cần `offsetMs` là bội số của giờ để dùng bảng giờ, ngược lại dùng bảng phút.
- **D16. Thư viện báo cáo:** XLSX viết tay trên `fflate` (MIT; một sheet, chuỗi nội tuyến, kiểu số) thay vì thư viện bảng tính đầy đủ; PDF dùng `pdfmake` (MIT) tải lười, phông có đủ chữ tiếng Việt; ứng viên và phương án dự phòng (`jsPDF`, `pdf-lib`, in của trình duyệt) ghi ở ADR-033, quyết định cuối sau task rà soát (số phiên bản, ngày phát hành, kích thước, lỗ hổng tra ngày làm). Lý do: giữ chunk nhỏ, ít bề mặt tấn công, kiểm tra XLSX bằng test tự viết.
- **D17. Bốn widget mới** (`history-trend`, `history-table`, `history-bar`, `history-pie`) thay vì thêm chế độ cho `line`, `bar`, `pie` của 007. Lý do: nguồn dữ liệu, tương tác và giới hạn khác hẳn (không thể ghép chung bộ đệm thời gian thực); danh mục vẫn là nguồn duy nhất cho validator và inspector. Danh mục lên `0.5.0` (thêm widget; `0.4.0` là của hai widget alarm GĐ 4, feature 009).
- **D18. "Chặn" ngân sách là chặn mềm.** Validator cảnh báo; Studio hỏi xác nhận khi nạp xuống; không chặn lưu hay chạy; runtime không tự bỏ dữ liệu vì ghi quá. Lý do: Constitution VII (cấm chặn); người dùng chịu trách nhiệm cấu hình (2026-10-10). Bảo vệ thiết bị đã có ở 003: trần dung lượng và ngưỡng đĩa trống.
- **D19. Đo ghi eMMC bằng `/proc/self/io` (`write_bytes`).** Lý do: số thật của tiến trình, rẻ, không cần quyền; không gồm tiến trình khác. Mức khuếch đại ghi bên trong eMMC không đo được (như lộ trình §5).
- **D20. Dấu chạy `mat_runs` thay cho đánh dấu từng khoảng trống trong dòng thô.** Lý do: biểu đồ cần biết "không chạy" khác "không đổi"; một dòng cập nhật mỗi phút (≤ 20 MB/ngày) rẻ hơn nhịp tim dày; chính xác tới 60 s (chấp nhận).
- **D21. Chuyển tiếp MQTT ngoài phạm vi.** Lý do: lộ trình để "tùy chọn, chốt sau"; cần thư viện client MQTT được rà license (Eclipse Paho/mosquitto), broker thử và thiết kế QoS; MQTT thuộc đợt driver 3 và "API dữ liệu ra" của GĐ 6. Không chặn nghiệm thu GĐ 5.
- **D22. Bảng tổng hợp không chuyển tiếp sang DB ngoài.** Lý do: DB ngoài đã nhận dòng thô (bảng rộng) và khách hàng tự tổng hợp bằng công cụ của họ; thêm đường gửi thứ hai tăng phạm vi chính xác-một-lần.
- **D23. Phiên bản:** runtime 0.9.0; Studio 0.8.0; `logging.json` 0.2.0; `reports.json` 0.1.0; `history.db` schema 2; danh mục widget 0.5.0; API thiết bị 1.4.0 (MINOR kế tiếp: alarm 009 là 1.3.0, 3b giữ 1.2.0); định dạng project 0.6.0 (thêm `reportsFile`, `navigation[].report`; 3b dùng 0.4.0 và alarm dùng 0.5.0 theo thứ tự phát hành, D28 của 009); giao thức live không đổi (1.3.0 của alarm); gói `.matscada` không đổi; `@mat/ui-components` 0.3.0 (0.2.0 cho 3b và alarm). Chuỗi phiên bản thật: runtime 0.7.0 (3b), 0.8.0 (alarm), 0.9.0 (feature này); Studio 0.6.0, 0.7.0, 0.8.0. Các số API, định dạng, danh mục **căn lại** nếu thứ tự phát hành đổi (cùng cách với D28 của 009); không ảnh hưởng thiết kế.
- **D24. Nghiệm thu "7 ngày":** chạy thật ≥ 24 giờ trên BL335 cộng DB 7 ngày dựng sẵn bằng `historian_tool fill` (cùng cấu hình) cho truy vấn và dung lượng; chạy thật 7 ngày liên tục trên BL335 là tùy chọn (⚠️🔌). Trên x64 dùng đồng hồ giả nén thời gian để kiểm logic 7 ngày. Lý do: số ghi/ngày ổn định theo giờ nên 24 giờ đủ ngoại suy; 7 ngày thật chậm và chiếm thiết bị.
- **D25. Thứ tự xóa khi chạm trần:** dòng thô, bucket phút, bucket giờ. Lý do: dòng thô chiếm nhiều nhất và có nguồn dựng lại (nhưng không dựng lại được từ bucket); bucket giờ rẻ và phục vụ báo cáo dài hạn.
- **D26. Mẫu báo cáo nằm trong `reports.json`** khai báo bởi `reportsFile` của `project.json`; mục menu trỏ mẫu bằng `navigation[].report`. Lý do: cùng cách `logging.json` (003); tách khỏi màn hình để dùng lại; không phát sinh loại màn hình mới.
- **D27. Trang `#/history` tích hợp sẵn**, không phải màn hình của project. Lý do: kỹ sư và người vận hành cần xem nhanh một Tag bất kỳ mà không phải dựng màn hình; dùng cùng widget.
- **D28. `maxPoints` mặc định 1.000, tối đa 5.000; trình duyệt dùng 2 × bề rộng vùng vẽ (≤ 2.000).** Lý do: dưới 2 điểm mỗi điểm ảnh không nhìn thấy; 5.000 × 16 đường còn trong 1,6 MB JSON.
- **D29. Không đẩy lịch sử qua WebSocket;** trình duyệt hỏi bằng HTTPS (như kết quả ghi, D29 của 007). Lý do: giữ giao thức live không đổi; lịch sử là yêu cầu theo nhu cầu.
- **D30. Studio dùng hai kiểu editor có sẵn:** Lưới (nhóm, Tag, cột báo cáo) và Form (kết nối, chung) của studio-ux §5, không thêm kiểu mới. Lý do: thống nhất với 006, 007; người dùng từ chối form cơ bản nên mọi bảng là lưới ảo hóa kéo thả từ cây.
- **D31. Truy vấn thường không ghi audit** (đếm trong `system/info`), xuất CSV ghi audit. Lý do: audit `FULL` (011) tốn ghi eMMC; truy vấn biểu đồ nhiều và vô hại; xuất hàng loạt là sự kiện đáng ghi.
- **D32. Dựng bù tổng hợp ở nền, không dừng dịch vụ.** Lý do: bật tổng hợp cho nhóm đã có dữ liệu không được yêu cầu công cụ ngoại tuyến; giới hạn 20 ms mỗi lượt bảo vệ live (như dọn của 003).
- **D33. Bảng dữ liệu lịch sử đọc dòng thô** (cần mọi cột đồng thời), phân trang theo `seq`; không đọc bảng tổng hợp. Lý do: bảng thể hiện dữ liệu gốc; khoảng dài thì người dùng xuất CSV hay xem biểu đồ.
- **D34. Sắp tên cột kiểu xuất:** CSV dùng nhãn tiếng Việt cho báo cáo và tên cột (`TANK01_LEVEL`) cho dòng thô. Lý do: báo cáo cho người đọc; dòng thô cho công cụ.
- **D35. Không thêm thư viện C++ mới.** Giảm điểm, tổng hợp, CSV tự viết (hàm thuần, test vector). Lý do: Constitution VII (YAGNI, rà license) và 003 đã có SQLite.
- **D36. Thiết bị BL335:** SSH tới BL335 không có trong phiên viết spec này (như 007 D40); đo và thử trên thiết bị là task ⚠️🔌. Mọi chức năng chạy và kiểm trên x64 trước (Constitution I: nghiệm thu trên BL335 là điều kiện đóng feature).

### Giả định và phụ thuộc

- **Phụ thuộc:** 003 (historian, `history.db`, validator logging, CLI xuất), 005 (HTTPS, đăng nhập, audit, `AuthGate`), 006 (Tag Engine v1, bảng giá trị, `@mat/tag-sim`), 007 (widget, phiên web, trang runtime, editor Màn hình, uPlot); runtime 0.6.0 trở lên. Phần cần GĐ 3b (SVG) và GĐ 4 (alarm) không có; chỉ căn số phiên bản (D23).
- **Cấu hình ghi gốc:** nhóm 200 Tag là giới hạn của 003 (một nhóm); nhiều nhóm hỏi riêng.
- **Bàn thử:** Chrome headless (puppeteer-core, đã có), `historian_tool fill` (mở rộng cho tổng hợp), `tools/web-it.ps1`; thử trên Chrome, Excel, Acrobat và Windows thật là việc của người.
- **Thao tác trên BL335** theo Constitution, quy trình bước 3: chỉ khi người dùng cho phép; ghi `device-changes.md`; không đụng dịch vụ khác.
- **ADR:** 031 (bảng tổng hợp và tín hiệu giữ), 032 (API truy vấn lịch sử, giảm điểm, giới hạn tải), 033 (báo cáo sinh trên trình duyệt, thư viện XLSX/PDF), 034 (chế độ trigger, ước tính ghi và chặn mềm, đo `/proc/self/io`); tất cả Proposed khi lập plan.
- **Mockup:** plan nêu bố cục hai editor (contracts/studio-010.md); mockup HTML `docs/architecture/mockups/studio-history.html` là task trước khi viết mã giao diện (phiên làm việc tự duyệt).
- Chrome ≥ 120 (Constitution IV); Studio chạy trên Windows 10/11.

## Ngoài phạm vi

- Chuyển tiếp MQTT (D21), chuyển tiếp bảng tổng hợp sang DB ngoài (D22).
- Ca không đều, lịch báo cáo tùy ý (tuần, quý, năm), lập lịch gửi báo cáo qua email, báo cáo tự sinh định kỳ trên thiết bị.
- Bố cục tùy ý của báo cáo (kéo thả trang in, ảnh, logo, biểu đồ trong báo cáo); chỉ bảng, tiêu đề, chân trang.
- Hàm tổng hợp tùy ý (phân vị, độ lệch chuẩn, tích phân có điều kiện) và công thức trên dữ liệu lịch sử.
- Truy vấn nhiều nhóm trong một yêu cầu; truy vấn SQL tự do; API cho hệ thống khác dùng khóa API (GĐ 6 "API dữ liệu ra").
- Đa ngôn ngữ của báo cáo (chuỗi tách file để thêm sau).
- Múi giờ có giờ mùa hè (003).
- Alarm trên dữ liệu lịch sử, so sánh hai kỳ, dự báo.
- Sửa hay xóa dữ liệu lịch sử từ giao diện; nhập dữ liệu từ CSV.
- Bố cục điện thoại; giao diện kiosk riêng cho lịch sử.
- Nén dữ liệu thô, đổi định dạng lưu thô (giữ bảng rộng của 003).
