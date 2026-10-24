# Vector project của feature 020 (kênh `bacnet` định dạng 1.1)

Sinh bởi `tests/project-vectors/generate.mjs` (mã ca ở `v11-bacnet.mjs`, hàm `bacnetCases`, gọi trong `cases11`); tên `v11-bacnet-*`, cùng bộ chạy với `v11-*`: `packages/project-schema/src/vectors-11.test.ts` (TS), `core/project-manager/tests/vectors_11_test.cpp` (C++). Đặc tả: [specs/020-driver-bacnet/spec.md](../../specs/020-driver-bacnet/spec.md) FR-005..FR-007, FR-011.

- Mỗi ca thêm kênh `bms` (thiết bị `ahu1`, instance 1001) và 7 Tag BACnet (`AI:1`, `AV:5@8`, `BO:2`, `MSV:3`, `AI:1:status-flags`, `DEV:1001:object-name`, `AV:5:relinquish@8`) vào project 1.1 gốc.
- Schema (`schemas/connections.schema.json`, `bacnetChannel`/`bacnetDevice`): `host` và `deviceInstance` bắt buộc, instance 0–4194302, `writePriority` 1–16 trừ 6, `mac` hex 1–6 byte và cần `network`, `maxApdu` 50–1476, broadcast/bindAddress IPv4, khóa Modbus hay `tcp` bị từ chối: `E_SCHEMA`. Địa chỉ Tag dài tối đa 32 ký tự (`tag.schema.json`).
- Luật địa chỉ (`rules-bacnet.ts`, `rules_bacnet.cpp`, cùng vector `tests/bacnet-vectors/address.json`): cú pháp `E_ADDR_SYNTAX`, tầm instance/thuộc tính/priority (6 dành riêng) `E_ADDR_RANGE`, kiểu sai với thuộc tính, ghi đối tượng input hay thuộc tính khác present-value, priority trên đối tượng không ghi được `E_ADDR_AREA`; đường dẫn `/tags/<i>/source/address`.
- `W_DETECT_SLOW` với mặc định BACnet 500 ms, gửi lại 1 (không cảnh báo ở chu kỳ normal 1000 ms).
- Kênh `bacnet` ở project 1.0: `E_CHANNEL_VERSION` tại `/channels/<i>/kind` của `connections.json` (mã chung với feature 018).
