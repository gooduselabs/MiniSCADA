// Adapter lưới của editor Lưu trữ (feature 010, FR-046; contracts/studio-010.md §1.1): lưới nhóm và lưới Tag dùng
// chung `mat-grid` (chọn ô, bộ gõ, dán, điền xuống, hoàn tác như Bảng Tag). Mỗi lần áp chữ thành MỘT sửa đổi
// `{ kind: 'logging' }` (một bước hoàn tác); chữ không đọc được bị từ chối theo ô, còn giá trị sai luật (id, độ dài...) vẫn
// ghi và hiện lỗi theo ô từ bộ kiểm tra: lưu được khi còn lỗi (FR-054).
import { defaultTableName, type LoggingConfig, type TagDataType } from '@mat/project-schema';
import { OFF_WORDS, ON_WORDS } from '../i18n/bool-words.ts';
import { t } from '../i18n/index.ts';
import type { EstimateView } from './estimate-view.ts';
import type { ApplyResult, CellChange, GridAdapter, GridColumn, Rejected } from './grid/types.ts';
import {
  MAX_TAGS_PER_GROUP,
  addGroup,
  applicable,
  displayModeOf,
  mapGroup,
  removeGroup,
  removeTags,
  setAggregates,
  setDisplayMode,
  setGroupField,
  setTagField,
  type DisplayMode,
} from './logging-doc.ts';

export const MAX_GROUPS = 32;

// ---- khoảng thời gian -------------------------------------------------------------------------------------------

const UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  giây: 1000,
  sec: 1000,
  m: 60_000,
  min: 60_000,
  phút: 60_000,
  h: 3_600_000,
  giờ: 3_600_000,
};

/** "250 ms", "5 s", "1,5 s", "2 phút", "1 giờ"; số trần là ms. Không đọc được hoặc ≤ 0: null. */
export function parseDuration(text: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([A-Za-zÀ-ỹ]*)\s*$/u.exec(text);
  if (!m) return null;
  const unit = (m[2] ?? '').toLowerCase();
  const mult = unit === '' ? 1 : UNIT_MS[unit];
  if (mult === undefined) return null;
  const ms = Math.round(Number(m[1]!.replace(',', '.')) * mult);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const dec = (n: number): string => String(Number(n.toFixed(3))).replace('.', ',');

export function formatMs(ms: number): string {
  if (ms >= 3_600_000 && ms % 600_000 === 0) return `${dec(ms / 3_600_000)} ${t('hist.unit.h')}`;
  if (ms >= 60_000 && ms % 1000 === 0 && ms % 6000 === 0)
    return `${dec(ms / 60_000)} ${t('hist.unit.min')}`;
  if (ms >= 1000) return `${dec(ms / 1000)} ${t('hist.unit.s')}`;
  return `${ms} ${t('hist.unit.ms')}`;
}

const parseNumber = (text: string): number | null => {
  const s = text.trim().replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---- chế độ -----------------------------------------------------------------------------------------------------

const MODE_ORDER: readonly DisplayMode[] = ['cyclic', 'onChange', 'combined', 'trigger'];
const modeLabel = (m: DisplayMode): string => t(`hist.mode.${m}`);
const modeOfLabel = (text: string): DisplayMode | null => {
  const s = text.trim().toLowerCase();
  return MODE_ORDER.find((m) => modeLabel(m).toLowerCase() === s || m.toLowerCase() === s) ?? null;
};

const EDGE_KEY = {
  rising: 'hist.edge.rising',
  falling: 'hist.edge.falling',
  both: 'hist.edge.both',
  active: 'hist.edge.active',
} as const;

const ON = (): string => t('hist.on');
const OFF = (): string => t('hist.off');
const isOn = (text: string): boolean | null => {
  const s = text.trim().toLowerCase();
  if (ON_WORDS.includes(s)) return true;
  if (OFF_WORDS.includes(s)) return false;
  return null;
};

// ---- adapter ----------------------------------------------------------------------------------------------------

export interface GroupAdapterOptions {
  cfg: LoggingConfig;
  types: ReadonlyMap<string, TagDataType> | null;
  estimate: EstimateView;
  readOnly: boolean;
  /** Mô tả Tag theo id (nhãn hiển thị mặc định, 042); vắng thì dùng tên Tag. */
  descriptions?: ReadonlyMap<string, string> | null;
}

const rej = (c: CellChange, reason: string): Rejected => ({
  row: c.row,
  ...(c.newIndex !== undefined ? { newIndex: c.newIndex } : {}),
  col: c.col,
  text: c.text,
  reason,
});

const mbText = (bytes: number): string => {
  const mb = bytes / 1e6;
  return mb >= 100 ? String(Math.round(mb)) : mb >= 1 ? mb.toFixed(1).replace('.', ',') : '<1';
};

export function groupAdapter(o: GroupAdapterOptions): GridAdapter {
  const columns: GridColumn[] = [
    { key: 'id', label: t('hist.col.id'), kind: 'text', width: 110, mono: true, name: true },
    { key: 'name', label: t('hist.col.name'), kind: 'text', width: 180 },
    { key: 'table', label: t('hist.col.table'), kind: 'text', width: 130, mono: true },
    { key: 'mode', label: t('hist.col.mode'), kind: 'select', width: 100 },
    { key: 'interval', label: t('hist.col.interval'), kind: 'text', width: 150 },
    { key: 'retention', label: t('hist.col.retention'), kind: 'number', width: 90, end: true },
    { key: 'tags', label: t('hist.col.tags'), kind: 'readonly', width: 60, end: true },
    { key: 'agg', label: t('hist.col.agg'), kind: 'select', width: 80 },
    { key: 'mb', label: t('hist.col.mbPerDay'), kind: 'readonly', width: 100, end: true },
  ];
  const groups = o.cfg.groups;
  const intervalText = (i: number): string => {
    const g = groups[i]!;
    switch (displayModeOf(g)) {
      case 'cyclic':
        return g.periodMs === undefined ? '' : formatMs(g.periodMs);
      case 'onChange':
        return t('hist.interval.min', { d: formatMs(g.minIntervalMs ?? 1000) });
      case 'combined':
        return `${formatMs(g.minIntervalMs ?? 1000)} – ${formatMs(g.maxIntervalMs ?? 0)}`;
      case 'trigger': {
        const tr = g.trigger;
        return tr ? t('hist.interval.trigger', { edge: t(EDGE_KEY[tr.edge]), tag: tr.tagId }) : '';
      }
    }
  };
  const text = (row: number, col: string): string => {
    const g = groups[row];
    if (!g) return '';
    switch (col) {
      case 'id':
        return g.id;
      case 'name':
        return g.name;
      case 'table':
        return g.table ?? defaultTableName(g.id);
      case 'mode':
        return modeLabel(displayModeOf(g));
      case 'interval':
        return intervalText(row);
      case 'retention':
        return g.retentionDays === undefined ? '' : String(g.retentionDays);
      case 'tags':
        return String(g.tags?.length ?? 0);
      case 'agg':
        return g.aggregates ? ON() : OFF();
      case 'mb':
        return o.estimate.state === 'ok' && o.estimate.groups[row]
          ? mbText(o.estimate.groups[row]!.totalBytes)
          : '';
      default:
        return '';
    }
  };
  const apply = (changes: readonly CellChange[]): ApplyResult => {
    if (o.readOnly) return { edits: [], rejected: changes.map((c) => rej(c, 'hist.err.readOnly')) };
    let cfg = o.cfg;
    const rejected: Rejected[] = [];
    for (const c of changes) {
      const row = c.row;
      if (row === null || !cfg.groups[row]) {
        rejected.push(rej(c, 'hist.err.row'));
        continue;
      }
      const txt = c.text.trim();
      switch (c.col) {
        case 'id':
        case 'name':
          cfg = setGroupField(cfg, row, c.col, c.text.trim());
          break;
        case 'table': {
          // Trống hoặc bằng tên mặc định theo id: bỏ khóa (giữ file gọn, runtime tự đặt).
          const g = cfg.groups[row]!;
          cfg = setGroupField(
            cfg,
            row,
            'table',
            txt === '' || txt === defaultTableName(g.id) ? undefined : txt,
          );
          break;
        }
        case 'retention': {
          const n = parseNumber(txt);
          if (n === null || !Number.isInteger(n) || n < 0) rejected.push(rej(c, 'hist.err.int'));
          else cfg = setGroupField(cfg, row, 'retentionDays', n);
          break;
        }
        case 'mode': {
          const m = modeOfLabel(txt);
          if (!m) rejected.push(rej(c, 'hist.err.mode'));
          else cfg = mapGroup(cfg, row, (g) => setDisplayMode(g, m));
          break;
        }
        case 'agg': {
          const on = isOn(txt);
          if (on === null) rejected.push(rej(c, 'hist.err.bool'));
          else cfg = setAggregates(cfg, row, on);
          break;
        }
        case 'interval': {
          const mode = displayModeOf(cfg.groups[row]!);
          if (mode === 'trigger') {
            rejected.push(rej(c, 'hist.err.readOnlyCell'));
          } else if (mode === 'combined') {
            const parts = txt.split(/\s*(?:–|—|\.\.|-)\s*/);
            const a = parts.length === 2 ? parseDuration(parts[0]!) : null;
            const b = parts.length === 2 ? parseDuration(parts[1]!) : null;
            if (a === null || b === null) rejected.push(rej(c, 'hist.err.range'));
            else {
              cfg = setGroupField(cfg, row, 'minIntervalMs', a);
              cfg = setGroupField(cfg, row, 'maxIntervalMs', b);
            }
          } else {
            const ms = parseDuration(txt.replace(/^≥\s*/, ''));
            if (ms === null) rejected.push(rej(c, 'hist.err.duration'));
            else
              cfg = setGroupField(cfg, row, mode === 'cyclic' ? 'periodMs' : 'minIntervalMs', ms);
          }
          break;
        }
        default:
          rejected.push(rej(c, 'hist.err.readOnlyCell'));
      }
    }
    return { edits: cfg === o.cfg ? [] : [{ kind: 'logging', value: cfg }], rejected };
  };
  return {
    columns,
    maxRows: MAX_GROUPS,
    rowCount: () => groups.length,
    text,
    editable: (row, col) =>
      !o.readOnly &&
      !!groups[row] &&
      col !== 'tags' &&
      col !== 'mb' &&
      !(col === 'interval' && displayModeOf(groups[row]!) === 'trigger'),
    options: (_row, col) =>
      col === 'mode' ? MODE_ORDER.map(modeLabel) : col === 'agg' ? [ON(), OFF()] : null,
    apply,
    remove: (rows) => {
      let cfg = o.cfg;
      for (const r of [...rows].sort((a, b) => b - a)) cfg = removeGroup(cfg, r);
      return [{ kind: 'logging', value: cfg }];
    },
    append: () => ({
      edits: [{ kind: 'logging', value: addGroup(o.cfg) }],
      row: o.cfg.groups.length,
    }),
    searchText: (row) => `${groups[row]?.id ?? ''} ${groups[row]?.name ?? ''}`,
  };
}

// ---- lưới Tag của một nhóm ----------------------------------------------------------------------------------------

export interface TagAdapterOptions extends GroupAdapterOptions {
  /** Chỉ số nhóm của lưới. */
  group: number;
}

export function tagAdapter(o: TagAdapterOptions): GridAdapter {
  const columns: GridColumn[] = [
    { key: 'tag', label: t('hist.tcol.tag'), kind: 'text', width: 220, mono: true, name: true },
    { key: 'column', label: t('hist.tcol.column'), kind: 'text', width: 150, mono: true },
    { key: 'label', label: t('hist.tcol.label'), kind: 'text', width: 180 },
    { key: 'deadband', label: t('hist.tcol.deadband'), kind: 'number', width: 90, end: true },
    { key: 'length', label: t('hist.tcol.length'), kind: 'number', width: 80, end: true },
    { key: 'agg', label: t('hist.tcol.agg'), kind: 'select', width: 90 },
    { key: 'note', label: t('hist.tcol.note'), kind: 'readonly', width: 220 },
  ];
  const tags = o.cfg.groups[o.group]?.tags ?? [];
  const defaultLabel = (id: string): string => o.descriptions?.get(id) || id;
  const typeOf = (row: number): TagDataType | undefined => {
    const id = tags[row]?.tagId;
    return id === undefined ? undefined : o.types?.get(id);
  };
  const ok = (row: number, field: 'deadband' | 'maxLength' | 'aggregate'): boolean =>
    applicable(typeOf(row), field);
  const text = (row: number, col: string): string => {
    const tg = tags[row];
    if (!tg) return '';
    switch (col) {
      case 'tag':
        return tg.tagId;
      case 'column':
        return tg.column ?? tg.tagId.replace(/\./g, '_');
      case 'label':
        return tg.label ?? defaultLabel(tg.tagId);
      case 'deadband':
        return tg.deadband === undefined ? '' : String(tg.deadband);
      case 'length':
        return tg.maxLength === undefined ? '' : String(tg.maxLength);
      case 'agg':
        return !ok(row, 'aggregate') ? t('hist.dash') : tg.aggregate === false ? OFF() : ON();
      case 'note':
        return typeOf(row) ? typeOf(row)! : o.types ? t('hist.tag.unknown') : '';
      default:
        return '';
    }
  };
  const apply = (changes: readonly CellChange[]): ApplyResult => {
    if (o.readOnly) return { edits: [], rejected: changes.map((c) => rej(c, 'hist.err.readOnly')) };
    let cfg = o.cfg;
    const rejected: Rejected[] = [];
    for (const c of changes) {
      const row = c.row;
      if (row === null || !tags[row]) {
        rejected.push(rej(c, 'hist.err.row'));
        continue;
      }
      const txt = c.text.trim();
      switch (c.col) {
        case 'tag':
          if (txt === '') rejected.push(rej(c, 'hist.err.tag'));
          else if (o.types && !o.types.has(txt)) rejected.push(rej(c, 'hist.err.tagMissing'));
          else cfg = setTagField(cfg, o.group, row, 'tagId', txt);
          break;
        case 'column':
          cfg = setTagField(cfg, o.group, row, 'column', txt === '' ? undefined : txt);
          break;
        case 'label': {
          // Chỉ ghi khi khác nhãn mặc định: runtime cũ từ chối khóa `label`, file không đổi khi không đặt nhãn.
          const def = defaultLabel(tags[row]!.tagId);
          cfg = setTagField(
            cfg,
            o.group,
            row,
            'label',
            txt === '' || txt === def ? undefined : txt,
          );
          break;
        }
        case 'deadband':
        case 'length': {
          const field = c.col === 'deadband' ? 'deadband' : 'maxLength';
          if (!ok(row, field)) {
            rejected.push(rej(c, 'hist.err.notApplicable'));
            break;
          }
          if (txt === '') {
            cfg = setTagField(cfg, o.group, row, field, undefined);
            break;
          }
          const n = parseNumber(txt);
          if (n === null || n < 0 || (field === 'maxLength' && !Number.isInteger(n)))
            rejected.push(rej(c, field === 'deadband' ? 'hist.err.number' : 'hist.err.int'));
          else cfg = setTagField(cfg, o.group, row, field, n);
          break;
        }
        case 'agg': {
          if (!ok(row, 'aggregate')) {
            rejected.push(rej(c, 'hist.err.notApplicable'));
            break;
          }
          const on = isOn(txt);
          if (on === null) rejected.push(rej(c, 'hist.err.bool'));
          else cfg = setTagField(cfg, o.group, row, 'aggregate', on ? undefined : false);
          break;
        }
        default:
          rejected.push(rej(c, 'hist.err.readOnlyCell'));
      }
    }
    return { edits: cfg === o.cfg ? [] : [{ kind: 'logging', value: cfg }], rejected };
  };
  return {
    columns,
    maxRows: MAX_TAGS_PER_GROUP,
    rowCount: () => tags.length,
    text,
    editable: (row, col) => {
      if (o.readOnly || !tags[row]) return false;
      if (col === 'note') return false;
      if (col === 'deadband') return ok(row, 'deadband');
      if (col === 'length') return ok(row, 'maxLength');
      if (col === 'agg') return ok(row, 'aggregate');
      return true;
    },
    options: (_row, col) => (col === 'agg' ? [ON(), OFF()] : null),
    apply,
    remove: (rows) => [{ kind: 'logging', value: removeTags(o.cfg, o.group, rows) }],
    searchText: (row) => `${tags[row]?.tagId ?? ''} ${tags[row]?.label ?? ''}`,
  };
}
