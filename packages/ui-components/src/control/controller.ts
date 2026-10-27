// ControlController: một bộ điều khiển cho mọi widget điều khiển (research R9; contract §5).
// Thuần TS, không DOM. Mọi lệnh ghi đi qua ActionHost.write và không bao giờ gửi lại.
import type { WidgetItem } from '@mat/project-schema';
import { VALUE_ERR } from '../i18n/control-vi.ts';
import type {
  ActionHost,
  Role,
  TagInfo,
  TagSource,
  TagState,
  WriteKind,
  WriteOutcome,
  WriteSpec,
} from '../host/types.ts';
import { lockOf, type Lock, type LockCode } from './lock-reasons.ts';
import { defaultModalRegistry, type ModalRegistry } from './modal-registry.ts';

export type { LockCode } from './lock-reasons.ts';

export interface Draft {
  spec: WriteSpec;
  info: TagInfo;
  current: TagState;
  confirm: 'always' | 'none';
  text?: string;
  /** Feature 029: các lệnh ghi kèm theo (widget ghi nhiều Tag, vd. time-range), gửi lần lượt sau `spec` một lần xác nhận. */
  more?: WriteSpec[];
}

export type ControlState =
  | { phase: 'locked'; code: LockCode; message: string }
  | { phase: 'ready' }
  | { phase: 'confirming'; draft: Draft }
  | { phase: 'sending'; requestId: string; draft: Draft; since: number; accepted: boolean }
  | { phase: 'result'; outcome: WriteOutcome; draft: Draft };

export interface ControlDeps {
  item: WidgetItem;
  source: TagSource;
  host: ActionHost;
  now(): number;
  uuid(): string;
  modal?: ModalRegistry;
  /** Gắn vào WriteSpec.context; vắng thì `{ screen: '', widget: item.id }`. */
  context?: { screen: string; widget: string };
  /**
   * Feature 013: id item dùng để hỏi quyền (`host.itemBlocked`); vắng thì `context.widget`. Phần tử SVG: `context.widget`
   * là `elementUid`, quyền theo item `svg` chứa nó.
   */
  accessItem?: string;
  /**
   * Feature 029: khe Tag ghi của widget ghi nhiều Tag (vd. time-range); vắng thì `target`. Tag chính (`tag`) là Tag đầu
   * tiên có gắn theo thứ tự này.
   */
  slots?: readonly string[];
}

const TYPE_RANGE: Partial<Record<TagInfo['type'], [number, number]>> = {
  INT16: [-32768, 32767],
  UINT16: [0, 65535],
  INT32: [-2147483648, 2147483647],
  UINT32: [0, 4294967295],
  INT64: [-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  UINT64: [0, Number.MAX_SAFE_INTEGER],
};
const INTEGER_TYPES = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);
const NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Giới hạn hiệu lực của ô nhập: giao của widget (props.min/max) và Tag (limits). */
export function effectiveLimits(
  item: WidgetItem,
  info: TagInfo | undefined,
): { min?: number; max?: number } {
  const p = item.props ?? {};
  const mins = [p['min'], info?.limits?.min].filter((v): v is number => typeof v === 'number');
  const maxs = [p['max'], info?.limits?.max].filter((v): v is number => typeof v === 'number');
  const out: { min?: number; max?: number } = {};
  if (mins.length) out.min = Math.max(...mins);
  if (maxs.length) out.max = Math.min(...maxs);
  return out;
}

export const CONFIRMED_AUTOCLEAR_MS = 4000;
export const UNKNOWN_HOLD_MS = 10_000;

export class ControlController {
  onChange: (() => void) | null = null;
  /** Lỗi kiểm giá trị của lần `propose` gần nhất (null: không lỗi). */
  error: string | null = null;

  readonly #d: ControlDeps;
  readonly #modal: ModalRegistry;
  #phase: 'idle' | 'confirming' | 'sending' | 'result' = 'idle';
  #draft: Draft | null = null;
  #requestId = '';
  #since = 0;
  #accepted = false;
  #outcome: WriteOutcome | null = null;
  #hold = false;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #off: () => void;
  #disposed = false;

  constructor(deps: ControlDeps) {
    this.#d = deps;
    this.#modal = deps.modal ?? defaultModalRegistry;
    this.#off = this.#modal.subscribe(() => this.#emit());
  }

  get tag(): string | undefined {
    for (const slot of this.#d.slots ?? ['target']) {
      const t = this.#d.item.tags?.[slot];
      const id = Array.isArray(t) ? t[0] : t;
      if (id) return id;
    }
    return undefined;
  }

  get state(): ControlState {
    if (this.#phase === 'confirming' && this.#draft) {
      return { phase: 'confirming', draft: this.#fresh(this.#draft) };
    }
    if (this.#phase === 'sending' && this.#draft) {
      return {
        phase: 'sending',
        requestId: this.#requestId,
        draft: this.#draft,
        since: this.#since,
        accepted: this.#accepted,
      };
    }
    if (this.#phase === 'result' && this.#draft && this.#outcome) {
      return { phase: 'result', outcome: this.#outcome, draft: this.#draft };
    }
    const l = this.#lock();
    return l ? { phase: 'locked', code: l.code, message: l.message } : { phase: 'ready' };
  }

  /** `BUSY` khi đang gửi hoặc kết quả UNKNOWN còn giữ. */
  busyLock(): 'BUSY' | null {
    return this.#phase === 'sending' || this.#hold ? 'BUSY' : null;
  }

  /** Khóa hiện thời của hộp xác nhận (nút Xác nhận tắt khi khác null). */
  confirmLock(): Lock | null {
    return this.#lock();
  }

  /** Giới hạn hiệu lực của ô nhập: giao của widget (props.min/max) và Tag (limits). */
  limits(): { min?: number; max?: number } {
    const info = this.tag ? this.#d.source.info(this.tag) : undefined;
    return effectiveLimits(this.#d.item, info);
  }

  propose(kind: WriteKind, value: boolean | number | string, opts?: { pulseMs?: number }): boolean {
    this.error = null;
    if (this.#phase !== 'idle') return false;
    if (this.#lock()) {
      this.#emit();
      return false;
    }
    const tag = this.tag;
    const info = tag ? this.#d.source.info(tag) : undefined;
    if (!tag || !info) return false;
    const current = this.#d.source.get(tag);
    const built = this.#build(kind, value, opts, info, current);
    if (typeof built === 'string') {
      this.error = built;
      this.#emit();
      return false;
    }
    const p = this.#d.item.props ?? {};
    const confirm: 'always' | 'none' =
      p['confirm'] === 'none' && info.type === 'BOOL' ? 'none' : 'always';
    const text =
      typeof p['confirmText'] === 'string' && p['confirmText'] ? p['confirmText'] : undefined;
    const draft: Draft = { spec: built, info, current, confirm, ...(text ? { text } : {}) };
    if (confirm === 'none') {
      this.#send(draft);
      return true;
    }
    if (!this.#modal.acquire(this)) return false;
    this.#draft = draft;
    this.#phase = 'confirming';
    this.#emit();
    return true;
  }

  /**
   * Feature 029: ghi nhiều Tag (số) với một lần xác nhận, kiểm từng giá trị như `propose('write', …)`; gửi lần lượt,
   * dừng ở lệnh đầu tiên không thành công. Trả false khi bị khóa hoặc giá trị lỗi (`error`).
   */
  proposeMany(entries: ReadonlyArray<{ tag: string; value: number }>, text?: string): boolean {
    this.error = null;
    if (this.#phase !== 'idle' || entries.length === 0) return false;
    if (this.#lock()) {
      this.#emit();
      return false;
    }
    const specs: WriteSpec[] = [];
    let firstInfo: TagInfo | undefined;
    for (const e of entries) {
      const info = this.#d.source.info(e.tag);
      if (!info || info.access !== 'RW' || info.kind === 'calculated') return false;
      firstInfo ??= info;
      const built = this.#build('write', e.value, undefined, info, this.#d.source.get(e.tag));
      if (typeof built === 'string') {
        this.error = built;
        this.#emit();
        return false;
      }
      specs.push(built);
    }
    if (!this.#modal.acquire(this)) return false;
    this.#draft = {
      spec: specs[0]!,
      info: firstInfo!,
      current: this.#d.source.get(specs[0]!.tag),
      confirm: 'always',
      ...(text ? { text } : {}),
      more: specs.slice(1),
    };
    this.#phase = 'confirming';
    this.#emit();
    return true;
  }

  confirm(): void {
    if (this.#phase !== 'confirming' || !this.#draft) return;
    if (this.#lock()) {
      // Khóa xuất hiện giữa chừng: không gửi, về trạng thái khóa.
      this.#toIdle();
      return;
    }
    this.#send(this.#draft);
  }

  cancel(): void {
    if (this.#phase === 'confirming') this.#toIdle();
  }

  dismissResult(): void {
    if (this.#phase !== 'result' || this.#hold) return;
    this.#toIdle();
  }

  recompute(): void {
    this.#emit();
  }

  dispose(): void {
    this.#disposed = true;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    this.#modal.release(this);
    this.#off();
  }

  // ---- nội bộ ----

  #lock(): Lock | null {
    const role = (this.#d.item.security?.minRole ?? 'operator') as Exclude<Role, 'viewer'>;
    const ctx = this.#d.context ?? { screen: '', widget: this.#d.item.id };
    return lockOf({
      item: { screen: ctx.screen, item: this.#d.accessItem ?? ctx.widget },
      tag: this.tag,
      minRole: role,
      source: this.#d.source,
      host: this.#d.host,
      busy: this.busyLock() !== null,
      otherDialog: this.#modal.blockedFor(this),
    });
  }

  #fresh(d: Draft): Draft {
    return { ...d, current: this.#d.source.get(d.info.id) };
  }

  #emit(): void {
    if (!this.#disposed) this.onChange?.();
  }

  #later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.#timers.delete(t);
      if (!this.#disposed) fn();
    }, ms);
    this.#timers.add(t);
  }

  #toIdle(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    this.#phase = 'idle';
    this.#draft = null;
    this.#outcome = null;
    this.#hold = false;
    this.#modal.release(this);
    this.#emit();
  }

  #send(draft: Draft): void {
    const requestId = this.#d.uuid();
    this.#requestId = requestId;
    this.#draft = draft;
    this.#phase = 'sending';
    this.#since = this.#d.now();
    this.#accepted = false;
    this.#modal.release(this);
    this.#emit();
    const spec: WriteSpec & { requestId: string } = { ...draft.spec, requestId };
    const live = () =>
      !this.#disposed && this.#phase === 'sending' && this.#requestId === requestId;
    const progress = (o: WriteOutcome) => {
      if (live() && o.status === 'ACCEPTED') {
        this.#accepted = true;
        this.#emit();
      }
    };
    let p: Promise<WriteOutcome>;
    try {
      p = this.#d.host.write(spec, progress);
      // Feature 029: lệnh kèm theo gửi lần lượt, mỗi lệnh một requestId; dừng ở lệnh đầu không thành công.
      for (const extra of draft.more ?? []) {
        p = p.then((o) =>
          live() && (o.status === 'CONFIRMED' || o.status === 'ACCEPTED')
            ? this.#d.host.write(
                { ...extra, requestId: this.#d.uuid() } as WriteSpec & { requestId: string },
                progress,
              )
            : o,
        );
      }
    } catch (e) {
      p = Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    p.then(
      (o) => {
        if (live()) this.#finish(o);
      },
      (e: unknown) => {
        if (live())
          this.#finish({
            status: 'FAILED',
            code: 'HOST_ERROR',
            message: String(e instanceof Error ? e.message : e),
          });
      },
    );
  }

  #finish(o: WriteOutcome): void {
    this.#phase = 'result';
    this.#outcome = o;
    if (o.status === 'CONFIRMED') {
      this.#later(CONFIRMED_AUTOCLEAR_MS, () => {
        if (this.#phase === 'result') this.#toIdle();
      });
    } else if (o.status === 'UNKNOWN') {
      this.#hold = true;
      this.#later(UNKNOWN_HOLD_MS, () => {
        this.#hold = false;
        this.#emit();
      });
    }
    this.#emit();
  }

  /** Dựng WriteSpec đã kiểm; chuỗi trả về là câu lỗi. */
  #build(
    kind: WriteKind,
    value: boolean | number | string,
    opts: { pulseMs?: number } | undefined,
    info: TagInfo,
    current: TagState,
  ): WriteSpec | string {
    const base = {
      tag: info.id,
      context: this.#d.context ?? { screen: '', widget: this.#d.item.id },
    };
    if (kind === 'toggle') {
      if (info.type !== 'BOOL' || typeof current.value !== 'boolean') return VALUE_ERR.notBool;
      return { kind, ...base, value: !current.value, expect: current.value };
    }
    if (kind === 'pulse') {
      if (info.type !== 'BOOL' || typeof value !== 'boolean') return VALUE_ERR.notBool;
      const ms = opts?.pulseMs;
      if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 100 || ms > 10_000)
        return VALUE_ERR.pulseMs;
      return { kind, ...base, value, pulseMs: ms };
    }
    if (info.type === 'BOOL') {
      return typeof value === 'boolean' ? { kind, ...base, value } : VALUE_ERR.notBool;
    }
    if (info.type === 'STRING') {
      if (typeof value !== 'string') return VALUE_ERR.notString;
      const max = info.limits?.maxLength;
      if (max !== undefined && [...value].length > max) return VALUE_ERR.tooLong(max);
      return { kind, ...base, value };
    }
    let n: number;
    if (typeof value === 'string') {
      const t = value.trim();
      if (t.includes(',')) return VALUE_ERR.decimalDot;
      if (!NUM_RE.test(t)) return VALUE_ERR.notNumber;
      n = Number(t);
    } else if (typeof value === 'number') {
      n = value;
    } else {
      return VALUE_ERR.notNumber;
    }
    if (!Number.isFinite(n)) return VALUE_ERR.notNumber;
    if (INTEGER_TYPES.has(info.type) && !Number.isInteger(n)) return VALUE_ERR.notInteger;
    const lim = effectiveLimits(this.#d.item, info);
    if ((lim.min !== undefined && n < lim.min) || (lim.max !== undefined && n > lim.max)) {
      return VALUE_ERR.range(lim.min, lim.max);
    }
    const tr = TYPE_RANGE[info.type];
    if (tr && (n < tr[0] || n > tr[1])) return VALUE_ERR.range(tr[0], tr[1]);
    return { kind, ...base, value: n };
  }
}
