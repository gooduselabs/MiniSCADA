# Plan: API dữ liệu (025)

Đầu vào: [spec.md](spec.md). Hiến pháp: bảo mật mặc định, ngân sách BL335, test trước.

## Kiến trúc

- `core/auth/api_keys.{hpp,cpp}`: mô hình key, đọc/ghi `api-keys.json` (dùng lại `readAuthPrivateFile`/`writeAuthPrivateFile` của `access_store`), token, IP/CIDR, `ApiKeyService` (xác thực, token bucket mỗi key, chặn IP đoán key, tạo/sửa/thu hồi theo `rev`, thống kê RAM). Thread-safe bằng một mutex.
- `server/http/data_api.{hpp,cpp}`: `DataApi::handle` sau cổng: xác thực key → quyền của key (`AccessService::forPrincipal`, không phải "tool") → đường đọc/ghi. Lịch sử: gọi `HistoryApi::handle` với một `GateDecision` tổng hợp (rule của `/api/v1/history/*`, `access` của key) nên dùng lại nguyên truy vấn, giới hạn, phân trang và CSV của 010. Alarm: `alarmsapi::getList/getHistory` với bộ lọc của key. Ghi: `WriteCoordinator::submit` với `WriteCaller{user=apikey:<id>, channel=https}`; `requestId` là khóa idempotency (coordinator trả `duplicate`).
- `core/auth/roles.cpp`: 12 dòng `/api/v1/data/*` (`needsSession=false`: cổng chỉ kiểm HTTPS và method; key kiểm ở `DataApi`), 4 dòng `/api/v1/admin/apikeys*`.
- `AdminApi`: nhánh `/api/v1/admin/apikeys*` (cùng `rateOk`, `reauth`, `deny`, `audit` của 013).
- Audit: `apikey.create`, `apikey.update`, `apikey.revoke`, `apikey.denied` (bị giới hạn/gộp như `access.denied`); kênh `https` (không thêm kênh mới để khỏi đổi CHECK của audit.db), người `apikey:<id>`.
- `server/main.cpp`: `ApiKeyService` trong thư mục auth, `DataApi`, `EngineeringApi::setData`.
- MQTT 022: `tagPatterns` (mở rộng thành danh sách Tag khi nạp model), `timestamps` (payload thêm `sourceTs`). Schema `connections.schema.json`, luật TS/C++ (`E_MQTT_GROUP_PATTERN` khi một mẫu không khớp Tag nào), vector `v11-mqtt-*`.
- Trang Quản trị: `tab-apikeys.ts`, `apikeys-model.ts` (kiểm form thuần), `api.ts`; e2e `admin-apikeys.e2e.mjs` trên `access-fake.mjs`.
- Tài liệu: OpenAPI 3.1, `docs/user/data-api.md`, ADR-053, threat-model I-18, mã lỗi, test `tools/data-api-openapi.test.mjs` (đường và method trong YAML = dòng `/api/v1/data/*` của `roles.cpp`).

## Ngân sách BL335

Kiểm key: SHA-256 một lần + tra bảng; không ghi đĩa khi gọi (thống kê RAM). `values` đọc `TagStore::snapshot` dưới một khóa. Lịch sử dùng chung bộ giới hạn 2 truy vấn của 010. Tốc độ mặc định 600 gọi/phút/key; ghi theo giới hạn sẵn có của coordinator (mỗi key là một phiên).

## Rủi ro

- Token lộ ở máy khách: hạn, IP cho phép, chỉ đọc mặc định, thu hồi tức thì, audit.
- Thống kê mất khi khởi động lại: chấp nhận (FR-008).
