# ADR-027: Mô hình alarm và động cơ: instance theo ngưỡng, trạng thái ISA-18.2, hai bản động cơ với vector chung

- **Trạng thái:** Proposed (feature 009, GĐ 4; quyết định "người dùng giao toàn quyền 2026-10-11")
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/009-alarms](../../specs/009-alarms/plan.md), [spec](../../specs/009-alarms/spec.md) (D6–D11, D15–D17, D30, D33, D34; FR-002 đến FR-036), [research](../../specs/009-alarms/research.md) R2–R7, R11, R12, R24; [ADR-015](015-expression-language.md), [ADR-017](017-tag-engine-v1.md), [ADR-019](019-widget-library.md), [ADR-006](006-live-protocol-v1.md); [Constitution](../../.specify/memory/constitution.md) II, III, V, VI, VII.

## Bối cảnh

Runtime chưa có gì báo cho người vận hành khi máy có sự cố. Cần mô hình alarm đủ dùng cho 200 alarm trên BL335 (RSS ≤ 150 MB, CPU ≤ 30 %), đúng khung ISA-18.2 ở mức tối thiểu hợp lý, và kiểm được bằng test: kết quả ở thiết bị (C++) và ở Thử alarm trong Studio (TS) phải giống nhau (Constitution II). Tag Engine (ADR-017) đã có `TagStore` với `quality` và `reason`; ngôn ngữ biểu thức (ADR-015) đã có để làm Tag tính toán. Mất tín hiệu từ PLC là nguồn alarm giả thường gặp nhất: động cơ không được báo "hết" giả khi rút cáp.

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Ngưỡng | một instance có "mức" thay đổi (HH/H/L/LL trong cùng trạng thái); **mỗi ngưỡng một instance độc lập** `<id>.<ngưỡng>` | mỗi ngưỡng một instance (D7) |
| Vị trí động cơ | luồng riêng cho động cơ; **luồng tick, sau `TagEngine::step`** | luồng tick (D30) |
| Số bản động cơ | chỉ TS (chạy trong Studio, runtime nhúng JS); chỉ C++ (Studio không thử được); **hai bản C++ và TS với vector chung** | hai bản + vector |
| Điều kiện | biểu thức tự do trên alarm; **ba loại cố định** (`digital`, `limit`, `quality`), điều kiện phức làm bằng Tag tính toán | ba loại (D6) |
| Trạng thái | ISA-18.2 đầy đủ (suppressed by design, out-of-service, quản lý thay đổi); **4 trạng thái + cờ `shelved`, `disabled`** | tối thiểu (D8, D11) |
| Quality xấu | báo "hết" hoặc "bật" theo giá trị cuối; **giữ nguyên trạng thái, cờ `inputBad`**, alarm `quality` báo mất tín hiệu | giữ nguyên (D16) |
| Chập chờn | giới hạn tốc độ ghi toàn cục; **tự cách ly từng instance** | tự cách ly (D15) |

## Quyết định

1. **Ba loại alarm:** `digital` (BOOL hoặc số nguyên, `trigger` true/false), `limit` (số; `HH`, `H`, `L`, `LL`; deadband chung, trễ bật/tắt chung, lớp và nội dung riêng từng ngưỡng), `quality` (`tag` hoặc `device`; `on` = `bad` hoặc `notGood`). Không có biểu thức riêng: điều kiện phức làm bằng Tag tính toán của 006 rồi đặt alarm số trên đó.
2. **Instance theo ngưỡng:** alarm `digital` và `quality` có một instance (id = id định nghĩa); alarm `limit` có tối đa bốn, id `<id>.<ngưỡng>`. Mỗi instance có lớp, trạng thái, lịch sử riêng. Giới hạn 500 instance mỗi project, nghiệm thu ở 200, trên 200 cảnh báo `W_ALARM_COUNT_HIGH`.
3. **Trạng thái ISA-18.2:** `NORMAL`, `ACTIVE_UNACK`, `ACTIVE_ACK`, `RTN_UNACK` theo bảng chuyển trạng thái (data-model §5), cộng hai cờ độc lập `shelved` (operator, tối đa 8 giờ, tối đa 50, có lý do) và `disabled` (engineer, bền, có lý do), và cờ phụ `inputBad`. Lớp có hai núm: `requiresAck` và `ackReturn`. Mỗi lần bật là một lần xảy ra (occurrence) mang mã tăng dần; hết rồi đúng lại là lần xảy ra mới.
4. **Lớp alarm:** `priority` (`critical`, `major`, `minor`, `advisory`), `color` (tám token thiết kế), `blink`, `requiresAck`, `ackReturn`, `sound` (`none`, `beep`, `double`, `siren`), `chatterLimit` (mặc định 5 lần trong 60 s). Tối đa 16 lớp, 64 khu vực phẳng.
5. **Deadband và trễ:** ngưỡng cao bật khi giá trị ≥ ngưỡng, hết khi < ngưỡng − deadband; ngưỡng thấp bật khi ≤ ngưỡng, hết khi > ngưỡng + deadband; trong vùng deadband giữ nguyên. Trễ bật đo từ lúc điều kiện liên tục đúng, trễ tắt từ lúc liên tục sai, bằng đồng hồ đơn điệu; điều kiện đảo trước hạn đặt lại bộ đếm. Độ phân giải thực tế là chu kỳ tick (≤ 250 ms).
6. **Quality giữ nguyên:** Tag BAD hoặc giá trị không hữu hạn: alarm `digital` và `limit` giữ trạng thái và bộ đếm trễ, đặt `inputBad`; khi quality trở lại, bộ đếm bắt đầu lại từ giá trị mới. UNCERTAIN đánh giá như GOOD. Alarm `quality` mới là nơi báo mất tín hiệu và giữ `reason` vào lần xảy ra; với `device`, điều kiện đúng khi mọi Tag của thiết bị không GOOD.
7. **Hai bản động cơ, thời gian tiêm vào:** `core/alarm` (C++17, thuần: không I/O, không mạng, không giữ khóa `TagStore` quá một lần `snapshot`) và `packages/alarm-engine` (TS) cùng ngữ nghĩa, nhận `nowMonoMs`, `nowEpochMs` làm tham số. Hai bản chạy chung bộ vector `tests/alarm-vectors/` (≥ 60 ca: chuỗi điều kiện theo thời gian ảo → chuỗi chuyển trạng thái, gồm chập chờn, khởi động lại, đổi cấu hình, nhóm `text-*` cho bộ định dạng nội dung).
8. **Vị trí trên tick:** `AlarmEngine::step(nowMonoMs, nowEpochMs, tags)` chạy trên luồng tick ngay sau `TagEngine::step`, đọc Tag alarm tham chiếu qua một lần `snapshot` mỗi tick; không luồng riêng. Ghi `alarm.db` ở luồng riêng ([ADR-028](028-alarm-log-storage.md)); gửi live do `LiveHub` ([ADR-029](029-alarm-live-api.md)); động cơ không chờ hai nơi này.
9. **Khởi động và đổi project:** dựng lại lần xảy ra mở từ `alarm.db` rồi đánh giá lại: còn đúng thì giữ (không chạy lại trễ bật), sai thì hết sau trễ tắt, chưa có giá trị tin cậy thì giữ nguyên. Kích hoạt project mới so theo `id` instance và dấu vân tay điều kiện (loại, Tag hoặc thiết bị, ngưỡng, `trigger`, `on`): giống thì giữ lần mở; khác hoặc bị xóa thì đóng với dấu `config`; lớp, khu vực, nội dung đổi không đóng lần.
10. **Tự cách ly chập chờn:** instance bật ≥ `chatterLimit` lần trong 60 s bị shelve hệ thống 30 phút (lý do "chập chờn"), chỉ ghi một dòng tổng kết; tự gỡ khi hết hạn. Có trong bộ vector.
11. **Nội dung:** `text` có thẻ `{name}`, `{tag}`, `{value}`, `{value:N}`, `{unit}`, `{limit}`, `{limitName}`, `{area}`, `{reason}`; giá trị chèn là giá trị lúc bật, chụp một lần; nội dung mặc định tiếng Việt theo loại và ngưỡng; hai bản định dạng cùng vector, số lẻ làm tròn nửa ra xa 0 như ADR-015.

## Hệ quả

- **Tốt:**
  - Máy trạng thái ISA áp dụng đồng nhất cho mọi instance; test theo bảng (trạng thái × sự kiện), không ca ngoại lệ.
  - Không thêm đường đánh giá thứ hai: điều kiện phức dùng lại ADR-015.
  - Thử alarm trong Studio là chính động cơ TS, tương đương C++ đo được bằng vector (SC-004, SC-017).
  - Cùng luồng với `TagEngine::step`: thứ tự "Tag cập nhật rồi mới đánh giá" đúng, không khóa mới.
  - Xử lý chập chờn ở nguồn giữ cả màn hình lẫn ngân sách eMMC.
- **Xấu:**
  - Vượt cả H và HH hiện hai dòng (bảng xếp theo ưu tiên nên HH ở trên); mỗi ngưỡng tính vào giới hạn 500.
  - Phải giữ hai bản động cơ đồng bộ; mọi đổi ngữ nghĩa phải sửa cả hai và vector.
  - Điều kiện nhiều Tag bắt buộc đi qua Tag tính toán (thêm một Tag).
- **Rủi ro:**
  - Động cơ chạy trên luồng tick: nếu một tick vượt ngân sách sẽ làm chậm Tag Engine; chặn bằng giới hạn 500 instance, không cấp phát trong đường nóng, đo thời gian tick lớn nhất ở `system/info`.
  - Giữ nguyên trạng thái khi BAD có thể che alarm thật nếu alarm `quality` không được cấu hình; cảnh báo ở Studio (xem R4).
  - Shelve tự cách ly có thể che alarm thật chập chờn; giới hạn 30 phút và ghi audit hệ thống.

## Số đo / bằng chứng

Số x64 chạy trong container Docker (tham khảo); **BL335 chưa đo** (task T129, T130 chờ SSH và người).

- **Tương đương hai bản (SC-004): đạt.** `tests/alarm-vectors` có 16 nhóm, 99 ca; `alarm_engine_vectors_test` (C++) 100 test xanh trên x64 và armhf (qemu-user), `packages/alarm-engine` (TS) chạy cùng vector; văn bản và làm tròn: `alarm_text_test` chạy `fold` 50, `fold-table` 134, `round-table` 1.006 ca. Lệch đã ghi: dấu thập phân là dấu phẩy theo contract §11 (spec D41 ghi dấu chấm).
- **Ngân sách tick (FR-021), x64:** spike T007: `snapshot` 200 chỉ số 0,9 µs, `step` 500 instance 6,0 µs trung bình (qemu-arm 92 µs). `alarm_perf_test` T041 (500 instance, 200 Tag theo dõi, tick 250 ms): im lặng trung bình 8,8 µs (p99 39 µs, tối đa 686 µs); đi ngẫu nhiên trung bình 146 µs (p99 633 µs, tối đa 3,04 ms); bão trung bình 122 µs (p99 1,53 ms, tối đa 3,15 ms). Trung bình và p99 trong 2 ms; **giá trị tối đa đơn lẻ (3 ms) vượt 2 ms** trong container dùng chung CPU, ghi nhận, không kết luận cho BL335. Kịch bản bão tích hợp (T112): thời gian đánh giá lớn nhất 0,78 ms. Nên không đổi sang đánh giá theo thay đổi. Báo cáo: `docs/reports/009-tick-x64.json`.
- **Phần alarm thêm (SC-011), tham khảo x64 (T116):** 200 alarm + 500 Tag mô phỏng + 10 Chrome, 10 phút: CPU 0,5 % so với 0,2 % khi tắt (thêm 0,3 điểm), RSS tối đa 20,6 MB so với 17,2 MB (thêm 3,4 MB), trong ngưỡng 3 điểm và 4 MB. `docs/reports/009-budget-x64.json`. **BL335: chưa đo.**
- **Trạng thái và quality (tích hợp x64):** `state` 32, `quality` 9, `restart` 14 kiểm xanh (`docs/reports/009-{state,quality,restart}-x64.json`); shelve không sống sau khởi động lại khi đồng hồ chưa đúng (`clockOk=false`, FR-033).
- Tương đương phụ thuộc hai bản làm tròn số giống nhau: kiểm bằng `round-table` ở trên (1.006 ca).

## Điều kiện xem xét lại

- Cần điều kiện nhiều Tag mà Tag tính toán làm nặng: xem lại việc cho biểu thức riêng (ADR-015) trong alarm.
- Đo thấy tick alarm vượt ngân sách hoặc bão alarm lan tới Tag Engine: tách động cơ sang luồng riêng với hàng đợi một chiều.
- Khách cần ISA-18.2 đầy đủ (suppressed by design, quản lý thay đổi): mở lại D8 và D11.
- Cần khu vực nhiều cấp hoặc lớp theo điều kiện: mở lại D32.
