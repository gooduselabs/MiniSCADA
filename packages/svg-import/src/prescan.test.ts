// T037: test tiền xử lý (FR-012; contract svg-import §1, research R3). Viết TRƯỚC, phải đỏ.
import { describe, expect, it } from 'vitest';
import { parseXml } from './dom.ts';
import { prescan } from './prescan.ts';
import { doc } from './test-helpers.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const MIB5 = 5 * 1024 * 1024;

describe('prescan: mã hóa', () => {
  it('bỏ BOM UTF-8', () => {
    const body = enc(doc('<rect width="1" height="1"/>'));
    const r = prescan(new Uint8Array([0xef, 0xbb, 0xbf, ...body]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text.charCodeAt(0)).toBe(60);
  });
  it('UTF-8 hỏng: E_IMPORT_ENCODING', () => {
    expect(prescan(new Uint8Array([0x3c, 0x73, 0xc3, 0x28]))).toMatchObject({
      ok: false,
      code: 'E_IMPORT_ENCODING',
    });
  });
  it('UTF-16 (BOM FF FE hoặc FE FF): E_IMPORT_ENCODING', () => {
    expect(prescan(new Uint8Array([0xff, 0xfe, 0x3c, 0x00]))).toMatchObject({ code: 'E_IMPORT_ENCODING' });
    expect(prescan(new Uint8Array([0xfe, 0xff, 0x00, 0x3c]))).toMatchObject({ code: 'E_IMPORT_ENCODING' });
  });
  it('khai báo encoding khác UTF-8: E_IMPORT_ENCODING; UTF-8 hoặc utf-8: ổn', () => {
    const mk = (e: string) => `<?xml version="1.0" encoding="${e}"?>${doc('')}`;
    expect(prescan(mk('ISO-8859-1'))).toMatchObject({ ok: false, code: 'E_IMPORT_ENCODING' });
    expect(prescan(mk('UTF-8')).ok).toBe(true);
    expect(prescan(mk('utf-8')).ok).toBe(true);
  });
});

describe('prescan: giới hạn byte', () => {
  it('5 MiB + 1 byte bị từ chối trong <= 50 ms, không parse', () => {
    const big = new Uint8Array(MIB5 + 1).fill(32);
    const t0 = performance.now();
    const r = prescan(big);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(r).toMatchObject({ ok: false, code: 'E_IMPORT_LIMIT' });
  });
  it('đúng 5 MiB vẫn qua', () => {
    const s = doc('<rect width="1" height="1"/>');
    const padded = enc(s + ' '.repeat(MIB5 - s.length));
    expect(padded.length).toBe(MIB5);
    expect(prescan(padded).ok).toBe(true);
  });
});

const ADOBE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
 <!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
 <!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
 <!ENTITY ns_svg "http://www.w3.org/2000/svg">
 <!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
]>
<svg xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" width="10" height="10"><rect width="1" height="1"/></svg>`;

describe('prescan: DOCTYPE', () => {
  it('entity namespace Adobe đã biết: thay bằng URI rồi bỏ DTD (C_ENTITY)', () => {
    const r = prescan(ADOBE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dtdRemoved).toBe(true);
    expect(r.entities).toBeGreaterThanOrEqual(4);
    expect(r.text).not.toContain('DOCTYPE');
    expect(r.text).not.toContain('&ns_');
    expect(r.text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(parseXml(r.text).ok).toBe(true);
  });
  it('DOCTYPE không có tập con nội bộ: bỏ, không lỗi', () => {
    const r = prescan('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">' + doc(''));
    expect(r.ok && r.dtdRemoved).toBe(true);
  });
  it('dấu > và ]> trong chuỗi nháy hoặc chú thích không kết thúc sớm', () => {
    const r = prescan(
      '<!DOCTYPE svg [ <!ENTITY ns_svg "http://www.w3.org/2000/svg"> <!-- ]> --> ]>' + doc(''),
    );
    expect(r.ok).toBe(true);
  });
  it('entity lạ, SYSTEM, PUBLIC, tham số, giá trị khác bảng, bom: E_IMPORT_DTD', () => {
    const cases = [
      '<!DOCTYPE svg [<!ENTITY x "hello">]>',
      '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>',
      '<!DOCTYPE svg [<!ENTITY x PUBLIC "a" "http://e/x">]>',
      '<!DOCTYPE svg [<!ENTITY % p "x">]>',
      '<!DOCTYPE svg [<!ENTITY ns_svg "http://evil.example/">]>',
      '<!DOCTYPE svg [<!ENTITY a "x"><!ENTITY b "&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;">]>',
    ];
    for (const c of cases) expect(prescan(c + doc('')), c).toMatchObject({ ok: false, code: 'E_IMPORT_DTD' });
  });
});

describe('prescan: chỉ thị xử lý', () => {
  it('bỏ PI (xml-stylesheet), không tính khai báo xml', () => {
    const r = prescan('<?xml version="1.0"?><?xml-stylesheet href="http://evil.example/x.css"?>' + doc(''));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pis).toEqual(['xml-stylesheet']);
    expect(r.text).not.toContain('xml-stylesheet');
  });
});

describe('parseXml: gốc và lỗi', () => {
  it('gốc không phải svg hoặc sai namespace: E_IMPORT_ROOT', () => {
    expect(parseXml('<html xmlns="http://www.w3.org/1999/xhtml"/>')).toMatchObject({
      ok: false,
      code: 'E_IMPORT_ROOT',
    });
    expect(parseXml('<svg width="1"/>')).toMatchObject({ ok: false, code: 'E_IMPORT_ROOT' });
    expect(parseXml('<g xmlns="http://www.w3.org/2000/svg"/>')).toMatchObject({
      ok: false,
      code: 'E_IMPORT_ROOT',
    });
  });
  it('XML hỏng: E_IMPORT_PARSE', () => {
    expect(parseXml('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>')).toMatchObject({
      ok: false,
      code: 'E_IMPORT_PARSE',
    });
  });
  it('svg hợp lệ', () => {
    const r = parseXml(doc('<rect/>'));
    expect(r.ok && r.root.localName).toBe('svg');
  });
});
