// Chẩn đoán driver (feature 006, T198, FR-051, FR-029, R22; device-api-1.1 §5): đọc `GET /api/v1/drivers/diagnostics`, hỏi mỗi 2 s
// chỉ khi trang đang mở (`DriverDiagFeed.start/stop`), giữ bản đầu của lần mở để hiện phần tăng thêm (US5-4), dựng các dòng
// số đếm, chu kỳ thực và Tag xấu. Hàm thuần và máy trạng thái, không DOM.
import { reasonText } from '../app/code-text.ts';
import { isDeviceError, type ApiResult, type DeviceError } from '../platform/device-types.ts';

/** Chu kỳ hỏi (FR-051: cập nhật ít nhất 2 s một lần). */
export const DRIVER_DIAG_PERIOD_MS = 2000;
/** Số Tag xấu tối đa thiết bị trả. */
export const MAX_BAD_TAGS = 500;

export interface DiagGroupView {
  group: string;
  periodMs: number;
  actualMs: { avg: number; max: number };
  overruns: number;
  overloaded: boolean;
}

export interface DiagDeviceView {
  id: string;
  name: string;
  state: string;
  requestsOk: number;
  timeouts: number;
  exceptions: Record<string, number>;
  badFrames: {
    crc: number;
    format: number;
    tid: number;
    unit: number;
    length: number;
    echo: number;
  };
  responseMs: { avg: number; max: number };
  groups: DiagGroupView[];
  writes: { confirmed: number; failed: number; timeout: number; rejected: number };
}

export interface DiagChannelView {
  id: string;
  name: string;
  kind: string;
  state: string;
  lastError: { code: string; at: number; device: string } | null;
  reconnects: number;
  warnings: string[];
  devices: DiagDeviceView[];
}

export interface BadTagView {
  id: string;
  quality: string;
  reason: string;
  detail: string | null;
  updatedAt: number;
}

export interface DriverDiag {
  at: number;
  runtimeStartedAt: number;
  scanGroups: Record<string, number>;
  channels: DiagChannelView[];
  badTags: BadTagView[];
  badTagsTruncated: boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
/** Số hữu hạn không âm; không thì 0 (thiết bị mới hơn Studio có thể thêm trường lạ, không làm trang vỡ). */
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isObject(v)) for (const [k, n] of Object.entries(v)) out[k] = num(n);
  return out;
};

function parseDevice(v: unknown): DiagDeviceView | null {
  if (!isObject(v) || typeof v.id !== 'string') return null;
  const bf = isObject(v.badFrames) ? v.badFrames : {};
  const rm = isObject(v.responseMs) ? v.responseMs : {};
  const wr = isObject(v.writes) ? v.writes : {};
  const groups: DiagGroupView[] = [];
  for (const g of Array.isArray(v.groups) ? v.groups : []) {
    if (!isObject(g) || typeof g.group !== 'string') continue;
    const a = isObject(g.actualMs) ? g.actualMs : {};
    groups.push({
      group: g.group,
      periodMs: num(g.periodMs),
      actualMs: { avg: num(a.avg), max: num(a.max) },
      overruns: num(g.overruns),
      overloaded: g.overloaded === true,
    });
  }
  return {
    id: v.id,
    name: str(v.name, v.id),
    state: str(v.state),
    requestsOk: num(v.requestsOk),
    timeouts: num(v.timeouts),
    exceptions: counts(v.exceptions),
    badFrames: {
      crc: num(bf.crc),
      format: num(bf.format),
      tid: num(bf.tid),
      unit: num(bf.unit),
      length: num(bf.length),
      echo: num(bf.echo),
    },
    responseMs: { avg: num(rm.avg), max: num(rm.max) },
    groups,
    writes: {
      confirmed: num(wr.confirmed),
      failed: num(wr.failed),
      timeout: num(wr.timeout),
      rejected: num(wr.rejected),
    },
  };
}

function parseChannel(v: unknown): DiagChannelView | null {
  if (!isObject(v) || typeof v.id !== 'string') return null;
  const le = v.lastError;
  return {
    id: v.id,
    name: str(v.name, v.id),
    kind: str(v.kind),
    state: str(v.state),
    lastError:
      isObject(le) && typeof le.code === 'string'
        ? { code: le.code, at: num(le.at), device: str(le.device) }
        : null,
    reconnects: num(v.reconnects),
    warnings: (Array.isArray(v.warnings) ? v.warnings : []).filter(
      (w): w is string => typeof w === 'string',
    ),
    devices: (Array.isArray(v.devices) ? v.devices : [])
      .map(parseDevice)
      .filter((d): d is DiagDeviceView => d !== null),
  };
}

/** Đọc thân của `GET /api/v1/drivers/diagnostics`; thiếu `at` hay `channels` thì `null`. */
export function parseDriverDiag(body: unknown): DriverDiag | null {
  if (!isObject(body) || typeof body.at !== 'number' || !Array.isArray(body.channels)) return null;
  const badTags: BadTagView[] = [];
  for (const b of Array.isArray(body.badTags) ? body.badTags : []) {
    if (!isObject(b) || typeof b.id !== 'string' || typeof b.reason !== 'string') continue;
    if (badTags.length >= MAX_BAD_TAGS) break;
    badTags.push({
      id: b.id,
      quality: str(b.quality, 'BAD'),
      reason: b.reason,
      detail: typeof b.detail === 'string' ? b.detail : null,
      updatedAt: num(b.updatedAt),
    });
  }
  return {
    at: num(body.at),
    runtimeStartedAt: num(body.runtimeStartedAt),
    scanGroups: counts(body.scanGroups),
    channels: body.channels.map(parseChannel).filter((c): c is DiagChannelView => c !== null),
    badTags,
    badTagsTruncated: body.badTagsTruncated === true,
  };
}

// ---------- Dòng hiển thị ----------

export interface CounterRow {
  /** `requestsOk`, `timeouts`, `exception:{mã}`, `badFrames`, `responseMs`, `writes`. */
  key: string;
  /** Tổng từ lúc runtime chạy (chữ). */
  total: string;
  /** Phần tăng từ lúc mở trang; `null` với số liệu không cộng dồn (trả lời trung bình, lớn nhất). */
  delta: number | null;
}

/** Hiệu của bộ đếm; bộ đếm giảm (runtime chạy lại) thì phần tăng là giá trị hiện tại. */
const grow = (cur: number, base: number | undefined): number =>
  base === undefined ? 0 : cur >= base ? cur - base : cur;

/**
 * Các dòng số đếm của một thiết bị trường (FR-029) cùng phần tăng thêm từ lúc mở trang so với bản đầu. Không có bản đầu của
 * thiết bị này thì phần tăng là 0.
 */
export function counterRows(
  d: DiagDeviceView,
  base: DiagDeviceView | null | undefined,
): CounterRow[] {
  const b = base ?? undefined;
  const rows: CounterRow[] = [
    { key: 'requestsOk', total: String(d.requestsOk), delta: grow(d.requestsOk, b?.requestsOk) },
    { key: 'timeouts', total: String(d.timeouts), delta: grow(d.timeouts, b?.timeouts) },
  ];
  for (const code of Object.keys(d.exceptions).sort())
    rows.push({
      key: `exception:${code}`,
      total: String(d.exceptions[code]),
      delta: grow(d.exceptions[code]!, b ? (b.exceptions[code] ?? 0) : undefined),
    });
  const kinds = ['crc', 'format', 'tid', 'unit', 'length', 'echo'] as const;
  rows.push({
    key: 'badFrames',
    total: kinds.map((k) => d.badFrames[k]).join('/'),
    delta: kinds.reduce((n, k) => n + grow(d.badFrames[k], b?.badFrames[k]), 0),
  });
  rows.push({
    key: 'responseMs',
    total: `${Math.round(d.responseMs.avg * 10) / 10} / ${Math.round(d.responseMs.max)}`,
    delta: null,
  });
  const w = ['confirmed', 'failed', 'timeout', 'rejected'] as const;
  rows.push({
    key: 'writes',
    total: w.map((k) => d.writes[k]).join('/'),
    delta: w.reduce((n, k) => n + grow(d.writes[k], b?.writes[k]), 0),
  });
  return rows;
}

export interface GroupRow {
  group: string;
  periodMs: number;
  avgMs: number;
  maxMs: number;
  overruns: number;
  /** Chu kỳ thực vượt chu kỳ đặt (US5-3): dấu quá tải. */
  overloaded: boolean;
}

export function groupRows(d: DiagDeviceView): GroupRow[] {
  return d.groups.map((g) => ({
    group: g.group,
    periodMs: g.periodMs,
    avgMs: g.actualMs.avg,
    maxMs: g.actualMs.max,
    overruns: g.overruns,
    overloaded: g.overloaded,
  }));
}

export interface BadTagLine {
  id: string;
  quality: string;
  /** Lý do bằng tiếng Việt; Tag tính toán kèm đầu vào xấu. */
  reason: string;
  at: number;
}

export function badTagLine(b: BadTagView): BadTagLine {
  const base = reasonText(b.reason);
  const reason = b.reason === 'INPUT_BAD' && b.detail ? `${base}: ${b.detail}` : base;
  return { id: b.id, quality: b.quality, reason, at: b.updatedAt };
}

// ---------- Nguồn dữ liệu ----------

export interface DriverDiagState {
  /** Bản mới nhất hỏi được. */
  data: DriverDiag | null;
  /** Bản đầu của lần mở trang: gốc để tính phần tăng. */
  baseline: DriverDiag | null;
  /** Thời điểm nhận bản `data` (ms theo giờ máy này). */
  receivedAt: number | null;
  /** Mã lỗi của lần hỏi gần nhất (`unreachable`, `forbidden`, `bad-response`…); `null` khi lần đó được. */
  error: string | null;
}

export interface DriverDiagDeps {
  /** `GET /api/v1/drivers/diagnostics` qua kết nối online. */
  get(): Promise<ApiResult | DeviceError>;
  now(): number;
  onChange(state: DriverDiagState): void;
}

const EMPTY: DriverDiagState = { data: null, baseline: null, receivedAt: null, error: null };

export class DriverDiagFeed {
  private st: DriverDiagState = EMPTY;
  private readonly deps: DriverDiagDeps;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending = false;
  /** Tăng mỗi lần dừng hoặc bắt đầu: trả lời của lần chạy cũ bị bỏ. */
  private epoch = 0;

  constructor(deps: DriverDiagDeps) {
    this.deps = deps;
  }

  get state(): DriverDiagState {
    return this.st;
  }

  get active(): boolean {
    return this.timer !== null;
  }

  /** Bắt đầu hỏi (trang mở): hỏi ngay, rồi mỗi 2 s. Bản đầu của lần mở là bản nhận được đầu tiên. */
  start(): void {
    if (this.timer !== null) return;
    this.epoch++;
    this.st = EMPTY;
    this.timer = setInterval(() => void this.poll(), DRIVER_DIAG_PERIOD_MS);
    void this.poll();
  }

  /** Dừng (trang đóng, rời Online): bỏ số liệu và bản đầu. */
  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.epoch++;
    this.pending = false;
    this.set(EMPTY);
  }

  /** Lấy bản hiện tại làm bản đầu: phần tăng tính lại từ bây giờ. */
  rebaseline(): void {
    if (!this.st.data) return;
    this.set({ ...this.st, baseline: this.st.data });
  }

  private set(next: DriverDiagState): void {
    this.st = next;
    this.deps.onChange(next);
  }

  private async poll(): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    const epoch = this.epoch;
    let res: ApiResult | DeviceError;
    try {
      res = await this.deps.get();
    } catch (e) {
      res = { error: e instanceof Error ? e.message : 'unreachable' };
    }
    if (epoch !== this.epoch) return;
    this.pending = false;
    if (isDeviceError(res)) {
      this.set({ ...this.st, error: res.error });
      return;
    }
    const data = parseDriverDiag(res.body);
    if (!data) {
      this.set({ ...this.st, error: 'bad-response' });
      return;
    }
    this.set({
      data,
      baseline: this.st.baseline ?? data,
      receivedAt: this.deps.now(),
      error: null,
    });
  }
}
