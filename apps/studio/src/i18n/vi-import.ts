// Chuỗi của hộp thoại Nhập SVG và bảng báo cáo nhập (feature 008, T057/T058; mockup studio-svg.html cảnh 1). Câu cho từng
// mã trong báo cáo (R_*, C_*, W_*) nằm ở @mat/svg-import (`viMessage`) và đã đi theo báo cáo; ở đây chỉ có chữ của giao diện.
export const viImport = {
  'cmd.import.svg': 'Thêm đồ họa SVG…',

  'imp.title': 'Nhập SVG',
  'imp.title.processing': 'Nhập SVG: đang xử lý {name}',
  'imp.title.rejected': 'Nhập SVG: không nhập được',
  'imp.close': 'Đóng',
  'imp.waiting': 'Đang chờ bạn chọn file SVG…',

  // ---- Đang xử lý ----
  'imp.step.read': 'Đọc file ({size})',
  'imp.step.scan': 'Kiểm tra mã hóa và khai báo DTD',
  'imp.step.clean': 'Làm sạch bằng danh sách cho phép, gán UID và tên phần tử',
  'imp.step.preview': 'Dựng xem trước trước và sau',
  'imp.progress': 'Tiến độ nhập',
  'imp.progress.help':
    'Chạy ngoài luồng giao diện khi có thể; bạn vẫn có thể Hủy. File lớn hơn 5 MiB bị từ chối ngay.',

  // ---- Xem trước ----
  'imp.file': 'File',
  'imp.generator': 'Phần mềm',
  'imp.target': 'Lưu thành',
  'imp.preview.before': 'Trước',
  'imp.preview.beforeNote': '(đã lọc theo danh sách cho phép)',
  'imp.preview.after': 'Sau (đã làm sạch)',
  'imp.preview.beforeLabel': 'Xem trước bản gốc đã lọc theo danh sách cho phép',
  'imp.preview.afterLabel': 'Xem trước bản đã làm sạch',
  'imp.preview.big': 'Bỏ qua xem trước bản gốc: file có hơn {n} phần tử.',
  'imp.preview.fail': 'Không dựng được xem trước.',
  'imp.stat.elements': 'Phần tử',
  'imp.stat.elementsValue': '{before} → {after}',
  'imp.stat.uid': 'UID gán',
  'imp.stat.named': 'Có tên',
  'imp.stat.depth': 'Độ sâu',
  'imp.stat.size': 'Cỡ sau',
  'imp.stat.viewBox': 'viewBox',
  'imp.stat.none': 'không có',

  // ---- Báo cáo ----
  'imp.report': 'Báo cáo nhập',
  'imp.rep.title': 'Báo cáo',
  'imp.rep.removed': 'Đã loại',
  'imp.rep.converted': 'Đã chuyển',
  'imp.rep.warnings': 'Cảnh báo',
  'imp.rep.sortHint': 'Nhấp tiêu đề cột để sắp xếp',
  'imp.rep.empty': 'Không có mục nào.',
  'imp.rep.scroll': 'Danh sách mục báo cáo',
  'imp.col.kind': 'Loại',
  'imp.col.name': 'Tên',
  'imp.col.count': 'SL',
  'imp.col.code': 'Mã',
  'imp.col.reason': 'Lý do',
  'imp.col.where': 'Vị trí ví dụ',
  'imp.col.what': 'Nội dung',
  'imp.col.note': 'Mô tả',
  'imp.kind.element': 'phần tử',
  'imp.kind.attribute': 'thuộc tính',
  'imp.kind.css-property': 'thuộc tính CSS',
  'imp.kind.css-rule': 'luật CSS',
  'imp.kind.css-at': 'luật @ của CSS',
  'imp.kind.namespace': 'namespace',
  'imp.kind.pi': 'chỉ thị xử lý',
  'imp.kind.dtd': 'DOCTYPE',
  'imp.kind.image': 'ảnh',
  'imp.kind.font': 'font',
  'imp.kind.definition': 'định nghĩa',
  'imp.kind.reference': 'tham chiếu',

  // ---- Tối ưu ----
  'imp.optimize': 'Tối ưu (gộp hình nhỏ cùng kiểu)',
  'imp.optimize.help':
    'Chưa cần: {n} phần tử. Studio chỉ gợi ý khi vượt 20.000 phần tử; Tối ưu không đổi hình vẽ.',
  'imp.optimize.suggest': 'File có {n} phần tử (trên 20.000): nên bật Tối ưu.',
  'imp.optimize.result': 'Đã gộp {merged} nhóm, bớt {saved} phần tử.',

  // ---- Chân hộp thoại ----
  'imp.saveReport': 'Lưu báo cáo…',
  'imp.format.label': 'Định dạng báo cáo',
  'imp.format.json': 'JSON',
  'imp.format.md': 'Markdown',
  'imp.saved': 'Đã lưu báo cáo: {name}',
  'imp.saveFail': 'Không lưu được báo cáo: {detail}',
  'imp.cancel': 'Hủy',
  'imp.do': 'Nhập',
  'imp.another': 'Chọn file khác…',
  'imp.done': 'Đã nhập {name} vào màn hình, lưu thành {file}',

  // ---- Từ chối ----
  'imp.kv.file': 'File',
  'imp.kv.changed': 'Đã thay đổi project',
  'imp.kv.no': 'Không',
  'imp.err.E_IMPORT_LIMIT.title': 'File vượt giới hạn',
  'imp.err.E_IMPORT_LIMIT.hint':
    'Studio nhập file SVG tối đa 5 MiB, 20.000 phần tử và 32 cấp lồng nhau. Hãy đơn giản hóa hình trong phần mềm vẽ rồi thử lại.',
  'imp.err.E_IMPORT_PARSE.title': 'File không phải XML hợp lệ',
  'imp.err.E_IMPORT_PARSE.hint': 'Hãy mở file bằng phần mềm vẽ và lưu lại dạng SVG, rồi chọn lại.',
  'imp.err.E_IMPORT_ENCODING.title': 'Mã hóa của file không hợp lệ',
  'imp.err.E_IMPORT_ENCODING.hint':
    'File phải dùng UTF-8. Hãy lưu lại từ phần mềm vẽ với mã hóa UTF-8.',
  'imp.err.E_IMPORT_ROOT.title': 'File không phải SVG',
  'imp.err.E_IMPORT_ROOT.hint': 'Phần tử gốc của file phải là svg thuộc namespace SVG.',
  'imp.err.E_IMPORT_DTD.title': 'File có khai báo DTD hoặc ENTITY',
  'imp.err.E_IMPORT_DTD.hint':
    'Studio không nhập SVG kiểu này vì có nguy cơ mở rộng thực thể làm treo máy. Hãy xuất lại từ Inkscape bằng Plain SVG (Lưu thành, chọn SVG thường), hoặc xóa khối DOCTYPE rồi thử lại.',
  'imp.err.E_IMPORT_USE_BOMB.title': 'Phần tử use mở rộng quá lớn',
  'imp.err.E_IMPORT_USE_BOMB.hint':
    'File có use lồng nhau quá sâu hoặc vòng tham chiếu. Hãy đơn giản hóa hình hoặc xuất lại bằng Plain SVG.',
  'imp.err.E_IMPORT_SIZE.title': 'Không xác định được kích thước',
  'imp.err.E_IMPORT_SIZE.hint':
    'File thiếu cả viewBox lẫn width và height. Hãy đặt kích thước trang trong phần mềm vẽ rồi lưu lại.',
  'imp.err.E_IMPORT_EXT.title': 'File không có đuôi .svg',
  'imp.err.E_IMPORT_EXT.hint': 'Hãy chọn một file có đuôi .svg.',
  'imp.err.io.title': 'Không đọc được file',
  'imp.err.io.hint': 'Hệ thống báo: {detail}',
  'imp.err.worker.title': 'Bộ xử lý nhập SVG bị lỗi',
  'imp.err.worker.hint':
    'Hãy thử lại; nếu vẫn lỗi, hãy chọn file khác hoặc báo cho nhóm phát triển. Chi tiết: {detail}',
  'imp.plan.max-svg-items': 'Màn hình đã có đủ {n} đồ họa SVG, không thêm được nữa.',
  'imp.plan.max-items': 'Màn hình đã đủ số đối tượng tối đa, không thêm được nữa.',
  'imp.plan.bad-result': 'Kết quả nhập không dùng được.',
} as const;

/** Lớp màu chip của độ chắc chắn nhận diện phần mềm vẽ (giá trị do @mat/svg-import trả). */
export const IMPORT_CERTAINTY_CLASS: Readonly<Record<string, 'ok' | 'info' | 'warn'>> = {
  'chắc chắn': 'ok',
  'có dấu hiệu': 'info',
  'không rõ': 'warn',
};
