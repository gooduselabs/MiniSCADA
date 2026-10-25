// @vitest-environment jsdom
// Feature 024 (T090 của 015): logo của đơn vị trong XLSX. Ảnh PNG (`meta.logoPng`) thành xl/media/image1.png, một
// drawing neo ở góc trên bên phải bảng, giữ tỉ lệ trong khung 160 x 48 px; byte không phải PNG bị bỏ (không có drawing).
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildXlsx, pngSize } from './xlsx/xlsx.ts';
import { LABELS, META, tableFromVector } from './testing.ts';

const dec = new TextDecoder();
const t = tableFromVector('report-shift-3-0600');

/** PNG hợp lệ tối thiểu với kích thước trong IHDR (dữ liệu ảnh không cần đúng cho test cấu trúc). */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

const xml = (zip: Record<string, Uint8Array>, name: string) => {
  const d = new DOMParser().parseFromString(dec.decode(zip[name]), 'application/xml');
  expect(d.getElementsByTagName('parsererror').length, `${name}: XML hợp lệ`).toBe(0);
  return d;
};

describe('XLSX: logo', () => {
  it('pngSize đọc IHDR; byte khác PNG cho null', () => {
    expect(pngSize(png(320, 96))).toEqual({ width: 320, height: 96 });
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngSize(new TextEncoder().encode('<svg/>'.padEnd(40, ' ')))).toBeNull();
  });

  it('PNG thành media + drawing, quan hệ và kiểu nội dung đúng, giữ tỉ lệ trong khung 160 x 48 px', () => {
    const logo = png(320, 96);
    const zip = unzipSync(buildXlsx(t, { ...META, logoPng: logo }, LABELS));
    expect(zip['xl/media/image1.png']).toEqual(logo);
    const types = dec.decode(zip['[Content_Types].xml']);
    expect(types).toContain('Extension="png" ContentType="image/png"');
    expect(types).toContain('/xl/drawings/drawing1.xml');
    const sheet = xml(zip, 'xl/worksheets/sheet1.xml');
    const drawing = sheet.getElementsByTagName('drawing')[0];
    expect(drawing).toBeDefined();
    const rels = dec.decode(zip['xl/worksheets/_rels/sheet1.xml.rels']);
    expect(rels).toContain('Target="../drawings/drawing1.xml"');
    expect(dec.decode(zip['xl/drawings/_rels/drawing1.xml.rels'])).toContain(
      'Target="../media/image1.png"',
    );
    const d = xml(zip, 'xl/drawings/drawing1.xml');
    const ext = d.getElementsByTagName('xdr:ext')[0]!;
    // 320 x 96 vào 160 x 48: tỉ lệ 0,5 → 160 x 48 px, 1 px = 9525 EMU
    expect(Number(ext.getAttribute('cx'))).toBe(160 * 9525);
    expect(Number(ext.getAttribute('cy'))).toBe(48 * 9525);
    // neo ở hàng đầu, cột ngay sau cột cuối của bảng
    const from = d.getElementsByTagName('xdr:from')[0]!;
    expect(from.getElementsByTagName('xdr:row')[0]!.textContent).toBe('0');
    expect(Number(from.getElementsByTagName('xdr:col')[0]!.textContent)).toBe(t.columns.length + 1);
  });

  it('ảnh nhỏ không bị phóng to; không có logo hoặc byte không phải PNG: không có drawing', () => {
    const small = unzipSync(buildXlsx(t, { ...META, logoPng: png(40, 20) }, LABELS));
    const ext = xml(small, 'xl/drawings/drawing1.xml').getElementsByTagName('xdr:ext')[0]!;
    expect(Number(ext.getAttribute('cx'))).toBe(40 * 9525);
    for (const meta of [META, { ...META, logoPng: new Uint8Array([1, 2, 3]) }]) {
      const z = unzipSync(buildXlsx(t, meta, LABELS));
      expect(Object.keys(z).filter((k) => k.includes('drawing') || k.includes('media'))).toEqual(
        [],
      );
      expect(dec.decode(z['xl/worksheets/sheet1.xml'])).not.toContain('<drawing');
    }
  });
});
