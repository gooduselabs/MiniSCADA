// Nguồn alarm sống của Studio khi Online (feature 009, T082, FR-074, FR-081, contract studio-alarm-editor §8): nối
// `alarmSnapshot`, `alarmDelta` của LiveConnection 1.3.0 thành `AlarmSource` chỉ đọc (Studio không xác nhận, không tạm ẩn,
// D31). Dùng cho cột "Trạng thái sống" của lưới alarm và cho xem trước màn hình ở chế độ Thiết bị. Logic cùng với
// `LiveAlarmSource` của trang vận hành; Studio giữ bản riêng để không phụ thuộc chéo giữa hai ứng dụng.
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

const EMPTY: AlarmSnapshot = {
  instances: [],
  classes: [],
  areas: [],
  counts: emptyCounts(),
  revision: 0,
};

export class StudioAlarmSource implements AlarmSource {
  private readonly n = new AlarmNotifier();
  private readonly map = new Map<string, AlarmInstance>();
  private conn: LiveConnection | null = null;
  private wanted = false;
  private classesList: readonly AlarmClassInfo[] = [];
  private areasList: readonly AlarmAreaInfo[] = [];
  private countsValue: AlarmCounts = EMPTY.counts;
  private revision = 0;
  private snap: AlarmSnapshot = EMPTY;
  private support: AlarmSupport | 'unknown' = 'unknown';
  private connected = false;
  private fresh = false;
  private everSnap = false;
  private lastStatus: AlarmSourceStatus = 'offline';
  private readonly clock: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.clock = now;
  }

  /** Gắn với kết nối live mới (mỗi lần mở lại); dữ liệu của kết nối cũ giữ tới khi snapshot mới tới. */
  attach(conn: LiveConnection): void {
    this.detach();
    this.conn = conn;
    conn.onAlarmSupport = (s) => this.setSupport(s);
    conn.onAlarmSnapshot = (s) => this.applySnapshot(s);
    conn.onAlarmDelta = (d) => this.applyDelta(d);
    conn.onAlarmResync = () => this.markResync();
    if (this.wanted) conn.subscribeAlarms();
  }

  detach(): void {
    const c = this.conn;
    if (!c) return;
    c.onAlarmSupport = null;
    c.onAlarmSnapshot = null;
    c.onAlarmDelta = null;
    c.onAlarmResync = null;
    this.conn = null;
    this.setConnected(false);
  }

  /** Người dùng cần alarm (lưới đang mở, xem trước Thiết bị): đăng ký nhận khi thiết bị hỗ trợ. */
  want(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) this.conn?.subscribeAlarms();
    else this.conn?.unsubscribeAlarms();
  }

  /** Trạng thái thô của kết nối live (`open`, `live`: đang nối). */
  onConnState(s: ConnState): void {
    this.setConnected(s === 'open' || s === 'live');
  }

  /** Bỏ mọi dữ liệu (Offline, đổi thiết bị). */
  clear(): void {
    this.map.clear();
    this.classesList = [];
    this.areasList = [];
    this.countsValue = EMPTY.counts;
    this.revision = 0;
    this.everSnap = false;
    this.fresh = false;
    this.support = 'unknown';
    this.rebuild();
    this.n.notify('all');
    this.statusChanged();
  }

  snapshot(): AlarmSnapshot {
    return this.snap;
  }
  counts(): AlarmCounts {
    return this.countsValue;
  }
  classes(): readonly AlarmClassInfo[] {
    return this.classesList;
  }
  areas(): readonly AlarmAreaInfo[] {
    return this.areasList;
  }
  now(): number {
    return this.clock();
  }
  subscribe(fn: (changed: readonly string[] | 'all') => void): () => void {
    return this.n.subscribe(fn);
  }

  status(): AlarmSourceStatus {
    if (this.support === 'unsupported') return 'unsupported';
    if (this.support === 'none') return 'none';
    if (!this.everSnap) return 'offline';
    return this.connected && this.fresh ? 'live' : 'stale';
  }

  setSupport(s: AlarmSupport): void {
    this.support = s;
    if (s !== 'supported' && (this.map.size > 0 || this.everSnap)) {
      this.map.clear();
      this.classesList = [];
      this.areasList = [];
      this.countsValue = EMPTY.counts;
      this.revision = 0;
      this.everSnap = false;
      this.fresh = false;
      this.rebuild();
      this.n.notify('all');
    }
    this.statusChanged();
  }

  setConnected(c: boolean): void {
    if (this.connected === c) return;
    this.connected = c;
    if (!c) this.fresh = false;
    this.statusChanged();
  }

  markResync(): void {
    this.fresh = false;
    this.statusChanged();
  }

  applySnapshot(s: AlarmSnapshotMsg): void {
    this.map.clear();
    for (const i of s.instances) this.map.set(i.id, i);
    this.classesList = s.classes;
    this.areasList = s.areas;
    this.countsValue = s.counts;
    this.revision = s.revision;
    this.connected = true;
    this.fresh = true;
    this.everSnap = true;
    this.rebuild();
    this.n.notify('all');
    this.lastStatus = this.status();
  }

  applyDelta(d: AlarmDeltaMsg): void {
    const ids: string[] = [];
    for (const i of d.changed) {
      this.map.set(i.id, i);
      ids.push(i.id);
    }
    for (const id of d.removed) if (this.map.delete(id)) ids.push(id);
    this.countsValue = d.counts;
    this.revision = d.revision;
    this.rebuild();
    if (ids.length > 0) this.n.notify(ids);
  }

  private rebuild(): void {
    this.snap = {
      instances: [...this.map.values()],
      classes: this.classesList,
      areas: this.areasList,
      counts: this.countsValue,
      revision: this.revision,
    };
  }

  private statusChanged(): void {
    const s = this.status();
    if (s === this.lastStatus) return;
    this.lastStatus = s;
    this.n.notify('all');
  }
}

/** Trạng thái sống của một dòng lưới (một định nghĩa): instance nặng nhất, số ngưỡng đang có (alarm ngưỡng). */
export interface LiveRow {
  /** Instance quyết định chữ và màu: ưu tiên cao nhất, rồi chưa xác nhận trước. */
  top: AlarmInstance | null;
  /** Số instance không ở trạng thái NORMAL (đang có), tổng số instance của dòng trên thiết bị. */
  active: number;
  total: number;
  instances: readonly AlarmInstance[];
}

const PRIORITY_RANK = { critical: 0, major: 1, minor: 2, advisory: 3 } as const;
const STATE_RANK = { ACTIVE_UNACK: 0, RTN_UNACK: 1, ACTIVE_ACK: 2, NORMAL: 3 } as const;

/** Gom instance theo `alarmId` (id của định nghĩa trong alarms.json). */
export function liveByDef(snap: AlarmSnapshot): Map<string, LiveRow> {
  const out = new Map<string, AlarmInstance[]>();
  for (const i of snap.instances) {
    const list = out.get(i.alarmId);
    if (list) list.push(i);
    else out.set(i.alarmId, [i]);
  }
  const rows = new Map<string, LiveRow>();
  for (const [id, list] of out) {
    const sorted = [...list].sort(
      (a, b) =>
        (a.state === 'NORMAL' ? 1 : 0) - (b.state === 'NORMAL' ? 1 : 0) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        STATE_RANK[a.state] - STATE_RANK[b.state],
    );
    rows.set(id, {
      top: sorted[0] ?? null,
      active: list.filter((i) => i.state !== 'NORMAL').length,
      total: list.length,
      instances: sorted,
    });
  }
  return rows;
}
