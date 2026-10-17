# Nghiệm thu feature 011: hoàn thiện, pilot, OTA, logic v2, trình vẽ SVG, template (T205)

> **Bản nháp — chờ T075–T087, T191, T198.** Chưa phải nghiệm thu: các lượt tải, soak, mất điện x64 và BL335 chưa chạy, bản `1.0.0-rc.1` chưa đóng gói, chưa có Go/No-Go. Mục chưa đo ghi "Chưa đo"; không gắn `1.0.0`.

Ngày lập: 2026-10-17. Nhánh `gd6` (commit `c86ebe85`). Bảng FR đầy đủ: [011-fr-matrix.md](011-fr-matrix.md). Số đo tải, soak, mất điện: [011-load.md](011-load.md), [011-soak.md](011-soak.md), [011-powercut.md](011-powercut.md).

Cách đọc: **Đạt** là test hoặc kịch bản tự động xanh, số đo trong ngưỡng; "(x64)" hoặc "(lab)" là trong container Docker (nhiều lượt chạy image `mat-armhf` trên Linux arm64, JSON ghi rõ máy). **Chưa đo** là làm được mà chưa chạy. **Chờ người** là cần người, thiết bị phụ, Windows, chứng chỉ thật hoặc khách hàng (mã mục ở §5).

## 1. Phiên bản

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Runtime | 1.0.0 | `kRuntimeVersion`; đang chạy trên BL335 từ 2026-10-17 (OTA tắt). Chưa có hậu tố `-rc.N` (FR-001): T191 |
| API thiết bị | 1.5.0 | MINOR kế tiếp của 1.4.0 (010) |
| Giao thức live | 1.3.0 | không đổi |
| Định dạng project | 1.0.0 | runtime nhận 0.1–1.0; Studio nâng cấp có sao lưu |
| Gói `.matupdate` | 1.0.0 | `mat-update-verify` armhf 214.592 B |
| Studio | 0.8.0 | **chưa nâng**; lên `1.0.0-rc.1` ở T191 (`release.ps1` đã cảnh báo lệch phiên bản) |
| Gói `.matscada` | không đổi | thêm từ chối tệp thừa `E_PACKAGE_EXTRA_FILE` |
| Constitution | 2.0.2 | PATCH T004 (ghi từ logic, OTA chỉ khi có HTTPS/đăng nhập/role/audit) |

## 2. Bảng theo SC

| SC | Nội dung ngắn | Trạng thái | Kết quả, bằng chứng |
|---|---|---|---|
| SC-001 | Medium 005–007 trong bảng truy vết | Đạt | `plan.md` "Phát hiện tồn"; P-01, P-12 chờ đo BL335, P-03 chờ người |
| SC-002 | ≥ 16 ca `Host`, rebinding | Đạt | ctest 22/22; `011-host-x64.json` 16/16; BL335: `evil.test` → 421, IP/`.local`/`localhost` → 200 |
| SC-003 | Khóa đăng nhập ≥ 14 ca; IP B ≤ 2 s | Đạt (x64) | 19 + 33 ca; 1.000 lần đoán: 20 lần kiểm mật khẩu, IP B ≤ 19 ms |
| SC-004 | Xung `kill -9` 20/20; nhật ký hỏng 20/20 | Đạt (x64) | `011-pulse-x64.json` |
| SC-005 | Gateway 1.000 chu kỳ | Đạt (x64) | `011-gateway-x64.json` |
| SC-006 | Tệp thừa ≥ 10 vector; 30 lần nạp | Đạt | 13 vector; `011-extra-file-x64.json` |
| SC-007 | `persist()` p99 ≤ 50 ms | Đạt (x64) | p99 6 ms |
| SC-008 | 40 TLS im lặng | Đạt (x64) · Chưa đo BL335 | `conn_limit_test`: nguồn khác 25 ms; BL335: T063 |
| SC-009 | audit, license, SAST, fuzz 7 mục tiêu | Chưa đo | audit, license, SAST đạt; fuzz 1 giờ chỉ `update-envelope` (0 sự cố); còn T058, T142, T165 |
| SC-010 | 0 Critical/High mở; Medium mở chỉ chờ người | Chưa đo | lần 1 đạt (0 Critical; K1 High đã sửa; O1, O2 chờ người); lần 2 T202; chạy lại trọn `web-it attack` |
| SC-011 | BL335 500 Tag × 10 client × 4 giờ | Chưa đo | T075, T079; tham khảo 0.9.0: CPU 12,8 % một lõi, RSS 12,1 MB, 0 mất sequence (30 phút) |
| SC-012 | BL335 1.000 Tag | Chưa đo | T080 |
| SC-013 | Soak 7 ngày BL335 | Chưa đo | T076, T081; **rủi ro**: ghi khối toàn máy nền 2,6–4,7 GB/ngày khi mat tắt (`011-soak.md` §4) |
| SC-014 | Mất điện 100 vòng + 5 điểm | Chờ người | B4; D2 (kill tiến trình) 40/40 và D4 20/20 đạt ở lab |
| SC-015 | Cắt mạng 50 lần | Chưa đo | x64 T078; BL335 B7 |
| SC-016 | Tuổi thọ eMMC | Chờ người | datasheet B5 (T082) |
| SC-017 | Ký thử 3 tệp, 12 ca hỏng, cổng `-Release` | Chờ người | cổng 8/8 đạt; ca hỏng 6–11 đạt; Authenticode cần Windows |
| SC-018 | `release.ps1` 9 mục ≤ 30 phút; SBOM | Chờ người | SBOM 836 thành phần; dry-run ngoài Windows 4,3 s (`011-release-dryrun.md`) |
| SC-019 | Chứng chỉ thật trên Windows 10/11 sạch | Chờ người | R1, R3 |
| SC-020 | OTA 20/20, ngừng ≤ 30 s, ≥ 25 gói xấu | Đạt (lab) | ngừng ≤ 9,6 s, toàn bộ ≤ 17,6 s; 31/31 gói xấu (`011-update-x64.json`) |
| SC-021 | OTA bền 40 kill; quay về ≤ 90 s | Đạt (lab) | 40/40; quay về 89,3 s |
| SC-022 | OTA bảo mật | Đạt | `update_api_test`; `update-x64` `auth`, `downgrade` |
| SC-023 | BL335 10 OTA thật, 5 lần cắt | Chờ người | B4, B9, R2 |
| SC-024 | ≥ 200 vector logic TS = C++ | Đạt | 279/279 (x64 và armhf qemu) |
| SC-025 | Độ chính xác logic | Đạt | Vitest + ctest 52 ca |
| SC-026 | Logic retain 100 vòng `kill -9` | Chưa đo | T146 |
| SC-027 | Ghi từ logic qua giả lập Modbus | Chưa đo | `logic_write_test` 11/11 (driver giả) đạt; kịch bản giả lập T146 |
| SC-028 | Tải logic | Chưa đo | engine p99 0,62 ms (x64); CPU/RSS T147, T148 |
| SC-029 | Kỹ sư dựng luật bơm ≤ 25 phút | Chờ người | H3 |
| SC-030 | Round-trip ≥ 20 fixture | Đạt | 26 fixture, ảnh khác 0 % |
| SC-031 | ≥ 150 ca hình học | Đạt | ~270 ca |
| SC-032 | Hoàn tác 1.000 chuỗi | Đạt | `command.test.ts` |
| SC-033 | Hiệu năng editor (máy dev) | Đạt | mở 20.000 nút 486 ms; kéo trong 2.000: khoảng khung p95 16,8 ms (nhịp 60 Hz, xử lý 1,7 ms); chọn khung ≤ 29 ms |
| SC-034 | Fuzz lệnh 100.000, 10 SVG độc, lint | Đạt | |
| SC-035 | Kill Studio 20 lần; thử tay | Chưa đo | kill giả lập ở `svg-state.test.ts`; kill thật chưa làm; bộ gõ, NVDA: H4 |
| SC-036 | Ký hiệu bơm ≤ 20 phút | Chờ người | H4 |
| SC-037 | Template 20/20, faceplate 20 bơm | Chưa đo | đạt trên runtime giả (`web-it faceplate` 103/103); chạy lại trên runtime x64 (T175) |
| SC-038 | `docs-check` 0 lỗi; người thử ≥ 90 % | Chờ người | `docs-check` 0 lỗi (258 tệp); H1 |
| SC-039 | Huấn luyện | Chờ người | H2, K5 |
| SC-040 | Pilot ≥ 30 ngày | Chờ người | K1–K6, P1–P3 |
| SC-041 | Biên bản ký; `kpi.mjs` khớp mẫu | Chờ người | `kpi.mjs` 16/16 đạt; biên bản K9 |
| SC-042 | Hồi quy `ci-local` với bước mới | Chưa đo | T059, T200 |
| SC-043 | Go/No-Go | Chờ người | T198, P4 |

Tổng: 17 Đạt, 13 Chưa đo, 13 Chờ người, 0 Không đạt (không SC nào có số đo vượt ngưỡng).

## 3. Hạn chế còn lại

1. **Chưa có lượt hồi quy đầy đủ sau khi gộp các nhánh** (`ci-local` với ASan ctest, audit, SAST, `update-it`, `logic-it`): T059, T200. Các nhánh chỉ chạy bộ test của module bị sửa.
2. **Fuzz 1 giờ** chỉ có cho `update-envelope`; sáu mục tiêu còn lại chưa chạy (T058, T142, T165).
3. **Tải, soak, mất điện** chưa có số của 1.0.0 (T075–T086); số tham khảo của 0.9.0 trên BL335 xa ngưỡng. Ghi khối toàn máy của BL335 hiện có đã vượt 2 GB/ngày khi mat tắt (dịch vụ khác): cần quyết định cách kết luận ngân sách eMMC ở T201.
4. **Ký số và cài đặt trên Windows** chưa chạy (signtool, Authenticode, bộ cài NSIS, PowerShell 5.1, WebView2); không có chứng chỉ thật, chưa có khóa phát hành thật.
5. **Logic**: `tools/logic-it.ps1` (T146) chưa có; CPU/RSS runtime với `projects/logic-load` chưa đo; chưa có lệnh "dán kèm binding" của editor SVG (tùy chọn).
6. **Faceplate** chỉ đạt trên runtime giả; chạy `web-it -Scenario faceplate` trên runtime x64 với `dashboard-demo` 1.0 còn chờ.
7. **Collector pilot**: `audit` chỉ cho administrator mà collector dùng viewer (ghi `FORBIDDEN`); chưa thử Credential Manager trên PowerShell 5.1.
8. **Load-tester**: thiếu phần L3 "client mới vào ≤ 35 s sau khi client 1 ngắt"; `maxLiveClientsPerSource` mặc định 5 nên bàn đo 10 client từ một máy phải đặt 10.
9. **Fixture SVG** của Illustrator và CorelDRAW là mô phỏng, không phải tệp xuất thật.
10. **Tài liệu người dùng**: còn phần OTA, ký bản phát hành và ảnh chụp Studio mới (T203).

## 4. Phát hiện rà soát bảo mật

Nguồn: [011-security-review.md](011-security-review.md) (T062 lần 1, 2026-10-17, năm lượt song song). Lần 2 (T202) chưa chạy.

| Mức | Số lượng | Tình trạng |
|---|---|---|
| Critical | 0 | — |
| High | K1 (phát lại gói `keyset` cũ để thêm lại khóa đã thu hồi; báo cáo tính là hai High cùng một lỗi) | **Đã sửa** (`trusted-keys/keyset-seq`; `updater_test.sh` mục 8) |
| Medium | U3, U4, M1, LG1–LG6, F1, F2, F3 đã sửa kèm test; **O1, O2 mở** | xem dưới |
| Low, Info | U6–U11, L1–L8, LG7–LG12, S1–S7, F4–F8 | đã sửa hoặc ghi nhận (S6, U11) |

Quyết định đang chờ người:

- **O1** (Medium): thao tác `rollback` của `mat-updater` không cần chữ ký; tài khoản `matscada` bị chiếm có thể quay về `.prev` (bản cũ đã ký) mỗi 300 s mà không xác thực lại. Lựa chọn: chấp nhận (ghi rủi ro), hoặc thêm ngưỡng `minReleaseSeq`.
- **O2** (Medium): một khóa tin cậy bất kỳ ký được gói `keyset` gỡ mọi khóa khác (chỉ cấm tự gỡ): một khóa bị lộ chiếm được bộ khóa. Lựa chọn: đòi hai chữ ký khác nhau cho `keyset` có `remove`.

Việc còn lại từ rà soát: kiểm trên Windows các đường F2, F5, F6, S5; chạy `ci-local` đầy đủ sau khi gộp; T202.

## 5. Việc chờ người

Danh sách tập trung ở [docs/pilot/customer-checklist.md](../pilot/customer-checklist.md) (FR-143); bảng dưới là bản tóm tắt ngày 2026-10-17, khi lệch thì theo checklist.

| # | Việc | Chặn |
|---|---|---|
| K1–K9 | Khách hàng: chọn site, ký thỏa thuận và xử lý dữ liệu; BL335 và nguồn ở site; PLC thật và xác nhận PLC tự nhả xung; IP tĩnh, NTP, VPN; danh sách người huấn luyện; dựng project site; chọn ≥ 10 tác vụ nghiệm thu; phạm vi tính năng pilot; ký biên bản | T186, T192–T197, E8, E9, X8–X10 |
| B1 | Đường SSH tới BL335 (đã có lại qua LAN ngày 2026-10-17 theo `device-changes.md`; checklist còn ghi "chờ") | T013, T063, T079–T086, T122, T123, T148, T149 |
| B2, B3 | Đổi mật khẩu root yếu, đóng chuyển cổng SSH ra Internet; gia cố SSH khi có người ở cạnh (thiết bị vẫn báo `SSH_ROOT_PASSWORD`) | T064 |
| B4 | Lắp bộ điều khiển nguồn, thử khô 5 lần | T083–T085, T123 |
| B5 | Datasheet chip eMMC | T082, X5 |
| B6 | Máy khác trong LAN chạy giả lập Modbus và `load-tester` 7 ngày | T081 |
| B7 | Người cắt mạng 50 lần | T086 |
| B8 | Chọn PLC hoặc giả lập để thử logic ghi PLC | T149 |
| B9 | Đồng ý bật `update.enabled` trên bàn thử | T122, T123 |
| R1 | Mua chứng chỉ ký mã, máy ký, URL dấu thời gian | T103–T105, E4 |
| R2 | Sinh hai khóa ECDSA phát hành ngoại tuyến | T103, T122 |
| R3 | Cài thử Studio trên Windows 10/11 sạch | T105 |
| H1–H4 | Người thử bảng tác vụ; huấn luyện thử nội bộ; kỹ sư thử editor logic; thử bộ gõ, NVDA và ký hiệu bơm trong trình vẽ | T150, T167, T186 |
| P1–P4 | Cài rc lên site, chạy pilot ≥ 30 ngày, đo trễ Chrome và `EXT_CSD`, Tech Lead ký vào và Go/No-Go | T193–T198 |
| O1, O2 | Quyết định về rollback không ký và keyset một chữ ký (§4) | T202, T198 |

Ngoài danh sách người: việc làm được không cần người nhưng chưa chạy: T058, T059, T075–T078, T142, T146, T147, T165, T175 (faceplate x64), T191, T200, T202, T203; trên BL335 qua LAN (cần người dùng cho phép theo Constitution): T013, T063, T079, T080, T148.

## 6. Số đo chính đã có

| Mục | Số đo | Nơi |
|---|---|---|
| BL335 runtime 1.0.0 rảnh | RSS 9,5 MB, 99 luồng, CPU 0,7 % một lõi, NRestarts 0; `deploy.sh` 13 s, health sau 1 s | `device-changes.md` 2026-10-17 |
| BL335 `mat-update-verify` | ≈ 16 ms/lần kiểm (Cortex-A7, gói 5 KiB) | như trên |
| BL335 runtime 0.9.0 (tham khảo) | tải 30 phút 10 Chrome 509 Tag: RSS 11,6 MB, CPU 12,8 %; mở màn 615 ms trung vị; 10 F5 tệ nhất 1,13 s; trễ live p95 297 ms | `device-changes.md` 2026-10-16 |
| OTA lab | ngừng ≤ 9,6 s, toàn bộ ≤ 17,6 s; 40/40 kill; quay về 89,3 s | `011-update-x64.json` |
| Logic engine | 550 khối, quét p99 0,62 ms, tối đa 0,90 ms | `011-logic-load-x64.json` |
| Editor SVG (máy dev) | mở 20.000 nút 486 ms; hoàn tác 7,4 ms (2.000 phần tử) | `011-svg-perf.json` |
| Fuzz `update-envelope` | 3.600 s, 54 triệu đầu vào, 0 sự cố | `011-fuzz-x64.json` |
| Phụ thuộc | npm 0 lỗ hổng; cargo 1 Medium + 3 Low (rustls, không chạm tới; nâng từ 2026-10-28) | `011-audit-*.json` |

## 7. Còn phải làm trước khi đóng bản nháp

T075–T087 (số tải, soak, mất điện), T191 (đóng gói `1.0.0-rc.1`, nâng Studio), T198 (Go/No-Go), cùng T059/T200 (hồi quy), T202 (rà soát lần 2), T201 (ngân sách, ADR-005).
