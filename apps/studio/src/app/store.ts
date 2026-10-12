// Store của Studio (feature 004, T031, data-model §3–§8): trạng thái project đang mở và các hành động
// sửa, hoàn tác, kiểm tra liên tục, tab, lựa chọn, lưu và xử lý xung đột. Logic thuần, không DOM; giao
// diện (ui/*) đăng ký nghe và gọi hành động. Đọc/ghi file qua lớp platform (Rust hoặc bản giả e2e).
import {
  validateProject,
  type Issue,
  type LoadedProject,
  type ProjectSource,
  type ValidationResult,
} from '@mat/project-schema';
import type { Platform, ReadOutcome, RecentFailure, WriteFailure } from '../platform/types.ts';
import type { EditorId } from '../model/tree.ts';
import {
  applyDocEdits,
  filesOf,
  isDirty,
  loadDoc,
  markSaved,
  newPendingDoc,
  outlineOf,
  restoreSnapshot,
  snapshotOf,
  withPending,
  writeOrder,
  writtenText,
  type ProjectDoc,
  type ProjectDocs,
  type ProjectEdit,
  type ProjectOutline,
} from '../model/project-doc.ts';
import {
  canRedo,
  canUndo,
  createHistory,
  recordEdit,
  redoEdit,
  undoEdit,
  type EditHistory,
} from './history.ts';
import { EMPTY_CONTEXT, type CommandContext } from './commands.ts';

/** Chờ sau lần sửa cuối rồi mới kiểm (FR-017: kiểm liên tục mà không làm chậm việc gõ). */
export const VALIDATE_DELAY_MS = 250;

export type Selection =
  | { kind: 'tag'; row: number }
  | { kind: 'element'; screen: string; uid: string }
  | { kind: 'group'; index: number }
  | { kind: 'project' }
  | null;

export interface SaveError {
  rel: string;
  error: WriteFailure;
  detail?: string;
}

export type SaveResult =
  | { status: 'saved'; files: string[] }
  | { status: 'conflict'; rel: string }
  | ({ status: 'error' } & SaveError)
  | { status: 'cancelled' };

export interface StudioState {
  readonly project: { display: string } | null;
  readonly docs: ProjectDocs;
  /** Cấu trúc project đọc được từ các file (kể cả khi còn lỗi): cây, ánh xạ lỗi, "Dùng ở đâu". */
  readonly outline: ProjectOutline;
  /** Lỗi và cảnh báo của lần kiểm mới nhất đã áp. */
  readonly issues: readonly Issue[];
  /** Project đã nạp khi không còn lỗi (xem trước dùng). */
  readonly loaded: LoadedProject | null;
  /** Số thứ tự của lần kiểm đã áp. */
  readonly checkSeq: number;
  readonly checking: boolean;
  readonly history: EditHistory<string>;
  readonly tabs: readonly EditorId[];
  readonly active: EditorId;
  readonly selection: Selection;
  /** File đang xung đột khi lưu (bị sửa ngoài Studio), chờ người dùng chọn (data-model §6). */
  readonly conflict: { rel: string } | null;
  readonly lastSaveError: SaveError | null;
}

export interface StoreDeps {
  platform: Platform;
  validate?: (source: ProjectSource) => Promise<ValidationResult>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Phần ngữ cảnh lệnh do giao diện biết (focus, phiên thiết bị). */
export type UiContext = Partial<
  Pick<CommandContext, 'monitoring' | 'deviceAddressSet' | 'tagGridFocused' | 'cellRow'>
>;

const EMPTY_OUTLINE: ProjectOutline = outlineOf({});

const initialState = (): StudioState => ({
  project: null,
  docs: {},
  outline: EMPTY_OUTLINE,
  issues: [],
  loaded: null,
  checkSeq: 0,
  checking: false,
  history: createHistory<string>(),
  tabs: ['start'],
  active: 'start',
  selection: null,
  conflict: null,
  lastSaveError: null,
});

export class StudioStore {
  private s: StudioState = initialState();
  private readonly listeners = new Set<(s: StudioState) => void>();
  private readonly platform: Platform;
  private readonly validate: (source: ProjectSource) => Promise<ValidationResult>;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private timer: unknown = null;
  /** Số thứ tự của lần kiểm được yêu cầu gần nhất; kết quả của lần cũ hơn bị bỏ. */
  private requested = 0;
  private latest: Promise<void> = Promise.resolve();

  constructor(deps: StoreDeps) {
    this.platform = deps.platform;
    this.validate = deps.validate ?? ((source) => validateProject(source));
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get state(): StudioState {
    return this.s;
  }

  subscribe(listener: (s: StudioState) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(patch: Partial<StudioState>): void {
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l(this.s);
  }

  // ---------- Mở project ----------

  /** Hộp thoại chọn thư mục; `false` khi người dùng hủy. Kiểm tra chạy nền, xem `idle()`. */
  async openProject(): Promise<boolean> {
    const picked = await this.platform.pickProject();
    if (!picked) return false;
    await this.load(picked.display);
    return true;
  }

  /** Đóng project: về trạng thái ban đầu; kết quả kiểm của project cũ còn chạy thì bị bỏ. */
  closeProject(): void {
    this.cancelTimer();
    this.requested++;
    this.s = initialState();
    this.set({});
  }

  /**
   * Mở project mà phía Rust vừa đặt làm thư mục project (Đọc lên thành project mới, `package_extract`): không hiện
   * hộp thoại chọn thư mục. Kiểm tra chạy nền, xem `idle()`.
   */
  async openPicked(display: string): Promise<void> {
    await this.load(display);
  }

  async openRecent(index: number): Promise<true | { error: RecentFailure }> {
    const r = await this.platform.openRecent(index);
    if ('error' in r) return r;
    await this.load(r.display);
    return true;
  }

  private async load(display: string): Promise<void> {
    this.cancelTimer();
    const docs = await this.readReferenced({}, new Set());
    this.requested++; // bỏ kết quả kiểm của project trước nếu còn chạy
    this.s = { ...initialState(), project: { display } };
    this.set({ docs, outline: outlineOf(filesOf(docs)) });
    void this.runValidate();
  }

  /**
   * Đọc các file project tham chiếu mà `docs` chưa có (trừ file trong `skip`): project.json, file Tag,
   * file lưu trữ, rồi màn hình, binding, SVG. File không đọc được thì bỏ qua: bộ kiểm tra tự đọc lại và
   * báo cùng mã lỗi với runtime.
   */
  private async readReferenced(
    start: Record<string, ProjectDoc>,
    skip: ReadonlySet<string>,
  ): Promise<Record<string, ProjectDoc>> {
    const docs = { ...start };
    const read = async (rel: string | null | undefined) => {
      if (!rel || docs[rel] || skip.has(rel)) return;
      const r = await this.platform.read(rel);
      if ('text' in r) docs[rel] = loadDoc(rel, r.text, r.hash, false);
    };
    await read('project.json');
    let outline = outlineOf(filesOf(docs));
    await read(outline.tagFile);
    await read(outline.loggingFile);
    for (const s of outline.screens) await read(s.file);
    outline = outlineOf(filesOf(docs));
    for (const s of outline.screens) {
      await read(s.bindingFile);
      await read(s.screen?.svgFile);
    }
    return this.withEditable(docs);
  }

  /** Chỉ project.json và file Tag sửa được (data-model §3.1). */
  private withEditable(docs: Record<string, ProjectDoc>): Record<string, ProjectDoc> {
    const tagFile = outlineOf(filesOf(docs)).tagFile;
    const out: Record<string, ProjectDoc> = {};
    for (const [rel, doc] of Object.entries(docs)) {
      const editable = (rel === 'project.json' || rel === tagFile) && doc.value !== null;
      out[rel] = doc.editable === editable ? doc : { ...doc, editable };
    }
    return out;
  }

  // ---------- Sửa, hoàn tác ----------

  edit(edits: readonly ProjectEdit[], mergeKey?: string): void {
    if (!this.s.project || edits.length === 0) return;
    const before = snapshotOf(this.s.docs);
    const docs = applyDocEdits(this.s.docs, edits);
    if (snapshotOf(docs) === before) return;
    const history = recordEdit(this.s.history, before, this.now(), mergeKey);
    this.set({ docs, history, outline: outlineOf(filesOf(docs)) });
    this.scheduleValidate();
  }

  /**
   * Áp một thay đổi lấy từ nơi khác (So sánh › Đọc lên phần chọn, feature 005, FR-030) thành MỘT bước hoàn tác:
   * `edits` sửa project.json và file Tag theo đối tượng; `replace` thay cả file (đường dẫn → nội dung mới) thành
   * "nội dung chờ ghi", kể cả file chưa có trên máy. Chưa lưu cho tới khi Lưu.
   */
  applyChange(change: {
    edits?: readonly ProjectEdit[];
    replace?: Readonly<Record<string, string>>;
  }): void {
    if (!this.s.project) return;
    const before = snapshotOf(this.s.docs);
    let docs: Record<string, ProjectDoc> = change.edits?.length
      ? applyDocEdits(this.s.docs, change.edits)
      : { ...this.s.docs };
    for (const [rel, text] of Object.entries(change.replace ?? {})) {
      const doc = docs[rel];
      if (!doc) docs[rel] = newPendingDoc(rel, text);
      else if (!doc.editable)
        docs[rel] =
          text === doc.diskText && doc.pending === undefined ? doc : withPending(doc, text);
    }
    docs = this.withEditable(docs);
    if (snapshotOf(docs) === before) return;
    const history = recordEdit(this.s.history, before, this.now());
    this.set({ docs, history, outline: outlineOf(filesOf(docs)) });
    this.scheduleValidate();
  }

  undo(): void {
    const step = undoEdit(this.s.history, snapshotOf(this.s.docs));
    if (step) this.restore(step.snapshot, step.history);
  }

  redo(): void {
    const step = redoEdit(this.s.history, snapshotOf(this.s.docs));
    if (step) this.restore(step.snapshot, step.history);
  }

  private restore(snapshot: string, history: EditHistory<string>): void {
    const docs = restoreSnapshot(this.s.docs, snapshot);
    this.set({ docs, history, outline: outlineOf(filesOf(docs)) });
    this.scheduleValidate();
  }

  dirtyFiles(): string[] {
    return writeOrder(this.s.docs).map((d) => d.rel);
  }

  /** Nội dung bộ kiểm tra thấy: tài liệu chưa lưu là chuỗi sẽ ghi, còn lại là nội dung trên đĩa. */
  textOf(rel: string, docs: ProjectDocs = this.s.docs): string {
    const doc = docs[rel];
    if (!doc) return '';
    return isDirty(doc) ? writtenText(doc) : doc.diskText;
  }

  // ---------- Kiểm tra liên tục (FR-017) ----------

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private scheduleValidate(): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.runValidate();
    }, VALIDATE_DELAY_MS);
  }

  private runValidate(): Promise<void> {
    const seq = ++this.requested;
    const docs = this.s.docs;
    const source: ProjectSource = {
      read: async (rel): Promise<ReadOutcome | { text: string }> =>
        docs[rel] ? { text: this.textOf(rel, docs) } : this.platform.read(rel),
    };
    this.set({ checking: true });
    const run = this.validate(source).then(
      (r) => {
        if (seq !== this.requested) return;
        this.set({
          issues: [...r.errors, ...r.warnings],
          loaded: r.project ?? null,
          checkSeq: seq,
          checking: false,
        });
      },
      () => {
        if (seq === this.requested) this.set({ checking: false });
      },
    );
    this.latest = run;
    return run;
  }

  /** Chờ lần kiểm được yêu cầu gần nhất chạy xong. */
  async idle(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.latest;
      await seen;
    } while (seen !== this.latest);
  }

  /** F7: đọc lại các file chưa sửa trên đĩa, đọc file mới được tham chiếu, rồi kiểm toàn bộ ngay. */
  async validateNow(): Promise<void> {
    if (!this.s.project) return;
    this.cancelTimer();
    const kept: Record<string, ProjectDoc> = {};
    const dropped = new Set<string>();
    for (const [rel, doc] of Object.entries(this.s.docs)) {
      if (isDirty(doc)) {
        kept[rel] = doc;
        continue;
      }
      const r = await this.platform.read(rel);
      if (!('text' in r)) {
        dropped.add(rel);
        continue;
      }
      kept[rel] =
        r.text === doc.diskText && r.hash === doc.diskHash
          ? doc
          : loadDoc(rel, r.text, r.hash, false);
    }
    const docs = await this.readReferenced(kept, dropped);
    this.set({ docs, outline: outlineOf(filesOf(docs)) });
    await this.runValidate();
  }

  // ---------- Tab, lựa chọn ----------

  openTab(id: EditorId): void {
    const tabs = this.s.tabs.includes(id) ? this.s.tabs : [...this.s.tabs, id];
    this.set({ tabs, active: id });
  }

  activate(id: EditorId): void {
    if (this.s.tabs.includes(id)) this.set({ active: id });
  }

  /** Bắt đầu không đóng được; đóng tab đang chọn thì chọn tab bên trái. */
  closeTab(id: EditorId): void {
    if (id === 'start') return;
    const i = this.s.tabs.indexOf(id);
    if (i < 0) return;
    const tabs = this.s.tabs.filter((t) => t !== id);
    const active = this.s.active === id ? tabs[Math.max(0, i - 1)] : this.s.active;
    this.set({ tabs, active });
  }

  select(selection: Selection): void {
    this.set({ selection });
  }

  // ---------- Lưu, xung đột (data-model §6) ----------

  async save(): Promise<SaveResult> {
    if (this.s.conflict) return { status: 'conflict', rel: this.s.conflict.rel };
    const files: string[] = [];
    for (const doc of writeOrder(this.s.docs)) {
      const r = await this.writeDoc(doc.rel, false);
      if (r.status !== 'saved') return r;
      files.push(doc.rel);
    }
    return { status: 'saved', files };
  }

  async resolveConflict(choice: 'overwrite' | 'reload' | 'cancel'): Promise<SaveResult> {
    const conflict = this.s.conflict;
    if (!conflict) return this.save();
    this.set({ conflict: null });
    if (choice === 'cancel') return { status: 'cancelled' };
    if (choice === 'reload') {
      const r = await this.platform.read(conflict.rel);
      if ('text' in r) {
        const docs = this.withEditable({
          ...this.s.docs,
          [conflict.rel]: loadDoc(conflict.rel, r.text, r.hash, false),
        });
        this.set({ docs, outline: outlineOf(filesOf(docs)) });
        this.scheduleValidate();
      }
      return this.save();
    }
    const forced = await this.writeDoc(conflict.rel, true);
    if (forced.status !== 'saved') return forced;
    const rest = await this.save();
    return rest.status === 'saved'
      ? { status: 'saved', files: [conflict.rel, ...rest.files] }
      : rest;
  }

  private async writeDoc(rel: string, force: boolean): Promise<SaveResult> {
    const doc = this.s.docs[rel];
    const content = writtenText(doc);
    const res = await this.platform.write(rel, content, doc.diskHash, force);
    if ('hash' in res) {
      const current = this.s.docs[rel];
      this.set({
        docs: { ...this.s.docs, [rel]: markSaved(current, content, res.hash) },
        lastSaveError: null,
      });
      return { status: 'saved', files: [rel] };
    }
    if (res.error === 'changed') {
      this.set({ conflict: { rel } });
      return { status: 'conflict', rel };
    }
    const error: SaveError =
      res.detail === undefined
        ? { rel, error: res.error }
        : { rel, error: res.error, detail: res.detail };
    this.set({ lastSaveError: error });
    return { status: 'error', ...error };
  }

  // ---------- Ngữ cảnh lệnh ----------

  commandContext(ui: UiContext = {}): CommandContext {
    const open = this.s.project !== null;
    return {
      ...EMPTY_CONTEXT,
      hasProject: open,
      dirty: open && this.dirtyFiles().length > 0,
      canUndo: canUndo(this.s.history),
      canRedo: canRedo(this.s.history),
      errorCount: this.s.issues.filter((i) => i.code.startsWith('E_')).length,
      activeEditor: open ? this.s.active : null,
      ...ui,
    };
  }
}
