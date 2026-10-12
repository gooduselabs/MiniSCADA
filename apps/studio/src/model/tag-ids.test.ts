// Tên Tag tự tăng số (feature 004, T010, FR-020): thêm dòng và điền xuống cột tên.
import { describe, expect, it } from 'vitest';
import { nextTagId } from './tag-ids.ts';

describe('nextTagId', () => {
  it('tăng nhóm số cuối, giữ số chữ số', () => {
    expect(nextTagId('TANK02.LEVEL')).toBe('TANK03.LEVEL');
    expect(nextTagId('T_09')).toBe('T_10');
    expect(nextTagId('X_001')).toBe('X_002');
    expect(nextTagId('AI3.X')).toBe('AI4.X');
  });

  it('nhóm số cuối cùng được tăng, nhóm trước giữ nguyên', () => {
    expect(nextTagId('TANK01.LEVEL2')).toBe('TANK01.LEVEL3');
    expect(nextTagId('L1.T9.X')).toBe('L1.T10.X');
  });

  it('tràn số chữ số thì thêm chữ số', () => {
    expect(nextTagId('T_99')).toBe('T_100');
    expect(nextTagId('T9')).toBe('T10');
  });

  it('số rất dài không mất chính xác', () => {
    expect(nextTagId('T_99999999999999999999')).toBe('T_100000000000000000000');
  });

  it('không có số thì thêm _1', () => {
    expect(nextTagId('PUMP.RUN')).toBe('PUMP.RUN_1');
    expect(nextTagId('MOTOR')).toBe('MOTOR_1');
  });

  it('trùng tên đã có thì tăng tiếp', () => {
    expect(nextTagId('TANK02.LEVEL', ['TANK03.LEVEL', 'TANK04.LEVEL'])).toBe('TANK05.LEVEL');
    expect(nextTagId('PUMP.RUN', new Set(['PUMP.RUN_1']))).toBe('PUMP.RUN_2');
    // so khớp đúng chữ hoa/thường như bộ kiểm tra (E_DUP_TAG)
    expect(nextTagId('T_1', ['t_2'])).toBe('T_2');
  });

  it('tên trống hoặc toàn khoảng trắng: bắt đầu từ TAG_1', () => {
    expect(nextTagId('')).toBe('TAG_1');
    expect(nextTagId('  ', ['TAG_1'])).toBe('TAG_2');
  });

  it('bỏ khoảng trắng đầu cuối của tên gốc', () => {
    expect(nextTagId(' T_01 ')).toBe('T_02');
  });
});
