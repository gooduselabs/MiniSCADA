# Contract: động cơ alarm (ngữ nghĩa, API, định dạng vector)

**Feature**: [spec.md](../spec.md) FR-015…FR-036, FR-094 · **Data model**: [data-model.md](../data-model.md) §4, §5 · **Store**: [alarm-store.md](alarm-store.md) · **ADR**: [015](../../../docs/adr/015-expression-language.md) (làm tròn)

Hai bản cài đặt cùng ngữ nghĩa: C++ (`core/alarm/alarm_engine.{hpp,cpp}`, `alarm_text.{hpp,cpp}`, `alarm_defs.{hpp,cpp}`, `alarm_types.hpp`) cho thiết bị và TS (`packages/alarm-engine/src/{types,engine,text,vectors}.ts`, `@mat/alarm-engine` 0.1.0) cho Studio. Cả hai chạy cùng `tests/alarm-vectors/*.json` (≥ 60 ca, mục tiêu 98) và phải cho **cùng chuỗi sự kiện**, cùng thời điểm ảo, cùng nội dung chèn (SC-004). Mọi chỗ dưới đây nói "động cơ" áp cho cả hai.

## 1. Nguyên tắc

- **Thuần:** không I/O, không mạng, không ghi đĩa, không đọc đồng hồ; thời gian là tham số (`nowMonoMs`, `nowEpochMs`).
- **Một luồng:** `step` và `load` chạy trên luồng tick, sau `TagEngine::step`, trước `hub.tick()` (`server/runtime_engine.cpp`, `server/main.cpp`). Lệnh của luồng khác đi qua hộp thư (§7).
- **Tất định:** cùng định nghĩa, cùng chuỗi `(nowMonoMs, nowEpochMs, tags, lệnh)` cho cùng chuỗi sự kiện; không phụ thuộc thứ tự băm, địa chỉ, hay số luồng.
- **Không cấp phát trong đường nóng** khi không có thay đổi (FR-021): mảng `Instance` cấp phát ở `load`; cấp phát chỉ xảy ra ở lần bật (chuỗi nội dung) và khi dựng `AlarmView`.
- **Đồng hồ đơn điệu** cho trễ, hết hạn shelve, cửa sổ chập chờn; **giờ treo tường** chỉ để ghi lần xảy ra (`ts_active_ms`…) và hạn shelve bền (FR-024, FR-033).

## 2. Đầu vào và kiểu dữ liệu

**`TagSample`** (một phần tử cho mỗi Tag mà động cơ theo dõi; thứ tự theo `watchedTags()`):

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `known` | bool | `false` nếu Tag chưa từng có giá trị (revision 0): xem §6 |
| `value` | số (double) | BOOL: 0 hoặc 1; INT, FLOAT: giá trị; Tag STRING không có `value` (chỉ `quality`) |
| `quality` | `GOOD` \| `UNCERTAIN` \| `BAD` | của `TagStore` |
| `reason` | chuỗi | mã lý do 006 (rỗng khi GOOD) |

**Thông tin tĩnh của Tag** (`AlarmTagInfo`, đưa vào lúc `load`): `unit` (chuỗi), `labels` (bảng giá trị của Tag: khóa số → nhãn, tùy chọn), `isBool`.

**`AlarmDefs`** (kết quả `compileAlarms(project)`): danh sách instance đã bung theo thứ tự cố định: theo thứ tự `alarms` của file, và trong alarm `limit` theo thứ tự `HH`, `H`, `L`, `LL`; cùng `classes`, `areas`, `tagIds` (Tag theo dõi, khử trùng, theo thứ tự xuất hiện đầu tiên), `deviceTags` (với mỗi `device`: danh sách chỉ số vào `tagIds`).

**Dấu vân tay điều kiện** (`fingerprint`): FNV-1a 64 bit trên chuỗi UTF-8 `kind|target|limit|threshold|trigger|on`, với:

- `kind` ∈ `digital`, `limit`, `quality`;
- `target` = id Tag hoặc `device:<id>`;
- `limit` = `HH`, `H`, `L`, `LL` hoặc rỗng; `threshold` = biểu diễn ngắn nhất khứ hồi của số (xem §11), rỗng nếu không có;
- `trigger` = `1`, `0` hoặc rỗng; `on` = `bad`, `notGood` hoặc rỗng;
- viết thành 16 ký tự hex thường.

Không có trong dấu vân tay: lớp, khu vực, nội dung, trễ, `deadband`, tên (đổi những thứ này không đóng lần xảy ra, FR-023).

**Sự kiện** (`AlarmEvent`): đầu ra của `step`/`load`, theo thứ tự phát sinh:

| Trường | Ý nghĩa |
|---|---|
| `kind` | `state`, `shelve`, `unshelve`, `disable`, `enable`, `chatter`, `command` (kết quả lệnh), `removed` (instance bị xóa khỏi project), `resync` |
| `tMono`, `tEpoch`, `clockOk` | thời điểm động cơ (tick đang chạy) |
| `instance` | id instance |
| `from`, `to` | trạng thái trước và sau (`NORMAL`, `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK`) |
| `occurrence` | mã lần xảy ra (0 = không có hoặc "bóng") |
| `closedBy` | `return`, `config`, `disabled`, `restart-lost` khi sự kiện đóng lần xảy ra |
| `text`, `value`, `quality`, `reason`, `flags` | khi bật (lần xảy ra mới) |
| `result` | với `command`: `ACKED`, `ALREADY_ACKED`, `NOT_ACTIVE`, `STALE`, `SHELVED`, `NOT_FOUND`, `OK`, `NOT_SHELVED`, `ALREADY_DISABLED`, `NOT_DISABLED`, `SHELVE_RANGE` |
| `revision` | revision toàn cục sau sự kiện |
| `row` | bản đầy đủ hàng `alarm_occurrence` sau sự kiện (cho hàng đợi ghi) |

## 3. Thứ tự xử lý trong một tick (tất định)

`step(nowMonoMs, nowEpochMs, tags)` thực hiện đúng thứ tự:

1. **Lệnh:** rút hộp thư; xử lý từng lệnh theo thứ tự đến (`ack`, `shelve`, `unshelve`, `disable`, `enable`). Mỗi lệnh sinh một sự kiện `command` và, nếu đổi trạng thái, sự kiện tương ứng.
2. **Hết hạn shelve:** duyệt instance theo thứ tự chỉ số; shelve có `untilMono ≤ nowMonoMs` được gỡ (sự kiện `unshelve`, lý do `expired` hoặc `chatter-end`).
3. **Đánh giá:** duyệt instance theo thứ tự chỉ số tăng dần (thứ tự của `AlarmDefs`): tính `rawCond`, xử lý trễ, chuyển trạng thái, chập chờn.
4. **Công bố:** nếu có sự kiện, dựng `AlarmView` mới, tăng `revision` (mỗi sự kiện đổi dữ liệu tăng 1; các sự kiện trong một tick có revision tăng dần theo thứ tự phát sinh).

Hệ quả: lệnh đến cùng tick với thay đổi điều kiện được xử lý **trước** đánh giá (ví dụ ack và điều kiện hết cùng tick: ack thấy AU rồi mới `off` đưa AA về N). Hai instance cùng đổi trong một tick: sự kiện theo chỉ số instance.

## 4. Đánh giá từng loại

Mỗi instance (không `disabled`, định nghĩa `enabled`) tính `rawCond` từ mẫu hiện tại, rồi xử lý trễ (§5) thành `cond`.

**`digital`:** `truthy = value ≠ 0` (BOOL: 1 là đúng; INT: khác 0 là đúng); `rawCond = (truthy == trigger)`. Không dùng hysteresis.

**`limit`:** hysteresis Schmitt trên `rawCond` đã nhớ (xem §5): với ngưỡng `HH`, `H` (cao): nếu `rawCond` đang `false` thì `rawCond = value ≥ threshold`; nếu đang `true` thì `rawCond = !(value < threshold − deadband)`. Với `L`, `LL` (thấp): `false → value ≤ threshold`; `true → !(value > threshold + deadband)`. `deadband` = 0: thành so sánh đơn giản (`≥` bật, `<` tắt cho ngưỡng cao).

**`quality` theo Tag:** `rawCond = P(quality)` với `P` = (`on` = `bad`: `quality == BAD`; `on` = `notGood`: `quality ≠ GOOD`).

**`quality` theo thiết bị:** `deviceTags` có ít nhất một Tag và `rawCond = tất cả Tag trong deviceTags thỏa P`; không có Tag nào thì `rawCond` luôn `false` (cảnh báo `W_ALARM_DEVICE_EMPTY` ở validator). `reason` của lần xảy ra = `reason` không rỗng đầu tiên theo thứ tự `deviceTags`; rỗng nếu không có.

Quality `UNCERTAIN` được đánh giá như `GOOD` ở `digital`, `limit` (D16); ở `quality` chỉ tính theo `on`.

## 5. Hysteresis và trễ

**Trạng thái trên mỗi instance:** `rawCond` (kết quả hysteresis, nhớ giữa các tick), `cond` (đã qua trễ, quyết định "đang có"), `pendingSinceMono`.

Mỗi tick, sau khi tính `rawCond`:

- `rawCond == cond`: `pendingSinceMono = -1`.
- `rawCond ≠ cond`:
  - nếu `pendingSinceMono < 0`: đặt `pendingSinceMono = nowMonoMs`;
  - `delay = rawCond ? onDelayMs : offDelayMs`; nếu `nowMonoMs − pendingSinceMono ≥ delay` thì **chốt**: `cond = rawCond`, `pendingSinceMono = -1`, kích hoạt sự kiện `on` (cond lên true) hoặc `off` (cond xuống false).

Hệ quả (FR-018): điều kiện sai trước hạn đặt lại bộ đếm (`rawCond` về bằng `cond` thì `pendingSinceMono = -1`, không có lần xảy ra); `delay` = 0 chốt ngay trong tick đầu tiên thấy `rawCond ≠ cond`. Độ phân giải thực là một chu kỳ tick: trễ thực = `delay` đến `delay + tick`.

Vì hysteresis nằm trên `rawCond`, giá trị dao động trong vùng deadband không bao giờ đặt lại bộ đếm trễ (vector `deadband-schmitt-no-timer-reset`).

**Giữ nguyên khi đầu vào xấu** (xem §6): bước đánh giá không chạy; `rawCond`, `cond` giữ; `pendingSinceMono` bị đặt về −1 (trở lại GOOD thì bộ đếm bắt đầu lại, FR-019).

## 6. Quality BAD, giá trị không hữu hạn, Tag chưa có giá trị

`inputBad` (cờ hiển thị trên instance và item live) của `digital`, `limit` là `quality == BAD` **hoặc** (Tag số và `value` là NaN hay vô cực). Khi `inputBad`:

- không đánh giá, không đổi `cond`, `state`; `pendingSinceMono = -1`; `rawCond` giữ;
- các sự kiện `state` không phát; chỉ `revision` tăng nếu cờ `inputBad` đổi (để `changed` có trong delta);
- khi hết `inputBad`: đánh giá bình thường từ giá trị mới, với `rawCond` đã nhớ làm trạng thái trước của hysteresis.

Alarm `quality` không có `inputBad` (nó **là** nơi báo xấu).

**Tag `known = false`** (chưa từng có giá trị tin cậy): với `digital`, `limit` coi như `inputBad`; với `quality`: bộ đánh giá giữ nguyên (không bật, không hết) cho tới khi `known = true`, để khởi động không sinh bão alarm mất tín hiệu trước khi lần đọc đầu tiên xong. Quyết định (người dùng giao toàn quyền 2026-10-11); xem Điểm cần sửa spec 3.

## 7. Máy trạng thái ISA, lệnh, kết quả

Bảng chuyển đầy đủ: [data-model.md §5](../data-model.md). Dưới đây là định nghĩa thao tác.

**Bật (`on`):** cấp mã lần xảy ra mới (tăng dần; cấp mã: [alarm-store.md §3](alarm-store.md)), chụp `value`, `quality`, `reason`, `flags` (`startup` §9, `inputBad` lúc bật = 0), định dạng `text` (§11), lấy `priority`, `class`, `area` hiện hành. Trạng thái: R → `ACTIVE_UNACK`; không R → `ACTIVE_ACK`. Mỗi lần bật ghi vào vòng chập chờn (§8).

**Hết (`off`):** `ts_return` = `nowEpochMs`. `ACTIVE_UNACK` → `RTN_UNACK` (giữ hàng mở); `ACTIVE_ACK` → `RTN_UNACK` nếu AR, ngược lại `NORMAL` và đóng hàng (`closedBy = return`).

**Ack:** lệnh `{ id, occurrence }`. Kết quả theo thứ tự: `NOT_FOUND` → mã không khớp: `NOT_ACTIVE` nếu trạng thái `NORMAL`, ngược lại `STALE` → `SHELVED` → trạng thái: `NORMAL` `NOT_ACTIVE`, `ACTIVE_ACK` `ALREADY_ACKED`, `ACTIVE_UNACK` → `ACKED` (đưa AA; `ts_ack`, `ack_user`), `RTN_UNACK` → `ACKED` (đưa `NORMAL`, đóng hàng, `ts_return_ack`, `return_ack_user`; nếu `ts_ack` còn rỗng thì đặt cùng giá trị). `ack_user` là `user` của lệnh.

**Ack hàng loạt:** API tính trước tập `(id, occurrence)` bằng `previewAck` (chạy trên `AlarmView`) rồi gửi một lệnh `ack` cho từng cặp; mỗi cặp được kiểm lại ở bước 1 của tick. Bộ lọc của `all` gồm `area`, `class`, `priority` ("từ mức này trở lên"), `state` (`unack` = `ACTIVE_UNACK`, `rtn` = `RTN_UNACK`), `q`; chỉ lấy instance không shelved và có `rev ≤ upToRevision`.

**Shelve:** lệnh `{ id, reason, durationS, user, system }`. `durationS` ngoài 60 đến 28.800, `reason` rỗng hoặc > 120 ký tự, hoặc đã có 50 instance shelved (không tính instance đang shelved sẵn; **không tính** tự cách ly do chập chờn, D47): `SHELVE_RANGE`. Còn lại đặt `shelve = { untilMono = nowMono + durationS×1000, untilEpoch = nowEpoch + durationS×1000, clockOk }`; lệnh lần hai thay thời hạn. Instance shelved vẫn được đánh giá và vẫn có sự kiện `state` (FR-031); không đổi trạng thái ISA.

**Unshelve (người dùng hoặc hết hạn):** gỡ `shelve`; xóa vòng chập chờn và `ghostCount` (sau khi ghi tổng kết nếu có, §8). Nếu `ACTIVE_ACK` và R và `cond` còn `true`: `ACTIVE_UNACK` (cùng mã) và sự kiện `state`. Nếu đang trong đợt tự cách ly với `ghostCount` > 0 và `cond` `true` mà không có hàng mở: mở lần xảy ra mới (§8).

**Disable:** lệnh `{ id, reason, user }`: `disabled = true`; nếu có lần xảy ra mở thì đóng (`closedBy = disabled`, `ts_return` rỗng), instance về `NORMAL`; `rawCond`, `cond`, `pendingSinceMono`, `shelve` xóa; không đánh giá cho tới `enable`. **Enable:** `disabled = false`, instance đánh giá từ đầu (như mới nạp, không cờ `startup`).

**Hộp thư lệnh:** hàng đợi có khóa (chỉ giữ khóa khi hoán đổi vector); `submit(Command, onResult)` trả ngay; `onResult` chạy trên luồng tick ở cuối `step` (API chuyển thành promise, chờ ≤ 2 s). Lệnh ở hộp thư khi `load` chạy (đổi project) bị trả kết quả `NOT_FOUND`.

## 8. Chập chờn (tự cách ly)

Mỗi instance có `chatterRing` (≤ `chatterLimit` mốc đơn điệu) và `ghostCount`. `chatterLimit` lấy từ lớp **hiện hành**; 0 tắt.

Khi **bật** (`on`) tại `nowMonoMs`:

1. loại khỏi vòng các mốc cũ hơn `nowMonoMs − chatterWindowS×1000` (mặc định 60 s), thêm `nowMonoMs`;
2. nếu `chatterLimit > 0`, vòng có ≥ `chatterLimit` mốc, và instance chưa shelved: **tự cách ly** (`system = true`, `user = system`, `reason = chatter`, `durationS = chatterShelveS` = 1800): sự kiện `shelve` và `chatter { count }`; lần xảy ra vừa mở là hàng tổng kết (`repeat_count` = số mốc trong vòng).

Trong đợt tự cách ly (`shelve.system`): đánh giá vẫn chạy và `state` vẫn chuyển, nhưng

- lần **bật** tiếp theo không mở hàng: `occurrence = 0` ("bóng", không có ghi `alarm.db`), `ghostCount++`; trạng thái ISA vẫn chuyển (`ACTIVE_UNACK` hay `ACTIVE_ACK` tùy R) và vì shelved nên không hiện ở banner, tiếng, đếm;
- lần **hết** của lần bóng chuyển trạng thái, không ghi hàng;
- hàng tổng kết đóng bình thường ở lần hết đầu tiên.

Khi đợt tự cách ly kết thúc (hết hạn hoặc người dùng unshelve): ghi `repeat_count` = vòng + `ghostCount` vào hàng tổng kết (một lần cập nhật hàng đợi ghi), phát `chatter { count }` cho audit `alarm.unshelve` (`system`); nếu lúc đó `cond` `true` và instance đang là lần bóng: mở **lần xảy ra mới thật** (cấp mã, `ACTIVE_UNACK` nếu R) với giá trị lúc gỡ; nếu lần xảy ra mở là hàng thật thì giữ.

Shelve của người dùng (`system = false`) trên instance đang chập chờn: không tự cách ly nữa (vì đã shelved); lần bật vẫn ghi hàng như bình thường (FR-031).

Ví dụ SC-019: alarm dao động 20 lần/phút, `chatterLimit` 5: hàng 1 đến 4 bình thường, lần bật thứ 5 trong cửa sổ tự cách ly và là hàng 5 (tổng kết); trong 30 phút cách ly tổng cộng đúng 5 hàng (`chatterLimit`), dòng thứ 5 mang `repeat_count`.

## 9. Khởi động và đối chiếu (`load`)

`load(defs, ctx)` gọi khi động cơ khởi tạo và mỗi lần kích hoạt project. `ctx`: `open` (các hàng `alarm_occurrence` có `closed = 0`, theo `id` tăng), `overrides` (hàng `alarm_override`), `nowMonoMs`, `nowEpochMs`, `clockOk`, `processStart` (true khi khởi động tiến trình, false khi đổi project), `nextOccurrence` (từ store). Thứ tự:

1. **Dựng instance** theo `defs`; instance chưa có hàng mở bắt đầu ở `NORMAL`, `rawCond = cond = false`.
2. **Override:** mỗi hàng `disable` có instance khớp `id`: `disabled = true` (hàng không có instance được giữ trong store để áp dụng khi alarm xuất hiện lại). Mỗi hàng `shelve`: nếu `clockOk` (cả lúc ghi và lúc nạp) và `ts_end_ms > nowEpochMs` thì shelved với `untilMono = nowMono + (ts_end_ms − nowEpoch)`; ngược lại coi như hết hạn: sự kiện `unshelve` (`expired`). Hàng không có instance khớp thì bị xóa.
3. **Hàng mở:** nhóm theo `alarm_id`; nếu có nhiều hơn một hàng mở thì giữ hàng có `id` lớn nhất, đóng các hàng còn lại với `closedBy = restart-lost`. Với hàng giữ lại:
   - instance không còn hoặc không `enabled`, hoặc `fingerprint` khác: đóng `closedBy = config` (sự kiện `state` về `NORMAL` hoặc `removed`);
   - instance `disabled`: đóng `closedBy = disabled`;
   - còn lại **dựng lại**: trạng thái từ cột (§5 data-model: `ts_return_ms` rỗng: `ts_ack_ms` rỗng ? `ACTIVE_UNACK` : `ACTIVE_ACK`; có `ts_return_ms`: `RTN_UNACK`); `cond = rawCond = (ts_return_ms rỗng)`; nếu lớp hiện hành không R thì áp quy tắc đổi lớp (AU → AA, RU → N và đóng). Không có sự kiện `state` (không đổi trạng thái); phát `resync` để hub gửi snapshot.
4. **Sau `load`:** ở `step` kế tiếp, đánh giá lại với Tag hiện tại: còn đúng điều kiện thì giữ (không chạy lại trễ bật, không lần xảy ra mới, `rawCond` giữ từ hàng); sai thì `rawCond = false`, trễ tắt bắt đầu từ tick đó; Tag chưa có giá trị tin cậy (`inputBad` hay `known = false`) thì giữ nguyên (FR-022).
5. **Cờ `startup`:** chỉ khi `processStart` là true: lần xảy ra mới bật mà `pendingSinceMono` được đặt ở **lần đánh giá hợp lệ đầu tiên** của instance sau `load` (tức điều kiện đã đúng ngay khi bắt đầu quan sát) có `flags.startup = 1`. Đổi project: không cờ `startup`.
6. **Thay project** (`processStart` = false): so theo `id` instance và `fingerprint`; khớp: giữ nguyên trạng thái, lần xảy ra, shelve, bộ đếm trễ; khác hoặc bị xóa: đóng `closedBy = config`; instance mới: đánh giá từ đầu. Lớp, khu vực, nội dung, trễ, `deadband`, tên đổi: áp dụng cho các lần bật và hiển thị về sau, không đóng lần xảy ra (hàng đã mở giữ `class`, `area`, `text` cũ). `shelve` giữ qua đổi project nếu instance khớp.

## 10. Đồng hồ

- `clockOk(nowEpochMs)`: cùng hàm với `core/historian/clock.hpp` (`audit.db`); bản TS `isClockOk(epochMs)` dùng cùng ngưỡng. Vector `clock-*` ghi ngưỡng hiện hành trong `options`.
- Lần xảy ra mang `clockOk` lúc bật; cột `clock_ok` ghi giá trị đó. Giờ nhảy (lùi hay đồng bộ NTP) không đổi thứ tự (mã tăng dần, `revision`) và không làm trễ hay hạn shelve (đơn điệu) sai.
- Shelve bền khi `clockOk` = false: đặt `clock_ok` = 0 trong `alarm_override`; khi nạp coi như hết hạn (FR-033).
- `AlarmView` có `clockJumpWhileOpen` (bool) khi `nowEpochMs` lệch với tiến độ đơn điệu quá 5 s trong lúc có lần xảy ra mở, để trang hiện cảnh báo (Edge Cases).

## 11. Định dạng nội dung

`formatAlarmText(template, ctx) → string`, ở `core/alarm/alarm_text.{hpp,cpp}` và `packages/alarm-engine/src/text.ts`; giống từng ký tự (vector `text-*`).

**Chọn mẫu:** `text` của ngưỡng, nếu không thì `text` của alarm, nếu không thì mẫu mặc định (D9):

| Loại | Mẫu mặc định |
|---|---|
| `digital` | `{name}` |
| `limit` `HH` | `{name} rất cao: {value} {unit} (ngưỡng {limit})` |
| `limit` `H` | `{name} cao: {value} {unit} (ngưỡng {limit})` |
| `limit` `L` | `{name} thấp: {value} {unit} (ngưỡng {limit})` |
| `limit` `LL` | `{name} rất thấp: {value} {unit} (ngưỡng {limit})` |
| `quality` | `{name}: mất tín hiệu ({reason})` |

**Thẻ:** `{name}` tên alarm; `{tag}` id Tag (rỗng với `device`; id thiết bị với `device`); `{value}` giá trị lúc bật; `{value:N}` (N 0 đến 6); `{unit}` đơn vị của Tag; `{limit}` ngưỡng (rỗng ngoài `limit`); `{limitName}` `HH`, `H`, `L`, `LL` hoặc rỗng; `{area}` tên khu vực hoặc "Chung"; `{reason}` `reason` lúc bật.

**Giá trị số:**

1. Lấy **chuỗi thập phân ngắn nhất khứ hồi** của `double`: thử `%.1g` đến `%.17g` (C++) cho tới khi `strtod` trả đúng giá trị; TS dùng `String(value)`; hai cách cho cùng chữ số; chuyển dạng mũ về dạng thường (không có `e`).
2. `{value:N}`: làm tròn chuỗi chữ số đó đến N chữ số thập phân **nửa ra xa 0** (xét `|giá trị|`, nửa tức chữ số kế là ≥ 5 thì tăng) rồi giữ đúng N chữ số (đệm số 0); `N = 0` thì không có dấu thập phân. `-0` sau làm tròn viết `0`. Ví dụ `1.005` với `{value:2}` ra `1,01` (chuỗi chữ số "1.005" làm tròn, không qua nhân nhị phân); `-2.5` với `{value:0}` ra `-3`.
3. `{value}` (không N) = `{value:6}` rồi bỏ các số 0 thừa ở cuối và dấu thập phân thừa.
4. Dấu thập phân là **dấu phẩy** `,` (ví dụ `91,2`), không có dấu phân cách hàng nghìn; quyết định cố định để C++ và TS giống nhau và khớp mẫu của spec (US1). 
5. `{limit}` dùng cùng quy tắc `{value}`.
6. Giá trị BOOL: `Bật` (1) hoặc `Tắt` (0); nếu Tag có `labels` (bảng giá trị 006) thì nhãn của khóa khớp (cho BOOL, INT); không khớp thì rơi về số.
7. Giá trị không hữu hạn (không xảy ra ở `digital`, `limit` vì `inputBad`; có thể ở `quality`): chữ `n/a`.

**Hậu xử lý:** xóa mọi `()` rỗng (cặp ngoặc chỉ chứa khoảng trắng), gộp dãy khoảng trắng thành một dấu cách, cắt hai đầu; rồi nếu dài hơn 200 điểm mã Unicode thì giữ 199 điểm mã đầu và thêm `…` (U+2026). Không tách giữa một ký tự ghép (dấu kết hợp đi liền ký tự gốc): cắt lùi tới ranh giới ký tự gốc.

**Chụp một lần (D10):** nội dung tính khi bật; không đổi khi hết hay xác nhận.

**`foldText(s)`** (dùng ở store §7 và bộ lọc chữ phía client): xem [alarm-store.md §7](alarm-store.md); hai bản C++/TS chung vector `text-fold-*`.

## 12. API C++ (`core/alarm/`)

```cpp
namespace mat::alarm {

enum class AlarmKind : uint8_t { Digital, Limit, Quality };
enum class AlarmState : uint8_t { Normal, ActiveUnack, ActiveAck, RtnUnack };
enum class Priority : uint8_t { Critical = 1, Major = 2, Minor = 3, Advisory = 4 };
enum class ClosedBy : uint8_t { None, Return, Config, Disabled, RestartLost };

struct TagSample {
  bool known = true;
  double value = 0;
  enum class Quality : uint8_t { Good, Uncertain, Bad } quality = Quality::Good;
  std::string_view reason;
};

struct AlarmOptions {                 // §11 data-model: cấu hình runtime
  int chatterWindowS = 60;
  int chatterShelveS = 1800;
  int maxShelved = 50;
};

class AlarmEngine {
 public:
  explicit AlarmEngine(AlarmOptions opt = {});

  // Nạp định nghĩa mới (khởi động hoặc đổi project). Chạy trên luồng tick.
  LoadReport load(const AlarmDefs& defs, const LoadContext& ctx);

  // Tag mà step đọc; caller dựng mảng TagSample theo đúng thứ tự này.
  const std::vector<std::string>& watchedTags() const;

  // Một chu kỳ. tags.size() == watchedTags().size(). Không I/O, không cấp phát khi không đổi.
  void step(int64_t nowMonoMs, int64_t nowEpochMs, std::span<const TagSample> tags);

  // Luồng khác gọi (khóa ngắn): đưa lệnh vào hộp thư; onResult chạy ở cuối step.
  void submit(Command cmd, std::function<void(const CommandResult&)> onResult);

  // Sự kiện phát sinh từ lần gọi trước; caller (alarm_glue) chuyển cho hàng đợi ghi và LiveHub.
  void takeEvents(std::vector<AlarmEvent>& out);

  // Ảnh chụp bất biến; luồng bất kỳ đọc được. Không khóa.
  std::shared_ptr<const AlarmView> view() const;

  // Ack hàng loạt: chạy trên AlarmView, không đổi trạng thái.
  std::vector<AckTarget> previewAck(const AckRequest& req) const;
};

// alarm_text.hpp
std::string formatAlarmText(const TextTemplate& tpl, const TextContext& ctx);
std::string foldText(std::string_view utf8);           // alarm-store.md §7
std::string shortestDouble(double v);                  // §11 bước 1
uint64_t fingerprint(const InstanceDef& d);
std::string fingerprintHex(const InstanceDef& d);

// alarm_defs.hpp
CompileResult compileAlarms(const ProjectView& project);  // lỗi đã được validator bắt; chỉ gọi khi hợp lệ
}  // namespace mat::alarm
```

`Command` = `{ kind (Ack, Shelve, Unshelve, Disable, Enable), id, occurrence, user, reason, durationS, system }`. `LoadContext` = `{ open, overrides, nowMonoMs, nowEpochMs, clockOk, processStart, nextOccurrence }`. `LoadReport` = số instance, danh sách lần đóng do đối chiếu. `AlarmView` = `{ revision, ts, counts, items[] }` (cấu trúc `AlarmItem` của [data-model §6](../data-model.md)), cộng chỉ mục `id → vị trí`.

Cắm vào tick: `alarm_glue` gọi `engine.step(mono, epoch, samples)` ngay sau `engine.step` của `TagEngine` (trong `server/runtime_engine.cpp`), dựng `samples` bằng **một** `TagStore::snapshot(indices, out)` (D30, FR-026), rồi `takeEvents` và đẩy sang hàng đợi ghi và hàng đợi live.

## 13. API TS (`@mat/alarm-engine`)

```ts
export type AlarmState = 'NORMAL' | 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK';
export type Priority = 'critical' | 'major' | 'minor' | 'advisory';
export type ClosedBy = 'return' | 'config' | 'disabled' | 'restart-lost';
export type Quality = 'GOOD' | 'UNCERTAIN' | 'BAD';

export interface TagSample { known?: boolean; value: number; quality: Quality; reason?: string }
export interface AlarmTagInfo { unit?: string; labels?: Record<string, string>; isBool?: boolean }

export interface AlarmEngineOptions { chatterWindowS?: number; chatterShelveS?: number; maxShelved?: number }

export type Command =
  | { kind: 'ack'; id: string; occurrence: number; user: string }
  | { kind: 'shelve'; id: string; reason: string; durationS: number; user: string; system?: boolean }
  | { kind: 'unshelve'; id: string; user: string }
  | { kind: 'disable'; id: string; reason: string; user: string }
  | { kind: 'enable'; id: string; user: string };

export interface AlarmEvent {
  kind: 'state' | 'shelve' | 'unshelve' | 'disable' | 'enable' | 'chatter' | 'command' | 'removed' | 'resync';
  tMono: number; tEpoch: number; clockOk: boolean;
  instance: string;
  from?: AlarmState; to?: AlarmState;
  occurrence?: number; closedBy?: ClosedBy;
  text?: string; value?: number; quality?: Quality; reason?: string;
  flags?: { startup: boolean; inputBad: boolean };
  result?: string; revision: number;
  row?: OccurrenceRow;
}

export interface LoadContext {
  open?: OccurrenceRow[]; overrides?: OverrideRow[];
  nowMonoMs: number; nowEpochMs: number; processStart: boolean; nextOccurrence?: number;
}

export class AlarmEngine {
  constructor(opts?: AlarmEngineOptions);
  load(defs: AlarmDefs, tagInfo: Record<string, AlarmTagInfo>, ctx: LoadContext): AlarmEvent[];
  watchedTags(): readonly string[];
  /** tags: cùng thứ tự watchedTags(). Trả sự kiện của tick; lệnh đã submit được xử lý trước. */
  step(nowMonoMs: number, nowEpochMs: number, tags: readonly TagSample[]): AlarmEvent[];
  submit(cmd: Command): void;           // áp dụng ở step kế tiếp; kết quả là sự kiện kind 'command'
  view(): AlarmView;
  previewAck(req: AckRequest): AckTarget[];
}

export function compileAlarms(project: ProjectLike): AlarmDefs;
export function formatAlarmText(tpl: TextTemplate, ctx: TextContext): string;
export function foldText(s: string): string;
export function shortestDouble(v: number): string;
export function fingerprintHex(d: InstanceDef): string;
export function runVector(v: AlarmVector): VectorResult;   // vectors.ts: chạy một ca, so với expect
```

Khác biệt cố ý duy nhất giữa hai bản: C++ trả sự kiện qua `takeEvents`, TS trả từ `step`/`load`; nội dung sự kiện giống nhau từng trường.

## 14. Định dạng file vector `tests/alarm-vectors/*.json`

Mỗi file một nhóm (`digital.json`, `limit-high.json`, …); trong file là mảng `cases`. Một ca:

```json
{
  "name": "limit-h-basic",
  "group": "limit-high",
  "description": "H = 80, deadband 2, trễ bật 3 s, trễ tắt 1 s; 79 → 81 → giữ 3 s → 79 → 77.",
  "options": { "tickMs": 250, "chatterWindowS": 60, "chatterShelveS": 1800, "epoch0": 1791600000000, "clockOkFrom": 1577836800000 },
  "classes": [
    { "id": "minor", "name": "Nhỏ", "priority": "minor", "color": "amber", "requiresAck": true, "ackReturn": false, "sound": "beep", "blink": false, "chatterLimit": 5 }
  ],
  "areas": [ { "id": "bon", "name": "Bồn" } ],
  "tags": { "TANK01.LEVEL": { "unit": "%" } },
  "devices": {},
  "alarms": [
    { "id": "TANK_LEVEL", "type": "limit", "name": "Mức bồn", "area": "bon", "tag": "TANK01.LEVEL",
      "limits": { "H": { "value": 80, "class": "minor" } }, "deadband": 2, "onDelayMs": 3000, "offDelayMs": 1000 }
  ],
  "timeline": [
    { "t": 0,    "tags": { "TANK01.LEVEL": { "value": 79, "quality": "GOOD" } } },
    { "t": 1000, "tags": { "TANK01.LEVEL": { "value": 81, "quality": "GOOD" } } },
    { "t": 5000, "action": { "type": "ack", "instance": "TANK_LEVEL.H", "occurrence": 1, "user": "op1" } },
    { "t": 6000, "tags": { "TANK01.LEVEL": { "value": 79, "quality": "GOOD" } } },
    { "t": 6500, "tags": { "TANK01.LEVEL": { "value": 77, "quality": "GOOD" } } }
  ],
  "end": 9000,
  "expect": [
    { "t": 4000, "instance": "TANK_LEVEL.H", "kind": "state", "from": "NORMAL", "to": "ACTIVE_UNACK", "occurrence": 1,
      "text": "Mức bồn cao: 81 % (ngưỡng 80)" },
    { "t": 5000, "instance": "TANK_LEVEL.H", "kind": "command", "result": "ACKED" },
    { "t": 5000, "instance": "TANK_LEVEL.H", "kind": "state", "from": "ACTIVE_UNACK", "to": "ACTIVE_ACK", "occurrence": 1 },
    { "t": 7500, "instance": "TANK_LEVEL.H", "kind": "state", "from": "ACTIVE_ACK", "to": "NORMAL", "occurrence": 1, "closedBy": "return" }
  ]
}
```

**Quy tắc chạy (`runVector`, cả hai bản dùng cùng thuật toán):**

- `t` là mili giây ảo từ 0; `nowMonoMs = t`, `nowEpochMs = epoch0 + t`. Bộ chạy gọi `step` ở **mọi** `t` là bội của `tickMs` từ 0 đến `end` (kể cả khi không có mục timeline); mọi `t` trong `timeline` MUST là bội của `tickMs` (kiểm khi nạp vector).
- Trước `step` ở thời điểm `t`: áp mục `tags` (hợp nhất vào mẫu hiện tại; Tag chưa nhắc giữ mẫu cũ; ban đầu mọi Tag `known = false`, `quality = BAD`, `reason = "NO_DATA"`), rồi `action` của mục đó (qua `submit`). Nhiều mục cùng `t` được áp theo thứ tự trong mảng.
- `tags.<id>` có `value`, `quality`, `reason?`; thêm `"known": false` để mô phỏng chưa có giá trị.
- Mẫu `devices`: `{ "plc1": ["T1", "T2"] }` (các Tag đọc từ thiết bị).
- **`action`:**
  - `ack` `{ instance, occurrence, user }`; `ackAll` `{ filter?, upToRevision?, user }`; `shelve` `{ instance, reason, durationS, user }`; `unshelve` `{ instance, user }`; `disable` `{ instance, reason, user }`; `enable` `{ instance, user }`;
  - `reload` `{ alarms, classes?, areas?, tags? }`: gọi `load` với định nghĩa mới và trạng thái hiện hành (`processStart = false`);
  - `commit`: đánh dấu điểm bền (mô hình store của bộ chạy ghi lại mọi hàng từ đầu đến đây);
  - `restart` `{ persist: "committed" | "all", clock?: "ok" | "bad" }`: tạo động cơ mới, `load` với hàng mở và override của mô hình store (`committed`: chỉ tới `commit` gần nhất, mô phỏng mất điện với WAL NORMAL; `all`: toàn bộ), `processStart = true`; mô hình store loại hàng `closed` khỏi `open`. Từ đây `t` tiếp tục (đơn điệu tiếp, `nowMonoMs` không về 0).
- **`expect`** là danh sách **đầy đủ và có thứ tự** các sự kiện mà bộ chạy phải thấy (không thừa, không thiếu), sắp theo `t` rồi thứ tự phát sinh. Mỗi phần tử so các trường được nêu: `t` (bắt buộc), `instance`, `kind` (mặc định `state`), `from`, `to`, `occurrence`, `closedBy`, `text`, `result`, `flags` (`{startup?, inputBad?}`), `count` (với `chatter`), `value`, `reason`. Trường không nêu thì không so (trừ `t`, `instance`, `kind`).
- Bản tin `command` không tạo sự kiện `state` trùng: mỗi lệnh có một sự kiện `command` và, nếu đổi trạng thái, `state`/`shelve`... đi ngay sau.
- Các sự kiện `shelve`, `unshelve`, `disable`, `enable`, `removed`, `resync` cũng được liệt kê trong `expect` khi ca quan tâm; bộ chạy có trường tùy chọn `"strict": false` ở mức ca để bỏ qua loại sự kiện không liệt kê (mặc định `true`: so đủ).
- Mỗi ca có thể thêm `expectView` (tùy chọn): danh sách `{ t, counts?, items? }` để so `AlarmView` ở thời điểm `t` (ví dụ `counts.unacked`).
- File vector kèm sha256 trong `tests/alarm-vectors/MANIFEST.json`; lint kiểm mỗi `name` duy nhất và mỗi file đủ ≥ 1 ca.

## 15. Danh sách nhóm ca (≥ 60; mục tiêu 98)

| Nhóm (file) | Số ca | Tên ca |
|---|---|---|
| `digital` | 8 | `digital-true-basic`, `digital-trigger-false`, `digital-int-nonzero`, `digital-on-delay-reset`, `digital-off-delay-hold`, `digital-both-delays`, `digital-reactivate-new-occurrence`, `digital-startup-true` |
| `limit-high` | 6 | `limit-h-basic`, `limit-h-exact-threshold`, `limit-hh-and-h`, `limit-jump-over-both`, `limit-drop-hh-to-between`, `limit-drop-below-h-both` |
| `limit-low` | 5 | `limit-l-basic`, `limit-l-exact`, `limit-ll-and-l`, `limit-low-jump-under-both`, `limit-low-rise-to-between` |
| `deadband` | 6 | `deadband-hold-inside`, `deadband-clear-below`, `deadband-zero`, `deadband-schmitt-no-timer-reset`, `deadband-low-side`, `deadband-restart-from-inside` |
| `delay` | 6 | `delay-on-exact-boundary`, `delay-on-interrupt-resets`, `delay-off-interrupt-holds`, `delay-zero-immediate`, `delay-granularity-tick`, `delay-long-24h` |
| `input-bad` | 6 | `inputbad-hold-active`, `inputbad-hold-normal`, `inputbad-return-restarts-timer`, `inputbad-uncertain-evaluated`, `inputbad-nan`, `inputbad-inf` |
| `quality` | 7 | `quality-tag-bad`, `quality-tag-notgood`, `quality-device-all-bad`, `quality-device-partial`, `quality-reason-captured`, `quality-on-delay`, `quality-never-known-hold` |
| `isa` | 8 | `isa-requiresack-flow`, `isa-no-ack-info`, `isa-ackreturn-flow`, `isa-unack-return-rtn`, `isa-rtn-reactivate-new`, `isa-class-change-to-noack`, `isa-aa-return-normal`, `isa-rtn-ack-normal` |
| `ack` | 6 | `ack-single`, `ack-idempotent`, `ack-stale`, `ack-shelved-rejected`, `ack-not-active`, `ack-all-up-to-revision` |
| `shelve` | 7 | `shelve-hides-active`, `shelve-expire-condition-true`, `shelve-expire-condition-false`, `shelve-unshelve-early`, `shelve-limit-50`, `shelve-range-reasons`, `shelve-aa-rearm` |
| `disable` | 4 | `disable-closes-open`, `disable-no-eval`, `enable-evaluate-fresh`, `disable-survives-restart` |
| `chatter` | 5 | `chatter-trigger-at-limit`, `chatter-summary-repeat-count`, `chatter-shelve-expires`, `chatter-unshelve-early-reset`, `chatter-limit-zero-off` |
| `reconcile` | 8 | `reconcile-keep-active`, `reconcile-condition-false-offdelay`, `reconcile-unknown-hold`, `reconcile-ack-lost-unack`, `reconcile-config-removed`, `reconcile-fingerprint-changed`, `reconcile-class-text-change-keeps`, `reconcile-duplicate-open-restart-lost` |
| `text` | 10 | `text-default-hh`, `text-default-digital`, `text-default-quality-no-reason`, `text-round-half-away-pos`, `text-round-half-away-neg`, `text-round-binary-edge`, `text-bool-labels`, `text-truncate-200`, `text-fold-vietnamese`, `text-fold-combining` |
| `clock` | 3 | `clock-not-ok-flag`, `clock-jump-back-ordering`, `clock-shelve-restart-not-ok` |
| `order` | 3 | `order-two-instances-same-tick`, `order-command-before-eval`, `order-limit-thresholds` |

Tổng: 8 + 6 + 5 + 6 + 6 + 6 + 7 + 8 + 6 + 7 + 4 + 5 + 8 + 10 + 3 + 3 = **98 ca**.

Phủ bổ sung ngoài vector (test đơn vị): bảng ISA 40 ô ([data-model §5](../data-model.md), SC-005); `foldText` trên tập 200 chuỗi; làm tròn trên 1.000 cặp `(giá trị, N)` sinh cố định so với bảng chuẩn.

## Điểm cần sửa spec

1. **Thời điểm đếm chập chờn:** Đã xử lý trong spec (US3 kịch bản 7, FR-035: đếm tại lần bật thứ `chatterLimit`).
2. **Lần xảy ra "bóng" (§8):** Đã xử lý trong spec (US3 kịch bản 7, FR-035, FR-038: các lần bật sau trong đợt tự cách ly không có hàng riêng, chỉ `repeat_count` của dòng tổng kết).
3. **Tag chưa có giá trị với alarm `quality` (§6):** Đã xử lý trong spec (D44: Tag chưa có giá trị `known = false`).
4. **Dấu thập phân (§11):** Đã xử lý trong spec (D41: số thập phân dùng dấu chấm).
5. **Đổi lớp từ `requiresAck` thành không (FR-023):** Đã xử lý trong spec (FR-023: `ACTIVE_UNACK` → `ACTIVE_ACK`, `RTN_UNACK` → `NORMAL`).
6. **Giới hạn `maxShelved` = 50 (FR-034):** Đã xử lý trong spec (D47: tự cách ly do chập chờn không tính vào 50, để một bão chập chờn không chiếm chỗ của người vận hành).
