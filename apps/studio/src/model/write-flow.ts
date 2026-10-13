// Ghi từ Bảng theo dõi (feature 006, T150, US2, FR-050, FR-040, data-model §13.3, R22). Không DOM: đọc giá trị gõ vào
// (dấu chấm thập phân, INT64 lớn thành chuỗi), khóa Ghi kèm lý do, và `WriteFlow` — máy trạng thái từng dòng:
// idle → sending → accepted → confirmed | failed | timeout; rejected; unknown (mất mạng, hỏi lại theo mã, KHÔNG BAO GIỜ gửi
// lại); relogin (phiên hết hạn: đăng nhập lại rồi xác nhận lại). Mỗi lần xác nhận một mã yêu cầu UUID v4 mới.
import { reasonText } from '../app/code-text.ts';
import type { MessageKey } from '../i18n/index.ts';
import { FALSE_WORDS, TRUE_WORDS } from '../i18n/bool-words.ts';
import { isDeviceError, type ApiResult, type DeviceError } from '../platform/device-types.ts';

/** Chu kỳ hỏi kết quả ghi và thời gian hỏi tối đa (device-api §3.2). */
export const POLL_MS = 200;
export const POLL_MAX_MS = 30000;
/** Số yêu cầu tối đa mỗi POST và mỗi lần hỏi. */
export const BATCH = 16;

export interface DeviceTagDef {
  id: string;
  kind: string;
  type: string;
  access?: string;
  limits?: { min?: number; max?: number; maxLength?: number };
  scaling?: unknown;
  source?: {
    device?: string;
    address?: string;
    scanGroup?: string;
    rawType?: string;
    byteOrder?: string;
    readback?: boolean;
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Định nghĩa Tag trên BL335 từ `GET /api/v1/projects/active`; `null` khi không đọc được. */
export function deviceTagDefs(body: unknown): Map<string, DeviceTagDef> | null {
  if (!isObj(body) || !isObj(body.tags) || !Array.isArray(body.tags.tags)) return null;
  const map = new Map<string, DeviceTagDef>();
  for (const t of body.tags.tags)
    if (isObj(t) && typeof t.id === 'string') map.set(t.id, t as unknown as DeviceTagDef);
  return map;
}

// ---------- Giá trị gõ vào ----------

export type ParsedValue =
  | { ok: true; value: boolean | number | string }
  | { ok: false; error: MessageKey; hint?: string; min?: number; max?: number };

const INTS = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

export function parseWriteValue(
  raw: string,
  def: Pick<DeviceTagDef, 'type' | 'limits'>,
): ParsedValue {
  const text = raw.trim();
  if (def.type === 'STRING') {
    if (text === '' && raw === '') return { ok: false, error: 'wf.err.empty' };
    const max = def.limits?.maxLength;
    if (max !== undefined && [...raw].length > max) return { ok: false, error: 'wf.err.maxLength' };
    return { ok: true, value: raw };
  }
  if (text === '') return { ok: false, error: 'wf.err.empty' };
  if (def.type === 'BOOL') {
    const f = text.toLowerCase();
    if (TRUE_WORDS.includes(f)) return { ok: true, value: true };
    if (FALSE_WORDS.includes(f)) return { ok: true, value: false };
    return { ok: false, error: 'wf.err.bool' };
  }
  if (text.includes(',') && !text.includes('.') && NUMBER.test(text.replace(',', '.')))
    return { ok: false, error: 'wf.err.comma', hint: text.replace(',', '.') };
  if (!NUMBER.test(text)) return { ok: false, error: 'wf.err.number' };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ok: false, error: 'wf.err.number' };
  if (INTS.has(def.type)) {
    if (!/^[+-]?\d+$/.test(text)) return { ok: false, error: 'wf.err.integer' };
    if (!Number.isSafeInteger(n)) {
      if (def.type === 'INT64' || def.type === 'UINT64')
        return { ok: true, value: text.replace(/^\+/, '') };
      return { ok: false, error: 'wf.err.integer' };
    }
  }
  const { min, max } = def.limits ?? {};
  if ((min !== undefined && n < min) || (max !== undefined && n > max))
    return { ok: false, error: 'wf.err.limits', min, max };
  return { ok: true, value: n };
}

// ---------- Khóa Ghi ----------

export interface WriteLockInput {
  online: boolean;
  role: string | null;
  /** Định nghĩa trên BL335: `null` Tag không có, `undefined` chưa đọc được. */
  def: DeviceTagDef | null | undefined;
  live?: { quality: string; reason?: string };
}

export interface WriteLock {
  reason: MessageKey;
  params?: Record<string, string>;
}

/** Lý do khóa lệnh Ghi của một dòng (FR-050); `null`: ghi được (giá trị còn phải đạt kiểm tra riêng). */
export function writeLock(i: WriteLockInput): WriteLock | null {
  if (!i.online || !i.role) return { reason: 'wf.lock.offline' };
  if (!['operator', 'engineer', 'administrator'].includes(i.role))
    return { reason: 'wf.lock.role' };
  if (i.def === undefined) return { reason: 'wf.lock.noDefinition' };
  if (i.def === null) return { reason: 'wf.lock.notOnDevice' };
  if (i.def.kind === 'calculated' || i.def.access !== 'RW') return { reason: 'wf.lock.readonly' };
  if (i.live?.quality === 'BAD')
    return {
      reason: 'wf.lock.badConnection',
      params: { reason: i.live.reason ? reasonText(i.live.reason) : '' },
    };
  return null;
}

// ---------- WriteFlow ----------

export type WriteState =
  | 'idle'
  | 'sending'
  | 'accepted'
  | 'confirmed'
  | 'failed'
  | 'timeout'
  | 'rejected'
  | 'unknown'
  | 'relogin';

export interface RowWrite {
  key: string;
  tag: string;
  requestId: string;
  value: boolean | number | string;
  state: WriteState;
  phase?: 'queued' | 'sent' | 'readback';
  code?: string;
  message?: string;
  readback?: unknown;
  exception?: { code: string; meaning: string };
  retryAfterMs?: number;
  /** Giá trị cũ lúc BL335 nhận. */
  old?: { value: unknown; quality: string };
  raw?: unknown;
  sentAt: number;
  /** Thời điểm (ms) trạng thái đổi lần gần nhất: hiện cạnh kết quả của dòng. */
  at: number;
  /** Mở rộng của device-api 1.2 (feature 007, xem trước màn hình ở chế độ Thiết bị): xung, kỳ vọng, nơi gọi. */
  pulseMs?: number;
  expect?: boolean;
  context?: { screen: string; widget: string };
  /** Trạng thái đã ghi nhận ở lần phát gần nhất (để đóng dấu `at`). */
  seen?: WriteState;
}

export interface WriteItem {
  key: string;
  tag: string;
  value: boolean | number | string;
  /** Device-api 1.2: giữ giá trị `pulseMs` ms rồi đảo lại (Tag BOOL). */
  pulseMs?: number;
  /** Device-api 1.2: chỉ ghi khi giá trị hiện tại của Tag BOOL bằng `expect`. */
  expect?: boolean;
  /** Device-api 1.2: màn hình và widget gọi lệnh (vào audit). */
  context?: { screen: string; widget: string };
}

export interface WriteDeps {
  post(path: string, body: object): Promise<ApiResult | DeviceError>;
  get(path: string, query?: Record<string, string>): Promise<ApiResult | DeviceError>;
  uuid?: () => string;
  /** Phiên hết hạn: giao diện hỏi đăng nhập lại. */
  onRelogin?: () => void;
}

const SESSION_CODES = new Set(['SESSION_EXPIRED', 'SESSION_INVALID', 'AUTH_REQUIRED']);
const SESSION_ERRORS = new Set(['session-expired', 'session-invalid', 'auth-required']);

const randomUuid = (): string => crypto.randomUUID();

const FINAL: Readonly<Record<string, WriteState>> = {
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  REJECTED: 'rejected',
};

export class WriteFlow {
  private readonly deps: WriteDeps;
  private readonly rows = new Map<string, RowWrite>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiters: Array<() => void> = [];

  constructor(deps: WriteDeps) {
    this.deps = deps;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(): void {
    const now = Date.now();
    for (const r of this.rows.values())
      if (r.state !== r.seen) Object.assign(r, { seen: r.state, at: now });
    for (const l of [...this.listeners]) l();
  }

  row(key: string): RowWrite | undefined {
    return this.rows.get(key);
  }

  /** Còn dòng đang gửi hoặc chờ kết quả. */
  get busy(): boolean {
    return [...this.rows.values()].some((r) => r.state === 'sending' || r.state === 'accepted');
  }

  /** Còn dòng chưa rõ kết quả (mất mạng, hết hạn hỏi). */
  get unknownCount(): number {
    return [...this.rows.values()].filter((r) => r.state === 'unknown').length;
  }

  /** Chờ tới khi không còn dòng đang gửi hoặc chờ. */
  settled(): Promise<void> {
    return this.busy ? new Promise((resolve) => this.waiters.push(resolve)) : Promise.resolve();
  }

  /**
   * Kết quả ghi vào Mô phỏng (feature 006, FR-052): ghi tại chỗ, không qua thiết bị, không đăng nhập, không audit. `message`
   * (chữ đã dịch) khi bị từ chối trước khi ghi.
   */
  recordLocal(
    it: WriteItem | { key: string; tag: string },
    outcome: { ok: true } | { ok: false; message: string },
  ): void {
    const now = Date.now();
    const row: RowWrite = {
      key: it.key,
      tag: it.tag,
      requestId: 'simulation',
      value: 'value' in it ? it.value : '',
      state: outcome.ok ? 'confirmed' : 'rejected',
      ...(outcome.ok ? { code: 'SIMULATED' } : { message: outcome.message }),
      sentAt: now,
      at: now,
    };
    this.rows.set(it.key, row);
    this.emit();
  }

  /** Bỏ trạng thái ghi của một dòng (người dùng đóng kết quả). */
  reset(key: string): void {
    if (this.rows.delete(key)) this.emit();
  }

  resetAll(): void {
    this.rows.clear();
    this.emit();
  }

  /** Đã đăng nhập lại: các dòng `relogin` về `idle`; phải xác nhận lại để ghi (US2-11). */
  loggedIn(): void {
    let changed = false;
    for (const [k, r] of this.rows) {
      if (r.state === 'relogin') {
        this.rows.delete(k);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /**
   * Gửi các lệnh ghi đã được người dùng xác nhận. Dòng đang gửi, đang chờ hoặc chưa rõ kết quả không nhận lần ghi mới
   * (chưa rõ: hỏi lại theo mã, hoặc đóng kết quả cũ trước).
   */
  async submit(items: readonly WriteItem[]): Promise<void> {
    const uuid = this.deps.uuid ?? randomUuid;
    const fresh: RowWrite[] = [];
    for (const it of items) {
      const cur = this.rows.get(it.key);
      if (cur && (cur.state === 'sending' || cur.state === 'accepted' || cur.state === 'unknown'))
        continue;
      const row: RowWrite = {
        key: it.key,
        tag: it.tag,
        value: it.value,
        requestId: uuid(),
        state: 'sending',
        sentAt: Date.now(),
        at: Date.now(),
        ...(it.pulseMs !== undefined ? { pulseMs: it.pulseMs } : {}),
        ...(it.expect !== undefined ? { expect: it.expect } : {}),
        ...(it.context ? { context: it.context } : {}),
      };
      this.rows.set(it.key, row);
      fresh.push(row);
    }
    if (!fresh.length) return;
    this.emit();
    for (let i = 0; i < fresh.length; i += BATCH) await this.send(fresh.slice(i, i + BATCH));
    this.schedule();
  }

  private async send(chunk: RowWrite[]): Promise<void> {
    let res: ApiResult | DeviceError;
    try {
      res = await this.deps.post('/api/v1/tags/write', {
        requests: chunk.map((r) => ({
          requestId: r.requestId,
          tag: r.tag,
          value: r.value,
          ...(r.expect !== undefined ? { expect: r.expect } : {}),
          ...(r.pulseMs !== undefined ? { pulseMs: r.pulseMs } : {}),
          ...(r.context ? { context: r.context } : {}),
        })),
      });
    } catch {
      res = { error: 'unreachable' };
    }
    if (isDeviceError(res)) {
      if (SESSION_ERRORS.has(res.error)) this.relogin(chunk);
      else this.markAll(chunk, 'unknown', { code: 'UNKNOWN_OUTCOME' });
      this.emit();
      return;
    }
    const body = isObj(res.body) ? res.body : {};
    const results = Array.isArray(body.results) ? body.results.filter(isObj) : [];
    if (!results.length) {
      // Không có kết quả từng dòng (400, 413, 403 không kèm results): cả lô bị từ chối.
      const code = typeof body.error === 'string' ? body.error : String(res.status);
      if (SESSION_CODES.has(code)) this.relogin(chunk);
      else
        this.markAll(chunk, 'rejected', {
          code,
          message: typeof body.message === 'string' ? body.message : undefined,
        });
      this.emit();
      return;
    }
    let needLogin = false;
    for (const row of chunk) {
      const r = results.find((x) => x.requestId === row.requestId);
      if (!r) {
        // BL335 không trả dòng này: coi như chưa rõ, hỏi lại theo mã.
        Object.assign(row, { state: 'unknown' as const, code: 'UNKNOWN_OUTCOME' });
        continue;
      }
      if (r.status === 'REJECTED' && typeof r.reason === 'string' && SESSION_CODES.has(r.reason)) {
        needLogin = true;
        continue;
      }
      this.apply(row, r);
    }
    if (needLogin)
      this.relogin(
        chunk.filter((c) =>
          results.some(
            (x) =>
              x.requestId === c.requestId &&
              x.status === 'REJECTED' &&
              SESSION_CODES.has(String(x.reason)),
          ),
        ),
      );
    this.emit();
  }

  private relogin(chunk: RowWrite[]): void {
    for (const r of chunk) Object.assign(r, { state: 'relogin' as const, code: 'SESSION_EXPIRED' });
    this.deps.onRelogin?.();
  }

  private markAll(chunk: RowWrite[], state: WriteState, extra: Partial<RowWrite>): void {
    for (const r of chunk) Object.assign(r, { state }, extra);
  }

  /** Áp một phần tử `results` vào dòng. */
  private apply(row: RowWrite, r: Record<string, unknown>): void {
    const status = String(r.status);
    delete row.phase;
    if (status === 'ACCEPTED') {
      row.state = 'accepted';
      if (r.phase === 'queued' || r.phase === 'sent' || r.phase === 'readback') row.phase = r.phase;
      if (isObj(r.old)) row.old = { value: r.old.value, quality: String(r.old.quality ?? '') };
      if (r.raw !== undefined) row.raw = r.raw;
      return;
    }
    if (status === 'UNKNOWN') {
      row.state = 'unknown';
      row.code = 'NO_SUCH_REQUEST';
      return;
    }
    row.state = FINAL[status] ?? 'unknown';
    row.code =
      typeof r.code === 'string' ? r.code : typeof r.reason === 'string' ? r.reason : undefined;
    if (typeof r.message === 'string') row.message = r.message;
    if (r.readback !== undefined) row.readback = r.readback;
    if (isObj(r.exception))
      row.exception = {
        code: String(r.exception.code ?? ''),
        meaning: String(r.exception.meaning ?? ''),
      };
    if (typeof r.retryAfterMs === 'number') row.retryAfterMs = r.retryAfterMs;
    if (isObj(r.old)) row.old = { value: r.old.value, quality: String(r.old.quality ?? '') };
  }

  // ---------- Hỏi kết quả ----------

  private schedule(): void {
    if (this.timer || !this.busy) {
      if (!this.busy) this.release();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, POLL_MS);
  }

  private release(): void {
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
  }

  private async poll(): Promise<void> {
    const now = Date.now();
    const active = [...this.rows.values()].filter((r) => r.state === 'accepted');
    for (const r of active) {
      if (now - r.sentAt > POLL_MAX_MS) {
        r.state = 'unknown';
        r.code = 'UNKNOWN_OUTCOME';
      }
    }
    await this.ask(active.filter((r) => r.state === 'accepted'));
    this.emit();
    this.schedule();
  }

  /** Hỏi kết quả theo mã yêu cầu (không bao giờ POST). */
  private async ask(rows: RowWrite[]): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      let res: ApiResult | DeviceError;
      try {
        res = await this.deps.get('/api/v1/tags/write', {
          ids: chunk.map((r) => r.requestId).join(','),
        });
      } catch {
        res = { error: 'unreachable' };
      }
      if (isDeviceError(res)) {
        if (SESSION_ERRORS.has(res.error)) this.relogin(chunk);
        else
          this.markAll(chunk, 'unknown', {
            code: res.error === 'no-such-request' ? 'NO_SUCH_REQUEST' : 'UNKNOWN_OUTCOME',
          });
        continue;
      }
      const body = isObj(res.body) ? res.body : {};
      const results = Array.isArray(body.results) ? body.results.filter(isObj) : [];
      for (const row of chunk) {
        const r = results.find((x) => x.requestId === row.requestId);
        if (r) this.apply(row, r);
        else Object.assign(row, { state: 'unknown' as const, code: 'UNKNOWN_OUTCOME' });
      }
    }
  }

  /** Có mạng lại: hỏi kết quả của các dòng chưa rõ, theo mã yêu cầu; không gửi lại lệnh nào. */
  async recheck(): Promise<void> {
    const rows = [...this.rows.values()].filter((r) => r.state === 'unknown');
    if (!rows.length) return;
    for (const r of rows) r.sentAt = Date.now();
    await this.ask(rows);
    this.emit();
    this.schedule();
  }
}

// ---------- Khác biệt giữa định nghĩa trên máy và trên BL335 ----------

export interface DefDifference {
  /** Tên trường của Tag (`type`, `source.address`, `limits`…). */
  field: string;
  local: string;
  device: string;
}

const same = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/**
 * Trường của Tag ảnh hưởng tới lệnh ghi mà bản trên máy khác bản đang chạy trên BL335 (hộp xác nhận cảnh báo, FR-050):
 * kiểu, quyền, thiết bị trường, địa chỉ, kiểu thô, thứ tự byte, thang đo, giới hạn ghi. Nhóm quét mặc định `normal`.
 */
export function diffDefs(local: DeviceTagDef | undefined, device: DeviceTagDef): DefDifference[] {
  if (!local) return [];
  const l = local as unknown as Record<string, unknown>;
  const d = device as unknown as Record<string, unknown>;
  const ls = (l.source ?? {}) as Record<string, unknown>;
  const ds = (d.source ?? {}) as Record<string, unknown>;
  const pairs: Array<[string, unknown, unknown]> = [
    ['type', l.type, d.type],
    ['access', l.access ?? 'R', d.access ?? 'R'],
    ['source.device', ls.device, ds.device],
    ['source.address', ls.address, ds.address],
    ['source.scanGroup', ls.scanGroup ?? 'normal', ds.scanGroup ?? 'normal'],
    ['source.rawType', ls.rawType ?? l.type, ds.rawType ?? d.type],
    ['source.byteOrder', ls.byteOrder, ds.byteOrder],
    ['scaling', l.scaling, d.scaling],
    ['limits', l.limits, d.limits],
  ];
  return pairs
    .filter(([, a, b]) => same(a) !== same(b))
    .map(([field, a, b]) => ({ field, local: same(a), device: same(b) }));
}

// ---------- Kế hoạch ghi (hộp xác nhận) ----------

export interface WriteRowInput {
  /** Khóa dòng trong WriteFlow. */
  key: string;
  tag: string;
  /** Chữ người dùng đã gõ ở ô Giá trị ghi. */
  text: string;
}

export interface WriteDraftItem {
  key: string;
  tag: string;
  text: string;
  /** Định nghĩa trên BL335: \`null\` Tag không có, \`undefined\` chưa đọc được. */
  def: DeviceTagDef | null | undefined;
  /** Chỗ khác nhau giữa bản trên máy và bản trên BL335. */
  differences: DefDifference[];
  /** Giá trị đã hiểu (chỉ có khi ghi được). */
  value?: boolean | number | string;
  /** Lý do khóa (không gửi được) hoặc lỗi giá trị: không có khi ghi được. */
  blocked?: { reason: MessageKey; params?: Record<string, string | number> };
  /** Giá trị sống hiện tại (chữ đã định dạng), đơn vị. */
  current: string;
  unit: string;
}

export interface WriteDraft {
  items: WriteDraftItem[];
  /** Số dòng sẽ được gửi. */
  sendable: number;
}

export interface WritePlanContext {
  online: boolean;
  role: string | null;
  defs: ReadonlyMap<string, DeviceTagDef> | null | undefined;
  /** Định nghĩa Tag trên máy (project đang mở). */
  local: ReadonlyMap<string, DeviceTagDef>;
  /** Giá trị sống hiện tại của Tag (chữ), kèm quality và lý do; \`null\` chưa có. */
  live(tag: string): { text: string; quality: string; reason?: string } | null;
}

/**
 * Dựng bản xem trước của lệnh ghi: mỗi dòng được khóa (kèm lý do) hoặc hiểu được giá trị (dấu chấm thập phân, giới hạn
 * theo định nghĩa trên BL335). Chỉ các dòng không bị khóa mới được gửi sau khi người dùng xác nhận.
 */
export function planWrite(rows: readonly WriteRowInput[], c: WritePlanContext): WriteDraft {
  const items = rows.map((r): WriteDraftItem => {
    const def =
      c.defs === undefined || c.defs === null
        ? (c.defs as undefined | null)
        : (c.defs.get(r.tag) ?? null);
    const local = c.local.get(r.tag);
    const live = c.live(r.tag);
    const item: WriteDraftItem = {
      key: r.key,
      tag: r.tag,
      text: r.text,
      def,
      differences: def ? diffDefs(local, def) : [],
      current: live?.text ?? '',
      unit:
        typeof (local as { unit?: unknown } | undefined)?.unit === 'string'
          ? String((local as { unit?: unknown }).unit)
          : '',
    };
    const lock = writeLock({
      online: c.online,
      role: c.role,
      def,
      live: live
        ? { quality: live.quality, ...(live.reason !== undefined ? { reason: live.reason } : {}) }
        : undefined,
    });
    if (lock) {
      item.blocked = lock;
      return item;
    }
    const parsed = parseWriteValue(r.text, def as DeviceTagDef);
    if (!parsed.ok) {
      let reason: MessageKey = parsed.error;
      if (parsed.error === 'wf.err.limits')
        reason =
          parsed.min !== undefined && parsed.max !== undefined
            ? 'wf.err.limitsRange'
            : parsed.min !== undefined
              ? 'wf.err.limitsMin'
              : 'wf.err.limitsMax';
      item.blocked = {
        reason,
        params: { hint: parsed.hint ?? '', min: parsed.min ?? '', max: parsed.max ?? '' },
      };
      return item;
    }
    item.value = parsed.value;
    return item;
  });
  return { items, sendable: items.filter((i) => i.value !== undefined && !i.blocked).length };
}

/**
 * Kế hoạch ghi vào Mô phỏng: cùng kiểm tra kiểu, giới hạn, quyền `RW`, Tag tính toán như ghi lên thiết bị, trên định nghĩa
 * Tag của project đang mở (không có đăng nhập, role hay thiết bị). Tag không có trong project có lý do riêng.
 */
export function planSimWrite(
  rows: readonly WriteRowInput[],
  local: ReadonlyMap<string, DeviceTagDef>,
): WriteDraft {
  const draft = planWrite(rows, {
    online: true,
    role: 'operator',
    defs: local,
    local,
    live: () => null,
  });
  for (const item of draft.items)
    if (item.def === null) item.blocked = { reason: 'wf.lock.notInProject' };
  return {
    items: draft.items,
    sendable: draft.items.filter((i) => i.value !== undefined && !i.blocked).length,
  };
}
