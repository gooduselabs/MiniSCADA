// Chẩn đoán thiết bị (feature 005, US4, data-model §12, FR-032; device-api §6): đọc `GET /api/v1/diagnostics`, giữ bản
// mới nhất và độ lệch giờ so với máy kỹ sư. `DiagnosticsFeed` hỏi mỗi 5 s trong lúc đang chạy (`start`/`stop`): StudioApp
// chỉ chạy khi tab Chẩn đoán đang mở và đang Online có đăng nhập. Không DOM, không chuỗi giao diện.
import { isDeviceError, type ApiResult, type DeviceError } from '../platform/device-types.ts';

/** Chu kỳ hỏi (FR-032: cập nhật ít nhất 5 s một lần). */
export const DIAGNOSTICS_PERIOD_MS = 5000;

export interface Diagnostics {
  /** Giờ thiết bị (ms UTC) lúc trả lời. */
  at: number;
  timeSynced: boolean;
  cpu: { systemPct1m: number; runtimePct1m: number; loadAvg1: number; cores: number };
  memory: { runtimeRssBytes: number; systemTotalBytes: number; systemAvailableBytes: number };
  /** `null` khi thiết bị không đọc được dung lượng. */
  disk: { path: string; totalBytes: number; freeBytes: number } | null;
  uptime: { systemS: number; runtimeS: number };
  clients: { live: number; max: number; sessions: number };
  discovery: {
    enabled: boolean;
    replies: number;
    dropped: { subnet: number; format: number; rate: number; port: number };
  } | null;
  versions: { runtime: string; protocol: string; api: string };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Đọc thân của `GET /api/v1/diagnostics`; thiếu khối cpu, memory, uptime, clients hay `at` thì `null`. */
export function parseDiagnostics(body: unknown): Diagnostics | null {
  if (!isObject(body)) return null;
  const at = num(body.at);
  const { cpu, memory, uptime, clients } = body;
  if (at === null || !isObject(cpu) || !isObject(memory) || !isObject(uptime) || !isObject(clients))
    return null;
  const c = {
    systemPct1m: num(cpu.systemPct1m),
    runtimePct1m: num(cpu.runtimePct1m),
    loadAvg1: num(cpu.loadAvg1),
    cores: num(cpu.cores),
  };
  const m = {
    runtimeRssBytes: num(memory.runtimeRssBytes),
    systemTotalBytes: num(memory.systemTotalBytes),
    systemAvailableBytes: num(memory.systemAvailableBytes),
  };
  const u = { systemS: num(uptime.systemS), runtimeS: num(uptime.runtimeS) };
  const k = { live: num(clients.live), max: num(clients.max), sessions: num(clients.sessions) };
  if (
    [...Object.values(c), ...Object.values(m), ...Object.values(u), ...Object.values(k)].includes(
      null,
    )
  )
    return null;
  const d = body.disk;
  const disk =
    isObject(d) && num(d.totalBytes) !== null && num(d.freeBytes) !== null
      ? { path: str(d.path), totalBytes: num(d.totalBytes)!, freeBytes: num(d.freeBytes)! }
      : null;
  const dc = body.discovery;
  const dropped = isObject(dc) && isObject(dc.dropped) ? dc.dropped : {};
  const discovery = isObject(dc)
    ? {
        enabled: dc.enabled === true,
        replies: num(dc.replies) ?? 0,
        dropped: {
          subnet: num(dropped.subnet) ?? 0,
          format: num(dropped.format) ?? 0,
          rate: num(dropped.rate) ?? 0,
          port: num(dropped.port) ?? 0,
        },
      }
    : null;
  const v = isObject(body.versions) ? body.versions : {};
  return {
    at,
    timeSynced: body.timeSynced === true,
    cpu: c as Diagnostics['cpu'],
    memory: m as Diagnostics['memory'],
    disk,
    uptime: u as Diagnostics['uptime'],
    clients: k as Diagnostics['clients'],
    discovery,
    versions: { runtime: str(v.runtime), protocol: str(v.protocol), api: str(v.api) },
  };
}

export interface DiagnosticsState {
  /** Bản mới nhất hỏi được (giữ lại khi một lần hỏi sau lỗi). */
  data: Diagnostics | null;
  /** Thời điểm nhận bản `data` (ms theo giờ máy này). */
  receivedAt: number | null;
  /** Giờ thiết bị − giờ máy này lúc nhận (ms; dương: thiết bị đi trước); đã trừ nửa thời gian khứ hồi. */
  skewMs: number | null;
  /** Mã lỗi của lần hỏi gần nhất (`unreachable`, `forbidden`, `bad-response`…); `null` khi lần đó được. */
  error: string | null;
}

export interface DiagnosticsDeps {
  /** `GET /api/v1/diagnostics` qua kết nối online. */
  get(): Promise<ApiResult | DeviceError>;
  now(): number;
  /** Báo khi `state` đổi. */
  onChange(state: DiagnosticsState): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class DiagnosticsFeed {
  private st: DiagnosticsState = { data: null, receivedAt: null, skewMs: null, error: null };
  private readonly deps: DiagnosticsDeps;
  private timer: unknown = null;
  private running = false;
  private pending = false;
  /** Tăng mỗi lần dừng: trả lời của lần chạy cũ bị bỏ. */
  private epoch = 0;

  constructor(deps: DiagnosticsDeps) {
    this.deps = deps;
  }

  get state(): DiagnosticsState {
    return this.st;
  }

  get active(): boolean {
    return this.running;
  }

  /** Hỏi ngay rồi mỗi `DIAGNOSTICS_PERIOD_MS`. Đang chạy thì không làm gì. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  /** Dừng hẳn (đóng tab, Offline). Số liệu cuối giữ lại tới khi `reset`. */
  stop(): void {
    this.running = false;
    this.epoch++;
    this.pending = false;
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as never);
    this.timer = null;
  }

  /** Quên số liệu (đổi thiết bị, đăng xuất). */
  reset(): void {
    this.stop();
    this.st = { data: null, receivedAt: null, skewMs: null, error: null };
    this.deps.onChange(this.st);
  }

  private async poll(): Promise<void> {
    if (!this.running || this.pending) return;
    this.pending = true;
    const epoch = this.epoch;
    const started = this.deps.now();
    let r: ApiResult | DeviceError;
    try {
      r = await this.deps.get();
    } catch {
      r = { error: 'unreachable' };
    }
    if (epoch !== this.epoch) return; // đã dừng trong lúc chờ
    this.pending = false;
    const received = this.deps.now();
    if (isDeviceError(r)) {
      this.st = { ...this.st, error: r.error };
    } else {
      const data = r.status === 200 ? parseDiagnostics(r.body) : null;
      this.st = data
        ? {
            data,
            receivedAt: received,
            skewMs: Math.round(data.at - (started + received) / 2),
            error: null,
          }
        : { ...this.st, error: 'bad-response' };
    }
    this.deps.onChange(this.st);
    if (this.running)
      this.timer = (this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(
        () => void this.poll(),
        DIAGNOSTICS_PERIOD_MS,
      );
  }
}
