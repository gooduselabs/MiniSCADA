// @vitest-environment jsdom
// Test đỏ T019 (FR-024): luật phụ thuộc NỘI DUNG SVG, chỉ ở bản TS (core/ không parse SVG, Constitution II).
// Cài ở T060 (`rules-04-svg.ts`, nối vào validate.ts khi checkSvg). Test dựng SVG trong bộ nhớ, đưa vào
// vector hợp lệ `v04-valid-full` (thay `graphics/main.svg` và file binding) và gọi `validateProject` với
// `checkSvg: true`; DOM do jsdom cung cấp. Dùng kiểu JSON tùy ý cục bộ vì không phụ thuộc kiểu 0.4 chi tiết.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors/v04-valid-full');
const SVG = 'graphics/main.svg';
const MB = 'screens/main.svg1.bindings.json';
const MS = 'screens/main.screen.json';
const NS = 'xmlns="http://www.w3.org/2000/svg"';

function tree(dir: string, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${n}` : n;
    if (statSync(join(dir, r)).isDirectory()) Object.assign(out, tree(dir, r));
    else if (n !== 'expected.json') out[r] = readFileSync(join(dir, r), 'utf8');
  }
  return out;
}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- JSON tùy ý của project

const BASE_INNER =
  '<rect data-mat-uid="el_aaa" x="10" y="10" width="30" height="80" fill="#38bdf8"/>' +
  '<circle data-mat-uid="el_bbb" cx="70" cy="50" r="20" fill="#64748b"/>' +
  '<text data-mat-uid="el_ccc" x="10" y="98">--</text>';
const svgOf = (inner: string, attrs = 'viewBox="0 0 100 100"') =>
  `<svg ${NS} ${attrs}>${inner}</svg>`;

interface Seen {
  errors: string[];
  warnings: string[];
}
const fmt = (i: { code: string; file: string; path: string }) => `${i.code} ${i.file}${i.path}`;

async function run(svg: string, mutate?: (f: Record<string, Json>) => void): Promise<Seen> {
  const raw = tree(DIR);
  const f: Record<string, Json> = {};
  for (const [k, v] of Object.entries(raw)) f[k] = k.endsWith('.json') ? JSON.parse(v) : v;
  f[SVG] = svg;
  mutate?.(f);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  const r = await validateProject(new MemorySource(out), { checkSvg: true });
  return { errors: r.errors.map(fmt).sort(), warnings: r.warnings.map(fmt).sort() };
}
const has = (xs: string[], code: string) => xs.some((x) => x.startsWith(code + ' '));

const bindElement = (uid: string, target: string, extra: Json = {}) => ({
  elementUid: uid,
  bindings: [
    {
      id: 'bx',
      target,
      source: { type: 'tag', tagId: 'TANK01.LEVEL' },
      transform: { kind: 'direct' },
      ...extra,
    },
  ],
});
const withBindings =
  (...els: Json[]) =>
  (f: Record<string, Json>) => {
    f[MB].elements = els;
  };

describe('đường cơ sở', () => {
  it('SVG sạch của vector hợp lệ: không có mã SVG nào', async () => {
    const r = await run(svgOf(BASE_INNER));
    for (const c of ['E_SVG_UNSAFE', 'E_SVG_LIMIT', 'W_SVG_HEAVY', 'W_BIND_ELEMENT_KIND']) {
      expect(has(r.errors, c) || has(r.warnings, c), c).toBe(false);
    }
  });
});

describe('E_SVG_UNSAFE: SVG không qua allowlist', () => {
  it.each([
    ['script', '<script>alert(1)</script>'],
    ['thuộc tính on*', '<rect data-mat-uid="el_zzz" width="1" height="1" onclick="alert(1)"/>'],
    ['onload ở gốc (đặt ngoài)', ''],
    ['href ngoài trên use', '<use href="http://evil.invalid/x.svg#a"/>'],
    ['href javascript: trên image', '<image href="javascript:alert(1)"/>'],
    [
      'phần tử ngoài allowlist (foreignObject)',
      '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"/></foreignObject>',
    ],
    [
      'phần tử ngoài allowlist (animate)',
      '<animate attributeName="opacity" values="0;1" dur="1s"/>',
    ],
    [
      'style có url() ngoài',
      '<rect width="1" height="1" style="fill:url(http://evil.invalid/x)"/>',
    ],
    ['giá trị ngoài miền (NaN)', '<rect x="NaN" width="1" height="1"/>'],
    [
      'phần tử ngoài namespace SVG',
      '<meta xmlns="http://www.w3.org/1999/xhtml" http-equiv="refresh"/>',
    ],
  ])('%s', async (label, inner) => {
    const attrs = label.startsWith('onload')
      ? 'viewBox="0 0 100 100" onload="alert(1)"'
      : undefined;
    const r = await run(svgOf(BASE_INNER + inner, attrs));
    expect(has(r.errors, 'E_SVG_UNSAFE')).toBe(true);
    expect(r.errors.some((e) => e.startsWith('E_SVG_UNSAFE') && e.includes(SVG))).toBe(true);
  });

  it('không báo khi SVG chỉ gồm phần tử và thuộc tính trong allowlist', async () => {
    const r = await run(
      svgOf(
        '<defs><linearGradient id="g1"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
          BASE_INNER +
          '<path d="M0 0L10 10z" fill="url(#g1)" transform="translate(1,2)" style="stroke:#000"/>',
      ),
    );
    expect(has(r.errors, 'E_SVG_UNSAFE')).toBe(false);
  });
});

describe('E_SVG_LIMIT và W_SVG_HEAVY', () => {
  it('quá 5 MiB: E_SVG_LIMIT', async () => {
    const pad = 'x'.repeat(5 * 1024 * 1024 + 1);
    const r = await run(svgOf(BASE_INNER + `<text>${pad}</text>`));
    expect(has(r.errors, 'E_SVG_LIMIT')).toBe(true);
  });

  it('quá 20.000 phần tử: E_SVG_LIMIT', async () => {
    const r = await run(svgOf(BASE_INNER + '<rect width="1" height="1"/>'.repeat(20_000)));
    expect(has(r.errors, 'E_SVG_LIMIT')).toBe(true);
  });

  it('đúng 20.000 phần tử (kể cả gốc) không vượt giới hạn phần tử', async () => {
    const r = await run(svgOf('<rect width="1" height="1"/>'.repeat(19_999)));
    expect(has(r.errors, 'E_SVG_LIMIT')).toBe(false);
  });

  it('sâu hơn 32 cấp: E_SVG_LIMIT; đúng 32 cấp thì không', async () => {
    const nest = (n: number) => '<g>'.repeat(n) + '<rect width="1" height="1"/>' + '</g>'.repeat(n);
    const deep = await run(svgOf(BASE_INNER + nest(32))); // gốc + 32 g + rect = 34
    expect(has(r(deep), 'E_SVG_LIMIT')).toBe(true);
    const ok = await run(svgOf(BASE_INNER + nest(30))); // gốc + 30 g + rect = 32
    expect(has(r(ok), 'E_SVG_LIMIT')).toBe(false);
    function r(x: Seen) {
      return x.errors;
    }
  });

  // T112: bom `use` trong gói (không qua bộ nhập) phải bị bắt ở bước kiểm project, trước khi nạp xuống thiết bị.
  it('bom use (10 tầng x 10 = 10^10 phần tử hiệu dụng): E_SVG_LIMIT; use hợp lệ thì không', async () => {
    const lv = (n: number) => {
      let defs = '<g id="l0"><rect width="1" height="1"/></g>';
      for (let i = 1; i <= n; i++)
        defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
      return `<defs>${defs}</defs><use href="#l${n}"/>`;
    };
    const bomb = await run(svgOf(BASE_INNER + lv(9)));
    expect(has(bomb.errors, 'E_SVG_LIMIT')).toBe(true);
    const ok = await run(svgOf(BASE_INNER + lv(2)));
    expect(has(ok.errors, 'E_SVG_LIMIT')).toBe(false);
  });

  it('chuỗi use nối nhau sâu (T112: 500 tầng treo Chrome) hoặc bom nằm hết trong defs: E_SVG_LIMIT', async () => {
    let d = '<g id="u0"><rect width="1" height="1"/></g>';
    for (let i = 1; i < 100; i++) d += `<g id="u${i}"><use href="#u${i - 1}"/></g>`;
    const deep = await run(svgOf(BASE_INNER + `<defs>${d}</defs><use href="#u99"/>`));
    expect(has(deep.errors, 'E_SVG_LIMIT')).toBe(true);
    let b = '<g id="l0"><rect width="1" height="1"/></g>';
    for (let i = 1; i <= 9; i++) b += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
    const inDefs = await run(svgOf(BASE_INNER + `<defs>${b}</defs>`));
    expect(has(inDefs.errors, 'E_SVG_LIMIT')).toBe(true);
  });

  it('từ 1 MiB đến dưới 5 MiB: W_SVG_HEAVY, không phải lỗi giới hạn', async () => {
    const pad = 'x'.repeat(1024 * 1024);
    const r = await run(svgOf(BASE_INNER + `<text>${pad}</text>`));
    expect(has(r.warnings, 'W_SVG_HEAVY')).toBe(true);
    expect(has(r.errors, 'E_SVG_LIMIT')).toBe(false);
  });

  it('từ 10.000 phần tử: W_SVG_HEAVY', async () => {
    const r = await run(svgOf(BASE_INNER + '<rect width="1" height="1"/>'.repeat(10_000)));
    expect(has(r.warnings, 'W_SVG_HEAVY')).toBe(true);
    expect(has(r.errors, 'E_SVG_LIMIT')).toBe(false);
  });

  it('SVG nhỏ không bị cảnh báo nặng', async () => {
    const r = await run(svgOf(BASE_INNER));
    expect(has(r.warnings, 'W_SVG_HEAVY')).toBe(false);
  });
});

describe('W_UID_NOT_IN_SVG cho sự kiện', () => {
  it('sự kiện click trên elementUid khai ở item nhưng không có trong SVG', async () => {
    const r = await run(svgOf(BASE_INNER), (f) => {
      f[MS].items[0].elements.push({ elementUid: 'el_zzz' });
      f[MB].elements.push({
        elementUid: 'el_zzz',
        events: { click: { action: 'navigate', screen: 'pump' } },
      });
    });
    expect(
      r.warnings.some((w) => w.startsWith('W_UID_NOT_IN_SVG') && w.includes('/elements/3')),
    ).toBe(true);
    expect(has(r.errors, 'E_REF_UID')).toBe(false);
  });

  it('sự kiện trên phần tử có trong SVG: không cảnh báo', async () => {
    const r = await run(svgOf(BASE_INNER), (f) => {
      f[MB].elements.push({
        elementUid: 'el_bbb',
        events: { click: { action: 'navigate', screen: 'pump' } },
      });
    });
    expect(has(r.warnings, 'W_UID_NOT_IN_SVG')).toBe(false);
  });
});

describe('W_BIND_ELEMENT_KIND: đích không hợp loại phần tử', () => {
  it('text.content trên phần tử không phải text', async () => {
    const r = await run(svgOf(BASE_INNER), withBindings(bindElement('el_aaa', 'text.content')));
    expect(has(r.warnings, 'W_BIND_ELEMENT_KIND')).toBe(true);
  });

  it('text.content trên text: không cảnh báo', async () => {
    const r = await run(svgOf(BASE_INNER), withBindings(bindElement('el_ccc', 'text.content')));
    expect(has(r.warnings, 'W_BIND_ELEMENT_KIND')).toBe(false);
  });

  it('geometry.levelPercent trên phần tử không phải rect', async () => {
    const r = await run(
      svgOf(BASE_INNER),
      withBindings(bindElement('el_bbb', 'geometry.levelPercent')),
    );
    expect(has(r.warnings, 'W_BIND_ELEMENT_KIND')).toBe(true);
  });

  it('geometry.levelPercent trên rect: không cảnh báo', async () => {
    const r = await run(
      svgOf(BASE_INNER),
      withBindings(bindElement('el_aaa', 'geometry.levelPercent')),
    );
    expect(has(r.warnings, 'W_BIND_ELEMENT_KIND')).toBe(false);
  });

  it('effect.flow trên phần tử không có nét; có nét (thuộc tính hoặc style) thì không cảnh báo', async () => {
    const noStroke = await run(
      svgOf(BASE_INNER),
      withBindings(bindElement('el_aaa', 'effect.flow')),
    );
    expect(has(noStroke.warnings, 'W_BIND_ELEMENT_KIND')).toBe(true);

    const attr = svgOf(BASE_INNER.replace('fill="#38bdf8"', 'fill="none" stroke="#38bdf8"'));
    const withAttr = await run(attr, withBindings(bindElement('el_aaa', 'effect.flow')));
    expect(has(withAttr.warnings, 'W_BIND_ELEMENT_KIND')).toBe(false);

    const sty = svgOf(BASE_INNER.replace('fill="#38bdf8"', 'style="stroke:#38bdf8"'));
    const withStyle = await run(sty, withBindings(bindElement('el_aaa', 'effect.flow')));
    expect(has(withStyle.warnings, 'W_BIND_ELEMENT_KIND')).toBe(false);
  });
});

describe('W_BIND_CLIP_EXISTS: clipLevel trên phần tử đã có clip-path gốc', () => {
  const clipped = (el: string) =>
    svgOf(
      '<defs><clipPath id="c1"><rect width="50" height="50"/></clipPath></defs>' +
        BASE_INNER.replace(`<${el} `, `<${el} clip-path="url(#c1)" `),
    );

  it('phần tử có clip-path: cảnh báo', async () => {
    const r = await run(clipped('rect'), withBindings(bindElement('el_aaa', 'geometry.clipLevel')));
    expect(has(r.warnings, 'W_BIND_CLIP_EXISTS')).toBe(true);
  });

  it('phần tử không có clip-path: không cảnh báo', async () => {
    const r = await run(clipped('rect'), withBindings(bindElement('el_bbb', 'geometry.clipLevel')));
    expect(has(r.warnings, 'W_BIND_CLIP_EXISTS')).toBe(false);
  });

  it('đích khác clipLevel trên phần tử có clip-path: không cảnh báo', async () => {
    const r = await run(clipped('rect'), withBindings(bindElement('el_aaa', 'style.opacity')));
    expect(has(r.warnings, 'W_BIND_CLIP_EXISTS')).toBe(false);
  });
});
