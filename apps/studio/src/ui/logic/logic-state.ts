// Trạng thái làm việc của editor Logic (feature 011, T144): nhóm đang mở (`app.logicKind`, đổi từ cây), khối đang chọn mỗi
// nhóm, tìm, chỉ dòng lỗi, tab của khung dưới (Thông tin / Thử logic), kết quả kiểm khi gõ (validator TS, ghi nhớ theo tài
// liệu), trạng thái `GET /api/v1/logic` của thiết bị khi Online (hỏi mỗi 3 s khi editor đang mở). Không chứa chuỗi giao diện.
import type { Issue, LogicDoc, TagV1 } from '@mat/project-schema';
import type { StudioApp } from '../../app/app.ts';
import { deviceSupport, type LogicStatus } from '../../model/device.ts';
import { isDeviceError } from '../../platform/device-types.ts';
import {
  LOGIC_KINDS,
  blocksOf,
  checkLogicDoc,
  issueTarget,
  type IssueTarget,
  type LogicKind,
} from '../../model/logic-doc.ts';

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
export const DOCK_HEIGHT = { info: 300, test: 460 } as const;

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
  if (cur >= h) return;
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
  if (tab === 'test') ensureDockHeight(app, DOCK_HEIGHT.test);
  else restoreDockHeight(app, DOCK_HEIGHT.info);
  app.requestRender();
}

export const logicDoc = (app: StudioApp): LogicDoc | null => app.store.state.outline.logic;

/** Tag v1 của project (định dạng 1.0 luôn là Tag v1). */
export const projectTags = (app: StudioApp): TagV1[] =>
  (app.store.state.outline.tags?.tags ?? []) as unknown as TagV1[];

export const tableNames = (app: StudioApp): string[] =>
  app.store.state.outline.valueTables.map((v) => v.name);

/** Một lần sửa logic.json = một bước hoàn tác (`merge`: gộp các lần gõ liên tiếp của cùng một ô). */
export function editLogic(app: StudioApp, doc: LogicDoc, merge?: string): void {
  app.store.edit([{ kind: 'logicSet', doc }], merge);
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
