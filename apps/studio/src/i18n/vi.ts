// Chuỗi giao diện tiếng Việt của mAT Studio (feature 004, FR-014, research R13). Khóa phẳng, nhóm theo
// vùng giao diện; tham số viết {tên}. Thêm ngôn ngữ khác: tạo file cùng khóa (kiểu Messages của
// i18n/index.ts). Chuỗi viết ngắn, chữ thường như câu nói, không viết hoa cả từ.
// Chuỗi của từng nhóm editor nằm ở file riêng (vi-tags.ts, vi-device.ts, vi-logging.ts) rồi gộp ở cuối.
// Feature 005: làm việc với thiết bị (tìm thiết bị, ghim chứng chỉ, đăng nhập) ở vi-online.ts.
import { viAudit } from './vi-audit.ts';
import { viFins } from './vi-fins.ts';
import { viBacnet } from './vi-bacnet.ts';
import { viTables } from './vi-tables.ts';
import { viCompare } from './vi-compare.ts';
import { viDeploy } from './vi-deploy.ts';
import { viDevice } from './vi-device.ts';
import { viGrid } from './vi-grid.ts';
import { viImport } from './vi-import.ts';
import { viLayout } from './vi-layout.ts';
import { viLogging } from './vi-logging.ts';
import { viOnline } from './vi-online.ts';
import { viProject02 } from './vi-project02.ts';
import { viScreens } from './vi-screens.ts';
import { viScreensInsp } from './vi-screens-insp.ts';
import { viScreensNav } from './vi-screens-nav.ts';
import { viSvg } from './vi-svg.ts';
import { viSymbols } from './vi-symbols.ts';
import { viTags } from './vi-tags.ts';
import { viTags2 } from './vi-tags2.ts';
import { viExpr } from './vi-expr.ts';
import { viAlarm } from './vi-alarm.ts';
import { viHistory } from './vi-history.ts';
import { viReports } from './vi-reports.ts';
import { viTemplate } from './vi-template.ts';
import { viLogic } from './vi-logic.ts';
import { viLogicDiagram } from './vi-logic-diagram.ts';
import { viSvgDraw } from './vi-svgdraw.ts';
import { viUpdate } from './vi-update.ts';
import { viNewProject } from './vi-newproject.ts';
import { viDashboard } from './vi-dashboard.ts';
import { viS7 } from './vi-s7.ts';
import { viMc } from './vi-mc.ts';
import { viOpcUa } from './vi-opcua.ts';

const viCore = {
  // ---- Giai đoạn của lộ trình v2: nhãn cạnh mục chưa làm (cây, task card, trang giai đoạn) ----
  'phase.f005': 'feature 005',
  'phase.p2': 'GĐ 2',
  'phase.p3a': 'GĐ 3a',
  'phase.p3b': 'GĐ 3b',
  'phase.p5': 'GĐ 5',

  // ---- Menu (contracts/commands.md) ----
  'menu.project': 'Project',
  'menu.edit': 'Sửa',
  'menu.view': 'Xem',
  'menu.online': 'Online',
  'menu.tools': 'Công cụ',
  'menu.help': 'Trợ giúp',
  'menu.recent.empty': 'Chưa có project mở gần đây',
  'menu.recent.missing': '{name} (không còn thư mục)',

  // ---- Lệnh: nhãn trong menu, bảng lệnh, tooltip (contracts/commands.md) ----
  'cmd.project.open': 'Mở project…',
  'cmd.project.openRecent': 'Mở gần đây',
  'cmd.project.save': 'Lưu',
  'cmd.project.settings': 'Thiết lập project',
  'cmd.project.close': 'Đóng project',
  'cmd.edit.undo': 'Hoàn tác',
  'cmd.edit.redo': 'Làm lại',
  'cmd.edit.find': 'Tìm',
  'cmd.edit.fillDown': 'Điền xuống',
  'cmd.tags.add': 'Thêm Tag',
  'cmd.tags.delete': 'Xóa dòng',
  'cmd.view.palette': 'Bảng lệnh',
  'cmd.view.themeSystem': 'Giao diện theo hệ thống',
  'cmd.view.themeLight': 'Giao diện sáng',
  'cmd.view.themeDark': 'Giao diện tối',
  'cmd.view.taskCards': 'Ẩn/hiện task card',
  'cmd.view.phases': 'Ẩn/hiện nhãn giai đoạn',
  'cmd.view.resetLayout': 'Đặt lại bố cục',
  'cmd.view.nextRegion': 'Chuyển vùng',
  'cmd.view.prevRegion': 'Chuyển vùng (ngược)',
  'cmd.online.connect': 'Kết nối theo dõi',
  'cmd.online.disconnect': 'Ngắt kết nối',
  'cmd.online.device': 'Thiết bị…',
  'cmd.online.openWeb': 'Mở web thiết bị',
  'cmd.online.devices': 'Thiết bị trong mạng…',
  'cmd.online.download': 'Nạp xuống…',
  'cmd.online.upload': 'Đọc lên…',
  'cmd.online.compare': 'So sánh với thiết bị',
  'cmd.tools.validate': 'Kiểm tra project',
  'cmd.tools.simulate': 'Bật hoặc tắt Mô phỏng',
  'cmd.help.docs': 'Hướng dẫn sử dụng',
  'help.openFailed':
    'Không mở được tài liệu đi kèm ({reason}). Tài liệu nằm trong thư mục docs-html của bản cài.',
  'cmd.help.shortcuts': 'Phím tắt',
  'cmd.help.roadmap': 'Lộ trình',
  'cmd.help.about': 'Giới thiệu mAT Studio',
  // Chỉ có trong bảng lệnh: mở editor theo tên
  'cmd.open.start': 'Mở tab Bắt đầu',
  'cmd.open.tags': 'Mở Bảng Tag mặc định',
  'cmd.open.logging': 'Mở Lưu trữ',
  'cmd.open.connections': 'Mở Kết nối',
  'cmd.open.calc': 'Mở Tag tính toán',
  'cmd.open.driverDiag': 'Mở Chẩn đoán driver',
  'cmd.open.valueTable': 'Mở Bảng giá trị {name}',
  'cmd.open.watch': 'Mở Bảng theo dõi {name}',
  'cmd.open.screen': 'Mở màn hình {name}',

  // ---- Lý do lệnh bị khóa: hiện ở tooltip và bảng lệnh ----
  'reason.f005': 'Có ở feature 005',
  'reason.p2': 'Có ở GĐ 2',
  'reason.noProject': 'Chưa mở project',
  'reason.noChanges': 'Không có thay đổi chưa lưu',
  'reason.noUndo': 'Không còn bước để hoàn tác',
  'reason.noRedo': 'Không còn bước để làm lại',
  'reason.projectErrors': 'Project còn lỗi',
  'reason.monitoring': 'Đang theo dõi thiết bị',
  'reason.notMonitoring': 'Chưa kết nối theo dõi',
  'reason.noAddress': 'Chưa nhập địa chỉ thiết bị (Online › Thiết bị…)',
  'reason.tagsNotActive': 'Mở Bảng Tag trước',
  'reason.gridNotFocused': 'Chọn một ô trong Bảng Tag',
  'reason.firstRow': 'Ô đang ở dòng đầu, không có ô bên trên để chép',
  'reason.noRow': 'Chọn một dòng trong Bảng Tag',
  'reason.locked': '{label}: {reason}',

  // ---- Cây project (studio-ux.md §4) ----
  'tree.project': 'Project',
  'tree.start': 'Bắt đầu',
  'tree.settings': 'Thiết lập project',
  'tree.device': 'BL335',
  'tree.deviceNoAddress': 'chưa nhập địa chỉ',
  'tree.connections': 'Kết nối',
  'tree.tags': 'Tag',
  'tree.tagTable': 'Bảng Tag mặc định',
  'tree.calc': 'Tag tính toán',
  'tree.valueTables': 'Bảng giá trị',
  'tree.alarm': 'Alarm',
  'tree.alarmList': 'Danh sách alarm',
  'tree.alarmClasses': 'Lớp alarm',
  'tree.logging': 'Lưu trữ',
  'tree.screens': 'Màn hình',
  'tree.entryScreen': 'màn hình đầu',
  'tree.reports': 'Báo cáo',
  'tree.users': 'Người dùng và quyền',
  'tree.library': 'Thư viện project',
  'tree.noProject': 'Chưa mở project',
  'tree.noProjectHint':
    'Tạo project mới (Ctrl+N) hoặc mở thư mục project (Ctrl+O) để xem cấu trúc project.',
  'tree.withPhase': '{label} · có ở {phase}',

  // ---- Trạng thái thiết bị: chữ đi kèm chấm màu (màu không là tín hiệu duy nhất, FR-012) ----
  'device.state.offline': 'Không kết nối',
  'device.state.monitoring': 'Đang theo dõi',
  'device.state.lost': 'Mất kết nối, đang thử lại',

  // ---- Trang giai đoạn: mục chưa làm trên cây (nội dung theo mockup bản 1) ----
  'phasePage.heading': '{title} có ở {phase}',
  'phasePage.roadmap': 'Thứ tự giai đoạn: docs/plans/roadmap-v2.md mục 4.',
  'phasePage.connections':
    'Kênh và thiết bị Modbus TCP, Modbus RTU: địa chỉ IP hoặc cổng nối tiếp, Unit ID, timeout, số lần thử lại, thứ tự byte/word; nhóm quét nhanh, thường, chậm; nút Thử kết nối. Trước khi có driver, Tag lấy giá trị từ Mock Tag.',
  'phasePage.calc':
    'Tag tính bằng biểu thức: + − × ÷ %, so sánh, logic, ? :, min, max, abs, round, clamp, text(tag, bảng). Không có script tự do. Studio kiểm biểu thức ngay khi gõ và gợi ý tên Tag; runtime C++ và Studio dùng chung bộ test vector.',
  'phasePage.valueTables':
    'Giá trị hoặc khoảng giá trị → chữ và màu, ví dụ 1 → "Normal" màu xanh, 2 → "Alarm" màu đỏ. Dùng chung cho Tag chuỗi, phần tử SVG, widget, alarm và báo cáo.',
  'phasePage.reports':
    'Mẫu báo cáo ngày, ca, tháng (min, max, avg, tổng, giá trị cuối) từ dữ liệu lưu trữ; xuất CSV, XLSX, PDF. Báo cáo sinh trên trình duyệt để không tốn CPU của BL335.',
  'phasePage.users':
    'Role viewer, operator, engineer, administrator. Tài khoản tạo bằng lệnh trên thiết bị lúc cài; Studio đăng nhập để kết nối, đọc lên, nạp xuống. Quản lý tài khoản ngay trong Studio làm sau.',
  'phasePage.library':
    'Ký hiệu SVG (bơm, van, bồn, motor, ống) và widget mẫu của project. Kéo vào màn hình; sửa mẫu thì mọi chỗ dùng cập nhật theo.',

  // ---- Bảng Tag (FR-020) ----
  'grid.col.id': 'Tên',
  'grid.col.type': 'Kiểu',
  'grid.col.source': 'Nguồn',
  'grid.col.unit': 'Đơn vị',
  'grid.col.min': 'Min',
  'grid.col.max': 'Max',
  'grid.col.description': 'Mô tả',
  'grid.col.value': 'Giá trị sống',
  'grid.col.quality': 'Quality',
  'grid.source.mock': 'Mô phỏng · {signal}',
  'grid.notice.sourceReadonly':
    'Nguồn Tag (kết nối, địa chỉ PLC) sửa được từ GĐ 2, khi có driver Modbus.',
  'grid.notice.liveReadonly':
    'Ghi giá trị Tag xuống thiết bị (có xác nhận, kiểm quyền, audit) có ở GĐ 2.',
  'grid.notice.required': 'Ô này không để trống được: sửa giá trị hoặc xóa cả dòng.',

  // ---- Thuộc tính gắn với Tag (đích binding) và "Dùng ở đâu" (FR-006) ----
  'target.style.fill': 'Màu nền',
  'target.style.stroke': 'Màu viền',
  'target.style.opacity': 'Độ mờ',
  'target.style.visibility': 'Hiện',
  'target.text.content': 'Chữ',
  'target.transform.rotate': 'Góc quay',
  'target.transform.translateX': 'Dịch ngang',
  'target.transform.translateY': 'Dịch dọc',
  'target.transform.scale': 'Co giãn',
  'target.geometry.levelPercent': 'Mức chất lỏng',
  'target.component.state': 'Trạng thái',
  'xref.binding': '{screen} › {element} ({target})',
  'xref.logging': 'Lưu trữ › {group}',
  'xref.expression': 'Biểu thức của {tag}',
  'xref.watch': 'Bảng theo dõi › {table} (dòng {row})',
  'xref.tagTable': 'Tag {tag} (bảng giá trị của Tag)',

  // ---- Khung cửa sổ (FR-001, FR-002, FR-011) ----
  'shell.menu': 'Menu chính',
  'shell.toolbar': 'Thanh công cụ',
  'shell.tree': 'Cây project',
  'shell.details': 'Details',
  'shell.editors': 'Editor đang mở',
  'shell.inspector': 'Inspector',
  'shell.taskCards': 'Task card',
  'shell.statusbar': 'Thanh trạng thái',
  'shell.collapseAll': 'Thu gọn tất cả',
  'shell.treeDrawer': 'Hiện/ẩn cây project',
  'shell.paletteButton': 'Tìm lệnh…',
  'shell.resize.left': 'Đổi độ rộng cây project',
  'shell.resize.details': 'Đổi chiều cao vùng Details',
  'shell.resize.inspector': 'Đổi chiều cao inspector',
  'shell.onlineChip': 'Đang theo dõi {name}',
  'shell.lostChip': 'Mất kết nối {name}',
  'shell.title': 'mAT Studio',
  'shell.titleProject': '{name} · mAT Studio',
  'shell.titleDirty': '● {name} · mAT Studio',
  'shell.dirtyMark': 'Có thay đổi chưa lưu',
  'shell.tooltip': '{label} ({shortcut})',

  // ---- Bảng lệnh (FR-009) ----
  'palette.label': 'Bảng lệnh',
  'palette.input': 'Tìm lệnh',
  'palette.placeholder': 'Gõ tên lệnh, ví dụ: bang tag, kiem tra, ket noi',
  'palette.empty': 'Không có lệnh khớp',

  // ---- Thanh công cụ ----
  'toolbar.online': 'Online',
  'toolbar.offline': 'Offline',
  'toolbar.onlineTip': 'Online tới thiết bị của project (Ctrl+K) / Offline (Ctrl+M)',
  'toolbar.validate': 'Kiểm tra',
  'toolbar.validateTip': 'Kiểm tra project (F7). Studio cũng tự kiểm sau mỗi lần sửa.',
  'toolbar.download': 'Nạp xuống',
  'toolbar.upload': 'Đọc lên',
  'toolbar.compare': 'So sánh',
  'toolbar.device': 'Thiết bị',
  'toolbar.simulate': 'Mô phỏng',

  // ---- Tab editor (FR-005) ----
  'tabs.close': 'Đóng {title}',
  'tabs.closeTip': 'Đóng (Ctrl+W)',
  'tabs.dirty': '{title} (chưa lưu)',
  'tabs.keptUnsaved': '{title}: thay đổi chưa lưu vẫn giữ trong project (Ctrl+S để lưu).',

  // ---- Inspector (FR-006, FR-018, FR-029) ----
  'insp.props': 'Thuộc tính',
  'insp.info': 'Thông tin',
  'insp.diag': 'Chẩn đoán',
  'insp.badgeErrors': '{n} lỗi',
  'insp.badgeWarnings': '{n} cảnh báo',
  'insp.ctx.project': 'Project',
  'insp.ctx.noProject': 'Chưa mở project',
  'insp.ctx.checked': 'Kiểm tra lúc {time} · cùng bộ kiểm tra với runtime',
  'insp.ctx.checking': 'Đang kiểm tra…',
  'insp.ctx.offline': 'Không kết nối',
  'insp.noProject': 'Mở một thư mục project để xem thuộc tính, lỗi và cảnh báo.',
  'insp.noIssues.title': 'Không có lỗi',
  'insp.noIssues.text': 'Runtime sẽ chấp nhận project này.',
  'insp.issue.goto': 'Nhấp đúp hoặc Enter để tới chỗ sai',
  'insp.issue.noJump': 'Lỗi này không có chỗ để nhảy tới; xem file {file}.',
  'insp.issue.error': 'Lỗi',
  'insp.issue.warning': 'Cảnh báo',
  'insp.issues': 'Lỗi và cảnh báo',
  'insp.diag.offTitle': 'Chưa kết nối thiết bị',
  'insp.diag.offText': 'Kết nối theo dõi (Ctrl+K) để xem trạng thái thiết bị và lưu trữ.',
  'prop.project': 'Project',
  'prop.folder': 'Thư mục',
  'prop.projectId': 'Mã project',
  'prop.version': 'Phiên bản',
  'prop.entryScreen': 'Màn hình đầu',
  'prop.files': 'File',
  'prop.hint': 'Chọn một Tag, phần tử màn hình hoặc nhóm lưu trữ để xem thuộc tính.',
  'prop.none': '—',

  // ---- Details (vùng dưới cây) ----
  'details.tags': 'Tag',
  'details.tagsDrag': 'Tag · kéo vào thuộc tính',
  'details.elements': 'Phần tử · {screen}',
  'details.groups': 'Nhóm lưu trữ',
  'details.groupTags': '{n} Tag',
  'details.noProject': 'Chưa mở project.',
  'details.empty': 'Không có mục nào.',
  'details.unnamed': '(trống)',

  // ---- Task card (FR-001) ----
  'tc.toolbox': 'Toolbox',
  'tc.library': 'Thư viện',
  'tc.online': 'Công cụ online',
  'tc.find': 'Tìm',
  'tc.collapse': 'Thu task card',
  'tc.group.display': 'Hiển thị',
  'tc.group.control': 'Điều khiển',
  'tc.group.chart': 'Biểu đồ',
  'tc.group.alarm': 'Alarm',
  'tc.group.symbols': 'Ký hiệu SVG',
  'tc.tool.card': 'Card giá trị',
  'tc.tool.text': 'Nhãn chữ',
  'tc.tool.lamp': 'Đèn báo',
  'tc.tool.gauge': 'Đồng hồ kim',
  'tc.tool.level': 'Thanh mức',
  'tc.tool.button': 'Nút',
  'tc.tool.switch': 'Công tắc',
  'tc.tool.setpoint': 'Ô nhập setpoint',
  'tc.tool.slider': 'Thanh trượt',
  'tc.tool.line': 'Đường',
  'tc.tool.bar': 'Cột',
  'tc.tool.pie': 'Tròn',
  'tc.tool.alarmTable': 'Bảng alarm',
  'tc.tool.alarmBanner': 'Banner alarm',
  'tc.tool.pump': 'Bơm',
  'tc.tool.valve': 'Van',
  'tc.tool.tank': 'Bồn',
  'tc.tool.motor': 'Motor',
  'tc.tool.pipe': 'Ống',
  'tc.toolSoon': '{name} có ở {phase}: kéo thả widget lên màn hình làm ở giai đoạn đó.',
  'tc.lib.project': 'Thư viện project',
  'tc.lib.common': 'Thư viện chung',
  'tc.lib.empty': 'Chưa có mục nào. Kéo phần tử từ màn hình vào đây để lưu làm mẫu.',
  'tc.online.offTitle': 'Chưa kết nối thiết bị',
  'tc.online.offText': 'Công cụ online cần kết nối theo dõi tới thiết bị.',
  'tc.online.write': 'Nạp project xuống thiết bị',
  'tc.online.readonly': 'Kết nối theo dõi chỉ đọc. Nạp xuống thiết bị cần Online và đăng nhập.',
  'tc.find.label': 'Tìm trong project',
  'tc.find.placeholder': 'Tên Tag, phần tử màn hình…',
  'tc.find.hint': 'Tìm trong Tag và phần tử màn hình. Thay thế hàng loạt có ở GĐ 2.',
  'tc.find.none': 'Không tìm thấy.',
  'tc.find.tag': 'Tag · {type}',
  'tc.find.element': 'Phần tử · {screen}',

  // ---- Thanh trạng thái (FR-008) ----
  'sb.device': 'Thiết bị',
  'sb.errors': '{n} lỗi',
  'sb.warnings': '{n} cảnh báo',
  'sb.openInfo': 'Mở tab Thông tin',
  'sb.checking': 'Đang kiểm tra…',
  'sb.theme.system': 'Theo hệ thống',
  'sb.theme.light': 'Sáng',
  'sb.theme.dark': 'Tối',
  'sb.themeCycle': 'Đổi giao diện: hệ thống → sáng → tối',
  'sb.runtime': 'runtime {version}',
  'sb.noAddress': 'chưa nhập địa chỉ thiết bị',
  'sb.connecting': 'Đang kết nối {address}…',
  'sb.full': 'Thiết bị đã đủ số phiên, tự thử lại sau 30 s',
  'sb.error': 'Không kết nối được: {reason}',
  'sb.incompatible': 'Giao thức của thiết bị không tương thích',

  // ---- Tab Bắt đầu (FR-003) ----
  'start.welcome': 'mAT Studio',
  'start.welcomeText':
    'Tạo project mới từ mẫu, hoặc mở một thư mục project có sẵn. Project gồm project.json, tags.json, màn hình và cấu hình lưu trữ.',
  'start.summary':
    '{path} · project {version} · {tags} Tag · {screens} màn hình · {groups} nhóm lưu trữ',
  'start.quick': 'Tác vụ nhanh',
  'start.tile.open': 'Mở project',
  'start.tile.openText': 'Chọn thư mục project trên máy này',
  'start.tile.validate': 'Kiểm tra project',
  'start.tile.validateText': '{e} lỗi, {w} cảnh báo · cùng bộ kiểm tra với runtime',
  'start.tile.validateNone': 'Cùng bộ kiểm tra với runtime',
  'start.tile.connect': 'Kết nối theo dõi',
  'start.tile.connectText': 'Xem giá trị sống từ BL335, chỉ đọc',
  'start.tile.tags': 'Bảng Tag',
  'start.tile.tagsText': 'Sửa Tag, kiểu, Min/Max, mô tả',
  'start.tile.devices': 'Thiết bị trong mạng',
  'start.tile.devicesText': 'Tìm BL335 trong LAN, ghim chứng chỉ, đăng nhập',
  'start.recent': 'Mở gần đây',
  'start.recentEmpty': 'Chưa có project nào mở gần đây.',
  'start.recentMissing': 'không còn thư mục',
  'start.recentCurrent': 'đang mở',
  'start.recentForget': 'Bỏ {name} khỏi danh sách',
  'start.recentOpen': 'Mở {name}',
  'start.roadmap': 'Lộ trình v2',
  'road.done': 'Đã có',
  'road.done.title': 'Runtime trên BL335, màn hình SVG trên Chrome',
  'road.done.text':
    'Mock Tag, 10 client, deploy/rollback; lưu trữ SQLite và gửi sang MySQL, SQL Server, PostgreSQL, InfluxDB (feature 003)',
  'road.p0': 'GĐ 0',
  'road.p0.title': 'Đóng Sprint 1',
  'road.p0.text': 'Vá các lỗi audit, test khởi động, nghiệm thu còn lại',
  'road.p1': 'GĐ 1',
  'road.p1.title': 'Studio mới + làm việc với thiết bị',
  'road.p1.text':
    'Khung này (feature 004); tìm thiết bị, HTTPS, đăng nhập, nạp xuống, đọc lên, so sánh (feature 005)',
  'road.p2': 'GĐ 2',
  'road.p2.title': 'Tag, driver, tính toán, ghi Tag',
  'road.p2.text':
    'Modbus TCP/RTU, Tag nội bộ và tính toán, bảng giá trị, lưới Tag kiểu Excel, bảng theo dõi online',
  'road.p3a': 'GĐ 3a',
  'road.p3a.title': 'Màn hình và widget',
  'road.p3a.text': 'Card, đồng hồ, biểu đồ, nút, công tắc, ô nhập setpoint; nhiều màn hình',
  'road.p3b': 'GĐ 3b',
  'road.p3b.title': 'Import SVG, gắn Tag bằng giao diện',
  'road.p3b.text': 'Màu, mức chất lỏng, quay, nhấp nháy, dòng chảy, sự kiện nhấp',
  'road.p45': 'GĐ 4–5',
  'road.p45.title': 'Alarm; biểu đồ lịch sử, báo cáo',
  'road.p45.text': 'ISA-18.2, alarm log; báo cáo ca/ngày/tháng, xuất CSV/XLSX/PDF',
  'road.p6': 'GĐ 6',
  'road.p6.title': 'Trình vẽ SVG trong Studio, cập nhật runtime qua mạng',
  'road.p6.text': 'Trước đó vẽ bằng công cụ ngoài rồi import và gắn Tag trong Studio',

  // ---- Hộp thoại (FR-024, FR-025, FR-034) ----
  'dlg.close': 'Đóng',
  'dlg.closeTip': 'Đóng (Esc)',
  'dlg.cancel': 'Hủy',
  'dlg.unsaved.title': 'Lưu thay đổi?',
  'dlg.unsaved.text': 'Project còn thay đổi chưa lưu: {files}. Lưu trước khi tiếp tục?',
  'dlg.unsaved.save': 'Lưu',
  'dlg.unsaved.discard': 'Không lưu',
  'dlg.conflict.title': 'File đã bị sửa ngoài Studio',
  'dlg.conflict.text':
    '{file} đã bị chương trình khác sửa sau khi Studio đọc. Ghi đè sẽ mất phần sửa bên ngoài. Tải lại sẽ lấy nội dung trên đĩa và bỏ phần sửa trong Studio của file này (vẫn hoàn tác được).',
  'dlg.conflict.overwrite': 'Ghi đè',
  'dlg.conflict.reload': 'Tải lại',
  'dlg.saveError.title': 'Không lưu được',
  'dlg.saveError.text': 'Không ghi được {file}: {reason}. Thay đổi vẫn giữ trong Studio.',
  'dlg.shortcuts.title': 'Phím tắt',
  'dlg.shortcuts.note':
    'Phím tắt Ctrl+K và Ctrl+M giống TIA Portal. Ctrl+L để dành cho Nạp xuống (feature 005).',
  'dlg.about.title': 'Giới thiệu mAT Studio',
  'dlg.about.app': 'Ứng dụng',
  'dlg.about.tauri': 'Tauri',
  'dlg.about.webview': 'WebView2',
  'dlg.about.mode': 'Chế độ',
  'dlg.about.mock': 'Bản thử giao diện, lớp Tauri giả (e2e)',
  'dlg.about.unknown': 'không rõ',
  'dlg.about.signature': 'Chữ ký số',
  'dlg.about.sigLoading': 'đang kiểm…',
  'dlg.about.sigSigner': '{signer}, dấu vân tay {thumbprint}',
  'dlg.about.sigNotTrusted': '{who} (chưa tin cậy: chứng chỉ thử)',
  'dlg.about.sigUnsigned': 'chưa ký (bản dựng nội bộ)',
  'dlg.about.sigUnsupported': 'chưa ký (chỉ kiểm được trên Windows)',
  'dlg.about.sigInvalid': 'chữ ký không hợp lệ ({detail})',
  'dlg.about.sigError': 'không đọc được chữ ký ({detail})',
  'shortcut.editCell': 'Sửa ô đang chọn',
  'shortcut.escape': 'Hủy sửa ô; đóng hộp thoại, menu',
  'shortcut.closeTab': 'Đóng tab đang chọn',

  // ---- Lỗi ghi file ----
  'save.error.changed': 'file đã bị sửa ngoài Studio',
  'save.error.bad-path': 'đường dẫn không hợp lệ',
  'save.error.no-project': 'chưa mở project',
  'save.error.io': 'lỗi ghi file ({detail})',

  // ---- Thông báo ngắn (toast) ----
  'toast.saved': 'Đã lưu {files}.',
  'toast.savedWithErrors': 'Đã lưu {files}. Còn {n} lỗi: thiết bị sẽ từ chối project này.',
  'toast.nothingToSave': 'Không có thay đổi chưa lưu.',
  'toast.saveCancelled': 'Chưa lưu {file}: thay đổi vẫn giữ trong Studio.',
  'toast.validated': 'Kiểm tra xong: {e} lỗi, {w} cảnh báo. Cùng bộ kiểm tra với runtime.',
  'toast.recentMissing': 'Thư mục không còn tồn tại. Bỏ mục này khỏi danh sách ở tab Bắt đầu.',
  'toast.layoutReset': 'Đã đặt lại bố cục.',
  'toast.openWebFailed': 'Không mở được trang thiết bị: {reason}',
  'toast.projectClosed': 'Đã đóng project.',
} as const;

export const viMessages = {
  ...viCore,
  ...viNewProject,
  ...viTags,
  ...viTags2,
  ...viExpr,
  ...viGrid,
  ...viLayout,
  ...viProject02,
  ...viDevice,
  ...viLogging,
  ...viOnline,
  ...viDeploy,
  ...viCompare,
  ...viAudit,
  ...viTables,
  ...viAlarm,
  ...viScreens,
  ...viScreensInsp,
  ...viDashboard,
  ...viScreensNav,
  ...viSvg,
  ...viSymbols,
  ...viImport,
  ...viHistory,
  ...viReports,
  ...viTemplate,
  ...viLogic,
  ...viLogicDiagram,
  ...viSvgDraw,
  ...viUpdate,
  ...viS7,
  ...viFins,
  ...viMc,
  ...viBacnet,
  ...viOpcUa,
} as const;
