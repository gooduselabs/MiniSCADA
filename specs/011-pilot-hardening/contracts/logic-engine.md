# Contract: `logic.json` và ngữ nghĩa engine logic v2

**Feature**: [spec.md](../spec.md) FR-073 đến FR-096, SC-024 đến SC-029 · **ADR**: [037](../../../docs/adr/037-logic-v2.md) · Biểu thức: [006 expression-language](../../006-tags-modbus/contracts/expression-language.md)

Một ngữ nghĩa, hai bản cài (`packages/logic-engine` TS cho mô phỏng Studio, `core/logic` C++ cho runtime), cùng bộ vector `tests/logic-vectors/`. Hai bản phải cho cùng đầu ra và cùng hành động ở 100 % ca.

## 1. Tệp và khối

`project.json` thêm `"logic": "logic.json"` (tùy chọn). `logic.json` (≤ 512 KiB, UTF-8, không BOM):

```json
{
  "schemaVersion": "1.0.0",
  "writes": [
    { "id": "w_pump_run", "tag": "PUMP01.RUN_CMD", "allowed": { "values": [true, false] },
      "minIntervalMs": 30000, "maxPerHour": 20 }
  ],
  "rules": [
    { "id": "pump_low_level", "name": "Bơm tự bật khi mức thấp", "enabled": true,
      "when": "TANK01.LEVEL < 20", "hold": 10000, "fireOnStart": false, "repeatMs": 0,
      "onRise": [ { "do": "write", "write": "w_pump_run", "value": true } ],
      "onFall": [ ] },
    { "id": "pump_high_level", "when": "TANK01.LEVEL > 80", "hold": 5000,
      "onRise": [ { "do": "write", "write": "w_pump_run", "value": false } ] }
  ],
  "timers":   [ { "id": "t_start", "kind": "ton", "in": "PUMP01.RUN_CMD", "pt": 5000,
                  "q": "LOGIC.T_START.Q", "et": "LOGIC.T_START.ET" } ],
  "counters": [ { "id": "c_starts", "up": "PUMP01.RUN", "down": null, "reset": "LOGIC.RESET_DAILY.Q",
                  "preset": 1000, "value": "LOGIC.C_STARTS.VALUE", "reached": "LOGIC.C_STARTS.REACHED", "retain": true } ],
  "totalizers": [ { "id": "z_flow", "source": "FLOW01", "rateUnit": "h", "factor": 1.0, "cutoff": 0.05,
                    "maxGapMs": 5000, "reset": "LOGIC.RESET_DAILY.Q", "total": "LOGIC.FLOW01.TOTAL",
                    "gapSeconds": "LOGIC.FLOW01.GAP_S", "retain": true } ],
  "runhours": [ { "id": "h_pump", "run": "PUMP01.RUN", "reset": null, "serviceEveryHours": 500,
                  "hours": "LOGIC.PUMP01.HOURS", "starts": "LOGIC.PUMP01.STARTS", "due": "LOGIC.PUMP01.DUE", "retain": true } ],
  "schedules": [ { "id": "s_day", "tzOffsetMin": null, "weekly": [ { "days": [1,2,3,4,5,6], "from": "06:00", "to": "18:00" } ],
                   "exceptions": [ { "date": "2026-12-25", "mode": "off" } ], "out": "LOGIC.DAY.Q" },
                 { "id": "s_midnight", "weekly": [ { "days": [1,2,3,4,5,6,7], "from": "00:00", "to": "00:01" } ], "out": "LOGIC.RESET_DAILY.Q" } ]
}
```

- Id khối: `^[a-z][a-z0-9_]{0,47}$`, duy nhất trong toàn tệp (mọi loại khối chung một không gian id).
- Tag đầu ra (`q`, `et`, `value`, `reached`, `total`, `gapSeconds`, `hours`, `starts`, `due`, `out`): Tag id hợp lệ theo 006; **tự được khai** thành Tag nội bộ chỉ đọc (kiểu: `q`, `reached`, `due`, `out` BOOL; `et` INT64 ms; `value`, `starts` INT64; `total`, `hours`, `gapSeconds` FLOAT64); không được trùng Tag trong `tags.json` hay đầu ra khác (`E_LOGIC_TAG_COLLISION`). Đề xuất tiền tố `LOGIC.`.
- Các ô nhận biểu thức (`when`, `in`, `up`, `down`, `reset`, `run`, `source`) là biểu thức của ADR-015 (một tên Tag là biểu thức hợp lệ); kết quả BOOL cho `when`, `in`, `up`, `down`, `reset`, `run`; số cho `source`.
- Hành động `do`: `setTag` (`tag`, `value`), `toggle` (`tag`), `write` (`write`, `value`), `pulse` (`write`, `value`, `ms` 100 đến 10.000). `setTag` và `toggle` chỉ cho Tag nội bộ (kind `internal`) không phải Tag logic.
- `value` là hằng (BOOL, số, chuỗi) hoặc biểu thức một giá trị `{"expr": "TANK01.SP + 5"}`; kiểu phải khớp Tag đích.

## 2. Luật: ngữ nghĩa

Trạng thái luật: `OK`, `SUSPENDED`, `THROTTLED`, `DISABLED` (`enabled: false`).

Mỗi lần quét (chu kỳ `logic.scanMs`, thời gian monotonic `now`):

1. Tính `cond = eval(when)`; kết quả là `true`, `false` hoặc `unknown`. `unknown` khi: có Tag tham chiếu với quality BAD, STALE hoặc chưa có giá trị; biểu thức lỗi (chia 0, kiểu sai lúc chạy); khối lịch phụ thuộc có `TIME_NOT_SYNCED`.
2. `cond = unknown`: luật chuyển `SUSPENDED` (`reason` = `INPUT_BAD` hoặc `EXPR_ERROR` hoặc `TIME_NOT_SYNCED`); **đóng băng**: không đổi `stable`, không đếm `hold`, không hành động. Khi `cond` trở lại `true` hoặc `false`, luật trở về `OK` và tiếp tục **từ trạng thái trước khi bị treo** (không bắn cạnh giả); `hold` bắt đầu lại từ 0 nếu `cond` khác `stable`.
3. Bộ lọc giữ: `candidate = cond`; nếu `candidate != stable` thì cần `candidate` giữ liên tục `hold` ms (đồng hồ monotonic, tính từ quét đầu tiên thấy `candidate`) mới thành `stable`; `candidate` đổi lại trước hạn thì hủy. `hold = 0` thì thành `stable` ngay trong quét đó.
4. Cạnh: `stable` đổi `false → true` là cạnh **lên** (chạy `onRise`), `true → false` là cạnh **xuống** (chạy `onFall`). Lần quét hợp lệ đầu tiên sau khởi động đặt `stable` mà không bắn cạnh, trừ khi `fireOnStart: true` và `stable = true` (khi đó chạy `onRise` một lần).
5. `repeatMs > 0` (≥ 10.000): khi `stable = true`, chạy lại `onRise` mỗi `repeatMs` kể từ lần chạy trước (khôi phục khi PLC khởi động lại làm mất bit); không áp cho `onFall`.
6. Mỗi lần bắn có **mã cạnh** `edgeId` (đếm tăng đơn điệu theo luật, giữ trong `logic-state` mỗi khi `flush`); mỗi hành động ghi PLC của một `edgeId` thực hiện **tối đa một lần** (khử trùng lặp sau thất bại và khởi động lại: sau khởi động `edgeId` tiếp tục từ giá trị đã lưu cộng 1; cạnh dở dang trước lúc mất điện không bắn lại).
7. Hành động của một luật chạy tuần tự theo thứ tự khai báo trong cùng quét; hành động `write`/`pulse` đi vào `WriteCoordinator` (không chờ kết quả); kết quả `FAILED`/`REJECTED` ghi vào `lastError` của luật (không tự thử lại; `repeatMs` là đường duy nhất lặp lại).
8. Nhiều luật cùng quét: chạy theo thứ tự id tăng dần (ổn định, kiểm được). Hai luật ghi cùng Tag giá trị khác nhau trong cùng quét: cả hai chạy theo thứ tự đó, validator cảnh báo `W_LOGIC_WRITE_CONFLICT`.
9. `THROTTLED`: một hành động ghi bị `RATE_LIMITED` (theo `writes[].minIntervalMs`, `maxPerHour` hoặc `logic.maxWritesPerMin`); trạng thái giữ 60 s kể từ lần bị chặn gần nhất rồi về `OK`; hành động bị chặn **không** thử lại.

## 3. Timer

Đầu vào `in` BOOL; `pt` ms (≥ `scanMs`, nhỏ hơn thì làm tròn lên và cảnh báo `W_LOGIC_PT_ROUNDED`). `et` là thời gian trôi (ms, 0 đến `pt`, riêng `tp` 0 đến `pt`).

| Kiểu | Hành vi | `q` | `et` |
|---|---|---|---|
| `ton` (trễ bật) | `in` lên: bắt đầu đếm; `in` giữ `true` liên tục `pt`: `q = true`; `in` xuống: `q = false`, `et = 0` | `true` khi `in` đã giữ `≥ pt` | tăng từ 0 khi `in`, dừng ở `pt`; 0 khi `in = false` |
| `tof` (trễ tắt) | `in = true`: `q = true`, `et = 0`; `in` xuống: đếm; sau `pt`: `q = false`; `in` lên lại trước đó: hủy | `true` cho tới `pt` sau cạnh xuống | tăng từ 0 sau cạnh xuống tới `pt` |
| `tp` (xung) | cạnh lên của `in`: `q = true` đúng `pt` ms, **bất kể `in` đổi giữa chừng** (không kích lại khi đang chạy); hết `pt`: `q = false` | `true` trong `pt` | tăng từ 0 tới `pt` |

- `in` `unknown`: khối giữ nguyên trạng thái đầu ra và dừng đếm; đầu ra là **giá trị cuối** với quality GOOD nhưng `degraded = true` trong `GET /logic`; khi `in` lại bình thường thì tiếp tục (tránh kéo `q` sai khi mất dữ liệu).
- Timer không giữ qua tắt máy (về `q = false`, `et = 0`).
- Sai số: `q` đổi trong ≤ 1 chu kỳ quét + 20 ms so với lý thuyết.

## 4. Counter

- `up`: đếm mỗi **cạnh lên** của biểu thức `up` giữa hai quét liên tiếp (so giá trị quét trước và hiện tại). Cạnh nhanh hơn chu kỳ quét (lên rồi xuống giữa hai quét) có thể không thấy: giới hạn ghi rõ; nếu Tag có `quality`/dấu thời gian của driver thì **không** dùng để bù (YAGNI); khuyến nghị: dùng counter của PLC khi cần đếm xung nhanh (> 5 Hz).
- `down` (tùy chọn): cạnh lên giảm 1; `value` không âm (dừng ở 0).
- `reset`: cạnh lên của `reset` đặt `value = 0` và `reached = false`; cạnh lên của `up` cùng quét với `reset` bị bỏ.
- `reached = (value ≥ preset)`; `preset` ≥ 1 (hằng) hoặc `null` (không có `reached`).
- Tràn: `value` dừng ở `9223372036854775807` và đặt `overflow = true` trong `GET /logic`; không quay vòng.
- `up`/`down`/`reset` `unknown`: bỏ qua quét đó (không tạo cạnh), cập nhật mốc "trước" chỉ khi hợp lệ.
- `retain: true` (mặc định): giữ qua tắt máy (§8).

## 5. Totalizer (cộng dồn lưu lượng)

- Mỗi quét hợp lệ `k` có `rate_k` (từ `source`, đơn vị gốc theo `rateUnit` = `s`, `min`, `h`, `d`) và `t_k` monotonic.
- `dt = t_k - t_{k-1}` (giây). Nếu `source` `unknown` ở một trong hai quét, hoặc `dt > maxGapMs/1000`: **không cộng**; `gapSeconds += dt`; `t_{k-1}` cập nhật theo quét hiện tại.
- Ngược lại: `r_k = (rate_k < cutoff) ? 0 : rate_k` (và `r_{k-1}` tương tự), `total += factor * ((r_{k-1} + r_k) / 2) * dt / unitSeconds`, với `unitSeconds` = 1, 60, 3600, 86400.
- Tràn số: nếu tổng mới không hữu hạn (tốc độ hữu hạn nhưng rất lớn, ví dụ 1e308): **không cộng**, `gapSeconds += dt` như khoảng unknown; `total` luôn hữu hạn (quyết định khi fuzz T142).
- `reset`: cạnh lên đặt `total = 0`, `gapSeconds = 0`; `rolloverAt` (số, tùy chọn): khi `total ≥ rolloverAt` thì `total -= rolloverAt` (ví dụ đồng hồ cơ 99.999,9).
- Số học: `double`; thứ tự phép toán cố định (không FMA) như ADR-015, để TS và C++ trùng bit.
- Sai số: dòng hằng, quét đều: ≤ 0,1 % (thực tế ≤ sai số làm tròn); dòng đổi chậm hơn chu kỳ quét: sai số hình thang, ghi rõ.
- `retain: true`: giữ qua tắt máy; mất tối đa phần cộng dồn của một chu kỳ ghi.

## 6. Giờ chạy

- `run` BOOL. `hours` tăng khi `run = true` đúng thời gian monotonic trôi (giây / 3600); `starts` tăng mỗi cạnh lên; `due = (serviceEveryHours != null) && hours ≥ serviceEveryHours`.
- `reset` (cạnh lên): đặt `hours = 0`, `due = false`; `starts` giữ (đặt lại bằng `POST /logic/reset`).
- `run` `unknown`: không cộng, không đếm; khoảng đó không bù.
- Không bao giờ giảm trừ khi `reset` hoặc `POST /logic/reset`.

## 7. Lịch

- Khung: `days` (1 là thứ Hai … 7 là Chủ nhật), `from`, `to` kiểu `HH:MM` (24 giờ), nửa mở `[from, to)`; `from > to` nghĩa là qua nửa đêm (khung thuộc ngày bắt đầu); `from = to` là lỗi (`E_LOGIC_SCHEDULE`).
- Ngoại lệ: `{"date": "YYYY-MM-DD", "mode": "on"|"off"}` đè kết quả của ngày đó (`on` là cả ngày bật, `off` cả ngày tắt).
- Giờ địa phương = UTC + `tzOffsetMin` (của khối nếu có, không thì của `runtime.json`). Không DST. Đồng hồ thực (`CLOCK_REALTIME`) chỉ dùng ở khối này.
- `timeSynced = false` (không có NTP/RTC đáng tin, theo cờ của `system/info.timeSynced`): đầu ra là **BAD** (`TIME_NOT_SYNCED`), luật phụ thuộc `SUSPENDED`.
- Đầu ra cập nhật tại biên (độ phân giải 1 quét).
- Giới hạn: ≤ 16 khung và ≤ 64 ngoại lệ mỗi lịch.

## 8. Ghi từ logic (`writes`)

- `allowed`: `{"values": [...]}` (danh sách giá trị) hoặc `{"min": a, "max": b}` (số); giá trị của hành động (hằng) phải thuộc `allowed` lúc kiểm tra; giá trị là biểu thức bị kẹp/chặn lúc chạy: ngoài `allowed` thì `REJECTED` `OUT_OF_LIMITS` và luật `lastError`.
- `minIntervalMs` 1.000 đến 86.400.000, `maxPerHour` 1 đến 3.600 (T062): bộ chặn theo mục `writes` (cửa sổ trượt 1 giờ). Vượt số mục mỗi mảng (§11) thì bộ kiểm chỉ báo `E_LOGIC_LIMIT` và dừng, không dựng đồ thị.
- `logic.maxWritesPerMin` (mặc định 20): bộ chặn toàn thiết bị (token bucket).
- `logic.writes = off` (cấu hình) hoặc đã dừng bởi administrator: `suppressed`, không gửi gì, audit `logic.write.suppressed` (gộp 60 s). Lệnh dừng của administrator áp cả cho lệnh đã xếp hàng chờ dispatcher (`suppressed`, `detail.queued: true`) và lệnh đang giao (kiểm lại ngay trước khi vào WriteCoordinator); lệnh đã vào WriteCoordinator thì chạy hết (T062).
- Chuỗi kiểm của 006 áp nguyên vẹn (Tag RW, giới hạn Tag, kết nối, hàng đợi) cộng audit bền trước khi gửi; `actor = "logic:<ruleId>"`, `channel = "logic"`.
- `pulse` đi qua cùng nhật ký xung (FR-018) và phục hồi (FR-019); `repeatMs` không áp cho xung đang chờ.
- Operator không bị chặn ghi cùng Tag (không phân xử): tài liệu nêu rõ.

## 9. Lưu trạng thái (`retain`)

- Dùng `RetainStore` của 006 (ghi tạm, fsync, đổi tên): khóa `logic/<id>/<trường>`; ghi mỗi `logic.flushS` khi có thay đổi, và khi dừng có kiểm soát (SIGTERM), không ghi khi chưa thay đổi.
- Giá trị lưu: counter (`value`, `overflow`), totalizer (`total`, `gapSeconds`), giờ chạy (`hours`, `starts`), `edgeId` mỗi luật, mốc `lastFired`.
- Phục hồi: đọc ở khởi động; nếu giá trị đọc được **nhỏ hơn** giá trị đã thấy trong lần chạy này (không xảy ra khi khởi động) thì bỏ qua; retain hỏng hoặc thiếu: khởi động về 0, cảnh báo `LOGIC_RETAIN_LOST`, audit `logic.retain.lost` một lần.
- Đồng hồ khởi động lại: mọi mốc monotonic đặt lại; `hold` và timer bắt đầu từ 0.
- Ước tính ghi đĩa/ngày (validator): `(số khối retain × 24 B + 512 B) × (86400 / flushS)` cộng 4 KiB mỗi lần ghi tệp; cảnh báo `W_LOGIC_RETAIN_IO` khi > 100 MB/ngày.

## 10. Thứ tự quét và độc lập chu kỳ

- Đồ thị phụ thuộc: nút = khối; cạnh từ khối `A` sang khối `B` khi biểu thức của `B` tham chiếu một đầu ra của `A`. Sắp xếp tô-pô ổn định (theo id khi hòa). Vòng: `E_LOGIC_CYCLE`.
- Đầu vào là Tag thiết bị hoặc nội bộ (giá trị tại thời điểm bắt đầu quét: một ảnh chụp thống nhất qua một lần khóa của Tag Engine, như 006).
- Hành động `setTag` của luật làm thay đổi Tag nội bộ: có hiệu lực ở **quét sau**; luật đọc chính Tag đó trong `when` là `E_LOGIC_SELF_TRIGGER` (kể cả gián tiếp qua khối khác).
- Một quét ≤ 5 ms ở cấu hình tối đa trên BL335 (FR-095); quét vượt `scanMs` làm quét sau bị trễ (không dồn), đếm `overrun` trong `GET /logic.scan`.

## 11. Mã lỗi `E_LOGIC_*`

| Mã | Khi |
|---|---|
| `E_LOGIC_LIMIT` | vượt giới hạn số khối, độ dài, số hành động, kích thước tệp |
| `E_LOGIC_ID` | id sai dạng hoặc trùng |
| `E_LOGIC_TAG_REF` | tham chiếu Tag không có |
| `E_LOGIC_TYPE` | kiểu biểu thức hoặc Tag không đúng (ví dụ `when` không phải BOOL) |
| `E_LOGIC_EXPR` | biểu thức không hợp lệ (cú pháp, hàm, độ sâu) |
| `E_LOGIC_TAG_COLLISION` | đầu ra trùng Tag có sẵn hoặc đầu ra khác |
| `E_LOGIC_CYCLE` | vòng phụ thuộc (kèm đường đi) |
| `E_LOGIC_SELF_TRIGGER` | luật đọc Tag do hành động của chính nó đặt |
| `E_LOGIC_WRITE_UNDECLARED` | hành động ghi tham chiếu `writes` không có |
| `E_LOGIC_WRITE_TARGET` | Tag của `writes` không phải Tag thiết bị RW |
| `E_LOGIC_WRITE_VALUE` | giá trị hằng ngoài `allowed` hoặc sai kiểu |
| `E_LOGIC_ACTION` | hành động không có trong danh sách, hoặc `setTag`/`toggle` vào Tag không phải nội bộ |
| `E_LOGIC_TIMER` | `pt` ≤ 0 hoặc quá lớn (> 86.400.000), `kind` lạ |
| `E_LOGIC_COUNTER` | `preset` không hợp lệ |
| `E_LOGIC_TOTALIZER` | `rateUnit` lạ, `factor` ≤ 0 hoặc không hữu hạn, `cutoff` < 0 |
| `E_LOGIC_SCHEDULE` | `from = to`, ngày lạ, ngoại lệ sai |
| `E_LOGIC_VERSION` | `schemaVersion` mới hơn mức hiểu |

Cảnh báo `W_LOGIC_*`: `W_LOGIC_PT_ROUNDED`, `W_LOGIC_WRITE_CONFLICT`, `W_LOGIC_RETAIN_IO`, `W_LOGIC_WRITES_OFF` (project có ghi từ logic, thiết bị đích đang `off`; Studio), `W_LOGIC_NO_HOLD` (luật `hold = 0` ghi xuống PLC từ Tag có thể nhiễu), `W_LOGIC_DISABLED`.

## 12. Vector chung `tests/logic-vectors/`

Mỗi ca là một tệp JSON:

```json
{
  "id": "rule-hold-basic",
  "doc": { "...": "nội dung logic.json" },
  "tags": { "TANK01.LEVEL": { "type": "FLOAT64", "writable": false }, "PUMP01.RUN_CMD": { "type": "BOOL", "writable": true } },
  "config": { "scanMs": 100, "tzOffsetMin": 420, "writes": "on", "maxWritesPerMin": 20 },
  "steps": [
    { "t": 0,    "set": { "TANK01.LEVEL": 50 } },
    { "t": 1000, "set": { "TANK01.LEVEL": 19 } },
    { "t": 10900, "expect": { "actions": [] } },
    { "t": 11100, "expect": { "actions": [ { "do": "write", "write": "w_pump_run", "tag": "PUMP01.RUN_CMD", "value": true } ] } }
  ],
  "expectState": { "blocks": { "pump_low_level": "OK" } },
  "expectErrors": []
}
```

- `t` ms monotonic từ 0; `set` đặt Tag (có thể kèm `quality`); `wall` đặt giờ thực (ISO 8601 với offset) cho lịch; `timeSynced` đặt cờ; `expect` kiểm hành động phát sinh **kể từ bước trước** và giá trị đầu ra tại bước đó.
- Ca lỗi: `expectErrors` là danh sách mã `E_LOGIC_*` (cả hai validator phải trả đúng tập mã).
- Hai bản chạy cùng `steps` bằng đồng hồ giả; so sánh từng `expect`.
- Phân bố tối thiểu của ≥ 200 ca: luật 40, timer 30, counter 25, totalizer 25, giờ chạy 15, lịch 40, ghi và giới hạn 15, kiểm tra tĩnh (lỗi) 30 (mỗi mã `E_LOGIC_*` ≥ 1 ca đúng, 1 ca sai), retain 10 (mô phỏng khởi động lại bằng `restart` trong `steps`).
