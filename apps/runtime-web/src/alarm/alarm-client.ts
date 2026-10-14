// Kho trạng thái alarm của trang vận hành (feature 009, FR-063, FR-066; contracts/ui-alarm.md §2, live-protocol-1.3.md §4.1, §6, §9):
// `LiveAlarmSource` cài `AlarmSource` của @mat/ui-components trên LiveConnection 1.3.0.
//  - Snapshot mới THAY HOÀN TOÀN trạng thái; delta thay theo `id` instance và xóa `removed`; `counts` và `revision` lấy từ bản tin mới nhất.
//  - Mỗi thay đổi tạo bản chụp bất biến mới (so `===`); instance không đổi giữ nguyên đối tượng.
//  - `status()`: unsupported (thiết bị < 1.3.0), none (project không có alarm), offline (chưa có dữ liệu), live, stale (mất kết nối
//    hoặc đang xin lại snapshot sau khi sequence đứt; hàng cũ còn hiện, bảng mờ).
//  - Thông báo gộp ở cuối microtask.
import type {
  AlarmDeltaMsg,
  AlarmSnapshotMsg,
  AlarmSupport,
  ConnState,
  LiveConnection,
} from '@mat/live-client';
import {
  AlarmNotifier,
  emptyCounts,
  type AlarmAreaInfo,
  type AlarmClassInfo,
  type AlarmCounts,
  type AlarmInstance,
  type AlarmSnapshot,
  type AlarmSource,
  type AlarmSourceStatus,
} from '@mat/ui-components';

export interface LiveAlarmSourceOptions {
  conn?: LiveConnection;
  /** Đăng ký nghe trạng thái thô của kết nối (LiveTagSource.onState); trả hàm hủy. */
  onState?: (fn: (s: ConnState) => void) => () => void;
  /** Giờ tham chiếu (ms UTC): cùng nguồn với TagSource.now(). */
  now?: () => number;
}

const EMPTY: AlarmSnapshot = {
  instances: [],
  classes: [],
  areas: [],
  counts: emptyCounts(),
  revision: 0,
};

export class LiveAlarmSource implements AlarmSource {
  readonly #conn: LiveConnection | undefined;
  readonly #onState: LiveAlarmSourceOptions['onState'];
  readonly #now: () => number;
  readonly #n = new AlarmNotifier();
  readonly #map = new Map<string, AlarmInstance>();
  #classes: readonly AlarmClassInfo[] = [];
  #areas: readonly AlarmAreaInfo[] = [];
  #counts: AlarmCounts = EMPTY.counts;
  #revision = 0;
  #snap: AlarmSnapshot = EMPTY;
  #support: AlarmSupport | 'unknown' = 'unknown';
  #connected = false;
  #fresh = false;
  #everSnap = false;
  #lastStatus: AlarmSourceStatus = 'offline';
  #offState: (() => void) | null = null;

  constructor(o: LiveAlarmSourceOptions = {}) {
    this.#conn = o.conn;
    this.#onState = o.onState;
    this.#now = o.now ?? (() => Date.now());
  }

  /** Nối với LiveConnection và đăng ký nhận alarm (gửi sau `hello` nếu thiết bị hỗ trợ; tự đăng ký lại khi kết nối lại). */
  start(): void {
    const c = this.#conn;
    if (!c) return;
    c.onAlarmSupport = (s) => this.setSupport(s);
    c.onAlarmSnapshot = (s) => this.applySnapshot(s);
    c.onAlarmDelta = (d) => this.applyDelta(d);
    c.onAlarmResync = () => this.markResync();
    this.#offState =
      this.#onState?.((s) => this.setConnected(s === 'open' || s === 'live')) ?? null;
    c.subscribeAlarms();
  }

  stop(): void {
    this.#offState?.();
    this.#offState = null;
    this.#conn?.unsubscribeAlarms();
  }

  // ---- AlarmSource -------------------------------------------------------------------------------------------------

  snapshot(): AlarmSnapshot {
    return this.#snap;
  }
  counts(): AlarmCounts {
    return this.#counts;
  }
  classes(): readonly AlarmClassInfo[] {
    return this.#classes;
  }
  areas(): readonly AlarmAreaInfo[] {
    return this.#areas;
  }
  now(): number {
    return this.#now();
  }
  subscribe(fn: (changed: readonly string[] | 'all') => void): () => void {
    return this.#n.subscribe(fn);
  }

  status(): AlarmSourceStatus {
    if (this.#support === 'unsupported') return 'unsupported';
    if (this.#support === 'none') return 'none';
    if (!this.#everSnap) return 'offline';
    return this.#connected && this.#fresh ? 'live' : 'stale';
  }

  // ---- đầu vào (từ LiveConnection hoặc test) -----------------------------------------------------------------------

  setSupport(s: AlarmSupport): void {
    this.#support = s;
    if (s !== 'supported' && (this.#map.size > 0 || this.#everSnap)) {
      // Project mới không có alarm (hoặc thiết bị cũ): bỏ dữ liệu của project trước.
      this.#map.clear();
      this.#classes = [];
      this.#areas = [];
      this.#counts = EMPTY.counts;
      this.#revision = 0;
      this.#everSnap = false;
      this.#fresh = false;
      this.#rebuild();
      this.#n.notify('all');
    }
    this.#statusChanged();
  }

  setConnected(c: boolean): void {
    if (this.#connected === c) return;
    this.#connected = c;
    if (!c) this.#fresh = false;
    this.#statusChanged();
  }

  /** Sequence đứt hoặc thiếu mảnh: đã xin lại snapshot; hàng cũ còn hiện nhưng đánh dấu cũ. */
  markResync(): void {
    this.#fresh = false;
    this.#statusChanged();
  }

  applySnapshot(s: AlarmSnapshotMsg): void {
    this.#map.clear();
    for (const i of s.instances) this.#map.set(i.id, i);
    this.#classes = s.classes;
    this.#areas = s.areas;
    this.#counts = s.counts;
    this.#revision = s.revision;
    this.#connected = true;
    this.#fresh = true;
    this.#everSnap = true;
    this.#rebuild();
    this.#n.notify('all');
    this.#lastStatus = this.status();
  }

  applyDelta(d: AlarmDeltaMsg): void {
    const ids: string[] = [];
    for (const i of d.changed) {
      this.#map.set(i.id, i);
      ids.push(i.id);
    }
    for (const id of d.removed) if (this.#map.delete(id)) ids.push(id);
    this.#counts = d.counts;
    this.#revision = d.revision;
    this.#rebuild();
    if (ids.length > 0) this.#n.notify(ids);
  }

  #rebuild(): void {
    this.#snap = {
      instances: [...this.#map.values()],
      classes: this.#classes,
      areas: this.#areas,
      counts: this.#counts,
      revision: this.#revision,
    };
  }

  #statusChanged(): void {
    const s = this.status();
    if (s === this.#lastStatus) return;
    this.#lastStatus = s;
    this.#n.notify('all');
  }
}
