// Chuỗi giao diện của Bảng Tag, Thiết lập project, inspector của Tag và chính sách lưu (feature 004,
// US2). Gộp vào viMessages ở vi.ts; quy ước như vi.ts.
export const viTags = {
  // ---- Bảng Tag (FR-020, FR-028, mockup bản 1) ----
  'tagGrid.hint': 'Nhấp đúp hoặc F2 để sửa · Enter xuống dòng · Ctrl+Z hoàn tác',
  'tagGrid.help':
    'Mũi tên hoặc Tab để di chuyển, Enter hoặc F2 để sửa, gõ để thay nội dung ô, Esc để hủy, Delete để xóa ô, Ctrl+D để điền xuống.',
  'tagGrid.tools': 'Công cụ Bảng Tag',
  'tagGrid.fillTip': 'Điền xuống (Ctrl+D): chép ô phía trên, tên Tag tự tăng số',
  'tagGrid.paste': 'Dán từ Excel',
  'tagGrid.importCsv': 'Nhập CSV',
  'tagGrid.exportCsv': 'Xuất CSV',
  'tagGrid.filter': 'Lọc Tag',
  'tagGrid.filterPlaceholder': 'Lọc Tag…',
  'tagGrid.count': '{shown}/{total} Tag',
  'tagGrid.deleted': 'Đã xóa {id} (Ctrl+Z để hoàn tác)',
  'tagGrid.empty.title': 'Chưa có Tag nào',
  'tagGrid.empty.text': 'Bấm Thêm Tag để tạo Tag đầu tiên.',
  'tagGrid.noMatch': 'Không có Tag nào khớp "{filter}".',
  'tagGrid.broken':
    'Không đọc được {file}: sửa file bằng trình soạn thảo rồi Kiểm tra (F7). Lỗi chi tiết ở tab Thông tin.',
  'tagGrid.issue': '{code}: {message}',
  'tagGrid.live.none': 'không có trên thiết bị',
  'tagGrid.live.stale': 'mất kết nối',

  // ---- Thiết lập project (FR-019, mockup bản 1) ----
  'settings.general': 'Chung',
  'settings.runtime': 'Chạy trên thiết bị',
  'settings.logging': 'Lưu trữ dữ liệu',
  'settings.projectName': 'Tên project',
  'settings.projectName.help': 'Hiện trên thanh tiêu đề Studio và trang runtime.',
  'settings.projectId': 'Mã project',
  'settings.projectId.help': 'Đặt khi tạo project, không đổi được.',
  'settings.projectVersion': 'Phiên bản',
  'settings.projectVersion.help':
    'SemVer, ví dụ 0.1.1. Thiết bị hiện phiên bản này ở thanh trạng thái khi theo dõi.',
  'settings.entryScreen': 'Màn hình đầu',
  'settings.entryScreen.help': 'Trang runtime mở màn hình này trước.',
  'settings.entryScreen.option': '{name} ({id})',
  'settings.entryScreen.missing': '{id} (không có trong project)',
  'settings.maxClients': 'Số client tối đa',
  'settings.maxClients.help': 'Từ 1 đến 10, không vượt giới hạn cứng của runtime.',
  'settings.minRuntimeVersion': 'Runtime tối thiểu',
  'settings.minRuntimeVersion.help': 'Thiết bị chạy runtime cũ hơn sẽ từ chối project.',
  'settings.timeZone': 'Múi giờ cột thời gian',
  'settings.timeZone.help': 'Đặt trong logging.json; editor lưu trữ đầy đủ ở GĐ 5.',
  'settings.timeZone.value': 'UTC{offset}',
  'settings.issue': '{code}: {message}',
  'settings.otherIssues': 'Lỗi ở trường khác của project.json (sửa bằng trình soạn thảo):',
  'settings.broken':
    'Không đọc được project.json: sửa file bằng trình soạn thảo rồi Kiểm tra (F7). Lỗi chi tiết ở tab Thông tin.',

  // ---- Inspector › Thuộc tính của Tag (FR-006, mockup bản 1) ----
  'tagProps.ctx': 'Tag {id} · sửa trong lưới',
  'tagProps.name': 'Tên',
  'tagProps.type': 'Kiểu dữ liệu',
  'tagProps.source': 'Nguồn',
  'tagProps.unit': 'Đơn vị',
  'tagProps.range': 'Phạm vi',
  'tagProps.rangeValue': '{min} – {max}',
  'tagProps.description': 'Mô tả',
  'tagProps.live': 'Giá trị sống',
  'tagProps.liveValue': '{value} · {quality}',
  'tagProps.whereUsed': 'Dùng ở đâu',
  'tagProps.unused': 'Chưa dùng ở màn hình hay nhóm lưu trữ nào.',
  'tagProps.gotoRef': 'Mở {ref}',

  // ---- Chính sách lưu, đóng gói (FR-023) ----
  'policy.errors': 'Còn {n} lỗi: thiết bị sẽ từ chối project này.',
  'policy.warnings': 'Không có lỗi, còn {n} cảnh báo: thiết bị vẫn nhận project này.',
  'policy.valid': 'Không có lỗi: thiết bị sẽ nhận project này.',
} as const;
