# Rà soát bảo mật feature 011 (T062, chuẩn bị T202)

Ngày 2026-10-17. Phạm vi: `git diff 634d528 (nay 8c1eb823)..HEAD -- core server drivers apps packages deployment tools`, tập trung phần 011 (từ `60b254bc`). **Bản dở dang:** năm lượt rà song song (OTA phía thiết bị, xác thực/HTTP, logic và tag engine, lệnh Tauri của Studio, TS SVG/template/công cụ). Ở bản này mới có kết quả của lượt OTA (phiên chính tự rà `mat-updater.sh`, `core/update/verify.cpp`) và lượt Studio Tauri. Bốn lượt còn lại cần chạy lại.

## 1. Kết quả

| # | Nguồn | Mức | Nội dung | Xử lý | Bằng chứng |
|---|---|---|---|---|---|
| K1 | OTA, `deployment/device/mat-updater.sh` (nhánh keyset), `core/update/verify.cpp:120` | High | Gói `keyset` chỉ được so `releaseSeq` với cây cài, mà keyset không đổi cây. Vì vậy một gói keyset đã ký cũ (thêm lại khóa đã thu hồi) áp lại được, khi kẻ tấn công có tài khoản administrator hoặc chiếm được `matscada` (ghi `request.json` và `ready/`). Sau đó gói runtime ký bằng khóa bị lộ được root cài. | **Đã sửa**: giữ `releaseSeq` của keyset cuối trong `trusted-keys/keyset-seq` (đổi tên cùng bộ khóa), từ chối `UPDATE_DOWNGRADE` khi `releaseSeq` ≤ giá trị đó | `updater_test.sh` mục 8: hai ca mới "releaseSeq kept", "replay refused". **Chưa chạy** (cần Docker và `mat-update-verify` Linux); `sh -n` xanh |
| S1 | Studio, `apps/studio/src-tauri/src/project_fs.rs:310` | Low | Tệp tạm của `write_atomic` (`.<tên>.tmp-<pid>`) theo symlink cài sẵn trong project lạ; 011 mở rộng đường này cho `.svg` | Chờ: `create_new(true)` cộng hậu tố ngẫu nhiên | đọc mã |
| S2 | Studio, `project_fs.rs:68` | Low | Trên Windows, `check_rel` cho qua đoạn có dấu chấm hoặc dấu cách ở cuối, và tên dành riêng (`aux`, `nul.svg`). Không thoát được thư mục gốc. | Chờ | đọc mã |
| S3 | Studio, `project_fs.rs:287`, `:147` | Low | `fs::read` không chặn cỡ sau khi đã kiểm `metadata()` (đua thời điểm) | Chờ: `take(limit+1)` | đọc mã |
| S4 | Studio, `csv.rs:144`, `:89` | Low | Chống công thức CSV bỏ sót ô bắt đầu bằng `\t`, `\r`, `\|`, và trường hợp dấu phân cách theo locale | Chờ | đọc mã |
| S5 | Studio, `signature.rs:113` | Low | Gọi `powershell.exe` theo tên trần, có thể bị thay bằng tệp cùng tên cài cạnh exe | Chờ: đường dẫn tuyệt đối System32 | đọc mã |
| S6 | Studio, `device/update.rs:427` | Info | Mật khẩu xác thực lại chỉ được xóa một phần khỏi bộ nhớ; không bị ghi log | Ghi nhận | đọc mã |
| S7 | Studio, `project_fs.rs` | Info | `project_write` ghi được vào `.mat-backup/` | Chờ: từ chối khi ghi | đọc mã |
| O1 | OTA, `mat-updater.sh` (op `rollback`) | Medium | `rollback` không có chữ ký: tài khoản `matscada` bị chiếm có thể quay về `.prev` (bản cũ đã ký, có thể còn lỗ đã biết) mà không cần xác thực lại. Đã giới hạn một lần mỗi 300 s. | Chờ người quyết định: chấp nhận, hoặc thêm tham số `minReleaseSeq` | đọc mã |

Đã đọc và không thấy lỗi trong `mat-updater.sh`:
- đọc `request.json` và gói dưới quyền `matscada`, chép sang thư mục của root, so SHA-256, rồi kiểm lại đầy đủ (chống TOCTOU);
- chỉ chạy `tar` trên bản chép, sau khi so danh sách với `files[]`; chặn link và tệp đặc biệt;
- ghi dưới `<dataDir>` bằng tệp tạm rồi đổi tên, với quyền `matscada`;
- `user` được lọc ký tự; khóa `flock`; các bước phục hồi.

Phía Studio: `open_help`, `open_device_web`, ghim TLS, `device_post` theo allowlist, CSP, capability.

## 2. Việc còn lại

- Chạy lại bốn lượt rà chưa có kết quả: xác thực/HTTP (Host policy, khóa (tên, IP), `LOGIN_BUSY`, tệp yêu cầu mở khóa, vá CivetWeb 5, bảng authz); logic/WriteCoordinator/pulse journal/deploy/check-data; SVG paste, template, docs-check/build-docs; công cụ phát hành (bí mật trong log).
- Chạy `updater_test.sh` trong container sau khi CI xong.
- `packages/project-schema` `npm test`: 1 ca đỏ do thiếu vector sinh `tests/package-vectors/out/extra-large-file.matscada` (môi trường, có từ trước, không liên quan sửa đổi này).
