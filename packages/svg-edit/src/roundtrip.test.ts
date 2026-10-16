// T154 (SC-030; FR-111, FR-117): round-trip trên ≥ 20 fixture (tests/svg-editor-fixtures): mở rồi lưu không sửa hai
// lần ⇒ cùng byte với tệp mở; sửa một thuộc tính ⇒ chỉ thẻ mở của nút đó khác; uid giữ 100 %; phần tử giữ nguyên
// (mask, filter, pattern, marker, svg lồng) không đổi byte; số phần tử, uid, hộp bao khớp expected.json.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeSeededUid } from '@mat/svg-import';
import { moveNodes } from './bake.ts';
import { bbox } from './bbox.ts';
import { applyCommand } from './command.ts';
import { documentOrder, OPAQUE_TAGS, type DrawDoc } from './node.ts';
import { parseDrawDoc } from './parse.ts';
import { serialize, serializeSubtree } from './serialize.ts';
import { UndoStack } from './undo.ts';

const DIR = resolve(__dirname, '../../../tests/svg-editor-fixtures');
const EXPECTED = JSON.parse(readFileSync(resolve(DIR, 'expected.json'), 'utf8')) as Record<
  string,
  {
    bytes: number;
    elements: number;
    uids: string[];
    bboxes: Record<string, number[]>;
    removed: number;
    rebuilt: boolean;
  }
>;
const FILES = Object.keys(EXPECTED).sort();
const read = (f: string) => readFileSync(resolve(DIR, f), 'utf8');
function open(text: string): DrawDoc {
  const r = parseDrawDoc(text, { uid: makeSeededUid(1) });
  if (!r.ok) throw new Error(r.message);
  expect(r.report.rebuilt).toBe(false);
  return r.doc;
}
const uids = (doc: DrawDoc) =>
  documentOrder(doc)
    .map((id) => doc.nodes.get(id)!.attrs.get('data-mat-uid'))
    .filter((u): u is string => u !== undefined);

describe('bộ fixture', () => {
  it('≥ 20 fixture, có Inkscape thật, mô phỏng Illustrator/CorelDRAW, ký hiệu tay, transform lồng 3 tầng', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(20);
    for (const must of [
      'imported-inkscape-01-tank-process.svg',
      'imported-illustrator-01-saveas-legacy.svg',
      'imported-corel-01-mm-css.svg',
      'hand-pump-symbol.svg',
      'nested-transform-3-levels.svg',
      'units-mm.svg',
      'inline-style.svg',
      'gradients.svg',
      'use-symbol.svg',
      'mask.svg',
      'filter.svg',
      'nested-svg.svg',
    ])
      expect(FILES).toContain(must);
  });
});

describe.each(FILES)('%s', (f) => {
  const text = read(f);
  const want = EXPECTED[f];

  it('mở rồi lưu không sửa (hai lần): cùng byte với tệp', () => {
    const once = serialize(open(text));
    expect(once).toBe(text);
    expect(serialize(open(once))).toBe(text);
    expect(Buffer.byteLength(text)).toBe(want.bytes);
    expect(want.removed).toBe(0);
  });

  it('số phần tử, uid, hộp bao khớp expected.json', () => {
    const doc = open(text);
    expect(doc.elementCount).toBe(want.elements);
    expect(uids(doc)).toEqual(want.uids);
    for (const id of documentOrder(doc)) {
      const u = doc.nodes.get(id)!.attrs.get('data-mat-uid');
      if (u === undefined || !want.bboxes[u]) continue;
      const b = bbox(doc, id)!;
      const [x, y, w, h] = want.bboxes[u];
      expect([b.x, b.y, b.width, b.height].map((v) => Math.round(v * 1000) / 1000)).toEqual([
        x,
        y,
        w,
        h,
      ]);
    }
  });

  it('sửa một thuộc tính: chỉ thẻ mở của nút đó khác; uid giữ 100 %', () => {
    const doc = open(text);
    const target = documentOrder(doc).find((id) => doc.nodes.get(id)!.attrs.has('data-mat-uid'));
    if (target === undefined) return;
    const n = doc.nodes.get(target)!;
    const oldStart = n.rawStart!;
    const before = uids(doc);
    const stack = new UndoStack(doc);
    stack.push(moveNodes(doc, [target], 5, 0).batch);
    const out = serialize(doc);
    const idx = text.indexOf(oldStart);
    expect(idx).toBeGreaterThanOrEqual(0);
    const newStart = out.slice(idx, out.indexOf('>', idx) + 1);
    expect(out.slice(0, idx)).toBe(text.slice(0, idx));
    expect(out.slice(idx + newStart.length)).toBe(text.slice(idx + oldStart.length));
    expect(uids(doc)).toEqual(before);
    stack.undo();
    expect(serialize(doc)).toBe(text);
  });

  it('phần tử giữ nguyên không đổi byte khi sửa nút khác', () => {
    const doc = open(text);
    const opaque = documentOrder(doc).filter((id) => {
      const t = doc.nodes.get(id)!.tag;
      return OPAQUE_TAGS.has(t) || (t === 'svg' && id !== doc.root);
    });
    if (opaque.length === 0) return;
    const snap = opaque.map((id) => serializeSubtree(doc, id));
    const other = documentOrder(doc).find(
      (id) => doc.nodes.get(id)!.attrs.has('data-mat-uid') && !opaque.includes(id),
    );
    if (other !== undefined) applyCommand(doc, moveNodes(doc, [other], 3, 3).batch);
    expect(opaque.map((id) => serializeSubtree(doc, id))).toEqual(snap);
    for (const s of snap) expect(serialize(doc)).toContain(s);
  });
});

describe('tệp chưa qua bộ nhập (Inkscape thật của feature 008)', () => {
  const raw = readFileSync(
    resolve(DIR, '../fixtures/svg-import/inkscape-01-tank-process.svg'),
    'utf8',
  );
  it('mở: loại namespace Inkscape, báo; lưu lần hai cùng byte lần một', () => {
    const r = parseDrawDoc(raw, { uid: makeSeededUid(1) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.removedElements + r.report.removedAttributes).toBeGreaterThan(0);
    const once = serialize(r.doc);
    expect(once).not.toContain('inkscape:');
    expect(once).not.toContain('sodipodi');
    expect(serialize(open(once))).toBe(once);
  });
});
