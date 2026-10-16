# Hướng dẫn người dạy

## 1. Trước buổi học (1 ngày trước)

- [ ] Bàn thử chạy runtime cùng phiên bản sẽ cài ở site; project `training-demo` đã nạp; ghi phiên bản vào phiếu đánh giá.
- [ ] PLC giả lập chạy được trên máy người dạy:

  ```sh
  node tools/modbus-sim/sim.mjs --tcp 1502 --control 1503 --map tools/modbus-sim/maps/training-demo.json
  ```

  Runtime chạy trên BL335 thì sửa "Địa chỉ máy" của kênh "PLC giả lập (huấn luyện)" thành IP máy người dạy rồi nạp lại. Mở cổng 1502/TCP trên tường lửa của máy người dạy cho mạng của bàn thử.
- [ ] Tài khoản riêng cho từng học viên (không dùng chung): vận hành `hv1`, `hv2`… vai trò `operator`; kỹ sư `ks1`… vai trò `engineer`; một tài khoản `viewer` để minh họa chỉ xem. Ghi mật khẩu tạm lên phiếu riêng, phát tay.
- [ ] Chứng chỉ thiết bị đã cài trên mọi máy học viên (khóa vận hành) hoặc chuẩn bị fingerprint để học viên tự ghim (khóa kỹ sư).
- [ ] In tài liệu: hướng dẫn tương ứng, phiếu đánh giá.

## 2. Tạo tình huống trong buổi học

| Tình huống | Cách tạo | Dùng cho |
|---|---|---|
| Tag BAD/STALE | dừng PLC giả lập (Ctrl+C), chạy lại sau | vận hành bài 2, kỹ sư K16 |
| Lệnh TIMEOUT | dừng giả lập ngay trước khi học viên bấm Xác nhận | vận hành bài kiểm mục 5 |
| Alarm mức | mức trong giả lập dao động 10–90 % mỗi 2 phút: chờ vượt 80 % | vận hành bài 4, kỹ sư K17 |
| Bơm lỗi | đặt bit 3 của `HR12` (giá trị 8) qua cổng điều khiển 1503 của giả lập, lệnh dưới bảng; đặt lại 0 để hết lỗi | alarm Khẩn cấp |
| Mất kết nối | rút cáp mạng máy học viên 1 phút | vận hành bài 5 |
| Bị khóa đăng nhập | học viên cố ý gõ sai 5 lần | quản trị bài 2 |
| Sai cấu hình | thêm khóa sai kiểu vào `runtime.json` (ví dụ `"logic": {"scanMs": 5}` trên bản 1.0, hoặc một khóa số mang giá trị chữ) | quản trị bài kiểm mục 4 |

Lệnh đặt bit lỗi bơm (chạy trên máy người dạy; API điều khiển: `tools/modbus-sim/control.mjs`):

```sh
curl -X POST http://127.0.0.1:1503/set -d '{"unit":1,"area":"holding","address":12,"value":8}'
```

Sau buổi học: khôi phục `runtime.json`, tắt tài khoản học viên (`mat-runtime --user-disable <tên>`), ghi vào sổ thay đổi của bàn thử.

## 3. Chấm bài kiểm

- Chỉ quan sát, không gợi ý. Học viên được tra tài liệu in.
- Ghi từng mục Đạt/Không đạt và ghi chú vào [evaluation-form.md](evaluation-form.md).
- Học viên hỏi người dạy trong lúc kiểm: ghi lại câu hỏi (đây là dữ liệu để sửa tài liệu) và tính mục đó Không đạt.
- Tổng hợp câu hỏi của học viên sau mỗi buổi vào `docs/pilot/training-results.md` (tạo khi có buổi học đầu tiên), kèm đề xuất sửa tài liệu.

## 4. An toàn

- Không bao giờ dạy trên thiết bị đang điều khiển máy thật.
- Không để mật khẩu trên bảng, slide hay ảnh chụp.
- Nút điều khiển của `training-demo` chỉ ghi vào PLC giả lập.
