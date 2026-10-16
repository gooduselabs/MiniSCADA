// Chuỗi giao diện cho project 0.2 (feature 006): hộp thoại Nâng cấp 0.1 → 0.2, từ chối project mới hơn, chế độ chỉ đọc,
// thông báo sao lưu. Gộp vào viMessages ở vi.ts; quy ước như vi.ts.
export const viProject02 = {
  // ---- Hộp thoại Nâng cấp (FR-003, FR-004) ----
  'upgrade.title': 'Mở project định dạng {from}',
  'upgrade.text':
    'Project này ở định dạng {from}. Nâng cấp lên 0.6.0 để nhập SVG, động hóa phần tử theo Tag, gắn sự kiện nhấp, dùng alarm, lịch sử và báo cáo: chỉ đổi schemaVersion của mọi tệp và nâng runtime tối thiểu lên 0.7.0 (0.4), 0.8.0 (0.5) rồi 0.9.0 (0.6); nội dung giữ nguyên, không tạo tệp alarm hay báo cáo (project 0.1 và 0.2 còn qua các bước: kết nối Modbus, Tag tính toán, bảng giá trị, màn hình nhiều widget, điều hướng và điều khiển từ Chrome). Project 0.4 cần runtime từ 0.7.0, 0.5 từ 0.8.0, 0.6 từ 0.9.0.',
  'upgrade.changes': 'Việc nâng cấp sẽ làm',
  'upgrade.change.legacyTags':
    '{count} Tag mock thành Tag mô phỏng legacy (giá trị giống hệt trước đây)',
  'upgrade.change.minRuntime': 'Runtime tối thiểu {version}',
  'upgrade.change.rewrite': 'Ghi lại {files}',
  'upgrade.change.screens': 'Chuyển {count} màn hình sang định dạng nhiều mục (0.3)',
  'upgrade.change.navigation': 'Thêm menu điều hướng {entries} mục',
  'upgrade.change.svgClean':
    'Làm sạch SVG theo danh sách an toàn của 0.4: bỏ {elements} phần tử và {attributes} thuộc tính ở {files} file (giữ nguyên id và UID, hình không đổi). Ví dụ: {detail}',
  'upgrade.svgClean.element': '<{name}> ×{count}',
  'upgrade.svgClean.attrs': '{count} thuộc tính',
  'upgrade.svgClean.dtd': 'khai báo DOCTYPE',
  'upgrade.change.originalErrors': 'Project gốc có {count} lỗi: mang sang, không chặn nâng cấp',
  'upgrade.backup': 'Bản sao lưu: {dir} (tạo ở lần lưu đầu, trước khi ghi)',
  'upgrade.noWrite': 'Studio chưa ghi gì: đĩa chỉ đổi khi bạn bấm Lưu.',
  'upgrade.planning': 'Đang tính các thay đổi…',
  'upgrade.failed':
    'Project này không nâng cấp được: {reason}. Mở chỉ đọc để xem hoặc nạp xuống nguyên trạng.',
  'upgrade.error.UNREADABLE': 'không đọc được {file}',
  'upgrade.error.UNSUPPORTED_VERSION': 'phiên bản {version} chưa hỗ trợ',
  'upgrade.error.NEW_ERRORS': 'bản mới có lỗi mới ({errors})',
  'upgrade.error.ALREADY_02': 'project đã ở định dạng mới nhất',
  'upgrade.error.ALREADY_03': 'project đã ở định dạng 0.3',
  'upgrade.error.ALREADY_04': 'project đã ở định dạng 0.4',
  'upgrade.error.ALREADY_05': 'project đã ở định dạng mới nhất',
  'upgrade.error.NO_PROJECT': 'chưa mở project',
  'upgrade.error.other': 'lỗi không rõ',
  'upgrade.do': 'Nâng cấp',
  'upgrade.readonly': 'Mở chỉ đọc',
  'upgrade.cancel': 'Hủy',
  'upgrade.readonlyHelp':
    'Mở chỉ đọc: xem, kiểm tra, xem trước, Mô phỏng legacy và Nạp xuống nguyên trạng; mọi lệnh sửa bị khóa.',
  'upgrade.done': 'Đã nâng cấp trong bộ nhớ. Bấm Lưu để ghi (Studio sao lưu bản gốc trước).',
  'upgrade.readonlyOpened': 'Đã mở chỉ đọc. Mọi lệnh sửa bị khóa.',
  'upgrade.backedUp': 'Đã sao lưu bản gốc vào {dir} ({abs}).',
  'upgrade.failedToast': 'Không nâng cấp được: {reason}',
  'save.error.backup': 'không sao lưu được bản gốc ({reason}); chưa ghi file nào',
  'save.backup.exists': 'thư mục sao lưu đã có',
  'save.backup.changed': 'file {file} đã bị sửa ngoài Studio',
  'save.backup.other': 'lỗi {reason}',

  // ---- Từ chối project mới hơn (FR-005) ----
  'refused.title': 'Project mới hơn mức Studio hiểu',
  'refused.text':
    'Project này ở định dạng {version}, mới hơn mức Studio này hiểu (0.1 đến 0.6). Hãy dùng Studio mới hơn để mở; Studio không đọc thêm và không ghi gì.',
  'refused.close': 'Đóng',

  // ---- Chỉ đọc ----
  'reason.readOnly': 'Project mở chỉ đọc (định dạng 0.1): hãy nâng cấp để sửa',
  'tagTable.readOnlyBanner':
    'Project 0.1 mở chỉ đọc: xem được, không sửa được. Nâng cấp lên 0.2 để sửa (File › Mở lại project).',
} as const;
