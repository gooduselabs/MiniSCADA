// Mô hình Bảng theo dõi, phần xem (feature 006, T132, FR-050, data-model §4): adapter lưới cho một bảng theo dõi (cùng
// lưới, chọn ô, bộ gõ, sao chép, dán, hoàn tác như Bảng Tag), định dạng giá trị, gợi ý tên Tag, dán danh sách tên, bảng mới.
// Lệnh Ghi nằm ở write-flow.ts (US2). Hàm thuần, không DOM; chữ số viết dấu chấm thập phân.
import { lookupValueTable } from '@mat/expression';
import type { ValueTableDoc, WatchRow, WatchTableDoc } from '@mat/project-schema';
import { reasonText } from '../app/code-text.ts';
import { fold, t, type MessageKey } from '../i18n/index.ts';
import type { ApplyResult, CellChange, GridAdapter, GridColumn, Rejected } from './grid/types.ts';
import type { ProjectEdit } from './project-doc.ts';

export const WATCH_MAX_ROWS = 200;
export const WATCH_MAX_TABLES = 32;
export const FORMATS = ['auto', 'dec', 'hex', 'bin', 'bool'] as const;
export type WatchFormat = (typeof FORMATS)[number];
const DASH = '—';
const TAG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

export interface WatchTagInfo {
  id: string;
  type: string;
  unit?: string;
  valueTable?: string;
}

export interface LiveCell {
  value: boolean | number | string | null;
  quality: 'GOOD' | 'BAD' | 'UNCERTAIN' | 'STALE';
  reason?: string;
  /** ms UTC lúc nhận. */
  ts: number;
}

const BITS: Readonly<Record<string, number>> = {
  BOOL: 8,
  INT16: 16,
  UINT16: 16,
  INT32: 32,
  UINT32: 32,
  INT64: 64,
  UINT64: 64,
};

/** Giá trị hiển thị theo định dạng của dòng (data-model §4). */
export function formatWatchValue(
  value: boolean | number | string | null,
  type: string,
  format: WatchFormat,
  decimals?: number,
): string {
  if (value === null || value === undefined) return DASH;
  if (typeof value === 'string' && type === 'STRING') return value;
  const numeric = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  const asBig = (): bigint | null => {
    try {
      if (typeof numeric === 'string') return BigInt(numeric);
      return Number.isInteger(numeric) ? BigInt(numeric) : null;
    } catch {
      return null;
    }
  };
  switch (format) {
    case 'bool': {
      const n = typeof numeric === 'string' ? Number(numeric) : numeric;
      return n !== 0 ? 'TRUE' : 'FALSE';
    }
    case 'hex':
    case 'bin': {
      const big = asBig();
      const width = BITS[type];
      if (big === null || !width) return autoText(value, type);
      const mask = (1n << BigInt(width)) - 1n;
      const u = big & mask;
      return format === 'hex'
        ? `0x${u
            .toString(16)
            .toUpperCase()
            .padStart(width / 4, '0')}`
        : `0b${u.toString(2).padStart(width, '0')}`;
    }
    case 'dec':
      if (typeof value === 'boolean') return value ? '1' : '0';
      if (typeof value === 'number' && decimals !== undefined) return value.toFixed(decimals);
      return autoText(value, type);
    default:
      return autoText(value, type);
  }
}

function autoText(value: boolean | number | string, type: string): string {
  if (typeof value === 'boolean')
    return type === 'BOOL' ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0';
  if (typeof value === 'number') {
    if (type === 'BOOL') return value !== 0 ? 'TRUE' : 'FALSE';
    return Number.isInteger(value) ? String(value) : String(parseFloat(value.toPrecision(7)));
  }
  return value;
}

export interface WatchAdapterOptions {
  table: WatchTableDoc;
  /** Tag của project theo id. */
  tags: ReadonlyMap<string, WatchTagInfo>;
  valueTables?: Readonly<Record<string, ValueTableDoc>>;
  online: boolean;
  live?: (id: string) => LiveCell | null;
  /** Tag mà BL335 báo không có (snapshot `unknown`). */
  unknownOnDevice?: ReadonlySet<string>;
  readOnly?: boolean;
  timeZone?: string;
  /** Kết quả lệnh ghi của dòng (US2): có hàm này thì thêm cột "Kết quả" sau cột giá trị ghi. */
  writes?: (row: number) => WriteCell | null;
}

export interface WriteCell {
  /** Chữ kết quả kèm thời điểm, đã dịch. */
  text: string;
  tone: 'pending' | 'ok' | 'warn' | 'err';
}

const COL = (
  key: string,
  kind: GridColumn['kind'],
  width: number,
  extra: Partial<GridColumn> = {},
): GridColumn => ({
  key,
  label: t(`wt.col.${key}` as MessageKey),
  kind,
  width,
  ...extra,
});

export class WatchAdapter implements GridAdapter {
  readonly columns: readonly GridColumn[];
  readonly maxRows: number;
  private readonly o: WatchAdapterOptions;
  private readonly timeFmt: Intl.DateTimeFormat;

  constructor(o: WatchAdapterOptions) {
    this.o = o;
    this.maxRows = o.readOnly ? 0 : WATCH_MAX_ROWS;
    this.timeFmt = new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: o.timeZone,
    });
    const live: GridColumn[] = o.online
      ? [
          COL('value', 'live', 120, { end: true }),
          COL('text', 'live', 110),
          COL('quality', 'live', 90),
          COL('reason', 'live', 200),
          COL('time', 'live', 80, { mono: true }),
        ]
      : [];
    this.columns = [
      COL('tag', 'text', 200, { mono: true, name: true }),
      ...live,
      COL('format', 'select', 80),
      COL('decimals', 'number', 80, { end: true }),
      COL('writeValue', 'text', 120, { mono: true }),
      ...(o.writes ? [COL('result', 'live', 300)] : []),
    ];
  }

  rowCount(): number {
    return this.o.table.rows.length;
  }

  private row(i: number): WatchRow {
    return this.o.table.rows[i] ?? { tag: '' };
  }

  /** Tag của dòng không có trong project (cảnh báo `W_WATCH_REF`). */
  missingInProject(i: number): boolean {
    return !this.o.tags.has(this.row(i).tag);
  }

  /** BL335 báo không có Tag này. */
  deviceMissing(i: number): boolean {
    return this.o.online && !!this.o.unknownOnDevice?.has(this.row(i).tag);
  }

  /** Sắc thái của kết quả ghi (để vẽ chip); `null` khi dòng chưa ghi. */
  writeTone(i: number): WriteCell['tone'] | null {
    return this.o.writes?.(i)?.tone ?? null;
  }

  /** Màu theo bảng giá trị của Tag (rỗng nếu không có). */
  color(i: number): string | null {
    return this.lookup(i)?.color ?? null;
  }

  private lookup(i: number): { text: string; color: string | null } | null {
    const r = this.row(i);
    const info = this.o.tags.get(r.tag);
    const table = info?.valueTable ? this.o.valueTables?.[info.valueTable] : undefined;
    const cell = this.o.live?.(r.tag);
    if (!table || !cell || cell.value === null || typeof cell.value === 'string') return null;
    return lookupValueTable(table as never, cell.value);
  }

  text(i: number, col: string): string {
    const r = this.row(i);
    switch (col) {
      case 'tag':
        return r.tag;
      case 'format':
        return r.format ?? 'auto';
      case 'decimals':
        return r.decimals === undefined ? '' : String(r.decimals);
      case 'writeValue':
        return r.writeValue ?? '';
      case 'result':
        return this.o.writes?.(i)?.text ?? '';
      default:
        break;
    }
    if (!this.o.online) return '';
    if (this.deviceMissing(i)) return col === 'value' ? t('wt.live.none') : '';
    const cell = this.o.live?.(r.tag) ?? null;
    if (!cell) return col === 'value' ? DASH : '';
    switch (col) {
      case 'value': {
        const info = this.o.tags.get(r.tag);
        return formatWatchValue(cell.value, info?.type ?? '', r.format ?? 'auto', r.decimals);
      }
      case 'text':
        return this.lookup(i)?.text ?? '';
      case 'quality':
        return cell.quality;
      case 'reason':
        return cell.reason ? reasonText(cell.reason) : '';
      case 'time':
        return this.timeFmt.format(new Date(cell.ts));
      default:
        return '';
    }
  }

  editable(_row: number, col: string): boolean {
    if (this.o.readOnly) return false;
    return ['tag', 'format', 'decimals', 'writeValue'].includes(col);
  }

  options(_row: number, col: string): readonly string[] | null {
    return col === 'format' ? FORMATS : null;
  }

  searchText(i: number): string {
    return this.row(i).tag;
  }

  apply(changes: readonly CellChange[]): ApplyResult {
    const rows: WatchRow[] = this.o.table.rows.map((r) => ({ ...r }));
    const rejected: Rejected[] = [];
    const fresh = new Map<number, WatchRow>();
    for (const c of changes) {
      const fail = (reason: MessageKey) =>
        rejected.push({ row: c.row, newIndex: c.newIndex, col: c.col, text: c.text, reason });
      const target = c.row === null ? (fresh.get(c.newIndex ?? 0) ?? { tag: '' }) : rows[c.row];
      if (!target) continue;
      const text = c.text.trim();
      switch (c.col) {
        case 'tag':
          if (!TAG_RE.test(text) || text.length > 64) {
            fail('wt.err.tag');
            continue;
          }
          target.tag = text;
          break;
        case 'format':
          if (!(FORMATS as readonly string[]).includes(text)) {
            fail('wt.err.format');
            continue;
          }
          if (text === 'auto') delete target.format;
          else target.format = text as WatchFormat;
          break;
        case 'decimals':
          if (text === '') delete target.decimals;
          else if (/^[0-9]$/.test(text)) target.decimals = Number(text);
          else {
            fail('wt.err.decimals');
            continue;
          }
          break;
        case 'writeValue':
          if (c.text.length > 64) {
            fail('wt.err.writeValue');
            continue;
          }
          if (text === '') delete target.writeValue;
          else target.writeValue = text;
          break;
        default:
          continue;
      }
      if (c.row === null) fresh.set(c.newIndex ?? 0, target);
    }
    for (const [, r] of [...fresh.entries()].sort((a, b) => a[0] - b[0]))
      if (r.tag !== '') rows.push(r);
    const same = JSON.stringify(rows) === JSON.stringify(this.o.table.rows);
    return {
      edits: same ? [] : [{ kind: 'watchTableUpsert', table: { ...this.o.table, rows } }],
      rejected,
    };
  }

  remove(rows: readonly number[]): ProjectEdit[] {
    const drop = new Set(rows);
    return [
      {
        kind: 'watchTableUpsert',
        table: { ...this.o.table, rows: this.o.table.rows.filter((_, i) => !drop.has(i)) },
      },
    ];
  }
}

export const watchAdapter = (o: WatchAdapterOptions): WatchAdapter => new WatchAdapter(o);

/** Gợi ý tên Tag khi gõ: bỏ dấu, không phân biệt hoa thường; khớp đầu tên trước, rồi khớp giữa. */
export function suggestTags(ids: readonly string[], query: string, limit = 20): string[] {
  const q = fold(query.trim());
  if (!q) return ids.slice(0, limit);
  const head: string[] = [];
  const mid: string[] = [];
  for (const id of ids) {
    const f = fold(id);
    if (f.startsWith(q)) head.push(id);
    else if (f.includes(q)) mid.push(id);
  }
  return [...head, ...mid].slice(0, limit);
}

/** Tách danh sách tên đã dán: dòng, tab, dấu phẩy, chấm phẩy, khoảng trắng. */
export function parseNameList(text: string): string[] {
  return text
    .split(/[\r\n\t,; ]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Thêm các tên vào cuối bảng (tới 200 dòng): một sửa đổi, số dòng đã thêm và số tên bị bỏ vì vượt giới hạn. */
export function addNames(
  table: WatchTableDoc,
  names: readonly string[],
): { edit: ProjectEdit; added: number; dropped: number } {
  const room = Math.max(0, WATCH_MAX_ROWS - table.rows.length);
  const take = names.slice(0, room);
  return {
    edit: {
      kind: 'watchTableUpsert',
      table: { ...table, rows: [...table.rows, ...take.map((tag): WatchRow => ({ tag }))] },
    },
    added: take.length,
    dropped: names.length - take.length,
  };
}

const slug = (s: string): string =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 46);

/** Bảng theo dõi mới: id `^[a-z0-9][a-z0-9-]{0,47}$` từ tên, không trùng id đã có. */
export function newWatchTable(existingIds: readonly string[], name: string): WatchTableDoc {
  const taken = new Set(existingIds);
  let title = name.trim();
  let base = slug(title);
  if (!base) {
    for (let n = 1; ; n++) {
      title = t('wt.newName', { n });
      base = slug(title);
      if (!taken.has(base)) break;
    }
  }
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return { schemaVersion: '0.2.0', id, name: title.slice(0, 80), rows: [] };
}

/** Tag cần đăng ký dữ liệu sống cho bảng này. */
export function watchTags(table: WatchTableDoc): string[] {
  return [...new Set(table.rows.map((r) => r.tag).filter(Boolean))];
}
