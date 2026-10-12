// Adapter giả cho test của lưới (feature 006): bảng chữ trong bộ nhớ, sửa đổi giả (`tagField`/`tagUpsert`/`tagRemove`) để
// so kết quả. Không vào bản build: chỉ file *.test.ts import.
import type { ProjectEdit } from '../project-doc.ts';
import type {
  ApplyResult,
  CellChange,
  ColKind,
  GridAdapter,
  GridColumn,
  Rejected,
} from './types.ts';

export const COLS: readonly GridColumn[] = [
  { key: 'id', label: 'Tên', kind: 'text', width: 120, name: true, mono: true },
  { key: 'type', label: 'Kiểu', kind: 'select', width: 80 },
  { key: 'addr', label: 'Địa chỉ', kind: 'text', width: 100, mono: true },
  { key: 'min', label: 'Min', kind: 'number', width: 60, end: true },
  { key: 'info', label: 'Thông tin', kind: 'readonly', width: 80 },
  { key: 'desc', label: 'Mô tả', kind: 'text', width: 160 },
];

export const TYPES = ['BOOL', 'INT16', 'FLOAT32'] as const;

export type Row = Record<string, string>;

export class FakeAdapter implements GridAdapter {
  columns = COLS;
  rows: Row[];
  maxRows: number;
  /** Cột có hàm tăng riêng (như địa chỉ tăng theo số thanh ghi). */
  stepCols = new Set<string>();

  constructor(rows: Row[] = [], maxRows = 2000) {
    this.rows = rows.map((r) => ({
      id: '',
      type: 'FLOAT32',
      addr: '',
      min: '',
      info: '',
      desc: '',
      ...r,
    }));
    this.maxRows = maxRows;
  }

  rowCount(): number {
    return this.rows.length;
  }

  text(row: number, col: string): string {
    return this.rows[row]?.[col] ?? '';
  }

  editable(_row: number, col: string): boolean {
    return this.columns.find((c) => c.key === col)?.kind !== ('readonly' as ColKind);
  }

  options(_row: number, col: string): readonly string[] | null {
    return col === 'type' ? TYPES : null;
  }

  apply(changes: readonly CellChange[]): ApplyResult {
    const edits: ProjectEdit[] = [];
    const rejected: Rejected[] = [];
    const created = new Map<number, Row>();
    for (const c of changes) {
      if (c.col === 'type' && !TYPES.includes(c.text as (typeof TYPES)[number])) {
        rejected.push({
          row: c.row,
          newIndex: c.newIndex,
          col: c.col,
          text: c.text,
          reason: 'bad type',
        });
        continue;
      }
      if (c.col === 'min' && c.text !== '' && Number.isNaN(Number(c.text))) {
        rejected.push({
          row: c.row,
          newIndex: c.newIndex,
          col: c.col,
          text: c.text,
          reason: 'NaN',
        });
        continue;
      }
      if (c.col === 'id' && c.text === '' && c.row !== null) {
        rejected.push({ row: c.row, col: c.col, text: c.text, reason: 'required' });
        continue;
      }
      if (c.row === null) {
        const k = c.newIndex ?? 0;
        const row = created.get(k) ?? {
          id: '',
          type: 'FLOAT32',
          addr: '',
          min: '',
          info: '',
          desc: '',
        };
        row[c.col] = c.text;
        created.set(k, row);
      } else {
        edits.push({ kind: 'tagField', index: c.row, field: c.col as never, value: c.text });
      }
    }
    for (const [, row] of [...created.entries()].sort((a, b) => a[0] - b[0]))
      edits.push({ kind: 'tagUpsert', tag: row as never });
    return { edits, rejected };
  }

  remove(rows: readonly number[]): ProjectEdit[] {
    return [...rows].sort((a, b) => b - a).map((index) => ({ kind: 'tagRemove', index }));
  }

  append(): { edits: ProjectEdit[]; row: number } {
    const last = this.rows.at(-1);
    return {
      edits: [{ kind: 'tagUpsert', tag: { ...(last ?? {}), id: '' } as never }],
      row: this.rows.length,
    };
  }

  fillNext(_row: number, col: string, above: string, steps: number): string | undefined {
    if (!this.stepCols.has(col)) return undefined;
    const m = /^([A-Z]+)(\d+)$/.exec(above);
    return m ? `${m[1]}${Number(m[2]) + 2 * steps}` : undefined;
  }

  /** Áp sửa đổi giả lên bảng (như store áp lên tài liệu). */
  commit(edits: readonly ProjectEdit[]): void {
    for (const e of edits) {
      if (e.kind === 'batch') this.commit(e.edits);
      else if (e.kind === 'tagField') this.rows[e.index][e.field] = String(e.value ?? '');
      else if (e.kind === 'tagUpsert') this.rows.push({ ...(e.tag as unknown as Row) });
      else if (e.kind === 'tagRemove') this.rows.splice(e.index, 1);
    }
  }
}

export const names = (a: FakeAdapter): string[] => a.rows.map((r) => r.id);
