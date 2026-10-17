# SAST mã C++: cppcheck và clang-tidy (feature 011, T055)

- **Ngày:** 2026-10-17. Nhánh `gd6-secdocs` từ `gd6` (`cd0046b`).
- **Yêu cầu:** FR-028, SC-009 ("`cppcheck` và `clang-tidy` 0 phát hiện chưa phân loại mức error/warning bảo mật"), research R11, spike T011 ([011-spikes](011-spikes.md) §2).
- **Công cụ:** ảnh `mat-armhf` (`deployment/toolchain/Dockerfile`, Ubuntu 20.04, thêm `cppcheck` 1.90 và `clang-tidy-10` 10.0.0 ở task này). Chạy: `./tools/sast/run.ps1` (cấu hình ở `tools/sast/`). License của công cụ: `third_party/LICENSES.md` mục "Feature 011: công cụ SAST".
- **Phạm vi:** 177 tệp `.cpp` sản phẩm của `core/`, `server/`, `drivers/` (mục của `compile_commands.json` x64, bỏ `*/tests/*`, mỗi tệp một lần dù được link vào nhiều target) và các header của ba thư mục đó mà chúng include. `third_party/` không phân tích (mã vendored; CVE theo dõi ở T056). Mã test không thuộc phạm vi (không chạy trên thiết bị).

## 1. Cấu hình

| Công cụ | Bộ kiểm | Ngưỡng chặn (`run.ps1` thoát 1) |
|---|---|---|
| cppcheck 1.90 | `--enable=warning,performance,portability` (luôn có `error`), thư viện `std`, `posix`, `sqlite3` và `tools/sast/cppcheck.cfg` (CivetWeb, Mbed TLS), `--inline-suppr`, `tools/sast/suppressions.txt` | mọi phát hiện mức `error`, `warning` |
| clang-tidy-10 | `bugprone-*`, `cert-*`, `clang-analyzer-*` (gồm `clang-analyzer-security.*`), `concurrency-*` (`tools/sast/clang-tidy.yaml`); tắt có lý do: `clang-analyzer-optin.performance.Padding`, `cert-err58-cpp` (mục 4), các bộ kiểm của macOS và MPI | mọi `warning` |

Mức `performance`, `portability` của cppcheck được báo và phân loại (mục 3) nhưng không chặn. Phân loại mỗi phát hiện chặn: **sửa** trong mã, **ngoại lệ** có lý do ngay trong mã (`// cppcheck-suppress <id>` hoặc `// NOLINT(<check>)` kèm nhận xét), hoặc **dương tính giả** (ghi ở `tools/sast/suppressions.txt` hoặc bảng dưới, kèm lý do đã kiểm bằng tay).

## 2. Kết quả tổng

| Công cụ | Phát hiện ban đầu (error/warning) | Sửa trong mã | Ngoại lệ trong mã có lý do | Dương tính giả / chấp nhận có lý do ở cấu hình | Còn chưa phân loại |
|---|---|---|---|---|---|
| cppcheck | 73 (56 error, 17 warning) | 11 (5 lớp `final`, 5 bộ đệm, 1 nhánh phòng thủ) | 1 | 61 (`suppressions.txt`) | **0** |
| clang-tidy | 29 (warning) | 4 (gồm 1 lỗi thật: `compareSemver`) | 16 | 9 (`cert-err58-cpp` tắt có lý do) | **0** |

**SC-009 (phần SAST): đạt**: 0 phát hiện mức error/warning chưa phân loại. Một lỗi thật (so phiên bản bị tràn số với dữ liệu từ gói) đã sửa kèm test viết trước. Không có lỗ bộ nhớ, tràn bộ đệm hay lỗi bảo mật Critical/High nào được công cụ tìm thấy. Mức `performance`, `portability` của cppcheck: 17, đều đã phân loại (mục 3.2).

## 3. cppcheck

Lần chạy đầu (trước khi sửa, chưa có thư viện `posix`): 55 phát hiện: 29 `error` `returnDanglingLifetime`, 1 `error` `internalAstError`, 5 `warning` `virtualCallInConstructor`, 5 `uninitMemberVar`, 6 `stlIfFind`, 1 `nullPointerRedundantCheck`, 8 `performance`. Thêm thư viện `posix` cho thêm 26 `error` (`invalidFunctionArgBool` ×25, `invalidFunctionArg` ×1) và 9 `portability`. Thời gian: 10–25 s (`-j 2`).

### 3.1 Mức error và warning: phân loại

| Mã | Số | Vị trí | Phân loại | Lý do, cách xử lý |
|---|---|---|---|---|
| `virtualCallInConstructor` | 5 | `core/historian/forward/{influx,mssql,mysql,pg}_destination.cpp`, `drivers/sdk/serial_port.{hpp,cpp}` | **Sửa** | hủy gọi `close()` ảo: đúng hành vi hiện tại (không có lớp con) nhưng sẽ sai lặng lẽ nếu ai đó kế thừa. Năm lớp đánh `final` và hủy gọi tường minh `X::close()`; không đổi hành vi (không cần test mới; test của driver serial và historian forward chạy lại trong `ctest` đầy đủ) |
| `uninitMemberVar` | 5 | `server/tls/server_cert.cpp` `CertWriter`, `CsrWriter` (bộ đệm `der`, `certPem`, `csrPem`, `keyPem`) | **Sửa** | Mbed TLS ghi bộ đệm trước khi đọc, nên không có lỗi đọc rác; nhưng hủy gọi `mbedtls_platform_zeroize` trên toàn bộ `keyPem` kể cả phần chưa ghi. Khởi tạo `{}` (13 KiB memset một lần mỗi lần sinh chứng chỉ hay CSR, không đáng kể) |
| `nullPointerRedundantCheck` | 1 | `core/historian/forward/influx_line.cpp:50` | **Sửa** (phòng thủ) | `*b` dựa vào bất biến "variant giữ đúng một kiểu" (monostate đã loại ở trên) nên không thể null; thêm nhánh trả `nullopt` cho trường hợp không thể xảy ra ở `BOOL` và `STRING`, không đổi hành vi với mọi giá trị hợp lệ |
| `invalidFunctionArg` | 1 | `core/auth/password_hash.cpp:113` `mmap(..., -1, 0)` | **Ngoại lệ trong mã** (dương tính giả) | `MAP_ANONYMOUS` đòi `fd = -1` (mmap(2)); `posix.cfg` của cppcheck 1.90 chỉ biết `fd ≥ 0`. `// cppcheck-suppress invalidFunctionArg` kèm nhận xét |
| `invalidFunctionArgBool` | 25 | `server/http/{drivers_api,engineering_api,engineering_api_project,logic_api,tags_api,web_api}.cpp` | **Dương tính giả** (`suppressions.txt`) | hàm `send(mg_connection*, int, const std::string&, bool close, …)` của chính dự án (`engineering_api_internal.hpp`) trùng tên `send(2)` của POSIX, đối số thứ 4 của POSIX là cờ. Các lời gọi `::send` thật trong các tệp này viết đủ `::` và không bị báo |
| `returnDanglingLifetime` | 29 | `core/package/package_check.cpp` (21), `zip_reader.cpp` (6), `core/project-manager/project_validator.cpp` (2); thêm 2026-10-18 `core/update/manifest.cpp` (1: `invalid(why, …)` trả `Error` chép chuỗi vào `std::string`) | **Dương tính giả** (`suppressions.txt`) | hàm trả **giá trị** (`PackageCheck`, `std::optional<PackageError>`, `std::vector<std::string>` dựng từ `std::set` cục bộ): bản sao hoặc move, không phải tham chiếu. Phân tích thời gian sống của cppcheck 1.90 nhầm giá trị dựng bằng ngoặc nhọn hoặc qua hàm phụ là "trỏ vào biến cục bộ"; đã đọc từng chỗ |
| `stlIfFind` | 6 | `project_validator.cpp` (3), `rules_02.cpp`, `rules_04.cpp`, `core/tag-engine/write_coordinator.cpp` | **Dương tính giả** (`suppressions.txt`) | `if (auto it = m.find(k); it != m.end())` của C++17: cppcheck 1.90 không hiểu câu khởi tạo trong `if`, thấy thành `if (m.find(k))` |
| `internalAstError` | 1 | `core/historian/query/csv_writer.cpp:45` | **Dương tính giả** (giới hạn công cụ, `suppressions.txt`) | cppcheck 1.90 không dựng được cây cú pháp cho chuỗi `if constexpr` trong lambda tổng quát của `std::visit`; tệp này chỉ được clang-tidy phân tích |

Sau sửa: **0 phát hiện mức error/warning chưa phân loại** (mọi dòng còn lại trong `suppressions.txt` hoặc có `cppcheck-suppress` trong mã đều ở bảng trên).

### 3.2 Mức performance và portability (không chặn)

| Mã | Số | Vị trí | Phân loại |
|---|---|---|---|
| `readdirCalled` | 6 | `alarm_store.cpp`, `emmc_life.cpp`, `proc_stats.cpp`, `serial_ports.cpp`, `readonly_retain_io.hpp`, `http_api.cpp` | **Dương tính giả**: glibc `readdir` an toàn khi mỗi luồng dùng `DIR*` riêng (đúng ở mọi chỗ, `DIR*` cục bộ); `readdir_r` đã bị glibc 2.24 đánh dấu lỗi thời |
| `getgrnamCalled`, `getpwuidCalled` | 3 | `account_store.cpp:289`, `historian/secrets.cpp:165`, `server/cli/export_audit.cpp:71` | **Chấp nhận**: chỉ chạy trong CLI root (`geteuid() == 0`, một luồng), không trong tiến trình dịch vụ nhiều luồng |
| `passedByValue` | 7 | constructor của `AlarmEngine`, các `SqlDestination`, `SimulationDriver` | **Chấp nhận**: chạy một lần khi khởi động; `SqlLimits` là struct số nguyên nhỏ; không đáng đổi chữ ký dùng chung |
| `useInitializationList` | 1 | `WriteCoordinator` (`auditThread_`) | **Có chủ ý**: luồng phải khởi động sau khi mọi thành viên khác đã dựng xong |

## 4. clang-tidy

Lần chạy đầy đủ: 177 tệp, 1.086 s (`-j 2`, máy dùng chung với các agent khác). **29 phát hiện** (duy nhất theo tệp, dòng, bộ kiểm), mọi phát hiện đều mức `warning`:

| Bộ kiểm | Số | Vị trí | Phân loại | Lý do, cách xử lý |
|---|---|---|---|---|
| `cert-err34-c` | 1 | `core/project-manager/project_validator.cpp` `compareSemver` (`sscanf("%d.%d.%d")`) | **Sửa, lỗi thật, test viết trước** | phiên bản trong project (`minRuntimeVersion`, `logic.schemaVersion`) đến từ gói (dữ liệu ngoài); schema cho mỗi thành phần tới 64 ký tự, `%d` tràn và quấn (x64: `2147483648` thành số âm) nên project đòi runtime "rất mới" có thể qua kiểm `minRuntimeVersion`. Nay so từng thành phần như số thập phân độ dài bất kỳ, giữ cách đọc cũ (dừng ở ký tự không phải số/dấu chấm, thẻ pre-release không so). Test `CompareSemver.AComponentWiderThanIntIsStillGreater` **đỏ 2/4** rồi xanh; `CompareSemver.OrdersEachComponentAsANumber` giữ hành vi cũ |
| `cert-err34-c` | 8 | `alarm_store.cpp` ×2 (`alarm_meta`), `local_store.cpp` (`mat_meta`), `pulse_journal.cpp` (`pulse.journal`), `alarm_text.cpp` (số mũ do chính `snprintf` in), `io_meter.cpp` (`/proc/self/io`), `server/cli/alarm_db_check.cpp`, `server/cli/auth_bench.cpp` (`/proc/self/status`) | **Ngoại lệ trong mã** (`NOLINTNEXTLINE(cert-err34-c)` kèm lý do) | đầu vào do chính runtime ghi (thư mục `0700`, tệp `0600`) hoặc do kernel; giá trị hỏng chỉ cho số 0 hoặc số sai trong dữ liệu đã thuộc quyền của kẻ có quyền ghi thư mục dữ liệu. Hai mục cuối là CLI root/bench |
| `cert-err58-cpp` | 9 | `alarm_rules.cpp` ×7, `rules_04.cpp`, `server/poc/main.cpp` | **Chấp nhận, tắt bộ kiểm có lý do** (`clang-tidy.yaml`) | bảng tên hằng (`std::set`, `std::vector` chuỗi) ở phạm vi namespace chỉ có thể ném `std::bad_alloc` lúc chương trình khởi động, trước mọi luồng và I/O: `std::terminate` rồi systemd chạy lại là đúng, như mọi cấp phát lúc khởi động |
| `bugprone-branch-clone` | 5 | `alarm_engine.cpp`, `alarm_service.cpp`, `rules_04.cpp`, `tag_store.cpp`, `server/http/source_filter.cpp` | **Dương tính giả, ngoại lệ trong mã** (`NOLINTNEXTLINE`) | các nhánh cùng kết quả nhưng là điều kiện khác nhau, viết tách để đọc (ví dụ "đóng vì cấu hình" do hai nguyên nhân); đã đọc từng chỗ, không phải lỗi chép dán |
| `bugprone-narrowing-conversions` | 3 | `rules_02.cpp` (`-INFINITY` float sang double), `drivers/simulation/mock_tag_provider.cpp` (ms sang giây), `server/poc/sim_tags.hpp` (53 bit sang double) | **Dương tính giả, ngoại lệ trong mã** | chuyển đổi chính xác (vô cực float là vô cực double; giá trị < 2^53) |
| `bugprone-misplaced-widening-cast` | 1 | `server/websocket/live_hub.cpp:417` | **Sửa** | `static_cast<long long>(s.sequence + 1)` với `int64_t`: không mất gì trên x64 và armhf, nhưng ép kiểu trước khi cộng là đúng ý; đổi thành `static_cast<long long>(s.sequence) + 1` |
| `clang-analyzer-core.NullDereference` | 1 | `drivers/sdk/merge_planner.cpp:75` (`best->after`) | **Sửa** (dương tính giả, thêm chốt) | `cuts` không rỗng nên vòng lặp luôn gán `best`; bộ phân tích không suy ra được. Thêm `if (!best) return false;` (không đổi hành vi) |
| `clang-analyzer-core.NonNullParamChecker` | 1 | `server/discovery/discovery_server.cpp:180` (`d.iface->mac`) | **Sửa** (dương tính giả qua hai tệp, thêm chốt) | `Responder::check` (`core/discovery/discovery_proto.cpp`) trả `Drop::Subnet` khi `iface` null nên lệnh return trước đã chặn; bộ phân tích chỉ thấy một tệp. Thêm `|| !d.iface` vào điều kiện return (không đổi hành vi) |

Không có phát hiện nào của `clang-analyzer-security.*`, `clang-analyzer-unix.*` (malloc, API Unix), `clang-analyzer-cplusplus.*` (new/delete, move), `bugprone-use-after-move`, `bugprone-sizeof-*`, `cert-*` khác (`cert-err33-c` không có ở clang-tidy 10). `concurrency-*` của clang-tidy 10 chưa có bộ kiểm nào (`concurrency-mt-unsafe` có từ bản 11).

Sau sửa: chạy lại clang-tidy trên 20 tệp đã đổi hoặc có phát hiện: 0 phát hiện; lần chạy đầy đủ cuối (cả hai công cụ, 177 tệp; cppcheck 10 s, clang-tidy 675 s): **0 phát hiện mức error/warning**.

## 5. Thay đổi mã

| Tệp | Thay đổi | Phát hiện |
|---|---|---|
| `core/historian/forward/{influx,mssql,mysql,pg}_destination.cpp` | lớp `final`, hủy gọi `X::close()` | `virtualCallInConstructor` |
| `drivers/sdk/serial_port.{hpp,cpp}` | `SerialPort final`, hủy gọi `SerialPort::close()` | `virtualCallInConstructor` |
| `server/tls/server_cert.cpp` | bộ đệm `CertWriter`, `CsrWriter` khởi tạo `{}` | `uninitMemberVar` |
| `core/historian/forward/influx_line.cpp` | nhánh phòng thủ cho biến thể không thể có | `nullPointerRedundantCheck` |
| `core/auth/password_hash.cpp` | `cppcheck-suppress` kèm lý do | `invalidFunctionArg` |
| `core/project-manager/project_validator.cpp` (+ test) | `compareSemver` so thành phần như số thập phân độ dài bất kỳ | `cert-err34-c` (lỗi thật) |
| `drivers/sdk/merge_planner.cpp`, `server/discovery/discovery_server.cpp` | chốt null tường minh | `clang-analyzer-core.*` |
| `server/websocket/live_hub.cpp` | ép kiểu trước khi cộng | `bugprone-misplaced-widening-cast` |
| 15 tệp (mục 4) | `// NOLINTNEXTLINE(<check>): <lý do>` | `cert-err34-c` ×8, `bugprone-branch-clone` ×5, `bugprone-narrowing-conversions` ×3 |

Thay đổi hành vi duy nhất là `compareSemver` (test viết trước, đỏ rồi xanh). Các sửa còn lại không đổi hành vi quan sát được. Kiểm hồi quy: x64 Release `ctest -j 3 -E '^AlarmStorm\.'` đầy đủ: 5.698 test, 5.684 đạt ở lần đầu; 14 trượt chỉ vì thiếu gói vector lớn sinh ra (`tests/package-vectors/out/`, "run `node tests/package-vectors/generate.mjs --out` first"), sau khi sinh thì chạy lại `PackageVector|CheckPackageCli` 128/128 đạt; 1 test bị tắt sẵn (`AuditLogBench`). clang-format sạch trên mọi tệp đã đổi.

## 6. Cách chạy lại và giữ sạch

- `./tools/sast/run.ps1` (mặc định cả hai công cụ, `-Jobs 2`, thư mục build `<MAT_BUILD_ROOT>/mat-sast`); `-Tool cppcheck` cho vòng nhanh (≈ 20 s). Kết quả: `<build>/sast/findings.json`, thoát 1 khi còn phát hiện chặn.
- Phát hiện mới: sửa; hoặc ngoại lệ trong mã có lý do; hoặc thêm vào `tools/sast/suppressions.txt` (cppcheck) kèm lý do và một dòng ở bảng của báo cáo này. Không tắt cả bộ kiểm để làm im một chỗ.
- Bước `sast` của `tools/ci-local.ps1`: việc của T059.
- Ghi chú lần chạy này: sandbox của phiên làm việc chặn `pwsh`, nên phần container của `run.ps1` (đoạn shell trong here-string, trích nguyên văn rồi thay bốn chỗ giữ chỗ như script làm) được chạy trực tiếp bằng `docker run`; phần PowerShell (gom, khử trùng lặp, `findings.json`, mã thoát) chưa chạy thật, cần chạy một lần trên máy dev.
- Khi nâng ảnh lên Ubuntu mới hơn (cppcheck 2.x, clang-tidy mới): xem lại các dòng dương tính giả của cppcheck 1.90 (nhiều dòng sẽ không còn cần) và bộ kiểm `concurrency-mt-unsafe` (có từ clang-tidy 11).
