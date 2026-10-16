// Hàm dùng chung cho test của @mat/svg-edit (không vào gói: không khớp mẫu *.test.ts, chỉ test import).
import { makeSeededUid } from '@mat/svg-import';
import { buildSubtree } from './build.ts';
import {
  Batch,
  InsertNode,
  MoveNode,
  RemoveNode,
  SetAttr,
  SetText,
  type Command,
} from './command.ts';
import type { Box, DrawDoc, NodeId } from './node.ts';
import { documentOrder, elementChildren, findById } from './node.ts';
import { parseDrawDoc } from './parse.ts';

export const NS = 'xmlns="http://www.w3.org/2000/svg"';

export function open(text: string, seed = 7): DrawDoc {
  const r = parseDrawDoc(text, { uid: makeSeededUid(seed) });
  if (!r.ok) throw new Error(r.code + ': ' + r.message);
  return r.doc;
}

/** Tài liệu từ phần thân (viewBox 0 0 200 200). */
export function body(inner: string, seed = 7): DrawDoc {
  return open(`<svg ${NS} viewBox="0 0 200 200">${inner}</svg>`, seed);
}

export const byId = (doc: DrawDoc, id: string): NodeId => {
  const n = findById(doc, id);
  if (n === null) throw new Error('không có id ' + id);
  return n;
};

export const attr = (doc: DrawDoc, id: string, name: string): string | undefined =>
  doc.nodes.get(byId(doc, id))!.attrs.get(name);

export function expectBox(
  expect: (v: unknown) => { toBeCloseTo(n: number, d?: number): void },
  b: Box | null,
  x: number,
  y: number,
  w: number,
  h: number,
  digits = 3,
): void {
  if (b === null) throw new Error('hộp bao null');
  expect(b.x).toBeCloseTo(x, digits);
  expect(b.y).toBeCloseTo(y, digits);
  expect(b.width).toBeCloseTo(w, digits);
  expect(b.height).toBeCloseTo(h, digits);
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Một lệnh ngẫu nhiên hợp lệ hoặc không (lệnh bị từ chối không vào ngăn xếp). */
export function randomCommand(doc: DrawDoc, r: () => number): Command {
  const els = documentOrder(doc).filter((id) => id !== doc.root);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const any = els.length > 0 ? pick(els) : doc.root;
  const groups = () => [doc.root, ...els.filter((id) => doc.nodes.get(id)!.tag === 'g')];
  switch (Math.floor(r() * 7)) {
    case 0:
      return new SetAttr(
        any,
        pick(['x', 'y', 'width', 'fill', 'stroke', 'opacity', 'transform']),
        pick(['1', '2.5', '#123456', 'translate(3 4)', 'none', '0.5']),
      );
    case 1:
      return new SetAttr(any, pick(['x', 'fill', 'stroke', 'id', 'data-mat-name']), null);
    case 2: {
      const p = pick(groups());
      const spec = pick([
        {
          tag: 'rect',
          attrs: [
            ['x', '1'],
            ['width', '4'],
            ['height', '4'],
          ] as Array<[string, string]>,
        },
        { tag: 'g', children: [{ tag: 'circle', attrs: [['r', '2']] as Array<[string, string]> }] },
        { tag: 'text', attrs: [['x', '1']] as Array<[string, string]>, text: 'Mới' },
      ]);
      return new InsertNode(
        p,
        Math.floor(r() * (doc.nodes.get(p)!.children.length + 1)),
        buildSubtree(doc, spec),
      );
    }
    case 3:
      return new RemoveNode(any);
    case 4: {
      const p = pick(groups());
      return new MoveNode(any, p, Math.floor(r() * elementChildren(doc, p).length));
    }
    case 5: {
      const texts = els.filter((id) => doc.nodes.get(id)!.tag === 'text');
      return new SetText(texts.length > 0 ? pick(texts) : any, pick(['A', 'Bơm 9', '', 'x < y']));
    }
    default:
      return new Batch([
        new SetAttr(any, 'x', String(Math.floor(r() * 100))),
        new SetAttr(pick(els.length > 0 ? els : [doc.root]), 'y', String(Math.floor(r() * 100))),
      ]);
  }
}
