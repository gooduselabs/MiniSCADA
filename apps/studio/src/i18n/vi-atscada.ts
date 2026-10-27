// Chuỗi của feature 029 (giao diện ATSCADA, widget/thuộc tính bổ sung): nhãn thuộc tính và khe Tag mới, widget hẹn giờ
// Từ–Đến. Gộp vào viMessages ở vi.ts; quy ước như vi.ts.
export const viAtscada = {
  // ---- switch: Tag số ----
  'widget.switch.prop.onValue': 'Giá trị khi bật (Tag số)',
  'widget.switch.prop.offValue': 'Giá trị khi tắt (Tag số)',
  // ---- button: phản hồi ----
  'widget.button.slot.feedback': 'Tag phản hồi',
  'widget.button.prop.activeValue': 'Giá trị đang tác động',
  'widget.button.prop.activeColor': 'Màu khi tác động',
  'widget.button.prop.inactiveColor': 'Màu khi không tác động',
  // ---- nhấp nháy theo ngưỡng, trạng thái thứ hai ----
  'widget.card.prop.blinkAbove': 'Nhấp nháy khi lớn hơn',
  'widget.card.prop.blinkBelow': 'Nhấp nháy khi nhỏ hơn',
  'widget.card.slot.status': 'Tag trạng thái',
  'widget.stat-tile.prop.blinkAbove': 'Nhấp nháy khi lớn hơn',
  'widget.stat-tile.prop.blinkBelow': 'Nhấp nháy khi nhỏ hơn',
  'widget.stat-tile.slot.status': 'Tag trạng thái',
  'widget.lamp.prop.blinkOn': 'Nhấp nháy khi bật',
  // ---- màu chuỗi, tìm kiếm, CSV ----
  'widget.line.prop.colors': 'Màu từng chuỗi',
  'widget.history-trend.prop.colors': 'Màu từng chuỗi',
  'widget.history-table.prop.search': 'Ô tìm kiếm',
  'widget.alarm-list.prop.search': 'Ô tìm kiếm',
  'widget.alarm-list.prop.exportCsv': 'Nút xuất CSV',
  // ---- time-range ----
  'widget.time-range': 'Hẹn giờ Từ–Đến',
  'widget.time-range.prop.format': 'Cách lưu giờ',
  'widget.time-range.prop.format.hourMinute': '4 Tag: giờ, phút',
  'widget.time-range.prop.format.minutes': '2 Tag: phút trong ngày',
  'widget.time-range.prop.fromText': 'Chữ "Từ"',
  'widget.time-range.prop.toText': 'Chữ "Đến"',
  'widget.time-range.slot.startHour': 'Giờ bắt đầu',
  'widget.time-range.slot.startMinute': 'Phút bắt đầu',
  'widget.time-range.slot.endHour': 'Giờ kết thúc',
  'widget.time-range.slot.endMinute': 'Phút kết thúc',
  'widget.time-range.slot.start': 'Bắt đầu (phút trong ngày)',
  'widget.time-range.slot.end': 'Kết thúc (phút trong ngày)',
  // ---- trình soạn lưới (C) ----
  'lay.moveSameRow': 'Chỉ đổi chỗ ô trong cùng một hàng; để dời cả hàng, kéo tay nắm ⋮⋮ ở đầu hàng',
  'lay.quickRow': 'Thêm hàng nhanh',
  'lay.quickRowTip': 'Thêm hàng {spans} (một chạm)',
  'lay.quickHeight': 'Chiều cao hàng nhanh',
  'lay.heightAutoShort': 'Tự động',
  'lay.dragCell': 'Kéo để đổi chỗ ô trong hàng',
  'lay.dragRow': 'Kéo để dời hàng',
  'lay.spanLess': 'Bớt một cột (phím −)',
  'lay.spanMore': 'Thêm một cột (phím +)',
  'lay.edge': 'Kéo cạnh để đổi số cột của ô',
} as const;
