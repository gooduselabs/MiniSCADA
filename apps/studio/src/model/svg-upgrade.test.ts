// Làm sạch SVG trong bước nâng cấp lên 0.4 (feature 008, T106; FR-005): đưa SVG cũ qua allowlist nhưng giữ id và
// data-mat-uid; file đã sạch giữ nguyên từng byte; báo cáo nêu đúng số lượng và tên phần tử bị loại.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSvg, sanitizeSvg } from '@mat/svg-renderer';
import { describe, expect, it } from 'vitest';
import { cleanSvgFiles } from './svg-upgrade.ts';

const TANK = readFileSync(
  resolve(__dirname, '../../../../projects/tank-demo/screens/tank-motor.svg'),
  'utf8',
);

const attrs = (text: string, name: string): string[] =>
  Array.from(parseSvg(text).querySelectorAll(`[${name}]`)).map((e) => e.getAttribute(name)!);
const removedOf = (text: string) => {
  const r = sanitizeSvg(parseSvg(text));
  return Object.keys(r.removedElements).length + r.removedAttributes + Object.keys(r.codes).length;
};

describe('cleanSvgFiles', () => {
  it('SVG của tank-demo 0.1: bỏ `title` ở gốc, giữ nguyên id và data-mat-uid, sau đó qua allowlist', () => {
    expect(removedOf(TANK)).toBeGreaterThan(0);
    const out = cleanSvgFiles({ 'screens/tank-motor.svg': TANK });
    const text = out.files['screens/tank-motor.svg']!;
    expect(text).not.toBe(TANK);
    expect(removedOf(text)).toBe(0);
    expect(attrs(text, 'id')).toEqual(attrs(TANK, 'id'));
    expect(attrs(text, 'data-mat-uid')).toEqual(attrs(TANK, 'data-mat-uid'));
    expect(out.change).toMatchObject({ kind: 'svgClean' });
    const f = out.change!.files[0]!;
    expect(f.file).toBe('screens/tank-motor.svg');
    expect(f.elements.title).toBe(1);
    expect(out.change!.totalElements).toBeGreaterThanOrEqual(1);
  });

  it('SVG đã sạch giữ nguyên từng byte, không có thay đổi để báo', () => {
    const clean = cleanSvgFiles({ 'a.svg': TANK }).files['a.svg']!;
    const again = cleanSvgFiles({ 'a.svg': clean, 'b.json': '{}' });
    expect(again.files['a.svg']).toBe(clean);
    expect(again.files['b.json']).toBe('{}');
    expect(again.change).toBeNull();
  });

  it('SVG không phải XML hợp lệ để nguyên (bộ kiểm tra sẽ báo lỗi)', () => {
    const out = cleanSvgFiles({ 'x.svg': '<svg' });
    expect(out.files['x.svg']).toBe('<svg');
    expect(out.change).toBeNull();
  });
});

// F11 (feature 011, T215): SVG 0.1 đến 0.3 có DTD mà bộ lọc không báo gì từng được giữ nguyên từng byte
describe('cleanSvgFiles: DOCTYPE', () => {
  const BODY =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect data-mat-uid="el_aaaaaaaaaa" width="5" height="5"/></svg>';
  const ATTLIST = `<!DOCTYPE svg [\n<!ATTLIST rect onclick CDATA "window.__pwned='f11'">\n]>\n`;

  it('project 0.3 có <!DOCTYPE … <!ATTLIST rect onclick …>: ghi lại không DTD, báo R_DTD', () => {
    const out = cleanSvgFiles({ 'screens/a.svg': `<?xml version="1.0"?>\n${ATTLIST}${BODY}` });
    const text = out.files['screens/a.svg']!;
    expect(text).not.toContain('DOCTYPE');
    expect(text).not.toContain('ATTLIST');
    expect(text).not.toContain('onclick');
    expect(removedOf(text)).toBe(0);
    expect(attrs(text, 'data-mat-uid')).toEqual(['el_aaaaaaaaaa']);
    expect(out.change?.files[0]).toMatchObject({ file: 'screens/a.svg' });
    expect(out.change?.files[0]?.codes).toContain('R_DTD');
  });

  it('DOCTYPE PUBLIC của Illustrator cũng bị bỏ', () => {
    const out = cleanSvgFiles({
      'a.svg': `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${BODY}`,
    });
    expect(out.files['a.svg']).not.toContain('DOCTYPE');
    expect(out.change?.files[0]?.codes).toEqual(['R_DTD']);
  });

  it('DTD có entity lạ: để nguyên (bộ kiểm tra báo E_SVG_UNSAFE), không đưa cho DOMParser', () => {
    const bad = `<!DOCTYPE svg [<!ENTITY e "x">]>${BODY}`;
    const out = cleanSvgFiles({ 'a.svg': bad });
    expect(out.files['a.svg']).toBe(bad);
    expect(out.change).toBeNull();
  });
});
