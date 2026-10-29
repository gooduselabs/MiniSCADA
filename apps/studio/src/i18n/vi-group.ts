// Chuỗi của trang nhóm trên cây (sửa lỗi 039): bấm vào mục nhóm mở trang giải thích, ví dụ, danh sách mục con, nút Thêm.
// Gộp vào viMessages ở vi.ts.
export const viGroup = {
  'group.items': 'Mục trong nhóm',
  'group.emptyList': 'Chưa có mục nào.',
  'group.valueTables.what':
    'Bảng giá trị đổi số thành chữ hoặc màu để người vận hành dễ đọc trên màn hình.',
  'group.valueTables.example': 'Ví dụ: trạng thái bơm 0 = Dừng, 1 = Chạy, 2 = Lỗi.',
  'group.valueTables.add': 'Thêm Bảng giá trị',
  'group.watchTables.what':
    'Bảng theo dõi xem và ghi thử giá trị của nhiều Tag cùng lúc khi chạy thử Mô phỏng hoặc Online với thiết bị.',
  'group.watchTables.example':
    'Ví dụ: gom Tag mức bồn, lệnh chạy bơm, nhiệt độ vào một bảng để kiểm tra khi chạy thử.',
  'group.watchTables.add': 'Thêm Bảng theo dõi',
  'group.screens.what': 'Màn hình và popup người vận hành xem trên trình duyệt của thiết bị.',
  'group.screens.example': 'Ví dụ: màn hình Tổng quan, màn hình Trạm bơm, popup Điều khiển bơm.',
  'group.screens.add': 'Thêm màn hình',
  'group.tagsFolder.what':
    'Tag là các điểm dữ liệu: đọc từ thiết bị qua Kết nối, hoặc tính từ Tag khác (Tag tính toán).',
  'group.tagsFolder.example':
    'Ví dụ: MucBon đọc thanh ghi Modbus 40001; TongLuuLuong = LuuLuong1 + LuuLuong2.',
  'group.alarm.what':
    'Alarm báo cho người vận hành khi giá trị Tag vượt ngưỡng hoặc đổi trạng thái.',
  'group.alarm.example': 'Ví dụ: MucBon > 90 thì báo "Bồn sắp tràn", lớp Khẩn cấp.',
  'group.users.what':
    'Người dùng, nhóm và quyền của thiết bị: quản lý khi Online bằng tài khoản administrator.',
  'group.users.example':
    'Ví dụ: nhóm Vận hành chỉ xem và điều khiển bơm, nhóm Bảo trì sửa thông số.',
  // ---- Câu dễ hiểu cho lỗi E_SCHEMA (sửa lỗi 039) ----
  'schema.root': 'tệp',
  'schema.emptyList': '"{field}" đang trống: cần ít nhất {min} mục.',
  'schema.fewItems': '"{field}" có {n} mục, cần ít nhất {min}.',
  'schema.manyItems': '"{field}" có {n} mục, nhiều nhất {max}.',
  'schema.required': '"{field}" thiếu trường bắt buộc "{prop}".',
  'schema.property': 'Trường "{prop}" có giá trị không hợp lệ hoặc không được phép.',
  'schema.type': '"{field}" sai kiểu dữ liệu, cần {want}.',
  'schema.tooLong': '"{field}" dài quá, tối đa {max} ký tự.',
  'schema.tooShort': '"{field}" ngắn quá, tối thiểu {min} ký tự.',
  'schema.pattern': '"{field}" sai định dạng.',
  'schema.max': '"{field}" lớn quá, tối đa {limit}.',
  'schema.min': '"{field}" nhỏ quá, tối thiểu {limit}.',
  'schema.enum': '"{field}" không phải giá trị được phép.',
  'schema.duplicate': '"{field}" có mục trùng nhau.',
  'schema.other': '"{field}" không hợp lệ ({message}).',
} as const;
