// Phần của thiết bị giả cho feature 006 (specs/006-tags-modbus/contracts/{device-api-1.1,live-protocol-1.2,
// tauri-commands-006}.md): giá trị sống có `reason`, ghi Tag (`POST /api/v1/tags/write` và hỏi kết quả theo mã yêu cầu),
// Thử kết nối (`POST /api/v1/drivers/test`), chẩn đoán driver (`GET /api/v1/drivers/diagnostics`), danh sách cổng
// serial, `GET /api/v1/projects/active`, lọc nguồn của trang xem, mã đóng 4401. Điều khiển qua
// `window.__matMock.device` (xem `Mock006Control` trong mock-device.ts). Không vào bản cài: chỉ lớp giả.
import type { ApiResult, DeviceError } from './device-types.ts';

export interface Sample {
  value: number | boolean | string | null;
  quality: 'GOOD' | 'BAD' | 'UNCERTAIN';
  reason?: string;
}

/** Cách thiết bị giả trả lời một lệnh ghi (sau khi qua các bước kiểm). */
export interface WriteBehavior {
  /** Kết quả cuối. */
  status: 'CONFIRMED' | 'FAILED' | 'TIMEOUT';
  /** Mã chi tiết: `CONFIRMED`, `NO_READBACK`, `APPLIED`, `DEVICE_EXCEPTION`, `READBACK_MISMATCH`, `WRITE_TIMEOUT`… */
  code?: string;
  /** Thời gian từ lúc nhận tới kết quả cuối (ms); mặc định 150. */
  delayMs?: number;
  /** Giá trị đọc lại (mặc định bằng giá trị ghi khi CONFIRMED). */
  readback?: unknown;
  exception?: { code: string; meaning: string };
  /** Không ghi giá trị vào nguồn dữ liệu sống (mô phỏng thiết bị trường không đổi). */
  keepValue?: boolean;
}

/** Cách trả lời `POST /api/v1/drivers/test`. */
export interface ProbeReply {
  status?: number;
  body: Record<string, unknown>;
}

export interface WriteRequestView {
  requestId: string;
  tag: string;
  value: unknown;
  user: string;
}

interface WriteRecord {
  requestId: string;
  tag: string;
  value: unknown;
  user: string;
  role: string;
  old: Sample | null;
  at: number;
  behavior: Required<Pick<WriteBehavior, 'status' | 'delayMs'>> & WriteBehavior;
  audited: boolean;
  receivedAt: string;
  raw?: number;
}

/** Chẩn đoán driver của một thiết bị trường (device-api §5). */
export interface DiagDevice {
  id: string;
  name: string;
  state: 'active' | 'suspended' | 'error' | 'disabled';
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
  groups: Array<{
    group: string;
    periodMs: number;
    actualMs: { avg: number; max: number };
    overruns: number;
    overloaded: boolean;
  }>;
  writes: { confirmed: number; failed: number; timeout: number; rejected: number };
}

export interface DiagChannel {
  id: string;
  name: string;
  kind: 'modbus-tcp' | 'modbus-rtu';
  state: 'disabled' | 'connecting' | 'opening' | 'connected' | 'error';
  lastError: { code: string; at: number; device?: string } | null;
  reconnects: number;
  warnings: string[];
  devices: DiagDevice[];
}

export interface DiagBadTag {
  id: string;
  quality: 'BAD' | 'UNCERTAIN';
  reason: string;
  detail: string | null;
  updatedAt: number;
}

export interface Dev006 {
  name: string;
  runtime: string;
  store: {
    active: number | null;
    versions: ReadonlyArray<{
      seq: number;
      digest: string;
      files: Readonly<Record<string, string>>;
    }>;
  };
  lives: ReadonlySet<{ stop(code: number, reason: string): void }>;
}

export interface Hooks006 {
  audit(
    f: Dev006,
    row: {
      action: string;
      result: string;
      user: string | null;
      role: string | null;
      target: string | null;
      code: string | null;
      detail: Record<string, unknown> | null;
    },
  ): void;
}

/** Trạng thái 006 của một thiết bị giả. */
export class State006 {
  viewerAccess: 'private' | 'any' | 'off' = 'private';
  /** Bắt tay live theo địa chỉ (ws) bị 403 vì lọc nguồn. */
  viewerBlock: 'viewer-private' | 'viewer-off' | null = null;
  readonly overrides = new Map<string, Sample>();
  readonly written = new Map<string, unknown>();
  behavior: WriteBehavior | ((req: WriteRequestView) => WriteBehavior) = {
    status: 'CONFIRMED',
    code: 'CONFIRMED',
  };
  /** Số lệnh ghi tối đa mỗi phút toàn thiết bị; 0 = không giới hạn. */
  writeRatePerMin = 20;
  readonly requests = new Map<string, WriteRecord>();
  readonly log: WriteRequestView[] = [];
  readonly stamps: number[] = [];
  /** Lỗi chung cho lần `drivers/test` kế tiếp (một lần): `TEST_BUSY`, `TEST_RATE_LIMITED`, `AUDIT_UNAVAILABLE`. */
  probeError: string | null = null;
  probeDelayMs = 0;
  /** Lần `tags/write` kế tiếp được xử lý bình thường nhưng câu trả lời bị mất (mất mạng sau khi gửi, US2-10). */
  dropNextWriteReply = false;
  probeFn: ((body: Record<string, unknown>) => ProbeReply) | null = null;
  readonly probes: Record<string, unknown>[] = [];
  diagChannels: DiagChannel[] | null = null;
  diagBadTags: DiagBadTag[] = [];
  diagFail: string | null = null;
  diagPulse = 0;
  /** Lần hỏi `projects/active` trả bản này thay cho bản đang chạy (để thử cảnh báo khác biệt). */
  activeOverride: { tags?: unknown[]; project?: Record<string, unknown> } | null = null;
}

const states = new WeakMap<object, State006>();
export const stateOf = (f: Dev006): State006 => {
  let s = states.get(f);
  if (!s) {
    s = new State006();
    states.set(f, s);
  }
  return s;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- Project đang chạy ----------

const parse = (text: string | undefined): unknown => {
  if (text === undefined) return null;
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return null;
  }
};

interface MockTag {
  id: string;
  type: string;
  kind?: string;
  access?: string;
  limits?: { min?: number; max?: number; maxLength?: number };
  min?: number;
  max?: number;
  source?: { device?: string; address?: string; readback?: boolean };
  scaling?: { rawMin: number; rawMax: number; engMin: number; engMax: number };
}

const tagCache = new WeakMap<object, { digest: string; tags: Map<string, MockTag> }>();

/** Tag của project đang chạy trên thiết bị giả (0.1 hoặc 0.2). */
export function tagsOf(f: Dev006): Map<string, MockTag> {
  const v = f.store.versions.find((x) => x.seq === f.store.active);
  if (!v) return new Map();
  const cached = tagCache.get(f);
  if (cached?.digest === v.digest) return cached.tags;
  const project = parse(v.files['project.json']);
  const tagFile =
    isObject(project) && typeof project.tagFile === 'string' ? project.tagFile : 'tags.json';
  const doc = parse(v.files[tagFile]);
  const list = isObject(doc) && Array.isArray(doc.tags) ? doc.tags : [];
  const tags = new Map<string, MockTag>();
  for (const t of list)
    if (isObject(t) && typeof t.id === 'string') tags.set(t.id, t as unknown as MockTag);
  tagCache.set(f, { digest: v.digest, tags });
  return tags;
}

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Giá trị mặc định của một Tag trong project 0.2 (tất định theo id và nhịp). */
function defaultSample(tag: MockTag, tick: number): Sample {
  const h = hash(tag.id);
  switch (tag.type) {
    case 'BOOL':
      return { value: h % 2 === 0, quality: 'GOOD' };
    case 'STRING':
      return { value: `S${h % 100}`, quality: 'GOOD' };
    case 'FLOAT32':
    case 'FLOAT64':
      return { value: 20 + (h % 600) / 10 + (tick % 4 < 2 ? 0 : 0.5), quality: 'GOOD' };
    default:
      return { value: h % 100, quality: 'GOOD' };
  }
}

/** Mẫu sống của Tag `id` ở nhịp `tick`; `undefined` khi thiết bị không có Tag. */
export function sampleOf(
  f: Dev006,
  id: string,
  tick: number,
  legacy: (id: string, tick: number) => unknown,
): Sample | undefined {
  const s = stateOf(f);
  const over = s.overrides.get(id);
  if (over) return over;
  if (s.written.has(id)) return { value: s.written.get(id) as Sample['value'], quality: 'GOOD' };
  const old = legacy(id, tick);
  if (old !== undefined) return { value: old as Sample['value'], quality: 'GOOD' };
  const tag = tagsOf(f).get(id);
  return tag ? defaultSample(tag, tick) : undefined;
}

// ---------- GET /api/v1/projects/active ----------

export function activeProject(f: Dev006): ApiResult | DeviceError {
  const v = f.store.versions.find((x) => x.seq === f.store.active);
  if (!v) return { error: 'http', detail: 404 };
  const s = stateOf(f);
  const project = parse(v.files['project.json']);
  const tagFile =
    isObject(project) && typeof project.tagFile === 'string' ? project.tagFile : 'tags.json';
  const tags = parse(v.files[tagFile]);
  const out: Record<string, unknown> = {
    project: s.activeOverride?.project ?? project,
    tags: s.activeOverride?.tags
      ? { ...(isObject(tags) ? tags : {}), tags: s.activeOverride.tags }
      : tags,
    digest: v.digest,
  };
  if (isObject(project) && Array.isArray(project.valueTables)) {
    const tables: Record<string, unknown> = {};
    for (const n of project.valueTables)
      if (typeof n === 'string') tables[n] = parse(v.files[`value-tables/${n}.json`]);
    out.valueTables = tables;
  }
  if (isObject(project) && typeof project.connectionFile === 'string') {
    const conn = parse(v.files[project.connectionFile]);
    if (isObject(conn) && Array.isArray(conn.channels))
      out.connections = {
        channels: conn.channels.filter(isObject).map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          devices: (Array.isArray(c.devices) ? c.devices : [])
            .filter(isObject)
            .map((d) => ({ id: d.id, name: d.name })),
        })),
      };
  }
  return { status: 200, body: out };
}

// ---------- Ghi Tag ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NUMERIC = new Set([
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
]);
const RANGE: Record<string, [number, number]> = {
  INT16: [-32768, 32767],
  UINT16: [0, 65535],
  INT32: [-2147483648, 2147483647],
  UINT32: [0, 4294967295],
};

type WriteResult = Record<string, unknown>;

function rejected(
  requestId: string,
  reason: string,
  extra: Record<string, unknown> = {},
): WriteResult {
  return { requestId, status: 'REJECTED', reason, ...extra };
}

function phaseAt(rec: WriteRecord, now: number): 'queued' | 'sent' | 'readback' | 'done' {
  const e = now - rec.at;
  const d = rec.behavior.delayMs;
  if (e >= d) return 'done';
  return e < d / 3 ? 'queued' : e < (2 * d) / 3 ? 'sent' : 'readback';
}

/** Kênh và thiết bị trường của Tag (cho `detail` của audit, data-model §9); rỗng khi Tag không có nguồn Modbus. */
function wiring(f: Dev006, tagId: string): { channel?: string; device?: string } {
  const device = tagsOf(f).get(tagId)?.source?.device;
  if (!device) return {};
  const v = f.store.versions.find((x) => x.seq === f.store.active);
  const project = v ? parse(v.files['project.json']) : null;
  const file =
    isObject(project) && typeof project.connectionFile === 'string' ? project.connectionFile : null;
  const conn = v && file ? parse(v.files[file]) : null;
  const channels =
    isObject(conn) && Array.isArray(conn.channels) ? conn.channels.filter(isObject) : [];
  const owner = channels.find(
    (c) => Array.isArray(c.devices) && c.devices.some((d) => isObject(d) && d.id === device),
  );
  return { ...(owner ? { channel: String(owner.id) } : {}), device };
}

/** Hoàn tất lệnh (ghi giá trị, audit) khi đã quá thời gian; trả `true` khi vừa xong. */
function settle(f: Dev006, hooks: Hooks006, rec: WriteRecord, now: number): boolean {
  if (rec.audited || phaseAt(rec, now) !== 'done') return false;
  rec.audited = true;
  const b = rec.behavior;
  const s = stateOf(f);
  if (b.status === 'CONFIRMED' && !b.keepValue) s.written.set(rec.tag, rec.value);
  const ok = b.status === 'CONFIRMED';
  hooks.audit(f, {
    action: 'tag.write',
    result: ok ? 'ok' : 'failed',
    user: rec.user,
    role: rec.role,
    target: rec.tag,
    code:
      b.code ?? (ok ? 'CONFIRMED' : b.status === 'TIMEOUT' ? 'WRITE_TIMEOUT' : 'DEVICE_EXCEPTION'),
    detail: {
      requestId: rec.requestId,
      ...wiring(f, rec.tag),
      old: rec.old?.value ?? null,
      new: rec.value,
      ...(b.status === 'CONFIRMED' && b.readback !== undefined ? { readback: b.readback } : {}),
    },
  });
  return true;
}

function viewOf(f: Dev006, hooks: Hooks006, rec: WriteRecord, now: number): WriteResult {
  settle(f, hooks, rec, now);
  const phase = phaseAt(rec, now);
  if (phase !== 'done')
    return { requestId: rec.requestId, status: 'ACCEPTED', phase, tag: rec.tag, value: rec.value };
  const b = rec.behavior;
  const base: WriteResult = {
    requestId: rec.requestId,
    status: b.status,
    code:
      b.code ??
      (b.status === 'CONFIRMED'
        ? 'CONFIRMED'
        : b.status === 'TIMEOUT'
          ? 'WRITE_TIMEOUT'
          : 'DEVICE_EXCEPTION'),
    tag: rec.tag,
    value: rec.value,
    receivedAt: rec.receivedAt,
    finishedAt: new Date(rec.at + b.delayMs).toISOString(),
    clockOk: true,
  };
  if (b.status === 'CONFIRMED' && b.code !== 'NO_READBACK' && b.code !== 'APPLIED')
    base.readback = b.readback ?? rec.value;
  if (b.exception) base.exception = b.exception;
  if (b.status === 'TIMEOUT') base.message = 'Thiết bị trường không trả lời: không chắc đã ghi';
  return base;
}

/** Các bước kiểm của FR-037 mà thiết bị giả làm được (loại, quyền, kiểu, giới hạn, tần suất). */
function check(tag: MockTag | undefined, value: unknown): WriteResult | null {
  if (!tag) return { reason: 'NO_SUCH_TAG', message: 'Thiết bị không có Tag này' };
  const writable = tag.kind === 'internal' || tag.kind === 'external' || tag.kind === 'simulation';
  if (!writable || tag.access !== 'RW') return { reason: 'READ_ONLY', message: 'Tag chỉ đọc' };
  if (tag.type === 'BOOL') {
    if (typeof value !== 'boolean') return { reason: 'BAD_TYPE' };
  } else if (tag.type === 'STRING') {
    if (typeof value !== 'string') return { reason: 'BAD_TYPE' };
    const max = tag.limits?.maxLength;
    if (max !== undefined && value.length > max) return { reason: 'STRING_TOO_LONG' };
  } else if (NUMERIC.has(tag.type)) {
    const n =
      typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
    if (typeof value !== 'number' && typeof value !== 'string') return { reason: 'BAD_TYPE' };
    if (!Number.isFinite(n)) return { reason: 'NOT_FINITE' };
    const lim = tag.limits;
    if ((lim?.min !== undefined && n < lim.min) || (lim?.max !== undefined && n > lim.max))
      return { reason: 'OUT_OF_LIMITS', limits: { min: lim?.min ?? null, max: lim?.max ?? null } };
    const r = RANGE[tag.type];
    if (r && (n < r[0] || n > r[1])) return { reason: 'OUT_OF_TYPE_RANGE' };
  }
  return null;
}

export interface WriteCaller {
  user: string;
  role: string;
}

/** `POST /api/v1/tags/write` (operator trở lên, đã qua kiểm quyền ở mock-device). */
export function postWrite(
  f: Dev006,
  hooks: Hooks006,
  caller: WriteCaller,
  body: unknown,
  now: number,
  legacy: (id: string, tick: number) => unknown,
): ApiResult | DeviceError {
  if (
    !isObject(body) ||
    !Array.isArray(body.requests) ||
    body.requests.length < 1 ||
    body.requests.length > 16
  )
    return { status: 400, body: { error: 'BAD_REQUEST' } };
  const ids = body.requests.map((r) => (isObject(r) ? r.requestId : undefined));
  if (ids.some((id) => typeof id !== 'string' || !UUID.test(id)))
    return { status: 400, body: { error: 'BAD_REQUEST' } };
  const s = stateOf(f);
  const tags = tagsOf(f);
  const results: WriteResult[] = [];
  for (const raw of body.requests as Record<string, unknown>[]) {
    const requestId = raw.requestId as string;
    const tagId = String(raw.tag ?? '');
    const prev = s.requests.get(requestId);
    if (prev) {
      if (prev.tag === tagId && JSON.stringify(prev.value) === JSON.stringify(raw.value))
        results.push({ ...viewOf(f, hooks, prev, now), duplicate: true });
      else results.push(rejected(requestId, 'REQUEST_ID_CONFLICT'));
      continue;
    }
    const tag = tags.get(tagId);
    const bad = check(tag, raw.value);
    if (bad) {
      const { reason, ...extra } = bad;
      results.push(rejected(requestId, String(reason), extra));
      hooks.audit(f, {
        action: 'tag.write',
        result: 'denied',
        user: caller.user,
        role: caller.role,
        target: tagId,
        code: String(reason),
        detail: { requestId, new: raw.value ?? null },
      });
      continue;
    }
    // Giới hạn tần suất toàn thiết bị (mặc định 20 lệnh/phút).
    while (s.stamps.length && s.stamps[0] < now - 60_000) s.stamps.shift();
    if (s.writeRatePerMin > 0 && s.stamps.length >= s.writeRatePerMin) {
      const retryAfterMs = Math.max(0, s.stamps[0] + 60_000 - now);
      results.push(rejected(requestId, 'RATE_LIMITED', { retryAfterMs }));
      hooks.audit(f, {
        action: 'tag.write',
        result: 'denied',
        user: caller.user,
        role: caller.role,
        target: tagId,
        code: 'RATE_LIMITED',
        detail: { requestId },
      });
      continue;
    }
    s.stamps.push(now);
    const view: WriteRequestView = { requestId, tag: tagId, value: raw.value, user: caller.user };
    s.log.push(view);
    const b = typeof s.behavior === 'function' ? s.behavior(view) : s.behavior;
    const rec: WriteRecord = {
      requestId,
      tag: tagId,
      value: raw.value,
      user: caller.user,
      role: caller.role,
      old: sampleOf(f, tagId, 0, legacy) ?? null,
      at: now,
      behavior: { delayMs: 150, ...b },
      audited: false,
      receivedAt: new Date(now).toISOString(),
    };
    s.requests.set(requestId, rec);
    hooks.audit(f, {
      action: 'tag.write',
      result: 'started',
      user: caller.user,
      role: caller.role,
      target: tagId,
      code: 'ACCEPTED',
      detail: { requestId, ...wiring(f, tagId), new: raw.value },
    });
    const res: WriteResult = {
      requestId,
      status: 'ACCEPTED',
      phase: 'queued',
      tag: tagId,
      old: rec.old
        ? { value: rec.old.value, quality: rec.old.quality }
        : { value: null, quality: 'BAD' },
      value: raw.value,
      receivedAt: rec.receivedAt,
    };
    results.push(res);
  }
  return { status: 200, body: { results } };
}

/** `GET /api/v1/tags/write/{id}` hoặc `?ids=a,b`. */
export function getWrite(
  f: Dev006,
  hooks: Hooks006,
  caller: WriteCaller,
  path: string,
  query: Record<string, string> | undefined,
  now: number,
): ApiResult | DeviceError {
  const s = stateOf(f);
  const one = /^\/api\/v1\/tags\/write\/([0-9a-f-]{36})$/.exec(path)?.[1];
  const look = (id: string): WriteResult | null => {
    const rec = s.requests.get(id);
    // Lệnh của tài khoản khác chỉ administrator thấy (device-api §1.1).
    if (!rec || (rec.user !== caller.user && caller.role !== 'administrator')) return null;
    return viewOf(f, hooks, rec, now);
  };
  if (one) {
    const r = look(one);
    return r ? { status: 200, body: { results: [r] } } : { error: 'no-such-request' };
  }
  const ids = (query?.ids ?? '').split(',').filter(Boolean);
  if (ids.length < 1 || ids.length > 16) return { error: 'http', detail: 400 };
  return {
    status: 200,
    body: { results: ids.map((id) => look(id) ?? { requestId: id, status: 'UNKNOWN' }) },
  };
}

// ---------- Thử kết nối ----------

const EXCEPTIONS: Record<string, string> = {
  '01': 'mã hàm không hỗ trợ',
  '02': 'địa chỉ không hợp lệ',
  '03': 'giá trị dữ liệu không hợp lệ',
};

/** Trả lời mặc định của `drivers/test` theo cấu hình gửi lên (địa chỉ máy, cổng, địa chỉ đọc). */
function defaultProbe(body: Record<string, unknown>): ProbeReply {
  const channel = isObject(body.channel) ? body.channel : {};
  const tcp = isObject(channel.tcp) ? channel.tcp : {};
  const serial = isObject(channel.serial) ? channel.serial : {};
  const host = String(tcp.host ?? '');
  const port = String(serial.port ?? '');
  const read = isObject(body.read) ? body.read : null;
  const fail = (code: string, extra: Record<string, unknown> = {}): ProbeReply => ({
    body: { ok: false, code, ...extra },
  });
  if (/refuse/i.test(host))
    return fail('REFUSED', { message: 'PLC từ chối kết nối (có thể đã đủ số kết nối)' });
  if (/timeout/i.test(host)) return fail('TIMEOUT', { connectMs: 3000 });
  if (/unreach/i.test(host)) return fail('UNREACHABLE');
  if (/dns/i.test(host)) return fail('DNS');
  if (/badframe/i.test(host)) return fail('BAD_FRAME', { connectMs: 3, responseMs: 8 });
  if (/^ttyAS0$/.test(port)) return fail('PORT_CONSOLE');
  if (/^ttyAS9$/.test(port)) return fail('PORT_NOT_ALLOWED');
  if (/^ttyUSB0$/.test(port)) return fail('PORT_BUSY');
  if (/^ttyERR/.test(port)) return fail('PORT_ERROR');
  const address = String(read?.address ?? '');
  const ex = /^(?:HR|IR|C|DI)(9\d{3})/.exec(address);
  if (ex) {
    const code = String(read?.exceptionCode ?? '02');
    return fail('EXCEPTION', {
      connectMs: 3,
      responseMs: 9,
      exception: { code, meaning: EXCEPTIONS[code] ?? 'mã lạ' },
    });
  }
  const out: Record<string, unknown> = { ok: true, code: 'OK', connectMs: 4, responseMs: 12 };
  if (read) {
    const count = Math.max(1, Math.min(16, Number(read.count) || 1));
    const offset = Number(/\d+/.exec(address)?.[0] ?? 0);
    const bit = /^(C|DI)/.test(address);
    out.read = bit
      ? {
          fc: address.startsWith('DI') ? 2 : 1,
          offset,
          count,
          bits: Array.from({ length: count }, (_, i) => i % 2 === 0),
        }
      : {
          fc: address.startsWith('IR') ? 4 : 3,
          offset,
          count,
          registers: ['42F6', 'E979', '0001', '00FF']
            .slice(0, count)
            .concat(Array(Math.max(0, count - 4)).fill('0000')),
        };
  }
  return { body: out };
}

/** Địa chỉ Modbus hợp lệ (project-format-0.2 §3). */
const ADDRESS = /^((C|DI|IR|HR)[0-9]{1,5}|[0134][0-9]{4,5})([.][0-9]{1,2})?$/;

export function postProbe(f: Dev006, body: unknown): ApiResult | DeviceError {
  const s = stateOf(f);
  if (!isObject(body) || !isObject(body.channel))
    return { status: 400, body: { error: 'BAD_REQUEST', issues: [] } };
  s.probes.push(body);
  if (s.probeError) {
    const e = s.probeError;
    s.probeError = null;
    return e === 'TEST_BUSY'
      ? { status: 409, body: { error: 'TEST_BUSY' } }
      : e === 'TEST_RATE_LIMITED'
        ? { status: 429, body: { error: 'TEST_RATE_LIMITED', retryAfterS: 20 } }
        : { status: 503, body: { error: e } };
  }
  const addr = isObject(body.read) ? String(body.read.address ?? '') : null;
  if (addr !== null && !ADDRESS.test(addr))
    return {
      status: 400,
      body: { error: 'BAD_REQUEST', issues: [{ code: 'E_ADDR_SYNTAX', path: '/read/address' }] },
    };
  const reply = (s.probeFn ?? defaultProbe)(body);
  return { status: reply.status ?? 200, body: reply.body };
}

// ---------- Chẩn đoán driver ----------

function defaultChannels(f: Dev006): DiagChannel[] {
  const v = f.store.versions.find((x) => x.seq === f.store.active);
  const project = v ? parse(v.files['project.json']) : null;
  const connFile =
    isObject(project) && typeof project.connectionFile === 'string' ? project.connectionFile : null;
  const conn = v && connFile ? parse(v.files[connFile]) : null;
  const channels =
    isObject(conn) && Array.isArray(conn.channels) ? conn.channels.filter(isObject) : [];
  const period = { fast: 250, normal: 1000, slow: 5000 };
  return channels.map((c) => ({
    id: String(c.id),
    name: String(c.name ?? c.id),
    kind: (c.kind === 'modbus-rtu' ? 'modbus-rtu' : 'modbus-tcp') as DiagChannel['kind'],
    state: c.enabled === false ? 'disabled' : 'connected',
    lastError: null,
    reconnects: 0,
    warnings: [],
    devices: (Array.isArray(c.devices) ? c.devices : []).filter(isObject).map((d) => ({
      id: String(d.id),
      name: String(d.name ?? d.id),
      state: d.enabled === false ? 'disabled' : 'active',
      requestsOk: 1000,
      timeouts: 0,
      exceptions: {},
      badFrames: { crc: 0, format: 0, tid: 0, unit: 0, length: 0, echo: 0 },
      responseMs: { avg: 38, max: 120 },
      groups: [
        {
          group: 'normal',
          periodMs: period.normal,
          actualMs: { avg: 1000, max: 1010 },
          overruns: 0,
          overloaded: false,
        },
      ],
      writes: { confirmed: 0, failed: 0, timeout: 0, rejected: 0 },
    })),
  }));
}

/** `GET /api/v1/drivers/diagnostics`: số đếm tăng theo thời gian (mỗi lần hỏi). */
export function driverDiagnostics(f: Dev006, now: number): ApiResult | DeviceError {
  const s = stateOf(f);
  if (s.diagFail) return { error: s.diagFail };
  s.diagChannels ??= defaultChannels(f);
  s.diagPulse++;
  for (const c of s.diagChannels)
    for (const d of c.devices) if (d.state === 'active') d.requestsOk += 84;
  return {
    status: 200,
    body: {
      at: now,
      runtimeStartedAt: now - 3_600_000,
      scanGroups: { fast: 250, normal: 1000, slow: 5000 },
      channels: s.diagChannels.map((c) => JSON.parse(JSON.stringify(c)) as DiagChannel),
      badTags: s.diagBadTags.map((b) => ({ ...b })),
      badTagsTruncated: false,
    },
  };
}

/** Tiêm lỗi vào số đếm (kịch bản e2e): tăng bộ đếm của một thiết bị trường. */
export function injectDiag(
  f: Dev006,
  deviceId: string,
  patch: {
    timeouts?: number;
    exceptions?: Record<string, number>;
    badFrames?: Partial<DiagDevice['badFrames']>;
    state?: DiagDevice['state'];
    overloaded?: boolean;
  },
  now: number,
): void {
  const s = stateOf(f);
  s.diagChannels ??= defaultChannels(f);
  for (const c of s.diagChannels)
    for (const d of c.devices)
      if (d.id === deviceId) {
        d.timeouts += patch.timeouts ?? 0;
        for (const [k, n] of Object.entries(patch.exceptions ?? {}))
          d.exceptions[k] = (d.exceptions[k] ?? 0) + n;
        for (const [k, n] of Object.entries(patch.badFrames ?? {}))
          d.badFrames[k as keyof DiagDevice['badFrames']] += n ?? 0;
        if (patch.state) d.state = patch.state;
        if (patch.overloaded !== undefined) {
          d.groups[0].overloaded = patch.overloaded;
          d.groups[0].overruns += patch.overloaded ? 6 : 0;
          d.groups[0].actualMs = patch.overloaded
            ? { avg: 1800, max: 2310 }
            : { avg: 1000, max: 1010 };
        }
        if ((patch.timeouts ?? 0) > 0) c.lastError = { code: 'TIMEOUT', at: now, device: d.id };
      }
}

// ---------- Cổng serial ----------

/** `GET /api/v1/serial/ports[?probe=1]`: trước khi dò, RS485 của cổng rảnh là `unknown`; `probe` đặt lại và báo `enabled`. */
export function serialPorts(probe = false): ApiResult {
  return {
    status: 200,
    body: {
      ports: [
        {
          name: 'ttyAS0',
          path: '/dev/ttyAS0',
          kind: 'onboard',
          driver: 'uart',
          allowed: false,
          inUse: { by: 'console', detail: 'console của hệ điều hành (serial-getty@ttyAS0)' },
          rs485: 'unknown',
        },
        {
          name: 'ttyAS2',
          path: '/dev/ttyAS2',
          kind: 'onboard',
          driver: 'uart',
          allowed: true,
          inUse: { by: 'channel', detail: 'rs485-1' },
          rs485: probe ? 'enabled' : 'unknown',
        },
        {
          name: 'ttyAS3',
          path: '/dev/ttyAS3',
          kind: 'onboard',
          driver: 'uart',
          allowed: true,
          inUse: null,
          rs485: 'unsupported',
        },
        {
          name: 'ttyUSB0',
          path: '/dev/ttyUSB0',
          kind: 'usb',
          driver: 'option',
          usb: { vid: '2c7c', pid: '0125', product: 'EC25' },
          allowed: false,
          inUse: null,
          rs485: 'unknown',
        },
      ],
    },
  };
}
