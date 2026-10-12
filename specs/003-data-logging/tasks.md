---

description: "Task list — Lưu trữ dữ liệu Tag trên thiết bị và chuyển tiếp sang DB ngoài"
---

# Tasks: Lưu trữ dữ liệu Tag trên thiết bị và chuyển tiếp sang DB ngoài

**Input**: `specs/003-data-logging/` (plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md)

**Tests**: **Bắt buộc, viết trước** (Constitution VI; spec FR-031). Mỗi task "Test" phải chạy **đỏ** trước task cài đặt tương ứng.
- C++ dùng GoogleTest (build x64 trong Docker qua `deployment/toolchain/test-x64.ps1`).
- TS dùng Vitest.
- Tích hợp với DB thật qua `tools/historian-it.ps1`.

**Quy ước an toàn**:
- Task ⚠️🔌 thao tác trên BL335 (SSH, deploy, `apt install`, `--set-secret`): **chỉ làm khi người dùng cho phép rõ**. Ghi `docs/reports/device-changes.md` kèm cách hoàn tác. Không đụng dịch vụ sản phẩm cũ (`atscada-*`).
- Không ghi mật khẩu DB thật vào repo. Test tích hợp sinh mật khẩu ngẫu nhiên mỗi lần chạy.
- Ổ D: gần đầy. Image Docker (DB thử) nằm ở ổ C:. Xóa `build/x64`, `build/armhf` cũ nếu ổ D: còn < 500 MB.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: chạy song song được (khác file, không phụ thuộc task chưa xong)
- **[Story]**: US1…US6 theo spec.md

---

## Phase 1: Setup (thư viện và khung build)

- [X] T001 Vendor SQLite 3.54.0: — **ghi chú khi làm:** file phiên bản đặt tên `VERSION.txt` thay vì `VERSION`: ổ D: (NTFS) mount vào Docker không phân biệt hoa/thường nên `#include <version>` của libstdc++ trúng file `VERSION`
  - tải `https://www.sqlite.org/2026/sqlite-amalgamation-3540000.zip` vào scratchpad;
  - kiểm SHA3-256 = `7b670a62fdfbd672b75fef004cb703c8a3e87d3a5cc7d675b4a08337004a2d93`;
  - chép `sqlite3.c`, `sqlite3.h` vào `third_party/sqlite/` cùng file `VERSION` (`3.54.0`);
  - thêm mục vào `third_party/LICENSES.md` (public domain, nguồn, ngày tải).
- [X] T002 Sửa `CMakeLists.txt`: — **ghi chú khi làm:** `mat_historian` tạo ở Phase 2 cùng file nguồn đầu tiên (`clock.cpp`); `mat_cli` thêm ở T025 khi có mã CLI. CMake 3.16 của image không có `cmake --build -k`, dùng `-- -k 0`
  - target `mat_sqlite` (STATIC, C) với định nghĩa `SQLITE_DQS=0 SQLITE_DEFAULT_MEMSTATUS=0 SQLITE_LIKE_DOESNT_MATCH_BLOBS SQLITE_OMIT_DEPRECATED SQLITE_OMIT_SHARED_CACHE SQLITE_OMIT_LOAD_EXTENSION SQLITE_THREADSAFE=1`, cờ `-w`;
  - target `mat_historian` (STATIC) cho `core/historian/**`, link `mat_core mat_sqlite ${CMAKE_DL_LIBS}`;
  - target `mat_cli` (STATIC) cho `server/cli/**`, link `mat_historian`;
  - `string(TIMESTAMP MAT_BUILD_EPOCH_S "%s" UTC)` truyền vào `MAT_BUILD_EPOCH_S`;
  - `mat-runtime` link thêm `mat_cli`;
  - hàm `mat_test` link thêm `mat_cli`.
  - `core/project-manager/logging_estimate.cpp` nằm trong `mat_core` (validator dùng), tránh vòng `mat_core` ↔ `mat_historian`.
- [X] T003 [P] Thêm `libmariadb-dev freetds-dev libpq-dev libcurl4-openssl-dev` (amd64) vào `deployment/toolchain/Dockerfile`. Ghi chú trong file: chỉ dùng cho `client_api_check_test` và test tích hợp; bản armhf không link các thư viện này.
- [X] T004 [P] Sửa `deployment/toolchain/run-x64.ps1`: thêm tham số `-DataDir` (mặc định `/tmp/mat-data` trong container) và truyền `--data-dir`.

**Checkpoint**: `./deployment/toolchain/test-x64.ps1` và `./deployment/toolchain/build.ps1` vẫn xanh (chưa có logic mới; `mat_sqlite` build được cho cả x64 và armhf).

---

## Phase 2: Foundational (chặn mọi user story)

**Mục đích**: đọc `TagStore` theo lô, đồng hồ/giờ địa phương, schema `logging.json` và việc nạp file này ở hai bản validator, khóa cấu hình runtime mới.

- [X] T005 [P] Test `core/tag-engine/tests/tag_store_test.cpp`:
  - `snapshot(indices, out)` trả `value`, `quality`, `revision` của đúng các index trong **một** lần khóa;
  - index ngoài phạm vi → `std::out_of_range`;
  - gọi `snapshot` không làm đổi kết quả `takeDirty()`.
- [X] T006 Cài `TagStore::snapshot` trong `core/tag-engine/tag_store.hpp/.cpp`, đạt T005.
- [X] T007 [P] Test `core/historian/tests/clock_test.cpp`:
  - `parseOffset`: nhận `+07:00`, `-03:30`, `+14:00`, `-12:00`; từ chối `7`, `+7:00`, `+07:60`, `+15:00`, `-13:00`;
  - `formatLocal(utcMs, offsetMin, sep)`: ra `2026-10-10 08:00:00.123` và dạng có `T`, kể cả sang ngày mới;
  - `alignedNext(nowUtc, periodMs, offsetMin, anchorUtc)`:
    - chu kỳ chia hết 86 400 000 thì căn bội số tính từ 00:00 giờ địa phương: 60 000 → giây 0; 3 600 000 → phút 0; 28 800 000 với `+07:00` → 00:00, 08:00, 16:00 giờ địa phương;
    - chu kỳ khác (ví dụ 7 000) thì căn bội số tính từ `anchorUtc`;
  - `clockValid(nowUtc)` ⇔ `nowUtc ≥ MAT_BUILD_EPOCH_S × 1000`.
- [X] T008 Cài `core/historian/clock.hpp/.cpp`, đạt T007.
- [X] T009 Viết `schemas/logging.schema.json` (draft-07, `$id` `https://schemas.atpro.com.vn/mat/logging/0.1.json`, `additionalProperties:false` ở mọi object) theo [data-model.md](data-model.md) §1.
  - **Gốc:**
    - `schemaVersion` SemVer (như các schema khác);
    - `timeZone` pattern `^[+-](0\d|1[0-4]):[0-5]\d$`;
    - `groups` 1–32;
    - `connections` 0–8.
  - **Nhóm:**
    - `id` `^[a-z0-9][a-z0-9-]{0,47}$`; `name` 1–80;
    - `table` `^[a-z][a-z0-9_]{0,47}$`;
    - `mode` enum `cyclic|onChange`;
    - `periodMs`, `minIntervalMs`, `maxIntervalMs` integer 100–86 400 000;
    - `retentionDays` integer 1–3650;
    - `destinations` ≤ 8, `uniqueItems`, phần tử theo pattern id;
    - `tags` 1–200.
  - **Tag:**
    - `tagId` theo pattern của `tag.schema.json`;
    - `column` `^[A-Za-z_][A-Za-z0-9_]{0,62}$`;
    - `deadband` number ≥ 0;
    - `maxLength` integer 1–4000.
  - **Kết nối:**
    - `id` theo pattern id; `type` enum `mysql|mssql|postgresql|influxdb`;
    - `host` 1–253; `port` 1–65535; `database` 1–64; `schema` `^[A-Za-z_][A-Za-z0-9_]{0,62}$`; `user` 1–128;
    - `url` ≤ 256, pattern `^https?://`; `org`, `bucket` 1–64;
    - `tls` enum `disable|prefer|require|verify-full`;
    - `timeZone` như ở gốc.
  - Thêm vào `schemas/project.schema.json` trường tùy chọn `loggingFile` (string, 6–128 ký tự, pattern `\.json$`, như `bindingFile`).
- [X] T010 Test vector cho phần nạp file, trong `tests/project-vectors/generate.mjs`:
  - hàm `withLogging(f, cfg)` (đặt `project.json.loggingFile = "logging.json"` và ghi `logging.json`);
  - vector `logging-valid-local-only`, `logging-invalid-schema` (`mode: "sometimes"`), `logging-invalid-path` (`loggingFile: "../logging.json"`), `logging-invalid-missing`, `logging-invalid-version` (`schemaVersion: "0.2.0"`);
  - `expected.json` có trường tùy chọn `warnings`.

  Sửa `packages/project-schema/src/vectors.test.ts` và `core/project-manager/tests/project_validator_test.cpp` để so **tập** mã cảnh báo khi `expected.warnings` có mặt. Chạy `node tests/project-vectors/generate.mjs` → test **đỏ**.
- [X] T011 Cài phía TS, đạt T010 phía Vitest:
  - `packages/project-schema/src/types.ts`: `Project.loggingFile?`, các kiểu `LoggingConfig`, `LoggingGroup`, `LoggedTag`, `Connection` khớp schema;
  - `validate.ts`: validator kind `logging`; khi có `loggingFile` thì `isSafeRelPath` → `E_PATH`, rồi `loadJson`; `LoadedProject.logging?`;
  - `rules.ts`: đưa file logging vào danh sách kiểm `schemaVersion`.
- [X] T012 Cài phía C++ trong `core/project-manager/project_validator.hpp/.cpp`, đạt T010 phía GoogleTest:
  - nạp schema `logging`; xử lý `loggingFile` cùng thứ tự với TS;
  - `LoadedProject.logging` (`json`, `null` khi không có);
  - `ProjectValidation.warnings`; `resultJson` in `warnings` thật.
- [X] T013 [P] Test `server/tests/config_test.cpp`:
  - mặc định `dataDir=/var/lib/mat-runtime`, `secretsFile=/etc/mat-runtime/secrets.json`, `clientLibDir=/opt/mat-runtime/lib`, `historianMaxDbMB=2048`, `historianMinFreeMB=500`, `historianCommitMs=5000`;
  - ngoài khoảng (`historianMaxDbMB` 64–65536, `historianMinFreeMB` 50–65536, `historianCommitMs` 1000–60000) → lỗi cấu hình;
  - `--data-dir`, `--secrets-file` ghi đè file.
- [X] T014 Cài khóa mới trong `server/config.hpp/.cpp`, đạt T013.

**Checkpoint**: `test-x64.ps1` và `npm test` xanh. Project không có `loggingFile` cho kết quả như Sprint 1.

---

## Phase 3: User Story 1 — Lưu dữ liệu Tag trên thiết bị theo cấu hình (Priority: P1) 🎯 MVP

**Goal**: runtime ghi các dòng bảng rộng theo nhóm vào `history.db`; dữ liệu còn sau khởi động lại và sau deploy.

**Independent Test**: project mẫu có 2 nhóm (chu kỳ 60 s, theo thay đổi) chạy ≥ 10 phút. `--export-history` cho đúng số dòng, thời điểm và giá trị (spec US1).

### Tests for User Story 1 ⚠️ viết trước

- [X] T015 [P] [US1] Test `core/historian/tests/logging_config_test.cpp`: dựng model từ `logging.json` đã validate cộng `TagStore`:
  - `table` mặc định `van-hanh` → `van_hanh`, `3pha` → `t_3pha`;
  - `column` mặc định `TANK01.LEVEL` → `TANK01_LEVEL`;
  - mặc định `minIntervalMs` 1000, `timeZone` `+07:00`, `maxLength` 255;
  - affinity SQLite theo kiểu Tag (BOOL/số nguyên → `INTEGER`, số thực → `REAL`, `STRING` → `TEXT`);
  - index Tag lấy từ `TagStore`.
- [X] T016 [P] [US1] Test `core/historian/tests/sampler_test.cpp` (hàm thuần, đồng hồ giả): — **ghi chú khi làm:** kiểm đồng hồ chưa hợp lệ chuyển sang `historian_test` (T022) vì `Historian` quyết định có gọi sampler hay không; phát hiện nhảy giờ bằng độ lệch giữa đồng hồ thực và monotonic (> 1 s), không phụ thuộc chu kỳ
  - **Theo chu kỳ:**
    - chu kỳ 60 s: một dòng ở mỗi giây 0 (± 100 ms);
    - mỗi lượt tối đa 1 dòng;
    - đồng hồ nhảy tới > 2 chu kỳ: 1 dòng rồi căn lại, `clockJumps++`;
    - nhảy lùi: tính lại mốc, không ghi trùng ngay.
  - **Theo thay đổi:**
    - dòng gốc lúc bắt đầu;
    - deadband: so `> deadband` với giá trị **đã ghi** (0,3 rồi 0,4 → chỉ lần thứ hai ghi);
    - BOOL và chuỗi: mọi thay đổi; đổi lớp chất lượng GOOD ↔ không GOOD là thay đổi;
    - `minIntervalMs`: 10 lần đổi trong 1 s → 1 dòng mang giá trị mới nhất (dòng chờ được ghi khi đủ khoảng);
    - `maxIntervalMs` 60 s và không đổi → mỗi 60 s một dòng.
  - **Ô và đồng hồ:**
    - quality khác GOOD, NaN, vô cực → ô rỗng;
    - chuỗi > `maxLength` bị cắt đúng ranh giới UTF-8 (thử với `ệ`) và `stringsTruncated++`;
    - `clockValid` sai → không tạo dòng.
- [X] T017 [P] [US1] Test `core/historian/tests/local_store_test.cpp` (file tạm): — **ghi chú khi làm:** cột UINT64 khai báo không kiểu (affinity BLOB): affinity INTEGER của SQLite đổi chuỗi số > INT64_MAX thành REAL (mất chính xác); test bắt được lỗi này
  - **Mở/tạo:**
    - PRAGMA `journal_mode=wal`, `synchronous=1`, `cache_size=-8192`;
    - `mat_meta.instance_id` (UUID v4) giữ nguyên qua lần mở lại;
    - tạo `log_<table>` với cột `seq INTEGER PRIMARY KEY AUTOINCREMENT`, `ts INTEGER NOT NULL` + cột Tag, và chỉ mục `log_<table>_ts`.
  - **Đổi cấu hình:** thêm cột khi cấu hình đổi (dòng cũ rỗng); bỏ Tag thì cột giữ nguyên; nhóm bị bỏ thì bảng và `mat_tables.retention_days` giữ nguyên.
  - **Ghi:**
    - ghi lô trong một giao dịch;
    - UINT64 > 2^63−1 lưu `TEXT`;
    - `seq` tăng đơn điệu kể cả sau khi xóa hết dòng.
  - **File hỏng:** file rác → đổi tên thành `history.db.corrupt-<epoch>` rồi tạo file mới; `lastError.code=corrupt_recovered`.
- [X] T018 [P] [US1] Test `server/tests/export_history_test.cpp` (contract [device.md](contracts/device.md)):
  - tiêu đề `time,<cột…>`;
  - thời gian giờ địa phương `YYYY-MM-DD HH:MM:SS.mmm` theo `--tz`; ô rỗng để trống;
  - quote theo RFC 4180 (chuỗi có `,`, `"`, xuống dòng);
  - lọc `--from`/`--to`; mặc định 24 giờ gần nhất;
  - nhóm không có → mã thoát 4; tham số sai → mã thoát 2;
  - tìm được nhóm đã bỏ khỏi project (qua `mat_tables`).

### Implementation for User Story 1

- [X] T019 [US1] Cài `core/historian/logging_config.hpp/.cpp`, đạt T015. — **ghi chú khi làm:** `GroupSampler` giữ bản sao model nhóm, không giữ tham chiếu (test bắt lỗi tham chiếu treo tới đối tượng tạm)
- [X] T020 [US1] Cài `core/historian/sampler.hpp/.cpp`, đạt T016.
- [X] T021 [US1] Cài `core/historian/local_store.hpp/.cpp`, đạt T017:
  - PRAGMA theo research R3; câu `INSERT` chuẩn bị sẵn cho từng bảng;
  - `commit(rows)` trong một giao dịch; kết nối chỉ đọc dùng cho thread gửi và cho lệnh xuất;
  - xử lý `SQLITE_CORRUPT`/`SQLITE_NOTADB`.
- [X] T022 [US1] Test `core/historian/tests/historian_test.cpp`, chạy bằng `runOnce(nowUtc, nowMono)` (không thread): — **ghi chú khi làm:** lỗi ghi giả lập bằng `PRAGMA query_only` (container chạy root nên không chặn được bằng quyền file); thêm `HistorianOptions.clockFloorMs` để test tất định (mốc build là thời điểm chạy CMake)
  - dòng đệm được commit mỗi `historianCommitMs`, hoặc khi đệm đủ 5000 dòng;
  - `stop()` commit phần còn lại;
  - SQLite lỗi → `state=error`, đệm ≤ 10 000 dòng (bỏ dòng cũ nhất, `rowsDropped++`), thử lại mỗi 10 s;
  - đồng hồ chưa hợp lệ → `state=clock_invalid`, không có dòng.
- [X] T023 [US1] Cài `core/historian/historian.hpp/.cpp` (thread 100 ms gọi `runOnce`; trạng thái nguyên tử để đọc từ thread HTTP), đạt T022. — **ghi chú khi làm:** đồng hồ còn bị coi là sai khi vượt mốc build + 30 năm: RTC đặt nhầm năm 2099 sẽ làm thời hạn lưu xóa sạch dữ liệu thật
- [X] T024 [US1] Nối vào `server/main.cpp`: — **ghi chú khi làm:** khối `historian` tối thiểu gồm `enabled`, `state`, `clock`, `groups`, `rowsWritten`; lỗi mở lưu trữ không làm dừng runtime
  - project hợp lệ có `logging` → dựng `LoggingModel` → `Historian` (`dataDir`, `historianCommitMs`) chạy thread;
  - `SIGTERM` → `historian.stop()` trước `mg_stop`;
  - `system/info` có khối `historian` tối thiểu (`enabled`, `state`, `rowsWritten`); khối đầy đủ làm ở US6.
- [X] T025 [US1] Cài lệnh `--export-history` trong `server/cli/export_history.hpp/.cpp` và nhánh xử lý trong `server/main.cpp` (chạy trước khi mở cổng, mở DB chỉ đọc), đạt T018.
- [X] T026 [US1] Thêm logging vào project mẫu: — **ghi chú khi làm:** `apps/studio/src/project-form.test.ts` thêm `logging.json` vào danh sách file của project mẫu dựng trong bộ nhớ
  - viết `projects/tank-demo/logging.json`:
    - nhóm `van-hanh`: `onChange`, `minIntervalMs` 1000, `maxIntervalMs` 60000, `retentionDays` 30; Tag `TANK01.LEVEL` (deadband 0.5), `MOTOR01.RUN`, `MOTOR01.SPEED` (deadband 10), `TANK01.TEMP`;
    - nhóm `bao-cao-ca`: `cyclic`, `periodMs` 60000, `retentionDays` 365; Tag `TANK01.LEVEL`, `TANK01.INFLOW`, `MOTOR01.RUN`;
    - không có đích ngoài;
  - `projects/tank-demo/project.json`: thêm `loggingFile`, `minRuntimeVersion` `0.3.0`;
  - nâng `RUNTIME_VERSION` (`packages/project-schema/src/codes.ts`) và `kRuntimeVersion` (`core/project-manager/project_validator.hpp`) lên `0.3.0`;
  - chạy lại `node tests/project-vectors/generate.mjs` (`valid-tank-demo` có `logging.json`).
- [X] T027 [US1] Sửa unit và script deploy: — **ghi chú khi làm:** `deploy.sh`/`rollback.sh` đã không đụng `/var/lib/mat-runtime` và `secrets.json`, không phải sửa; `package-runtime.ps1` chép sẵn `schemas/*.json`, chỉ sửa dòng phiên bản README
  - `deployment/systemd/mat-runtime.service` thêm `StateDirectory=mat-runtime`, `StateDirectoryMode=0700`;
  - đọc `deployment/device/deploy.sh` và `rollback.sh`, bảo đảm không xóa hay ghi đè `/var/lib/mat-runtime` và `/etc/mat-runtime/secrets.json` (sửa nếu có);
  - `deployment/package-runtime.ps1` đóng thêm `schemas/logging.schema.json` (kiểm danh sách file).
- [X] T028 [US1] Kiểm chứng x64 theo [quickstart.md](quickstart.md) §2. Tạo `docs/reports/003-acceptance.md`, ghi số dòng, độ lệch giờ, và mẫu CSV.

**Checkpoint**: US1 chạy độc lập trên x64. Sau `docker restart mat-runtime-x64` (thư mục dữ liệu được giữ), dữ liệu cũ vẫn còn.

---

## Phase 4: User Story 2 — Tự xóa dữ liệu cũ và bảo vệ bộ nhớ thiết bị (Priority: P1)

**Goal**: thời hạn lưu theo ngày, trần dung lượng, ngưỡng trống. Không gián đoạn việc ghi và cập nhật live.

**Independent Test**: dữ liệu giả lập 10 ngày, thời hạn 7 ngày, trần 64 MB. Sau đợt dọn không còn dòng cũ; `dbBytes` ≤ trần + 5 %.

- [X] T029 [P] [US2] Test bổ sung `core/historian/tests/local_store_test.cpp`: — **ghi chú khi làm:** test viết trước nhưng không chạy riêng bước đỏ (các hàm chưa tồn tại nên chắc chắn lỗi biên dịch); chạy xanh cùng lúc với T030
  - **Thời hạn lưu:**
    - xóa theo `ts < cutoff` mỗi lô 2000 dòng;
    - bảng mồ côi dùng `mat_tables.retention_days`;
    - dòng có `ts` ở tương lai giữ nguyên.
  - **Trần dung lượng:**
    - `usedBytes = (page_count − freelist_count) × page_size`;
    - vượt trần thì xóa lô dòng cũ nhất trên mọi bảng (bảng có `min(ts)` nhỏ nhất trước) tới khi < 90 % trần;
    - đếm `capPurges`, `capRowsDeleted`.
  - **Ngưỡng trống:** hàm `statvfs` tiêm được (giả) → `paused_low_disk`; ghi tiếp khi trống > ngưỡng + 50 MB.
- [X] T030 [US2] Cài thời hạn lưu, trần dung lượng, ngưỡng trống trong `core/historian/local_store.cpp`, đạt T029.
- [X] T031 [US2] Test bổ sung `core/historian/tests/historian_test.cpp`: — **ghi chú khi làm:** như T029: không chạy riêng bước đỏ
  - đợt dọn chạy lúc khởi động và mỗi giờ, cắt lát ≤ 20 ms mỗi lượt (100 000 dòng cần xóa không làm lượt lấy mẫu chậm > 1 s);
  - kiểm trần và dung lượng trống mỗi 60 s;
  - `lastRetention{at, rowsDeleted}` cập nhật.
- [X] T032 [US2] Cài lịch bảo trì trong `core/historian/historian.cpp`, đạt T031.
- [X] T033 [US2] Công cụ dev `core/historian/tests/historian_tool.cpp` (binary `historian_tool`, chỉ x64, không đóng gói), các lệnh: — **ghi chú khi làm:** fill tạo thư mục dữ liệu; thêm count --older-than-hours (tiêu chí SC-006 là thời hạn + 1 giờ); write-loop có sẵn cho kịch bản kill ở US4
  - `fill --group --from --to --period`: chèn dòng giả lập theo `ts`;
  - `write-loop`: ghi liên tục tới khi bị kill;
  - `integrity`: chạy `PRAGMA integrity_check`;
  - `count`.

  Script `tools/historian-it.ps1` với kịch bản `-Scenario retention` (fill 10 ngày, thời hạn 7 ngày, trần 64 MB, chạy runtime x64, kiểm sau đợt dọn, đo trễ live bằng `build/load-tester.exe -clients 1`). Kiểm `tools/load-tester` có báo khoảng trống lớn nhất giữa hai delta không; chưa có thì thêm trường `maxDeltaGapMs` vào kết quả JSON (kèm test Go).
- [X] T034 [US2] Chạy kịch bản `retention`; ghi kết quả SC-006/SC-007 vào `docs/reports/003-acceptance.md`. — **ghi chú khi làm:** kịch bản tách hai pha (thời hạn với trần 256 MB, rồi trần 64 MB) vì trần 64 MB với 104 MB dữ liệu xóa hết dòng cũ trước đợt dọn theo thời hạn

**Checkpoint**: US1 và US2 chạy độc lập; dữ liệu không vượt trần.

---

## Phase 5: User Story 3 — Ghi sang DB của khách hàng (Priority: P1)

**Goal**: chuyển dòng sang MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB với bảng rộng tự tạo, cột thời gian theo giờ địa phương, con trỏ chính xác một lần.

**Independent Test**: với mỗi loại DB, nhóm gửi tới đó 10 phút → giá trị và giờ khớp 100 % (SC-004).

### Tests for User Story 3 ⚠️ viết trước

- [X] T035 [P] [US3] Test `core/historian/tests/sql_dialect_test.cpp` theo [external-schema.md](contracts/external-schema.md): — **ghi chú khi làm:** số thực viết dạng ngắn nhất đọc lại đúng giá trị (65.2, 0.1) thay cho %.17g/%.9g; thêm batchRowsFor (giới hạn lô ~4 MiB theo ước tính byte, STRING tính maxLength × 4) và insertChunks (mỗi INSERT ≤ 1 MiB, cùng giao dịch): chỉ công thức theo số ô cho phép lô ~400 MB với 200 chuỗi 4000 ký tự
  - **DDL cho 3 dialect:** tạo bảng với đúng bảng kiểu cột; chỉ mục `ix_<table>_time`; thêm cột; DDL `mat_forward_state`; câu đọc danh sách cột; câu đọc `last_seq`.
  - **Lô ghi:**
    - MySQL: danh sách câu riêng (`START TRANSACTION`, `INSERT`, `UPDATE`, `INSERT` dự phòng, `COMMIT`);
    - SQL Server: một batch có `SET XACT_ABORT ON` và `IF @@ROWCOUNT = 0`;
    - PostgreSQL: một chuỗi có `ON CONFLICT`.
  - **Giá trị:** int64; uint64 (`18446744073709551615`); double `%.17g`; FLOAT32 `%.9g`; BOOL (`1/0`, PostgreSQL `TRUE/FALSE`); `NULL`; thời gian `+07:00` (kể cả qua ngày, dạng `T` của SQL Server); chuỗi SQL Server `N'…'` nhân đôi `'`; escaper MySQL/PostgreSQL tiêm vào (giả).
  - **Tên:** PostgreSQL đổi tên cột sang chữ thường.
  - **Kích thước lô:** `min(500, max(1, 200000 / số_cột))`.
- [X] T036 [P] [US3] Test `core/historian/tests/influx_line_test.cpp`: — **ghi chú khi làm:** xuống dòng trong chuỗi đổi thành dấu cách (giá trị trường line protocol không chứa được \n)
  - escape measurement (dấu phẩy, dấu cách), tag và tên trường (dấu phẩy, dấu bằng, dấu cách), chuỗi (`\`, `"`);
  - hậu tố `i`/`u`; BOOL `true/false`;
  - ô rỗng bỏ trường; dòng không còn trường thì bỏ dòng;
  - thời điểm ms;
  - chia lô theo 5000 dòng hoặc 1 MB.
- [X] T037 [P] [US3] Test `core/historian/tests/secrets_test.cpp` theo [device.md](contracts/device.md): — **ghi chú khi làm:** thêm test: ghi đè file sai quyền vẫn giữ các mục cũ; file hỏng thì từ chối ghi; mẫu id kết nối
  - đọc `{"schemaVersion","connections":{id: chuỗi}}`;
  - id không có → không có bí mật;
  - `mode & 0007 ≠ 0` → từ chối (lý do `permissions`); file > 64 KB → từ chối;
  - `writeSecret`: ghi file tạm rồi `rename`, quyền `0640` (bỏ qua `chown` khi không có group `matscada`);
  - bí mật không xuất hiện trong chuỗi lỗi.
- [X] T038 [P] [US3] Test `core/historian/tests/client_api_check_test.cpp` (x64, include header thật từ gói `-dev`):
  - `static_assert` hằng số tự khai báo bằng hằng số thật: `MYSQL_OPT_CONNECT_TIMEOUT`, `MYSQL_OPT_READ_TIMEOUT`, `MYSQL_OPT_WRITE_TIMEOUT`, `MYSQL_OPT_SSL_ENFORCE`, `MYSQL_OPT_SSL_VERIFY_SERVER_CERT`, `MYSQL_SET_CHARSET_NAME`, `CLIENT_FOUND_ROWS`, `DBSETHOST`, `DBSETUSER`, `DBSETPWD`, `DBSETAPP`, `DBSETCHARSET`, `DBSETENCRYPT`, `DBSETDBNAME`, `DBVERSION_74`, `SUCCEED`, `FAIL`, `NO_MORE_RESULTS`, `NO_MORE_ROWS`, `CONNECTION_OK`, `PGRES_COMMAND_OK`, `PGRES_TUPLES_OK`, các `CURLOPT_*` và `CURLINFO_RESPONSE_CODE` dùng tới, `CURL_GLOBAL_DEFAULT`;
  - `std::is_same` kiểu con trỏ hàm tự khai báo với `decltype(&hàm_thật)` cho mọi hàm dùng tới.
- [X] T039 [P] [US3] Test `core/historian/tests/error_class_test.cpp` theo bảng [system-info.md](contracts/system-info.md): — **ghi chú khi làm:** thêm mã MySQL 1049/1406, SQL Server 911/2628, PostgreSQL 08001/22001/3F000/57014 và classifyPgConnect (libpq không có SQLSTATE khi kết nối thất bại)
  - MySQL 1045 → `auth`, 2003 → `connect`, 2026 → `tls`, 1142 → `permission`, 1054 → `schema_mismatch`;
  - SQL Server 18456 → `auth`, 20009 → `connect`, 20003 → `timeout`, 207 → `schema_mismatch`;
  - PostgreSQL `28P01` → `auth`, `08006` → `connect`, `42501` → `permission`, `42703` → `schema_mismatch`;
  - HTTP 401 → `auth`, 404 → `schema_mismatch`, 503 → `http`;
  - lỗi curl kết nối/timeout/SSL → `connect`/`timeout`/`tls`;
  - câu tiếng Việt cố định, không chứa chuỗi gốc.
- [X] T040 [P] [US3] Test `core/historian/tests/forwarder_test.cpp` với `FakeDestination` (bộ nhớ): — **ghi chú khi làm:** Destination::batchRows nhận bảng (giới hạn theo byte); lastError xóa khi đích về ok; thêm test thread + notify + stop
  - đọc lô sau con trỏ từ `LocalStore`, gửi đúng thứ tự `seq`, tiến con trỏ;
  - nhiều nhóm trên cùng đích;
  - `syncSchema` gọi khi kết nối và khi cột đổi;
  - đích không có giao dịch (kiểu InfluxDB): con trỏ chuyển cho historian ghi vào `mat_forward`;
  - lỗi → trạng thái `error`, backoff 1, 2, 4 … 60 s (đồng hồ giả);
  - thiếu bí mật → `no_secret`; thiếu thư viện → `no_client`.

### Implementation for User Story 3

- [X] T041 [US3] Cài `core/historian/forward/sql_dialect.hpp/.cpp`, đạt T035.
- [X] T042 [US3] Cài `core/historian/forward/influx_line.hpp/.cpp`, đạt T036.
- [X] T043 [US3] Cài phần bí mật, đạt T037: — **ghi chú khi làm:** thêm server/tests/set_secret_test.cpp; --set-secret không có --secrets-file thì lấy secretsFile của runtime.json (--config)
  - `core/historian/secrets.hpp/.cpp`;
  - lệnh `--set-secret <id>` trong `server/cli/set_secret.hpp/.cpp`: đọc dòng đầu stdin; tắt echo bằng `termios` khi là TTY; chỉ chạy bằng root; `getgrnam("matscada")`; mã thoát 4 khi lỗi.
- [X] T044 [US3] Cài phần nạp động, đạt T038: — **ghi chú khi làm:** các hàm nạp nằm trong dyn_lib.cpp, một mutex chung cho mọi thư viện; client_api_check_test kiểm thêm việc nạp được 4 thư viện ở runtime
  - `core/historian/forward/dyn_lib.hpp/.cpp`: `dlopen` `${clientLibDir}/<soname>` rồi tới soname, `RTLD_NOW|RTLD_LOCAL`; thiếu symbol → thất bại;
  - khởi tạo toàn cục một lần dưới mutex: `mysql_server_init`, `dbinit`, `curl_global_init`;
  - `mysql_api.hpp`, `freetds_api.hpp`, `libpq_api.hpp`, `curl_api.hpp`.
- [X] T045 [US3] Cài interface `core/historian/forward/destination.hpp` (`connect`, `syncSchema`, `readCursor`, `writeBatch`, `close`, `transactional()`) và `error_class.hpp/.cpp`, đạt T039. — **ghi chú khi làm:** thêm sql_destination.{hpp,cpp}: phần chung của 3 đích SQL (đồng bộ lược đồ, đọc con trỏ); destination.cpp chọn đích theo loại
- [X] T046 [P] [US3] Cài `core/historian/forward/mysql_destination.cpp`: — **ghi chú khi làm:** tls prefer: thử SSL_ENFORCE trước, lỗi 2026 thì kết nối lại không TLS; verify-full thêm MYSQL_OPT_SSL_CA=/etc/ssl/certs/ca-certificates.crt; INSERT chia câu ≤ 1 MiB trong cùng giao dịch
  - timeout 5/30/30 s; `CLIENT_FOUND_ROWS`; `utf8mb4`;
  - `tls`: `prefer` thử bắt buộc trước, lỗi do máy chủ không có TLS thì kết nối lại không TLS; `require` = `SSL_ENFORCE`; `verify-full` cộng `VERIFY_SERVER_CERT`;
  - bảng `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`; escape bằng `mysql_real_escape_string`.
- [X] T047 [P] [US3] Cài `core/historian/forward/mssql_destination.cpp` (FreeTDS db-lib): — **ghi chú khi làm:** FreeTDS 1.1.6 không cài DBSETLENCRYPT (UNIMPLEMENTED): mỗi kết nối một mục trong freetds.conf do runtime sinh (FREETDSCONF, /tmp riêng của dịch vụ) với host, port, encryption off/request/require; dbopen theo tên mục; không dùng DBSETDBNAME (dbuse sau đăng nhập để lỗi 18456 không lẫn với 4060); cột không phải chuỗi đổi sang chữ bằng dbconvert
  - handler lỗi/thông điệp ghi vào biến `thread_local`;
  - login: user, pwd, app `mat-runtime`, charset `UTF-8`, `DBVERSION_74`, `DBSETLENCRYPT` khi `require`;
  - `dbopen(login, "host:port")`; `dbuse(database)`; `SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON`;
  - `schema` mặc định `dbo`; `dbsetlogintime(5)`, `dbsettime(30)`.
- [X] T048 [P] [US3] Cài `core/historian/forward/pg_destination.cpp` (libpq): — **ghi chú khi làm:** thêm client_encoding=UTF8, tcp_user_timeout=30000; lỗi kết nối không có SQLSTATE thì phân loại theo thông báo (classifyPgConnect)
  - `PQconnectdbParams` với `host`, `port`, `dbname`, `user`, `password`, `sslmode`, `sslrootcert=/etc/ssl/certs/ca-certificates.crt` (khi `verify-full`), `connect_timeout=5`, `application_name=mat-runtime`, `options=-c statement_timeout=30000`;
  - tên cột chữ thường; `schema` mặc định `public`; escape bằng `PQescapeLiteral`.
- [X] T049 [P] [US3] Cài `core/historian/forward/influx_destination.cpp` (libcurl): — **ghi chú khi làm:** connect gọi GET /ping (2.x: 204; 3.x: 200, có token) để biết sớm máy chủ/TLS; lỗi bucket và token lộ ra ở lần ghi đầu (404/401)
  - `POST /api/v2/write?org&bucket&precision=ms`, `Authorization: Token`;
  - `CURLOPT_TIMEOUT_MS=30000`, `CONNECTTIMEOUT_MS=5000`, `NOSIGNAL=1`;
  - TLS theo `tls` và URL; 204 là thành công;
  - con trỏ lưu trên thiết bị.
- [X] T050 [US3] Cài `core/historian/forward/forwarder.hpp/.cpp`, đạt T040: — **ghi chú khi làm:** con trỏ mọi đích trả về historian (InfluxDB: con trỏ thật; SQL: bản sao cho trạng thái); history.db được thay khi phục hồi file hỏng thì forwarder mở lại và kết nối lại
  - thread cho mỗi kết nối, kết nối SQLite chỉ đọc riêng;
  - lô theo `sql_dialect`; con trỏ: SQL đọc từ DB ngoài, InfluxDB đọc từ `mat_forward`;
  - thức dậy bằng biến điều kiện do historian báo sau mỗi commit, hoặc mỗi 1 s;
  - trạng thái nguyên tử: `state`, `pendingRows`, `lagS`, `sentRows`, `lastOkAt`, `lastError`.
- [X] T051 [US3] Nối forwarder vào `core/historian/historian.cpp` và `server/main.cpp`: — **ghi chú khi làm:** test HistorianForwarding (3 ca) trong historian_test.cpp; con trỏ lưu mỗi commitMs và khi dừng; readelf xác nhận mat-runtime không link thư viện client nào
  - tạo forwarder cho mỗi kết nối có nhóm trỏ tới;
  - historian ghi con trỏ InfluxDB nhận từ forwarder trong lần commit kế tiếp;
  - thứ tự dừng: historian commit → forwarder dừng.
- [X] T052 [US3] Dựng test tích hợp: — **ghi chú khi làm:** tạo DB, tài khoản và quyền do chính historian_it làm với quyền quản trị (root/sa/postgres) qua cùng code client, thay cho thư mục init/; historian_it đăng ký trong ctest và tự bỏ qua khi không có MAT_IT_*; kịch bản thêm: bucket không có → schema_mismatch
  - `tests/historian-it/compose.yaml`:
    - `mysql:8.4`;
    - `mcr.microsoft.com/mssql/server:2022-latest` (`ACCEPT_EULA=Y`);
    - `pgvector/pgvector:pg17`;
    - `influxdb:2.7` (`DOCKER_INFLUXDB_INIT_MODE=setup`);
    - mật khẩu và token lấy từ biến môi trường do script sinh ngẫu nhiên.
  - `tests/historian-it/init/`: tạo DB `scada` và user ghi cho từng máy chủ.
  - Binary `historian_it` (`core/historian/tests/historian_it.cpp`), chỉ chạy khi có biến `MAT_IT_*`. Kịch bản cho từng DB:
    - tạo bảng đúng kiểu;
    - 600 dòng dựng sẵn khớp giá trị, và `time` = giờ `+07:00`;
    - thêm Tag → thêm cột, dòng cũ `NULL`;
    - sai mật khẩu → `auth`, đích khác vẫn `ok`;
    - `tls=require` với MySQL và PostgreSQL;
    - kiểm `dbopen("host:port")` của FreeTDS;
    - user chỉ có quyền `INSERT/SELECT/UPDATE`, bảng do quản trị tạo sẵn đủ cột → gửi được; thiếu một cột → `permission`;
    - cột có sẵn sai kiểu (ví dụ kiểu số mà Tag gửi chuỗi) → `schema_mismatch`, đích khác vẫn `ok`;
    - nhóm 64 Tag chuỗi `maxLength` 255 tạo bảng được trên cả 4 DB.
  - Mở rộng `tools/historian-it.ps1`: `compose up --wait` → build x64 → chạy `historian_it` trong container toolchain trên mạng compose → `compose down` (trừ khi có `-Keep`).
- [X] T053 [US3] Chạy `tools/historian-it.ps1`, 4 loại DB `PASS`. Ghi SC-004 vào `docs/reports/003-acceptance.md`. Nếu FreeTDS không nhận `host:port` thì đổi cách theo research R7 và ghi chú khi làm. — **ghi chú khi làm:** 19/19 đạt; dbopen("host:port") chạy được nhưng phải đổi sang mục freetds.conf để bật mã hóa (xem T047)

**Checkpoint**: US3 chạy độc lập với 4 loại DB trên x64.

---

## Phase 6: User Story 4 — Mất kết nối DB ngoài không mất và không trùng dữ liệu (Priority: P2)

**Goal**: gửi bù đủ và đúng thứ tự sau khi mất kết nối, khởi động lại hay kill. DB chậm không ảnh hưởng việc ghi hay đích khác. Đếm dòng mất.

**Independent Test**: dừng máy chủ 30 phút (rút gọn bằng dữ liệu dựng sẵn) rồi bật lại → đủ 100 % dòng, 0 trùng. Kill 3 lần giữa lúc gửi → 0 trùng, 0 thiếu (SC-005).

- [X] T054 [P] [US4] Test bổ sung `core/historian/tests/forwarder_test.cpp`: — **ghi chú khi làm:** viết cùng lúc với T055, không chạy riêng bước đỏ; thêm test ForwarderPacing (hàm pauseAfter) và một đích treo không chặn status/notify/takeCursorUpdates
  - commit không rõ: `FakeDestination` đã commit rồi báo mất kết nối → sau khi kết nối lại đọc con trỏ từ đích, không gửi trùng;
  - commit thất bại thật → gửi lại đúng lô, không mất;
  - dòng bị xóa trên thiết bị trước khi gửi → `lostRows += min(seq) − con_trỏ − 1`, con trỏ được đẩy lên (SQL: giao dịch chỉ cập nhật con trỏ), chỉ tính một lần;
  - đích chặn 10 s không làm chậm `historian.runOnce` hay forwarder khác;
  - nhịp gửi bù: nghỉ ≥ 20 ms giữa các lô, ≤ 5000 dòng/s.
- [X] T055 [US4] Hoàn thiện `core/historian/forward/forwarder.cpp` (đẩy con trỏ khi mất dòng, nhịp gửi bù, kiểm timeout), đạt T054. — **ghi chú khi làm:** lô chỉ đẩy con trỏ khi mất dòng (SQL) chạy như một lô bình thường; nhịp gửi bù = max(20 ms, số dòng / 5000 dòng/s)
- [X] T056 [US4] Mở rộng `historian_tool` với lệnh `forward` (chạy forwarder tới khi gửi hết hoặc bị kill) và `verify` (so DB ngoài với SQLite: số dòng, trùng theo `time`, giá trị). — **ghi chú khi làm:** historian_tool thêm forward, verify, purge, fill --rows/--start-ms, cột theo kiểu Tag; các kịch bản gộp trong -Scenario reliability (một lần dựng 4 DB); mất kết nối mô phỏng bằng docker network disconnect (docker stop xóa dữ liệu tmpfs của MySQL/PostgreSQL)

  Thêm vào `tools/historian-it.ps1` các kịch bản:
  - `-Scenario outage`: `docker stop` máy chủ, fill 1800 dòng, `docker start`, đo thời gian gửi bù;
  - `-Scenario crash`: kill `forward` 3 lần, rồi `write-loop` + kill -9 10 lần + `integrity`;
  - `-Scenario lost`: thời hạn ngắn khi đích tắt → `lostRows`.
- [X] T057 [US4] Chạy các kịch bản trên với 4 loại DB. Ghi SC-005 và SC-008 (phần tự động) vào `docs/reports/003-acceptance.md`. — **ghi chú khi làm:** lần chạy đầu phát hiện forward của công cụ không có nhịp gửi nên kill không cắt ngang; sửa và chạy lại: đạt

**Checkpoint**: US3 và US4 cho dữ liệu đủ và không trùng khi gặp lỗi.

---

## Phase 7: User Story 5 — Cấu hình được kiểm trước khi chạy, có cảnh báo dung lượng ghi (Priority: P2)

**Goal**: 13 mã lỗi `E_LOG_*` và 2 cảnh báo `W_LOG_*` giống nhau ở TS và C++. Studio cho lưu khi chỉ còn cảnh báo `W_LOG_*`.

**Independent Test**: bộ vector `logging-*` cho cùng kết luận ở hai bản (SC-009). Mở `logging-warn-budget` trong Studio → có cảnh báo, nút Lưu vẫn bật.

- [X] T058 [P] [US5] Test vector: thêm vào `tests/project-vectors/generate.mjs` các vector còn lại của [logging-config.md](contracts/logging-config.md): — **ghi chú khi làm:** 60 vector; logging-valid dùng 8 kết nối đủ 4 loại và mọi tổ hợp tls hợp lệ; vectors.test.ts đòi đủ 13 mã E_LOG_* và cả 2 mã W_LOG_*
  - `logging-valid`, `logging-warn-budget` (200 Tag FLOAT32 `W.T001…W.T200`, mỗi 100 ms, thời hạn 1 ngày), `logging-warn-size-cap` (3 Tag, mỗi 1 s, 3650 ngày);
  - `logging-invalid-secret`, `-dup-id` (nhóm thứ hai đặt `table` riêng), `-ref-tag`, `-dup-tag`, `-ref-dest`, `-column-reserved`, `-column-dup`, `-table-dup`, `-deadband`, `-maxlen`, `-mode`, `-limit` (65 Tag `STRING`), `-conn`, `-tls`.

  Cập nhật danh sách mã bắt buộc trong `packages/project-schema/src/vectors.test.ts`: thêm 13 mã `E_LOG_*`, và mỗi `W_LOG_*` có ít nhất một vector. Chạy → **đỏ**.
- [X] T059 [P] [US5] Test công thức ước tính: — **ghi chú khi làm:** ví dụ 100 ms của contract ghi '≈ 7,8 GB/ngày' nhưng theo đúng công thức là 8 029 808 640 byte (≈ 8,0 GB), và một ngày dữ liệu đã 3,9 GB nên có thêm W_LOG_SIZE_CAP; test so số đúng công thức, contract đã sửa
  - `core/project-manager/tests/logging_estimate_test.cpp` và `packages/project-schema/src/logging.test.ts`;
  - cùng số cho hai ví dụ của contract: 500 FLOAT32 mỗi 1 s ≈ 0,99 GB/ngày, không cảnh báo; mỗi 100 ms ≈ 7,8 GB/ngày → `W_LOG_WRITE_BUDGET`;
  - `storageBytes` > 2 GiB → `W_LOG_SIZE_CAP`.
- [X] T060 [US5] Cài phía TS, đạt T058/T059 phía TS: — **ghi chú khi làm:** khóa bí mật: so theo 'chứa' (password, passwd, pwd, secret, token, apikey, api_key) không phân biệt hoa/thường; timeZone ở kết nối influxdb và schema ở kết nối mysql là trường của loại khác → E_LOG_CONN
  - `packages/project-schema/src/logging.ts`:
    - quét khóa bí mật trước schema (`password|passwd|pwd|secret|token|apikey|api_key`, không phân biệt hoa/thường) → `E_LOG_SECRET`;
    - luật `E_LOG_*` theo thứ tự contract; mục `E_LOG_DUP_TAG` không kiểm thêm `E_LOG_COLUMN`;
    - ước tính và `W_LOG_*`;
  - `codes.ts`: thêm mã lỗi, mở rộng `WarningCode`;
  - nối vào `validate.ts` và `rules.ts`.
- [X] T061 [US5] Cài phía C++, đạt T058/T059 phía C++, cùng thứ tự và cùng mã: — **ghi chú khi làm:** quét bí mật và ước tính ở logging_estimate.{hpp,cpp}; luật E_LOG_* trong project_validator.cpp; cả 60 vector cùng tập mã lỗi và cảnh báo với bản TS
  - `core/project-manager/logging_estimate.hpp/.cpp` (trong `mat_core`);
  - luật logging trong `core/project-manager/project_validator.cpp`.
- [X] T062 [US5] Runtime đưa mã `W_LOG_*` của project đang chạy vào `historian.warnings` (`server/main.cpp`). — **ghi chú khi làm:** làm cùng T066: main.cpp lấy W_LOG_* từ kết quả validator đưa vào HistorianInfoInput.warnings
- [X] T063 [P] [US5] Test `apps/studio/src/save-policy.test.ts`: hàm thuần `canSave(valid, warnings)` cho lưu khi chỉ còn `W_LOG_*`, chặn khi còn `W_UID_NOT_IN_SVG` hay lỗi. — **ghi chú khi làm:** thêm checkSummary (câu tóm tắt tab Kiểm tra) vào cùng module
- [X] T064 [US5] Cài `apps/studio/src/save-policy.ts`, đạt T063. Dùng trong `apps/studio/src/main.ts` (`runValidation`, `save`); tóm tắt ở tab Kiểm tra ghi rõ "cảnh báo dung lượng ghi (vẫn lưu được)". — **ghi chú khi làm:** test project-form cập nhật: xóa Tag mà cả binding và logging.json dùng → E_REF_TAG và E_LOG_REF_TAG

**Checkpoint**: `npm test`, `test-x64.ps1` xanh; cả hai bộ vector cùng kết luận.

---

## Phase 8: User Story 6 — Theo dõi lưu trữ và kiểm dữ liệu trên thiết bị (Priority: P3)

**Goal**: khối `historian` đầy đủ trong `system/info`, không lộ thông tin kết nối. Studio hiện tóm tắt. (Lệnh xuất CSV đã làm ở US1 vì cần cho kiểm chứng.)

**Independent Test**: gây lỗi một đích → `system/info` và tab Thiết bị hiện đích đó lỗi kèm lý do ngắn; quét JSON không thấy host, user, database, URL hay bí mật (SC-010).

- [X] T065 [P] [US6] Test `core/historian/tests/status_test.cpp`: — **ghi chú khi làm:** thêm test đầu-cuối: Historian với đích bị từ chối, chuỗi lỗi gốc có host/user/database/URL/mật khẩu → không chuỗi nào lọt vào JSON
  - JSON đúng [system-info.md](contracts/system-info.md): đủ trường, đúng kiểu, `enabled:false` khi không có cấu hình, `destinations[]`;
  - quét mọi giá trị chuỗi trong JSON: không chứa `host`, `user`, `database`, `url` của cấu hình hay bí mật.
- [X] T066 [US6] Cài `core/historian/status.hpp/.cpp` (`toJson`), dùng trong `server/main.cpp`, đạt T065. — **ghi chú khi làm:** core/historian/status.{hpp,cpp}: historianInfoJson(HistorianInfoInput, HistorianStatus); main.cpp chỉ còn dựng input
- [X] T067 [P] [US6] Test `apps/studio/src/device.test.ts` (bổ sung): hàm `historianSummary(info)` trả các dòng `state · rowsWritten · dbBytes/dbMaxBytes`, và mỗi đích `id · state · pendingRows · lagS · lastError.message`; `enabled:false` → "Không lưu trữ".
- [X] T068 [US6] Cài `apps/studio/src/device.ts` (kiểu `HistorianInfo`, `historianSummary`). Hiển thị trong tab Thiết bị (`apps/studio/src/main.ts`, `index.html`), đạt T067. — **ghi chú khi làm:** tab Thiết bị: dòng 'Lưu trữ' và mỗi đích một dòng 'DB ngoài'
- [X] T069 [US6] Kiểm Studio theo [quickstart.md](quickstart.md) §6 với runtime x64; ghi kết quả vào `docs/reports/003-acceptance.md`. — **ghi chú khi làm:** phần tự động: system/info thật của runtime x64 (2 đích lỗi) qua historianSummary; sửa hiển thị dung lượng nhỏ (KB thay vì 0.0 MB); phần bấm nút trong ứng dụng Studio cần người kiểm

**Checkpoint**: mọi user story chạy độc lập trên x64.

---

## Phase 9: Polish & nghiệm thu

- [X] T070 [P] Viết `docs/adr/008-data-logging.md` (SQLite bảng rộng, chính xác một lần qua `mat_forward_state`, `dlopen` client, secret trên thiết bị, ước tính chỉ cảnh báo) và thêm dòng vào `docs/adr/README.md`.
- [X] T071 [P] Cập nhật tài liệu: — **ghi chú khi làm:** LICENSES.md thêm mục client DB nạp động (MariaDB Connector/C và FreeTDS là LGPL, libpq, libcurl), sửa câu đầu chỉ nói về thư viện vendored; mat-runtime.md thêm mục 5a và lệnh xóa /var/lib/mat-runtime khi gỡ hẳn
  - `docs/deployment/mat-runtime.md`: thư mục dữ liệu, sao lưu `history.db`, xuất CSV, nhập secret, cài/gỡ gói client theo từng DB;
  - `third_party/LICENSES.md`: các client nạp động và license;
  - `schemas/README.md`: `logging.schema.json`;
  - `README.md`: lệnh `tools/historian-it.ps1`, `--export-history`.
- [X] T072 [P] Project đo tải `tests/historian-it/bench-500/`, sinh bằng `tests/historian-it/make-bench.mjs`: — **ghi chú khi làm:** schema cho tối đa 200 Tag mỗi nhóm nên 500 Tag mỗi giây chia 3 nhóm chu kỳ (sim-a/b/c); hai validator cùng cho hợp lệ kèm W_LOG_SIZE_CAP (~2,8 GB cho 7 ngày, đúng ước tính); eslint.config.mjs đã áp dụng cho mọi *.mjs nên chỉ thêm đường dẫn vào package.json
  - `tags.json`: 5 Tag bồn và `SIM.T0001…SIM.T0500` FLOAT32 `signal` `sim.load` (`MockTagProvider` dùng lại Tag đã có);
  - `logging.json`: nhóm `sim-500` chu kỳ 1000 ms gồm 500 Tag, nhóm `van-hanh` theo thay đổi, thời hạn 7 ngày;
  - thêm `tests/historian-it/*.mjs` vào glob `lint`/`format` của `package.json` và vào `eslint.config.mjs`.
- [X] T073 Review bảo mật (agent `agent-protocols:security-auditor`): — **ghi chú khi làm:** chạy thêm review code (agent `code-reviewer`), và cả hai review chạy hai vòng. Vòng đầu: review bảo mật 0 Critical/High, 4 Medium, 4 Low, 9 hardening; review code 2 Critical, 9 Important, 14 gợi ý. Vòng hai kiểm lại chính các bản sửa: review code 4 Important, 6 gợi ý; review bảo mật 3 Medium, 4 Low, 7 hardening. Đã sửa mọi Critical/Important/Medium/Low và các hardening, test trước. Vòng ba (review độc lập các bản sửa vòng hai, 2026-10-11): 4 Important, 4 Minor, đã sửa hết, test trước; trong đó có IT so-rồi-ghi con trỏ với giao dịch commit muộn thật ở cả 3 DB SQL. Người dùng chốt ngày 2026-10-10: chấp thuận ngoại lệ `synchronous=FULL` (Constitution 1.1.1) và để Claude chọn mặc định TLS (đã đổi sang `verify-full`). Còn lại ghi ở `docs/reports/003-acceptance.md` §6: S4; S5, S6 đo trên BL335
  - secrets; SQL injection (tên đối tượng, literal); đường dẫn `dlopen`;
  - lộ thông tin qua `system/info` và log;
  - CSV injection khi mở bằng Excel;
  - quyền file.

  Vá mức Critical/High; mục còn lại ghi vào báo cáo.
- [X] T074 Chạy `tools/ci-local.ps1`: clang-format, build armhf, x64 + ctest, Go, lint, typecheck, test, build web. Phải xanh. Build lại bộ cài Studio (`$env:CARGO_TARGET_DIR='C:\build\mat-studio'; npm run studio:build`). — **ghi chú khi làm:** xanh sau vòng ba và bản vá SQLite (ctest 350, Vitest 211, smoke armhf đạt). Sau vòng đầu, lần chạy đầu dừng ở lint vì 2 file TS chưa qua Prettier. Bộ cài Studio build lại lúc 2026-10-11 02:02, sau khi validator TS đổi mặc định TLS. CI có thêm bước `armhf smoke (qemu)` (2026-10-11): chạy runtime armhf dưới qemu-user với project có lưu trữ; bước này bắt được lỗi SQLite 32-bit mà x64 không thấy. Chạy lại cả 3 kịch bản tích hợp sau vòng ba, máy chủ mới tinh: forward 39/39, reliability đạt, retention đạt
- [X] T075 ⚠️🔌 **(cần người dùng cho phép)** Deploy lên BL335: — **ghi chú khi làm (2026-10-11, người dùng cho phép ngày 2026-10-10):** lần đầu bản mới dừng ngay khi mở `history.db` (`free(): invalid pointer`) và `deploy.sh` tự rollback. ASan armhf trên thiết bị chỉ ra lỗi tràn heap của SQLite 3.54.0 trên máy 32-bit; đã vá (`third_party/sqlite/PATCHES.md`), thêm bước CI `armhf smoke (qemu)` và lệnh `--check-history`. Lần hai đạt (`historian.state=running`, `/var/lib/mat-runtime` `matscada` 700). BL335 không có `sudo`: dùng `runuser -u matscada --`
  - gói runtime mới (`deploy.sh`), unit có `StateDirectory`;
  - kiểm `/var/lib/mat-runtime` thuộc `matscada`, `system/info.historian.state=running`;
  - ghi `docs/reports/device-changes.md`.
- [X] T076 ⚠️🔌 **(cần người dùng cho phép)** Đo SC-001 trên BL335 với `bench-500` và 10 client (`load-tester -clients 10 -tags sim -duration 1800` + `sample.sh`): RSS, CPU, số dòng, 0 mất sequence. Tính thêm độ lệch thời điểm của các dòng chu kỳ so với mốc lý thuyết từ CSV xuất ra (SC-002). Kết quả → `docs/reports/003-bench-*.csv/json`. — **ghi chú khi làm (2026-10-11):** đạt. 30 phút, 3 nhóm chu kỳ mỗi nhóm 1740/1740 dòng, lệch tối đa 71 ms, RSS tối đa 13,7 MB, CPU toàn hệ thống trung bình 11,7 %, 10 client 0 mất sequence (`docs/reports/003-bench-bl335-*`). Đo xong trả thiết bị về `tank-demo`
- [ ] T077 ⚠️🔌 **(cần người dùng cho phép)** Độ bền trên BL335: — **ghi chú khi làm (2026-10-11):** phần `kill -9` ×10 đạt (khởi động lại 3–4 s, `integrity: ok` cả 10 lần, không có dòng năm 1970; `docs/reports/003-bl335-kill.csv`). Còn cắt điện thật ≥ 3 lần: cần người ở cạnh thiết bị
  - `kill -9` 10 lần;
  - cắt điện thật ≥ 3 lần (người dùng làm);
  - sau mỗi lần, `--export-history` và `integrity` đều `ok`;
  - kiểm `historian.clock` sau mất điện, không có dòng năm 1970 (SC-008, FR-010).
- [X] T078 ⚠️🔌 **(cần người dùng cho phép, chỉ khi có DB ngoài trong LAN)**: — **ghi chú khi làm (2026-10-11):** chưa có DB thật trong LAN của thiết bị, nên thay bằng 4 máy chủ của test tích hợp trên máy dev, nối qua đường hầm SSH ngược. Phía thiết bị chạy thật: thư viện client, `--set-secret`, TLS `require`. Gửi 10 phút: SQL khớp đúng số dòng của thiết bị (2852 + 14), không trùng, không thiếu; InfluxDB đủ mọi dòng có dữ liệu. Đã cài và giữ `libmariadb3`, `libsybdb5`, `libpq5`, `libcurl4`; đã xóa bí mật thử. Gửi tới DB thật của người dùng: chờ thông tin kết nối
  - `apt install` gói client tương ứng;
  - `sudo mat-runtime --set-secret <id>`;
  - gửi thử 10 phút tới DB thật của người dùng;
  - ghi `device-changes.md`.
- [X] T079 Hoàn thiện `docs/reports/003-acceptance.md`: SC-001…SC-011 có số đo và đường dẫn file bằng chứng; mục chưa đo ghi "chưa đo" kèm lý do. Cập nhật mục lưu trữ trong `docs/plans/roadmap-v2.md`. — **ghi chú khi làm:** SC-001, SC-002 trên BL335 và cắt điện thật (SC-008) ghi "chưa đo": cần người dùng cho phép T075–T077

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → các user story.
- **US1 (Phase 3)** là nền của US2, US3, US4: cần `LocalStore`, `Historian` và lệnh xuất.
- **US2** chỉ cần US1.
- **US3** cần US1. **US4** cần US3.
- **US5** chỉ cần Phase 2; làm song song với US1–US4 được. Vector `logging-*` dùng chung file `generate.mjs` với T010 và T026 nên phải làm tuần tự.
- **US6** cần US1, cộng US3 cho phần `destinations`.
- **Polish** cần các story muốn nghiệm thu. T075–T078 cần người dùng cho phép.

### Within Each User Story

- Test (đỏ) → cài đặt (xanh) → nối vào `server/main.cpp` → kiểm chứng theo quickstart.
- Hàm thuần (sampler, `sql_dialect`, `influx_line`, `error_class`, `estimate`) trước phần có thread hay I/O.

### Parallel Opportunities

- Phase 1: T003, T004 song song.
- Phase 2: T005, T007, T013 song song; T009 trước T010.
- US1: T015–T018 song song (khác file test).
- US3: T035–T040 song song; T046–T049 song song (mỗi DB một file) sau T044/T045.
- US5: T058, T059, T063 song song.
- US6: T065, T067 song song.

---

## Parallel Example: User Story 3

```text
# Test (viết trước, cùng lúc):
Task: "Test core/historian/tests/sql_dialect_test.cpp"
Task: "Test core/historian/tests/influx_line_test.cpp"
Task: "Test core/historian/tests/secrets_test.cpp"
Task: "Test core/historian/tests/client_api_check_test.cpp"
Task: "Test core/historian/tests/error_class_test.cpp"
Task: "Test core/historian/tests/forwarder_test.cpp"

# Bốn đích (sau dyn_lib + destination.hpp):
Task: "core/historian/forward/mysql_destination.cpp"
Task: "core/historian/forward/mssql_destination.cpp"
Task: "core/historian/forward/pg_destination.cpp"
Task: "core/historian/forward/influx_destination.cpp"
```

---

## Implementation Strategy

### MVP

1. Phase 1 + 2.
2. US1 (lưu trên thiết bị). **Dừng và kiểm** theo quickstart §2.
3. US2 (dọn và trần): cùng mức P1, bảo vệ thiết bị trước khi chạy lâu dài.
4. US3 (gửi DB ngoài): yêu cầu trực tiếp của người dùng.

Ba story P1 này là bản tối thiểu dùng được cho người dùng.

### Incremental Delivery

- US4: độ tin cậy khi lỗi mạng hay crash.
- US5: luật kiểm đầy đủ và cảnh báo.
- US6: theo dõi.
- Polish + đo trên BL335 (cần cho phép).

Mỗi bước giữ `test-x64.ps1` và `npm test` xanh.

---

## Notes

- `[P]` = khác file, không phụ thuộc task chưa xong.
- Task có sai lệch so với kế hoạch: thêm "**ghi chú khi làm:**" ngay trong task (như tasks.md của 002).
- Không commit khi người dùng chưa yêu cầu. Làm trên nhánh `003-data-logging`.
