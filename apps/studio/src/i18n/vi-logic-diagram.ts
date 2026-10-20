// Chuỗi giao diện của sơ đồ khối Logic (feature 015; specs/015-logic-ui). Mã (TON, AND, OK, E_LOGIC_*) và tên trường JSON
// giữ nguyên như API; chú thích tiếng Việt. Gộp vào viMessages ở vi.ts.
export const viLogicDiagram = {
  // ---- Khung nhìn ----
  'lgd.view': 'Khung nhìn',
  'lgd.view.diagram': 'Sơ đồ',
  'lgd.view.table': 'Bảng',
  'lgd.view.diagramTip': 'Sơ đồ khối: Tag, cổng logic, khối và dây nối',
  'lgd.view.tableTip': 'Bảng khối theo nhóm (như trước)',

  // ---- Thanh công cụ của sơ đồ ----
  'lgd.toolbar': 'Công cụ sơ đồ',
  'lgd.zoomIn': 'Phóng to (+)',
  'lgd.zoomOut': 'Thu nhỏ (−)',
  'lgd.zoom': 'Mức phóng {z} %',
  'lgd.fit': 'Vừa khung (0)',
  'lgd.actual': 'Về 100 %',
  'lgd.arrange': 'Tự sắp xếp',
  'lgd.arrangeTip': 'Xếp lại mọi khối từ trái sang phải theo phụ thuộc (một bước hoàn tác)',
  'lgd.snap': 'Căn lưới 16 px',
  'lgd.minimap': 'Bản đồ nhỏ',
  'lgd.keys':
    'Kéo cổng ra tới cổng vào để nối · kéo nền: khung chọn · Space hoặc nút giữa + kéo: dời · Shift+bấm: chọn thêm',
  'lgd.dock.close': 'Thu gọn khung dưới (Ctrl+J)',
  'lgd.dock.open': 'Mở khung dưới (Ctrl+J)',

  // ---- Vùng vẽ và nút ----
  'lgd.label': 'Sơ đồ khối logic',
  'lgd.desc':
    'Tab chuyển khối; Shift+bấm hoặc kéo khung trên nền để chọn nhiều khối, Ctrl+A chọn hết, Esc bỏ chọn nhóm; mũi tên dịch khối đang chọn 16 px (Shift: 64 px); Delete xóa khối hoặc dây đang chọn; Ctrl+D nhân bản; Enter sửa thuộc tính; + − 0 đổi mức phóng; Space + kéo để dời khung nhìn; Ctrl+J gập hoặc mở khung dưới. Kéo cổng ra tới cổng vào để nối dây.',
  'lgd.empty':
    'Chưa có khối. Kéo một khối từ task card "Khối / Tag" vào đây, hoặc bấm Thêm khối (Insert).',
  'lgd.node.block': '{kind} {id}',
  'lgd.node.tag': 'Tag đầu vào {id}',
  'lgd.node.out': 'Tag đích {id}',
  'lgd.node.missing': 'Tag không có trong project',
  'lgd.node.err': 'có lỗi',
  'lgd.node.warn': 'có cảnh báo',
  'lgd.node.sel': 'đang chọn',
  'lgd.node.ins': 'vào: {list}',
  'lgd.node.outs': 'ra: {list}',
  'lgd.unset': 'chưa nối',

  // ---- Chi tiết dưới khối ----
  'lgd.d.hold': 'giữ {s}',
  'lgd.d.repeat': 'lặp {s}',
  'lgd.d.pt': 'PT {s}',
  'lgd.d.preset': 'đặt trước {n}',
  'lgd.d.noPreset': 'không đặt trước',
  'lgd.d.rate': 'theo /{u} × {f}',
  'lgd.d.service': 'bảo trì mỗi {h} h',
  'lgd.d.noService': 'không hạn bảo trì',
  'lgd.d.windows': '{n} khung / tuần',
  'lgd.d.write': '→ {tag}',
  'lgd.d.off': 'tắt',
  'lgd.d.actions': '{n} hành động',

  // ---- Giá trị sống ----
  'lgd.live.test': 'Thử logic · t = {t} s',
  'lgd.live.online': 'Online · giá trị trên thiết bị',
  'lgd.live.tip': 'Dây BOOL xanh lá khi TRUE; số ghi cạnh cổng ra; khối vừa bắn sáng lên',
  'lgd.remain': 'còn {s}',
  'lgd.fired': '{n} lần',

  // ---- Thông báo ----
  'lgd.t.gateHint': 'Thả cổng {gate} vào một cổng vào của khối hoặc chân của cổng khác.',
  'lgd.t.tagHint': 'Thả Tag vào một cổng vào để nối.',
  'lgd.t.noTarget':
    'Không nối được: thả dây vào cổng vào của khối, chân của cổng, mục Ghi PLC hoặc Tag đích.',
  'lgd.t.actionOnly': 'Cổng ↑/↓ của luật chỉ nối tới mục Ghi PLC hoặc Tag đích.',
  'lgd.t.derived': 'Nút Tag hiện theo biểu thức: xóa dây nối của nó để bỏ.',
  'lgd.t.connected': 'Đã nối {from} → {to} (Ctrl+Z để hoàn tác)',
  'lgd.t.arranged': 'Đã sắp xếp lại sơ đồ (Ctrl+Z để hoàn tác)',

  // ---- Palette cổng (task card) ----
  'tc.logic.gates': 'Cổng logic',
  'tc.logic.gatesSub': 'thả vào cổng vào',
  'tc.logic.gateTip': 'Kéo vào một cổng vào trên sơ đồ để bọc biểu thức bằng {gate}',
  'lgd.gate.and': 'AND',
  'lgd.gate.or': 'OR',
  'lgd.gate.not': 'NOT',
  'lgd.gate.cmp': 'So sánh',
} as const;
