// Danh mục lệnh của Studio (feature 004, contracts/commands.md, data-model §11, FR-009, FR-010, FR-031):
// id, khóa nhãn, phím tắt, menu, điều kiện bật. Khai báo thuần: menu, thanh công cụ, bảng lệnh và phím
// tắt dựng từ đây; store cung cấp CommandContext và nối `run` theo id.
// Lệnh của GĐ 2 hiện trên menu nhưng luôn khóa, kèm lý do. Feature 005: US1 mở Thiết bị trong mạng, Đăng nhập…,
// Đăng xuất; US2 Nạp xuống, Khôi phục; US3 Đọc lên, So sánh (hết khóa).
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import type { EditorId } from '../model/tree.ts';

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
  | 'open.logging';

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
  errorCount: 0,
  activeEditor: null,
  tagGridFocused: false,
  cellRow: null,
  readOnly: false,
};

/** `true` hoặc khóa i18n của lý do bị khóa (tooltip, bảng lệnh). */
export type Enabled = true | MessageKey;

export interface CommandSpec {
  id: CommandId;
  label: MessageKey;
  /** Dạng hiển thị: `Ctrl+S`, `Ctrl+Shift+P`, `F7`, `Shift+F6`. */
  shortcut?: string;
  /** null: chỉ có trong bảng lệnh. */
  menu: MenuId | null;
  /** Icon trên thanh công cụ (nếu lệnh có nút). */
  icon?: IconName;
  enabled(ctx: CommandContext): Enabled;
}

type Check = (c: CommandContext) => Enabled;
const always: Check = () => true;
const needProject: Check = (c) => c.hasProject || 'reason.noProject';
const phase2: Check = () => 'reason.p2';
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
  extra: { shortcut?: string; icon?: IconName } = {},
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

  cmd('tools.validate', 'tools', needProject, { shortcut: 'F7', icon: 'check' }),
  cmd('tools.simulate', 'tools', phase2, { icon: 'play' }),
  cmd('help.shortcuts', 'help', always),
  // Lộ trình: mở tab Bắt đầu.
  cmd('help.roadmap', 'help', always),
  cmd('help.about', 'help', always, { icon: 'info' }),

  cmd('open.start', null, always, { icon: 'home' }),
  cmd('open.tags', null, needProject, { icon: 'table' }),
  cmd('open.logging', null, needProject, { icon: 'db' }),
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
  ],
  tools: ['tools.validate', 'tools.simulate'],
  help: ['help.shortcuts', 'help.roadmap', '-', 'help.about'],
};
