// Chuỗi giao diện của template và faceplate (feature 011, T173; FR-126; mockup studio-svg-draw cảnh 3). Gộp vào viMessages
// ở vi.ts.
export const viTemplate = {
  // ---- Lệnh ----
  'cmd.screen.createTemplate': 'Tạo template…',
  'cmd.screen.explodeInstance': 'Bung thành item thường',
  'cmd.screen.updateInstances': 'Cập nhật mọi bản sao…',
  'cmd.screen.faceplate': 'Tạo faceplate (tham số cho popup)',
  'reason.needFormat10': 'Cần project định dạng 1.0.0 (nâng cấp project)',
  'reason.noInstanceSel': 'Chọn một item của bản sao template',
  'reason.notPopup': 'Chỉ dùng cho màn hình popup',

  // ---- Cây ----
  'tree.templates': 'Template',
  'tree.templateInstances': '{n} bản sao',

  // ---- Chung ----
  'tpl.menu': 'Template của vùng chọn',
  'tpl.ok': 'đúng',
  'tpl.id': 'Id',
  'tpl.name': 'Tên',
  'tpl.size': 'Kích thước',
  'tpl.sizeValue': '{w} × {h}',
  'tpl.sizeNone': '—',
  'tpl.paramsLabel': 'Tham số',
  'tpl.itemsLabel': 'Item',
  'tpl.fileLabel': 'Tệp',
  'tpl.col.name': 'Tên',
  'tpl.col.kind': 'Kiểu',
  'tpl.col.default': 'Mặc định',
  'tpl.col.remove': 'Bỏ',
  'tpl.col.use': 'Thay',
  'tpl.col.item': 'Item',
  'tpl.col.place': 'Chỗ',
  'tpl.col.current': 'Giá trị hiện tại',
  'tpl.col.inTemplate': 'Trong template',
  'tpl.col.value': 'Giá trị',
  'tpl.col.check': 'Kiểm',
  'tpl.col.screen': 'Màn hình',
  'tpl.col.inst': 'Bản sao',
  'tpl.col.values': 'Tham số',
  'tpl.col.items': 'Item',
  'tpl.col.status': 'Trạng thái',
  'tpl.col.actions': 'Thao tác',

  // ---- Tạo template ----
  'tpl.createTitle': 'Tạo template từ vùng chọn ({n} item)',
  'tpl.params': 'Tham số ({n} / 16)',
  'tpl.addParam': 'Thêm tham số',
  'tpl.removeParam': 'Bỏ tham số {name}',
  'tpl.replacements': 'Thay bằng tham số',
  'tpl.useRep': 'Thay {place} của {item}',
  'tpl.noReplacements': 'Không có chỗ nào khớp giá trị mặc định của tham số.',
  'tpl.substHelp':
    'Thay thế là phép thay chuỗi thuần: không biểu thức, không lồng. ‹tham số› lạ hoặc chưa khai là lỗi E_TEMPLATE_PARAM.',
  'tpl.replaceSel': 'Thay vùng chọn bằng một bản sao của template (tham số = giá trị hiện tại)',
  'tpl.saveHelp':
    'Lưu thành {file} và thêm vào project.json › templates. Tối đa 120 item mỗi template; item SVG không dùng được.',
  'tpl.create': 'Tạo template',
  'tpl.created': 'Đã tạo template {id}',

  // ---- Lỗi ----
  'tpl.err.empty': 'Chưa chọn item nào',
  'tpl.err.tooMany': 'Template tối đa 120 item',
  'tpl.err.svg':
    'Template chỉ gồm widget: item SVG có tệp binding riêng, không dùng chung cho nhiều bản sao',
  'tpl.err.id': 'Id template: chữ thường, số, gạch nối, bắt đầu bằng chữ, tối đa 48 ký tự',
  'tpl.err.taken': 'Đã có template cùng id',
  'tpl.err.name': 'Tên template từ 1 đến 80 ký tự',
  'tpl.err.params':
    'Tham số sai: tên bắt đầu bằng chữ thường (chữ, số), không trùng, mặc định đúng kiểu, ‹tham số› đúng chỗ',
  'tpl.err.inst': 'Id bản sao: chữ thường, số, gạch nối, bắt đầu bằng chữ, tối đa 32 ký tự',
  'tpl.err.instTaken': 'Màn hình đã có bản sao cùng id',
  'tpl.err.args': 'Giá trị tham số còn thiếu hoặc sai kiểu',
  'tpl.err.at': 'Vị trí X, Y phải là số nguyên',
  'tpl.err.maxItems': 'Màn hình đã đủ số item tối đa',
  'tpl.err.noTemplate': 'Không có template {id}',

  // ---- Bản sao ----
  'tpl.inst.addTitle': 'Thêm bản sao của {id}',
  'tpl.inst.editTitle': 'Tham số của bản sao {inst} ({id})',
  'tpl.inst.screen': 'Màn hình',
  'tpl.inst.id': 'Id bản sao',
  'tpl.inst.values': 'Giá trị tham số',
  'tpl.inst.valueOf': 'Giá trị của {name}',
  'tpl.inst.required': 'bắt buộc (không có mặc định)',
  'tpl.inst.noParams': 'Template không có tham số.',
  'tpl.inst.help':
    'Khi lưu, bản sao được bung thành item thường (id <bản sao>.<item>, Tag đã thay) kèm chú thích tpl; runtime không biết template. Ô trống lấy mặc định của {id}.',
  'tpl.inst.add': 'Thêm bản sao',
  'tpl.inst.addShort': 'Thêm bản sao…',
  'tpl.inst.apply': 'Áp dụng',
  'tpl.inst.added': 'Đã thêm bản sao {inst} vào {screen}',
  'tpl.exploded': 'Đã bung thành item thường: {list}',

  // ---- Inspector ----
  'tpl.insp.instance': 'Bản sao',
  'tpl.insp.hint':
    'Item của bản sao template: sửa ở template rồi "Cập nhật mọi bản sao"; sửa tay ở đây sẽ bị ghi đè (W_TEMPLATE_DRIFT).',

  // ---- Thư viện, trang template ----
  'tpl.lib.count': '{n} template',
  'tpl.lib.empty': 'Project chưa có template',
  'tpl.lib.howto':
    'Chọn các widget trên một màn hình, nhấp phải rồi chọn "Tạo template…" (hoặc nút trên thanh công cụ của editor Màn hình).',
  'tpl.lib.help':
    'Template bung khi lưu: màn hình chỉ chứa item thường kèm chú thích tpl, runtime không đổi. Xóa template còn bản sao thì bản sao được giữ dạng item thường.',
  'tpl.lib.noParams': 'không tham số',
  'tpl.lib.broken': 'không đọc được {file}',
  'tpl.ed.toolbar': 'Thao tác template',
  'tpl.ed.instances': 'Danh sách bản sao',
  'tpl.ed.noInstances': 'Chưa có bản sao nào. "Thêm bản sao…" hoặc tạo template từ vùng chọn.',
  'tpl.ed.goto': 'Mở',
  'tpl.ed.params': 'Tham số…',
  'tpl.st.ok': 'khớp template',
  'tpl.st.drift': 'lệch template',

  // ---- Cập nhật mọi bản sao ----
  'tpl.upd.title': 'Cập nhật mọi bản sao của "{id}"',
  'tpl.upd.button': 'Cập nhật mọi bản sao ({n})',
  'tpl.upd.applyTo': 'Áp cho',
  'tpl.upd.count': '{n} bản sao trên {screens} màn hình ({list})',
  'tpl.upd.keep': 'Giữ riêng',
  'tpl.upd.keepText': 'vị trí, cỡ của từng item, giá trị tham số, id bản sao',
  'tpl.upd.undo': 'Hoàn tác',
  'tpl.upd.undoText': 'một bước (Ctrl+Z)',
  'tpl.upd.removed':
    'Item thêm tay vào bản sao sẽ bị xóa: {list}. Muốn giữ: "Bung thành item thường" cho bản sao đó trước.',
  'tpl.upd.failed':
    'Không bung lại được (tham số thiếu hoặc sai với template hiện tại), giữ nguyên: {list}',
  'tpl.upd.do': 'Cập nhật {n} bản sao',
  'tpl.updated': 'Đã cập nhật {n} bản sao trên {screens} màn hình; xóa {removed} item thêm tay',

  // ---- Xóa template ----
  'tpl.del.title': 'Xóa template "{id}"?',
  'tpl.del.button': 'Xóa template…',
  'tpl.del.has': 'Template còn {n} bản sao trên {screens} màn hình: {first} … {last}.',
  'tpl.del.only': 'Các bản sao được giữ dạng item thường (xóa chú thích tpl) rồi template bị xóa.',
  'tpl.del.help':
    'Không có lựa chọn xóa luôn bản sao: muốn xóa thì xóa trên màn hình trước. Một bước hoàn tác.',
  'tpl.del.none': 'Template không có bản sao. Tệp template bị xóa khi lưu; một bước hoàn tác.',
  'tpl.del.do': 'Bung {n} bản sao và xóa template',
  'tpl.del.doNone': 'Xóa template',
  'tpl.deleted': 'Đã xóa template {id} ({n} bản sao thành item thường)',

  // ---- Faceplate ----
  'tpl.fp.params': 'Tham số của popup (faceplate)',
  'tpl.fp.none':
    'Popup chưa có tham số: "Tạo faceplate" đổi tiền tố Tag chung thành tham số prefix.',
  'tpl.fp.notPopup': 'Chỉ màn hình popup mới thành faceplate được',
  'tpl.fp.noPrefix': 'Các Tag của popup không có tiền tố chung để làm tham số',
  'tpl.fp.done': 'Popup đã có tham số: {list}. Đặt args ở hành động Mở popup của từng nút.',

  // ---- args của Mở popup ----
  'args.title': 'args của Mở popup · {item}',
  'args.label': 'args',
  'args.none': '(mặc định)',
  'args.edit': 'args…',
  'args.popup': 'Màn hình popup',
  'args.table': 'Giá trị tham số của popup',
  'args.valueOf': 'Giá trị của {name}',
  'args.missing': 'thiếu (không có mặc định)',
  'args.noParams': 'Popup này không có tham số: không cần args.',
  'args.extra': 'args thừa (không phải tham số của popup): {list}',
  'args.dropExtra': 'Bỏ args thừa',
  'args.locked':
    'Nút thuộc bản sao template: args lấy từ ‹tham số› của template khi bung; sửa ở template rồi Cập nhật mọi bản sao.',
  'args.tags': 'Tag sẽ dùng khi mở (bung tĩnh)',
  'args.noTag': 'không có',
  'args.help':
    'Runtime thay ‹tham số› bằng args khi mở popup (thay chuỗi thuần) và chỉ đăng ký Tag có trong project; bộ kiểm bung mọi tổ hợp args (E_POPUP_ARGS, E_TEMPLATE_TAG_REF).',
  'args.apply': 'Áp dụng',
} as const;
