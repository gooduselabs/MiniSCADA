// Chuỗi giao diện của lưới dùng chung (feature 006, ADR-016, FR-045, FR-046): thông báo của mô hình lưới, lưới mat-grid,
// thêm hàng loạt, nhập và xuất CSV. Gộp vào viMessages ở vi.ts; quy ước như vi.ts.
export const viGrid = {
  // ---- Thông báo của mô hình lưới ----
  'gx.notice.readonly': 'Ô này chỉ đọc, không sửa được',
  'gx.notice.required': 'Ô này bắt buộc, không xóa được',
  'gx.notice.rejected': '{count} ô không hợp lệ, đã đánh dấu đỏ',
  'gx.notice.pasted': 'Đã dán {rows} dòng',
  'gx.notice.rowLimit': 'Vượt giới hạn {max} dòng: bỏ {count} dòng',
  'gx.notice.colsDropped': 'Bỏ {count} cột thừa của văn bản dán',
  'gx.notice.headerSkipped': 'Đã bỏ qua dòng tiêu đề',
  'gx.cell.ambiguousNumber':
    'số mơ hồ: dấu phân cách và 3 chữ số có thể là hàng nghìn, hãy viết rõ',
  'gx.cell.invalidNumber': 'không phải số',

  // ---- Lưới mat-grid ----
  'gx.sortBy': 'Sắp xếp theo {col}',
  'gx.filterCol': 'Lọc cột {col}',
  'gx.cellLabel': '{col}, dòng {row}: {value}',
  'gx.options': 'Danh sách {col}',
  'gx.noOption': 'Không có mục nào khớp',
  'gx.fillHandle': 'Kéo để điền xuống',

  // ---- Kiểm project ngoài luồng ----
  'validate.workerFailed':
    'Bộ kiểm tra nền gặp lỗi ({reason}): Studio kiểm ngay trong cửa sổ chính',

  // ---- Thanh trạng thái: lọc nguồn của trang xem (ADR-018) ----
  'sb.viewerPublic': 'Trang xem đang mở cho mọi nguồn',
  'sb.viewerPublicTip':
    'viewerAccess = any: ai tới được thiết bị cũng xem được dữ liệu sống. Đặt lại private nếu không cần.',
} as const;
