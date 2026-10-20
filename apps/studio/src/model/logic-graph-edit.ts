// Sửa logic.json từ sơ đồ khối (feature 015; spec D4). Nối dây là sửa biểu thức ADR-015: thay đúng đoạn nguồn (`Slot.span`,
// code point) bằng id Tag; bọc cổng từ palette sinh biểu thức tương đương (`(x) && true`, `(x) || false`, `!x`, `x > 0`);
// xóa dây bỏ toán hạng của AND/OR (còn một thì gộp), thay chân khác bằng hằng giữ chỗ, ô của khối thành rỗng hoặc null;
// dây hành động thêm/bỏ hành động khai báo (ghi PLC chỉ qua mục `writes`). Hàm thuần, trả tài liệu MỚI.
import { parseExpression } from '@mat/expression';
import type { LogicAction, LogicDoc, LogicScalar } from '@mat/project-schema';
import {
  addAction,
  allIds,
  blocksOf,
  defaultBlock,
  findBlock,
  outputFields,
  removeAction,
  updateBlock,
  ID_RE,
  KIND_KEY,
  type Block,
  type Edge,
  type LogicKind,
} from './logic-doc.ts';
import { inFieldsOf, type LogicGraph, type PortType, type Slot, type Wire } from './logic-graph.ts';

export type GateTool = 'and' | 'or' | 'not' | 'cmp';

const fieldText = (doc: LogicDoc, slot: Slot): string | null => {
  const v = findBlock(doc, slot.kind, slot.id)?.[slot.field];
  return typeof v === 'string' ? v : null;
};

/** Chữ hiện tại của chỗ sửa (cả ô hoặc đoạn); ô null/thiếu là ''. */
export function slotText(doc: LogicDoc, slot: Slot): string {
  const src = fieldText(doc, slot) ?? '';
  if (!slot.span) return src;
  return Array.from(src).slice(slot.span[0], slot.span[1]).join('');
}

/** Thay chỗ sửa bằng `text` (cả ô khi không có `span`). */
export function setSlot(doc: LogicDoc, slot: Slot, text: string): LogicDoc {
  if (!slot.span) return updateBlock(doc, slot.kind, slot.id, { [slot.field]: text });
  const cps = Array.from(fieldText(doc, slot) ?? '');
  const next = [...cps.slice(0, slot.span[0]), text, ...cps.slice(slot.span[1])].join('');
  return updateBlock(doc, slot.kind, slot.id, { [slot.field]: next });
}

/** Toán hạng cần ngoặc khi đứng cạnh toán tử (Tag, hằng, lời gọi hàm, ngoặc sẵn thì không). */
function par(x: string): string {
  const r = parseExpression(x);
  if ('error' in r) return `(${x})`;
  const t = r.root.t;
  return t === 'tag' || t === 'num' || t === 'bool' || t === 'str' || t === 'paren' || t === 'call'
    ? x
    : `(${x})`;
}

/** Bọc chỗ sửa bằng cổng của palette; trong đoạn của biểu thức lớn hơn thì kết quả nằm trong ngoặc. */
export function wrapSlot(doc: LogicDoc, slot: Slot, gate: GateTool): LogicDoc {
  const cur = slotText(doc, slot).trim();
  let out: string;
  switch (gate) {
    case 'and':
      out = `${cur ? par(cur) : 'false'} && true`;
      break;
    case 'or':
      out = `${cur ? par(cur) : 'false'} || false`;
      break;
    case 'not':
      out = `!${cur ? par(cur) : 'false'}`;
      break;
    case 'cmp':
      out = `${cur ? par(cur) : '0'} > 0`;
      break;
  }
  return setSlot(doc, slot, slot.span ? `(${out})` : out);
}

const placeholder = (t: PortType) => (t === 'bool' ? 'false' : '0');

/** Xóa một dây (spec D4). Dây không còn trên đồ thị thì trả nguyên tài liệu. */
export function removeWire(doc: LogicDoc, graph: LogicGraph, wire: Wire): LogicDoc {
  if (wire.kind === 'action' && wire.action)
    return removeAction(doc, wire.action.rule, wire.action.edge, wire.action.index);
  const to = graph.byKey.get(wire.to.node);
  const port = to?.ports.find((p) => p.key === wire.to.port);
  const slot = port?.slot;
  if (!to || !port || !slot) return doc;
  if (to.type === 'block' && !slot.span) {
    const optional = inFieldsOf(slot.kind).find((f) => f[0] === slot.field)?.[2] ?? false;
    return updateBlock(doc, slot.kind, slot.id, { [slot.field]: optional ? null : '' });
  }
  if ((to.gate === 'and' || to.gate === 'or') && to.slot?.span) {
    const pins = to.ports.filter((p) => p.side === 'in' && p.slot?.span);
    const rest = pins.filter((p) => p.key !== port.key);
    const cps = Array.from(fieldText(doc, slot) ?? '');
    const text = (p: (typeof pins)[number]) =>
      cps.slice(p.slot!.span![0], p.slot!.span![1]).join('');
    const joined = rest.map(text).join(to.gate === 'and' ? ' && ' : ' || ');
    return setSlot(doc, to.slot, joined);
  }
  return setSlot(doc, slot, placeholder(port.type));
}

/** Kéo từ ↑/↓ của luật tới mục Ghi PLC (write, giá trị cho phép đầu tiên) hoặc tới Tag (setTag true). */
export function connectAction(
  doc: LogicDoc,
  ruleId: string,
  edge: Edge,
  target: { writes: string } | { tag: string },
): LogicDoc {
  let action: LogicAction;
  if ('writes' in target) {
    const w = findBlock(doc, 'writes', target.writes) as
      (Block & { allowed?: { values?: LogicScalar[]; min?: number } }) | null;
    const value: LogicScalar = w?.allowed?.values?.[0] ?? w?.allowed?.min ?? true;
    action = { do: 'write', write: target.writes, value };
  } else action = { do: 'setTag', tag: target.tag, value: true };
  return addAction(doc, ruleId, edge, action);
}

/** Nhân bản khối (Ctrl+D): id `<id>_<n>` chưa dùng, ngay sau khối gốc, đầu ra Tag theo id mới. */
export function duplicateBlock(
  doc: LogicDoc,
  kind: LogicKind,
  id: string,
): { doc: LogicDoc; id: string } {
  const src = findBlock(doc, kind, id);
  if (!src) return { doc, id };
  const used = allIds(doc);
  const base = id.replace(/_\d+$/, '').slice(0, 40);
  let n = 2;
  let nid = `${base}_${n}`;
  while (used.has(nid) || !ID_RE.test(nid)) nid = `${base}_${++n}`;
  const copy = JSON.parse(JSON.stringify(src)) as Block;
  copy.id = nid;
  const fresh = defaultBlock(kind, nid);
  for (const f of outputFields(kind)) if (typeof copy[f] === 'string') copy[f] = fresh[f];
  const list = blocksOf(doc, kind).map((b) => JSON.parse(JSON.stringify(b)) as Block);
  list.splice(list.findIndex((b) => b.id === id) + 1, 0, copy);
  const next = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
  next[KIND_KEY[kind]] = list;
  return { doc: next as unknown as LogicDoc, id: nid };
}
