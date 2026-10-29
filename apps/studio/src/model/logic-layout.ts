// Vị trí khối của sơ đồ Logic (feature 015, spec D2): tệp phụ của Studio `<tên logic>.layout.json` cạnh logic.json. Không
// thuộc tập file project (projectFiles) nên không vào gói nạp xuống, runtime không đọc; thiếu hay hỏng thì sơ đồ tự sắp
// xếp. Khóa nút: id khối (chung không gian id của logic.json), `tag:<id>` (Tag đầu vào), `out:<id>` (Tag đích của luật).
// Hàm thuần, trả bản MỚI.

export const LAYOUT_GRID = 16;
/** Trần tọa độ (px): tệp viết tay có số lớn vẫn vẽ được. */
const LIMIT = 100_000;

export interface NodePos {
  x: number;
  y: number;
}

export interface LogicLayoutDoc {
  kind: 'mat-logic-layout';
  version: 1;
  nodes: Record<string, NodePos>;
  /** Feature 043: nhóm / khu vực của thẻ luật (id khối → tên nhóm), chỉ để xem trong Studio. */
  groups?: Record<string, string>;
}

export const emptyLayout = (): LogicLayoutDoc => ({
  kind: 'mat-logic-layout',
  version: 1,
  nodes: {},
});

/** `logic.json` → `logic.layout.json` (cùng thư mục). */
export function logicLayoutFile(logicFile: string): string {
  return `${logicFile.replace(/\.json$/i, '')}.layout.json`;
}

const clamp = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Đọc khoan dung: mục sai hình bị bỏ, không phải đối tượng thì layout rỗng. */
export function readLayout(v: unknown): LogicLayoutDoc {
  const out = emptyLayout();
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return out;
  const nodes = (v as { nodes?: unknown }).nodes;
  const okNodes = nodes !== null && typeof nodes === 'object' && !Array.isArray(nodes);
  for (const [k, p] of Object.entries(okNodes ? (nodes as Record<string, unknown>) : {})) {
    if (p === null || typeof p !== 'object') continue;
    const { x, y } = p as { x?: unknown; y?: unknown };
    if (isNum(x) && isNum(y)) out.nodes[k] = { x: clamp(x), y: clamp(y) };
  }
  const groups = (v as { groups?: unknown }).groups;
  if (groups !== null && typeof groups === 'object' && !Array.isArray(groups)) {
    const g: Record<string, string> = {};
    for (const [k, n] of Object.entries(groups as Record<string, unknown>))
      if (typeof n === 'string' && n.trim()) g[k] = n.trim().slice(0, 60);
    if (Object.keys(g).length) out.groups = g;
  }
  return out;
}

/** Làm tròn về lưới (`grid` 1: không làm tròn). */
export function snap(v: number, grid = LAYOUT_GRID): number {
  const r = Math.round(v / grid) * grid;
  return r === 0 ? 0 : r;
}

/** Đặt (hoặc bỏ khi `null`) vị trí nhiều nút. */
export function placeNodes(
  layout: LogicLayoutDoc,
  entries: Readonly<Record<string, NodePos | null>>,
): LogicLayoutDoc {
  const nodes = { ...layout.nodes };
  for (const [k, p] of Object.entries(entries)) {
    if (p === null) delete nodes[k];
    else nodes[k] = { x: clamp(Math.round(p.x)), y: clamp(Math.round(p.y)) };
  }
  return { ...layout, nodes };
}

/** Vị trí đi theo id mới (đổi id khối); không có thì trả nguyên bản. */
export function renameLayoutNode(layout: LogicLayoutDoc, from: string, to: string): LogicLayoutDoc {
  const p = layout.nodes[from];
  if (!p || from === to) return layout;
  const nodes: Record<string, NodePos> = {};
  for (const [k, v] of Object.entries(layout.nodes)) nodes[k === from ? to : k] = v;
  return { ...layout, nodes };
}

/** Chỉ giữ các nút còn trên sơ đồ. */
export function pruneLayout(layout: LogicLayoutDoc, keep: ReadonlySet<string>): LogicLayoutDoc {
  const nodes: Record<string, NodePos> = {};
  for (const [k, v] of Object.entries(layout.nodes)) if (keep.has(k)) nodes[k] = v;
  return { ...layout, nodes };
}

/** Đặt (tên rỗng: bỏ) nhóm của một thẻ luật (feature 043). */
export function setGroup(layout: LogicLayoutDoc, id: string, name: string): LogicLayoutDoc {
  const groups = { ...(layout.groups ?? {}) };
  const n = name.trim().slice(0, 60);
  if (n) groups[id] = n;
  else delete groups[id];
  const out: LogicLayoutDoc = { ...layout, groups };
  if (Object.keys(groups).length === 0) delete out.groups;
  return out;
}
