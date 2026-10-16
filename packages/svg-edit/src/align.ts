// Căn chỉnh, phân bố, cùng cỡ (contracts/svg-editor.md §5; FR-104): hàm thuần trên hộp bao trong hệ tài liệu trả độ
// dịch/tỉ lệ; bản trên tài liệu quy kết quả về hệ của cha qua `transformNodes` (bake khi chính xác).
import { transformNodes, topLevel } from './bake.ts';
import { bbox, unionBoxes } from './bbox.ts';
import { Batch, type Command } from './command.ts';
import { scaleM, translateM } from './matrix.ts';
import type { Box, DrawDoc, NodeId } from './node.ts';

export type AlignMode = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom';

export interface BoxItem {
  id: NodeId;
  box: Box;
}

/** Độ dịch để căn theo hộp chung (`selection`) hoặc theo phần tử đầu (`first`, giữ Alt). */
export function alignBoxes(
  items: readonly BoxItem[],
  mode: AlignMode,
  reference: 'selection' | 'first' = 'selection',
): Array<{ id: NodeId; dx: number; dy: number }> {
  if (items.length === 0) return [];
  const ref = reference === 'first' ? items[0].box : unionBoxes(items.map((i) => i.box))!;
  return items.map(({ id, box: b }) => {
    let dx = 0;
    let dy = 0;
    switch (mode) {
      case 'left': dx = ref.x - b.x; break; // prettier-ignore
      case 'right': dx = ref.x + ref.width - (b.x + b.width); break; // prettier-ignore
      case 'centerH': dx = ref.x + ref.width / 2 - (b.x + b.width / 2); break; // prettier-ignore
      case 'top': dy = ref.y - b.y; break; // prettier-ignore
      case 'bottom': dy = ref.y + ref.height - (b.y + b.height); break; // prettier-ignore
      case 'centerV': dy = ref.y + ref.height / 2 - (b.y + b.height / 2); break; // prettier-ignore
    }
    return { id, dx: dx + 0, dy: dy + 0 };
  });
}

/** Phân bố đều khoảng trống ngang (`h`) hoặc dọc (`v`); hai phần tử ngoài cùng giữ chỗ; cần ≥ 3 phần tử. */
export function distribute(
  items: readonly BoxItem[],
  axis: 'h' | 'v',
): Array<{ id: NodeId; dx: number; dy: number }> {
  if (items.length < 3) return [];
  const pos = (b: Box) => (axis === 'h' ? b.x : b.y);
  const size = (b: Box) => (axis === 'h' ? b.width : b.height);
  const sorted = [...items].sort((a, b) => pos(a.box) - pos(b.box) || a.id - b.id);
  const first = sorted[0].box;
  const last = sorted[sorted.length - 1].box;
  const span = pos(last) + size(last) - pos(first);
  const total = sorted.reduce((s, i) => s + size(i.box), 0);
  const gap = (span - total) / (sorted.length - 1);
  const out = new Map<NodeId, number>();
  let cur = pos(first);
  for (const it of sorted) {
    out.set(it.id, cur - pos(it.box));
    cur += size(it.box) + gap;
  }
  out.set(sorted[sorted.length - 1].id, 0);
  return items.map((i) => ({
    id: i.id,
    dx: axis === 'h' ? out.get(i.id)! + 0 : 0,
    dy: axis === 'v' ? out.get(i.id)! + 0 : 0,
  }));
}

/** Tỉ lệ để cùng rộng/cao với phần tử đầu (gốc co là góc trên trái của từng hộp). */
export function sameSize(
  items: readonly BoxItem[],
  dim: 'width' | 'height' | 'both',
): Array<{ id: NodeId; sx: number; sy: number; ox: number; oy: number }> {
  if (items.length === 0) return [];
  const ref = items[0].box;
  return items.map(({ id, box: b }) => ({
    id,
    sx: dim !== 'height' && b.width > 0 ? ref.width / b.width : 1,
    sy: dim !== 'width' && b.height > 0 ? ref.height / b.height : 1,
    ox: b.x,
    oy: b.y,
  }));
}

function boxItems(doc: DrawDoc, ids: readonly NodeId[]): BoxItem[] {
  const out: BoxItem[] = [];
  const keep = new Set(topLevel(doc, ids));
  for (const id of ids) {
    if (!keep.has(id)) continue;
    keep.delete(id);
    const b = bbox(doc, id);
    if (b) out.push({ id, box: b });
  }
  return out;
}

function deltasToBatch(
  doc: DrawDoc,
  ds: Array<{ id: NodeId; dx: number; dy: number }>,
  label: string,
): Batch {
  const cmds: Command[] = [];
  for (const d of ds)
    if (d.dx !== 0 || d.dy !== 0)
      cmds.push(...transformNodes(doc, [d.id], translateM(d.dx, d.dy)).batch.commands);
  return new Batch(cmds, { label });
}

export function alignNodes(
  doc: DrawDoc,
  ids: readonly NodeId[],
  mode: AlignMode,
  reference: 'selection' | 'first' = 'selection',
): Batch {
  return deltasToBatch(doc, alignBoxes(boxItems(doc, ids), mode, reference), 'Căn chỉnh');
}

export function distributeNodes(doc: DrawDoc, ids: readonly NodeId[], axis: 'h' | 'v'): Batch {
  return deltasToBatch(doc, distribute(boxItems(doc, ids), axis), 'Phân bố');
}

export function sameSizeNodes(
  doc: DrawDoc,
  ids: readonly NodeId[],
  dim: 'width' | 'height' | 'both',
): Batch {
  const cmds: Command[] = [];
  for (const s of sameSize(boxItems(doc, ids), dim))
    if (s.sx !== 1 || s.sy !== 1)
      cmds.push(...transformNodes(doc, [s.id], scaleM(s.sx, s.sy, s.ox, s.oy)).batch.commands);
  return new Batch(cmds, {
    label: dim === 'width' ? 'Cùng rộng' : dim === 'height' ? 'Cùng cao' : 'Cùng cỡ',
  });
}
