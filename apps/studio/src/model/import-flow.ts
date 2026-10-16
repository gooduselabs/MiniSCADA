// Luồng Nhập SVG (feature 008, T057; data-model §3, contract studio-svg-editor §3, FR-011, D29):
//   idle → reading (svg_open) → importing (importSvg ở Worker) → preview | error → committed | cancelled
// `preview → importing` khi đổi tùy chọn Tối ưu. Chỉ `committed` đổi tài liệu, bằng MỘT lần `apply` (store.applyChange:
// một bước hoàn tác cho item, file SVG chờ ghi và file binding rỗng; chưa ghi đĩa cho tới khi Lưu). Lớp không biết
// store hay giao diện; mọi thứ ngoài vào qua `ImportFlowDeps`. Kết quả chạy muộn của lượt trước bị bỏ (đổi Tối ưu liên
// tiếp, Hủy khi đang nhập).
import { LIMITS_03, LIMITS_04, type ScreenModel, type SvgItem } from '@mat/project-schema';
import type { ImportResult } from '@mat/svg-import';
import type { SvgOpenOutcome } from '../platform/types.ts';
import { nextItemId } from './screen-edit/clipboard.ts';
import type { ImportRunner } from './import-runner.ts';
import type { ProjectEdit } from './project-doc.ts';
import { emptyBindingSet } from './svg-binding-doc.ts';
import { NAME_MAX, uniqueSvgPath } from './svg-doc.ts';

export type { ImportRunner } from './import-runner.ts';

export type { SvgOpenOutcome } from '../platform/types.ts';

export type ImportPhase =
  'idle' | 'reading' | 'importing' | 'preview' | 'error' | 'committed' | 'cancelled';

export type ImportFailCode =
  | 'E_IMPORT_LIMIT'
  | 'E_IMPORT_EXT'
  | 'E_IMPORT_PARSE'
  | 'E_IMPORT_ENCODING'
  | 'E_IMPORT_ROOT'
  | 'E_IMPORT_DTD'
  | 'E_IMPORT_USE_BOMB'
  | 'E_IMPORT_SIZE'
  | 'io'
  | 'worker';

export interface ImportState {
  phase: ImportPhase;
  fileName: string | null;
  options: { optimize: boolean };
  /** Kết quả của importSvg (cả khi bị từ chối: có báo cáo). */
  result: ImportResult | null;
  error: { code: ImportFailCode; detail?: string } | null;
  /** 0..1 khi đang nhập và Worker báo; không thì null. */
  progress: number | null;
}

/** Đối tượng đích khi bấm Nhập: màn hình đang mở và các file đã có. */
export interface ImportTarget {
  screen: ScreenModel;
  /** Đường dẫn file đang có trong project (chỉ `graphics/` được dùng để tránh trùng slug). */
  graphicsFiles: Iterable<string>;
  /** `schemaVersion` của project.json (file binding mới mang cùng phiên bản). */
  schemaVersion: string;
}

/** Thay đổi đưa cho `store.applyChange`. */
export interface StoreChange {
  edits?: readonly ProjectEdit[];
  replace?: Readonly<Record<string, string>>;
}

export type PlanRejection = 'max-svg-items' | 'max-items' | 'bad-result';

export type ImportPlan =
  | { ok: true; item: SvgItem; svgFile: string; bindingFile: string; change: StoreChange }
  | { ok: false; reason: PlanRejection };

export interface ImportFlowDeps {
  open: () => Promise<SvgOpenOutcome>;
  run: ImportRunner;
  /** Màn hình đích lúc bấm Nhập; `null` khi không có (không nhập được). */
  target: () => ImportTarget | null;
  apply: (change: StoreChange) => void;
}

/** Cỡ item (đơn vị màn hình) từ viewBox, thu vừa màn hình, giữ tỉ lệ, không phóng to (D29). */
export function fitItemSize(
  viewBox: readonly [number, number, number, number],
  screen: { width: number; height: number },
): { width: number; height: number } {
  const [, , w, h] = viewBox;
  const scale = Math.min(1, screen.width / w, screen.height / h);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

const baseName = (fileName: string): string =>
  [...fileName.replace(/^.*[\\/]/, '').replace(/\.svg$/i, '')].slice(0, NAME_MAX).join('').trim();

/** Trần item `svg` mỗi màn hình theo phiên bản project: 0.4 trở lên là 64, cũ hơn là 8. */
export const svgItemLimit = (schemaVersion: string): number =>
  /^0\.[0-3]\./.test(schemaVersion) ? LIMITS_03.svgItems : LIMITS_04.svgItems;

/**
 * Kế hoạch thêm: item `svg` ở (0, 0) cỡ viewBox thu vừa màn hình, file `graphics/<slug>.svg`, file binding rỗng
 * `screens/<màn hình>.<item>.bindings.json`. Thuần; không đổi `target`.
 */
export function planImport(
  result: ImportResult,
  fileName: string,
  target: ImportTarget,
): ImportPlan {
  if (!result.ok) return { ok: false, reason: 'bad-result' };
  const screen = target.screen;
  if (screen.items.filter((i) => i.type === 'svg').length >= svgItemLimit(target.schemaVersion))
    return { ok: false, reason: 'max-svg-items' };
  if (screen.items.length >= LIMITS_03.items) return { ok: false, reason: 'max-items' };
  const svgFile = uniqueSvgPath(fileName, target.graphicsFiles);
  const itemId = nextItemId('svg', new Set(screen.items.map((i) => i.id)));
  const bindingFile = `screens/${screen.id}.${itemId}.bindings.json`;
  const size = fitItemSize(result.viewBox, screen.size);
  const name = baseName(fileName);
  const item: SvgItem = {
    id: itemId,
    ...(name !== '' ? { name } : {}),
    type: 'svg',
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    svgFile,
    bindingFile,
    viewBox: [...result.viewBox],
    elements: result.elements
      .filter((e) => e.label !== undefined)
      .map((e) => ({ elementUid: e.uid, name: e.name })),
  };
  return {
    ok: true,
    item,
    svgFile,
    bindingFile,
    change: {
      edits: [
        { kind: 'screenUpsert', screen: { ...screen, items: [...screen.items, item] } },
        {
          kind: 'svgBindings',
          file: bindingFile,
          set: emptyBindingSet(screen.id, itemId, target.schemaVersion),
        },
      ],
      replace: { [svgFile]: result.svg },
    },
  };
}

const initial = (): ImportState => ({
  phase: 'idle',
  fileName: null,
  options: { optimize: false },
  result: null,
  error: null,
  progress: null,
});

export class ImportFlow {
  private s: ImportState = initial();
  private bytes: Uint8Array | null = null;
  private seq = 0;
  private readonly listeners = new Set<() => void>();

  private readonly deps: ImportFlowDeps;

  constructor(deps: ImportFlowDeps) {
    this.deps = deps;
  }

  get state(): ImportState {
    return this.s;
  }

  /** Byte gốc của file đang nhập (để dựng xem trước "Trước" bằng bản đã lọc); null khi chưa có. */
  get sourceBytes(): Uint8Array | null {
    return this.bytes;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  private set(patch: Partial<ImportState>): void {
    this.s = { ...this.s, ...patch };
    for (const l of [...this.listeners]) l();
  }

  /** Chọn file (hộp thoại của hệ điều hành) rồi nhập; gọi lại từ error/preview là "chọn file khác". */
  async start(): Promise<void> {
    const token = ++this.seq;
    const prev = this.s;
    const keep = prev.phase === 'error' || prev.phase === 'preview' ? prev : null;
    this.set({ phase: 'reading', error: null, progress: null });
    const r = await this.deps.open();
    if (token !== this.seq) return;
    if (r === null) {
      if (keep) this.set({ ...keep });
      else this.set({ phase: 'cancelled' });
      return;
    }
    if ('error' in r) {
      this.bytes = null;
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
    this.bytes = r.bytes;
    this.set({ fileName: r.name, result: null });
    await this.runImport();
  }

  /** Đổi tùy chọn Tối ưu và chạy lại; chỉ khi đã có file (preview hoặc error của chính file). */
  async setOptimize(optimize: boolean): Promise<void> {
    if (this.bytes === null || !['preview', 'error', 'importing'].includes(this.s.phase)) return;
    this.set({ options: { ...this.s.options, optimize } });
    await this.runImport();
  }

  private async runImport(): Promise<void> {
    const bytes = this.bytes;
    if (bytes === null) return;
    const token = ++this.seq;
    this.set({ phase: 'importing', error: null, progress: null });
    let result: ImportResult;
    try {
      result = await this.deps.run(
        bytes,
        { fileName: this.s.fileName ?? 'unnamed.svg', optimize: this.s.options.optimize },
        (f) => {
          if (token === this.seq) this.set({ progress: f });
        },
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
    if (result.ok) this.set({ phase: 'preview', result, error: null, progress: null });
    else this.set({ phase: 'error', result, error: { code: result.error.code }, progress: null });
  }

  /**
   * Nhập vào project. Trả kế hoạch (`ok: true` thì đã `apply` và phase = committed); `null` khi không ở preview hoặc
   * không có màn hình đích; kế hoạch `ok: false` (trần item) giữ nguyên preview để giao diện báo lý do.
   */
  commit(): ImportPlan | null {
    const { phase, result, fileName } = this.s;
    if (phase !== 'preview' || result === null || !result.ok) return null;
    const target = this.deps.target();
    if (target === null) return null;
    const plan = planImport(result, fileName ?? 'unnamed.svg', target);
    if (!plan.ok) return plan;
    this.seq++;
    this.deps.apply(plan.change);
    this.set({ phase: 'committed' });
    return plan;
  }

  /** Hủy: không đổi tài liệu; kết quả đang chạy dở bị bỏ. */
  cancel(): void {
    if (this.s.phase === 'committed') return;
    this.seq++;
    this.set({ phase: 'cancelled', progress: null });
  }
}
