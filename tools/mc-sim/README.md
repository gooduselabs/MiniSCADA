# mc-sim — giả lập PLC Mitsubishi MC protocol (SLMP)

Giả lập Node (≥ 22, không gói ngoài) cho test của feature 017 (`specs/017-driver-mc/contracts/mc-protocol.md` §5). Chỉ dùng cho test: giữ bộ nhớ giống PLC, trả lời khung 3E/4E binary và ASCII trên cùng một cổng (TCP và UDP), và gây lỗi theo lệnh.

```
node tools/mc-sim/sim.mjs --tcp 5007 [--udp 5008] --control 5009 --map tools/mc-sim/maps/all-types.json \
     [--log requests.jsonl] [--host 0.0.0.0] [--control-host 127.0.0.1] [--frame 3E|4E|auto] [--code binary|ascii|auto]
```

- Nhận dạng khung theo byte đầu: `50 00` / `54 00` (binary), `5000` / `5400` (ASCII). TCP cắt khung theo trường độ dài; byte không thành khung thì đóng kết nối. UDP: một yêu cầu mỗi datagram.
- `--frame`/`--code`: chỉ trả lời loại khung đó (loại khác bỏ qua, đếm `badFrames`).
- Lệnh: 0401/0000, 0401/0001, 1401/0000, 1401/0001, 0403/0000. End code: số điểm sai `C051`, ngoài `size` `C056`, lệnh/lệnh con lạ `C059`, thiết bị không có trong bản đồ `C05C`, đơn vị bit trên thiết bị word `C05B`, độ dài dữ liệu sai `C061`, ký tự ASCII sai `C050`. Định tuyến không có trong `routes` (mặc định 0/255): không trả lời, có ghi log.

## Bản đồ (`maps/*.json`)

Định dạng ở đầu `map.mjs`: `xyNotation` (`hex`/`octal`, số X/Y trong khung ASCII), `routes`, `devices` (`size`, `values` có kiểu INT16…FLOAT64/INT64/UINT64/STRING hoặc `words` thô, `bits` trong word, `on` cho thiết bị bit), `scripts` (`everySecond`; thêm `"type": "FLOAT32"` trên thiết bị word: mỗi cặp word giữ một FLOAT32 hữu hạn đổi mỗi giây). Giá trị nhiều word: word thấp trước; STRING: ký tự đầu ở byte thấp. Số thiết bị dạng chuỗi đọc theo cách viết địa chỉ Tag (X/Y/B/W hex).

- `all-types.json`: mọi thiết bị và mọi kiểu của hợp đồng.
- `bench-500.json`: D0..D999 và M0..M999 đổi mỗi giây, D1100..D1199 là FLOAT32 đổi mỗi giây (đo 500 Tag).
- `it-all-types.json`: sinh bởi `tests/driver-it/make-mc-projects.mjs` cho driver-it MC (project `mc-all-types`).

## Cổng điều khiển HTTP (JSON)

| Lệnh | Nội dung |
|---|---|
| `GET /state` | `xyNotation`, `routes`, `devices` (`size`, `kind`), `faults`, `refusing`, `counters` |
| `GET /mem?device=D&at=100&count=4` | `{ values }` (word, hoặc điểm 0/1); `at` thập phân (X1A0 → `at=416`) |
| `GET /mem?device=D&at=100&type=INT32[&length=n]` | `{ value }` đọc theo kiểu |
| `POST /set` | `{ device, at, type?, length?, value \| values, bit? }`: có `type` ghi theo kiểu; không có: word thô hoặc điểm; `bit` 0–15 cho một bit trong word |
| `POST /fault` | `{ mode, code?, device?, from?, to?, at?, count?, delayMs?, bytes?, cmd?, transport?, frame?, encoding? }` |
| `DELETE /fault`, `GET /faults` | xóa mọi lỗi / xem lỗi đang chờ |
| `GET /counters` (= `GET /stats`) | `requests`, `responses`, `unanswered`, `badFrames`, `faults`, `byCommand` (`"0401"`), `endCodes` (`"C056"`), `connections`, `bytesIn`, `bytesOut`, `last` |
| `GET /log?since=<seq>` | `{ entries: [{ seq, ts, transport, frame, code, cmd, sub, serial?, device?, at?, points?, n?, m?, data?, route, endCode, result }] }`, cũng ghi vào `--log` |
| `POST /reset` | xóa lỗi, đếm, log (không xóa bộ nhớ) |

`mode` của `/fault`: `silent` (không trả lời), `close` (đóng TCP ở yêu cầu kế), `endcode` (`code` số hoặc chuỗi hex `"C056"`), `delay` (`delayMs`), `garbage` (byte ngẫu nhiên, byte đầu `FF`), `refuse` (ngừng nghe TCP, UDP im lặng) tới khi `none`/`clear`. `device` + `from`/`to` (hoặc `at`) giới hạn lỗi vào yêu cầu chạm vùng đó; `count` = số yêu cầu bị áp (mặc định không giới hạn). `cmd` (`"1401"`), `transport` (`tcp`/`udp`), `frame` (`3E`/`4E`), `encoding` (`binary`/`ascii`) giới hạn lỗi vào loại yêu cầu đó (ví dụ chỉ lệnh ghi, hoặc chỉ một kênh của runtime); `refuse` luôn áp cho cả giả lập.

Test: `node --test tools/mc-sim/*.test.mjs`.
