# Nghiệm thu Sprint 1 — Vertical slice trên thiết bị

Cập nhật 2026-10-10; đối chiếu lại với số đo gốc ngày 2026-10-11 (audit Sprint 1). Spec: [specs/002-vertical-slice/spec.md](../../specs/002-vertical-slice/spec.md). Mục nào chưa đo ghi rõ **chưa đo**.

**Môi trường đo**
- **Thiết bị:** BL335 (Linux 5.4.61 armv7l, Ubuntu 20.04.5, 993 MB RAM), `mat-runtime` 0.2.0 chạy bằng systemd (`User=matscada`, `MemoryMax=300M`).
- **Truy cập:** từ chiều 2026-10-10 máy dev **không còn ở LAN** của thiết bị. Client (load-tester, Chrome headless) chạy trên máy dev Windows và đi **qua Internet** (IP công cộng `198.51.100.200`, cổng 9080 → 8080 của thiết bị). Điều kiện mạng này khắt khe hơn LAN của SC-001…SC-004.
- **Đo tài nguyên:** `tools/measure/sample.sh` chạy trên thiết bị qua `ssh … sh -s`, 1 mẫu/s. CPU là CPU **toàn hệ thống**, gồm cả tiến trình lấy mẫu và timer `atscada-admin-recover` (5 s) của sản phẩm cũ; baseline rảnh ở Sprint 0 là 7,25 %.
- **Bản đo:** 5 lần `deploy.sh` ([device-changes.md](device-changes.md)). Đo trên deploy 1: `sprint1-load`, `-budget`, `-origin`, `-resub*`, `-slot`, `-slow`, `-slow-budget`. Deploy 2 và 3: `sprint1-slow-deploy2.json`, `sprint1-slow-deploy3.json`. Deploy 4: `sprint1-postreview-*`, `-smoke-bl335`, `-http-bl335`. Trường `startedAt` trong JSON của load-tester là thời điểm **kết thúc** lần chạy.

## Tiêu chí thành công

| SC | Tiêu chí | Kết quả đo | Kết luận | Nguồn |
|---|---|---|---|---|
| SC-001 | 10 tab Chrome trên ≥ 2 máy, ≥ 10 phút, 0 mất sequence chưa khôi phục | **Chưa đo bằng Chrome thật trên nhiều máy** (cần người dùng thao tác các máy client). Thay thế tạm: 10 client WebSocket (load-tester) × 300 s và 9 client × 600 s qua Internet, **0 mất sequence**; 1 tab Chrome headless chạy đúng | Chưa nghiệm thu (thiếu bước thủ công) | [sprint1-load.json](sprint1-load.json), [sprint1-slow.json](sprint1-slow.json), [sprint1-smoke-bl335.json](sprint1-smoke-bl335.json) |
| SC-002 | Tab 11 nhận thông báo đầy ≤ 2 s; 10 tab không gián đoạn | Client 11 nhận `MAX_CLIENTS_REACHED` + 4429; 10 client còn lại 0 mất sequence. Sau deploy 4: client 11 bị đóng 4429 sau **1 ms** tính từ lúc bắt tay xong (`closedAfterMs`, chưa gồm thời gian bắt tay). Banner đầy + đếm ngược 30 s + "Thử lại ngay" có test giao diện. **Chưa thử bằng tab Chrome thứ 11 trên thiết bị** | Đạt ở mức giao thức; phần giao diện chưa nghiệm thu thủ công | [sprint1-load.json](sprint1-load.json), [sprint1-postreview-load.json](sprint1-postreview-load.json), `status.test.ts`, `connection.test.ts` |
| SC-003 | Mất mạng ≥ 30 s: STALE ≤ 15 s, khôi phục ≤ 30 s, không tải lại trang; slot giải phóng ≤ 20 s | x64 (mô phỏng mất mạng bằng `docker pause`, 30 s): STALE sau **14,9 s**, khôi phục sau **0,1 s**, không tải lại trang. Slot: client im lặng bị đóng 4408 sau **15,3 s** trên BL335 (deploy 1; chưa chạy lại sau deploy 4, bản đổi đường đóng phiên). **Chưa rút cáp thật** | Đạt trên x64 + slot trên BL335; rút cáp thật chưa làm | [sprint1-reconnect-x64.json](sprint1-reconnect-x64.json), [sprint1-slot.txt](sprint1-slot.txt) |
| SC-004 | Mở màn hình ≤ 2 s; độ trễ Tag → hiển thị ≤ chu kỳ + 500 ms | Qua Internet: trang tải xong **59 ms**, có dữ liệu sống **289 ms** (deploy 4; lần chạy sau deploy 1 cho 75/296 ms nhưng file đã bị ghi đè). Độ trễ delta so với bản tin nhanh nhất: p95 **18–30 ms** (cận dưới; xem hạn chế 2). Gom delta mỗi 250 ms theo thiết kế | Đạt | [sprint1-smoke-bl335.json](sprint1-smoke-bl335.json), [sprint1-load.json](sprint1-load.json) |
| SC-005 | 500 Tag/1 s, 10 client mỗi client 500 Tag: RSS ≤ 150 MB, CPU TB ≤ 30 %, đỉnh ≤ 60 % | 300 s, 310 mẫu: RSS TB **3,13 MB**, tối đa **3,5 MB**; CPU TB **11,86 %**, p95 20 %, đỉnh **29 %**; MemAvailable thấp nhất 886 MB. Đo lại sau các bản vá review (deploy 4, 120 s, [sprint1-postreview-budget.csv](sprint1-postreview-budget.csv)): RSS TB 3,17 MB, tối đa 3,7 MB; CPU TB 11,89 %, đỉnh 22,4 %; 0 mất sequence ([sprint1-postreview-load.json](sprint1-postreview-load.json)) | **Đạt** | [sprint1-budget.csv](sprint1-budget.csv), [sprint1-load.json](sprint1-load.json) |
| SC-006 | Client chậm: 9 client không mất sequence; client chậm bị đóng; RSS không tăng 10 phút | 600 s (deploy 1): 9 client mỗi client 2399–2400 delta, **0 mất sequence**; CPU TB 11,8 %. RSS 3,8–4,0 MB tới giây 573, lên 4,2 MB ở giây 574 và **4,4 MB** từ giây 575 tới hết file (giây 620): chưa đủ để kết luận RSS không tăng. File 600 s không chứng minh máy chủ bỏ client chậm (deploy 1 chưa có bộ đếm `writeFailedTotal`; load-tester chỉ ghi lỗi `use of closed network connection`). Đường **ghi quá hạn 10 s** có bằng chứng ở hai lần chạy sau: deploy 2, 200 s: `writeFailedTotal` = 1, log máy chủ `write failed/timed out (queued 190753 B)` (hàng đợi < 256 KB); deploy 3, 90 s: `writeFailedTotal` = 1, `clients` 10 → 9 khi đọc `system/info` (log và `clients` chỉ có trong đầu ra lệnh lúc đo, không lưu file). Cả hai lần 9 client 0 mất sequence. Đường **4409 `resync_required`** quan sát được ở kịch bản client đọc chậm hơn tốc độ dữ liệu (resubscribe 500 Tag liên tục qua Internet). Mọi lần chạy đều trước deploy 4 | **Đạt một phần**: hai đường bảo vệ hoạt động (ADR-006); RSS tăng 0,4 MB cuối lần chạy, chưa kết luận được; chưa chạy lại sau deploy 4 | [sprint1-slow.json](sprint1-slow.json), [sprint1-slow-budget.csv](sprint1-slow-budget.csv), [sprint1-slow-deploy2.json](sprint1-slow-deploy2.json), [sprint1-slow-deploy3.json](sprint1-slow-deploy3.json), [sprint1-resub-500tag-wan-overflow.json](sprint1-resub-500tag-wan-overflow.json) |
| SC-007 | 10 client cùng tải lại trang ≤ 5 s | **Chưa đo** (cần 10 tab Chrome thật) | Chưa đo | — |
| SC-008 | Vector schema: 100 % đúng ở cả hai phía | Mã Sprint 1 (commit `60578be`): 38 vector (4 hợp lệ + 34 không hợp lệ, phủ mọi mã lỗi): TS 38/38, C++ 38/38, cùng tập mã lỗi. Bộ vector đã tăng thêm sau Sprint 1 | **Đạt** | `vectors.test.ts`, `project_validator_test`, [sprint1-ci-local.txt](sprint1-ci-local.txt) |
| SC-009 | Origin lạ bị từ chối 100 %; SVG mở trực tiếp không chạy script | Origin lạ → HTTP 403, không tốn slot (x64 và BL335). SVG có `<script>`/`onload` mở thẳng: script không chạy (CSP `sandbox`); trong trang runtime: script bị lọc | **Đạt** | [sprint1-http-bl335.json](sprint1-http-bl335.json), [sprint1-http-x64-script-svg.json](sprint1-http-x64-script-svg.json) |
| SC-010 | Tự chạy lại ≤ 10 s sau kill và sau khởi động lại thiết bị | `kill -9`: `system/info` trả `active` lại sau **2,4 s** (2391 ms, thăm dò mỗi 0,2 s; `NRestarts=1`; đầu ra lệnh lúc đo, không lưu file). **Chưa khởi động lại BL335** (chờ người dùng đồng ý) | Đạt một nửa | [device-changes.md](device-changes.md) |
| SC-011 | `tools/ci-local.ps1` xanh | `ci-local: ALL STEPS PASSED` ở lần chạy cuối trên mã Sprint 1, sau các bản vá review (2026-10-10 09:46–09:47 UTC): clang-format, armhf, x64 + **97** test C++, Go, lint, typecheck, validate project, **165** test Vitest, build web. `cargo test --lib` 4/4 trên Windows (ca `symlink_escape_is_blocked` chỉ biên dịch trên Unix nên không chạy) | **Đạt** | [sprint1-ci-local.txt](sprint1-ci-local.txt), mục "Kiểm tra cục bộ" |
| SC-012 | Studio: mở, sửa, lưu, xem trước, mở web ≤ 5 phút | Bộ cài release dựng được (208 MiB). `studio-smoke.mjs` trên bản release với BL335: IPC; chặn đọc/ghi file khi chưa mở project; chặn URL `javascript:`/`file:`; "Kiểm tra kết nối" dưới CSP thật hiện runtime 0.2.0, project `tank-demo` active; WebSocket từ origin Studio được nhận; không lỗi CSP. Logic form/thiết bị có test (Vitest 15, Rust 4). Bộ cài dùng cho lần smoke này dựng lúc 16:18 ngày 2026-10-10 (giờ VN), **trước** các bản vá review của validator; bộ cài đã dựng lại trong feature 003 (02:02 ngày 2026-10-11) nhưng chưa chạy lại `studio-smoke`. **Chưa thao tác GUI end-to-end** (hộp thoại chọn thư mục, sửa/lưu, xem trước, đo thời gian) | Chưa nghiệm thu (phần tự động đạt) | [sprint1-studio-smoke.json](sprint1-studio-smoke.json) |
| SC-013 | Trang runtime truy cập được sau deploy và sau reboot | Sau deploy: truy cập được tại `http://198.51.100.200:9080/` (từ xa, qua chuyển cổng của router). **Chưa kiểm từ máy trong LAN** (máy dev không còn ở LAN của thiết bị; health check của `deploy.sh` gọi `127.0.0.1`). Sau reboot: **chưa thử** | Đạt một phần (chỉ qua Internet) | [sprint1-smoke-bl335.json](sprint1-smoke-bl335.json) |

## Kiểm chứng khác

| Hạng mục | Kết quả |
|---|---|
| FR-020 (race snapshot + đăng ký) | Unit test 100 lần subscribe xen kẽ bộ phát: 0 gap. Trên BL335: resubscribe 100 lần (5 Tag, lệnh chạy với `-tags demo`; file không ghi tập Tag) **0 gap, 0 delta cũ** ([sprint1-resub.json](sprint1-resub.json)) |
| FR-025 (project lỗi) | x64 với vector `invalid-ref-tag`: `system/info.project.status = "invalid"` kèm `E_REF_TAG`, `/api/v1/projects/active` → 503, tiến trình không thoát. Kiểm tay (2026-10-10 09:03 UTC), đầu ra lệnh không lưu file; test tự động (T063) chưa có |
| Deploy (Constitution VII) | 5 lần `deploy.sh` trên BL335 (08:45–09:45 UTC, [device-changes.md](device-changes.md)): stage → `--check-project` → backup `.prev` → activate → health check OK sau 1 s ở cả 5 lần (log của `deploy.sh` lúc chạy, không lưu file). Từ lần 4 có thêm kiểm SHA-256, validate bằng user `matscada`, sao lưu unit. Sau lần 5 (bản chạy cuối Sprint 1) chỉ có smoke không lưu file (`liveMs` 273, đạt); smoke và HTTP/CSP có file là của deploy 4. **Chưa chạy `rollback.sh`** trong Sprint 1 (hạn chế 7) |
| T058 (Sprint 0) | CSP trang và file project, allowlist `/project/`, 404 cho `unsafe-elements.svg`/lab/fixture, 405 với POST, Origin 403: `http-check.mjs` PASS trên x64 và BL335 |
| Hiển thị | Mức bồn đổi, chữ, `TANK01.TEMP` BAD hiển thị `--`: BL335 ([sprint1-smoke-bl335.json](sprint1-smoke-bl335.json)). Chữ mức bồn và màu motor khi chạy (`rgb(34, 197, 94)`): x64 ([sprint1-reconnect-x64.json](sprint1-reconnect-x64.json)). Trong file smoke của BL335 (deploy 4) motor dừng suốt lần đo (`fanAnimations` 0); quạt quay (`fanAnimations` 1, 1456 rpm, màu xanh) chỉ có ở lần smoke sau deploy 1, file đã bị ghi đè. Logic quay (Web Animations) có unit test (`applier.test.ts`) |

## Review mã và bảo mật (T093)

Hai review độc lập (code review: correctness/concurrency; security audit) trên toàn bộ mã Sprint 1. Phát hiện đã đối chiếu với mã nguồn trước khi sửa.

| Mức | Phát hiện | Xử lý |
|---|---|---|
| Critical | CivetWeb cấp phát theo độ dài frame client khai báo (tới khoảng 2 GB) **trước** khi kiểm giới hạn bản tin → một client không cần xác thực có thể làm `mat-runtime` bị OOM-kill | **Đã sửa:** vá CivetWeb, frame > 96 KiB bị đóng 1009 trước khi cấp phát |
| High | CivetWeb 1.16 dính CVE-2025-55763 (tràn bộ đệm khi redirect thư mục; chuỗi đích dựng từ header Host) | **Đã sửa:** `mat-runtime` build CivetWeb với `NO_FILES` và tự phục vụ `/`, `/assets/`, `/project/` theo allowlist. Theo dõi bản sửa của upstream |
| High | Client ẩn danh có thể giữ cả 10 slot (chưa có xác thực) | **Chấp nhận theo thiết kế Sprint 1** (xác thực ở Sprint 5). Khuyến nghị đóng port-forward công cộng 9080 khi không demo |
| Important | Ghi một phần khi quá hạn bị coi là thành công (`<= 0`) | **Đã sửa:** so đúng số byte |
| Important | Lịch heartbeat theo đồng hồ hệ thống: chỉnh giờ lùi thì mọi client bị 4408 | **Đã sửa:** lịch theo đồng hồ monotonic, `ts` vẫn theo giờ hệ thống (có test) |
| Important | Giới hạn 16 KB không đủ cho `subscribe` 1000 Tag hợp lệ → vòng lặp 1009 | **Đã sửa:** giới hạn 96 KiB (có test 67 KB) |
| Medium | `std::regex` đệ quy làm sập validator C++ với chuỗi 100 KB (agent đã tái hiện) | **Đã sửa:** chặn chuỗi > 1024 byte trước khi so pattern, thêm `maxLength` cho SemVer; vector `invalid-schema-longstring` |
| Medium | `maxClients` = 2³²+1 bị ép về 1 trong C++ (lệch TS) | **Đã sửa:** đọc bằng double; vector `invalid-max-clients-overflow` |
| Medium | JSON lồng sâu có thể tràn stack (bản tin WS và file project) | **Đã sửa:** đếm độ sâu trước khi parse (WS ≤ 32, project ≤ 64); vector `invalid-json-deep` + test hub |
| Medium | Sanitizer SVG vẫn là denylist (Constitution V cần allowlist) | **Nợ đã ghi nhận, làm ở Sprint 2** (importer). Giảm thiểu hiện tại: SVG do kỹ sư đặt, CSP `script-src 'self'`, CSP `sandbox` cho `/project/` |
| Minor | Sau close frame, client không đóng thì giữ worker vô hạn; tạo thread lỗi → `terminate`; INT64 dạng chuỗi không qua transform; "Cập nhật cuối" lệch khi mất kết nối; độ dài đường dẫn TS đếm UTF-16; `svgFile` không encode trong URL; đọc cả file vào RAM; `Cache-Control` assets | **Đã sửa:** hạn chót 5 s rồi cắt TCP; bắt `system_error` → 1013; ép INT64 theo kiểu Tag; bỏ qua STALE khi tính thời điểm cập nhật; đếm byte UTF-8; encode từng đoạn; gửi theo khối 16 KB; `public, max-age=31536000, immutable` |
| Low | systemd chưa siết hết; `deploy.sh` chạy binary mới bằng root, không kiểm checksum | **Đã sửa:** thêm `CapabilityBoundingSet=`, `SystemCallFilter=@system-service`, `MemoryDenyWriteExecute`…; validate bằng user `matscada`; kiểm SHA-256; backup/khôi phục cả unit khi rollback |
| Low | CSP Studio `connect-src http: ws:`; `open_device_web` không kiểm host | Chấp nhận (IP thiết bị do người dùng nhập; đã biện minh trong plan) |

**Chưa kiểm hồi quy trên thiết bị** cho các bản vá đường đóng phiên: hai bản vá CivetWeb (frame quá lớn, cắt kết nối sau hạn chót) và bản vá ghi một phần là lỗi (Important, review I-1). Hiện chỉ có đọc mã và unit test của hub; các đường đóng trong `CivetLiveTransport` (ghi một phần, hạn chót sau close frame) chưa có test tự động. Các kịch bản slot (`-slot-test`), client chậm và resub 500 Tag chưa chạy lại sau deploy 4: số đo của SC-003 (phần slot) và SC-006 là của deploy 1–3. Các kiểm tra chức năng sau khi vá (smoke, HTTP/CSP/Origin, tải 10 + 1 client) đã chạy lại trên BL335 ở deploy lần 4.

## Kiểm tra cục bộ

Lần chạy cuối trên mã Sprint 1 (2026-10-10 09:46–09:47 UTC, sau mọi bản vá review): [sprint1-ci-local.txt](sprint1-ci-local.txt). Số ở bản trước của báo cáo (C++ 89, Vitest 160) là của lần chạy trước các bản vá review.

| Bộ | Kết quả |
|---|---|
| C++ (GoogleTest, x64 trong Docker) | 97/97 (59 test + 38 ca vector) |
| TypeScript (Vitest) | 165: project-schema 47, live-client 27, binding-engine 23, svg-renderer 38, runtime-web 15, studio 15 |
| Rust (Studio) | 4/4 trên Windows; `symlink_escape_is_blocked` có `#[cfg(unix)]` nên không chạy |
| Go (load-tester) | đạt |
| Lint (Prettier + ESLint), clang-format | đạt |

**Sau GĐ 0 (2026-10-11):** đã xử lý các phát hiện của audit Sprint 1 (ghi chú trong [tasks.md](../../specs/002-vertical-slice/tasks.md)). `tools/ci-local.ps1` xanh; Claude chạy lại độc lập trên máy dev, log ở scratchpad của phiên, không lưu trong repo.

| Bộ | Kết quả |
|---|---|
| C++ (GoogleTest, x64 trong Docker) | 377/377. Có cả test của feature 003; mới trong GĐ 0: 13 vector, 6 `startup_test`, 6 `civet_transport_test`, 1 validator, 1 mock |
| TypeScript (Vitest) | 252: project-schema 115, live-client 31, binding-engine 23, svg-renderer 38, runtime-web 16, studio 29 |
| Vector dùng chung | 82 ca (13 hợp lệ, 69 không hợp lệ): TS 82/82, C++ 82/82 |
| Rust (Studio) | 10/10 trên Windows (chạy tay; CI không chạy Rust) |
| Go (load-tester) | 9 test, đạt |
| Bước mới | `deploy/rollback (sh)`: `deploy.sh` + `rollback.sh` với lệnh hệ thống giả, gồm ca deploy dừng giữa chừng; `armhf smoke (qemu)` (từ feature 003) |

## Hạn chế và việc còn lại

1. **Nghiệm thu thủ công chưa làm** (cần người dùng): 10 tab Chrome trên ≥ 2 máy (SC-001, SC-007), tab thứ 11 trên giao diện (SC-002), rút cáp thật (SC-003), mở trang từ máy trong LAN (SC-013), khởi động lại BL335 (SC-010, SC-013), thao tác Studio (SC-012). Hướng dẫn: [quickstart §5, §8, §9](../../specs/002-vertical-slice/quickstart.md).
2. **Độ trễ (SC-004):** đo bằng "độ trễ so với bản tin nhanh nhất" để khử lệch đồng hồ giữa hai máy. Cách đo này nhạy với **bước nhảy giờ**: một lần đo sau review cho p95 4,7 s trong khi p50 vẫn 3–11 ms và nhịp nhận delta vẫn đều 260 ms ([sprint1-postreview-load.json](sprint1-postreview-load.json)), tức là đồng hồ bị chỉnh chứ không phải dữ liệu đến muộn. Load-tester đã chuyển thời điểm nhận sang đồng hồ monotonic; đo lại 60 s cho p95 10–21 ms ([sprint1-postreview-lag.json](sprint1-postreview-lag.json)). Đây là cận dưới, chưa gồm độ trễ mạng tối thiểu và thời gian vẽ trên trình duyệt. Thời gian "mở trang → có dữ liệu" (289 ms qua Internet, deploy 4) là số đo đầu-cuối thực tế.
3. **Đo qua Internet thay vì LAN:** băng thông đường lên của site thiết bị là giới hạn thật. Resubscribe 500 Tag liên tục bị 4409 (bảo vệ đúng). Trên x64 cục bộ (Docker, localhost, không qua LAN), resub 100 lần × 500 Tag đạt 0 gap (đầu ra lệnh lúc đo, không lưu file).
4. **CPU** là CPU toàn hệ thống, có cả tải nền của sản phẩm cũ. Chưa tách phần của riêng `mat-runtime` (RSS thì là của riêng tiến trình).
5. **Việc treo từ Sprint 0** (không chặn Sprint 1): T034 Tech Lead duyệt Go/No-Go; T036 SVG thật từ Illustrator/CorelDRAW; giới hạn import 20.000 node; ngưỡng RAM OS 200/250 MB; timer `atscada-admin-recover` vẫn chạy (không tự tắt).
6. **Runtime không có xác thực và hiện truy cập được từ Internet qua cổng 9080:** chấp nhận cho demo vì chỉ đọc; nên đóng forward hoặc giới hạn IP khi không demo (Sprint 5 thêm xác thực).
7. **`rollback.sh` chưa được chạy thử trong Sprint 1** (T073, Constitution VII): cần người dùng cho phép rõ trên thiết bị, hoặc chạy trong container x64 có systemd; là việc của người dùng ở GĐ 0. Nhánh tự rollback của `deploy.sh` (gọi `rollback.sh`) đã chạy một lần trên BL335 trong feature 003 (2026-10-10 17:50 UTC: bản 0.3.0 lỗi khi khởi động, dịch vụ về lại 0.2.0 cùng unit cũ; [device-changes.md](device-changes.md)). Lưu ý: `rollback.sh` khôi phục unit `.prev` nếu có, mà unit chỉ được sao lưu khi đổi, nên unit `.prev` có thể thuộc một lần deploy cũ hơn bản `/opt/mat-runtime.prev`. **Đã sửa ngày 2026-10-11 (GĐ 0):** `deploy.sh` giữ `.service.prev` đi cặp với bản backup; có test `deployment/device/tests/deploy_rollback_test.sh` trong CI. Thiết bị hiện vẫn còn cặp lệch từ các lần deploy cũ ([device-changes.md](device-changes.md), lưu ý cuối).
