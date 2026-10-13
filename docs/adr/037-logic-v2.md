# ADR-037: Logic v2: luật và khối khai báo (`logic.json`), hai engine dùng chung vector, ghi PLC khai báo và có giới hạn

- **Trạng thái:** Proposed (feature 011, GĐ 6; quyết định "người dùng giao toàn quyền 2026-10-11"). Cần Constitution PATCH 2.0.2 (task T004) trước khi viết mã ghi PLC. Chuyển Accepted ở Go/No-Go (T198).
- **Ngày:** 2026-10-13
- **Liên quan:** [specs/011-pilot-hardening](../../specs/011-pilot-hardening/plan.md), research R20–R23, R31; contract [logic-engine.md](../../specs/011-pilot-hardening/contracts/logic-engine.md); [ADR-015](015-expression-language.md) (biểu thức), [ADR-017](017-tag-engine-v1.md) (Tag Engine, `WriteCoordinator`, retain), [ADR-011](011-auth-roles-audit.md) (audit FULL); Constitution II, V.

## Bối cảnh

Tag tính toán (006) cho ra giá trị nhưng không có trạng thái, thời gian hay lệnh ghi. Khách hàng cần: khi điều kiện đúng thì đặt Tag, timer, counter, cộng dồn lưu lượng, giờ chạy, lịch. Constitution V cấm script tùy ý và đòi mọi lệnh ghi qua kiểm quyền và audit; "lệnh ghi từ logic xuống PLC khai báo rõ và có audit; interlock ở PLC" (roadmap §5).

## Các phương án

| Vấn đề | Phương án | Chọn |
|---|---|---|
| Mô hình | script (Lua, JS); ladder/FBD đồ họa; máy trạng thái tổng quát; **luật và khối khai báo** | khai báo |
| Biểu thức | ngôn ngữ mới; **ADR-015 không thêm hàm có trạng thái** | ADR-015 |
| Engine | chỉ C++; chỉ TS; **hai bản dùng chung vector** (như biểu thức, Constitution II) | hai bản |
| Thời gian | giờ thực; **monotonic (lịch dùng giờ thực)** | monotonic |
| Ghi PLC | cho ghi mọi Tag; **khai báo `writes` + giới hạn + audit + tắt mặc định + dừng khẩn cấp** | khai báo |
| Chủ thể ghi | tài khoản "logic"; **`logic:<ruleId>`, ủy quyền bởi người nạp xuống (engineer) và `writes`** | `logic:<ruleId>` |
| Lưu trạng thái | mỗi thay đổi; **mỗi 60 s qua `RetainStore`** | 60 s |

## Quyết định

1. **`logic.json`** (project 1.0.0) gồm `rules`, `timers` (`ton`, `tof`, `tp`), `counters`, `totalizers`, `runhours`, `schedules`, `writes`; giới hạn 200/100/100/50/50/50/100; đầu ra là **Tag logic** (nội bộ, chỉ đọc với bên ngoài, `OWNED_BY_LOGIC`). Không vòng lặp, không hàm người dùng, không truy cập ngoài.
2. **Ngữ nghĩa luật** (contract §2): `hold` thay timer rời; cạnh sau khi ổn định; điều kiện `unknown` (BAD, STALE, lỗi biểu thức, giờ chưa đồng bộ) ⇒ `SUSPENDED` đóng băng, không cạnh giả; `fireOnStart: false`; `repeatMs` tùy chọn; `edgeId` khử trùng lặp; thứ tự theo id; sắp xếp tô-pô, `E_LOGIC_CYCLE`, `E_LOGIC_SELF_TRIGGER`.
3. **Engine hai bản:** `packages/logic-engine` (TS, mô phỏng Studio) và `core/logic` (C++, runtime); đồng hồ và giờ thực tiêm vào; số học không FMA; bộ vector ≥ 200 ca kiểm cả hai.
4. **Ghi PLC từ logic:** mọi hành động `write`/`pulse` tham chiếu một mục `writes` (Tag RW, giá trị cho phép, `minIntervalMs` ≥ 1.000, `maxPerHour`); đi qua `WriteCoordinator` với đủ chuỗi kiểm của 006 và **audit bền trước khi gửi** (`actor` `logic:<id>`, `channel` `logic`, ≤ 8 giá trị đầu vào); trần toàn thiết bị `logic.maxWritesPerMin` (20); `logic.writes` mặc định `off` ở `runtime.json` (root); administrator dừng ngay bằng API (giữ qua khởi động lại), bật lại chỉ bằng root; Studio liệt kê ghi tự động ở bước xem trước Nạp xuống.
5. **Lưu trạng thái:** counter, totalizer, giờ chạy, `edgeId` qua `RetainStore` (`logic.flushS` 60 s, SIGTERM); mất tối đa một chu kỳ; không bao giờ giảm trừ khi reset; hỏng ⇒ 0 + cảnh báo + audit.
6. **Lịch:** múi giờ cố định (`tzOffsetMin`, mặc định UTC+7), không DST, không tzdata; giờ chưa đồng bộ ⇒ đầu ra BAD.
7. **Interlock an toàn vẫn ở PLC;** tài liệu nêu rõ.

## Hệ quả

- **Tốt:** bỏ logic nhỏ khỏi PLC; kiểm tĩnh và mô phỏng được; ngân sách ghi audit bị chặn (≤ 20 lệnh/phút ≈ 0,9 GB/ngày < 2 GB); không script.
- **Xấu:** hai bản engine phải giữ đồng bộ; counter không thấy cạnh nhanh hơn chu kỳ quét (khuyến nghị counter PLC > 5 Hz); mất tối đa 60 s cộng dồn khi mất điện.
- **Rủi ro:** máy tự ghi xuống PLC ngoài ý muốn: nhiều lớp (khai báo, hold, giới hạn, tắt mặc định, dừng khẩn cấp, audit); Constitution V cần làm rõ (PATCH 2.0.2).

## Điều kiện xem xét lại

- Khách cần đếm xung nhanh trong runtime: thêm đầu vào có dấu thời gian driver.
- Nhu cầu logic tuần tự (SFC/ladder): ngoài 1.x, xem lại với ADR mới.
- Ghi nhiều Tag một lô (recipe): dùng nền `writes` và audit lô (kế hoạch sau pilot).

## Số đo / bằng chứng

Điền ở T146, T147 (x64: độ chính xác, kill, tải), T148, T149 (BL335, cần người).
