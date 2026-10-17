# Bộ dữ liệu mẫu KPI pilot

Dữ liệu kiểm cho `tools/pilot/kpi.mjs` (spec 011 FR-138, SC-041; [contract test-protocols](../../specs/011-pilot-hardening/contracts/test-protocols.md) §6). Chạy: `node --test tools/pilot/kpi.test.mjs`.

Mỗi thư mục là một kịch bản:

- `data/lab/<yyyy-mm-dd>.jsonl`: mẫu thu như `tools/pilot/collect.ps1` ghi (dạng ở [data-model](../../specs/011-pilot-hardening/data-model.md) §6), mỗi 15 phút, giờ địa phương `+07:00`, site `lab`.
- `incident-log.md`: bảng "Sự cố" cùng cột với [docs/pilot/incident-log.md](../../docs/pilot/incident-log.md); dòng `INC-mau-00` của site khác để kiểm việc lọc theo site.
- `expected.json`: `args` (site, kỳ đo) và `expect` (các khóa cần kiểm của đầu ra KPI). Số trong `expect` tính tay theo quy tắc dưới đây, không lấy từ đầu ra của `kpi.mjs`. Test so từng khóa có trong `expect`; mảng phải đủ số phần tử.

Dữ liệu là số giả lập, không có tên Tag, giá trị quy trình hay địa chỉ thật.

## Kịch bản

| Thư mục | Tình huống | Điểm kiểm chính |
|---|---|---|
| `01-normal` | 8 ngày (2 tuần) không sự cố; `emmcLife.typeA` tăng 1 bậc ngày thứ 5 | uptime 1; thống kê RSS, CPU theo tuần; ghi đĩa mỗi ngày; `liveLag` theo tuần; X1, X2, X4 Đạt |
| `02-restart-mid-period` | runtime crash sau mẫu 12:00, lên lại 12:10 | ngừng ước tính 10 phút, `lastReason = crash`; bộ đếm ghi đĩa về 0 vẫn cộng đúng; RSS 160 MB: X11 Không đạt; X1 Không đạt |
| `03-clock-jump` | đồng hồ nhảy tới 2 giờ khi NTP đồng bộ muộn | không phải khoảng trống, không phải khởi động lại; ghi vào `clockJumps` |
| `04-data-gap` | mất dữ liệu 06:00 đến 10:00 (tiến trình vẫn chạy); khoảng trống 14:00 đến 15:00 có sự cố `product` xác nhận | khoảng thứ nhất không tính; khoảng thứ hai tính 60 phút |
| `05-site-power-excluded` | site mất điện 08:00 đến 10:00, boot id đổi | 136 phút ngừng loại trừ nhờ dòng loại `site` |
| `06-planned-update-excluded` | cập nhật `rc.1` lên `rc.2` có kế hoạch | 6 phút loại trừ nhờ dòng loại `planned`; S2 mở chưa có cách tránh và chưa rõ nguyên nhân: X2 Không đạt |
| `07-missing-emmc` | thiết bị không đọc được `emmcLife` (`no-emmc`) | X4 Chưa đo dù ghi đĩa trong ngưỡng |

## Quy tắc tính

**Kỳ đo.** `--from` và `--to` là ngày địa phương, cả hai ngày đều tính: kỳ đo là `[from 00:00, to + 1 ngày 00:00)`. Múi giờ lấy từ `--tz` hoặc từ trường `t` của mẫu đầu tiên. Mẫu ngoài kỳ bị bỏ. Dòng trùng y hệt chỉ tính một lần; dòng không đọc được đếm vào `badLines`.

**Khởi động lại.** Giữa hai mẫu liền nhau A và B, tiến trình đã khởi động lại khi một trong ba điều đúng: `uptimeS` của B nhỏ hơn của A; `diag.restarts.total` tăng; `info.bootId` đổi (máy khởi động lại, `bootChanged`). Nguyên nhân là `diag.restarts.lastReason` của B khi bộ đếm tăng, nếu không là `unknown`.

**Ước tính thời gian ngừng.** Tiến trình mới bắt đầu lúc `B.t − B.uptimeS`. Không biết tiến trình cũ dừng lúc nào nên lấy cách bi quan: ngừng từ mẫu A đến lúc tiến trình mới bắt đầu, giới hạn trong `[0, B.t − A.t]`. Lấy mẫu 15 phút nên một lần khởi động lại có thể bị tính dư tối đa 15 phút.

**Đồng hồ nhảy.** Khi không có khởi động lại, `uptimeS` là đồng hồ đơn điệu của tiến trình. Nếu chênh lệch giữa giờ tường (`B.t − A.t`) và `B.uptimeS − A.uptimeS` lớn hơn 60 s thì ghi một mục `clockJumps` (`shiftS` dương là nhảy tới) và dùng thời lượng theo `uptimeS`. Đồng hồ nhảy không tạo khoảng trống và không tạo thời gian ngừng. Giới hạn: nếu đồng hồ nhảy đúng lúc tiến trình khởi động lại thì không tách được, thời gian ngừng ước tính có thể lệch (bị chặn bởi `B.t − A.t`).

**Khoảng trống dữ liệu.** Hai mẫu cách nhau hơn 30 phút (theo `uptimeS` khi cùng tiến trình), hoặc đầu kỳ đến mẫu đầu, hoặc mẫu cuối đến cuối kỳ. Khi `uptimeS` cho thấy tiến trình vẫn chạy suốt khoảng đó, đây là lỗi thu (VPN, máy thu tắt), **không** tính vào ngừng. Khoảng trống chỉ được tính (`counted: true`) khi nhật ký có sự cố loại `product` có khung giờ chồng lên (ví dụ runtime treo, không phục vụ dù tiến trình còn sống); khi đó tính cả khoảng.

**Loại trừ.** Một lần khởi động lại được loại trừ (không vào thời gian ngừng, ghi vào `uptime.excluded`) khi nhật ký có dòng loại `site` (mất điện, mạng của site) hoặc `planned` (bảo trì, cập nhật có kế hoạch) có khung giờ chồng lên khoảng ngừng. Bản ghi audit `system.update.committed` không đủ để loại trừ vì `collect.ps1` chỉ thu số dòng audit theo loại, không thu chi tiết: cập nhật có kế hoạch phải có dòng `planned` trong nhật ký.

**Khung giờ của một dòng nhật ký.** Nếu cột "Tác động" có hai thời điểm `YYYY-MM-DD HH:MM` (ví dụ "ngừng 2026-11-02 08:00 đến 2026-11-02 10:00") thì khung là giữa hai thời điểm đó; nếu không, khung là "Phát hiện" ± 60 phút. Giờ trong nhật ký là giờ địa phương.

**Uptime.** `ratio = 1 − (Σ ngừng không loại trừ) / (to − from)`, làm tròn 6 chữ số; X1 Đạt khi `ratio ≥ 0,999`.

**RSS, CPU, độ trễ.** Chia kỳ thành tuần 7 ngày tính từ `from` (tuần cuối có thể ngắn hơn). Mỗi tuần: số mẫu, trung bình (làm tròn 0,1), p95 theo hạng gần nhất (phần tử thứ `⌈0,95 n⌉` của dãy tăng dần), lớn nhất. `liveLag.weeklyMaxP95Ms` là giá trị `liveLagP95Ms` lớn nhất của từng tuần (`null` khi tuần không có mẫu).

**Ghi đĩa mỗi ngày.** `ioWriteBytesToday` là bộ đếm về 0 lúc 00:00 giờ địa phương và khi tiến trình khởi động. Trong một ngày, mỗi lần bộ đếm giảm là bắt đầu một đoạn mới; byte của ngày là tổng giá trị lớn nhất của các đoạn, từng thành phần (`history`, `audit`…) tính cùng cách. Phần ghi giữa mẫu cuối của một đoạn và lúc bộ đếm về 0 không thấy được (tối đa một chu kỳ thu). Ngưỡng 2 GB là 2 GiB, như `tools/soak/analyze.mjs`.

**eMMC.** `start` là `emmcLife` đầu tiên khác `null`, `end` là cái cuối; `stepsIncreased` là mức tăng lớn nhất của `typeA` và `typeB`. Không có `emmcLife` thì cả ba là `null` và `reason` lấy từ `emmcLifeReason`.

**Sự cố.** Chỉ đếm dòng có mã `INC-<site>-…` và "Phát hiện" trong kỳ, theo mức `S1` đến `S4`; dòng mức `-` đếm vào `events`. Cột đọc theo tên ("Mã" hoặc "ID", "Phát hiện", "Mức", "Loại" hoặc "Loại trừ uptime", "Tác động", "Nguyên nhân", "Trạng thái" hoặc "Đóng"), nên nhận cả bảng cũ theo data-model §6 (`site-power` được hiểu là `site`).

## Trạng thái tiêu chí

Mỗi tiêu chí là **Đạt**, **Không đạt** hoặc **Chưa đo**; thiếu dữ liệu không bao giờ là Đạt. Khi tiêu chí có phần `kpi.mjs` không đo được, phần đo được mà vượt ngưỡng cho Không đạt, còn lại là Chưa đo kèm ghi chú (`criteriaNotes`).

| # | `kpi.mjs` quyết định | Ghi chú |
|---|---|---|
| X1 | Đạt / Không đạt theo `ratio`; Chưa đo khi không có mẫu | |
| X2 | Không đạt khi có S1, quá 2 S2 chưa đóng, S2 trạng thái `mở` (chưa có cách tránh), hoặc S1/S2 chưa ghi nguyên nhân; Chưa đo khi không có nhật ký | |
| X3 | Không đạt khi `liveLagP95Ms` > 500 ms ở tuần nào đó; còn lại Chưa đo | đo đầu-cuối Chrome (`load-tester --latency`) không có trong dữ liệu thu |
| X4 | Không đạt khi có ngày ghi > 2 GiB hoặc `EXT_CSD` tăng > 1 bậc; Chưa đo khi thiếu ghi đĩa hoặc `emmcLife`; còn lại Đạt | |
| X5 đến X10 | luôn Chưa đo | đo ở chỗ khác (`criteria.md`) |
| X11 | Không đạt khi RSS > 150 MB hoặc CPU trung bình tuần > 30 %; còn lại Chưa đo | tmpfs ≤ 64 MB không có trong dữ liệu thu (đo bằng `mat-sample` của soak) |
