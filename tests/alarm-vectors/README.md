# Bộ vector động cơ alarm (`tests/alarm-vectors/`)

Dùng chung cho hai bản cài đặt: C++ (`core/alarm/`) và TypeScript (`packages/alarm-engine/`). Cả hai phải cho **cùng chuỗi sự kiện** trên 100 % ca (FR-016, SC-004). Định dạng gốc: [alarm-engine.md §14](../../specs/009-alarms/contracts/alarm-engine.md); danh sách nhóm: §15.

Kỳ vọng được **suy luận từ contract và spec** (không sinh bằng cách chạy động cơ). Khi động cơ và vector lệch nhau, phân xử từng ca theo contract/spec rồi sửa bên sai (ghi trong `specs/009-alarms/tasks.md`, ghi chú T013).

## File

| File | Nội dung |
|---|---|
| `digital.json` … `order.json` | 16 nhóm, 99 ca (98 ca của §15 + `shelve-survives-restart`) |
| `fold.json` | 50 cặp `foldText(in) = out` |
| `fold-table.json` | 134 cặp điểm mã NFC → chữ Latin cơ sở (alarm-store.md §7) |
| `fingerprint.json` | FNV-1a 64 (`raw`: chuỗi → hex) và dấu vân tay từng loại điều kiện (`def` → chuỗi chuẩn → hex) |
| `round-table.json` | 1.006 bộ ba `(v, n, out)` cho `{value:N}` (oracle: số học thập phân BigInt) |
| `MANIFEST.json` | sha256 từng file (kiểm ở `vectors.test.ts`) |

## Ca vector

`{ name, group, description, options, classes, areas, tags, devices, alarms, timeline, end, expect, strict?, expectView? }`.

- `options`: `tickMs`, `chatterWindowS`, `chatterShelveS`, `epoch0`, `clockOkFrom` (ngưỡng `clockOk`: `epochMs ≥ clockOkFrom`). `maxShelved` mặc định 50.
- `classes`: lớp đã đủ trường (không dựa vào mặc định); `alarms`/`areas` đúng định dạng `alarms.json` 0.5.
- `tags`: thông tin tĩnh từng Tag (`unit`, `labels`, `isBool`). Tag dùng trong `alarms` mà không khai ở đây coi như `{}`.
- Giá trị Tag trong `timeline`: số, hoặc chuỗi `"NaN"`, `"Infinity"`, `"-Infinity"` (JSON không có các số này).
- Mẫu ban đầu của mọi Tag: `known = false`, `quality = BAD`, `reason = "NO_DATA"`.
- `timeline`: các mục cùng `t` được áp theo thứ tự mảng (tags trước hay action trước là do thứ tự trong mảng); mục không sắp theo `t` vẫn hợp lệ, bộ chạy gom theo `t`.
- Bộ chạy gọi `load` một lần ở `t = 0` (`processStart = true`, mono 0, epoch `epoch0`), rồi `step` ở mọi `t` là bội của `tickMs` từ 0 tới `end`.

### Action (phần bổ sung so với §14, đều tùy chọn và cộng thêm)

Ngoài `ack`, `ackAll`, `shelve`, `unshelve`, `disable`, `enable`, `reload`, `commit`, `restart` của §14:

- `clock` `{ epoch0 }`: từ mục này `nowEpochMs = epoch0 + t` (mô phỏng giờ treo tường nhảy; đồng hồ đơn điệu không đổi).
- `restart` thêm: `alarms`, `classes`, `areas`, `tags`, `devices` (định nghĩa mới có hiệu lực từ lần khởi động này: project đổi trong lúc tắt máy), `rows` (mảng hàng `alarm_occurrence` đầy đủ, nạp thẳng vào mô hình store trước khi `load`; mô phỏng store có sẵn dữ liệu), `clock: "bad"` (từ đây `nowEpochMs = t`, tức năm 1970, dưới ngưỡng `clockOkFrom`). `restart` **đặt lại mọi mẫu Tag về chưa có giá trị** (TagStore mới): ai cần giá trị phải có mục `tags` đặt SAU `restart` trong mảng.
- `reload` `{ alarms, classes?, areas?, tags? }`: `load` với `processStart = false` trên cùng động cơ; thiếu `classes`/`areas` thì giữ cái cũ.
- `ackAll` `{ filter?, upToRevision?, user }`: bộ chạy gọi `previewAck` trên `view()` của tick trước rồi `submit` một lệnh `ack` cho từng cặp, theo thứ tự `items` của view (thứ tự instance).

### Mô hình store của bộ chạy

Mọi sự kiện có `row` ghi đè hàng cùng `id` (bản mới nhất thắng); sự kiện `shelve`/`disable` ghi `override`, `unshelve`/`enable` (`override: null`) xóa. `commit` chụp ảnh các hàng và override hiện có. `restart` với `persist = "committed"` dùng ảnh gần nhất, `"all"` dùng tất cả (cộng `rows`). `open` = các hàng `closed = 0` theo `id` tăng; `overrides` sắp theo `(alarmId, kind)`; `nextOccurrence = max(id) + 1` trong store (1 nếu rỗng).

### Kỳ vọng

- `expect`: danh sách đầy đủ, có thứ tự (§14). Mỗi phần tử so các trường nêu: `t`, `instance`, `kind` (mặc định `state`), `from`, `to`, `occurrence`, `closedBy`, `text`, `result`, `flags`, `count`, `value`, `reason`; **thêm** `tEpoch`, `clockOk` (của sự kiện) và `row` (so từng trường nêu của `OccurrenceRow`).
- `strict: false`: bỏ qua sự kiện có `kind` không xuất hiện ở bất kỳ phần tử `expect` nào. Các ca có `load`/`restart`/`reload` đều dùng `strict: false` (động cơ phát thêm `resync`).
- `expectView`: `[{ t, counts?, items? }]` so `view()` **sau** `step` ở `t`. `counts` so từng khóa nêu; `items` là bản đồ `id instance → mảng trường AlarmItem` so từng trường nêu (so sâu từng phần với đối tượng, ví dụ `shelve`).

### `OccurrenceRow` (JSON, camelCase, phản chiếu cột `alarm_occurrence`)

`id, alarmId, fingerprint, tsActiveMs, clockOk (0|1), tsAckMs?, ackUser?, tsReturnMs?, tsReturnAckMs?, returnAckUser?, priority (1..4), class, area?, text, textFold, valueActive?, qualityActive, reason?, flags (0..3), repeatCount, closed (0|1), closedBy?`. Cột NULL thì **vắng** khóa. `OverrideRow`: `alarmId, kind ("shelve"|"disable"), user, reason, system (0|1), tsStartMs, clockOk (0|1), tsEndMs?`.

## Quyết định cho chỗ contract chưa nói rõ (cả hai bản MUST theo)

1. **Thứ tự sự kiện của một lệnh:** `command`; sự kiện riêng của lệnh (`shelve`, `unshelve`, `disable`, `enable`); rồi hệ quả (`chatter` tổng kết, `state`). Một tick: lệnh (theo thứ tự submit) → hết hạn shelve (theo chỉ số instance) → đánh giá (theo chỉ số instance).
2. **Tự cách ly:** sự kiện theo thứ tự `state` (lần bật là hàng tổng kết), `shelve` (`reason = "chatter"`), `chatter { count = số mốc trong vòng }` (kèm `row.repeatCount` = count).
3. **`RTN_UNACK` bật lại** = HAI sự kiện `state` cùng tick: `RTN_UNACK → NORMAL` (`occurrence` cũ, `closedBy = return`) rồi `NORMAL → ACTIVE_UNACK` (`occurrence` mới). Lý do: mỗi sự kiện mang một `row`; hàng cũ phải được đóng.
4. **Lần "bóng"** (đang tự cách ly): `occurrence = 0`, chỉ `state`; lần bật bóng không đưa mốc vào vòng (vòng đóng băng ở `chatterLimit` mốc tại lúc cách ly), `ghostCount++`. Hết đợt (hết hạn hoặc unshelve): `unshelve` (lý do `chatter-end` khi tự hết hạn của shelve hệ thống, `expired` khi shelve người dùng hết hạn, `user` khi người dùng gỡ), rồi `chatter { count = vòng + ghostCount }` (`row.repeatCount` = count, `row.id` = hàng tổng kết), rồi nếu lúc đó `cond` còn true và instance là lần bóng: `state` từ trạng thái bóng sang trạng thái lần thật mới (có thể trùng `from`/`to`), `occurrence` = mã mới. Giá trị lúc gỡ lấy từ mẫu Tag của chính tick đó (lệnh/hết hạn xử lý trước đánh giá). `chatter` cuối đợt luôn được phát khi gỡ shelve hệ thống.
5. **Disable instance đang shelved:** thêm `unshelve` (`reason = "disabled"`) sau `disable`, trước `state` đóng (không có vector).
6. **`revision`:** tăng 1 cho mỗi sự kiện loại `state`, `shelve`, `unshelve`, `disable`, `enable`, `removed`, `chatter`, và 1 khi cờ `inputBad` của một instance đổi (không có sự kiện đi kèm). `command` và `resync` không tăng. Động cơ mới (`restart`) bắt đầu từ 0; `reload` giữ bộ đếm. `item.rev` = `revision` của lần tăng cuối ảnh hưởng instance. Lúc `load`, `inputBad` ban đầu của mọi instance là `false`.
7. **`counts`** (chỉ tính instance không shelved): `active` = trạng thái ≠ `NORMAL`; `unacked` = `ACTIVE_UNACK` + `RTN_UNACK`; `rtnUnack` = `RTN_UNACK`; `shelved` = số instance shelved; `disabled` = số instance disabled. `AlarmView.items` chỉ chứa instance có trạng thái ≠ `NORMAL` hoặc shelved hoặc disabled.
8. **`load`:** sự kiện theo thứ tự: (a) override hết hạn (`unshelve`, lý do `expired`) theo thứ tự `overrides`; (b) hàng mở theo `id` tăng: hàng bị đóng sinh `state` (`from` = trạng thái suy từ cột, `to = NORMAL`, `occurrence` = mã hàng, `closedBy`); instance không còn trong `defs` thì sự kiện là `removed` (cùng trường); (c) cuối cùng một sự kiện `resync` (`instance = ""`), **luôn** (cả `reload`). Khi thay project (`processStart = false`) xử lý theo thứ tự instance CŨ: mất hoặc đổi dấu vân tay → đóng `config`; khớp → quy tắc đổi lớp (`ACTIVE_UNACK → ACTIVE_ACK`; `RTN_UNACK → NORMAL`, `closedBy = return`). Hàng mở khi `processStart = false` không dùng (trạng thái nằm sẵn trong RAM).
9. **Alarm `quality` theo thiết bị:** nếu BẤT KỲ Tag của thiết bị còn `known = false` thì giữ nguyên (như alarm `quality` theo Tag).
10. **Cờ `startup`:** `pendingSinceMono` được đặt ở lần đánh giá hợp lệ đầu tiên (instance chưa từng được đánh giá hợp lệ kể từ `load` với `processStart = true`) thì lần bật sinh ra có `startup`; lần bật do `enable` hay `reload` không có cờ.
11. **Nội dung:** `{tag}` = id Tag, với alarm theo thiết bị = id thiết bị (contract §11 viết mâu thuẫn, chọn vế sau); nhãn (`labels`, BOOL `Bật`/`Tắt`) áp cho `{value}` và `{value:N}`, KHÔNG áp cho `{limit}`; thẻ lạ giữ nguyên chữ; cặp ngoặc rỗng xóa một lượt (không lặp). `row.textFold = foldText(text + " " + alarmId + " " + tên khu vực)`, không khu vực thì "Chung".
12. **`foldText`:** không chuẩn hóa NFC/NFD. Chỉ: bỏ dấu kết hợp U+0300..U+036F có mặt trong chuỗi, đổi điểm mã trong `fold-table.json`, hạ `A-Z`; mọi ký tự khác (kể cả `Ç`, `Ü`) giữ nguyên.
13. **`shortestDouble`:** chuỗi thập phân ngắn nhất khứ hồi, không có `e`; `-0` thành `0`.
14. **Ack lần xảy ra đã hết (`RTN_UNACK`) chưa từng ack:** đặt cả `tsAckMs`/`ackUser` và `tsReturnAckMs`/`returnAckUser` bằng nhau.
