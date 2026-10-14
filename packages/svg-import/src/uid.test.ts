// T040: test UID (FR-019, D5; contract §5). Viết TRƯỚC, phải đỏ.
import { describe, expect, it } from 'vitest';
import { assignUids, isBindable, makeCryptoUid, makeSeededUid } from './uid.ts';
import { parseBody } from './test-helpers.ts';

const UID_FORMAT = /^el_[a-z2-7]{10}$/;

describe('isBindable', () => {
  it('phần tử vẽ được ngoài defs, clipPath, mask, symbol, pattern, marker, filter', () => {
    const root = parseBody(
      '<g id="g1"><rect id="r1"/><tspan id="x"/></g>' +
        '<defs><rect id="r2"/><g id="g2"><circle id="c2"/></g></defs>' +
        '<clipPath id="cp"><rect id="r3"/></clipPath><mask id="m"><rect id="r4"/></mask>' +
        '<symbol id="s"><rect id="r5"/></symbol><pattern id="p"><rect id="r6"/></pattern>' +
        '<marker id="mk"><path id="r7"/></marker><use id="u1"/><text id="t1">a</text><image id="i1"/>',
    );
    const q = (id: string) => root.querySelector('#' + id)!;
    for (const id of ['g1', 'r1', 'u1', 't1', 'i1']) expect(isBindable(q(id)), id).toBe(true);
    for (const id of ['r2', 'g2', 'c2', 'r3', 'r4', 'r5', 'r6', 'r7', 'x', 'cp', 'm', 's'])
      expect(isBindable(q(id)), id).toBe(false);
    expect(isBindable(root)).toBe(false);
  });
});

describe('bộ sinh UID', () => {
  it('theo seed: tất định, đúng định dạng, seed khác cho chuỗi khác', () => {
    const a = makeSeededUid(42);
    const b = makeSeededUid(42);
    const c = makeSeededUid(43);
    const sa = Array.from({ length: 50 }, () => a());
    const sb = Array.from({ length: 50 }, () => b());
    const sc = Array.from({ length: 50 }, () => c());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    for (const u of sa) expect(u).toMatch(UID_FORMAT);
    expect(new Set(sa).size).toBe(50);
  });
  it('bộ sinh mật mã: đúng định dạng, không trùng', () => {
    const g = makeCryptoUid();
    const s = Array.from({ length: 200 }, () => g());
    for (const u of s) expect(u).toMatch(UID_FORMAT);
    expect(new Set(s).size).toBe(200);
  });
});

describe('assignUids', () => {
  it('gán UID duy nhất cho phần tử gắn được; bỏ data-mat-uid nguồn (kể cả trùng)', () => {
    const root = parseBody(
      '<rect data-mat-uid="el_victim12345" width="1" height="1"/><rect data-mat-uid="el_victim12345" width="1" height="1"/><defs><rect id="d"/></defs>',
    );
    const { elements } = assignUids(root, makeSeededUid(1));
    const rects = Array.from(root.querySelectorAll('rect[data-mat-uid]'));
    expect(rects).toHaveLength(2);
    const uids = rects.map((r) => r.getAttribute('data-mat-uid')!);
    expect(new Set(uids).size).toBe(2);
    for (const u of uids) {
      expect(u).toMatch(UID_FORMAT);
      expect(u).not.toBe('el_victim12345');
    }
    expect(root.querySelector('#d')!.hasAttribute('data-mat-uid')).toBe(false);
    expect(elements.map((e) => e.uid)).toEqual(uids);
  });
  it('bộ sinh trả trùng: vẫn duy nhất', () => {
    const root = parseBody('<rect/><rect/><rect/>');
    const seq = ['el_aaaaaaaaaa', 'el_aaaaaaaaaa', 'el_bbbbbbbbbb', 'el_aaaaaaaaaa', 'el_cccccccccc'];
    let i = 0;
    assignUids(root, () => seq[i++ % seq.length]);
    const uids = Array.from(root.querySelectorAll('rect')).map((r) => r.getAttribute('data-mat-uid'));
    expect(new Set(uids).size).toBe(3);
  });
  it('ElementInfo: thẻ, tên, cha (UID của tổ tiên gắn được gần nhất), độ sâu', () => {
    const root = parseBody(
      '<g id="Bon_1"><rect id="rect123"/><g id="in"><circle/></g></g><path id="path5"/>',
    );
    const { elements, named } = assignUids(root, makeSeededUid(7));
    expect(elements.map((e) => e.tag)).toEqual(['g', 'rect', 'g', 'circle', 'path']);
    expect(elements[0]).toMatchObject({ name: 'Bon_1', parent: null, depth: 0, label: 'Bon_1' });
    expect(elements[1]).toMatchObject({ name: 'rect 1', parent: elements[0].uid, depth: 1 });
    expect(elements[1].label).toBeUndefined();
    expect(elements[3]).toMatchObject({ parent: elements[2].uid, depth: 2 });
    expect(elements[4]).toMatchObject({ name: 'path 1', parent: null, depth: 0 });
    // data-mat-name chỉ ghi cho phần tử có nhãn: Bon_1 và "in"
    expect(named).toBe(2);
    expect(root.querySelector('rect')!.hasAttribute('data-mat-name')).toBe(false);
  });
  it('data-mat-name có sẵn (do importer ghi từ inkscape:label) được giữ', () => {
    const root = parseBody('<rect data-mat-name="Bồn chính" id="rect9"/>');
    const { elements } = assignUids(root, makeSeededUid(7));
    expect(elements[0].name).toBe('Bồn chính');
    expect(root.querySelector('rect')!.getAttribute('data-mat-name')).toBe('Bồn chính');
  });
  it('cây sâu 30 cấp và 5.000 phần tử không tràn ngăn xếp', () => {
    let body = '';
    for (let i = 0; i < 30; i++) body += '<g>';
    body += '<rect/>'.repeat(5000);
    body += '</g>'.repeat(30);
    const root = parseBody(body);
    const { elements } = assignUids(root, makeSeededUid(3));
    expect(elements).toHaveLength(5030);
  });
});
