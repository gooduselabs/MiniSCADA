// T088: test đỏ thư viện ký hiệu (FR-055, FR-056, SC-017; contract symbol-library §2, §4). Viết TRƯỚC src/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSvg, sanitizeSvg } from '@mat/svg-renderer';
import { importSvg } from '@mat/svg-import';
import {
  SUGGEST_IDS,
  SYMBOL_MANIFEST,
  SYMBOLS,
  getSymbol,
  getSymbolSvg,
  searchSymbols,
  symbolFiles,
  symbolsByCategory,
  validateManifest,
} from '../src/index.ts';
import { MANIFEST_DATA, SVG_DATA } from '../src/symbols-data.ts';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

/** Mọi tệp SVG (kể cả biến thể) với ký hiệu chủ và danh sách điểm gắn của tệp. */
const FILES = SYMBOLS.flatMap((s) => symbolFiles(s));

const PALETTE = new Set(['none', '#37474f', '#eceff1', '#b0bec5', '#1e88e5', '#ffffff']);

describe('manifest.json', () => {
  const raw = JSON.parse(read('manifest.json')) as unknown;

  it('hợp lệ theo schema (validateManifest không có lỗi)', () => {
    expect(validateManifest(raw)).toEqual([]);
  });

  it('12 ký hiệu, 5 nhóm, 15 tệp SVG, giấy phép CC0-1.0', () => {
    expect(SYMBOLS).toHaveLength(12);
    expect(SYMBOL_MANIFEST.categories.map((c) => c.id)).toEqual([
      'tank',
      'pump',
      'valve',
      'motor',
      'pipe',
    ]);
    expect(SYMBOL_MANIFEST.license).toBe('CC0-1.0');
    expect(FILES).toHaveLength(15);
    expect(new Set(FILES.map((f) => f.file)).size).toBe(15);
  });

  it('mọi nhóm có ký hiệu; id duy nhất', () => {
    for (const c of SYMBOL_MANIFEST.categories) {
      expect(symbolsByCategory(c.id).length).toBeGreaterThan(0);
    }
    expect(new Set(SYMBOLS.map((s) => s.id)).size).toBe(SYMBOLS.length);
  });

  it('thư mục svg/ có đúng các tệp mà manifest khai báo', () => {
    const onDisk = readdirSync(resolve(ROOT, 'svg')).sort();
    expect(onDisk).toEqual(FILES.map((f) => f.file.replace('svg/', '')).sort());
  });

  it('validateManifest bắt lỗi: uid sai, vai trò trùng, gợi ý lạ, điểm gắn ngoài hộp', () => {
    const bad = structuredClone(raw) as typeof MANIFEST_DATA;
    const s = bad.symbols[2]; // pump-centrifugal
    s.parts[0].uid = 'el_sai';
    s.parts[1].role = s.parts[0].role;
    s.parts[2].suggest = ['khong-co'];
    s.ports[0].x = 1.5;
    const errs = validateManifest(bad);
    expect(errs.length).toBeGreaterThanOrEqual(4);
    expect(errs.some((e) => e.includes('uid'))).toBe(true);
    expect(errs.some((e) => e.includes('role'))).toBe(true);
    expect(errs.some((e) => e.includes('suggest'))).toBe(true);
    expect(errs.some((e) => e.includes('port'))).toBe(true);
  });

  it('validateManifest từ chối đầu vào không phải đối tượng', () => {
    expect(validateManifest(null).length).toBeGreaterThan(0);
    expect(validateManifest(42).length).toBeGreaterThan(0);
  });

  it('suggest nằm trong danh sách động hóa (14 id của contract studio-svg-editor §5)', () => {
    expect(SUGGEST_IDS).toContain('level');
    for (const s of SYMBOLS)
      for (const p of s.parts)
        for (const g of p.suggest) {
          expect(SUGGEST_IDS).toContain(g);
        }
  });
});

describe('dữ liệu sinh (symbols-data.ts) khớp tệp', () => {
  it('MANIFEST_DATA bằng manifest.json', () => {
    expect(MANIFEST_DATA).toEqual(JSON.parse(read('manifest.json')));
  });

  it('SVG_DATA khớp từng tệp, không thừa không thiếu', () => {
    expect(Object.keys(SVG_DATA).sort()).toEqual(FILES.map((f) => f.file).sort());
    for (const f of FILES) expect(SVG_DATA[f.file]).toBe(read(f.file));
  });

  it('getSymbolSvg, getSymbol, searchSymbols', () => {
    expect(getSymbolSvg('svg/pump-centrifugal.svg')).toBe(read('svg/pump-centrifugal.svg'));
    expect(getSymbolSvg('svg/khong-co.svg')).toBeNull();
    expect(getSymbol('fan')?.name).toBe('Quạt');
    expect(getSymbol('khong-co')).toBeUndefined();
    expect(
      searchSymbols('bơm')
        .map((s) => s.id)
        .sort(),
    ).toEqual(['pump-centrifugal', 'pump-dosing']);
    expect(searchSymbols('ELBOW').map((s) => s.id)).toEqual(['pipe-elbow']);
    expect(searchSymbols('').length).toBe(12);
    expect(searchSymbols('zzzz')).toEqual([]);
  });
});

describe.each(FILES)('ký hiệu $symbol.id / $file', ({ symbol, file, ports }) => {
  const text = read(file);
  const root = parseSvg(text);
  const all = [root as Element, ...Array.from(root.querySelectorAll('*'))];

  it('qua sanitizeSvg (allowlist) mà không bị loại gì', () => {
    const report = sanitizeSvg(parseSvg(text));
    expect(report.removedElements).toEqual({});
    expect(report.removedAttributes).toBe(0);
    expect(report.removedDataAttributes).toBe(0);
    expect(report.unwrapped).toBe(0);
    expect(report.codes).toEqual({});
  });

  it('qua importSvg: ok và converted rỗng', () => {
    const r = importSvg(text, { fileName: file });
    expect(r.ok).toBe(true);
    expect(r.report.converted).toEqual([]);
    // importSvg gán UID mới nên bỏ data-mat-uid của nguồn (ADR-003 mục 4): đó là điều duy nhất được loại.
    for (const rm of r.report.removed) {
      expect([rm.code, rm.name]).toEqual(['R_DATA_ATTR', 'data-mat-uid']);
    }
  });

  it('không <style>, không class, không id; có <title> (QUYẾT ĐỊNH: con đầu của nhóm gốc)', () => {
    expect(root.querySelectorAll('style')).toHaveLength(0);
    expect(root.querySelectorAll('[class],[id]')).toHaveLength(0);
    // Allowlist chỉ giữ <title> làm con của phần tử gắn được (g, rect, ...); <title> ở gốc <svg> bị loại,
    // nên contract §4 "title ở gốc" được hiện thực bằng <g><title>…</title>…</g> bọc toàn bộ nội dung.
    const wrap = root.firstElementChild;
    expect(wrap?.localName).toBe('g');
    expect(wrap?.hasAttribute('data-mat-uid')).toBe(false);
    expect(root.children).toHaveLength(1);
    const title = wrap?.firstElementChild;
    expect(title?.localName).toBe('title');
    expect((title?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('≤ 8 KB và ≤ 60 phần tử', () => {
    expect(statSync(resolve(ROOT, file)).size).toBeLessThanOrEqual(8 * 1024);
    expect(all.length).toBeLessThanOrEqual(60);
  });

  it('viewBox của tệp bằng manifest', () => {
    const vb = (root.getAttribute('viewBox') ?? '').trim().split(/\s+/).map(Number);
    expect(vb).toEqual(symbol.viewBox);
  });

  it('mỗi parts[].uid có đúng một phần tử data-mat-uid, nằm ngoài defs; không UID thừa', () => {
    const uids = all.map((e) => e.getAttribute('data-mat-uid')).filter((u): u is string => !!u);
    expect([...uids].sort()).toEqual(symbol.parts.map((p) => p.uid).sort());
    for (const p of symbol.parts) {
      const els = all.filter((e) => e.getAttribute('data-mat-uid') === p.uid);
      expect(els).toHaveLength(1);
      expect(els[0].closest('defs')).toBeNull();
    }
  });

  it('điểm gắn trong hộp bao [0,1] và nằm trên cạnh khớp hướng', () => {
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
      const edge = { w: p.x === 0, e: p.x === 1, n: p.y === 0, s: p.y === 1 }[p.dir];
      expect(edge, `${p.id} hướng ${p.dir} phải nằm trên cạnh tương ứng`).toBe(true);
    }
  });

  it('màu trung tính, nét rộng 2, tọa độ tối đa một chữ số thập phân, không phông hãng', () => {
    for (const e of all) {
      for (const a of ['fill', 'stroke']) {
        const v = e.getAttribute(a);
        if (v !== null) expect(PALETTE.has(v), `${a}="${v}"`).toBe(true);
      }
      const sw = e.getAttribute('stroke-width');
      if (sw !== null) expect(sw).toBe('2');
      const ff = e.getAttribute('font-family');
      if (ff !== null) expect(ff).toBe('sans-serif');
    }
    // Tọa độ và kích thước tối đa một chữ số thập phân (độ mờ như stroke-opacity không phải tọa độ).
    for (const e of all) {
      for (const a of Array.from(e.attributes)) {
        if (a.name.endsWith('opacity')) continue;
        expect(/\d\.\d{2,}/.test(a.value), `${a.name}="${a.value}"`).toBe(false);
      }
    }
    expect(text.includes('<image')).toBe(false);
  });

  it('quy tắc theo vai trò (contract §4)', () => {
    for (const p of symbol.parts) {
      const el = all.find((e) => e.getAttribute('data-mat-uid') === p.uid)!;
      if (p.role === 'hit') {
        expect(el.getAttribute('fill')).toBe('none');
        expect(el.getAttribute('stroke')).toBe('none');
      }
      if (p.role === 'flow') {
        expect(['line', 'path']).toContain(el.localName);
        expect(el.getAttribute('stroke')).not.toBeNull();
        expect(el.getAttribute('stroke-dasharray')).not.toBeNull();
      }
      if (['impeller', 'rotor', 'blades'].includes(p.role)) {
        expect(el.localName).toBe('g');
      }
      if (p.role === 'text') expect(el.localName).toBe('text');
      if (p.role === 'liquid') {
        const body = all.find(
          (e) => e.getAttribute('data-mat-uid') === `el_${symbol.id.replaceAll('-', '_')}_body`,
        )!;
        const w = (e: Element, a: string): number => Number(e.getAttribute(a));
        expect(el.localName).toBe('rect');
        // hộp bao chất lỏng nằm trong hộp bao thân và phủ phần lớn phần trong
        expect(w(el, 'x')).toBeGreaterThanOrEqual(w(body, 'x'));
        expect(w(el, 'y')).toBeGreaterThanOrEqual(w(body, 'y'));
        expect(w(el, 'width')).toBeGreaterThan(w(body, 'width') * 0.9);
        expect(w(el, 'height')).toBeGreaterThan(w(body, 'height') * 0.9);
      }
    }
  });

  it('gợi ý mặc định theo vai trò (contract §3)', () => {
    const expected: Record<string, string[]> = {
      liquid: ['level'],
      text: ['text'],
      impeller: ['spin'],
      rotor: ['spin'],
      blades: ['spin'],
      lamp: ['fill', 'blink'],
      flow: ['flow'],
      pipe: ['fill'],
      body: ['fill'],
      actuator: ['fill'],
      plunger: ['translateX'],
      handwheel: ['rotate'],
      stem: ['translateY'],
      arrow: ['visibility'],
      hit: ['click'],
    };
    for (const p of symbol.parts) expect(p.suggest).toEqual(expected[p.role]);
  });
});

describe('giấy phép', () => {
  it('LICENSES.md của gói nêu CC0-1.0, do dự án vẽ, không logo/hình/font của hãng', () => {
    const t = read('LICENSES.md');
    expect(t).toContain('CC0-1.0');
    expect(t).toContain('do dự án');
    expect(t).toContain('không');
    expect(existsSync(resolve(ROOT, 'LICENSES.md'))).toBe(true);
  });

  it('third_party/LICENSES.md có dòng về ký hiệu do dự án vẽ', () => {
    const t = readFileSync(resolve(ROOT, '../../third_party/LICENSES.md'), 'utf8');
    expect(t).toContain('@mat/symbols');
    expect(t).toContain('CC0-1.0');
  });
});
