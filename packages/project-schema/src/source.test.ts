// Đường dẫn an toàn (isSafeRelPath): cùng luật với bản C++ (project_validator isSafeRelPath) và Rust
// (check_rel của Studio).
import { describe, expect, it } from 'vitest';
import { isSafeRelPath, MemorySource } from './source.ts';

describe('isSafeRelPath', () => {
  it('nhận đường dẫn tương đối thường, từ chối tuyệt đối, `..`, `\\`, `:`, ký tự điều khiển, > 128 byte', () => {
    expect(isSafeRelPath('screens/a.svg')).toBe(true);
    for (const bad of [
      '',
      '../a.svg',
      '/etc/a.svg',
      'C:\\a.svg',
      'a//b.svg',
      './a.svg',
      'a\u0001.svg',
    ])
      expect(isSafeRelPath(bad), bad).toBe(false);
    expect(isSafeRelPath('a'.repeat(129))).toBe(false);
  });

  // T062 (rà soát bảo mật S2): Windows bỏ dấu `.`/khoảng trắng cuối tên (hai tên khác nhau trỏ cùng
  // một file) và coi CON, PRN, AUX, NUL, COM1-9, LPT1-9 (kèm đuôi hay không, mọi kiểu chữ) là thiết bị.
  it('từ chối đoạn kết thúc bằng `.`/khoảng trắng và tên thiết bị của Windows', () => {
    for (const bad of [
      'a./b.json',
      'a /b.json',
      'screens /s.svg',
      'a.json.',
      'a.json ',
      'screens/CON.json',
      'con.svg',
      'nul.json',
      'nul.svg',
      'Prn.json',
      'aux/x.json',
      'Com1.json',
      'screens/lpt9.x.json',
      'COM9.svg',
      'con .json',
      'LPT1 .svg',
      'Con',
    ])
      expect(isSafeRelPath(bad), bad).toBe(false);
    for (const ok of [
      'screens/console.json',
      'console.json',
      'com10.json',
      'com0.json',
      'contact.json',
      'lpt.json',
      'nul-x.json',
      'auxiliary/x.svg',
      '.mat-editor/autosave/a.svg',
      'value-tables/TrangThai.json',
    ])
      expect(isSafeRelPath(ok), ok).toBe(true);
  });

  it('MemorySource trả bad-path cho tên thiết bị', async () => {
    expect(await new MemorySource({ 'nul.json': '{}' }).read('nul.json')).toEqual({
      error: 'bad-path',
    });
  });
});
