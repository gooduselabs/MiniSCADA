# Contract: giao thức live 1.1.0 (phần thay đổi so với 1.0.0)

**Feature**: [spec.md](../spec.md) FR-025 · **Research**: R14 · Bản gốc: [live-ws.md 1.0.0](../../002-vertical-slice/contracts/live-ws.md)

Theo [ADR-006](../../docs/adr/006-live-protocol-v1.md), thêm trường và thêm cách hiểu một mã đóng là tăng MINOR: `protocolVersion` = `"1.1.0"`. Mọi quy tắc khác của 1.0.0 giữ nguyên.

## 1. `hello.project` thêm `digest`

```json
{ "type": "hello", "protocolVersion": "1.1.0", "serverVersion": "0.4.0",
  "maxClients": 10, "heartbeatMs": 5000, "timeoutMs": 15000,
  "project": { "projectId": "tank-demo", "projectVersion": "1.3.0", "digest": "sha256:9f2c…" } }
```

- `digest`: digest nội dung của project đang chạy ([matscada-package.md](matscada-package.md) §4).
- `project` vẫn là `null` khi không có project hợp lệ.
- `GET /api/v1/projects/active` thêm khóa cấp đầu `digest`, cùng giá trị.

## 2. Mã đóng 1012

| Mã | Ý nghĩa | Client 1.1.0 |
|---|---|---|
| 1012 | Máy chủ khởi động lại để kích hoạt project mới hoặc quay về bản cũ (mã chuẩn "Service Restart") | Thử lại mỗi 1 s, cộng ngẫu nhiên 0–250 ms, tối đa 30 lần; rồi mới về backoff thường. Giá trị vẫn chuyển `STALE` như mọi lần mất kết nối |

- Máy chủ gửi 1012 cho mọi phiên, ngay trước `execv` (kích hoạt hoặc rollback), rồi chờ tối đa 1 s để các luồng ghi gửi xong close frame.
- Số phiên được báo ghi vào `DeployOperation.clientsNotified`.

## 3. Trang xem tải lại khi project đổi

`apps/runtime-web` (FR-025):

1. Lúc mở trang, nạp `/api/v1/projects/active`, nhớ `digest`.
2. Mỗi lần nhận `hello`, nếu `hello.project?.digest` khác `digest` đã nhớ (kể cả `null` thành có, hay ngược lại): hiện "Đang nạp project mới…", rồi `location.reload()` sau 0–1000 ms ngẫu nhiên. Ngẫu nhiên để 10 client không cùng gọi một lúc.
3. Máy chủ 1.0.0 không có `digest`: so `projectId` + `projectVersion` như cũ.

Studio (`DeviceSession`) không tải lại trang: phiên thấy digest đổi thì làm mới so sánh và thanh trạng thái.

## 4. Tương thích

| Client | Máy chủ | Kết quả |
|---|---|---|
| 1.0.0 (Studio 004, trang mở từ runtime 0.3.0) | 1.1.0 | Bỏ qua `digest`; coi 1012 là mã "khác", kết nối lại theo backoff (1, 2, 4 s…). Không tải lại trang tự động: cần F5 một lần sau khi cập nhật runtime |
| 1.1.0 | 1.0.0 | Không có `digest`, không có 1012: chạy như 1.0.0 |

## 5. Test

- `@mat/live-client`: 1012 thử lại mỗi khoảng 1 s, tối đa 30 lần; mã khác giữ backoff; `hello.project.digest` đọc được; bỏ qua khi thiếu.
- `apps/runtime-web`: digest đổi thì tải lại một lần; digest giống thì không; khoảng chờ nằm trong 0–1000 ms (đồng hồ giả).
- Tích hợp x64: nạp xuống khi có 10 trang mở; mọi trang tải lại trong ≤ 10 s (SC-006).
