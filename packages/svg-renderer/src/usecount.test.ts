// @vitest-environment jsdom
// T112 (rà soát bảo mật): đếm `use` phải bao cả `use` nằm trong `defs` (Chrome dựng bóng cho MỌI `use`, kể cả không ai dùng)
// và độ sâu chuỗi `use` (chuỗi 500 `use` nối nhau tốn 12 giây ở Chrome, 1.000 trở lên treo hẳn dù chỉ 2.000 phần tử).
import { describe, expect, it } from 'vitest';
import { MAX_USE_DEPTH, MAX_USE_WORK, countEffective } from './usecount.ts';
import { mountScreen } from './mount.ts';
import { parseSvg, sanitizeSvg } from './sanitize.ts';

const H = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
const layout = {
  viewBox: [0, 0, 10, 10] as [number, number, number, number],
  fitMode: 'contain' as const,
  elements: [],
};

const chain = (n: number, outer = true): string => {
  let d = '<g id="u0"><rect width="1" height="1"/></g>';
  for (let i = 1; i < n; i++) d += `<g id="u${i}"><use href="#u${i - 1}"/></g>`;
  return `${H}<defs>${d}</defs>${outer ? `<use href="#u${n - 1}"/>` : ''}</svg>`;
};
const bombDefs = (levels: number, fan: number): string => {
  let d = '<g id="l0"><rect width="1" height="1"/></g>';
  for (let i = 1; i <= levels; i++)
    d += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(fan)}</g>`;
  return d;
};
const count = (svg: string) => {
  const root = parseSvg(svg);
  sanitizeSvg(root);
  return countEffective(root, 100_000);
};

describe('countEffective: độ sâu chuỗi use', () => {
  it('đo số tầng use nối nhau', () => {
    expect(count(chain(1)).depth).toBe(1);
    expect(count(chain(5)).depth).toBe(5);
    expect(count(chain(40, false)).depth).toBe(39); // cả khi không ai dùng từ ngoài defs
  });

  it('chuỗi use sâu hơn ngưỡng bị mountScreen từ chối, kể cả chuỗi nằm hết trong defs', () => {
    for (const outer of [true, false])
      expect(() =>
        mountScreen(document.createElement('div'), chain(MAX_USE_DEPTH + 2, outer), layout),
      ).toThrow(/use/);
  });

  it('chuỗi đúng ngưỡng vẫn dựng được', () => {
    const m = mountScreen(document.createElement('div'), chain(MAX_USE_DEPTH, true), layout);
    expect(m.svg.querySelectorAll('use').length).toBe(MAX_USE_DEPTH);
  });
});

describe('countEffective: công việc dựng bóng của mọi use', () => {
  it('bom nằm hết trong defs (không use ngoài defs) bị từ chối', () => {
    const svg = `${H}<defs>${bombDefs(9, 10)}</defs><rect width="1" height="1"/></svg>`;
    expect(count(svg).work).toBeGreaterThan(MAX_USE_WORK);
    expect(() => mountScreen(document.createElement('div'), svg, layout)).toThrow(/use/);
  });

  it('bom bọc trong pattern được tham chiếu bởi fill bị từ chối', () => {
    const svg =
      `${H}<defs>${bombDefs(9, 10)}<pattern id="p" width="1" height="1"><use href="#l9"/></pattern></defs>` +
      '<rect width="5" height="5" fill="url(#p)"/></svg>';
    expect(() => mountScreen(document.createElement('div'), svg, layout)).toThrow(/use/);
  });

  it('thư viện ký hiệu điển hình (use 3 tầng, vài chục bản sao) không bị chạm ngưỡng', () => {
    const svg =
      `${H}<defs><symbol id="a"><rect width="1" height="1"/></symbol>` +
      '<g id="b"><use href="#a"/><use href="#a"/></g><g id="c"><use href="#b"/><use href="#b"/></g></defs>' +
      '<use href="#c"/>'.repeat(40) +
      '</svg>';
    const r = count(svg);
    expect(r.depth).toBe(3);
    expect(r.work).toBeLessThan(MAX_USE_WORK);
    expect(() => mountScreen(document.createElement('div'), svg, layout)).not.toThrow();
  });
});
