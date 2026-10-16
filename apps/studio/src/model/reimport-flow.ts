// Luồng Nhập lại SVG (feature 008, T102; FR-028, FR-029; contract svg-import §7, studio-svg-editor §3):
//   idle → reading (svg_open) → importing (importSvg có `previous`) → matching → resolve → applied | cancelled
// `error` khi file bị từ chối. Ở `resolve` người dùng chọn cho từng mục "cần chọn" (mặc định "Mới": không gán UID cũ) và
// cách xử lý mồ côi ("Bỏ binding" mặc định, hoặc "Giữ mồ côi" để lại E_REF_UID). `apply` đổi tài liệu bằng MỘT lần
// `store.applyChange`: SVG mới, `elements` của item (và của item dùng chung nếu áp cho mọi thể hiện) và file binding.
// Hủy không đổi gì. Lớp không biết store hay giao diện; mọi thứ ngoài vào qua `ReimportDeps`.
import type { BindingSet04, ScreenModel, SvgItem } from '@mat/project-schema';
import { applyMatch, type ImportResult, type MatchResult } from '@mat/svg-import';
import type { ImportRunner } from './import-runner.ts';
import type { ImportFailCode, StoreChange, SvgOpenOutcome } from './import-flow.ts';
import type { ProjectEdit } from './project-doc.ts';
import { uniqueSvgPath } from './svg-doc.ts';

export type ReimportPhase =
  'idle' | 'reading' | 'importing' | 'matching' | 'resolve' | 'error' | 'applied' | 'cancelled';

export type OrphanMode = 'drop' | 'keep';
export type ShareMode = 'split' | 'all';

/** Item `svg` khác dùng chung tệp SVG với item đang nhập lại. */
export interface ReimportSharer {
  screen: ScreenModel;
  item: SvgItem;
  bindings: BindingSet04;
}

/** Item đích và dữ liệu hiện có của nó lúc bắt đầu. */
export interface ReimportTarget {
  screen: ScreenModel;
  item: SvgItem;
  /** Văn bản SVG đang dùng (đã chuẩn hóa, có `data-mat-uid`); null khi chưa đọc được. */
  svg: string | null;
  bindings: BindingSet04;
  graphicsFiles: Iterable<string>;
  sharers: readonly ReimportSharer[];
}

export interface ReimportDeps {
  open: () => Promise<SvgOpenOutcome>;
  run: ImportRunner;
  target: () => ReimportTarget | null;
  apply: (change: StoreChange) => void;
}

export interface ReimportState {
  phase: ReimportPhase;
  fileName: string | null;
  result: ImportResult | null;
  error: { code: ImportFailCode | 'E_NO_TARGET'; detail?: string } | null;
  /** `newPath` → UID cũ được chọn, hoặc null ("Mới"). Không có khóa nghĩa là "Mới". */
  choices: Readonly<Record<string, string | null>>;
  /** Xử lý từng mồ côi; thiếu khóa nghĩa là `drop`. */
  orphanModes: Readonly<Record<string, OrphanMode>>;
  shareMode: ShareMode;
}

export interface ReimportSummary {
  kept: number;
  added: number;
  ambiguous: number;
  /** Mồ côi (kể cả không có binding). */
  orphans: number;
  /** Mồ côi có binding hoặc sự kiện: chỉ các mục này cần xử lý. */
  orphansBound: number;
}

const initial = (): ReimportState => ({
  phase: 'idle',
  fileName: null,
  result: null,
  error: null,
  choices: {},
  orphanModes: {},
  shareMode: 'split',
});

type Elem = BindingSet04['elements'][number];

/** Bỏ mục binding của các UID bị "Bỏ binding". */
function dropUids(set: BindingSet04, drop: ReadonlySet<string>): BindingSet04 {
  if (!set.elements.some((e) => drop.has(e.elementUid))) return set;
  return { ...set, elements: set.elements.filter((e) => !drop.has(e.elementUid)) };
}

/**
 * `elements` mới của item: phần tử có nhãn trong SVG mới, cộng phần tử còn binding hoặc sự kiện mà SVG mới có (cần khai
 * báo để không bị E_REF_UID). Mồ côi "Giữ" không nằm trong SVG mới nên không được khai báo: đúng ý, lỗi E_REF_UID chặn
 * Nạp xuống cho tới khi người dùng gắn lại hoặc bỏ. Giữ tên cũ khi phần tử không có nhãn trong SVG.
 */
function declared(
  elements: ReturnType<typeof applyMatch>['elements'],
  old: SvgItem['elements'],
  sets: BindingSet04,
): SvgItem['elements'] {
  const oldName = new Map(old.map((e) => [e.elementUid, e.name]));
  const bound = new Set(sets.elements.map((e: Elem) => e.elementUid));
  const out: SvgItem['elements'] = [];
  for (const e of elements) {
    if (e.label !== undefined) out.push({ elementUid: e.uid, name: e.name });
    else if (bound.has(e.uid)) {
      const name = oldName.get(e.uid);
      out.push(
        name !== undefined && name !== '' ? { elementUid: e.uid, name } : { elementUid: e.uid },
      );
    }
  }
  return out;
}

export class ReimportFlow {
  private s: ReimportState = initial();
  private seq = 0;
  /** `applyMatch` đọc lại cả SVG nên nhớ kết quả theo (kết quả nhập, lựa chọn). */
  private orphanCache: {
    result: ImportResult;
    choices: ReimportState['choices'];
    list: MatchResult['orphans'];
  } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly deps: ReimportDeps;

  constructor(deps: ReimportDeps) {
    this.deps = deps;
  }

  get state(): ReimportState {
    return this.s;
  }

  /** Kết quả đối chiếu (có khi ở `resolve`). */
  get match(): MatchResult | null {
    const r = this.s.result;
    return r !== null && r.ok ? (r.match ?? null) : null;
  }

  /** Có item khác dùng chung tệp SVG (hộp thoại phải hỏi áp cho mọi thể hiện hay tách). */
  get hasSharers(): boolean {
    return (this.deps.target()?.sharers.length ?? 0) > 0;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  private set(patch: Partial<ReimportState>): void {
    this.s = { ...this.s, ...patch };
    for (const l of [...this.listeners]) l();
  }

  summary(): ReimportSummary {
    const m = this.match;
    if (m === null) return { kept: 0, added: 0, ambiguous: 0, orphans: 0, orphansBound: 0 };
    return {
      kept: m.pairs.length,
      added: m.added.length,
      ambiguous: m.ambiguous.length,
      orphans: this.orphanList().length,
      orphansBound: this.orphanList().filter((o) => o.hasBinding || o.hasEvent).length,
    };
  }

  /** Mồ côi sau các lựa chọn hiện tại: ứng viên không ai nhận cũng là mồ côi. */
  orphanList(): MatchResult['orphans'] {
    const r = this.s.result;
    if (r === null || !r.ok || !r.match) return [];
    const c = this.orphanCache;
    if (c !== null && c.result === r && c.choices === this.s.choices) return c.list;
    const list = applyMatch(r, this.s.choices).orphans;
    this.orphanCache = { result: r, choices: this.s.choices, list };
    return list;
  }

  /** Chọn file mới rồi đối chiếu; gọi lại ở `error`/`resolve` là chọn file khác. */
  async start(): Promise<void> {
    const token = ++this.seq;
    const keep = this.s.phase === 'error' || this.s.phase === 'resolve' ? this.s : null;
    const target = this.deps.target();
    if (target === null || target.svg === null) {
      this.set({
        phase: 'error',
        result: null,
        error: { code: 'E_NO_TARGET' },
      });
      return;
    }
    this.set({ phase: 'reading', error: null });
    const r = await this.deps.open();
    if (token !== this.seq) return;
    if (r === null) {
      if (keep) this.set({ ...keep });
      else this.set({ phase: 'cancelled' });
      return;
    }
    if ('error' in r) {
      this.set({
        phase: 'error',
        fileName: null,
        result: null,
        error: {
          code:
            r.error === 'too-large'
              ? 'E_IMPORT_LIMIT'
              : r.error === 'bad-extension'
                ? 'E_IMPORT_EXT'
                : 'io',
          ...(r.detail !== undefined ? { detail: r.detail } : {}),
        },
      });
      return;
    }
    this.set({ phase: 'importing', fileName: r.name, result: null, error: null });
    const bound = new Set<string>();
    const events = new Set<string>();
    for (const e of target.bindings.elements) {
      if ((e.bindings?.length ?? 0) > 0) bound.add(e.elementUid);
      if (e.events?.click !== undefined) events.add(e.elementUid);
    }
    let result: ImportResult;
    try {
      result = await this.deps.run(
        r.bytes,
        {
          fileName: r.name,
          optimize: false,
          previous: { svg: target.svg, bound, events },
        },
        undefined,
      );
    } catch (e) {
      if (token !== this.seq) return;
      this.set({
        phase: 'error',
        result: null,
        error: { code: 'worker', detail: e instanceof Error ? e.message : String(e) },
      });
      return;
    }
    if (token !== this.seq) return;
    if (!result.ok) {
      this.set({ phase: 'error', result, error: { code: result.error.code } });
      return;
    }
    this.set({ phase: 'matching', result });
    this.set({ phase: 'resolve', choices: {}, orphanModes: {}, shareMode: 'split' });
  }

  /** Chọn UID cũ cho mục cần chọn `newPath`; `null` là "Mới". UID ngoài danh sách ứng viên bị bỏ qua. */
  choose(newPath: string, oldUid: string | null): void {
    const m = this.match;
    if (this.s.phase !== 'resolve' || m === null) return;
    const a = m.ambiguous.find((x) => x.newPath === newPath);
    if (!a) return;
    if (oldUid !== null && !a.candidates.some((c) => c.oldUid === oldUid)) return;
    const choices: Record<string, string | null> = { ...this.s.choices };
    // Một UID cũ chỉ nhận cho một phần tử: chọn lại ở mục khác thì mục trước về "Mới".
    if (oldUid !== null)
      for (const k of Object.keys(choices)) if (choices[k] === oldUid) choices[k] = null;
    choices[newPath] = oldUid;
    this.set({ choices });
  }

  setOrphan(oldUid: string, mode: OrphanMode): void {
    if (this.s.phase !== 'resolve') return;
    this.set({ orphanModes: { ...this.s.orphanModes, [oldUid]: mode } });
  }

  setShare(mode: ShareMode): void {
    if (this.s.phase !== 'resolve') return;
    this.set({ shareMode: mode });
  }

  /** Số mồ côi có binding mà người dùng chọn "Giữ" (sẽ để lại E_REF_UID). */
  keptOrphanCount(): number {
    return this.orphanList().filter(
      (o) => (o.hasBinding || o.hasEvent) && this.s.orphanModes[o.oldUid] === 'keep',
    ).length;
  }

  /**
   * Áp dụng: MỘT lần `apply`. `true` khi đã áp; `false` khi không ở `resolve` hoặc item không còn.
   * Hủy mới là đường không đổi gì; hàm này không đổi tài liệu khi trả `false`.
   */
  commit(): boolean {
    const { phase, result, choices, orphanModes, shareMode, fileName } = this.s;
    if (phase !== 'resolve' || result === null || !result.ok) return false;
    const target = this.deps.target();
    if (target === null) return false;
    const final = applyMatch(result, choices);
    const drop = new Set(
      final.orphans
        .filter((o) => (orphanModes[o.oldUid] ?? 'drop') === 'drop')
        .map((o) => o.oldUid),
    );
    const shared = target.sharers.length > 0;
    const split = shared && shareMode === 'split';
    const svgFile = split
      ? uniqueSvgPath(fileName ?? 'svg', target.graphicsFiles)
      : target.item.svgFile;

    const bindings = dropUids(target.bindings, drop);
    const edits: ProjectEdit[] = [];
    const screens = new Map<string, ScreenModel>([[target.screen.id, target.screen]]);
    const swap = (screenId: string, item: SvgItem): void => {
      const sc = screens.get(screenId)!;
      screens.set(screenId, { ...sc, items: sc.items.map((i) => (i.id === item.id ? item : i)) });
    };
    swap(target.screen.id, {
      ...target.item,
      svgFile,
      viewBox: [...result.viewBox],
      elements: declared(final.elements, target.item.elements, bindings),
    });
    edits.push({ kind: 'svgBindings', file: target.item.bindingFile, set: bindings });
    if (shared && shareMode === 'all') {
      for (const sh of target.sharers) {
        if (!screens.has(sh.screen.id)) screens.set(sh.screen.id, sh.screen);
        const set = dropUids(sh.bindings, drop);
        swap(sh.screen.id, {
          ...sh.item,
          viewBox: [...result.viewBox],
          elements: declared(final.elements, sh.item.elements, set),
        });
        edits.push({ kind: 'svgBindings', file: sh.item.bindingFile, set });
      }
    }
    for (const sc of screens.values()) edits.unshift({ kind: 'screenUpsert', screen: sc });
    this.seq++;
    this.deps.apply({ edits, replace: { [svgFile]: final.svg } });
    this.set({ phase: 'applied' });
    return true;
  }

  /** Hủy: không đổi tài liệu; kết quả đang chạy dở bị bỏ. */
  cancel(): void {
    if (this.s.phase === 'applied') return;
    this.seq++;
    this.set({ phase: 'cancelled' });
  }
}
