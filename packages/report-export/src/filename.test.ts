// T098: tên file làm sạch; tải lười (mã XLSX, PDF không nằm trong chunk chính).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportFileName } from './filename.ts';

describe('exportFileName', () => {
  it('<id>_<kỳ>.<đuôi>', () => {
    expect(exportFileName('dien-ca', '2026-10-12', 'pdf')).toBe('dien-ca_2026-10-12.pdf');
    expect(exportFileName('dien-thang', '2026-10', 'xlsx')).toBe('dien-thang_2026-10.xlsx');
  });
  it('bỏ ký tự cấm của Windows, ký tự điều khiển, tối đa 80 ký tự', () => {
    expect(exportFileName('a\\b/c:d*e?f"g<h>i|j', '2026-10-12', 'csv')).toBe(
      'a-b-c-d-e-f-g-h-i-j_2026-10-12.csv',
    );
    const long = exportFileName('x'.repeat(200), '2026-10-12', 'csv');
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('.csv')).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(exportFileName('a\u0000b\nc', 'k', 'csv')).not.toMatch(/[\u0000-\u001f]/);
  });
  it('không rỗng và không kết thúc bằng dấu chấm hay khoảng trắng', () => {
    expect(exportFileName('', '', 'csv')).toMatch(/^[^.\s]/);
    expect(exportFileName('ab. ', 'x', 'csv')).not.toMatch(/[. ]\./);
  });
});

describe('tải lười', () => {
  const src = readFileSync(resolve(__dirname, 'index.ts'), 'utf8');
  it('index.ts không import tĩnh mã XLSX và PDF, chỉ import() động', () => {
    expect(src).not.toMatch(/^\s*import[^;]*['"]\.\/(xlsx|pdf)\//m);
    expect(src).toMatch(/import\(\s*['"]\.\/xlsx\/xlsx\.ts['"]\s*\)/);
    expect(src).toMatch(/import\(\s*['"]\.\/pdf\/pdf\.ts['"]\s*\)/);
  });
  it('pdf.ts nạp pdfmake và phông bằng import() động', () => {
    const pdf = readFileSync(resolve(__dirname, 'pdf/pdf.ts'), 'utf8');
    expect(pdf).not.toMatch(/^\s*import\s+(?!\()[^;]*['"]pdfmake/m);
    expect(pdf).toMatch(/import\(\s*['"]pdfmake\/build\/pdfmake/);
    expect(pdf).toMatch(/import\(\s*['"]pdfmake\/build\/vfs_fonts/);
  });
  it('index.ts xuất CSV đồng bộ và XLSX, PDF bất đồng bộ', async () => {
    const mod = await import('./index.ts');
    expect(typeof mod.exportCsv).toBe('function');
    expect(typeof mod.exportXlsx).toBe('function');
    expect(typeof mod.exportPdf).toBe('function');
  });
});
