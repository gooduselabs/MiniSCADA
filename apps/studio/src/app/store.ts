// Store của Studio (feature 004, T031, data-model §3–§8): trạng thái project đang mở và các hành động
// sửa, hoàn tác, kiểm tra liên tục, tab, lựa chọn, lưu và xử lý xung đột. Logic thuần, không DOM; giao
// diện (ui/*) đăng ký nghe và gọi hành động. Đọc/ghi file qua lớp platform (Rust hoặc bản giả e2e).
import {
  migrate01to02,
  migrateTo03,
  migrateTo04,
  migrateTo05,
  migrateTo06,
  migrateTo10,
  migrateTo11,
  stripBom,
  validateProject,
  type Issue,
  type LoadedProject,
  type LoadedProject02,
  type LoadedProject03,
  type LoadedProject05,
  type MigrateError,
  type ProjectSource,
  type ValidationResult,
} from '@mat/project-schema';
import type {
  BackupOutcome,
  Platform,
  ReadOutcome,
  RecentFailure,
  WriteFailure,
} from '../platform/types.ts';
import { cleanSvgFiles, type UpgradeChange } from '../model/svg-upgrade.ts';
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
  withEditable,
  withPending,
  withValue,
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
export const VALIDATE_DELAY_MS = 150;

export type Selection =
  | { kind: 'tag'; row: number }
  | { kind: 'element'; screen: string; uid: string }
  | { kind: 'group'; index: number }
  /** Item đang chọn ở editor Màn hình 0.3 (feature 007). */
  | { kind: 'items'; screen: string; ids: readonly string[] }
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
  /** Sao lưu bản 0.1 trước lần lưu đầu sau khi nâng cấp không được: không ghi gì (contract tauri-commands-006 §5). */
  | {
      status: 'backup-failed';
      error: 'exists' | 'bad-path' | 'no-project' | 'changed' | 'io';
      detail?: string;
    }
  | { status: 'cancelled' };

/** Project 0.1 đã nâng cấp trong bộ nhớ, chờ lưu (FR-004). */
export interface UpgradeState {
  /** Phiên bản gốc (`schemaVersion` của project.json 0.1), nhãn thư mục sao lưu. */
  from: string;
  /** Các file sẽ được sao lưu (đã viết lại), kèm hash lúc đọc. */
  files: { rel: string; hash: string }[];
  /** Thư mục sao lưu sau lần lưu đầu; `null` khi chưa lưu. */
  backup: { dir: string; abs: string } | null;
}

/** Kế hoạch nâng cấp: như `MigrateResult` nhưng `changes` có thêm việc làm sạch SVG. */
export type UpgradePlan =
  | {
      ok: true;
      files: Record<string, string>;
      changes: UpgradeChange[];
      backup: string[];
    }
  | { ok: false; error: MigrateError };

export type UpgradeOutcome =
  | { ok: true; changes: UpgradeChange[] }
  | { ok: false; error: MigrateError | { code: 'NO_PROJECT' } };

export interface StudioState {
  readonly project: { display: string } | null;
  readonly docs: ProjectDocs;
  /** Cấu trúc project đọc được từ các file (kể cả khi còn lỗi): cây, ánh xạ lỗi, "Dùng ở đâu". */
  readonly outline: ProjectOutline;
  /** Lỗi và cảnh báo của lần kiểm mới nhất đã áp. */
  readonly issues: readonly Issue[];
  /** Project 0.3 đã nạp khi không còn lỗi (xem trước, kiểm màn hình dùng). */
  readonly loaded03: LoadedProject03 | null;
  /** Project 0.5 đã nạp khi không còn lỗi (alarm: thử, xem trước dùng). */
  readonly loaded05: LoadedProject05 | null;
  /** Project 0.1 đã nạp khi không còn lỗi (xem trước dùng). */
  readonly loaded: LoadedProject | null;
  /** Project 0.2 đã nạp khi không còn lỗi (Mô phỏng, xem trước, Tag tính toán dùng). */
  readonly loaded02: LoadedProject02 | null;
  /** Project 0.1 vừa mở, chờ người dùng chọn Nâng cấp / Mở chỉ đọc / Hủy (FR-003). */
  readonly pendingUpgrade: boolean;
  /** Kế hoạch nâng cấp (`migrate01to02` trong bộ nhớ) của project 0.1 đang chờ chọn; `null` khi chưa tính xong. */
  readonly upgradePlan: UpgradePlan | null;
  /** Đã nâng cấp trong bộ nhớ: chưa lưu hoặc vừa lưu (còn thông tin thư mục sao lưu). */
  readonly upgrade: UpgradeState | null;
  /** Project 0.1 mở chỉ đọc: mọi tài liệu khóa sửa (FR-003). */
  readonly readOnly: boolean;
  /** Project mới hơn mức Studio hiểu: không mở, nêu phiên bản (FR-005). */
  readonly refusal: { version: string } | null;
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
  Pick<
    CommandContext,
    | 'monitoring'
    | 'deviceAddressSet'
    | 'tagGridFocused'
    | 'cellRow'
    | 'screenSel'
    | 'screenClip'
    | 'screenPreview'
    | 'screenIsPopup'
    | 'screenTplSel'
  >
>;

const SCREEN_FILE = /^screens\/[^/]+\.screen\.json$/;

const EMPTY_OUTLINE: ProjectOutline = outlineOf({});

/** `schemaVersion` mới hơn 0.5.x (FR-005): trả phiên bản đó; không thì `null`. */
function newerVersion(project: unknown): string | null {
  const v =
    project !== null && typeof project === 'object'
      ? (project as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  const m = typeof v === 'string' ? /^(\d+)\.(\d+)\./.exec(v) : null;
  // hiểu 0.1 đến 0.6, 1.0 (feature 011) và 1.1 (feature 012); 0.7+, 1.2+ chưa có (contracts/project-format-1.1.md §1)
  const [major, minor] = m ? [Number(m[1]), Number(m[2])] : [0, 0];
  return m && (major > 1 || (major === 1 && minor > 1) || (major === 0 && minor > 6))
    ? (v as string)
    : null;
}

/** Kết quả `backup-failed` từ lỗi của `project_backup`. */
function backupFailure(b: Extract<BackupOutcome, { error: string }>): SaveResult {
  return 'detail' in b
    ? { status: 'backup-failed', error: b.error, detail: b.detail }
    : { status: 'backup-failed', error: b.error };
}

const initialState = (): StudioState => ({
  project: null,
  docs: {},
  outline: EMPTY_OUTLINE,
  issues: [],
  loaded: null,
  loaded02: null,
  loaded03: null,
  loaded05: null,
  pendingUpgrade: false,
  upgradePlan: null,
  upgrade: null,
  readOnly: false,
  refusal: null,
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
    const version = newerVersion(docs['project.json']?.value);
    if (version !== null) {
      // Project mới hơn mức Studio hiểu (FR-005): không mở, không đọc thêm, không ghi gì.
      this.s = { ...initialState(), refusal: { version } };
      this.set({});
      return;
    }
    const outline = outlineOf(filesOf(docs));
    const old = !outline.format11 && outline.project !== null;
    this.s = { ...initialState(), project: { display } };
    this.set({ docs, outline, pendingUpgrade: old });
    void this.runValidate();
    if (old) void this.planUpgrade();
  }

  /**
   * Đọc các file project tham chiếu mà `docs` chưa có (trừ file trong `skip`): project.json, file Tag, file lưu
   * trữ, (0.2) kết nối, bảng giá trị, bảng theo dõi, rồi màn hình, binding, SVG. File không đọc được thì bỏ qua: bộ
   * kiểm tra tự đọc lại và báo cùng mã lỗi với runtime.
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
    // Project mới hơn mức hiểu: chỉ project.json (để từ chối), không đọc các file khác.
    if (newerVersion(docs['project.json']?.value) !== null) return docs;
    await read(outline.tagFile);
    await read(outline.loggingFile);
    await read(outline.reportsFile);
    await read(outline.connectionFile);
    await read(outline.alarmFile);
    await read(outline.alarmClassFile);
    await read(outline.logicFile);
    for (const f of outline.templateFiles) await read(f);
    for (const v of outline.valueTables) await read(v.file);
    for (const w of outline.watchTables) await read(w.file);
    for (const s of outline.screens) await read(s.file);
    outline = outlineOf(filesOf(docs));
    for (const s of outline.screens) {
      await read(s.bindingFile);
      await read(s.screen?.svgFile);
      // 0.3: SVG và binding của từng item `svg`.
      for (const it of s.model?.items ?? []) {
        if (it.type !== 'svg') continue;
        await read(it.bindingFile);
        await read(it.svgFile);
      }
    }
    return this.withEditable(docs);
  }

  /** Tài liệu sửa được (data-model §13.1); project 0.1 mở chỉ đọc thì không tài liệu nào sửa được. */
  private withEditable(docs: Record<string, ProjectDoc>): Record<string, ProjectDoc> {
    return withEditable(docs, { readOnly: this.s.readOnly });
  }

  // ---------- Nâng cấp 0.1 → 0.2, chỉ đọc (FR-003, FR-004) ----------

  /** Nội dung chữ của mọi tài liệu (bộ đọc của `migrate01to02`). */
  private textsOf(docs: ProjectDocs = this.s.docs): Record<string, string> {
    const out: Record<string, string> = {};
    for (const rel of Object.keys(docs)) if (!docs[rel].removed) out[rel] = this.textOf(rel, docs);
    return out;
  }

  /**
   * `migrateTo10` (hoặc `migrateTo06`, `migrateTo05`, `migrateTo04` khi `target` là 0.6, 0.5, 0.4) rồi làm sạch SVG theo allowlist 0.4 (giữ id và UID;
   * `svg-upgrade.ts`): file SVG đổi vào danh sách sao lưu, báo cáo vào `changes` trước dòng "Ghi lại".
   */
  private async migrateClean(
    target: '0.4' | '0.5' | '0.6' | '1.0' | '1.1' = '1.1',
  ): Promise<UpgradePlan> {
    const step =
      target === '0.4'
        ? migrateTo04
        : target === '0.5'
          ? migrateTo05
          : target === '0.6'
            ? migrateTo06
            : target === '1.0'
              ? migrateTo10
              : migrateTo11;
    const r = await step(this.textsOf());
    if (!r.ok) return r;
    const { files, change } = cleanSvgFiles(r.files);
    if (change === null) return r;
    const backup = [...new Set([...r.backup, ...change.files.map((f) => f.file)])].sort();
    return {
      ok: true,
      files,
      backup,
      changes: [
        ...r.changes.filter((c) => c.kind !== 'rewrite'),
        change,
        { kind: 'rewrite', files: backup },
      ],
    };
  }

  /** Tính kế hoạch nâng cấp của project 0.1 vừa mở (nền) để hộp thoại liệt kê các thay đổi. */
  private async planUpgrade(): Promise<void> {
    const project = this.s.project;
    const plan = await this.migrateClean().catch(() => null);
    if (this.s.project !== project || !this.s.pendingUpgrade || plan === null) return;
    this.set({ upgradePlan: plan });
  }

  /** Mở chỉ đọc (người dùng chọn trong hộp thoại Nâng cấp): khóa mọi sửa; Nạp xuống vẫn nguyên trạng. */
  openReadOnly(): void {
    if (!this.s.project || !this.s.pendingUpgrade) return;
    const docs = withEditable(this.s.docs, { readOnly: true });
    this.set({ readOnly: true, pendingUpgrade: false, upgradePlan: null, docs });
  }

  /**
   * Nâng cấp project trong bộ nhớ: lên 1.0 (`migrateTo10`, mặc định, feature 011: 0.1 đến 0.6 qua cả chuỗi trong một lần), lên 0.6
   * (`migrateTo06`), lên 0.5 (`migrateTo05`), lên 0.4
   * (`migrateTo04`), lên 0.3 (`migrateTo03`) hoặc, khi `target` là `0.2`, chỉ 0.1 → 0.2 (`migrate01to02`). Đĩa không đổi tới khi Lưu; lần lưu đầu sao lưu các file
   * đã viết lại. Không hoàn tác được (lịch sử bắt đầu lại).
   */
  async upgrade(
    target: '0.2' | '0.3' | '0.4' | '0.5' | '0.6' | '1.0' | '1.1' = '1.1',
  ): Promise<UpgradeOutcome> {
    if (!this.s.project) return { ok: false, error: { code: 'NO_PROJECT' } };
    const texts = this.textsOf();
    const result =
      target === '0.2'
        ? await migrate01to02(texts)
        : target === '0.3'
          ? await migrateTo03(texts)
          : await this.migrateClean(target);
    if (!result.ok) return result;
    const tagFile = this.s.outline.tagFile;
    const from = String(
      (this.s.docs['project.json']?.value as { schemaVersion?: unknown } | null)?.schemaVersion ??
        '0.1.0',
    );
    let docs: Record<string, ProjectDoc> = { ...this.s.docs };
    for (const [rel, text] of Object.entries(result.files)) {
      const cur = docs[rel];
      if (!cur || text === this.textOf(rel)) continue;
      // project.json và file Tag sửa theo đối tượng; lưu trữ, màn hình, binding chỉ đổi schemaVersion: nội dung chờ ghi.
      docs[rel] =
        rel === 'project.json' || rel === tagFile || (target !== '0.2' && SCREEN_FILE.test(rel))
          ? withValue(cur, JSON.parse(stripBom(text)) as unknown)
          : withPending(cur, text);
    }
    docs = withEditable(docs);
    this.cancelTimer();
    this.set({
      docs,
      outline: outlineOf(filesOf(docs)),
      pendingUpgrade: false,
      upgradePlan: null,
      history: createHistory<string>(),
      upgrade: {
        from,
        files: result.backup.map((rel) => ({ rel, hash: this.s.docs[rel]?.diskHash ?? '' })),
        backup: null,
      },
    });
    void this.runValidate();
    return { ok: true, changes: result.changes };
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

  /**
   * Trình vẽ SVG (feature 011) vừa ghi (hoặc nạp lại) tệp SVG `rel`: tài liệu của store nhận nội dung trên đĩa mới (không
   * thành bước hoàn tác, không chưa lưu) để cây phần tử của 008 và bộ kiểm tra thấy văn bản mới; binding không đổi.
   */
  fileSaved(rel: string, text: string, hash: string): void {
    if (!this.s.project) return;
    const docs = { ...this.s.docs, [rel]: loadDoc(rel, text, hash, false) };
    this.set({ docs, outline: outlineOf(filesOf(docs)) });
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
    if (!doc || doc.removed) return '';
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
        docs[rel]
          ? docs[rel].removed
            ? { error: 'missing' }
            : { text: this.textOf(rel, docs) }
          : this.platform.read(rel),
    };
    this.set({ checking: true });
    const run = this.validate(source).then(
      (r) => {
        if (seq !== this.requested) return;
        this.set({
          issues: [...r.errors, ...r.warnings],
          loaded: r.project ?? null,
          loaded02: r.project02 ?? null,
          // 0.4 (feature 008) trả `project04` thay vì `project03`: cùng cấu trúc tập file.
          loaded03: r.project03 ?? (r.project04 as unknown as LoadedProject03 | undefined) ?? null,
          loaded05: r.project05 ?? null,
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
    const order = writeOrder(this.s.docs);
    if (order.length === 0) return { status: 'saved', files: [] };
    // Lần lưu đầu sau khi nâng cấp: sao lưu các file 0.1 trước, không sao lưu được thì không ghi gì (FR-004).
    const up = this.s.upgrade;
    if (up && !up.backup) {
      const b = await this.platform.projectBackup(up.files, up.from);
      if ('error' in b) return backupFailure(b);
      this.set({ upgrade: { ...up, backup: { dir: b.dir, abs: b.abs } } });
    }
    const files: string[] = [];
    for (const doc of order) {
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
      if (this.s.docs[conflict.rel]?.removed) {
        // Bảng đã xóa mà file bị sửa ngoài: giữ file trên đĩa, bỏ tài liệu (project.json đã thôi tham chiếu nó).
        const { [conflict.rel]: _gone, ...rest } = this.s.docs;
        void _gone;
        this.set({ docs: rest, outline: outlineOf(filesOf(rest)) });
        this.scheduleValidate();
      } else if ('text' in r) {
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

  /** Xóa file của bảng đã xóa (`project_remove`, kiểm hash); bảng chưa từng có trên đĩa thì bỏ tài liệu. */
  private async removeDoc(rel: string, force: boolean): Promise<SaveResult> {
    const doc = this.s.docs[rel];
    let hash = doc.diskHash ?? '';
    if (force) {
      // Ghi đè: xóa bản hiện có trên đĩa dù đã khác lúc đọc.
      const cur = await this.platform.read(rel);
      if ('hash' in cur) hash = cur.hash;
    }
    const res = await this.platform.projectRemove(rel, hash);
    if ('ok' in res || ('error' in res && res.error === 'missing')) {
      const { [rel]: _gone, ...rest } = this.s.docs;
      void _gone;
      this.set({ docs: rest, lastSaveError: null });
      return { status: 'saved', files: [rel] };
    }
    if (res.error === 'changed') {
      this.set({ conflict: { rel } });
      return { status: 'conflict', rel };
    }
    const error: SaveError =
      res.error === 'io' ? { rel, error: 'io', detail: res.detail } : { rel, error: 'bad-path' };
    this.set({ lastSaveError: error });
    return { status: 'error', ...error };
  }

  private async writeDoc(rel: string, force: boolean): Promise<SaveResult> {
    const doc = this.s.docs[rel];
    if (doc.removed) return this.removeDoc(rel, force);
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
      readOnly: this.s.readOnly,
      version02: this.s.outline.version === '0.2',
      version03: this.s.outline.schema === '0.3',
      screenEditor: open && this.s.outline.schema === '0.3' && this.s.active.startsWith('screen:'),
      version05: this.s.outline.v05,
      hasTags: (this.s.outline.tags?.tags.length ?? 0) > 0,
      alarmCount: this.s.outline.alarms?.alarms.length ?? 0,
      format10: this.s.outline.format10,
      ...ui,
    };
  }
}
