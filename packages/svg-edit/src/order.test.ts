// T152 (SC-031; FR-104, FR-105): xếp lớp trong cùng cha (lên/xuống một bậc, lên/xuống cùng), chuyển sang cha khác giữ
// hiển thị, và lớp `<g data-mat-layer>` (tạo, đổi tên, xóa, chuyển phần tử, thứ tự).
import { describe, expect, it } from 'vitest';
import { bbox } from './bbox.ts';
import { CommandError, applyCommand } from './command.ts';
import {
  createLayer,
  deleteLayer,
  layerOf,
  listLayers,
  moveToLayer,
  renameLayer,
  reorderLayer,
} from './layers.ts';
import { elementChildren, type DrawDoc } from './node.ts';
import { bringForward, bringToFront, moveToParent, sendBackward, sendToBack } from './order.ts';
import { canonical, serialize } from './serialize.ts';
import { body, byId, expectBox, open, NS } from './test-helpers.ts';

const ids = (doc: DrawDoc, parent = doc.root) =>
  elementChildren(doc, parent).map(
    (i) => doc.nodes.get(i)!.attrs.get('id') ?? doc.nodes.get(i)!.attrs.get('data-mat-layer'),
  );
const ABCD = '<rect id="a"/><rect id="b"/><rect id="c"/><rect id="d"/>';

describe('xếp lớp trong cùng cha', () => {
  it.each<[string, (d: DrawDoc) => ReturnType<typeof bringToFront>, string[]]>([
    ['lên trên cùng: b', (d) => bringToFront(d, [byId(d, 'b')]), ['a', 'c', 'd', 'b']],
    [
      'lên trên cùng: a, c giữ thứ tự',
      (d) => bringToFront(d, [byId(d, 'c'), byId(d, 'a')]),
      ['b', 'd', 'a', 'c'],
    ],
    ['xuống dưới cùng: c', (d) => sendToBack(d, [byId(d, 'c')]), ['c', 'a', 'b', 'd']],
    [
      'xuống dưới cùng: b, d',
      (d) => sendToBack(d, [byId(d, 'd'), byId(d, 'b')]),
      ['b', 'd', 'a', 'c'],
    ],
    ['lên một bậc: b', (d) => bringForward(d, [byId(d, 'b')]), ['a', 'c', 'b', 'd']],
    ['lên một bậc: d (đã trên cùng)', (d) => bringForward(d, [byId(d, 'd')]), ['a', 'b', 'c', 'd']],
    [
      'lên một bậc: c, d (khối trên cùng không đổi)',
      (d) => bringForward(d, [byId(d, 'c'), byId(d, 'd')]),
      ['a', 'b', 'c', 'd'],
    ],
    [
      'lên một bậc: a, b',
      (d) => bringForward(d, [byId(d, 'a'), byId(d, 'b')]),
      ['c', 'a', 'b', 'd'],
    ],
    ['xuống một bậc: c', (d) => sendBackward(d, [byId(d, 'c')]), ['a', 'c', 'b', 'd']],
    [
      'xuống một bậc: a (đã dưới cùng)',
      (d) => sendBackward(d, [byId(d, 'a')]),
      ['a', 'b', 'c', 'd'],
    ],
    [
      'xuống một bậc: b, d',
      (d) => sendBackward(d, [byId(d, 'b'), byId(d, 'd')]),
      ['b', 'a', 'd', 'c'],
    ],
  ])('%s', (_l, op, want) => {
    const doc = body(ABCD);
    applyCommand(doc, op(doc));
    expect(ids(doc)).toEqual(want);
  });

  it('bỏ qua chữ và chú thích khi tính bậc', () => {
    const doc = body('<rect id="a"/><!-- x --><rect id="b"/>');
    applyCommand(doc, bringForward(doc, [byId(doc, 'a')]));
    expect(ids(doc)).toEqual(['b', 'a']);
  });

  it('tệp thụt dòng: thứ tự mới vẫn mỗi phần tử một dòng; hoàn tác về đúng byte', () => {
    const text = `<svg ${NS}>\n  <rect id="a"/>\n  <rect id="b"/>\n  <rect id="c"/>\n</svg>\n`;
    const doc = open(text);
    const inv = applyCommand(doc, bringToFront(doc, [byId(doc, 'a')]));
    expect(serialize(doc)).toBe(
      `<svg ${NS}>\n  <rect id="b"/>\n  <rect id="c"/>\n  <rect id="a"/>\n</svg>\n`,
    );
    applyCommand(doc, inv);
    expect(canonical(doc)).toBe(text);
  });

  it('mỗi cha xếp riêng', () => {
    const doc = body(
      '<g id="g1"><rect id="a"/><rect id="b"/></g><g id="g2"><rect id="c"/><rect id="d"/></g>',
    );
    applyCommand(doc, bringToFront(doc, [byId(doc, 'a'), byId(doc, 'c')]));
    expect(ids(doc, byId(doc, 'g1'))).toEqual(['b', 'a']);
    expect(ids(doc, byId(doc, 'g2'))).toEqual(['d', 'c']);
  });
});

describe('chuyển sang cha khác: giữ hiển thị', () => {
  it.each([
    [
      'vào g có transform',
      '<g id="t" transform="translate(10 10) scale(2)"/><rect id="a" x="0" y="0" width="4" height="4"/>',
      't',
    ],
    [
      'ra khỏi g xoay',
      '<g id="s" transform="rotate(90)"><rect id="a" x="0" y="0" width="4" height="2"/></g><g id="t"/>',
      't',
    ],
    [
      'vào g nghiêng',
      '<g id="t" transform="skewX(20)"/><rect id="a" x="0" y="0" width="4" height="4"/>',
      't',
    ],
  ])('%s', (_l, inner, target) => {
    const doc = body(inner);
    const before = bbox(doc, byId(doc, 'a'))!;
    const r = moveToParent(doc, [byId(doc, 'a')], byId(doc, target), null);
    applyCommand(doc, r.batch);
    const a = byId(doc, 'a');
    expect(doc.nodes.get(a)!.parent).toBe(byId(doc, target));
    expectBox(expect, bbox(doc, a), before.x, before.y, before.width, before.height);
  });

  it('không chuyển vào chính cây con', () => {
    const doc = body('<g id="g"><g id="h"/></g>');
    expect(() =>
      applyCommand(doc, moveToParent(doc, [byId(doc, 'g')], byId(doc, 'h'), null).batch),
    ).toThrow(CommandError);
  });
});

describe('lớp (data-mat-layer)', () => {
  const doc0 = () =>
    open(
      `<svg ${NS}>\n  <g data-mat-layer="Nền">\n    <rect id="a"/>\n  </g>\n  <rect id="b"/>\n</svg>\n`,
    );

  it('liệt kê lớp theo thứ tự vẽ; phần tử ngoài lớp thuộc lớp mặc định (null)', () => {
    const doc = doc0();
    expect(listLayers(doc).map((l) => l.name)).toEqual(['Nền']);
    expect(layerOf(doc, byId(doc, 'a'))).toBe('Nền');
    expect(layerOf(doc, byId(doc, 'b'))).toBeNull();
  });

  it('tạo lớp: g cấp một mới ở trên cùng; tên trùng hoặc > 64 byte bị từ chối', () => {
    const doc = doc0();
    applyCommand(doc, createLayer(doc, 'Bơm').batch);
    expect(listLayers(doc).map((l) => l.name)).toEqual(['Nền', 'Bơm']);
    expect(serialize(doc)).toContain('\n  <g data-mat-layer="Bơm"/>\n</svg>');
    expect(() => createLayer(doc, 'Nền')).toThrow(CommandError);
    expect(() => createLayer(doc, 'Đ'.repeat(33))).toThrow(CommandError);
  });

  it('đổi tên lớp', () => {
    const doc = doc0();
    applyCommand(doc, renameLayer(doc, 'Nền', 'Nền xưởng'));
    expect(listLayers(doc).map((l) => l.name)).toEqual(['Nền xưởng']);
  });

  it('chuyển phần tử sang lớp (giữ hiển thị)', () => {
    const doc = doc0();
    applyCommand(doc, moveToLayer(doc, [byId(doc, 'b')], 'Nền').batch);
    expect(layerOf(doc, byId(doc, 'b'))).toBe('Nền');
    applyCommand(doc, moveToLayer(doc, [byId(doc, 'a')], null).batch);
    expect(layerOf(doc, byId(doc, 'a'))).toBeNull();
  });

  it('xóa lớp: "content" xóa luôn nội dung; "move" chuyển nội dung sang lớp mặc định', () => {
    const d1 = doc0();
    applyCommand(d1, deleteLayer(d1, 'Nền', 'content').batch);
    expect(() => byId(d1, 'a')).toThrow();
    const d2 = doc0();
    applyCommand(d2, deleteLayer(d2, 'Nền', 'move').batch);
    expect(layerOf(d2, byId(d2, 'a'))).toBeNull();
    expect(listLayers(d2)).toEqual([]);
  });

  it('đổi thứ tự lớp', () => {
    const doc = doc0();
    applyCommand(doc, createLayer(doc, 'Trên').batch);
    applyCommand(doc, reorderLayer(doc, 'Trên', 0));
    expect(listLayers(doc).map((l) => l.name)).toEqual(['Trên', 'Nền']);
  });
});
