// Động cơ alarm ISA-18.2 (contracts/alarm-engine.md §1–§10; data-model.md §4–§5).
// Thuần: không I/O, không đọc đồng hồ; thời gian là tham số. Cùng ngữ nghĩa với core/alarm/alarm_engine.cpp.

import { defaultTemplate, foldText, formatAlarmText, fingerprintHex } from './text.ts';
import type {
  AckRequest,
  AckTarget,
  AlarmArea,
  AlarmClass,
  AlarmCounts,
  AlarmDefJson,
  AlarmDefs,
  AlarmEngineOptions,
  AlarmEvent,
  AlarmItem,
  AlarmState,
  AlarmTagInfo,
  AlarmView,
  ClosedBy,
  Command,
  CommandResultCode,
  InstanceDef,
  LimitName,
  LoadContext,
  OccurrenceRow,
  OverrideRow,
  Priority,
  ProjectLike,
  Quality,
  TagSample,
} from './types.ts';
import { PRIORITY_NUM } from './types.ts';

/** Ngưỡng mặc định của `clockOk`: 2020-01-01T00:00:00Z. */
export const DEFAULT_CLOCK_FLOOR_MS = 1577836800000;

export function isClockOk(epochMs: number, floorMs: number = DEFAULT_CLOCK_FLOOR_MS): boolean {
  return epochMs >= floorMs;
}

// ---------------------------------------------------------------- bảng chuyển trạng thái (data-model §5)

export type IsaEvent =
  | 'on'
  | 'off'
  | 'ack'
  | 'ackReturn'
  | 'shelve'
  | 'unshelve'
  | 'disable'
  | 'enable'
  | 'configRemoved'
  | 'restartReconcile';

export const ISA_STATES: readonly AlarmState[] = [
  'NORMAL',
  'ACTIVE_UNACK',
  'ACTIVE_ACK',
  'RTN_UNACK',
];
export const ISA_EVENTS: readonly IsaEvent[] = [
  'on',
  'off',
  'ack',
  'ackReturn',
  'shelve',
  'unshelve',
  'disable',
  'enable',
  'configRemoved',
  'restartReconcile',
];

export interface IsaContext {
  requiresAck: boolean;
  ackReturn: boolean;
  /** Điều kiện còn đúng (cho `unshelve` của ACTIVE_ACK). */
  condTrue?: boolean;
}

export type Transition =
  | { kind: 'move'; to: AlarmState; closes: boolean; opens: boolean }
  | { kind: 'reject'; to: AlarmState; result: 'NOT_ACTIVE' | 'ALREADY_ACKED' }
  | { kind: 'impossible' };

const IMPOSSIBLE: Transition = { kind: 'impossible' };
const mv = (to: AlarmState, closes = false, opens = false): Transition => ({
  kind: 'move',
  to,
  closes,
  opens,
});

/** 4 trạng thái × 10 sự kiện = 40 ô; ô "KTT" trả `impossible`. */
export function transition(state: AlarmState, ev: IsaEvent, ctx: IsaContext): Transition {
  const R = ctx.requiresAck;
  const AR = ctx.ackReturn && R;
  switch (state) {
    case 'NORMAL':
      switch (ev) {
        case 'on':
          return mv(R ? 'ACTIVE_UNACK' : 'ACTIVE_ACK', false, true);
        case 'off':
          return IMPOSSIBLE;
        case 'ack':
        case 'ackReturn':
          return { kind: 'reject', to: 'NORMAL', result: 'NOT_ACTIVE' };
        default:
          return mv('NORMAL', false, false);
      }
    case 'ACTIVE_UNACK':
      switch (ev) {
        case 'on':
        case 'ackReturn':
        case 'enable':
          return IMPOSSIBLE;
        case 'off':
          return R ? mv('RTN_UNACK') : mv('NORMAL', true);
        case 'ack':
          return mv('ACTIVE_ACK');
        case 'disable':
        case 'configRemoved':
          return mv('NORMAL', true);
        default:
          return mv('ACTIVE_UNACK');
      }
    case 'ACTIVE_ACK':
      switch (ev) {
        case 'on':
        case 'ackReturn':
        case 'enable':
          return IMPOSSIBLE;
        case 'off':
          return AR ? mv('RTN_UNACK') : mv('NORMAL', true);
        case 'ack':
          return { kind: 'reject', to: 'ACTIVE_ACK', result: 'ALREADY_ACKED' };
        case 'unshelve':
          return mv(R && ctx.condTrue === true ? 'ACTIVE_UNACK' : 'ACTIVE_ACK');
        case 'disable':
        case 'configRemoved':
          return mv('NORMAL', true);
        default:
          return mv('ACTIVE_ACK');
      }
    default:
      switch (ev) {
        case 'on':
          return mv(R ? 'ACTIVE_UNACK' : 'ACTIVE_ACK', true, true);
        case 'off':
        case 'ack':
        case 'enable':
          return IMPOSSIBLE;
        case 'ackReturn':
        case 'disable':
        case 'configRemoved':
          return mv('NORMAL', true);
        default:
          return mv('RTN_UNACK');
      }
  }
}

// ---------------------------------------------------------------- compileAlarms

const LIMIT_ORDER: readonly LimitName[] = ['HH', 'H', 'L', 'LL'];

function applyClassDefaults(
  c: NonNullable<ProjectLike['alarmClasses']>['classes'][number],
): AlarmClass {
  return {
    id: c.id,
    name: c.name,
    priority: c.priority,
    color: c.color,
    blink: c.blink ?? false,
    requiresAck: c.requiresAck ?? true,
    ackReturn: c.ackReturn ?? false,
    sound: c.sound ?? 'none',
    chatterLimit: c.chatterLimit ?? 5,
  };
}

/** Bung project 0.5 (alarms.json + alarm-classes.json) thành danh sách instance theo thứ tự cố định. */
export function compileAlarms(project: ProjectLike): AlarmDefs {
  const file = project.alarms;
  const classes = (project.alarmClasses?.classes ?? []).map(applyClassDefaults);
  const areas: AlarmArea[] = (file?.areas ?? []).map((a) => ({ id: a.id, name: a.name }));
  const devices = project.devices ?? {};
  const instances: InstanceDef[] = [];
  const base = (a: AlarmDefJson) => ({
    defId: a.id,
    name: a.name,
    onDelayMs: a.onDelayMs ?? 0,
    offDelayMs: a.offDelayMs ?? 0,
    areaId: a.area ?? '',
  });
  const finish = (d: Omit<InstanceDef, 'fingerprint'>): InstanceDef => ({
    ...d,
    fingerprint: fingerprintHex(d),
  });
  for (const a of file?.alarms ?? []) {
    if (a.enabled === false) continue;
    if (a.type === 'digital') {
      instances.push(
        finish({
          ...base(a),
          id: a.id,
          limitName: '',
          kind: 'digital',
          tagId: a.tag ?? '',
          deviceId: '',
          threshold: null,
          deadband: 0,
          trigger: a.trigger ?? true,
          on: null,
          classId: a.class ?? '',
          text: a.text ?? null,
        }),
      );
    } else if (a.type === 'quality') {
      instances.push(
        finish({
          ...base(a),
          id: a.id,
          limitName: '',
          kind: 'quality',
          tagId: a.device === undefined ? (a.tag ?? '') : '',
          deviceId: a.device ?? '',
          threshold: null,
          deadband: 0,
          trigger: null,
          on: a.on ?? 'bad',
          classId: a.class ?? '',
          text: a.text ?? null,
        }),
      );
    } else {
      for (const name of LIMIT_ORDER) {
        const l = a.limits?.[name];
        if (l === undefined) continue;
        instances.push(
          finish({
            ...base(a),
            id: `${a.id}.${name}`,
            limitName: name,
            kind: 'limit',
            tagId: a.tag ?? '',
            deviceId: '',
            threshold: l.value,
            deadband: a.deadband ?? 0,
            trigger: null,
            on: null,
            classId: l.class,
            text: l.text ?? a.text ?? null,
          }),
        );
      }
    }
  }
  const tagIds: string[] = [];
  const slot = new Map<string, number>();
  const add = (t: string): number => {
    let i = slot.get(t);
    if (i === undefined) {
      i = tagIds.length;
      tagIds.push(t);
      slot.set(t, i);
    }
    return i;
  };
  const deviceTags: Record<string, number[]> = {};
  for (const d of instances) {
    if (d.deviceId !== '') {
      if (deviceTags[d.deviceId] === undefined)
        deviceTags[d.deviceId] = (devices[d.deviceId] ?? []).map(add);
    } else {
      add(d.tagId);
    }
  }
  return { instances, classes, areas, tagIds, deviceTags };
}

// ---------------------------------------------------------------- động cơ

interface ShelveInfo {
  untilMono: number;
  untilEpoch: number;
  clockOk: boolean;
  user: string;
  reason: string;
  system: boolean;
}

interface Inst {
  def: InstanceDef;
  state: AlarmState;
  rawCond: boolean;
  cond: boolean;
  pendingSince: number;
  startupPending: boolean;
  startupEligible: boolean;
  evaluated: boolean;
  inputBad: boolean;
  shelve: ShelveInfo | null;
  disabled: boolean;
  occurrence: number;
  occ: OccurrenceRow | null;
  ring: number[];
  ghostCount: number;
  summary: OccurrenceRow | null;
  rev: number;
  slot: number;
  deviceSlots: number[];
}

const BUMP_KINDS: ReadonlySet<AlarmEvent['kind']> = new Set([
  'state',
  'shelve',
  'unshelve',
  'disable',
  'enable',
  'removed',
  'chatter',
]);
const NO_SAMPLES: readonly TagSample[] = [];

function freshInst(
  def: InstanceDef,
  slot: number,
  deviceSlots: number[],
  startupEligible: boolean,
): Inst {
  return {
    def,
    state: 'NORMAL',
    rawCond: false,
    cond: false,
    pendingSince: -1,
    startupPending: false,
    startupEligible,
    evaluated: !startupEligible,
    inputBad: false,
    shelve: null,
    disabled: false,
    occurrence: 0,
    occ: null,
    ring: [],
    ghostCount: 0,
    summary: null,
    rev: 0,
    slot,
    deviceSlots,
  };
}

export class AlarmEngine {
  private readonly opts: Required<AlarmEngineOptions>;
  private defs: AlarmDefs = { instances: [], classes: [], areas: [], tagIds: [], deviceTags: {} };
  private tagInfo: Record<string, AlarmTagInfo> = {};
  private classes = new Map<string, AlarmClass>();
  private insts: Inst[] = [];
  private byId = new Map<string, Inst>();
  private revision = 0;
  private nextOcc = 1;
  private mailbox: Command[] = [];
  private events: AlarmEvent[] = [];
  private nowMono = 0;
  private nowEpoch = 0;
  private clockOk = true;
  private cur: readonly TagSample[] = NO_SAMPLES;
  private lastMono = -1;
  private lastEpoch = 0;
  private jump = false;

  constructor(opts: AlarmEngineOptions = {}) {
    this.opts = {
      chatterWindowS: opts.chatterWindowS ?? 60,
      chatterShelveS: opts.chatterShelveS ?? 1800,
      maxShelved: opts.maxShelved ?? 50,
      clockFloorMs: opts.clockFloorMs ?? DEFAULT_CLOCK_FLOOR_MS,
    };
  }

  watchedTags(): readonly string[] {
    return this.defs.tagIds;
  }

  submit(cmd: Command): void {
    this.mailbox.push(cmd);
  }

  // ------------------------------------------------------------ tiện ích

  private setTime(nowMono: number, nowEpoch: number): void {
    this.nowMono = nowMono;
    this.nowEpoch = nowEpoch;
    this.clockOk = isClockOk(nowEpoch, this.opts.clockFloorMs);
  }

  private cls(i: Inst): AlarmClass {
    return (
      this.classes.get(i.def.classId) ?? {
        id: i.def.classId,
        name: i.def.classId,
        priority: 'minor',
        color: 'gray',
        blink: false,
        requiresAck: true,
        ackReturn: false,
        sound: 'none',
        chatterLimit: 5,
      }
    );
  }

  private isa(i: Inst): { requiresAck: boolean; ackReturn: boolean } {
    const c = this.cls(i);
    return { requiresAck: c.requiresAck, ackReturn: c.ackReturn };
  }

  private areaName(areaId: string): string {
    if (areaId === '') return 'Chung';
    return this.defs.areas.find((a) => a.id === areaId)?.name ?? areaId;
  }

  private emit(
    kind: AlarmEvent['kind'],
    i: Inst | null,
    extra: Partial<AlarmEvent> = {},
  ): AlarmEvent {
    if (BUMP_KINDS.has(kind)) {
      this.revision++;
      if (i !== null) i.rev = this.revision;
    }
    const e: AlarmEvent = {
      kind,
      tMono: this.nowMono,
      tEpoch: this.nowEpoch,
      clockOk: this.clockOk,
      instance: i === null ? '' : i.def.id,
      revision: this.revision,
      ...extra,
    };
    this.events.push(e);
    return e;
  }

  private emitRaw(kind: AlarmEvent['kind'], id: string, extra: Partial<AlarmEvent>): AlarmEvent {
    const e: AlarmEvent = {
      kind,
      tMono: this.nowMono,
      tEpoch: this.nowEpoch,
      clockOk: this.clockOk,
      instance: id,
      revision: this.revision,
      ...extra,
    };
    if (BUMP_KINDS.has(kind)) {
      this.revision++;
      e.revision = this.revision;
    }
    this.events.push(e);
    return e;
  }

  private setState(i: Inst, to: AlarmState, extra: Partial<AlarmEvent> = {}): void {
    const from = i.state;
    i.state = to;
    const row = i.occ === null ? undefined : { ...i.occ };
    this.emit('state', i, {
      from,
      to,
      occurrence: i.occurrence,
      ...(row === undefined ? {} : { row }),
      ...extra,
    });
  }

  private sampleOf(i: Inst): TagSample | undefined {
    return i.slot >= 0 ? this.cur[i.slot] : undefined;
  }

  private capture(i: Inst): { value: number | undefined; quality: Quality; reason: string } {
    if (i.def.deviceId !== '') {
      let worst: Quality = 'GOOD';
      let reason = '';
      for (const s of i.deviceSlots) {
        const t = this.cur[s];
        if (t === undefined) continue;
        if (t.quality === 'BAD' || (t.quality === 'UNCERTAIN' && worst === 'GOOD'))
          worst = t.quality;
        if (reason === '' && (t.reason ?? '') !== '') reason = t.reason ?? '';
      }
      return { value: undefined, quality: worst, reason };
    }
    const s = this.sampleOf(i);
    if (s === undefined) return { value: undefined, quality: 'BAD', reason: '' };
    return {
      value: Number.isFinite(s.value) ? s.value : undefined,
      quality: s.quality,
      reason: s.reason ?? '',
    };
  }

  private textFor(i: Inst, value: number | undefined, reason: string): string {
    const d = i.def;
    const info = this.tagInfo[d.tagId];
    return formatAlarmText(d.text ?? defaultTemplate(d), {
      name: d.name,
      tag: d.deviceId !== '' ? d.deviceId : d.tagId,
      ...(value === undefined ? {} : { value }),
      unit: d.deviceId !== '' ? '' : (info?.unit ?? ''),
      limit: d.threshold,
      limitName: d.limitName,
      area: this.areaName(d.areaId),
      reason,
      ...(info?.isBool === undefined ? {} : { isBool: info.isBool }),
      ...(info?.labels === undefined ? {} : { labels: info.labels }),
    });
  }

  private overrideRow(
    i: Inst,
    kind: 'shelve' | 'disable',
    user: string,
    reason: string,
    system: boolean,
    untilEpoch?: number,
  ): OverrideRow {
    const r: OverrideRow = {
      alarmId: i.def.id,
      kind,
      user,
      reason,
      system: system ? 1 : 0,
      tsStartMs: this.nowEpoch,
      clockOk: this.clockOk ? 1 : 0,
    };
    if (untilEpoch !== undefined) r.tsEndMs = untilEpoch;
    return r;
  }

  // ------------------------------------------------------------ mở / đóng lần xảy ra

  private openOccurrence(i: Inst, startup: boolean, fromState?: AlarmState): void {
    const d = i.def;
    const c = this.cls(i);
    const cap = this.capture(i);
    const text = this.textFor(i, cap.value, cap.reason);
    const id = this.nextOcc++;
    const area = d.areaId === '' ? undefined : d.areaId;
    const row: OccurrenceRow = {
      id,
      alarmId: d.id,
      fingerprint: d.fingerprint,
      tsActiveMs: this.nowEpoch,
      clockOk: this.clockOk ? 1 : 0,
      priority: PRIORITY_NUM[c.priority],
      class: c.id,
      ...(area === undefined ? {} : { area }),
      text,
      textFold: foldText(`${text} ${d.id} ${this.areaName(d.areaId)}`),
      ...(cap.value === undefined ? {} : { valueActive: cap.value }),
      qualityActive: cap.quality,
      ...(cap.reason === '' ? {} : { reason: cap.reason }),
      flags: startup ? 1 : 0,
      repeatCount: 1,
      closed: 0,
    };
    i.occurrence = id;
    i.occ = row;
    i.summary = null;
    const from = fromState ?? i.state;
    const to = transition('NORMAL', 'on', this.isa(i));
    i.state = to.kind === 'move' ? to.to : 'ACTIVE_UNACK';
    this.emit('state', i, {
      from,
      to: i.state,
      occurrence: id,
      text,
      ...(cap.value === undefined ? {} : { value: cap.value }),
      quality: cap.quality,
      reason: cap.reason,
      flags: { startup, inputBad: false },
      row: { ...row },
    });
  }

  /** Đóng hàng đang mở và đưa instance về NORMAL (sự kiện `state` hoặc `removed`). */
  private closeOccurrence(i: Inst, closedBy: ClosedBy, kind: 'state' | 'removed' = 'state'): void {
    const from = i.state;
    const occurrence = i.occurrence;
    let row: OccurrenceRow | undefined;
    if (i.occ !== null) {
      i.occ.closed = 1;
      i.occ.closedBy = closedBy;
      if (closedBy === 'return' && i.occ.tsReturnMs === undefined) i.occ.tsReturnMs = this.nowEpoch;
      row = { ...i.occ };
    }
    i.state = 'NORMAL';
    i.occurrence = 0;
    i.occ = null;
    this.emit(kind, i, {
      from,
      to: 'NORMAL',
      occurrence,
      ...(row === undefined ? {} : { closedBy, row }),
    });
  }

  private onTrue(i: Inst): void {
    const startup = i.startupPending;
    i.startupPending = false;
    if (i.state === 'RTN_UNACK') {
      // lần bóng (không hàng): chuyển thẳng ở nhánh bóng bên dưới
      if (i.occ !== null) this.closeOccurrence(i, 'return');
    }
    const c = this.cls(i);
    const limit = c.chatterLimit;
    if (i.shelve?.system === true) {
      // lần "bóng": không hàng, không mốc vào vòng
      const to = transition('NORMAL', 'on', this.isa(i));
      i.ghostCount++;
      i.occurrence = 0;
      i.occ = null;
      this.setState(i, to.kind === 'move' ? to.to : 'ACTIVE_UNACK', { occurrence: 0 });
      return;
    }
    if (limit > 0) {
      const cutoff = this.nowMono - this.opts.chatterWindowS * 1000;
      i.ring = i.ring.filter((t) => t >= cutoff);
      i.ring.push(this.nowMono);
      while (i.ring.length > limit) i.ring.shift();
    }
    this.openOccurrence(i, startup);
    if (limit > 0 && i.ring.length >= limit && i.shelve === null) {
      const secs = this.opts.chatterShelveS;
      i.shelve = {
        untilMono: this.nowMono + secs * 1000,
        untilEpoch: this.nowEpoch + secs * 1000,
        clockOk: this.clockOk,
        user: 'system',
        reason: 'chatter',
        system: true,
      };
      const ov = this.overrideRow(i, 'shelve', 'system', 'chatter', true, i.shelve.untilEpoch);
      this.emit('shelve', i, { reason: 'chatter', override: ov });
      if (i.occ !== null) {
        i.occ.repeatCount = i.ring.length;
        i.summary = i.occ;
      }
      this.emit('chatter', i, {
        count: i.ring.length,
        occurrence: i.occurrence,
        ...(i.occ === null ? {} : { row: { ...i.occ } }),
      });
    }
  }

  private onFalse(i: Inst): void {
    const tr = transition(i.state, 'off', this.isa(i));
    if (tr.kind !== 'move') return;
    if (i.occ !== null) {
      i.occ.tsReturnMs = this.nowEpoch;
    }
    if (tr.closes) {
      this.closeOccurrence(i, 'return');
    } else {
      this.setState(i, tr.to);
    }
  }

  // ------------------------------------------------------------ shelve

  private endShelve(i: Inst, reason: string): void {
    const sh = i.shelve;
    if (sh === null) return;
    i.shelve = null;
    this.emit('unshelve', i, { reason, override: null });
    const ghost = i.ghostCount;
    const wasSystem = sh.system;
    const summary = i.summary;
    if (wasSystem) {
      const count = i.ring.length + ghost;
      const row = summary === null ? undefined : { ...summary, repeatCount: count };
      this.emit('chatter', i, {
        count,
        ...(summary === null ? {} : { occurrence: summary.id }),
        ...(row === undefined ? {} : { row }),
      });
    }
    i.ring = [];
    i.ghostCount = 0;
    i.summary = null;
    const isGhost = i.occurrence === 0 && i.state !== 'NORMAL';
    if (wasSystem && ghost > 0 && isGhost) {
      if (i.cond) {
        this.openOccurrence(i, false, i.state);
      } else {
        // tổng kết cuối đợt: lần bóng đã hết điều kiện, dọn về NORMAL
        this.setState(i, 'NORMAL');
      }
      return;
    }
    if (i.state === 'ACTIVE_ACK' && !isGhost) {
      const tr = transition('ACTIVE_ACK', 'unshelve', { ...this.isa(i), condTrue: i.cond });
      if (tr.kind === 'move' && tr.to !== 'ACTIVE_ACK') this.setState(i, tr.to);
    }
  }

  // ------------------------------------------------------------ lệnh

  private result(i: string, code: CommandResultCode): void {
    this.emitRaw('command', i, { result: code });
  }

  private runCommand(cmd: Command): void {
    const i = this.byId.get(cmd.id);
    if (i === undefined) {
      this.result(cmd.id, 'NOT_FOUND');
      return;
    }
    switch (cmd.kind) {
      case 'ack':
        this.cmdAck(i, cmd.occurrence, cmd.user);
        return;
      case 'shelve':
        this.cmdShelve(i, cmd);
        return;
      case 'unshelve':
        if (i.shelve === null) {
          this.result(i.def.id, 'NOT_SHELVED');
          return;
        }
        this.result(i.def.id, 'OK');
        this.endShelve(i, 'user');
        return;
      case 'disable':
        if (i.disabled) {
          this.result(i.def.id, 'ALREADY_DISABLED');
          return;
        }
        this.result(i.def.id, 'OK');
        this.cmdDisable(i, cmd.user, cmd.reason);
        return;
      case 'enable':
        if (!i.disabled) {
          this.result(i.def.id, 'NOT_DISABLED');
          return;
        }
        this.result(i.def.id, 'OK');
        i.disabled = false;
        i.rawCond = false;
        i.cond = false;
        i.pendingSince = -1;
        i.startupPending = false;
        i.evaluated = true;
        this.emit('enable', i, { override: null });
        return;
    }
  }

  private cmdAck(i: Inst, occurrence: number, user: string): void {
    const id = i.def.id;
    if (occurrence !== i.occurrence) {
      this.result(id, i.state === 'NORMAL' ? 'NOT_ACTIVE' : 'STALE');
      return;
    }
    if (i.shelve !== null) {
      this.result(id, 'SHELVED');
      return;
    }
    const tr = transition(i.state, i.state === 'RTN_UNACK' ? 'ackReturn' : 'ack', this.isa(i));
    if (tr.kind === 'reject') {
      this.result(id, tr.result);
      return;
    }
    if (tr.kind === 'impossible') {
      this.result(id, 'NOT_ACTIVE');
      return;
    }
    this.result(id, 'ACKED');
    if (i.occ !== null) {
      if (i.state === 'ACTIVE_UNACK') {
        i.occ.tsAckMs = this.nowEpoch;
        i.occ.ackUser = user;
      } else {
        i.occ.tsReturnAckMs = this.nowEpoch;
        i.occ.returnAckUser = user;
        if (i.occ.tsAckMs === undefined) {
          i.occ.tsAckMs = this.nowEpoch;
          i.occ.ackUser = user;
        }
      }
    }
    if (tr.closes) this.closeOccurrence(i, 'return');
    else this.setState(i, tr.to);
  }

  private cmdShelve(i: Inst, cmd: Extract<Command, { kind: 'shelve' }>): void {
    const id = i.def.id;
    const system = cmd.system === true;
    const reasonLen = Array.from(cmd.reason).length;
    let bad =
      !(cmd.durationS >= 60 && cmd.durationS <= 28800) || reasonLen === 0 || reasonLen > 120;
    if (!bad && !system) {
      let others = 0;
      for (const o of this.insts) if (o !== i && o.shelve !== null && !o.shelve.system) others++;
      if (others >= this.opts.maxShelved) bad = true;
    }
    if (bad) {
      this.result(id, 'SHELVE_RANGE');
      return;
    }
    this.result(id, 'OK');
    const until = cmd.durationS * 1000;
    i.shelve = {
      untilMono: this.nowMono + until,
      untilEpoch: this.nowEpoch + until,
      clockOk: this.clockOk,
      user: cmd.user,
      reason: cmd.reason,
      system,
    };
    this.emit('shelve', i, {
      reason: cmd.reason,
      override: this.overrideRow(i, 'shelve', cmd.user, cmd.reason, system, i.shelve.untilEpoch),
    });
  }

  private cmdDisable(i: Inst, user: string, reason: string): void {
    i.disabled = true;
    this.emit('disable', i, {
      reason,
      override: this.overrideRow(i, 'disable', user, reason, false),
    });
    const hadShelve = i.shelve !== null;
    i.shelve = null;
    i.ring = [];
    i.ghostCount = 0;
    i.summary = null;
    if (hadShelve) this.emit('unshelve', i, { reason: 'disabled', override: null });
    if (i.state !== 'NORMAL') {
      if (i.occ !== null) this.closeOccurrence(i, 'disabled');
      else this.setState(i, 'NORMAL');
    }
    i.rawCond = false;
    i.cond = false;
    i.pendingSince = -1;
    i.startupPending = false;
    i.inputBad = false;
  }

  // ------------------------------------------------------------ đánh giá

  private evaluate(i: Inst): void {
    const d = i.def;
    if (i.disabled) return;
    let raw: boolean;
    if (d.kind === 'quality') {
      const pred = (s: TagSample): boolean =>
        d.on === 'notGood' ? s.quality !== 'GOOD' : s.quality === 'BAD';
      if (d.deviceId !== '') {
        if (i.deviceSlots.length === 0) {
          raw = false;
        } else {
          let all = true;
          for (const k of i.deviceSlots) {
            const s = this.cur[k];
            if (s === undefined || s.known === false) {
              i.pendingSince = -1;
              i.startupPending = false;
              return;
            }
            if (!pred(s)) all = false;
          }
          raw = all;
        }
      } else {
        const s = this.sampleOf(i);
        if (s === undefined || s.known === false) {
          i.pendingSince = -1;
          i.startupPending = false;
          return;
        }
        raw = pred(s);
      }
    } else {
      const s = this.sampleOf(i);
      const bad =
        s === undefined || s.known === false || s.quality === 'BAD' || !Number.isFinite(s.value);
      if (bad !== i.inputBad) {
        i.inputBad = bad;
        this.revision++;
        i.rev = this.revision;
      }
      if (bad || s === undefined) {
        i.pendingSince = -1;
        i.startupPending = false;
        return;
      }
      const v = s.value;
      if (d.kind === 'digital') {
        raw = (v !== 0) === (d.trigger === true);
      } else {
        const th = d.threshold as number;
        const high = d.limitName === 'HH' || d.limitName === 'H';
        if (high) raw = i.rawCond ? !(v < th - d.deadband) : v >= th;
        else raw = i.rawCond ? !(v > th + d.deadband) : v <= th;
      }
    }
    if (raw === i.cond) {
      i.pendingSince = -1;
      i.startupPending = false;
    } else {
      if (i.pendingSince < 0) {
        i.pendingSince = this.nowMono;
        i.startupPending = i.startupEligible && !i.evaluated;
      }
      const delay = raw ? d.onDelayMs : d.offDelayMs;
      if (this.nowMono - i.pendingSince >= delay) {
        i.cond = raw;
        i.pendingSince = -1;
        i.rawCond = raw;
        i.evaluated = true;
        if (raw) this.onTrue(i);
        else {
          i.startupPending = false;
          this.onFalse(i);
        }
        return;
      }
    }
    i.rawCond = raw;
    i.evaluated = true;
  }

  // ------------------------------------------------------------ step

  step(nowMonoMs: number, nowEpochMs: number, tags: readonly TagSample[]): AlarmEvent[] {
    this.events = [];
    this.setTime(nowMonoMs, nowEpochMs);
    this.cur = tags;
    if (this.lastMono >= 0 && this.insts.some((i) => i.occ !== null)) {
      const drift = nowEpochMs - this.lastEpoch - (nowMonoMs - this.lastMono);
      if (Math.abs(drift) > 5000) this.jump = true;
    }
    this.lastMono = nowMonoMs;
    this.lastEpoch = nowEpochMs;
    // 1. lệnh
    const cmds = this.mailbox;
    this.mailbox = [];
    for (const c of cmds) this.runCommand(c);
    // 2. hết hạn shelve
    for (const i of this.insts) {
      if (i.shelve !== null && i.shelve.untilMono <= nowMonoMs)
        this.endShelve(i, i.shelve.system ? 'chatter-end' : 'expired');
    }
    // 3. đánh giá
    for (const i of this.insts) this.evaluate(i);
    if (!this.insts.some((i) => i.occ !== null)) this.jump = false;
    this.cur = NO_SAMPLES;
    return this.events;
  }

  // ------------------------------------------------------------ load

  private bindSlots(defs: AlarmDefs, d: InstanceDef): { slot: number; deviceSlots: number[] } {
    if (d.deviceId !== '') return { slot: -1, deviceSlots: defs.deviceTags[d.deviceId] ?? [] };
    return { slot: defs.tagIds.indexOf(d.tagId), deviceSlots: [] };
  }

  private stateFromRow(r: OccurrenceRow): AlarmState {
    if (r.tsReturnMs !== undefined) return 'RTN_UNACK';
    return r.tsAckMs === undefined ? 'ACTIVE_UNACK' : 'ACTIVE_ACK';
  }

  load(defs: AlarmDefs, tagInfo: Record<string, AlarmTagInfo>, ctx: LoadContext): AlarmEvent[] {
    this.events = [];
    this.setTime(ctx.nowMonoMs, ctx.nowEpochMs);
    this.cur = NO_SAMPLES;
    for (const c of this.mailbox) this.emitRaw('command', c.id, { result: 'NOT_FOUND' });
    this.mailbox = [];
    const old = this.insts;
    this.defs = defs;
    this.tagInfo = tagInfo;
    this.classes = new Map(defs.classes.map((c) => [c.id, c]));
    if (ctx.processStart) this.nextOcc = ctx.nextOccurrence ?? 1;
    if (ctx.processStart) {
      this.loadFresh(defs, ctx);
    } else {
      this.reloadKeeping(defs, old);
    }
    this.emitRaw('resync', '', {});
    return this.events;
  }

  private loadFresh(defs: AlarmDefs, ctx: LoadContext): void {
    this.insts = defs.instances.map((d) => {
      const b = this.bindSlots(defs, d);
      return freshInst(d, b.slot, b.deviceSlots, true);
    });
    this.byId = new Map(this.insts.map((i) => [i.def.id, i]));
    this.lastMono = -1;
    this.jump = false;
    // override
    for (const o of ctx.overrides ?? []) {
      const i = this.byId.get(o.alarmId);
      if (i === undefined) continue;
      if (o.kind === 'disable') {
        i.disabled = true;
      } else if (
        o.clockOk === 1 &&
        this.clockOk &&
        o.tsEndMs !== undefined &&
        o.tsEndMs > this.nowEpoch
      ) {
        i.shelve = {
          untilMono: this.nowMono + (o.tsEndMs - this.nowEpoch),
          untilEpoch: o.tsEndMs,
          clockOk: true,
          user: o.user,
          reason: o.reason,
          system: o.system === 1,
        };
      } else {
        this.emit('unshelve', i, { reason: 'expired', override: null });
      }
    }
    // hàng mở
    const open = [...(ctx.open ?? [])].sort((a, b) => a.id - b.id);
    const maxId = new Map<string, number>();
    for (const r of open) maxId.set(r.alarmId, Math.max(maxId.get(r.alarmId) ?? 0, r.id));
    let maxSeen = 0;
    for (const r of open) {
      maxSeen = Math.max(maxSeen, r.id);
      const i = this.byId.get(r.alarmId);
      const from = this.stateFromRow(r);
      const closed = (closedBy: ClosedBy, kind: 'state' | 'removed'): void => {
        const row: OccurrenceRow = { ...r, closed: 1, closedBy };
        const target = i ?? null;
        const id = r.alarmId;
        const extra: Partial<AlarmEvent> = { from, to: 'NORMAL', occurrence: r.id, closedBy, row };
        if (target !== null) this.emit(kind, target, extra);
        else this.emitRaw(kind, id, extra);
      };
      if (i === undefined) {
        closed('config', 'removed');
        continue;
      }
      if (maxId.get(r.alarmId) !== r.id) {
        closed('restart-lost', 'state');
        continue;
      }
      if (i.def.fingerprint !== r.fingerprint) {
        closed('config', 'state');
        continue;
      }
      if (i.disabled) {
        closed('disabled', 'state');
        continue;
      }
      i.state = from;
      i.occurrence = r.id;
      i.occ = { ...r };
      i.cond = r.tsReturnMs === undefined;
      i.rawCond = i.cond;
      const c = this.cls(i);
      if (!c.requiresAck) {
        if (i.state === 'ACTIVE_UNACK') this.setState(i, 'ACTIVE_ACK');
        else if (i.state === 'RTN_UNACK') this.closeOccurrence(i, 'return');
      }
    }
    this.nextOcc = Math.max(this.nextOcc, maxSeen + 1, ctx.nextOccurrence ?? 1);
  }

  private reloadKeeping(defs: AlarmDefs, old: Inst[]): void {
    const newById = new Map(defs.instances.map((d) => [d.id, d]));
    const kept = new Map<string, Inst>();
    for (const i of old) {
      const nd = newById.get(i.def.id);
      if (nd === undefined) {
        this.closeRemoved(i);
        continue;
      }
      if (nd.fingerprint !== i.def.fingerprint) {
        if (i.occ !== null || i.state !== 'NORMAL') {
          if (i.occ !== null) this.closeOccurrence(i, 'config');
          else this.setState(i, 'NORMAL');
        }
        const fresh = freshInst(nd, 0, [], false);
        fresh.disabled = i.disabled;
        fresh.shelve = i.shelve;
        kept.set(nd.id, fresh);
        continue;
      }
      i.def = nd;
      kept.set(nd.id, i);
      if (!this.cls(i).requiresAck) {
        if (i.state === 'ACTIVE_UNACK') this.setState(i, 'ACTIVE_ACK');
        else if (i.state === 'RTN_UNACK') {
          if (i.occ !== null) this.closeOccurrence(i, 'return');
          else this.setState(i, 'NORMAL');
        }
      }
    }
    this.insts = defs.instances.map((d) => {
      const b = this.bindSlots(defs, d);
      const i = kept.get(d.id) ?? freshInst(d, b.slot, b.deviceSlots, false);
      i.def = d;
      i.slot = b.slot;
      i.deviceSlots = b.deviceSlots;
      return i;
    });
    this.byId = new Map(this.insts.map((i) => [i.def.id, i]));
  }

  private closeRemoved(i: Inst): void {
    const from = i.state;
    const occurrence = i.occurrence;
    let row: OccurrenceRow | undefined;
    if (i.occ !== null) {
      i.occ.closed = 1;
      i.occ.closedBy = 'config';
      row = { ...i.occ };
    }
    i.state = 'NORMAL';
    i.occurrence = 0;
    i.occ = null;
    this.emit('removed', i, {
      from,
      to: 'NORMAL',
      occurrence,
      ...(row === undefined ? {} : { closedBy: 'config' as const, row }),
    });
  }

  // ------------------------------------------------------------ view

  private itemOf(i: Inst): AlarmItem {
    const d = i.def;
    const c = this.cls(i);
    const it: AlarmItem = {
      id: d.id,
      defId: d.defId,
      ...(d.limitName === '' ? {} : { limit: d.limitName }),
      name: d.name,
      class: c.id,
      ...(d.areaId === '' ? {} : { area: d.areaId }),
      priority: c.priority,
      state: i.state,
      inputBad: i.inputBad,
      occurrence: i.occurrence,
      rev: i.rev,
    };
    if (i.shelve !== null) {
      it.shelve = {
        user: i.shelve.user,
        reason: i.shelve.reason,
        untilMs: i.shelve.untilEpoch,
        remainingS: Math.max(0, Math.ceil((i.shelve.untilMono - this.nowMono) / 1000)),
        system: i.shelve.system,
      };
    }
    if (i.disabled) it.disabled = true;
    const o = i.occ;
    if (o !== null) {
      it.tsActiveMs = o.tsActiveMs;
      it.clockOk = o.clockOk === 1;
      if (o.tsAckMs !== undefined) it.tsAckMs = o.tsAckMs;
      if (o.ackUser !== undefined) it.ackUser = o.ackUser;
      if (o.tsReturnMs !== undefined) it.tsReturnMs = o.tsReturnMs;
      if (o.valueActive !== undefined) it.value = o.valueActive;
      it.quality = o.qualityActive;
      if (o.reason !== undefined) it.reason = o.reason;
      it.text = o.text;
      if ((o.flags & 1) !== 0) it.startup = true;
      if (o.repeatCount > 1) it.repeat = o.repeatCount;
    }
    return it;
  }

  view(): AlarmView {
    const zero = (): Record<Priority, number> => ({ critical: 0, major: 0, minor: 0, advisory: 0 });
    const counts: AlarmCounts = {
      active: 0,
      unacked: 0,
      rtnUnack: 0,
      shelved: 0,
      disabled: 0,
      unackedByPriority: zero(),
      activeByPriority: zero(),
    };
    const items: AlarmItem[] = [];
    for (const i of this.insts) {
      if (i.disabled) counts.disabled++;
      if (i.shelve !== null) counts.shelved++;
      else if (i.state !== 'NORMAL') {
        const p = this.cls(i).priority;
        counts.active++;
        counts.activeByPriority[p]++;
        if (i.state === 'ACTIVE_UNACK' || i.state === 'RTN_UNACK') {
          counts.unacked++;
          counts.unackedByPriority[p]++;
        }
        if (i.state === 'RTN_UNACK') counts.rtnUnack++;
      }
      if (i.state !== 'NORMAL' || i.shelve !== null || i.disabled) items.push(this.itemOf(i));
    }
    return {
      revision: this.revision,
      ts: this.nowEpoch,
      clockOk: this.clockOk,
      clockJumpWhileOpen: this.jump,
      counts,
      items,
    };
  }

  previewAck(req: AckRequest): AckTarget[] {
    const out: AckTarget[] = [];
    const q = req.q === undefined || req.q === '' ? '' : foldText(req.q);
    for (const i of this.insts) {
      if (i.shelve !== null || i.disabled) continue;
      if (i.state !== 'ACTIVE_UNACK' && i.state !== 'RTN_UNACK') continue;
      if (i.occurrence === 0) continue;
      if (req.upToRevision !== undefined && i.rev > req.upToRevision) continue;
      if (req.area !== undefined && i.def.areaId !== req.area) continue;
      const c = this.cls(i);
      if (req.class !== undefined && c.id !== req.class) continue;
      if (req.priority !== undefined && PRIORITY_NUM[c.priority] > PRIORITY_NUM[req.priority])
        continue;
      if (req.state === 'unack' && i.state !== 'ACTIVE_UNACK') continue;
      if (req.state === 'rtn' && i.state !== 'RTN_UNACK') continue;
      if (q !== '') {
        const hay = foldText(`${i.occ?.text ?? ''} ${i.def.id} ${this.areaName(i.def.areaId)}`);
        if (!hay.includes(q)) continue;
      }
      out.push({ id: i.def.id, occurrence: i.occurrence });
    }
    return out;
  }
}
