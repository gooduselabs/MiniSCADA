# ADR-015: Ngôn ngữ biểu thức, bảng giá trị và bộ sinh mô phỏng dùng chung hai bản

- **Trạng thái:** Accepted (2026-10-13, sau khi hai bản TS và C++ khớp bộ vector chung và đạt SC-015 trên x64; feature 006, plan ngày 2026-10-11; người dùng giao toàn quyền quyết định cho phiên làm việc ngày 2026-10-11).
- **Ngày:** 2026-10-11
- **Liên quan:** [specs/006-tags-modbus](../../specs/006-tags-modbus/plan.md), research R17, R18; contracts [expression-language.md](../../specs/006-tags-modbus/contracts/expression-language.md), [value-tables-simulation.md](../../specs/006-tags-modbus/contracts/value-tables-simulation.md); Constitution II, V; [ADR-004](004-schema-versioning.md).

## Bối cảnh

Spec 006 cần Tag tính toán bằng biểu thức (`+ − × ÷ %`, so sánh, logic, `? :`, `min`, `max`, `abs`, `round`, `clamp`, `text`), bảng giá trị, và bộ sinh mô phỏng chạy giống nhau ở BL335 (C++) và Studio (TS).

Ràng buộc:

- **Constitution II:** biểu thức có hai bản dùng chung bộ vector JSON.
- **Constitution V:** không `eval`, không script.
- **SC-008:** ≥ 300 ca biểu thức, 100 % giống nhau về giá trị, kiểu, quality, mã lỗi.
- **Số:** `Math.round` của JS làm tròn nửa về phía +∞, khác C++; `Math.sin` và `std::sin` có thể khác nhau một ulp; GCC mặc định `-ffp-contract=fast` (kiểm ngày 2026-10-11).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Cú pháp | kiểu Excel (`IF`, `AND`); **kiểu C (`? :`, `&&`, `\|\|`)** | kiểu C, như spec |
| So sánh nối tiếp | kết hợp trái; **không kết hợp (lỗi cú pháp)** | không kết hợp |
| Parser | thư viện JS (jsep) + tự viết C++; **tự viết cả hai, cùng ngữ pháp** | tự viết |
| Chạy | duyệt cây; **bytecode máy ngăn xếp** | bytecode, lệnh nhảy cho `&&`, `\|\|`, `?:` |
| Số | decimal; **số thực 64 bit, không FMA** | số thực 64 bit; `round` tự viết; C++ `-ffp-contract=off` |
| Quality | xấu nhất của mọi đầu vào; **xấu nhất của đầu vào thực sự được nạp** | theo nhánh đã tính |
| Hàm sin của bộ sinh | `std::sin`/`Math.sin`; **tự viết (thu gọn quãng tám + đa thức fdlibm)** | tự viết |
| Ngẫu nhiên | PRNG có trạng thái (xorshift, splitmix64); **hàm băm theo bộ đếm 32 bit** | lowbias32 trên (hạt giống, ⌊t/T⌋) |
| Bảng giá trị | cho chồng, mục đầu thắng; **cấm chồng, khoảng nửa mở** | cấm chồng |

## Quyết định

1. **Ngữ pháp:**
   - thứ tự ưu tiên `?:` < `||` < `&&` < `== !=` < `< <= > >=` < `+ -` < `* / %` < một ngôi;
   - so sánh không kết hợp; số thập phân, chuỗi ngoặc kép, tên Tag theo luật id;
   - sáu hàm; `text(x, Bảng)`; `round(x, n)` với n viết thẳng 0–9.
2. **Kiểu:** `number`, `bool`, `string`; BOOL là 1/0 trong phép số; phép logic chỉ nhận `bool`; chuỗi chỉ dùng với `==`, `!=` và làm kết quả. Kiểm tĩnh khi kiểm project và khi gõ trong Studio.
3. **Ngữ nghĩa số:**
   - IEEE 754 64 bit, không FMA;
   - `round` nửa ra xa số 0 (`trunc` và so phần dư); `round(x, n)` qua nhân 10ⁿ, nên `round(1.005, 2)` = 1, có vector;
   - `%` theo `fmod`; chia cho 0, ∞, NaN, ngoài khoảng kiểu cho BAD kèm lý do.
4. **Quality:** xấu nhất của các đầu vào đã nạp; gặp đầu vào BAD thì kết quả BAD `INPUT_BAD` (hoặc `NO_VALUE`), giữ giá trị cuối.
5. **Giới hạn:** ≤ 1.000 ký tự; lồng ≤ 32 (độ sâu đệ quy của parser); ≤ 32 Tag đầu vào; chuỗi phụ thuộc ≤ 16 tầng; vòng tham chiếu là lỗi, báo ở mọi Tag trong vòng.
6. **Hai bản cùng cấu trúc:** `packages/expression` (TS) và `core/expression` (C++): tách từ → parser → kiểm kiểu → bytecode → chạy. Lỗi có `span` để gạch dưới.
7. **Bảng giá trị:** điểm hoặc khoảng nửa mở, cấm chồng, có mặc định; dùng cho `text()`, Studio và binding `valueTable`.
8. **Bộ sinh mô phỏng:**
   - hàm tất định của thời gian UTC (`const`, `ramp`, `sine`, `random`, `square`, `manual`), dùng phép nguyên chính xác cho `t mod T`;
   - `sinTurns` tự viết; `random` = lowbias32 trên bộ đếm;
   - `legacy` (Tag mock của 0.1) giữ `MockTagProvider`.
9. **Bộ vector chung:**
   - `tests/expression-vectors` (≥ 300 ca), `tests/value-table-vectors`, `tests/sim-vectors`; so từng bit;
   - ca sinh tự động lấy kết quả từ một bộ tính tham chiếu viết riêng trong script sinh.

## Hệ quả

- **Tốt:**
  - Studio xem trước và Mô phỏng cho đúng giá trị BL335 sẽ tính.
  - Tính lười giống hệt nhau nên chọn nguồn dự phòng bằng `?:` dùng được (US4-6).
  - Không có script, không `eval`.
- **Xấu:**
  - Hai bản phải giữ khớp; mỗi thay đổi ngữ nghĩa cần vector mới ở cả hai.
  - `round(1.005, 2)` = 1 có thể làm người dùng bất ngờ (ghi trong trợ giúp của Studio).
  - Bản C++ phải build với `-ffp-contract=off`; ai thêm cờ CPU cũng phải giữ cờ này.
  - Sin tự viết sai số dưới 2 ulp so với sin thật (đủ cho mô phỏng).

## Số đo / bằng chứng

- **Ngày 2026-10-11:**
  - `g++ -Q --help=optimizers` của toolchain: `-ffp-contract=fast` mặc định (x64 và armhf, cả `-std=c++17`); armhf mặc định `-mfpu=vfpv3-d16` (không có FMA).
  - Bản thử `sinTurns` (Node, scratchpad): lệch so với `Math.sin` tối đa 6,9e-16 trên 2 triệu điểm; sin(2π·0.25) = 1 đúng.
  - jsep 1.4.0 (MIT) có sẵn nhưng chỉ có bản JS.
- **Chưa đo:** thời gian tính 200 Tag tính toán trên BL335 (ước dưới 1 ms mỗi giây, đo cùng SC-004).

## Điều kiện xem xét lại

- Cần biểu thức trong binding (GĐ 3b), alarm theo biểu thức (GĐ 4), hay logic v2 (timer, counter: GĐ 6): mở rộng ngữ pháp bằng MINOR, giữ tương thích ngược.
- Người dùng cần tính toán thập phân chính xác (tiền, năng lượng cộng dồn): xét kiểu decimal.
- Hiệu năng không đạt trên BL335 với tải SC-004.

## Số đo x64 khi chuyển Accepted (2026-10-13)

- Bộ vector chung `tests/expression-vectors` (556 ca) và `tests/sim-vectors`: bản TS và bản C++ cho cùng kết quả từng bit; ctest và vitest xanh.
- SC-015 (Studio, 500 Tag tính toán): gợi ý tên Tag p95 9,4 ms (ngưỡng 200 ms), báo lỗi biểu thức p95 289 ms (ngưỡng 500 ms), mở editor 157 ms (`apps/studio/tests/e2e/out/calc.json`).
- 200 Tag tính toán cùng 100 Tag nội bộ trên tải 500 Tag, 10 client, 60 s: 12.000 lần đổi đầu vào, 0 lần Tag tính toán không nằm cùng delta, CPU 0,6 % một lõi (`docs/reports/006-calc-x64.json`).
- Fuzz biểu thức và giới hạn độ sâu: `limits.json` trong bộ vector; rà bảo mật 2026-10-13 ghi nhận chuỗi toán tử nhị phân dài chưa có bộ đếm độ sâu riêng (mức Low, `docs/reports/006-acceptance.md` §review).
- Thời gian tính trên BL335 ghi cùng SC-004 (T219); không chặn việc chấp nhận vì quyết định ngôn ngữ không đổi theo số đo đó (điều kiện xem xét lại ở trên vẫn áp dụng).
