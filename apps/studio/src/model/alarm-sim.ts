// Bộ điều khiển "Thử alarm" (feature 009, T074, FR-080, FR-081; contract studio-alarm-editor §7): ghép `@mat/alarm-engine`
// (bản TS, cùng vector với C++) với `SimEngine` của 006 bằng một đồng hồ ảo. `SimEngine` nhận đồng hồ tiêm vào
// (`opts.clock`) và `tick()` tính lại tại đồng hồ đó, nên không cần bộ chuyển đổi: cả hai động cơ đọc cùng `virtualNowMs`.
// Không DOM, không hẹn giờ thật: giao diện gọi `advanceRealMs` / `step` theo nhịp của nó. Mọi hành động chỉ trong phiên thử.
import type { ValueTable } from '@mat/expression';
import type { AlarmArea, AlarmClassDef, AlarmDef, TagDefinition, TagV1 } from '@mat/project-schema';
import {
  AlarmEngine,
  compileAlarms,
  type AlarmDefs,
  type AlarmEvent,
  type AlarmItem,
  type AlarmTagInfo,
  type AlarmView,
  type OccurrenceRow,
  type Quality,
  type TagSample,
} from '@mat/alarm-engine';
import type {
  ActionHost,
  AlarmAckOutcome,
  AlarmAckRequest,
  AlarmAckResultCode,
  AlarmActionOutcome,
  AlarmClassInfo,
  AlarmInstance,
  AlarmShelveRequest,
  AlarmSnapshot,
  AlarmSource,
  AlarmSourceStatus,
} from '@mat/ui-components';
import { AlarmNotifier, emptyCounts } from '@mat/ui-components';
import { SimEngine } from './sim-engine.ts';

export const ALARM_SIM_TICK_MS = 250;
export type AlarmSimSpeed = 1 | 5 | 20;
export const ALARM_SIM_SPEEDS: readonly AlarmSimSpeed[] = [1, 5, 20];
export const ALARM_SIM_LOG_MAX = 2000;

/** Từ vựng lý do của nhật ký (contract §7.4). */
export type AlarmLogReason =
  | 'on-delay'
  | 'off-delay'
  | 'deadband'
  | 'ack'
  | 'ack-return'
  | 'shelve'
  | 'shelve-expired'
  | 'unshelve'
  | 'chatter-isolate'
  | 'chatter-release'
  | 'disable'
  | 'enable'
  | 'input-bad'
  | 'input-good'
  | 'restart';

export interface AlarmLogEntry {
  /** Giờ ảo (ms). */
  t: number;
  instance: string;
  from: string;
  to: string;
  reason: AlarmLogReason;
  /** Chi tiết thô (giá trị, ngưỡng, trễ, mã lần xảy ra); không dịch. */
  detail: string;
}

export interface ManualTag {
  value: number;
  quality: Quality;
  reason?: string;
}

export interface AlarmSimProject {
  alarms: readonly AlarmDef[];
  classes: readonly AlarmClassDef[];
  areas: readonly AlarmArea[];
}

export interface AlarmSimOptions {
  project: AlarmSimProject;
  tags: readonly (TagV1 | TagDefinition)[];
  tables?: readonly ValueTable[];
  /** Id alarm bị bỏ qua (lỗi của bộ kiểm tra); liệt kê lại ở `skipped`. */
  skip?: readonly string[];
  /** Giờ treo tường ảo tại t = 0 (ms UTC). Mặc định một mốc cố định để chuỗi tất định. */
  epoch0?: number;
  tickMs?: number;
  chatterWindowS?: number;
  chatterShelveS?: number;
  /** Tên tài khoản giả cho ack/shelve thử. */
  user?: string;
}

const DEFAULT_EPOCH0 = 1_791_600_000_000;
const UNKNOWN: TagSample = { known: false, value: 0, quality: 'BAD', reason: 'NO_DATA' };
const noopTimers = { setInterval: (): unknown => null, clearInterval: (): void => undefined };
const PRIORITIES = ['critical', 'major', 'minor', 'advisory'] as const;

const isV02 = (t: TagV1 | TagDefinition): t is TagV1 => typeof (t as TagV1).kind === 'string';

/** Tag đọc từ thiết bị trường: id thiết bị → id Tag (không tính Tag tính toán, mô phỏng, nội bộ). */
export function deviceTagsOf(tags: readonly (TagV1 | TagDefinition)[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of tags) {
    if (!isV02(t) || t.kind !== 'external' || !t.source?.device) continue;
    (out[t.source.device] ??= []).push(t.id);
  }
  return out;
}

/** Thông tin tĩnh của Tag cho động cơ: đơn vị, BOOL, nhãn từ bảng giá trị (mục có `value`). */
export function tagInfoOf(
  tags: readonly (TagV1 | TagDefinition)[],
  tables: readonly ValueTable[] = [],
): Record<string, AlarmTagInfo> {
  const byName = new Map(tables.filter((t) => t.name).map((t) => [t.name!, t]));
  const out: Record<string, AlarmTagInfo> = {};
  for (const t of tags) {
    const info: AlarmTagInfo = {};
    if (t.unit) info.unit = t.unit;
    if (t.type === 'BOOL') info.isBool = true;
    const vt = isV02(t) && t.valueTable ? byName.get(t.valueTable) : undefined;
    if (vt) {
      const labels: Record<string, string> = {};
      for (const e of vt.entries)
        if (e.value !== undefined)
          labels[String(typeof e.value === 'boolean' ? (e.value ? 1 : 0) : e.value)] = e.text;
      if (Object.keys(labels).length) info.labels = labels;
    }
    out[t.id] = info;
  }
  return out;
}

const toSample = (
  e: { value: unknown; quality: Quality; reason?: string } | undefined,
): TagSample => {
  if (!e || e.value === null || e.value === undefined) return UNKNOWN;
  const v = e.value;
  const value =
    typeof v === 'boolean'
      ? v
        ? 1
        : 0
      : typeof v === 'number'
        ? v
        : typeof v === 'string'
          ? Number(v)
          : 0;
  return {
    known: true,
    value: Number.isFinite(value) ? value : 0,
    quality: e.quality,
    ...(e.reason ? { reason: e.reason } : {}),
  };
};

export class AlarmSim {
  readonly tickMs: number;
  readonly epoch0: number;
  readonly user: string;
  readonly sim: SimEngine;
  readonly skipped: readonly string[];
  private readonly opts: AlarmSimOptions;
  private readonly tagInfo: Record<string, AlarmTagInfo>;
  private readonly defs: AlarmDefs;
  private engine: AlarmEngine;
  private virtualNow = 0;
  private speedValue: AlarmSimSpeed = 1;
  private realAcc = 0;
  private readonly manual = new Map<string, ManualTag>();
  private readonly rows = new Map<number, OccurrenceRow>();
  private readonly logRing: AlarmLogEntry[] = [];
  private readonly inputBadSeen = new Map<string, boolean>();
  private readonly notifier = new AlarmNotifier();
  private viewCache: AlarmView;
  private snapshotCache: AlarmSnapshot | null = null;
  private readonly pending = new Map<string, Array<(e: AlarmEvent) => void>>();

  constructor(opts: AlarmSimOptions) {
    this.opts = opts;
    this.tickMs = opts.tickMs ?? ALARM_SIM_TICK_MS;
    this.epoch0 = opts.epoch0 ?? DEFAULT_EPOCH0;
    this.user = opts.user ?? 'thu';
    const skip = new Set(opts.skip ?? []);
    this.skipped = [...skip];
    this.tagInfo = tagInfoOf(opts.tags, opts.tables);
    this.defs = compileAlarms({
      alarms: {
        areas: [...opts.project.areas],
        alarms: opts.project.alarms.filter((a) => !skip.has(a.id)),
      },
      alarmClasses: { classes: [...opts.project.classes] },
      devices: deviceTagsOf(opts.tags),
    });
    this.sim = new SimEngine({ clock: () => this.epoch0 + this.virtualNow, timers: noopTimers });
    this.sim.load(opts.tags, opts.tables ?? []);
    this.sim.start();
    this.engine = this.newEngine();
    this.engine.load(this.defs, this.tagInfo, {
      nowMonoMs: 0,
      nowEpochMs: this.epoch0,
      processStart: true,
      nextOccurrence: 1,
    });
    this.viewCache = this.engine.view();
  }

  private newEngine(): AlarmEngine {
    return new AlarmEngine({
      ...(this.opts.chatterWindowS !== undefined
        ? { chatterWindowS: this.opts.chatterWindowS }
        : {}),
      ...(this.opts.chatterShelveS !== undefined
        ? { chatterShelveS: this.opts.chatterShelveS }
        : {}),
    });
  }

  // ---------- đồng hồ ảo ----------

  get virtualNowMs(): number {
    return this.virtualNow;
  }
  get epochNowMs(): number {
    return this.epoch0 + this.virtualNow;
  }
  get speed(): AlarmSimSpeed {
    return this.speedValue;
  }
  set speed(s: AlarmSimSpeed) {
    this.speedValue = s;
  }
  get instanceCount(): number {
    return this.defs.instances.length;
  }
  watchedTags(): readonly string[] {
    return this.engine.watchedTags();
  }

  /** Một tick ảo: tiến đồng hồ, tính Tag mô phỏng, chạy động cơ alarm. Trả sự kiện của tick. */
  step(): AlarmEvent[] {
    this.virtualNow += this.tickMs;
    return this.runStep();
  }

  /** Chạy `n` tick ảo liên tiếp. */
  run(n: number): AlarmEvent[] {
    const out: AlarmEvent[] = [];
    for (let i = 0; i < n; i++) out.push(...this.step());
    return out;
  }

  /** Thời gian thật trôi `ms`: mỗi 250 ms thật chạy `speed` tick ảo (contract §7.1). */
  advanceRealMs(ms: number): AlarmEvent[] {
    this.realAcc += ms;
    let ticks = 0;
    while (this.realAcc >= ALARM_SIM_TICK_MS) {
      this.realAcc -= ALARM_SIM_TICK_MS;
      ticks += this.speedValue;
    }
    return this.run(ticks);
  }

  private samples(): TagSample[] {
    return this.engine.watchedTags().map((id) => this.sampleOf(id));
  }

  private runStep(): AlarmEvent[] {
    this.sim.tick();
    const events = this.engine.step(this.virtualNow, this.epochNowMs, this.samples());
    this.absorb(events);
    return events;
  }

  /** Áp lệnh đã gửi ngay tại giờ ảo hiện tại (không tiến đồng hồ): một `step` nữa cùng mốc thời gian. */
  private flush(): void {
    this.absorb(this.engine.step(this.virtualNow, this.epochNowMs, this.samples()));
  }

  private absorb(events: AlarmEvent[]): void {
    const changed = new Set<string>();
    for (const e of events) {
      if (e.row) this.rows.set(e.row.id, e.row);
      if (e.kind === 'command') this.pending.get(e.instance)?.shift()?.(e);
      if (e.instance) changed.add(e.instance);
      this.logEvent(e);
    }
    const view = this.engine.view();
    for (const it of view.items) {
      const prev = this.inputBadSeen.get(it.id) ?? false;
      if (prev !== it.inputBad) {
        this.inputBadSeen.set(it.id, it.inputBad);
        this.pushLog({
          t: this.virtualNow,
          instance: it.id,
          from: it.state,
          to: it.state,
          reason: it.inputBad ? 'input-bad' : 'input-good',
          detail: '',
        });
        changed.add(it.id);
      }
    }
    if (view.revision !== this.viewCache.revision || events.length > 0) {
      for (const old of this.viewCache.items)
        if (!view.items.some((i) => i.id === old.id)) changed.add(old.id);
      this.viewCache = view;
      this.snapshotCache = null;
      if (changed.size) this.notifier.notify([...changed]);
    }
  }

  // ---------- Tag nhập tay ----------

  setManual(tagId: string, v: ManualTag): void {
    this.manual.set(tagId, { ...v });
  }
  clearManual(tagId: string): void {
    this.manual.delete(tagId);
  }
  manualOf(tagId: string): ManualTag | undefined {
    return this.manual.get(tagId);
  }
  /** Mẫu Tag mà động cơ thấy ở tick kế (nhập tay hoặc mô phỏng). */
  sampleOf(tagId: string): TagSample {
    const m = this.manual.get(tagId);
    if (m)
      return {
        known: true,
        value: m.value,
        quality: m.quality,
        ...(m.reason ? { reason: m.reason } : {}),
      };
    return toSample(this.sim.get(tagId));
  }

  // ---------- lệnh thử ----------

  private command(id: string, submit: () => void): Promise<string> {
    return new Promise<AlarmEvent>((resolve) => {
      let list = this.pending.get(id);
      if (!list) this.pending.set(id, (list = []));
      list.push(resolve);
      submit();
      this.flush();
    }).then((e) => e.result ?? 'NOT_FOUND');
  }

  ack(id: string, occurrence: number): Promise<string> {
    return this.command(id, () =>
      this.engine.submit({ kind: 'ack', id, occurrence, user: this.user }),
    );
  }
  shelve(id: string, reason: string, durationS: number): Promise<string> {
    return this.command(id, () =>
      this.engine.submit({ kind: 'shelve', id, reason, durationS, user: this.user }),
    );
  }
  unshelve(id: string): Promise<string> {
    return this.command(id, () => this.engine.submit({ kind: 'unshelve', id, user: this.user }));
  }
  /** Bật/tắt từng alarm trong phiên thử (vô hiệu thử; không đổi `enabled` của project). */
  setEnabled(id: string, enabled: boolean): Promise<string> {
    return this.command(id, () =>
      this.engine.submit(
        enabled
          ? { kind: 'enable', id, user: this.user }
          : { kind: 'disable', id, reason: 'thu', user: this.user },
      ),
    );
  }

  /** "Khởi động lại engine": động cơ mới, nạp lại hàng mở hiện có (như runtime khởi động lại với alarm.db). */
  restart(): AlarmEvent[] {
    const open = [...this.rows.values()].filter((r) => r.closed === 0).sort((a, b) => a.id - b.id);
    let next = 1;
    for (const id of this.rows.keys()) next = Math.max(next, id + 1);
    this.engine = this.newEngine();
    const events = this.engine.load(this.defs, this.tagInfo, {
      open,
      nowMonoMs: this.virtualNow,
      nowEpochMs: this.epochNowMs,
      processStart: true,
      nextOccurrence: next,
    });
    this.pushLog({
      t: this.virtualNow,
      instance: '',
      from: '',
      to: '',
      reason: 'restart',
      detail: `${open.length}`,
    });
    this.inputBadSeen.clear();
    this.absorb(events);
    this.notifier.notify('all');
    return events;
  }

  /** Đặt lại: đồng hồ về 0, xóa trạng thái, nhật ký, nhập tay; nạp lại Tag mô phỏng. */
  reset(): void {
    this.virtualNow = 0;
    this.realAcc = 0;
    this.manual.clear();
    this.rows.clear();
    this.logRing.length = 0;
    this.inputBadSeen.clear();
    this.pending.clear();
    this.sim.stop();
    this.sim.start();
    this.engine = this.newEngine();
    this.engine.load(this.defs, this.tagInfo, {
      nowMonoMs: 0,
      nowEpochMs: this.epoch0,
      processStart: true,
      nextOccurrence: 1,
    });
    this.viewCache = this.engine.view();
    this.snapshotCache = null;
    this.notifier.notify('all');
  }

  // ---------- nhật ký ----------

  get log(): readonly AlarmLogEntry[] {
    return this.logRing;
  }
  clearLog(): void {
    this.logRing.length = 0;
  }

  private pushLog(e: AlarmLogEntry): void {
    this.logRing.push(e);
    if (this.logRing.length > ALARM_SIM_LOG_MAX)
      this.logRing.splice(0, this.logRing.length - ALARM_SIM_LOG_MAX);
  }

  private logEvent(e: AlarmEvent): void {
    const def = this.defs.instances.find((d) => d.id === e.instance);
    const base = { t: e.tMono, instance: e.instance, from: e.from ?? '', to: e.to ?? '' };
    switch (e.kind) {
      case 'state': {
        const active = e.to === 'ACTIVE_UNACK' || e.to === 'ACTIVE_ACK';
        const wasActive = e.from === 'ACTIVE_UNACK' || e.from === 'ACTIVE_ACK';
        let reason: AlarmLogReason;
        let detail = '';
        if (e.closedBy === 'disabled') reason = 'disable';
        else if (e.closedBy === 'restart-lost' || e.closedBy === 'config') reason = 'restart';
        else if (active && !wasActive) {
          reason = 'on-delay';
          const th = def?.threshold;
          detail = `${e.value ?? ''}${th !== null && th !== undefined ? ` / ${th}` : ''} · ${def?.onDelayMs ?? 0} ms · #${e.occurrence ?? 0}`;
        } else if (e.from === 'ACTIVE_UNACK' && e.to === 'ACTIVE_ACK') reason = 'ack';
        else if (e.from === 'RTN_UNACK' && e.to === 'NORMAL') reason = 'ack-return';
        else if (e.from === 'ACTIVE_ACK' && e.to === 'ACTIVE_UNACK') reason = 'unshelve';
        else if (wasActive && !active) {
          reason = def?.kind === 'limit' && def.deadband > 0 ? 'deadband' : 'off-delay';
          detail = `${def?.offDelayMs ?? 0} ms · #${e.occurrence ?? 0}`;
        } else reason = 'restart';
        this.pushLog({ ...base, reason, detail });
        return;
      }
      case 'shelve':
        this.pushLog({
          ...base,
          reason: e.reason === 'chatter' ? 'chatter-isolate' : 'shelve',
          detail: e.reason ?? '',
        });
        return;
      case 'unshelve':
        this.pushLog({
          ...base,
          reason:
            e.reason === 'chatter-end'
              ? 'chatter-release'
              : e.reason === 'expired'
                ? 'shelve-expired'
                : 'unshelve',
          detail: '',
        });
        return;
      case 'disable':
      case 'enable':
        this.pushLog({ ...base, reason: e.kind, detail: '' });
        return;
      case 'chatter':
        this.pushLog({ ...base, reason: 'chatter-isolate', detail: `count ${e.count ?? 0}` });
        return;
      default:
        return;
    }
  }

  // ---------- AlarmSource / hành động cho <mat-alarm-table> và widget (§7.3, §7.5) ----------

  view(): AlarmView {
    return this.viewCache;
  }

  private toInstance(it: AlarmItem): AlarmInstance {
    const def = this.defs.instances.find((d) => d.id === it.id);
    return {
      id: it.id,
      alarmId: it.defId,
      name: it.name,
      type: def?.kind ?? 'digital',
      ...(it.limit ? { limit: it.limit } : {}),
      occurrence: it.occurrence,
      rev: it.rev,
      state: it.state,
      class: it.class,
      priority: it.priority,
      area: it.area ?? null,
      text: it.text ?? '',
      valueActive: it.value ?? null,
      qualityActive: it.quality ?? 'GOOD',
      ...(it.reason !== undefined ? { reason: it.reason } : {}),
      tsActive: it.tsActiveMs ?? 0,
      clockOk: it.clockOk ?? true,
      ...(it.tsAckMs !== undefined ? { tsAck: it.tsAckMs } : {}),
      ...(it.ackUser !== undefined ? { ackUser: it.ackUser } : {}),
      ...(it.tsReturnMs !== undefined ? { tsReturn: it.tsReturnMs } : {}),
      ...(it.shelve
        ? {
            shelved: {
              until: it.shelve.untilMs,
              remainingMs: it.shelve.remainingS * 1000,
              reason: it.shelve.reason,
              user: it.shelve.user,
              system: it.shelve.system,
            },
          }
        : {}),
      disabled: it.disabled === true,
      inputBad: it.inputBad,
      startup: it.startup === true,
    };
  }

  snapshot(): AlarmSnapshot {
    if (this.snapshotCache) return this.snapshotCache;
    const v = this.viewCache;
    const counts = emptyCounts();
    counts.active = v.counts.active;
    counts.unack = v.counts.unacked;
    counts.rtnUnack = v.counts.rtnUnack;
    counts.shelved = v.counts.shelved;
    counts.disabled = v.counts.disabled;
    for (const p of PRIORITIES)
      counts.byPriority[p] = {
        active: v.counts.activeByPriority[p],
        unack: v.counts.unackedByPriority[p],
      };
    const classes: AlarmClassInfo[] = this.opts.project.classes.map((c) => ({
      id: c.id,
      name: c.name,
      priority: c.priority,
      color: c.color,
      blink: c.blink ?? false,
      requiresAck: c.requiresAck ?? true,
      ackReturn: c.ackReturn ?? false,
      sound: c.sound ?? 'none',
      chatterLimit: c.chatterLimit ?? 5,
    }));
    this.snapshotCache = {
      instances: v.items.map((it) => this.toInstance(it)),
      classes,
      areas: this.defs.areas.map((a) => ({ id: a.id, name: a.name })),
      counts,
      revision: v.revision,
    };
    return this.snapshotCache;
  }

  /** Nguồn alarm cho bảng và widget; `status` = `live` (có alarm) hoặc `none`. */
  source(): AlarmSource {
    return {
      snapshot: () => this.snapshot(),
      subscribe: (fn) => this.notifier.subscribe(fn),
      counts: () => this.snapshot().counts,
      classes: () => this.snapshot().classes,
      areas: () => this.snapshot().areas,
      status: (): AlarmSourceStatus => (this.defs.instances.length ? 'live' : 'none'),
      now: () => this.epochNowMs,
    };
  }

  /** Ba hàm alarm của `ActionHost` (ghép với `SimActionHost` của 007 bằng `Object.assign`). */
  alarmActions(): Pick<ActionHost, 'ackAlarms' | 'shelveAlarm' | 'unshelveAlarm'> {
    return {
      ackAlarms: (req) => this.ackAlarms(req),
      shelveAlarm: (req) => this.shelveAlarm(req),
      unshelveAlarm: (id) => this.unshelve(id).then((r) => ({ ok: true, changed: r === 'OK' })),
    };
  }

  private async ackAlarms(req: AlarmAckRequest): Promise<AlarmAckOutcome> {
    let targets: { id: string; occurrence: number }[];
    if ('items' in req) targets = [...req.items];
    else {
      const f = req.filter;
      targets = this.engine
        .previewAck({ upToRevision: req.upToRevision, ...(f.q ? { q: f.q } : {}) })
        .filter((t) => {
          const it = this.viewCache.items.find((i) => i.id === t.id);
          if (!it) return false;
          if (f.areas?.length && !f.areas.includes(it.area ?? '-')) return false;
          if (f.classes?.length && !f.classes.includes(it.class)) return false;
          if (f.priorities?.length && !f.priorities.includes(it.priority)) return false;
          if (f.states?.length && !(f.states as readonly string[]).includes(it.state)) return false;
          return true;
        });
    }
    const results: { id: string; occurrence: number; result: AlarmAckResultCode }[] = [];
    for (const t of targets)
      results.push({
        id: t.id,
        occurrence: t.occurrence,
        result: (await this.ack(t.id, t.occurrence)) as AlarmAckResultCode,
      });
    const acked = results.filter((r) => r.result === 'ACKED').length;
    const skippedNewer =
      'all' in req
        ? this.viewCache.items.filter(
            (i) =>
              (i.state === 'ACTIVE_UNACK' || i.state === 'RTN_UNACK') && i.rev > req.upToRevision,
          ).length
        : 0;
    return { ok: true, results, acked, skippedNewer };
  }

  private async shelveAlarm(req: AlarmShelveRequest): Promise<AlarmActionOutcome> {
    const r = await this.shelve(req.id, req.reason, req.durationS);
    if (r === 'OK') return { ok: true, changed: true };
    return { ok: false, error: { code: r, message: r }, changed: false };
  }
}
