// T152 (SC-031; FR-102): nhóm và bỏ nhóm giữ hiển thị (hộp bao từng con không đổi) và uid; nhóm mới có uid mới;
// nhóm rỗng tự bị xóa.
import { describe, expect, it } from 'vitest';
import { bbox } from './bbox.ts';
import { CommandError, applyCommand } from './command.ts';
import { groupNodes, ungroupNode } from './group.ts';
import { deleteNodes } from './structure.ts';
import { elementChildren, findByUid, type DrawDoc, type NodeId } from './node.ts';
import { canonical, serialize } from './serialize.ts';
import { attr, body, byId, expectBox, open, NS } from './test-helpers.ts';

function boxes(doc: DrawDoc, uids: string[]) {
  return uids.map((u) => bbox(doc, findByUid(doc, u)!)!);
}
function same(doc: DrawDoc, uids: string[], before: ReturnType<typeof boxes>) {
  boxes(doc, uids).forEach((b, i) =>
    expectBox(expect, b, before[i].x, before[i].y, before[i].width, before[i].height),
  );
}

const R = (id: string, extra = '') =>
  `<rect id="${id}" data-mat-uid="el_${id.padEnd(10, 'q')}" ${extra}/>`;
const U = (id: string) => `el_${id.padEnd(10, 'q')}`;

describe('groupNodes', () => {
  it('cùng cha: g mới tại vị trí nút trên cùng, giữ thứ tự, không đổi hiển thị, uid mới', () => {
    const doc = body(
      R('a', 'x="0" width="5" height="5"') +
        R('b', 'x="10" width="5" height="5"') +
        R('c', 'x="20" width="5" height="5"'),
    );
    const before = boxes(doc, [U('a'), U('c')]);
    const r = groupNodes(doc, [byId(doc, 'c'), byId(doc, 'a')]);
    applyCommand(doc, r.batch);
    const g = doc.nodes.get(r.group)!;
    expect(g.tag).toBe('g');
    expect(g.attrs.get('data-mat-uid')).toMatch(/^el_[a-z2-7]{10}$/);
    expect(elementChildren(doc, r.group).map((id) => doc.nodes.get(id)!.attrs.get('id'))).toEqual([
      'a',
      'c',
    ]);
    // g nằm sau b (vị trí của c, nút trên cùng)
    expect(
      elementChildren(doc, doc.root).map((id) => doc.nodes.get(id)!.attrs.get('id') ?? 'g'),
    ).toEqual(['b', 'g']);
    same(doc, [U('a'), U('c')], before);
    expect(findByUid(doc, U('a'))).toBe(byId(doc, 'a'));
  });

  it('khác cha có transform: mỗi nút nhận bù để giữ vị trí', () => {
    const doc = body(
      '<g id="p1" transform="translate(50 0) rotate(90)">' +
        R('a', 'width="4" height="2"') +
        '</g>' +
        '<g id="p2" transform="scale(2)">' +
        R('b', 'x="1" y="1" width="3" height="3"') +
        '<path id="c" data-mat-uid="el_cqqqqqqqqq" d="M0 0 L4 4"/></g>',
    );
    const before = boxes(doc, [U('a'), U('b'), U('c')]);
    const r = groupNodes(doc, [byId(doc, 'a'), byId(doc, 'b'), byId(doc, 'c')]);
    applyCommand(doc, r.batch);
    same(doc, [U('a'), U('b'), U('c')], before);
    // b, c cùng cha p2 (nút trên cùng là c): g nằm trong p2; a từ p1 sang nhận bù
    expect(doc.nodes.get(r.group)!.parent).toBe(byId(doc, 'p2'));
    // p1 rỗng bị xóa
    expect(() => byId(doc, 'p1')).toThrow();
  });

  it('nhóm rồi hoàn tác: cùng byte', () => {
    const text = `<svg ${NS}>\n  ${R('a', 'width="1" height="1"')}\n  ${R('b', 'width="1" height="1"')}\n</svg>\n`;
    const doc = open(text);
    const inv = applyCommand(doc, groupNodes(doc, [byId(doc, 'a'), byId(doc, 'b')]).batch);
    expect(serialize(doc)).toContain('<g data-mat-uid=');
    applyCommand(doc, inv);
    expect(canonical(doc)).toBe(text);
  });

  it('tệp thụt dòng: g mới trên dòng riêng, con trên dòng riêng', () => {
    const doc = open(
      `<svg ${NS}>\n  ${R('a', 'width="1" height="1"')}\n  ${R('b', 'width="1" height="1"')}\n</svg>\n`,
      3,
    );
    const r = groupNodes(doc, [byId(doc, 'a'), byId(doc, 'b')]);
    applyCommand(doc, r.batch);
    const uid = attr(doc, 'a', 'data-mat-uid');
    const g = doc.nodes.get(r.group)!.attrs.get('data-mat-uid');
    expect(serialize(doc)).toBe(
      `<svg ${NS}>\n  <g data-mat-uid="${g}">\n    <rect id="a" data-mat-uid="${uid}" width="1" height="1"/>\n    ${R('b', 'width="1" height="1"')}\n  </g>\n</svg>\n`,
    );
  });

  it.each<[string, (d: DrawDoc) => NodeId[]]>([
    ['rỗng', () => []],
    ['gốc', (d) => [d.root]],
    ['phần tử trong defs', (d) => [byId(d, 'lg')]],
    ['lớp', (d) => [byId(d, 'L')]],
  ])('từ chối: %s', (_l, ids) => {
    const doc = body('<defs><linearGradient id="lg"/></defs><g id="L" data-mat-layer="Nền"/>');
    expect(() => groupNodes(doc, ids(doc))).toThrow(CommandError);
  });

  it('chọn cả cha lẫn con: chỉ nhóm cha', () => {
    const doc = body(
      '<g id="p">' + R('a', 'width="1" height="1"') + '</g>' + R('b', 'width="1" height="1"'),
    );
    const r = groupNodes(doc, [byId(doc, 'p'), byId(doc, 'a'), byId(doc, 'b')]);
    applyCommand(doc, r.batch);
    expect(elementChildren(doc, r.group).map((id) => doc.nodes.get(id)!.attrs.get('id'))).toEqual([
      'p',
      'b',
    ]);
  });
});

describe('ungroupNode', () => {
  it('đẩy transform xuống con (bake khi chính xác), giữ uid con, xóa g', () => {
    const doc = body(
      '<g id="g" data-mat-uid="el_gqqqqqqqqq" transform="translate(10 20)">' +
        R('a', 'x="1" y="1" width="2" height="2"') +
        '<path id="p" data-mat-uid="el_pqqqqqqqqq" d="M0 0 L1 1"/></g>',
    );
    const before = boxes(doc, [U('a'), U('p')]);
    const r = ungroupNode(doc, byId(doc, 'g'));
    applyCommand(doc, r.batch);
    same(doc, [U('a'), U('p')], before);
    expect(attr(doc, 'a', 'x')).toBe('11');
    expect(attr(doc, 'a', 'transform')).toBeUndefined();
    expect(attr(doc, 'p', 'transform')).toBe('translate(10 20)');
    expect(findByUid(doc, 'el_gqqqqqqqqq')).toBeNull();
    expect(r.removedUid).toBe('el_gqqqqqqqqq');
    expect(r.children.length).toBe(2);
  });

  it('xoay 30: con nhận transform gộp, hiển thị giữ', () => {
    const doc = body(
      '<g id="g" transform="rotate(30 5 5)">' +
        R('a', 'width="10" height="4"') +
        R('b', 'x="2" width="1" height="1" transform="scale(2)"') +
        '</g>',
    );
    const before = boxes(doc, [U('a'), U('b')]);
    applyCommand(doc, ungroupNode(doc, byId(doc, 'g')).batch);
    same(doc, [U('a'), U('b')], before);
    expect(attr(doc, 'a', 'transform')).toBe('rotate(30 5 5)');
  });

  it('thuộc tính kế thừa của g (fill, stroke, font-size) chép xuống con chưa đặt', () => {
    const doc = body(
      '<g id="g" fill="#f00" stroke="#000" font-size="20">' +
        R('a', 'width="1" height="1"') +
        R('b', 'width="1" height="1" fill="#0f0"') +
        '</g>',
    );
    applyCommand(doc, ungroupNode(doc, byId(doc, 'g')).batch);
    expect([attr(doc, 'a', 'fill'), attr(doc, 'a', 'stroke'), attr(doc, 'a', 'font-size')]).toEqual(
      ['#f00', '#000', '20'],
    );
    expect(attr(doc, 'b', 'fill')).toBe('#0f0');
  });

  it.each([
    ['opacity', 'opacity="0.5"'],
    ['clip-path', 'clip-path="url(#c)"'],
    ['filter', 'filter="url(#f)"'],
  ])('từ chối khi g có %s (không giữ được hiển thị)', (_l, a) => {
    const doc = body(`<g id="g" ${a}>${R('a', 'width="1" height="1"')}</g>`);
    expect(() => ungroupNode(doc, byId(doc, 'g'))).toThrow(CommandError);
  });

  it('nhóm rồi bỏ nhóm: hiển thị như cũ, uid giữ 100 %', () => {
    const doc = body(
      '<g transform="rotate(90)">' +
        R('a', 'width="4" height="2"') +
        '</g>' +
        R('b', 'x="5" width="3" height="3" transform="translate(1 1)"'),
    );
    const before = boxes(doc, [U('a'), U('b')]);
    const g = groupNodes(doc, [byId(doc, 'a'), byId(doc, 'b')]);
    applyCommand(doc, g.batch);
    applyCommand(doc, ungroupNode(doc, g.group).batch);
    same(doc, [U('a'), U('b')], before);
    expect(findByUid(doc, U('a'))).not.toBeNull();
    expect(findByUid(doc, U('b'))).not.toBeNull();
  });
});

describe('deleteNodes: xóa kèm khoảng trắng đứng trước, nhóm rỗng tự xóa', () => {
  it('xóa con cuối của g: g rỗng bị xóa; hoàn tác về đúng byte', () => {
    const text = `<svg ${NS}>\n  <g id="g">\n    ${R('a', 'width="1" height="1"')}\n  </g>\n  ${R('b', 'width="1" height="1"')}\n</svg>\n`;
    const doc = open(text);
    const inv = applyCommand(doc, deleteNodes(doc, [byId(doc, 'a')]).batch);
    expect(serialize(doc)).toBe(`<svg ${NS}>\n  ${R('b', 'width="1" height="1"')}\n</svg>\n`);
    applyCommand(doc, inv);
    expect(serialize(doc)).toBe(text);
  });

  it('không xóa lớp rỗng (lớp là của người dùng)', () => {
    const doc = body(`<g id="L" data-mat-layer="Nền">${R('a', 'width="1" height="1"')}</g>`);
    applyCommand(doc, deleteNodes(doc, [byId(doc, 'a')]).batch);
    expect(byId(doc, 'L')).toBeDefined();
  });

  it('trả uid của mọi phần tử bị xóa (để cảnh báo binding)', () => {
    const doc = body(
      `<g id="g" data-mat-uid="el_gqqqqqqqqq">${R('a', 'width="1" height="1"')}</g>`,
    );
    expect(deleteNodes(doc, [byId(doc, 'g')]).uids.sort()).toEqual([
      'el_aqqqqqqqqq',
      'el_gqqqqqqqqq',
    ]);
  });
});
