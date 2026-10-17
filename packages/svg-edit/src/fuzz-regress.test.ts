// Hồi quy từ bản chạy dài của fuzz lệnh (feature 011, T165; tools/fuzz/targets/svg-edit-commands.mjs). Mỗi ca là đầu
// vào đã rút gọn.
import { describe, expect, it } from 'vitest';
import { assertAllowlisted, makeSeededUid } from '@mat/svg-import';
import { buildSubtree } from './build.ts';
import { copyNodes, pasteClip } from './clipboard.ts';
import { InsertNode, SetAttr } from './command.ts';
import { invariants } from './fuzz-helpers.ts';
import { findById, type DrawDoc } from './node.ts';
import { parseDrawDoc } from './parse.ts';
import { serialize } from './serialize.ts';
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

/** Văn bản ghi ra là XML hợp lệ về namespace và qua bộ lọc DOM của feature 008; đọc lại được. */
const writesValid = (doc: DrawDoc) => {
  const text = serialize(doc);
  expect(() => assertAllowlisted(text)).not.toThrow();
  expect(parseDrawDoc(text, { uid: makeSeededUid(4) }).ok).toBe(true);
  expect(invariants(doc)).toBeNull();
  return text;
};

describe('fuzz lệnh: xlink:href khi gốc không khai báo xmlns:xlink', () => {
  // Phát hiện: seed 20261017, 12 ca trong 44 triệu (ca đầu 1133400): chèn <use xlink:href="#pump"> (hoặc đặt
  // thuộc tính xlink:href) vào tài liệu mà gốc không có xmlns:xlink; văn bản ghi ra có tiền tố không khai báo, không
  // phải XML hợp lệ (bộ lọc DOM của 008 từ chối: "unbound namespace prefix"). Sửa ở gd6 (T202 N-SVG2, commit
  // 39c2708c): serialize thêm xmlns:xlink vào gốc khi cây có xlink:*.
  it('InsertNode <use xlink:href>: văn bản ghi ra khai báo xmlns:xlink, hợp lệ', () => {
    const doc = open(svg(NS));
    const sub = buildSubtree(doc, { tag: 'use', attrs: [['xlink:href', '#pump']] });
    new UndoStack(doc).push(new InsertNode(doc.root, 0, sub));
    expect(writesValid(doc)).toContain(XL);
  });

  it('SetAttr xlink:href: văn bản ghi ra hợp lệ', () => {
    const doc = open(svg(NS));
    new UndoStack(doc).push(new SetAttr(findById(doc, 'u1')!, 'xlink:href', '#pump'));
    expect(writesValid(doc)).toContain(XL);
  });

  it('chép <use xlink:href> sang tài liệu không có xmlns:xlink: dán được, văn bản hợp lệ', () => {
    const src = open(svg(`${NS} ${XL}`).replace('href="#pump"', 'xlink:href="#pump"'));
    const clip = copyNodes(src, [findById(src, 'u1')!]);
    const dst = open(svg(NS));
    new UndoStack(dst).push(pasteClip(dst, clip).batch);
    writesValid(dst);
  });
});
