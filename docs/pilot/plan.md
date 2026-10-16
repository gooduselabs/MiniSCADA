# Kế hoạch pilot mAT SCADA 1.0

Theo [spec 011](../../specs/011-pilot-hardening/spec.md) FR-132, FR-136, FR-140 và [contract test-protocols](../../specs/011-pilot-hardening/contracts/test-protocols.md) §5, §6. Tiêu chí vào và ra: [criteria.md](criteria.md). Việc cần khách hàng: [customer-checklist.md](customer-checklist.md).

Tài liệu này là mẫu. Phần trong `<…>` điền khi chốt site. Không ghi địa chỉ IP công cộng, cổng chuyển tiếp, mật khẩu hay tên người không đồng ý công khai vào repo (repo công khai): ghi các mục đó ở hồ sơ riêng của dự án.

## 1. Mục đích

Chạy bản `1.0.0-rc.N` liên tục ≥ 30 ngày ở ít nhất một site thật và một bàn thử nội bộ, đo theo tiêu chí ra X1 đến X11, để quyết định Go/No-Go cho bản `1.0.0` (`docs/reports/011-go-no-go.md`, Tech Lead ký).

## 2. Phạm vi

| Mục | Nội dung |
|---|---|
| Site | 1 site bắt buộc, mục tiêu 2: `<tên site 1>`, `<tên site 2 nếu có>` |
| Bàn thử nội bộ | 1 BL335 chạy song song cùng bản, PLC giả lập Modbus, tải chuẩn (soak S2 của contract) |
| Mỗi site | 1 BL335, PLC thật qua Modbus TCP hoặc RTU, 2 đến 10 client Chrome, project do kỹ sư của khách (hoặc của đội) dựng bằng Studio |
| Truy cập từ xa | VPN vào LAN của site; **không** chuyển cổng ra Internet |
| Bản phần mềm | `1.0.0-rc.N` cố định trong kỳ; bản vá chỉ cho sự cố S1/S2 hoặc lỗi bảo mật, sau hồi quy đầy đủ |
| Tính năng trong pilot | ghi rõ ở bảng E9 của [criteria.md](criteria.md): alarm (GĐ 4), lịch sử và báo cáo (GĐ 5), logic, logic ghi PLC (mặc định **tắt**), OTA (mặc định **tắt**) |
| Ngoài phạm vi | các mảng của [post-1.0-backlog.md](../plans/post-1.0-backlog.md) |

## 3. Vai trò

| Vai trò | Người | Việc |
|---|---|---|
| Tech Lead | `<tên>` | duyệt kế hoạch, quyết định bản vá, ký Go/No-Go |
| Kỹ sư pilot | `<tên>` | cài đặt, theo dõi hằng ngày, thu dữ liệu, xử lý sự cố |
| QA | `<tên>` | hồi quy bản vá, đo, đối chiếu KPI |
| Người liên hệ khách hàng | `<tên>` | điều phối với site, lịch huấn luyện, ký biên bản |
| Người vận hành của khách | `<tên, số người>` | dùng hằng ngày, báo sự cố |
| Quản trị site | `<tên>` | mạng, VPN, tài khoản, thiết bị |

## 4. Lịch

| Mốc | Ngày dự kiến | Điều kiện |
|---|---|---|
| Tiêu chí vào E1 đến E9 đạt | `<ngày>` | [criteria.md](criteria.md) |
| Khảo sát site, chốt danh sách khách hàng | `<ngày>` | [customer-checklist.md](customer-checklist.md) |
| Cài bản rc, nạp project, bật thu dữ liệu | `<ngày>` = **ngày bắt đầu đồng hồ pilot** | admin-guide mục 2 |
| Huấn luyện vận hành, kỹ sư, quản trị | trong tuần đầu | [docs/training/](../training/README.md) |
| Báo cáo tuần | mỗi thứ Hai | [weekly-report.md](weekly-report.md) |
| Đánh giá giữa kỳ | ngày 15 | KPI tạm thời, sự cố mở |
| Kết thúc đo | ngày bắt đầu + 30 (hoặc muộn hơn nếu đồng hồ bị tính lại) | |
| Nghiệm thu với khách hàng | sau khi kết thúc đo | [acceptance-minutes.md](acceptance-minutes.md) |
| Go/No-Go | sau nghiệm thu | `docs/reports/011-go-no-go.md` |

**Đồng hồ pilot:** chạy từ ngày cài bản rc và bắt đầu thu dữ liệu. Sự cố S1 làm dừng đồng hồ và tính lại từ ngày bản vá được triển khai (hồi quy xanh). S2 và bản vá khác chỉ ghi chú. Pilot không kéo quá 90 ngày; quá hạn mà chưa đạt là No-Go kèm kế hoạch.

## 5. Theo dõi hằng ngày (kỹ sư pilot)

1. Kiểm dữ liệu thu của hôm qua có đủ (`docs/pilot/data/<site>/<ngày>.jsonl`, thu bằng `tools/pilot/collect.ps1` mỗi 15 phút; thư mục này không commit).
2. Đọc cảnh báo trong `system/info`, log `journalctl -u mat-runtime`.
3. Hỏi người liên hệ của khách có vấn đề gì không.
4. Sự cố: ghi [incident-log.md](incident-log.md) trong 1 ngày làm việc.

Không thu dữ liệu quy trình (giá trị Tag, tên Tag, tên màn hình): [data-handling.md](data-handling.md).

## 6. Rủi ro

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Không có site thật | không đủ điều kiện 1.0.0 | pilot chạy ở bàn thử; **không** gắn 1.0.0, ghi rõ trong Go/No-Go |
| Mất điện site | khoảng trống dữ liệu | loại trừ khỏi uptime khi nhật ký xác nhận; kiểm toàn vẹn sau mỗi lần |
| Mất VPN | không thu được dữ liệu | thiết bị vẫn chạy; thu bù bằng tay khi có mạng |
| Ghi sai xuống PLC | an toàn | logic ghi PLC tắt mặc định; lệnh từ người có xác nhận và audit; PLC giữ khóa liên động |
| Bit xung kẹt khi mất điện | thiết bị chạy ngoài ý muốn | PLC tự nhả bit xung (yêu cầu ở customer-checklist); `pulseRecovery` bật |
| eMMC mòn nhanh hơn dự kiến | tuổi thọ < 5 năm | đo ghi mỗi ngày (X4, X5); giảm lưu trữ của project |
| Bị dò mật khẩu từ Internet | bảo mật | không chuyển cổng; SSH bằng khóa; cảnh báo `SSH_ROOT_PASSWORD` |
| Người vận hành chưa quen | dùng sai, báo sự cố giả | huấn luyện tuần đầu, hướng dẫn in tại chỗ |
| Bản vá giữa kỳ gây lỗi mới | sự cố | hồi quy đầy đủ trước khi cài; giữ `.prev` để rollback |
