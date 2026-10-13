# Contract: gói cập nhật `.matupdate` và quy trình `mat-updater`

**Feature**: [spec.md](../spec.md) FR-057 đến FR-072, SC-020 đến SC-023 · **ADR**: [035](../../../docs/adr/035-release-trust-ota.md) · API: [device-api-011.md](device-api-011.md) §3

## 1. Phong bì

`.matupdate` là một tệp tar (ustar, không nén) có **đúng ba** thành viên theo thứ tự:

| # | Tên | Kích thước tối đa | Nội dung |
|---|---|---|---|
| 1 | `update.json` | 256 KiB | manifest (UTF-8, không BOM) |
| 2 | `update.sig` | 128 byte | chữ ký ECDSA P-256 dạng DER trên SHA-256 của **byte nguyên văn** của `update.json` |
| 3 | `payload.tar.gz` | `maxPackageMiB` | cây tệp cần cài (tar nén gzip) |

Bộ đọc (`mat-update-verify`, C++ tự viết, Mbed TLS) đọc **chỉ** hai tiêu đề đầu theo độ dài cố định: kiểm tổng kiểm 512 byte của tiêu đề tar, `typeflag` là tệp thường (`0` hoặc NUL), tên đúng, kích thước trong trần, không có phần mở rộng (`x`, `g`, `L`, `K`), không có thành viên thứ tư. Phần 3 được băm khi đọc dòng (không giải nén trước khi băm). Đầu vào lạ ở mọi chỗ là `UPDATE_PACKAGE_INVALID` kèm `detail.code`: `ENVELOPE_HEADER`, `ENVELOPE_ORDER`, `ENVELOPE_SIZE`, `ENVELOPE_EXTRA_MEMBER`, `ENVELOPE_TRUNCATED`.

## 2. Manifest `update.json`

```json
{
  "format": "1.0.0",
  "kind": "runtime",
  "product": "mat-runtime",
  "version": "1.0.1",
  "releaseSeq": 12,
  "arch": "armhf",
  "minFromVersion": "0.6.0",
  "projectFormatMax": "1.0.0",
  "updaterRequired": 1,
  "createdAt": "2026-11-20T09:00:00+07:00",
  "payloadSha256": "<hex 64>",
  "payloadSize": 2843012,
  "files": [
    { "path": "bin/mat-runtime", "sha256": "<hex>", "size": 1834512, "mode": "0755" },
    { "path": "web/index.html", "sha256": "<hex>", "size": 912, "mode": "0644" },
    { "path": "schemas/project.schema.json", "sha256": "<hex>", "size": 20301, "mode": "0644" }
  ],
  "notes": "Sửa lỗi ...",
  "keyset": null
}
```

- `kind`: `runtime` (cập nhật cây `/opt/mat-runtime`) hoặc `keyset` (xoay khóa, không có `files`, `payload.tar.gz` rỗng hợp lệ).
- `format`: SemVer của định dạng gói; runtime 1.0 nhận `1.x.y`; `2.x` bị từ chối `UPDATE_PACKAGE_INVALID` `FORMAT_UNSUPPORTED`.
- `releaseSeq`: số nguyên dương **đơn điệu** theo thứ tự phát hành (không phải SemVer); gói bị từ chối nếu `releaseSeq` ≤ `releaseSeq` của bản đang chạy (chống hạ cấp, D36). `releaseSeq` của bản đang chạy nằm trong `build-info.json` của cây cài.
- `minFromVersion`: bản thấp nhất được phép nâng thẳng lên (SemVer); thấp hơn thì phải qua bản trung gian.
- `projectFormatMax`: định dạng project cao nhất mà bản mới chạy được; nhỏ hơn định dạng của project đang chạy thì `UPDATE_PROJECT_INCOMPATIBLE`.
- `updaterRequired`: số hiệu giao thức tối thiểu của `mat-updater` đã cài (hiện 1); cao hơn thì `UPDATER_MANUAL_ONLY` kèm hướng dẫn chạy `deploy.sh`.
- `files[]`: **đầy đủ** mọi tệp của payload (ngoại trừ thư mục); đường dẫn tương đối, UTF-8, không bắt đầu bằng `/`, không có đoạn `.` hoặc `..`, không `\`, không ký tự điều khiển, ≤ 200 byte, không trùng (so không phân biệt hoa thường), phải thuộc tiền tố cho phép: `bin/`, `web/`, `schemas/`, `README-deploy.txt`, `build-info.json`; `mode` chỉ `0644` hoặc `0755`.
- Không có `updater/` trong `files[]` (FR-072): có thì `UPDATER_MANUAL_ONLY`.
- `keyset` (chỉ khi `kind = keyset`): `{"add": ["<PEM>"…], "remove": ["sha256:<keyId>"…]}`; tối đa 4 khóa thêm, `remove` không được xóa khóa vừa ký gói này.

`keyId` là `sha256:` + băm SHA-256 của DER `SubjectPublicKeyInfo` của khóa công khai.

## 3. Chữ ký và khóa tin cậy

- Thuật toán: ECDSA, đường cong P-256 (secp256r1), băm SHA-256; chữ ký DER. Không chấp nhận thuật toán khác (không có trường chọn thuật toán trong gói).
- Khóa công khai: tệp PEM `*.pem` (SPKI) trong `trustedKeysDir` (mặc định `/etc/mat-runtime/trusted-keys/`), thuộc root, mode 0644; thư mục 0755. Runtime và `mat-updater` đọc; chỉ root ghi (CLI `--trust-key` hoặc gói `keyset`).
- Kiểm: thử lần lượt từng khóa tin cậy; có một khóa kiểm đúng thì chấp nhận và ghi `signer.keyId`. Không khóa nào đúng: `UPDATE_SIGNATURE_INVALID` nếu có ít nhất một khóa được thử; không có khóa nào trong thư mục: `UPDATE_KEYS_MISSING` (cảnh báo `system/info`, OTA coi như tắt).
- Khóa ký phát hành: [release-signing.md](release-signing.md) §5.

## 4. Quy trình áp dụng (8 bước)

Trạng thái từng thao tác lưu ở `<dataDir>/update/ops/<updateId>.json` (ghi tạm rồi đổi tên, fsync tệp và thư mục) **trước** mỗi bước: `{"step": n, "name": "...", "at": "...", "from": "...", "to": "...", "result": null}`.

| Bước | Tên | Ai | Việc |
|---|---|---|---|
| S1 | `receiving` | runtime (matscada) | audit `system.update.accepted`; nhận byte vào `incoming/<id>.part` |
| S2 | `verified` | runtime | kiểm theo FR-061 bằng cùng thư viện với `mat-update-verify`; đổi tên thành `ready/<id>.matupdate` |
| S3 | `requested` | runtime | sau `apply` (mật khẩu đúng): audit `system.update.applying`, ghi `update/request.json` (`updateId`, `sha256` của gói, người yêu cầu); `mat-updater.path` kích hoạt |
| S4 | `root-verified` | `mat-updater` (root) | sao chép gói sang `/var/lib/mat-updater/<id>/` (thuộc root, 0700), chạy lại **toàn bộ** kiểm bằng `mat-update-verify` trên bản sao (không tin kiểm của runtime, tránh TOCTOU); kiểm băm gói khớp `request.json` |
| S5 | `staged` | `mat-updater` | giải nén `payload.tar.gz` vào `/opt/mat-runtime.new` bằng `tar --no-same-owner --no-same-permissions` **sau khi** liệt kê và đối chiếu với `files[]` (từ chối liên kết, thiết bị, đường dẫn lạ); kiểm `sha256sum` từng tệp; chmod theo `mode`; chạy `bin/mat-runtime --self-check --config /etc/mat-runtime/runtime.json` dưới user `matscada` (kiểm cấu hình, mở chỉ đọc cơ sở dữ liệu, validator chạy trên project đang chạy) |
| S6 | `switched` | `mat-updater` | dừng dịch vụ; `/opt/mat-runtime` → `/opt/mat-runtime.prev` (xóa `.prev` cũ trước), `/opt/mat-runtime.new` → `/opt/mat-runtime`; fsync thư mục cha; `systemctl start mat-runtime` |
| S7 | `health-check` | `mat-updater` | tối đa 60 s: tiến trình sống ổn định ≥ 5 s, `GET http://127.0.0.1:<port>/api/v1/system/info` và HTTPS trả lời, `version` và `releaseSeq` đúng bản mới, `project.digest` bằng digest trước khi cập nhật |
| S8 | `committed` | `mat-updater` | ghi `<dataDir>/update/last.json` (`result: "committed"`), dọn `ready/` và `/var/lib/mat-updater/<id>/`; giữ `.prev` |

**Gói `kind: keyset`:** S1 đến S4 như trên; S5 ghi khóa mới vào `/etc/mat-runtime/trusted-keys/` (ghi tạm rồi đổi tên, 0644) và xóa khóa theo `remove`; S6 và S7 **bỏ qua** (không đổi cây cài, không khởi động lại; kiểm `mat-update-verify --keys` đọc được thư mục khóa mới); S8 commit và audit `system.keys.updated`.

Quay về (`rolled-back`) ở S7 hoặc khi S6 `start` thất bại: dừng dịch vụ, đổi tên `/opt/mat-runtime` → `/opt/mat-runtime.failed`, `.prev` → `/opt/mat-runtime`, khởi động, kiểm sức khỏe lại, ghi `last.json` (`result: "rolled-back"`, `reason`). Hai bước đổi tên là nguyên tử riêng lẻ; `ops/<id>.json` cho phép tiếp tục hoặc đảo ngược khi khởi động lại giữa chừng (`mat-updater` chạy lại lúc khởi động qua `mat-updater-recover.service`, oneshot, trước `mat-runtime.service`, đọc `ops/`):

| Bị gián đoạn ở | Khi lên lại |
|---|---|
| S1 đến S3 | xóa `incoming/`, `ready/` quá hạn; bản cũ chạy; không cập nhật |
| S4, S5 | xóa `/opt/mat-runtime.new` và bản sao của root; bản cũ chạy |
| S6 (trước rename 2) | `/opt/mat-runtime` còn nguyên: bản cũ chạy |
| S6 (giữa hai rename: không có `/opt/mat-runtime`) | hoàn tất đảo: `.prev` → `/opt/mat-runtime`; bản cũ chạy |
| S6 (sau rename 2) hoặc S7 | khởi động bản mới; kiểm sức khỏe; đạt thì commit, không thì quay về |
| S8 | commit lặp lại là idempotent |

Kết quả cuối được runtime mới ghi audit (`system.update.committed` hoặc `rolled-back`) ở lần khởi động đầu rồi đánh dấu `last.json.audited = true`.

## 5. Dịch vụ systemd và quyền

| Unit | Chạy | Ghi chú |
|---|---|---|
| `mat-runtime.service` | `matscada`, sandbox như hiện có | **không đổi** quyền; thêm `ReadWritePaths` không cần: runtime chỉ ghi `<dataDir>/update/` đã có `StateDirectory` |
| `mat-updater.path` | systemd | `PathChanged=/var/lib/mat-runtime/update/request.json` |
| `mat-updater.service` | root, `Type=oneshot`, `ProtectSystem=strict`, `ReadWritePaths=/opt /var/lib/mat-updater /var/lib/mat-runtime/update`, `PrivateTmp`, `NoNewPrivileges`, `RestrictAddressFamilies=AF_UNIX`, `SystemCallFilter=@system-service`, `TimeoutStartSec=300` | cài bởi `deploy.sh`, **không** nằm trong gói OTA |
| `mat-updater-recover.service` | root, oneshot, `Before=mat-runtime.service` | xử lý gián đoạn |

- `mat-updater` đọc `request.json` do `matscada` ghi (không tin): chỉ lấy `updateId` (kiểm `^upd_[0-9a-f]{16}$`) và băm; mọi thứ khác lấy từ gói đã kiểm lại.
- Thư mục `<dataDir>/update/{incoming,ready,ops}` do `matscada` sở hữu; `/var/lib/mat-updater/` do root.
- `/opt/mat-runtime.failed` giữ tối đa một bản để điều tra, bị xóa ở cập nhật kế.

## 6. Bộ gói xấu bắt buộc có test (≥ 25)

| # | Ca | Mã mong đợi |
|---|---|---|
| 1 | chữ ký sai (đổi một byte của `update.sig`) | `UPDATE_SIGNATURE_INVALID` |
| 2 | chữ ký đúng nhưng khóa không có trong `trusted-keys` | `UPDATE_SIGNATURE_INVALID` hoặc `UPDATE_KEY_UNKNOWN` |
| 3 | sửa `update.json` sau khi ký | `UPDATE_SIGNATURE_INVALID` |
| 4 | sửa một byte của payload | `UPDATE_PACKAGE_INVALID` `PAYLOAD_DIGEST` |
| 5 | `payloadSha256` đúng nhưng một `files[].sha256` sai | `FILE_DIGEST` |
| 6 | thiếu một tệp có trong `files[]` | `FILE_MISSING` |
| 7 | payload có tệp không có trong `files[]` | `FILE_EXTRA` |
| 8 | đường dẫn có `..` | `PATH_TRAVERSAL` |
| 9 | đường dẫn tuyệt đối | `PATH_ABSOLUTE` |
| 10 | liên kết tượng trưng hoặc liên kết cứng trong payload | `LINK_FORBIDDEN` |
| 11 | tệp thiết bị, FIFO | `SPECIAL_FORBIDDEN` |
| 12 | tar bomb: tổng giải nén > 128 MiB | `UNPACKED_TOO_LARGE` |
| 13 | tỉ lệ nén > 20 | `RATIO_TOO_HIGH` |
| 14 | gói lớn hơn `maxPackageMiB` | `UPDATE_TOO_LARGE` |
| 15 | `arch` khác thiết bị | `UPDATE_ARCH_MISMATCH` |
| 16 | `releaseSeq` bằng hoặc thấp hơn | `UPDATE_DOWNGRADE` |
| 17 | `minFromVersion` cao hơn bản đang chạy | `UPDATE_PACKAGE_INVALID` `FROM_VERSION` |
| 18 | `projectFormatMax` thấp hơn project đang chạy | `UPDATE_PROJECT_INCOMPATIBLE` |
| 19 | cắt ngang gói (mất phần cuối) | `ENVELOPE_TRUNCATED` |
| 20 | thành viên thứ tư trong tar | `ENVELOPE_EXTRA_MEMBER` |
| 21 | thứ tự thành viên sai | `ENVELOPE_ORDER` |
| 22 | tiêu đề tar mở rộng (`x`) | `ENVELOPE_HEADER` |
| 23 | gói chứa `updater/` | `UPDATER_MANUAL_ONLY` |
| 24 | `format` 2.0.0 | `FORMAT_UNSUPPORTED` |
| 25 | `keyset` xóa chính khóa đã ký | `UPDATE_PACKAGE_INVALID` `KEYSET_SELF_REVOKE` |
| 26 | tên tệp trùng (hoa thường khác nhau) | `PATH_DUPLICATE` |
| 27 | mode `4755` (setuid) | `MODE_FORBIDDEN` |
| 28 | tên tệp tiếng Việt có dấu tổ hợp lạ, ký tự điều khiển | `PATH_INVALID` |
| 29 | gửi lại cùng `updateId` đang áp dụng | 409 `DEVICE_BUSY` |
| 30 | `Content-Length` lớn hơn thực tế gửi (nhận dở) | `UPDATE_RECEIVE_ABORTED`, dọn dẹp, nhả khóa |

Mỗi ca: bản đang chạy, `/opt`, dữ liệu không đổi; không tệp nào ngoài `update/incoming/` được ghi; audit `system.update.rejected`.

## 7. Vector và fuzz

`tests/update-vectors/` chứa gói hợp lệ mẫu (ký bằng khóa thử `tests/update-vectors/keys/test-ec-p256.pem`, khóa thử công khai, **không** dùng để phát hành) và 30 ca trên; sinh bằng `tools/release/make-update.mjs` (Node `crypto`, không phụ thuộc mới). Fuzz bộ đọc phong bì ≥ 1 giờ dưới ASan/UBSan (FR-029).
