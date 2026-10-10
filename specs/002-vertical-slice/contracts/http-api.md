# Contract — HTTP của `mat-runtime` (Sprint 1)

Chỉ đọc, chưa có xác thực (Sprint 5). Mọi phản hồi có `X-Content-Type-Options: nosniff`. Phương thức khác `GET`/`HEAD` → 405.

## Trang runtime (static, docroot `/opt/mat-runtime/web`)

| Đường dẫn | Nội dung | Header |
|---|---|---|
| `/`, `/index.html` | trang runtime | CSP runtime (dưới), `Cache-Control: no-cache`, ETag |
| `/assets/*` | JS/CSS có hash trong tên | `Cache-Control: public, max-age=31536000, immutable`; phục vụ `.gz` nén sẵn nếu trình duyệt nhận gzip |

**CSP runtime:** `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`

Gói deploy **không** có `lab.html`, fixture SVG hay `screens/` của Sprint 0.

## Project đang hoạt động

| Method | Đường dẫn | Phản hồi |
|---|---|---|
| GET | `/api/v1/projects/active` | 200 `{ "project": <project.json>, "tags": <tags.json>, "screens": { "<id>": { "screen": <screen.json>, "bindings": <bindings.json> } } }`. Khi project không hợp lệ hoặc không có: **503** `{ "error": "NO_VALID_PROJECT", "errors": [{code, file, path, message}] }` |
| GET | `/project/<path>` | Chỉ trả file nằm trong **allowlist** lập lúc validate (`svgFile` của các screen). Ngoài allowlist → 404. Header: `Content-Type: image/svg+xml`, **CSP project**, `Cache-Control: no-cache`, ETag |

**CSP project:** `default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox`

## Hệ thống

`GET /api/v1/system/info` → 200, `Cache-Control: no-store`:

```json
{
  "runtimeVersion": "0.2.0",
  "protocolVersion": "1.0.0",
  "schemaVersions": ["0.1"],
  "clients": 3,
  "maxClients": 10,
  "rejectedTotal": 1,
  "originRejectedTotal": 0,
  "overflowClosedTotal": 0,
  "timeoutClosedTotal": 2,
  "writeFailedTotal": 0,
  "uptimeS": 3600,
  "project": { "status": "active", "projectId": "tank-demo", "projectVersion": "0.1.0", "errors": [] },
  "tagCount": 505
}
```

`project.status` ∈ `active | invalid | missing`. Khi `invalid`, `errors` liệt kê mã lỗi theo [project-format.md](project-format.md).

Endpoint này trả kèm `Access-Control-Allow-Origin` cho các origin trong `allowedOrigins`, để Studio đọc được từ `http://tauri.localhost`.
