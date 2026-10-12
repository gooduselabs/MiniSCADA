// Nhập và xuất CSV của Bảng Tag (feature 006, T124, FR-045, US1-12). Nhập: giải mã byte (BOM, UTF-8, Windows-1258), tách
// cột, khớp cột theo tiêu đề, thêm mới hoặc cập nhật theo tên Tag (không bao giờ xóa), kiểm từng dòng qua adapter của Bảng
// Tag; dòng có lỗi không được áp. Kết quả là kế hoạch để xem trước và MỘT sửa đổi `batch`. Xuất: UTF-8 có BOM, chống công
// thức, bỏ cột chỉ đọc. Hàm thuần.
import { fold, type MessageKey } from '../i18n/index.ts';
import { batchOf } from './grid/batch.ts';
import { parseNumber } from './grid/clipboard.ts';
import { decodeCsvBytes, parseCsv, toCsv, type CsvEncoding, type Delimiter } from './grid/csv.ts';
import type { CellChange } from './grid/types.ts';
import type { ProjectEdit } from './project-doc.ts';
import { MAX_TAG_ROWS, type TagTable } from './tag-table.ts';

/** Dấu thập phân mặc định theo vùng của Windows (`Intl.NumberFormat`). */
export function defaultDecimal(): '.' | ',' {
  try {
    const part = new Intl.NumberFormat().formatToParts(1.5).find((p) => p.type === 'decimal');
    return part?.value === ',' ? ',' : '.';
  } catch {
    return '.';
  }
}

export interface CsvImportOptions {
  decimal: '.' | ',';
  /** Ép dấu phân cách; mặc định tự nhận. */
  delimiter?: Delimiter;
  /** Ép bảng mã; mặc định tự nhận. */
  encoding?: CsvEncoding;
}

export interface CsvHeader {
  header: string;
  /** Khóa cột của Bảng Tag; `null`: không khớp, bỏ qua. */
  col: string | null;
}

export interface CsvRowError {
  /** `null`: lỗi của cả dòng (tên trùng, quá giới hạn). */
  col: string | null;
  /** Khóa chuỗi hoặc chữ đã dựng sẵn. */
  reason: MessageKey | string;
}

export interface CsvImportRow {
  /** Số dòng trong file (dòng tiêu đề là 1). */
  line: number;
  id: string;
  action: 'add' | 'update' | 'same' | 'error' | 'dropped';
  /** Khóa các cột có thay đổi. */
  cells: string[];
  errors: CsvRowError[];
}

export interface CsvImportPlan {
  encoding: CsvEncoding;
  delimiter: Delimiter;
  headers: CsvHeader[];
  rows: CsvImportRow[];
  edits: ProjectEdit[];
  counts: { add: number; update: number; same: number; error: number; dropped: number };
  fatal?: MessageKey;
}

/** Cột nhận từ CSV: mọi cột ghi được (bỏ cột chỉ đọc và cột sống). */
const writable = (adapter: TagTable) =>
  adapter.columns.filter((c) => c.kind !== 'readonly' && c.kind !== 'live');

export function planCsvImport(
  bytes: Uint8Array,
  table: TagTable,
  opts: CsvImportOptions,
): CsvImportPlan {
  const { text, encoding } = decodeCsvBytes(bytes, opts.encoding);
  const parsed = parseCsv(text, opts.delimiter);
  const plan: CsvImportPlan = {
    encoding,
    delimiter: parsed.delimiter,
    headers: [],
    rows: [],
    edits: [],
    counts: { add: 0, update: 0, same: 0, error: 0, dropped: 0 },
  };
  if (!parsed.rows.length) return { ...plan, fatal: 'tt.csv.empty' };

  const adapter = table.full();
  const cols = writable(adapter);
  const byName = new Map<string, string>();
  for (const c of cols) {
    byName.set(fold(c.label), c.key);
    byName.set(fold(c.csv ?? c.label), c.key);
    byName.set(fold(c.key), c.key);
  }
  const header = parsed.rows[0];
  plan.headers = header.map((h) => ({ header: h, col: byName.get(fold(h.trim())) ?? null }));
  const idAt = plan.headers.findIndex((h) => h.col === 'id');
  if (idAt < 0) return { ...plan, fatal: 'tt.csv.noId' };

  // Tên trùng trong file: mọi dòng trùng đều lỗi.
  const seen = new Map<string, number>();
  for (const r of parsed.rows.slice(1)) {
    const id = (r[idAt] ?? '').trim();
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const index = new Map<string, number>();
  for (let i = 0; i < adapter.rowCount(); i++) index.set(adapter.text(i, 'id'), i);
  let room = Math.max(0, MAX_TAG_ROWS - adapter.rowCount());
  const edits: ProjectEdit[] = [];

  parsed.rows.slice(1).forEach((cells, k) => {
    const line = k + 2;
    const id = (cells[idAt] ?? '').trim();
    const row: CsvImportRow = { line, id, action: 'same', cells: [], errors: [] };
    plan.rows.push(row);
    if (cells.every((c) => c.trim() === '')) {
      plan.rows.pop();
      return;
    }
    if ((seen.get(id) ?? 0) > 1) {
      row.action = 'error';
      row.errors.push({ col: null, reason: 'tt.csv.dupInFile' });
      return;
    }
    const existing = index.get(id);
    if (existing === undefined && room <= 0) {
      row.action = 'dropped';
      row.errors.push({ col: null, reason: 'tt.csv.dropped' });
      return;
    }
    const changes: CellChange[] = [];
    const bad: CsvRowError[] = [];
    plan.headers.forEach((h, j) => {
      if (!h.col) return;
      const col = cols.find((c) => c.key === h.col)!;
      let value = cells[j] ?? '';
      if (col.kind === 'number') {
        const n = parseNumber(value, opts.decimal);
        if (!n.ok) {
          bad.push({
            col: h.col,
            reason: n.reason === 'ambiguous' ? 'gx.cell.ambiguousNumber' : 'gx.cell.invalidNumber',
          });
          return;
        }
        value = n.text;
      }
      if (existing !== undefined) {
        if (h.col === 'id' || adapter.text(existing, h.col) === value) return;
        changes.push({ row: existing, col: h.col, text: value });
      } else if (h.col === 'id' || value !== '')
        changes.push({ row: null, newIndex: 0, col: h.col, text: value });
    });
    if (bad.length) {
      row.action = 'error';
      row.errors.push(...bad);
      return;
    }
    if (existing !== undefined && !changes.length) {
      row.action = 'same';
      return;
    }
    const res = adapter.apply(changes);
    if (res.rejected.length) {
      row.action = 'error';
      row.errors.push(...res.rejected.map((r) => ({ col: r.col, reason: r.reason })));
      return;
    }
    row.cells = changes.filter((c) => c.col !== 'id').map((c) => c.col);
    row.action = existing === undefined ? 'add' : 'update';
    if (existing === undefined) {
      room--;
      // Dòng mới sau này không được trùng tên với dòng mới đã nhận (đã loại ở bước tên trùng trong file).
    }
    edits.push(...res.edits);
  });

  for (const r of plan.rows) plan.counts[r.action]++;
  plan.edits = batchOf(edits);
  return plan;
}

/** Xuất mọi Tag: một dòng tiêu đề (nhãn tiếng Việt) rồi từng Tag; bỏ cột chỉ đọc. */
export function tagsToCsv(table: TagTable, decimal: '.' | ','): string {
  const adapter = table.full();
  const cols = writable(adapter);
  const rows: string[][] = [cols.map((c) => c.label)];
  for (let i = 0; i < adapter.rowCount(); i++) rows.push(cols.map((c) => adapter.text(i, c.key)));
  return toCsv(rows, { decimal });
}
