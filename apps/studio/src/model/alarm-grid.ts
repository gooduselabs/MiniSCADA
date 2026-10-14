// Adapter lưới của editor Danh sách alarm (feature 009, T076, FR-074, FR-077, FR-078; contract studio-alarm-editor §3): cột theo
// §3.1, chữ của ô, danh sách chọn, sửa ô, điền xuống, dán và thêm dòng thành sửa đổi project (`alarmsSet`,
// `alarmClassesSet`), giới hạn 500 instance. Dùng lưới ảo hóa chung của 006 (ADR-016). Hàm thuần, không DOM.
import { ALARM_LIMITS } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import {
  ALARM_COLS,
  addAlarm,
  alarmFromCells,
  cellApplicable,
  cellText,
  docEdits,
  insertAlarms,
  instanceCount,
  isAlarmCol,
  removeAlarms,
  setCells,
  newAlarm,
  type AlarmCol,
  type AlarmCtx,
  type AlarmDoc,
  type CellEdit,
} from './alarm-doc.ts';
import type { ApplyResult, CellChange, GridAdapter, GridColumn, Rejected } from './grid/types.ts';
import type { ProjectEdit } from './project-doc.ts';

export const ALARM_LIVE_COL = 'live';

/** Dấu ẩn trong chữ tìm để bộ lọc nhanh "Chỉ dòng lỗi", "Chỉ dòng chưa dùng ngưỡng" dùng ô tìm của lưới. */
export const FILTER_ERRORS = 'zzerrzz';
export const FILTER_UNUSED = 'zzunusedzz';

const WIDTH: Readonly<Record<AlarmCol, number>> = {
  id: 130,
  name: 170,
  type: 90,
  tag: 170,
  cond: 120,
  HH: 70,
  H: 70,
  L: 70,
  LL: 70,
  deadband: 80,
  onDelay: 90,
  offDelay: 90,
  class: 150,
  area: 110,
  text: 260,
  enabled: 70,
};
const NUMERIC = new Set<AlarmCol>(['HH', 'H', 'L', 'LL', 'deadband', 'onDelay', 'offDelay']);

export interface AlarmGridOptions {
  doc: AlarmDoc;
  ctx: AlarmCtx;
  /** `schemaVersion` của project (file mới phải khớp). */
  version: string;
  hadFiles: { alarms: boolean; classes: boolean };
  readOnly: boolean;
  /** Cột đang hiện (mặc định tất cả). */
  columns?: readonly AlarmCol[];
  /** Hàng có lỗi hoặc cảnh báo (cho bộ lọc "Chỉ dòng lỗi"). */
  errorRows?: ReadonlySet<number>;
  /** Có cột "Trạng thái sống" (Online, thiết bị hỗ trợ alarm). */
  live?: boolean;
  /** Chữ của cột sống cho một dòng. */
  liveText?: (row: number) => string;
}

export class AlarmGrid implements GridAdapter {
  readonly columns: readonly GridColumn[];
  readonly maxRows = 100_000;
  readonly doc: AlarmDoc;
  /** Trường bị bỏ ở lần `apply` gần nhất do đổi loại alarm (editor báo cho người dùng). */
  lost: string[] = [];
  private readonly o: AlarmGridOptions;

  constructor(o: AlarmGridOptions) {
    this.o = o;
    this.doc = o.doc;
    const shown = o.columns ?? ALARM_COLS;
    const cols: GridColumn[] = ALARM_COLS.filter((c) => shown.includes(c)).map((c) => ({
      key: c,
      label: t(`alarm.grid.col.${c}`),
      kind:
        c === 'type' ||
        c === 'cond' ||
        c === 'class' ||
        c === 'area' ||
        c === 'enabled' ||
        c === 'tag'
          ? ('select' as const)
          : NUMERIC.has(c)
            ? ('number' as const)
            : ('text' as const),
      width: WIDTH[c],
      ...(c === 'id' || c === 'tag' ? { mono: true } : {}),
      ...(c === 'id' ? { name: true } : {}),
      ...(NUMERIC.has(c) ? { end: true } : {}),
    }));
    if (o.live)
      cols.push({ key: ALARM_LIVE_COL, label: t('alarm.grid.col.live'), kind: 'live', width: 190 });
    this.columns = cols;
  }

  rowCount(): number {
    return this.doc.alarms.length;
  }

  text(row: number, col: string): string {
    if (col === ALARM_LIVE_COL) return this.o.liveText?.(row) ?? '';
    return isAlarmCol(col) ? cellText(this.doc.alarms[row], col, this.doc) : '';
  }

  editable(row: number, col: string): boolean {
    if (this.o.readOnly || !isAlarmCol(col)) return false;
    const def = this.doc.alarms[row];
    return !!def && cellApplicable(def, col);
  }

  /** Chữ tìm: tên, Id, Tag, nội dung (không phân biệt dấu); thêm dấu ẩn cho bộ lọc nhanh. */
  searchText(row: number): string {
    const d = this.doc.alarms[row] as unknown as Record<string, unknown> | undefined;
    if (!d) return '';
    const parts = [d.id, d.name, d.tag, d.device, d.text].map((x) =>
      typeof x === 'string' ? x : '',
    );
    if (d.type === 'limit')
      for (const l of Object.values((d.limits ?? {}) as Record<string, { text?: string }>))
        parts.push(l.text ?? '');
    if (this.o.errorRows?.has(row)) parts.push(FILTER_ERRORS);
    if (d.type === 'limit' && Object.keys((d.limits ?? {}) as object).length < 4)
      parts.push(FILTER_UNUSED);
    return parts.join(' ');
  }

  options(row: number, col: string): readonly string[] | null {
    const def = this.doc.alarms[row] as unknown as Record<string, unknown> | undefined;
    switch (col) {
      case 'type':
        return (['digital', 'limit', 'quality'] as const).map((k) => t(`alarm.type.${k}`));
      case 'tag': {
        const tags = [...this.o.ctx.tags.keys()];
        return def?.type === 'quality' ? [...tags, ...this.o.ctx.devices] : tags;
      }
      case 'cond':
        return def?.type === 'digital'
          ? [t('alarm.trigger.on'), t('alarm.trigger.off')]
          : [t('alarm.qualityOn.bad'), t('alarm.qualityOn.notGood')];
      case 'class':
        return this.doc.classes.map((c) => c.name);
      case 'area':
        return [t('alarm.area.common'), ...this.doc.areas.map((a) => a.name)];
      case 'enabled':
        return [t('alarm.enabled.on'), t('alarm.enabled.off')];
      default:
        return null;
    }
  }

  /** Thay đổi các ô thành sửa đổi project: ô không áp dụng hoặc sai kiểu được trả về để lưới đánh dấu. */
  apply(changes: readonly CellChange[]): ApplyResult {
    const edits: CellEdit[] = [];
    const fresh = new Map<number, Partial<Record<AlarmCol, string>>>();
    const rejected: Rejected[] = [];
    for (const c of changes) {
      if (!isAlarmCol(c.col)) continue;
      if (c.row === null) {
        const idx = c.newIndex ?? 0;
        const cells = fresh.get(idx) ?? {};
        cells[c.col] = c.text;
        fresh.set(idx, cells);
      } else edits.push({ row: c.row, col: c.col, text: c.text });
    }
    const set = setCells(this.doc, edits, this.o.ctx);
    this.lost = set.lost;
    for (const r of set.rejected)
      rejected.push({ row: r.row, col: r.col, text: r.text, reason: r.reason });
    let doc = set.doc;
    let dropped = 0;
    let added = 0;
    for (const [, cells] of [...fresh.entries()].sort((x, y) => x[0] - y[0])) {
      // Từng dòng một: id gợi ý của dòng sau thấy các dòng đã thêm (không trùng trong cùng đợt dán).
      const r = alarmFromCells(doc, cells, this.o.ctx);
      const ins = insertAlarms(doc, [r.def]);
      doc = ins.doc;
      dropped += ins.dropped;
      added += ins.added;
    }
    if (dropped > 0)
      rejected.push({
        row: null,
        newIndex: Math.max(0, added + dropped - 1),
        col: 'id',
        text: '',
        reason: t('alarm.grid.pasteOverLimit', { n: dropped, max: ALARM_LIMITS.instances }),
      });
    return { edits: this.edits(doc), rejected };
  }

  remove(rows: readonly number[]): ProjectEdit[] {
    return this.edits(removeAlarms(this.doc, rows));
  }

  append(): { edits: ProjectEdit[]; row: number } {
    if (instanceCount([...this.doc.alarms, newAlarm(this.doc)]) > ALARM_LIMITS.instances)
      return { edits: [], row: this.doc.alarms.length };
    return { edits: this.edits(addAlarm(this.doc)), row: this.doc.alarms.length };
  }

  /** Sửa đổi project để đưa tài liệu hiện tại thành `next`. */
  edits(next: AlarmDoc): ProjectEdit[] {
    return docEdits(this.doc, next, this.o.version, this.o.hadFiles);
  }
}

export const alarmGrid = (o: AlarmGridOptions): AlarmGrid => new AlarmGrid(o);

/** Thanh trạng thái dưới lưới (§3): "142 instance / 500 (cảnh báo trên 200) · 3 lỗi · 1 cảnh báo". */
export function statusLine(doc: AlarmDoc, errors: number, warnings: number): string {
  return `${t('alarm.grid.status', {
    n: instanceCount(doc.alarms),
    max: ALARM_LIMITS.instances,
    e: errors,
    w: warnings,
  })} ${t('alarm.grid.statusWarn', { warn: ALARM_LIMITS.warnInstances })}`;
}
