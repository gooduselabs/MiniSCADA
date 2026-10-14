// Adapter lưới của editor Lớp alarm (feature 009, T078, FR-076; contract studio-alarm-editor §4): cột Id, Tên, Ưu tiên, Màu,
// Nhấp nháy, Cần xác nhận, Xác nhận khi hết (khóa khi không cần xác nhận), Âm thanh, Chập chờn, Đang dùng. Sửa ô, thêm,
// xóa thành `alarmClassesSet` (và `alarmsSet` khi file alarm mới tạo). Hàm thuần.
import { ALARM_COLORS, ALARM_LIMITS, ALARM_PRIORITIES, ALARM_SOUNDS } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import {
  CLASS_COLS,
  addClass,
  applyClassCell,
  classCellText,
  colorLabel,
  docEdits,
  priorityLabel,
  removeClass,
  soundLabel,
  type AlarmDoc,
  type ClassCol,
} from './alarm-doc.ts';
import type { ApplyResult, CellChange, GridAdapter, GridColumn, Rejected } from './grid/types.ts';
import type { ProjectEdit } from './project-doc.ts';

const WIDTH: Readonly<Record<ClassCol, number>> = {
  id: 120,
  name: 140,
  priority: 110,
  color: 120,
  blink: 90,
  requiresAck: 110,
  ackReturn: 130,
  sound: 100,
  chatterLimit: 150,
  inUse: 90,
};

export interface AlarmClassesOptions {
  doc: AlarmDoc;
  version: string;
  hadFiles: { alarms: boolean; classes: boolean };
  readOnly: boolean;
}

const isClassCol = (c: string): c is ClassCol => (CLASS_COLS as readonly string[]).includes(c);

export class AlarmClassesGrid implements GridAdapter {
  readonly columns: readonly GridColumn[];
  readonly maxRows = ALARM_LIMITS.classes;
  readonly doc: AlarmDoc;
  private readonly o: AlarmClassesOptions;

  constructor(o: AlarmClassesOptions) {
    this.o = o;
    this.doc = o.doc;
    this.columns = CLASS_COLS.map((c) => ({
      key: c,
      label: t(`alarm.classes.col.${c}`),
      kind:
        c === 'inUse'
          ? ('readonly' as const)
          : c === 'chatterLimit'
            ? ('number' as const)
            : c === 'priority' ||
                c === 'color' ||
                c === 'sound' ||
                c === 'blink' ||
                c === 'requiresAck' ||
                c === 'ackReturn'
              ? ('select' as const)
              : ('text' as const),
      width: WIDTH[c],
      ...(c === 'id' ? { mono: true, name: true } : {}),
      ...(c === 'chatterLimit' || c === 'inUse' ? { end: true } : {}),
    }));
  }

  rowCount(): number {
    return this.doc.classes.length;
  }

  text(row: number, col: string): string {
    return isClassCol(col) ? classCellText(this.doc.classes[row], col, this.doc) : '';
  }

  editable(row: number, col: string): boolean {
    if (this.o.readOnly || !isClassCol(col) || col === 'inUse') return false;
    const c = this.doc.classes[row];
    if (!c) return false;
    // Xác nhận khi hết chỉ có nghĩa khi cần xác nhận.
    return !(col === 'ackReturn' && c.requiresAck === false);
  }

  options(_row: number, col: string): readonly string[] | null {
    switch (col) {
      case 'priority':
        return ALARM_PRIORITIES.map(priorityLabel);
      case 'color':
        return ALARM_COLORS.map(colorLabel);
      case 'sound':
        return ALARM_SOUNDS.map(soundLabel);
      case 'blink':
      case 'requiresAck':
      case 'ackReturn':
        return [t('alarm.enabled.on'), t('alarm.enabled.off')];
      default:
        return null;
    }
  }

  apply(changes: readonly CellChange[]): ApplyResult {
    const classes = [...this.doc.classes];
    const rejected: Rejected[] = [];
    let doc = this.doc;
    for (const c of changes) {
      if (!isClassCol(c.col)) continue;
      if (c.row === null) {
        const add = addClass({ ...doc, classes });
        if ('error' in add) {
          rejected.push({
            row: null,
            newIndex: c.newIndex ?? 0,
            col: c.col,
            text: c.text,
            reason: add.error,
          });
          continue;
        }
        classes.splice(0, classes.length, ...add.doc.classes);
        doc = add.doc;
        const at = classes.length - 1;
        const r = applyClassCell(classes[at]!, c.col, c.text);
        if (r.error) rejected.push({ row: at, col: c.col, text: c.text, reason: r.error });
        else classes[at] = r.def;
        continue;
      }
      const cur = classes[c.row];
      if (!cur) {
        rejected.push({ row: c.row, col: c.col, text: c.text, reason: 'alarm.err.row' });
        continue;
      }
      const r = applyClassCell(cur, c.col, c.text);
      if (r.error) rejected.push({ row: c.row, col: c.col, text: c.text, reason: r.error });
      else classes[c.row] = r.def;
    }
    return { edits: this.edits({ ...this.doc, classes }), rejected };
  }

  remove(rows: readonly number[]): ProjectEdit[] {
    let doc = this.doc;
    for (const r of rows) {
      const id = this.doc.classes[r]?.id;
      if (id) doc = removeClass(doc, id);
    }
    return this.edits(doc);
  }

  append(): { edits: ProjectEdit[]; row: number } {
    const r = addClass(this.doc);
    if ('error' in r) return { edits: [], row: this.doc.classes.length };
    return { edits: this.edits(r.doc), row: r.row };
  }

  /** Sửa đổi project để đưa tài liệu hiện tại thành `next`. */
  edits(next: AlarmDoc): ProjectEdit[] {
    // Lớp có thể rỗng khi xóa hết: docEdits không tự thêm lớp mặc định khi chưa có alarm.
    return docEdits(this.doc, next, this.o.version, this.o.hadFiles);
  }
}

export const alarmClassesGrid = (o: AlarmClassesOptions): AlarmClassesGrid =>
  new AlarmClassesGrid(o);
