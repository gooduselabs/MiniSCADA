# ADR-008: Lưu trữ dữ liệu Tag trên thiết bị và chuyển tiếp sang DB ngoài

- **Trạng thái:** Accepted (feature 003, 2026-10-10), sửa đổi sau review cùng ngày (mục cuối). Số đo trên BL335 chưa có (cần người dùng cho phép deploy).
- **Ngày:** 2026-10-10
- **Liên quan:** [specs/003-data-logging](../../specs/003-data-logging/spec.md) (research R1–R16, contracts); Constitution III (ngân sách tài nguyên), V (an toàn mặc định), VII (phạm vi, LGPL); [ADR-005](005-resource-budget.md).

## Bối cảnh

Người dùng cần lưu giá trị Tag theo nhóm do họ cấu hình (theo chu kỳ hoặc theo thay đổi), tự xóa dữ liệu cũ theo số ngày, và tùy chọn ghi sang MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB của nhà máy. Bảng phải dạng rộng (mỗi Tag một cột) để báo cáo ca viết SQL đơn giản; giờ ở DB ngoài là giờ địa phương (mặc định UTC+7).

Ràng buộc của thiết bị: BL335 armhf, một phân vùng eMMC 6,8 GB, RAM nhỏ, RTC không chạy (đồng hồ có thể về 1970 sau mất điện). DB ngoài có thể mất kết nối hàng giờ. Báo cáo ca không chịu được dòng trùng (SUM sai).

## Các phương án

| Vấn đề | Phương án đã xét | Chọn |
|---|---|---|
| Lưu trên thiết bị | SQLite; file nhị phân tự viết; chỉ ghi DB ngoài | **SQLite 3.54 vendored**, WAL + `synchronous=NORMAL` (Constitution; riêng giao dịch xóa mốc gửi chạy `FULL`, ngoại lệ ở Constitution 1.1.1), một writer, bảng rộng `log_<table>` |
| Không trùng ở DB ngoài | con trỏ trên thiết bị; khóa duy nhất trên `time` + `INSERT IGNORE`/`MERGE`; con trỏ trong DB ngoài | **con trỏ `mat_forward_state` trong DB ngoài, cập nhật cùng giao dịch với lô** |
| Client DB | link trực tiếp; ODBC; tự viết giao thức; tiến trình riêng | **`dlopen` lúc chạy** MariaDB Connector/C, FreeTDS db-lib, libpq, libcurl; API tự khai báo |
| Bí mật | trong project (mã hóa); biến môi trường systemd; file trên thiết bị | **`/etc/mat-runtime/secrets.json`** (root:matscada 0640), nhập bằng `--set-secret` |
| Ngân sách ghi eMMC | chặn cấu hình vượt ngân sách; chỉ cảnh báo | **chỉ cảnh báo** `W_LOG_*` (người dùng chịu trách nhiệm cấu hình) |

## Quyết định

1. **Thiết bị:** thread `historian` lấy mẫu mỗi 100 ms, gom dòng và commit một giao dịch mỗi `historianCommitMs` (mặc định 5 s). Thời hạn lưu theo ngày, trần dung lượng (mặc định 2 GiB, xóa dòng cũ nhất tới dưới 90 %), ngưỡng trống tối thiểu (500 MiB, trễ 50 MiB). Không ghi và không dọn khi đồng hồ chưa hợp lệ (trước thời điểm build).
2. **Chuyển tiếp:** mỗi kết nối một thread, một kết nối SQLite chỉ đọc riêng. SQL: lô dòng và con trỏ trong một giao dịch, con trỏ đọc lại từ DB ngoài sau mỗi lần kết nối (commit không rõ cũng không trùng). InfluxDB: ít nhất một lần, con trỏ lưu trên thiết bị (`mat_forward`); gửi lại cùng điểm thì ghi đè. Lỗi: lùi 1, 2, 4 … 60 s (sai mật khẩu: 1, 2, 4, 5 phút); máy chủ từ chối một nhóm thì chỉ nhóm đó chờ, kết nối và các nhóm khác vẫn chạy. Gửi bù có nhịp (≥ 20 ms giữa các lô, ≤ 5.000 dòng/s, nghỉ ít nhất bằng thời gian CPU của lô, thread nice +10). Dòng bị xóa trên thiết bị trước khi gửi tới một đích đã nhận dữ liệu được đếm vào `lostRows`.
3. **Client:** runtime không link thư viện client nào; thiếu thư viện thì đích báo `no_client`, runtime vẫn chạy. Hằng số và chữ ký hàm tự khai báo được `client_api_check_test` so với header thật. Thư viện đi kèm (`clientLibDir`) chỉ được nạp từ thư mục thuộc root mà người khác không ghi được. SQL Server: FreeTDS 1.1.6 không đặt được mã hóa theo từng login, nên runtime sinh một `freetds.conf` riêng (biến `FREETDSCONF`, thư mục riêng tạo bằng `mkdtemp`, có `ca file` khi `verify-full`) cho các kết nối SQL Server.
4. **Bảo mật:** kết nối SQL mặc định `tls: verify-full` (kiểm chứng chỉ và tên máy theo kho CA của thiết bị; Constitution V); máy chủ chứng chỉ tự ký phải ghi rõ `require`/`prefer` và nhận cảnh báo `W_LOG_TLS_UNVERIFIED`. Project không chứa mật khẩu (validator báo `E_LOG_SECRET` trước schema); `system/info` (công khai) chỉ có mã phân loại lỗi, mã lỗi của DB và câu cố định; thông báo gốc của client chỉ vào journal.
5. **Validator hai bản** (TS cho Studio, C++ cho runtime) có 13 mã `E_LOG_*` và 3 mã `W_LOG_*` (`W_LOG_WRITE_BUDGET`, `W_LOG_SIZE_CAP`, `W_LOG_TLS_UNVERIFIED`), kiểm bằng bộ vector chung.

## Số đo / bằng chứng

Chi tiết trong [003-acceptance.md](../reports/003-acceptance.md):

- 4 loại DB thật (MySQL 8.4, SQL Server 2022, PostgreSQL 17, InfluxDB 2.7): 600 dòng, 10 kiểu Tag, khớp 100 % giá trị và giờ +07:00, 0,02–0,24 s (39/39 test tích hợp, gồm lô của phiên trước commit muộn không bị lưu hai lần, giá trị không vừa cột, nhóm bị từ chối không chặn nhóm khác, `verify-full` từ chối chứng chỉ tự ký, InfluxDB ghi một phần, câu trả lời quá lớn, hạn chờ của client PostgreSQL, database không phải UTF8, phiên MySQL luôn `utf8mb4`).
- Mất mạng tới DB rồi có lại: gửi bù 1.800 dòng trong 0,21–0,71 s; kill -9 tiến trình gửi 3 lần giữa 20.000 dòng: 0 trùng, 0 thiếu, cả 4 DB.
- 10 lần kill -9 lúc đang ghi SQLite: `integrity_check` luôn `ok`.
- Thời hạn lưu xóa hết dòng quá hạn; trần 64 MiB giữ file ở 60,36 MB; trong lúc dọn, client live không gián đoạn quá 253 ms.
- Số trên là lần chạy lại sau hai vòng review (2026-10-10).

## Hệ quả

- **Tốt:** dữ liệu không mất khi DB ngoài tắt; không trùng dòng ở SQL; thiết bị không phụ thuộc gói client; cấu hình sai được báo ngay ở Studio.
- **Xấu:** DB ngoài có thêm bảng `mat_forward_state` (quản trị DB cần biết, đã ghi trong contract); tài khoản ghi cần quyền tạo bảng hoặc quản trị phải tạo sẵn bảng; mỗi kết nối thêm một thread; thông báo gốc của client (có tên user, địa chỉ) nằm trong journal, đọc được bởi root và nhóm `adm`, `systemd-journal`; mất điện có thể mất vài giao dịch cuối trên thiết bị (đã gửi rồi thì vẫn nằm ở DB ngoài).

## Điều kiện xem xét lại

- Đo trên BL335 cho thấy client DB làm runtime crash hoặc vượt ngân sách RAM/CPU (khi đó tách tiến trình `mat-forwarder`).
- Cần truy vấn lịch sử từ trình duyệt (biểu đồ, báo cáo): thêm API đọc, chỉ mục phù hợp.
- Nhiều nhà máy cần tin một CA riêng cho từng kết nối thay vì đưa CA vào kho chung của thiết bị: thêm trường file CA cho kết nối.

## Sửa đổi sau review code và review bảo mật (2026-10-10)

Chi tiết từng mục: [003-acceptance.md §6](../reports/003-acceptance.md).

- **Mốc khi mở file, giữ trong `history.db`** (review C1 và review lần hai): với `synchronous=NORMAL`, giao dịch đã commit có thể mất khi mất điện, trong khi forwarder đã gửi các dòng đó; sau khởi động, thiết bị cấp lại cùng `seq` cho dòng mới và đích SQL bỏ qua chúng. Historian trao cho forwarder `seq` lớn nhất của mỗi bảng lúc mở file; ở lần chuẩn bị đầu tiên, con trỏ của đích lớn hơn mốc đó được hạ về mốc. Mốc của đích SQL nằm trong `mat_forward_mark` cho tới khi được kiểm, nên một lần khởi động lại trước khi tới được đích không làm mất mốc. Giao dịch xóa mốc là giao dịch duy nhất chạy với `synchronous=FULL` (mỗi đích và bảng một lần sau mỗi lần khởi động), để mất điện không làm mốc quay lại sau khi dòng đã vượt nó. Người dùng chấp thuận ngoại lệ này ngày 2026-10-10; Constitution 1.1.1 ghi lại. Dùng `synchronous=FULL` cho mọi giao dịch đã cân nhắc nhưng không chọn: mòn eMMC mà không cần. Con trỏ trên thiết bị ghi cùng giao dịch với dòng (không thêm lần ghi eMMC riêng).
- **Cô lập lỗi theo nhóm** (review I1): trước đây một nhóm bị từ chối chặn mọi nhóm của kết nối và làm đăng nhập lại mỗi giây.
- **Giá trị không vừa cột thành `NULL`**, chuỗi cắt theo cột (SQL Server tính UTF-16); InfluxDB ghi một phần (HTTP 422) coi là đã gửi; chuỗi Tag sửa UTF-8 ngay khi vào `TagStore` (review I2, I3, M1).
- **File hỏng phát hiện lúc commit** được đổi tên và thay bằng file mới có instance id mới; con trỏ mang instance id để không ghi nhầm sang file mới (review I4, I6).
- **TLS:** SQL Server nhận `verify-full`; validator cảnh báo kết nối không xác thực máy chủ (review bảo mật M2). Sau một phiên TLS thành công, `prefer` không còn hạ xuống kết nối không mã hóa (MySQL, PostgreSQL).
- **Review vòng ba (2026-10-11), các bản sửa của vòng hai:**
  - Con trỏ SQL chỉ dời từ giá trị forwarder đã đọc (so rồi ghi, trước khi chèn dòng). Client bỏ cuộc ở hạn chờ trong khi máy chủ commit muộn không còn gây lưu trùng; kiểm bằng giao dịch muộn thật đang giữ khóa ở MySQL, SQL Server và PostgreSQL.
  - Mốc C1 không ghi được lúc khởi động thì nhóm SQL chờ, không bỏ qua bước kiểm.
  - PostgreSQL: trả lời COPY đóng phiên thay vì quay CPU mãi; gửi không chặn dưới hạn chờ.
  - InfluxDB 3 qua API v2: một dòng sai kiểu làm cả lô bị từ chối, nên đích báo lỗi và giữ dữ liệu trên thiết bị (kiểm với 3 Core 3.12).
- **Mặc định `tls` của kết nối SQL là `verify-full`** (người dùng giao quyết định ngày 2026-10-10; Constitution V: an toàn mặc định). Feature chưa triển khai ở đâu nên không có project nào phải sửa. Chứng chỉ bị từ chối hiện `tls` ở cả ba loại DB; với SQL Server, FreeTDS báo giống mất kết nối (db-lib 20002), nên khi đã đòi TLS runtime đổi thành `tls`.
- **Máy chủ không đáng tin không làm treo hay hết RAM thiết bị:** PostgreSQL chạy bất đồng bộ với hạn chờ của client; mọi câu trả lời giới hạn 100.000 dòng và 16 MiB; database PostgreSQL phải là `UTF8`; phiên MySQL luôn là `utf8mb4`.

