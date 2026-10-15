// T098: test áp lựa chọn đối chiếu (FR-027, FR-028; contract svg-import §7). Viết TRƯỚC, phải đỏ.
import { describe, expect, it } from 'vitest';
import { applyMatch, assertAllowlisted, importSvg, makeSeededUid } from './index.ts';
import { doc } from './test-helpers.ts';

const VB = 'width="1000" height="600" viewBox="0 0 1000 600"';
const U = (c: string) => 'el_' + c.repeat(10);
const r1 = (x: number, uid = '') => `<rect x="${x}" y="100" width="40" height="30" ${uid ? `data-mat-uid="${uid}" data-mat-name="Ô ${uid[3]}"` : ''}/>`;

/** Bản cũ: hai ô giống hệt (a, b) và một ô riêng (c). Bản mới: một ô giống hệt cộng ô riêng, có thêm một mới. */
const OLD = doc(r1(100, U('a')) + r1(100, U('b')) + r1(500, U('c')), VB);
const NEW = doc(r1(100) + r1(500) + `<circle cx="800" cy="400" r="20"/>`, VB);
const imp = (extra = {}) => {
  const r = importSvg(NEW, { uid: makeSeededUid('am'), previous: { svg: OLD }, ...extra });
  if (!r.ok) throw new Error(r.error.message);
  return r;
};
const uidOf = (svg: string, path: string): string => {
  const tag = path.split('/').pop()!.split('[')[0];
  const idx = Number(path.match(/\[(\d+)\]$/)![1]);
  const list = [...svg.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => m[0]);
  return list[idx - 1].match(/data-mat-uid="([^"]+)"/)![1];
};

describe('applyMatch', () => {
  it('trước khi chọn: ô riêng mang UID cũ, mục cần chọn và phần tử mới mang UID mới', () => {
    const r = imp();
    expect(r.match!.pairs.map((p) => p.oldUid)).toEqual([U('c')]);
    expect(r.match!.ambiguous.map((a) => a.newPath)).toEqual(['/svg/rect[1]']);
    expect(r.match!.added).toEqual(['/svg/circle[1]']);
    expect(uidOf(r.svg, '/svg/rect[2]')).toBe(U('c'));
    expect(uidOf(r.svg, '/svg/rect[1]')).not.toMatch(/^el_(a|b)+$/);
    expect(r.elements.find((e) => e.uid === U('c'))).toBeDefined();
  });

  it('chọn một ứng viên: SVG cuối mang UID cũ đã chọn, ứng viên còn lại thành mồ côi', () => {
    const r = imp();
    const out = applyMatch(r, { '/svg/rect[1]': U('b') });
    expect(uidOf(out.svg, '/svg/rect[1]')).toBe(U('b'));
    expect(out.elements.map((e) => e.uid)).toContain(U('b'));
    expect(out.orphans).toEqual([{ oldUid: U('a'), name: 'Ô a', hasBinding: false, hasEvent: false }]);
    expect(out.rejected).toEqual([]);
    expect(() => assertAllowlisted(out.svg)).not.toThrow();
  });

  it('chọn "Mới" (null) hoặc không chọn: giữ UID mới; cả hai ứng viên thành mồ côi', () => {
    const r = imp();
    const fresh = uidOf(r.svg, '/svg/rect[1]');
    for (const choices of [{ '/svg/rect[1]': null }, {}]) {
      const out = applyMatch(r, choices);
      expect(uidOf(out.svg, '/svg/rect[1]')).toBe(fresh);
      expect(out.orphans.map((o) => o.oldUid).sort()).toEqual([U('a'), U('b')]);
    }
  });

  it('UID cuối duy nhất; cha của phần tử trong elements khớp UID cuối', () => {
    const r = imp();
    const out = applyMatch(r, { '/svg/rect[1]': U('a') });
    const uids = out.elements.map((e) => e.uid);
    expect(new Set(uids).size).toBe(uids.length);
    const all = [...out.svg.matchAll(/data-mat-uid="([^"]+)"/g)].map((m) => m[1]);
    expect(all.sort()).toEqual([...uids].sort());
    for (const e of out.elements) if (e.parent !== null) expect(uids).toContain(e.parent);
  });

  it('lựa chọn ngoài danh sách ứng viên bị từ chối và giữ UID mới', () => {
    const r = imp();
    const out = applyMatch(r, { '/svg/rect[1]': U('c') });
    expect(out.rejected).toEqual(['/svg/rect[1]']);
    expect(uidOf(out.svg, '/svg/rect[1]')).not.toBe(U('c'));
    expect(uidOf(out.svg, '/svg/rect[2]')).toBe(U('c'));
  });

  it('hai mục cùng chọn một UID cũ: mục đầu được, mục sau bị từ chối', () => {
    const O = doc(r1(100, U('a')) + r1(100, U('b')), VB);
    const N = doc(r1(100) + r1(100), VB);
    const r = importSvg(N, { uid: makeSeededUid('d'), previous: { svg: O } });
    if (!r.ok) throw new Error('nhập lỗi');
    expect(r.match!.ambiguous).toHaveLength(2);
    const out = applyMatch(r, { '/svg/rect[1]': U('a'), '/svg/rect[2]': U('a') });
    expect(out.rejected).toEqual(['/svg/rect[2]']);
    expect(uidOf(out.svg, '/svg/rect[1]')).toBe(U('a'));
    expect(uidOf(out.svg, '/svg/rect[2]')).not.toBe(U('a'));
    expect(out.orphans.map((o) => o.oldUid)).toEqual([U('b')]);
  });

  it('không có thông tin đối chiếu (nhập lần đầu): trả nguyên, không mồ côi', () => {
    const r = importSvg(NEW, { uid: makeSeededUid('first') });
    if (!r.ok) throw new Error('nhập lỗi');
    const out = applyMatch(r, {});
    expect(out.svg).toBe(r.svg);
    expect(out.orphans).toEqual([]);
  });

  it('không đổi nội dung khác: chỉ khác nhau ở giá trị UID', () => {
    const r = imp();
    const out = applyMatch(r, { '/svg/rect[1]': U('a') });
    const norm = (s: string) => s.replace(/data-mat-uid="[^"]+"/g, 'U');
    expect(norm(out.svg)).toBe(norm(r.svg));
  });
});

describe('importSvg với previous', () => {
  it('giữ UID nguồn của phần tử khớp bản cũ, bỏ UID lạ, UID mới không trùng UID cũ', () => {
    const N = doc(r1(100, U('a')) + r1(500, U('z')), VB);
    const O = doc(r1(100, U('a')) + r1(500, U('c')), VB);
    const r = importSvg(N, { uid: makeSeededUid('k'), previous: { svg: O } });
    if (!r.ok) throw new Error('nhập lỗi');
    expect(uidOf(r.svg, '/svg/rect[1]')).toBe(U('a'));
    const second = uidOf(r.svg, '/svg/rect[2]');
    expect(second).toBe(U('c'));
    expect(r.match!.pairs).toHaveLength(2);
  });

  it('không có previous: UID nguồn bị bỏ như cũ, không có match', () => {
    const N = doc(r1(100, U('a')), VB);
    const r = importSvg(N, { uid: makeSeededUid('k') });
    if (!r.ok) throw new Error('nhập lỗi');
    expect(r.match).toBeUndefined();
    expect(r.report.match).toBeNull();
    expect(uidOf(r.svg, '/svg/rect[1]')).not.toBe(U('a'));
  });
});
