// T155, T165 (SC-034; FR-029, FR-109): fuzz lệnh 100.000 chuỗi (hạt cố định): lệnh ngẫu nhiên, nhiều lệnh độc (on*,
// javascript:, url ngoài, script, foreignObject, bom use, vòng cha con, chữ có ký tự điều khiển…). Sau mỗi chuỗi:
// mọi trạng thái nằm trong allowlist và giới hạn; hoàn tác hết ⇒ canonical bằng ban đầu. Cứ 2.000 chuỗi, kiểm chéo
// bằng bộ lọc DOM của feature 008 (`assertAllowlisted` trên văn bản đã ghi).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOW_ELEMENTS } from '@mat/svg-renderer';
import { assertAllowlisted } from '@mat/svg-import';
import { checkAttr, hasInvalidXmlChar, structuralProblem } from './allow.ts';
import { buildSubtree, type NodeSpec } from './build.ts';
import {
  Batch,
  CommandError,
  InsertNode,
  MoveNode,
  RemoveNode,
  SetAttr,
  SetText,
  type Command,
} from './command.ts';
import { SVG_MAX_DEPTH, SVG_MAX_NODES } from './limits.ts';
import {
  COMMENT_NODE,
  TEXT_NODE,
  depthOf,
  documentOrder,
  isElement,
  type DrawDoc,
} from './node.ts';
import { canonical, serialize } from './serialize.ts';
import { open, randomCommand, rng } from './test-helpers.ts';
import { UndoStack } from './undo.ts';

const SEEDS = [
  'hand-pump-symbol.svg',
  'gradients.svg',
  'use-symbol.svg',
  'text-tspan-vi.svg',
  'layers.svg',
  'mask.svg',
].map((f) => readFileSync(resolve(__dirname, '../../../tests/svg-editor-fixtures', f), 'utf8'));

const EVIL_NAMES = [
  'onclick',
  'ONLOAD',
  'onmouseover',
  'href',
  'xlink:href',
  'style',
  'fill',
  'data-x',
  'data-mat-uid',
  'data-mat-layer',
  'id',
  'transform',
  'xmlns',
  'xmlns:evil',
  'xml:base',
  'formaction',
  'x',
  'clip-path',
  'filter',
  'mask',
];
const EVIL_VALUES = [
  'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'url(http://evil.invalid/x)', 'url(javascript:alert(1))', 'url(#lg)',
  '#steel', '#pump', 'http://evil.invalid/a.svg#x', 'data:text/html,<script>alert(1)</script>', '@import url(x.css)',
  'fill:red;behavior:url(x.htc)', 'expression(alert(1))', 'NaN', '1e999', '\u0001', 'a‮b', 'el_pump_body', 'el_new_uid',
  'translate(1 2) url(x)', 'rotate(30)', '10', '#123', 'none', '', ' ', 'Đ'.repeat(70),
]; // prettier-ignore
const EVIL_TAGS = [
  'script',
  'foreignObject',
  'a',
  'iframe',
  'style',
  'animate',
  'set',
  'svg:rect',
  'image',
  'use',
  'title',
  'rect',
  'g',
  'text',
  'tspan',
  'metadata',
  'filter',
  'feImage',
  'handler',
];

function evilCommand(doc: DrawDoc, r: () => number): Command {
  const els = documentOrder(doc);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const any = pick(els);
  switch (Math.floor(r() * 6)) {
    case 0:
    case 1:
      return new SetAttr(any, pick(EVIL_NAMES), pick(EVIL_VALUES));
    case 2: {
      const tag = pick(EVIL_TAGS);
      const spec: NodeSpec = {
        tag,
        attrs:
          r() < 0.5
            ? [[pick(EVIL_NAMES), pick(EVIL_VALUES)]]
            : tag === 'use'
              ? [['href', pick(['#pump', '#steel', '#motor', '#l0'])]]
              : [],
        text: r() < 0.3 ? pick(['alert(1)', 'x\u0000y', 'ok']) : undefined,
        children: r() < 0.3 ? [{ tag: pick(EVIL_TAGS) }] : undefined,
      };
      const p = pick(els);
      return new InsertNode(
        p,
        Math.floor(r() * (doc.nodes.get(p)!.children.length + 1)),
        buildSubtree(doc, spec),
      );
    }
    case 3: {
      const p = pick(els);
      return new MoveNode(any, p, Math.floor(r() * (doc.nodes.get(p)!.children.length + 1)));
    }
    case 4:
      return new SetText(any, pick(['<script>', 'a\u0007b', 'Bình thường', ']]>', '-->']));
    default:
      return r() < 0.5
        ? new RemoveNode(any)
        : new Batch([evilCommand(doc, r), evilCommand(doc, r)]);
  }
}

/** Bất biến: allowlist, giới hạn, uid duy nhất, đếm phần tử đúng. */
function invariants(doc: DrawDoc): string | null {
  let count = 0;
  const uids = new Set<string>();
  for (const n of doc.nodes.values()) {
    if (n.tag === TEXT_NODE || n.tag === COMMENT_NODE) {
      if (hasInvalidXmlChar(n.text ?? '')) return 'ký tự cấm trong chữ';
      continue;
    }
    count++;
    if (!ALLOW_ELEMENTS.has(n.tag)) return 'phần tử ngoài allowlist: ' + n.tag;
    if (depthOf(doc, n.id) > SVG_MAX_DEPTH) return 'quá sâu';
    for (const [k, v] of n.attrs) {
      const ver = checkAttr(n.tag, k, v, n.id === doc.root);
      if (!ver.ok) return `thuộc tính ngoài allowlist: ${n.tag} ${k}="${v}"`;
    }
    const u = n.attrs.get('data-mat-uid');
    if (u !== undefined) {
      if (uids.has(u)) return 'uid trùng ' + u;
      uids.add(u);
    }
    if (!isElement(n)) return 'loại nút lạ';
  }
  if (count !== doc.elementCount) return `đếm phần tử lệch ${count} != ${doc.elementCount}`;
  if (count > SVG_MAX_NODES) return 'quá nhiều phần tử';
  return structuralProblem(doc);
}

describe('fuzz lệnh: 100.000 chuỗi (hạt cố định)', () => {
  it('mọi trạng thái trong allowlist và giới hạn; hoàn tác hết về ban đầu', () => {
    const N = 100_000;
    let applied = 0;
    let rejected = 0;
    const codes: Record<string, number> = {};
    for (let s = 0; s < SEEDS.length; s++) {
      const doc = open(SEEDS[s], s + 1);
      const start = canonical(doc);
      const stack = new UndoStack(doc);
      const per = Math.ceil(N / SEEDS.length);
      for (let seq = 0; seq < per; seq++) {
        const r = rng(0x5eed + s * 1_000_003 + seq);
        const len = 1 + Math.floor(r() * 5);
        for (let i = 0; i < len; i++) {
          const cmd = r() < 0.7 ? evilCommand(doc, r) : randomCommand(doc, r);
          const v = doc.version;
          const before = seq % 97 === 0 ? canonical(doc) : null;
          try {
            stack.push(cmd);
            applied++;
          } catch (e) {
            if (!(e instanceof CommandError)) throw e;
            rejected++;
            codes[e.code] = (codes[e.code] ?? 0) + 1;
            // lệnh bị từ chối: tài liệu không đổi
            expect(doc.version).toBe(v);
            if (before !== null) expect(canonical(doc)).toBe(before);
          }
        }
        const bad = invariants(doc);
        if (bad !== null) throw new Error(`chuỗi ${s}/${seq}: ${bad}`);
        if (seq % 2000 === 0) assertAllowlisted(serialize(doc));
        while (stack.canUndo) stack.undo();
        stack.clear();
        if (canonical(doc) !== start)
          throw new Error(`chuỗi ${s}/${seq}: hoàn tác không về ban đầu`);
      }
    }
    expect(applied + rejected).toBeGreaterThan(N);
    expect(applied).toBeGreaterThan(10_000);
    expect(Object.keys(codes).sort()).toEqual(
      expect.arrayContaining(['SVG_INVALID', 'SVG_LOCKED', 'SVG_UNSAFE']),
    );
  }, 600_000);
});
