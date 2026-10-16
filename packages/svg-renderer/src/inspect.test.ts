import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectSvg } from './inspect';
import { parseSvg } from './sanitize';
import { withoutDoctype } from './test-helpers.ts';

const FIX = resolve(__dirname, '../../../tests/fixtures/svg');
const inspectText = (text: string, limits?: Parameters<typeof inspectSvg>[2]) =>
  inspectSvg(parseSvg(withoutDoctype(text)), text, limits); // DTD: bỏ như importer (parseSvg từ chối, F12)
const inspectFixture = (name: string) => inspectText(readFileSync(resolve(FIX, name), 'utf8'));
const codes = (r: ReturnType<typeof inspectSvg>) => r.warnings.map((w) => w.code);

describe('inspectSvg — nhận diện phần mềm xuất', () => {
  it('Inkscape: lấy phiên bản từ inkscape:version, cảnh báo flowRoot, ảnh liên kết, đơn vị mm', () => {
    const r = inspectFixture('synthetic-inkscape-features.svg');
    expect(r.generator).toBe('Inkscape 1.4.4');
    expect(r.certainty).toBe('chắc chắn');
    expect(r.units).toBe('mm');
    expect(codes(r)).toEqual(
      expect.arrayContaining(['flowroot', 'linked-image', 'units', 'foreign-namespace']),
    );
  });

  it('Illustrator Save As: phiên bản từ comment Generator, cảnh báo DOCTYPE/ENTITY và font PostScript', () => {
    const r = inspectFixture('synthetic-illustrator-saveas.svg');
    expect(r.generator).toBe('Adobe Illustrator 28.0.0');
    expect(r.certainty).toBe('chắc chắn');
    expect(codes(r)).toEqual(
      expect.arrayContaining(['doctype-entity', 'postscript-font', 'foreign-object']),
    );
    expect(r.fonts).toContain('MyriadPro-Regular');
  });

  it('Illustrator Export As: chỉ "có dấu hiệu"; font PostScript có dự phòng thì không cảnh báo', () => {
    const r = inspectFixture('synthetic-illustrator-export.svg');
    expect(r.generator).toBe('Adobe Illustrator (Export As)');
    expect(r.certainty).toBe('có dấu hiệu');
    expect(codes(r)).not.toContain('postscript-font');
  });

  it('CorelDRAW: nhận diện qua comment/namespace, đơn vị mm', () => {
    const r = inspectFixture('synthetic-coreldraw.svg');
    expect(r.generator).toBe('CorelDRAW');
    expect(r.units).toBe('mm');
    expect(r.hasViewBox).toBe(true);
  });

  it('draw.io: nhãn HTML trong foreignObject, có chữ dự phòng trong <switch>', () => {
    const r = inspectFixture('synthetic-drawio.svg');
    expect(r.generator).toBe('draw.io');
    const fo = r.warnings.find((w) => w.code === 'foreign-object');
    expect(fo?.message).toMatch(/dự phòng/);
  });

  it('SVG sạch viết tay: không rõ phần mềm, không cảnh báo', () => {
    const r = inspectFixture('tank.svg');
    expect(r.generator).toBe('không rõ');
    expect(r.warnings).toEqual([]);
  });

  it('LibreOffice Draw (file xuất thật): font SVG nhúng, đơn vị mm', () => {
    const r = inspectFixture('real-libreoffice-draw.svg');
    expect(r.generator).toBe('LibreOffice');
    expect(r.units).toBe('mm');
    expect(codes(r)).toEqual(expect.arrayContaining(['svg-font', 'units']));
  });
});

describe('inspectSvg — CSS, giới hạn, ảnh', () => {
  it('đếm class trùng tên khác nội dung giữa các khối <style>', () => {
    const r = inspectText(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <style>.cls-1{fill:red}.cls-2{fill:blue}</style>
      <style>.cls-1{fill:green}.cls-2{fill:blue}</style>
      <rect class="cls-1"/><rect class="cls-1 cls-2"/><rect class="cls-2"/></svg>`);
    expect(r.styleBlocks).toBe(2);
    expect(r.classConflicts).toBe(1); // .cls-2 giống nhau nên không tính
    expect(r.conflictedElements).toBe(2);
    expect(codes(r)).toContain('class-conflict');
  });

  it('đoạn CSS dài không có dấu { không làm treo (fuzz T113: regex O(n^2) mất 6 giây cho 100 KB)', () => {
    const junk = '9 '.repeat(100_000);
    const t0 = performance.now();
    const r = inspectText(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <style>${junk}.a{fill:red}</style><style>${junk}.a{fill:blue}</style><rect class="a"/></svg>`);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(r.classConflicts).toBe(0); // bộ chọn là "9 9 ... .a", không phải ".a" thuần
  });

  it('quét quy tắc CSS: nhiều bộ chọn, dấu } lạc, { không đóng', () => {
    const r = inspectText(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
      <style>} .x,.y{fill:red} stray } .x{fill:blue} {a{b} .z{fill:1} .w{fill:2</style>
      <style>.x{fill:red}.y{fill:red}.z{fill:3}</style></svg>`);
    expect(r.classConflicts).toBe(2); // .x (red vs blue) và .z (1 vs 3); .y giống nhau
  });

  it('cảnh báo vượt giới hạn import (kích thước, số phần tử, độ sâu)', () => {
    const r = inspectText(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g><g><rect/><rect/></g></g></svg>',
      { maxBytes: 10, maxNodes: 3, maxDepth: 2 },
    );
    expect(r.overLimits).toHaveLength(3);
    expect(codes(r)).toContain('over-limit');
  });

  it('thiếu viewBox và ảnh raster nhúng', () => {
    const r = inspectText(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' +
        '<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/></svg>',
    );
    expect(codes(r)).toEqual(expect.arrayContaining(['no-viewbox', 'embedded-raster']));
  });

  it('file Inkscape thật của dự án: vượt giới hạn node, 366 class xung đột', () => {
    const r = inspectText(readFileSync(resolve(FIX, 'factory-isometric-stress.svg'), 'utf8'));
    expect(r.generator).toBe('Inkscape 1.4.4');
    expect(r.elements).toBeGreaterThan(20000);
    expect(r.classConflicts).toBe(366);
    expect(r.conflictedElements).toBe(10411);
    expect(codes(r)).toEqual(expect.arrayContaining(['over-limit', 'class-conflict', 'show-only']));
  }, 60_000);
});

// T112 (rà soát bảo mật): regex /<!DOCTYPE[^>]*\[[\s\S]*?<!ENTITY/ chạy bậc ba trên "<!DOCTYPE [" lặp lại trong CDATA
// (5.000 lần = 55 KB: 77 giây; 5 MiB: không bao giờ xong). Cổng thời gian: bộ quét tuyến tính.
describe('inspectSvg — chống ReDoS trên đầu vào thô (T112)', () => {
  const svgWith = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="1" y="1">${inner}</text></svg>`;
  const flagged = (raw: string) => codes(inspectSvg(parseSvg(svgWith('x')), raw));

  it('"<!DOCTYPE [" lặp 200.000 lần trong CDATA xong dưới 2 giây và không báo doctype-entity', () => {
    const text = svgWith('<![CDATA[' + '<!DOCTYPE ['.repeat(200_000) + ']]>');
    const t0 = Date.now();
    const r = inspectText(text);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(codes(r)).not.toContain('doctype-entity');
  }, 20_000);

  it('vẫn báo doctype-entity khi có DOCTYPE với ENTITY (kể cả viết thường)', () => {
    expect(flagged('<!DOCTYPE svg [<!ENTITY a "b">]>' + svgWith('x'))).toContain('doctype-entity');
    expect(flagged('<!doctype svg [ <!entity a "b">]>' + svgWith('x'))).toContain('doctype-entity');
  });

  it('DOCTYPE không có ENTITY, hoặc ENTITY đứng trước DOCTYPE, hoặc "[" sau ">", không báo', () => {
    expect(flagged('<!DOCTYPE svg [<!ELEMENT a ANY>]>' + svgWith('x'))).not.toContain(
      'doctype-entity',
    );
    expect(flagged('<!ENTITY a "b"><!DOCTYPE svg [ ]>' + svgWith('x'))).not.toContain(
      'doctype-entity',
    );
    expect(flagged('<!DOCTYPE svg><x>[<!ENTITY a "b">' + svgWith('x'))).not.toContain(
      'doctype-entity',
    );
  });
});
