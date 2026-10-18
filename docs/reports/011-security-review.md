# Rà soát bảo mật feature 011 (T062, chuẩn bị T202)

Ngày 2026-10-17. Phạm vi: `git diff 60b254bc..HEAD -- core server drivers apps packages deployment tools` (phần 011; mốc 007 là `8c1eb823`). Năm lượt rà song song, chỉ đọc:

1. OTA phía thiết bị (`mat-updater.sh`, `core/update`, `update_service`, unit systemd);
2. xác thực/HTTP (Host policy, khóa (tên, IP), `LOGIN_BUSY`, tệp yêu cầu mở khóa, vá CivetWeb 5, bảng authz, `writeMinRole`);
3. logic và Tag Engine (WriteCoordinator, nhật ký xung, `logic_glue`, deploy, check-data);
4. lệnh Tauri của Studio;
5. TS SVG/template/tham số, docs-check/build-docs, công cụ phát hành và pilot.

Mỗi phát hiện được sửa trên một nhánh riêng (`gd6-review1`, `gd6-sec-ota`, `gd6-sec-auth`, `gd6-sec-logic`, `gd6-sec-studio`, `gd6-sec-tools`, `gd6-sec-paths`), test viết trước (đỏ trên mã cũ), rồi gộp vào `gd6`.

**Kết luận:** không có phát hiện Critical. Hai High (cùng một lỗi phát lại gói keyset) đã sửa. Hai Medium thiết kế: O1 chấp nhận là rủi ro còn lại, O2 hoãn sau pilot (người dùng giao quyền quyết định 2026-10-17).

## 1. OTA phía thiết bị

| # | Mức | Nội dung | Xử lý | Bằng chứng |
|---|---|---|---|---|
| K1 | High | Gói `keyset` chỉ được so `releaseSeq` với cây cài; keyset không đổi cây nên gói keyset cũ đã ký (thêm lại khóa đã thu hồi) áp lại được bởi administrator hoặc `matscada` bị chiếm, rồi root cài gói runtime ký bằng khóa bị lộ. | **Đã sửa**: `trusted-keys/keyset-seq` giữ `releaseSeq` keyset cuối, đổi tên cùng bộ khóa; `releaseSeq` ≤ giá trị đó → `UPDATE_DOWNGRADE` | `updater_test.sh` mục 8 ("releaseSeq kept", "replay refused") |
| U3 | Medium | Runtime kẹt `Applying`/DEVICE_BUSY tới lần khởi động sau khi mat-updater kết thúc mà không khởi động lại runtime (keyset, RATE_LIMITED, sha lệch, verify từ chối, self-check hỏng, UPDATER_MANUAL_ONLY); audit kết quả bị hoãn | **Đã sửa**: `UpdateService::settle()` (gọi từ `expire()` và tick 1 s) audit kết quả trong `last.json`, nhả busy; keyset nạp lại khóa | ctest `UpdateApi` (3 ca mới) |
| U4 | Medium | `cat ready/<id>.matupdate` không giới hạn cỡ, không kiểm loại tệp; `request.json` là FIFO làm treo 300 s | **Đã sửa**: `user_read` chỉ đọc tệp thường không phải link, tối đa max+1 byte, dưới `timeout`; quá cỡ → `UPDATE_TOO_LARGE`; `PrivateDevices=true` | `updater_test.sh` (FIFO, link, quá cỡ) |
| U6 | Low | `mv` không kiểm kết quả, không `-T`: hỏng giữa chừng có thể mất cả cây | **Đã sửa**: mọi `mv -T` có kiểm, hoàn lại cây cũ, mã `SWITCH_FAILED`/`STAGE_FAILED` | đọc mã (không giả lập được `mv` hỏng dưới root trong container) |
| U7 | Low | `cp` khóa của keyset không kiểm, mất khóa lặng lẽ | **Đã sửa**: kiểm `cp`/`install`/`keyset-seq`, so số khóa → `KEYSET_KEY` | `updater_test.sh` |
| U8 | Low | Unit root của mat-updater thiếu giới hạn capability và các cờ làm cứng | **Đã sửa**: `CapabilityBoundingSet` (8 cap), `ProtectKernelLogs`, `ProtectClock`, `RestrictSUIDSGID`, `RestrictNamespaces`, `RestrictRealtime`, `LockPersonality`. `ReadWritePaths=/opt` giữ nguyên (đổi cây là rename trong `/opt`; bind mount sẽ làm rename EBUSY) | `deploy_rollback_test.sh`; thử trên BL335 2026-10-17 (`docs/reports/device-changes.md`) |
| U9 | Info | `tar -t` dưới `LC_ALL=C` thoát tên không ASCII → gói hợp lệ bị từ chối | **Đã sửa**: `--quoting-style=literal`, vector `utf8.matupdate` | `updater_test.sh` |
| U10 | Info | chmod theo mode trong manifest | Verify chỉ cho 0644/0755; thêm test, mat-updater kiểm lại trước `chmod` | ctest `UpdateManifest.OnlyModes0644And0755PassTheFileList` |
| O1 | Medium | Op `rollback` không cần chữ ký: `matscada` bị chiếm có thể quay về `.prev` (bản cũ đã ký) mỗi 300 s mà không xác thực lại | **Chấp nhận là rủi ro còn lại** (người dùng giao quyền quyết định, 2026-10-17): chỉ quay về `.prev` là bản đã ký và từng được cài, 1 lần/300 s, có audit; rollback là đường an toàn sau bản lỗi. Xem lại ngưỡng `minReleaseSeq` sau pilot | đọc mã |
| O2 | Medium | Một khóa tin cậy bất kỳ ký được keyset gỡ mọi khóa khác (chỉ cấm tự gỡ): khóa lộ chiếm được bộ khóa | **Hoãn sau pilot** (người dùng giao quyền quyết định, 2026-10-17): M-of-N cần đổi định dạng envelope. Giảm thiểu: hai khóa phát hành giữ tách biệt (máy/token offline khác nhau), lộ một khóa thì thu hồi ngay bằng khóa còn lại | đọc mã |
| U11 | Info | Lần cài đầu tin khóa đi kèm gói (TOFU) | Đã ghi trong tài liệu; `deploy.sh` cảnh báo TOFU và có `--expect-key-id` (F1) | — |

## 2. Xác thực và HTTP

| # | Mức | Nội dung | Xử lý |
|---|---|---|---|
| M1 | Medium | Giới hạn kết nối mỗi nguồn tính theo 75 % `httpsThreads` (48/64) nhưng dùng cả cho context HTTP chỉ có 24 luồng: một máy LAN giữ hết luồng HMI. Hub live `maxClients` 10 có thể bị một nguồn chiếm hết | **Đã sửa**: giới hạn theo từng cổng = min(`maxConnPerSource`, 75 % worker của cổng) (HTTP 18/24, HTTPS 48/64, tổng vẫn 48); phiên live tối đa ceil(maxClients/2) = 5 mỗi IP (`maxLiveClientsPerSource` 1–10), vượt → `MAX_CLIENTS_REACHED` `scope:"source"` |
| L1 | Low–Medium | Mỗi yêu cầu sai Host ghi một dòng audit không giới hạn, đẩy bằng chứng cũ ra khỏi `auditMaxMB` | **Đã sửa**: gộp theo (địa chỉ, mã), lần đầu ghi ngay, sau đó một bản ghi tổng mỗi phút `detail.repeated` |
| L2 | Low | Tệp yêu cầu mở khóa không kiểm chủ sở hữu root, không kiểm `S_ISREG` | **Đã sửa**: chỉ dùng tệp thường của root, không quyền nhóm/khác; khác → xóa, audit `account.unlock` denied `UNLOCK_REQUEST_REFUSED` |
| L3 | Low | CLI root ghi vào `dataDir` của user dịch vụ, chỉ thành phần cuối có `O_NOFOLLOW` | **Đã sửa**: mở `dataDir` `O_DIRECTORY|O_NOFOLLOW`, `openat`/`unlinkat` (cả `--logic-writes-reset`) |
| L4 | Low | `LOGIN_BUSY` có thể bị vài chục IP giữ, không để lại dấu vết | **Đã sửa**: audit `auth.busy` tối đa một bản ghi mỗi phút kèm số lần từ chối |
| L5 | Low | Đẩy mục khỏi bảng khóa làm mất lịch sử nhân đôi; bảng theo dõi tấn công phân tán bị xả được | **Đã sửa**: đẩy trước mục chưa từng khóa / không có lần sai trong cửa sổ / đã cũ |
| L6 | Low | `system/info` và `device/identity` công khai lộ chi tiết cảnh báo, đường dẫn khóa, `acceptedHosts` | **Đã sửa**: không phiên → `warningDetails[].detail` là `null`, `device/identity` không có `acceptedHosts`; Studio đọc lại identity sau đăng nhập |
| L7 | Info | `LoginGuard` dùng IP thô, `ConnLimiter` bỏ `::ffff:` | **Đã sửa**: `LoginGuard` nhận IP đã chuẩn hóa |
| L8 | Info | `time_sync` `waitpid` không có hạn | **Đã sửa**: `waitpid(WNOHANG)` tới hạn rồi `SIGKILL` |

Đã rà, không thấy lỗi: phân tích Host (hoa/thường, dấu chấm cuối, cổng, IPv6, ký tự điều khiển), nhiều Host → 400, kiểm Host trước nâng cấp WebSocket, không tin `X-Forwarded-For`, chuẩn hóa tên khi khóa, đếm lỗi trước khi băm, đồng hồ đơn điệu, vá CivetWeb 5 (nhận/trả đúng một lần mỗi socket), bảng route 011, CSRF/Origin/`Sec-Fetch-Site`, `writeMinRole` ở cả HTTP lẫn coordinator, `--test-*` chỉ có dưới `MAT_TEST_HOOKS`.

## 3. Logic và Tag Engine

| # | Mức | Nội dung | Xử lý |
|---|---|---|---|
| LG1 | Medium | Dòng nhật ký xung JSON hợp lệ nhưng sai kiểu → `std::terminate` mỗi lần khởi động (cả `--check-data`, `--self-check`); `seq` âm thành `UINT64_MAX` | **Đã sửa**: try/catch từng dòng, kiểm kiểu, tính là dòng hỏng |
| LG2 | Medium | Administrator dừng ghi nhưng lệnh đã xếp hàng vẫn tới PLC | **Đã sửa**: `handOver` kiểm lại dưới `mu_`; `stopWrites` bỏ hàng đợi với audit `logic.write.suppressed` |
| LG3 | Medium | fsync `logic-state.json` dưới `mu_` chặn vòng quét Tag Engine | **Đã sửa**: chụp dưới `mu_`, ghi dưới `stateMu_` riêng |
| LG4 | Medium | `logic-state.json` hỏng làm mất lệnh dừng của administrator | **Đã sửa**: khởi động với ghi dừng, `LOGIC_WRITES_OFF` `reason: STATE_UNREADABLE`, chỉ `--logic-writes-reset` bỏ được |
| LG5 | Medium | Lệnh bật xung hỏng sau khi thiết bị đã nhận (`READBACK_*`) đóng mục nhật ký, bit có thể kẹt ON | **Đã sửa**: chỉ `DEVICE_EXCEPTION`, `NOT_SENT_*` đóng mục; còn lại nhả khi tới hạn, thử lại mỗi 5 s |
| LG6 | Medium | `logic.json` lớn làm bộ kiểm chậm hoặc tràn stack (Tarjan đệ quy, Kahn O(n²)) | **Đã sửa**: dừng sau `E_LOGIC_LIMIT` (C++ và TS), Kahn min-heap, Tarjan lặp |
| LG7 | Low | `Bucket::taken_` lớn dần trên thiết bị không ai xem | **Đã sửa**: tỉa trong `take()` |
| LG8 | Low | Ép float → int64 không xác định từ API (`1e300`) | **Đã sửa**: 400 khi > 2^53, kẹp trong `counters`/`runhours` |
| LG9 | Low | `minIntervalMs`, `maxPerHour` không có chặn trên | **Đã sửa**: ≤ 86.400.000 ms, ≤ 3.600/giờ (C++ và TS, 4 vector mới) |
| LG10 | Low | `--logic-writes-reset` không kiểm chủ tệp là root; audit ghi sau khi áp | **Đã sửa**: `S_ISREG`, chủ root, mode 0600; audit trước |
| LG11 | Low | Phục hồi xung khớp Tag chỉ theo id | **Đã sửa**: dòng `arm` lưu `ch`/`dev`/`addr`; lệch → `PULSE_STUCK`, không ghi |
| LG12 | Low | check-data chọn `immutable=1` có thể báo "damaged" sai khi runtime đang ghi | **Đã sửa**: DB rollback journal mở `mode=ro`; khóa → `warning` |

Còn lại (ghi trong contract): lệnh đã vào WriteCoordinator lúc dừng vẫn chạy hết; mục `PULSE_STUCK` do lệch địa chỉ chỉ hết khi xóa nhật ký bằng tay; `logicGraph` TS vẫn đệ quy nhưng độ sâu bị chặn ~550 khối nhờ giới hạn số mục.

Đã rà, không thấy lỗi: audit `started` bền trước khi gửi, `arm` fdatasync trước khi bật bit, giới hạn tốc độ trước khi xếp hàng, deploy persist ngoài mutex theo vé, từ chối tệp thừa không theo symlink, check-data chỉ đọc, ghi nhật ký xung O_APPEND/0600/fdatasync, nén nhật ký tmp+rename+fsync thư mục.

## 4. Studio (Tauri)

| # | Mức | Nội dung | Xử lý |
|---|---|---|---|
| S1 | Low | Tệp tạm `write_atomic` theo symlink cài sẵn | **Đã sửa**: `create_new` + hậu tố ngẫu nhiên, thử lại 16 lần |
| S2 | Low | `check_rel` cho qua tên kết thúc `.`/dấu cách và tên thiết bị Windows | **Đã sửa** ở Studio, TS (`isSafeRelPath`), C++ (`core/common/path_segment.hpp`: bộ kiểm, kho project, luật gói) và luật gói Rust; vector gói `path-device-name-space`, `path-trailing-space`, vector project `v10-logic-path-*` |
| S3 | Low | `fs::read` không chặn cỡ sau `metadata()` | **Đã sửa**: `read_limited` |
| S4 | Low | Chống công thức CSV bỏ sót `\t`, `\r`, `\|` | **Đã sửa** |
| S5 | Low | `powershell.exe` theo tên trần | **Đã sửa**: đường dẫn tuyệt đối từ `%SystemRoot%` (chưa chạy trên Windows) |
| S6 | Info | Mật khẩu xác thực lại chỉ xóa một phần khỏi bộ nhớ | Ghi nhận |
| S7 | Info | `project_write` ghi được vào `.mat-backup/` | **Đã sửa**: `BadPath` |

Đã rà, không thấy lỗi: `open_help`, `open_device_web`, ghim TLS, allowlist `device_post`, CSP, capability.

## 5. TS SVG/template và công cụ

| # | Mức | Nội dung | Xử lý |
|---|---|---|---|
| F1 | Medium | `deploy.sh` kiểm chữ ký bằng `mat-update-verify` lấy từ chính gói đang kiểm | **Đã sửa**: dùng bản đã cài; lần đầu cảnh báo TOFU; `--expect-key-id` |
| F2 | Medium | Collector pilot chỉ kiểm ghim chứng chỉ một lần, sau đó gửi mật khẩu qua TLS không kiểm | **Đã sửa**: kiểm ghim ở mọi kết nối; HTTPS không `-Fingerprint` bị từ chối trừ khi `-Insecure` (đường PS 5.1 chưa chạy trên Windows) |
| F3 | Medium | Cổng phát hành không chặn khóa thử khi có `-Verifier`; `make-update.mjs` ký bằng khóa thử không cản | **Đã sửa**: luôn tính keyId, pha gate `key`; `make-update.mjs` đòi `--test` cho khóa thử |
| F4 | Low–Medium | Khóa phát hành mã hóa không dùng được; `release.ps1` truyền sai tham số `--runtime` | **Đã sửa**: `MAT_SIGN_PASSPHRASE` hoặc hỏi TTY; `--from` |
| F5 | Low | Chèn lệnh ở `sign.ps1` chế độ command; che bí mật thiếu | **Đã sửa**: đường dẫn qua `$1`/biến môi trường; che từ 4 ký tự; log chỉ ghi tên chương trình |
| F6 | Low | `keygen.ps1` tạo khóa dưới umask mặc định | **Đã sửa**: `umask 077`; `icacls` trên Windows (chưa chạy trên Windows) |
| F7 | Low | `build-docs.mjs` nhúng ảnh ngoài `docs/`; `--out` xóa đệ quy thư mục bất kỳ | **Đã sửa**: realpath trong `docs/`; cần tệp đánh dấu `.mat-build-docs` |
| F8 | Low | Khóa `__proto__` khi thay tham số | **Đã sửa**: `Object.defineProperty`, `Object.create(null)` |

Đã rà, không thấy lỗi: SVG paste/import (cấm DOCTYPE/ENTITY, giới hạn cỡ/nút/độ sâu/`use`, allowlist dùng chung với runtime, 9 SVG độc đều bị lọc), runtime-web lọc lại trước `importNode`, canvas Studio không dùng `innerHTML`, tham số faceplate (kiểu, độ dài, một lượt thay, không đệ quy), escape của `build-docs.mjs`, xử lý bí mật của pilot và phát hành.

## 6. Việc còn lại

- O1, O2: đã quyết định 2026-10-17 (O1 chấp nhận, O2 hoãn sau pilot).
- `maxLiveClientsPerSource` mặc định 5 chặn nhiều máy sau cùng một NAT và lượt đo load-tester 10 client từ một PC: nơi cần thì đặt `10` trong `runtime.json` (compose web-it/device-it/alarm-it đặt 10).
- Chạy `ci-local` đầy đủ sau khi gộp mọi nhánh; kiểm trên Windows các đường F2, F5, F6, S5.
- T202 (rà soát lần hai) dùng báo cáo này làm đầu vào.

## 7. Rà soát lần hai (T202, 2026-10-17, HEAD `c86ebe85`)

Năm lượt chỉ đọc (OTA, xác thực/HTTP, logic, Studio/công cụ/luật đường dẫn, SVG/template): kiểm lại từng mục "Đã sửa" ở trên và rà lại toàn bộ 011. Không có Critical hay High. Các mục T062 đều được xác nhận đúng, trừ U3 (sửa một phần → N-OTA2, N-OTA3), S7 (còn đường vòng → N-S1) và F1 (lần cài đầu → N-OTA1).

| # | Mức | Nội dung | Xử lý |
|---|---|---|---|
| N-OTA1 | Medium | Lần cài đầu, `--expect-key-id` tin stdout của bộ kiểm trong chính gói; có bộ kiểm đã cài mà `trusted-keys` trống thì dùng khóa của gói không cảnh báo | **Đã sửa** (`gd6-sec2-ota`) |
| N-OTA2 | Medium | Cập nhật có khởi động lại runtime: runtime mới ở Idle nên kết quả không được audit kịp (hoặc mất), và trong S6–S8 deploy project được nhận làm hỏng kiểm sức khỏe | **Đã sửa** (`gd6-sec2-ota`) |
| N-OTA3 | Medium | Yêu cầu ghi lúc mat-updater còn chạy bị mất (`PathChanged` + `flock -n`), thiết bị DEVICE_BUSY tới khi khởi động lại máy | **Đã sửa** (`gd6-sec2-ota`) |
| N3, N8, N9 | Low | `settle()` audit đôi khi chạy song song; nhả thiết bị dù audit hỏng; I/O trên tick chính | **Đã sửa** (`gd6-sec2-ota`) |
| N5, N6, N7a, N7b | Low | keyset không `sync` trước `mv -T`; `keyset-seq` hỏng thì bỏ qua kiểm (fail-open); op rollback có thể xóa bản tốt duy nhất; recover rollback dở có thể mất `.prev` | **Đã sửa** (`gd6-sec2-ota`) |
| N-L1 | Low | `stopWrites` không chờ lệnh đang bàn giao: API trả "stopped" mà một lệnh vẫn tới PLC | **Đã sửa** (`gd6-sec2-logic`) |
| N-L2 | Low (cân nhắc nâng) | Dấu vân tay xung chỉ so id kênh/thiết bị/chuỗi địa chỉ; đổi unitId, addressBase hay host thì lệnh nhả ghi sang chỗ khác | **Đã sửa** (`gd6-sec2-logic`) |
| N-L3, N-L4, N-L5 | Low | `PULSE_STUCK` do lệch địa chỉ không đóng được; audit "enabled" lặp khi ghi tệp trạng thái hỏng; `reset` audit dưới `mu_` | **Đã sửa** (`gd6-sec2-logic`) |
| N-S1 | Low | `remove_file` xóa được tệp trong `.mat-backup/`; tên 8.3/symlink vượt kiểm | **Đã sửa** (`gd6-sec2-misc`) |
| N-S2 | Low | `sign.ps1` `-Command` với `"{file}"`: giá trị mở rộng nằm ngoài nháy với cmd | **Đã sửa** (`gd6-sec2-misc`) |
| N-SVG1, N-SVG2 | Low | Trần điểm ảnh GIF chỉ đọc logical screen; không có trần tổng điểm ảnh mỗi tài liệu (kiosk BL335 có thể OOM) | **Đã sửa** (`gd6-sec2-misc`) |
| N-A1 | Low | Số lần `LOGIN_BUSY` chỉ được ghi khi có lần busy sau mốc 60 s | **Đã sửa** (`gd6-sec2-misc`) |
| T200 | Low | (So cặp T200, [011-regression-pair.md](011-regression-pair.md) §2.3) Dòng `access.denied` 421/400 của Host policy dùng chung ngân sách 10 dòng/phút của audit (R11 của 005) với `auth.login` thất bại: một trang lạ dội sai `Host` từ nhiều nguồn làm dòng đăng nhập sai bị gộp vào `audit.suppressed`, che bằng chứng dò mật khẩu | **Đã sửa** (`gd6-audit-budget`): `AuditBudget::HostPolicy`, ngân sách riêng 10 dòng/phút và dòng `audit.suppressed` riêng (`detail.budget: "host"`); test `AuditLog.HostPolicyRefusalsDoNotSpendTheBudgetOfFailedSignIns`, `HostPolicy.AFloodOfWrongHostsLeavesEveryFailedSignInItsOwnRow`; hợp đồng device-api-011 §1 |

Info (ghi nhận, sửa khi rẻ): dòng tổng Host có thể bị bộ giới hạn audit bỏ; không kiểm `st_nlink`; `hrefValue` lấy href đầu (lỗi cũ 008); thiếu vài ký tự vô hình; lớp tên `__proto__` trong `svg-state.ts`; lưu SVG có thể mất `xmlns:xlink`; cửa sổ Help không có CSP; `collect.ps1` PS 5.1 để lại callback toàn cục; `release.ps1` không tính keyId của khóa mã hóa; `deploy.sh` giải nén trước khi root kiểm; `seq` = UINT64_MAX tràn. Tên project cũ như `aux.svg` sẽ báo `E_PATH` sau nâng cấp: ghi vào ghi chú phát hành.

**Cổng T202** ("không Critical/High mở; Medium mở chỉ là mục chờ người quyết định"): mọi phát hiện N-* đã sửa và gộp vào `gd6` (test viết trước; unit mat-updater mới thử trên BL335, `docs/reports/device-changes.md`). Medium còn mở chỉ là O1, O2 (chờ người dùng quyết định). `ci-local` đầy đủ xanh trên `gd6` sau khi gộp (2026-10-17, chạy tiếp theo đoạn bằng `-StartAt` sau ba sửa nhỏ: import `own.ts`, `driver-it` với `--max-live-clients-per-source 10`, danh mục mã lỗi): **cổng T202 đạt**: không Critical/High mở; O1 chấp nhận, O2 hoãn sau pilot (quyết định 2026-10-17 theo ủy quyền của người dùng). Thêm: `mat-runtime --pulse-ack <rid|all>` (N-L3), mã `UPDATE_READ_TIMEOUT`, `PULSE_ACK_REQUEST_FAILED`, action `pulse.ack`.
