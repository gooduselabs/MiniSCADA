# Research — 003 Lưu trữ dữ liệu Tag

Phase 0 của [plan.md](plan.md). Mỗi mục gồm: **Quyết định**, **Lý do**, **Phương án đã loại**. Phiên bản thư viện client lấy từ spike chạy trong container `ubuntu:20.04`, cùng bản OS với BL335 (ngày 2026-10-10):

| Client | Gói Ubuntu 20.04 | Thư viện (soname) | Phụ thuộc đáng chú ý |
|---|---|---|---|
| MySQL/MariaDB | `libmariadb3` 10.3.39 (Connector/C 3.1.21) | `libmariadb.so.3` | GnuTLS, zlib |
| SQL Server | `libsybdb5` 1.1.6 (FreeTDS db-lib) | `libsybdb.so.5` | GnuTLS, Kerberos |
| PostgreSQL | `libpq5` 12.22 | `libpq.so.5` | OpenSSL, Kerberos, LDAP, SASL |
| InfluxDB (HTTP) | `libcurl4` 7.68.0 (bản OpenSSL) | `libcurl.so.4` | OpenSSL, nghttp2, libssh, librtmp, … |

## R1. Lưu trữ trên thiết bị: SQLite 3.54.0 vendored

- **Quyết định:**
  - Vendor bản amalgamation SQLite 3.54.0 (`sqlite3.c`, `sqlite3.h`, public domain) vào `third_party/sqlite`, build static trong `mat_core`. SHA3-256 của zip theo trang tải: `7b670a62…2d93`.
  - Tùy chọn build theo khuyến nghị của sqlite.org: `SQLITE_DQS=0`, `SQLITE_DEFAULT_MEMSTATUS=0`, `SQLITE_LIKE_DOESNT_MATCH_BLOBS`, `SQLITE_OMIT_DEPRECATED`, `SQLITE_OMIT_SHARED_CACHE`, `SQLITE_OMIT_LOAD_EXTENSION` (không nạp extension: an toàn, và không phát sinh `dlopen` ngoài ý muốn), `SQLITE_THREADSAFE=1`.
- **Lý do:**
  - Constitution chọn SQLite (WAL, `synchronous=NORMAL`).
  - Bản trên BL335 (3.31.1) cũ và phụ thuộc OS. Bản vendored cho cùng hành vi trên x64, armhf và Buildroot sau này.
  - License public domain, không có ràng buộc.
- **Phương án đã loại:**
  - `libsqlite3` của hệ thống: phụ thuộc phiên bản OS, khó tái lập.
  - LMDB, RocksDB: không có SQL để xuất CSV/kiểm dữ liệu, footprint lớn hơn.
  - File CSV xoay vòng: không có giao dịch, khó gửi bù chính xác.

## R2. Bố cục dữ liệu trên thiết bị

- **Quyết định:**
  - Một file `history.db` trong `dataDir` (mặc định `/var/lib/mat-runtime`).
  - Mỗi nhóm một bảng rộng `log_<table>` gồm các cột:
    - `seq INTEGER PRIMARY KEY AUTOINCREMENT`;
    - `ts INTEGER NOT NULL` (UTC, ms);
    - mỗi Tag một cột: BOOL và số nguyên → `INTEGER`, số thực → `REAL`, chuỗi → `TEXT`; UINT64 > 2^63−1 lưu `TEXT` thập phân.
  - Chỉ mục trên `ts`.
  - Bảng phụ:
    - `mat_meta(key, value)`: `instance_id` (UUID ngẫu nhiên tạo khi tạo file), `schema` = `1`;
    - `mat_tables(name, group_id, retention_days, created_ms, updated_ms)`: mọi bảng đã từng tạo, kể cả của nhóm đã bỏ, cùng thời hạn lưu cuối cùng đã biết;
    - `mat_forward(dest, tbl, last_seq)`: con trỏ gửi của đích không có giao dịch (InfluxDB) và bản sao con trỏ của đích SQL để báo trạng thái.
- **Lý do:**
  - Người dùng chọn bảng rộng.
  - `AUTOINCREMENT` bảo đảm `seq` không bao giờ dùng lại, kể cả khi thời hạn lưu xóa hết dòng. Con trỏ gửi (số `seq`) vì vậy luôn đúng.
  - Không có cột nhóm nên mỗi dòng nhỏ: 500 Tag số khoảng 4,5 KB/dòng, so với khoảng 25 KB nếu lưu dạng hẹp.
- **Phương án đã loại:**
  - Bảng hẹp `(tag, ts, value)`: ghi gấp khoảng 5 lần cho cùng dữ liệu, trái lựa chọn của người dùng.
  - Lưu cả dòng dạng JSON/BLOB: không xuất/kiểm bằng SQL được, phải giải mã khi gửi.
  - Rowid không `AUTOINCREMENT`: `seq` có thể quay về 1 sau khi xóa hết → gửi bù sai.

## R3. Ghi gom và độ bền khi mất điện

- **Quyết định:**
  - Thread historian là **thread duy nhất ghi** SQLite. Dòng đợi trong RAM rồi được ghi trong **một giao dịch mỗi `historianCommitMs`** (mặc định 5000, giới hạn 1000–60000), hoặc sớm hơn khi đệm đạt 5000 dòng.
  - PRAGMA: `journal_mode=WAL`, `synchronous=NORMAL` (Constitution), `busy_timeout=5000`, `cache_size=-8192` (8 MB), `temp_store=MEMORY`, `journal_size_limit=67108864`; `auto_vacuum=NONE`.
  - Các thread gửi mở kết nối **chỉ đọc**; mỗi lần đọc là một giao dịch ngắn.
- **Lý do:**
  - WAL với `NORMAL` không làm hỏng DB khi mất điện; chỉ mất các giao dịch cuối chưa checkpoint, nằm trong khoảng gom ghi (FR-011, SC-008).
  - Gom 5 s giảm số trang 4 KB phải ghi. Ghi mỗi dòng một giao dịch sẽ tốn ≥ 4 KB × 86.400 = 350 MB/ngày chỉ riêng phần đệm trang.
  - Một thread ghi nên không tranh khóa ghi.
  - Cache 8 MB nằm trong ngân sách 32 MB (Constitution III).
- **Phương án đã loại:**
  - `synchronous=FULL`: fsync mỗi giao dịch, mòn eMMC hơn mà không cần thiết với WAL.
  - Gom 1 s: gấp 5 lần lượng ghi trang.
  - Mỗi thread gửi tự ghi con trỏ vào SQLite: nhiều thread ghi, tranh khóa → chuyển con trỏ qua thread historian (R8).
- **Ghi chú review (2026-10-10, C1):** với `NORMAL`, giao dịch đã commit có thể mất khi mất điện. Forwarder gửi dòng ngay sau commit, nên DB ngoài có thể đã giữ seq 1001–1005 trong khi thiết bị, sau khi khởi động lại, cấp lại đúng các seq đó cho dòng mới; con trỏ của đích làm các dòng mới bị bỏ qua mà không ai biết. Cách xử lý:
  - **Mốc khi mở file:** trước commit đầu tiên, historian đọc `seq` lớn nhất từng cấp của mỗi bảng (`sqlite_sequence`) và trao cho forwarder. Ở lần chuẩn bị đầu tiên của mỗi nhóm, trước khi forwarder gửi gì, con trỏ của đích lớn hơn mốc đó chỉ có thể do thiết bị đã mất dòng (mất điện, hoặc chép lại một bản `history.db` cũ): forwarder ghi log, hạ con trỏ của đích về mốc bằng một giao dịch chỉ-con-trỏ, rồi gửi các dòng từ mốc trở đi, kể cả dòng historian đã ghi trong lúc đích vắng mặt. Sau đó không kiểm lại: dòng forwarder gửi đã đẩy con trỏ qua mốc một cách hợp lệ. So với `seq` lớn nhất *hiện tại* thì sai: historian có thể đã cấp lại vài `seq` trước khi đích có lại kết nối, và các dòng đó bị bỏ qua.
  - **Mốc được giữ trong `history.db`** (bảng `mat_forward_mark`, review lần hai): với đích SQL, mốc được ghi khi mở file nếu chưa có, và chỉ xóa sau khi forwarder đã so con trỏ của đích với nó. Nếu runtime khởi động lại trước khi tới được đích (đích còn tắt sau đợt mất điện, hoặc vừa deploy), mốc cũ (nhỏ hơn) vẫn còn, nên dòng ghi trong các lần chạy trước vẫn được gửi.
  - **Giao dịch xóa mốc chạy với `synchronous=FULL`**, và là giao dịch duy nhất như vậy: mỗi đích và bảng một lần sau mỗi lần khởi động. Nhóm chỉ gửi sau khi việc xóa đã nằm trên eMMC, để một đợt mất điện không làm mốc quay lại sau khi dòng đã vượt qua nó (khi đó con trỏ bị hạ nhầm, dòng bị gửi trùng). Mọi giao dịch khác giữ `NORMAL` theo Constitution.
  - **Ghi mốc lỗi lúc khởi động** (đĩa đầy, lỗi I/O, khóa; review vòng ba): nhóm của đích SQL chờ, không gửi và không đụng con trỏ (trạng thái `error`/`sql`). Historian thử lại với thời gian chờ tăng dần, dùng đúng `seq` đọc lúc mở file, nên mốc lưu muộn vẫn là mốc của lần khởi động đó; mốc cũ hơn đã có trong file được giữ. Xóa mốc lỗi cũng thử lại với thời gian chờ tăng dần (từ `retryMs` tới 60 s), không ghi journal mỗi 100 ms.
  - Dòng đã gửi rồi mất trên thiết bị vẫn nằm ở đích (dữ liệu thật). Dòng mới cùng `seq` có thời điểm khác, nên không thành bản trùng.
  - Đã cân nhắc `synchronous=FULL` (commit trả về khi WAL đã nằm trên eMMC, thêm một fsync mỗi lần commit): Constitution quy định `NORMAL`, và lớp bảo vệ trên đã đủ cho C1. Chỉ giao dịch xóa mốc được ngoại lệ (người dùng chấp thuận ngày 2026-10-10, Constitution 1.1.1).
  - Con trỏ gửi đi của InfluxDB (và bản sao của con trỏ SQL) ghi **cùng giao dịch** với dòng của lần commit kế tiếp; khi không có dòng mới thì ghi riêng, tối đa mỗi phút một lần (review S8).

## R4. Thời hạn lưu, trần dung lượng, ngưỡng trống

- **Quyết định:**
  - **Thời hạn lưu:** lúc khởi động và mỗi giờ, với mỗi bảng trong `mat_tables` (kể cả bảng mồ côi):

    ```sql
    DELETE FROM t WHERE rowid IN (SELECT rowid FROM t WHERE ts < :cutoff LIMIT 2000)
    ```

    Mỗi lô là một giao dịch. Các lô xen giữa các lượt lấy mẫu, mỗi lượt ≤ 20 ms việc dọn, nên không chặn quá 1 s (FR-014, SC-006).
  - **Trần dung lượng** (`historianMaxDbMB`, mặc định 2048):
    - kiểm mỗi phút bằng `(page_count − freelist_count) × page_size`;
    - vượt trần thì xóa lô dòng cũ nhất trên mọi bảng (bảng có `min(ts)` nhỏ nhất trước) tới khi < 90 % trần;
    - đếm `capPurges` và `capRowsDeleted`.
  - **Ngưỡng trống** (`historianMinFreeMB`, mặc định 500): `statvfs` mỗi phút; dưới ngưỡng thì trạng thái `paused_low_disk` và không ghi; trên ngưỡng + 50 MB thì ghi tiếp (trễ để không dao động).
  - Trang trống sau khi xóa được SQLite dùng lại nên file không phình. Không chạy `VACUUM` tự động (ghi lại toàn file).
- **Lý do:** đúng FR-014/015/016. Đo bằng trang đang dùng nên không tính trang trống.
- **Phương án đã loại:**
  - `auto_vacuum=INCREMENTAL`: thu nhỏ file nhưng di chuyển trang (ghi thêm), không cần khi đã có trần.
  - Xóa theo `ts` không giới hạn lô: một lần xóa lớn giữ khóa ghi lâu.

## R5. Đồng hồ và giờ địa phương

- **Quyết định:**
  - **Mốc hợp lệ:** đồng hồ hợp lệ khi `now ≥ MAT_BUILD_EPOCH` (thời điểm cấu hình CMake, UTC). Trước mốc thì không ghi, trạng thái `clock_invalid` (FR-010). Lý do: RTC BL335 không đọc được, sau mất điện giờ có thể lùi.
  - **Không dò trạng thái đồng bộ NTP** (`adjtimex`): systemd `SystemCallFilter=@system-service` chặn nhóm `@clock`.
  - **Giờ địa phương:** độ lệch cố định dạng `±HH:MM`:
    - `timeZone` ở gốc `logging.json`, mặc định `+07:00`, dùng để căn chu kỳ và xuất CSV;
    - mỗi kết nối có thể đặt `timeZone` riêng cho cột thời gian ở DB ngoài.
  - **Căn chu kỳ:** chu kỳ chia hết 86.400.000 ms thì căn theo bội số chu kỳ tính từ 00:00 giờ địa phương; chu kỳ khác thì căn theo bội số tính từ lúc nhóm bắt đầu.
  - **Nhảy giờ:** mỗi nhóm ghi tối đa 1 dòng mỗi lượt.
    - Nhảy tới quá 2 chu kỳ: ghi một dòng rồi tính mốc tiếp theo từ giờ mới, không ghi bù.
    - Nhảy lùi quá 2 chu kỳ: tính lại mốc từ giờ mới.

    Mỗi lần nhảy tăng `clockJumps`.
- **Lý do:** Việt Nam không đổi giờ mùa hè; dùng độ lệch cố định thì không cần tzdata và cho kết quả giống nhau giữa TS và C++.
- **Phương án đã loại:**
  - Múi giờ IANA (`Asia/Ho_Chi_Minh`): cần tzdata trên thiết bị và trong trình duyệt; DST không cần ở đợt này.
  - Chờ NTP đồng bộ mới ghi: trạm không có NTP sẽ không bao giờ ghi.

## R6. Quyết định ghi (sampler)

- **Quyết định:**
  - Thread historian chạy mỗi **100 ms**. Hàm quyết định là **hàm thuần**, test không cần thread.
  - Giá trị đọc từ `TagStore` qua hàm mới `snapshot(indices, out)`: một lần khóa cho cả nhóm, kèm `revision`.
  - **Theo chu kỳ:** tới mốc thì ghi một dòng.
  - **Theo thay đổi:**
    - Với Tag có `revision` đổi kể từ dòng trước, "đổi" nghĩa là: lớp chất lượng đổi (GOOD ↔ không GOOD); hoặc số có `|v − v_đã_ghi| > deadband`; hoặc BOOL/chuỗi khác giá trị.
    - Có đổi và đã qua `minIntervalMs` thì ghi ngay. Chưa qua thì đánh dấu chờ và ghi ngay khi đủ khoảng, bằng giá trị mới nhất.
    - Có `maxIntervalMs` thì ghi định kỳ dù không đổi.
    - Nhóm theo thay đổi ghi một dòng gốc ngay khi bắt đầu.
  - **Giá trị ô:** chất lượng khác GOOD, NaN hoặc vô cực → rỗng (NULL). Chuỗi dài hơn `maxLength` (mặc định 255 ký tự Unicode) bị cắt đúng ranh giới ký tự UTF-8 và tăng `stringsTruncated`.
- **Lý do:**
  - Tick 100 ms cho độ lệch ≤ 100 ms cộng thời gian xử lý, đạt SC-002 (± 250 ms).
  - Dùng `revision` thì không phải so mọi Tag mỗi lượt.
  - Không dùng `takeDirty()` của `TagStore`: hàm này thuộc về LiveHub, gọi sẽ lấy mất dữ liệu của client.
- **Phương án đã loại:**
  - Observer trong `TagStore::set()`: gọi chéo thread lúc driver ghi, khó kiểm thời gian.
  - Chu kỳ ghi bám theo chu kỳ quét driver: driver chưa có.

## R7. Client DB ngoài: nạp động, API tự khai báo

> **Ghi chú review bảo mật (2026-10-10):** thư viện đi kèm trong `clientLibDir` chỉ được nạp khi file thật (sau khi theo symlink) và **mọi thư mục phía trên nó** đều thuộc root, nhóm và người khác không ghi được. Không đạt thì bỏ qua (ghi journal) và dùng thư viện của hệ thống.

- **Quyết định:**
  - Runtime **không link** thư viện client. Lần đầu cần một loại DB, runtime `dlopen` lần lượt `${clientLibDir}/<soname>` (mặc định `/opt/mat-runtime/lib`, cho bản kèm gói sau này) rồi tới tên soname qua bộ nạp hệ thống:
    - `libmariadb.so.3` cho MySQL/MariaDB;
    - `libsybdb.so.5` cho SQL Server;
    - `libpq.so.5` cho PostgreSQL;
    - `libcurl.so.4` cho InfluxDB.
  - Thiếu thư viện hoặc thiếu hàm thì đích báo `no_client` (FR-022). Đã nạp thì không `dlclose`.
  - **Khai báo API tối thiểu** (struct opaque, con trỏ hàm, hằng số) trong `core/historian/forward/*_api.hpp`. Bản build armhf vì vậy không cần gói `-dev`.
  - Test x64 `client_api_check_test` include header thật (gói `-dev` trong image toolchain) và `static_assert` từng hằng số và kiểu hàm khớp. Ví dụ: `MYSQL_OPT_CONNECT_TIMEOUT`, `MYSQL_OPT_SSL_ENFORCE`, `DBSETENCRYPT = 12`, `DBVERSION_74 = 8`, `CURLOPT_*`.
  - **Khởi tạo toàn cục** đúng một lần, dưới mutex: `mysql_server_init` (`mysql_library_init` là macro của hàm này), `dbinit`, `curl_global_init`.
  - **SQL Server:** dùng db-lib của FreeTDS, mở bằng `dbopen(login, "host:port")`. Cú pháp `host:port` được tác giả FreeTDS xác nhận trên mailing list ([2016](https://lists.ibiblio.org/sympa/arc/freetds/2016-04/msg00092.html), [2008](https://lists.ibiblio.org/sympa/arc/freetds/2008-11/msg00065.html)) nhưng không có trong tài liệu chính thức. **Phải kiểm bằng test tích hợp**; nếu không chạy thì đặt `TDSPORT` cho riêng kết nối qua `freetds.conf` tạm.
- **Lý do:**
  - Runtime chạy được khi thiết bị không có thư viện (FR-030).
  - LGPL (MariaDB C, FreeTDS) chỉ được nạp động (Constitution VII).
  - Không phải cài 4 bộ `-dev` armhf (multiarch) vào image build chéo.
  - Microsoft không có driver ODBC cho ARM 32-bit, nên FreeTDS là lựa chọn duy nhất cho SQL Server trên armhf.
- **Phương án đã loại:**
  - Link trực tiếp: thiếu một thư viện là runtime không khởi động được.
  - ODBC (unixODBC + 3 driver): thêm một tầng và ba gói driver.
  - Tự viết giao thức MySQL/TDS: TDS có TLS lồng trong gói, nhiều rủi ro.
  - Tách tiến trình `mat-forwarder` riêng: cô lập lỗi tốt hơn nhưng thêm unit systemd, cấu hình và deploy. Để dành khi đo thấy client làm runtime crash.

## R8. Chính xác một lần (exactly-once)

- **Quyết định:**
  - **MySQL/MariaDB, SQL Server, PostgreSQL:** con trỏ gửi nằm **trong DB ngoài**, bảng `mat_forward_state`:

    | Cột | Kiểu |
    |---|---|
    | `source_id` | VARCHAR(64), = `instance_id` của `history.db` |
    | `table_name` | VARCHAR(64) |
    | `last_seq` | BIGINT |
    | `updated_at` | thời điểm |

    Khóa chính `(source_id, table_name)`. Mỗi lô (`INSERT` nhiều dòng) và cập nhật con trỏ nằm **trong cùng một giao dịch**. Sau khi kết nối (lại), runtime đọc con trỏ từ DB ngoài. Kết quả: commit không rõ (mất kết nối sau `COMMIT`) không gây trùng hay thiếu.
  - Cập nhật con trỏ:
    - MySQL và SQL Server: `UPDATE …` rồi `INSERT` nếu không khớp dòng nào. MySQL đặt cờ `CLIENT_FOUND_ROWS`; SQL Server dùng `SET XACT_ABORT ON` trong cùng batch.
    - PostgreSQL: `INSERT … ON CONFLICT … DO UPDATE`.
  - **Ghi chú review vòng ba (2026-10-11): con trỏ chỉ dời từ giá trị forwarder đã đọc.** Commit "không rõ" còn một dạng nữa: client bỏ cuộc ở hạn chờ trong khi máy chủ vẫn chạy giao dịch (chờ khóa do quản trị DB đang `ALTER`/`VACUUM FULL`, chờ bản sao đồng bộ) rồi commit muộn. Lần kết nối lại đọc con trỏ cũ, vì giao dịch kia chưa commit. Nếu cập nhật con trỏ vô điều kiện thì lô gửi lại chờ khóa của nó rồi cũng commit: lưu hai lần. Nay mỗi lô làm "so rồi ghi" trước khi chèn dòng:
    - `UPDATE … SET last_seq = mới … WHERE … AND last_seq = cũ`. Không khớp dòng nào mà dòng con trỏ đã có giá trị khác thì dừng cả lô, không lưu gì. Chưa có dòng thì `INSERT`; khóa chính chặn lần chèn thứ hai.
    - SQL Server: `IF @@ROWCOUNT = 0` + `EXISTS … WITH (UPDLOCK, HOLDLOCK)` + `THROW 51000` trong cùng batch.
    - PostgreSQL: khối `DO` (plpgsql) với `RAISE … USING ERRCODE = '40001'`. Dấu `$…$` được chọn sao cho không xuất hiện trong thân lệnh.
    - MySQL: từng câu; `CLIENT_FOUND_ROWS` = 0 thì `SELECT … FOR UPDATE`.
    - Lỗi này là lỗi câu lệnh (`sql`): nhóm chờ nhịp lùi, đọc lại con trỏ rồi gửi tiếp từ đó. Kiểm bằng giao dịch muộn thật đang giữ khóa ở cả ba DB.
    - Không dùng `PQcancel`: với libpq 12 (Ubuntu 20.04), lệnh này mở kết nối chặn tới hết thời gian kết nối TCP của hệ thống, trong khi so-rồi-ghi đã đủ để không trùng.
  - **InfluxDB:** gửi ít nhất một lần, con trỏ lưu ở `mat_forward` trên thiết bị. Gửi lại cùng điểm (cùng measurement, tag set, thời điểm) thì ghi đè, nên không tạo bản trùng.
  - **Mất dòng:** con trỏ + 1 < `min(seq)` hiện có thì dòng đã bị xóa trước khi gửi. Runtime tăng `lostRows` thêm `min(seq) − con_trỏ − 1` rồi đẩy con trỏ lên (FR-021).
- **Lý do:** báo cáo ca không chịu được dòng trùng (SUM sai). Lưu con trỏ cạnh dữ liệu là cách duy nhất để ghi dữ liệu và ghi con trỏ thành một thao tác nguyên tử.
- **Phương án đã loại:**
  - Con trỏ trên thiết bị cho SQL: crash giữa commit ngoài và ghi con trỏ thì trùng một lô.
  - Khóa duy nhất trên `time` + `INSERT IGNORE`/`MERGE`: cú pháp khác nhau ở từng DB, và hai dòng có thể cùng thời điểm khi đồng hồ lùi.

## R9. Lược đồ ở DB ngoài

- **Quyết định:**
  - Bảng `<table>` (cùng tên trong mọi đích) gồm cột `id` tự tăng làm khóa chính, `time` (giờ địa phương của kết nối, ms), rồi mỗi Tag một cột. Có chỉ mục trên `time`. MySQL dùng `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`.
  - Kiểu cột theo từng DB:

    | Tag | MySQL/MariaDB | SQL Server | PostgreSQL |
    |---|---|---|---|
    | BOOL | TINYINT(1) | BIT | BOOLEAN |
    | INT16 | SMALLINT | SMALLINT | SMALLINT |
    | UINT16, INT32 | INT | INT | INTEGER |
    | UINT32, INT64 | BIGINT | BIGINT | BIGINT |
    | UINT64 | DECIMAL(20,0) | DECIMAL(20,0) | NUMERIC(20,0) |
    | FLOAT32 | FLOAT | REAL | REAL |
    | FLOAT64 | DOUBLE | FLOAT(53) | DOUBLE PRECISION |
    | STRING(n) | TEXT (giới hạn dòng 65.535 byte của InnoDB, xem contract) | NVARCHAR(n) | VARCHAR(n) |
    | thời gian | DATETIME(3) | DATETIME2(3) | TIMESTAMP(3) |

  - Tên cột theo cấu hình, giữ chữ hoa/thường ở MySQL và SQL Server. PostgreSQL dùng chữ thường để truy vấn không cần ngoặc kép; validator bảo đảm không trùng khi bỏ qua hoa/thường.
  - Khi (re)connect hoặc cấu hình đổi: tạo bảng nếu chưa có (`CREATE TABLE IF NOT EXISTS`; SQL Server dùng `IF OBJECT_ID(…) IS NULL`), đọc danh sách cột từ `information_schema` / `sys.columns`, `ALTER TABLE … ADD` cột thiếu. Không bao giờ xóa hay đổi kiểu cột (FR-018). Cột có sẵn sai kiểu thì `schema_mismatch` khi `INSERT` lỗi.
  - **Giá trị trong câu lệnh:**
    - số nguyên dạng thập phân; số thực dạng ngắn nhất đọc lại đúng giá trị (tối đa 17 chữ số; FLOAT32 theo độ chính xác float, tối đa 9); BOOL `1/0`, PostgreSQL `TRUE/FALSE`; rỗng → `NULL`;
    - chuỗi: MySQL qua `mysql_real_escape_string` (theo kết nối), SQL Server `N'…'` nhân đôi dấu nháy, PostgreSQL qua `PQescapeLiteral`;
    - thời gian: `'YYYY-MM-DD HH:MM:SS.mmm'`; SQL Server dùng `'YYYY-MM-DDTHH:MM:SS.mmm'` để không phụ thuộc `DATEFORMAT`.
  - **Kích thước lô:** `min(500, max(1, 200000 / số_cột))` dòng, thêm giới hạn khoảng 4 MiB theo ước tính byte (chuỗi `maxLength` × 4); mỗi câu `INSERT` tối đa 1 MiB, nhiều câu trong cùng giao dịch. SQL Server giới hạn 1000 dòng mỗi `VALUES`. (Ghi chú khi làm: chỉ giới hạn theo số ô thì nhóm 200 chuỗi 4000 ký tự cho lô khoảng 400 MB.)
  - **InfluxDB:** `POST {url}/api/v2/write?org=…&bucket=…&precision=ms`, header `Authorization: Token …`, thành công khi trả 204.
    - Measurement là tên bảng, tag set `source=<instance_id>`.
    - Trường: BOOL → `true/false`; số nguyên có hậu tố `i`; UINT64 có hậu tố `u`; số thực không hậu tố; chuỗi đặt trong nháy kép, escape `\` và `"`.
    - Ô rỗng thì bỏ trường; dòng không còn trường nào thì bỏ dòng. Mỗi lần gửi tối đa 5000 dòng hoặc 1 MB.
    - Áp dụng cho InfluxDB 2.x và 3.x (API v2).
- **Lý do:** kiểu giữ đủ độ chính xác (UINT64 dùng DECIMAL); không cần chuỗi định dạng ngày theo locale.
- **Phương án đã loại:**
  - Prepared statement cho từng loại DB: FreeTDS db-lib không có tham số, bốn API khác nhau. Escape bằng hàm của chính client cho kết quả an toàn tương đương với số dòng mỗi lô lớn.
  - InfluxDB 1.x: hết hỗ trợ, hậu tố `u` không bật mặc định.

## R10. Mã hóa đường truyền (TLS)

- **Quyết định:** trường `tls` của mỗi kết nối nhận `disable`, `prefer`, `require` (mã hóa, không kiểm chứng chỉ) hoặc `verify-full` (mã hóa, kiểm chứng chỉ theo CA hệ thống và tên máy; **mặc định với SQL** từ 2026-10-10, xem ghi chú cuối mục).

  | Mức | MySQL/MariaDB | SQL Server (FreeTDS) | PostgreSQL | InfluxDB (libcurl) |
  |---|---|---|---|---|
  | `disable` | không bật TLS | `encryption = off` | `sslmode=disable` | URL phải là `http://` |
  | `prefer` | thử bật TLS bắt buộc trước; lỗi do máy chủ không có TLS thì kết nối lại không TLS (**kiểm bằng test tích hợp**) | `encryption = request` | `sslmode=prefer` | không dùng |
  | `require` | `MYSQL_OPT_SSL_ENFORCE` | `encryption = require` (mục freetds.conf do runtime sinh, xem ghi chú) | `sslmode=require` | `https://`, tắt `VERIFYPEER`/`VERIFYHOST` |
  | `verify-full` | cộng thêm `MYSQL_OPT_SSL_VERIFY_SERVER_CERT` | `encryption = require` + `ca file = /etc/ssl/certs/ca-certificates.crt` trong mục freetds.conf: FreeTDS kiểm chứng chỉ và tên máy (xem ghi chú review) | `sslmode=verify-full`, `sslrootcert=/etc/ssl/certs/ca-certificates.crt` | `https://`, mặc định khi URL là `https` |

- **Lý do:** dùng tên của PostgreSQL vì quen thuộc; mỗi giá trị ánh xạ được sang cả bốn client. Mạng nhà máy hay dùng chứng chỉ tự ký, nên cần `require`.
- **Ghi chú khi làm (2026-10-10):** test tích hợp cho thấy FreeTDS 1.1.6 không cài `dbsetlbool(DBSETENCRYPT)` ("UNIMPLEMENTED"), phiên SQL Server không được mã hóa. Runtime sinh một file `freetds.conf` (biến `FREETDSCONF`, trong `/tmp` riêng của dịch vụ), mỗi kết nối SQL Server một mục gồm `host`, `port`, `tds version = 7.4`, `encryption`; `dbopen()` mở theo tên mục. Kiểm bằng `sys.dm_exec_connections.encrypt_option = TRUE`.
- **Ghi chú review bảo mật (2026-10-10, M2):**
  - Lý do "db-lib không có API đặt CA" đã lỗi thời từ khi runtime tự sinh `freetds.conf`: FreeTDS 1.1.6 (`tls.c`) kiểm chứng chỉ và tên máy khi mục có `ca file`. SQL Server nhận `verify-full`; validator thôi báo `E_LOG_TLS`.
  - `prefer`, `require`, `disable` (và InfluxDB `http://` tới máy khác, `https://` + `require`) để kẻ đứng giữa lấy được mật khẩu/token. Hai validator cảnh báo `W_LOG_TLS_UNVERIFIED` (không chặn).
  - **Mặc định đổi sang `verify-full`** (người dùng giao quyết định ngày 2026-10-10; Constitution V: an toàn mặc định). Feature chưa triển khai ở đâu nên không có project nào phải sửa. Máy chủ dùng chứng chỉ tự ký có hai cách: đưa CA (hoặc chính chứng chỉ) vào kho CA của thiết bị, hoặc ghi rõ `tls: require` (vẫn mã hóa) hay `prefer` trong project, kèm cảnh báo.
  - **SQL Server:** FreeTDS kết thúc lần đăng nhập có chứng chỉ bị từ chối bằng lỗi db-lib 20002, giống mất kết nối. Khi đã đòi TLS (`require`, `verify-full`) mà không có thông báo nào từ máy chủ, runtime báo `tls` (`classifyMssqlOpen`), để người dùng sửa chứng chỉ chứ không đi tìm lỗi mạng. Lỗi TCP (20009) và tên máy (20013) vẫn là `connect`.
  - Chứng chỉ tự ký của nhà máy: chép CA vào `/usr/local/share/ca-certificates/<tên>.crt` rồi `update-ca-certificates`; cả bốn client đọc `/etc/ssl/certs/ca-certificates.crt`.
  - `freetds.conf` nằm trong thư mục riêng tạo bằng `mkdtemp` (0700), ghi bằng `O_EXCL` rồi đổi tên; không ghi được thì không kết nối (FreeTDS sẽ coi tên mục là tên máy).
- **Phương án đã loại:** tham số riêng cho từng loại DB: khó viết validator dùng chung.

## R11. Bí mật trên thiết bị

- **Quyết định:**
  - **File:** `/etc/mat-runtime/secrets.json` (đổi được bằng `secretsFile`, `--secrets-file`), nội dung:

    ```json
    {"schemaVersion":"0.1.0","connections":{"<id>":"<mật khẩu hoặc token>"}}
    ```

    Chủ sở hữu `root:matscada`, quyền `0640`. File cho người khác đọc (`mode & 0004`) thì runtime **không dùng** và báo `no_secret`.
  - **Đọc lại:** mỗi thread gửi đọc lại file ở mỗi lần kết nối (file nhỏ), nên sửa mật khẩu không cần khởi động lại runtime.
  - **Lệnh nhập:** `sudo mat-runtime --set-secret <connId>` đọc mật khẩu từ stdin (không echo khi là TTY), ghi atomic (file tạm rồi `rename`) với đúng chủ sở hữu và quyền.
  - Không bao giờ ghi bí mật vào log hay trạng thái.
  - Validator **từ chối** khóa giống bí mật (`password`, `passwd`, `pwd`, `secret`, `token`, `apiKey`, `api_key`) ở bất kỳ đâu trong `logging.json`. Kiểm tra này chạy trước JSON Schema để báo mã riêng `E_LOG_SECRET` (FR-006).
- **Lý do:** Constitution V và Master Plan §9.1: "secret nhập trên thiết bị". Ubuntu 20.04 có systemd 245, chưa có `LoadCredential=` (cần 247+).
- **Phương án đã loại:**
  - Mã hóa mật khẩu trong project: khóa giải mã vẫn phải nằm trên thiết bị, không an toàn hơn.
  - Biến môi trường trong unit systemd: lộ qua `systemctl show`.

## R12. Thread và cô lập lỗi

- **Quyết định:**
  - **Thread:** 1 thread `historian` (lấy mẫu, ghi, dọn, trần) và **1 thread gửi cho mỗi kết nối** (tối đa 8). Thread gửi chờ trên biến điều kiện, được thread historian báo sau mỗi lần commit, hoặc tự thức sau 1 s.
  - **Timeout client:**
    - kết nối 5 s;
    - đọc/ghi 30 s (MySQL `READ/WRITE_TIMEOUT`, FreeTDS `dbsettime`, libpq `connect_timeout` + `tcp_user_timeout`, curl `CURLOPT_TIMEOUT`);
    - lỗi thì thử lại sau 1, 2, 4, … tối đa 60 s (FR-019).
  - **Nhịp gửi bù:** nghỉ 20 ms giữa các lô và tối đa 5.000 dòng/s, để gửi bù vài ngày dữ liệu không chiếm CPU BL335.
  - **Dừng:** khi `SIGTERM`, historian commit phần đệm, các thread gửi xong lô đang chạy (giới hạn bởi timeout) rồi dừng.
- **Lý do:** FR-020: DB chậm hay treo không được làm chậm việc ghi hay các đích khác. Gửi bù 30 phút dữ liệu 1 s (1.800 dòng) mất vài giây, đạt FR-019 rất xa.
- **Ghi chú review (2026-10-10, I1, I7, I8, S7):**
  - **Lỗi của một nhóm** (`permission`, `schema_mismatch`, `sql`: máy chủ từ chối lược đồ hoặc dòng của nhóm đó) không đóng kết nối và không chặn các nhóm khác: nhóm đó có backoff riêng 1, 2, 4 … 60 s, rồi đồng bộ lược đồ và đọc lại con trỏ trước khi thử lại. Lỗi khác đóng kết nối với backoff chung, **chỉ về 1 s sau một lô gửi được hoặc khi không còn gì để gửi** (trước đây về 1 s ngay khi kết nối được, nên lỗi ghi lặp lại thành đăng nhập lại mỗi giây). Sai mật khẩu: 60, 120, 240, 300 s để không khóa tài khoản (hardening 5).
  - **Nhịp:** sau mỗi lô nghỉ `max(20 ms, số dòng / 5.000 dòng/s, thời gian CPU của lô)`: nhóm rộng tốn CPU theo số ô, nên thread gửi dùng tối đa khoảng nửa một lõi; thời gian chờ mạng không tính. Thread gửi chạy với nice +10.
  - **Thức:** sau mỗi commit của historian, hoặc tự thức sau 5 s (trước là 1 s), sớm hơn khi một nhóm hết thời gian chờ.
  - **Dừng hai pha:** historian báo dừng mọi thread gửi trước rồi mới chờ từng thread, để N đích treo chỉ tốn một lần thời gian chờ thay vì N lần (TimeoutStopSec 90 s).
- **Ghi chú review lần hai (2026-10-10):**
  - **PostgreSQL có hạn chờ phía client:** libpq đồng bộ chờ tới TCP keepalive (khoảng 2 giờ) khi máy chủ ngừng trả lời sau khi đã nhận câu lệnh. Runtime dùng `PQconnectStartParams`/`PQconnectPoll` (kết nối tối đa 10 s, gồm TLS và đăng nhập) và `PQsendQuery` + `poll` (mỗi câu tối đa 35 s), kèm keepalive 10/5/3 s; hết hạn thì đóng phiên (`timeout`).
  - **Câu trả lời có giới hạn:** tối đa 100.000 dòng và 16 MiB mỗi câu, vượt thì đóng phiên (`connect`). Mục đích: máy chủ bị chiếm, hoặc kẻ đứng giữa trên kết nối không `verify-full`, không làm hết RAM thiết bị (MemoryMax 300M), khiến runtime khởi động lại liên tục. MySQL đọc từng dòng (`mysql_use_result`) với gói tối đa 16 MiB; PostgreSQL ở chế độ một dòng; SQL Server đếm dòng.
  - **Đọc `history.db` gặp trang hỏng:** nhóm đó báo `sql` với `dbCode` `sqlite:11` và chờ như lỗi riêng của nhóm. Forwarder báo historian file nào hỏng; historian thay file nếu đó vẫn là file hiện tại. Dọn theo thời hạn hay theo trần gặp trang hỏng cũng dẫn tới việc thay file.
  - **Ghi chú review vòng ba (2026-10-11):**
    - PostgreSQL trả lời bằng COPY (máy chủ bị chiếm, kẻ đứng giữa): libpq trả kết quả COPY ở mọi lần gọi mà không chờ socket. Mọi trạng thái ngoài kết quả dòng, `COMMAND_OK`, `EMPTY_QUERY` và lỗi đều đóng phiên ngay (`connect`). Hạn chờ được kiểm ở mỗi kết quả.
    - Phiên PostgreSQL ở chế độ không chặn (`PQsetnonblocking`): phần câu lệnh chưa gửi đi được `PQflush` gửi dưới cùng hạn chờ. Phân giải tên trong `PQconnectStartParams` vẫn theo thời gian chờ của resolver.
    - InfluxDB 3 Core (3.12) qua API v2: một dòng sai kiểu làm cả lô bị từ chối (`400`, `{"code":"invalid","message":"… line protocol parse failed …"}`), không lưu gì; `accept_partial` không có tác dụng. Đích báo `schema_mismatch` và giữ dữ liệu trên thiết bị tới khi người dùng sửa, ví dụ đổi tên field hoặc xóa bảng. Dạng `{"error":"partial write …","data":[…]}` chỉ có ở API v3; runtime vẫn nhận dạng nó, kể cả khi câu trả lời bị cắt (chỉ đọc đầu chuỗi). Dạng InfluxDB 2 chỉ được nhận khi `message` bắt đầu bằng "partial write".
  - **InfluxDB nhận một phần lô:** nếu chỉ có điểm cũ hơn thời hạn của bucket thì không phải lỗi. Nếu có field khác kiểu, lô vẫn tính là đã gửi nhưng đích báo `schema_mismatch` cho tới khi có một lô đi trọn. Số điểm bị bỏ chỉ đọc từ trường `message` của JSON (InfluxDB 3 lặp lại dòng bị từ chối, trong đó có chữ của Tag), và không vượt số dòng đã gửi.
  - **File thay mới** (`history.db` hỏng, thay bằng file mới có instance id mới): forwarder mở lại file, bỏ con trỏ chờ lưu của file cũ; mỗi con trỏ mang instance id của file nó thuộc về, nên con trỏ của file cũ không bao giờ ghi vào file mới (I4). Instance id phải đúng dạng UUID, nếu không forwarder không gửi (S12).
- **Phương án đã loại:**
  - Một thread gửi chung: một DB treo chặn mọi đích.
  - I/O không chặn: bốn client có bốn kiểu API bất đồng bộ khác nhau.

## R13. Trạng thái và phân loại lỗi

- **Quyết định:**
  - `system/info` có thêm khối `historian` (xem [contracts/system-info.md](contracts/system-info.md)).
  - Lỗi của đích được **phân loại**: `no_client`, `no_secret`, `connect`, `auth`, `tls`, `timeout`, `permission`, `schema_mismatch`, `sql`, `http`. Mỗi loại có câu thông báo tiếng Việt cố định, kèm mã lỗi số của DB nếu có (ví dụ 1045, 18456).
  - Thông báo gốc của client (có thể chứa tên người dùng, địa chỉ máy chủ) **chỉ** ghi vào journal của systemd, không vào `system/info`. Trên Ubuntu, journal đọc được bởi root và các thành viên nhóm `adm`, `systemd-journal` (sửa theo review bảo mật). Văn bản từ máy chủ đi qua `journalSafe()`: ký tự điều khiển thành `\xNN`, ký tự ngắt dòng U+2028/2029 và điều khiển chiều chữ (bidi) thành `\uXXXX`, tối đa 512 byte, để không giả được dòng log (review bảo mật L3). NOTICE của PostgreSQL bị bỏ ngay từ lúc kết nối, kể cả trước khi đăng nhập xong.
  - Mã DB trong `system/info` chỉ là số, hoặc SQLSTATE đúng dạng 5 ký tự `0-9A-Z`; JSON trả cho trình duyệt thay byte không phải UTF-8 bằng U+FFFD thay vì ném ngoại lệ (review bảo mật M4).
- **Lý do:** FR-026, SC-010. `system/info` hiện công khai vì chưa có đăng nhập.
- **Phương án đã loại:** lọc chuỗi lỗi gốc bằng regex: dễ sót.

## R14. Cấu hình `logging.json` và validator hai bản

- **Quyết định:**
  - Thêm `loggingFile` (tùy chọn) vào `project.json`. Schema mới `schemas/logging.schema.json`, phiên bản `0.1.x` như các schema khác.
  - Luật liên file và mã lỗi `E_LOG_*` ở [contracts/logging-config.md](contracts/logging-config.md).
  - Hai bản validator thêm cùng luật và cùng **cảnh báo** `W_LOG_WRITE_BUDGET`, `W_LOG_SIZE_CAP`. Bản C++ trả cảnh báo; hiện nó chưa trả cảnh báo nào.
  - `expected.json` của vector thêm trường `warnings` (tùy chọn). Test hai bên so cả tập mã cảnh báo khi trường có mặt.
  - **Công thức ước tính** dùng chung (định nghĩa trong contract), cùng hằng số ở TS và C++:
    - byte mỗi ô theo kiểu, cộng 24 byte mỗi dòng;
    - dòng/ngày: theo chu kỳ = 86.400.000 / `periodMs`; theo thay đổi lấy cận trên = 86.400.000 / `minIntervalMs`;
    - ghi/ngày = dòng × byte × 2 (WAL) + số lần commit × 4 KB × số nhóm.
  - `RUNTIME_VERSION` lên `0.3.0`. Project mẫu có `logging.json` đặt `minRuntimeVersion` `0.3.0`. Runtime 0.2.0 gặp `loggingFile` thì báo `E_SCHEMA`, tức từ chối an toàn.
  - Studio cho lưu khi chỉ còn cảnh báo `W_LOG_*` (FR-024); cảnh báo `W_UID_NOT_IN_SVG` vẫn chặn như cũ.
- **Lý do:** Constitution V (validator hai phía, runtime không kích hoạt project lỗi); ADR-004 (SemVer).
- **Phương án đã loại:** gộp cấu hình vào `project.json`: file chính phình ra, khó tách editor sau này.

## R15. Triển khai trên BL335

- **Quyết định:**
  - **Unit systemd** thêm `StateDirectory=mat-runtime` và `StateDirectoryMode=0700`. Thư mục `/var/lib/mat-runtime` thuộc `matscada` và ghi được dù có `ProtectSystem=strict`.
  - **`deploy.sh` / `rollback.sh`** không đụng `/var/lib/mat-runtime` và `/etc/mat-runtime/secrets.json` (FR-029).
  - **Thư viện client:** trên image Ubuntu 20.04 hiện tại, cài bằng
    `apt install libmariadb3 libsybdb5 libpq5 libcurl4`,
    chỉ loại DB thật sự dùng, và **chỉ khi người dùng cho phép** (thay đổi thiết bị, cần Internet trên thiết bị, ghi `device-changes.md`). Image Buildroot sau này đóng sẵn các thư viện này. Thư mục `clientLibDir` để dành cho bản kèm gói.
  - Project mẫu `projects/tank-demo` có thêm `logging.json` (2 nhóm, không có đích ngoài). Thiết bị bắt đầu ghi sau lần deploy tới.
- **Lý do:** Constitution quy trình 3; FR-029/030.
- **Phương án đã loại:** kèm toàn bộ thư viện và phụ thuộc vào gói runtime. `libpq` và `libcurl` kéo khoảng 30 thư viện (Kerberos, LDAP, SASL, …), dễ xung đột với OS.

## R16. Kiểm thử

- **Quyết định:**
  - **Unit (GoogleTest, không mạng):** sampler, `LocalStore` (chạy trên file tạm), sinh SQL theo từng loại DB, line protocol, forwarder với đích giả (mô phỏng commit lỗi, mất kết nối sau commit, dòng bị xóa trước khi gửi), secrets, đọc `logging.json`, `client_api_check_test`.
  - **Vector dùng chung TS ↔ C++:** thêm khoảng 18 vector `logging-*`.
  - **Tích hợp (x64, Docker, chạy khi có biến môi trường):**
    - `tools/historian-it.ps1` dựng `mysql:8.4` và `pgvector/pgvector:pg17` (đã có sẵn trên máy dev), `mcr.microsoft.com/mssql/server:2022-latest`, `influxdb:2.7`;
    - chạy binary `historian_it` trong container toolchain cùng mạng Docker;
    - kịch bản: tạo bảng, gửi, so dữ liệu và giờ, thêm cột, dừng máy chủ 30 phút (rút gọn thời gian bằng dữ liệu dựng sẵn), kill giữa lúc gửi, TLS `require`, sai mật khẩu.
  - **Mất điện:** kill -9 tiến trình ghi 10 lần rồi `PRAGMA integrity_check` (x64). Cắt điện thật ≥ 3 lần trên BL335 do người dùng làm.
  - **Đo trên BL335** (SC-001): cần người dùng cho phép deploy.
- **Lý do:** Constitution VI. Máy dev đã có Docker và hai image DB.
- **Phương án đã loại:** mock client DB thay cho máy chủ thật: không bắt được khác biệt kiểu và cú pháp của từng DB.
