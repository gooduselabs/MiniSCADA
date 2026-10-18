# So cặp trước/sau 011: đường xem 0.6 từ mạng riêng và quy trình nạp xuống 005 (T200, SC-042)

**Kết luận: không có hồi quy.** Cùng một bộ kiểm, cùng cấu hình, chạy với runtime **0.9.0** (commit `60b254bc`, trước 011) và **1.0.0-rc.1** (`aa7c0a94`, nhánh `gd6`): 1.194 đường dẫn JSON của bản ghi giống nhau, 134 khác. Mọi chỗ khác thuộc một trong ba loại: thay đổi có chủ đích của 011 (Host 421, `Referrer-Policy`, khóa mới của `system/info`, chuỗi phiên bản), nhiễu đo (pha sin của giả lập, lúc thăm dò, id thiết bị), hoặc hệ quả của dòng audit mới (421) lên ngưỡng gộp `audit.suppressed` có từ 005. Lần đối chứng không gửi Host lạ cho ra **đúng 39/39 dòng audit như bản 0.9.0**. Kết quả đầy đủ: [011-regression-pair.json](011-regression-pair.json) (hai bản ghi, bản đối chứng, danh sách khác).

Ngày đo 2026-10-18, Docker `mat-armhf` (Linux arm64 trên Mac Apple Silicon, cùng cách gọi "x64" của các rig khác), bản dựng Release, `MAT_TEST_HOOKS=OFF`. Chưa chạy trên BL335.

## 1. Cách đo

| Mục | Giá trị |
|---|---|
| Runtime cũ | `60b254bc` (0.9.0, API 1.4.0, live 1.3.0), dựng ở `~/build/t200-old` từ `git worktree` riêng; trang xem `apps/runtime-web/dist-device` dựng từ chính cây đó |
| Runtime mới | `aa7c0a94` (1.0.0-rc.1, API 1.5.0, live 1.3.0), dựng ở `~/build/t200-new`; trang xem dựng từ cây hiện tại |
| Cấu hình | `--viewer-access private`, `--no-discovery`, mọi giới hạn để mặc định; `supervise.sh` của chính cây nguồn |
| Project | `projects/training-demo` (`schemaVersion` 0.6.0, 9 Tag Modbus, 2 alarm, 1 nhóm lưu trữ), cùng một thư mục cho cả hai; giả lập `tools/modbus-sim` map `training-demo.json` chạy chung mạng với runtime |
| Mạng | `lan` 172.30.71.0/24 (RFC1918) và `pub` 203.0.113.0/24 (không phải mạng riêng); client có địa chỉ trên cả hai |
| Bộ kiểm | `tests/device-it/pair-011.mjs` (client Node, cây hiện tại cho cả hai lần), rig `tests/device-it/compose.pair.yaml` + `pair-011-rig.mjs`, so bằng `pair-011-diff.mjs` |
| Che giá trị | thời điểm, token, `opId`, `sequence`, hash tên tệp asset, vân tay; digest giữ nguyên (cùng tệp nên cùng digest) |
| Nhiễu | chạy 0.9.0 hai lần: 9 đường dẫn khác (`bonMuc`, số delta, `evalMaxMs`, `deviceId`, `freeBytes`, độ dài `system/info`, thời gian và vết bước nạp xuống) |
| Đối chứng | 1.0.0-rc.1 chạy lại với `--skip-evil-host` (không gửi `Host: evil.example`) |

Chạy lại (không cần pwsh):

```sh
node tests/device-it/pair-011-rig.mjs --label old --src <cây 60b254bc> --build <build cũ> --out old.json
node tests/device-it/pair-011-rig.mjs --label new --src . --build <build mới> --out new.json
node tests/device-it/pair-011-diff.mjs old.json new.json
```

## 2. Kết quả

### 2.1 Giống nhau

| Phần | Hành vi (cả hai bản) |
|---|---|
| Trang xem từ mạng riêng, không đăng nhập | `/`, `/index.html`, `/login`: 200 `text/html` có CSP, `no-cache`, ETag, gzip; asset `index-*.js`, `index-*.css`: 200, `public, max-age=31536000, immutable`, gzip; `/device.crt` 200 |
| API của trang xem | `system/info`, `device/identity`, `projects/active`, `alarms`: 200 JSON `no-store`; `/project/screens/*.screen.json` 200, đúng byte của thư mục project; `/project/project.json`, `tags.json`, `connections.json`, `alarms.json`, tệp không có: 404; `web/session`, `history/catalog`, `diagnostics`, `project/versions`: 401 `AUTH_REQUIRED` |
| Hình dạng `projects/active` | giống hệt (project, tags, screens, navigation, connections, valueTables) |
| WebSocket `/api/v1/live` từ mạng riêng | 101; `hello` protocol 1.3.0, `maxClients` 10, `heartbeatMs` 5000, `timeoutMs` 15000, `features: ["alarms"]`, `project` {id, version, digest} cùng digest; `subscribe` 9 Tag + 1 Tag lạ → `snapshot` 9 Tag GOOD, `unknown: ["KHONG.CO"]`, khóa Tag `id, quality, revision, serverTimestamp, sourceTimestamp, value`; khoảng 27–28 `delta` trong 7 s, `sequence` tăng dần; `write` qua live: `error BAD_MESSAGE` và audit `tag.write denied LIVE_WRITE_NOT_ALLOWED` |
| Biến thể nâng cấp | không có Origin: 101; Origin `https://evil.example`: 403; Origin `http://<ip>:8443`: 101 |
| Nguồn công cộng (203.0.113.50) | `/`, `/index.html`, `system/info`, `projects/active`, `alarms`, `/project/*`: 403 (`SOURCE_NOT_ALLOWED` ở API); `/login`, `/device.crt`, `device/identity`: 200; WebSocket: 403 |
| `X-Forwarded-For`, `X-Real-IP`, `Forwarded` giả 172.30.71.50 từ nguồn công cộng | **không được tin**: vẫn 403 |
| Host là IP (có hoặc không cổng), `rt:8443`, `rt.local`, `localhost:8443` | 200 |
| Cổng HTTP 8080 | `/`, `system/info`, `projects/active`: 200; `/project/project.json`: 404; API kỹ thuật (`project/versions` có Bearer): 403 `HTTPS_REQUIRED` |
| Đăng nhập | sai mật khẩu 401 `AUTH_FAILED`; engineer 200; `auth/session` 200 (idle 1799 s, lifetime 43199 s) |
| Kho project lúc đầu | seq 1 `active`, nguồn `runtime-package` (nhận từ thư mục project), đọc lên 200 `application/zip`, đủ 8 tệp, `X-Mat-Digest` = digest đang chạy; `project/manifest` 200; `project/operation` 200 `null` |
| Từ chối trước khi nhận | không đăng nhập 401 `AUTH_REQUIRED`; role viewer 403 `FORBIDDEN`; base sai 409 `BASE_CHANGED`; `X-Mat-Digest` sai dạng 400 `BAD_REQUEST` |
| Nạp xuống 0.2.0 | 202 → `committed` khoảng 4,2 s; các bước `receive`, `verify-package`, `validate`, `backup`, `activate`, `health` đều `ok`; đọc lên đúng byte của gói; khách thấy `projects/active` 0.2.0 |
| Gói có digest khác khai báo | 202 → `failed` ở `verify-package`, `E_PKG_DIGEST` |
| Project lỗi kiểm (Tag không có trên màn hình) | 202 → `failed` ở `validate`, `E_VALIDATION`, issue `E_REF_TAG screens/tong-quan.screen.json /items/1/tags/value` |
| Nạp xuống 0.3.0 | `committed`; versions: seq 3 active, seq 2 và 1 `backup` `restorable` |
| Khôi phục | bản đang chạy 409 `ALREADY_ACTIVE`; seq 999 404 `NO_SUCH_VERSION`; seq 2 (0.2.0) 202 → `committed`, `kind: restore`, `receive`/`verify-package` `skipped`; seq 2 active nguồn `restore`; đọc lên đúng byte của 0.2.0; đọc bản dự phòng seq 1: 200 |
| Audit | role viewer 403 `FORBIDDEN`; chuỗi `project.deploy started/ok/failed` (`BASE_CHANGED`, `E_PKG_DIGEST`, `E_VALIDATION`), `project.restore` (`ALREADY_ACTIVE`, `NO_SUCH_VERSION`, `started`, `ok`), `project.read`, `auth.login`, `account.create`, `project.adopt`, `cert.generate`: giống từng dòng (bản đối chứng: 39/39) |

### 2.2 Khác có chủ đích (FR/ADR)

| Chỗ khác | 0.9.0 | 1.0.0-rc.1 | Lý do |
|---|---|---|---|
| `Host: evil.example` trên `/` và `projects/active` | 200 | 421 `HOST_NOT_ALLOWED`, JSON, `no-store`, đúng thân của hợp đồng | FR-011 đến FR-013, research R4, [device-api-011.md](../../specs/011-pilot-hardening/contracts/device-api-011.md) §1 |
| WebSocket với `Host: evil.example` | 101, nhận `hello` | 421 trước khi nâng cấp | như trên (kiểm Host cả lúc nâng cấp WebSocket) |
| Audit thêm `access.denied HOST_NOT_ALLOWED /` | không có | 1 dòng (gộp theo nguồn và phút) | như trên; L1 của rà soát bảo mật 011 |
| Header `Referrer-Policy: no-referrer` | không có | có ở mọi phản hồi đã ghi (58 đường dẫn) | L-17 của 007, T041/T050 |
| `system/info.runtimeVersion`, `hello.serverVersion` | 0.9.0 | 1.0.0-rc.1 | T191 (phiên bản phát hành) |
| `system/info.device.apiVersion` | 1.4.0 | 1.5.0 | device-api-011 (MINOR, chỉ thêm) |
| `system/info.schemaVersions` | 0.1–0.5 | 0.1–0.6, 1.0 | commit `be55ed06` (định dạng 1.0; 0.6 bị thiếu trong danh sách từ 010 dù runtime 0.9.0 đã nhận project 0.6) |
| `system/info` khóa mới | không có | `warningDetails` (`[]`), `timeSynced`, `releaseSeq` (0), `update {enabled:false, supported:true}`, `logic {present:false, writes:"off"}` | device-api-011 §5–§6 (T140 đồng hồ, OTA, logic) |
| `device/identity.features` | 15 mục | thêm `logic`, `update` | như trên |
| Kích thước `system/info`, `device/identity` | 2.127 B, 467 B | 2.283 B, 489 B | các khóa mới ở trên |
| `index.html` gzip | 1.049 B | 1.051 B | trang xem dựng lại từ cây 011 (tên bundle khác); số và loại asset giống |
| `audit.suppressed.detail` | `byAction` | thêm `sources` (`{"172.30.71.50": n}`) | L-06 của 005, T041 |

### 2.3 Hồi quy

Không có.

Hai chỗ khác đã xem kỹ và **không** xếp là hồi quy:

1. **Dòng `auth.login failed AUTH_FAILED` có ở 0.9.0 nhưng ở 1.0.0-rc.1 nằm trong `audit.suppressed`** (`byAction.auth.login: 1`). Nguyên nhân: kịch bản gửi 10 yêu cầu bị từ chối trong cùng một phút (8 `AUTH_REQUIRED`, 1 `HOST_NOT_ALLOWED` mới, 1 `LIVE_WRITE_NOT_ALLOWED`) trước lần đăng nhập sai; quá 10 dòng giới hạn mỗi phút thì sự kiện được đếm vào `audit.suppressed` (research R11 của 005, không đổi). Lần đối chứng bỏ Host lạ: dòng `auth.login failed` trở lại, 39/39 dòng giống bản cũ. Hành vi gộp giữ nguyên; chỉ có thêm một loại sự kiện bị từ chối (421) dùng chung ngân sách 10 dòng/phút. Nên ghi nhận cho vận hành: một trang lạ dội 421 vào thiết bị có thể làm dòng đăng nhập sai bị gộp (vẫn được đếm, có nguồn trong `detail.sources`). Đây là thiết kế đã chốt ở L1 (421 gộp theo phút), không phải lỗi. **Cập nhật 2026-10-18 (đã sửa, nhánh `gd6-audit-budget`):** dù không phải hồi quy, việc có thể che bằng chứng dò mật khẩu được xếp thành phát hiện T200 ([011-security-review.md](011-security-review.md) §7) và đã sửa: dòng của Host policy có ngân sách audit riêng (10 dòng/phút, dòng `audit.suppressed` riêng với `detail.budget: "host"`, [device-api-011.md](../../specs/011-pilot-hardening/contracts/device-api-011.md) §1). Với kịch bản này, ngân sách chung chỉ còn 9 dòng trước lần đăng nhập sai, nên dòng `auth.login failed` được ghi riêng như ở 0.9.0. Bản ghi so cặp ở trên là của `aa7c0a94`, trước khi sửa; chưa chạy lại rig.
2. **Vết bước của lần nạp xuống**: lần thăm dò đầu sau khi nhận thân thấy `verify-package: pending` (1.0.0-rc.1, 2/3 lần chạy) thay cho `running` (0.9.0); ngược lại 0.9.0 có lần thấy thêm trạng thái trung gian `activate: running`. Thăm dò mỗi 100 ms nên chỉ bắt được một số trạng thái trung gian; hai lần chạy cùng bản 0.9.0 cũng khác nhau ở mục này. Trạng thái cuối, thứ tự bước, kết quả và mã lỗi giống hệt.

### 2.4 Nhiễu đo (không tính)

`snapshot.bonMuc` và theo đó số alarm đang có (`alarms.active`, `unacked`, độ dài `GET /alarms`): giá trị BON.MUC theo pha sin 120 s của giả lập lúc đo (lần cuối: 80,96 trên 0.9.0, quá ngưỡng H 80; 15,10 trên 1.0.0-rc.1). Số khung delta (27–28), `evalMaxMs`, `deviceId` (sinh mới mỗi rig), `historian.freeBytes`, `rows24h`, thời gian nạp xuống (4,20 s và 4,22 s).

## 3. Giới hạn

- Không có BL335: đo trên Docker arm64 của Mac; `maxLiveClientsPerSource` (5 mặc định ở 1.0) và giới hạn kết nối theo nguồn không bị chạm vì chỉ có một client (đã đo riêng ở `011-load-x64.json`, `011-lockout-x64.json`).
- Chỉ kiểm mức giao thức (HTTP, WebSocket); không mở trang bằng Chrome. Phần giao diện của trang xem nằm ở e2e runtime-web và `web-it` của `ci-local`.
- Nạp xuống kiểm các lỗi rẻ (`E_PKG_DIGEST`, `E_VALIDATION`, `BASE_CHANGED`); các vector gói độc, `DEVICE_BUSY`, quay về do health (`--test-health`), SIGKILL từng bước là phần của `device-it` (`packages`, `busy`, `health`, `kill`) trong `ci-local`.
