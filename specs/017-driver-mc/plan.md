# Implementation Plan: Driver Mitsubishi MC protocol (SLMP)

**Branch**: `017-driver-mc` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md) | **Khung**: [contracts/mc-protocol.md](contracts/mc-protocol.md)

## Summary

Driver C++17 tự viết `drivers/mc/` theo khuôn `ModbusTcpDriver`: một luồng mỗi kênh, lịch quét `Scheduler`, gom khối `planBlocks`/`splitBlock`, `DiagCounters`, `Backoff`, `Transport` (TCP của SDK, thêm UDP). Codec thuần (`mc_address`, `mc_frame`) dùng chung cho validator C++ (`mat_mc_codec` trong `mat_core`). TS: `@mat/tag-codec` thêm `parseMcAddress` cùng vector `tests/mc-vectors/address.json`; `project-schema` thêm luật MC ở `rules-mc.ts` (gọi từ `rules-02.ts`), C++ `rules_mc.cpp` (gọi từ `rules_02.cpp`). Runtime: `mc_factory` tạo driver cho kênh `mc`; `RuntimeEngine` giữ thêm danh sách driver MC, định tuyến ghi theo `drv::Driver*`. Giả lập Node `tools/mc-sim`; driver-it riêng `tools/driver-it-mc.ps1` (rig `mat-mc-it`, mạng 172.30.17.0/24). Studio: kênh MC, editor, địa chỉ, chẩn đoán.

## Technical Context

- C++17, CMake + Ninja, gtest; TypeScript (Vitest), Node 22 (giả lập, driver-it); JSON Schema draft-07.
- Không thêm thư viện. License: mã tự viết theo tài liệu công khai.
- Ngân sách: một luồng 256 KiB mỗi kênh, bộ đệm cỡ khung (≤ 2 KB binary, ≤ 4 KB ASCII); không cấp phát mỗi chu kỳ ngoài vector khung.

## Constitution Check

| Nguyên tắc | Đánh giá |
|---|---|
| II Ranh giới | Driver chỉ gọi `EngineSink::publish`/`writeDone`; địa chỉ và luật dùng chung giữa Studio (TS) và runtime (C++) qua vector |
| III Ngân sách | Đo 500 Tag/1 s x64 (`017-mc-x64.md`); BL335 chờ thiết bị (ghi rõ) |
| V An toàn | Ghi qua write coordinator (quyền, giới hạn, audit) như Modbus; bộ giải mã kiểm độ dài trước khi đọc, có fuzz |
| VI Test trước | gtest khung/địa chỉ/driver, Vitest địa chỉ và luật, vector chung viết trước mã |
| VII Phiên bản | Chỉ thêm ở dòng 1.x: kênh `mc` ở project 1.0 là `E_CHANNEL_VERSION`; `schemas/1.0/` không đổi. Phát hành driver cần số đo BL335 + PLC thật: để mở |

## Quyết định (tự chốt)

1. **Lệnh con Q/L (0000/0001), mã thiết bị 1 byte**: iQ-R, FX5, Q, L đều nhận; đủ cho thiết bị FR-003. Không dùng lệnh con iQ-R (0002/0003).
2. **Đọc mọi thứ theo word**: thiết bị bit cũng đọc bằng 0401/0000 (16 điểm/word, đầu khối bội 16). Một kiểu khối, ít lệnh hơn, giải mã một đường. Ghi bit dùng 1401/0001 một điểm; đọc lại bit dùng 0401/0001.
3. **Random Read**: sau khi gom khối, các khối ≤ 2 word của cùng nhóm quét (≥ 2 khối) gom vào 0403 (khối 1 word = điểm word, 2 word = điểm dword), ≤ `maxRandomPoints` mỗi lệnh. Tắt được bằng `randomRead: false` (PLC/module không hỗ trợ).
4. **3E không có số thứ tự**: mỗi trả lời kiểm định tuyến và độ dài; 3E qua TCP mà timeout thì đóng và mở lại kết nối (dòng byte không tin được nữa). 4E và UDP: timeout làm thiết bị vào backoff riêng (khuôn Modbus TCP 011), 3 timeout liên tiếp trên ≥ 2 thiết bị thì đóng kết nối (TCP).
5. **End code** gom 4 lý do quality (contracts §4) thay vì một mã mỗi end code (danh mục mã lỗi không phình); giá trị cụ thể ở chẩn đoán và `exception` của kết quả ghi.
6. **Thứ tự byte**: mặc định CDAB (word thấp trước) và chuỗi BA (ký tự đầu ở byte thấp), dùng lại codec Modbus trên giá trị word; Tag ghi đè `byteOrder`/`stringByteOrder` được.
7. **Ghi bit trong word**: chỉ đọc-sửa-ghi (`write.registerBit: rmw`, cảnh báo `W_BIT_RMW`); MC không có lệnh mask.
8. **Tích hợp runtime gọn**: không đổi lớp Modbus; `RuntimeEngine` thêm `mcChannels_`, `driverOf()` trả `drv::Driver*`, chẩn đoán nhận `drv::Driver*` theo thứ tự kênh của model. Thử kết nối (`POST /api/v1/drivers/test`) cho `mc` để sau (ghi ở tasks).
9. **driver-it riêng** (`tools/driver-it-mc.ps1`, `tests/driver-it/compose-mc.yaml`, `tests/driver-it/mc-it.mjs`): không va hai agent driver khác và không đổi kịch bản Modbus.

## Hợp đồng định dạng (dòng 1.x, chỉ thêm)

### `connections.json`: kênh `mc`

```json
{
  "id": "plc-mc", "name": "PLC Mitsubishi", "kind": "mc", "enabled": true, "requestGapMs": 0,
  "tcp": { "host": "192.168.3.39", "port": 5007, "connectTimeoutMs": 3000, "reconnectMaxS": 10 },
  "mc": { "frame": "3E", "code": "binary", "transport": "tcp" },
  "devices": [{
    "id": "fx5u", "name": "FX5U dây chuyền 1", "enabled": true,
    "network": 0, "station": 255, "moduleIo": 1023, "moduleStation": 0,
    "xyNotation": "hex", "timeoutMs": 1000, "retries": 0, "writeDeadlineMs": 5000,
    "maxBatchWords": 960, "maxGapWords": 16, "randomRead": true, "maxRandomPoints": 192,
    "write": { "registerBit": "none" }
  }]
}
```

| Khóa | Miền | Mặc định |
|---|---|---|
| `tcp.port` | 1–65535 | 5007 |
| `mc.frame` | `3E`, `4E` | `3E` |
| `mc.code` | `binary`, `ascii` | `binary` |
| `mc.transport` | `tcp`, `udp` | `tcp` |
| `network` | 0–239 | 0 |
| `station` | 0–255 | 255 |
| `moduleIo` | 0–65535 | 1023 (0x03FF) |
| `moduleStation` | 0–255 | 0 |
| `xyNotation` | `hex`, `octal` | `hex` |
| `timeoutMs`, `retries`, `writeDeadlineMs` | như Modbus | 1000, 0, 5000 |
| `maxBatchWords` | 1–960 | 960 |
| `maxGapWords` | 0–960 | 16 |
| `randomRead` | bool | true |
| `maxRandomPoints` | 1–192 | 192 |
| `write.registerBit` | `none`, `rmw` | `none` |

### Địa chỉ Tag MC (`source.address`, ≤ 16 ký tự)

```
address = device number [ "." bit ]
device  = "SM" / "SD" / "TN" / "CN" / "ZR" / "D" / "W" / "R" / "M" / "X" / "Y" / "B" / "L"
number  = 1*8 DIGIT (thiết bị thập phân) / 1*6 HEXDIG (X, Y, B, W) / 1*8 octal (X, Y khi xyNotation octal)
bit     = HEXDIG   ; 0-F, chỉ thiết bị word, chỉ rawType BOOL
```

Chữ thường đổi thành chữ hoa, không cắt khoảng trắng. Lỗi (dùng lại mã Modbus): cú pháp `E_ADDR_SYNTAX`; thiết bị bit với kiểu khác BOOL, thiết bị word kiểu BOOL không có bit, bit trên thiết bị bit, `X` với `access: RW`: `E_ADDR_AREA`; số + số word > 0x1000000: `E_ADDR_RANGE`. Số word: BOOL 1, 16 bit 1, 32 bit 2, 64 bit 4, STRING ceil(độ dài/2). Vector: `tests/mc-vectors/address.json` (TS `packages/tag-codec`, C++ `drivers/mc/tests/mc_address_test.cpp`).

### Luật (TS `rules-mc.ts`, C++ `rules_mc.cpp`; vector `v11-mc-*`, README-017.md)

1. Kênh `kind: "mc"` trong project 1.0.x: `E_CHANNEL_VERSION` `/channels/<ci>/kind`.
2. Tag ngoài của thiết bị thuộc kênh `mc` (sau luật `stringLength` chung): địa chỉ theo ngữ pháp trên (`xyNotation` của thiết bị), lỗi `E_ADDR_*` `/tags/<i>/source/address`; số word > `maxBatchWords`: `E_ADDR_READ_LIMIT` `/tags/<i>/source`; bit trong word với RW: `write.registerBit` `none` → `E_BIT_WRITE` `/source/address`, `rmw` → `W_BIT_RMW` một lần mỗi thiết bị; `W_DETECT_SLOW` như Modbus (retries mặc định 0).
