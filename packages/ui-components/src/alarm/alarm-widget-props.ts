// Đọc thuộc tính của hai widget alarm (danh mục 0.4.0; contracts/ui-alarm.md §13.1, §13.2). Validator đã chặn giá trị sai; ở đây
// là lớp phòng thủ: sai kiểu, ngoài khoảng, trùng hoặc lạ thì bỏ và dùng mặc định (như `MatWidget.prop`).
import type { WidgetItem } from '@mat/project-schema';
import type { AlarmPriority } from '../host/types.ts';
import { ALARM_COLUMNS, PRIORITIES, type AlarmColumn } from './alarm-format.ts';

export type ListState = 'ACTIVE_UNACK' | 'ACTIVE_ACK' | 'RTN_UNACK';
const LIST_STATES: readonly ListState[] = ['ACTIVE_UNACK', 'ACTIVE_ACK', 'RTN_UNACK'];
const DEFAULT_COLUMNS: readonly AlarmColumn[] = ['time', 'priority', 'text', 'value', 'state'];

export interface AlarmListProps {
  areas: string[];
  classes: string[];
  minPriority: AlarmPriority;
  states: ListState[];
  columns: AlarmColumn[];
  maxRows: number;
  showAck: boolean;
}

export type CountMode = 'unacked' | 'active';
export type CountTarget =
  { kind: 'alarms' } | { kind: 'none' } | { kind: 'screen'; screen: string };

export interface AlarmCountProps {
  areas: string[];
  minPriority: AlarmPriority;
  mode: CountMode;
  target: CountTarget;
}

const propsOf = (item: WidgetItem | undefined): Record<string, unknown> =>
  item?.props && typeof item.props === 'object' ? (item.props as Record<string, unknown>) : {};

function strings(v: unknown, max: number, maxLen = 32): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v)
    if (typeof x === 'string' && [...x].length <= maxLen && out.length < max) out.push(x);
  return out;
}

function pickEnum<T extends string>(v: unknown, set: readonly T[]): T | undefined {
  return typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : undefined;
}

function uniqueEnums<T extends string>(v: unknown, set: readonly T[]): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    const e = pickEnum(x, set);
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

export function listProps(item: WidgetItem | undefined): AlarmListProps {
  const p = propsOf(item);
  const states = uniqueEnums(p.states, LIST_STATES);
  const columns = uniqueEnums(p.columns, ALARM_COLUMNS);
  const rows = p.maxRows;
  return {
    areas: strings(p.areas, 64),
    classes: strings(p.classes, 16),
    minPriority: pickEnum(p.minPriority, PRIORITIES) ?? 'advisory',
    states: states.length ? states : [...LIST_STATES],
    columns: columns.length ? columns : [...DEFAULT_COLUMNS],
    maxRows:
      typeof rows === 'number' && Number.isInteger(rows) && rows >= 1 && rows <= 50 ? rows : 8,
    showAck: typeof p.showAck === 'boolean' ? p.showAck : true,
  };
}

export function countProps(item: WidgetItem | undefined): AlarmCountProps {
  const p = propsOf(item);
  let target: CountTarget = { kind: 'alarms' };
  const t = p.target;
  if (t && typeof t === 'object' && !Array.isArray(t)) {
    const o = t as Record<string, unknown>;
    if (o.kind === 'none') target = { kind: 'none' };
    else if (
      o.kind === 'screen' &&
      typeof o.screen === 'string' &&
      o.screen !== '' &&
      [...o.screen].length <= 64
    )
      target = { kind: 'screen', screen: o.screen };
  }
  return {
    areas: strings(p.areas, 64),
    minPriority: pickEnum(p.minPriority, PRIORITIES) ?? 'advisory',
    mode: p.mode === 'active' ? 'active' : 'unacked',
    target,
  };
}
