// T042: test importer đầu cuối (FR-015, FR-018, FR-022, SC-001, SC-003, SC-010). Viết TRƯỚC, phải đỏ.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertAllowlisted, importSvg, makeSeededUid } from './index.ts';
import type { ImportReport, ImportResult } from './index.ts';
import { doc } from './test-helpers.ts';

const FIX = resolve(__dirname, '../../../tests/fixtures/svg-import');
const STRESS = resolve(__dirname, '../../../tests/fixtures/svg/factory-isometric-stress.svg');

interface LimitsModule {
  LIMIT_CASE_NAMES: string[];
  buildLimitCase: (n: string) => { content: string; expect: { outcome: string; codes: string[] } };
}
const limitsMod = (await import(
  /* @vite-ignore */ pathToFileURL(resolve(FIX, 'limits.mjs')).href
)) as LimitsModule;

const opts = (name: string) => ({ fileName: name, uid: makeSeededUid(1) });

function codesOf(r: ImportResult): Set<string> {
  const rep: ImportReport = r.report;
  const s = new Set<string>();
  for (const x of rep.removed) s.add(x.code);
  for (const x of rep.converted) s.add(x.code);
  for (const x of rep.warnings) s.add(x.code);
  if (!r.ok) s.add(r.error.code);
  return s;
}

describe('10 fixture nghiệm thu', () => {
  const manifest = JSON.parse(readFileSync(resolve(FIX, 'manifest.json'), 'utf8')) as {
    fixtures: Array<{ file: string; expectCodes: string[] }>;
  };
  it('manifest có 10 fixture', () => expect(manifest.fixtures).toHaveLength(10));
  for (const f of manifest.fixtures) {
    it(`${f.file}: nhập được, mã báo cáo khớp manifest, allowlist sạch`, () => {
      const r = importSvg(readFileSync(resolve(FIX, f.file)), opts(f.file));
      expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
      if (!r.ok) return;
      const codes = codesOf(r);
      for (const c of f.expectCodes)
        expect(codes.has(c), `thiếu mã ${c}; có ${[...codes].join(',')}`).toBe(true);
      expect(() => assertAllowlisted(r.svg)).not.toThrow();
      expect(r.elements.length).toBeGreaterThan(0);
      expect(r.viewBox[2]).toBeGreaterThan(0);
      expect(r.svg).not.toContain('<style');
      expect(r.svg).not.toContain('class=');
      expect(r.report.counts.elementsAfter).toBeLessThanOrEqual(20000);
      // UID duy nhất và đúng định dạng
      const uids = r.elements.map((e) => e.uid);
      expect(new Set(uids).size).toBe(uids.length);
      expect(r.report.counts.uidAssigned).toBe(uids.length);
    });
  }
  it('nhập tất định: hai lần cùng seed cho cùng từng byte (cả báo cáo)', () => {
    for (const f of manifest.fixtures) {
      const bytes = readFileSync(resolve(FIX, f.file));
      const a = importSvg(bytes, opts(f.file));
      const b = importSvg(bytes, opts(f.file));
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(a.svg).toBe(b.svg);
        expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
      }
    }
  });
  it('nhập lại bản đã nhập: ổn định (không mất phần tử), xanh allowlist', () => {
    const f = manifest.fixtures[0].file;
    const a = importSvg(readFileSync(resolve(FIX, f)), opts(f));
    if (!a.ok) throw new Error('nhập lần 1 lỗi');
    const b = importSvg(a.svg, opts(f));
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.report.counts.elementsAfter).toBe(a.report.counts.elementsAfter);
  });
});

interface Expect {
  id: string;
  outcome: 'sanitized' | 'rejected';
  codes: string[];
  forbid: string[];
  keep?: string[];
  generated?: { case: string };
}

describe('bộ SVG độc hại (SC-003)', () => {
  const dir = resolve(FIX, 'malicious');
  const files = readdirSync(dir).filter((f) => f.endsWith('.expect.json'));
  it('có >= 30 ca', () => expect(files.length).toBeGreaterThanOrEqual(30));
  for (const f of files) {
    const ex = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Expect;
    it(`${ex.id}`, () => {
      const input: string | Uint8Array = ex.generated
        ? limitsMod.buildLimitCase(ex.generated.case).content
        : readFileSync(resolve(dir, ex.id + '.svg'));
      const r = importSvg(input, opts(ex.id));
      const codes = codesOf(r);
      for (const c of ex.codes)
        expect(codes.has(c), `thiếu ${c}; có ${[...codes].join(',')}`).toBe(true);
      if (ex.outcome === 'rejected') {
        expect(r.ok).toBe(false);
        return;
      }
      expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
      if (!r.ok) return;
      const lower = r.svg.toLowerCase();
      for (const bad of ex.forbid)
        expect(lower.includes(bad.toLowerCase()), `còn "${bad}"`).toBe(false);
      for (const keep of ex.keep ?? []) expect(r.svg.includes(keep), `mất "${keep}"`).toBe(true);
      expect(() => assertAllowlisted(r.svg)).not.toThrow();
      // báo cáo không chứa nội dung gốc nguy hiểm
      expect(JSON.stringify(r.report)).not.toContain('__pwned');
    });
  }
});

describe('ca giới hạn đúng biên (SC-010)', () => {
  for (const name of limitsMod.LIMIT_CASE_NAMES) {
    it(
      name,
      () => {
        const c = limitsMod.buildLimitCase(name);
        const r = importSvg(c.content, { uid: makeSeededUid(1) });
        const codes = codesOf(r);
        if (c.expect.outcome === 'rejected') {
          expect(r.ok, name).toBe(false);
          for (const code of c.expect.codes)
            expect(codes.has(code), `${name}: thiếu ${code}`).toBe(true);
        } else {
          expect(r.ok, r.ok ? '' : JSON.stringify(r.error)).toBe(true);
          if (c.expect.outcome === 'sanitized')
            for (const code of c.expect.codes)
              expect(codes.has(code), `${name}: thiếu ${code}`).toBe(true);
          else
            for (const bad of ['R_IMAGE_LIMIT', 'R_FILTER_LIMIT', 'R_TEXT_LONG', 'R_VALUE_INVALID'])
              expect(codes.has(bad), `${name}: ${bad}`).toBe(false);
        }
      },
      120_000,
    );
  }
});

describe('hành vi khác', () => {
  it('đầu vào xấu trả ok:false, không ném lỗi', () => {
    for (const input of ['', 'abc', '<svg', new Uint8Array(0)]) {
      const r = importSvg(input, opts('x'));
      expect(r.ok).toBe(false);
    }
  });
  it('không có phần tử vẽ được: W_IMPORT_NO_DRAWABLE', () => {
    const r = importSvg(doc('<g/>'), opts('x'));
    expect(r.ok).toBe(true);
    expect(codesOf(r).has('W_IMPORT_NO_DRAWABLE')).toBe(true);
  });
  it('use vòng và use bom bị từ chối E_IMPORT_USE_BOMB', () => {
    const cyc = importSvg(doc('<g id="a"><use href="#a"/></g><use href="#a"/>'), opts('x'));
    expect(cyc).toMatchObject({ ok: false, error: { code: 'E_IMPORT_USE_BOMB' } });
  });
  it('tên inkscape:label thành data-mat-name; data-mat-uid nguồn bị bỏ', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="10" height="10" viewBox="0 0 10 10"><rect id="rect1" inkscape:label="Bồn chính" data-mat-uid="el_fake123456" width="5" height="5"/></svg>`;
    const r = importSvg(svg, opts('x'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain('data-mat-name="Bồn chính"');
    expect(r.svg).not.toContain('el_fake123456');
    expect(r.elements[0].name).toBe('Bồn chính');
    expect(r.report.counts.named).toBe(1);
  });
  it('lớp của trình vẽ SVG (data-mat-layer trên g, T166) được giữ khi nhập lại', () => {
    const r = importSvg(
      doc(
        '<g data-mat-layer="Bơm"><rect width="5" height="5"/></g><rect data-mat-layer="X" width="1" height="1"/>',
      ),
      opts('x'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain('data-mat-layer="Bơm"');
    expect(r.svg).not.toContain('data-mat-layer="X"');
    assertAllowlisted(r.svg);
  });
  it('báo cáo: tên tệp, byte, sha256, phần mềm', () => {
    const r = importSvg(
      readFileSync(resolve(FIX, 'inkscape-01-tank-process.svg')),
      opts('inkscape-01-tank-process.svg'),
    );
    expect(r.report.file.name).toBe('inkscape-01-tank-process.svg');
    expect(r.report.file.sha256).toHaveLength(64);
    expect(r.report.generator.name).toContain('Inkscape');
  });
});

describe('thời gian và file stress', () => {
  it('đo nhập 20.000 phần tử trong jsdom', () => {
    const c = limitsMod.buildLimitCase('elements-20000');
    const t0 = performance.now();
    const r = importSvg(c.content, { uid: makeSeededUid(1) });
    const ms = performance.now() - t0;
    console.log(`IMPORT_20000_MS=${Math.round(ms)}`);
    expect(r.ok).toBe(true);
  }, 120_000);

  it.skipIf(!existsSync(STRESS))(
    'factory-isometric-stress: không Tối ưu vượt 20.000; có Tối ưu <= 20.000 và < 5 MiB',
    () => {
      const bytes = readFileSync(STRESS);
      const a = importSvg(bytes, opts('stress'));
      expect(a).toMatchObject({ ok: false, error: { code: 'E_IMPORT_LIMIT' } });
      const t0 = performance.now();
      const b = importSvg(bytes, { ...opts('stress'), optimize: true });
      console.log(`IMPORT_STRESS_OPT_MS=${Math.round(performance.now() - t0)}`);
      expect(b.ok, b.ok ? '' : JSON.stringify(b.error)).toBe(true);
      if (b.ok) {
        expect(b.report.counts.elementsAfter).toBeLessThanOrEqual(20000);
        expect(b.report.optimize.enabled).toBe(true);
        expect(b.report.optimize.merged).toBeGreaterThan(0);
        expect(b.svg.length).toBeLessThan(5 * 1024 * 1024);
      }
    },
    600_000,
  );
});
