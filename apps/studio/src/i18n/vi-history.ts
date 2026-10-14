// Chuỗi giao diện của feature 010 (editor Lưu trữ, khung Ước tính ghi, hộp thoại chặn mềm, editor Mẫu báo cáo,
// Toolbox lịch sử). Khóa tiền tố `hist.` (lưu trữ), `rpt.` (mẫu báo cáo), `hw.` (widget lịch sử).
export const viHistory = {
  'rtd.hit.trigger': 'Tag kích hoạt của nhóm lưu trữ “{group}”',
  'rtd.hit.report': 'Cột của mẫu báo cáo “{report}”',

  // ---- đơn vị, chế độ, cạnh ----
  'hist.unit.ms': 'ms',
  'hist.unit.s': 's',
  'hist.unit.min': 'phút',
  'hist.unit.h': 'giờ',
  'hist.on': 'Bật',
  'hist.off': 'Tắt',
  'hist.dash': '—',
  'hist.mode.cyclic': 'Chu kỳ',
  'hist.mode.onChange': 'Thay đổi',
  'hist.mode.combined': 'Kết hợp',
  'hist.mode.trigger': 'Kích hoạt',
  'hist.mode.help.cyclic': 'Ghi một dòng mỗi chu kỳ.',
  'hist.mode.help.onChange':
    'Ghi khi một Tag đổi vượt deadband, không quá một dòng mỗi khoảng tối thiểu.',
  'hist.mode.help.combined':
    'Ghi khi đổi như "Thay đổi", và chắc chắn có một dòng sau mỗi khoảng tối đa dù không đổi.',
  'hist.mode.help.trigger':
    'Ghi một dòng khi Tag kích hoạt có cạnh (hoặc theo chu kỳ khi đang bật).',
  'hist.edge.rising': 'cạnh lên',
  'hist.edge.falling': 'cạnh xuống',
  'hist.edge.both': 'cả hai cạnh',
  'hist.edge.active': 'khi đang bật',
  'hist.interval.min': '≥ {d}',
  'hist.interval.trigger': '{edge} của {tag}',

  // ---- cột lưới ----
  'hist.col.id': 'id',
  'hist.col.name': 'Tên',
  'hist.col.mode': 'Chế độ',
  'hist.col.interval': 'Chu kỳ / khoảng ghi',
  'hist.col.retention': 'Lưu (ngày)',
  'hist.col.tags': 'Tag',
  'hist.col.agg': 'Tổng hợp',
  'hist.col.mbPerDay': 'Ghi MB/ngày',
  'hist.tcol.tag': 'Tag',
  'hist.tcol.column': 'Cột',
  'hist.tcol.deadband': 'Deadband',
  'hist.tcol.length': 'Độ dài',
  'hist.tcol.agg': 'Tổng hợp',
  'hist.tcol.note': 'Ghi chú',
  'hist.tag.unknown': 'Tag không có trong project',

  // ---- lỗi theo ô ----
  'hist.err.readOnly': 'Cấu hình lưu trữ đang ở chế độ chỉ đọc.',
  'hist.err.readOnlyCell': 'Ô này không sửa được ở đây.',
  'hist.err.row': 'Dòng không tồn tại.',
  'hist.err.int': 'Nhập số nguyên không âm.',
  'hist.err.number': 'Nhập số không âm (dùng dấu chấm hoặc phẩy).',
  'hist.err.bool': 'Nhập Bật hoặc Tắt.',
  'hist.err.mode': 'Chế độ phải là Chu kỳ, Thay đổi, Kết hợp hoặc Kích hoạt.',
  'hist.err.duration': 'Nhập khoảng thời gian, ví dụ 500 ms, 5 s, 1 phút.',
  'hist.err.range': 'Nhập "tối thiểu – tối đa", ví dụ 1 s – 60 s.',
  'hist.err.tag': 'Nhập tên Tag.',
  'hist.err.tagMissing': 'Project không có Tag này.',
  'hist.err.notApplicable': 'Không áp dụng cho kiểu của Tag này.',
} as const;
