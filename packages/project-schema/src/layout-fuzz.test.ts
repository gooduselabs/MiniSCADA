// Fuzz bố cục lưới (feature 012, T056; SC-004): 10.000 đột biến ngẫu nhiên (có hạt giống, lặp lại được) của `layout` trên
// màn hình lưới của vector v11-valid-full. Luật rules-11 không bao giờ ném; mỗi đột biến cho mã lỗi/cảnh báo đã đăng ký
// hoặc không lỗi. 300 đột biến đầu đi qua cả `validateProject` (schema, mọi luật). Bản C++ đi qua project_fuzz_test.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './codes.ts';
import { MemorySource, validateProject } from './index.ts';
import { runRules11 } from './rules-11.ts';

const ROOT = resolve(__dirname, '../../../tests/project-vectors/v11-valid-full');
const SCREEN = 'screens/tong-quan.screen.json';

function files(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e !== 'expected.json')
        out[relative(ROOT, p).split('\\').join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(ROOT);
  return out;
}

/** Bộ sinh số giả ngẫu nhiên có hạt giống (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ODD: unknown[] = [
  null,
  -1,
  0,
  1,
  12,
  13,
  1e9,
  1.5,
  '4',
  '',
  'auto',
  true,
  [],
  {},
  'c1',
  'den',
  'x'.repeat(80),
];

function mutate(screen: Record<string, unknown>, r: () => number): void {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const layout = screen.layout as Record<string, unknown>;
  const rows = layout.rows as Array<Record<string, unknown>>;
  for (let k = 1 + Math.floor(r() * 4); k > 0; k--) {
    const op = Math.floor(r() * 9);
    const row = rows.length ? pick(rows) : undefined;
    const cells =
      row && Array.isArray(row.cells) ? (row.cells as Array<Record<string, unknown>>) : [];
    const cell = cells.length ? pick(cells) : undefined;
    if (op === 0) layout[pick(['mode', 'columns', 'gap', 'padding'])] = pick(ODD);
    else if (op === 1 && cell)
      cell[pick(['id', 'span', 'offset', 'align', 'minHeight', 'item'])] = pick(ODD);
    else if (op === 2 && row) row[pick(['id', 'height', 'gap'])] = pick(ODD);
    else if (op === 3 && cell) cells.push(JSON.parse(JSON.stringify(cell)));
    else if (op === 4 && row) rows.push(JSON.parse(JSON.stringify(row)));
    else if (op === 5 && cells.length) cells.splice(Math.floor(r() * cells.length), 1);
    else if (op === 6 && rows.length) rows.splice(Math.floor(r() * rows.length), 1);
    else if (op === 7) {
      const items = screen.items as Array<Record<string, unknown>>;
      if (items.length) pick(items)[pick(['x', 'y', 'width', 'height'])] = pick(ODD);
    } else if (op === 8 && row) row.cells = pick([[], null, 'x', cells.concat(cells)]);
  }
}

describe('fuzz bố cục lưới (SC-004)', () => {
  it('10.000 đột biến: rules-11 không ném, chỉ trả mã đã đăng ký; 300 đột biến qua validateProject không ném', async () => {
    const base = files();
    const known = new Set<string>([...ERROR_CODES, 'W_LAYOUT_ITEM_ORPHAN']);
    const r = rng(12012);
    const project = JSON.parse(base['project.json']!);
    for (let i = 0; i < 10_000; i++) {
      const screen = JSON.parse(base[SCREEN]!);
      mutate(screen, r);
      // rules-11 chỉ chạy trên tài liệu đã qua schema; ở đây ép đầu vào hỏng để chắc nó không ném với kiểu lạ
      // (mảng thay bằng chuỗi, null…) — chỉ khi `rows` vẫn là mảng các đối tượng có `cells` là mảng.
      const rows = (screen.layout as { rows?: unknown }).rows;
      const shaped =
        Array.isArray(rows) &&
        rows.every(
          (x) =>
            x !== null && typeof x === 'object' && Array.isArray((x as { cells?: unknown }).cells),
        );
      if (shaped) {
        const out = runRules11({ project, screens: { 'tong-quan': { file: SCREEN, screen } } });
        for (const e of [...out.errors, ...out.warnings])
          expect(known.has(e.code), e.code).toBe(true);
      }
      if (i < 300) {
        const v = await validateProject(
          new MemorySource({ ...base, [SCREEN]: JSON.stringify(screen) }),
          {
            checkSvg: false,
            runtimeVersion: '1.1.0',
          },
        );
        expect(Array.isArray(v.errors)).toBe(true);
      }
    }
  }, 120_000);
});
