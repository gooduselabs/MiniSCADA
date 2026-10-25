# Feature Specification: API dữ liệu cho hệ thống khác (ERP/MES/BI, script)

**Branch**: `025-data-api` | **Ngày**: 2026-10-25 | **Trạng thái**: duyệt (người dùng giao toàn quyền quyết định; các quyết định dưới đây tự chốt)

## Bối cảnh

ERP/MES/BI và script của nhà máy cần đọc giá trị, lịch sử, alarm và (khi được phép) ghi Tag mà không giả làm người đăng nhập. Phiên `mats_`/`matw_` của 005/007 dành cho người (hết hạn khi rỗi, gắn IP đăng nhập), không hợp cho máy. Feature này thêm **API key** cho máy và nhóm đường `/api/v1/data/*` có phiên bản trong đường dẫn, quyền theo đúng mô hình 013.

## User stories

### US1 — Quản trị viên cấp API key (P1)

Trang Quản trị web có tab **API key**: tạo key (tên, vai trò viewer/operator, nhóm 013, chỉ đọc, IP/CIDR cho phép, hạn, giới hạn gọi/phút), token `matk_…` hiện **đúng một lần**; sửa quyền/hạn/IP; thu hồi; xem lần dùng cuối và số gọi.

**Chấp nhận:** (1) token chỉ có trong câu trả lời tạo key, thiết bị chỉ lưu SHA-256; (2) tạo key có quyền ghi, hoặc sửa key thành có quyền ghi, phải nhập lại mật khẩu (`REAUTH_REQUIRED`); (3) `rev` sai → 409 `CONFLICT`; (4) mọi thay đổi có audit `apikey.*`; (5) axe không có vi phạm nghiêm trọng.

### US2 — Hệ thống khác đọc dữ liệu (P1)

Với `Authorization: Bearer matk_…` qua HTTPS: danh sách Tag được phép (tên, kiểu, đơn vị, mô tả, có ghi được không), giá trị hiện tại (giá trị, quality, timestamp), lịch sử thô/tổng hợp/dòng/CSV (dùng lại truy vấn lịch sử 010), alarm đang có và lịch sử alarm.

**Chấp nhận:** (1) Tag ngoài quyền của key không xuất hiện ở bất kỳ đường nào; hỏi riêng Tag đó → 403 `ACCESS_DENIED`; (2) key hết hạn/thu hồi/sai IP → 401/403 có mã riêng và audit; (3) quá giới hạn → 429 `RATE_LIMITED` có `Retry-After`; (4) HTTP thường → 403 `HTTPS_REQUIRED`.

### US3 — Hệ thống khác ghi Tag (P2)

Key operator không chỉ đọc ghi một/nhiều Tag qua write coordinator; mỗi lệnh có `requestId` (khóa idempotency: gửi lại cùng id không ghi hai lần) và `expect` tùy chọn (BOOL: giá trị phải đang là `expect`, khác thì `STALE_EXPECTATION`); kết quả từng Tag; hỏi kết quả sau.

**Chấp nhận:** (1) Tag không thuộc component `operate` mà key được phép → `ACCESS_DENIED` cho lệnh đó; (2) key chỉ đọc/viewer → 403 cả lô; (3) audit `tag.write` kênh `https`, người = `apikey:<id>`.

### US4 — Đẩy dữ liệu ra broker MQTT (P2)

Kỹ sư cấu hình nhóm publish JSON của driver MQTT 022 để đẩy dữ liệu ra broker; bổ sung chọn Tag theo **mẫu tên** (`tagPatterns`, `*`/`?`) và **timestamp từng Tag** (`timestamps: true`).

**Chấp nhận:** (1) vector luật TS + C++ cho khóa mới; (2) payload có `sourceTs` khi bật; (3) tài liệu cấu hình.

### US5 — Tài liệu API (P2)

OpenAPI 3.1 `docs/api/data-api.openapi.yaml` khớp bảng route (test); hướng dẫn `docs/user/data-api.md` với `curl`, Python, Node-RED; tab API key có liên kết tới hướng dẫn.

## Yêu cầu chức năng

- **FR-001** Token `matk_` + 43 ký tự base64url (32 byte ngẫu nhiên); thiết bị lưu `sha256` hex và 12 ký tự đầu (để nhận diện); so sánh băm thời gian hằng.
- **FR-002** Kho `<dataDir>/auth/api-keys.json` 0600, `rev` cả tệp, ghi nguyên tử (giữ `.bak`), tối đa 32 key; tệp hỏng → mọi key bị từ chối (503 `APIKEY_STORE`), trang báo lỗi (an toàn mặc định).
- **FR-003** Key: `role` viewer|operator, `groups` (nhóm của `access.json`), `readOnly`, `allowFrom` (≤ 16 IP/CIDR v4/v6, rỗng = mọi nguồn), `expiresAt` (tùy chọn), `ratePerMin` 10–6000 (mặc định 600).
- **FR-004** Quyền: key là một `Principal` (`user` = `apikey:<id>`) của `computeAccess` 013: đọc = `liveTags`, lịch sử = `historyTags`, alarm = `alarmAllowed`, ghi = Tag trong binding của item `operate` được phép, cộng `writeMinRole` của Tag. Không bao giờ là "công cụ kỹ sư" (thấy hết).
- **FR-005** Từ chối: thiếu/sai dạng token 401 `AUTH_REQUIRED`; key không có 401 `APIKEY_INVALID`; hết hạn 401 `APIKEY_EXPIRED`; sai nguồn 403 `APIKEY_SOURCE`; quá tốc độ 429 `RATE_LIMITED`; một IP gửi key sai 20 lần/phút → 429 `APIKEY_THROTTLED` đến hết phút; kho hỏng 503 `APIKEY_STORE`. Mọi từ chối audit `apikey.denied` (gộp theo cơ chế giới hạn của audit, như `access.denied`).
- **FR-006** Đường đọc: `GET /api/v1/data/{key,tags,values,history/catalog,history/series,history/aggregate,history/rows,history/export.csv,alarms,alarms/history}`; ghi: `POST /api/v1/data/write`, `GET /api/v1/data/write?ids=`, `GET /api/v1/data/write/{requestId}`. `values?tags=` ≤ 200 Tag; không có `tags` → mọi Tag được phép.
- **FR-007** Quản trị: `GET|POST /api/v1/admin/apikeys`, `POST /api/v1/admin/apikeys/{id}`, `POST /api/v1/admin/apikeys/{id}/revoke` theo khuôn 013 (administrator, HTTPS, CSRF/Origin của cookie, 30 thay đổi/phút, `rev`, audit trước khi ghi).
- **FR-008** Lần dùng cuối, nguồn cuối và số gọi giữ trong RAM (không ghi eMMC mỗi lần gọi); về 0 khi runtime khởi động lại.

## Giả định

- Máy gọi API ở trong mạng nhà máy hoặc qua VPN; chứng chỉ thiết bị tự ký hoặc CA nội bộ (`curl --cacert device.crt`).
- Không có CORS: API dành cho máy, không cho trang web của bên thứ ba.
- Thu hồi = xóa khỏi kho (audit giữ lịch sử); không có "tạm khóa".
- Quyền ghi đi theo component `operate` của 013, nên một Tag chỉ ghi được khi có component điều khiển gắn Tag đó (kỹ sư có thể thêm một màn hình "API" không có trong menu).

## Tiêu chí thành công

- **SC-001** Key bị thu hồi bị từ chối ngay ở lần gọi tiếp theo.
- **SC-002** Kiểm key là một SHA-256 và một lần tra bảng; không ghi đĩa khi gọi.
- **SC-003** Không có token rõ trong tệp kho, log, audit (test).
