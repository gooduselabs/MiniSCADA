# Nghiệm thu feature 011: hoàn thiện, pilot, OTA, logic v2, trình vẽ SVG, template (T205)

> **Bản nháp, chờ T076, T080, T087, T059 (ASan qua `ci-local`), T200, T198.** Chưa phải nghiệm thu: soak x64 24 giờ đang chạy, L2 1.000 Tag trên BL335 chưa đo, mất điện và cắt mạng trên BL335 cần người, chưa có pilot và Go/No-Go. Mục chưa đo ghi "Chưa đo"; không gắn `1.0.0`.

Lập 2026-10-17; **cập nhật 2026-10-18** trên nhánh `gd6` (commit `3b1508f3`). Bảng FR đầy đủ: [011-fr-matrix.md](011-fr-matrix.md). Số đo tải, soak, mất điện: [011-load.md](011-load.md), [011-soak.md](011-soak.md), [011-powercut.md](011-powercut.md). Ghi chú phát hành: [1.0.0-rc.1](../release/notes/1.0.0-rc.1.md).

Cách đọc: **Đạt** là test hoặc kịch bản tự động xanh, số đo trong ngưỡng; "(x64)" hoặc "(lab)" là trong container Docker (các lượt 011 chạy image `mat-armhf` trên Linux arm64 của máy Mac Apple Silicon, không phải x64 thật; JSON ghi rõ máy). **Không đạt** là số đo vượt ngưỡng hoặc việc chưa xong. **Chưa đo** là làm được mà chưa chạy, hoặc hoãn có quyết định. **Chờ người** là cần người, thiết bị phụ, Windows, chứng chỉ thật hoặc khách hàng (mã mục ở §5).

## 1. Phiên bản

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Runtime | 1.0.0-rc.1 | `kRuntimeVersion`, `RUNTIME_VERSION` nâng ở T191. **BL335 chạy `1.0.0-rc.1` releaseSeq 12** (cài bằng `deploy.sh` 2026-10-18 07:54, commit `8db76073`; `.prev` là bản thử T122 releaseSeq 11); OTA tắt, không khóa tin cậy. `minRuntimeVersion` so phần số: rc.1 nhận project 1.0.0 (ADR 035 mục 7) |
| API thiết bị | 1.5.0 | MINOR kế tiếp của 1.4.0 (010) |
| Giao thức live | 1.3.0 | không đổi |
| Định dạng project | 1.0.0 | runtime nhận 0.1–0.6 và 1.0; Studio nâng cấp có sao lưu; gói runtime chép mọi bộ schema đóng băng (sửa 95effeb5 sau khi T079 phát hiện thiếu `schemas/0.6`) |
| Gói `.matupdate` | 1.0.0 | `mat-update-verify` armhf 214.592 B; so SemVer đầy đủ (rc.1 < 1.0.0) |
| Studio | 1.0.0-rc.1 | `package.json`, `tauri.conf.json`, `Cargo.toml`; `build-info.mjs versions --expect 1.0.0-rc.1` đồng nhất. Bộ cài NSIS chưa dựng và chưa ký (Windows, T102–T104) |
| Gói `.matscada` | không đổi | thêm từ chối tệp thừa `E_PACKAGE_EXTRA_FILE` |
| Constitution | 2.0.2 | PATCH T004 (ghi từ logic, OTA chỉ khi có HTTPS/đăng nhập/role/audit) |

## 2. Bảng theo SC

| SC | Nội dung ngắn | Trạng thái | Kết quả, bằng chứng |
|---|---|---|---|
| SC-001 | Medium 005–007 trong bảng truy vết | Đạt | `plan.md` "Phát hiện tồn"; P-01, P-12 đã đo trên BL335 (T063, T079 L8); P-03 chờ người áp dụng |
| SC-002 | ≥ 16 ca `Host`, rebinding | Đạt | ctest 22/22; `011-host-x64.json` 16/16; BL335 rc.1 (T063): `evil.test` → 421 trên HTTP và HTTPS, IP/`.local`/`localhost` → 200 |
| SC-003 | Khóa đăng nhập ≥ 14 ca; IP B ≤ 2 s | Đạt (x64) | 19 + 33 ca; 1.000 lần đoán: 20 lần kiểm mật khẩu, IP B ≤ 19 ms |
| SC-004 | Xung `kill -9` 20/20; nhật ký hỏng 20/20 | Đạt (x64) | `011-pulse-x64.json` |
| SC-005 | Gateway 1.000 chu kỳ | Đạt (x64) | `011-gateway-x64.json` |
| SC-006 | Tệp thừa ≥ 10 vector; 30 lần nạp | Đạt | 13 vector; `011-extra-file-x64.json` |
| SC-007 | `persist()` p99 ≤ 50 ms | Đạt (x64) | p99 6 ms |
| SC-008 | 40 TLS im lặng | Đạt | x64 `conn_limit_test` nguồn khác 25 ms; **BL335 rc.1 (T063)**: 43/43 đăng nhập từ địa chỉ khác, chậm nhất 837 ms, RSS 9,5 → 8,2 MB (đỉnh 27,9 MB là Argon2id); T079 L8 tệ nhất 1.198 ms, RSS +0,3–0,7 MB (`011-security-bl335.json`) |
| SC-009 | audit, license, SAST, fuzz 7 mục tiêu ≥ 1 giờ | Chưa đo | audit, license, SAST đạt; fuzz TS mọi mục tiêu ≥ 1 giờ (T058, T142, T165), C++ ASan + UBSan `update-envelope`, gói `.matscada`, `logic-json` ≥ 1 giờ; **project-json, expression, modbus C++ mới 30 phút** (0 sự cố mọi lượt; T058 chưa đóng) |
| SC-010 | 0 Critical/High mở; Medium mở chỉ chờ người | Đạt | T062 và T202 (lần 2): 0 Critical/High mở; K1, N-OTA1–3 đã sửa; O1 chấp nhận, O2 hoãn sau pilot; `web-it attack` trong `ci-local` xanh |
| SC-011 | BL335 500 Tag × 10 client × 4 giờ | Đạt (BL335) | T079 (runtime 1.0.0): CPU 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 %; RSS ≤ 19,5 MB đi ngang; 0 mất sequence; client 11 4429 50/50; F5 10 trang × 50 vòng tối đa 935 ms. T079 chưa đóng: `mat-sample` chưa cài, chưa xen kẽ 8443, RSS tab L5 |
| SC-012 | BL335 1.000 Tag | **Đạt**: CPU 43,8 % một lõi (≤ 50 %), RSS 12,8 MB, 0 mất sequence (1 giờ, 10 client, rc.1) | T080 |
| SC-013 | Soak 7 ngày BL335 | Chưa đo | **Hoãn theo quyết định người dùng 2026-10-18** (T081 không chạy ở GĐ 6); thay bằng soak x64 24 giờ (T076, đang chạy), L1 4 giờ BL335 (T079), soak 30 ngày bàn thử khi pilot (T196). Rủi ro: ghi khối toàn máy nền 2,6–4,7 GB/ngày khi mat tắt (`011-soak.md` §4) |
| SC-014 | Mất điện 100 vòng + 5 điểm | Chờ người | x64 (T077): 130/130 vòng `kill -9` (100 ngẫu nhiên + D1, D3, D5 × 10), 0 lệnh ACCEPTED thiếu audit trên 1.781; D2 40/40, D4 20/20 ở lab; BL335 cần bộ điều khiển nguồn (B4) |
| SC-015 | Cắt mạng 50 lần | Chờ người | x64 (T078): 500/500 nối lại, 0 lần > 35 s (tối đa 8,7 s), 0 slot rò; BL335 cần người cắt mạng (T086, B7) |
| SC-016 | Tuổi thọ eMMC | Chờ người | T013: sysfs `life_time` `0x01 0x01`, `pre_eol_info` `0x01` (bình thường); tuổi thọ tuyệt đối cần datasheet (B5, T082) |
| SC-017 | Ký thử 3 tệp, 12 ca hỏng, cổng `-Release` | Chờ người | cổng 8/8 đạt; ca hỏng 6–12 đạt (T191); ca 1–5 và Authenticode cần Windows |
| SC-018 | `release.ps1` 9 mục ≤ 30 phút; SBOM | Chờ người | SBOM 836 thành phần; T191: `release.ps1` chế độ thử bằng pwsh trên macOS tạo `release/1.0.0-rc.1/` (bước 4–9 đạt; bước 3 bộ cài cần Windows) |
| SC-019 | Chứng chỉ thật trên Windows 10/11 sạch | Chờ người | R1, R3 |
| SC-020 | OTA 20/20, ngừng ≤ 30 s, ≥ 25 gói xấu | Đạt (lab) | ngừng ≤ 9,6 s, toàn bộ ≤ 17,6 s; 31/31 gói xấu (`011-update-x64.json`; `update-it` trong `ci-local` rc.1 xanh) |
| SC-021 | OTA bền 40 kill; quay về ≤ 90 s | Đạt (lab) | 40/40; quay về 89,3 s |
| SC-022 | OTA bảo mật | Đạt | `update_api_test`; `update-x64` `auth`, `downgrade` |
| SC-023 | BL335 10 OTA thật, 5 lần cắt | Chờ người | **10 OTA thật Đạt (T122)**: 10/10 `committed`, ngừng 13,2–15,9 s (trung bình 14,5 s), toàn bộ 21,1–24,0 s, quay về bằng tay đạt, audit đủ (`011-ota-bl335.json`); 5 lần cắt điện giữa bước chờ bộ điều khiển nguồn (T123, B4) |
| SC-024 | ≥ 200 vector logic TS = C++ | Đạt | 279/279 (x64 và armhf qemu); sau tối ưu T148: C++ 287, TS 396 xanh |
| SC-025 | Độ chính xác logic | Đạt | Vitest + ctest 52 ca |
| SC-026 | Logic retain 100 vòng `kill -9` | Đạt (x64) | T146 `retain-kill` 100 vòng: mất tối đa count 6, total 0,95, giờ chạy 0,0027 (≤ một `flushS`), 0 lần giảm, 0 ghi trùng cạnh; `retain-lost` 5/5 (`011-logic-x64.json`). BL335 cắt điện (D5) là T149 |
| SC-027 | Ghi từ logic qua giả lập Modbus | Đạt (x64) | T146 `rules` 9/9 (audit đủ trường trước khi gửi), `writes-off` 0 lệnh, `throttle` chặn 35/35 cạnh thừa; validator từ chối ghi Tag không khai báo |
| SC-028 | Logic tối đa trên BL335 | **Đạt** (2026-10-18, releaseSeq 13): CPU +2,5 điểm một lõi, RSS +3,8 MB, quét 1,05 ms | T148 |
| SC-029 | Kỹ sư dựng luật bơm ≤ 25 phút | Chờ người | H3 |
| SC-030 | Round-trip ≥ 20 fixture | Đạt | 26 fixture, ảnh khác 0 % |
| SC-031 | ≥ 150 ca hình học | Đạt | ~270 ca |
| SC-032 | Hoàn tác 1.000 chuỗi | Đạt | `command.test.ts` |
| SC-033 | Hiệu năng editor (máy dev) | Đạt | mở 20.000 nút 486 ms; kéo trong 2.000: khoảng khung p95 16,8 ms (nhịp 60 Hz, xử lý 1,7 ms); chọn khung ≤ 29 ms |
| SC-034 | Fuzz lệnh 100.000, 10 SVG độc, lint | Đạt | thêm lượt dài `svg-edit-commands` 3.600 s (T165) |
| SC-035 | Kill Studio 20 lần; thử tay | Chưa đo | kill giả lập ở `svg-state.test.ts`; kill thật chưa làm; bộ gõ, NVDA: H4 |
| SC-036 | Ký hiệu bơm ≤ 20 phút | Chờ người | H4 |
| SC-037 | Template 20/20, faceplate 20 bơm | Đạt (x64) | `web-it -Scenario faceplate` 103/103 trên runtime x64 với `dashboard-demo` 1.0 (`011-faceplate-x64.json`, 2026-10-18); 88 vector |
| SC-038 | `docs-check` 0 lỗi; người thử ≥ 90 % | Chờ người | `docs-check` 0 lỗi; H1 |
| SC-039 | Huấn luyện | Chờ người | H2, K5 |
| SC-040 | Pilot ≥ 30 ngày | Chờ người | K1–K6, P1–P3 |
| SC-041 | Biên bản ký; `kpi.mjs` khớp mẫu | Chờ người | `kpi.mjs` 16/16 đạt; biên bản K9 |
| SC-042 | Hồi quy `ci-local` với bước mới | Chưa đo | `ci-local` đầy đủ xanh trên rc.1 2026-10-18 ("ALL STEPS PASSED", gồm SAST, audit, docs-check, `update-it`, `logic-it`); ctest ASan + UBSan chạy riêng (T059: 5.888 ca, 56 đỏ đã sửa); **chưa có** lượt `ci-local -Sanitize` (T059) và so cặp 0.6/1.0 (T200) |
| SC-043 | Go/No-Go | Chờ người | T198, P4 |

Tổng: 25 Đạt, 0 Không đạt, 4 Chưa đo, 14 Chờ người (SC-028 đạt sau quét theo sự kiện) (SC-012 đạt 2026-10-18 sau T080; lần trước 2026-10-17: 17, 0, 13, 13).

## 3. Hạn chế còn lại

1. **CPU logic trên BL335 vượt 0,3 điểm (SC-028, FR-095):** 550 khối quét 10 lần/s thêm +3,3 điểm một lõi; cần quyết định cách đọc ngưỡng hoặc hạ `scanMs` cho cấu hình tối đa (ghi ở ghi chú phát hành rc.1 và `011-load.md` §3.2).
2. **Hồi quy ASan qua `ci-local`:** lượt `pwsh tools/ci-local.ps1 -Sanitize` chưa chạy (T059); ctest ASan + UBSan đã chạy riêng. So cặp 0.6/1.0 (T200) chưa làm.
3. **Fuzz C++:** project-json, expression, modbus mới 30 phút mỗi mục tiêu (T058); các mục tiêu khác ≥ 1 giờ, 0 sự cố.
4. **Soak:** S0 x64 24 giờ đang chạy (T076, xong khoảng 03:38 ngày 2026-10-19 giờ +07); soak 7 ngày BL335 không chạy ở GĐ 6 theo quyết định người dùng; ghi khối toàn máy BL335 nền đã vượt 2 GB/ngày khi mat tắt (dịch vụ khác): cần kết luận ngân sách eMMC ở T201.
5. **L2 1.000 Tag trên BL335** (T080) chưa đo; mất điện, cắt mạng trên BL335 cần người (T083–T086, T123).
6. **Ký số và cài đặt trên Windows** chưa chạy (signtool, Authenticode, bộ cài NSIS, PowerShell 5.1, WebView2); không có chứng chỉ thật, chưa có khóa phát hành thật.
7. **T079 chưa đóng:** `mat-sample` chưa cài trên BL335, L1 chưa xen kẽ 8443 (`load-tester` chỉ có `ws://`), RSS tab ở L5 chưa đo.
8. **Collector pilot**: `audit` chỉ cho administrator mà collector dùng viewer (ghi `FORBIDDEN`); chưa thử Credential Manager trên PowerShell 5.1.
9. **Load-tester**: thiếu phần L3 "client mới vào ≤ 35 s sau khi client 1 ngắt" (T079 đo bằng script riêng: 28–83 ms, 15,2 s khi client 1 im lặng); `maxLiveClientsPerSource` mặc định 5 nên bàn đo 10 client từ một máy phải đặt 10.
10. **Fixture SVG** của Illustrator và CorelDRAW là mô phỏng, không phải tệp xuất thật.
11. **Tài liệu người dùng**: phần chữ xong (T203); còn ảnh chụp Studio trên Windows.
12. **Thiết bị BL335:** sshd vẫn cho root bằng mật khẩu (T013, cảnh báo `SSH_ROOT_PASSWORD`); gia cố cần người ở cạnh (T064).

## 4. Phát hiện rà soát bảo mật

Nguồn: [011-security-review.md](011-security-review.md): lần 1 (T062, 2026-10-17, năm lượt song song) và lần 2 (T202, §7). Cả hai đã đóng.

| Mức | Số lượng | Tình trạng |
|---|---|---|
| Critical | 0 | — |
| High | K1 (phát lại gói `keyset` cũ để thêm lại khóa đã thu hồi; báo cáo tính là hai High cùng một lỗi) | **Đã sửa** (`trusted-keys/keyset-seq`; `updater_test.sh` mục 8) |
| Medium | lần 1: U3, U4, M1, LG1–LG6, F1, F2, F3; lần 2: N-OTA1–3 | **Đã sửa** kèm test; **O1, O2 đã quyết định** (dưới) |
| Low, Info | lần 1: U6–U11, L1–L8, LG7–LG12, S1–S7, F4–F8; lần 2: N3, N5–N9, N-L1–L5, N-S1, N-S2, N-SVG1/2, N-A1 | đã sửa hoặc ghi nhận (S6, U11) |

Quyết định (người dùng giao quyền, 2026-10-17, ADR-035):

- **O1** (Medium): `rollback` của `mat-updater` không cần chữ ký: **chấp nhận là rủi ro còn lại** (tối đa 1 lần/300 s, có audit, chỉ về bản đã ký từng cài); xem lại ngưỡng `minReleaseSeq` sau pilot.
- **O2** (Medium): một khóa tin cậy ký được gói `keyset` gỡ mọi khóa khác: **hoãn sau pilot** (M-of-N cần đổi định dạng phong bì); giảm thiểu bằng hai khóa phát hành giữ tách biệt ngoại tuyến.

Cổng T202 đạt: không Critical/High mở; `ci-local` đầy đủ xanh sau gộp. Việc còn lại từ rà soát: kiểm trên Windows các đường F2, F5, F6, S5.

## 5. Việc chờ người

Danh sách tập trung ở [docs/pilot/customer-checklist.md](../pilot/customer-checklist.md) (FR-143); bảng dưới là bản tóm tắt ngày 2026-10-18, khi lệch thì theo checklist.

| # | Việc | Chặn |
|---|---|---|
| K1–K9 | Khách hàng: chọn site, ký thỏa thuận và xử lý dữ liệu; BL335 và nguồn ở site; PLC thật và xác nhận PLC tự nhả xung; IP tĩnh, NTP, VPN; danh sách người huấn luyện; dựng project site; chọn ≥ 10 tác vụ nghiệm thu; phạm vi tính năng pilot; ký biên bản | T186, T192–T197, E8, E9, X8–X10 |
| B1 | Đường SSH tới BL335: có qua LAN, người dùng cho phép (đã dùng cho T013, T063, T079, T122, T148 ngày 2026-10-17/18) | T080 còn lại |
| B2, B3 | Đổi mật khẩu root yếu, đóng chuyển cổng SSH ra Internet; gia cố SSH khi có người ở cạnh (thiết bị vẫn báo `SSH_ROOT_PASSWORD`) | T064 |
| B4 | Lắp bộ điều khiển nguồn, thử khô 5 lần | T083–T085, T123 |
| B5 | Datasheet chip eMMC (`S0311D`, manfid `0xea`) | T082, X5 |
| B6 | Máy khác trong LAN chạy giả lập Modbus và `load-tester` 7 ngày | **không cần ở GĐ 6** (T081 hoãn theo quyết định người dùng) |
| B7 | Người cắt mạng 50 lần | T086 |
| B8 | Chọn PLC hoặc giả lập để thử logic ghi PLC | T149 |
| B9 | Bật `update.enabled` trên bàn thử | đã cho phép và dùng ở T122; còn T123 (cần B4) |
| R1 | Mua chứng chỉ ký mã, máy ký, URL dấu thời gian | T103–T105, E4 |
| R2 | Sinh hai khóa ECDSA phát hành ngoại tuyến | T103 |
| R3 | Cài thử Studio trên Windows 10/11 sạch | T105 |
| H1–H4 | Người thử bảng tác vụ; huấn luyện thử nội bộ; kỹ sư thử editor logic; thử bộ gõ, NVDA và ký hiệu bơm trong trình vẽ | T150, T167, T186 |
| P1–P4 | Cài rc lên site, chạy pilot ≥ 30 ngày, đo trễ Chrome và `EXT_CSD`, Tech Lead ký vào và Go/No-Go | T193–T198 |
| Windows | Spike signtool, chứng chỉ thử, dựng bộ cài ký, `release.ps1` đủ 9 bước, ca hỏng 1–5, ảnh chụp Studio | T009, T091–T094, T102, T203 |

Việc làm được không cần người nhưng chưa xong: T076 (đang chạy), T058 (ba mục tiêu C++ đủ 1 giờ), T059 (`ci-local -Sanitize`), T077 (D3 đủ, D2/D4 trong rig), T147 (L1 đầy đủ), T200, T201, T087, T205, T208; trên BL335 qua LAN (người dùng đã cho phép): T079 phần còn lại, T080; quyết định cách xử lý CPU logic (SC-028).

## 6. Số đo chính đã có

| Mục | Số đo | Nơi |
|---|---|---|
| BL335 rc.1 rảnh | RSS 9,5 MB đầu, 8,2 MB sau L8; NRestarts 0; `deploy.sh` kiểm sức khỏe sau 1 s | `device-changes.md` 2026-10-18 |
| BL335 L1 4 giờ (1.0.0) | CPU 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 %; RSS ≤ 19,5 MB; 0 mất sequence; MemAvailable ≥ 859 MB | `011-load.md` §3.1 |
| BL335 L3, L4, L5, L8 (1.0.0) | 50/50 4429; F5 tối đa 935 ms; ≥ 53,4 FPS; đăng nhập tệ nhất 1.198 ms | `011-load-bl335.json` |
| BL335 L7 logic tối đa (rc.1) | quét trung vị 2,5 ms, p99 3,8 ms; RSS +3,9 MB; CPU +3,3 điểm một lõi | `011-logic-bl335.json` khóa `remeasureRc1` |
| BL335 OTA thật (T122) | 10/10 `committed`; ngừng 13,2–15,9 s; toàn bộ 21,1–24,0 s | `011-ota-bl335.json` |
| BL335 `mat-update-verify` | ≈ 16 ms/lần kiểm (Cortex-A7, gói 5 KiB) | `device-changes.md` 2026-10-17 |
| x64 L1 1 giờ, L4, L6, L8 | CPU 4,3 %, RSS ≤ 25 MB; F5 tối đa 494 ms; 500/500 nối lại; đăng nhập 82 ms | `011-load-x64.json`, `011-flap-x64.json` |
| x64 L7 logic tối đa | +1,43 điểm CPU, RSS +4,6 MB (trước sửa arena glibc +30 MB), quét p99 1,38 ms, overrun 0 | `011-logic-load-x64.json` |
| x64 mất điện (`kill -9`) | 130/130 vòng; READY trung vị 514 ms, tối đa 12,1 s | `011-powercut-x64.json` |
| OTA lab | ngừng ≤ 9,6 s, toàn bộ ≤ 17,6 s; 40/40 kill; quay về 89,3 s | `011-update-x64.json` |
| Fuzz | TS mọi mục tiêu ≥ 1 giờ; C++ ASan + UBSan: gói 3.600 s (7,35 triệu biến thể), `logic-json` 3.601 s, `update-envelope` 3.600 s, project-json/expression/modbus 1.800 s; 0 sự cố | `011-fuzz-x64.json`, `011-fuzz-svg.json` |
| ctest ASan + UBSan | 5.888 ca; 56 đỏ lần đầu: 1 lỗi runtime (429 lịch sử alarm, đã sửa), 53 lỗi mã test, 2 ngân sách thời gian dưới ASan | T059 |
| Editor SVG (máy dev) | mở 20.000 nút 486 ms; hoàn tác 7,4 ms (2.000 phần tử) | `011-svg-perf.json` |
| Phụ thuộc | npm 0 lỗ hổng; cargo 1 Medium + 3 Low (rustls, không chạm tới; nâng từ 2026-10-28) | `011-audit-*.json` |

## 7. Còn phải làm trước khi đóng bản nháp

T076 (thu kết quả soak x64), T080 (L2 BL335), T087 (kết luận ba báo cáo), T201 (ngân sách, ADR-005, cách kết luận CPU logic và eMMC), T059 (`ci-local -Sanitize`), T200 (so cặp 0.6/1.0), rồi T198 (Go/No-Go, cần pilot).
