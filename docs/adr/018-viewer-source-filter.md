# ADR-018: Phần không cần đăng nhập chỉ phục vụ mạng riêng; kênh live của Studio mang phiên

- **Trạng thái:** Proposed (feature 006, FR-055a và D33; phiên chính chốt khi duyệt spec, người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11).
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/006-tags-modbus](../../specs/006-tags-modbus/plan.md), research R19, R20, R24; contracts [device-api-1.1.md](../../specs/006-tags-modbus/contracts/device-api-1.1.md) §1.2, [live-protocol-1.2.md](../../specs/006-tags-modbus/contracts/live-protocol-1.2.md); Constitution IV, V; [ADR-006](006-live-protocol-v1.md), [ADR-010](010-device-discovery-https.md), [ADR-011](011-auth-roles-audit.md).

## Bối cảnh

Trang xem trên Chrome không đăng nhập (FR-033 của 005, kéo dài tới GĐ 3a theo D2). Từ GĐ 2, trang này hiện dữ liệu PLC thật. Người dùng đang mở port-forward 9080 ra Internet để xem bản demo, nên dữ liệu sản xuất có thể lộ ra ngoài.

Studio Online từ xa (qua port-forward HTTPS) phải vẫn theo dõi được. Trong 005, Rust không gửi token cho kênh live.

## Các phương án

| Phương án | Ưu | Nhược |
|---|---|---|
| Đăng nhập trên Chrome ngay ở GĐ 2 | an toàn nhất | GĐ 3a (cookie, CSRF, quy trình chứng chỉ CA); vượt phạm vi |
| Chỉ khuyến nghị đóng port-forward | không đổi mã | không có gì chặn khi người dùng quên |
| **Lọc theo nguồn: mặc định chỉ mạng riêng; request có phiên không bị lọc** | không đổi gì trong LAN và qua VPN; chặn đúng trường hợp port-forward | router có SNAT làm mất tác dụng; người dùng đặt `any` |
| Danh sách mạng do người dùng tự cấu hình | linh hoạt | dễ cấu hình sai; chưa cần |

## Quyết định

1. **Phần không cần đăng nhập** (trang, `/assets`, `/project`, `system/info`, `projects/active`, live không kèm phiên), trên cả HTTP và HTTPS, mặc định chỉ phục vụ nguồn thuộc mạng riêng:
   - 10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, 127/8;
   - fc00::/7, fe80::/10, ::1.

   Nguồn khác nhận 403 kèm hướng dẫn VPN; được đếm, không audit.
2. **`viewerAccess`:** `private` (mặc định), `any` (cảnh báo ở `system/info`, thanh trạng thái Studio, `deploy.sh`), `off` (tắt trang xem; `system/info` vẫn phục vụ mạng riêng và loopback).
3. **Request HTTPS kèm phiên hợp lệ không bị lọc**, kể cả nâng cấp WebSocket. Phiên kiểm kiểu "nhìn", không làm mới hạn. Token qua HTTP bị từ chối.
4. **Studio gửi `Authorization: Bearer` khi mở `wss` `/api/v1/live`** lúc đã đăng nhập (đổi so với 005).
5. **Kết nối live nhận nhờ token từ nguồn ngoài mạng riêng** được kiểm lại mỗi 60 s; phiên hết hạn hoặc bị thu hồi thì đóng mã 4401 (giao thức live 1.2.0).
6. **`deploy.sh`** in lời nhắc khi lên 0.5 lần đầu: muốn giữ cách xem qua port-forward 9080 thì phải đặt `any`.

## Hệ quả

- **Tốt:**
  - Dữ liệu PLC không ra Internet theo mặc định, mà người dùng trong LAN hay VPN không thấy khác gì.
  - Online từ xa vẫn chạy.
  - Không tốn ghi eMMC khi bị bot quét.
- **Xấu:**
  - Người đang xem qua port-forward 9080 mất trang xem sau khi cập nhật, tới khi đặt `any` hoặc dùng VPN.
  - Router port-forward có SNAT làm mọi nguồn trông như mạng riêng (ghi trong tài liệu triển khai).
  - Chế độ theo dõi chỉ đọc của 004 (HTTP, không đăng nhập) không dùng được từ ngoài mạng riêng.

## Số đo / bằng chứng

- **Chưa đo.** Kịch bản `driver-it -Scenario source` dùng mạng Docker 203.0.113.0/24 (dải tài liệu) để có nguồn công cộng (SC-022); thử thật qua 4G trên BL335 ở task ⚠️🔌.
- Chi phí mỗi request: so địa chỉ với 9 dải, vài trăm ns.

## Điều kiện xem xét lại

- GĐ 3a có đăng nhập trên Chrome: trang xem cần đăng nhập, lọc nguồn thành lớp thứ hai hoặc bỏ.
- Khách hàng dùng LAN địa chỉ công cộng: thêm danh sách mạng cấu hình được.
- Cần IPv6 công cộng cho trang xem.
