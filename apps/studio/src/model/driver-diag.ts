// Chẩn đoán driver (feature 006, T198, FR-051, FR-029, R22; device-api-1.1 §5): đọc `GET /api/v1/drivers/diagnostics`, hỏi mỗi 2 s
// chỉ khi trang đang mở (`DriverDiagFeed.start/stop`), giữ bản đầu của lần mở để hiện phần tăng thêm (US5-4), dựng các dòng
// số đếm, chu kỳ thực và Tag xấu. Hàm thuần và máy trạng thái, không DOM.
import { reasonText } from '../app/code-text.ts';
import { hasKey, t } from '../i18n/index.ts';
import { mcEndCode } from './mc.ts';
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
  /** Thông số đã thương lượng của kênh (S7: `pduSize`, `localTsap`, `remoteTsap`); `null` khi thiết bị không gửi. */
  details: Record<string, string> | null;
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

/** Đối tượng chỉ gồm giá trị chữ (bỏ giá trị khác); không phải đối tượng hay rỗng thì `null`. */
const strings = (v: unknown): Record<string, string> | null => {
  if (!isObject(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, s] of Object.entries(v)) if (typeof s === 'string') out[k] = s;
  return Object.keys(out).length ? out : null;
};

/**
 * Một mã lỗi PLC trong `exceptions` của CPU S7 (contracts/s7-driver.md §5): mã trả về của item (1, 3, 5, 6, 7, 10) viết 2 chữ số
 * hex, lỗi đầu khung (lớp·256 + mã, ví dụ 33028) viết 4 chữ số hex, kèm tên: "03 truy cập bị từ chối", "8104 chưa bật PUT/GET".
 */
export function s7ExceptionText(code: string): string {
  // khóa hex như Modbus: "03", "0A", "8104" (lỗi đầu khung)
  const n = /^[0-9A-Fa-f]{2,4}$/.test(code) ? parseInt(code, 16) : NaN;
  if (!Number.isFinite(n)) return `${code} ${t('s7Ex.other')}`;
  const hex = n
    .toString(16)
    .toUpperCase()
    .padStart(n > 255 ? 4 : 2, '0');
  const key = `s7Ex.${n}`;
  return `${hex} ${hasKey(key) ? t(key) : t('s7Ex.other')}`;
}

/**
 * Dòng thông tin của kênh OPC UA (specs/019-driver-opcua/contracts/opcua.md §3) theo thứ tự hiện: khóa và giá trị; khóa lạ
 * bỏ qua, giá trị rỗng bỏ qua.
 */
export const OPCUA_DETAIL_KEYS = [
  'endpointUrl',
  'securityMode',
  'securityPolicy',
  'readMode',
  'session',
  'publishingMs',
  'serverCertSha256',
  'clientCertSha256',
  'lastStatus',
] as const;

export function opcuaDetailRows(
  details: Record<string, string> | null,
): Array<{ key: (typeof OPCUA_DETAIL_KEYS)[number]; value: string }> {
  if (!details) return [];
  return OPCUA_DETAIL_KEYS.filter((k) => details[k]).map((k) => ({ key: k, value: details[k] }));
}

/** Dòng thông tin của kênh MQTT (feature 022): broker, TLS, client id, số subscription, nhóm, số tin vào/ra/bỏ. */
export const MQTT_DETAIL_KEYS = [
  'broker',
  'tls',
  'clientId',
  'subscriptions',
  'groups',
  'messagesIn',
  'messagesOut',
  'dropped',
  'serverCertSha256',
] as const;

export function mqttDetailRows(
  details: Record<string, string> | null,
): Array<{ key: (typeof MQTT_DETAIL_KEYS)[number]; value: string }> {
  if (!details) return [];
  return MQTT_DETAIL_KEYS.filter((k) => details[k]).map((k) => ({ key: k, value: details[k] }));
}

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
    details: strings(v.details),
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

// ---------- Kênh Mitsubishi MC (feature 017, contracts/mc-protocol.md §4) ----------

/**
 * Nhãn của dòng `exception:{mã}`: Modbus "Exception 02"; S7 tên lỗi; FINS mã kết thúc; kênh MC đếm theo end code (số thập phân trong JSON) nên hiện hex
 * kèm nghĩa ngắn: `C056` → "End code C056: địa chỉ hoặc số điểm ngoài vùng".
 */
export function exceptionLabel(code: string, channelKind: string): string {
  // BACnet/IP (feature 020): error:31, reject:9, abort:4
  const bac = /^(error|reject|abort):(d+)$/.exec(code);
  if (bac)
    return t(
      bac[1] === 'error'
        ? 'dd.row.bacnetError'
        : bac[1] === 'reject'
          ? 'dd.row.bacnetReject'
          : 'dd.row.bacnetAbort',
      { code: bac[2]! },
    );
  // CPU S7 (feature 016): mã lỗi PLC (item hay đầu khung), tên S7 thay cho exception Modbus
  if (channelKind === 's7') return t('dd.row.s7item', { code: s7ExceptionText(code) });
  if (channelKind === 'mc') {
    const e = mcEndCode(code);
    return t('dd.row.mcEndCode', { code: e.hex, meaning: t(`mc.end.${e.reason}`) });
  }
  // Omron FINS (feature 018): mã kết thúc bốn chữ số hex; Modbus: exception hai chữ số
  return t(code.length === 4 ? 'dd.row.endCode' : 'dd.row.exception', { code });
}

/** Loại kênh chứa thiết bị trường `deviceId` trong bản chẩn đoán (rỗng khi không thấy). */
export function channelKindOf(data: DriverDiag | null | undefined, deviceId: string): string {
  return data?.channels.find((c) => c.devices.some((d) => d.id === deviceId))?.kind ?? '';
}
