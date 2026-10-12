// Chuỗi giao diện của editor Lưu trữ chỉ đọc (feature 004, US4, FR-026, mockup bản 1).
// Gộp vào viMessages ở vi.ts; quy ước như vi.ts.
export const viLogging = {
  // ---- Đầu editor, ghi chú ----
  'logging.readonly': 'Chỉ đọc',
  'logging.readonlyTip':
    'Xem cấu hình lưu trữ. Muốn đổi: sửa file bằng tay rồi bấm Kiểm tra (F7) để đọc lại.',
  'logging.phaseChip': 'Editor sửa: GĐ 5',
  'logging.note':
    'Cấu hình này đã chạy trên thiết bị từ feature 003: runtime ghi SQLite trên thiết bị trước rồi gửi tiếp sang DB ngoài; mất kết nối không mất và không trùng dòng. Muốn đổi cấu hình: sửa {file} bằng tay rồi bấm Kiểm tra (F7) để đọc lại. Editor sửa lưu trữ có ở GĐ 5.',

  // ---- Không có cấu hình, không đọc được ----
  'logging.none.title': 'Project chưa lưu dữ liệu',
  'logging.none.text':
    'project.json không khai báo loggingFile nên runtime không ghi lịch sử Tag. Muốn lưu dữ liệu: thêm "loggingFile": "logging.json" vào project.json, viết logging.json (nhóm Tag, chế độ ghi, thời hạn, DB ngoài) rồi bấm Kiểm tra (F7).',
  'logging.none.doc':
    'Tài liệu cấu hình: specs/003-data-logging/contracts/logging-config.md (định dạng, ví dụ, mã lỗi).',
  'logging.noProject.title': 'Không đọc được project.json',
  'logging.noProject.text': 'Sửa project.json theo tab Thông tin rồi bấm Kiểm tra (F7) để đọc lại.',
  'logging.unreadable.title': 'Không đọc được {file}',
  'logging.unreadable.text':
    'Sửa file theo lỗi dưới đây (cũng có trong tab Thông tin) rồi bấm Kiểm tra (F7) để đọc lại.',
  'logging.fileIssues': 'Lỗi và cảnh báo của cả file',
  'logging.issue.error': 'Lỗi',
  'logging.issue.warning': 'Cảnh báo',
  'logging.issues.errors': '{n} lỗi',
  'logging.issues.warnings': '{n} cảnh báo',

  // ---- Ước tính ghi eMMC (cùng công thức với bộ kiểm tra) ----
  'logging.est.label': 'Ước tính ghi eMMC',
  'logging.est.write': '≈ {value}/ngày · {pct} ngân sách {budget}/ngày',
  'logging.est.storageLabel': 'Dung lượng để giữ đủ thời hạn lưu',
  'logging.est.storage': '≈ {value} · {pct} trần {budget}',
  'logging.est.help':
    'Tính theo trường hợp ghi nhiều nhất (nhóm theo thay đổi: một dòng mỗi khoảng ghi tối thiểu), cùng công thức với bộ kiểm tra của Studio và runtime. Vượt ngân sách chỉ cảnh báo, vẫn lưu và chạy được.',
  'logging.est.blocked': 'Chưa ước tính được: sửa lỗi của {file} trước (tab Thông tin).',
  'logging.est.noTags': 'Chưa ước tính được: chưa đọc được file Tag {file}.',
  'logging.pct': '{n} %',
  'logging.pctTiny': '< {n} %',
  'logging.size.b': '{n} B',
  'logging.size.kb': '{n} kB',
  'logging.size.mb': '{n} MB',
  'logging.size.gb': '{n} GB',
  'logging.size.gib': '{n} GiB',

  // ---- Nhóm lưu trữ ----
  'logging.groups': 'Nhóm lưu trữ',
  'logging.groups.count': '{n} nhóm',
  'logging.col.group': 'Nhóm',
  'logging.col.mode': 'Chế độ',
  'logging.col.interval': 'Khoảng ghi',
  'logging.col.tags': 'Tag',
  'logging.col.retention': 'Thời hạn',
  'logging.col.destinations': 'Gửi tới',
  'logging.group.unnamed': 'Nhóm {n}',
  'logging.mode.cyclic': 'Theo chu kỳ',
  'logging.mode.onChange': 'Theo thay đổi',
  'logging.interval.range': '{min} – {max}',
  'logging.interval.atLeast': '≥ {min}',
  'logging.days': '{n} ngày',
  'logging.localOnly': 'chỉ SQLite trên thiết bị',
  'logging.timeZone':
    'Giờ địa phương của dữ liệu: UTC{tz}, dùng để căn chu kỳ ghi và cho cột thời gian ở DB ngoài.',
  'logging.timeZoneDefault':
    'Giờ địa phương của dữ liệu: UTC{tz} (mặc định), dùng để căn chu kỳ ghi và cho cột thời gian ở DB ngoài.',
  'logging.dur.ms': '{n} ms',
  'logging.dur.s': '{n} s',
  'logging.dur.min': '{n} phút',
  'logging.dur.h': '{n} giờ',

  // ---- Tag của nhóm ----
  'logging.tags.title': 'Tag của nhóm {name}',
  'logging.col.tag': 'Tag',
  'logging.col.type': 'Kiểu',
  'logging.col.column': 'Cột',
  'logging.col.deadband': 'Deadband',
  'logging.col.when': 'Ghi khi',
  'logging.type.unknown': 'không có trong file Tag',
  'logging.type.maxLength': '{type}, tối đa {n} ký tự',
  'logging.when.cycle': 'ghi mỗi chu kỳ',
  'logging.when.change': 'ghi khi đổi',
  'logging.when.deadband': 'ghi khi đổi quá deadband',
  'logging.deadband.unused': '{value} (không dùng khi ghi theo chu kỳ)',

  // ---- Kết nối DB ngoài (không có mật khẩu: bí mật nằm trên thiết bị) ----
  'logging.conns': 'Kết nối DB ngoài',
  'logging.conns.none': 'Không có kết nối DB ngoài: dữ liệu chỉ nằm trong SQLite trên thiết bị.',
  'logging.col.conn': 'Kết nối',
  'logging.col.connType': 'Loại',
  'logging.col.server': 'Máy chủ',
  'logging.col.tables': 'Bảng',
  'logging.col.tls': 'TLS',
  'logging.connType.mysql': 'MySQL/MariaDB',
  'logging.connType.mssql': 'SQL Server',
  'logging.connType.postgresql': 'PostgreSQL',
  'logging.connType.influxdb': 'InfluxDB',
  'logging.server.influx': '{url} · org {org} · bucket {bucket}',
  'logging.server.masked': 'Đã che tài khoản, mật khẩu trong địa chỉ',
  'logging.tables.none': 'chưa có nhóm nào gửi tới',
  'logging.tls.default': '{mode} (mặc định)',
  'logging.tls.byUrl': 'theo URL ({scheme})',
  'logging.tls.verifyFull': 'xác thực máy chủ',
  'logging.tls.require': 'mã hóa, không xác thực máy chủ',
  'logging.tls.prefer': 'mã hóa nếu máy chủ hỗ trợ, không xác thực máy chủ',
  'logging.tls.disable': 'không mã hóa',
  'logging.secrets':
    'Mật khẩu và token của DB ngoài lưu trên thiết bị (secrets.json), không nằm trong project và không đi theo gói nạp xuống.',

  // ---- Inspector › Thuộc tính của nhóm ----
  'logging.props.ctx': 'Nhóm lưu trữ {name}',
  'logging.props.id': 'Mã nhóm',
  'logging.props.mode': 'Chế độ',
  'logging.props.interval': 'Khoảng ghi',
  'logging.props.tags': 'Số Tag',
  'logging.props.retention': 'Thời hạn',
  'logging.props.retentionValue': '{n} ngày, tự xóa bản ghi cũ hơn',
  'logging.props.destinations': 'Gửi tới',
  'logging.props.table': 'Bảng ở DB ngoài',
  'logging.props.tableValue': '{table} (bảng rộng, mỗi Tag một cột)',
  'logging.props.cyclic': 'mỗi {period} một dòng',
  'logging.props.onChangeMax': 'cách nhau ít nhất {min}; không đổi thì vẫn ghi sau {max}',
  'logging.props.onChange': 'cách nhau ít nhất {min}; chỉ ghi khi có Tag đổi',
} as const;
