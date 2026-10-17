# Rà soát bảo mật feature 011 (T062, chuẩn bị T202)

Ngày 2026-10-17. Phạm vi: `git diff 60b254bc..HEAD -- core server drivers apps packages deployment tools` (phần 011; mốc 007 là `8c1eb823`). Năm lượt rà song song, chỉ đọc:

1. OTA phía thiết bị (`mat-updater.sh`, `core/update`, `update_service`, unit systemd);
2. xác thực/HTTP (Host policy, khóa (tên, IP), `LOGIN_BUSY`, tệp yêu cầu mở khóa, vá CivetWeb 5, bảng authz, `writeMinRole`);
3. logic và Tag Engine (WriteCoordinator, nhật ký xung, `logic_glue`, deploy, check-data);
4. lệnh Tauri của Studio;
5. TS SVG/template/tham số, docs-check/build-docs, công cụ phát hành và pilot.

Mỗi phát hiện được sửa trên một nhánh riêng (`gd6-review1`, `gd6-sec-ota`, `gd6-sec-auth`, `gd6-sec-logic`, `gd6-sec-studio`, `gd6-sec-tools`, `gd6-sec-paths`), test viết trước (đỏ trên mã cũ), rồi gộp vào `gd6`.

**Kết luận:** không có phát hiện Critical. Hai High (cùng một lỗi phát lại gói keyset) đã sửa. Hai Medium cần người quyết định (O1, O2) được giữ nguyên và ghi là rủi ro chấp nhận tạm.

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
| O1 | Medium | Op `rollback` không cần chữ ký: `matscada` bị chiếm có thể quay về `.prev` (bản cũ đã ký) mỗi 300 s mà không xác thực lại | **Chờ người quyết định**: chấp nhận, hoặc thêm ngưỡng `minReleaseSeq` | đọc mã |
| O2 | Medium | Một khóa tin cậy bất kỳ ký được keyset gỡ mọi khóa khác (chỉ cấm tự gỡ): khóa lộ chiếm được bộ khóa | **Chờ người quyết định**: đòi 2 chữ ký khác nhau cho keyset có `remove` | đọc mã |
| U11 | Info | Lần cài đầu tin khóa đi kèm gói (TOFU) | Đã ghi trong tài liệu; `deploy.sh` cảnh báo TOFU và có `--expect-key-id` (F1) | — |

## 2. Xác thực và HTTP

| # | Mức | Nội dung | Xử lý |
|---|---|---|---|
| M1 | Medium | Giới hạn kết nối mỗi nguồn tính theo 75 % `httpsThreads` (48/64) nhưng dùng cả cho context HTTP chỉ có 24 luồng: một máy LAN giữ hết luồng HMI. Hub live `maxClients` 10 có thể bị một nguồn chiếm hết | Nhánh `gd6-sec-auth` |
| L1 | Low–Medium | Mỗi yêu cầu sai Host ghi một dòng audit không giới hạn, đẩy bằng chứng cũ ra khỏi `auditMaxMB` | Nhánh `gd6-sec-auth` |
| L2 | Low | Tệp yêu cầu mở khóa không kiểm chủ sở hữu root, không kiểm `S_ISREG` | Nhánh `gd6-sec-auth` (phía logic: xem LG10) |
| L3 | Low | CLI root ghi vào `dataDir` của user dịch vụ, chỉ thành phần cuối có `O_NOFOLLOW` | Nhánh `gd6-sec-auth` |
| L4 | Low | `LOGIN_BUSY` có thể bị vài chục IP giữ, không để lại dấu vết | Nhánh `gd6-sec-auth` |
| L5 | Low | Đẩy mục khỏi bảng khóa làm mất lịch sử nhân đôi; bảng theo dõi tấn công phân tán bị xả được | Nhánh `gd6-sec-auth` |
| L6 | Low | `system/info` và `device/identity` công khai lộ chi tiết cảnh báo, đường dẫn khóa, `acceptedHosts` | Nhánh `gd6-sec-auth` |
| L7 | Info | `LoginGuard` dùng IP thô, `ConnLimiter` bỏ `::ffff:` | Nhánh `gd6-sec-auth` |
| L8 | Info | `time_sync` `waitpid` không có hạn | Nhánh `gd6-sec-auth` |

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

- O1, O2: người dùng quyết định.
- Chạy `ci-local` đầy đủ sau khi gộp mọi nhánh; kiểm trên Windows các đường F2, F5, F6, S5.
- T202 (rà soát lần hai) dùng báo cáo này làm đầu vào.
