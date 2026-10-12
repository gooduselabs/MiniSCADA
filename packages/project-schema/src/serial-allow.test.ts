// E_SERIAL_NOT_ALLOWED (feature 006 T165, T166): luật theo thiết bị, chạy khi có SerialPolicy.
// Cùng quy tắc với bản C++ (core/project-manager/tests/project_validator_test.cpp).
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProject } from './index.ts';
import { NodeDirSource } from './node-source.ts';
import { serialPatternMatches, serialPortAllowed, type SerialPolicy } from './serial-allow.ts';

const DIR = resolve(__dirname, '../../../tests/project-vectors');
const codesOf = async (vector: string, serialPolicy?: SerialPolicy) => {
  const r = await validateProject(new NodeDirSource(`${DIR}/${vector}`), {
    checkSvg: false,
    ...(serialPolicy ? { serialPolicy } : {}),
  });
  return { r, codes: [...new Set(r.errors.map((e) => e.code))].sort() };
};

describe('serialPatternMatches', () => {
  it('tên tty có thể kết thúc bằng *; đường dẫn chỉ khớp đúng tên', () => {
    expect(serialPatternMatches('ttyAS*', 'ttyAS2')).toBe(true);
    expect(serialPatternMatches('ttyAS*', 'ttyUSB0')).toBe(false);
    expect(serialPatternMatches('ttyAS2', 'ttyAS2')).toBe(true);
    expect(serialPatternMatches('ttyAS2', 'ttyAS20')).toBe(false);
    expect(serialPatternMatches('/dev/serial/by-id/x', '/dev/serial/by-id/x')).toBe(true);
    expect(serialPatternMatches('/dev/serial/by-id/x', '/dev/serial/by-id/xy')).toBe(false);
    expect(serialPatternMatches('ttyAS*', '/dev/serial/by-id/x')).toBe(false);
    expect(serialPatternMatches('/dev/serial/by-id/x', 'ttyAS2')).toBe(false);
    expect(serialPatternMatches('', 'ttyAS2')).toBe(false);
  });

  it('console không bao giờ được phép, kể cả khi khớp mẫu', () => {
    const p: SerialPolicy = { allowPatterns: ['ttyAS*'], isConsole: (x) => x === 'ttyAS0' };
    expect(serialPortAllowed(p, 'ttyAS2')).toBe(true);
    expect(serialPortAllowed(p, 'ttyAS0')).toBe(false);
  });
});

describe('E_SERIAL_NOT_ALLOWED trên project 0.2', () => {
  it('không có SerialPolicy thì luật không chạy (vector chung không đổi)', async () => {
    expect((await codesOf('v02-valid-full')).codes).toEqual([]);
  });

  it('cổng ngoài danh sách của cấu hình', async () => {
    expect((await codesOf('v02-valid-full', { allowPatterns: ['ttyAS*'] })).codes).toEqual([]);
    const bad = await codesOf('v02-valid-full', { allowPatterns: ['ttyUSB*'] });
    expect(bad.codes).toEqual(['E_SERIAL_NOT_ALLOWED']);
    expect(bad.r.errors[0]!.file).toBe('connections.json');
    expect(bad.r.errors[0]!.path).toContain('/serial/port');
    expect((await codesOf('v02-valid-full', { allowPatterns: [] })).codes).toEqual([
      'E_SERIAL_NOT_ALLOWED',
    ]);
  });

  it('cổng console bị loại kể cả khi khớp mẫu', async () => {
    const p: SerialPolicy = { allowPatterns: ['ttyAS*'], isConsole: (x) => x === 'ttyAS2' };
    expect((await codesOf('v02-valid-full', p)).codes).toEqual(['E_SERIAL_NOT_ALLOWED']);
    const q: SerialPolicy = { allowPatterns: ['ttyAS*'], isConsole: (x) => x === 'ttyAS0' };
    expect((await codesOf('v02-valid-full', q)).codes).toEqual([]);
  });

  it('đường dẫn by-id, by-path được phép theo đúng tên', async () => {
    const id = 'v02-valid-serial-by-id';
    expect((await codesOf(id, { allowPatterns: ['ttyAS*', 'ttyUSB*'] })).codes).toEqual([
      'E_SERIAL_NOT_ALLOWED',
    ]);
    expect(
      (await codesOf(id, { allowPatterns: ['/dev/serial/by-id/usb-FTDI_FT232R-if00-port0'] }))
        .codes,
    ).toEqual([]);
  });

  it('cổng sai dạng chỉ báo E_SERIAL_PORT, không thêm E_SERIAL_NOT_ALLOWED', async () => {
    const r = await codesOf('v02-invalid-serial-port-windows', { allowPatterns: ['ttyUSB*'] });
    expect(r.codes).toContain('E_SERIAL_PORT');
    expect(r.codes).not.toContain('E_SERIAL_NOT_ALLOWED');
  });
});
