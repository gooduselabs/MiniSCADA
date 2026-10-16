# Tiêu chí vào và ra của pilot

Theo [contract test-protocols](../../specs/011-pilot-hardening/contracts/test-protocols.md) §5 và spec 011 FR-139, FR-140. Mỗi dòng có trạng thái **Đạt**, **Không đạt** (kèm báo cáo giới hạn và phương án) hoặc **Chưa đo**. Số chưa đo ghi "Chưa đo", không ghi "Đạt". Cột "Bằng chứng" ghi đường dẫn tệp hoặc mục cụ thể.

## 1. Tiêu chí vào (tất cả bắt buộc trước ngày cài)

| # | Tiêu chí | Nơi ghi bằng chứng | Trạng thái | Bằng chứng | Ngày |
|---|---|---|---|---|---|
| E1 | US1 xong: 0 Critical/High/Medium mở (trừ mục chờ người ghi rõ) | `docs/reports/011-security-review.md` | Chưa đo | | |
| E2 | Tải L1, L3, L4 đạt; soak S1 7 ngày đạt (hoặc báo cáo giới hạn được Tech Lead chấp thuận bằng văn bản) | `docs/reports/011-load.md`, `docs/reports/011-soak.md` | Chưa đo | | |
| E3 | Mất điện: 100 vòng ngẫu nhiên và ≥ 10 vòng mỗi điểm đạt (hoặc báo cáo giới hạn) | `docs/reports/011-powercut.md` | Chưa đo | | |
| E4 | Bản rc ký (hoặc quyết định ghi rõ chạy bản chưa ký), SBOM, license | thư mục `release/<rc>/` (ngoài git), ghi SHA-256 ở đây | Chưa đo | | |
| E5 | OTA đạt kiểm lab, hoặc quyết định dùng quy trình thủ công | `docs/reports/011-acceptance.md` | Chưa đo | | |
| E6 | Ba hướng dẫn và giáo trình xong; ít nhất hai buổi huấn luyện đã lên lịch | `docs/user/`, `docs/training/`; lịch ở [plan.md](plan.md) | Đang làm | tài liệu có; lịch chưa có | |
| E7 | Hồi quy xanh: `tools/ci-local.ps1`, `device-it`, `driver-it`, `web-it` | báo cáo hồi quy của bản rc | Chưa đo | | |
| E8 | Site sẵn sàng: PLC, mạng (IP tĩnh, NTP), người liên hệ, VPN, người vận hành; sao lưu cấu hình trước khi chạy | [customer-checklist.md](customer-checklist.md) | Chưa đo | | |
| E9 | Phạm vi tính năng pilot ghi rõ (bảng dưới) | bảng E9 dưới đây | Chưa chốt | | |

**Bảng E9: phạm vi tính năng** (điền khi chốt với khách hàng)

| Tính năng | Có trong pilot | Ghi chú |
|---|---|---|
| Xem và điều khiển trên Chrome | Có | |
| Alarm (GĐ 4) | `<có/không>` | |
| Lịch sử và báo cáo (GĐ 5) | `<có/không>` | |
| Logic (không ghi PLC) | `<có/không>` | |
| Logic ghi PLC (`logic.writes: on`) | `<có/không>`, mặc định không | cần khách hàng đồng ý bằng văn bản và danh sách ghi đã duyệt |
| Cập nhật qua mạng (OTA) | `<có/không>`, mặc định không | |
| DB ngoài | `<có/không>` | |

## 2. Tiêu chí ra (tất cả bắt buộc cho 1.0.0)

| # | Tiêu chí | Ngưỡng | Cách đo | Nơi ghi bằng chứng | Trạng thái | Kết quả |
|---|---|---|---|---|---|---|
| X1 | Uptime tiến trình | ≥ 99,9 % (≤ 43 phút ngừng ngoài kế hoạch mỗi 30 ngày) | `uptimeS`, `restarts`, khoảng trống dữ liệu, [incident-log.md](incident-log.md); mất nguồn do site loại trừ khi nhật ký xác nhận | kết quả `tools/pilot/kpi.mjs` cuối kỳ | Chưa đo | |
| X2 | Sự cố | 0 S1; ≤ 2 S2 mở và mỗi cái có cách tránh; 0 S1/S2 chưa rõ nguyên nhân | đếm theo mức | [incident-log.md](incident-log.md) | Chưa đo | |
| X3 | Độ trễ | `liveLagP95Ms` ≤ 500 ms mọi tuần; đo đầu-cuối Chrome ≤ chu kỳ quét + 500 ms ở ≥ 3 lần đo mỗi site | `system/diagnostics`; `load-tester --latency` | [weekly-report.md](weekly-report.md), báo cáo đo | Chưa đo | |
| X4 | Ghi eMMC | ≤ 2 GB mọi ngày; chỉ số `EXT_CSD` tăng ≤ 1 bậc | `collect.ps1`, `kpi.mjs` | kết quả `kpi.mjs` | Chưa đo | |
| X5 | Tuổi thọ eMMC | ước tính ≥ 5 năm (contract §3, lấy cách bi quan) | TBW và bậc `EXT_CSD` | `docs/reports/011-soak.md` | Chưa đo | |
| X6 | Toàn vẹn | 0 DB hỏng sau mọi lần mất điện (site và lab) | `mat-runtime --check-data` sau mỗi lần | [incident-log.md](incident-log.md), `docs/reports/011-powercut.md` | Chưa đo | |
| X7 | Bảo mật và audit | 0 Critical/High/Medium mở; 0 lệnh ghi thiếu audit trong dữ liệu đối chiếu | rà soát; đối chiếu audit | `docs/reports/011-security-review.md` | Chưa đo | |
| X8 | Chức năng | 100 % tác vụ đại diện (≥ 10, do khách hàng chọn) làm được | biên bản | [acceptance-minutes.md](acceptance-minutes.md) | Chưa đo | |
| X9 | Huấn luyện | ≥ 2 người vận hành và ≥ 1 kỹ sư của khách đạt bài kiểm thực hành | phiếu đánh giá | `docs/pilot/training-results.md` | Chưa đo | |
| X10 | Nghiệm thu khách hàng | biên bản có chữ ký | | [acceptance-minutes.md](acceptance-minutes.md) | Chưa đo | |
| X11 | Ngân sách | RSS ≤ 150 MB; CPU trung bình ≤ 30 % theo tuần; tmpfs ≤ 64 MB | `system/diagnostics` | kết quả `kpi.mjs` | Chưa đo | |

**Quyết định có điều kiện:** chỉ X3, X5, X11 được Tech Lead chấp nhận có điều kiện (ghi rõ lý do và kế hoạch). X1, X2, X4, X6, X7, X10 không có ngoại lệ. Mục nào "Chưa đo" vào ngày Go/No-Go thì 1.0.0 không gắn.

## 3. Quy tắc bản vá trong kỳ

- Chỉ sửa sự cố S1, S2 hoặc lỗi bảo mật.
- Qua hồi quy đầy đủ (E7) trước khi triển khai (OTA hoặc `deploy.sh`).
- Ghi vào [incident-log.md](incident-log.md) và [weekly-report.md](weekly-report.md): bản, lý do, hồi quy.
- S1: đồng hồ pilot tính lại từ ngày bản vá chạy. Bản vá khác: không dừng đồng hồ nếu hồi quy xanh.
