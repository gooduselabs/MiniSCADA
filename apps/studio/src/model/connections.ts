// Mô hình form Kết nối và Thử kết nối (feature 006, T128, FR-030, FR-044, data-model §2, device-api §4). Không DOM:
// bảng trường theo loại kênh (nhóm, mặc định, khoảng, trợ giúp), sửa một trường thành đối tượng mới hoặc lỗi tại ô,
// kênh và thiết bị trường mới, và bộ chạy Thử kết nối (khóa kèm lý do, mỗi lúc một lần, bảng cách hiểu). Studio không
// bao giờ tự kết nối tới thiết bị trường: lần thử đi qua `DeviceLink.post` tới BL335.
import { interpretRegisters, type InterpretRow } from '@mat/tag-codec';
import type { Channel, FieldDevice, TagV1 } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import { FALSE_WORDS, TRUE_WORDS } from '../i18n/bool-words.ts';
import { isDeviceError, type ApiResult, type DeviceError } from '../platform/device-types.ts';

export type ChannelKind = 'modbus-tcp' | 'modbus-rtu';
export type FieldGroup = 'basic' | 'advanced';
export type Obj = Record<string, unknown>;

export interface FieldSpec {
  key: string;
  target: 'channel' | 'device';
  /** Đường tới trường trong đối tượng kênh hoặc thiết bị trường. */
  path: readonly string[];
  label: MessageKey;
  help: MessageKey;
  group: FieldGroup;
  kind: 'text' | 'number' | 'select' | 'bool';
  options?: readonly string[];
  /** Danh sách chọn gồm số: lưu thành số. */
  numeric?: boolean;
  min?: number;
  max?: number;
  /** Số thực (mặc định số nguyên). */
  real?: boolean;
  default?: string | number | boolean;
  required?: boolean;
  maxLen?: number;
  mono?: boolean;
  unit?: string;
}

const f = (
  target: FieldSpec['target'],
  key: string,
  path: readonly string[],
  group: FieldGroup,
  kind: FieldSpec['kind'],
  extra: Partial<FieldSpec> = {},
): FieldSpec => ({
  key,
  target,
  path,
  group,
  kind,
  label: `cn.f.${key}` as MessageKey,
  help: `cn.h.${key}` as MessageKey,
  ...extra,
});

const ch = (
  key: string,
  path: readonly string[],
  group: FieldGroup,
  kind: FieldSpec['kind'],
  extra?: Partial<FieldSpec>,
) => f('channel', key, path, group, kind, extra);
const dv = (
  key: string,
  path: readonly string[],
  group: FieldGroup,
  kind: FieldSpec['kind'],
  extra?: Partial<FieldSpec>,
) => f('device', key, path, group, kind, extra);

const COMMON_CHANNEL: FieldSpec[] = [
  ch('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  ch('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  ch('enabled', ['enabled'], 'basic', 'bool', { default: true }),
];

const TCP_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('host', ['tcp', 'host'], 'basic', 'text', { required: true, mono: true, maxLen: 253 }),
  ch('port', ['tcp', 'port'], 'basic', 'number', { min: 1, max: 65535, default: 502, mono: true }),
  ch('connectTimeoutMs', ['tcp', 'connectTimeoutMs'], 'advanced', 'number', {
    min: 500,
    max: 30000,
    default: 3000,
    unit: 'ms',
  }),
  ch('reconnectMaxS', ['tcp', 'reconnectMaxS'], 'advanced', 'number', {
    min: 1,
    max: 60,
    default: 10,
    unit: 's',
  }),
  ch('requestGapMs', ['requestGapMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    default: 0,
    unit: 'ms',
  }),
];

const RTU_CHANNEL: FieldSpec[] = [
  ...COMMON_CHANNEL,
  ch('serialPort', ['serial', 'port'], 'basic', 'text', {
    required: true,
    mono: true,
    maxLen: 220,
  }),
  ch('baud', ['serial', 'baud'], 'basic', 'select', {
    options: ['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'],
    numeric: true,
    default: 9600,
  }),
  ch('dataBits', ['serial', 'dataBits'], 'basic', 'select', {
    options: ['7', '8'],
    numeric: true,
    default: 8,
  }),
  ch('parity', ['serial', 'parity'], 'basic', 'select', {
    options: ['none', 'even', 'odd'],
    default: 'even',
  }),
  ch('stopBits', ['serial', 'stopBits'], 'basic', 'select', {
    options: ['1', '2'],
    numeric: true,
    default: 1,
  }),
  ch('rs485', ['serial', 'rs485'], 'advanced', 'bool', { default: true }),
  ch('dropEcho', ['serial', 'dropEcho'], 'advanced', 'bool', { default: false }),
  ch('silenceMs', ['serial', 'silenceMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    real: true,
    unit: 'ms',
  }),
  ch('requestGapMs', ['requestGapMs'], 'advanced', 'number', {
    min: 0,
    max: 1000,
    default: 0,
    unit: 'ms',
  }),
];

const deviceCommon = (kind: ChannelKind): FieldSpec[] => [
  dv('id', ['id'], 'basic', 'text', { required: true, mono: true, maxLen: 32 }),
  dv('name', ['name'], 'basic', 'text', { required: true, maxLen: 64 }),
  dv('enabled', ['enabled'], 'basic', 'bool', { default: true }),
  kind === 'modbus-tcp'
    ? dv('unitId', ['unitId'], 'basic', 'number', { min: 0, max: 255, default: 1 })
    : dv('slave', ['slave'], 'basic', 'number', { min: 1, max: 247, default: 1 }),
  dv('addressBase', ['addressBase'], 'basic', 'select', {
    options: ['0', '1'],
    numeric: true,
    default: 0,
  }),
  dv('byteOrder', ['byteOrder'], 'basic', 'select', {
    options: ['ABCD', 'CDAB', 'BADC', 'DCBA'],
    default: 'ABCD',
    mono: true,
  }),
  dv('timeoutMs', ['timeoutMs'], 'advanced', 'number', {
    min: 100,
    max: 10000,
    default: 1000,
    unit: 'ms',
  }),
  dv('retries', ['retries'], 'advanced', 'number', {
    min: 0,
    max: 5,
    default: kind === 'modbus-tcp' ? 0 : 1,
  }),
  dv('maxReadRegisters', ['maxReadRegisters'], 'advanced', 'number', {
    min: 1,
    max: 125,
    default: 125,
  }),
  dv('maxReadBits', ['maxReadBits'], 'advanced', 'number', { min: 1, max: 2000, default: 2000 }),
  dv('maxGapRegisters', ['maxGapRegisters'], 'advanced', 'number', {
    min: 0,
    max: 125,
    default: 10,
  }),
  dv('maxGapBits', ['maxGapBits'], 'advanced', 'number', { min: 0, max: 2000, default: 64 }),
  dv('writeDeadlineMs', ['writeDeadlineMs'], 'advanced', 'number', {
    min: 1000,
    max: 60000,
    default: 5000,
    unit: 'ms',
  }),
  dv('writeSingleRegister', ['write', 'singleRegister'], 'advanced', 'select', {
    options: ['fc06', 'fc16'],
    default: 'fc06',
    mono: true,
  }),
  dv('writeSingleCoil', ['write', 'singleCoil'], 'advanced', 'select', {
    options: ['fc05', 'fc15'],
    default: 'fc05',
    mono: true,
  }),
  dv('writeRegisterBit', ['write', 'registerBit'], 'advanced', 'select', {
    options: ['none', 'mask', 'rmw'],
    default: 'none',
    mono: true,
  }),
];

export const channelFields = (kind: ChannelKind): readonly FieldSpec[] =>
  kind === 'modbus-tcp' ? TCP_CHANNEL : RTU_CHANNEL;
export const deviceFields = (kind: ChannelKind): readonly FieldSpec[] => deviceCommon(kind);

/** Chữ mặc định (để hiện ở ô trống). */
export const fieldDefault = (spec: FieldSpec): string =>
  spec.default === undefined ? '' : String(spec.default);

function read(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Obj)[k];
  }
  return cur;
}

/** Chữ của trường trong đối tượng; vắng khóa thì rỗng. */
export function fieldText(obj: unknown, spec: FieldSpec): string {
  const v = read(obj, spec.path);
  return v === undefined || v === null ? '' : String(v);
}

export interface TakenIds {
  channels: ReadonlySet<string>;
  devices: ReadonlySet<string>;
}

export type SetResult<T> = { value: T } | { error: MessageKey };

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function write(obj: Obj, path: readonly string[], value: unknown): Obj {
  const out: Obj = { ...obj };
  if (path.length === 1) {
    if (value === undefined) delete out[path[0]];
    else out[path[0]] = value;
    return out;
  }
  const [head, ...rest] = path;
  const child = write((out[head] as Obj | undefined) ?? {}, rest, value);
  if (Object.keys(child).length === 0 && value === undefined) delete out[head];
  else out[head] = child;
  return out;
}

/** Đặt một trường từ chữ gõ vào; trả đối tượng mới (đối tượng cũ không đổi) hoặc lỗi tại ô. */
export function setField<T extends object>(
  obj: T,
  spec: FieldSpec,
  raw: string,
  taken: TakenIds,
): SetResult<T> {
  const text = spec.kind === 'text' ? raw.trim() : raw.trim();
  const own = obj as unknown as Obj;
  let value: unknown;
  if (text === '') {
    if (spec.required) return { error: 'cn.err.required' };
    value = undefined;
  } else if (spec.kind === 'text') {
    if (spec.maxLen !== undefined && text.length > spec.maxLen) return { error: 'cn.err.maxLen' };
    if (spec.key === 'id') {
      if (!ID_RE.test(text)) return { error: 'cn.err.idSyntax' };
      const set = spec.target === 'channel' ? taken.channels : taken.devices;
      if (text !== own.id && set.has(text)) return { error: 'cn.err.idDup' };
    }
    value = text;
  } else if (spec.kind === 'number') {
    if (!/^[+-]?\d+(\.\d+)?$/.test(text) || (!spec.real && !/^[+-]?\d+$/.test(text)))
      return { error: spec.real ? 'cn.err.number' : 'cn.err.integer' };
    const n = Number(text);
    if ((spec.min !== undefined && n < spec.min) || (spec.max !== undefined && n > spec.max))
      return { error: 'cn.err.range' };
    value = n;
  } else if (spec.kind === 'select') {
    if (!spec.options?.includes(text)) return { error: 'cn.err.option' };
    value = spec.numeric ? Number(text) : text;
  } else {
    const b = TRUE_WORDS.includes(text.toLowerCase())
      ? true
      : FALSE_WORDS.includes(text.toLowerCase())
        ? false
        : undefined;
    if (b === undefined) return { error: 'cn.err.bool' };
    value = b;
  }
  // Bằng mặc định thì không ghi khóa (file gọn, như Tag).
  if (value !== undefined && spec.default !== undefined && value === spec.default)
    value = undefined;
  return { value: write(own, spec.path, value) as T };
}

function freeId(prefix: string, taken: ReadonlySet<string>): { id: string; n: number } {
  for (let n = 1; ; n++) if (!taken.has(`${prefix}${n}`)) return { id: `${prefix}${n}`, n };
}

/** Kênh mới: id `plc1`/`rtu1`… chưa dùng (cả với id thiết bị trường), chưa có thiết bị trường nào. */
export function newChannel(
  channelIds: readonly string[],
  kind: ChannelKind,
  deviceIds: readonly string[],
): Channel {
  const taken = new Set([...channelIds, ...deviceIds]);
  const { id, n } = freeId(kind === 'modbus-tcp' ? 'plc' : 'rtu', taken);
  const base = { id, name: t('cn.newChannel', { n }), kind, devices: [] as FieldDevice[] };
  return kind === 'modbus-tcp'
    ? { ...base, kind, tcp: { host: '192.168.1.10' } }
    : { ...base, kind, serial: { port: '' } };
}

/** Thiết bị trường mới của kênh: id duy nhất trong cả project, `unitId` hay `slave` bằng 1. */
export function newDevice(channel: Channel, deviceIds: readonly string[]): FieldDevice {
  const taken = new Set(deviceIds);
  const prefix = `${channel.id.slice(0, 26)}-d`;
  const { id, n } = freeId(prefix, taken);
  return channel.kind === 'modbus-tcp'
    ? { id, name: t('cn.newDevice', { n }), unitId: 1 }
    : { id, name: t('cn.newDevice', { n }), slave: 1 };
}

/** Số Tag ngoài của từng thiết bị trường. */
export function tagsPerDevice(tags: readonly TagV1[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const tag of tags) {
    const id = tag.kind === 'external' ? tag.source?.device : undefined;
    if (id) map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

// ---------- Thử kết nối ----------

export interface ProbeRead {
  address: string;
  count: number;
}

const pick = (src: unknown, keys: readonly string[]): Obj => {
  const out: Obj = {};
  const o = (src && typeof src === 'object' ? src : {}) as Obj;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};

/** Thân của `POST /api/v1/drivers/test`: cấu hình đang sửa, chỉ gồm trường đã đặt. */
export function probeBody(channel: Channel, device: FieldDevice, read: ProbeRead | null): object {
  const tcp = channel.kind === 'modbus-tcp';
  const ch: Obj = { kind: channel.kind };
  if (tcp) ch.tcp = pick(channel.tcp, ['host', 'port', 'connectTimeoutMs']);
  else
    ch.serial = pick(channel.serial, [
      'port',
      'baud',
      'dataBits',
      'parity',
      'stopBits',
      'rs485',
      'dropEcho',
      'silenceMs',
    ]);
  if (channel.requestGapMs !== undefined) ch.requestGapMs = channel.requestGapMs;
  const dev = pick(device, [tcp ? 'unitId' : 'slave', 'timeoutMs', 'addressBase', 'retries']);
  return {
    channel: ch,
    device: dev,
    ...(read ? { read: { address: read.address, count: read.count } } : {}),
  };
}

export interface ProbeGateInput {
  online: boolean;
  role: string | null;
}

/** Khóa kèm lý do: cần Online (đã đăng nhập) với role từ engineer. */
export function probeGate(input: ProbeGateInput): MessageKey | null {
  if (!input.online) return 'cn.probe.offline';
  if (input.role !== 'engineer' && input.role !== 'administrator') return 'cn.probe.role';
  return null;
}

export type ProbeFailure = 'busy' | 'rate' | 'badRequest' | 'audit' | 'device' | 'unknown';

export interface ProbeResult {
  ok: boolean;
  code: string;
  connectMs?: number;
  responseMs?: number;
  message?: string;
  exception?: { code: string; meaning: string };
  read?: { fc: number; offset: number; count: number };
  /** Thanh ghi dạng hex (4 ký tự mỗi thanh ghi). */
  hex?: string[];
  bits?: boolean[];
  /** Bảng cách hiểu: các kiểu và thứ tự byte (rỗng với bit hoặc khi không đọc thanh ghi). */
  interpret: InterpretRow[];
  /** Có khi lần thử không tới được kết quả của thiết bị trường (yêu cầu bị từ chối hoặc lỗi mạng). */
  failure?: ProbeFailure;
  retryAfterS?: number;
  issues?: string[];
  deviceError?: DeviceError;
}

export interface ProbeState {
  running: boolean;
  /** Lý do khóa lần gần nhất; `null`: không khóa. */
  locked: MessageKey | null;
  result: ProbeResult | null;
}

export interface ProbeDeps {
  post(path: string, body: object): Promise<ApiResult | DeviceError>;
  gate(): MessageKey | null;
}

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

function resultOf(res: ApiResult | DeviceError): ProbeResult {
  const empty: ProbeResult = { ok: false, code: '', interpret: [] };
  if (isDeviceError(res)) return { ...empty, failure: 'device', deviceError: res };
  const body = isObj(res.body) ? res.body : {};
  if (res.status === 409) return { ...empty, code: 'TEST_BUSY', failure: 'busy' };
  if (res.status === 429)
    return {
      ...empty,
      code: 'TEST_RATE_LIMITED',
      failure: 'rate',
      ...(typeof body.retryAfterS === 'number' ? { retryAfterS: body.retryAfterS } : {}),
    };
  if (res.status === 400)
    return {
      ...empty,
      code: 'BAD_REQUEST',
      failure: 'badRequest',
      issues: Array.isArray(body.issues)
        ? body.issues.filter(isObj).map((i) => String(i.code ?? ''))
        : [],
    };
  if (res.status === 503) return { ...empty, code: 'AUDIT_UNAVAILABLE', failure: 'audit' };
  if (res.status < 200 || res.status >= 300)
    return { ...empty, code: String(res.status), failure: 'unknown' };
  const out: ProbeResult = { ok: body.ok === true, code: String(body.code ?? ''), interpret: [] };
  if (typeof body.connectMs === 'number') out.connectMs = body.connectMs;
  if (typeof body.responseMs === 'number') out.responseMs = body.responseMs;
  if (typeof body.message === 'string') out.message = body.message;
  if (isObj(body.exception))
    out.exception = {
      code: String(body.exception.code ?? ''),
      meaning: String(body.exception.meaning ?? ''),
    };
  if (isObj(body.read)) {
    const r = body.read;
    out.read = { fc: Number(r.fc), offset: Number(r.offset), count: Number(r.count) };
    if (Array.isArray(r.registers)) {
      out.hex = r.registers.map((x) => String(x).toUpperCase().padStart(4, '0'));
      out.interpret = interpretRegisters(out.hex.map((h) => parseInt(h, 16)));
    }
    if (Array.isArray(r.bits)) out.bits = r.bits.map((b) => b === true);
  }
  return out;
}

/** Bộ chạy Thử kết nối: một lần tại một thời điểm; trạng thái cho giao diện đọc và nghe. */
export class ConnectionProbe {
  state: ProbeState = { running: false, locked: null, result: null };
  private readonly deps: ProbeDeps;
  private readonly listeners = new Set<() => void>();

  constructor(deps: ProbeDeps) {
    this.deps = deps;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(next: Partial<ProbeState>): void {
    this.state = { ...this.state, ...next };
    for (const l of [...this.listeners]) l();
  }

  /** Cập nhật lý do khóa mà không chạy (giao diện gọi khi phiên đổi). */
  refreshLock(): void {
    const locked = this.deps.gate();
    if (locked !== this.state.locked) this.set({ locked });
  }

  async run(channel: Channel, device: FieldDevice, read: ProbeRead | null): Promise<void> {
    if (this.state.running) return;
    const locked = this.deps.gate();
    if (locked) {
      this.set({ locked });
      return;
    }
    this.set({ running: true, locked: null, result: null });
    let result: ProbeResult;
    try {
      result = resultOf(
        await this.deps.post('/api/v1/drivers/test', probeBody(channel, device, read)),
      );
    } catch {
      result = {
        ok: false,
        code: '',
        interpret: [],
        failure: 'device',
        deviceError: { error: 'unreachable' },
      };
    }
    this.set({ running: false, result });
  }

  clear(): void {
    this.set({ result: null });
  }
}

// ---------- Lỗi của bộ kiểm tra theo trường ----------

/**
 * Khóa trường của form cho một lỗi theo JSON pointer trong \`connections.json\`: \`/channels/1/serial/port\` → kênh 1,
 * trường \`serialPort\`; \`/channels/1/devices/0/timeoutMs\` → kênh 1, thiết bị 0, trường \`timeoutMs\`. Lỗi không gắn với một
 * trường (cả đối tượng) thì \`field = null\`.
 */
export function issueField(
  path: string,
  kind: ChannelKind,
): { channel: number; device: number | null; field: string | null } | null {
  const seg = path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (seg[0] !== 'channels' || !/^\d+$/.test(seg[1] ?? '')) return null;
  const channel = Number(seg[1]);
  const isDevice = seg[2] === 'devices' && /^\d+$/.test(seg[3] ?? '');
  const rest = (isDevice ? seg.slice(4) : seg.slice(2)).join('/');
  const specs = isDevice ? deviceFields(kind) : channelFields(kind);
  const spec = rest ? specs.find((s) => s.path.join('/') === rest) : undefined;
  return { channel, device: isDevice ? Number(seg[3]) : null, field: spec?.key ?? null };
}

// ---------- Bảng cách hiểu ----------

export interface InterpretLine {
  type: string;
  /** Giá trị theo thứ tự byte; kiểu 16 bit chỉ có \`-\`. */
  values: Partial<Record<'ABCD' | 'CDAB' | 'BADC' | 'DCBA' | '-', string>>;
  /** Thứ tự byte nào cho giá trị không hợp lệ (NaN, vô cực). */
  invalid: string[];
}

/** Gộp các dòng của \`interpretRegisters\` thành bảng: mỗi kiểu một dòng, một cột cho từng thứ tự byte. */
export function interpretTable(rows: readonly InterpretRow[]): InterpretLine[] {
  const out = new Map<string, InterpretLine>();
  for (const r of rows) {
    const line = out.get(r.type) ?? { type: r.type, values: {}, invalid: [] };
    const key = r.byteOrder ?? '-';
    line.values[key] = r.text;
    if (r.invalid) line.invalid.push(key);
    out.set(r.type, line);
  }
  return [...out.values()];
}
