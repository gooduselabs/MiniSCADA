# Research — 010 Lưu trữ nâng cao, truy vấn lịch sử, biểu đồ lịch sử, báo cáo

Mỗi mục: **Quyết định**, lý do, phương án đã xét. Mọi quyết định là "Quyết định (người dùng giao toàn quyền 2026-10-11)". Số đo chưa có (chưa có SSH tới BL335 khi viết) ghi **chưa đo** và có task đo (⚠️🔌) hoặc task kiểm trên x64.

## R1. Chế độ ghi: "kết hợp" đã có, thêm `trigger`

**Phát hiện:** `core/historian/sampler.*` và FR-004 của 003 đã có `onChange` với `minIntervalMs` và `maxIntervalMs` tùy chọn; `maxIntervalMs` ghi một dòng sau khoảng đó kể từ **dòng trước** (dòng do thay đổi cũng đặt lại bộ đếm). Đó đúng là "theo thay đổi nhưng ít nhất N giây ghi một lần".

**Quyết định:** không thêm giá trị `mode` thứ tư cho hành vi này. Việc làm: tên "Kết hợp" trong Studio, test `sampler_test` riêng cho tổ hợp (đã có test `maxIntervalMs`; thêm ca "đổi vượt deadband đặt lại bộ đếm"), tài liệu. **`trigger`** là giá trị mới của `mode` (spec D3).

**Cài đặt `trigger`:** mở rộng `GroupSampler::tick` (hàm thuần, 100 ms) với trạng thái `active` (lần lấy mẫu trước) và `lastRowMono`; Tag kích hoạt có thể không nằm trong danh sách Tag của nhóm nên `Historian` phải snapshot thêm Tag đó (`TagStore::snapshot(indices)` đã nhận chỉ số tùy ý). Quality xấu = tắt và không tạo cạnh. `active` ghi theo `periodMs` căn theo thời gian đơn điệu từ lúc bật (không căn theo đồng hồ), vì nhịp bắt đầu theo sự kiện. Xung ngắn: lấy mẫu 100 ms bỏ sót xung < 100 ms; xung ≥ 300 ms luôn thấy (mẫu cách 100 ms, giá trị Tag cập nhật theo vòng quét ≤ 100 ms; nếu vòng quét Modbus chậm hơn thì xung cũng phải dài hơn vòng quét; tài liệu nêu rõ).

**Phương án khác:** (a) thêm `mode: "hybrid"` — trùng hành vi, hai cách viết, từ chối. (b) bắt cạnh bằng bộ đếm revision của `TagStore` thay vì lấy mẫu — bắt được xung ngắn hơn nhưng bộ đếm revision tăng cả khi giá trị không đổi (mỗi lần driver cập nhật), cần đổi `TagStore` ngoài phạm vi; để lại như cải tiến nếu khách hàng cần xung ngắn.

## R2. Bảng tổng hợp: dạng dài, tín hiệu giữ, 7 giá trị

**Quyết định:** một bảng dài `mat_agg(cid, res, bucket, n, min, max, first, last, sumw, wms)` `WITHOUT ROWID`, khóa `(cid, res, bucket)`, `cid` tra từ `mat_agg_cols` (history-db.md). Một nhóm 200 Tag không biến thành bảng 1.400 cột.

**Vì sao dài, không rộng:** bảng rộng 7 giá trị × 200 Tag = 1.400 cột gần giới hạn 2.000 cột của SQLite và mỗi truy vấn một Tag vẫn đọc cả dòng (cùng vấn đề của dòng thô, R4). Bảng dài cho phép đọc đúng các hàng của vài Tag trong một khoảng bằng quét khóa chính liên tục.

**Vì sao tín hiệu giữ (D4):** nhóm `onChange` có dòng thưa; trung bình số học các dòng nghiêng về lúc có nhiều thay đổi. Tín hiệu giữ cho trung bình theo thời gian, tích phân (kWh từ kW, lưu lượng tích lũy, giờ chạy của BOOL) và `delta` cộng đúng qua bucket khi `first` mang từ bucket trước. Cho nhóm `cyclic` hai cách gần như trùng nhau; một công thức duy nhất giữ code ngắn.

**Kích thước:** mỗi hàng ≈ khóa 3 số nguyên (1+1+4 byte) + 7 giá trị (4 REAL 8 byte, `sumw` 8 byte, `n`, `wms` 2–4 byte) khoảng 55–70 byte; ước tính dùng 64. 200 Tag × (1.440 + 24) hàng/ngày × 64 ≈ 18,7 MB/ngày dữ liệu, ≈ 37,5 MB/ngày ghi (WAL ×2). Chưa đo: task đo `write_bytes` (SC-004).

**Phương án khác:** (a) lưu chỉ `min, max, avg, last` như lộ trình ghi — không đủ cho `delta` và tích phân, avg theo số học sai với dòng thưa. (b) bảng rộng một hàng cho mỗi phút — bị loại như trên. (c) tính bucket khi truy vấn từ dòng thô — chính là chi phí phải tránh (R4). (d) Tag số nguyên 64 bit lưu `INTEGER`: số tổng hợp dùng `REAL`; chấp nhận mất chính xác trên 2^53 (bộ đếm điện năng thật không tới); ghi trong ADR-031.

## R3. Ghi nguyên tử, khôi phục và dựng bù

**Quyết định:** bucket phút đóng ở lượt lấy mẫu nào được ghi **trong giao dịch commit** chứa dòng thô của lượt đó hoặc lượt sau (không trước). Mốc `agg_built_to` (cuối bucket phút cuối đã ghi) cập nhật trong cùng giao dịch, mỗi phút một lần. Sau khởi động lại, đọc dòng thô `ts ≥ agg_built_to` dựng các bucket còn dở, ghi bằng upsert **ghép** (nên một lần chạy lại giữa phút không tạo trùng); giờ dựng lại từ bucket phút và ghi `INSERT OR REPLACE`.

**Vì sao ghép chứ không thay:** lần chạy mới có thể cắt cùng một phút với bucket vừa khôi phục (khởi động lại trong phút). Ghép (cộng `n`, `sumw`, `wms`; `min`/`max`; `first` giữ; `last` mới) giữ đúng tổng và khóa chính duy nhất; hai nửa phút không bao giờ cùng một dòng thô (mốc `agg_built_to` chặn đọc trùng).

**Vì sao không ghi mốc mỗi commit:** commit mỗi 5 s sẽ thêm 17.280 lần ghi một trang `mat_tables` mỗi ngày (≈ 140 MB/ngày với WAL), chiếm 7 % ngân sách ghi cho một mốc; ghi mỗi phút: 1.440 lần ≈ 12 MB/ngày, và dòng thô chưa tổng hợp tối đa 1 phút bị dựng lại khi mở (rẻ).

**Dựng bù:** nhóm bật tổng hợp lần đầu có dữ liệu thô: dựng lùi theo lát ≤ 1 giờ dòng thô mỗi lượt bảo trì ≤ 20 ms (cùng cơ chế dọn của 003), `agg_back_to` ghi tiến độ. Gieo tín hiệu giữ ở đầu lát từ dòng thô cuối trước lát nếu không có lần chạy mới (`mat_runs`) xen giữa, để dựng bù cho kết quả giống chạy trực tiếp (kiểm bằng vector). Nếu dựng bù làm màn hình live gián đoạn > 1 s: giảm lát (task đo SC-009).

**Phương án khác:** thêm cờ "đã tổng hợp" vào từng dòng thô — tăng kích thước dòng và cần UPDATE từng dòng; từ chối. Dựng lại toàn bộ khi khởi động — chậm với DB GB; từ chối.

## R4. Truy vấn: chi phí của bảng rộng quyết định nguồn dữ liệu

**Đo (ước lượng; chưa đo trên BL335):** một dòng thô 200 Tag FLOAT32 dài khoảng 24 + 200 × 9 = 1,8 KB (ước tính của 003; SQLite lưu số thực 8 byte nên thực tế quanh 1,6 KB), vừa một trang 4 KB, khoảng 2 dòng mỗi trang. 24 giờ ở 1 dòng/giây = 86.400 dòng ≈ 150 MB trang phải đọc, cho dù chỉ cần một cột (SQLite phải giải mã bản ghi tới cột cần). Ở 100 MB/s tuần tự lý tưởng của eMMC thì 1,5 s chỉ cho I/O, chưa tính giải mã, JSON, tranh chấp với ghi và 10 client live. **Không thể đảm bảo 2 s** từ dòng thô cho nhóm lớn.

**Quyết định:** truy vấn dài đọc **bảng tổng hợp** (24 giờ = 1.440 hàng mỗi Tag; 8 Tag ≈ 11.520 hàng ≈ 0,8 MB); dòng thô chỉ cho khoảng ngắn (zoom) hoặc bảng dữ liệu. `res=auto` chọn theo cửa sổ giảm điểm `w` (history-api.md §3.1); `SCAN_LIMIT` 64 MiB chặn truy vấn thô quá lớn trước khi chạy (ước tính bằng hiệu `seq`, hai lần tìm chỉ mục). Nhóm không bật tổng hợp: `decimate` bằng tra chỉ mục từng cửa sổ (`maxPoints` lần tìm, mỗi lần đọc một dòng) — xấp xỉ nhưng nằm trong 2 s và không quét.

**Ngưỡng 64 MiB:** ở 1,8 KB/dòng khoảng 36.000 dòng ≈ 10 giờ dữ liệu 1 s; ở 4,5 KB/dòng (500 Tag, nếu sau này nâng giới hạn nhóm) ≈ 14.000 dòng. Đo ở task quickstart §9 rồi chỉnh `historyMaxScanMiB`.

**Phương án khác:** (a) đổi lưu thô sang bảng dài (mỗi Tag một hàng) — truy vấn một Tag nhanh nhưng ghi và dung lượng tăng mạnh, xóa kiến trúc 003 đã nghiệm thu; từ chối (đã nêu là Ngoài phạm vi). (b) bảng chỉ mục phụ theo cột — không giúp đọc cả dòng. (c) Cache kết quả ở máy chủ — thêm bộ nhớ, ít lợi vì khoảng "bây giờ" đổi mỗi giây; để lại.

## R5. Giảm điểm: minmax mặc định, LTTB tùy chọn, decimate dự phòng; tự viết

**Quyết định:** ba thuật toán thuần ở `core/historian/downsample.*`, test vector chung TS/C++ (chỉ để so khớp hành vi; client không giảm điểm lại, nhưng `history-math` có bản TS cho `SimHistorySource` của Studio để xem trước khớp thiết bị).

- `minmax`: một lượt, O(1) bộ nhớ mỗi cửa sổ mỗi đường, bảo toàn mọi gai (đặc tính cần cho SCADA: áp suất đỉnh, dòng khởi động). Mặc định.
- `lttb`: đẹp hơn cho đường liên tục nhưng cần cả chuỗi trong bộ nhớ và có thể bỏ gai ngắn; tùy chọn.
- `decimate`: chỉ khi không thể quét; trả `approximate`.
- Với nguồn tổng hợp, ghép bucket liền kề (`merge`) cho kết quả **chính xác** về min/max và avg có trọng số thời gian; không dùng LTTB.

**Phương án khác:** thư viện LTTB/M4 — M4 (min, max, đầu, cuối mỗi cửa sổ) gần giống `minmax`; không thêm phụ thuộc cho thuật toán 40 dòng (Constitution VII).

## R6. Đọc và ghi cùng lúc, giới hạn tải

**Quyết định:** kết nối đọc riêng `query_only`, `cache_size = −4096`, `mmap_size = 0` (tránh RSS phình khi file lớn), tối đa 3, tạo lười; WAL cho đọc không chặn ghi. `sqlite3_progress_handler` mỗi 1.000 lệnh ảo kiểm hạn (10 s) và cờ hủy (ngắt kết nối của trình duyệt phát hiện ở chu kỳ ghi). Luồng đọc `nice +10` (setpriority theo luồng). Nhả giao dịch đọc giữa các khối khi phát CSV (không giữ snapshot trong lúc chờ mạng, để WAL checkpoint không đói).

**Ngân sách cache:** ghi 8 MiB + đọc 3 × 4 MiB = 20 MiB + mỗi luồng gửi (≤ 8) khoảng 1 MiB, `alarm.db` 2 MiB (009 FR-037), audit 0,25 MiB ≈ 30,3 MiB ≤ 32 MiB (dư 1,7 MiB; kết nối đọc của `alarm.db` tính theo số của 009). Kiểm khi khởi động; vượt thì hạ cache đọc (`historyReaderCacheKiB`). Chưa đo RSS thực: task đo.

**Số luồng CivetWeb:** mỗi WebSocket chiếm một luồng worker (ADR-001). Mặc định `httpThreads` cần ≥ 10 phiên live + 2 truy vấn + 1 xuất + các yêu cầu khác; kiểm `WebOptions::httpThreads` mặc định ở task và nâng nếu thiếu (ví dụ 20). Truy vấn bị giới hạn đồng thời nên không thể chiếm hết luồng; yêu cầu thứ ba nhận 429 ngay (không giữ luồng chờ).

**Mô hình xếp hàng:** không có hàng đợi ở máy chủ (429 ngay); hàng đợi và thử lại ở trình duyệt (`Retry-After`, lùi có ngẫu nhiên), để máy chủ không giữ kết nối rảnh. 10 client × 2 yêu cầu = 20 > giới hạn 2: lượt đầu nhiều 429 nhưng mỗi truy vấn ≤ 100 ms (nguồn tổng hợp), nên hết lượt trong vài giây (SC-009: 4 biểu đồ × 10 client ≤ 10 s).

**Phương án khác:** hàng đợi ở máy chủ có hạn chờ — giữ luồng CivetWeb; từ chối. Tiến trình đọc riêng (`mat-history`) — cô lập hơn nhưng thêm tiến trình, IPC, RAM; xem lại nếu đo cho thấy ảnh hưởng live (điều kiện xem xét lại của ADR-032).

## R7. Xác thực: viewer, HTTPS, cookie cho GET

**Quyết định:** theo yêu cầu "HTTPS + đăng nhập (viewer đọc)". Thêm năm dòng vào bảng quyền `core/auth/roles.*` với `cookieAllowed = true` (chỉ `GET` đọc, giống `tags/write/{id}`, có kiểm `Sec-Fetch-Site`). Không nhánh HTTP, không phụ thuộc `viewerLogin`: widget lịch sử trên kiosk HTTP không đăng nhập hiện "Đăng nhập để xem lịch sử". Lý do: lịch sử là khối dữ liệu lớn và nhạy cảm (sản lượng, chế độ vận hành nhiều ngày), và API đọc dữ liệu qua mạng thuộc điều kiện Constitution V. Giá phải trả: kiosk muốn xem lịch sử phải đăng nhập một lần (phiên 12 giờ, `webSessionIdleMin` tới 480).

**Audit:** chỉ xuất CSV (một dòng khi kết thúc; D31). Truy vấn thường không audit để không tăng ghi eMMC `FULL`; có bộ đếm và p95 trong `system/info`.

**Phương án khác:** cho `viewerAccess` quyết định truy cập HTTP (đồng bộ với live) — tiện cho kiosk nhưng mở khối dữ liệu lớn qua HTTP không mã hóa; xem lại nếu khách hàng cần (điều kiện xem xét lại của ADR-032).

## R8. Xuất CSV phát dần

**Quyết định:** phát `Transfer-Encoding: chunked` từng khối ≤ 64 KiB, đọc theo `seq` (thô) hoặc `(cid, bucket)` (tổng hợp), định dạng số bằng hàm tự viết (`%.15g` dùng `std::to_chars`/`snprintf` cố định locale `C`), giờ địa phương bằng `clock.*` của 003 (`formatLocal`). Ước tính số dòng trước (hiệu `seq`); > 500.000 → 422. CPU: luồng `nice +10`, nghỉ vài ms giữa các khối khi có truy vấn khác hoặc phiên live tải nặng. Không nén (CPU BL335); mạng LAN.

**Rủi ro:** CSV thô nhóm 200 Tag × 500.000 dòng = hơn 1 GB file; giới hạn dòng không giới hạn byte; thêm giới hạn byte ≈ 512 MiB (422 `EXPORT_TOO_LARGE` tính theo `rows × cols × 12` ước) — ghi vào contract nếu đo cho thấy cần. Thời gian 24 giờ nhóm 50 Tag ≤ 15 s (SC-011): chưa đo.

## R9. Báo cáo: tính trên trình duyệt từ `aggregate`

**Quyết định:** máy chủ chỉ ghép bucket vào cửa sổ cố định (`bucketMs`, `offsetMs`) và trả các số nguyên thủy (`n, min, max, first, last, sumw, wms`); mọi hàm báo cáo (`avg, sum, delta, …`), dòng tổng, thiếu dữ liệu, định dạng nằm ở `packages/history-math` (TS thuần). Hàm suy ra `avg`/`sum` cũng có ở C++ (`agg_math`) cho `export.csv` tổng hợp và `aggregate`, kiểm bằng vector chung. Máy chủ không biết "ca" hay "tháng": ca là cửa sổ cố định có `offsetMs`, tháng là các cửa sổ ngày ghép ở trình duyệt.

**Vì sao ca đều (D14):** cửa sổ cố định + một `offsetMs` đủ; ca không đều cần ghép bucket phút hay nhiều yêu cầu, và chưa có nhu cầu.

**Múi giờ (D15):** `tz` cố định; `offsetMs = from mod bucketMs`. Bảng giờ dùng khi `bucketMs` và `offsetMs` là bội số của 3.600.000 (Việt Nam +07:00, mọi ca bắt đầu đúng giờ); độ lệch lẻ như +05:30 hoặc ca bắt đầu 06:30 dùng bảng phút (đắt hơn: tháng × 24 Tag ≤ 300.000 hàng, nếu vượt thì 422 và trang báo thu hẹp kỳ).

**Tại sao `delta` không phải "tổng":** "tổng" của bộ đếm điện năng tích lũy là `cuối − đầu`; "tổng" của công suất là tích phân (`sum`, kWh). Mẫu cho người dùng chọn đúng hàm theo loại Tag; nhãn hàm tiếng Việt giải thích ngắn trong Studio.

## R10. Thư viện XLSX và PDF trên trình duyệt (rà soát)

Quy tắc dự án (ADR-009, ADR-020): không thêm thư viện nếu tránh được; mọi thư viện phải rà license, tuổi (phát hành ≥ 14 ngày), kích thước, lỗ hổng. Chưa chạy `npm view` (cần mạng): task T005 ghi kết quả vào ADR-033; bảng dưới là giả thuyết cần xác nhận.

| Việc | Ứng viên | License (giả thuyết) | Kích thước (giả thuyết) | Nhận xét |
|---|---|---|---|---|
| ZIP cho XLSX | `fflate` | MIT | khoảng 8–30 KB nén gzip | không phụ thuộc; tự viết phần XML của XLSX (một sheet) |
| XLSX đủ tính năng | `exceljs`, SheetJS | MIT / Apache-2.0 | hàng trăm KB tới hơn 1 MB | quá nặng và rộng bề mặt tấn công cho một sheet; SheetJS bản npm cũ có lỗ hổng đã biết: loại |
| PDF | `pdfmake` | MIT | khoảng 0,5–1 MB nén gzip kèm phông Roboto | định nghĩa tài liệu khai báo (bảng, lặp tiêu đề, chia trang) — hợp báo cáo bảng; phông Roboto có chữ Việt |
| PDF | `jsPDF` (+ `jspdf-autotable`) | MIT | 200–400 KB | cần nhúng phông riêng cho tiếng Việt; từng có lỗ hổng ReDoS |
| PDF | `pdf-lib` + `fontkit` | MIT | 300 KB | không bảo trì từ lâu; phải tự dàn trang |
| PDF | in của trình duyệt (`window.print()` với CSS in) | không | 0 | chữ Việt đúng tuyệt đối, nhưng không có tệp để kiểm tự động và người dùng phải chọn "Lưu thành PDF" |

**Quyết định:** XLSX tự viết trên `fflate`; PDF dùng `pdfmake` tải lười. Nếu `pdfmake` không đạt (license, tuổi, kích thước nén > 1,2 MB, lỗi chữ Việt, lỗ hổng chưa vá) thì dùng `jsPDF` + phông Việt nhúng; nếu không có gì đạt thì dùng in của trình duyệt cho PDF và giữ XLSX/CSV (ghi vào ADR-033 là sai khác so với nghiệm thu). Phiên bản **phải** cố định trong `package.json` và ghi `third_party/LICENSES.md`.

**Kiểm chữ Việt:** test trích chữ từ PDF (bằng thư viện đọc PDF trong thư mục test, không đưa vào bản build) và so với từng ô; thử tay mở Acrobat/Chrome.

**Kích thước:** chunk PDF ≤ 1,2 MB gzip, chunk XLSX ≤ 60 KB gzip, cả hai chỉ tải khi bấm nút; kiểm tải khởi động ≤ 250 KB gzip (SC-024 của 007) bằng `web-it`.

## R11. Biểu đồ lịch sử trên uPlot

**Quyết định:** dùng lại uPlot (ADR-020) cho `history-trend`. Phóng/dịch tự viết bằng `hooks` của uPlot (`setSelect` cho kéo chọn, plugin `wheel` cho cuộn, `mousemove/mouseup` cho Shift+kéo), vì uPlot không có sẵn; mỗi lần khoảng đổi: `setScale` ngay (phản hồi tức thì với dữ liệu cũ) rồi gọi lại API sau 250 ms (R6: hàng đợi, hủy). Nét bậc thang `paths: uPlot.paths.stepped({align: 1})` cho nhóm `onChange`/`trigger`. Vùng min–max bằng `bands`. Khoảng đứt bằng `NaN` chèn tại `gaps`/`null` và `spanGaps: false`. Trục X theo giờ địa phương của nhóm: `axes[0].values` và `ticks` dùng `history-math.formatLocal` (uPlot có sẵn `tzDate`; không dùng vì không có múi giờ cố định theo chuỗi `±HH:MM`).

**Bộ nhớ:** một đường 2.000 điểm × 8 đường × 4 biểu đồ = 64.000 số; bộ nhớ đệm khoảng ≤ 32 mục: vài MB trong trình duyệt.

**Phương án khác:** Canvas tự viết — đã xét ở ADR-020; không đổi.

## R12. Ước tính ghi và đo thực

**Quyết định:** giữ công thức 003 và mở rộng (contracts/logging-config-0.2.md §5): cận trên theo khoảng ghi tối thiểu cho `onChange` và `trigger`, giảm bằng `expectedRowsPerDay` nếu người dùng biết (hoặc lấy từ số đo), cộng phần tổng hợp. Đo thực bằng `write_bytes` của `/proc/self/io` (rẻ, đúng tiến trình, không cần quyền). Studio so ước tính với số đo và có nút "Dùng số đo".

**Chặn mềm (D18):** Constitution VII bắt validator chỉ cảnh báo. Cách làm: cảnh báo kèm số; Studio hỏi xác nhận khi nạp xuống (không chặn lưu, xem trước, hay chạy); runtime không tự bỏ dữ liệu vì ghi quá. Bảo vệ thiết bị đã có từ 003 (trần dung lượng, ngưỡng đĩa trống). Thêm mức `W_LOG_WRITE_EXTREME` (> 4× ngân sách) cho xác nhận mạnh hơn.

**Sai số:** ước tính 003 dùng `2 × rowBytes` (WAL) và 3 trang mỗi commit; thực tế còn phụ thuộc kích thước trang, checkpoint và tần suất commit; SC-025 yêu cầu lệch ≤ 30 % với hồ sơ chuẩn, nếu không thì hiệu chỉnh hằng số (ghi ADR-034).

## R13. Studio: hai editor mới

**Quyết định:** dùng lại lưới ảo hóa (ADR-016), mô hình tài liệu `project-doc`, `props-*` của inspector, `expression-input` không cần. Khung ước tính là phần tử Lit thuần hiển thị dữ liệu từ `estimateLogging` (TS) — một hàm, đã có vector, nên không thể lệch với validator. Chặn mềm dùng hộp thoại `mat-dialog` có sẵn. Editor báo cáo dùng cùng `history-math` và mã xuất của trang runtime (đóng gói trong `packages/` để Studio và runtime-web chia sẻ, Constitution II): `packages/history-math` (tính toán, định dạng) và `packages/report-export` (CSV, XLSX, PDF; tải lười). Mockup HTML trước khi viết mã giao diện (T004).

## R14. Kiểm thử và dữ liệu thử

- **Bản tham chiếu độc lập:** `tools/history-ref/` (TS, đọc `history.db` bằng thư viện SQLite của Node hoặc xuất CSV từ `historian_tool`), tính bucket và báo cáo từ dòng thô bằng thuật toán chậm, đơn giản, viết riêng để so với runtime (SC-003, SC-015); không dùng mã của runtime hay `history-math` (tránh sai chung).
- **Dữ liệu:** mở rộng `historian_tool fill` (003) thành `fill-agg`: sinh dòng thô theo mô hình tất định (sin, ramp, bậc, bộ đếm, BOOL chạy theo ca, khoảng thiếu) kèm `mat_runs`, dựng được 31 ngày hoặc 7 ngày × 200 Tag nhanh (dựng thẳng SQLite bằng giao dịch lớn, không chờ thời gian thực); đồng hồ giả cho bộ cộng dồn.
- **kill100:** `tools/historian-it.ps1 -Scenario kill100` giết `mat-runtime` ngẫu nhiên 100 lần (khoảng chờ 1–12 s ngẫu nhiên có hạt giống ghi lại) khi đang ghi, tổng hợp, gửi bù và truy vấn; sau mỗi lần `integrity_check`, `--verify-aggregates`; tổng thời gian khoảng 25–40 phút trên x64.
- **Tải truy vấn:** `tools/load-tester` mở rộng (10 phiên live + N truy vấn đồng thời) để đo SC-006, SC-009; Chrome headless cho SC-012.
- **Cache nguội trên BL335:** `sync; echo 3 > /proc/sys/vm/drop_caches` cần root: task ⚠️🔌.

## R15. Nghiệm thu 7 ngày và 100 lần mất điện

- **7 ngày (D24):** dựng DB 7 ngày × 200 Tag cùng cấu hình bằng `fill-agg` (chạy trên x64, chép sang BL335 hoặc dựng ngay trên thiết bị) cho truy vấn và dung lượng; chạy thật ≥ 24 giờ để đo `write_bytes`, CPU, RSS; chạy thật 7 ngày liên tục là tùy chọn.
- **100 lần mất điện:** người cắt điện BL335 100 lần (ước tính 100 × (khởi động 40 s + chạy 60 s) ≈ 3–4 giờ nếu có relay điều khiển; nếu không có relay thì rất tốn công người). Đề xuất trong quickstart §11: relay/ổ cắm hẹn giờ do người dùng cung cấp; chưa có thì "chưa đo" và dùng kill -9 làm phần tự động.

## R16. Phiên bản và tương thích

Runtime 0.9.0 nhận project 0.1–0.6 (0.6 thêm `reportsFile`, `navigation[].report`), `logging.json` 0.1–0.2. API 1.4.0 chỉ thêm endpoint. `history.db` schema 2 mở được ở runtime 0.8 (bỏ qua bảng lạ); project mới không chạy ở runtime cũ (từ chối an toàn). Gói `.matscada` 1.0.0 không đổi. Danh mục widget 0.5.0 thêm widget: runtime cũ gặp widget lạ trong project mới báo lỗi kiểm tra (đã có cơ chế của 007). Studio 0.8.0 mở project cũ chỉ đọc cho tới khi nâng (như 006, 007).
