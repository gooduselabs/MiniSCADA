// Cây project (feature 004, data-model §7, FR-004, thứ tự theo studio-ux.md §4 và mockup bản 1): hàm
// thuần dựng cây từ cấu trúc project đọc được (outlineOf, kể cả khi project còn lỗi hay thiếu file) và
// trạng thái phiên thiết bị. Mục của giai đoạn sau có nhãn giai đoạn và mở trang giải thích.
// Nhãn đã dịch sẵn bằng t(); đổi ngôn ngữ thì dựng lại cây.
import type { CompareResult, DiffStatus } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import { treeMarks } from './compare-view.ts';
import type { SessionState } from './device-session.ts';
import type { ProjectOutline } from './project-doc.ts';

/** Giai đoạn của lộ trình v2 hoặc feature sau (nhãn cạnh mục chưa làm). */
export type Phase = 'f005' | 'p2' | 'p3a' | 'p3b' | 'p4' | 'p5';

export const PHASE_LABEL: Readonly<Record<Phase, MessageKey>> = {
  f005: 'phase.f005',
  p2: 'phase.p2',
  p3a: 'phase.p3a',
  p3b: 'phase.p3b',
  p4: 'phase.p4',
  p5: 'phase.p5',
};
export const phaseLabel = (phase: Phase): string => t(PHASE_LABEL[phase]);

export type PhasePageKey =
  'connections' | 'calc' | 'valueTables' | 'alarm' | 'reports' | 'users' | 'library';

/** Nội dung trang giai đoạn (editor `phase:{key}`); tiêu đề dùng lại nhãn trên cây. */
export interface PhasePage {
  title: MessageKey;
  text: MessageKey;
  phase: Phase;
  icon: IconName;
}

export const PHASE_PAGES: Readonly<Record<PhasePageKey, PhasePage>> = {
  connections: {
    title: 'tree.connections',
    text: 'phasePage.connections',
    phase: 'p2',
    icon: 'connection',
  },
  calc: { title: 'tree.calc', text: 'phasePage.calc', phase: 'p2', icon: 'fx' },
  valueTables: {
    title: 'tree.valueTables',
    text: 'phasePage.valueTables',
    phase: 'p2',
    icon: 'list',
  },
  alarm: { title: 'tree.alarm', text: 'phasePage.alarm', phase: 'p4', icon: 'bell' },
  reports: { title: 'tree.reports', text: 'phasePage.reports', phase: 'p5', icon: 'report' },
  users: { title: 'tree.users', text: 'phasePage.users', phase: 'f005', icon: 'users' },
  library: { title: 'tree.library', text: 'phasePage.library', phase: 'p3b', icon: 'library' },
};

/** Editor mở trong tab (data-model §8); mỗi editorId tối đa một tab. */
export type EditorId =
  | 'start'
  | 'settings'
  | 'tags'
  | 'logging'
  | 'device'
  | 'compare'
  | 'audit'
  | `screen:${string}`
  | `phase:${PhasePageKey}`;

/** Trạng thái phiên thiết bị (data-model §9), dùng chung với `device-session.ts`. */
export type DeviceSessionState = SessionState;
export type DeviceNodeState = 'offline' | 'monitoring' | 'lost';

export const deviceNodeState = (s: DeviceSessionState): DeviceNodeState =>
  // Chờ đăng nhập lại (feature 005): dữ liệu sống vẫn chạy, vẫn là đang theo dõi.
  s === 'monitoring' || s === 'relogin' ? 'monitoring' : s === 'lost' ? 'lost' : 'offline';

const DEVICE_STATE_LABEL: Readonly<Record<DeviceNodeState, MessageKey>> = {
  offline: 'device.state.offline',
  monitoring: 'device.state.monitoring',
  lost: 'device.state.lost',
};
/** Chữ đi kèm chấm màu trạng thái (màu không là tín hiệu duy nhất, FR-012). */
export const deviceStateLabel = (s: DeviceNodeState): string => t(DEVICE_STATE_LABEL[s]);

export interface TreeNode {
  /** Ổn định giữa các lần dựng: giữ trạng thái mở/đóng và chọn. */
  id: string;
  label: string;
  icon: IconName;
  /** Chữ phụ: địa chỉ thiết bị, "màn hình đầu". */
  sub?: string;
  /** Editor mở khi chọn; null với nút chỉ để nhóm. */
  editor: EditorId | null;
  /** Số Tag, số nhóm lưu trữ. */
  count?: number;
  /** Mục chưa làm: giai đoạn sẽ có. */
  phase?: Phase;
  /** Chỉ nút thiết bị. */
  deviceState?: DeviceNodeState;
  /**
   * Ký hiệu so với thiết bị khi Online (feature 005, FR-029): `=` giống, `≠` khác, `+` chỉ có trên máy, `-` chỉ có
   * trên thiết bị. Gộp từ các đối tượng của nút (Tag, lưu trữ, màn hình cùng binding, SVG).
   */
  diff?: DiffStatus;
  children?: TreeNode[];
}

export interface TreeInput {
  /** Tên thư mục project: nhãn gốc khi project.json không đọc được. */
  folderName: string;
  outline: ProjectOutline;
  device: {
    /** Tên thiết bị nếu biết; không có thì "BL335". */
    name?: string | null;
    /** Địa chỉ người dùng đã nhập (chuỗi gốc); null hoặc rỗng nếu chưa nhập. */
    address: string | null;
    state: DeviceSessionState;
  };
  /** Kết quả So sánh gần nhất; chỉ hiện ký hiệu khi phiên đang Online (`monitoring`, `relogin`). */
  compare?: CompareResult | null;
}

/** Nút mở sẵn lần đầu (như mockup): gốc, thiết bị, Tag, Màn hình. */
export const DEFAULT_EXPANDED: ReadonlySet<string> = new Set([
  'root',
  'device',
  'tagsFolder',
  'screens',
]);

const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

function phaseNode(id: string, key: PhasePageKey, label: MessageKey, icon?: IconName): TreeNode {
  const page = PHASE_PAGES[key];
  return {
    id,
    label: t(label),
    icon: icon ?? page.icon,
    editor: `phase:${key}`,
    phase: page.phase,
  };
}

/** Đặt `diff` cho các nút có trong `marks` (tại chỗ, trên cây vừa dựng). */
function markTree(root: TreeNode, marks: ReadonlyMap<string, DiffStatus>): void {
  const mark = marks.get(root.id);
  if (mark) root.diff = mark;
  for (const c of root.children ?? []) markTree(c, marks);
}

export function buildTree(input: TreeInput): TreeNode {
  const root = buildNodes(input);
  const live = input.device.state === 'monitoring' || input.device.state === 'relogin';
  if (live && input.compare) markTree(root, treeMarks(input.compare, input.outline));
  return root;
}

function buildNodes(input: TreeInput): TreeNode {
  const { outline, device } = input;
  const project = outline.project;
  const name = project && nonEmpty(project.projectName) ? project.projectName : null;
  const entry = project?.entryScreen;

  const screens: TreeNode[] = outline.screens.map((s) => ({
    id: `screen:${s.id}`,
    label: nonEmpty(s.screen?.name) ? s.screen.name : s.id,
    icon: 'screen',
    editor: `screen:${s.id}`,
    ...(s.id === entry ? { sub: t('tree.entryScreen') } : {}),
  }));

  const tags: TreeNode = { id: 'tags', label: t('tree.tagTable'), icon: 'table', editor: 'tags' };
  if (outline.tags) tags.count = outline.tags.tags.length;
  const logging: TreeNode = {
    id: 'logging',
    label: t('tree.logging'),
    icon: 'db',
    editor: 'logging',
  };
  if (outline.loggingFile !== null && outline.logging)
    logging.count = outline.logging.groups.length;

  const deviceNode: TreeNode = {
    id: 'device',
    label: nonEmpty(device.name) ? device.name : t('tree.device'),
    sub: nonEmpty(device.address) ? device.address : t('tree.deviceNoAddress'),
    icon: 'device',
    editor: 'device',
    deviceState: deviceNodeState(device.state),
    children: [
      phaseNode('connections', 'connections', 'tree.connections'),
      {
        id: 'tagsFolder',
        label: t('tree.tags'),
        icon: 'tag',
        editor: null,
        children: [tags, phaseNode('calc', 'calc', 'tree.calc')],
      },
      phaseNode('valueTables', 'valueTables', 'tree.valueTables'),
      {
        ...phaseNode('alarm', 'alarm', 'tree.alarm'),
        children: [
          phaseNode('alarmList', 'alarm', 'tree.alarmList'),
          phaseNode('alarmClasses', 'alarm', 'tree.alarmClasses', 'list'),
        ],
      },
      logging,
      { id: 'screens', label: t('tree.screens'), icon: 'screen', editor: null, children: screens },
      phaseNode('reports', 'reports', 'tree.reports'),
      phaseNode('users', 'users', 'tree.users'),
    ],
  };

  return {
    id: 'root',
    label: name ?? (nonEmpty(input.folderName) ? input.folderName : t('tree.project')),
    icon: 'project',
    editor: null,
    children: [
      { id: 'start', label: t('tree.start'), icon: 'home', editor: 'start' },
      { id: 'settings', label: t('tree.settings'), icon: 'gear', editor: 'settings' },
      deviceNode,
      phaseNode('library', 'library', 'tree.library'),
    ],
  };
}

export interface TreeRow {
  node: TreeNode;
  /** aria-level, gốc là 1. */
  level: number;
  parentId: string | null;
}

/** Các nút đang hiện (cha đang mở), theo thứ tự trên màn hình: để vẽ và điều hướng bằng phím. */
export function flattenTree(root: TreeNode, expanded: ReadonlySet<string>): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (node: TreeNode, level: number, parentId: string | null) => {
    out.push({ node, level, parentId });
    if (node.children && expanded.has(node.id))
      for (const c of node.children) walk(c, level + 1, node.id);
  };
  walk(root, 1, null);
  return out;
}

export function findNode(root: TreeNode, id: string): TreeNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return undefined;
}

/** Nút đầu tiên (duyệt trước-sau) mở editor này: chọn trên cây khi chuyển tab. */
export function findByEditor(root: TreeNode, editor: EditorId): TreeNode | undefined {
  if (root.editor === editor) return root;
  for (const c of root.children ?? []) {
    const r = findByEditor(c, editor);
    if (r) return r;
  }
  return undefined;
}

/** id các nút cha từ gốc xuống (để mở đường tới một nút); không có nút thì null. */
export function ancestorsOf(root: TreeNode, id: string): string[] | null {
  if (root.id === id) return [];
  for (const c of root.children ?? []) {
    const r = ancestorsOf(c, id);
    if (r) return [root.id, ...r];
  }
  return null;
}
