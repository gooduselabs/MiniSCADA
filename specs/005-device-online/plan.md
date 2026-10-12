# Implementation Plan: Làm việc với thiết bị từ Studio

**Branch**: `005-device-online` | **Date**: 2026-10-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-device-online/spec.md`

## Summary

Phần thiết bị của GĐ 1 ([lộ trình v2](../../docs/plans/roadmap-v2.md) §4.1). Kỹ sư:

- tìm BL335 trong LAN, hoặc thêm theo địa chỉ;
- kết nối HTTPS có ghim fingerprint, đăng nhập theo role;
- nạp xuống project qua bước xem trước và tiến trình từng bước, tự rollback khi lỗi;
- đọc lên, so sánh theo đối tượng, xem chẩn đoán và audit.

Constitution V bắt buộc HTTPS, đăng nhập, phân quyền và audit có trước API nạp xuống, nên phần bảo mật làm trước.

Cách làm ([research.md](research.md) R1–R19):

- **Tìm thiết bị:**
  - UDP broadcast có hướng, cổng 8446;
  - gói hỏi đệm đúng 1024 byte, gói trả lời không bao giờ dài hơn (chống khuếch đại);
  - thiết bị chỉ trả lời nguồn cùng subnet, có giới hạn tần suất, tắt được.
- **HTTPS trên runtime:**
  - Mbed TLS 3.6.7 (LTS) vendored, link tĩnh, cộng bản vá handshake có hạn cho CivetWeb;
  - context HTTPS riêng ở cổng 8443; trang xem giữ HTTP 8080 như cũ (FR-033);
  - chứng chỉ ECDSA P-256 tự sinh ở lần chạy đầu.
- **Studio nói chuyện với thiết bị qua Rust:**
  - rustls với verifier ghim SHA-256 của chứng chỉ (vẫn kiểm chữ ký bắt tay), reqwest, tokio-tungstenite;
  - token chỉ nằm trong Rust;
  - mã của 004 chỉ thêm adapter (`createSocket`, `fetch` đã tiêm được).
- **Đăng nhập, phân quyền:**
  - Argon2id (m = 19 MiB, t = 2);
  - tài khoản ở `/etc/mat-runtime/users.json`, chỉ lệnh root ghi;
  - token bearer, phiên 30 phút rảnh và tối đa 12 giờ, gắn IP;
  - khóa 5 phút sau 5 lần sai, theo tài khoản và theo IP;
  - một bảng quyền theo role.
- **Audit:** SQLite riêng `audit.db`, `synchronous=FULL` (ngoại lệ, chờ người dùng chấp thuận); giữ 365 ngày, trần 64 MiB, gộp từ chối để chống ngập.
- **Gói `.matscada`:**
  - ZIP tập con chặt, tự viết ở C++ và Rust, cùng bộ vector;
  - manifest có SHA-256 từng file; digest tính theo nội dung, không phụ thuộc cách nén.
- **Nạp xuống:**
  - kho project trong `/var/lib/mat-runtime/projects`, tách khỏi gói runtime;
  - chuỗi upload → kiểm gói → kiểm project → sao lưu → kích hoạt → kiểm tra sức khỏe;
  - kích hoạt bằng `state.json` (rename) cộng `execv`;
  - kiểm tra sức khỏe ở tiến trình mới, tự rollback;
  - giữ 3 bản dự phòng; mỗi lúc một thao tác.
- **Client tải lại:** giao thức live 1.1.0 (`hello.project.digest`, mã đóng 1012).
- **So sánh:** `packages/project-schema/src/compare.ts`, theo file rồi theo đối tượng; ký hiệu `= ≠ + -` trên cây; đọc lên phần chọn thành sửa đổi hoàn tác được.

Quyết định ghi trong ADR [010](../../docs/adr/010-device-discovery-https.md), [011](../../docs/adr/011-auth-roles-audit.md), [012](../../docs/adr/012-project-package-deploy.md) (Proposed).

## Technical Context

**Language/Version**:

- C++17 (GCC 9 trong Docker Ubuntu 20.04; cross `arm-linux-gnueabihf`);
- TypeScript 7 (Vite 8);
- Rust 1.99, edition 2024 (Tauri 2.12);
- PowerShell, Node và sh cho công cụ.

**Primary Dependencies** (phiên bản, license: research R19):

- **Mới, C, vendored, link tĩnh:** Mbed TLS 3.6.7 (Apache-2.0), phc-winner-argon2 20190702 (CC0-1.0 hoặc Apache-2.0), miniz 3.1.2 (MIT, chỉ `tinfl` và CRC32).
- **Mới, Rust:** rustls 0.23.45 + ring 0.17.14, tokio-rustls 0.26.5, tokio-tungstenite 0.30.0, if-addrs 0.15.0, zeroize 1.9.0.
- **Có sẵn, bật thêm feature:** reqwest 0.13.5, flate2 1.1.10, tokio, uuid.
- **Có sẵn:** CivetWeb 1.16 (thêm bản vá cục bộ thứ ba), SQLite 3.54.0, nlohmann/json, valijson; Tauri 2, sha2, serde_json; `@mat/project-schema`, `@mat/live-client`.
- TS không thêm phụ thuộc.

**Storage**:

- **Thiết bị:**
  - `/var/lib/mat-runtime/`: `audit.db`, `projects/` (kho project), `tls/server.pem`, `device-id`;
  - `/etc/mat-runtime/users.json`;
  - `/run/mat-runtime/auth-state.json` (tmpfs);
  - `history.db` của 003 không đổi.
- **Studio:** `%APPDATA%\vn.com.atpro.matstudio\devices.json`; gói tạm trong thư mục cache của ứng dụng.

**Testing**:

- GoogleTest + CTest (x64 Docker); smoke armhf trên qemu-user;
- Vitest (vector chung TS); e2e Chrome headless với lớp Tauri giả; `cargo test`;
- tích hợp x64 `tools/device-it.ps1` (mạng Docker riêng: nạp xuống đầu-cuối, giết tiến trình ≥ 20 lần, tìm thiết bị, client tải lại);
- đo và cắt điện trên BL335 ở task ⚠️🔌 (cần người dùng cho phép).

**Target Platform**:

- BL335: armv7l, 2 × Cortex-A7, 993 MB RAM, Ubuntu 20.04.5, systemd 245, eMMC, RTC không đọc được;
- Studio: Windows 10/11 x64, WebView2.

**Project Type**: dịch vụ nhúng C++ (mở rộng `mat-runtime`), ứng dụng desktop Tauri (Rust + TS), package TS dùng chung.

**Performance Goals**:

| Mục tiêu | Ngưỡng | Nguồn |
|---|---|---|
| Tìm thiết bị trong LAN | ≤ 3 s | FR-001, SC-001 |
| Một lần đăng nhập trên BL335 | ≤ 1 s (mục tiêu 0,3–0,8 s) | SC-007 |
| Nạp xuống project < 1 MB qua LAN, gồm kiểm tra sức khỏe | ≤ 15 s (ước tính 5–8 s) | SC-006 |
| Client Chrome tải lại sau kích hoạt | ≤ 10 s (ước tính 2–5 s) | FR-025 |
| Chẩn đoán cập nhật | ≤ 5 s | FR-032 |

**Constraints**:

- So với runtime 0.3.0: RSS khi rảnh tăng ≤ 10 MB, CPU khi rảnh tăng ≤ 2 điểm (SC-007). Ước tính: +1,5–3 MB, < 0,5 điểm.
- Tải chuẩn vẫn ≤ 150 MB RSS, ≤ 30 % CPU (Constitution III).
- Ghi eMMC ≤ 2 GB/ngày: audit ≤ 150 MB/ngày ngay cả khi bị tấn công liên tục.
- Gói ≤ 50 MiB. Một thao tác nạp xuống tại một thời điểm.
- Giữ sandbox systemd: không thêm `AF_NETLINK`, không thêm capability.
- Không bí mật trong gói và gói tìm thiết bị.
- Thư viện mới phát hành ≥ 2 tuần trước ngày chọn.
- Ổ D: máy dev còn khoảng 4,2 GB.

**Scale/Scope**:

- Thiết bị và Studio: ≤ 10 thiết bị mỗi LAN; ≤ 64 thiết bị đã lưu; ≤ 64 tài khoản; ≤ 32 phiên.
- Gói và kho: ≤ 1024 file mỗi gói; 3 bản dự phòng; audit ≤ 64 MiB.
- Khoảng 30 module C++ mới, 13 lệnh thiết bị mới, 24 lệnh Tauri mới, 7 hộp thoại hoặc editor Studio mới.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution 2.0.0.

| Nguyên tắc | Đánh giá | Ghi chú |
|---|---|---|
| I. Vertical slice trên thiết bị thật | ✅ (cần đo) | Runtime làm trước, Studio dùng định dạng runtime đã chạy. Mọi chức năng chạy trên x64 và qemu armhf trước; nghiệm thu trên BL335 thật ở task ⚠️🔌 |
| II. Ranh giới kiến trúc | ✅ | Trình duyệt không truy cập PLC. So sánh, digest, tập file của project nằm trong `packages/project-schema` (dùng chung). Bộ kiểm tra C++ chạy trên thiết bị, bộ TS ở Studio, như cũ. Rust chỉ vận chuyển và đọc/ghi định dạng gói; bản Rust và C++ dùng chung bộ vector (cùng cách làm với expression engine). `core/` không include CivetWeb hay UI: auth, audit, gói, kho, tìm thiết bị đều test được không cần mạng |
| III. Ngân sách tài nguyên | ✅ (cần đo) | Ước tính ở research R17. Đỉnh +19 MiB khi băm mật khẩu, từng lần một. Đo trên BL335 trước khi đánh dấu xong |
| IV. Chrome, 10 client | ✅ | Hai listener dùng chung transport: 10 phiên tính tổng. Studio vẫn 1 phiên. Trang xem (Chrome ≥ 120) chỉ thêm tự tải lại khi project đổi |
| V. An toàn, bảo mật (NON-NEGOTIABLE) | ✅ | API nạp xuống chỉ chạy trên HTTPS, có phiên, role engineer, và chỉ chạy sau khi ghi được audit. Gói tìm thiết bị không có bí mật. Gói project chống ZIP bomb và path traversal, có checksum, schema, kiểm bí mật. Bộ kiểm tra chạy ở cả hai phía; runtime không kích hoạt project lỗi. Không `eval`. Ghi Tag chưa có. Trang xem HTTP không đăng nhập là đúng Constitution vì chưa có thao tác ghi (FR-033) |
| VI. Test trước | ✅ | Danh sách test viết trước theo FR-036. Vector chung cho gói, gói tìm, digest, tập file. Tích hợp x64: nạp xuống đầu-cuối, giết tiến trình ≥ 20 lần, tìm thiết bị trong mạng thử |
| VII. Đơn giản, có phiên bản | ✅ | Đúng phạm vi GĐ 1. Không có quản lý tài khoản trong Studio, cập nhật runtime qua mạng, IPv6, nháy LED. SemVer: runtime `0.4.0`, giao thức live `1.1.0`, API thiết bị `1.0.0`, gói `1.0.0`. Deploy atomic: stage → validate → backup → activate → health check → rollback |
| Ràng buộc công nghệ | ⚠️ | C++17/CMake/Ninja/armhf, CivetWeb: giữ. License: Apache-2.0, CC0, MIT, ISC; không LGPL. Log thường vẫn ghi tmpfs; audit ghi eMMC (đúng Constitution). **Điểm vướng:** `audit.db` cần `synchronous=FULL` để FR-015 (audit bền khi mất điện). Đây là ngoại lệ mới của quy tắc SQLite. Theo Constitution, ngoại lệ mới cần lý do và ADR (ADR-011); ngoại lệ trước còn được người dùng chấp thuận và ghi vào Constitution 1.1.1. Ghi ở Complexity Tracking, câu hỏi 1 |
| Quy trình | ✅ | Spec Kit. Thao tác trên BL335 chỉ khi người dùng cho phép; ghi `device-changes.md`. ADR 010–012 |

**Kết quả trước Phase 0:** đạt có điều kiện. Một ngoại lệ có lý do và ADR, chờ người dùng chấp thuận trước khi làm phần audit. Không còn `NEEDS CLARIFICATION`.

**Kiểm lại sau Phase 1** (data-model, contracts):

- Không phát sinh vi phạm mới.
- **Bề mặt mạng mới:**
  - cổng 8443/tcp: mọi API kỹ thuật cần phiên, trừ `device/identity` và đăng nhập;
  - cổng 8446/udp: chỉ trả lời gói cố định, không parse JSON.
- **Quyền:**
  - runtime không ghi được tài khoản (`/etc/mat-runtime` chỉ đọc);
  - lệnh root ghi audit qua tiến trình con đã hạ quyền.
- **Unit:** chỉ thêm `RuntimeDirectory`.
- **Studio:** CSP chặt hơn (bỏ `http: ws:`); token không vào WebView.
- Ngoại lệ `synchronous=FULL` vẫn là điểm duy nhất cần người dùng chốt.

## Project Structure

### Documentation (this feature)

```text
specs/005-device-online/
├── spec.md
├── plan.md                       # file này
├── research.md                   # R1–R19
├── data-model.md                 # thực thể trên thiết bị và trong Studio, máy trạng thái
├── quickstart.md                 # test, tích hợp x64, Studio, BL335 ⚠️🔌
├── contracts/
│   ├── device-api.md             # HTTP API của thiết bị 1.0.0
│   ├── discovery.md              # gói tìm thiết bị
│   ├── matscada-package.md       # định dạng gói 1.0.0, digest, mã lỗi E_PKG_*
│   ├── device-config.md          # runtime.json, file, unit, lệnh, deploy.sh
│   ├── live-protocol-1.1.md      # hello.project.digest, mã đóng 1012
│   └── tauri-commands.md         # lệnh Rust ↔ giao diện, DeviceLink
├── checklists/requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
third_party/
├── mbedtls/                          # Mbed TLS 3.6.7: include/, library/, LICENSE
├── mbedtls-config/mat_mbedtls_config.h
├── argon2/                           # phc-winner-argon2 20190702: argon2.c, core.c, ref.c, encoding.c, blake2/
├── miniz/                            # miniz 3.1.2 (chỉ tinfl + CRC32)
├── civetweb/mod_mbedtls.inl          # + mAT patch 3: handshake có hạn; patch 4: close_notify là EOF, kiểm mbedtls_ssl_setup
└── LICENSES.md                       # + 3 thư viện, bản vá 3, 4
schemas/package-manifest.schema.json  # mới

core/                                 # mỗi module một thư viện CMake (mat_crypto, mat_audit, mat_auth, mat_package,
│                                     # mat_project_store, mat_discovery, mat_diag); mat_device (INTERFACE) gom lại
├── crypto/                           # sha256, random (getrandom), so sánh hằng thời gian, base64url, hex (bọc Mbed TLS)
├── auth/                             # password_hash (Argon2id, PHC), account_store, session_store, login_guard, roles, auth_service
├── audit/                            # audit_log: SQLite FULL, gộp, trần, thời hạn, truy vấn; audit_actions (danh mục hành động)
├── package/                          # zip_reader, zip_writer (stored), manifest, digest, package_check, extract
├── project-store/                    # store (state.json, v/<seq>, nhận project cũ), boot_decision, deploy_pipeline, health_check
├── diagnostics/                      # proc_stats (/proc, statvfs), cửa sổ CPU 1 phút
├── discovery/                        # discovery_proto (hàm thuần: parse, trả lời, tần suất, subnet), iface_table (ioctl)
└── project-manager/project_validator.*   # + LoadedProject::files(); digest cho activeJson, hello, system/info

server/
├── main.cpp                          # 2 context, luồng tìm thiết bị, quyết định lúc khởi động, kiểm sức khỏe, execv
├── config.*                          # khóa mới
├── tls/server_cert.*                 # sinh, đọc, fingerprint (Mbed TLS)
├── http/
│   ├── http_api.*                    # + digest, khối device, handler HTTPS_REQUIRED trên HTTP
│   ├── auth_gate.*                   # TLS → phiên → role → audit
│   └── engineering_api.*             # auth, identity, diagnostics, project, deployments, restore, audit
├── websocket/civet_transport.*       # cài trên 2 context; đóng 1012 trước execv
├── discovery/discovery_server.*      # socket UDP, IP_PKTINFO, luồng
├── cli/                              # users, cert, audit, project, package, auth-bench
└── tests/tls_test_support.*          # chứng chỉ thử sinh lúc chạy, client libcurl (chỉ cho test)

deployment/
├── systemd/mat-runtime.service       # + RuntimeDirectory
├── device/deploy.sh                  # validate project trong kho; tài khoản admin lần đầu; in fingerprint
├── device/tests/deploy_rollback_test.sh   # + kịch bản có kho
├── toolchain/Dockerfile              # + curl, openssl (chỉ để test; binary thiết bị không link)
├── toolchain/run-x64.ps1             # + -HttpsPort, file tài khoản
└── toolchain/smoke-armhf.sh          # + TLS, đăng nhập, nạp xuống, execv

tests/
├── package-vectors/                  # gói hợp lệ, độc; digest
├── discovery-vectors/
├── project-vectors/                  # + tập file của project
└── device-it/                        # kịch bản tích hợp x64: compose.yaml, supervise.sh, client Node;
                                      # bản x64 build với -DMAT_TEST_HOOKS=ON (cờ giết/treo theo bước)
tools/
├── device-it.ps1
└── measure/device-api.mjs            # đăng nhập, nạp xuống, tải lại (Node, ghim fingerprint)

packages/
├── project-schema/src/               # package-digest.ts, project-files.ts, compare.ts (+ test)
└── live-client/src/connection.ts     # 1012 thử lại nhanh; state.ts: hello.project.digest
apps/runtime-web/src/reload.ts        # tải lại khi digest đổi (nối vào main.ts)

apps/studio/
├── src/platform/                     # device-types.ts, tauri-device.ts, mock-device.ts
├── src/model/
│   ├── device-session.ts             # (sửa) chế độ online, đăng nhập, lỗi mới
│   ├── device-adapters.ts            # fetch, SocketLike dựa trên DeviceLink
│   ├── discovery.ts  download-flow.ts  compare-view.ts
│   └── tree.ts                       # (sửa) ký hiệu = ≠ + -
├── src/app/commands.ts               # (sửa) bật lệnh 005; thêm đăng nhập, đăng xuất, khôi phục, audit
├── src/ui/dialogs/                   # thiết bị trong mạng, ghim, đăng nhập, nạp xuống, khôi phục
├── src/ui/editors/                   # compare-editor.ts, audit-view.ts
├── src/ui/diagnostics.ts             # (sửa) tab Chẩn đoán của Inspector: CPU, RAM, dung lượng, số phiên
├── src/i18n/vi-online.ts             # chuỗi của 005, theo cách tách vi-tags, vi-device, vi-logging của 004
└── src-tauri/
    ├── Cargo.toml  tauri.conf.json   # crate mới (dev: rcgen sinh chứng chỉ thử); CSP
    └── src/
        ├── lib.rs                    # đăng ký lệnh 005
        ├── device/                   # mod, registry, tls (PinnedVerifier), http, live, session, deploy
        ├── discovery.rs
        └── package/                  # mod, zip, manifest, extract

docs/
├── adr/010-device-discovery-https.md, 011-auth-roles-audit.md, 012-project-package-deploy.md
├── deployment/mat-runtime.md         # + HTTPS, tài khoản, kho project, rollback qua mốc 0.4.0
└── reports/005-acceptance.md
```

**Structure Decision:**

- **Thiết bị:** logic mới nằm trong `core/` thành module độc lập CivetWeb và độc lập luồng (auth, audit, gói, kho, tìm thiết bị, chẩn đoán), như cách 003 làm với historian, để unit test không cần mạng. `server/` chỉ nối CivetWeb, socket và lệnh.
- **Hàm thuần có test trước:** `discovery_proto`, `zip_reader`, `boot_decision` (bảng quyết định lúc khởi động), máy trạng thái `deploy_pipeline` (bước chạy qua giao diện tiêm được).
- **Studio:** phần mạng và định dạng gói ở Rust (`device/`, `package/`, `discovery.rs`). Phần quyết định ở TS thuần: phiên, luồng Nạp xuống, so sánh. Giao diện chỉ hiển thị.
- **Dùng chung:** so sánh, digest, tập file nằm trong `packages/project-schema` (Constitution II).

### Ảnh hưởng tới mã của feature 004

| File | Thay đổi |
|---|---|
| `apps/studio/src/platform/types.ts` | giữ `Platform`; giao diện mới `DeviceLink` ở file riêng (contracts/tauri-commands.md §9) |
| `apps/studio/src/model/device-session.ts` | thêm `mode: monitor \| online`, `deviceId`, `auth`; các bước dò, ghim, đăng nhập trước `connecting`; mã lỗi mới. Giữ option `createSocket`, `fetch`: 24 test của T016 chạy nguyên |
| `apps/studio/src/model/device.ts` | thêm `normalizeHttps`; `checkDevice` giữ chữ ký |
| `apps/studio/src/app/commands.ts` | `online.devices`, `online.download`, `online.upload`, `online.compare` hết khóa "Có ở feature 005"; thêm lệnh mới |
| `apps/studio/src/model/tree.ts` | ký hiệu so sánh trên nút |
| Mô hình tài liệu (004 data-model §3) | tài liệu không sửa được theo đối tượng (lưu trữ, màn hình, binding, SVG) nhận "nội dung chờ ghi" để đọc lên phần chọn hoàn tác được |
| `apps/studio/src-tauri/{Cargo.toml, src/lib.rs, tauri.conf.json}` | crate, lệnh, CSP |
| `packages/live-client` | xử lý 1012; giao diện công khai không đổi |
| Mockup Nạp xuống | bỏ ô "Lưu kèm nguồn project": gói luôn là toàn bộ nguồn (research R12) |

## Thứ tự làm (gợi ý cho `/speckit-tasks`)

1. **Nền bảo mật trên thiết bị** (không đụng file của 004; làm ngay):
   - vendor Mbed TLS, Argon2, miniz; cập nhật CMake;
   - `core/crypto`; context HTTPS, chứng chỉ, bản vá 3 cho CivetWeb;
   - `core/audit`, `core/auth`, `auth_gate`; lệnh tài khoản và chứng chỉ;
   - tìm thiết bị; chẩn đoán.

   **Mốc:** HTTPS, đăng nhập, phân quyền và audit chạy được trên x64 và qemu **trước khi** viết route nạp xuống (Constitution V).
2. **Gói và kho trên thiết bị:**
   - `core/package` cùng bộ vector; kho, nhận project cũ, quyết định lúc khởi động;
   - chuỗi nạp xuống, khôi phục, `execv`, kiểm tra sức khỏe;
   - giao thức live 1.1.0 và trang xem tự tải lại;
   - `deploy.sh`, unit; tích hợp x64; smoke armhf.
3. **Studio Rust:** tìm thiết bị, danh sách thiết bị, ghim TLS, HTTP, cầu nối live, đóng gói, kiểm gói, giải nén, theo dõi nạp xuống. Phần lớn là file mới. `Cargo.toml` và `lib.rs` phối hợp với phiên đang làm 004.
4. **Studio TS:** bắt đầu sau khi 004 xong T071 và các task giao diện chạm cùng file.
   - `DeviceLink` và bản giả; `DeviceSession` chế độ online; hộp thoại thiết bị, ghim, đăng nhập;
   - luồng Nạp xuống; so sánh, editor So sánh, ký hiệu trên cây; khôi phục;
   - tab Chẩn đoán, xem Audit; siết CSP.
5. **BL335 ⚠️🔌**, khi người dùng cho phép: quickstart §6.

**Theo user story:**

| Story | Gồm |
|---|---|
| US1 (P1) | bước 1, phần tương ứng của bước 3 và 4 |
| US2 (P1) | bước 2 và phần nạp xuống của bước 3 và 4 |
| US3 (P2) | đọc lên, so sánh |
| US4 (P3) | chẩn đoán, xem audit |

Bước 1 và 2 làm song song được với 004.

**Phụ thuộc US2 → US3** (analyze C2, ghi 2026-10-11): bước xem trước của Nạp xuống cần đọc gói đang chạy và so sánh với project trên máy (FR-020). Vì vậy phần dùng chung làm trong US2:
- route `GET /project/manifest`, `GET /project/package` (T109, T110);
- lệnh `device_fetch_package` (T116, T117);
- `compare.ts` (T118, T119).

US3 dùng lại các phần này, chỉ thêm giao diện đọc lên và editor So sánh. US3 không làm độc lập được trước US2.

## Câu hỏi cho người dùng

**Đã trả lời 2026-10-11** (người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11; ghi ở T012):

1. **Chấp thuận** ngoại lệ `synchronous=FULL` cho `audit.db`: Constitution lên 2.0.1 (PATCH). Không dùng phương án B.
2. **Làm việc từ xa:** hỗ trợ cả VPN lẫn port-forward, khuyến nghị VPN hoặc đường hầm SSH; thiết bị và Studio không tự mở cổng nào. Không mở port-forward cho HTTPS theo mặc định. Cổng 9080 (trang xem chỉ đọc, chưa đăng nhập) giữ tới GĐ 2, khi ghi Tag bắt buộc đăng nhập; tài liệu triển khai ghi khuyến nghị đóng 9080 ra Internet khi không cần xem từ xa.
3. **Đồng ý** Argon2id thay PBKDF2 và token phiên trong header; cookie `HttpOnly` + CSRF để GĐ 2.
4. **Cho phép** phiên làm việc làm các task trên BL335 qua SSH và web: cài runtime 0.4.0 bằng `deploy.sh`, tạo tài khoản quản trị (mật khẩu sinh ngẫu nhiên, chỉ lưu ngoài repo), đo RSS, CPU, thời gian đăng nhập, nạp xuống/đọc lên; làm việc từ xa qua đường hầm SSH. Mọi thay đổi ghi `docs/reports/device-changes.md` kèm cách hoàn tác; không đụng `atscada-*`, `piano-edtech-*`. **Không làm được từ xa:** cắt điện thật (cần người ở cạnh thiết bị) và tìm thiết bị từ một máy Windows cùng LAN (máy dev ở xa): thay bằng kịch bản `device-it` trên mạng Docker và ghi là hạn chế của nghiệm thu.
5. **Giữ 15 ký tự** (NIST SP 800-63B-4).

Nội dung câu hỏi gốc giữ dưới đây để tra cứu.


1. **Ngoại lệ `synchronous=FULL` cho `audit.db`.** FR-015 yêu cầu audit không mất khi mất điện. Với `synchronous=NORMAL` (quy tắc hiện tại), các bản ghi cuối có thể mất. Đồng ý thêm ngoại lệ thứ hai vào Constitution ("Ràng buộc công nghệ", PATCH 2.0.1), như ngoại lệ của 003?
   - Lượng ghi thêm: dưới 3 MB/ngày khi vận hành thường; tối đa khoảng 150 MB/ngày khi bị tấn công liên tục.
   - Không đồng ý thì dùng phương án B: file audit nối đuôi + `fdatasync`, không đụng quy tắc SQLite, nhưng lọc và xóa cũ phải tự viết.
2. **Quyết định 5 (làm việc từ xa).** Mặc định của plan: hỗ trợ kỹ thuật cả VPN lẫn port-forward, khuyến nghị VPN, không tự mở cổng nào.
   - Có cần mở port-forward cho HTTPS (ví dụ 9443 → 8443) để nạp xuống từ xa không, hay chỉ qua VPN?
   - Cổng 9080 → 8080 (trang xem, chưa đăng nhập) hiện đang mở ra Internet: giữ tới GĐ 2, hay đóng?
3. **Hai điểm khác lộ trình §4.1** (người dùng đã duyệt lộ trình):
   - băm mật khẩu bằng **Argon2id** thay PBKDF2: PBKDF2 theo mức khuyến nghị hiện hành ước mất khoảng 2 s trên BL335, vượt SC-007;
   - Studio gửi token phiên trong **header**. Cookie `HttpOnly` + CSRF để GĐ 2, khi trang web cần đăng nhập.

   Đồng ý?
4. **Thử trên BL335 (⚠️🔌).** Khi tới task, cho phép:
   - cài runtime 0.4.0 bằng `deploy.sh`, đặt mật khẩu quản trị;
   - đo RSS, CPU và thời gian đăng nhập;
   - ≥ 3 lần cắt điện thật: cần người ở cạnh thiết bị;
   - tìm thiết bị trong LAN: cần một máy Windows cùng LAN với BL335, vì máy dev đang ở xa.

   Ai làm, khi nào?
5. **Độ dài mật khẩu tối thiểu.** Plan đặt 15 ký tự, theo NIST SP 800-63B-4 (bản cuối 2025-08) khi mật khẩu là yếu tố xác thực duy nhất. Giữ 15, hay hạ xuống 12 cho dễ dùng (bù bằng khóa tạm và VPN)?

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `synchronous=FULL` cho `audit.db`: ngoại lệ mới của "Ràng buộc công nghệ" (**đã chấp thuận, Constitution 2.0.1, 2026-10-11**) | FR-015: audit của thao tác đã báo thành công không được mất khi mất điện | `NORMAL` mất các bản ghi cuối khi mất điện. File nối đuôi + `fdatasync` phải tự viết lọc, phân trang, xóa cũ (giữ làm phương án B, câu hỏi 1) |
| Vendor Mbed TLS (khoảng 6 MB mã nguồn) và thêm bản vá thứ ba cho CivetWeb | HTTPS là điều kiện của Constitution V. Cổng có thể ra Internet, nên cần TLS còn được vá, không phụ thuộc OS. Nhánh Mbed TLS của CivetWeb 1.16 quay CPU không hạn khi bắt tay | OpenSSL 1.1.1 của Ubuntu 20.04 đã hết hỗ trợ. OpenSSL 3 vendored quá lớn với máy dev và build chéo |
| Hai context CivetWeb trong một tiến trình | HTTPS lỗi hay bị tấn công không được làm hỏng trang xem đang vận hành | Một context hai cổng: lỗi TLS làm `mg_start` lỗi cả trang xem; chung thread pool |
| Kích hoạt bằng `execv`, phiên đi qua bằng file tmpfs | Dùng lại đường khởi động đã kiểm (T063); trùng đường phục hồi sau mất điện | Đổi project ngay trong tiến trình: sửa lớn `main.cpp`, `TagStore`, `LiveHub`, historian; dễ race |
| Tự viết bộ đọc/ghi ZIP ở hai ngôn ngữ (C++, Rust) | Cùng luật chặt ở hai phía, bề mặt tấn công nhỏ (Constitution V) | Thư viện ZIP đầy đủ: nhiều tính năng thừa (ZIP64, mã hóa); không bảo đảm hai phía cùng luật |
| Chuyển kết nối thiết bị của Studio xuống Rust (sửa mã 004, siết CSP) | WebView2 không ghim được chứng chỉ tự ký; token không được vào WebView | Tắt kiểm chứng chỉ cho WebView: mất an toàn cho mọi kết nối |
| Thêm thư viện Argon2 dù Mbed TLS có PBKDF2 | Khuyến nghị hiện hành (OWASP). PBKDF2 600.000 vòng ước khoảng 2 s trên BL335, vượt SC-007 | PBKDF2 ít vòng: yếu trước tấn công bằng GPU |
