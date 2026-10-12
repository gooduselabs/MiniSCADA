# Báo cáo nghiệm thu — 005 Làm việc với thiết bị (Phase 2: Mốc bảo mật)

Spec: [specs/005-device-online/spec.md](../../specs/005-device-online/spec.md). Ngày: 2026-10-12. Phần 1 đến 7: Phase 2 (T054). Phần 8 đến 10: US2–US4 trên x64, review, việc còn mở (T126, T127, T140, T150, T153; T152, T157, T166 chưa xong, xem mục 10).

**Phạm vi của lần kiểm này:** Phase 2 (nền bảo mật) và phần tìm thiết bị phía runtime của US1. US1 phía Studio, US2–US4 chưa kiểm ở đây, nên các SC về nạp xuống, đọc lên, so sánh ghi "chưa tới". Mọi số đo là x64 (Docker Desktop trên máy dev) hoặc armhf dưới qemu-user. **Chưa có số đo nào trên BL335:** các task ⚠️🔌 chưa làm vì SSH tới thiết bị đang bị chặn (mục 5).

**Trạng thái Checkpoint "Mốc bảo mật" (Constitution V):** đạt ngày 2026-10-12, xem mục 6.

## Tóm tắt theo tiêu chí

| SC | Nội dung | Kết quả | Bằng chứng |
|---|---|---|---|
| SC-001 | Tìm thấy thiết bị ≤ 3 s, 10/10 lần trong LAN; thêm theo địa chỉ qua VPN hoặc port-forward | **Đạt phần logic trên x64**: 2 runtime trả lời trong 3–50 ms, runtime tắt tìm thiết bị im lặng. **Chưa đo trong LAN thật** (T162) và qua VPN (T163) | [005-discovery-x64.json](005-discovery-x64.json) |
| SC-002 | Đọc lên ngay sau nạp xuống: digest giống 10/10, 3 project | **Chưa tới** (US2, US3) | — |
| SC-003 | 100 % gói hỏng và độc bị từ chối | **Chưa tới** ở mức tích hợp (US2, kịch bản `packages`). Bộ vector gói có test riêng của d1 | — |
| SC-004 | Giết tiến trình hoặc cắt điện ở từng bước nạp xuống | **Chưa tới** (US2, T161) | — |
| SC-005 | Chưa đăng nhập và thiếu quyền bị từ chối 100 %, có audit; sai 5 lần thì khóa; mật khẩu không lộ | **Đạt trên x64** (mục 2). Trên qemu armhf mới chạy phần đăng nhập, audit và tìm chuỗi; từ chối và khóa tạm chưa chạy (mục 3). Tìm chuỗi trên BL335 (T164) chưa làm | [005-auth-x64.json](005-auth-x64.json), [005-secrets-x64.json](005-secrets-x64.json) |
| SC-006 | Nạp xuống ≤ 15 s, client tải lại ≤ 10 s | **Chưa tới** (US2) | — |
| SC-007 | BL335: RSS khi rảnh +≤ 10 MB, CPU +≤ 2 điểm; đăng nhập ≤ 1 s | **Chưa đo trên BL335** (T055, T159). Tham khảo trên x64: xem bảng ngay dưới | mục 2 |
| SC-008 | Chức năng 004 và Sprint 1 vẫn đạt; trang xem không đổi hành vi | **Đạt phần trang xem HTTP**: `HttpsApi.HttpListenerServesThePageAsBefore`, `system/info` qua HTTP 200 không cần đăng nhập. Bộ test 004 phía Studio không chạy lại ở lần kiểm này | mục 1 |
| SC-009 | Một kỹ sư làm trọn vòng ≤ 5 phút | **Chưa tới** (T165) | — |

Số đo tham khảo cho SC-007 trên x64:

- RSS khi rảnh 8,1 MiB;
- CPU khi rảnh 0 % trong 10 s;
- đăng nhập Argon2id thật (m = 19 MiB, t = 2) trung vị 66 ms, chỉ phần request;
- `--auth-bench` dưới qemu-arm: t = 2 cho 310 ms (T047). qemu không đại diện cho BL335.

| FR | Kiểm | Kết quả |
|---|---|---|
| FR-003 | chỉ trả lời nguồn cùng subnet, giới hạn tần suất, gói trả lời ≤ gói hỏi | **Đạt**: nguồn ngoài subnet (có đối chứng đường về) và cổng nguồn 53 không được trả lời; 5 gói hỏi/s → 3 trả lời; trả lời 484 byte |
| FR-004 | tắt được tìm thiết bị | **Đạt**: rt3 `--no-discovery` im lặng, `system/info.device.discovery = false` |
| FR-006 | khóa và chứng chỉ riêng, sinh ở lần chạy đầu, chỉ runtime đọc được, giữ qua khởi động lại | **Đạt**: `server.pem` `0600` (qemu armhf); `docker restart` không đổi fingerprint (quickstart §2); hai runtime có fingerprint khác nhau |
| FR-007 | API kỹ thuật chỉ qua HTTPS | **Đạt**: qua HTTP 403 `HTTPS_REQUIRED`, có audit `access.denied` (x64) |
| FR-009 | lệnh in fingerprint | **Đạt**: `--cert-fingerprint` trùng `openssl s_client` (armhf), trùng `device/identity` (x64) |
| FR-010, FR-011 | tài khoản cục bộ, tạo bằng lệnh trên thiết bị | **Đạt** (`--user-add --password-stdin`). Phát hiện: BOM ở đầu stdin được nhận làm ký tự của mật khẩu (mục 4) |
| FR-012 | phiên, đăng xuất | **Đạt**: `idleTimeoutS` 1800, `maxLifetimeS` 43200; sau `logout`, `session` 401 |
| FR-013 | khóa tạm 5 lần sai, theo tài khoản và địa chỉ; lỗi không nói sai gì | **Đạt**: lần 6 với mật khẩu đúng 429 `AUTH_LOCKED`, `retryAfterS` 300; cùng tên từ địa chỉ khác cũng 429; mọi lần sai cùng `AUTH_FAILED` |
| FR-014 | quyền theo role | **Đạt**: viewer → `project/versions` 403; engineer → `audit` 403; administrator → `audit` qua cổng kiểm |
| FR-015 | audit | **Đạt**: `auth.login` ok/failed, `auth.lockout`, `auth.locked`, `auth.logout`, `access.denied` (https, http), `cert.generate`, `account.*` |
| FR-033 | trang xem HTTP giữ như cũ | **Đạt** (xem SC-008) |
| FR-034 | RSS, CPU trong ngân sách trên BL335 | **Chưa đo trên BL335**. x64: rảnh 0 %, 8 kết nối HTTPS treo +0,1–0,2 điểm |

## 1. Test tự động

| Lớp | Kết quả |
|---|---|
| `test-x64.ps1` cả bộ | **chưa chạy xong**: ổ C: hết chỗ giữa lúc build, Docker Desktop ngừng (mục 6). Lần chạy cả bộ gần nhất: 983/983 (c1, T047), trước khi đổi keep-alive sang 15 s |
| `HttpsApi.*` (`-Target https_api_test`) | 23/23, gồm test mới `IdleKeepAliveConnectionClosesAfter15s`: đỏ với keep-alive 60 s (kết nối còn mở sau 30 s), xanh với 15 s (đóng sau 15,0 s) |
| `cargo test --lib` (`apps/studio/src-tauri`) | 88/88; `cargo clippy --all-targets -D warnings`, `cargo fmt --check` sạch. `timeouts_follow_the_research` đỏ với `pool_idle_timeout` 30 s, xanh với 10 s |
| `smoke-armhf.sh` (qemu-arm, `C:\build\mat-armhf-e2`) | bản T053 (chứng chỉ, fingerprint, đăng nhập, audit): `armhf smoke: OK`. Phần thêm sau (401/403, khóa tạm, `auth.lockout`): **chưa chạy** (mục 3, 6) |
| `tools/device-it.ps1 -Scenario auth,tls-idle,secrets,discovery` | 4/4 đạt (mục 2) |
| Prettier, ESLint (`.mjs` mới), clang-format (C++ đã sửa), `sh -n` (script mới) | sạch |

## 2. Tích hợp x64: `tools/device-it.ps1`

Khung: `tests/device-it/compose.yaml`.

- Mạng `lan` 172.30.5.0/24: rt1, rt2, rt3 (tắt tìm thiết bị). Mạng `other` 172.30.6.0/24.
- Runtime x64 dưới `supervise.sh`, như `Restart=always`.
- Client Node 22 dùng chung PID namespace với rt1 để đo CPU và RSS.
- Mật khẩu thử ngẫu nhiên mỗi lần chạy, không ghi file.

| Kịch bản | Kiểm | Kết quả chính |
|---|---|---|
| `auth` | 37 | Xem các dòng FR-007, FR-012–FR-015 ở trên. Ghim sai: `cert-mismatch` ngay sau bắt tay, thiết bị không nhận request nào (không có dòng audit mới). Bắt tay TLS 1.3 16 ms, đăng nhập trung vị 66 ms |
| `tls-idle` | 7 | Xem bảng dưới |
| `secrets` | 4 + tìm chuỗi | 5 chuỗi (3 mật khẩu, 1 mật khẩu sai, 1 mật khẩu gõ vào ô tên) không có trong 10 file của `/logs`, `/data`, `/run/mat-runtime`, `/etc/mat-runtime`, và không có trong `docker logs`. Đối chứng: chuỗi mồi được tìm thấy |
| `discovery` | 15 | Xem FR-003, FR-004. Mạng thứ hai đi qua NAT của Docker (thiết bị thấy 172.30.5.1, cùng subnet), nên chỉ ghi thành số đo; nguồn ngoài subnet dùng địa chỉ phụ 10.99.0.50, có đối chứng đường về |

**`tls-idle`**, 8 kết nối vào 8443 (`httpsThreads` = 8):

| Trường hợp | CPU runtime | RSS | Bị đóng sau | Client thứ 9, gửi lúc 2 s |
|---|---|---|---|---|
| Rảnh, đối chứng 10 s | 0 % | 8,1 MiB | | |
| TCP im lặng, không bắt tay | +0,1 điểm | 8,1 MiB | 10,0 s (cả 8) | chờ 8,0 s, rồi 200 |
| Bắt tay xong, 1 request keep-alive, rồi im | +0,2 điểm | 8,1 MiB | 14,6–15,0 s | chờ 12,6 s, rồi 200 |

**Quyết định 2026-10-12:**

- keep-alive của HTTPS hạ từ 60 s xuống 15 s;
- `pool_idle_timeout` của Studio hạ từ 30 s xuống 10 s.

Lý do: với 60 s, 8 máy trong LAN giữ hết worker tới một phút. Rủi ro còn lại (chiếm worker 10–15 s mỗi lần) được chấp nhận và ghi ở [ADR-010](../adr/010-device-discovery-https.md).

## 3. armhf dưới qemu: `deployment/toolchain/smoke-armhf.sh`

Ngoài phần lưu trữ của 003, smoke kiểm thêm:

- **Chứng chỉ:** lần chạy đầu sinh `tls/server.pem` `0600` và mở 8443. `--cert-fingerprint` trùng từng byte kết quả `openssl s_client | openssl x509 -fingerprint -sha256`.
- **Tài khoản và đăng nhập:** tài khoản `smoke` (engineer) tạo bằng `--password-stdin`, mật khẩu ngẫu nhiên. `curl -k` đăng nhập lấy được token, role engineer.
- **Từ chối:**
  - không token → 401;
  - engineer → `audit` 403;
  - API kỹ thuật qua HTTP → 403;
  - 5 lần sai, rồi mật khẩu đúng → `AUTH_LOCKED`.
- **Audit:** `audit.db` có `auth.login ok` và `auth.lockout`.
- **Mật khẩu:** không có trong dữ liệu, file tài khoản hay log.

**Trạng thái:** các phần Chứng chỉ, Tài khoản và đăng nhập, `auth.login ok` và Mật khẩu đã chạy: `armhf smoke: OK`. Phần Từ chối, khóa tạm và dòng `auth.lockout` được viết sau, đúng lúc Docker ngừng, nên **chưa chạy lần nào**.

Kiểm phần đỏ (bản đã chạy): ba biến thể sửa ở scratchpad (sai mật khẩu, tìm sai dòng audit, đòi mode khác) đều làm smoke báo lỗi đúng chỗ.

## 4. Quickstart §2 (trừ nạp xuống)

Chạy `run-x64.ps1 -Port 18080 -HttpsPort 18443 -NoDiscovery`. Dùng cổng khác mặc định để không đụng container của phiên khác.

| Mong đợi | Kết quả |
|---|---|
| `system/info`: `device.https = "ok"`, `httpsPort`, `project.digest` bắt đầu bằng `sha256:` | đạt (`ok`, 18443, `sha256:9ba112c6…`) |
| lần chạy đầu sinh `server.pem`; chạy lại container thì fingerprint không đổi | đạt (`certificate (new)`, rồi sau `docker restart` cùng `CF:1D:90:…:54:C4`) |
| `curl -sk https://…/api/v1/diagnostics` → 401 `AUTH_REQUIRED` | đạt |
| `curl -s http://…/api/v1/diagnostics` → 403 `HTTPS_REQUIRED`, audit `access.denied` | đạt (audit có `access.denied` channel `http`, code `HTTPS_REQUIRED`) |
| `node tools/measure/device-api.mjs https://localhost:18443 --fingerprint <fp> --user admin` | đạt: `login` 200 (65 ms; bắt tay 41 ms), `session` 200, `logout` 204. Ghim sai: mã 3, `cert-mismatch` |

Ghi chú:

- Bước tạo tài khoản của quickstart dùng `docker exec -it` (nhập trên terminal). Lần kiểm này không có terminal, nên tài khoản tạo bằng `--password-stdin`.
- `device-api.mjs` chưa có lệnh nạp xuống, đọc lên (US2).

**Phát hiện (chuyển cho phiên chính):** khi đưa mật khẩu vào `--user-add --password-stdin` qua pipe của Windows PowerShell 5.1 (`"…" | docker exec -i …`), dòng nhận được có BOM UTF-8 ở đầu. Lệnh nhận BOM làm ký tự đầu của mật khẩu và báo thành công, rồi đăng nhập bằng mật khẩu đã gõ bị `AUTH_FAILED`. Cách gặp thật: quản trị viên dùng PowerShell gửi lệnh qua `ssh`. Đề xuất: `--password-stdin` từ chối, hoặc bỏ, U+FEFF ở đầu dòng.

## 5. Chưa làm: task ⚠️🔌 (SSH tới BL335 đang bị chặn)

| Task | Việc | Ảnh hưởng |
|---|---|---|
| T055 | `--auth-bench` trên BL335, chốt t của Argon2id (R7) | SC-007 (đăng nhập ≤ 1 s) chưa có số thật; tham số giữ m = 19 MiB, t = 2 |
| T158 | cài runtime 0.4.0 lên BL335 | mọi số đo thiết bị |
| T159 | RSS, CPU khi rảnh và khi tải; 20 lần đăng nhập | SC-007, FR-034 |
| T160 | nạp xuống, đọc lên trên BL335 | SC-002, SC-006 (sau US2) |
| T161 | cắt điện thật | SC-004 (sau US2) |
| T162 | tìm thiết bị 10/10 trong LAN thật, tường lửa Windows | SC-001 |
| T163 | làm việc từ xa qua VPN hoặc port-forward | SC-001 |
| T164 | tìm chuỗi mật khẩu thử trên thiết bị | SC-005 phần thiết bị |
| T165 | kỹ sư làm trọn vòng | SC-009 |

## 6. Checkpoint "Mốc bảo mật"

| Điều kiện (tasks.md, cuối Phase 2) | x64 | qemu armhf |
|---|---|---|
| HTTPS có chứng chỉ tự sinh | đạt | đạt |
| Đăng nhập theo role | đạt (3 role, 403 đúng chỗ) | đạt (engineer; 401/403) |
| Khóa tạm | đạt | đạt |
| Audit chạy | đạt | đạt (`auth.login ok`, `auth.lockout`) |
| Trang xem HTTP 8080 không đổi hành vi (FR-033) | đạt | — |
| Test xanh | cả bộ `test-x64.ps1` **1065/1065** (1 bench tắt sẵn); `device-it` 4/4; Rust 88/88 | `smoke-armhf.sh` bản mở rộng: OK |

**Kết luận: đạt (2026-10-12).** Mốc bảo mật đạt trên x64 và qemu armhf. Từ đây được viết route nạp xuống, đọc lên (US2, US3).

Giới hạn: chưa đo trên BL335 thật (T055, T158–T165 chờ quyền SSH); xem mục 7.

**Sự cố môi trường ngày 2026-10-12:** một lần chạy ASan lỗi ghi log rất lớn làm file ảo của Docker phình tới 75 GB, ổ C: đầy, Docker ngừng. Đã xóa container và build ASan; Docker chạy lại. File ảo chưa được compact, C: còn khoảng 4 GB: build mới nên chạy lần lượt, không song song nhiều thư mục.

## 7. Hạn chế

- **Chiếm worker HTTPS:** một máy trong LAN chiếm được cả 8 worker, mỗi lần 10–15 s. Trang xem không bị ảnh hưởng (ADR-010).
- **Mở khóa sau 5 phút:** chỉ kiểm bằng unit test với đồng hồ giả. `device-it` chỉ kiểm `retryAfterS` = 300, không chờ hết 5 phút.
- **Nguồn khác subnet qua NAT:** một router NAT vào LAN làm client ở xa trông như cùng subnet, nên thiết bị trả lời. Đúng contract, ghi để biết.
- **Tường lửa Windows và broadcast thật:** chưa kiểm. Docker Desktop dùng NAT, nên phải làm ở T162.
- **Dòng audit trong smoke armhf:** tìm bằng chuỗi byte của bản ghi SQLite, vì image không có `sqlite3`. Cách này kiểm phần ghi, không kiểm truy vấn.

## 8. US2–US4 trên x64 (2026-10-12, T126, T127, T140, T150)

Chạy bằng `tools/device-it.ps1`; mỗi kịch bản có `docs/reports/005-<tên>-x64.json`. Runtime x64 build `-DMAT_TEST_HOOKS=ON` (chỉ cho `health`, `kill`).

| Kịch bản | Kết quả | SC/FR |
|---|---|---|
| `deploy` | 3 project (`tank-demo`, `bench-500`, một project có tên file tiếng Việt) x 10 lần nạp xuống rồi đọc lên: digest và byte giống hệt **30/30**; mỗi lần nạp xuống tới `committed` trung vị 4,1 s, lớn nhất 4,4 s; đổi nhóm và cột: `history.db` giữ dữ liệu (152 sang 161 dòng), thêm 1 cột; thiết bị cài theo cách cũ đọc lên đủ file | SC-002, SC-006 (phần x64), FR-026, US3-2 |
| `packages` | mọi vector độc của `tests/package-vectors` bị từ chối đúng mã; `state.json`, bản đang chạy, kho, `staging/` không đổi; mỗi lần có audit `project.deploy failed` | SC-003 |
| `busy` | lần hai 409 `DEVICE_BUSY` kèm opId, kind, user, source, since; khôi phục khi bận cũng 409; mạng rớt giữa lúc gửi: `RECEIVE_ABORTED`, khóa nhả | US2-7 |
| `health` | runtime chết khi chạy thử: `rolled-back` `HEALTH_CRASH` sau 7,9 s; treo: `HEALTH_TIMEOUT` sau 20,1 s; chạy lại bản cũ, có audit | US2-5 |
| `kill` | 24 vòng SIGKILL (6 bước x 4): luôn lên lại bản cũ (20) hoặc bản mới hoàn chỉnh (4), thao tác dở dang hiện đúng bước bị giết, `pending` hết sau tối đa 2 s, `staging/` rỗng | SC-004 (phần x64), FR-023 |
| `reload` | 10 tab Chrome 154 headless: cả 10 tải lại, tab cuối 3,1 s sau khi gửi gói (trước khi thao tác báo xong), thấy project 7.0.0 và kết nối live lại | FR-025, SC-006 (phần x64) |
| `auth` (mở rộng) | engineer `/audit` 403 có audit; administrator đọc, lọc, phân trang; viewer đọc `diagnostics`; `--export-audit` có đăng nhập thất bại, `access.denied`, `auth.lockout`, không có mật khẩu | SC-005, US4 |
| `secrets` | sau `deploy`: 5 chuỗi mật khẩu không có trong `/data` (kể cả `projects/`), `/run/mat-runtime`, log, docker logs | SC-005 |

**Chưa chạy lại sau lần sửa cuối:** kiểm "thiết bị cài theo cách cũ" thêm vào `deploy` (T140) sau lần chạy xanh; `tls-idle` và `discovery` không chạy lại ở phiên này (báo cáo mục 2 giữ nguyên).

**Lỗi nhỏ đã sửa:** `clang-format` ở `https_api_test.cpp`; `--password-stdin` bỏ BOM U+FEFF đầu dòng (test `ByteOrderMarkOnStdinIsNotPartOfThePassword`); thao tác `interrupted` hiện đúng bước (ghi `ops/<opId>.json` trước mỗi bước; 17 fsync mỗi lần nạp xuống thay cho 9). Test nhắm đích: `DeployPipeline|UserCli` 43/43.

## 9. Review bảo mật và review code (T153)

Hai agent con (`security-auditor`, `code-reviewer`) chạy trên `git diff 476b1bb..HEAD -- core server apps packages deployment`. **Không có phát hiện Critical hoặc High**, nên không có mã vá bắt buộc. Bảng đã ghi, chưa sửa:

| Mức | Nội dung | Xử lý |
|---|---|---|
| Medium | WebSocket live cũng cài trên HTTPS không cần đăng nhập, 8 worker HTTPS (bị chiếm bởi 8 kết nối wss hoặc TLS rảnh) làm login và nạp xuống ngừng trả lời | ghi nhận (đã nằm ở mục 7); đề xuất: không cài live trên HTTPS, hoặc `httpsThreads` > `maxClients` |
| Medium | Đăng nhập thành công xóa bộ đếm sai theo nguồn: kẻ có một tài khoản hợp lệ thử mật khẩu hàng loạt trên các tên khác (còn khóa theo tên) | ghi nhận, việc cho GĐ 2 |
| Medium | SSH root bằng mật khẩu mở ra Internet và port-forward 9080 cho HTTP không mã hóa trên BL335 | chờ người dùng (cấu hình router, VPN); tài liệu khuyến nghị VPN |
| Medium (review code) | `persist()` giữ mutex trong lúc fsync; ghi dư trước bước đầu; lỗi `writeOp` chỉ ghi log | ghi nhận; chi phí ghi đã nêu ở ADR-012 |
| Medium (tôi tìm) | gói có file thừa không được tham chiếu qua kiểm gói và kiểm project, nhưng digest runtime tính từ project khác digest gói: bị quay về `HEALTH_TIMEOUT` | an toàn nhờ rollback; đề xuất validator từ chối file thừa (đúng contract §5) |
| Low | `users.json` kiểm quyền chỉ cấm bit "others" (nên cấm group-write và chủ khác root); BOM bỏ ở mọi lần đọc dòng; discovery không giới hạn độ dài chuỗi tên; `open_device_web` mở URL tùy ý; SVG sanitizer còn denylist; `audit.suppressed` mất thông tin nguồn | ghi nhận |

## 10. Chưa làm trong phiên này và lý do

Ổ C: còn dưới 2 GB (1,0 GB lúc dừng) khi `ci-local.ps1` đang build x64 trong Docker, nên theo quy tắc **dừng**: chưa có lượt kiểm đầy đủ cuối cùng.

- **T152** (hồi quy SC-008, `http-check`, `runtime-smoke`, ngân sách RSS/CPU, client live 1.0.0): chưa chạy.
- **T157** (`ci-local.ps1` trọn bộ; bộ cài Studio 0.3.0; `studio-smoke --exe`): chưa chạy. Đã nâng phiên bản Studio lên 0.3.0 trong `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`. Lần chạy `ci-local` đã qua clang-format, build armhf, smoke armhf qemu, deploy/rollback sh; dừng giữa `ctest` (mới tới test 994/1184, mọi test đã chạy đều xanh).
- **T166:** báo cáo này đã cập nhật bảng, số đo, giới hạn; chưa có số của T152, T157.
- **T158–T165:** chờ người dùng cho phép SSH tới BL335 (T165 cần một kỹ sư; T162 cần máy Windows cùng LAN; T161 cần người cạnh thiết bị).
- Trước khi chạy lại cần giải phóng ổ C: (file ảo của Docker chưa được compact; `docker system df` báo hàng chục GB trong VM), rồi `./tools/ci-local.ps1`, kế đó bộ cài Studio (`CARGO_TARGET_DIR=C:\build\mat-studio`, xóa `incremental`).
