// Danh mục lệnh của Studio (feature 004, contracts/commands.md, data-model §11, FR-009, FR-010, FR-031):
// id, khóa nhãn, phím tắt, menu, điều kiện bật. Khai báo thuần: menu, thanh công cụ, bảng lệnh và phím
// tắt dựng từ đây; store cung cấp CommandContext và nối `run` theo id.
// Lệnh của GĐ 2 hiện trên menu nhưng luôn khóa, kèm lý do. Feature 005: US1 mở Thiết bị trong mạng, Đăng nhập…,
// Đăng xuất; US2 Nạp xuống, Khôi phục; US3 Đọc lên, So sánh (hết khóa).
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import type { EditorId, NodeRef } from '../model/tree.ts';

export type MenuId = 'project' | 'edit' | 'view' | 'online' | 'tools' | 'help';

export type CommandId =
  | 'project.open'
  | 'project.openRecent'
  | 'project.save'
  | 'project.settings'
  | 'project.close'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.find'
  | 'edit.fillDown'
  | 'tags.add'
  | 'tags.delete'
  | 'tags.bulkAdd'
  | 'tags.importCsv'
  | 'tags.exportCsv'
  | 'tags.rename'
  | 'tree.add'
  | 'tree.rename'
  | 'tree.duplicate'
  | 'tree.remove'
  | 'watch.write'
  | 'watch.writeAll'
  | 'view.palette'
  | 'view.themeSystem'
  | 'view.themeLight'
  | 'view.themeDark'
  | 'view.taskCards'
  | 'view.phases'
  | 'view.resetLayout'
  | 'view.nextRegion'
  | 'view.prevRegion'
  | 'online.connect'
  | 'online.disconnect'
  | 'online.device'
  | 'online.openWeb'
  | 'online.devices'
  | 'online.login'
  | 'online.logout'
  | 'online.download'
  | 'online.restore'
  | 'online.upload'
  | 'online.compare'
  | 'online.audit'
  | 'tools.validate'
  | 'tools.simulate'
  | 'help.shortcuts'
  | 'help.roadmap'
  | 'help.about'
  // Chỉ có trong bảng lệnh (không có menu): mở editor theo tên
  | 'open.start'
  | 'open.tags'
  | 'open.logging'
  | 'open.connections'
  | 'open.calc'
  | 'open.driverDiag'
  // Feature 007: màn hình 0.3 (cây, trình bố trí). Không có menu: bảng lệnh, thanh công cụ editor, menu chuột phải.
  | 'screen.add'
  | 'screen.addPopup'
  | 'screen.setEntry'
  | 'screen.props'
  | 'open.navigation'
  | 'screen.selectAll'
  | 'screen.copy'
  | 'screen.paste'
  | 'screen.duplicate'
  | 'screen.delete'
  | 'screen.alignLeft'
  | 'screen.alignCenter'
  | 'screen.alignRight'
  | 'screen.alignTop'
  | 'screen.alignMiddle'
  | 'screen.alignBottom'
  | 'screen.distributeH'
  | 'screen.distributeV'
  | 'screen.sameWidth'
  | 'screen.sameHeight'
  | 'screen.toFront'
  | 'screen.toBack'
  | 'screen.forward'
  | 'screen.backward'
  | 'screen.lock'
  | 'screen.hide'
  | 'screen.toggleGrid'
  | 'screen.toggleSnap'
  | 'screen.zoomIn'
  | 'screen.zoomOut'
  | 'screen.zoomFit'
  | 'screen.zoom100'
  | 'screen.previewOff'
  | 'screen.previewSim'
  | 'screen.previewDevice'
  | 'screen.toolSelect'
  | 'screen.toolHand'
  // Feature 008: nhập đồ họa SVG vào màn hình đang mở (không có menu: menu cố định theo contract 004).
  | 'import.svg';

/** Trạng thái mà điều kiện bật của lệnh cần; store dựng mỗi khi trạng thái đổi. */
export interface CommandContext {
  hasProject: boolean;
  /** Còn tài liệu chưa lưu. */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Đang theo dõi thiết bị (phiên `monitoring`). */
  monitoring: boolean;
  /** Đã nhập địa chỉ thiết bị hợp lệ. */
  deviceAddressSet: boolean;
  /** Đang Online có đăng nhập (feature 005), phiên còn hạn. */
  onlineAuth: boolean;
  /** Như `onlineAuth` và tài khoản từ engineer trở lên (đọc lên cần quyền này). */
  onlineEngineer: boolean;
  /** Phiên đăng nhập vừa hết hạn, đang chờ đăng nhập lại (feature 005). */
  relogin: boolean;
  /** Như `onlineAuth` và tài khoản từ operator trở lên (ghi Tag cần quyền này, feature 006). */
  onlineOperator: boolean;
  /** Số lỗi (mã E_) của lần kiểm mới nhất. */
  errorCount: number;
  /** Editor của tab đang chọn. */
  activeEditor: EditorId | null;
  /** Focus đang ở lưới Bảng Tag (không phải ô nhập đang sửa). */
  tagGridFocused: boolean;
  /** Vị trí của ô đang chọn trong các dòng đang hiện của Bảng Tag (0 = dòng đầu); null: chưa chọn. */
  cellRow: number | null;
  /** Project 0.1 mở chỉ đọc (feature 006, FR-003): mọi lệnh sửa bị khóa. */
  readOnly: boolean;
  /** Project ở định dạng 0.2 (đã nâng cấp hoặc mở sẵn): có Kết nối, Bảng giá trị, Bảng theo dõi. */
  version02: boolean;
  /** Loại nút đang chọn trên cây (thêm, đổi tên, nhân bản, xóa); `null`: nút không có thao tác. */
  treeKind: NodeRef['type'] | null;
  /** Id của Tag đang chọn (Bảng Tag, Tag tính toán); null: chưa chọn Tag. */
  selectedTag: string | null;
  /** Mô phỏng đang bật (feature 006, FR-052). */
  simulating: boolean;
  // ---- Feature 007 ----
  /** Project ở định dạng 0.3 (màn hình nhiều item). */
  version03: boolean;
  /** Editor của tab đang chọn là editor Màn hình 0.3. */
  screenEditor: boolean;
  /** Số item đang chọn trong editor Màn hình. */
  screenSel: number;
  /** Clipboard của trình bố trí có nội dung. */
  screenClip: boolean;
  /** Chế độ xem trước của editor Màn hình: `off` là chỉnh sửa. */
  screenPreview: 'off' | 'sim' | 'device';
  /** Màn hình đang mở là popup (không đặt làm màn hình đầu được). */
  screenIsPopup: boolean;
}

export const EMPTY_CONTEXT: CommandContext = {
  hasProject: false,
  dirty: false,
  canUndo: false,
  canRedo: false,
  monitoring: false,
  deviceAddressSet: false,
  onlineAuth: false,
  onlineEngineer: false,
  relogin: false,
  onlineOperator: false,
  errorCount: 0,
  activeEditor: null,
  tagGridFocused: false,
  cellRow: null,
  readOnly: false,
  version02: false,
  treeKind: null,
  selectedTag: null,
  simulating: false,
  version03: false,
  screenEditor: false,
  screenSel: 0,
  screenClip: false,
  screenPreview: 'off',
  screenIsPopup: false,
};

/** `true` hoặc khóa i18n của lý do bị khóa (tooltip, bảng lệnh). */
export type Enabled = true | MessageKey;

export interface CommandSpec {
  id: CommandId;
  label: MessageKey;
  /** Dạng hiển thị: `Ctrl+S`, `Ctrl+Shift+P`, `F7`, `Shift+F6`. */
  shortcut?: string;
  /** Phím chỉ có hiệu lực khi canvas hoặc danh sách Lớp có focus (feature 007, contract studio-screen-editor §4). */
  canvasKey?: string;
  /** null: chỉ có trong bảng lệnh. */
  menu: MenuId | null;
  /** Icon trên thanh công cụ (nếu lệnh có nút). */
  icon?: IconName;
  enabled(ctx: CommandContext): Enabled;
}

type Check = (c: CommandContext) => Enabled;
const always: Check = () => true;
const needProject: Check = (c) => c.hasProject || 'reason.noProject';
const editable: Check = (c) => (c.readOnly ? 'reason.readOnly' : true);
/** Bảng Tag 0.2 đang mở: Thêm hàng loạt, Nhập và Xuất CSV. */
const tagTable02: Check = (c) =>
  c.activeEditor !== 'tags' ? 'reason.tagsNotActive' : c.version02 ? true : 'reason.needVersion02';
/** Bảng theo dõi đang mở, Online với tài khoản từ operator: lệnh Ghi (feature 006, US2). */
const canWrite: Check = (c) =>
  !c.activeEditor?.startsWith('watch:')
    ? 'reason.watchNotActive'
    : c.simulating
      ? true
      : !c.onlineAuth
        ? 'reason.notOnline'
        : c.onlineOperator
          ? true
          : 'reason.needOperator';
/** Project 0.3 (màn hình nhiều item). */
const project03: Check = (c) => c.version03 || 'reason.needVersion03';
/** Editor Màn hình 0.3 đang mở. */
const screenOpen: Check = (c) => c.screenEditor || 'reason.screenNotActive';
const notPopup: Check = (c) => (c.screenIsPopup ? 'reason.screenIsPopup' : true);
/** Chỉnh sửa màn hình: editor mở, project sửa được, không đang xem trước. */
const screenEdit: Check = (c) =>
  !c.hasProject
    ? 'reason.noProject'
    : c.readOnly
      ? 'reason.readOnly'
      : !c.screenEditor || !c.version03
        ? 'reason.screenNotActive'
        : c.screenPreview !== 'off'
          ? 'reason.screenPreviewLocked'
          : true;
/** Cần ít nhất `n` item được chọn. */
const selected =
  (n: number): Check =>
  (c) =>
    c.screenSel >= n
      ? true
      : n === 1
        ? 'reason.screenNoSelection'
        : n === 2
          ? 'reason.screenNeed2'
          : 'reason.screenNeed3';

/** Nút trên cây có đối tượng riêng (kênh, thiết bị trường, bảng). */
const treeObject: Check = (c) =>
  c.treeKind === 'channel' ||
  c.treeKind === 'device' ||
  c.treeKind === 'valueTable' ||
  c.treeKind === 'watch' ||
  (c.treeKind === 'screen' && c.version03)
    ? true
    : 'reason.noTreeTarget';
const all =
  (...checks: Check[]): Check =>
  (c) => {
    for (const check of checks) {
      const r = check(c);
      if (r !== true) return r;
    }
    return true;
  };

const cmd = (
  id: CommandId,
  menu: MenuId | null,
  enabled: Check,
  extra: { shortcut?: string; canvasKey?: string; icon?: IconName } = {},
): CommandSpec => ({
  id,
  // `satisfies`: TypeScript kiểm mọi id lệnh đều có chuỗi `cmd.{id}` trong vi.ts.
  label: `cmd.${id}` as const satisfies MessageKey,
  menu,
  enabled,
  ...extra,
});

/** Theo thứ tự của contract; lệnh chỉ có trong bảng lệnh ở cuối. */
export const COMMANDS: readonly CommandSpec[] = [
  cmd('project.open', 'project', always, { shortcut: 'Ctrl+O', icon: 'project' }),
  cmd('project.openRecent', 'project', always),
  cmd(
    'project.save',
    'project',
    all(needProject, (c) => c.dirty || 'reason.noChanges'),
    { shortcut: 'Ctrl+S', icon: 'save' },
  ),
  cmd('project.settings', 'project', needProject, { icon: 'gear' }),
  cmd('project.close', 'project', needProject),

  cmd('edit.undo', 'edit', (c) => c.canUndo || 'reason.noUndo', {
    shortcut: 'Ctrl+Z',
    icon: 'undo',
  }),
  cmd('edit.redo', 'edit', (c) => c.canRedo || 'reason.noRedo', {
    shortcut: 'Ctrl+Y',
    icon: 'redo',
  }),
  cmd('edit.find', 'edit', needProject, { shortcut: 'Ctrl+F', icon: 'search' }),
  cmd(
    'edit.fillDown',
    'edit',
    (c) =>
      !c.tagGridFocused || c.cellRow === null
        ? 'reason.gridNotFocused'
        : c.cellRow === 0
          ? 'reason.firstRow'
          : true,
    { shortcut: 'Ctrl+D', icon: 'filldown' },
  ),
  cmd('tags.add', 'edit', (c) => c.activeEditor === 'tags' || 'reason.tagsNotActive', {
    icon: 'plus',
  }),
  cmd(
    'tags.delete',
    'edit',
    (c) =>
      c.activeEditor !== 'tags'
        ? 'reason.tagsNotActive'
        : c.cellRow === null
          ? 'reason.noRow'
          : true,
    { icon: 'x' },
  ),

  cmd('tags.bulkAdd', 'edit', all(editable, tagTable02), { icon: 'plus' }),
  cmd('tags.importCsv', 'edit', all(editable, tagTable02), { icon: 'import' }),
  cmd('tags.exportCsv', 'edit', tagTable02, { icon: 'export' }),
  // Đổi tên Tag (feature 006, FR-047): Tag đang chọn; hộp thoại liệt kê chỗ sẽ đổi.
  cmd(
    'tags.rename',
    'edit',
    all(needProject, editable, (c) =>
      !c.version02 ? 'reason.needVersion02' : c.selectedTag === null ? 'reason.noTag' : true,
    ),
  ),
  cmd(
    'tree.add',
    'edit',
    all(needProject, editable, (c) =>
      !c.version02 ? 'reason.needVersion02' : c.treeKind === null ? 'reason.noTreeTarget' : true,
    ),
    { shortcut: 'Insert', icon: 'plus' },
  ),
  cmd('tree.rename', 'edit', all(needProject, editable, treeObject), { shortcut: 'F2' }),
  cmd('tree.duplicate', 'edit', all(needProject, editable, treeObject), {
    shortcut: 'Ctrl+Shift+D',
  }),
  cmd('tree.remove', 'edit', all(needProject, editable, treeObject), {
    shortcut: 'Delete',
    icon: 'x',
  }),

  cmd('view.palette', 'view', always, { shortcut: 'Ctrl+Shift+P', icon: 'menu' }),
  cmd('view.themeSystem', 'view', always, { icon: 'contrast' }),
  cmd('view.themeLight', 'view', always, { icon: 'sun' }),
  cmd('view.themeDark', 'view', always, { icon: 'moon' }),
  cmd('view.taskCards', 'view', always),
  cmd('view.phases', 'view', always),
  cmd('view.resetLayout', 'view', always),
  cmd('view.nextRegion', 'view', always, { shortcut: 'F6' }),
  cmd('view.prevRegion', 'view', always, { shortcut: 'Shift+F6' }),

  // Ctrl+K, nút Online (feature 005, T085a): project đã gắn thiết bị thì Online thiết bị đó, chưa gắn thì mở
  // Thiết bị trong mạng (StudioApp quyết định khi chạy). Không có lớp thiết bị (test của 004): theo dõi theo
  // địa chỉ như 004, chưa nhập địa chỉ thì mở trang Thiết bị.
  cmd(
    'online.connect',
    'online',
    all(needProject, (c) => !c.monitoring || 'reason.monitoring'),
    { shortcut: 'Ctrl+K', icon: 'online' },
  ),
  cmd('online.disconnect', 'online', (c) => c.monitoring || 'reason.notMonitoring', {
    shortcut: 'Ctrl+M',
    icon: 'offline',
  }),
  cmd('online.device', 'online', always, { icon: 'device' }),
  cmd('online.openWeb', 'online', (c) => c.deviceAddressSet || 'reason.noAddress', {
    icon: 'ext',
  }),
  cmd('online.devices', 'online', always, { icon: 'device' }),
  // Phiên hết hạn: mở lại hộp thoại đăng nhập. Đã đăng nhập: khóa.
  cmd('online.login', 'online', (c) => c.relogin || !c.onlineAuth || 'reason.loggedIn', {
    icon: 'lock',
  }),
  cmd('online.logout', 'online', (c) => c.onlineAuth || c.relogin || 'reason.notLoggedIn'),
  // Nạp xuống (feature 005, US2): khi còn lỗi, lý do là "Project còn lỗi" (FR-023); cần Online và đăng nhập.
  cmd(
    'online.download',
    'online',
    all(
      needProject,
      (c) => (c.errorCount > 0 ? 'reason.projectErrors' : true),
      (c) => c.onlineAuth || 'reason.notOnline',
    ),
    { shortcut: 'Ctrl+L', icon: 'download' },
  ),
  // Khôi phục bản trước trên thiết bị (T124): chọn trong danh sách bản lưu của thiết bị đang Online.
  cmd('online.restore', 'online', (c) => c.onlineAuth || 'reason.notOnline', { icon: 'restore' }),
  // Đọc lên (US3): từ engineer trở lên; "thành project mới" không cần mở project.
  cmd(
    'online.upload',
    'online',
    (c) => (c.onlineEngineer ? true : c.onlineAuth ? 'reason.needEngineer' : 'reason.notOnline'),
    { icon: 'upload' },
  ),
  // So sánh (US3): cần project và Online; viewer chỉ thấy khớp hay khác.
  cmd(
    'online.compare',
    'online',
    all(needProject, (c) => c.onlineAuth || 'reason.notOnline'),
    {
      icon: 'compare',
    },
  ),

  // Audit của thiết bị (US4): mở editor Audit; chỉ administrator xem được, tài khoản khác thấy "không đủ quyền".
  cmd('online.audit', 'online', (c) => c.onlineAuth || 'reason.notOnline', { icon: 'list' }),

  // Ghi từ Bảng theo dõi (US2): luôn qua hộp xác nhận; khóa kèm lý do khi chưa đủ điều kiện.
  cmd('watch.write', 'online', canWrite, { shortcut: 'Ctrl+Shift+Enter', icon: 'upload' }),
  cmd('watch.writeAll', 'online', canWrite, { icon: 'upload' }),

  cmd('tools.validate', 'tools', needProject, { shortcut: 'F7', icon: 'check' }),
  // Mô phỏng (feature 006, FR-052): bật hoặc tắt; giá trị tự tính trong Studio, không gửi gì tới thiết bị.
  cmd('tools.simulate', 'tools', needProject, { icon: 'play' }),
  cmd('help.shortcuts', 'help', always),
  // Lộ trình: mở tab Bắt đầu.
  cmd('help.roadmap', 'help', always),
  cmd('help.about', 'help', always, { icon: 'info' }),

  cmd('open.start', null, always, { icon: 'home' }),
  cmd('open.tags', null, needProject, { icon: 'table' }),
  cmd('open.logging', null, needProject, { icon: 'db' }),
  // Feature 006 (FR-053): mọi editor mới mở được từ bảng lệnh; Bảng giá trị và Bảng theo dõi theo tên (`open.vt:`, `open.watch:`).
  cmd('open.connections', null, needProject, { icon: 'table' }),
  cmd('open.calc', null, needProject, { icon: 'table' }),
  cmd('open.driverDiag', null, needProject, { icon: 'table' }),

  // ---- Feature 007: màn hình 0.3 ----
  cmd('screen.add', null, all(needProject, editable, project03), { icon: 'plus' }),
  cmd('screen.addPopup', null, all(needProject, editable, project03), { icon: 'popup' }),
  cmd('screen.setEntry', null, all(needProject, editable, project03, screenOpen, notPopup), {
    icon: 'home',
  }),
  cmd('screen.props', null, all(needProject, editable, project03, screenOpen), { icon: 'gear' }),
  cmd('open.navigation', null, all(needProject, project03), { icon: 'menu' }),
  cmd('screen.selectAll', null, screenEdit, { icon: 'pointer', canvasKey: 'Ctrl+A' }),
  cmd('screen.copy', null, all(screenEdit, selected(1)), { icon: 'paste', canvasKey: 'Ctrl+C' }),
  cmd(
    'screen.paste',
    null,
    all(screenEdit, (c) => c.screenClip || 'reason.clipEmpty'),
    {
      icon: 'paste',
      canvasKey: 'Ctrl+V',
    },
  ),
  cmd('screen.duplicate', null, all(screenEdit, selected(1)), {
    icon: 'plus',
    canvasKey: 'Ctrl+D',
  }),
  cmd('screen.delete', null, all(screenEdit, selected(1)), { icon: 'x', canvasKey: 'Delete' }),
  cmd('screen.alignLeft', null, all(screenEdit, selected(2)), { icon: 'align-l' }),
  cmd('screen.alignCenter', null, all(screenEdit, selected(2)), { icon: 'align-c' }),
  cmd('screen.alignRight', null, all(screenEdit, selected(2)), { icon: 'align-r' }),
  cmd('screen.alignTop', null, all(screenEdit, selected(2)), { icon: 'align-t' }),
  cmd('screen.alignMiddle', null, all(screenEdit, selected(2)), { icon: 'align-m' }),
  cmd('screen.alignBottom', null, all(screenEdit, selected(2)), { icon: 'align-b' }),
  cmd('screen.distributeH', null, all(screenEdit, selected(3)), { icon: 'dist-h' }),
  cmd('screen.distributeV', null, all(screenEdit, selected(3)), { icon: 'dist-v' }),
  cmd('screen.sameWidth', null, all(screenEdit, selected(2)), { icon: 'same-w' }),
  cmd('screen.sameHeight', null, all(screenEdit, selected(2)), { icon: 'same-h' }),
  cmd('screen.toFront', null, all(screenEdit, selected(1)), {
    icon: 'front',
    canvasKey: 'Shift+]',
  }),
  cmd('screen.toBack', null, all(screenEdit, selected(1)), { icon: 'back', canvasKey: 'Shift+[' }),
  cmd('screen.forward', null, all(screenEdit, selected(1)), {
    icon: 'forward',
    canvasKey: ']',
  }),
  cmd('screen.backward', null, all(screenEdit, selected(1)), {
    icon: 'backward',
    canvasKey: '[',
  }),
  cmd('screen.lock', null, all(screenEdit, selected(1)), { icon: 'lock' }),
  cmd('screen.hide', null, all(screenEdit, selected(1)), { icon: 'eyeoff' }),
  cmd('screen.toggleGrid', null, all(needProject, project03, screenOpen), { icon: 'grid' }),
  cmd('screen.toggleSnap', null, all(needProject, project03, screenOpen), { icon: 'snap' }),
  cmd('screen.zoomIn', null, all(needProject, project03, screenOpen), {
    icon: 'zoomin',
    canvasKey: '+',
  }),
  cmd('screen.zoomOut', null, all(needProject, project03, screenOpen), {
    icon: 'zoomout',
    canvasKey: '-',
  }),
  cmd('screen.zoomFit', null, all(needProject, project03, screenOpen), {
    icon: 'fit',
    canvasKey: '0',
  }),
  cmd('screen.zoom100', null, all(needProject, project03, screenOpen), { canvasKey: '1' }),
  cmd('screen.previewOff', null, all(needProject, project03, screenOpen), { icon: 'pointer' }),
  cmd('screen.previewSim', null, all(needProject, project03, screenOpen), { icon: 'play' }),
  cmd('screen.previewDevice', null, all(needProject, project03, screenOpen), { icon: 'online' }),
  cmd('screen.toolSelect', null, all(needProject, project03, screenOpen), { icon: 'pointer' }),
  cmd('screen.toolHand', null, all(needProject, project03, screenOpen), { icon: 'hand' }),
  // ---- Feature 008: nhập SVG (khóa khi chỉ đọc, chưa nâng cấp 0.3, đang xem trước) ----
  cmd('import.svg', null, screenEdit, { shortcut: 'Ctrl+Shift+I', icon: 'import' }),
];

const BY_ID = new Map<string, CommandSpec>(COMMANDS.map((c) => [c.id, c]));

export const commandById = (id: string): CommandSpec | undefined => BY_ID.get(id);

/** Lý do bị khóa đã dịch; null khi lệnh đang bật. */
export function reasonOf(cmd: CommandSpec, ctx: CommandContext): string | null {
  const r = cmd.enabled(ctx);
  return r === true ? null : t(r);
}

export const MENU_ORDER: readonly MenuId[] = ['project', 'edit', 'view', 'online', 'tools', 'help'];

export const MENU_LABEL: Readonly<Record<MenuId, MessageKey>> = {
  project: 'menu.project',
  edit: 'menu.edit',
  view: 'menu.view',
  online: 'menu.online',
  tools: 'menu.tools',
  help: 'menu.help',
};

/** Nội dung từng menu; `-` là vạch ngăn. `project.openRecent` là menu con (danh sách gần đây). */
export const MENUS: Readonly<Record<MenuId, ReadonlyArray<CommandId | '-'>>> = {
  project: [
    'project.open',
    'project.openRecent',
    '-',
    'project.save',
    '-',
    'project.settings',
    '-',
    'project.close',
  ],
  edit: [
    'edit.undo',
    'edit.redo',
    '-',
    'edit.find',
    '-',
    'edit.fillDown',
    'tags.add',
    'tags.delete',
    'tags.bulkAdd',
    'tags.importCsv',
    'tags.exportCsv',
    'tags.rename',
    '-',
    'tree.add',
    'tree.rename',
    'tree.duplicate',
    'tree.remove',
  ],
  view: [
    'view.palette',
    '-',
    'view.themeSystem',
    'view.themeLight',
    'view.themeDark',
    '-',
    'view.taskCards',
    'view.phases',
    'view.resetLayout',
    '-',
    'view.nextRegion',
    'view.prevRegion',
  ],
  online: [
    'online.connect',
    'online.disconnect',
    '-',
    'online.device',
    'online.openWeb',
    '-',
    'online.devices',
    'online.login',
    'online.logout',
    '-',
    'online.download',
    'online.restore',
    'online.upload',
    'online.compare',
    'online.audit',
    '-',
    'watch.write',
    'watch.writeAll',
  ],
  tools: ['tools.validate', 'tools.simulate'],
  help: ['help.shortcuts', 'help.roadmap', '-', 'help.about'],
};
