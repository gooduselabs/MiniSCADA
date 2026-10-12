// Điền xuống (Ctrl+D) và kéo điền (feature 006, FR-045, studio-ux §5): tên tăng số (`TANK_01` → `TANK_02`), ô khác chép
// nguyên, cột có hàm tăng riêng do adapter cấp (địa chỉ tăng theo số thanh ghi của kiểu). Hàm thuần.
import { nextTagId } from '../tag-ids.ts';
import type { ProjectEdit } from '../project-doc.ts';
import { outcome, type GridOutcome } from './ime.ts';
import { buildView, posIn, selectionRect, type GridState } from './selection.ts';
import type { CellChange, GridAdapter } from './types.ts';

/** Tên sau `steps` lần tăng số (giữ số chữ số). Tên trống thì `TAG_1`. */
export function incrementName(text: string, steps = 1): string {
  let name = text;
  for (let i = 0; i < steps; i++) name = nextTagId(name);
  return name;
}

const isEditable = (a: GridAdapter, row: number, col: string): boolean => {
  const c = a.columns.find((x) => x.key === col);
  return !!c && c.kind !== 'readonly' && c.kind !== 'live' && a.editable(row, col);
};

/** Chữ điền cho ô: hàm của adapter, hoặc tăng số (cột tên), hoặc chép nguyên. */
function filled(
  a: GridAdapter,
  row: number,
  col: string,
  source: string,
  steps: number,
  taken: Set<string>,
): string {
  const custom = a.fillNext?.(row, col, source, steps);
  if (custom !== undefined) return custom;
  const column = a.columns.find((c) => c.key === col);
  if (!column?.name) return source;
  // Cột tên: tăng số, không trùng tên đã có.
  let name = incrementName(source, steps);
  while (taken.has(name)) name = incrementName(name);
  taken.add(name);
  return name;
}

function result(
  a: GridAdapter,
  s: GridState,
  changes: CellChange[],
  readonlyOnly: boolean,
): GridOutcome {
  if (!changes.length)
    return outcome(s, readonlyOnly ? { notice: { key: 'gx.notice.readonly' } } : {});
  const res = a.apply(changes);
  return outcome(s, {
    edits: res.edits as ProjectEdit[],
    ...(res.rejected.length
      ? {
          rejected: res.rejected,
          notice: { key: 'gx.notice.rejected' as const, params: { count: res.rejected.length } },
        }
      : {}),
  });
}

/**
 * Điền xuống: một ô thì chép ô phía trên (dòng đang hiện); vùng nhiều dòng thì dòng đầu của vùng là nguồn cho các
 * dòng còn lại. Dòng đầu (kể cả dòng đầu đang hiện khi lọc) thì không làm gì.
 */
export function fillDown(a: GridAdapter, s: GridState): GridOutcome {
  const view = buildView(a, s);
  const rect = selectionRect(view, s);
  if (!rect) return outcome(s, { handled: false });
  const single = rect.r0 === rect.r1;
  const srcPos = single ? rect.r0 - 1 : rect.r0;
  if (srcPos < 0) return outcome(s);
  const lastPos = rect.r1;
  const firstTarget = single ? rect.r0 : rect.r0 + 1;
  // Tên của các dòng không bị điền: để không sinh tên trùng.
  const filling = new Set<number>();
  for (let r = firstTarget; r <= lastPos; r++) filling.add(view.rows[r]);
  const changes: CellChange[] = [];
  let anyEditable = false;
  const takenByCol = new Map<string, Set<string>>();
  for (let c = rect.c0; c <= rect.c1; c++) {
    const col = view.cols[c];
    const taken = new Set<string>();
    if (a.columns.find((x) => x.key === col)?.name)
      for (let r = 0; r < a.rowCount(); r++) if (!filling.has(r)) taken.add(a.text(r, col));
    takenByCol.set(col, taken);
  }
  // Theo dòng rồi theo cột: mỗi dòng đổi gọn thành một cụm sửa đổi.
  for (let r = firstTarget; r <= lastPos; r++) {
    const row = view.rows[r];
    for (let c = rect.c0; c <= rect.c1; c++) {
      const col = view.cols[c];
      if (!isEditable(a, row, col)) continue;
      anyEditable = true;
      const source = a.text(view.rows[srcPos], col);
      const text = filled(a, row, col, source, r - srcPos, takenByCol.get(col)!);
      if (text !== a.text(row, col)) changes.push({ row, col, text });
    }
  }
  return result(a, s, changes, !anyEditable);
}

/**
 * Kéo điền: kéo núm ở góc vùng chọn xuống dòng `toRow` (dòng gốc). Nguồn nhiều dòng thì lặp theo chu kỳ; cột tên tăng
 * tiếp từ dòng cuối của nguồn. Vùng chọn mới gồm cả phần vừa điền.
 */
export function dragFill(a: GridAdapter, s: GridState, toRow: number): GridOutcome {
  const view = buildView(a, s);
  const rect = selectionRect(view, s);
  const target = posIn(view, { row: toRow, col: view.cols[0] });
  if (!rect || !target || target.r <= rect.r1) return outcome(s);
  const n = rect.r1 - rect.r0 + 1;
  const changes: CellChange[] = [];
  let anyEditable = false;
  for (let c = rect.c0; c <= rect.c1; c++) {
    const col = view.cols[c];
    const column = a.columns.find((x) => x.key === col);
    for (let q = rect.r1 + 1; q <= target.r; q++) {
      const row = view.rows[q];
      if (!isEditable(a, row, col)) continue;
      anyEditable = true;
      const steps = q - rect.r1;
      const lastSource = a.text(view.rows[rect.r1], col);
      let text: string;
      const custom = a.fillNext?.(row, col, lastSource, steps);
      if (custom !== undefined) text = custom;
      else if (column?.name) text = incrementName(lastSource, steps);
      else text = a.text(view.rows[rect.r0 + ((q - rect.r1 - 1) % n)], col);
      if (text !== a.text(row, col)) changes.push({ row, col, text });
    }
  }
  // Vùng chọn mới: từ góc trên trái của nguồn tới dòng vừa kéo tới (cột cuối của nguồn).
  const anchor = { row: view.rows[rect.r0], col: view.cols[rect.c0] };
  const cell = { row: view.rows[target.r], col: view.cols[rect.c1] };
  const r = result(a, s, changes, !anyEditable);
  return { ...r, state: { ...r.state, anchor, cell } };
}
