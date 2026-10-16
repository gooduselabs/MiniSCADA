# ADR-034: Chế độ ghi theo Tag kích hoạt, ước tính ghi eMMC mở rộng, chặn mềm và đo ghi thực

- **Trạng thái:** Accepted trên x64 (2026-10-15). Hằng số ước tính khớp số đo x64 (độ lệch 3 %/4 %); xác nhận trên BL335 (SC-025, T143) **cần thiết bị**: chưa đo.
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/010-history-reports](../../specs/010-history-reports/spec.md) (US1, US7, FR-002…FR-008, FR-047…FR-049, FR-055…FR-057), [research R1, R12](../../specs/010-history-reports/research.md), [contracts/logging-config-0.2.md](../../specs/010-history-reports/contracts/logging-config-0.2.md); [ADR-008](008-data-logging.md), [ADR-005](005-resource-budget.md), [ADR-031](031-history-aggregates.md); Constitution III, VII.

## Bối cảnh

Lộ trình §4.6 yêu cầu thêm chế độ "kết hợp" và "theo Tag kích hoạt", mở rộng ước tính ghi eMMC cho chế độ mới, và "cảnh báo/chặn theo ngân sách". Đọc mã 003: chế độ kết hợp đã có (`onChange` + `maxIntervalMs`). Constitution VII (điều kiện lưu trữ 2026-10-10) bắt validator **cảnh báo, không chặn** cấu hình vượt ngân sách. Công thức 003 ước tính `onChange` bằng cận trên (một dòng mỗi `minIntervalMs`), quá thô cho nhóm ghi thưa.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Kết hợp | thêm `mode: hybrid`; **gọi tên tổ hợp có sẵn** | gọi tên: `onChange` + `maxIntervalMs` là "Kết hợp" ở Studio; không thêm `mode` |
| Trigger | bắt cạnh bằng bộ đếm revision của Tag; **lấy mẫu 100 ms của historian** | lấy mẫu 100 ms; xung < 100 ms có thể bỏ sót (tài liệu) |
| Ước tính thưa | giữ cận trên; **thêm gợi ý `expectedRowsPerDay` (và số đo)** | thêm `expectedRowsPerDay`; Studio điền từ số đo thiết bị |
| Ngân sách | chặn lưu/nạp; **chặn mềm: cảnh báo + xác nhận khi nạp xuống**; runtime tự giảm | chặn mềm; runtime không tự bỏ dữ liệu |
| Đo thực | `/sys/block/mmcblk*/stat`; **`/proc/self/io` `write_bytes`** | `/proc/self/io`: đúng tiến trình, không cần quyền |

## Quyết định

1. `mode: "trigger"` với `trigger {tagId, edge ∈ rising|falling|both|active, threshold}`; trạng thái bật = BOOL đúng hoặc số > `threshold`; quality xấu = tắt, không tạo cạnh; không có cạnh lúc bắt đầu; `active` ghi mỗi `periodMs` (đơn điệu) khi bật và một dòng khi tắt; `minIntervalMs` hoãn cạnh sớm.
2. Ước tính v2: `trigger` và `onChange` dùng `min(cận trên, expectedRowsPerDay)`; thêm phần tổng hợp (`aggTags × (1.440 + 24) × 64` byte/ngày, nhân hai cho WAL) và dung lượng theo thời hạn bucket; thêm `W_LOG_WRITE_EXTREME` (> 8 GiB/ngày). Một hàm TS (`@mat/project-schema`) và một hàm C++, cùng hằng số và thứ tự phép tính, kiểm bằng vector có số cố định.
3. **Chặn mềm** (Studio): lưu, xem trước, chạy không bị chặn; nạp xuống cấu hình có `W_LOG_WRITE_BUDGET` hoặc `W_LOG_SIZE_CAP` cần xác nhận "Tôi hiểu, vẫn nạp" (nút mặc định Hủy), `W_LOG_WRITE_EXTREME` cần gõ lại tên project; xác nhận gắn với băm của ước tính. Runtime không chặn và không tự bỏ dữ liệu; bảo vệ thiết bị vẫn là trần dung lượng và ngưỡng đĩa trống (003).
4. Đo ghi (bổ sung 2026-10-16: kernel BL335 không có `/proc/self/io` nên có thêm nguồn `sqlite-vfs`, [ADR-039](039-sqlite-write-meter.md)): `IoMeter` lấy `write_bytes` của `/proc/self/io` mỗi 60 s (vòng 1.440 ô), đưa `writeBytes1h`, `writeBytes24h`, `bytesPerDay` (ngoại suy) vào `system/info`; Studio hiện cạnh ước tính và có nút "Dùng số đo".
5. Mức sai số chấp nhận: ước tính và số đo cho hồ sơ chuẩn lệch ≤ 30 % (SC-025); lệch hơn thì hiệu chỉnh hằng số (kích thước hàng tổng hợp, hệ số WAL) ở cả hai bản và ghi vào mục "Số đo".

## Hệ quả

- **Tốt:** người dùng thấy con số trước khi nạp và còn quyền quyết định (Constitution VII); ước tính sát hơn nhờ số đo; Kết hợp không thêm hành vi mới.
- **Xấu:** `expectedRowsPerDay` là con số người dùng đoán (hoặc lấy từ số đo cũ), có thể lạc hậu; `write_bytes` gồm cả ghi khác của tiến trình và không phản ánh khuếch đại ghi trong eMMC; xung ngắn có thể bị bỏ sót ở `trigger`.
- **Rủi ro:** người dùng nạp bằng công cụ khác (không qua Studio) không thấy hộp xác nhận: runtime vẫn cảnh báo qua `historian.warnings` và `system/info`.

## Số đo / bằng chứng

**Hiệu chỉnh theo số đo x64 (2026-10-15).** `historian_tool soak`, 200 Tag FLOAT32 `onChange` 1 dòng/s, 3–7 ngày giả, `write_bytes` của tiến trình: ghi thô 688–731 MB/ngày so với ước tính ban đầu 503 MB; tổng hợp thêm 57 MB/ngày so với ước tính 36 MB. Đổi hai hằng số của `estimateLogging` (TS và C++): `COMMIT_PAGES` 3 → 6 (số trang SQLite sửa mỗi commit) và `AGG_WRITE_FACTOR` 2 → 3 (hệ số ghi tổng hợp); `aggRowBytes` 64 và công thức dung lượng giữ nguyên. Sáu ví dụ và vector `v06-logging-010-*` tính lại.

**Hiệu chỉnh lần hai (2026-10-15, ADR-031).** Sau khi đổi khóa `mat_agg` theo thời gian và ghi mỗi 15 phút, tổng hợp thêm 64,2 MB/ngày (ca xấu) so với ước tính 53,6 MB: `AGG_WRITE_FACTOR` 3 → 3,6 (TS, C++, vector `v06-logging-010-estimate-*`). Soak 7 ngày x 200 Tag: ghi tổng 795,2 MB/ngày đo so với 769,9 ước tính (lệch 3 %), không tổng hợp 731,0 so với 705,6 (4 %), tổng hợp thêm 64,2 so với 64,3: SC-025 đạt trên x64 (≤ 30 %).

Còn lại: SC-025 (BL335: T143) điền độ lệch ước tính so với `write_bytes`; sáu ví dụ tính tay của [contracts/logging-config-0.2.md §5](../../specs/010-history-reports/contracts/logging-config-0.2.md) là vector cố định của hai validator.

## Điều kiện xem xét lại

- Độ lệch ước tính so với số đo > 30 % ở hồ sơ chuẩn: hiệu chỉnh hằng số.
- Khách hàng cần bắt xung ngắn hơn 100 ms: dùng bộ đếm revision của `TagStore` hoặc cạnh do driver báo.
- Muốn chặn cứng ở runtime (giới hạn ghi theo ngày): cần sửa Constitution VII (ngoài phạm vi feature này).
