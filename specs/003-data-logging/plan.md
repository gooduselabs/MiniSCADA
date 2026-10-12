# Implementation Plan: Lưu trữ dữ liệu Tag trên thiết bị và chuyển tiếp sang DB ngoài

**Branch**: `003-data-logging` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-data-logging/spec.md`

## Summary

`mat-runtime` lưu giá trị Tag theo các nhóm do người dùng khai báo trong `logging.json` của project.

- **Ghi trên thiết bị:** mỗi lần ghi là một dòng **bảng rộng**, vào SQLite vendored trên BL335.
- **Bảo vệ bộ nhớ:** tự xóa theo số ngày, có trần dung lượng và ngưỡng trống.
- **Chuyển tiếp** sang MySQL/MariaDB, SQL Server, PostgreSQL, InfluxDB:
  - bảng rộng tự tạo, tự thêm cột;
  - cột thời gian theo giờ địa phương (mặc định UTC+7);
  - **chính xác một lần** nhờ bảng con trỏ nằm trong chính DB ngoài, cập nhật cùng giao dịch.
- **Client DB nạp động (`dlopen`):** runtime chạy được khi thiếu thư viện; LGPL không bị link tĩnh.
- **Validator hai bản** (TS, C++) kiểm `logging.json` với 13 mã lỗi mới và 2 mã cảnh báo ước tính ghi eMMC (không chặn).
- **Trạng thái** hiện trong `system/info` và tab Thiết bị của Studio.

Chi tiết quyết định: [research.md](research.md) R1–R16.

## Technical Context

**Language/Version**:
- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`);
- TypeScript (validator dùng chung, Studio);
- PowerShell và Node cho công cụ.

**Primary Dependencies**:
- Mới, vendored: SQLite 3.54.0 amalgamation (public domain).
- Mới, nạp lúc chạy (không link):
  - `libmariadb.so.3` (MariaDB Connector/C 3.1, LGPL-2.1);
  - `libsybdb.so.5` (FreeTDS 1.1.6, LGPL);
  - `libpq.so.5` (PostgreSQL License);
  - `libcurl.so.4` (curl license).
- Có sẵn: nlohmann/json, valijson, CivetWeb, GoogleTest; `@cfworker/json-schema` ở phía TS.
- Image toolchain thêm `libmariadb-dev`, `freetds-dev`, `libpq-dev`, `libcurl4-openssl-dev` (amd64), chỉ để kiểm API và chạy test tích hợp.

**Storage**: SQLite WAL `${dataDir}/history.db` (mặc định `/var/lib/mat-runtime`). DB ngoài của khách hàng là đích tùy chọn.

**Testing**:
- GoogleTest + CTest (x64 Docker): sampler, local store, sinh SQL, line protocol, forwarder với đích giả, secrets, kiểm API client với header thật.
- Vitest: validator TS và vector dùng chung.
- Tích hợp opt-in `tools/historian-it.ps1`: `mysql:8.4`, `mcr.microsoft.com/mssql/server:2022-latest`, `pgvector/pgvector:pg17`, `influxdb:2.7`.
- Đo trên BL335 (cần người dùng cho phép).

**Target Platform**: BL335 (armv7l, Ubuntu 20.04.5, systemd 245, eMMC, RTC không đọc được); x64 Docker để test.

**Project Type**: dịch vụ nhúng C++ (mở rộng `mat-runtime`), thư viện TS dùng chung, ứng dụng desktop (Studio, sửa nhỏ).

**Performance Goals**:
- 500 Tag/nhóm ghi mỗi 1 s cộng 10 client live: CPU trung bình ≤ 30 %, RSS ≤ 150 MB;
- dòng chu kỳ lệch ≤ ± 250 ms;
- dòng tới DB ngoài ≤ 10 s;
- gửi bù 30 phút dữ liệu trong ≤ 10 phút.

**Constraints**:
- SQLite cache ≤ 32 MB (dùng 8 MB);
- ghi eMMC ≤ 2 GB/ngày ở cấu hình chuẩn (vượt thì chỉ cảnh báo);
- mất điện mất ≤ `historianCommitMs`;
- `system/info` công khai nên không lộ thông tin kết nối;
- giữ sandbox systemd hiện có;
- ổ D: máy dev còn khoảng 1 GB (SQLite amalgamation khoảng 9 MB).

**Scale/Scope**: ≤ 32 nhóm, ≤ 200 Tag/nhóm, ≤ 8 kết nối, 1 thiết bị mỗi bảng ngoài.

## Constitution Check

*GATE: kiểm trước Phase 0, kiểm lại sau Phase 1.*

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị trước | ✅ (cần đo) | Chạy trên BL335; cấu hình JSON viết tay; editor Studio để giai đoạn 5. SC-001/008 đo trên thiết bị, cần người dùng cho phép deploy |
| II. Ranh giới kiến trúc | ✅ | Historian nằm trong `core/historian`, chỉ đọc `TagStore` qua hàm snapshot mới; driver không đụng DB. Trình duyệt không truy cập DB. Validator dùng chung `packages/project-schema` (Studio không có logic runtime riêng) |
| III. Ngân sách tài nguyên | ✅ (cần đo) | Cache SQLite 8 MB; ghi gom 5 s; thời hạn lưu, trần 2 GB, ngưỡng trống 500 MB; ước tính ghi trong validator. Thêm ≤ 9 thread. Đo SC-001 trên BL335 |
| IV. Chrome + 10 client | ✅ | Không thêm phiên live. Phiên Studio xem trước vẫn tính vào 10 |
| V. An toàn mặc định | ✅ | Secret chỉ trên thiết bị (`0640`); validator từ chối khóa giống secret; `system/info` chỉ có mã lỗi đã phân loại. Tên bảng/cột theo allowlist ký tự và luôn được trích dẫn; giá trị escape bằng hàm của client. Hỗ trợ TLS (`require`/`verify-full`). Không `eval`. `dlopen` chỉ từ `clientLibDir` (root sở hữu) và đường dẫn hệ thống. Runtime không kích hoạt project có `logging.json` lỗi |
| VI. Test-first | ✅ | Test viết trước cho sampler, store, SQL, line protocol, forwarder, secrets, validator (vector chung). Có test tích hợp với 4 DB thật và test kill/integrity |
| VII. Đơn giản, có phiên bản (1.1.0) | ✅ | Đúng các điều kiện đã thêm: SQLite trước, thời hạn + trần, đích ngoài tùy chọn, bảng rộng, giờ địa phương, secret trên thiết bị, LGPL nạp động, vượt ngân sách chỉ cảnh báo. Schema `logging` `0.1.0`; runtime `0.3.0` |
| Ràng buộc công nghệ | ✅ | C++17/CMake/Ninja/cross armhf; SQLite WAL `synchronous=NORMAL` đúng Constitution; riêng giao dịch xóa mốc gửi chạy `FULL` (ngoại lệ người dùng chấp thuận ngày 2026-10-10, Constitution 1.1.1). License: public domain, LGPL (nạp động), PostgreSQL, curl, ghi `third_party/LICENSES.md` |
| Quy trình | ✅ | Spec Kit. Thao tác thiết bị (deploy, `apt install`, `set-secret`) chỉ khi người dùng cho phép, ghi `device-changes.md`. ADR mới: ADR-008 (lưu trữ dữ liệu) |

**Kết quả:** đạt. Có 4 điểm cần biện minh, ghi ở Complexity Tracking. Kiểm lại sau Phase 1 (data model, contracts): không phát sinh vi phạm mới. Bảng `mat_forward_state` trong DB khách hàng đã được ghi rõ trong contract và quyền tối thiểu.

## Project Structure

### Documentation (this feature)

```text
specs/003-data-logging/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── logging-config.md      # logging.json, mã lỗi E_LOG_*, cảnh báo W_LOG_*, công thức, vector
│   ├── external-schema.md     # bảng ở 4 loại DB, kiểu cột, giao dịch chính xác một lần, InfluxDB
│   ├── device.md              # runtime.json mới, secrets.json, thư mục dữ liệu, lệnh CLI, gói client
│   └── system-info.md         # khối historian, phân loại lỗi
├── checklists/requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
third_party/sqlite/                   # sqlite3.c, sqlite3.h 3.54.0 (+ LICENSES.md)
schemas/
├── logging.schema.json               # mới
└── project.schema.json               # + loggingFile (tùy chọn)

core/
├── tag-engine/tag_store.*            # + snapshot(indices, out) (một lần khóa)
├── project-manager/project_validator.*   # + logging: schema, luật E_LOG_*, cảnh báo W_LOG_*, warnings
├── project-manager/logging_estimate.*    # công thức ước tính (trong mat_core: validator và historian cùng dùng)
└── historian/
    ├── logging_config.*              # logging.json đã validate → model (mặc định table/column…)
    ├── clock.*                       # mốc build, độ lệch ±HH:MM, định dạng giờ địa phương, căn chu kỳ
    ├── sampler.*                     # quyết định ghi (hàm thuần): cyclic/onChange/deadband/min/max/nhảy giờ
    ├── local_store.*                 # SQLite: mở/tạo, bảng rộng, thêm cột, commit, dọn, trần, file hỏng
    ├── historian.*                   # thread: lấy mẫu → đệm → commit → bảo trì; trạng thái
    ├── secrets.*                     # đọc/ghi secrets.json, kiểm quyền
    ├── forward/
    │   ├── dyn_lib.*                 # dlopen/dlsym, khởi tạo toàn cục một lần
    │   ├── mysql_api.hpp, freetds_api.hpp, libpq_api.hpp, curl_api.hpp   # API tự khai báo
    │   ├── sql_dialect.*             # DDL/DML/literal theo từng DB (hàm thuần)
    │   ├── influx_line.*             # line protocol (hàm thuần)
    │   ├── destination.hpp           # interface đích: connect, syncSchema, readCursor, writeBatch
    │   ├── mysql_destination.*, mssql_destination.*, pg_destination.*, influx_destination.*
    │   ├── error_class.*             # phân loại lỗi → code/câu tiếng Việt
    │   └── forwarder.*               # thread gửi theo đích: đọc lô, gửi, con trỏ, backoff, lostRows
    └── tests/                        # unit + client_api_check_test + historian_it (tích hợp)

server/
├── main.cpp                          # + historian/forwarder, khối historian trong system/info, dừng gọn
├── config.*                          # + dataDir, secretsFile, clientLibDir, historian*; --data-dir, --secrets-file
└── cli/                              # --export-history, --set-secret (lib mat_cli, tách khỏi core)

packages/project-schema/src/          # + logging.ts (types, luật, ước tính), codes.ts (E_LOG_*, W_LOG_*)
apps/studio/src/                      # main.ts (cho lưu khi chỉ còn W_LOG_*; tóm tắt historian ở tab Thiết bị)
projects/tank-demo/                   # + logging.json (2 nhóm, không đích ngoài); minRuntimeVersion 0.3.0
tests/project-vectors/generate.mjs    # + vector logging-*, trường warnings
tests/historian-it/                   # compose + project/secret mẫu cho test tích hợp
tools/historian-it.ps1                # dựng 4 DB, chạy historian_it, kịch bản crash/retention
deployment/
├── toolchain/Dockerfile              # + gói -dev amd64 (kiểm API, test tích hợp)
├── toolchain/run-x64.ps1             # + -DataDir
├── systemd/mat-runtime.service       # + StateDirectory
└── device/deploy.sh, rollback.sh     # bảo đảm không đụng /var/lib/mat-runtime, secrets.json
docs/
├── adr/008-data-logging.md
├── deployment/mat-runtime.md         # + lưu trữ, secrets, gói client
└── reports/                          # số đo 003
```

**Structure Decision:** Logic lưu trữ nằm trong `core/historian`, độc lập CivetWeb và độc lập thread như các module Sprint 1, để unit test không cần mạng. Phần nói chuyện với DB ngoài tách thành hai lớp:
- **phần sinh câu lệnh** (`sql_dialect`, `influx_line`): hàm thuần, test hết bằng unit;
- **phần gọi thư viện** (`*_destination` qua `dyn_lib`): mỏng, test bằng tích hợp.

Công thức ước tính nằm ở `core/project-manager/logging_estimate.*` (trong `mat_core`), để validator C++ và historian cùng dùng mà không tạo vòng phụ thuộc giữa `mat_core` và `mat_historian`. Lệnh CLI nằm ở lib riêng `mat_cli` (`mat_historian` không phụ thuộc `server/`).

### Ghi chú thiết kế chính

- **Thread:**
  - `ticker` (có sẵn) gồm `provider.step()` rồi `hub.tick()`;
  - `historian` (mới) mỗi 100 ms: snapshot nhóm → `Sampler` → đệm dòng → commit mỗi `historianCommitMs` → bảo trì (dọn ≤ 20 ms/lượt, trần và ngưỡng trống mỗi phút) → ghi con trỏ InfluxDB do thread gửi chuyển sang → báo các thread gửi;
  - `forward-<id>` (mới, mỗi kết nối một thread) gồm kết nối đọc SQLite riêng (chỉ đọc) và client DB riêng.
- **Bộ nhớ:** đệm ≤ 10.000 dòng; lô gửi ≤ 200.000 ô; cache SQLite 8 MB; thư viện client chỉ nạp khi có đích loại đó.
- **Dừng:** khi `SIGTERM`, historian commit đệm. Thread gửi dừng sau lô hiện tại (timeout client ≤ 30 s, timeout kết nối 5 s), nên `mat-runtime` thoát trong ≤ 35 s, dưới mặc định 90 s của systemd.
- **Tương thích:** project không có `loggingFile` chạy như Sprint 1. Runtime 0.2.0 gặp project có `loggingFile` thì báo `E_SCHEMA` (từ chối an toàn). `RUNTIME_VERSION` lên `0.3.0`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Thêm 1 thread historian và tối đa 8 thread gửi | FR-020: DB ngoài chậm hay treo không được chặn việc ghi trên thiết bị hay đích khác | Ghi và gửi trên thread `ticker`: DB treo làm đứng cập nhật live. Một thread gửi chung: một đích treo chặn mọi đích |
| Nạp động 4 thư viện client (`dlopen`) với API tự khai báo | FR-022/030: runtime chạy khi thiếu thư viện. Constitution VII: LGPL nạp động. Không cần gói `-dev` armhf | Link trực tiếp: thiếu thư viện là không khởi động được. Rủi ro khai báo sai được chặn bằng `client_api_check_test` (`static_assert` với header thật) |
| Tạo bảng `mat_forward_state` trong DB của khách hàng | FR-017: chính xác một lần; dữ liệu và con trỏ chỉ ghi nguyên tử khi nằm cùng DB | Con trỏ trên thiết bị: crash giữa hai bước thì trùng một lô. Khóa duy nhất theo `time`: cú pháp khác nhau ở từng DB và hỏng khi đồng hồ lùi |
| Vendor SQLite amalgamation (khoảng 9 MB mã nguồn) | Hành vi giống nhau x64/armhf/Buildroot; không phụ thuộc 3.31 của OS | Dùng `libsqlite3` hệ thống: phiên bản khác nhau giữa môi trường, khó tái lập lỗi |
