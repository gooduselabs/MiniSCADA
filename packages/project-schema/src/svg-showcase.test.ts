// @vitest-environment jsdom
// Project mẫu projects/svg-showcase (feature 026, sinh bằng tools/svg-showcase/generate.mjs): sơ đồ công nghệ SVG vẽ tay,
// màn hình lưới kết hợp, popup faceplate. Project phải qua validateProject 0 lỗi (kể cả bộ lọc SVG: không phần nào bị
// loại) và không có cảnh báo về binding hay SVG.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemorySource, validateProject } from './index.ts';

const DIR = resolve(__dirname, '../../../projects/svg-showcase');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files: Record<string, string> = Object.fromEntries(
  walk(DIR)
    .map((p) => relative(DIR, p).replace(/\\/g, '/'))
    .filter((rel) => !rel.startsWith('.') && !rel.endsWith('.md'))
    .map((rel) => [rel, readFileSync(join(DIR, rel), 'utf8')]),
);

describe('project mẫu svg-showcase (feature 026)', () => {
  it('validateProject: 0 lỗi, không cảnh báo SVG hay binding', async () => {
    const v = await validateProject(new MemorySource(files), {
      runtimeVersion: '1.1.0',
      checkSvg: true,
    });
    expect(v.errors.map((e) => `${e.code} ${e.file}${e.path} ${e.message}`)).toEqual([]);
    expect(
      v.warnings
        .filter((w) => /^W_(SVG|BIND|ANIM|EVENT|BLINK)/.test(w.code))
        .map((w) => `${w.code} ${w.file}${w.path} ${w.message}`),
    ).toEqual([]);
  });

  it('mọi phần tử có binding đều có data-mat-uid trong SVG, đủ 9 loại hoạt ảnh', () => {
    const svg = files['graphics/so-do-cong-nghe.svg']!;
    const b = JSON.parse(files['screens/so-do-cong-nghe.so_do.bindings.json']!) as {
      elements: Array<{
        elementUid: string;
        bindings?: Array<{ target: string }>;
        events?: unknown;
      }>;
    };
    for (const e of b.elements) expect(svg).toContain(`data-mat-uid="${e.elementUid}"`);
    const targets = new Set(b.elements.flatMap((e) => (e.bindings ?? []).map((x) => x.target)));
    for (const t of [
      'geometry.levelPercent',
      'geometry.clipLevel',
      'transform.rotate',
      'style.fill',
      'style.stroke',
      'effect.flow',
      'effect.blink',
      'text.content',
      'style.visibility',
    ])
      expect(targets).toContain(t);
    expect(b.elements.filter((e) => e.events).length).toBe(5);
  });
});

describe('trang Thư viện component (thu-vien)', () => {
  const screen = JSON.parse(files['screens/thu-vien.screen.json']!) as {
    layout: { rows: Array<{ height: number; cells: Array<{ item: string }> }> };
    items: Array<{ id: string; type: string; widget?: string; svgFile?: string }>;
  };
  const catalog = JSON.parse(
    readFileSync(resolve(__dirname, '../../../schemas/widgets.catalog.json'), 'utf8'),
  ) as { widgets: Array<{ id: string }> };
  const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '../../../tools/symbol-data/manifest.json'), 'utf8'),
  ) as { symbols: Array<{ id: string }> };

  it('có mọi loại widget của catalog và mọi ký hiệu của thư viện', () => {
    const widgets = new Set(screen.items.map((i) => i.widget).filter(Boolean));
    for (const w of catalog.widgets) expect(widgets).toContain(w.id);
    const svgs = new Set(screen.items.map((i) => i.svgFile).filter(Boolean));
    for (const s of manifest.symbols) expect(svgs).toContain(`graphics/symbols/${s.id}.svg`);
  });

  it('mọi item nằm trong đúng một ô lưới, nằm trong menu điều hướng', () => {
    const cells = screen.layout.rows.flatMap((r) => r.cells.map((c) => c.item));
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells.sort()).toEqual(screen.items.map((i) => i.id).sort());
    const project = JSON.parse(files['project.json']!) as {
      navigation: { items: Array<{ screen: string }> };
    };
    expect(project.navigation.items.map((i) => i.screen)).toContain('thu-vien');
  });
});
