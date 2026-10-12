// Sao chép và dán dạng TSV (như Excel) trên lưới (feature 006, FR-045, FR-046; US1-11, US1-12). Hàm thuần.
import { fold } from '../../i18n/index.ts';
import type { ProjectEdit } from '../project-doc.ts';
import { parseDelimited } from './csv.ts';
import type { GridNotice } from './ime.ts';
import { buildView, cellsOf, selectionRect, type GridState } from './selection.ts';
import type { CellChange, GridAdapter, Rejected } from './types.ts';

/** Văn bản dạng TSV của vùng chọn: ô có tab, xuống dòng hay nháy kép được bọc nháy kép như Excel. */
export function copyText(a: GridAdapter, s: GridState): string {
  const view = buildView(a, s);
  const rect = selectionRect(view, s);
  if (!rect) return '';
  const lines: string[] = [];
  for (let r = rect.r0; r <= rect.r1; r++) {
    const cells: string[] = [];
    for (let c = rect.c0; c <= rect.c1; c++) {
      const text = a.text(view.rows[r], view.cols[c]);
      cells.push(/["\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\r\n');
}

/** Đọc văn bản TSV (clipboard); dòng rỗng ở cuối bị bỏ. */
export function parseTsv(text: string): string[][] {
  return parseDelimited(text, '\t');
}

export type NumberReading =
  { ok: true; text: string } | { ok: false; reason: 'ambiguous' | 'invalid' };

const PLAIN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const GROUP_OF_THREE = /^[+-]?\d{1,3}[.,]\d{3}$/;

/**
 * Số đọc theo dấu thập phân đã chọn (`.` hoặc `,`), chuẩn hóa thành chữ với dấu chấm. Một nhóm đúng 3 chữ số sau dấu
 * phân cách (`1,000`, `1.000`) là mơ hồ (có thể là hàng nghìn); dấu khác dấu đã chọn là không hợp lệ.
 */
export function parseNumber(raw: string, decimal: '.' | ','): NumberReading {
  const text = raw.trim();
  if (text === '') return { ok: true, text: '' };
  if (GROUP_OF_THREE.test(text)) return { ok: false, reason: 'ambiguous' };
  const normalized = decimal === ',' ? text.replace(',', '.') : text;
  if (decimal === ',' && text.includes('.')) return { ok: false, reason: 'invalid' };
  if (!PLAIN.test(normalized)) return { ok: false, reason: 'invalid' };
  return { ok: true, text: normalized };
}

export interface PasteOptions {
  /** Dấu thập phân của số trong văn bản dán. Mặc định `.`. */
  decimal?: '.' | ',';
}

export interface PasteResult {
  state: GridState;
  edits: ProjectEdit[];
  /** Ô sai (số mơ hồ, chữ không phải số, adapter từ chối): lưới đánh dấu lỗi tại ô; phần còn lại vẫn dán. */
  rejected: Rejected[];
  /** Số cột thừa của văn bản dán (vượt các cột của bảng) bị bỏ. */
  droppedCols: number;
  /** Số dòng vượt giới hạn của bảng bị bỏ. */
  droppedRows: number;
  /** Dòng đầu là tiêu đề cột nên đã bỏ qua. */
  skippedHeader: boolean;
  notice?: GridNotice;
}

const NUMBER_REASON = {
  ambiguous: 'gx.cell.ambiguousNumber',
  invalid: 'gx.cell.invalidNumber',
} as const;

/**
 * Dán từ ô đang chọn: dòng theo các dòng đang hiện, cột theo các cột của bảng (cột chỉ đọc chiếm chỗ nhưng bỏ qua);
 * quá dòng cuối thì tạo dòng mới (tới giới hạn của bảng). Một ô dán vào vùng nhiều ô thì điền cả vùng. Dòng đầu khớp
 * tên cột thì bỏ qua.
 */
export function paste(
  a: GridAdapter,
  s: GridState,
  text: string,
  opts: PasteOptions = {},
): PasteResult {
  const decimal = opts.decimal ?? '.';
  const empty: PasteResult = {
    state: s,
    edits: [],
    rejected: [],
    droppedCols: 0,
    droppedRows: 0,
    skippedHeader: false,
  };
  let lines = parseDelimited(text, '\t');
  const view = buildView(a, s);
  const rect = selectionRect(view, s);
  if (!lines.length || !rect) return empty;
  // Dán từ góc trên trái của vùng chọn.
  const start = { r: rect.r0, c: rect.c0 };
  const cols = a.columns;
  const c0 = rect.c0;

  // Một ô dán vào vùng nhiều ô: điền cả vùng.
  if (lines.length === 1 && lines[0].length === 1 && (rect.r0 !== rect.r1 || rect.c0 !== rect.c1)) {
    const changes: CellChange[] = [];
    const rejected: Rejected[] = [];
    for (const p of cellsOf(view, rect)) {
      const col = cols.find((c) => c.key === p.col);
      if (!col || col.kind === 'readonly' || col.kind === 'live' || !a.editable(p.row, p.col))
        continue;
      const v = prepare(col.kind, lines[0][0], decimal);
      if (!v.ok)
        rejected.push({
          row: p.row,
          col: p.col,
          text: lines[0][0],
          reason: NUMBER_REASON[v.reason],
        });
      else if (v.text !== a.text(p.row, p.col))
        changes.push({ row: p.row, col: p.col, text: v.text });
    }
    const res = changes.length ? a.apply(changes) : { edits: [], rejected: [] };
    return { ...empty, edits: res.edits, rejected: [...rejected, ...res.rejected] };
  }

  // Dòng đầu là tiêu đề cột?
  const headers = cols.slice(c0).map((c) => fold(c.csv ?? c.label));
  const labels = cols.slice(c0).map((c) => fold(c.label));
  let skippedHeader = false;
  if (
    lines.length > 1 &&
    lines[0].every((cell, j) => {
      const f = fold(cell.trim());
      return f !== '' && (f === headers[j] || f === labels[j]);
    })
  ) {
    lines = lines.slice(1);
    skippedHeader = true;
  }

  const rowCount = a.rowCount();
  const capacity = Math.max(0, a.maxRows - rowCount);
  const changes: CellChange[] = [];
  const rejected: Rejected[] = [];
  let droppedCols = 0;
  let droppedRows = 0;
  let newCount = 0;
  lines.forEach((cells, i) => {
    const pos = start.r + i;
    let row: number | null = null;
    let newIndex: number | undefined;
    if (pos < view.rows.length) row = view.rows[pos];
    else if (newCount < capacity) newIndex = newCount++;
    else {
      droppedRows++;
      return;
    }
    droppedCols = Math.max(droppedCols, cells.length - (cols.length - c0));
    cells.forEach((raw, j) => {
      const col = cols[c0 + j];
      if (!col || col.kind === 'readonly' || col.kind === 'live') return;
      if (row !== null && !a.editable(row, col.key)) return;
      const v = prepare(col.kind, raw, decimal);
      if (!v.ok) {
        rejected.push({ row, newIndex, col: col.key, text: raw, reason: NUMBER_REASON[v.reason] });
        return;
      }
      if (row !== null && a.text(row, col.key) === v.text) return;
      changes.push({ row, newIndex, col: col.key, text: v.text });
    });
  });
  droppedCols = Math.max(0, droppedCols);
  const res = changes.length
    ? a.apply(changes)
    : { edits: [] as ProjectEdit[], rejected: [] as Rejected[] };
  const all = [...rejected, ...res.rejected];
  return {
    state: s,
    edits: res.edits,
    rejected: all,
    droppedCols,
    droppedRows,
    skippedHeader,
    ...(all.length
      ? { notice: { key: 'gx.notice.rejected' as const, params: { count: all.length } } }
      : {}),
  };
}

function prepare(kind: string, raw: string, decimal: '.' | ','): NumberReading {
  return kind === 'number' ? parseNumber(raw, decimal) : { ok: true, text: raw };
}
