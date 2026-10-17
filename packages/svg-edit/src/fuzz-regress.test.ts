// Hồi quy từ bản chạy dài của fuzz lệnh (feature 011, T165; tools/fuzz/targets/svg-edit-commands.mjs). Mỗi ca là đầu
// vào đã rút gọn.
import { describe, expect, it } from 'vitest';
import { assertAllowlisted, makeSeededUid } from '@mat/svg-import';
import { buildSubtree } from './build.ts';
import { copyNodes, pasteClip } from './clipboard.ts';
import { CommandError, InsertNode, SetAttr } from './command.ts';
import { invariants } from './fuzz-helpers.ts';
import { findById, type DrawDoc } from './node.ts';
import { parseDrawDoc } from './parse.ts';
import { canonical, serialize } from './serialize.ts';
import { UndoStack } from './undo.ts';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (rootAttrs: string) =>
  `<svg ${rootAttrs} viewBox="0 0 100 100">\n` +
  `  <defs><g id="pump"><rect width="10" height="10"/></g></defs>\n` +
  `  <use id="u1" href="#pump" x="5"/>\n` +
  `</svg>\n`;

function open(text: string): DrawDoc {
  const r = parseDrawDoc(text, { uid: makeSeededUid(3) });
  if (!r.ok) throw new Error(r.message);
  return r.doc;
}

const rejected = (doc: DrawDoc, f: () => void) => {
  const before = canonical(doc);
  let err: unknown = null;
  try {
    f();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(CommandError);
  expect((err as CommandError).code).toBe('SVG_INVALID');
  expect(canonical(doc)).toBe(before);
};

describe('fuzz lệnh: xlink:href khi gốc không khai báo xmlns:xlink', () => {
  // Phát hiện: seed 20261017, 12 ca trong 44 triệu (ca đầu 1133400): chèn <use xlink:href="#pump"> (hoặc đặt
  // thuộc tính xlink:href) vào tài liệu mà gốc không có xmlns:xlink; văn bản ghi ra có tiền tố không khai báo, không
  // phải XML hợp lệ (bộ lọc DOM của 008 từ chối: "unbound namespace prefix").
  it('InsertNode <use xlink:href>: từ chối SVG_INVALID, tài liệu không đổi', () => {
    const doc = open(svg(NS));
    const sub = buildSubtree(doc, { tag: 'use', attrs: [['xlink:href', '#pump']] });
    rejected(doc, () => new UndoStack(doc).push(new InsertNode(doc.root, 0, sub)));
    expect(invariants(doc)).toBeNull();
    expect(() => assertAllowlisted(serialize(doc))).not.toThrow();
  });

  it('SetAttr xlink:href: từ chối SVG_INVALID', () => {
    const doc = open(svg(NS));
    const u = findById(doc, 'u1')!;
    rejected(doc, () => new UndoStack(doc).push(new SetAttr(u, 'xlink:href', '#pump')));
  });

  it('gốc có xmlns:xlink: xlink:href vẫn được, văn bản ghi ra hợp lệ', () => {
    const doc = open(svg(`${NS} ${XL}`));
    const sub = buildSubtree(doc, { tag: 'use', attrs: [['xlink:href', '#pump']] });
    new UndoStack(doc).push(new InsertNode(doc.root, 0, sub));
    expect(serialize(doc)).toContain('xlink:href="#pump"');
    expect(() => assertAllowlisted(serialize(doc))).not.toThrow();
  });

  it('bất biến của fuzz bắt được tiền tố xlink không khai báo', () => {
    const doc = open(svg(NS));
    doc.nodes.get(findById(doc, 'u1')!)!.attrs.set('xlink:href', '#pump');
    expect(invariants(doc)).toMatch(/xmlns:xlink/);
  });

  it('chép <use xlink:href> từ tài liệu có xmlns:xlink sang tài liệu không có: dán được, ghi thành href', () => {
    const src = open(svg(`${NS} ${XL}`).replace('href="#pump"', 'xlink:href="#pump"'));
    const clip = copyNodes(src, [findById(src, 'u1')!]);
    const dst = open(svg(NS));
    const r = pasteClip(dst, clip);
    new UndoStack(dst).push(r.batch);
    const text = serialize(dst);
    expect(text).not.toContain('xlink:');
    expect(() => assertAllowlisted(text)).not.toThrow();
    expect(invariants(dst)).toBeNull();
  });
});
