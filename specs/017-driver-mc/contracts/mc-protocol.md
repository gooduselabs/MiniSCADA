# Hợp đồng: khung MC protocol (SLMP) của driver và giả lập (feature 017)

Nguồn: cấu trúc khung theo tài liệu công khai của Mitsubishi (SLMP Reference Manual SH-080956ENG; MELSEC Communication Protocol Reference Manual SH-080008). Driver C++ (`drivers/mc/`) và giả lập Node (`tools/mc-sim/`) cài **cùng** hợp đồng này; vector byte ở `tests/mc-vectors/frames.json`.

## 1. Thiết bị (mã 1 byte, số 3 byte: lệnh con Q/L)

| Thiết bị | Mã (binary) | ASCII | Loại | Số viết (địa chỉ Tag) | Số trong ASCII |
|---|---|---|---|---|---|
| SM | 0x91 | `SM` | bit | thập phân | thập phân |
| SD | 0xA9 | `SD` | word | thập phân | thập phân |
| X | 0x9C | `X*` | bit | hex (bát phân nếu `xyNotation: octal`) | như địa chỉ |
| Y | 0x9D | `Y*` | bit | hex (bát phân nếu `octal`) | như địa chỉ |
| M | 0x90 | `M*` | bit | thập phân | thập phân |
| L | 0x92 | `L*` | bit | thập phân | thập phân |
| B | 0xA0 | `B*` | bit | hex | hex |
| D | 0xA8 | `D*` | word | thập phân | thập phân |
| W | 0xB4 | `W*` | word | hex | hex |
| TN | 0xC2 | `TN` | word (giá trị hiện tại timer) | thập phân | thập phân |
| CN | 0xC5 | `CN` | word (giá trị hiện tại counter) | thập phân | thập phân |
| R | 0xAF | `R*` | word | thập phân | thập phân |
| ZR | 0xB0 | `ZR` | word | thập phân (như GX Works) | hex |

Số thiết bị trên dây (binary) là giá trị số: `X1F` (hex) = 31, `X17` (octal) = 15, `ZR1000` = 1000. Số tối đa 0xFFFFFF.

## 2. Khung binary (mọi số nhiều byte là little-endian)

### 2.1 Yêu cầu 3E

| Offset | Cỡ | Trường | Giá trị |
|---|---|---|---|
| 0 | 2 | subheader | `50 00` |
| 2 | 1 | network no | thiết bị `network` (mặc định 0) |
| 3 | 1 | PC no | thiết bị `station` (mặc định 255 = 0xFF) |
| 4 | 2 | module I/O no | thiết bị `moduleIo` (mặc định 0x03FF → `FF 03`) |
| 6 | 1 | module station no | thiết bị `moduleStation` (mặc định 0) |
| 7 | 2 | request data length | số byte từ offset 9 tới hết |
| 9 | 2 | monitoring timer | đơn vị 250 ms: `max(1, (timeoutMs - 250) / 250)` |
| 11 | 2 | command | |
| 13 | 2 | subcommand | |
| 15 | n | request data | |

### 2.2 Trả lời 3E

| Offset | Cỡ | Trường |
|---|---|---|
| 0 | 2 | `D0 00` |
| 2 | 5 | network, PC, module I/O (2), module station: **bằng** yêu cầu (khác: khung không phải của yêu cầu này, đếm `unit`) |
| 7 | 2 | response data length = 2 + số byte sau end code |
| 9 | 2 | end code |
| 11 | n | dữ liệu (end code 0) hoặc thông tin lỗi 9 byte (network, PC, module I/O 2, station, command 2, subcommand 2) |

Trả lời có end code 0 mà độ dài dữ liệu khác độ dài lệnh đòi: khung sai (`length`). End code ≠ 0: độ dài dữ liệu tùy ý (giả lập gửi 9 byte thông tin lỗi; driver không đòi).

### 2.3 Khung 4E

Yêu cầu: `54 00` + serial (2, LE) + `00 00`, rồi các trường 3E từ offset 2 trở đi (dịch +4). Trả lời: `D4 00` + serial + `00 00` + phần 3E. Driver tăng serial mỗi yêu cầu (bắt đầu ngẫu nhiên), bỏ trả lời có serial khác (đếm `tid`; serial của yêu cầu đã timeout thì bỏ im lặng như Modbus).

### 2.4 Lệnh

| Lệnh | Lệnh con | Dữ liệu yêu cầu | Dữ liệu trả lời |
|---|---|---|---|
| 0401 Batch Read word | 0000 | số thiết bị (3) + mã (1) + số điểm (2) | điểm × 2 byte (word LE); với thiết bị bit: mỗi word 16 điểm, điểm đầu ở bit 0 |
| 0401 Batch Read bit | 0001 | như trên | ceil(điểm / 2) byte; mỗi byte 2 điểm, điểm đầu ở **nibble cao** (`0x10` = điểm đầu ON) |
| 1401 Batch Write word | 0000 | thiết bị + mã + điểm + điểm × 2 byte | không |
| 1401 Batch Write bit | 0001 | thiết bị + mã + điểm + ceil(điểm/2) byte nibble | không |
| 0403 Random Read | 0000 | số điểm word n (1) + số điểm dword m (1) + n × (số 3 + mã 1) + m × (số 3 + mã 1) | n × 2 byte rồi m × 4 byte (LE; dword: word thấp ở số thiết bị nhỏ) |

Giới hạn (Q/L, cũng là trần schema): 0401/1401 word ≤ 960 điểm; bit ≤ 7168 điểm; 0403 n + m ≤ 192 (n, m ≥ 0, n + m ≥ 1). Vượt: end code `C051`.

Thiết bị bit đọc theo word (0401/0000, 0403 word): số đầu là bội 16 (driver làm tròn xuống).

## 3. Khung ASCII

Mọi trường viết bằng chữ hex in hoa, **big-endian dạng chữ** (giá trị 0x03FF → `03FF`):

- 3E yêu cầu: `5000` + network `00` + PC `FF` + module I/O `03FF` + station `00` + độ dài 4 chữ (số **ký tự** từ timer tới hết) + timer 4 chữ + command 4 chữ + subcommand 4 chữ + dữ liệu.
- Thiết bị trong dữ liệu: mã ASCII 2 ký tự (§1) + số 6 ký tự (thập phân, hex hay bát phân theo cột "Số trong ASCII", đệm `0` bên trái) + số điểm 4 chữ hex.
- Dữ liệu word: 4 chữ hex mỗi word (`0102` = 0x0102). Dữ liệu bit (lệnh con 0001): 1 ký tự `0`/`1` mỗi điểm. Random Read: n, m mỗi số 2 chữ hex; dword 8 chữ hex.
- 3E trả lời: `D000` + 10 ký tự định tuyến + độ dài 4 chữ (số ký tự từ end code tới hết) + end code 4 chữ + dữ liệu.
- 4E: yêu cầu `5400` + serial 4 chữ + `0000` + phần 3E sau subheader; trả lời `D400` + serial + `0000` + phần 3E.

Ký tự ngoài `0-9A-F` (trừ mã thiết bị, `*`) trong trả lời: khung sai (`format`).

## 4. End code → lý do quality

| End code | Lý do | Ghi chú |
|---|---|---|
| 0xC051–0xC054, 0xC056, 0x4030, 0x4031 | `MC_END_RANGE` | số điểm hoặc địa chỉ ngoài vùng; khối ≥ 2 Tag thì chia (như exception 02 Modbus); Random Read ≥ 2 điểm thì tách thành Batch Read |
| 0xC05B, 0xC05C, 0xC060 | `MC_END_DEVICE` | thiết bị không đọc/ghi được, chỉ định sai |
| 0xC050, 0xC058, 0xC059, 0xC05F, 0xC061, 0xC06F | `MC_END_COMMAND` | lệnh, lệnh con, độ dài, binary/ASCII không khớp cấu hình PLC |
| khác | `MC_END_OTHER` | |

Chẩn đoán (`exceptions`) đếm theo giá trị end code; Studio hiện hex (`C056`).

## 5. Giả lập `tools/mc-sim`

- `node tools/mc-sim/sim.mjs --tcp <port> [--udp <port>] --control <port> --map <file> [--log <jsonl>] [--host h] [--control-host h] [--frame 3E|4E|auto] [--code binary|ascii|auto]`. Mặc định nhận cả 3E và 4E, binary và ASCII (nhận dạng theo byte đầu: `50 00`, `54 00`, `5000`, `5400`).
- Bản đồ JSON (`tools/mc-sim/map.mjs`): `xyNotation`, `routes` (mặc định chỉ mạng 0 trạm 255; định tuyến khác: không trả lời), `devices` (`size`, `values` theo kiểu, `words`, `bits` trong word, `on` cho thiết bị bit), `scripts` (`everySecond`). Ngoài `size`: `C056`; thiết bị không có trong bản đồ: `C05C`; số điểm sai: `C051`; lệnh lạ: `C059`; đơn vị bit trên thiết bị word: `C05B`.
- Cổng điều khiển HTTP và log: [tools/mc-sim/README.md](../../../tools/mc-sim/README.md) (`/state`, `/mem`, `/set`, `/fault` với `silent|close|endcode|delay|garbage|refuse|none|clear`, `/counters`, `/log`, `/reset`).
