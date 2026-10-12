// Kết quả tìm thiết bị cho hộp thoại Thiết bị trong mạng (feature 005, data-model §1, contract discovery
// §5, §5a, spec US1-1, Edge Cases). Logic thuần, không DOM, không chuỗi giao diện (lý do, gợi ý là mã):
// - lượt quét (`DiscoveryScan`): kết quả đến dần qua `DeviceLink.discover`, Tìm lại xóa kết quả cũ;
// - gộp theo (`deviceId`, IP); sắp theo tên rồi IP; trùng tên thì đánh dấu để hiện MAC;
// - ghép với thiết bị đã lưu (`devices.json`): khớp theo `deviceId` (kể cả khi đổi IP) hoặc host:cổng;
// - card VPN, card không broadcast hiện mờ kèm lý do; không thấy gì thì gợi ý tường lửa, Thêm theo địa chỉ;
// - fingerprint của gói tìm chỉ để tham khảo (R6): khác kết quả dò thì cảnh báo đỏ.
import {
  deviceError,
  type DeviceError,
  type DeviceLink,
  type DeviceStatus,
  type DiscoveredDevice,
  type DiscoverSummary,
  type KnownDevice,
  type NetInterface,
  type ProbeResult,
} from '../platform/device-types.ts';

/** Một lượt quét: gửi lúc 0, 600, 1200 ms, nhận tới 2500 ms (contract discovery §5). */
export const SCAN_MS = 2500;

export const foundKey = (d: Pick<DiscoveredDevice, 'deviceId' | 'ip'>): string =>
  `${d.deviceId}@${d.ip}`;

const ipv4 = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  return m ? m.slice(1).map(Number) : null;
};

/** So IPv4 theo số (192.168.1.9 trước 192.168.1.10); không phải IPv4 thì so chuỗi. */
export function compareIp(a: string, b: string): number {
  const pa = ipv4(a);
  const pb = ipv4(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const nameKey = (s: string) => s.trim().toLocaleLowerCase('vi');
const compareName = (a: string, b: string) =>
  a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' });

/** Thêm một gói trả lời: cùng (deviceId, IP) thì bản mới thay bản cũ (thiết bị trả lời cả ba gói hỏi). */
export function mergeFound(
  list: readonly DiscoveredDevice[],
  d: DiscoveredDevice,
): DiscoveredDevice[] {
  const key = foundKey(d);
  const i = list.findIndex((x) => foundKey(x) === key);
  if (i < 0) return [...list, d];
  const next = [...list];
  next[i] = d;
  return next;
}

/** Sắp theo tên (không phân biệt hoa thường, số theo giá trị), rồi IP. */
export function sortFound(list: readonly DiscoveredDevice[]): DiscoveredDevice[] {
  return [...list].sort((a, b) => compareName(a.name, b.name) || compareIp(a.ip, b.ip));
}

/**
 * Một dòng của bảng thiết bị: thiết bị trả lời gói tìm (kèm mục đã lưu khớp với nó, nếu có), hoặc thiết bị đã
 * lưu không trả lời lượt quét này (khác subnet, qua VPN, tắt tìm thiết bị, runtime cũ).
 */
export type DeviceRow =
  | {
      kind: 'found';
      key: string;
      device: DiscoveredDevice;
      known: KnownDevice | null;
      /** Có dòng khác cùng tên: hiện MAC để phân biệt. */
      sameName: boolean;
    }
  | { kind: 'saved'; key: string; known: KnownDevice; sameName: boolean };

const matches = (k: KnownDevice, d: DiscoveredDevice): boolean =>
  (!!k.deviceId && k.deviceId === d.deviceId) ||
  (k.host.toLowerCase() === d.ip && k.httpsPort === d.httpsPort);

export function deviceRows(
  found: readonly DiscoveredDevice[],
  known: readonly KnownDevice[],
): DeviceRow[] {
  const used = new Set<string>();
  const rows: DeviceRow[] = sortFound(found).map((d) => {
    const k = known.find((x) => !used.has(x.id) && matches(x, d)) ?? null;
    if (k) used.add(k.id);
    return { kind: 'found', key: foundKey(d), device: d, known: k, sameName: false };
  });
  for (const k of known)
    if (!used.has(k.id))
      rows.push({ kind: 'saved', key: `saved:${k.id}`, known: k, sameName: false });
  const count = new Map<string, number>();
  const nameOf = (r: DeviceRow) => nameKey(r.kind === 'found' ? r.device.name : r.known.name);
  for (const r of rows) count.set(nameOf(r), (count.get(nameOf(r)) ?? 0) + 1);
  return rows.map((r) => ({ ...r, sameName: (count.get(nameOf(r)) ?? 0) > 1 }));
}

export type StatusKind = DeviceStatus | 'unknown';

const STATUSES: readonly string[] = ['running', 'no-project', 'project-error', 'activating'];

/** Trạng thái lạ vẫn hiện thiết bị, ghi "không rõ" (discovery §5a). */
export const statusKind = (s: string): StatusKind =>
  STATUSES.includes(s) ? (s as DeviceStatus) : 'unknown';

/** Một card mạng trong ô chọn; card không quét được hiện mờ kèm lý do. */
export interface IfaceOption {
  index: number;
  name: string;
  /** Địa chỉ của card, dạng `192.168.1.20/24`. */
  cidr: string;
  /** Subnet sẽ quét, dạng `192.168.1.0/24`. */
  subnet: string;
  usable: boolean;
  reason: 'vpn' | 'no-broadcast' | null;
}

function subnetOf(address: string, prefix: number): string {
  const p = ipv4(address);
  if (!p || prefix < 0 || prefix > 32) return `${address}/${prefix}`;
  const ip = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const net = (ip & mask) >>> 0;
  return `${[net >>> 24, (net >>> 16) & 255, (net >>> 8) & 255, net & 255].join('.')}/${prefix}`;
}

export function ifaceOptions(list: readonly NetInterface[]): IfaceOption[] {
  return list.map((i) => ({
    index: i.index,
    name: i.name,
    cidr: `${i.address}/${i.prefix}`,
    subnet: subnetOf(i.address, i.prefix),
    usable: i.canBroadcast,
    reason: i.canBroadcast ? null : i.hint === 'vpn' ? 'vpn' : 'no-broadcast',
  }));
}

export type ScanState = 'idle' | 'scanning' | 'done' | 'error';
export type ScanHint = 'none-found' | 'iface-failed' | null;

/** Gợi ý sau lượt quét không thấy thiết bị nào: card lỗi, hoặc kiểm tường lửa và Thêm theo địa chỉ. */
export function scanHint(s: {
  state: ScanState;
  rows: readonly unknown[];
  summary: DiscoverSummary | null;
}): ScanHint {
  if (s.state !== 'done' || s.rows.length) return null;
  return s.summary?.failed.length && !s.summary.scanned ? 'iface-failed' : 'none-found';
}

/** Fingerprint của gói tìm so với fingerprint thấy khi bắt tay TLS (chỉ tham khảo). */
export function compareDiscovered(p: ProbeResult): 'same' | 'differs' | 'unknown' {
  if (!p.discovered) return 'unknown';
  return p.discovered === p.fingerprint ? 'same' : 'differs';
}

/** Một lượt quét đang chạy hoặc đã xong; kết quả đến dần. Tìm lại xóa kết quả cũ. */
export class DiscoveryScan {
  private st: ScanState = 'idle';
  private list: DiscoveredDevice[] = [];
  private sorted: DiscoveredDevice[] = [];
  private sum: DiscoverSummary | null = null;
  private err: string | null = null;
  private errFull: DeviceError | null = null;
  private started: number | null = null;
  private finished: number | null = null;
  private chosen: number[] | null = null;
  private run = 0;
  private readonly listeners = new Set<() => void>();
  private readonly link: DeviceLink;
  private readonly now: () => number;

  constructor(link: DeviceLink, now: () => number = () => Date.now()) {
    this.link = link;
    this.now = now;
  }

  get state(): ScanState {
    return this.st;
  }

  /** Thiết bị đã trả lời, đã gộp và sắp. */
  get rows(): readonly DiscoveredDevice[] {
    return this.sorted;
  }

  get summary(): DiscoverSummary | null {
    return this.sum;
  }

  /** Mã lỗi khi `state === 'error'` (`busy`…). */
  get error(): string | null {
    return this.err;
  }

  /** Lỗi gốc khi `state === 'error'` (mã kèm dữ liệu), để giao diện nói câu theo mã. */
  get failure(): DeviceError | null {
    return this.errFull;
  }

  /** Thời điểm bắt đầu lượt quét (ms), để hiện tiến trình. */
  get startedAt(): number | null {
    return this.started;
  }

  /** Thời điểm lượt quét kết thúc (ms), để hiện "Tìm xong trong … s". */
  get finishedAt(): number | null {
    return this.finished;
  }

  /** Card đã chọn của lượt quét gần nhất (`null`: mọi card broadcast được). */
  get ifaces(): number[] | null {
    return this.chosen;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  /** Bắt đầu lượt quét mới (Tìm lại). Đang quét thì bỏ qua. */
  async start(ifaces: number[] | null): Promise<void> {
    if (this.st === 'scanning') return;
    const run = ++this.run;
    this.st = 'scanning';
    this.list = [];
    this.sorted = [];
    this.sum = null;
    this.err = null;
    this.errFull = null;
    this.chosen = ifaces;
    this.started = this.now();
    this.finished = null;
    this.emit();
    try {
      const sum = await this.link.discover(ifaces, (d) => {
        if (run !== this.run) return; // gói của lượt cũ tới muộn
        this.list = mergeFound(this.list, d);
        this.sorted = sortFound(this.list);
        this.emit();
      });
      if (run !== this.run) return;
      this.sum = sum;
      this.finished = this.now();
      this.st = 'done';
    } catch (e) {
      if (run !== this.run) return;
      this.finished = this.now();
      this.errFull = deviceError(e);
      this.err = this.errFull.error;
      this.st = 'error';
    }
    this.emit();
  }
}
