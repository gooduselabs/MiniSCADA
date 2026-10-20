// @vitest-environment jsdom
// Widget `image` (feature 014, danh mục 0.6.0): tệp SVG ở `props.src` phải có trong project (E_FILE_MISSING), nội dung qua
// cùng luật với SVG của item svg (E_SVG_UNSAFE, E_SVG_LIMIT); đường dẫn ngoài mẫu `graphics/…svg` là lỗi thuộc tính.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../projects/grid-demo');
const SCREEN = 'screens/bang-dieu-khien.screen.json';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const base: Record<string, string> = Object.fromEntries(
  walk(DIR).map((p) => [relative(DIR, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')]),
);

/** grid-demo có thêm một hàng chứa widget image trỏ `src`; `extra`: tệp thêm vào project. */
async function check(src: string, extra: Record<string, string> = {}) {
  const screen = JSON.parse(base[SCREEN]!) as {
    layout: { rows: unknown[] };
    items: unknown[];
  };
  screen.layout.rows.push({
    id: 'r99',
    height: 200,
    cells: [{ id: 'c99', span: 12, item: 'anh' }],
  });
  screen.items.push({ id: 'anh', type: 'widget', widget: 'image', props: { src } });
  const v = await validateProject(
    new MemorySource({ ...base, ...extra, [SCREEN]: JSON.stringify(screen) }),
    { runtimeVersion: '1.1.0', checkSvg: true },
  );
  return v.errors.map((e) => `${e.code} ${e.file}${e.path}`);
}

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#0b7285"/></svg>';

describe('widget image (feature 014)', () => {
  it('grid-demo gốc: 0 lỗi', async () => {
    const v = await validateProject(new MemorySource(base), {
      runtimeVersion: '1.1.0',
      checkSvg: true,
    });
    expect(v.errors).toEqual([]);
  });

  it('tệp có và SVG sạch: không lỗi; tệp thiếu: E_FILE_MISSING ở props/src', async () => {
    expect(await check('graphics/logo.svg', { 'graphics/logo.svg': LOGO })).toEqual([]);
    expect(await check('graphics/khong-co.svg')).toEqual([
      `E_FILE_MISSING ${SCREEN}/items/20/props/src`,
    ]);
  });

  it('src rỗng (chưa chọn ảnh) hợp lệ; đường dẫn ngoài mẫu là lỗi thuộc tính, không đọc tệp', async () => {
    expect(await check('')).toEqual([]);
    const bad = await check('../project.json');
    expect(
      bad.some((e) => e.startsWith('E_WIDGET_PROP') && e.endsWith('/items/20/props/src')),
    ).toBe(true);
    expect(bad.some((e) => e.startsWith('E_FILE_MISSING'))).toBe(false);
  });

  it('SVG có script: E_SVG_UNSAFE như SVG của item svg', async () => {
    const evil =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>';
    expect(await check('graphics/xau.svg', { 'graphics/xau.svg': evil })).toEqual([
      'E_SVG_UNSAFE graphics/xau.svg',
    ]);
  });
});
