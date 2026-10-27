// Cây project (feature 004, data-model §7, FR-004, thứ tự theo studio-ux.md §4 và mockup bản 1): hàm
// thuần dựng cây từ cấu trúc project đọc được (outlineOf, kể cả khi project còn lỗi hay thiếu file) và
// trạng thái phiên thiết bị. Mục của giai đoạn sau có nhãn giai đoạn và mở trang giải thích.
// Nhãn đã dịch sẵn bằng t(); đổi ngôn ngữ thì dựng lại cây.
import type { CompareResult, DiffStatus, Issue } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import { treeMarks } from './compare-view.ts';
import type { SessionState } from './device-session.ts';
import type { ProjectOutline } from './project-doc.ts';
import { channelSub, deviceSub, tagsPerDevice } from './connections.ts';
import type { TagV1 } from '@mat/project-schema';

/** Giai đoạn của lộ trình v2 hoặc feature sau (nhãn cạnh mục chưa làm). */
export type Phase = 'f005' | 'p2' | 'p3a' | 'p3b' | 'p5';

export const PHASE_LABEL: Readonly<Record<Phase, MessageKey>> = {
  f005: 'phase.f005',
  p2: 'phase.p2',
  p3a: 'phase.p3a',
  p3b: 'phase.p3b',
  p5: 'phase.p5',
};
export const phaseLabel = (phase: Phase): string => t(PHASE_LABEL[phase]);

export type PhasePageKey =
  'connections' | 'calc' | 'valueTables' | 'driverDiag' | 'reports' | 'library';

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
  driverDiag: {
    title: 'tree.driverDiag',
    text: 'phasePage.driverDiag',
    phase: 'p2',
    icon: 'check',
  },
  valueTables: {
    title: 'tree.valueTables',
    text: 'phasePage.valueTables',
    phase: 'p2',
    icon: 'list',
  },
  reports: { title: 'tree.reports', text: 'phasePage.reports', phase: 'p5', icon: 'report' },
  library: { title: 'tree.library', text: 'phasePage.library', phase: 'p3b', icon: 'library' },
};

/** Editor mở trong tab (data-model §8); mỗi editorId tối đa một tab. */
export type EditorId =
  | 'start'
  | 'settings'
  | 'tags'
  | 'connections'
  | 'logging'
  | 'device'
  | 'compare'
  | 'audit'
  /** Thiết lập thiết bị (feature 027): khi Online bằng administrator. */
  | 'deviceSettings'
  /** Tag tính toán và Chẩn đoán driver (feature 006, bỏ nhãn giai đoạn ở project 0.2). */
  | 'calc'
  | 'driverDiag'
  /** Editor Điều hướng của project 0.3 (feature 007). */
  | 'navigation'
  /** Alarm của project 0.5 (feature 009): danh sách, lớp, và trang nâng cấp cho project cũ. */
  | 'alarms'
  | 'alarmClasses'
  | 'alarmUpgrade'
  /** Thử alarm (feature 009): panel chạy bản TS của động cơ với Tag mô phỏng. */
  | 'alarmTest'
  | `vt:${string}`
  | `screen:${string}`
  | `watch:${string}`
  /** Danh sách mẫu báo cáo và từng mẫu (feature 010, project định dạng 0.6). */
  | 'reports'
  | `report:${string}`
  /** Recipe (feature 024, project định dạng 1.1): một editor, mỗi loại là một tab. */
  | `recipe:${string}`
  | 'recipes'
  /** Thư viện template và từng template (feature 011, project định dạng 1.0). */
  | 'templates'
  | `template:${string}`
  /** Editor Logic (feature 011, project định dạng 1.0): một tab cho cả bảy nhóm (Luật, Timer, …, Ghi PLC). */
  | 'logic'
  /** Người dùng và quyền của thiết bị Online (feature 027): `admin:users`, `admin:groups`, … (app/admin-workspace.ts). */
  | `admin:${string}`
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
  /** Số lỗi và cảnh báo của đối tượng (alarm, feature 009 FR-085). */
  issues?: { errors: number; warnings: number };
  /** Mục chưa làm: giai đoạn sẽ có. */
  phase?: Phase;
  /** Chỉ nút thiết bị. */
  deviceState?: DeviceNodeState;
  /** Chỉ nút kênh, khi Online: trạng thái kết nối do BL335 báo (`connected`, `error`…). */
  status?: string;
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
    /** Online bằng administrator (feature 027): nút con "Thiết lập thiết bị". */
    admin?: boolean;
  };
  /** Kết quả So sánh gần nhất; chỉ hiện ký hiệu khi phiên đang Online (`monitoring`, `relogin`). */
  compare?: CompareResult | null;
  /** Trạng thái kênh theo id (chẩn đoán driver); chỉ hiện khi phiên đang Online. */
  channelStates?: Readonly<Record<string, string>> | null;
  /** Lỗi và cảnh báo của lần kiểm mới nhất (nhãn số lỗi của mục Alarm). */
  issues?: readonly Pick<Issue, 'code' | 'file'>[];
}

/** Nút mở sẵn lần đầu (như mockup): gốc, thiết bị, Tag, Màn hình. */
export const DEFAULT_EXPANDED: ReadonlySet<string> = new Set([
  'root',
  'device',
  'tagsFolder',
  'screens',
]);

const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';

/** Số instance của alarm: mỗi alarm số hoặc quality một, mỗi ngưỡng một; alarm tắt không tính. */
function instanceTotal(outline: ProjectOutline): number {
  let n = 0;
  for (const a of (outline.alarms?.alarms ?? []) as unknown as Array<Record<string, unknown>>) {
    if (a.enabled === false) continue;
    n +=
      a.type === 'limit' && a.limits && typeof a.limits === 'object'
        ? Object.keys(a.limits).length
        : 1;
  }
  return n;
}

/**
 * Mục Alarm (feature 009, FR-073, FR-085): project 0.5 mở Danh sách alarm và Lớp alarm; project cũ vẫn hiện mục nhưng cả
 * hai nút con mở trang nâng cấp (không còn nhãn giai đoạn).
 */
function alarmNode(input: TreeInput): TreeNode {
  const o = input.outline;
  if (!o.v05)
    return {
      id: 'alarm',
      label: t('tree.alarm'),
      icon: 'bell',
      editor: null,
      children: [
        { id: 'alarmList', label: t('tree.alarmList'), icon: 'bell', editor: 'alarmUpgrade' },
        { id: 'alarmClasses', label: t('tree.alarmClasses'), icon: 'list', editor: 'alarmUpgrade' },
      ],
    };
  const mine = (input.issues ?? []).filter(
    (i) => i.file === o.alarmFile || i.file === o.alarmClassFile,
  );
  const errors = mine.filter((i) => i.code.startsWith('E_')).length;
  const warnings = mine.length - errors;
  const node: TreeNode = {
    id: 'alarm',
    label: t('tree.alarm'),
    icon: 'bell',
    editor: null,
    count: instanceTotal(o),
    children: [
      {
        id: 'alarmList',
        label: t('tree.alarmList'),
        icon: 'bell',
        editor: 'alarms',
        count: instanceTotal(o),
      },
      {
        id: 'alarmClasses',
        label: t('tree.alarmClasses'),
        icon: 'list',
        editor: 'alarmClasses',
        count: o.alarmClasses?.classes.length ?? 0,
      },
    ],
  };
  if (errors || warnings) node.issues = { errors, warnings };
  return node;
}

/**
 * Người dùng và quyền (feature 027): editor quản trị của thiết bị đang Online (dữ liệu ở thiết bị, ADR-042), và Nhật ký là
 * editor Audit của thiết bị.
 */
function usersNode(): TreeNode {
  const kids: Array<[string, MessageKey, IconName]> = [
    ['users', 'tree.admin.users', 'users'],
    ['groups', 'tree.admin.groups', 'group'],
    ['pages', 'tree.admin.pages', 'table'],
    ['components', 'tree.admin.components', 'screen'],
    ['viewAs', 'tree.admin.viewAs', 'eye'],
    ['email', 'tree.admin.email', 'bell'],
    ['apikeys', 'tree.admin.apikeys', 'lock'],
  ];
  return {
    id: 'users',
    label: t('tree.users'),
    icon: 'users',
    editor: null,
    children: [
      ...kids.map(([k, label, icon]): TreeNode => ({
        id: `admin:${k}`,
        label: t(label),
        icon,
        editor: `admin:${k}`,
      })),
      { id: 'adminAudit', label: t('tree.admin.audit'), icon: 'list', editor: 'audit' },
    ],
  };
}

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

/** Nhóm có nút con: gộp ký hiệu từ nút con khi nút không tự có đối tượng so sánh. */
function rollUp(root: TreeNode): DiffStatus | undefined {
  const kids = (root.children ?? []).map(rollUp).filter((d): d is DiffStatus => d !== undefined);
  if (root.diff === undefined && kids.length && root.children?.some((c) => c.id.includes(':')))
    root.diff = kids.every((k) => k === kids[0]) ? kids[0] : '≠';
  return root.diff;
}

function setStatus(root: TreeNode, states: Readonly<Record<string, string>>): void {
  if (root.id.startsWith('channel:')) {
    const st = states[root.id.slice('channel:'.length)];
    if (st !== undefined) root.status = st;
  }
  for (const c of root.children ?? []) setStatus(c, states);
}

export function buildTree(input: TreeInput): TreeNode {
  const root = buildNodes(input);
  const live = input.device.state === 'monitoring' || input.device.state === 'relogin';
  if (live && input.compare) {
    markTree(root, treeMarks(input.compare, input.outline));
    rollUp(root);
  }
  if (live && input.channelStates) setStatus(root, input.channelStates);
  return root;
}

/** Nút của các mục có thêm, đổi tên, nhân bản, xóa (FR-043): loại và khóa của đối tượng trong project. */
export type NodeRef =
  | { type: 'connections' }
  | { type: 'channel'; id: string }
  | { type: 'device'; id: string }
  | { type: 'valueTables' }
  | { type: 'valueTable'; name: string }
  | { type: 'watchTables' }
  | { type: 'watch'; id: string }
  /** Mục Màn hình và từng màn hình của project 0.3 (feature 007). */
  | { type: 'screens' }
  | { type: 'screen'; id: string }
  /** Alarm (feature 009): mục Danh sách alarm, một lớp, một alarm theo id định nghĩa. */
  | { type: 'alarms' }
  | { type: 'alarmClass'; id: string }
  | { type: 'alarm'; id: string };

export function refOfNode(id: string): NodeRef | null {
  if (id === 'connections') return { type: 'connections' };
  if (id === 'valueTables') return { type: 'valueTables' };
  if (id === 'watchTables') return { type: 'watchTables' };
  if (id === 'screens') return { type: 'screens' };
  if (id.startsWith('screen:')) return { type: 'screen', id: id.slice(7) };
  if (id === 'alarmList') return { type: 'alarms' };
  if (id.startsWith('alarmclass:')) return { type: 'alarmClass', id: id.slice(11) };
  if (id.startsWith('alarm:')) return { type: 'alarm', id: id.slice(6) };
  if (id.startsWith('channel:')) return { type: 'channel', id: id.slice(8) };
  if (id.startsWith('fdev:')) return { type: 'device', id: id.slice(5) };
  if (id.startsWith('valuetable:')) return { type: 'valueTable', name: id.slice(11) };
  if (id.startsWith('watch:')) return { type: 'watch', id: id.slice(6) };
  return null;
}

/**
 * Mục Template của project 1.0 (feature 011, FR-126): thư viện template, mỗi template một editor (danh sách bản sao,
 * "Cập nhật mọi bản sao"); chữ phụ là số bản sao trên mọi màn hình.
 */
function templatesNode(outline: ProjectOutline): TreeNode {
  const count = new Map<string, Set<string>>();
  for (const s of outline.screens)
    for (const it of s.model?.items ?? []) {
      const tpl = (it as { tpl?: { inst?: unknown; tid?: unknown } }).tpl;
      if (!tpl || typeof tpl.tid !== 'string' || typeof tpl.inst !== 'string') continue;
      const set = count.get(tpl.tid) ?? new Set<string>();
      set.add(`${s.id}/${tpl.inst}`);
      count.set(tpl.tid, set);
    }
  return {
    id: 'templates',
    label: t('tree.templates'),
    icon: 'template',
    editor: 'templates',
    count: outline.templates.length,
    children: outline.templates.map((tp) => ({
      id: `template:${tp.id}`,
      label: nonEmpty(tp.doc?.name) ? tp.doc.name : tp.id,
      icon: 'template',
      editor: `template:${tp.id}`,
      sub: t('tree.templateInstances', { n: count.get(tp.id)?.size ?? 0 }),
    })),
  };
}

/** Nhóm của Logic theo thứ tự cây (mockup studio-logic.html; T007 quyết định 3). */
const LOGIC_GROUPS: ReadonlyArray<[kind: string, key: string, label: MessageKey, icon: IconName]> =
  [
    ['rule', 'rules', 'logic.kind.rule', 'rule'],
    ['timer', 'timers', 'logic.kind.timer', 'timer'],
    ['counter', 'counters', 'logic.kind.counter', 'counter'],
    ['totalizer', 'totalizers', 'logic.kind.totalizer', 'sum'],
    ['runhours', 'runhours', 'logic.kind.runhours', 'hours'],
    ['schedule', 'schedules', 'logic.kind.schedule', 'cal'],
    ['writes', 'writes', 'logic.kind.writes', 'plc'],
  ];

/**
 * Nút Logic của project 1.0 (feature 011, FR-094): dưới thiết bị, cạnh Alarm và Lưu trữ; mỗi nhóm mở cùng tab `logic` (một
 * logic.json, một lịch sử hoàn tác) và đổi nhóm. Huy hiệu số lỗi, cảnh báo của logic.json.
 */
function logicNode(input: TreeInput): TreeNode {
  const o = input.outline;
  const doc = (o.logic ?? {}) as unknown as Record<string, unknown>;
  const len = (k: string) => (Array.isArray(doc[k]) ? (doc[k] as unknown[]).length : 0);
  const children = LOGIC_GROUPS.map(([kind, key, label, ic]): TreeNode => ({
    id: `logic:${kind}`,
    label: t(label),
    icon: ic,
    editor: 'logic',
    count: len(key),
  }));
  const mine = (input.issues ?? []).filter((i) => o.logicFile !== null && i.file === o.logicFile);
  const errors = mine.filter((i) => i.code.startsWith('E_')).length;
  const node: TreeNode = {
    id: 'logic',
    label: t('logic.tree'),
    icon: 'logic',
    editor: 'logic',
    count: children.reduce((n, c) => n + (c.count ?? 0), 0),
    children,
  };
  if (mine.length) node.issues = { errors, warnings: mine.length - errors };
  return node;
}

/** Mục Recipe của project 1.1 (feature 024): mỗi loại một editor. */
function recipesNode(outline: ProjectOutline): TreeNode {
  const list = outline.recipes?.types ?? [];
  return {
    id: 'recipes',
    label: t('tree.recipes'),
    icon: 'recipe',
    editor: 'recipes',
    count: list.length,
    children: list.map((r) => ({
      id: `recipe:${r.id}`,
      label: nonEmpty(r.name) ? r.name : r.id,
      icon: 'recipe',
      editor: `recipe:${r.id}`,
      count: r.recipes?.length ?? 0,
    })),
  };
}

/** Mục Báo cáo của project 0.6 (feature 010): danh sách mẫu, mỗi mẫu một editor. */
function reportsNode(outline: ProjectOutline): TreeNode {
  const list = outline.reports?.reports ?? [];
  return {
    id: 'reports',
    label: t('tree.reports'),
    icon: 'report',
    editor: 'reports',
    count: list.length,
    children: list.map((r) => ({
      id: `report:${r.id}`,
      label: nonEmpty(r.name) ? r.name : r.id,
      icon: 'report',
      editor: `report:${r.id}`,
    })),
  };
}

/** Cây của project 0.2 (feature 006, FR-043): Kết nối, Tag, Bảng giá trị, Bảng theo dõi, Chẩn đoán driver. */
function deviceChildren02(
  alarm: TreeNode,
  outline: ProjectOutline,
  tags: TreeNode,
  logging: TreeNode,
  screens: TreeNode[],
  logic: TreeNode | null = null,
): TreeNode[] {
  const perDevice = tagsPerDevice((outline.tags?.tags ?? []) as unknown as TagV1[]);
  const channels = outline.connections?.channels ?? [];
  const connChildren: TreeNode[] = channels.map((ch) => ({
    id: `channel:${ch.id}`,
    label: nonEmpty(ch.name) ? ch.name : ch.id,
    sub: channelSub(ch),
    icon: ch.kind === 's7' ? 'plc' : 'connection',
    editor: 'connections',
    count: ch.devices?.length ?? 0,
    children: (ch.devices ?? []).map((d) => ({
      id: `fdev:${d.id}`,
      label: nonEmpty(d.name) ? d.name : d.id,
      sub: deviceSub(ch, d),
      icon: 'device',
      editor: 'connections',
      count: perDevice.get(d.id) ?? 0,
    })),
  }));
  const connections: TreeNode = {
    id: 'connections',
    label: t('tree.connections'),
    icon: 'connection',
    editor: 'connections',
    count: channels.length,
    children: connChildren,
  };
  const calculated = ((outline.tags?.tags ?? []) as unknown as Array<{ kind?: string }>).filter(
    (x) => x.kind === 'calculated',
  ).length;
  const calc: TreeNode = {
    id: 'calc',
    label: t('tree.calc'),
    icon: 'fx',
    editor: 'calc',
    count: calculated,
  };
  const valueTables: TreeNode = {
    id: 'valueTables',
    label: t('tree.valueTables'),
    icon: 'list',
    editor: null,
    count: outline.valueTables.length,
    children: outline.valueTables.map((v) => ({
      id: `valuetable:${v.name}`,
      label: v.name,
      icon: 'list',
      editor: `vt:${v.name}`,
    })),
  };
  const watchTables: TreeNode = {
    id: 'watchTables',
    label: t('tree.watchTables'),
    icon: 'table',
    editor: null,
    count: outline.watchTables.length,
    children: outline.watchTables.map((w) => ({
      id: `watch:${w.id}`,
      label: nonEmpty(w.doc?.name) ? w.doc.name : w.id,
      icon: 'table',
      editor: `watch:${w.id}`,
      ...(w.doc ? { count: w.doc.rows?.length ?? 0 } : {}),
    })),
  };
  return [
    connections,
    {
      id: 'tagsFolder',
      label: t('tree.tags'),
      icon: 'tag',
      editor: null,
      children: [tags, calc],
    },
    valueTables,
    watchTables,
    { id: 'driverDiag', label: t('tree.driverDiag'), icon: 'check', editor: 'driverDiag' },
    alarm,
    logging,
    ...(logic ? [logic] : []),
    {
      id: 'screens',
      label: t('tree.screens'),
      icon: 'screen',
      editor: null,
      count: outline.screens.length,
      children: screens,
    },
    ...(outline.format10 ? [templatesNode(outline)] : []),
    outline.format06 ? reportsNode(outline) : phaseNode('reports', 'reports', 'tree.reports'),
    ...(outline.format10 ? [recipesNode(outline)] : []),
    usersNode(),
  ];
}

/** Feature 027: "Thiết lập thiết bị" (Online bằng administrator), con đầu tiên của nút thiết bị. */
function deviceSettingsNode(): TreeNode {
  return {
    id: 'deviceSettings',
    label: t('tree.deviceSettings'),
    icon: 'gear',
    editor: 'deviceSettings',
  };
}

function buildNodes(input: TreeInput): TreeNode {
  const { outline, device } = input;
  const project = outline.project;
  const name = project && nonEmpty(project.projectName) ? project.projectName : null;
  const entry = project?.entryScreen;

  const v03 = outline.schema === '0.3';
  const screenNodes: TreeNode[] = outline.screens.map((s) => {
    const name = v03 ? s.model?.name : s.screen?.name;
    const popup = v03 && s.model?.kind === 'popup';
    return {
      id: `screen:${s.id}`,
      label: nonEmpty(name) ? name : s.id,
      icon: popup ? 'popup' : 'screen',
      editor: `screen:${s.id}`,
      ...(s.id === entry
        ? { sub: t('tree.entryScreen') }
        : popup
          ? { sub: t('tree.popupScreen') }
          : {}),
    };
  });
  const navCount = (outline.navigation?.items ?? []).reduce(
    (n, it) => n + (Array.isArray(it.items) ? it.items.length : 1),
    0,
  );
  // Project 0.3: mục Điều hướng đứng đầu nhóm Màn hình.
  const screens: TreeNode[] = v03
    ? [
        {
          id: 'navigation',
          label: t('tree.navigation'),
          icon: 'menu',
          editor: 'navigation',
          count: navCount,
        },
        ...screenNodes,
      ]
    : screenNodes;

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
      ...(device.admin ? [deviceSettingsNode()] : []),
      ...((outline.version === '0.2'
        ? deviceChildren02(
            alarmNode(input),
            outline,
            tags,
            logging,
            screens,
            outline.format10 ? logicNode(input) : null,
          )
        : [
            phaseNode('connections', 'connections', 'tree.connections'),
            {
              id: 'tagsFolder',
              label: t('tree.tags'),
              icon: 'tag',
              editor: null,
              children: [tags, phaseNode('calc', 'calc', 'tree.calc')],
            },
            phaseNode('valueTables', 'valueTables', 'tree.valueTables'),
            alarmNode(input),
            logging,
            {
              id: 'screens',
              label: t('tree.screens'),
              icon: 'screen',
              editor: null,
              children: screens,
            },
            phaseNode('reports', 'reports', 'tree.reports'),
            usersNode(),
          ]) as TreeNode[]),
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
