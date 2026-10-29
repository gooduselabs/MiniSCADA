// Trạng thái làm việc của editor Logic (feature 011, T144): nhóm đang mở (`app.logicKind`, đổi từ cây), khối đang chọn mỗi
// nhóm, tìm, chỉ dòng lỗi, tab của khung dưới (Thông tin / Thử logic), kết quả kiểm khi gõ (validator TS, ghi nhớ theo tài
// liệu), trạng thái `GET /api/v1/logic` của thiết bị khi Online (hỏi mỗi 3 s khi editor đang mở). Không chứa chuỗi giao diện.
import type { Issue, LogicDoc, TagV1 } from '@mat/project-schema';
import { APP_EXTENSIONS, type StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import { deviceSupport, type LogicStatus } from '../../model/device.ts';
import { isDeviceError } from '../../platform/device-types.ts';
import {
  LOGIC_KINDS,
  addBlock,
  blocksOf,
  checkLogicDoc,
  issueTarget,
  removeBlock,
  type IssueTarget,
  type LogicKind,
} from '../../model/logic-doc.ts';
import {
  placeNodes,
  renameLayoutNode,
  type LogicLayoutDoc,
  type NodePos,
} from '../../model/logic-layout.ts';
import { LogicSim } from '../../model/logic-sim.ts';

export const LIVE_POLL_MS = 3000;

export interface LogicUi {
  sel: Partial<Record<LogicKind, string>>;
  search: string;
  onlyErr: boolean;
  dockTab: 'info' | 'test';
  menu: boolean;
  chipMenu: boolean;
  /** Lỗi của ô Id (đổi id bị từ chối). */
  idMsg: { id: string; reason: 'format' | 'duplicate' } | null;
  /** Ô cần focus sau khi nhảy từ danh sách lỗi. */
  focus: { id: string; field: string | null } | null;
  live: LogicStatus | null;
  liveAt: number;
  liveTimer: ReturnType<typeof setInterval> | null;
  liveBusy: boolean;
  check: { doc: LogicDoc | null; key: string; issues: Issue[] } | null;
  /** Chiều cao khung dưới trước khi editor Logic nâng lên. */
  savedHeight: number | null;
  /** Lỗi mà F8 / Shift+F8 vừa nhảy tới (chỉ số trong danh sách có vị trí), -1 khi chưa nhảy. */
  issueCursor: number;
  /** Khung nhìn: Luật (thẻ, mặc định, feature 043), Sơ đồ hoặc Bảng (Nâng cao, feature 015). */
  view: LogicView;
  /** Nút Tag/Tag đích đang chọn trên sơ đồ (khối chọn theo `sel`). */
  dsel: string | null;
  /** Nhóm nút chọn trên sơ đồ (Shift+bấm, khung chọn); rỗng: chỉ khối chính. */
  dmulti: string[];
  /** Phóng và dời của sơ đồ (null: vừa khung ở lần vẽ đầu). */
  dview: { z: number; tx: number; ty: number } | null;
  /** Bộ chạy Thử logic dùng chung giữa bảng Thử logic và sơ đồ (tạo lại khi logic.json đổi). */
  sim: LogicSim | null;
  simDoc: unknown;
  simListeners: Set<() => void>;
}

export type LogicView = 'cards' | 'diagram' | 'table';
const VIEW_KEY = 'mat-studio.logic-view';

function readView(): LogicView {
  try {
    // Feature 043: mặc định là "Luật" (thẻ dạng câu); Sơ đồ và Bảng là chế độ Nâng cao.
    const v = globalThis.localStorage?.getItem(VIEW_KEY);
    return v === 'table' || v === 'diagram' ? v : 'cards';
  } catch {
    return 'cards';
  }
}

const states = new WeakMap<StudioApp, LogicUi>();

export function logicUi(app: StudioApp): LogicUi {
  let s = states.get(app);
  if (!s) {
    s = {
      sel: {},
      search: '',
      onlyErr: false,
      dockTab: 'info',
      menu: false,
      chipMenu: false,
      idMsg: null,
      focus: null,
      live: null,
      liveAt: 0,
      liveTimer: null,
      liveBusy: false,
      check: null,
      savedHeight: null,
      issueCursor: -1,
      view: readView(),
      dsel: null,
      dmulti: [],
      dview: null,
      sim: null,
      simDoc: null,
      simListeners: new Set(),
    };
    states.set(app, s);
  }
  return s;
}

export const isKind = (k: string): k is LogicKind => (LOGIC_KINDS as readonly string[]).includes(k);

export function kindOf(app: StudioApp): LogicKind {
  return isKind(app.logicKind) ? app.logicKind : 'rule';
}

export function setKind(app: StudioApp, kind: LogicKind): void {
  app.logicKind = kind;
  logicUi(app).menu = false;
  // Cây chọn theo nhóm đang mở (nút `logic:<nhóm>`).
  if (app.ui.treeSel?.startsWith('logic') && app.ui.treeSel !== `logic:${kind}`)
    app.revealNode(`logic:${kind}`);
  app.requestRender();
}

/** Chiều cao khung dưới cần cho Inspector (mockup: 288 px) và cho Thử logic (đường thời gian). */
export const DOCK_HEIGHT = { info: 300, test: 460, testDiagram: 380, testMin: 200 } as const;
/** Phần vùng giữa dành cho vùng vẽ của sơ đồ khi Thử logic (feature 015: ≥ 55 %). */
export const DIAGRAM_SHARE = 0.55;

/**
 * Chiều cao khung dưới cho Thử logic. Bảng: 460 px. Sơ đồ (feature 015): sao cho vùng vẽ còn ≥ DIAGRAM_SHARE chiều cao vùng
 * giữa (đo phần khung của editor: thanh tab, thanh công cụ, dòng đếm), không thấp hơn `testMin`, không cao hơn 380 px.
 */
export function testDockHeight(app: StudioApp): number {
  if (logicUi(app).view !== 'diagram') return DOCK_HEIGHT.test;
  const center = dims().centerHeight;
  if (center <= 0) return DOCK_HEIGHT.testDiagram;
  const view = document
    .querySelector('mat-logic-diagram .lgd-view')
    ?.getBoundingClientRect().height;
  const dock = app.workspace.inspectorCollapsed ? 32 : app.workspace.inspectorHeight;
  const chrome = view !== undefined ? center - view - dock : 140;
  const fit = Math.floor(center * (1 - DIAGRAM_SHARE) - chrome) - 8; // 8 px dư cho làm tròn
  return Math.max(DOCK_HEIGHT.testMin, Math.min(DOCK_HEIGHT.testDiagram, fit));
}

function dims(): { leftColumnHeight: number; centerHeight: number } {
  if (typeof document === 'undefined') return { leftColumnHeight: 0, centerHeight: 0 };
  return {
    leftColumnHeight: document.querySelector('.left')?.getBoundingClientRect().height ?? 0,
    centerHeight: document.querySelector('.center')?.getBoundingClientRect().height ?? 0,
  };
}

/** Nâng khung dưới lên ít nhất `h` px khi editor Logic mở (nhớ chiều cao cũ để trả lại khi rời editor). */
export function ensureDockHeight(app: StudioApp, h: number): void {
  const ui = logicUi(app);
  const cur = app.workspace.inspectorHeight;
  // khung đang gập theo ý người dùng: không tự mở (feature 015)
  if (cur >= h || app.workspace.inspectorCollapsed) return;
  if (ui.savedHeight === null) ui.savedHeight = cur;
  app.setLayout({ inspectorHeight: h }, dims());
}

/** Trả lại chiều cao khung dưới trước khi editor Logic nâng lên (`keepAtLeast`: vẫn giữ tối thiểu ngần này). */
export function restoreDockHeight(app: StudioApp, keepAtLeast = 0): void {
  const ui = logicUi(app);
  if (ui.savedHeight === null) return;
  const h = Math.max(ui.savedHeight, keepAtLeast);
  if (keepAtLeast === 0) ui.savedHeight = null;
  if (app.workspace.inspectorHeight !== h) app.setLayout({ inspectorHeight: h }, dims());
}

export function setDockTab(app: StudioApp, tab: 'info' | 'test'): void {
  const ui = logicUi(app);
  ui.dockTab = tab;
  if (tab === 'test') {
    app.setInspectorCollapsed(false);
    const h = testDockHeight(app);
    if (ui.view === 'diagram') {
      // Sơ đồ: đặt đúng chiều cao để vùng vẽ còn ≥ 55 % (có thể thấp hơn hiện tại)
      const cur = app.workspace.inspectorHeight;
      if (cur !== h) {
        if (ui.savedHeight === null) ui.savedHeight = cur;
        app.setLayout({ inspectorHeight: h }, dims());
      }
    } else ensureDockHeight(app, h);
  } else restoreDockHeight(app, DOCK_HEIGHT.info);
  app.requestRender();
}

export const logicDoc = (app: StudioApp): LogicDoc | null => app.store.state.outline.logic;

/** Tag v1 của project (định dạng 1.0 luôn là Tag v1). */
export const projectTags = (app: StudioApp): TagV1[] =>
  (app.store.state.outline.tags?.tags ?? []) as unknown as TagV1[];

export const tableNames = (app: StudioApp): string[] =>
  app.store.state.outline.valueTables.map((v) => v.name);

/**
 * Một lần sửa logic.json = một bước hoàn tác (`merge`: gộp các lần gõ liên tiếp của cùng một ô). `layout`: vị trí của
 * sơ đồ đổi cùng lúc (thêm khối ở chỗ thả, đổi id, xóa), vẫn một bước.
 */
export function editLogic(
  app: StudioApp,
  doc: LogicDoc,
  merge?: string,
  layout?: LogicLayoutDoc,
): void {
  if (layout && layout !== logicLayout(app))
    app.store.edit(
      [
        {
          kind: 'batch',
          edits: [
            { kind: 'logicSet', doc },
            { kind: 'logicLayoutSet', doc: layout },
          ],
        },
      ],
      merge,
    );
  else app.store.edit([{ kind: 'logicSet', doc }], merge);
}

/** Vị trí của sơ đồ (tệp phụ `<logic>.layout.json`; feature 015). */
export const logicLayout = (app: StudioApp): LogicLayoutDoc => app.store.state.outline.logicLayout;

/** Chỉ đổi vị trí (kéo khối, mũi tên, Tự sắp xếp): một bước hoàn tác (`merge` gộp các lần dịch liên tiếp). */
export function editLayout(app: StudioApp, layout: LogicLayoutDoc, merge?: string): void {
  app.store.edit([{ kind: 'logicLayoutSet', doc: layout }], merge);
}

/** Đổi id khối (Inspector): vị trí trên sơ đồ đi theo id mới, cùng một bước. */
export function editLogicRenamed(app: StudioApp, doc: LogicDoc, from: string, to: string): void {
  editLogic(app, doc, undefined, renameLayoutNode(logicLayout(app), from, to));
}

/** Xóa khối (Delete, nút Xóa, sơ đồ): vị trí của nó bị bỏ cùng một bước. */
export function removeLogicBlock(app: StudioApp, kind: LogicKind, id: string): void {
  const doc = logicDoc(app);
  if (!doc) return;
  const layout = logicLayout(app);
  editLogic(
    app,
    removeBlock(doc, kind, id),
    undefined,
    layout.nodes[id] ? placeNodes(layout, { [id]: null }) : undefined,
  );
}

export function setView(app: StudioApp, view: LogicView): void {
  logicUi(app).view = view;
  try {
    globalThis.localStorage?.setItem(VIEW_KEY, view);
  } catch {
    // không lưu được (chế độ riêng tư): chỉ nhớ trong phiên
  }
  app.requestRender();
}

// ---------- Thử logic dùng chung (bảng Thử logic và sơ đồ; feature 015) ----------

/** Bộ chạy của tài liệu hiện tại (tạo lại khi logic.json đổi); null khi chưa có logic. */
export function logicSim(app: StudioApp): LogicSim | null {
  const doc = logicDoc(app);
  const ui = logicUi(app);
  if (!doc) return null;
  if (ui.simDoc !== doc || !ui.sim) {
    ui.sim = new LogicSim({ doc, tags: projectTags(app) });
    ui.simDoc = doc;
  }
  return ui.sim;
}

/** Bảng Thử logic vừa chạy hay đổi bộ chạy: báo sơ đồ vẽ lại giá trị. */
export function simChanged(app: StudioApp): void {
  for (const fn of logicUi(app).simListeners) fn();
}

export function onSimChange(app: StudioApp, fn: () => void): () => void {
  const set = logicUi(app).simListeners;
  set.add(fn);
  return () => void set.delete(fn);
}

/** Khối đang chọn của nhóm (mặc định khối đầu). */
export function selectedId(app: StudioApp, kind = kindOf(app)): string | null {
  const list = blocksOf(logicDoc(app), kind);
  const want = logicUi(app).sel[kind];
  return list.find((b) => b.id === want)?.id ?? list[0]?.id ?? null;
}

export function select(app: StudioApp, kind: LogicKind, id: string | null): void {
  const ui = logicUi(app);
  if (id === null) delete ui.sel[kind];
  else ui.sel[kind] = id;
  ui.idMsg = null;
  ui.dsel = null;
  ui.dmulti = [];
  app.requestRender();
}

/** Ghi PLC của thiết bị đích khi Online (cho W_LOGIC_WRITES_OFF). */
export function deviceWrites(app: StudioApp): 'on' | 'off' | undefined {
  if (!app.online() || app.session.mode !== 'online') return undefined;
  const s = deviceSupport(app.session.info);
  if (!s.logic) return undefined;
  return s.logicWrites === 'off' ? 'off' : 'on';
}

/** Lỗi và cảnh báo của logic.json theo validator TS, tính ngay trên tài liệu đang sửa (ghi nhớ theo tài liệu). */
export function logicIssues(app: StudioApp): Issue[] {
  const doc = logicDoc(app);
  const ui = logicUi(app);
  const dw = deviceWrites(app);
  const tags = projectTags(app);
  const key = `${dw ?? ''}|${tags.length}`;
  if (ui.check && ui.check.doc === doc && ui.check.key === key) return ui.check.issues;
  let issues: Issue[] = [];
  if (doc) {
    const r = checkLogicDoc(doc, {
      tags,
      tables: tableNames(app),
      ...(dw ? { deviceWrites: dw } : {}),
    });
    const file = app.store.state.outline.logicFile ?? 'logic.json';
    issues = [...r.errors, ...r.warnings].map((i) => ({ ...i, file }));
  }
  ui.check = { doc, key, issues };
  return issues;
}

export interface LocatedIssue {
  issue: Issue;
  target: IssueTarget | null;
}

export function locatedIssues(app: StudioApp): LocatedIssue[] {
  const doc = logicDoc(app);
  return logicIssues(app).map((issue) => ({ issue, target: issueTarget(doc, issue.path) }));
}

/** Nhảy tới khối và ô của một lỗi (nhấp đúp ở Thông tin, F8). */
export function jumpToIssue(app: StudioApp, li: LocatedIssue): void {
  const tg = li.target;
  if (!tg) return;
  setKind(app, tg.kind);
  if (tg.id) select(app, tg.kind, tg.id);
  logicUi(app).focus = tg.id ? { id: tg.id, field: tg.field } : null;
  app.requestRender();
}

/**
 * F8 / Shift+F8 (T144): tới lỗi kế / trước có vị trí trong logic.json, vòng lại đầu / cuối. Chạy được ở bất kỳ đâu khi tab
 * Logic đang mở (lệnh `logic.nextIssue`), không chỉ khi focus ở danh sách lỗi.
 */
export function stepIssue(app: StudioApp, dir: 1 | -1): void {
  const list = locatedIssues(app).filter((l) => l.target !== null);
  const ui = logicUi(app);
  if (list.length === 0) {
    ui.issueCursor = -1;
    app.toast(t('logic.info.noneToast'));
    return;
  }
  const cur = ui.issueCursor >= list.length ? -1 : ui.issueCursor;
  const i = cur < 0 ? (dir > 0 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
  ui.issueCursor = i;
  const li = list[i]!;
  jumpToIssue(app, li);
  app.toast(t('logic.info.at', { i: i + 1, n: list.length, code: li.issue.code }));
}

APP_EXTENSIONS.logicIssue = stepIssue;

/**
 * Thêm khối mới vào nhóm (sau khối đang chọn nếu cùng nhóm), chọn nó và focus ô Id. Thanh công cụ, Insert, task card.
 * `at`: vị trí trên sơ đồ (thả từ task card), ghi cùng một bước hoàn tác.
 */
export function addLogicBlock(app: StudioApp, kind: LogicKind, at?: NodePos): boolean {
  const doc = logicDoc(app);
  if (!doc || app.store.state.readOnly) return false;
  const after = kindOf(app) === kind ? (selectedId(app, kind) ?? undefined) : undefined;
  const r = addBlock(doc, kind, after ? { after } : {});
  logicUi(app).menu = false;
  logicUi(app).dsel = null;
  editLogic(app, r.doc, undefined, at ? placeNodes(logicLayout(app), { [r.id]: at }) : undefined);
  setKind(app, kind);
  select(app, kind, r.id);
  logicUi(app).focus = { id: r.id, field: 'id' };
  return true;
}

/** Mã lỗi (E_) và cảnh báo (W_) theo ô `id|field` để tô bảng. */
export function cellMarks(app: StudioApp): Map<string, 'e' | 'w'> {
  const out = new Map<string, 'e' | 'w'>();
  for (const { issue, target } of locatedIssues(app)) {
    if (!target?.id) continue;
    const key = `${target.id}|${target.field ?? 'id'}`;
    const sev = issue.code.startsWith('W_') ? 'w' : 'e';
    if (out.get(key) !== 'e') out.set(key, sev);
  }
  return out;
}

// ---------- Trạng thái trên thiết bị (GET /logic) ----------

export function liveOnline(app: StudioApp): boolean {
  return app.online() && app.session.mode === 'online' && deviceSupport(app.session.info).logic;
}

async function pollLive(app: StudioApp): Promise<void> {
  const ui = logicUi(app);
  if (ui.liveBusy || !liveOnline(app)) return;
  ui.liveBusy = true;
  try {
    const r = await app.session.logicStatus();
    ui.live = isDeviceError(r) ? null : r;
    ui.liveAt = Date.now();
  } finally {
    ui.liveBusy = false;
  }
  app.requestRender();
}

/** Editor Logic mở: hỏi trạng thái thiết bị ngay và mỗi LIVE_POLL_MS khi Online. */
export function startLive(app: StudioApp): void {
  const ui = logicUi(app);
  if (ui.liveTimer !== null) return;
  void pollLive(app);
  ui.liveTimer = setInterval(() => {
    if (!liveOnline(app)) {
      if (ui.live) {
        ui.live = null;
        app.requestRender();
      }
      return;
    }
    void pollLive(app);
  }, LIVE_POLL_MS);
}

export function stopLive(app: StudioApp): void {
  const ui = logicUi(app);
  if (ui.liveTimer !== null) clearInterval(ui.liveTimer);
  ui.liveTimer = null;
}

/** Hỏi lại ngay (sau khi dừng ghi, đặt lại khối). */
export function refreshLive(app: StudioApp): void {
  void pollLive(app);
}

/** Gập/mở khung dưới (nút trên dải tab của khung, Ctrl+J trong tab Logic); chiều cao được nhớ (feature 015). */
export function toggleDock(app: StudioApp): void {
  app.setInspectorCollapsed(!app.workspace.inspectorCollapsed);
}
