# API dữ liệu cho hệ thống khác (ERP, MES, BI, script)

Thiết bị mAT SCADA cho hệ thống khác **đọc** giá trị Tag, lịch sử, alarm và (khi được cho phép) **ghi** Tag qua HTTPS bằng **API key**. Có hai cách lấy dữ liệu ra:

- **Hỏi khi cần (REST, mục 2 đến 6):** hệ thống của bạn gọi `https://<thiết bị>/api/v1/data/...` với API key.
- **Thiết bị tự đẩy (MQTT, mục 8):** driver MQTT gửi giá trị lên broker theo chu kỳ hoặc khi đổi.

Đặc tả máy đọc được: [data-api.openapi.yaml](../api/data-api.openapi.yaml) (OpenAPI 3.1). Thiết kế: [ADR-053](../adr/053-data-api.md).

## 1. Tạo API key

Quản trị viên mở trang web của thiết bị → **Quản trị** → tab **API key** → **Tạo API key**:

| Ô | Ý nghĩa |
| --- | --- |
| Tên key | Tên dễ nhận ra: `ERP kho`, `Power BI`, `script ca đêm`. |
| Vai trò | **viewer**: chỉ đọc. **operator**: đọc, và ghi được nếu bỏ "Chỉ đọc". |
| Chỉ đọc | Mặc định bật. Key ghi được Tag cần bạn nhập lại mật khẩu khi tạo. |
| Nhóm | Nhóm người dùng của tab **Nhóm**: key thấy đúng những gì một người trong các nhóm đó, cùng vai trò, thấy. |
| Chỉ cho phép từ | Danh sách IP hoặc mạng (`192.0.2.10`, `192.0.2.0/24`, `2001:db8::/32`). Để trống: mọi nguồn. **Nên điền.** |
| Hết hạn sau ngày | Để trống: không hết hạn. |
| Giới hạn gọi mỗi phút | 10 đến 6000, mặc định 600. Gọi dồn được tối đa một phần mười (ít nhất 10) rồi đều theo giới hạn. |

Sau khi tạo, key (dạng `matk_` + 43 ký tự) **hiện đúng một lần**: bấm **Sao chép** và lưu vào nơi an toàn của hệ thống gọi (biến môi trường, kho bí mật). Thiết bị chỉ giữ bản băm SHA-256; mất key thì **Thu hồi** và tạo key mới. Bảng key cho biết lần dùng cuối, địa chỉ gọi cuối và số lần gọi (tính từ lần khởi động runtime gần nhất).

**Thu hồi** có hiệu lực ngay ở lần gọi tiếp theo. Mọi tạo, sửa, thu hồi và mọi lần gọi bị từ chối có trong **Nhật ký** (`apikey.create`, `apikey.update`, `apikey.revoke`, `apikey.denied`); mọi lần ghi Tag là `tag.write` với người `apikey:<mã key>`.

### Key thấy và ghi được gì

Key theo đúng phân quyền của trang (feature 013), như một người có cùng vai trò và nhóm:

- **Đọc giá trị:** Tag gắn với các màn hình, component, báo cáo người đó xem được.
- **Lịch sử:** Tag của nhóm ghi lịch sử người đó xem được.
- **Alarm:** alarm của Tag người đó xem được (cần quyền xem trang Alarm).
- **Ghi:** Tag nằm trong binding của **component điều khiển** mà người đó **thao tác** được, Tag có quyền RW, và vai trò key không thấp hơn `writeMinRole` của Tag. Muốn cho ERP ghi một Tag không có trên màn hình nào: kỹ sư thêm một màn hình (không cần đưa vào menu) có component điều khiển gắn Tag đó, rồi cấp quyền thao tác cho nhóm của key.

Tag ngoài quyền không xuất hiện ở bất kỳ đường nào; hỏi riêng Tag đó nhận `403 ACCESS_DENIED` (giống hệt Tag không tồn tại).

## 2. Gọi API

Mọi yêu cầu qua **HTTPS** (HTTP thường: `403 HTTPS_REQUIRED`) và mang header:

```text
Authorization: Bearer matk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Chứng chỉ của thiết bị tự ký: tải `device.crt` từ trang web của thiết bị (hoặc dùng CA nội bộ của nhà máy) và chỉ cho công cụ gọi tin chứng chỉ đó. **Không** tắt kiểm chứng chỉ (`curl -k`, `verify=False`) trên mạng thật.

```sh
export MAT=https://192.0.2.10:8443
export MAT_KEY=matk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
curl --cacert device.crt -H "Authorization: Bearer $MAT_KEY" $MAT/api/v1/data/key
```

`GET /api/v1/data/key` trả về chính key đang dùng (tên, vai trò, nhóm, chỉ đọc, hạn, giới hạn, địa chỉ nguồn thiết bị thấy): dùng để kiểm cấu hình.

## 3. Danh sách Tag và giá trị hiện tại

`GET /api/v1/data/tags`: các Tag key đọc được, theo thứ tự của project.

```json
{"tags": [
  {"name": "TANK01.LEVEL", "type": "FLOAT32", "unit": "%", "description": "Mức nước bồn",
   "writable": false, "history": true},
  {"name": "MOTOR01.RUN", "type": "BOOL", "unit": null, "description": "Bơm đang chạy",
   "writable": true, "history": true}
]}
```

`GET /api/v1/data/values?tags=TANK01.LEVEL,MOTOR01.RUN` (1 đến 200 Tag; bỏ `tags` để lấy mọi Tag được đọc):

```json
{"time": "2026-10-25T08:00:00.120Z",
 "values": [
  {"name": "TANK01.LEVEL", "value": 42.5, "quality": "GOOD",
   "sourceTs": "2026-10-25T07:59:59.900Z", "serverTs": "2026-10-25T07:59:59.901Z"},
  {"name": "MOTOR01.RUN", "value": null, "quality": "BAD", "reason": "COMM_TIMEOUT",
   "sourceTs": null, "serverTs": "2026-10-25T07:59:58.000Z"}
]}
```

Số nguyên vượt ±2^53 trả dạng chuỗi thập phân. Thời điểm luôn là UTC (ISO 8601).

## 4. Lịch sử

Dùng lại nguyên truy vấn lịch sử của trang (giới hạn, chọn nguồn thô/tổng hợp, giảm điểm, tối đa 2 truy vấn cùng lúc trên thiết bị):

| Đường | Dùng cho |
| --- | --- |
| `GET /api/v1/data/history/catalog` | nhóm ghi lịch sử, Tag của nhóm (chỉ Tag key được đọc), giới hạn |
| `GET /api/v1/data/history/series?group=&tags=&from=&to=&maxPoints=` | chuỗi để vẽ (tối đa 16 Tag, 5000 điểm) |
| `GET /api/v1/data/history/aggregate?group=&tags=&from=&to=&bucketMs=` | min, max, avg, first, last, sum, count theo cửa sổ (bội số 1 phút) |
| `GET /api/v1/data/history/rows?group=&from=&to=&limit=&after=` | dòng thô theo trang (tối đa 500 dòng; trang sau: `after` = `seq` cuối) |
| `GET /api/v1/data/history/export.csv?group=&from=&to=&res=` | tệp CSV (UTF-8, có BOM; `bom=0` để bỏ) |

`from`, `to` là epoch ms UTC, khoảng `[from, to)`. Ví dụ trung bình mỗi giờ của hôm qua:

```sh
curl --cacert device.crt -H "Authorization: Bearer $MAT_KEY" \
  "$MAT/api/v1/data/history/aggregate?group=bon-nuoc&tags=TANK01.LEVEL&from=1793059200000&to=1793145600000&bucketMs=3600000"
```

## 5. Alarm

- `GET /api/v1/data/alarms`: alarm đang có (trạng thái, mức, lần xảy ra, đã xác nhận chưa).
- `GET /api/v1/data/alarms/history?from=&to=&priority=&state=&limit=&beforeId=`: lịch sử, trang sau dùng `beforeId` = mã nhỏ nhất của trang trước.

Key không xác nhận hay tạm ẩn alarm được: các thao tác đó là của người vận hành.

## 6. Ghi Tag

Key vai trò **operator**, bỏ **Chỉ đọc**. `POST /api/v1/data/write` với `Content-Type: application/json`, 1 đến 16 lệnh:

```json
{"requests": [
  {"requestId": "3f9c1a52-7d4e-4b8a-9f61-0c2d5e8a7b10", "tag": "TANK01.SP", "value": 75.5},
  {"requestId": "5b2e8c41-1a9d-4f3e-8b72-6d0c9e4f2a31", "tag": "MOTOR01.RUN", "value": true, "expect": false}
]}
```

- **`requestId`** (UUID v4, chữ thường) là **khóa idempotency**: mạng chập chờn, gửi lại cùng `requestId` thì thiết bị trả lại kết quả cũ kèm `"duplicate": true` và **không ghi lần hai**. Luôn tự sinh `requestId` cho mỗi lệnh mới. Thiếu `requestId` thì thiết bị tự cấp (mất idempotency).
- **`expect`** (Tag BOOL): giá trị phải đang bằng `expect`; khác thì `STALE_EXPECTATION` và không ghi gì (tránh hai hệ thống cùng đảo một bit). Hộp "xác nhận" của trang không áp cho máy: `expect` và `requestId` thay cho nó.
- Mọi giới hạn của ghi tay vẫn áp: giới hạn giá trị, `writeMinRole`, trạng thái kết nối PLC, tốc độ ghi mỗi key, audit trước khi gửi.

Trả về kết quả từng lệnh, cùng thứ tự:

```json
{"results": [
  {"requestId": "3f9c1a52-…", "tag": "TANK01.SP", "status": "ACCEPTED", "phase": "queued"},
  {"requestId": "5b2e8c41-…", "tag": "MOTOR01.RUN", "status": "REJECTED", "reason": "ACCESS_DENIED",
   "message": "Key không được ghi Tag này."}
]}
```

`ACCEPTED` là đã vào hàng đợi; kết quả cuối (`CONFIRMED` khi PLC đọc lại đúng, `FAILED` kèm `code`) hỏi bằng `GET /api/v1/data/write?ids=<id>,<id>` hoặc `GET /api/v1/data/write/<requestId>` (giữ 15 phút, chỉ key đã gửi mới thấy). Key chỉ đọc hoặc viewer: `403 FORBIDDEN` cho cả lô.

## 7. Lỗi và giới hạn

| HTTP | Mã | Khi |
| --- | --- | --- |
| 401 | `AUTH_REQUIRED` | không có `Authorization: Bearer matk_…` (token phiên đăng nhập của người không dùng được ở đây) |
| 401 | `APIKEY_INVALID` | key không có (sai, đã thu hồi) |
| 401 | `APIKEY_EXPIRED` | key đã hết hạn |
| 403 | `APIKEY_SOURCE` | địa chỉ gọi không nằm trong "Chỉ cho phép từ" |
| 403 | `HTTPS_REQUIRED` | gọi bằng HTTP thường |
| 403 | `ACCESS_DENIED` | Tag hoặc alarm ngoài quyền của key |
| 403 | `FORBIDDEN` | ghi bằng key chỉ đọc, hoặc Tag cần vai trò cao hơn |
| 429 | `RATE_LIMITED` | quá giới hạn gọi mỗi phút của key; đợi theo `Retry-After` (giây) hoặc `retryAfterMs` |
| 429 | `APIKEY_THROTTLED` | một địa chỉ gửi key sai 20 lần trong một phút: bị chặn đến hết phút |
| 503 | `APIKEY_STORE` | kho key trên thiết bị hỏng: mọi key bị từ chối đến khi quản trị viên lưu lại danh sách |
| 503 | `AUDIT_UNAVAILABLE` | thiết bị chưa ghi được nhật ký, chưa nhận lệnh ghi |

Danh mục đầy đủ: [error-codes.md](error-codes.md). Nên hỏi theo chu kỳ (ví dụ 5–10 s) thay vì liên tục; cần dữ liệu tức thời thì dùng MQTT (mục 8).

## 8. Ví dụ

### Python (requests)

```python
import os, time, uuid, requests

MAT = "https://192.0.2.10:8443"
s = requests.Session()
s.headers["Authorization"] = "Bearer " + os.environ["MAT_KEY"]
s.verify = "device.crt"  # chứng chỉ của thiết bị, không tắt kiểm

values = s.get(f"{MAT}/api/v1/data/values", params={"tags": "TANK01.LEVEL,MOTOR01.RUN"}, timeout=10)
values.raise_for_status()
for v in values.json()["values"]:
    print(v["name"], v["value"], v["quality"])

# Ghi có idempotency: gửi lại cùng requestId khi lỗi mạng, không ghi hai lần
req = {"requestId": str(uuid.uuid4()), "tag": "TANK01.SP", "value": 75.5}
for attempt in range(3):
    try:
        r = s.post(f"{MAT}/api/v1/data/write", json={"requests": [req]}, timeout=10)
        break
    except requests.ConnectionError:
        time.sleep(2)
r.raise_for_status()
print(r.json()["results"][0])
```

### Node-RED

1. Nút **http request**: Method `GET`, URL `https://192.0.2.10:8443/api/v1/data/values?tags=TANK01.LEVEL`, Return "a parsed JSON object", bật **Enable secure (SSL/TLS) connection** và chọn cấu hình TLS có CA là `device.crt` (bật "Verify server certificate").
2. Đặt header bằng nút **change** trước đó: `msg.headers` = `{"Authorization": "Bearer matk_…"}` (lấy key từ biến môi trường của Node-RED, không dán vào flow xuất ra ngoài).
3. Nút **inject** lặp mỗi 10 s → change → http request → **function**:

```js
// msg.payload: {"time": ..., "values": [{name, value, quality, ...}]}
msg.payload = Object.fromEntries(msg.payload.values.map((v) => [v.name, v.value]));
return msg;
```

Ghi: Method `POST`, URL `.../api/v1/data/write`, `msg.headers["Content-Type"] = "application/json"`, `msg.payload = {"requests": [{"requestId": "<uuid mới>", "tag": "TANK01.SP", "value": 75.5}]}` (sinh UUID bằng `crypto.randomUUID()` trong nút function).

### Excel / Power BI

Power Query → **Lấy dữ liệu → Từ web → Nâng cao**: URL `https://192.0.2.10:8443/api/v1/data/history/export.csv?group=bon-nuoc&from=…&to=…&res=1h`, thêm header `Authorization` = `Bearer matk_…`. Máy chạy Power BI phải tin `device.crt` (nhập vào kho chứng chỉ Windows "Trusted Root" của máy đó).

## 9. Đẩy dữ liệu ra broker MQTT

Khi hệ thống của bạn đã có broker MQTT (Mosquitto, EMQX, HiveMQ, AWS IoT…), cho thiết bị **tự đẩy** dữ liệu bằng **nhóm publish** của kênh MQTT ([hướng dẫn kỹ sư, kênh MQTT](engineer-guide.md)): Studio → Kết nối → thêm kênh MQTT tới broker, rồi trong `connections.json` của project:

```json
"publishGroups": [
  {"topic": "nhamay/tram7/bon", "tagPatterns": ["TANK01.*", "TANK02.*"], "intervalMs": 5000,
   "timestamps": true, "qos": 1},
  {"topic": "nhamay/tram7/bom", "tags": ["MOTOR01.RUN", "MOTOR01.SPEED"], "onChange": true}
]
```

| Khóa | Ý nghĩa |
| --- | --- |
| `tags` | danh sách Tag (tối đa 500) |
| `tagPatterns` | mẫu tên Tag, tối đa 16: `*` khớp mọi chuỗi, `?` đúng một ký tự, phân biệt hoa thường. Tag khớp được thêm sau `tags`, theo thứ tự của project. Mẫu không khớp Tag nào: lỗi `E_MQTT_GROUP_PATTERN`. Cần `tags` hoặc `tagPatterns`. |
| `intervalMs` / `onChange` | gửi theo chu kỳ (100 ms đến 1 giờ) và/hoặc khi giá trị hay quality đổi (so mỗi 250 ms) |
| `timestamps` | thêm thời điểm đọc của từng giá trị (`sourceTs`, epoch ms; `null` khi chưa đọc được) |
| `qos`, `retain` | QoS 0/1, giữ tin cuối trên broker |

Tin gửi đi (một JSON mỗi lần):

```json
{"ts": 1793145600000,
 "values": {"TANK01.LEVEL": 42.5, "TANK01.TEMP": null},
 "quality": {"TANK01.LEVEL": "GOOD", "TANK01.TEMP": "BAD"},
 "sourceTs": {"TANK01.LEVEL": 1793145599900, "TANK01.TEMP": null}}
```

Tốc độ gửi của cả kênh bị giới hạn bởi `maxPublishPerS` (mặc định 20 tin/giây). Nhóm publish gửi mọi Tag được liệt kê, không theo phân quyền người dùng: chỉ đưa vào nhóm những Tag được phép ra khỏi nhà máy, và dùng TLS + tài khoản riêng trên broker.

## 10. Khuyến nghị an toàn

- Mỗi hệ thống một key, đặt tên rõ; dùng **Chỉ đọc** trừ khi thật cần ghi.
- Luôn điền **Chỉ cho phép từ** và **Hết hạn**; thu hồi key của hệ thống ngừng dùng.
- Không đặt key trong URL, mã nguồn hay flow Node-RED xuất ra ngoài; dùng biến môi trường hoặc kho bí mật.
- Key bị lộ: thu hồi ngay, xem **Nhật ký** lọc `apikey` và `tag.write` để biết key đã làm gì.
