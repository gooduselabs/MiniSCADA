# Hợp đồng: driver Siemens S7 (016)

Nguồn công khai dùng để dựng khung: RFC 1006 (TPKT), ISO 8073 / RFC 905 (COTP lớp 0), bộ phân tích S7comm của Wireshark (`packet-s7comm.c`, wiki "S7comm") và tài liệu công khai của Snap7 (bố cục khung, mã lỗi). Không chép mã nguồn nào.

## 1. Kết nối (connections.json, định dạng 1.1)

```json
{
  "id": "s7-1", "name": "PLC S7-1200", "kind": "s7", "enabled": true, "requestGapMs": 0,
  "tcp": { "host": "192.168.0.10", "port": 102, "connectTimeoutMs": 3000, "reconnectMaxS": 10 },
  "s7": { "rack": 0, "slot": 1, "pduSize": 480 },
  "devices": [ { "id": "cpu1", "name": "CPU 1214C", "timeoutMs": 1000, "retries": 0,
                 "writeDeadlineMs": 5000, "maxGapBytes": 16, "enabled": true } ]
}
```

- `s7.rack` 0–7 (mặc định 0), `s7.slot` 0–31 (mặc định 1), `s7.localTsap`, `s7.remoteTsap`: chuỗi `^[0-9A-Fa-f]{4}$`. `s7.pduSize` 240–960 (mặc định 480). `s7` có thể vắng (mọi giá trị mặc định).
- TSAP: local = `localTsap` hoặc `0x0100`; remote = `remoteTsap` hoặc `0x0100 | (rack << 5) | slot` (kiểu PG).
- Luật `E_S7_TSAP`: `remoteTsap` cùng với `rack` hoặc `slot`. Đường dẫn `/channels/<i>/s7/remoteTsap`.
- Luật `E_DRIVER_VERSION`: kênh `kind: "s7"` trong project 1.0. Đường dẫn `/channels/<i>/kind`, tệp connections.
- `devices`: 0 hoặc 1 phần tử (schema `maxItems: 1`). `timeoutMs` 100–10000 (1000), `retries` 0–5 (0), `writeDeadlineMs` 1000–60000 (5000), `maxGapBytes` 0–256 (16).
- Cảnh báo `W_DETECT_SLOW` áp như Modbus TCP (retries mặc định 0).

## 2. Địa chỉ Tag

Ngữ pháp (không phân biệt hoa/thường; không khoảng trắng):

```
s7-address = "DB" num "." db-item / area area-item
db-item    = "DBX" num "." bit / "DBB" num / "DBW" num / "DBD" num / "STRING" num / "LREAL" num
area       = "M" / "I" / "E" / "Q" / "A"
area-item  = num "." bit / "B" num / "W" num / "D" num
num        = 1*5DIGIT   ; DB 1–65535, byte 0–65535
bit        = DIGIT      ; 0–7
```

| Dạng | rawType | Kiểu S7 | Byte |
|---|---|---|---|
| bit (`DBX`, `Mb.x`, `Ib.x`, `Qb.x`) | BOOL | BOOL | 1 bit |
| `B` | UINT16 | BYTE | 1 |
| `B` | STRING (`stringLength` n) | CHAR (n = 1) / ARRAY OF CHAR | n |
| `W` | INT16 / UINT16 | INT / WORD | 2 |
| `D` | INT32 / UINT32 / FLOAT32 | DINT / DWORD / REAL | 4 |
| `LREAL` (chỉ DB) | FLOAT64 | LREAL | 8 |
| `STRING` (chỉ DB) | STRING (`stringLength` n ≤ 250) | STRING[n] | n + 2 |

Thứ tự kiểm và mã: không khớp ngữ pháp → `E_ADDR_SYNTAX`; DB 0, số > 65535, bit 8–9 → `E_ADDR_RANGE`; rawType không có trong bảng → `E_ADDR_AREA`; `access: RW` ở vùng I → `E_ADDR_AREA`; byte + cỡ > 65536 → `E_ADDR_RANGE`. Chuẩn hóa: chữ hoa, `E`→`I`, `A`→`Q`, số không có số 0 đầu (`db01.dbw002` → `DB1.DBW2`).

Kết quả: `{ ok, normalized, area: "DB"|"I"|"Q"|"M", db (0 ngoài DB), byte, bit (null nếu không phải bit), s7Type, size (byte; bit = 1) }`.

Giới hạn PDU (luật kiểm project, `pduSize` cấu hình): cỡ đọc > `pduSize − 18` → `E_ADDR_READ_LIMIT` (`/tags/<i>/source`); Tag RW có cỡ ghi > `pduSize − 28` → `E_ADDR_WRITE_LIMIT` (cỡ ghi: bit 1, STRING n + 1, còn lại = cỡ). `source.byteOrder`, `source.stringByteOrder` trên Tag của thiết bị S7 → `E_SCHEMA` (`/tags/<i>/source/byteOrder`).

## 3. Khung

Mọi số nhiều byte là big-endian. Một khung S7 = TPKT `03 00 LLLL` (LLLL = cả khung) + COTP DT `02 F0 80` + PDU S7. "PDU" dưới đây tính từ byte `32`, phải ≤ PDU đã thương lượng.

- **COTP CR** (22 byte): `03 00 00 16 11 E0 00 00 00 01 00 C0 01 0A C1 02 <local> C2 02 <remote>`. **CC**: loại `D0` (nửa cao `D`); tham số bỏ qua. **DR** (`80`) hay loại khác → từ chối (`S7_CONNECT_REJECTED`).
- **Setup Communication** (Job): `32 01 00 00 <ref> 00 08 00 00 F0 00 00 01 00 01 <pdu>`. Trả lời Ack_Data: `32 03 00 00 <ref> 00 08 00 00 <eclass> <ecode> F0 00 <amqCaller> <amqCallee> <pdu>`. PDU dùng = min(xin, trả lời); lỗi đầu khung hoặc PDU trả lời < 240 → `S7_SETUP_FAILED`.
- **Read Var** (Job): `32 01 00 00 <ref> <plen=2+12N> 00 00 04 <N>` + N item `12 0A 10 <ts> <len> <db> <area> <addr3>`; `ts` 01 (BIT, len 1) hoặc 02 (BYTE, len = số byte); `area` 81 I, 82 Q, 83 M, 84 DB; `addr3` = byte·8 + bit. N ≤ 20; 12 + 12N ≤ PDU.
  Trả lời: `32 03 00 00 <ref> 00 02 <dlen> <eclass> <ecode> 04 <N>` + mỗi item `<rc> <ts> <len> <data>` và một byte đệm 00 sau data lẻ trừ item cuối. `rc` FF = tốt; `ts` 03/04/05: `len` tính bằng bit (byte = ⌈len/8⌉), 06/07/09: tính bằng byte; item lỗi: `<rc> 00 00 00`. Kích thước: 14 + Σ(4 + nᵢ + đệm) ≤ PDU.
- **Write Var** (Job, một item): `32 01 00 00 <ref> 00 0E <dlen=4+n> 05 01 12 0A 10 <ts> <len> <db> <area> <addr3> 00 <dts> <dlen> <data>`; bit: `ts` 01, `dts` 03, dlen 1 (bit); byte: `ts` 02 len n, `dts` 04, dlen n·8. Kích thước 28 + n ≤ PDU. Trả lời: `32 03 00 00 <ref> 00 02 00 01 <eclass> <ecode> 05 01 <rc>`.
- Trả lời lỗi đầu khung: ROSCTR 02 hoặc 03 với `eclass`/`ecode` ≠ 0 (có thể không có tham số). Trả lời có `ref` khác yêu cầu đang chờ: bỏ, đếm `badFrames.tid`. Khung TPKT sai phiên bản, độ dài < 7 hay > 4096, COTP không phải DT, S7 không bắt đầu `32`: lỗi khung (đóng kết nối, `BAD_FRAME`). DT không có cờ EOT được ghép với DT sau.

## 4. Kế hoạch đọc

Cho mỗi (nhóm quét, vùng, DB): khoảng byte của Tag `[byte, byte + size)` (bit: `[byte, byte+1)`), gộp bằng `planBlocks` của SDK với `maxGap = maxGapBytes`, `maxLen = PDU − 18`. Các khoảng (item) xếp vào yêu cầu theo thứ tự (vùng, DB, byte), mở yêu cầu mới khi thêm item làm vượt 20 item, 12 + 12N > PDU, hoặc 14 + Σ(4 + nᵢ + 1) > PDU. Mỗi yêu cầu là một "block" của Scheduler. Item trả `05`/`0A` có ≥ 2 Tag: tách bằng `splitBlock`, xếp lại yêu cầu của vòng đó; một Tag: Tag đó BAD.

## 5. Mã lỗi

| Nguồn | Lý do quality / mã |
|---|---|
| item `01` | `S7_HARDWARE_FAULT` |
| item `03` | `S7_ACCESS_DENIED` (DB "optimized" hoặc bảo vệ) |
| item `05` | `S7_ADDRESS_OUT_OF_RANGE` |
| item `06` | `S7_TYPE_NOT_SUPPORTED` |
| item `07` | `S7_TYPE_INCONSISTENT` |
| item `0A` | `S7_OBJECT_NOT_FOUND` (DB không có) |
| item khác | `S7_ITEM_ERROR` |
| đầu khung `81 04` | `S7_FUNCTION_NOT_AVAILABLE` (thường do chưa bật PUT/GET) |
| đầu khung khác | `S7_REQUEST_ERROR` |
| Tag lớn hơn PDU đã thương lượng | `S7_PDU_TOO_SMALL` |
| COTP bị từ chối | lỗi kênh và lý do Tag `S7_CONNECT_REJECTED` |
| Setup Communication lỗi | lỗi kênh và lý do Tag `S7_SETUP_FAILED` |

Mã kết nối TCP, `TIMEOUT`, `DISCONNECTED`, `BAD_FRAME`, `DISABLED` như Modbus. Ghi: `DEVICE_EXCEPTION` với `exception` = mã item (hoặc `eclass·256 + ecode` của lỗi đầu khung), các mã còn lại như Modbus (data-model §8 của 006). Chẩn đoán: `exceptions` theo cùng số đó, khóa hex như Modbus (`03`, `0A`; lỗi đầu khung 4 chữ số: `8104`); `channel.details` = `{ pduSize, localTsap, remoteTsap }` sau khi kết nối.

## 6. Giả lập (`tools/s7-sim`)

`node tools/s7-sim/sim.mjs --tcp 102 --control 1503 --map <map.json> [--control-host 0.0.0.0] [--log requests.jsonl]`.

Bản đồ:

```json
{
  "pduSize": 480,
  "tsap": { "remote": "0101" },
  "areas": {
    "DB1": { "size": 512, "data": [ { "byte": 0, "bit": 0, "type": "BOOL", "value": true },
                                      { "byte": 10, "type": "STRING", "maxLength": 20, "value": "Bơm 1" } ] },
    "M": { "size": 256 }, "I": { "size": 64 }, "Q": { "size": 64 }
  },
  "denied": ["DB3"],
  "putGetDisabled": false
}
```

Kiểu của `data`: BOOL (`bit`), BYTE, CHAR (`value` chuỗi, mỗi ký tự một byte Latin-1), INT, WORD, DINT, DWORD, REAL, LREAL, STRING (`maxLength`). DB không có → item `0A`; ngoài `size` → `05`; DB trong `denied` → `03`; `putGetDisabled` → lỗi đầu khung `81 04` cho Read/Write Var. `tsap.remote` có mà khác TSAP của CR → trả DR. PDU = min(xin, `pduSize`).

Điều khiển (HTTP JSON, như modbus-sim): `POST /fault {kind: silent|close|delay|garbage|refuse|putget, count?, delayMs?}`, `DELETE /fault`, `GET /counters` (`connections`, `requests`, `byFunction`, `items`, `maxRequestPdu`, `maxResponsePdu`, `pduSize`, `errors`), `GET /log?since=<seq>`, `POST /set {area, byte, type, bit?, maxLength?, value}`, `GET /mem?area=&byte=&count=` (hex), `POST /reset`.
