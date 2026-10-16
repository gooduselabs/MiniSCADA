// Chuỗi Toolbox Ký hiệu SVG và Gắn nhanh (feature 008, T091, T092; FR-057, FR-058).
export const viSymbols = {
  // ---- Toolbox ----
  'tc.sym.search': 'Tìm ký hiệu',
  'tc.sym.placeholder': 'Tìm bơm, van, bồn...',
  'tc.sym.origin': 'Ký hiệu CC0, do dự án vẽ. Kéo gần điểm gắn để dính (Alt tắt dính).',
  'tc.sym.none': 'Không có ký hiệu nào khớp.',
  'tc.sym.tip': '{name}: kéo vào màn hình hoặc nhấp đúp để thêm. Giữ Alt khi thả để tắt dính.',
  'tc.sym.openScreen': 'Mở một màn hình để thêm ký hiệu.',
  'tc.sym.count': '{n} ký hiệu',
  'sym.added': 'Đã thêm ký hiệu {name}.',
  'sym.reject.unknown-symbol': 'Không tìm thấy ký hiệu này trong thư viện.',
  'sym.reject.max-svg-items': 'Màn hình đã đủ {n} đồ họa SVG; xóa bớt hoặc dùng màn hình khác.',
  'sym.reject.max-items': 'Màn hình đã đủ số item tối đa.',

  // ---- Gắn nhanh ----
  'qb.title': 'Gắn nhanh',
  'qb.hint': 'Bấm một bộ phận: vào item, chọn phần tử và mở Gắn Tag tới dòng gợi ý.',
  'qb.parts': 'Bộ phận của ký hiệu',
  'qb.suggest': 'gợi ý: {rows}',
  'qb.bound': '{n} binding',
  'qb.event': 'Sự kiện nhấp',
  'qb.open': 'Gắn…',
  'qb.openFor': 'Gắn nhanh {label}',
  'qb.ports': 'Điểm gắn',
  'qb.portDir.n': 'trên',
  'qb.portDir.e': 'phải',
  'qb.portDir.s': 'dưới',
  'qb.portDir.w': 'trái',
  'qb.portLinked': 'đã nối với {item}',
  'qb.portFree': 'chưa nối',
  'qb.portHint': 'Kéo ký hiệu gần điểm gắn để dính; giữ Alt để tắt dính.',
} as const;
