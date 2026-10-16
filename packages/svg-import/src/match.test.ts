// T098: test đối chiếu nhập lại (FR-026, FR-027, SC-009; contract svg-import §7). Viết TRƯỚC, phải đỏ.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importSvg, makeSeededUid, matchSvg } from './index.ts';
import type { MatchResult } from './index.ts';
import { doc } from './test-helpers.ts';

const FIX = resolve(__dirname, '../../../tests/fixtures/svg-import/reimport');
const VB = 'width="1000" height="600" viewBox="0 0 1000 600"';
const U = (c: string) => 'el_' + c.repeat(10);
const rect = (x: number, y: number, w = 40, h = 30, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${extra}/>`;
const old = (body: string) => doc(body, VB);
const neu = (body: string) => doc(body, VB);
const run = (o: string, n: string, opt = {}): MatchResult => matchSvg(old(o), neu(n), opt);
const oldOf = (r: MatchResult, newPath: string) => r.pairs.find((p) => p.newPath === newPath);

describe('bước 1: UID', () => {
  it('khớp tự động theo data-mat-uid có trong bản cũ khi phần tử dời gần (D <= 0,05)', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      rect(40, 30, 40, 30, `data-mat-uid="${U('a')}"`), // lệch 30 px: D = 30 / 1166 = 0,026
    );
    expect(r.pairs).toEqual([
      { newPath: '/svg/rect[1]', oldUid: U('a'), step: 1, d: expect.any(Number) },
    ]);
    expect(r.added).toEqual([]);
    expect(r.orphans).toEqual([]);
  });

  // F9 (feature 011, T213): UID nằm trong file nhập là dữ liệu của file, có thể giả; D đến 0,25 đường chéo vẫn nhận
  // UID của nút có binding/sự kiện. Bước 1 chỉ tự nhận khi D <= 0,05 và phần tử cũ không có sự kiện ghi.
  it('UID khớp nhưng dời xa (0,05 < D <= 0,25): không tự nhận, hỏi với UID đó là ứng viên', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      rect(100, 90, 40, 30, `data-mat-uid="${U('a')}"`), // D = 90 / 1166 = 0,077
    );
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous).toEqual([
      {
        newPath: '/svg/rect[1]',
        candidates: [expect.objectContaining({ oldUid: U('a') })],
      },
    ]);
    expect(r.orphans).toEqual([]);
  });

  it('UID ở xa vẫn là ứng viên dù có ba hình khác gần hơn', () => {
    const O =
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`) +
      rect(200, 180, 40, 30, `data-mat-uid="${U('b')}"`) +
      rect(205, 180, 40, 30, `data-mat-uid="${U('c')}"`) +
      rect(210, 180, 40, 30, `data-mat-uid="${U('d')}"`);
    const r = run(
      O,
      `<g>${rect(200, 200, 40, 30, `data-mat-uid="${U('a')}"`)}</g>` +
        rect(600, 500, 40, 30) +
        rect(605, 500, 40, 30) +
        rect(610, 500, 40, 30),
    );
    const a = r.ambiguous.find((x) => x.newPath === '/svg/g[1]/rect[1]');
    expect(a?.candidates.map((c) => c.oldUid)).toContain(U('a'));
    expect(r.pairs.some((p) => p.oldUid === U('a'))).toBe(false);
  });

  it('UID của phần tử cũ có sự kiện ghi: không tự nhận ở bước 1 dù gần, hỏi người dùng', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      `<g>${rect(40, 30, 40, 30, `data-mat-uid="${U('a')}"`)}</g>`,
      { events: new Set([U('a')]) },
    );
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous.map((x) => [x.newPath, x.candidates.map((c) => c.oldUid)])).toEqual([
      ['/svg/g[1]/rect[1]', [U('a')]],
    ]);
  });

  it('phần tử có sự kiện không đổi vị trí vẫn khớp tự động ở bước sau (cấu trúc), không phiền người dùng', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      { events: new Set([U('a')]) },
    );
    expect(r.pairs).toEqual([{ newPath: '/svg/rect[1]', oldUid: U('a'), step: 3, d: 0 }]);
  });

  it('UID ngoài tập bản cũ bị bỏ (phần tử thành mới)', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      rect(500, 400, 40, 30, `data-mat-uid="${U('z')}"`),
    );
    expect(r.pairs).toEqual([]);
    expect(r.added).toEqual(['/svg/rect[1]']);
    expect(r.orphans.map((o) => o.oldUid)).toEqual([U('a')]);
  });

  it('UID trùng trên hai phần tử mới: không dùng cho cả hai', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`) +
        rect(300, 300, 40, 30, `data-mat-uid="${U('a')}"`),
    );
    expect(r.pairs.filter((p) => p.step === 1)).toEqual([]);
  });

  it('UID khác thẻ không khớp', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      `<circle cx="30" cy="25" r="15" data-mat-uid="${U('a')}"/>`,
    );
    expect(r.pairs).toEqual([]);
  });

  it('UID khớp nhưng hình cách quá xa (D > 0,25): không khớp', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      rect(900, 560, 40, 30, `data-mat-uid="${U('a')}"`),
    );
    expect(r.pairs).toEqual([]);
  });

  it('opt.uids giới hạn tập UID của bản cũ', () => {
    const r = run(
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      rect(10, 10, 40, 30, `data-mat-uid="${U('a')}"`),
      { uids: new Set([U('b')]) },
    );
    expect(r.pairs).toEqual([]);
  });
});

describe('bước 2: id', () => {
  const o = (id: string) => rect(10, 10, 40, 30, `id="${id}" data-mat-uid="${U('a')}"`);
  it('id duy nhất ở cả hai bản và D <= 0,25', () => {
    const r = run(o('tank'), rect(40, 40, 40, 30, 'id="tank"'));
    expect(r.pairs).toEqual([
      { newPath: '/svg/rect[1]', oldUid: U('a'), step: 2, d: expect.any(Number) },
    ]);
  });

  it('id trùng ở một phía: không dùng', () => {
    const dupOld =
      rect(10, 10, 40, 30, `id="x" data-mat-uid="${U('a')}"`) +
      rect(400, 300, 40, 30, `id="x" data-mat-uid="${U('b')}"`);
    const r = run(dupOld, rect(80, 80, 40, 30, 'id="x"'));
    expect(r.pairs.filter((p) => p.step === 2)).toEqual([]);
    const dupNew = run(o('x'), rect(10, 10, 40, 30, 'id="x"') + rect(400, 300, 40, 30, 'id="x"'));
    expect(dupNew.pairs.filter((p) => p.step === 2)).toEqual([]);
  });
});

describe('bước 3: cấu trúc dưới cha đã khớp', () => {
  it('cùng chỉ số trong anh em cùng thẻ, D <= 0,05, g phải cùng số con', () => {
    const O =
      `<g data-mat-uid="${U('g')}">` +
      rect(100, 100, 40, 30, `data-mat-uid="${U('a')}"`) +
      rect(500, 100, 40, 30, `data-mat-uid="${U('b')}"`) +
      '</g>';
    const N = '<g>' + rect(110, 105, 40, 30) + rect(505, 100, 40, 30) + '</g>';
    const r = run(O, N);
    const by = (p: string) => oldOf(r, p);
    expect(by('/svg/g[1]/rect[1]')).toMatchObject({ oldUid: U('a'), step: 3 });
    expect(by('/svg/g[1]/rect[2]')).toMatchObject({ oldUid: U('b'), step: 3 });
    expect(by('/svg/g[1]')).toMatchObject({ oldUid: U('g') });
  });

  it('khi cha chưa khớp thì không dùng bước 3', () => {
    const O =
      `<g data-mat-uid="${U('g')}">` +
      rect(100, 100, 40, 30, `data-mat-uid="${U('a')}"`) +
      rect(500, 100) +
      '</g>';
    const N =
      '<g>' +
      rect(100, 100, 40, 30) +
      rect(500, 100) +
      '</g>' +
      rect(300, 300) +
      rect(700, 450) +
      rect(800, 450);
    const r = run(O, N);
    expect(r.pairs.filter((p) => p.step === 3).length).toBeLessThanOrEqual(2);
  });

  it('hàng hình giống nhau cách < 5 % đường chéo, chèn một phần tử: không gán lệch chỉ số', () => {
    const row = (xs: number[], uid: boolean) =>
      xs
        .map((x, i) => rect(x, 100, 30, 50, uid ? `data-mat-uid="${U('abcdefghij'[i])}"` : ''))
        .join('');
    const xs = [30, 70, 110, 150, 190, 230];
    const O = row(xs, true);
    // chèn một rect ở đầu danh sách (lệch chỉ số 1) nhưng ở xa hàng
    const N = rect(30, 400, 30, 20) + row(xs, false);
    const r = run(O, N);
    for (const p of r.pairs) {
      const idx = Number(p.newPath.match(/rect\[(\d+)\]/)![1]);
      expect(p.oldUid, p.newPath).toBe(U('abcdefghij'[idx - 2]));
    }
  });
});

describe('bước 4: hình học duy nhất', () => {
  it('ứng viên duy nhất D <= 0,005 dù khác cha, khác chỉ số', () => {
    const O =
      rect(100, 100, 40, 30, `data-mat-uid="${U('a')}"`) +
      rect(400, 300, 40, 30, `data-mat-uid="${U('b')}"`);
    const N =
      rect(402, 300, 40, 30) + '<g>' + rect(100, 100, 40, 30) + rect(700, 500, 20, 20) + '</g>';
    const r = run(O, N);
    expect(oldOf(r, '/svg/rect[1]')).toMatchObject({ oldUid: U('b'), step: 4 });
    expect(oldOf(r, '/svg/g[1]/rect[1]')).toMatchObject({ oldUid: U('a'), step: 4 });
    expect(r.added).toContain('/svg/g[1]/rect[2]');
  });

  it('hai ứng viên giống nhau: mơ hồ, không tự gán, tối đa 3 ứng viên xếp theo D', () => {
    const O = [100, 101, 102, 103, 104]
      .map((x, i) => rect(x, 100, 40, 30, `data-mat-uid="${U('abcde'[i])}"`))
      .join('');
    const r = run(O, rect(101, 100, 40, 30) + rect(900, 500));
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].newPath).toBe('/svg/rect[1]');
    expect(r.ambiguous[0].candidates.length).toBeLessThanOrEqual(3);
    const ds = r.ambiguous[0].candidates.map((c) => c.d);
    expect(ds).toEqual([...ds].sort((a, b) => a - b));
    expect(r.ambiguous[0].candidates[0].d).toBe(0);
    expect(r.added).toEqual(['/svg/rect[2]']);
  });

  it('ứng viên tốt nhất không hơn hạng hai ít nhất 0,002: mơ hồ', () => {
    const O =
      rect(100, 100, 40, 30, `data-mat-uid="${U('a')}"`) +
      rect(102, 100, 40, 30, `data-mat-uid="${U('b')}"`);
    const r = run(O, rect(100.5, 100, 40, 30));
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous).toHaveLength(1);
  });

  it('phần tử cũ khớp tối đa một: hai phần tử mới cùng chỉ vào một cũ thành cần chọn', () => {
    const O = rect(100, 100, 40, 30, `data-mat-uid="${U('a')}"`);
    const r = run(O, rect(100, 100, 40, 30) + rect(100, 100, 40, 30));
    expect(r.pairs).toEqual([]);
    expect(r.ambiguous.map((a) => a.newPath).sort()).toEqual(['/svg/rect[1]', '/svg/rect[2]']);
  });
});

describe('mới, mồ côi, thông tin ứng viên', () => {
  it('mới: không ứng viên cùng thẻ D <= 0,25; mồ côi mang tên và cờ binding/sự kiện', () => {
    const O =
      rect(100, 100, 40, 30, `data-mat-uid="${U('a')}" data-mat-name="Bơm 1"`) +
      rect(800, 500, 40, 30, `data-mat-uid="${U('b')}" data-mat-name="Van"`);
    const r = run(O, rect(100, 100, 40, 30) + `<circle cx="500" cy="300" r="10"/>`, {
      bound: new Set([U('b')]),
      events: new Set([U('b')]),
    });
    expect(r.pairs.map((p) => p.oldUid)).toEqual([U('a')]);
    expect(r.added).toEqual(['/svg/circle[1]']);
    expect(r.orphans).toEqual([{ oldUid: U('b'), name: 'Van', hasBinding: true, hasEvent: true }]);
  });

  it('ứng viên của mục cần chọn mang tên và cờ để giao diện hiển thị', () => {
    const O =
      rect(100, 100, 40, 30, `data-mat-uid="${U('a')}" data-mat-name="Bồn A"`) +
      rect(100, 100, 40, 30, `data-mat-uid="${U('b')}" data-mat-name="Bồn B"`);
    const r = run(O, rect(100, 100, 40, 30), { bound: new Set([U('b')]) });
    expect(r.ambiguous[0].candidates).toEqual([
      { oldUid: U('a'), d: 0, name: 'Bồn A', hasBinding: false, hasEvent: false },
      { oldUid: U('b'), d: 0, name: 'Bồn B', hasBinding: true, hasEvent: false },
    ]);
    expect(r.orphans).toEqual([]);
  });

  it('tất định: cùng đầu vào cho cùng kết quả', () => {
    const O =
      rect(100, 100, 40, 30, `data-mat-uid="${U('a')}"`) +
      rect(300, 100, 40, 30, `data-mat-uid="${U('b')}"`);
    const N = rect(300, 100, 40, 30) + rect(100, 100, 40, 30);
    expect(run(O, N)).toEqual(run(O, N));
  });
});

/** UID duy nhất theo chỉ số (10 chữ cái, hệ 26). */
const uidOf = (i: number): string => {
  let s = '';
  for (let k = 0, v = i; k < 10; k++, v = Math.floor(v / 26))
    s = String.fromCharCode(97 + (v % 26)) + s;
  return 'el_' + s;
};

describe('hiệu năng', () => {
  const grid = (n: number, uid: boolean, reverse: boolean) => {
    const cells: string[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i % 200) * 10 + 2;
      const y = Math.floor(i / 200) * 10 + 2;
      cells.push(
        `<rect x="${x}" y="${y}" width="6" height="6" ${uid ? `data-mat-uid="${uidOf(i)}"` : ''}/>`,
      );
    }
    return doc(
      (reverse ? cells.reverse() : cells).join(''),
      'width="2000" height="1000" viewBox="0 0 2000 1000"',
    );
  };
  for (const reverse of [false, true]) {
    it(`20.000 phần tử trong <= 3 s (thứ tự mới ${reverse ? 'đảo ngược' : 'giữ nguyên'})`, () => {
      const O = grid(20000, true, false);
      const N = grid(20000, false, reverse);
      const t0 = performance.now();
      const r = matchSvg(O, N);
      const ms = performance.now() - t0;
      expect(r.pairs.length + r.ambiguous.length + r.added.length).toBe(20000);
      expect(r.pairs.length).toBe(20000);
      expect(ms).toBeLessThan(3000);
    }, 30_000);
  }
});

interface Answer {
  pair: string;
  answers: Array<{ new: string; old: string | null; ambiguous?: boolean }>;
}
const pairDirs = readdirSync(FIX, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe('bộ cặp nhập lại (T097)', () => {
  it('có >= 6 cặp và >= 150 phần tử có đáp án', () => {
    expect(pairDirs.length).toBeGreaterThanOrEqual(6);
    let n = 0;
    for (const d of pairDirs)
      n += (JSON.parse(readFileSync(resolve(FIX, d, 'answer.json'), 'utf8')) as Answer).answers
        .length;
    expect(n).toBeGreaterThanOrEqual(150);
  });

  let withBinding = 0;
  let correct = 0;
  const wrongAll: string[] = [];
  const summary: string[] = [];
  for (const d of pairDirs) {
    it(`${d}: 0 gán sai tự động; mơ hồ thì hỏi; mồ côi đúng`, () => {
      const v1 = readFileSync(resolve(FIX, d, 'v1.svg'));
      const v2 = readFileSync(resolve(FIX, d, 'v2.svg'));
      const ans = JSON.parse(readFileSync(resolve(FIX, d, 'answer.json'), 'utf8')) as Answer;
      const r = importSvg(v2, {
        fileName: 'v2.svg',
        uid: makeSeededUid('t'),
        previous: { svg: v1.toString('utf8') },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.match).toBeDefined();
      const m = r.match!;
      const truth = new Map(ans.answers.map((a) => [a.new, a]));
      let ok = 0;
      for (const p of m.pairs) {
        const t = truth.get(p.newPath);
        expect(t, `${d}: ${p.newPath} không có trong đáp án`).toBeDefined();
        if (t!.old !== p.oldUid)
          wrongAll.push(`${d} ${p.newPath} -> ${p.oldUid} (đáp án ${t!.old})`);
        else ok++;
      }
      for (const a of ans.answers) if (a.old !== null) withBinding++;
      correct += ok;
      // mọi phần tử có đáp án phải rơi vào đúng một trong: pairs, ambiguous, added
      const seen = new Set([
        ...m.pairs.map((p) => p.newPath),
        ...m.ambiguous.map((a) => a.newPath),
        ...m.added,
      ]);
      expect(seen.size).toBe(ans.answers.length);
      for (const a of ans.answers)
        if (a.ambiguous)
          expect(
            m.ambiguous.map((x) => x.newPath),
            d + ' ' + a.new,
          ).toContain(a.new);
      for (const a of m.ambiguous) expect(a.candidates.length).toBeLessThanOrEqual(3);
      // mồ côi: phần tử cũ không còn trong đáp án phải có mặt (không bị gán nhầm cho phần tử khác)
      const v1Uids = [...v1.toString('utf8').matchAll(/data-mat-uid="(el_[a-z2-7]{10})"/g)].map(
        (x) => x[1],
      );
      const claimed = new Set(ans.answers.map((a) => a.old).filter((x): x is string => x !== null));
      const removed = v1Uids.filter((u) => !claimed.has(u));
      const orphanOrCand = new Set([
        ...m.orphans.map((o) => o.oldUid),
        ...m.ambiguous.flatMap((a) => a.candidates.map((c) => c.oldUid)),
      ]);
      for (const u of removed)
        expect(orphanOrCand.has(u), `${d}: ${u} đã xóa phải là mồ côi`).toBe(true);
      expect(r.report.match).toEqual({
        kept: m.pairs.length,
        added: m.added.length,
        ambiguous: m.ambiguous.length,
        orphans: m.orphans.length,
      });
      summary.push(
        `${d}: ${ok}/${ans.answers.filter((a) => a.old !== null).length} khớp đúng, ${m.ambiguous.length} cần chọn, ${m.added.length} mới, ${m.orphans.length} mồ côi`,
      );
    });
  }

  it('toàn bộ: 0 gán sai tự động và >= 90 % phần tử có binding khớp đúng', () => {
    console.log(summary.join('\n'));
    expect(wrongAll).toEqual([]);
    expect(withBinding).toBeGreaterThan(0);
    expect(correct / withBinding).toBeGreaterThanOrEqual(0.9);
  });

  it('cặp lưới giống hệt: 12 phần tử cần chọn, mỗi mục tối đa 3 ứng viên', () => {
    if (!existsSync(resolve(FIX, '06-identical-grid'))) return;
    const v1 = readFileSync(resolve(FIX, '06-identical-grid/v1.svg'), 'utf8');
    const v2 = readFileSync(resolve(FIX, '06-identical-grid/v2.svg'));
    const r = importSvg(v2, { uid: makeSeededUid('g'), previous: { svg: v1 } });
    expect(r.ok && r.match!.ambiguous.length).toBe(12);
    expect(r.ok && r.match!.pairs.length).toBe(2);
  });
});
