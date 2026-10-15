# Contract: giao thức live 1.3.0 (phần thay đổi so với 1.2.0)

**Feature**: [spec.md](../spec.md) FR-045…FR-049, FR-052, FR-063, SC-015, SC-018 · **Data model**: [data-model.md](../data-model.md) §4 (hàng đợi live), §5 (bảng trạng thái), §6 (bản tin live) · **Research**: R13 · **ADR**: [029](../../../docs/adr/029-alarm-live-api.md), [006](../../../docs/adr/006-live-protocol-v1.md) · Bản trước: [live-protocol-1.2.md](../../006-tags-modbus/contracts/live-protocol-1.2.md)

Theo [ADR-006](../../../docs/adr/006-live-protocol-v1.md): thêm bản tin và thêm trường tùy chọn là MINOR, nên `protocolVersion` = `"1.3.0"` (`kLiveProtocolVersion` trong `server/websocket/live_hub.hpp`; `schemas/protocol-version.json` thành `{"live":"1.3.0","project":["0.1","0.2","0.3","0.4","0.5"]}`). Mọi quy tắc khác của 1.2.0 giữ nguyên: bản tin `hello, snapshot, delta, heartbeat, error, resync_required`, `subscribe`, `unsubscribe`, `heartbeat`, hàng đợi 256 KB mỗi phiên (tràn thì `resync_required` rồi đóng 4409), 4401, 1012, 4429, tối đa 10 phiên. Alarm đi chung kết nối live đã có; không mở kết nối thêm (Constitution IV).

Quyết định (người dùng giao toàn quyền 2026-10-11): alarm dùng **đăng ký riêng** (`subscribeAlarms`), không trộn vào `delta` của Tag (D18); xác nhận **chỉ qua REST** (D31, [device-api-1.3.md](device-api-1.3.md)).

## 1. `hello.features`

`hello` thêm trường tùy chọn `features` (mảng chuỗi):

```json
{ "type": "hello", "protocolVersion": "1.3.0", "serverVersion": "0.8.0", "maxClients": 10,
  "heartbeatMs": 5000, "timeoutMs": 15000,
  "features": ["alarms"],
  "project": { "…": "…" } }
```

| Giá trị | Có khi |
|---|---|
| `alarms` | project đang chạy có ít nhất một instance alarm (FR-049) |

- Không có alarm nào (project 0.1 đến 0.4, hoặc 0.5 không có `alarms.json`): **không có** trường `features`, hoặc mảng không chứa `alarms`. Client coi trường vắng là mảng rỗng.
- Giá trị lạ trong `features`: client bỏ qua (mở rộng sau này không cần đổi giao thức).
- `features` do project đang chạy quyết định, nên cố định suốt phiên (đổi project là khởi động lại runtime, đóng 1012, §7).

## 2. Bản tin client: `subscribeAlarms`, `unsubscribeAlarms`

```json
{ "type": "subscribeAlarms", "requestId": "a1" }
{ "type": "unsubscribeAlarms" }
```

| Trường | Ràng buộc |
|---|---|
| `requestId` | bắt buộc, chuỗi ≤ 64 ký tự (như `subscribe`); máy chủ lặp lại ở `subscriptionId` của `alarmSnapshot` và `alarmDelta` |
| (không có tham số lọc) | Quyết định: bộ lọc (khu vực, lớp, mức) làm ở client. Lý do: tối đa 500 instance (≈ 170 KB); một snapshot dùng chung cho banner, bảng, widget; lọc phía máy chủ thêm trạng thái mỗi phiên mà không tiết kiệm đáng kể (YAGNI) |

Quy tắc:

- **Không cần có Tag nào được đăng ký**: `subscribeAlarms` và `subscribe` độc lập; trang chỉ có banner (không widget) vẫn đăng ký alarm.
- `subscribeAlarms` thiếu `requestId` hoặc sai kiểu: `error` `BAD_MESSAGE` (tính vào chuỗi lỗi liên tiếp như `subscribe`; thành công thì đặt lại chuỗi).
- Đăng ký lần hai trên cùng phiên: **thay** bản đăng ký, hủy mọi `alarmDelta` đang chờ dồn (§5) và gửi `alarmSnapshot` mới (Edge Cases của spec). `subscriptionId` đổi theo `requestId` mới; client bỏ bản tin mang `subscriptionId` cũ.
- Giới hạn tần suất: tối đa 5 bản tin `subscribeAlarms` trong 10 s mỗi phiên; quá mức: `error` `BAD_MESSAGE` ("subscribeAlarms quá nhanh"). Lý do: mỗi lần tạo một snapshot (≤ 170 KB); chặn client lỗi xin snapshot vòng lặp.
- `unsubscribeAlarms`: ngừng gửi `alarmDelta`, xóa dồn; không có phản hồi (như `unsubscribe`). Phiên đóng thì đăng ký tự mất.
- Gửi `subscribeAlarms` khi `features` của `hello` không có `alarms` vẫn hợp lệ: nhận `alarmSnapshot` rỗng (§3, FR-049). Client 1.3.0 **không** nên gửi trong trường hợp này (§8), nhưng máy chủ không coi là lỗi.
- Bản tin alarm mang cùng quyền như dữ liệu Tag (FR-048): ai mở được `/api/v1/live` (lọc nguồn, `viewerLogin`, phiên) thì đăng ký được alarm; không có kiểm quyền thứ hai.

## 3. `alarmSnapshot`

Gửi ngay sau `subscribeAlarms` (và chỉ khi đó). Chứa **mọi instance không ở `NORMAL`, hoặc đang `shelved`, hoặc `disabled`**, cộng lớp, khu vực và số đếm. Instance `NORMAL` bình thường không có mặt: client suy ra "bình thường" khi không thấy.

```json
{ "type": "alarmSnapshot", "subscriptionId": "a1", "sequence": 1, "ts": 1791601205000,
  "revision": 9123,
  "instances": [
    { "id": "TANK_B1_LEVEL.HH", "alarmId": "TANK_B1_LEVEL", "name": "Mức bồn B1", "type": "limit", "limit": "HH",
      "occurrence": 4412, "rev": 9120,
      "state": "ACTIVE_UNACK", "class": "critical", "priority": "critical", "area": "bon",
      "text": "Mức bồn B1 rất cao: 91.2 % (ngưỡng 90)",
      "valueActive": 91.2, "qualityActive": "GOOD",
      "tsActive": 1791601203000, "clockOk": true,
      "inputBad": false, "startup": false, "disabled": false },
    { "id": "PUMP1_FAULT", "alarmId": "PUMP1_FAULT", "name": "Bơm 1 lỗi", "type": "digital",
      "occurrence": 4390, "rev": 9101,
      "state": "ACTIVE_ACK", "class": "major", "priority": "major", "area": null,
      "text": "Bơm 1 lỗi", "valueActive": true, "qualityActive": "GOOD",
      "tsActive": 1791600100000, "clockOk": true,
      "tsAck": 1791600160000, "ackUser": "vanhanh1",
      "inputBad": false, "startup": false, "disabled": false },
    { "id": "METER3_COMM", "alarmId": "METER3_COMM", "name": "Mất tín hiệu đồng hồ 3", "type": "quality",
      "occurrence": 4301, "rev": 9050,
      "state": "RTN_UNACK", "class": "minor", "priority": "minor", "area": "dien",
      "text": "Mất tín hiệu đồng hồ 3 (TIMEOUT)", "valueActive": null, "qualityActive": "BAD", "reason": "TIMEOUT",
      "tsActive": 1791590000000, "clockOk": true, "tsReturn": 1791600500000,
      "inputBad": false, "startup": true, "disabled": false,
      "shelved": { "until": 1791604800000, "remainingMs": 3595000, "reason": "Chờ thay cảm biến", "user": "vanhanh1", "system": false } } ],
  "classes": [ { "id": "critical", "name": "Khẩn cấp", "priority": "critical", "color": "red", "blink": true,
                 "requiresAck": true, "ackReturn": false, "sound": "siren", "chatterLimit": 5 } ],
  "areas": [ { "id": "bon", "name": "Bồn" }, { "id": "dien", "name": "Điện" } ],
  "counts": { "active": 2, "unack": 1, "rtnUnack": 1, "shelved": 1, "disabled": 0,
              "byPriority": { "critical": { "active": 1, "unack": 1 }, "major": { "active": 1, "unack": 0 },
                              "minor": { "active": 0, "unack": 0 }, "advisory": { "active": 0, "unack": 0 } } } }
```

### 3.1 Trường của snapshot

| Trường | Ý nghĩa |
|---|---|
| `subscriptionId` | `requestId` của `subscribeAlarms` |
| `sequence` | số thứ tự **riêng của alarm** trong phiên: đơn điệu, tăng 1 sau mỗi `alarmSnapshot` hoặc `alarmDelta` gửi cho phiên này; độc lập với `sequence` của Tag. Giá trị đầu tiên của phiên là 1; đăng ký lại thì **tiếp tục** (không về 1), như Tag |
| `ts` | giờ treo tường của thiết bị (ms UTC) lúc gửi; trang dùng làm giờ tham chiếu (cộng thời gian trôi cục bộ) |
| `revision` | `rev` lớn nhất của động cơ tại thời điểm tạo bản tin; **số toàn cục của động cơ**, không phải của phiên. Dùng làm `upToRevision` khi "Xác nhận tất cả" ([device-api-1.3.md](device-api-1.3.md) §3.1) |
| `instances[]` | xem §3.2 |
| `classes[]` | toàn bộ lớp của project (≤ 16): id, tên, ưu tiên, màu, nhấp nháy, cần xác nhận, xác nhận khi hết, âm thanh, `chatterLimit`. Cố định suốt phiên |
| `areas[]` | toàn bộ khu vực (≤ 64): id, tên. Cố định suốt phiên |
| `counts` | số đếm đã tính sẵn (§3.3); client **không tự đếm lại** từ `instances` để hiện huy hiệu (hai nơi cùng một số) nhưng được dùng `instances` để lọc |
| `part`, `parts` | chỉ có khi snapshot chia mảnh (§3.4) |

### 3.2 Một instance (`instances[]`, `changed[]`)

| Trường | Kiểu | Có khi | Ý nghĩa |
|---|---|---|---|
| `id` | chuỗi | luôn | id instance: `<alarmId>` (số, quality) hoặc `<alarmId>.<HH|H|L|LL>` |
| `alarmId` | chuỗi | luôn | id định nghĩa |
| `name` | chuỗi | luôn | tên hiển thị của định nghĩa (1 đến 80) |
| `type` | `digital` \| `limit` \| `quality` | luôn | |
| `limit` | `HH` \| `H` \| `L` \| `LL` | `type` = `limit` | |
| `occurrence` | số nguyên ≥ 1 | luôn | mã lần xảy ra đang mở (hoặc lần xảy ra gần nhất khi instance chỉ `shelved` hoặc `disabled` ở `NORMAL`: `0` nếu chưa có) |
| `rev` | số nguyên | luôn | `sequence` toàn cục của động cơ tại lần đổi cuối của instance |
| `state` | `NORMAL` \| `ACTIVE_UNACK` \| `ACTIVE_ACK` \| `RTN_UNACK` | luôn | ([data-model.md](../data-model.md) §5) `NORMAL` chỉ xuất hiện khi kèm `shelved` hoặc `disabled` |
| `class`, `priority`, `area` | chuỗi, chuỗi, chuỗi hoặc `null` | luôn | lớp, mức ưu tiên (suy từ lớp, đưa sẵn để lọc không cần tra), khu vực (`null` = "Chung") |
| `text` | chuỗi ≤ 200 | luôn | nội dung đã chèn **lúc bật** (D10); chữ thô, client chỉ vào DOM bằng `textContent` |
| `valueActive` | số, bool, chuỗi hoặc `null` | luôn | giá trị lúc bật (D10) |
| `qualityActive` | `GOOD` \| `UNCERTAIN` \| `BAD` | luôn | quality lúc bật |
| `reason` | chuỗi | khi có | `reason` của Tag lúc bật (alarm `quality`) |
| `tsActive`, `clockOk` | số, bool | luôn | giờ bật (ms UTC) và cờ đồng hồ hợp lệ (FR-024) |
| `tsAck`, `ackUser` | số, chuỗi | đã xác nhận | |
| `tsReturn` | số | đã hết (`RTN_UNACK`) | giờ hết |
| `shelved` | đối tượng | đang tạm ẩn | `until` (ms UTC), `remainingMs` (tính tại `ts` của bản tin; client đếm ngược bằng đồng hồ cục bộ, vì giờ thiết bị có thể chưa đồng bộ), `reason`, `user`, `system` (true: tự cách ly do chập chờn) |
| `disabled` | bool | luôn | bị kỹ sư vô hiệu (FR-032) |
| `inputBad` | bool | luôn | Tag đầu vào BAD, trạng thái đang giữ nguyên (FR-019) |
| `startup` | bool | luôn | lần xảy ra bật ngay sau khởi động (FR-036) |

Thứ tự của `instances[]`: máy chủ không cam kết; client tự sắp xếp.

### 3.3 `counts`

| Trường | Đếm |
|---|---|
| `active` | instance **không shelved** có `state` khác `NORMAL` |
| `unack` | trong đó `ACTIVE_UNACK` |
| `rtnUnack` | trong đó `RTN_UNACK` |
| `shelved` | instance đang shelved (mọi trạng thái) |
| `disabled` | instance bị vô hiệu |
| `byPriority.<p>.active`, `.unack` | như `active`, `unack` theo mức ưu tiên (`critical`, `major`, `minor`, `advisory`) |

`unack` là số hiện ở huy hiệu menu, tiêu đề tab và banner ([ui-alarm.md](ui-alarm.md) §6, §7). Instance shelved không tính vào `active` và `unack` (FR-031). Không có `unack` cho `ACTIVE_ACK`: lớp không `requiresAck` vào thẳng `ACTIVE_ACK`, nên không làm nhấp nháy banner.

### 3.4 Chia mảnh snapshot lớn

Một instance có thể tới ≈ 600 byte (nội dung 200 ký tự); 500 instance có thể vượt 256 KB của hàng đợi. Quy tắc:

- Máy chủ chia `instances` thành các mảnh ≤ 100 instance (≈ 60 KB). Mỗi mảnh là một bản tin `alarmSnapshot` đủ trường (`classes`, `areas`, `counts` lặp lại ở mọi mảnh để mỗi mảnh tự hiểu được), cùng `sequence` và `revision`, kèm `part` (từ 1) và `parts` (tổng).
- Snapshot ≤ 100 instance: không có `part`, `parts` (trường hợp thường: 200 alarm nhưng thường chỉ vài chục không `NORMAL`).
- Mảnh sau chỉ gửi khi hàng đợi gửi của phiên còn dưới 50 % (cùng ngưỡng của §5); tick sau thử lại.
- Trong lúc chưa gửi hết mảnh, thay đổi mới của alarm được **dồn** (§5) và gửi bằng `alarmDelta` ngay sau mảnh cuối với `sequence` + 1.
- Client chỉ áp snapshot khi nhận đủ `parts` mảnh cùng `sequence`; trước đó giữ trạng thái cũ (hoặc rỗng nếu chưa có). Thiếu mảnh quá 10 s: client gửi lại `subscribeAlarms`.

## 4. `alarmDelta`

```json
{ "type": "alarmDelta", "subscriptionId": "a1", "sequence": 2, "ts": 1791601205250, "revision": 9125,
  "changed": [ { "id": "TANK_B1_LEVEL.HH", "…": "đủ trường như §3.2, state mới" } ],
  "removed": [ "TANK_B1_LEVEL.H" ],
  "counts": { "active": 1, "unack": 0, "rtnUnack": 0, "shelved": 1, "disabled": 0,
              "byPriority": { "…": "…" } } }
```

- `changed`: instance vừa đổi (đổi trạng thái, xác nhận, shelve, unshelve, disable, enable, đổi cờ `inputBad`, lần xảy ra mới). **Đủ trường**, không phải bản vá từng trường: client thay thế nguyên đối tượng theo `id`. Lý do: kích thước nhỏ (một instance ≈ 350 byte), client đơn giản, dồn theo instance (§5) không phải hợp nhất bản vá.
- `removed`: instance trở về `NORMAL` mà không còn shelved và không `disabled` (nên không còn trong "tập có mặt" của snapshot). Client xóa theo `id`. Một `id` không xuất hiện đồng thời ở `changed` và `removed` của cùng bản tin.
- `counts`: **luôn có**, đã tính lại sau thay đổi (client không tự suy).
- `revision`: như §3.1.
- Máy chủ gửi `alarmDelta` trong ≤ 1 tick sau thay đổi (FR-046), cùng nhịp với `delta` của Tag (`deltaPeriodMs`, mặc định 250 ms). Nhiều thay đổi cùng tick gom trong một bản tin; thay đổi nhiều lần của một instance trong cùng tick chỉ còn bản cuối. Không gửi `alarmDelta` rỗng.
- Một bản tin `alarmDelta` tối đa 100 phần tử `changed`; nhiều hơn thì chia thành nhiều bản tin liên tiếp, mỗi bản có `sequence` riêng.
- **Không có cập nhật định kỳ** nào khác (không gửi lại theo thời gian): giá trị sống của Tag đi bằng `delta` Tag.

### 4.1 Bất biến khi áp dụng ở client

1. `sequence` của bản tin = `sequence` trước + 1; khác thì xin lại snapshot (§6).
2. Sau khi áp, tập instance của client bằng tập instance máy chủ tại cùng `revision` (kiểm trong test mô phỏng: ngẫu nhiên hóa chuỗi sự kiện, dồn và không dồn cho cùng kết quả cuối).
3. `counts` lấy từ bản tin mới nhất, không cộng dồn.

## 5. Dồn theo instance khi hàng đợi gần đầy

Mục tiêu: client chậm không làm tràn hàng đợi 256 KB (4409), alarm không bị bỏ (FR-047, SC-018).

Mỗi phiên đã đăng ký alarm có một **bảng chờ**: `id instance → bản mới nhất (changed) hoặc dấu xóa (removed)`, tối đa 500 phần tử (bằng số instance), nên bộ nhớ có chặn trên.

| Điều kiện (đo lúc tick) | Việc làm |
|---|---|
| hàng đợi gửi ≤ 50 % và bảng chờ rỗng | gửi `alarmDelta` ngay như bình thường |
| hàng đợi gửi > 50 % | **không gửi**; ghép thay đổi của tick vào bảng chờ (bản mới thay bản cũ cùng `id`; `removed` thay `changed` và ngược lại) |
| hàng đợi gửi < 25 % và bảng chờ không rỗng | gửi bảng chờ thành một (hoặc nhiều, ≤ 100 mỗi bản) `alarmDelta`, mỗi bản một `sequence` kế tiếp; xóa bảng chờ |
| bảng chờ không rỗng quá 5 s | không đổi cách làm; tràn hàng đợi do **Tag** vẫn theo cơ chế 1.0.0 (`resync_required` rồi 4409). Alarm không tự gây 4409: bảng chờ không đi vào hàng đợi |

- `counts` và `revision` của bản dồn là của thời điểm gửi, không phải của từng tick bị gộp.
- `sequence` của client vẫn liên tục (mỗi bản gửi đi tăng 1); client **không** nhận ra việc dồn, chỉ thấy bản tin thưa hơn.
- Dồn **mất các bước trung gian** (ví dụ `ACTIVE_UNACK` rồi `RTN_UNACK` trong cùng khoảng dồn chỉ còn `RTN_UNACK`); lịch sử đầy đủ nằm ở `alarm.db` ([alarm-store.md](alarm-store.md)), nên không mất bản ghi. Mất bước trung gian chỉ ảnh hưởng chuyển động hiển thị và tiếng của client chậm.
- Hai ngưỡng 50 % và 25 % là hằng số của `LiveHub` (`kAlarmHoldHighPct`, `kAlarmHoldLowPct`), ghi trong [data-model.md](../data-model.md) §4.
- Ước tính SC-018 (200 alarm cùng bật một tick, 10 client): một snapshot ≈ 70 KB, một `alarmDelta` ≈ 70 KB; chia ≤ 100 phần tử thì ≤ 35 KB mỗi bản; hàng đợi cao nhất ≤ 50 % nhờ ngưỡng gửi.

## 6. Mất đồng bộ và resync

- **Phát hiện:** client thấy `sequence` của `alarmDelta` khác `sequence` trước + 1 (trên kết nối TCP có thứ tự điều này chỉ xảy ra do lỗi phía máy chủ hoặc client; vẫn phải xử lý). Client **bỏ** bản tin, gửi lại `subscribeAlarms` với `requestId` mới, và hiện trạng thái `stale` cho tới khi có snapshot mới ([ui-alarm.md](ui-alarm.md) §1).
- Máy chủ **có thể** gửi `resync_required` (bản tin có sẵn của 1.0.0) khi biết phiên bị mất bản tin alarm; client xử lý bằng cách xin lại cả `subscribe` (Tag) lẫn `subscribeAlarms`. Bản 1.3.0 không dùng trường hợp này cho alarm (bảng chờ chặn tràn); giữ để mở rộng.
- **Mất kết nối:** `@mat/live-client` kết nối lại (backoff có sẵn); trạng thái alarm thành `stale` ngay lúc mất kết nối (bảng mờ, banner "Mất kết nối…"); sau `hello` mới client gửi lại `subscribeAlarms`; snapshot mới **thay hoàn toàn** trạng thái cũ (không còn hàng cũ, US1 kịch bản 10).
- Mã đóng 4401, 4409, 4429, 1012: như 1.2.0 (client giữ trạng thái `stale` rồi kết nối lại).

## 7. Đổi project, project không có alarm

- **Đổi project (nạp xuống, khôi phục):** runtime khởi động lại bằng `execv`; `CivetTransport::closeAllForRestart()` đóng mọi phiên bằng **1012** (như 1.1.0 §2). Không có thay đổi lớp hay khu vực **trong một phiên**: `classes` và `areas` cố định suốt phiên. Client kết nối lại, nhận `hello` mới (`features` có thể đổi), gửi lại `subscribeAlarms`, nhận `alarmSnapshot` **mới hoàn toàn** của project mới. Lần xảy ra của alarm bị xóa hoặc đổi định nghĩa đã được đóng ở `alarm.db` (dấu `config`, FR-023); client không thấy chúng nữa vì snapshot chỉ chứa instance hiện có.
- **Khởi động lại do sự cố** (`kill -9`, mất điện): như trên; `alarmSnapshot` đầu tiên sau khởi động chứa instance dựng lại từ `alarm.db` đã đánh giá lại với Tag (FR-022). Trong lúc động cơ chưa chạy tick đầu, máy chủ chưa gửi `alarmSnapshot` (đợi tick đầu, ≤ 250 ms) để client không thấy trạng thái dở.
- **Thiết bị không có alarm** (project không có `alarms.json`, hoặc 0.1 đến 0.4): `hello` không có `features.alarms`. `subscribeAlarms` vẫn được chấp nhận và nhận `alarmSnapshot` rỗng: `instances: []`, `classes: []`, `areas: []`, `counts` toàn số 0, `revision: 0`. Không có `alarmDelta` nào sau đó.
- **Runtime chưa có alarm** (< 0.8.0, giao thức < 1.3.0): xem §8.

## 8. Không có `ack` trên live

Xác nhận, tạm ẩn, vô hiệu **không** đi qua WebSocket (FR-048, D31): chỉ REST có kiểm role, CSRF và audit ([device-api-1.3.md](device-api-1.3.md)).

- Client gửi `{"type":"ack", …}` hoặc `{"type":"alarmAck", …}` (và bất kỳ loại không hỗ trợ nào khác): `error` `BAD_MESSAGE` ("type không hỗ trợ: ack") như mọi loại lạ (nhánh cuối của `LiveHub::onMessage`), tính vào chuỗi lỗi liên tiếp.
- Riêng hai loại `ack` và `alarmAck` gọi **móc audit** (cùng cơ chế `setRejectedWriteHook` của `write`): dòng `alarm.ack` `denied` mã `LIVE_ACK_NOT_ALLOWED`, `detail` có `id` và `occurrence` nếu đọc được (cắt ≤ 64 ký tự mỗi trường), kênh theo phiên live (như `LIVE_WRITE_NOT_ALLOWED` của `tag.write`). Dòng này đi qua `auditLimited` (gộp 60 s, tối đa 10 dòng/phút) để client lỗi không làm đầy `audit.db`.
- Bản tin `shelve`, `unshelve`, `disable`, `enable` trên live: chỉ `BAD_MESSAGE` (không audit riêng: không có dấu hiệu dò xác nhận ngoài `ack`; xem Điểm cần sửa spec).

## 9. Tương thích 1.2.0 ↔ 1.3.0

| Client | Máy chủ | Kết quả |
|---|---|---|
| 1.2.0 (trang runtime 0.6/0.7, Studio 0.5/0.6, `@mat/live-client` 1.2.0) | 1.3.0 | Không đăng ký alarm nên **không nhận bản tin alarm nào** (0 bản tin, 0 lỗi, SC-015). Bỏ qua trường `features` của `hello` (đọc `hello` theo từng trường đã biết). `protocolVersion` `1.3.0` có `major` = 1 nên `isCompatibleProtocol` chấp nhận. Tag, `reason`, 4401 chạy y như cũ |
| 1.3.0 (trang runtime 0.8, Studio 0.7) | 1.2.0 hoặc 1.1.0 | `hello` không có `features`, `protocolVersion` < `1.3.0`. Client **không gửi** `subscribeAlarms` (máy chủ cũ sẽ trả `BAD_MESSAGE` và có thể đóng 1008 sau chuỗi lỗi). Trạng thái alarm = `unsupported`: banner và trang Alarm hiện "Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)", không có huy hiệu, `AlarmSource.status()` = `unsupported` |
| 1.3.0 | 1.3.0, project không có alarm | `hello` không có `features.alarms`, `protocolVersion` ≥ 1.3.0: client coi là "không cấu hình alarm": không banner, không mục menu (US1 kịch bản 12), `status()` = `none`, **không** gửi `subscribeAlarms` (tiết kiệm một vòng tin) |
| 1.3.0 | 1.3.0, project có alarm | `hello.features` có `alarms`: client gửi `subscribeAlarms` ngay sau khi nhận `hello` (cùng lúc hoặc trước `subscribe` Tag) |

Quy tắc quyết định của client: `supportsAlarms = protocolVersion ≥ 1.3.0` (so MINOR) **và** `features` chứa `"alarms"`; `unsupported` = `protocolVersion` < 1.3.0; `none` = `protocolVersion` ≥ 1.3.0 và không có `alarms` trong `features`.

## 10. Test

- `server/websocket/tests/live_hub_test.cpp` (bản tin bằng `FakeTransport` có sẵn):
  - `hello` có `features:["alarms"]` khi có alarm, không có khi không; `protocolVersion` `1.3.0`;
  - `subscribeAlarms` thiếu `requestId`: `BAD_MESSAGE`; đăng ký lần hai thay bản đăng ký và gửi snapshot mới; giới hạn 5 lần/10 s;
  - `alarmSnapshot`: đủ trường §3.2, `instances` gồm shelved và disabled, bỏ `NORMAL` thường; rỗng khi không có alarm; chia mảnh khi > 100 instance (đủ `part`, `parts`, cùng `sequence`);
  - `alarmDelta`: `changed` đủ trường, `removed`, `counts`, `sequence` + 1, không gửi rỗng, gom cùng tick, ≤ 100 phần tử mỗi bản;
  - dồn: hàng đợi > 50 % thì không gửi, < 25 % thì gửi bảng chờ; bản mới thắng; `removed` thay `changed`; bất biến §4.1 trên chuỗi sự kiện ngẫu nhiên (hạt giống cố định) có và không dồn cho cùng trạng thái cuối;
  - 200 instance đổi trong một tick tới 10 phiên: 0 phiên tràn, hàng đợi cao nhất ≤ 50 % (SC-018);
  - `{"type":"ack"}` và `{"type":"alarmAck"}`: `BAD_MESSAGE` và gọi móc audit `LIVE_ACK_NOT_ALLOWED`; loại khác: chỉ `BAD_MESSAGE`;
  - phiên không đăng ký alarm không nhận `alarmDelta` (tương thích 1.2.0).
- `server/websocket/tests/civet_transport_test.cpp` (CivetWeb trong tiến trình): client 1.2.0 giả (không đăng ký alarm) nhận Tag đúng và 0 bản tin alarm khi alarm đổi; `closeAllForRestart` đóng 1012 phiên đã đăng ký alarm; đăng ký lại sau khi kết nối mới nhận snapshot mới; `alarmSnapshot` không vượt `maxMessageBytes` của máy chủ.
- `@mat/live-client` (`packages/live-client`): `subscribeAlarms`, gọi lại `onAlarmSnapshot`/`onAlarmDelta`; ghép mảnh; phát hiện `sequence` đứt thì xin lại snapshot; bỏ bản tin mang `subscriptionId` cũ; không gửi khi `unsupported` hoặc `none` (§9); mất kết nối thì `stale` rồi snapshot mới thay hoàn toàn; client không lỗi khi `hello` không có `features`.
- Rust `apps/studio/src-tauri/src/device/live.rs`: Studio Online 0.7 cần nhận bản tin alarm cho cột trạng thái sống. Nếu lớp Rust chuyển tiếp khung văn bản **nguyên văn** (không lọc theo `type`) thì chỉ cần test "bản tin `alarmSnapshot`/`alarmDelta` đi qua không đổi và `subscribeAlarms` từ giao diện được gửi đi"; nếu có danh sách loại bản tin thì thêm bốn loại mới và test tương ứng. Không thêm lệnh Tauri mới.
- `tools/alarm-it.ps1 -Scenario compat|storm|latency` ([quickstart.md](../quickstart.md) §3): client Node 1.2.0 giả, 10 client chậm, đo độ trễ DOM.

## Điểm cần sửa spec

- **`upToRevision`**: Đã xử lý trong spec (D42, FR-028: `revision` toàn cục của động cơ; mỗi instance có `rev`). [data-model.md](../data-model.md) §6 dùng cùng tên.
- **Tập instance của snapshot.** FR-046 ghi "mọi instance không ở `NORMAL` hoặc đang shelved"; Studio cần thấy cả instance `disabled` ở `NORMAL` (cột trạng thái sống). Hợp đồng này thêm "hoặc `disabled`". Đề nghị sửa FR-046.
- **Chia mảnh snapshot (`part`, `parts`):** Đã xử lý trong spec (FR-046: snapshot chia lô ≤ 100 hàng).
- **Audit bản tin `ack` trên live** kênh ghi: spec nói "audit `alarm.ack` denied `LIVE_ACK_NOT_ALLOWED`" mà không nêu `channel`; hợp đồng chọn như `LIVE_WRITE_NOT_ALLOWED`. Cần khớp [data-model.md](../data-model.md) §8.
