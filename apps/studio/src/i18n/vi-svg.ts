// Chuỗi của chọn phần tử SVG, gắn Tag và sự kiện (feature 008, T068): nhãn 13 mục động hóa (`svg.row.`), nhãn đích
// binding mới (`target.`), lý do Gợi ý (`svg.suggest.`), lý do từ chối (`svg.reject.`, `svg.eventReject.`), "Dùng ở đâu".
export const viSvg = {
  'svg.on': 'Bật',
  'svg.off': 'Tắt',

  // ---- 13 mục động hóa (contract studio-svg-editor §5) ----
  'svg.row.text': 'Chữ hiển thị giá trị',
  'svg.row.fill': 'Màu nền',
  'svg.row.stroke': 'Màu viền',
  'svg.row.level': 'Mức chất lỏng',
  'svg.row.rotate': 'Quay',
  'svg.row.spin': 'Quay liên tục',
  'svg.row.translateX': 'Di chuyển X',
  'svg.row.translateY': 'Di chuyển Y',
  'svg.row.scale': 'Co giãn',
  'svg.row.blink': 'Nhấp nháy',
  'svg.row.flow': 'Dòng chảy',
  'svg.row.visibility': 'Ẩn/hiện',
  'svg.row.opacity': 'Độ mờ',

  // ---- Nhãn đích binding mới (xref, lỗi) ----
  'target.geometry.clipLevel': 'Mức chất lỏng',
  'target.effect.blink': 'Nhấp nháy',
  'target.effect.flow': 'Dòng chảy',

  // ---- Lý do chặn dòng và từ chối thao tác ----
  'svg.block.element-kind': 'Không hợp loại phần tử này',
  'svg.block.tag-type': 'Không hợp kiểu Tag này',
  'svg.reject.unknown-row': 'Không có mục động hóa này',
  'svg.reject.unknown-element': 'Không có phần tử này',
  'svg.reject.unknown-binding': 'Không có binding này',
  'svg.reject.unknown-tag': 'Không có Tag này',
  'svg.reject.element-kind': 'Mục này không dùng được cho loại phần tử đang chọn',
  'svg.reject.tag-type': 'Kiểu của Tag không hợp mục này',
  'svg.reject.transform': 'Phép biến đổi này không dùng được cho Tag và mục này',
  'svg.reject.duplicate-group': 'Phần tử đã có binding cùng nhóm đích',
  'svg.reject.too-many': 'Một phần tử có tối đa 16 binding',
  'svg.reject.bad-event': 'Sự kiện không hợp lệ',
  'svg.eventReject.bad-action': 'Hành động không hợp lệ',
  'svg.eventReject.bad-tag': 'Chưa chọn Tag cho hành động',
  'svg.eventReject.not-writable': 'Tag phải ghi được (RW, không phải Tag tính toán)',
  'svg.eventReject.not-bool': 'Đảo và xung cần Tag BOOL',
  'svg.eventReject.bad-value': 'Giá trị không hợp kiểu hoặc ngoài giới hạn của Tag',
  'svg.eventReject.bad-duration': 'Thời gian xung từ 100 đến 10000 ms',
  'svg.eventReject.bad-confirm': 'Chỉ Tag BOOL được chọn không cần xác nhận',
  'svg.eventReject.bad-role': 'Quyền tối thiểu không hợp lệ',
  'svg.eventReject.bad-label': 'Nhãn tối đa 80 ký tự',
  'svg.eventReject.bad-screen': 'Màn hình đích không tồn tại',
  'svg.eventReject.wrong-screen-kind':
    'Màn hình đích sai loại (chuyển màn hình cần màn hình, popup cần popup)',

  // ---- Gợi ý (contract §6) ----
  'svg.suggest.text-number': 'Chữ hiển thị giá trị số, 1 số lẻ, kèm đơn vị của Tag',
  'svg.suggest.text-table': 'Chữ lấy từ bảng giá trị của Tag',
  'svg.suggest.level': 'Tên phần tử là mức chất lỏng: tuyến tính theo khoảng của Tag',
  'svg.suggest.fill-bool': 'Màu nền theo bật tắt',
  'svg.suggest.fill-table': 'Màu nền theo bảng giá trị',
  'svg.suggest.spin': 'Tên phần tử là bộ phận quay: quay liên tục',
  'svg.suggest.flow': 'Đường theo trạng thái chạy: dòng chảy',
  'svg.suggest.alarm': 'Tên phần tử là cảnh báo: nhấp nháy kèm màu nền (không chỉ nhấp nháy)',

  // ---- Canvas vào item (T070) ----
  'svo.entered': 'Đang vào: {name}  ·  Esc để thoát',
  'svo.crumbLabel': 'Đường dẫn: màn hình, item, phần tử',
  'svg.readOnly': 'Project chỉ đọc: không sửa được binding',
  'svg.bind.partial': 'Đã gắn cho {n} phần tử, bỏ qua {m} phần tử không hợp',
  'svg.copy.done': 'Đã sao chép {n} binding của phần tử',
  'svg.copy.none': 'Phần tử chưa có binding để sao chép',
  'svg.paste.none': 'Chưa sao chép bộ binding nào',
  'svg.paste.nothing':
    'Không dán được cho phần tử nào ({m} binding không hợp loại phần tử hoặc kiểu Tag)',
  'svg.paste.done': 'Đã dán {n} binding, bỏ qua {m}',
  'svg.drop.done': 'Đã gắn {tag} vào {name}',

  // ---- Cây phần tử (T071) ----
  'et.tab': 'Phần tử',
  'et.tabTip': 'Cây phần tử của đồ họa đang vào: chọn, lọc, xem phần tử nào đã gắn Tag',
  'et.label': 'Cây phần tử SVG',
  'et.rowLabel': '{name}, thẻ {tag}, {bind} binding {event}',
  'et.hasBind': 'Có {n} binding',
  'et.hasEvent': 'Có sự kiện nhấp',
  'et.hasError': 'Có lỗi ở binding hoặc sự kiện',
  'et.hasWarning': 'Có cảnh báo ở binding hoặc sự kiện',
  'et.renameLabel': 'Tên phần tử mới',
  'et.notEntered': 'Nhấp đúp (hoặc Enter) vào một đồ họa SVG trên canvas để xem cây phần tử.',
  'et.filter': 'Lọc phần tử theo tên, thẻ hoặc UID',
  'et.filterHint': 'Lọc theo tên, thẻ, UID',
  'et.loading': 'Đang dựng đồ họa…',
  'et.noMatch': 'Không có phần tử nào khớp.',
  'et.empty': 'Đồ họa chưa có phần tử gắn được (không có UID).',
  'et.foot': '{n} phần tử cấp trên cùng · {bound} đã có binding hoặc sự kiện',
  'et.footFilter': 'Hiện {n} trong {total} phần tử khớp',

  // ---- Dùng ở đâu, đổi tên Tag, xóa màn hình ----
  'xref.svgElement': '{screen} › {item} › {element} ({target})',
  'xref.svgEvent': '{screen} › {item} › {element} (sự kiện {action})',
  'xref.svgTable': '{screen} › {item} › {element} (bảng giá trị)',
  'screenref.svgEvent': 'Sự kiện {action} của {item} › {element} ở màn hình {screen}',
} as const;
