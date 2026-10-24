// Phần Studio của kênh Mitsubishi MC (feature 017, US4, FR-011): gợi ý mềm tại ô, thông báo lỗi địa chỉ, ví dụ theo kiểu,
// bước tăng địa chỉ (điền xuống, Thêm hàng loạt), end code của chẩn đoán (contracts/mc-protocol.md §4).
import type { Channel, FieldDevice } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n/index.ts';
import {
  mcAddressError,
  mcDefaultStep,
  mcEndCode,
  mcEndReason,
  mcExamples,
  mcFieldHint,
  mcStepAddress,
} from './mc.ts';

const ch = (extra: Partial<Channel> = {}): Channel => ({
  id: 'mc1',
  name: 'MC',
  kind: 'mc',
  tcp: { host: '192.168.3.39' },
  devices: [],
  ...extra,
});
const dev = (extra: Partial<FieldDevice> = {}): FieldDevice => ({ id: 'fx', name: 'FX', ...extra });

describe('mcFieldHint: gợi ý mềm', () => {
  it('kênh: cổng 502, ASCII, UDP; mặc định thì không có gợi ý', () => {
    expect(mcFieldHint('mcPort', 'channel', ch())).toBeNull();
    expect(mcFieldHint('mcPort', 'channel', ch({ tcp: { host: 'x', port: 502 } }))?.key).toBe(
      'mc.hint.port502',
    );
    expect(mcFieldHint('mcCode', 'channel', ch({ mc: { code: 'ascii' } }))?.key).toBe(
      'mc.hint.ascii',
    );
    expect(mcFieldHint('mcTransport', 'channel', ch({ mc: { transport: 'udp' } }))?.key).toBe(
      'mc.hint.udp',
    );
    expect(mcFieldHint('mcFrame', 'channel', ch({ mc: { frame: '4E' } }))).toBeNull();
  });

  it('trạm không khớp mạng; module I/O lạ; đọc rải tắt; khoảng gộp lớn hơn khối; rmw', () => {
    expect(mcFieldHint('station', 'device', dev())).toBeNull();
    expect(mcFieldHint('station', 'device', dev({ station: 3 }))?.key).toBe(
      'mc.hint.stationDirect',
    );
    expect(mcFieldHint('station', 'device', dev({ network: 2 }))?.key).toBe(
      'mc.hint.stationRemote',
    );
    expect(mcFieldHint('station', 'device', dev({ network: 2, station: 3 }))).toBeNull();
    expect(mcFieldHint('moduleIo', 'device', dev())).toBeNull();
    expect(mcFieldHint('moduleIo', 'device', dev({ moduleIo: 0x03e1 }))).toBeNull();
    expect(mcFieldHint('moduleIo', 'device', dev({ moduleIo: 0x1234 }))?.key).toBe(
      'mc.hint.moduleIo',
    );
    expect(mcFieldHint('maxRandomPoints', 'device', dev({ randomRead: false }))?.key).toBe(
      'mc.hint.randomOff',
    );
    const gap = mcFieldHint('maxGapWords', 'device', dev({ maxBatchWords: 10, maxGapWords: 20 }));
    expect(gap).toEqual({ key: 'mc.hint.gapOverBatch', params: { n: 10 } });
    expect(t(gap!.key, gap!.params)).toMatch(/10/);
    expect(
      mcFieldHint('mcRegisterBit', 'device', dev({ write: { registerBit: 'rmw' } }))?.key,
    ).toBe('mc.hint.rmw');
  });
});

describe('địa chỉ Tag MC', () => {
  it('thông báo lỗi theo mã; X, Y có chữ số ngoài 0–7 khi thiết bị viết bát phân: lỗi riêng', () => {
    expect(mcAddressError('E_ADDR_SYNTAX', 'Q100', 'hex')).toBe('tt.err.mcAddress');
    expect(mcAddressError('E_ADDR_SYNTAX', 'X18', 'octal')).toBe('tt.err.mcOctal');
    expect(mcAddressError('E_ADDR_SYNTAX', 'x1f', 'octal')).toBe('tt.err.mcOctal');
    expect(mcAddressError('E_ADDR_SYNTAX', 'X18', 'hex')).toBe('tt.err.mcAddress');
    expect(mcAddressError('E_ADDR_AREA', 'M10', 'hex')).toBe('tt.err.mcAddressArea');
    expect(mcAddressError('E_ADDR_RANGE', 'D16777215', undefined)).toBe('tt.err.mcAddressRange');
    for (const k of ['tt.err.mcAddress', 'tt.err.mcOctal'] as const) expect(t(k)).toMatch(/X/);
  });

  it('ví dụ theo kiểu: BOOL dùng thiết bị bit và D100.5; số dùng thiết bị word; bát phân thì X17', () => {
    expect(mcExamples('BOOL')).toContain('D100.5');
    expect(mcExamples('BOOL')).toContain('X1F');
    expect(mcExamples('BOOL', 'octal')).toContain('X17');
    expect(mcExamples('INT16')).toEqual(['D100', 'W1A', 'R200', 'ZR1000', 'TN5', 'SD8000']);
  });

  it('bước mặc định: thiết bị bit và bit trong word là 1; word theo kiểu', () => {
    expect(mcDefaultStep('M10', 'BOOL')).toBe(1);
    expect(mcDefaultStep('D100.3', 'BOOL')).toBe(1);
    expect(mcDefaultStep('D100', 'FLOAT32')).toBe(2);
    expect(mcDefaultStep('ZR0', 'FLOAT64')).toBe(4);
    expect(mcDefaultStep('D0', 'STRING', 10)).toBe(5);
    expect(mcDefaultStep('Q1', 'INT16')).toBe(1);
  });

  it('tăng địa chỉ giữ cơ số và độ dài chữ số; bit trong word tới F; ngoài giới hạn thì không có', () => {
    expect(mcStepAddress('D100', 2, 3)).toBe('D106');
    expect(mcStepAddress('d100', 1, 1)).toBe('D101');
    expect(mcStepAddress('X0F', 1, 1)).toBe('X10');
    expect(mcStepAddress('W00FF', 1, 1)).toBe('W0100');
    expect(mcStepAddress('X17', 1, 1, 'octal')).toBe('X20');
    expect(mcStepAddress('X17', 1, 1, 'hex')).toBe('X18');
    expect(mcStepAddress('ZR1000', 4, 2)).toBe('ZR1008');
    expect(mcStepAddress('D100.9', 1, 6)).toBe('D100.F');
    expect(mcStepAddress('D100.F', 1, 1)).toBeUndefined();
    expect(mcStepAddress('D16777215', 1, 1)).toBeUndefined();
    expect(mcStepAddress('HR100', 1, 1)).toBeUndefined();
  });
});

describe('end code (contracts/mc-protocol.md §4)', () => {
  it('nhóm lý do theo bảng của driver', () => {
    for (const c of [0xc051, 0xc054, 0xc056, 0x4030, 0x4031])
      expect(mcEndReason(c)).toBe('MC_END_RANGE');
    for (const c of [0xc05b, 0xc05c, 0xc060]) expect(mcEndReason(c)).toBe('MC_END_DEVICE');
    for (const c of [0xc050, 0xc058, 0xc059, 0xc05f, 0xc061, 0xc06f])
      expect(mcEndReason(c)).toBe('MC_END_COMMAND');
    expect(mcEndReason(0xc0ff)).toBe('MC_END_OTHER');
  });

  it('khóa thập phân của bộ đếm → hex 4 chữ số; khóa lạ giữ nguyên', () => {
    expect(mcEndCode('C056')).toEqual({ hex: 'C056', reason: 'MC_END_RANGE' });
    expect(mcEndCode('C05C')).toEqual({ hex: 'C05C', reason: 'MC_END_DEVICE' });
    expect(mcEndCode('4030')).toEqual({ hex: '4030', reason: 'MC_END_RANGE' });
    expect(mcEndCode('0055')).toEqual({ hex: '0055', reason: 'MC_END_OTHER' });
    expect(mcEndCode('abc')).toEqual({ hex: 'ABC', reason: 'MC_END_OTHER' });
    expect(mcEndCode('99999')).toEqual({ hex: '99999', reason: 'MC_END_OTHER' });
  });

  it('lý do quality của Tag có câu tiếng Việt', () => {
    expect(t('tagReason.MC_END_RANGE')).toBe('PLC báo địa chỉ hoặc số điểm ngoài vùng');
    for (const r of ['MC_END_DEVICE', 'MC_END_COMMAND', 'MC_END_OTHER'] as const)
      expect(t(`tagReason.${r}`)).toMatch(/PLC/);
  });
});
