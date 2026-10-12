# Data model — 002 Vertical slice (schema v0)

Nguồn chuẩn là các file JSON Schema (draft-07) trong `schemas/`. Tài liệu này mô tả ý nghĩa, ràng buộc và quan hệ giữa các thực thể. Khi hai nơi khác nhau, file schema là chuẩn. Mọi tài liệu project đều có `schemaVersion` = `"0.1.0"`. Đây là bản v0 nên MAJOR = 0: theo SemVer mọi thay đổi MINOR ở giai đoạn 0.x đều có thể không tương thích. Runtime chỉ chấp nhận đúng `0.1.x` (ADR-004; quy tắc chấp nhận cụ thể xem [contracts/project-format.md](contracts/project-format.md)).

## Bố cục thư mục project (viết tay)

```text
<project>/
├── project.json            # Project (manifest)
├── tags.json               # TagList
└── screens/
    ├── tank-motor.svg      # SVG đã gắn data-mat-uid
    ├── tank-motor.screen.json
    └── tank-motor.bindings.json
```

## Project — `project.json` (`schemas/project.schema.json`)

| Trường | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `format` | const `"matscada-project"` | ✓ | |
| `schemaVersion` | string SemVer | ✓ | runtime chấp nhận `0.1.x` |
| `projectId` | string | ✓ | `^[a-z0-9][a-z0-9-]{1,47}$` |
| `projectName` | string | ✓ | 1–80 ký tự |
| `projectVersion` | string SemVer | ✓ | |
| `minRuntimeVersion` | string SemVer | ✓ | ≤ phiên bản runtime, ngược lại `E_RUNTIME_TOO_OLD` |
| `entryScreen` | string | ✓ | phải có trong `screens` |
| `screens` | string[] | ✓ | 1–32 phần tử, duy nhất, khớp `^[a-z0-9][a-z0-9-]{0,47}$`; mỗi id ứng với file `screens/<id>.screen.json` |
| `tagFile` | string | ✓ | đường dẫn tương đối an toàn (xem dưới), đuôi `.json`; project mẫu dùng `tags.json` |
| `maxClients` | integer | ✓ | 1–10 (`E_MAX_CLIENTS`); runtime dùng `min(project, config)`. Số nguyên theo JSON Schema: `10.0`, `1e1` hợp lệ |
| `supportedBrowsers` | array | — | v0 chỉ kiểm cú pháp, **chưa dùng**: trang runtime luôn yêu cầu Chrome/Chromium ≥ 120 (`MIN_CHROME` trong `apps/runtime-web/src/main.ts`) bất kể giá trị này |

## TagList — `tags.json` (`schemas/tag.schema.json`)

`{ schemaVersion, tags: TagDefinition[] }`, tối đa 2000 Tag.

| Trường của TagDefinition | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `id` | string | ✓ | `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$`, ≤ 64 ký tự, duy nhất (`E_DUP_TAG`) |
| `type` | enum | ✓ | `BOOL, INT16, UINT16, INT32, UINT32, INT64, UINT64, FLOAT32, FLOAT64, STRING` |
| `description` | string | — | ≤ 200 ký tự |
| `unit` | string | — | ≤ 16 ký tự |
| `min`, `max` | number | — | chỉ với kiểu số; `min < max` (`E_TAG_RANGE`) |
| `source` | object | ✓ | v0: `{ "kind": "mock", "signal": <string> }`. `signal` là khóa mô phỏng của Mock provider (`tank.level`, `motor.run`…); Tag không có tín hiệu tương ứng thì có chất lượng `BAD` |

## Screen — `screens/<id>.screen.json` (`schemas/screen.schema.json`)

| Trường | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `schemaVersion` | SemVer | ✓ | |
| `id` | string | ✓ | trùng tên file và có trong `project.screens` (`E_SCREEN_ID`) |
| `name` | string | ✓ | |
| `svgFile` | string | ✓ | đường dẫn an toàn, đuôi `.svg`, tồn tại (`E_FILE_MISSING`) |
| `viewBox` | [number×4] | ✓ | rộng, cao > 0 |
| `fitMode` | enum | ✓ | `contain`, `cover`, `stretch` |
| `background` | string | — | màu `#rgb`/`#rrggbb` |
| `bindingFile` | string | ✓ | đường dẫn an toàn, đuôi `.json` |
| `elements` | ElementRef[] | ✓ | ≤ 2000 |

**ElementRef**: `{ elementUid, name?, kind? }`
- `elementUid` khớp `^el_[a-z0-9_]{3,40}$` (ADR-003) và duy nhất trong screen (`E_DUP_UID`).
- `kind` là gợi ý hiển thị (`shape`, `group`, `text`).
- Luật chỉ có ở bản TS: mỗi `elementUid` phải có phần tử mang `data-mat-uid` tương ứng trong SVG (`W_UID_NOT_IN_SVG`, mức cảnh báo, chặn lưu ở Studio).

## BindingSet — `screens/<id>.bindings.json` (`schemas/binding.schema.json`)

`{ schemaVersion, screenId, elements: ElementBindings[] }`, với `screenId` trùng screen (`E_SCREEN_ID`).

**ElementBindings**: `{ elementUid, bindings: Binding[] }`
- `elementUid` phải có trong `screen.elements` (`E_REF_UID`).
- `elementUid` không được lặp giữa các mục (`E_DUP_UID`).

**Binding**

| Trường | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|
| `id` | string | ✓ | duy nhất trong screen (`E_DUP_BINDING`) |
| `target` | enum | ✓ | v0 hỗ trợ `style.fill, style.stroke, style.opacity, style.visibility, text.content, transform.rotate, geometry.levelPercent`. Đích khác thuộc allowlist §8.2 nhưng chưa hỗ trợ → `E_TARGET_UNSUPPORTED`; đích ngoài allowlist → lỗi schema |
| `source` | object | ✓ | `{ "type": "tag", "tagId" }`; Tag phải tồn tại (`E_REF_TAG`) |
| `transform` | Transform | ✓ | xem dưới |
| `onBadQuality` | object | — | `{ mode: "hold" \| "override", value? }`. `value` không bắt buộc: `override` thiếu `value` thì dùng giá trị trung tính theo đích. Không có `onBadQuality`: cũng là `override` với giá trị trung tính (fill/stroke `#8d99a3`, opacity 0.5, text `"--"`, rotate dừng, level giữ) |
| `animation` | enum | — | chỉ với `transform.rotate`: `"spin"` |
| `direction` | enum | — | chỉ với `geometry.levelPercent`: `up` (mặc định), `down`, `left`, `right` |
| `format` | object | — | chỉ với `text.content`: `{ decimals: 0–6, suffix? }` |

**Transform** (`kind`):
- `direct`: giá trị đi thẳng tới đích. Kiểu phải phù hợp đích (`E_TYPE_MISMATCH`), ví dụ `geometry.levelPercent` cần Tag số.
- `discreteMap`: `{ cases: [{ equals: bool|number|string, value }], default? }`, 1–64 case. Kiểu của `equals` phải khớp kiểu Tag (`E_TYPE_MISMATCH`). Không case nào khớp và không có `default` thì xử lý như chất lượng xấu.
- `linearScale`: `{ inMin, inMax, outMin, outMax, clamp: true }`, với `inMin ≠ inMax` (`E_SCALE_RANGE`). Chỉ dùng cho Tag số (`E_TYPE_MISMATCH`).
- Các kiểu khác của §8.2 (`rangeMap`, `format`, `expression`) → `E_TRANSFORM_UNSUPPORTED`.

**Ngữ nghĩa giá trị theo đích:**
- `style.fill`/`stroke`: chuỗi màu `#rgb`/`#rrggbb` hoặc tên CSS cơ bản; chuỗi chứa `url(` bị chặn.
- `style.opacity`: 0–1.
- `style.visibility`: BOOL hoặc `visible`/`hidden`.
- `text.content`: chuỗi hoặc số đã định dạng.
- `transform.rotate`: độ (tĩnh); với `spin` là rpm (> 0 thì quay) hoặc BOOL.
- `geometry.levelPercent`: 0–100, kẹp về biên.

## Đường dẫn an toàn (áp dụng cho `tagFile`, `svgFile`, `bindingFile`)

Là đường dẫn tương đối dùng `/`, không có `..`, không bắt đầu bằng `/` hay ký tự ổ đĩa, không có `\`, `:`, ký tự điều khiển; dài ≤ 128 byte UTF-8; sau khi chuẩn hóa vẫn nằm trong thư mục project. Vi phạm → `E_PATH`. Tên file so **đúng chữ hoa/thường** như ext4 trên thiết bị, kể cả khi kiểm trên Windows: `screens/Main.svg` không trỏ tới `main.svg` (`E_FILE_MISSING`).

Mỗi màn hình gắn tối đa **1000** Tag khác nhau (`E_SCREEN_TAGS`): trang runtime đăng ký mọi Tag của màn hình trong một `subscribe` ([contracts/live-ws.md](contracts/live-ws.md)).

## Thực thể lúc chạy (không lưu file)

### TagValue (máy chủ ↔ client)

| Trường | Ghi chú |
|---|---|
| `id` | |
| `value` | BOOL → `true/false`; số → number; INT64/UINT64 → chuỗi thập phân; null khi chưa có |
| `quality` | `GOOD`, `BAD`, `UNCERTAIN`, `STALE` (STALE chỉ do client đặt khi mất kết nối) |
| `sourceTimestamp`, `serverTimestamp` | epoch ms UTC |
| `revision` | tăng mỗi lần giá trị hoặc chất lượng đổi |

### LiveSession (máy chủ)

`sid`, `origin`, `acceptedAt`, `lastRxAt`, `subscription { requestId, tagIndexes[] }`, `sequence`, `SendQueue { bytes, maxBytes = 262144, overflowed }`.

Trạng thái:

```text
CONNECTING --(Origin sai)--> REJECTED_ORIGIN (HTTP 403, không chiếm slot)
CONNECTING --(đủ slot)--> REJECTED_FULL (error MAX_CLIENTS_REACHED + close 4429, rejectedTotal)
CONNECTING --> OPEN (hello) --subscribe--> SUBSCRIBED --subscribe--> SUBSCRIBED (thay thế, snapshot mới)
OPEN/SUBSCRIBED --(im > 15 s)--> CLOSING 4408 (timeoutClosedTotal, slot trả ngay)
SUBSCRIBED --(hàng đợi > 256 KB)--> CLOSING 4409 (sau resync_required, overflowClosedTotal, slot trả ngay)
OPEN/SUBSCRIBED --(20 lỗi giao thức liên tiếp)--> CLOSING 1008
OPEN/SUBSCRIBED --(header frame > 96 KiB)--> CLOSED (CivetWeb gửi close 1009 rồi đóng ngay)
CLOSING / REJECTED_FULL --(client đóng)--> CLOSED
CLOSING / REJECTED_FULL --(client không đóng trong 5 s kể từ close frame)--> CLOSED (cắt TCP)
OPEN/SUBSCRIBED --(ghi bị chặn > 10 s hoặc ghi thiếu)--> CLOSED (cắt TCP ngay, không mã đóng, writeFailedTotal, slot trả ngay)
* --(client đóng / TCP đứt)--> CLOSED (giải phóng slot ngay)
```

### LiveConnection (client, `@mat/live-client`)

Trạng thái `ConnState` thật: `idle | connecting | open | live | offline | full | incompatible | stopped`.

```text
idle --start()--> connecting --(socket mở)--> open (gửi subscribe ngay, không chờ hello)
open --(snapshot của đăng ký hiện tại)--> live
live --(sequence nhảy)--> live: bỏ delta đó (không áp giá trị), gửi lại subscribe (requestId mới),
                         bỏ delta của đăng ký cũ, áp snapshot mới khi tới
* --(close 4429 hoặc error MAX_CLIENTS_REACHED)--> full (đếm ngược 30 s | "Thử lại ngay") → connecting
* --(close khác / mất mạng / máy chủ im > 15 s: client tự đóng 4001)--> offline (Tag STALE;
                         backoff 1→30 s + jitter; 1008/1009 ghi lỗi console) → connecting
open/live --(hello có protocolVersion MAJOR khác)--> incompatible (dừng, không thử lại)
* --stop()--> stopped
```

Khi gặp sequence nhảy, client 1.0.0 gửi lại `subscribe` (máy chủ thay thế và gửi snapshot) thay vì đóng 4000 như Sprint 0. Bớt được một lần kết nối và slot không bị giải phóng giữa chừng.

### DeviceConnection (Studio, cục bộ)

`{ host, port = 8080 }` lưu ở `localStorage` của Studio. URL web là `http://host:port/`.

### RuntimeConfig (`/etc/mat-runtime/runtime.json`)

Xem [contracts/runtime-config.md](contracts/runtime-config.md).
