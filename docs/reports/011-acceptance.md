# Nghiệm thu feature 011: hoàn thiện, pilot, OTA, logic v2, trình vẽ SVG, template (T205)

> **Bản nháp — chờ T198 (go/no-go, Tech Lead) và pilot T192–T197.** Mọi phép đo tự làm được (x64, BL335 qua LAN) đã có kết quả; phần còn lại cần người (mất điện, cắt mạng, gia cố SSH trên BL335), Windows (ký số, bộ cài), khách hàng (pilot) hoặc quyết định Go/No-Go. Mục chưa đo ghi "Chưa đo"; không gắn `1.0.0`.

Lập 2026-10-17; cập nhật 2026-10-18; **cập nhật 2026-10-19** trên nhánh `gd6-final-docs` (từ `gd6` `5fbb4269`). Bảng FR đầy đủ: [011-fr-matrix.md](011-fr-matrix.md). Số đo tải, soak, mất điện (đã kết luận, T087): [011-load.md](011-load.md), [011-soak.md](011-soak.md), [011-powercut.md](011-powercut.md). Ghi chú phát hành: [1.0.0-rc.1](../release/notes/1.0.0-rc.1.md).

Cách đọc: **Đạt** là test hoặc kịch bản tự động xanh, số đo trong ngưỡng; "(x64)" hoặc "(lab)" là trong container Docker (các lượt 011 chạy image `mat-armhf` trên Linux arm64 của máy Mac Apple Silicon, không phải x64 thật; JSON ghi rõ máy). **Không đạt** là số đo vượt ngưỡng hoặc việc chưa xong. **Chưa đo** là làm được mà chưa chạy, hoặc hoãn có quyết định. **Chờ người** là cần người, thiết bị phụ, Windows, chứng chỉ thật hoặc khách hàng (mã mục ở §5). Dòng có hai phần tính theo phần yếu hơn, cùng quy tắc với bảng FR.

## 1. Phiên bản

| Thành phần | Phiên bản | Ghi chú |
|---|---|---|
| Runtime | 1.0.0-rc.1 | `kRuntimeVersion`, `RUNTIME_VERSION` nâng ở T191. **BL335 chạy `1.0.0-rc.1` releaseSeq 13** (cài bằng `deploy.sh` 2026-10-18 12:32, commit `af6d129a`, gồm quét logic theo sự kiện; `.prev` là releaseSeq 12); project `tank-demo` 0.1.0; `runtime.json` gốc; OTA tắt, không khóa tin cậy. OTA sau này chỉ nhận gói có releaseSeq > 13, trừ khi cài lại bằng `deploy.sh` |
| API thiết bị | 1.5.0 | MINOR kế tiếp của 1.4.0 (010) |
| Giao thức live | 1.3.0 | không đổi |
| Định dạng project | 1.0.0 | runtime nhận 0.1–0.6 và 1.0; Studio nâng cấp có sao lưu; gói runtime chép mọi bộ schema đóng băng (sửa 95effeb5, kiểm trên thiết bị ở T080 với `bench-1000` định dạng 0.6) |
| Gói `.matupdate` | 1.0.0 | `mat-update-verify` armhf 214.592 B; so SemVer đầy đủ (rc.1 < 1.0.0) |
| Studio | 1.0.0-rc.1 | `package.json`, `tauri.conf.json`, `Cargo.toml`; `build-info.mjs versions --expect 1.0.0-rc.1` đồng nhất. Bộ cài NSIS dựng và ký thử trên Windows 11 (T093, T098, 2026-10-19); không ký Authenticode của CA (sản phẩm nội bộ, quyết định 2026-10-19; T103, T104 không áp dụng) |
| Gói `.matscada` | không đổi | thêm từ chối tệp thừa `E_PACKAGE_EXTRA_FILE` |
| Constitution | 2.0.2 | PATCH T004 (ghi từ logic, OTA chỉ khi có HTTPS/đăng nhập/role/audit) |

## 2. Bảng theo SC

| SC | Nội dung ngắn | Trạng thái | Kết quả, bằng chứng |
|---|---|---|---|
| SC-001 | Medium 005–007 trong bảng truy vết | Đạt | `plan.md` "Phát hiện tồn"; P-01, P-12 đã đo trên BL335 (T063, T079 L8); P-03 chờ người áp dụng |
| SC-002 | ≥ 16 ca `Host`, rebinding | Đạt | ctest 22/22; `011-host-x64.json` 16/16; BL335 rc.1 (T063): `evil.test` → 421 trên HTTP và HTTPS, IP/`.local`/`localhost` → 200 |
| SC-003 | Khóa đăng nhập ≥ 14 ca; IP B ≤ 2 s | Đạt (x64) | 19 + 33 ca; 1.000 lần đoán: 20 lần kiểm mật khẩu, IP B ≤ 19 ms |
| SC-004 | Xung `kill -9` 20/20; nhật ký hỏng 20/20 | Đạt (x64) | `011-pulse-x64.json`; thêm D4 trong rig powercut x64 10/10 (T077) |
| SC-005 | Gateway 1.000 chu kỳ | Đạt (x64) | `011-gateway-x64.json` |
| SC-006 | Tệp thừa ≥ 10 vector; 30 lần nạp | Đạt | 13 vector; `011-extra-file-x64.json` |
| SC-007 | `persist()` p99 ≤ 50 ms | Đạt (x64) | p99 6 ms |
| SC-008 | 40 TLS im lặng | Đạt | x64 `conn_limit_test` nguồn khác 25 ms; **BL335 rc.1 (T063)**: 43/43 đăng nhập từ địa chỉ khác, chậm nhất 837 ms, RSS 9,5 → 8,2 MB (đỉnh 27,9 MB là Argon2id); T079 L8 tệ nhất 1.198 ms, RSS +0,3–0,7 MB (`011-security-bl335.json`) |
| SC-009 | audit, license, SAST, fuzz 7 mục tiêu ≥ 1 giờ | Đạt | audit, license, SAST đạt; fuzz TS mọi mục tiêu ≥ 1 giờ (T058, T142, T165); C++ ASan + UBSan: `update-envelope`, gói `.matscada`, `logic-json`, project-json, expression, modbus mỗi mục ≥ 1 giờ (T058 xong 2026-10-18); 0 sự cố (`011-fuzz-x64.json`) |
| SC-010 | 0 Critical/High mở; Medium mở chỉ chờ người | Đạt | T062 và T202 (lần 2): 0 Critical/High mở; K1, N-OTA1–3 đã sửa; O1 chấp nhận, O2 hoãn sau pilot; phát hiện Low của T200 (ngân sách audit 421) đã sửa; `web-it attack` trong `ci-local` xanh |
| SC-011 | BL335 500 Tag × 10 client × 4 giờ | Đạt (BL335) | T079 (runtime 1.0.0): CPU 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 %; RSS ≤ 19,5 MB đi ngang; 0 mất sequence; client 11 4429 50/50; F5 10 trang × 50 vòng tối đa 935 ms. T079 chưa đóng vì ba mục không có ngưỡng của SC: `mat-sample` trên thiết bị, L1 xen kẽ 8443, RSS tab L5 |
| SC-012 | BL335 1.000 Tag | Đạt | T080 (rc.1 releaseSeq 12, 1 giờ, 10 client): CPU 43,8 % một lõi (≤ 50 %), RSS 12,8 MB, 0 mất sequence |
| SC-013 | Soak 7 ngày BL335 | Chưa đo | **Hoãn theo quyết định người dùng 2026-10-18** (T081 không chạy ở GĐ 6); thay bằng soak x64 24 giờ (**T076 xong**: 48/48 đoạn tải, 0 mất sequence, 47 `kill -9`, 9/9 nạp xuống, RSS ≤ 34,1 MB, dữ liệu toàn vẹn), L1 4 giờ BL335 (T079), soak 30 ngày bàn thử khi pilot (T196). eMMC: kết luận theo phần ghi của mat (quyết định T201, `011-soak.md` §4) |
| SC-014 | Mất điện 100 vòng + 5 điểm | Chờ người | x64 (**T077 xong**): 100 vòng ngẫu nhiên + D1, D3, D4, D5 × 10 `kill -9` đạt, D2 40/40 (`update-it kill`), 0 lệnh ACCEPTED thiếu audit; BL335 cần bộ điều khiển nguồn (B4; T083–T085) |
| SC-015 | Cắt mạng 50 lần | Chờ người | x64 (T078): 500/500 nối lại, 0 lần > 35 s (tối đa 8,7 s), 0 slot rò; BL335 cần người cắt mạng (T086, B7) |
| SC-016 | Tuổi thọ eMMC | Chờ người | T013: sysfs `life_time` `0x01 0x01`, `pre_eol_info` `0x01` (bình thường); tuổi thọ tuyệt đối cần datasheet (B5, T082) |
| SC-017 | Ký thử 3 tệp, 12 ca hỏng, cổng `-Release` | Chờ người | cổng 8/8 đạt; ca hỏng 6–12 đạt (T191); ca 1–5 và Authenticode cần Windows |
| SC-018 | `release.ps1` 9 mục ≤ 30 phút; SBOM | Chờ người | SBOM 836 thành phần; T191: `release.ps1` chế độ thử bằng pwsh trên macOS tạo `release/1.0.0-rc.1/` (bước 4–9 đạt; bước 3 bộ cài cần Windows) |
| SC-019 | Chứng chỉ thật trên Windows 10/11 sạch | Chờ người | R1, R3 |
| SC-020 | OTA 20/20, ngừng ≤ 30 s, ≥ 25 gói xấu | Đạt (lab) | ngừng ≤ 9,6 s, toàn bộ ≤ 17,6 s; 31/31 gói xấu (`011-update-x64.json`; `update-it` trong `ci-local` xanh) |
| SC-021 | OTA bền 40 kill; quay về ≤ 90 s | Đạt (lab) | 40/40; quay về 89,3 s |
| SC-022 | OTA bảo mật | Đạt | `update_api_test`; `update-x64` `auth`, `downgrade` |
| SC-023 | BL335 10 OTA thật, 5 lần cắt | Chờ người | **10 OTA thật Đạt (T122)**: 10/10 `committed`, ngừng 13,2–15,9 s (trung bình 14,5 s), toàn bộ 21,1–24,0 s, quay về bằng tay đạt, audit đủ (`011-ota-bl335.json`); 5 lần cắt điện giữa bước chờ bộ điều khiển nguồn (T123, B4) |
| SC-024 | ≥ 200 vector logic TS = C++ | Đạt | 279/279 (x64 và armhf qemu); sau tối ưu T148: C++ 287, TS 396 xanh |
| SC-025 | Độ chính xác logic | Đạt | Vitest + ctest 52 ca |
| SC-026 | Logic retain 100 vòng `kill -9` | Đạt (x64) | T146 `retain-kill` 100 vòng: mất tối đa count 6, total 0,95, giờ chạy 0,0027 (≤ một `flushS`), 0 lần giảm, 0 ghi trùng cạnh; `retain-lost` 5/5 (`011-logic-x64.json`). BL335 cắt điện (D5) là T149 |
| SC-027 | Ghi từ logic qua giả lập Modbus | Đạt (x64) | T146 `rules` 9/9 (audit đủ trường trước khi gửi), `writes-off` 0 lệnh, `throttle` chặn 35/35 cạnh thừa; validator từ chối ghi Tag không khai báo |
| SC-028 | Logic tối đa trên BL335 | Đạt | **T148 xong** (releaseSeq 13, quét theo sự kiện): CPU +2,5 điểm một lõi, RSS +3,8 MB, quét trung vị 1,05 ms, p99 2,6 ms (`011-logic-bl335.json` `remeasureEventDriven`). T147 xong (x64, Linux arm64 64 bit, L1 1 giờ, sau sửa bộ nhớ 2026-10-19): CPU +0,58, RSS +4,49 MiB, quét p99 2,7 ms — đạt (`011-logic-load-x64.json` `runtimeL1b`) |
| SC-029 | Kỹ sư dựng luật bơm ≤ 25 phút | Chờ người | H3 |
| SC-030 | Round-trip ≥ 20 fixture | Đạt | 26 fixture, ảnh khác 0 % |
| SC-031 | ≥ 150 ca hình học | Đạt | ~270 ca |
| SC-032 | Hoàn tác 1.000 chuỗi | Đạt | `command.test.ts` |
| SC-033 | Hiệu năng editor (máy dev) | Đạt | mở 20.000 nút 486 ms; kéo trong 2.000: khoảng khung p95 16,8 ms (nhịp 60 Hz, xử lý 1,7 ms); chọn khung ≤ 29 ms |
| SC-034 | Fuzz lệnh 100.000, 10 SVG độc, lint | Đạt | thêm lượt dài `svg-edit-commands` 3.600 s (T165) |
| SC-035 | Kill Studio 20 lần; thử tay | Chưa đo | kill giả lập ở `svg-state.test.ts`; kill thật chưa làm; bộ gõ, NVDA: H4 |
| SC-036 | Ký hiệu bơm ≤ 20 phút | Chờ người | H4 |
| SC-037 | Template 20/20, faceplate 20 bơm | Đạt (x64) | `web-it -Scenario faceplate` 103/103 trên runtime x64 với `dashboard-demo` 1.0 (`011-faceplate-x64.json`); 88 vector |
| SC-038 | `docs-check` 0 lỗi; người thử ≥ 90 % | Chờ người | `docs-check` 0 lỗi; H1 |
| SC-039 | Huấn luyện | Chờ người | H2, K5 |
| SC-040 | Pilot ≥ 30 ngày | Chờ người | K1–K6, P1–P3 |
| SC-041 | Biên bản ký; `kpi.mjs` khớp mẫu | Chờ người | `kpi.mjs` 16/16 đạt; biên bản K9 |
| SC-042 | Hồi quy `ci-local` với bước mới; so cặp | Đạt | **T200 xong** (2026-10-18 tối, gd6 sau `gd6-audit-budget`): `ci-local` đầy đủ xanh, ghi giờ từng bước; **T059**: `ci-local -Sanitize` ctest ASan + UBSan 5.946/5.948 (2 `MallocTuning` bỏ qua có lý do: ASan thay malloc của glibc), fuzz C++ 20 s đạt; so cặp 0.9.0 ↔ 1.0.0-rc.1 không hồi quy (`011-regression-pair.md`) |
| SC-043 | Go/No-Go | Chờ người | T198, P4 |

Tổng: **27 Đạt, 0 Không đạt, 2 Chưa đo (SC-013 hoãn theo quyết định người dùng, SC-035), 14 Chờ người** (khớp `011-fr-matrix.md`, đếm 2026-10-19). Lần trước (2026-10-18): 25, 0, 4, 14; chuyển Đạt: SC-009 (T058), SC-042 (T059, T200).

## 3. Hạn chế còn lại

1. **Mất điện, cắt mạng trên BL335 chưa đo** (T083–T086, T123, T149): cần bộ điều khiển nguồn và người ở cạnh. Tiền kiểm x64 (`docker kill`) không mô phỏng mất page cache hay eMMC ngắt giữa lần ghi trang.
2. **Soak 7 ngày BL335 không chạy** (quyết định người dùng 2026-10-18); độ dốc RSS nhiều ngày, FD/luồng, `dmesg`, ghi eMMC trên thiết bị chờ soak 30 ngày bàn thử (T196).
3. **eMMC:** ghi khối toàn máy BL335 nền 2,6–4,7 GB/ngày khi mat tắt (dịch vụ khác); quyết định T201 kết luận ngưỡng 2 GB/ngày theo phần ghi của mat (`sqlite-vfs`); tuổi thọ tuyệt đối cần datasheet (T082). Bố cục phân vùng A/B chưa khớp Master Plan §6.3 (OS dev image, phụ thuộc ADR-002).
4. **CPU L1 theo một lõi còn biên 1,1 điểm** (28,9/30 %): project lớn hơn `soak-standard` (logic, nhiều lịch sử) cần đo trước khi hứa với khách hàng.
5. **T079 chưa đóng:** `mat-sample` chưa chạy trên BL335, L1 chưa xen kẽ 8443 (`load-tester` chưa có `wss://`), RSS tab ở L5 chưa đo. Lỗi gói thiếu `schemas/0.6` đã sửa và kiểm (T080).
6. **T147 (x64): xong 2026-10-19.** RSS logic tối đa trên Linux arm64 64 bit trước +5,4 MiB; nguồn là dữ liệu dựng lúc khởi động giữ suốt đời và cây JSON của `GET /logic`; sau sửa +4,49 MiB ở L1 1 giờ (`runtimeL1b`).
7. **Chưa có mã cảnh báo** cho RAM khả dụng < 250 MB và tuổi thọ eMMC > 70 % (Master Plan §6.1, §6.3); số có trong `system/diagnostics`, theo dõi bằng collector khi pilot.
8. **Ký số và cài đặt trên Windows** chưa chạy (signtool, Authenticode, bộ cài NSIS, PowerShell 5.1, WebView2); không có chứng chỉ thật, chưa có khóa phát hành thật.
9. **Collector pilot**: `audit` chỉ cho administrator mà collector dùng viewer (ghi `FORBIDDEN`); chưa thử Credential Manager trên PowerShell 5.1.
10. **`maxLiveClientsPerSource` mặc định 5:** nhiều máy sau một NAT hoặc bàn đo 10 client từ một máy phải đặt 10.
11. **Fixture SVG** của Illustrator và CorelDRAW là mô phỏng, không phải tệp xuất thật.
12. **Tài liệu người dùng**: phần chữ xong (T203); còn ảnh chụp Studio trên Windows.
13. **Thiết bị BL335:** sshd vẫn cho root bằng mật khẩu (T013, cảnh báo `SSH_ROOT_PASSWORD`); gia cố cần người ở cạnh (T064).

## 4. Phát hiện rà soát bảo mật

Nguồn: [011-security-review.md](011-security-review.md): lần 1 (T062, 2026-10-17, năm lượt song song), lần 2 (T202, §7) và phát hiện của T200. Đã đóng.

| Mức | Số lượng | Tình trạng |
|---|---|---|
| Critical | 0 | — |
| High | K1 (phát lại gói `keyset` cũ để thêm lại khóa đã thu hồi; báo cáo tính là hai High cùng một lỗi) | **Đã sửa** (`trusted-keys/keyset-seq`; `updater_test.sh` mục 8) |
| Medium | lần 1: U3, U4, M1, LG1–LG6, F1, F2, F3; lần 2: N-OTA1–3 | **Đã sửa** kèm test; **O1, O2 đã quyết định** (dưới) |
| Low, Info | lần 1: U6–U11, L1–L8, LG7–LG12, S1–S7, F4–F8; lần 2: N3, N5–N9, N-L1–L5, N-S1, N-S2, N-SVG1/2, N-A1; T200: dòng 421 của Host policy dùng chung ngân sách audit 10 dòng/phút với đăng nhập sai (có thể che bằng chứng dò mật khẩu) | đã sửa hoặc ghi nhận (S6, U11); T200 sửa ở `gd6-audit-budget` (ngân sách audit riêng cho Host policy, test viết trước) |

Quyết định (người dùng giao quyền, 2026-10-17, ADR-035):

- **O1** (Medium): `rollback` của `mat-updater` không cần chữ ký: **chấp nhận là rủi ro còn lại** (tối đa 1 lần/300 s, có audit, chỉ về bản đã ký từng cài); xem lại ngưỡng `minReleaseSeq` sau pilot.
- **O2** (Medium): một khóa tin cậy ký được gói `keyset` gỡ mọi khóa khác: **hoãn sau pilot** (M-of-N cần đổi định dạng phong bì); giảm thiểu bằng hai khóa phát hành giữ tách biệt ngoại tuyến.

Cổng T202 đạt: không Critical/High mở; `ci-local` đầy đủ xanh sau gộp. Việc còn lại từ rà soát: kiểm trên Windows các đường F2, F5, F6, S5.

## 5. Việc chờ người

Danh sách tập trung ở [docs/pilot/customer-checklist.md](../pilot/customer-checklist.md) (FR-143); bảng dưới là bản tóm tắt ngày 2026-10-19, khi lệch thì theo checklist.

| # | Việc | Chặn |
|---|---|---|
| K1–K9 | Khách hàng: chọn site, ký thỏa thuận và xử lý dữ liệu; BL335 và nguồn ở site; PLC thật và xác nhận PLC tự nhả xung; IP tĩnh, NTP, VPN; danh sách người huấn luyện; dựng project site; chọn ≥ 10 tác vụ nghiệm thu; phạm vi tính năng pilot; ký biên bản | T186, T192–T197, E8, E9, X8–X10 |
| B1 | Đường SSH tới BL335: có qua LAN, người dùng cho phép (đã dùng cho T013, T063, T079, T080, T122, T148, L3 `-reentry` ngày 2026-10-17/18) | chỉ còn phần còn lại của T079 (tự làm được) |
| B2, B3 | Đổi mật khẩu root yếu, đóng chuyển cổng SSH ra Internet; gia cố SSH khi có người ở cạnh (thiết bị vẫn báo `SSH_ROOT_PASSWORD`) | T064 |
| B4 | Lắp bộ điều khiển nguồn, thử khô 5 lần | T083–T085, T123, T149 |
| B5 | Datasheet chip eMMC (`S0311D`, manfid `0xea`) | T082, X5 |
| B6 | Máy khác trong LAN chạy giả lập Modbus và `load-tester` 7 ngày | **không cần ở GĐ 6** (T081 hủy theo quyết định người dùng) |
| B7 | Người cắt mạng 50 lần | T086 |
| B8 | Chọn PLC hoặc giả lập để thử logic ghi PLC | T149 |
| B9 | Bật `update.enabled` trên bàn thử | đã cho phép và dùng ở T122; còn T123 (cần B4) |
| R1 | ~~Mua chứng chỉ ký mã~~ không áp dụng (nội bộ, 2026-10-19); còn cài thử Windows sạch | T105, E4 |
| R2 | Sinh hai khóa ECDSA phát hành ngoại tuyến (cho `SHA256SUMS` và gói OTA; vẫn cần dù không mua chứng chỉ) | trước pilot |
| R3 | Cài thử Studio trên Windows 10/11 sạch | T105 |
| H1–H4 | Người thử bảng tác vụ; huấn luyện thử nội bộ; kỹ sư thử editor logic; thử bộ gõ, NVDA và ký hiệu bơm trong trình vẽ | T150, T167, T186 |
| P1–P4 | Cài rc lên site và bàn thử, chạy pilot ≥ 30 ngày, đo trễ Chrome, `EXT_CSD` và soak 30 ngày bàn thử (T196), Tech Lead ký vào và Go/No-Go | T193–T198 |
| Windows | Spike signtool, chứng chỉ thử, dựng bộ cài ký, `release.ps1` đủ 9 bước, ca hỏng 1–5, ảnh chụp Studio | T009, T088, T091–T094, T098, T102, T203 |

Việc làm được không cần người nhưng chưa xong: phần còn lại của T079 (`mat-sample` trên BL335, `wss://` cho L1 xen kẽ 8443, RSS tab L5), T189 (collector viewer và `audit`), T208 (`/speckit-analyze` cuối; chuyển ADR chỉ ở T198).

## 6. Số đo chính đã có

| Mục | Số đo | Nơi |
|---|---|---|
| BL335 rc.1 rảnh | RSS 9,5 MB (8,2 MB sau L8); CPU 0,7 % một lõi (1.0.0); NRestarts 0; `deploy.sh` kiểm sức khỏe sau 1 s | `device-changes.md` 2026-10-18, `011-load.md` §1.7 |
| BL335 L1 4 giờ (1.0.0) | CPU 28,9 % một lõi (14,5 % cả máy), đỉnh 50,4 %; RSS ≤ 19,5 MB; 0 mất sequence; MemAvailable ≥ 859 MB | `011-load.md` §3.1 |
| BL335 L2 1.000 Tag (rc.1) | CPU 43,8 % một lõi, đỉnh 47,5 %; RSS 12,8 MB; 0 mất sequence | `011-load-bl335.json` `L2` |
| BL335 L3, L4, L5, L8 | 50/50 4429, vào lại 9 ms (đóng sạch) / 15 s (im lặng); F5 tối đa 935 ms; ≥ 53,4 FPS; đăng nhập tệ nhất 1.198 ms | `011-load-bl335.json` |
| BL335 L7 logic tối đa (rc.1 releaseSeq 13) | +2,5 điểm CPU một lõi, RSS +3,8 MB, quét trung vị 1,05 ms, p99 2,6 ms | `011-logic-bl335.json` `remeasureEventDriven` |
| BL335 OTA thật (T122) | 10/10 `committed`; ngừng 13,2–15,9 s; toàn bộ 21,1–24,0 s | `011-ota-bl335.json` |
| BL335 `mat-update-verify` | ≈ 16 ms/lần kiểm (Cortex-A7, gói 5 KiB) | `device-changes.md` 2026-10-17 |
| BL335 ghi khối toàn máy | mat tắt 2,6–4,7 GB/ngày, mat chạy 3,5–3,8 GB/ngày (0.9.0, cửa sổ 3 phút); phần mat ước < ~1 GB/ngày | `011-soak.md` §4 |
| x64 L1 1 giờ, L4, L6, L8 | CPU 4,3 %, RSS ≤ 25 MB; F5 tối đa 494 ms; 500/500 nối lại; đăng nhập 82 ms | `011-load-x64.json`, `011-flap-x64.json` |
| x64 L7 logic tối đa, L1 1 giờ | +0,58 điểm CPU, RSS +4,49 MiB, quét p99 2,7 ms (T147 xong; trước sửa +5,4 MiB) | `011-logic-load-x64.json` `runtimeL1b` (trước: `runtimeL1`) |
| x64 soak 24 giờ (T076) | 48/48 đoạn, 0 mất sequence, 47 `kill -9` (trung vị 1,04 s), 9/9 nạp xuống, RSS ≤ 34,1 MB, WAL 4,3 MB | `011-soak-x64.json` |
| x64 mất điện (`kill -9`, T077) | 150 vòng (100 ngẫu nhiên, D1, D3, D4, D5 × 10) đạt; READY trung vị 514 ms, tối đa 12,1 s; 0 lệnh ACCEPTED thiếu audit | `011-powercut-x64.json` |
| OTA lab | ngừng ≤ 9,6 s, toàn bộ ≤ 17,6 s; 40/40 kill; quay về 89,3 s | `011-update-x64.json` |
| Fuzz | TS mọi mục tiêu ≥ 1 giờ; C++ ASan + UBSan mọi mục tiêu ≥ 1 giờ (gói, `logic-json`, `update-envelope`, project-json, expression, modbus); 0 sự cố | `011-fuzz-x64.json`, `011-fuzz-svg.json` |
| ctest ASan + UBSan | `ci-local -Sanitize`: 5.946/5.948 (2 bỏ qua có lý do); lượt đầu 56 đỏ: 1 lỗi runtime (429 lịch sử alarm, đã sửa), 53 lỗi mã test, 2 ngân sách thời gian | T059 |
| So cặp 0.9.0 ↔ rc.1 | 1.194 đường dẫn giống, 134 khác đều giải thích được; không hồi quy | `011-regression-pair.md` |
| Editor SVG (máy dev) | mở 20.000 nút 486 ms; hoàn tác 7,4 ms (2.000 phần tử) | `011-svg-perf.json` |
| Phụ thuộc | npm 0 lỗ hổng; cargo 1 Medium + 3 Low (rustls, không chạm tới; nâng từ 2026-10-28) | `011-audit-*.json` |

## 7. Còn phải làm trước khi đóng bản nháp

T198 (Go/No-Go, Tech Lead ký; cần pilot T192–T197 và soak 30 ngày bàn thử T196), sau đó đánh dấu T205. Không cần người: phần còn lại của T079 (không chặn SC-011), T208 sau T198.
