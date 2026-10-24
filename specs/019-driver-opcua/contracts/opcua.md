# Hợp đồng: driver OPC UA client (019)

Bổ sung [spec.md](../spec.md). Áp cho runtime (C++), validator TS/C++ và Studio.

## §1 Kênh `opcua` (connections.json, định dạng 1.1)

```json
{
  "id": "ua-1",
  "name": "Server OPC UA",
  "kind": "opcua",
  "enabled": true,
  "opcua": {
    "endpointUrl": "opc.tcp://192.168.0.20:4840",
    "securityMode": "SignAndEncrypt",
    "securityPolicy": "Basic256Sha256",
    "serverCertSha256": "<64 chữ số hex thường>",
    "auth": { "mode": "username", "username": "operator", "secretId": "opcua-ua-1" },
    "readMode": "subscription",
    "sessionTimeoutMs": 60000,
    "connectTimeoutMs": 5000,
    "reconnectMaxS": 10
  },
  "devices": [{ "id": "srv1", "name": "Server", "timeoutMs": 2000, "writeDeadlineMs": 5000 }]
}
```

Mặc định: `securityMode` None, `securityPolicy` None, `auth` anonymous, `readMode` subscription, `sessionTimeoutMs` 60000, `connectTimeoutMs` 5000, `reconnectMaxS` 10; thiết bị `timeoutMs` 2000, `writeDeadlineMs` 5000. Không có `tcp`, `serial`, `requestGapMs`; thiết bị không có `unitId`, `retries`… (`E_SCHEMA`).

Luật (TS `rules-opcua.ts`, C++ `rules_02.cpp`; theo thứ tự, mỗi kênh `opcua`):

1. project không phải 1.1 → `E_DRIVER_VERSION` tại `/channels/<i>/kind`.
2. Mode/policy hiệu lực (sau mặc định) không khớp: mode None với policy Basic256Sha256, hoặc Sign/SignAndEncrypt với policy None → `E_OPCUA_SECURITY` tại `/channels/<i>/opcua/securityPolicy`.
3. `auth.mode` username thiếu `username` hoặc `secretId`, hoặc anonymous có một trong hai → `E_OPCUA_AUTH` tại `/channels/<i>/opcua/auth`.
4. Cảnh báo: username với mode None → `W_OPCUA_PLAIN_PASSWORD` tại `/channels/<i>/opcua/auth`; mode khác None và không có `serverCertSha256` → `W_OPCUA_CERT_NOT_PINNED` tại `/channels/<i>/opcua`.

Tag ngoài trên thiết bị của kênh `opcua` (sau luật `stringLength` chung):

- `byteOrder` → `E_SCHEMA` `.../source/byteOrder`; `stringByteOrder` → `E_SCHEMA` `.../source/stringByteOrder`.
- `source.address` phân tích bằng NodeId (`tests/opcua-vectors/nodeid.json`); lỗi → mã của bộ phân tích tại `.../source/address`, thông điệp `OPC UA NodeId '<address>': <code>`.
- `W_DETECT_SLOW` như Modbus TCP (`retries` 0, `timeoutMs` mặc định 2000) khi NodeId phân tích được.

## §2 Kiểu (D5)

| Kiểu server | Tag BOOL | số nguyên | FLOAT32/64 | STRING |
|---|---|---|---|---|
| Boolean | có | 0/1 | 0/1 | "true"/"false" |
| SByte…UInt64 | ≠0 | trong khoảng | có | thập phân |
| Float, Double | — | không (`OPCUA_TYPE_MISMATCH`) | có (FLOAT32 trong khoảng float) | — |
| String | — | — | — | có |
| DateTime | — | INT64/UINT64: ms Unix | — | ISO 8601 UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` |

`—` là `OPCUA_TYPE_MISMATCH`. Ghi: theo kiểu của node trên server (biết từ lần đọc gần nhất, chưa có thì đọc Value trước): số nguyên ngoài khoảng của kiểu node → `DEVICE_EXCEPTION` không gửi (`NOT_SENT_UNSUPPORTED`).

## §3 Chẩn đoán (GET /api/v1/drivers/diagnostics)

Kênh `kind: "opcua"`, thêm `details` (chuỗi):
`endpointUrl`, `securityMode`, `securityPolicy`, `readMode` (`subscription` | `poll` | `subscription+poll`), `session` (`none` | `active`), `serverCertSha256` (chứng chỉ server thấy ở lần kết nối gần nhất), `clientCertSha256`, `publishingMs` (ví dụ `250/1000/5000`, giá trị server chấp nhận), `lastStatus` (tên StatusCode lỗi gần nhất, ví dụ `BadNodeIdUnknown`).
`warnings`: `OPCUA_SUBSCRIPTION_FALLBACK`, `OPCUA_SERVER_CERT_EXPIRED`. `lastError.code`: `OPCUA_*`, `REFUSED`, `TIMEOUT`, `DISCONNECTED`, `DNS`, `UNREACHABLE`.

## §4 POST /api/v1/drivers/opcua/browse (engineer)

Yêu cầu:

```json
{ "channel": { "id": "ua-1", "kind": "opcua", "opcua": { … như §1 … } },
  "action": "endpoints" | "browse",
  "nodeId": "i=85",
  "timeoutMs": 5000 }
```

`channel.opcua` như §1 (kênh chưa lưu cũng được); `nodeId` chỉ cho browse (mặc định `i=85`, Objects); `timeoutMs` 1000–30000. Lỗi đầu vào → 400 `{ "code": "E_FIELD_VALUE" | "E_FIELD_MISSING" | "E_ADDR_SYNTAX" | "E_ADDR_RANGE", "issues": [{ "code", "path", "message" }] }`. Quá 60 lần/phút → 429 `TEST_RATE_LIMITED`. Audit `driver.test` (target = endpointUrl).

Trả lời 200:

```json
{ "ok": true, "code": "OK", "message": "…", "elapsedMs": 120,
  "server": { "applicationUri": "urn:…", "certSha256": "…" | null, "certSubject": "CN=…" | null, "certNotAfter": "2036-…Z" | null },
  "endpoints": [{ "securityMode": "None", "securityPolicy": "None", "userTokens": ["anonymous", "username"] }],
  "references": [{ "nodeId": "ns=2;s=Tank", "browseName": "2:Tank", "displayName": "Tank", "nodeClass": "Object", "hasChildren": true },
                 { "nodeId": "ns=2;s=Tank.Level", "browseName": "2:Level", "displayName": "Level", "nodeClass": "Variable", "dataType": "Double", "tagType": "FLOAT64", "writable": true, "hasChildren": false }],
  "truncated": false }
```

- `endpoints`: chỉ GetEndpoints (không session, không cần tin chứng chỉ); `server` lấy từ endpoint đầu có chứng chỉ (ưu tiên endpoint khớp mode/policy của kênh).
- `browse`: mở session theo security/xác thực của kênh; mode khác None cần `serverCertSha256` khớp, không thì `ok: false`, `code: "OPCUA_CERT_UNTRUSTED"`, kèm `server.certSha256` để Studio hỏi kỹ sư. Tối đa 1000 tham chiếu (HierarchicalReferences, hướng xuôi), `truncated` khi nhiều hơn. `tagType` là kiểu Tag gợi ý (Boolean → BOOL, SByte/Int16 → INT16, Byte/UInt16 → UINT16, Int32/UInt32/Int64/UInt64/Float/Double tương ứng, String → STRING, DateTime → INT64); không gợi ý được thì bỏ. `writable` theo UserAccessLevel.
- `ok: false`: `code` là `REFUSED`, `TIMEOUT`, `DNS`, `UNREACHABLE`, `OPCUA_*`; `message` tiếng Việt.

`POST /api/v1/drivers/test` với `channel.kind: "opcua"` → 200 `{ ok: false, code: "NOT_SUPPORTED" }`.

## §5 Bí mật, chứng chỉ

- Mật khẩu: `secrets.json` của thiết bị, khóa = `auth.secretId` (`mat-runtime --set-secret <secretId>`).
- Chứng chỉ client: `<dataDir>/opcua/client-cert.der`, `client-key.der` (0600), RSA 2048, ApplicationUri `urn:atpro:mat-scada:<hostname>`.
- Ghim: SHA-256 của DER chứng chỉ server, 64 chữ số hex thường.
