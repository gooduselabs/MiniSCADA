# Tài liệu người dùng mAT SCADA

Chọn tài liệu theo việc bạn làm.

| Bạn là | Đọc | Nội dung |
|---|---|---|
| Người vận hành | [Hướng dẫn người vận hành](operator-guide.md) | đăng nhập, xem, điều khiển, trạng thái giá trị, alarm, khi có sự cố |
| Kỹ sư dựng project | [Hướng dẫn kỹ sư](engineer-guide.md) | Studio, kết nối Modbus, Tag, màn hình, SVG, template, logic, nạp xuống, chẩn đoán |
| Quản trị viên | [Hướng dẫn quản trị viên](admin-guide.md) | cài đặt, chứng chỉ, tài khoản, sao lưu, cập nhật, gia cố, chẩn đoán, ma trận phiên bản |
| Mọi người | [Thuật ngữ](glossary.md) | nghĩa của các từ dùng trong phần mềm |
| Mọi người | [Mã lỗi và cảnh báo](error-codes.md) | mọi mã lỗi, ý nghĩa, nơi dùng |

Tài liệu khác:

- Huấn luyện: [vận hành (2 giờ)](../training/operator.md), [kỹ sư (1 ngày)](../training/engineer.md), [quản trị (nửa ngày)](../training/admin.md), [hướng dẫn người dạy](../training/instructor.md).
- Triển khai chi tiết trên BL335: [mat-runtime.md](../deployment/mat-runtime.md), [vận hành alarm](../deployment/alarm-operations.md).
- Xuất SVG từ phần mềm vẽ: [svg-export.md](../guides/svg-export.md).

Tài liệu viết cho runtime 0.9 và Studio 0.8. Mục ghi **(có từ bản 1.0)** là tính năng của bản 1.0 theo đặc tả đã duyệt, bản hiện tại chưa có.

Bản HTML đi kèm bộ cài được dựng từ các tệp này bằng `node tools/build-docs.mjs` (ra `release/docs/`). Kiểm liên kết, lệnh và mã lỗi: `node tools/docs-check.mjs`.
