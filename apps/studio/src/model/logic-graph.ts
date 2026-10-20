// Đồ thị của sơ đồ khối Logic (feature 015; spec D1, D3, D5): hàm thuần của logic.json + Tag + vị trí (logic-layout.ts),
// không DOM, không chuỗi giao diện. Nút: khối (7 nhóm), Tag đầu vào (`tag:<id>`), Tag đích của setTag/toggle (`out:<id>`),
// cổng suy ra từ cây cú pháp của biểu thức (AND, OR, NOT, so sánh, "Biểu thức"; `g:<khối>:<ô>:<n>`, đi theo khối, không lưu
// vị trí). Cổng vào mang `slot` (khối, ô, đoạn nguồn) để nối dây là sửa đúng đoạn đó. Lỗi lấy từ validator (khóa `id|ô` của
// cellMarks), không luật kiểm riêng. Sắp xếp tự động: cột theo hạng phụ thuộc (Tag 0, khối 1 + hạng nguồn, Ghi PLC/Tag đích
// sau luật), trong cột theo trọng tâm nguồn.
import { parseExpression, type ExprNode, type TagDataType } from '@mat/expression';
import { logicOutputs, type LogicAction, type LogicDoc, type TagV1 } from '@mat/project-schema';
import { LOGIC_KINDS, blocksOf, type LogicKind } from './logic-doc.ts';
import { LAYOUT_GRID, type LogicLayoutDoc, type NodePos } from './logic-layout.ts';

// ---------- Kích thước (px, hệ tọa độ của sơ đồ) ----------
export const GEOM = {
  blockW: 248,
  head: 36,
  row: 30,
  foot: 30,
  tagW: 200,
  tagH: 36,
  /** Toán hạng Tag gắn vào chân (hộp tên Tag, chữ mono 12 px). */
  opH: 26,
  gateHead: 24,
  gateRow: 28,
  gapX: 36,
  gapY: 10,
  colGap: 68,
  rowGap: 28,
  margin: 32,
} as const;
/** Tỉ lệ rộng : cao mà sắp xếp tự động nhắm tới (gập cột cao thành cột phụ). */
const ASPECT = 2.4;
/** Độ sâu tối đa của cây cổng; sâu hơn gói thành nút "Biểu thức". */
const MAX_DEPTH = 4;

export type PortType = 'bool' | 'num' | 'any';
export type Mark = 'e' | 'w';

/** Chỗ sửa của một cổng vào: ô biểu thức của khối, `span` là đoạn [đầu, cuối) theo code point (thiếu: cả ô). */
export interface Slot {
  kind: LogicKind;
  id: string;
  field: string;
  span?: [number, number];
}

export interface GPort {
  key: string;
  side: 'in' | 'out';
  /** Nhãn ngắn (tên trường JSON, ↑ ↓, id Tag của chân Biểu thức). */
  label: string;
  type: PortType;
  /** Vị trí neo so với góc trên trái của nút. */
  dx: number;
  dy: number;
  /** Cổng ra: Tag mang giá trị. */
  tag?: string;
  /** Cổng vào: chỗ sửa khi nối dây. */
  slot?: Slot;
  /** Cổng vào không có dây: chữ hiện cạnh cổng (hằng, ô rỗng '', biểu thức hỏng). */
  text?: string;
  broken?: boolean;
  optional?: boolean;
  mark?: Mark;
}

export type GateKind = 'and' | 'or' | 'not' | 'cmp' | 'expr';

export interface GNode {
  key: string;
  type: 'block' | 'tag' | 'out' | 'gate';
  kind?: LogicKind;
  /** Id khối hoặc id Tag. */
  id?: string;
  /** Cổng suy ra: id khối chủ. */
  owner?: string;
  gate?: GateKind;
  /** Cổng: chữ trên đầu (AND, OR, NOT, "> 80", ">="); Biểu thức: "f(x)". */
  title?: string;
  /** Biểu thức: đoạn nguồn (để hiện); cổng: đoạn nguồn của cả cổng (để tính giá trị sống). */
  text?: string;
  /** Cổng suy ra: chỗ sửa của cả cổng (bọc, chọn ô ở Inspector). */
  slot?: Slot;
  /** Tag: kiểu dữ liệu; không có trong project và không phải Tag logic thì `missing`. */
  tagType?: TagDataType;
  missing?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  ports: GPort[];
  /** Kéo được (khối, Tag, Tag đích); cổng suy ra đi theo khối. */
  movable: boolean;
  mark?: Mark;
}

export interface WireEnd {
  node: string;
  port: string;
}

export interface Wire {
  key: string;
  from: WireEnd;
  to: WireEnd;
  kind: 'data' | 'action';
  type: PortType;
  /** Dây dữ liệu: Tag mang giá trị (từ nút Tag hoặc cổng ra của khối). */
  tag?: string;
  /** Dây hành động: hành động thứ `index` của `onRise`/`onFall`. */
  action?: { rule: string; edge: 'onRise' | 'onFall'; index: number };
  mark?: Mark;
}

export interface LogicGraph {
  nodes: GNode[];
  wires: Wire[];
  byKey: Map<string, GNode>;
  /** Khung bao mọi nút. */
  bounds: { x: number; y: number; w: number; h: number };
}

export interface GraphInput {
  tags: readonly TagV1[];
  layout: LogicLayoutDoc;
  /** Lỗi/cảnh báo theo `id|ô` (cellMarks của editor). */
  marks?: ReadonlyMap<string, Mark>;
}

// ---------- Mô tả cổng của từng nhóm ----------
type FieldSpec = readonly [field: string, type: PortType, optional: boolean];
const IN_FIELDS: Readonly<Record<LogicKind, readonly FieldSpec[]>> = {
  rule: [['when', 'bool', false]],
  timer: [['in', 'bool', false]],
  counter: [
    ['up', 'bool', false],
    ['down', 'bool', true],
    ['reset', 'bool', true],
  ],
  totalizer: [
    ['source', 'num', false],
    ['reset', 'bool', true],
  ],
  runhours: [
    ['run', 'bool', false],
    ['reset', 'bool', true],
  ],
  schedule: [],
  writes: [],
};
const OUT_FIELDS: Readonly<Record<LogicKind, readonly (readonly [string, PortType])[]>> = {
  rule: [],
  timer: [
    ['q', 'bool'],
    ['et', 'num'],
  ],
  counter: [
    ['value', 'num'],
    ['reached', 'bool'],
  ],
  totalizer: [
    ['total', 'num'],
    ['gapSeconds', 'num'],
  ],
  runhours: [
    ['hours', 'num'],
    ['starts', 'num'],
    ['due', 'bool'],
  ],
  schedule: [['out', 'bool']],
  writes: [],
};

export const inFieldsOf = (k: LogicKind): readonly FieldSpec[] => IN_FIELDS[k];

export const portTypeOf = (t: TagDataType | undefined): PortType =>
  t === undefined || t === 'STRING' ? 'any' : t === 'BOOL' ? 'bool' : 'num';

const FLIP: Readonly<Record<string, string>> = {
  '<': '>',
  '>': '<',
  '<=': '>=',
  '>=': '<=',
  '==': '==',
  '!=': '!=',
};
const CMP_OPS = new Set(Object.keys(FLIP));

// ---------- Cây cú pháp → cổng ----------
type Operand = { s: number; e: number } & (
  { k: 'tag'; id: string } | { k: 'const'; text: string } | { k: 'gate'; g: GateSpec }
);
interface GateSpec {
  gate: GateKind;
  title: string;
  s: number;
  e: number;
  pins: Operand[];
  pinType: PortType;
}

const strip = (n: ExprNode): ExprNode => (n.t === 'paren' ? strip(n.x) : n);

function isConst(n: ExprNode): boolean {
  const x = strip(n);
  if (x.t === 'num' || x.t === 'bool' || x.t === 'str') return true;
  return x.t === 'un' && x.op === '-' && strip(x.x).t === 'num';
}

function children(n: ExprNode): ExprNode[] {
  switch (n.t) {
    case 'paren':
    case 'un':
      return [n.x];
    case 'bin':
      return [n.l, n.r];
    case 'cond':
      return [n.c, n.a, n.b];
    case 'call':
      return n.args;
    default:
      return [];
  }
}

/** Tag trong cây (lần xuất hiện đầu, theo vị trí nguồn). */
function tagsIn(root: ExprNode): Array<{ id: string; s: number; e: number }> {
  const out: Array<{ id: string; s: number; e: number }> = [];
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.t === 'tag') {
      if (!seen.has(n.id)) {
        seen.add(n.id);
        out.push({ id: n.id, s: n.s, e: n.e });
      }
      continue;
    }
    const ch = children(n);
    for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]!);
  }
  return out.sort((a, b) => a.s - b.s);
}

function operandOf(n: ExprNode, cps: readonly string[], depth: number): Operand {
  const x = strip(n);
  const span = { s: n.s, e: n.e };
  if (x.t === 'tag') return { ...span, k: 'tag', id: x.id };
  if (isConst(x)) return { ...span, k: 'const', text: cps.slice(x.s, x.e).join('') };
  return { ...span, k: 'gate', g: gateOf(x, cps, depth) };
}

function gateOf(x: ExprNode, cps: readonly string[], depth: number): GateSpec {
  const base = { s: x.s, e: x.e };
  if (depth < MAX_DEPTH) {
    if (x.t === 'bin' && (x.op === '&&' || x.op === '||')) {
      const list: ExprNode[] = [];
      let cur: ExprNode = x;
      while (cur.t === 'bin' && cur.op === x.op) {
        list.unshift(cur.r);
        cur = cur.l;
      }
      list.unshift(cur);
      return {
        ...base,
        gate: x.op === '&&' ? 'and' : 'or',
        title: x.op === '&&' ? 'AND' : 'OR',
        pinType: 'bool',
        pins: list.map((c) => operandOf(c, cps, depth + 1)),
      };
    }
    if (x.t === 'un' && x.op === '!')
      return {
        ...base,
        gate: 'not',
        title: 'NOT',
        pinType: 'bool',
        pins: [operandOf(x.x, cps, depth + 1)],
      };
    if (x.t === 'bin' && CMP_OPS.has(x.op)) {
      const pinType: PortType = x.op === '==' || x.op === '!=' ? 'any' : 'num';
      const lc = isConst(x.l);
      const rc = isConst(x.r);
      if (rc && !lc)
        return {
          ...base,
          gate: 'cmp',
          title: `${x.op} ${cps.slice(strip(x.r).s, strip(x.r).e).join('')}`,
          pinType,
          pins: [operandOf(x.l, cps, depth + 1)],
        };
      if (lc && !rc)
        return {
          ...base,
          gate: 'cmp',
          title: `${FLIP[x.op]} ${cps.slice(strip(x.l).s, strip(x.l).e).join('')}`,
          pinType,
          pins: [operandOf(x.r, cps, depth + 1)],
        };
      return {
        ...base,
        gate: 'cmp',
        title: x.op,
        pinType,
        pins: [operandOf(x.l, cps, depth + 1), operandOf(x.r, cps, depth + 1)],
      };
    }
  }
  return {
    ...base,
    gate: 'expr',
    title: 'f(x)',
    pinType: 'any',
    pins: tagsIn(x).map((t) => ({ s: t.s, e: t.e, k: 'tag', id: t.id })),
  };
}

// ---------- Kích thước nút ----------
const gateWidth = (g: GateSpec, text: string): number =>
  g.gate === 'expr'
    ? Math.max(
        150,
        Math.min(
          280,
          28 + Math.max(text.length, ...g.pins.map((p) => (p.k === 'tag' ? p.id.length : 0))) * 7.4,
        ),
      )
    : Math.max(76, 34 + g.title.length * 8.4);
/** Bề rộng hộp toán hạng theo độ dài id Tag (chữ mono 12 px). */
const opWidth = (tag: string): number => Math.max(76, Math.min(260, 40 + tag.length * 7.4));
const gateHeight = (n: number) => Math.max(40, GEOM.gateHead + n * GEOM.gateRow + 6);

export function blockRows(kind: LogicKind): number {
  return Math.max(1, IN_FIELDS[kind].length, kind === 'rule' ? 2 : OUT_FIELDS[kind].length);
}
export const blockHeight = (kind: LogicKind): number =>
  GEOM.head + blockRows(kind) * GEOM.row + GEOM.foot;
const portY = (i: number) => GEOM.head + i * GEOM.row + GEOM.row / 2;

// ---------- Dựng ----------
interface Pending {
  /** Tag mang giá trị (dây từ toán hạng hoặc từ đầu ra khối). */
  tag?: string;
  to: WireEnd;
  type: PortType;
  /** Dây từ cổng ra `out` của một nút gắn (cổng suy ra, toán hạng Tag); thiếu: từ đầu ra khối sinh `tag`. */
  from?: string;
}

/** Cây cổng đã dựng (tọa độ tương đối), trước khi đặt. */
interface BuiltTree {
  node: GNode;
  w: number;
  h: number;
  /** Con theo thứ tự chân; `t` null: chỗ trống của chân nối dây từ khối khác (giữ cây con đúng hàng chân). */
  kids: Array<{ t: BuiltTree | null; h: number; pin: number }>;
}

interface TreeOut {
  /** Nút cổng, tọa độ tương đối so với góc khối. */
  nodes: GNode[];
  w: number;
  h: number;
}

const snapUp = (v: number) => Math.ceil(v / LAYOUT_GRID) * LAYOUT_GRID;
const snapNear = (v: number) => Math.round(v / LAYOUT_GRID) * LAYOUT_GRID;

export function buildLogicGraph(doc: LogicDoc, input: GraphInput): LogicGraph {
  const marks = input.marks ?? new Map<string, Mark>();
  const tagTypes = new Map<string, TagDataType>();
  for (const t of input.tags) if (!tagTypes.has(t.id)) tagTypes.set(t.id, t.type);
  const outputs = new Map<string, { block: string; field: string }>();
  for (const o of logicOutputs(doc)) {
    if (!outputs.has(o.tag)) outputs.set(o.tag, { block: o.block, field: o.field });
    if (!tagTypes.has(o.tag)) tagTypes.set(o.tag, o.type);
  }

  const nodes: GNode[] = [];
  const pend: Pending[] = [];
  const blockNodes: GNode[] = [];
  /** Cây cổng của mỗi khối (tọa độ tương đối) và bề rộng/chiều cao chiếm thêm. */
  const trees = new Map<string, { gates: GNode[]; left: number; top: number; bottom: number }>();
  const deps = new Map<string, Set<string>>();

  const markOf = (id: string, field: string): Mark | undefined => marks.get(`${id}|${field}`);
  const blockMark = (id: string): Mark | undefined => {
    let m: Mark | undefined;
    for (const [k, v] of marks) {
      if (k.slice(0, k.indexOf('|')) !== id) continue;
      if (v === 'e') return 'e';
      m = 'w';
    }
    return m;
  };

  for (const kind of LOGIC_KINDS) {
    for (const b of blocksOf(doc, kind)) {
      const id = b.id;
      if (typeof id !== 'string') continue;
      const ports: GPort[] = [];
      const gates: GNode[] = [];
      const dep = new Set<string>();
      deps.set(id, dep);
      const ins = IN_FIELDS[kind];
      const h = blockHeight(kind);
      const subtrees: Array<{ out: TreeOut; py: number }> = [];
      let gateN = 0;
      /** Tag là đầu ra của khối: dây từ khối đó (không toán hạng). Trả false khi Tag không phải đầu ra. */
      const want = (tag: string, to: WireEnd, type: PortType): boolean => {
        const src = outputs.get(tag);
        if (!src) return false;
        pend.push({ tag, to, type });
        if (src.block !== id) dep.add(src.block);
        return true;
      };

      ins.forEach(([field, type, optional], i) => {
        const raw = b[field];
        const slot: Slot = { kind, id, field };
        const port: GPort = {
          key: field,
          side: 'in',
          label: field,
          type,
          dx: 0,
          dy: portY(i),
          slot,
          ...(optional ? { optional: true } : {}),
        };
        const pm = markOf(id, field);
        if (pm) port.mark = pm;
        ports.push(port);
        if (typeof raw !== 'string') return;
        if (raw.trim() === '') {
          port.text = '';
          return;
        }
        const parsed = parseExpression(raw);
        if ('error' in parsed) {
          port.text = raw;
          port.broken = true;
          return;
        }
        const cps = Array.from(raw);
        const op = operandOf(parsed.root, cps, 0);
        if (op.k === 'const') {
          port.text = op.text;
          return;
        }
        /** Toán hạng Tag (FBD: hộp tên Tag gắn vào chân, đi theo khối). */
        const operand = (tag: string, span: [number, number] | undefined): BuiltTree => {
          const key = `t:${id}:${field}:${gateN++}`;
          const ty = tagTypes.get(tag);
          const w = opWidth(tag);
          const node: GNode = {
            key,
            type: 'tag',
            id: tag,
            owner: id,
            kind,
            slot: span ? { kind, id, field, span } : { kind, id, field },
            x: 0,
            y: 0,
            w,
            h: GEOM.opH,
            ports: [
              {
                key: 'out',
                side: 'out',
                label: '',
                type: portTypeOf(ty),
                dx: w,
                dy: GEOM.opH / 2,
                tag,
              },
            ],
            movable: false,
            ...(ty ? { tagType: ty } : { missing: true }),
            ...(pm ? { mark: pm } : {}),
          };
          return { node, w, h: GEOM.opH, kids: [] };
        };
        if (op.k === 'tag') {
          if (want(op.id, { node: id, port: field }, type)) return;
          const t = operand(op.id, undefined);
          pend.push({ tag: op.id, to: { node: id, port: field }, type, from: t.node.key });
          t.node.x = -GEOM.gapX - t.w;
          subtrees.push({ out: { nodes: [t.node], w: t.w, h: t.h }, py: portY(i) });
          return;
        }
        // cây cổng: dựng tương đối (gốc ở 0,0), đặt sau
        const build = (g: GateSpec, depth: number): BuiltTree => {
          const key = `g:${id}:${field}:${gateN++}`;
          const text = cps.slice(g.s, g.e).join('');
          const w = gateWidth(g, text);
          const gh = gateHeight(g.pins.length);
          const gnode: GNode = {
            key,
            type: 'gate',
            owner: id,
            kind,
            gate: g.gate,
            title: g.title,
            text,
            slot: { kind, id, field, span: [g.s, g.e] },
            x: 0,
            y: 0,
            w,
            h: gh,
            ports: [],
            movable: false,
            ...(pm ? { mark: pm } : {}),
          };
          const kids: BuiltTree['kids'] = [];
          g.pins.forEach((p, j) => {
            const pkey = `p${j}`;
            const pin: GPort = {
              key: pkey,
              side: 'in',
              label: g.gate === 'expr' && p.k === 'tag' ? p.id : '',
              type: g.pinType,
              dx: 0,
              dy: GEOM.gateHead + j * GEOM.gateRow + GEOM.gateRow / 2,
              slot: { kind, id, field, span: [p.s, p.e] },
            };
            if (pm) pin.mark = pm;
            gnode.ports.push(pin);
            if (p.k === 'tag') {
              if (want(p.id, { node: key, port: pkey }, g.pinType))
                kids.push({ t: null, h: GEOM.gateRow, pin: j });
              else {
                const t = operand(p.id, [p.s, p.e]);
                kids.push({ t, h: t.h, pin: j });
                pend.push({
                  tag: p.id,
                  to: { node: key, port: pkey },
                  type: g.pinType,
                  from: t.node.key,
                });
              }
            } else if (p.k === 'const') pin.text = p.text;
            else {
              const t = build(p.g, depth + 1);
              kids.push({ t, h: t.h, pin: j });
              pend.push({ to: { node: key, port: pkey }, type: g.pinType, from: t.node.key });
            }
          });
          gnode.ports.push({
            key: 'out',
            side: 'out',
            label: '',
            type: g.gate === 'expr' ? 'any' : 'bool',
            dx: w,
            dy: gh / 2,
          });
          const kidsH =
            kids.reduce((s, k) => s + k.h, 0) + Math.max(0, kids.length - 1) * GEOM.gapY;
          const kidsW = kids.reduce((m, k) => Math.max(m, k.t?.w ?? 0), 0);
          return {
            node: gnode,
            w: w + (kidsW ? GEOM.gapX + kidsW : 0),
            h: Math.max(gh, kidsH),
            kids,
          };
        };
        const tree = build(op.g, 0);
        // đặt cây: gốc có mép phải tại -gapX, trên cùng tại 0 (dời sau theo cổng vào)
        const placed: GNode[] = [];
        const place = (t: BuiltTree, right: number, top: number) => {
          t.node.x = right - t.node.w;
          t.node.y = top + (t.h - t.node.h) / 2;
          placed.push(t.node);
          let y =
            top +
            (t.h -
              (t.kids.reduce((s, k) => s + k.h, 0) + Math.max(0, t.kids.length - 1) * GEOM.gapY)) /
              2;
          for (const k of t.kids) {
            if (k.t) place(k.t, t.node.x - GEOM.gapX, y);
            y += k.h + GEOM.gapY;
          }
        };
        place(tree, -GEOM.gapX, 0);
        pend.push({ to: { node: id, port: field }, type, from: tree.node.key });
        subtrees.push({ out: { nodes: placed, w: tree.w, h: tree.h }, py: portY(i) });
      });

      // xếp các cây của khối theo chiều dọc, mỗi cây gần cổng vào của nó, không chồng nhau
      let cursor = -Infinity;
      let top = 0;
      let bottom = h;
      let left = 0;
      for (const st of subtrees) {
        const y0 = Math.max(cursor, st.py - st.out.h / 2);
        for (const g of st.out.nodes) {
          g.y += y0;
          gates.push(g);
        }
        cursor = y0 + st.out.h + GEOM.gapY;
        top = Math.min(top, y0);
        bottom = Math.max(bottom, y0 + st.out.h);
        left = Math.max(left, st.out.w + GEOM.gapX);
      }
      trees.set(id, { gates, left, top, bottom });

      if (kind === 'rule') {
        ports.push(
          {
            key: 'rise',
            side: 'out',
            label: '↑',
            type: 'any',
            dx: GEOM.blockW,
            dy: portY(0),
            ...(markOf(id, 'onRise') ? { mark: markOf(id, 'onRise')! } : {}),
          },
          {
            key: 'fall',
            side: 'out',
            label: '↓',
            type: 'any',
            dx: GEOM.blockW,
            dy: portY(1),
            ...(markOf(id, 'onFall') ? { mark: markOf(id, 'onFall')! } : {}),
          },
        );
      } else if (kind === 'writes') {
        ports.push({
          key: 'cmd',
          side: 'in',
          label: '',
          type: 'any',
          dx: 0,
          dy: portY(0),
          ...(markOf(id, 'tag') ? { mark: markOf(id, 'tag')! } : {}),
        });
      }
      OUT_FIELDS[kind].forEach(([field, type], i) => {
        const tag = b[field];
        if (typeof tag !== 'string') return;
        const p: GPort = {
          key: field,
          side: 'out',
          label: field,
          type,
          dx: GEOM.blockW,
          dy: portY(i),
          tag,
        };
        const pm = markOf(id, field);
        if (pm) p.mark = pm;
        ports.push(p);
      });
      const n: GNode = {
        key: id,
        type: 'block',
        kind,
        id,
        x: 0,
        y: 0,
        w: GEOM.blockW,
        h,
        ports,
        movable: true,
      };
      const bm = blockMark(id);
      if (bm) n.mark = bm;
      nodes.push(n);
      blockNodes.push(n);
    }
  }

  // ---------- Dây dữ liệu ----------
  const wires: Wire[] = [];
  let wn = 0;
  for (const p of pend) {
    if (p.from) {
      wires.push({
        key: `w${wn++}`,
        from: { node: p.from, port: 'out' },
        to: p.to,
        kind: 'data',
        type: p.tag ? portTypeOf(tagTypes.get(p.tag)) : p.type,
        ...(p.tag ? { tag: p.tag } : {}),
      });
      continue;
    }
    const src = p.tag ? outputs.get(p.tag) : undefined;
    if (!src || !p.tag) continue;
    wires.push({
      key: `w${wn++}`,
      from: { node: src.block, port: src.field },
      to: p.to,
      kind: 'data',
      type: portTypeOf(tagTypes.get(p.tag)),
      tag: p.tag,
    });
  }
  // ---------- Hành động của luật ----------
  const writesIds = new Set(blocksOf(doc, 'writes').map((w) => w.id));
  const outNodes = new Map<string, GNode>();
  const actionTargets = new Map<string, Set<string>>();
  for (const r of blocksOf(doc, 'rule')) {
    for (const edge of ['onRise', 'onFall'] as const) {
      const list = (r[edge] as LogicAction[] | undefined) ?? [];
      list.forEach((a, index) => {
        let target: string | null = null;
        let port = 'cmd';
        if (
          (a.do === 'write' || a.do === 'pulse') &&
          typeof a.write === 'string' &&
          writesIds.has(a.write)
        )
          target = a.write;
        else if (
          (a.do === 'setTag' || a.do === 'toggle') &&
          typeof a.tag === 'string' &&
          a.tag !== ''
        ) {
          target = `out:${a.tag}`;
          port = 'set';
          if (!outNodes.has(target)) {
            const ty = tagTypes.get(a.tag);
            outNodes.set(target, {
              key: target,
              type: 'out',
              id: a.tag,
              x: 0,
              y: 0,
              w: GEOM.tagW,
              h: GEOM.tagH,
              ports: [{ key: 'set', side: 'in', label: '', type: 'any', dx: 0, dy: GEOM.tagH / 2 }],
              movable: true,
              ...(ty ? { tagType: ty } : { missing: true }),
            });
          }
        }
        if (!target) return;
        const set = actionTargets.get(target) ?? new Set<string>();
        set.add(r.id);
        actionTargets.set(target, set);
        const w: Wire = {
          key: `a:${r.id}:${edge}:${index}`,
          from: { node: r.id, port: edge === 'onRise' ? 'rise' : 'fall' },
          to: { node: target, port },
          kind: 'action',
          type: 'any',
          action: { rule: r.id, edge, index },
        };
        const m = markOf(r.id, edge);
        if (m) w.mark = m;
        wires.push(w);
      });
    }
  }
  nodes.push(...outNodes.values());

  // dây vào cổng vào có lỗi cũng đỏ
  const portMark = new Map<string, Mark>();
  for (const n of nodes)
    for (const p of n.ports)
      if (p.mark && p.side === 'in') portMark.set(`${n.key}|${p.key}`, p.mark);
  for (const n of blockNodes)
    for (const g of trees.get(n.key)?.gates ?? [])
      for (const p of g.ports)
        if (p.mark && p.side === 'in') portMark.set(`${g.key}|${p.key}`, p.mark);
  for (const w of wires) {
    const m = portMark.get(`${w.to.node}|${w.to.port}`);
    if (m && !w.mark) w.mark = m;
  }

  // ---------- Vị trí ----------
  const movable = nodes.filter((n) => n.movable);
  const auto = autoLayout(movable, deps, actionTargets, trees, wires);
  const stored = input.layout.nodes;
  const have = movable.filter((n) => stored[n.key]);
  const missing = movable.filter((n) => !stored[n.key]);
  let dy = 0;
  if (have.length && missing.length) {
    const bottom = Math.max(
      ...have.map((n) => stored[n.key]!.y + n.h + (trees.get(n.key)?.bottom ?? n.h) - n.h),
    );
    const autoTop = Math.min(
      ...missing.map((n) => auto.get(n.key)!.y + (trees.get(n.key)?.top ?? 0)),
    );
    dy = snapUp(bottom + GEOM.rowGap * 2 - autoTop);
  }
  for (const n of movable) {
    const p: NodePos = stored[n.key] ?? { x: auto.get(n.key)!.x, y: auto.get(n.key)!.y + dy };
    n.x = p.x;
    n.y = p.y;
  }
  for (const n of blockNodes) {
    const t = trees.get(n.key);
    if (!t) continue;
    for (const g of t.gates) {
      g.x += n.x;
      g.y += n.y;
      nodes.push(g);
    }
  }

  const byKey = new Map(nodes.map((n) => [n.key, n]));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + n.w);
    y1 = Math.max(y1, n.y + n.h);
  }
  const bounds = nodes.length
    ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    : { x: 0, y: 0, w: 0, h: 0 };
  return { nodes, wires, byKey, bounds };
}

/**
 * Sắp xếp tự động (spec US1): cột theo hạng, mỗi cột chừa chỗ cho cây cổng bên trái khối; trong cột theo trọng tâm của
 * nguồn (Tag theo trọng tâm nơi dùng), rồi theo thứ tự tài liệu. Trả góc trên trái của từng nút (đã căn lưới).
 */
function autoLayout(
  movable: readonly GNode[],
  deps: ReadonlyMap<string, ReadonlySet<string>>,
  actionTargets: ReadonlyMap<string, ReadonlySet<string>>,
  trees: ReadonlyMap<string, { left: number; top: number; bottom: number }>,
  wires: readonly Wire[],
): Map<string, NodePos> {
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const r = rank.get(id);
    if (r !== undefined) return r;
    if (visiting.has(id)) return 0; // cạnh ngược của vòng
    visiting.add(id);
    let best = 0;
    for (const d of deps.get(id) ?? []) best = Math.max(best, rankOf(d));
    visiting.delete(id);
    rank.set(id, best + 1);
    return best + 1;
  };
  let maxRank = 1;
  for (const n of movable)
    if (n.type === 'block' && n.kind !== 'writes') maxRank = Math.max(maxRank, rankOf(n.key));
  // Luật không có đầu ra cho khối khác: xếp chung cột ngoài cùng bên phải (như mạng FBD kết thúc ở cuộn), ngay trước Ghi PLC.
  const col = new Map<string, number>();
  for (const n of movable) {
    if (n.type === 'tag') col.set(n.key, 0);
    else if (n.type === 'block' && n.kind === 'rule') col.set(n.key, maxRank);
    else if (n.type === 'block' && n.kind !== 'writes') col.set(n.key, rank.get(n.key)!);
  }
  for (const n of movable) {
    if (col.has(n.key)) continue;
    const src = actionTargets.get(n.key);
    col.set(
      n.key,
      src && src.size ? Math.max(...[...src].map((r) => col.get(r) ?? 1)) + 1 : maxRank + 1,
    );
  }
  const ncol = Math.max(...col.values(), 0) + 1;
  const cols: GNode[][] = Array.from({ length: ncol }, () => []);
  for (const n of movable) cols[col.get(n.key)!]!.push(n);

  // Cột cao quá thì gập sang cột phụ: sơ đồ gần tỉ lệ ASPECT (vùng vẽ của editor rộng hơn cao).
  const unitH = (n: GNode) => {
    const t = trees.get(n.key);
    return (t ? t.bottom - t.top : n.h) + GEOM.rowGap;
  };
  const unitW = (n: GNode) => n.w + (trees.get(n.key)?.left ?? 0) + GEOM.colGap;
  const area = movable.reduce((s, n) => s + unitH(n) * unitW(n), 0);
  const maxH = Math.max(3 * (blockHeight('counter') + GEOM.rowGap), Math.sqrt(area / ASPECT));

  const pos = new Map<string, NodePos>();
  const order = new Map(movable.map((n, i) => [n.key, i]));
  const byKey = new Map(movable.map((n) => [n.key, n]));
  /** Nguồn của nút (để tính trọng tâm): khối phụ thuộc, luật bắn tới. */
  const sources = (n: GNode): string[] => [
    ...(deps.get(n.key) ?? []),
    ...(actionTargets.get(n.key) ?? []),
  ];
  const center = (k: string) => {
    const p = pos.get(k);
    const n = byKey.get(k);
    return p && n ? p.y + n.h / 2 : undefined;
  };
  /** Xếp một cột từ x0 (chừa cây cổng bên trái), gập cột phụ khi quá maxH; trả x của cột kế. */
  const stack = (list: readonly GNode[], x0: number): number => {
    if (list.length === 0) return x0;
    const left = list.reduce((m, n) => Math.max(m, trees.get(n.key)?.left ?? 0), 0);
    const w = list.reduce((m, n) => Math.max(m, n.w), 0);
    let x = snapUp(x0 + left);
    let cursor = GEOM.margin;
    for (const n of list) {
      const t = trees.get(n.key);
      const top = t ? t.top : 0;
      const bottom = t ? t.bottom : n.h;
      if (cursor > GEOM.margin && cursor + (bottom - top) > GEOM.margin + maxH) {
        x = snapUp(x + w + GEOM.colGap + left);
        cursor = GEOM.margin;
      }
      const y = snapUp(cursor - top);
      pos.set(n.key, { x, y });
      cursor = y + bottom + GEOM.rowGap;
    }
    return x + w + GEOM.colGap;
  };
  const bary = (n: GNode): number | undefined => {
    const ys = sources(n)
      .map(center)
      .filter((v): v is number => v !== undefined);
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : undefined;
  };
  // lượt 1: thứ tự tài liệu (Tag theo lần dùng đầu); lượt 2: khối theo trọng tâm nguồn
  const starts: number[] = [];
  let x: number = GEOM.margin;
  for (let c = 0; c < ncol; c++) {
    starts[c] = x;
    x = stack(cols[c]!, x);
  }
  x = starts[1] ?? x;
  for (let c = 1; c < ncol; c++) {
    const list = cols[c]!;
    const key = new Map(list.map((n) => [n.key, bary(n) ?? pos.get(n.key)!.y]));
    list.sort((a, b) => key.get(a.key)! - key.get(b.key)! || order.get(a.key)! - order.get(b.key)!);
    x = stack(list, x);
  }
  // Tag: trọng tâm nơi dùng (neo khối chủ của cổng)
  const owner = new Map<string, string>();
  for (const w of wires) {
    if (!w.from.node.startsWith('tag:')) continue;
    const to = w.to.node.startsWith('g:') ? w.to.node.split(':')[1]! : w.to.node;
    if (!owner.has(w.from.node)) owner.set(w.from.node, to);
  }
  const tags = cols[0]!;
  const tkey = new Map(tags.map((n) => [n.key, center(owner.get(n.key) ?? '') ?? 0]));
  tags.sort((a, b) => tkey.get(a.key)! - tkey.get(b.key)! || order.get(a.key)! - order.get(b.key)!);
  stack(tags, GEOM.margin);
  for (const [k, p] of pos) pos.set(k, { x: snapNear(p.x), y: snapNear(p.y) });
  return pos;
}
