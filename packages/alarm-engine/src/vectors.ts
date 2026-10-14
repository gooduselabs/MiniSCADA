// Bộ chạy vector `tests/alarm-vectors/*.json` (contracts/alarm-engine.md §14). Thuần (không I/O): người gọi tự đọc file.
// Quy tắc chạy và phần bổ sung: tests/alarm-vectors/README.md.

import { AlarmEngine, compileAlarms } from './engine.ts';
import type { AlarmDefs } from './types.ts';
import type {
  AckRequest,
  AlarmArea,
  AlarmClassJson,
  AlarmDefJson,
  AlarmEvent,
  AlarmTagInfo,
  AlarmView,
  OccurrenceRow,
  OverrideRow,
  TagSample,
} from './types.ts';

export interface VectorTagValue {
  value: number | 'NaN' | 'Infinity' | '-Infinity';
  quality: 'GOOD' | 'UNCERTAIN' | 'BAD';
  reason?: string;
  known?: boolean;
}

export type VectorAction =
  | { type: 'ack'; instance: string; occurrence: number; user: string }
  | {
      type: 'ackAll';
      filter?: Omit<AckRequest, 'upToRevision'>;
      upToRevision?: number;
      user: string;
    }
  | { type: 'shelve'; instance: string; reason: string; durationS: number; user: string }
  | { type: 'unshelve'; instance: string; user: string }
  | { type: 'disable'; instance: string; reason: string; user: string }
  | { type: 'enable'; instance: string; user: string }
  | {
      type: 'reload';
      alarms: AlarmDefJson[];
      classes?: AlarmClassJson[];
      areas?: AlarmArea[];
      tags?: Record<string, AlarmTagInfo>;
    }
  | { type: 'commit' }
  | {
      type: 'restart';
      persist: 'committed' | 'all';
      clock?: 'ok' | 'bad';
      alarms?: AlarmDefJson[];
      classes?: AlarmClassJson[];
      areas?: AlarmArea[];
      tags?: Record<string, AlarmTagInfo>;
      devices?: Record<string, string[]>;
      rows?: OccurrenceRow[];
    }
  | { type: 'clock'; epoch0: number };

export interface VectorTimelineEntry {
  t: number;
  tags?: Record<string, VectorTagValue>;
  action?: VectorAction;
}

export interface VectorExpectEvent {
  t: number;
  instance?: string;
  kind?: AlarmEvent['kind'];
  from?: string;
  to?: string;
  occurrence?: number;
  closedBy?: string;
  text?: string;
  result?: string;
  flags?: { startup?: boolean; inputBad?: boolean };
  count?: number;
  value?: number;
  reason?: string;
  tEpoch?: number;
  clockOk?: boolean;
  row?: Partial<OccurrenceRow>;
}

export interface VectorExpectView {
  t: number;
  counts?: Record<string, unknown>;
  items?: Record<string, Record<string, unknown>>;
}

export interface VectorOptions {
  tickMs?: number;
  chatterWindowS?: number;
  chatterShelveS?: number;
  epoch0?: number;
  clockOkFrom?: number;
}

export interface AlarmVector {
  name: string;
  group?: string;
  description?: string;
  options?: VectorOptions;
  classes: AlarmClassJson[];
  areas?: AlarmArea[];
  tags?: Record<string, AlarmTagInfo>;
  devices?: Record<string, string[]>;
  alarms: AlarmDefJson[];
  timeline: VectorTimelineEntry[];
  end: number;
  expect: VectorExpectEvent[];
  strict?: boolean;
  expectView?: VectorExpectView[];
}

export type ActualEvent = AlarmEvent & { t: number };

export interface VectorResult {
  name: string;
  ok: boolean;
  errors: string[];
  events: ActualEvent[];
}

const INITIAL: TagSample = { known: false, value: 0, quality: 'BAD', reason: 'NO_DATA' };

function numberOf(v: VectorTagValue['value']): number {
  if (v === 'NaN') return Number.NaN;
  if (v === 'Infinity') return Number.POSITIVE_INFINITY;
  if (v === '-Infinity') return Number.NEGATIVE_INFINITY;
  return v;
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

/** So sánh từng phần: mọi khóa của `exp` phải khớp trong `act` (đệ quy); mảng so đủ độ dài. */
export function partialMismatch(exp: unknown, act: unknown, path = ''): string | null {
  if (exp !== null && typeof exp === 'object') {
    if (act === null || typeof act !== 'object')
      return `${path || '.'}: cần đối tượng, thực tế ${JSON.stringify(act)}`;
    if (Array.isArray(exp)) {
      if (!Array.isArray(act) || act.length !== exp.length)
        return `${path || '.'}: độ dài mảng khác`;
      for (let i = 0; i < exp.length; i++) {
        const m = partialMismatch(exp[i], act[i], `${path}[${i}]`);
        if (m !== null) return m;
      }
      return null;
    }
    for (const [k, v] of Object.entries(exp as Record<string, unknown>)) {
      const m = partialMismatch(
        v,
        (act as Record<string, unknown>)[k],
        path === '' ? k : `${path}.${k}`,
      );
      if (m !== null) return m;
    }
    return null;
  }
  return Object.is(exp, act) || exp === act
    ? null
    : `${path || '.'}: cần ${JSON.stringify(exp)}, thực tế ${JSON.stringify(act)}`;
}

function eventMismatch(exp: VectorExpectEvent, act: ActualEvent): string | null {
  const kind = exp.kind ?? 'state';
  if (act.t !== exp.t) return `t: cần ${exp.t}, thực tế ${act.t}`;
  if (act.kind !== kind) return `kind: cần ${kind}, thực tế ${act.kind}`;
  if (exp.instance !== undefined && act.instance !== exp.instance)
    return `instance: cần ${exp.instance}, thực tế ${act.instance}`;
  const scalar: Array<keyof VectorExpectEvent & keyof AlarmEvent> = [
    'from',
    'to',
    'occurrence',
    'closedBy',
    'text',
    'result',
    'count',
    'value',
    'reason',
    'tEpoch',
    'clockOk',
  ];
  for (const k of scalar) {
    if (exp[k] !== undefined && exp[k] !== act[k])
      return `${k}: cần ${JSON.stringify(exp[k])}, thực tế ${JSON.stringify(act[k])}`;
  }
  if (exp.flags !== undefined) {
    const m = partialMismatch(exp.flags, act.flags, 'flags');
    if (m !== null) return m;
  }
  if (exp.row !== undefined) {
    const m = partialMismatch(exp.row, act.row, 'row');
    if (m !== null) return m;
  }
  return null;
}

class Runner {
  private readonly v: AlarmVector;
  private readonly opts: Required<VectorOptions>;
  private alarms: AlarmDefJson[];
  private classes: AlarmClassJson[];
  private areas: AlarmArea[];
  private tagInfo: Record<string, AlarmTagInfo>;
  private devices: Record<string, string[]>;
  private defs: AlarmDefs;
  private engine: AlarmEngine;
  private samples = new Map<string, TagSample>();
  private epoch0: number;
  private rows = new Map<number, OccurrenceRow>();
  private overrides = new Map<string, OverrideRow>();
  private committedRows = new Map<number, OccurrenceRow>();
  private committedOverrides = new Map<string, OverrideRow>();
  readonly events: ActualEvent[] = [];
  readonly views = new Map<number, AlarmView>();
  readonly errors: string[] = [];

  constructor(v: AlarmVector) {
    this.v = v;
    this.opts = {
      tickMs: 250,
      chatterWindowS: 60,
      chatterShelveS: 1800,
      epoch0: 1791600000000,
      clockOkFrom: 1577836800000,
      ...v.options,
    };
    this.alarms = v.alarms;
    this.classes = v.classes;
    this.areas = v.areas ?? [];
    this.tagInfo = v.tags ?? {};
    this.devices = v.devices ?? {};
    this.epoch0 = this.opts.epoch0;
    this.defs = this.compile();
    this.engine = this.newEngine();
  }

  private compile(): AlarmDefs {
    return compileAlarms({
      alarms: { areas: this.areas, alarms: this.alarms },
      alarmClasses: { classes: this.classes },
      devices: this.devices,
    });
  }

  private newEngine(): AlarmEngine {
    return new AlarmEngine({
      chatterWindowS: this.opts.chatterWindowS,
      chatterShelveS: this.opts.chatterShelveS,
      clockFloorMs: this.opts.clockOkFrom,
    });
  }

  private epochAt(t: number): number {
    return this.epoch0 + t;
  }

  private collect(list: AlarmEvent[]): void {
    for (const e of list) {
      this.events.push({ ...e, t: e.tMono });
      if (e.row !== undefined) this.rows.set(e.row.id, clone(e.row));
      if (e.override !== undefined) {
        if (e.override === null)
          this.overrides.delete(`${e.instance}|${e.kind === 'enable' ? 'disable' : 'shelve'}`);
        else this.overrides.set(`${e.override.alarmId}|${e.override.kind}`, clone(e.override));
      }
    }
  }

  private buildSamples(): TagSample[] {
    return this.engine.watchedTags().map((id) => this.samples.get(id) ?? INITIAL);
  }

  private applyTags(tags: Record<string, VectorTagValue>): void {
    for (const [id, s] of Object.entries(tags)) {
      const sample: TagSample = {
        known: s.known ?? true,
        value: numberOf(s.value),
        quality: s.quality,
        reason: s.reason ?? '',
      };
      this.samples.set(id, sample);
    }
  }

  private open(): OccurrenceRow[] {
    return [...this.rows.values()].filter((r) => r.closed === 0).sort((a, b) => a.id - b.id);
  }

  private sortedOverrides(): OverrideRow[] {
    return [...this.overrides.values()].sort((a, b) =>
      a.alarmId < b.alarmId
        ? -1
        : a.alarmId > b.alarmId
          ? 1
          : a.kind < b.kind
            ? -1
            : a.kind > b.kind
              ? 1
              : 0,
    );
  }

  private nextOccurrence(): number {
    let m = 0;
    for (const id of this.rows.keys()) m = Math.max(m, id);
    return m + 1;
  }

  private action(t: number, a: VectorAction): void {
    switch (a.type) {
      case 'ack':
        this.engine.submit({ kind: 'ack', id: a.instance, occurrence: a.occurrence, user: a.user });
        return;
      case 'ackAll': {
        const req: AckRequest = {
          ...(a.filter ?? {}),
          ...(a.upToRevision === undefined ? {} : { upToRevision: a.upToRevision }),
        };
        for (const target of this.engine.previewAck(req))
          this.engine.submit({
            kind: 'ack',
            id: target.id,
            occurrence: target.occurrence,
            user: a.user,
          });
        return;
      }
      case 'shelve':
        this.engine.submit({
          kind: 'shelve',
          id: a.instance,
          reason: a.reason,
          durationS: a.durationS,
          user: a.user,
        });
        return;
      case 'unshelve':
        this.engine.submit({ kind: 'unshelve', id: a.instance, user: a.user });
        return;
      case 'disable':
        this.engine.submit({ kind: 'disable', id: a.instance, reason: a.reason, user: a.user });
        return;
      case 'enable':
        this.engine.submit({ kind: 'enable', id: a.instance, user: a.user });
        return;
      case 'clock':
        this.epoch0 = a.epoch0;
        return;
      case 'commit':
        this.committedRows = clone(this.rows);
        this.committedOverrides = clone(this.overrides);
        return;
      case 'reload': {
        this.alarms = a.alarms;
        if (a.classes !== undefined) this.classes = a.classes;
        if (a.areas !== undefined) this.areas = a.areas;
        if (a.tags !== undefined) this.tagInfo = a.tags;
        this.defs = this.compile();
        this.collect(
          this.engine.load(this.defs, this.tagInfo, {
            nowMonoMs: t,
            nowEpochMs: this.epochAt(t),
            processStart: false,
          }),
        );
        return;
      }
      case 'restart': {
        if (a.alarms !== undefined) this.alarms = a.alarms;
        if (a.classes !== undefined) this.classes = a.classes;
        if (a.areas !== undefined) this.areas = a.areas;
        if (a.tags !== undefined) this.tagInfo = a.tags;
        if (a.devices !== undefined) this.devices = a.devices;
        if (a.clock === 'bad') this.epoch0 = 0;
        for (const r of a.rows ?? []) {
          this.rows.set(r.id, clone(r));
          this.committedRows.set(r.id, clone(r));
        }
        if (a.persist === 'committed') {
          this.rows = clone(this.committedRows);
          this.overrides = clone(this.committedOverrides);
        }
        this.committedRows = clone(this.rows);
        this.committedOverrides = clone(this.overrides);
        this.samples = new Map();
        this.defs = this.compile();
        this.engine = this.newEngine();
        this.collect(
          this.engine.load(this.defs, this.tagInfo, {
            open: this.open(),
            overrides: this.sortedOverrides(),
            nowMonoMs: t,
            nowEpochMs: this.epochAt(t),
            processStart: true,
            nextOccurrence: this.nextOccurrence(),
          }),
        );
        return;
      }
    }
  }

  run(): void {
    const { tickMs } = this.opts;
    const byT = new Map<number, VectorTimelineEntry[]>();
    for (const e of this.v.timeline) {
      if (e.t % tickMs !== 0)
        this.errors.push(`timeline t=${e.t} không là bội của tickMs=${tickMs}`);
      const list = byT.get(e.t);
      if (list === undefined) byT.set(e.t, [e]);
      else list.push(e);
    }
    if (this.v.end % tickMs !== 0) this.errors.push(`end=${this.v.end} không là bội của tickMs`);
    const viewAt = new Set((this.v.expectView ?? []).map((x) => x.t));
    // load đầu (store rỗng) không sinh sự kiện đáng kể: bỏ qua kết quả (chỉ có `resync`).
    this.engine.load(this.defs, this.tagInfo, {
      nowMonoMs: 0,
      nowEpochMs: this.epochAt(0),
      processStart: true,
      nextOccurrence: 1,
    });
    for (let t = 0; t <= this.v.end; t += tickMs) {
      for (const e of byT.get(t) ?? []) {
        if (e.tags !== undefined) this.applyTags(e.tags);
        if (e.action !== undefined) this.action(t, e.action);
      }
      this.collect(this.engine.step(t, this.epochAt(t), this.buildSamples()));
      if (viewAt.has(t)) this.views.set(t, clone(this.engine.view()));
    }
  }
}

/** Chạy một ca vector và so với `expect` (và `expectView`). */
export function runVector(v: AlarmVector): VectorResult {
  const r = new Runner(v);
  r.run();
  const errors = [...r.errors];
  const strict = v.strict !== false;
  const kinds = new Set(v.expect.map((e) => e.kind ?? 'state'));
  const actual = strict ? r.events : r.events.filter((e) => kinds.has(e.kind));
  const n = Math.max(actual.length, v.expect.length);
  for (let i = 0; i < n; i++) {
    const exp = v.expect[i];
    const act = actual[i];
    if (exp === undefined) {
      errors.push(`sự kiện thừa #${i}: ${brief(act)}`);
      break;
    }
    if (act === undefined) {
      errors.push(`thiếu sự kiện #${i}: ${JSON.stringify(exp)}`);
      break;
    }
    const m = eventMismatch(exp, act);
    if (m !== null) {
      errors.push(`sự kiện #${i} lệch (${m}): cần ${JSON.stringify(exp)}, thực tế ${brief(act)}`);
      break;
    }
  }
  for (const ev of v.expectView ?? []) {
    const view = r.views.get(ev.t);
    if (view === undefined) {
      errors.push(`expectView t=${ev.t}: không có view`);
      continue;
    }
    if (ev.counts !== undefined) {
      const m = partialMismatch(ev.counts, view.counts, 'counts');
      if (m !== null) errors.push(`expectView t=${ev.t} ${m}`);
    }
    for (const [id, exp] of Object.entries(ev.items ?? {})) {
      const item = view.items.find((x) => x.id === id);
      if (item === undefined) errors.push(`expectView t=${ev.t}: không có item ${id}`);
      else {
        const m = partialMismatch(exp, item, `items.${id}`);
        if (m !== null) errors.push(`expectView t=${ev.t} ${m}`);
      }
    }
  }
  return { name: v.name, ok: errors.length === 0, errors, events: r.events };
}

function brief(e: ActualEvent | undefined): string {
  if (e === undefined) return 'undefined';
  const o: Record<string, unknown> = { t: e.t, kind: e.kind, instance: e.instance };
  for (const k of [
    'from',
    'to',
    'occurrence',
    'closedBy',
    'result',
    'text',
    'reason',
    'count',
    'value',
  ] as const)
    if (e[k] !== undefined) o[k] = e[k];
  return JSON.stringify(o);
}
