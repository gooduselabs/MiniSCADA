# @mat/alarm-engine

Động cơ alarm bản TypeScript của mAT SCADA (feature 009, phiên bản 0.1.0, `private`). Cùng ngữ nghĩa với bản C++ trên thiết bị (`core/alarm/alarm_engine.{hpp,cpp}`); hai bản chạy chung bộ vector `tests/alarm-vectors/` (SC-017).

Hợp đồng: [alarm-engine.md](../../specs/009-alarms/contracts/alarm-engine.md); mô hình dữ liệu: [data-model.md](../../specs/009-alarms/data-model.md) §4, §5; quyết định: [ADR-027](../../docs/adr/027-alarm-model-engine.md).

## Dùng ở đâu

- **Studio:** panel "Thử alarm" (`apps/studio/src/model/alarm-sim.ts`) chạy gói này với `SimEngine` của 006 trên đồng hồ ảo; xem trước màn hình ở chế độ Mô phỏng cũng cấp `AlarmSource` từ đây. Phụ thuộc một chiều: Studio dùng gói, gói không biết Studio.
- **Không dùng trên trang vận hành:** trang chỉ nhận trạng thái qua live 1.3.0 (`alarmSnapshot`, `alarmDelta`), không tự đánh giá alarm.

## Nguyên tắc

- **Thuần:** không I/O, không mạng, không ghi đĩa, không đọc đồng hồ; thời gian là tham số (`nowMonoMs` cho trễ, hết hạn tạm ẩn, cửa sổ chập chờn; `nowEpochMs` chỉ để ghi lần xảy ra).
- **Tất định:** cùng định nghĩa và cùng chuỗi `(nowMonoMs, nowEpochMs, tags, lệnh)` cho cùng chuỗi sự kiện.
- **Một luồng:** `step` và `load` gọi tuần tự; lệnh xác nhận, tạm ẩn, vô hiệu đi qua hộp thư của động cơ.

## Cấu trúc (theo contract, điền dần theo task T015 đến T032)

```text
src/
├── types.ts      # AlarmDefs, TagSample, AlarmEvent, AlarmView
├── engine.ts     # compileAlarms, AlarmEngine (load, step, lệnh)
├── text.ts       # chèn giá trị vào nội dung ({name}, {value:N}, {unit}, {limit}, ...)
├── vectors.ts    # bộ nạp vector dùng chung với test C++
└── index.ts
```

Trạng thái hiện tại: khung gói (T001); phần cài đặt đang làm. README này chỉ ghi phần đã chốt trong contract; cập nhật khi mỗi mô-đun xong.

## Test

```sh
npm run test --workspace @mat/alarm-engine
npm run typecheck --workspace @mat/alarm-engine
```

Vector nằm ở `tests/alarm-vectors/` (nhóm `text-*`, chuyển trạng thái, trễ, deadband, tạm ẩn, chập chờn); bản C++ đọc cùng tệp.
