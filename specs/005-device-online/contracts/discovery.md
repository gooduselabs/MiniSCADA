# Contract: gói tìm thiết bị (discovery 1)

**Feature**: [spec.md](../spec.md) FR-001…FR-004 · **Research**: R1–R3

## 1. Truyền tải

- UDP IPv4, cổng thiết bị **8446** (`discoveryPort`, 1024–65535).
- Studio gửi tới địa chỉ broadcast có hướng của card đã chọn (ví dụ `192.168.1.255`), từ socket bind vào địa chỉ của card đó, cổng ngẫu nhiên.
- Thiết bị trả lời **unicast** về đúng địa chỉ và cổng nguồn của gói hỏi. Địa chỉ nguồn của gói trả lời là địa chỉ của card đã nhận gói (đặt bằng `IP_PKTINFO`).
- Thứ tự byte của số nguyên nhiều byte: big-endian.

## 2. Gói hỏi: đúng 1024 byte

| Offset | Dài | Giá trị |
|---|---|---|
| 0 | 4 | `4D 41 54 44` (`MATD`) |
| 4 | 1 | version = `1` |
| 5 | 1 | type = `1` (hỏi) |
| 6 | 2 | cờ = `0` |
| 8 | 16 | nonce ngẫu nhiên |
| 24 | 1000 | `00` |

Thiết bị bỏ qua (không trả lời, không ghi log từng gói) khi:

- độ dài khác 1024;
- sai magic, version hoặc type; cờ khác 0; phần đệm có byte khác 0;
- nguồn không cùng subnet với card nhận: `(src & mask) != (ifaddr & mask)` với mọi địa chỉ IPv4 của card đó;
- nguồn là `0.0.0.0`, `255.255.255.255`, địa chỉ broadcast của subnet, multicast hoặc loopback;
- cổng nguồn < 1024;
- vượt giới hạn tần suất (§4);
- `discoveryEnabled = false`: khi đó runtime không mở socket.

Thiết bị đếm số gói đã trả lời và số gói bị bỏ theo lý do, đọc được ở `GET /api/v1/diagnostics` (khối `discovery`, [device-api.md](device-api.md) §6). Không ghi audit.

## 3. Gói trả lời: tối đa 1024 byte

| Offset | Dài | Giá trị |
|---|---|---|
| 0 | 4 | `MATD` |
| 4 | 1 | version = `1` |
| 5 | 1 | type = `2` (trả lời) |
| 6 | 2 | cờ: bit 0 = `truncated` |
| 8 | 16 | nonce của gói hỏi |
| 24 | ≤ 1000 | JSON UTF-8, không đệm |

**JSON:**

```json
{
  "v": 1,
  "id": "4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10",
  "name": "BL335-01",
  "model": "BL335",
  "mac": "C2:D9:CC:52:33:70",
  "ip": "192.168.1.110",
  "prefix": 24,
  "runtime": "0.4.0",
  "api": "1.0.0",
  "status": "running",
  "project": { "id": "tank-demo", "name": "Tank demo", "version": "1.3.0", "digest": "sha256:9f2c…" },
  "https": 8443,
  "http": 8080,
  "fp": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
}
```

| Khóa | Ràng buộc |
|---|---|
| `v` | `1` |
| `id` | `deviceId` (UUID) |
| `name`, `model` | ≤ 32 byte UTF-8 |
| `mac`, `ip`, `prefix` | của card nhận gói hỏi |
| `runtime`, `api` | SemVer |
| `status` | `running` \| `no-project` \| `project-error` \| `activating` |
| `project` | `null` khi không có project. `name` ≤ 64 ký tự, có thể bị bỏ |
| `https` | `0` khi HTTPS tắt hoặc chứng chỉ lỗi |
| `fp` | 64 hex chữ thường, hoặc `null` khi HTTPS tắt |

**Không bao giờ có:** mật khẩu, khóa, token, tên tài khoản, nội dung project, đường dẫn trên thiết bị (Constitution V).

**Khi JSON vượt 1000 byte:** bỏ `project.name`; còn vượt thì cắt `name` theo ranh giới ký tự UTF-8. Bật cờ `truncated`.

**Phía Studio:**

- Bỏ gói trả lời: ngắn hơn 24 byte, dài hơn 1024 byte, sai magic/version/type, nonce không khớp lượt quét đang chạy, JSON không đọc được hoặc thiếu khóa bắt buộc (`v`, `id`, `name`, `runtime`, `status`, `https`).
- Khóa lạ được bỏ qua, để version 1 thêm khóa được.
- IP của thiết bị lấy theo địa chỉ nguồn UDP.

## 4. Giới hạn tần suất (thiết bị)

| Giới hạn | Giá trị |
|---|---|
| Mỗi địa chỉ nguồn | token bucket 1 trả lời/s, tối đa dồn 3 |
| Tổng | 20 trả lời/s |
| Bảng nguồn | 64 mục, bỏ mục lâu nhất (LRU) |

## 5. Phía Studio: một lượt quét

1. Sinh nonce 16 byte.
2. Với mỗi card đã chọn: gửi gói hỏi lúc 0, 600 và 1200 ms.
3. Nhận tới 2500 ms. Mỗi gói hợp lệ đẩy ngay lên giao diện. Gộp theo (`id`, IP nguồn).
4. Kết thúc: tóm tắt số card đã gửi, số thiết bị, card lỗi (không bind được, không có broadcast).

## 5a. Quyết định bổ sung (2026-10-11)

Các luật dưới đây (phiên làm việc chốt ngày 2026-10-11 (người dùng giao toàn quyền quyết định), theo các điểm mơ hồ agent viết vector T013/T014 nêu ra) bổ sung §2–§5; bộ vector `tests/discovery-vectors/` theo đúng các luật này.

- **Nguồn không hợp lệ:** gói hỏi từ `0.0.0.0`, địa chỉ broadcast, multicast, loopback bị bỏ và đếm vào bộ đếm `subnet`. Vì vậy test phía thiết bị (T059) gửi gói hỏi từ một địa chỉ không phải loopback (ví dụ địa chỉ của container trên mạng Docker), không dùng 127.0.0.1.
- **Độ dài trả lời** tính trên JSON gọn (không khoảng trắng; như `nlohmann::json::dump()` và `serde_json::to_string`). Vượt 1000 byte thì: (1) bỏ `project.name`; (2) cắt `name` theo ký tự, giữ phần đầu dài nhất còn vừa; (3) còn vượt thì bỏ hẳn khối `project`. Mỗi bước đặt cờ `truncated`. Với cấu hình hợp lệ (`deviceName` ≤ 32 byte) bước 3 không xảy ra.
- **Tên project dài hơn 64 ký tự** (schema cho tới 80): cắt còn 64 ký tự và đặt cờ `truncated`.
- **Giới hạn tổng 20 trả lời/s:** token bucket dung lượng 20, nạp 20/s; giới hạn mỗi nguồn giữ như §4.
- **Phía Studio:** `v` khác 1 → bỏ gói (đếm như lỗi định dạng); khóa tùy chọn sai kiểu → coi như không có khóa đó; `status` lạ → vẫn hiện thiết bị, trạng thái ghi "không rõ".

## 6. Vector test

`tests/discovery-vectors/*.json`: gói hỏi và gói trả lời dạng hex, kèm kết quả mong đợi. Phải có:

- gói hỏi hợp lệ;
- 1023 và 1025 byte; sai magic, version, type; đệm khác 0;
- nguồn khác subnet; nguồn là broadcast; cổng nguồn 53;
- trả lời với tên project 64 ký tự tiếng Việt (vừa 1024 byte);
- trả lời buộc cắt (`truncated`);
- chuỗi tần suất: 5 gói từ một nguồn trong 1 s → 3 trả lời.

C++ (thiết bị) và Rust (Studio) cùng chạy bộ vector này.
