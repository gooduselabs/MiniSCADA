# Contract: giao thức live 1.2.0 (phần thay đổi so với 1.1.0)

**Feature**: [spec.md](../spec.md) FR-010, FR-036, FR-045, FR-050, FR-055a · **Research**: R19, R20 · Bản trước: [live-protocol-1.1.md](../../005-device-online/contracts/live-protocol-1.1.md), [live-ws.md 1.0.0](../../002-vertical-slice/contracts/live-ws.md)

Theo [ADR-006](../../../docs/adr/006-live-protocol-v1.md): thêm trường, thêm một mã đóng, thêm một cách xác thực tùy chọn là MINOR, nên `protocolVersion` = `"1.2.0"`. Mọi quy tắc khác của 1.1.0 giữ nguyên. Alarm của GĐ 4 sẽ là 1.3.0.

## 1. Lý do của quality

**Snapshot:** mỗi Tag có thêm `reason` khi `quality` khác `GOOD`:

```json
{ "type": "snapshot", "subscriptionId": "s1", "sequence": 1, "ts": 1791601205000,
  "tags": [ { "id": "TANK01.LEVEL", "value": 48.2, "quality": "GOOD", "sourceTimestamp": 1791601204950,
              "serverTimestamp": 1791601205000, "revision": 812 },
            { "id": "METER3.P", "value": 12.4, "quality": "BAD", "reason": "TIMEOUT", "…": "…" } ],
  "unknown": [] }
```

**Delta:** phần tử có thêm vị trí thứ tư khi `quality` khác `GOOD`:

```json
{ "type": "delta", "subscriptionId": "s1", "sequence": 2, "ts": 1791601205250,
  "tags": [ [0, 48.3, "GOOD"], [1, 12.4, "BAD", "TIMEOUT"], [5, 61.0, "UNCERTAIN", "CLAMPED"] ] }
```

- `reason` lấy từ danh mục mã của [data-model.md](../data-model.md) §6. Mã lạ: client hiện "không rõ" kèm mã.
- Đổi lý do mà không đổi giá trị hay quality vẫn sinh delta (FR-012).

## 2. Nâng cấp WebSocket kèm phiên (FR-055a)

- Client có phiên (Studio Online) gửi `Authorization: Bearer mats_…` trong request nâng cấp, **chỉ qua `wss`**.
- Máy chủ:
  - header `Authorization` trên listener HTTP: 403 `HTTPS_REQUIRED`, không lấy slot;
  - phiên hợp lệ (còn hạn, đúng IP lúc đăng nhập): nhận, không xét nguồn. Kiểm kiểu "nhìn", không làm mới hạn phiên;
  - phiên không hợp lệ: xử lý như request không có phiên, tức theo luật lọc nguồn ([device-api-1.1.md](device-api-1.1.md) §1.2);
  - không có header: theo luật lọc nguồn.
- Giới hạn 10 phiên tính chung mọi phiên, có hay không có token (Constitution IV).
- `Origin` vẫn kiểm như ADR-006: client không phải trình duyệt không gửi `Origin`.

## 3. Mã đóng 4401

| Mã | Ý nghĩa | Client 1.2.0 |
|---|---|---|
| 4401 | `SESSION_ENDED`: phiên đã dùng để mở kết nối hết hạn hoặc bị thu hồi, và nguồn không thuộc mạng riêng | Không tự kết nối lại bằng token cũ. Studio chuyển sang hỏi đăng nhập lại (như `SESSION_EXPIRED` của 005), rồi mở lại |

Máy chủ kiểm lại phiên của các kết nối đã được nhận nhờ token, từ nguồn ngoài mạng riêng, mỗi 60 s. Kết nối từ mạng riêng không bị đóng (không có token vẫn được phục vụ).

## 4. Không có bản tin ghi

GĐ 2 không ghi qua kênh live (FR-036). Bản tin `{"type":"write", …}` nhận `error` `BAD_MESSAGE` như mọi loại không hỗ trợ (1.0.0), và máy chủ ghi audit `tag.write` `denied` `LIVE_WRITE_NOT_ALLOWED` (gộp 60 s), kèm Tag và giá trị nếu đọc được.

## 5. Tương thích

| Client | Máy chủ | Kết quả |
|---|---|---|
| 1.1.0 (trang xem cũ, Studio 005) | 1.2.0 | Đọc delta bằng `const [index, value, q] = entry` nên bỏ qua vị trí thứ tư; bỏ qua `reason` của snapshot. 4401 là mã "khác": kết nối lại theo backoff, sau đó bị lọc nguồn (403) nếu ở ngoài mạng riêng |
| 1.2.0 | 1.1.0 | Không có `reason`: hiện quality không kèm lý do. Gửi token qua `wss` tới máy chủ 1.1.0: máy chủ bỏ qua header |
| 1.2.0 | 1.0.0 | Như 1.1.0 với máy chủ 1.0.0 |

## 6. Test

- `server/websocket/tests/live_hub_test.cpp`: `reason` có ở snapshot và delta khi khác GOOD, không có khi GOOD; đổi lý do sinh delta; bản tin `write` nhận `BAD_MESSAGE` và gọi móc audit.
- `civet_transport_test` (CivetWeb trong tiến trình):
  - token trên HTTP: 403;
  - token hợp lệ trên HTTPS từ nguồn công cộng (giả lập bằng hàm phân loại nguồn được tiêm vào): nhận;
  - token hết hạn: đóng 4401 trong ≤ 60 s;
  - không token từ nguồn công cộng: 403, không tốn slot.
- `@mat/live-client`: đọc `reason` từ snapshot và delta, bỏ qua khi thiếu; 4401 gọi hàm `onSessionEnded` thay vì tự kết nối lại.
- Rust `device/live.rs`: request nâng cấp có `Authorization` khi đã đăng nhập, chỉ với `wss`; không có khi theo dõi bằng địa chỉ (`ws`).
