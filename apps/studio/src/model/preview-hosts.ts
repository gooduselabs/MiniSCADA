// Xem trước màn hình 0.3 ngay trong Studio (feature 007, FR-067, T121, T131, T132; contract studio-screen-editor §7):
// nơi chứa của `@mat/ui-components` cho Studio. `SimTagSource` + `SimActionHost` bọc `SimEngine` (Mô phỏng: không bao giờ
// gọi thiết bị); `DeviceTagSource` + `DeviceActionHost` bọc phiên Online và `WriteFlow` của 006 (kênh `studio`). Không DOM,
// không phụ thuộc StudioApp: giao diện cấp hàm đọc trạng thái lúc chạy (handler đọc trạng thái lúc chạy).
import type { ValueTable } from '@mat/expression';
import type { TagDefinition, TagV1 } from '@mat/project-schema';
import type {
  ActionHost,
  Quality,
  Role,
  SessionInfo,
  TagInfo,
  TagScalar,
  TagSource,
  TagState,
  TagType,
  WriteOutcome,
  WriteSpec,
} from '@mat/ui-components';
import type { LiveValue } from './device-session.ts';
import type { SimEngine, SimEntry } from './sim-engine.ts';
import type { WriteFlow, RowWrite } from './write-flow.ts';

type AnyTag = TagV1 | TagDefinition;

const TAG_TYPES: ReadonlySet<string> = new Set([
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
]);

/** `TagInfo` của `@mat/ui-components` từ Tag của tags.json (0.1: Tag mock thành mô phỏng; Tag v1 mặc định chỉ đọc). */
export function hostTagInfo(tag: AnyTag): TagInfo | null {
  const t = tag as unknown as Record<string, unknown>;
  if (typeof t.id !== 'string' || !TAG_TYPES.has(String(t.type))) return null;
  const kind = (['external', 'internal', 'calculated', 'simulation'] as const).find(
    (k) => k === t.kind,
  );
  const info: TagInfo = {
    id: t.id,
    type: t.type as TagType,
    kind: kind ?? 'simulation',
    access: t.access === 'RW' && kind !== 'calculated' ? 'RW' : 'R',
  };
  if (typeof t.description === 'string') info.description = t.description;
  if (typeof t.unit === 'string') info.unit = t.unit;
  if (typeof t.min === 'number') info.min = t.min;
  if (typeof t.max === 'number') info.max = t.max;
  if (typeof t.valueTable === 'string') info.valueTable = t.valueTable;
  const lim = t.limits;
  if (lim !== null && typeof lim === 'object') info.limits = lim as TagInfo['limits'] & object;
  return info;
}

/** Chỉ mục TagInfo theo id, dựng lại khi danh sách Tag đổi (so theo đối tượng). */
class TagIndex {
  private readonly source: () => readonly AnyTag[];
  private last: readonly AnyTag[] | null = null;
  private map = new Map<string, TagInfo>();

  constructor(source: () => readonly AnyTag[]) {
    this.source = source;
  }

  get(id: string): TagInfo | undefined {
    const tags = this.source();
    if (tags !== this.last) {
      this.last = tags;
      this.map = new Map();
      for (const tg of tags) {
        const info = hostTagInfo(tg);
        if (info) this.map.set(info.id, info);
      }
    }
    return this.map.get(id);
  }
}

class Listeners {
  private readonly set = new Set<{
    ids: ReadonlySet<string>;
    cb: (c: readonly string[]) => void;
  }>();

  add(ids: readonly string[], cb: (c: readonly string[]) => void): () => void {
    const entry = { ids: new Set(ids), cb };
    this.set.add(entry);
    return () => void this.set.delete(entry);
  }

  notify(changed: readonly string[]): void {
    for (const l of [...this.set]) {
      const hit = changed.filter((id) => l.ids.has(id));
      if (hit.length) l.cb(hit);
    }
  }
}

const tableLookup =
  (tables: () => readonly ValueTable[]) =>
  (name: string): ValueTable | undefined =>
    tables().find((t) => (t as { name?: string }).name === name);

// ---------------------------------------------------------------------------------------------
// Mô phỏng

export interface SimSourceDeps {
  engine: SimEngine;
  tags: () => readonly AnyTag[];
  tables: () => readonly ValueTable[];
  clock?: () => number;
}

const simState = (e: SimEntry | undefined): TagState =>
  e
    ? {
        value: e.value as TagScalar,
        quality: e.quality,
        ...(e.reason !== undefined ? { reason: e.reason } : {}),
        updatedAt: e.ts,
      }
    : { value: null, quality: 'UNKNOWN' };

export class SimTagSource implements TagSource {
  private readonly deps: SimSourceDeps;
  private readonly index: TagIndex;
  readonly connection = 'live' as const;

  constructor(deps: SimSourceDeps) {
    this.deps = deps;
    this.index = new TagIndex(deps.tags);
  }

  info(id: string): TagInfo | undefined {
    return this.index.get(id);
  }

  get(id: string): TagState {
    return simState(this.deps.engine.get(id));
  }

  subscribe(ids: readonly string[], onChange: (changed: readonly string[]) => void): () => void {
    const want = new Set(ids);
    return this.deps.engine.subscribe((changes) => {
      const hit = changes.map((c) => c.id).filter((id) => want.has(id));
      if (hit.length) onChange(hit);
    });
  }

  now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  valueTable(name: string): ValueTable | undefined {
    return tableLookup(this.deps.tables)(name);
  }
}

/** Chuyển màn hình trong editor (hành động `navigate`, `popup`, `closePopup` của widget khi xem trước). */
export interface PreviewNav {
  navigate(screenId: string): void;
  openPopup(screenId: string): void;
  closePopup(): void;
}

export interface SimTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SimHostDeps {
  engine: SimEngine;
  source: TagSource;
  nav: PreviewNav;
  /** Tên tài khoản giả hiện ở hộp xác nhận (đã dịch). */
  user: string;
  timers?: SimTimers;
}

const realTimers: SimTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const NUMERIC: ReadonlySet<string> = new Set([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
]);

/**
 * Hành động khi xem trước bằng Mô phỏng: phiên operator giả; ghi vào `SimEngine` với kết quả `CONFIRMED` hoặc `REJECTED`
 * theo RW, kiểu và giới hạn (không gửi gì ra ngoài); xung bằng hẹn giờ (không có mã `PULSE` thật).
 */
export class SimActionHost implements ActionHost {
  private readonly deps: SimHostDeps;
  private readonly timers: SimTimers;

  constructor(deps: SimHostDeps) {
    this.deps = deps;
    this.timers = deps.timers ?? realTimers;
  }

  session(): SessionInfo {
    return { user: this.deps.user, role: 'operator' };
  }

  writeBlocked(): null {
    return null;
  }

  private refuse(code: string, message: string): WriteOutcome {
    return { status: 'REJECTED', code, message };
  }

  /** Kiểm trước khi ghi; trả kết quả từ chối hoặc `null`. */
  private check(spec: WriteSpec): WriteOutcome | null {
    const info = this.deps.source.info(spec.tag);
    if (!info) return this.refuse('TAG_UNKNOWN', spec.tag);
    const why = this.deps.engine.writable(spec.tag);
    if (why === 'calculated') return this.refuse('TAG_CALCULATED', spec.tag);
    if (why) return this.refuse('TAG_READONLY', spec.tag);
    const v = spec.value;
    if (NUMERIC.has(info.type)) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return this.refuse('TYPE_MISMATCH', spec.tag);
      const min = info.limits?.min;
      const max = info.limits?.max;
      if ((min !== undefined && n < min) || (max !== undefined && n > max))
        return this.refuse('OUT_OF_RANGE', spec.tag);
    }
    if (spec.expect !== undefined && this.deps.source.get(spec.tag).value !== spec.expect)
      return this.refuse('STALE_EXPECTATION', spec.tag);
    return null;
  }

  async write(spec: WriteSpec, onPhase: (o: WriteOutcome) => void): Promise<WriteOutcome> {
    const refused = this.check(spec);
    if (refused) {
      onPhase(refused);
      return refused;
    }
    onPhase({ status: 'ACCEPTED' });
    this.deps.engine.write(spec.tag, spec.value);
    if (spec.kind === 'pulse' && spec.pulseMs !== undefined && typeof spec.value === 'boolean') {
      const back = !spec.value;
      const hold = spec.pulseMs;
      await new Promise<void>((resolve) =>
        this.timers.setTimeout(() => {
          this.deps.engine.write(spec.tag, back);
          resolve();
        }, hold),
      );
    }
    const out: WriteOutcome = {
      status: 'CONFIRMED',
      readback: this.deps.source.get(spec.tag).value,
    };
    onPhase(out);
    return out;
  }

  navigate(screenId: string): void {
    this.deps.nav.navigate(screenId);
  }

  openPopup(screenId: string): void {
    this.deps.nav.openPopup(screenId);
  }

  closePopup(): void {
    this.deps.nav.closePopup();
  }

  requestLogin(): void {
    // Mô phỏng luôn có phiên giả: không có gì để đăng nhập.
  }
}

// ---------------------------------------------------------------------------------------------
// Thiết bị (phiên Online)

export interface DeviceSourceDeps {
  tags: () => readonly AnyTag[];
  tables: () => readonly ValueTable[];
  values: () => ReadonlyMap<string, LiveValue>;
  /** Tag thiết bị báo không có. */
  unknown?: () => ReadonlySet<string>;
  connection: () => 'live' | 'stale' | 'offline';
  clock?: () => number;
}

/**
 * Giá trị sống của phiên Online. Giao diện gọi `notify(ids)` khi phiên báo giá trị đổi (app.subscribeValues) và khi
 * trạng thái kết nối đổi (`notify` với mọi Tag đang đăng ký bằng `notifyAll`).
 */
export class DeviceTagSource implements TagSource {
  private readonly deps: DeviceSourceDeps;
  private readonly index: TagIndex;
  private readonly listeners = new Listeners();
  private readonly watching = new Set<string>();

  constructor(deps: DeviceSourceDeps) {
    this.deps = deps;
    this.index = new TagIndex(deps.tags);
  }

  get connection(): 'live' | 'stale' | 'offline' {
    return this.deps.connection();
  }

  info(id: string): TagInfo | undefined {
    return this.index.get(id);
  }

  get(id: string): TagState {
    const v = this.deps.values().get(id);
    if (!v) return { value: null, quality: 'UNKNOWN' };
    if (this.deps.unknown?.().has(id)) return { value: null, quality: 'UNKNOWN' };
    return {
      value: v.value as TagScalar,
      quality: (this.connection === 'live' ? v.quality : 'STALE') as Quality,
      ...(v.reason !== undefined ? { reason: v.reason } : {}),
      updatedAt: v.ts,
    };
  }

  subscribe(ids: readonly string[], onChange: (changed: readonly string[]) => void): () => void {
    for (const id of ids) this.watching.add(id);
    const off = this.listeners.add(ids, onChange);
    return () => {
      off();
    };
  }

  /** Mọi Tag đã có người đăng ký (để xin thiết bị gửi, `live-subscriptions.ts`). */
  watched(): string[] {
    return [...this.watching];
  }

  notify(ids: readonly string[]): void {
    this.listeners.notify(ids);
  }

  notifyAll(): void {
    this.listeners.notify([...this.watching]);
  }

  now(): number {
    return (this.deps.clock ?? Date.now)();
  }

  valueTable(name: string): ValueTable | undefined {
    return tableLookup(this.deps.tables)(name);
  }
}

export interface DeviceHostDeps {
  flow: Pick<WriteFlow, 'submit' | 'row' | 'subscribe' | 'reset'>;
  /** Đang làm việc với thiết bị (Online). */
  online: () => boolean;
  /** Vai trò của tài khoản đang đăng nhập; null khi chưa đăng nhập. */
  session: () => SessionInfo | null;
  /** Câu lý do khi chưa Online (đã dịch). */
  notOnlineMessage: string;
  nav: PreviewNav;
  requestLogin: () => void;
}

const FINAL_STATES = new Set(['confirmed', 'failed', 'timeout', 'rejected', 'unknown', 'relogin']);

function outcomeOf(r: RowWrite): WriteOutcome {
  const base = {
    ...(r.code !== undefined ? { code: r.code } : {}),
    ...(r.message !== undefined ? { message: r.message } : {}),
    ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}),
  };
  switch (r.state) {
    case 'confirmed':
      return {
        status: 'CONFIRMED',
        ...base,
        ...(r.readback !== undefined ? { readback: r.readback as TagScalar } : {}),
      };
    case 'failed':
      return { status: 'FAILED', ...base };
    case 'timeout':
      return { status: 'TIMEOUT', ...base };
    case 'unknown':
      return { status: 'UNKNOWN', ...base };
    case 'relogin':
      return { status: 'REJECTED', ...base, code: 'SESSION_EXPIRED' };
    default:
      return { status: 'REJECTED', ...base };
  }
}

/**
 * Hành động khi xem trước bằng Thiết bị: ghi qua `WriteFlow` của 006 (kèm `context`, `expect`, `pulseMs`, kênh `studio`);
 * khóa khi chưa Online hoặc chưa đăng nhập; không bao giờ gửi lại khi chưa rõ kết quả (do WriteFlow).
 */
export class DeviceActionHost implements ActionHost {
  private readonly deps: DeviceHostDeps;

  constructor(deps: DeviceHostDeps) {
    this.deps = deps;
  }

  session(): SessionInfo | null {
    return this.deps.online() ? this.deps.session() : null;
  }

  writeBlocked(): { code: 'SESSION_EXPIRED'; message: string } | null {
    return this.deps.online()
      ? null
      : { code: 'SESSION_EXPIRED', message: this.deps.notOnlineMessage };
  }

  write(spec: WriteSpec, onPhase: (o: WriteOutcome) => void): Promise<WriteOutcome> {
    const key = `${spec.context.screen}/${spec.context.widget}`;
    const flow = this.deps.flow;
    return new Promise<WriteOutcome>((resolve) => {
      let accepted = false;
      let settled = false;
      const check = (): void => {
        const r = flow.row(key);
        if (!r || settled) return;
        if (r.state === 'accepted' && !accepted) {
          accepted = true;
          onPhase({ status: 'ACCEPTED' });
        }
        if (FINAL_STATES.has(r.state)) {
          settled = true;
          off();
          const out = outcomeOf(r);
          onPhase(out);
          resolve(out);
        }
      };
      const off = flow.subscribe(check);
      flow.reset(key);
      void flow
        .submit([
          {
            key,
            tag: spec.tag,
            value: spec.value,
            context: spec.context,
            ...(spec.expect !== undefined ? { expect: spec.expect } : {}),
            ...(spec.kind === 'pulse' && spec.pulseMs !== undefined
              ? { pulseMs: spec.pulseMs }
              : {}),
          },
        ])
        .then(check);
    });
  }

  navigate(screenId: string): void {
    this.deps.nav.navigate(screenId);
  }

  openPopup(screenId: string): void {
    this.deps.nav.openPopup(screenId);
  }

  closePopup(): void {
    this.deps.nav.closePopup();
  }

  requestLogin(): void {
    this.deps.requestLogin();
  }
}

/** Vai trò đủ quyền ghi từ operator trở lên. */
export const canWriteRole = (role: Role | null | undefined): boolean =>
  role === 'operator' || role === 'engineer' || role === 'administrator';
