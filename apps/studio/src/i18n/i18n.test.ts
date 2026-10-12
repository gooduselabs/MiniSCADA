// Chuỗi giao diện (feature 004, T020, FR-014, research R13): t() thay tham số, khóa thiếu thì ném lỗi
// khi test, mọi khóa t('…') trong mã Studio có trong vi.ts.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fold, hasKey, setStrictKeys, t, type MessageKey } from './index.ts';
import { viMessages } from './vi.ts';

// Giá trị tự nhận từ môi trường lúc nạp module (import.meta.env.MODE === 'test'), trước mọi test.
const strictAtLoad = setStrictKeys(true);

describe('t()', () => {
  afterEach(() => {
    setStrictKeys(true);
  });

  it('khi chạy test, chế độ ném lỗi tự bật', () => {
    expect(strictAtLoad).toBe(true);
  });

  it('trả chuỗi tiếng Việt theo khóa', () => {
    expect(t('cmd.project.save')).toBe('Lưu');
    expect(t('tree.tagTable')).toBe('Bảng Tag mặc định');
  });

  it('thay tham số {tên}, kể cả số', () => {
    expect(t('phasePage.heading', { title: 'Alarm', phase: 'GĐ 4' })).toBe('Alarm có ở GĐ 4');
    expect(t('phasePage.heading', { title: 'Alarm', phase: 4 })).toBe('Alarm có ở 4');
    expect(t('cmd.open.screen', { name: 'Bồn nước + bơm' })).toBe('Mở màn hình Bồn nước + bơm');
    expect(t('grid.source.mock', { signal: 'tank.level' })).toBe('Mô phỏng · tank.level');
  });

  it('khóa thiếu thì ném lỗi khi test', () => {
    expect(() => t('khong.co.khoa' as MessageKey)).toThrow(/khong\.co\.khoa/);
  });

  it('thiếu tham số thì ném lỗi khi test', () => {
    expect(() => t('phasePage.heading', { title: 'Alarm' })).toThrow(/phase/);
  });

  it('bản phát hành không ném: khóa thiếu trả chính khóa, tham số thiếu giữ nguyên', () => {
    setStrictKeys(false);
    expect(t('khong.co.khoa' as MessageKey)).toBe('khong.co.khoa');
    expect(t('phasePage.heading', { title: 'Alarm' })).toBe('Alarm có ở {phase}');
  });

  it('hasKey', () => {
    expect(hasKey('cmd.project.save')).toBe(true);
    expect(hasKey('khong.co')).toBe(false);
    expect(hasKey('toString')).toBe(false);
  });
});

describe('fold() (so khớp không dấu)', () => {
  it('bỏ dấu, đ → d, chữ thường', () => {
    expect(fold('Mở Bảng Tag mặc định')).toBe('mo bang tag mac dinh');
    expect(fold('ĐIỀN XUỐNG')).toBe('dien xuong');
    expect(fold('Nạp xuống…')).toBe('nap xuong…');
    expect(fold('Người dùng và quyền')).toBe('nguoi dung va quyen');
  });

  it('chuỗi đã không dấu giữ nguyên (trừ chữ hoa)', () => {
    expect(fold('TANK01.LEVEL')).toBe('tank01.level');
  });
});

// Mã nguồn Studio (trừ file test): mọi lời gọi t('khóa') dùng khóa có thật. Khóa dựng động
// (template có ${…}) không quét được: dùng bảng tra có kiểu MessageKey thay vì dựng chuỗi.
const SRC = resolve(__dirname, '..');
function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) yield p;
  }
}
const CALL = /(?<![\w$.])t\(\s*(['"`])([^'"`$\\\n]*)\1/g;
// Bỏ chú thích (khối và cả dòng) để ví dụ trong chú thích không bị coi là lời gọi.
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('vi.ts', () => {
  it("mọi khóa t('…') trong apps/studio/src có trong vi.ts", () => {
    const missing: string[] = [];
    let found = 0;
    for (const file of sourceFiles(SRC)) {
      for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(CALL)) {
        found++;
        if (!hasKey(m[2])) missing.push(`${relative(SRC, file)}: ${m[2]}`);
      }
    }
    expect(missing).toEqual([]);
    expect(found).toBeGreaterThan(0);
  });

  it('chuỗi không rỗng, không thừa khoảng trắng, tham số viết đúng dạng {tên}', () => {
    for (const [key, text] of Object.entries(viMessages)) {
      expect(text, key).not.toBe('');
      expect(text, key).toBe(text.trim());
      // Ngoặc nhọn chỉ dùng cho tham số.
      expect(text.replace(/\{\w+\}/g, ''), key).not.toMatch(/[{}]/);
    }
  });
});
