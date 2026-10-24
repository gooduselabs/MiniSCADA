// Kênh Siemens S7 trong mô hình form Kết nối (feature 016, US4, contracts/s7-driver.md §1): trường của kênh và CPU, mặc định,
// khoảng, TSAP 4 chữ số hex, xung đột rack/slot với remoteTsap, kênh mới có sẵn một CPU, không thêm CPU thứ hai, Thử kết nối
// chưa hỗ trợ, nhãn trên cây.
import type { Channel } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  canAddDevice,
  channelFields,
  channelSub,
  deviceFields,
  deviceSub,
  fieldDefault,
  issueField,
  newChannel,
  newDevice,
  probeSupported,
  s7TsapConflict,
  setField,
  type FieldSpec,
  type SetResult,
} from './connections.ts';

const S7: Channel = {
  id: 's7-1',
  name: 'PLC S7-1200',
  kind: 's7',
  tcp: { host: '192.168.0.10' },
  devices: [{ id: 'cpu1', name: 'CPU 1214C' }],
};

const spec = (list: readonly FieldSpec[], key: string): FieldSpec => {
  const s = list.find((x) => x.key === key);
  if (!s) throw new Error(key);
  return s;
};
const val = <T>(r: SetResult<T>): T => {
  if (!('value' in r)) throw new Error(String(r.error));
  return r.value;
};
const taken = { channels: new Set(['s7-1']), devices: new Set(['cpu1']) };

describe('trường của kênh S7', () => {
  it('kênh: máy, cổng 102, rack, slot, TSAP, PDU, chờ kết nối; không có trường Modbus', () => {
    const keys = channelFields('s7').map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'enabled',
        'host',
        'port',
        'rack',
        'slot',
        'localTsap',
        'remoteTsap',
        'pduSize',
        'connectTimeoutMs',
        'reconnectMaxS',
        'requestGapMs',
      ]),
    );
    expect(keys).not.toContain('serialPort');
    const f = channelFields('s7');
    expect(fieldDefault(spec(f, 'port'))).toBe('102');
    expect(fieldDefault(spec(f, 'rack'))).toBe('0');
    expect(fieldDefault(spec(f, 'slot'))).toBe('1');
    expect(fieldDefault(spec(f, 'pduSize'))).toBe('480');
    expect(spec(f, 'rack').path).toEqual(['s7', 'rack']);
    expect(spec(f, 'remoteTsap').mono).toBe(true);
    expect(spec(f, 'rack').group).toBe('basic');
    expect(spec(f, 'remoteTsap').group).toBe('advanced');
    // Trợ giúp riêng cho S7 (không nói Modbus, không nói cổng 502).
    expect(spec(f, 'host').help).toBe('cn.h.s7Host');
    expect(spec(f, 'port').help).toBe('cn.h.s7Port');
  });

  it('CPU: thời gian chờ, thử lại mặc định 0, thời hạn ghi, khe gộp byte; không có unitId, addressBase, byteOrder, write', () => {
    const d = deviceFields('s7');
    const keys = d.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'enabled',
        'timeoutMs',
        'retries',
        'writeDeadlineMs',
        'maxGapBytes',
      ]),
    );
    for (const k of [
      'unitId',
      'slave',
      'addressBase',
      'byteOrder',
      'maxReadRegisters',
      'writeSingleRegister',
    ])
      expect(keys).not.toContain(k);
    expect(fieldDefault(spec(d, 'retries'))).toBe('0');
    expect(fieldDefault(spec(d, 'maxGapBytes'))).toBe('16');
    expect(spec(d, 'maxGapBytes').max).toBe(256);
    expect(new Set(d.map((f) => f.group))).toEqual(new Set(['basic', 'advanced']));
  });
});

describe('sửa kênh S7', () => {
  const f = channelFields('s7');

  it('rack 0–7, slot 0–31, PDU 240–960; bằng mặc định thì bỏ khóa và bỏ cả khối s7 rỗng', () => {
    const a = val(setField(S7, spec(f, 'rack'), '2', taken));
    expect(a.s7).toEqual({ rack: 2 });
    expect(setField(S7, spec(f, 'rack'), '8', taken)).toEqual({ error: 'cn.err.range' });
    expect(setField(S7, spec(f, 'slot'), '32', taken)).toEqual({ error: 'cn.err.range' });
    expect(setField(S7, spec(f, 'pduSize'), '200', taken)).toEqual({ error: 'cn.err.range' });
    expect(val(setField(S7, spec(f, 'pduSize'), '960', taken)).s7).toEqual({ pduSize: 960 });
    const back = val(setField(a, spec(f, 'rack'), '0', taken));
    expect(back.s7).toBeUndefined();
  });

  it('TSAP: đúng 4 chữ số hex, ghi chữ hoa', () => {
    expect(val(setField(S7, spec(f, 'remoteTsap'), '03c1', taken)).s7).toEqual({
      remoteTsap: '03C1',
    });
    expect(setField(S7, spec(f, 'remoteTsap'), '3C1', taken)).toEqual({ error: 'cn.err.tsap' });
    expect(setField(S7, spec(f, 'localTsap'), '01G0', taken)).toEqual({ error: 'cn.err.tsap' });
    expect(setField(S7, spec(f, 'localTsap'), '01000', taken)).toEqual({ error: 'cn.err.tsap' });
    expect(val(setField(S7, spec(f, 'localTsap'), '', taken)).s7).toBeUndefined();
  });

  it('xung đột: remoteTsap cùng rack hay slot đã đặt (khác mặc định)', () => {
    expect(s7TsapConflict(S7)).toBe(false);
    expect(s7TsapConflict({ ...S7, s7: { remoteTsap: '0301' } })).toBe(false);
    expect(s7TsapConflict({ ...S7, s7: { remoteTsap: '0301', slot: 2 } })).toBe(true);
    expect(s7TsapConflict({ ...S7, s7: { remoteTsap: '0301', rack: 0 } })).toBe(true);
    expect(s7TsapConflict({ ...S7, s7: { rack: 0, slot: 1 } })).toBe(false);
  });

  it('lỗi của bộ kiểm tra theo trường: /channels/2/s7/remoteTsap → remoteTsap; /kind → cả kênh', () => {
    expect(issueField('/channels/2/s7/remoteTsap', 's7')).toEqual({
      channel: 2,
      device: null,
      field: 'remoteTsap',
    });
    expect(issueField('/channels/2/kind', 's7')).toEqual({ channel: 2, device: null, field: null });
    expect(issueField('/channels/2/devices/0/maxGapBytes', 's7')).toEqual({
      channel: 2,
      device: 0,
      field: 'maxGapBytes',
    });
  });
});

describe('kênh S7 mới', () => {
  it('id s7-1, s7-2…; có sẵn một CPU với id duy nhất; cổng mặc định không ghi', () => {
    const c = newChannel(['plc1', 's7-1'], 's7', ['cpu1', 'plc1-main']);
    expect(c.id).toBe('s7-2');
    expect(c.kind).toBe('s7');
    expect(c.tcp?.host).toBe('192.168.0.1');
    expect(c.tcp?.port).toBeUndefined();
    expect(c.serial).toBeUndefined();
    expect(c.devices).toHaveLength(1);
    expect(c.devices[0]!.id).toBe('cpu2');
    expect(c.devices[0]!.name).toBe('CPU 2');
    expect(c.devices[0]!.unitId).toBeUndefined();
  });

  it('mỗi kênh S7 một CPU: không thêm CPU thứ hai; kênh S7 trống thì thêm được', () => {
    expect(canAddDevice(S7)).toBe(false);
    expect(canAddDevice({ ...S7, devices: [] })).toBe(true);
    expect(canAddDevice({ ...S7, kind: 'modbus-tcp' })).toBe(true);
    const d = newDevice({ ...S7, devices: [] }, ['cpu1']);
    expect(d.id).toBe('cpu2');
    expect(d.unitId).toBeUndefined();
    expect(d.slave).toBeUndefined();
  });

  it('Thử kết nối chưa hỗ trợ kênh S7', () => {
    expect(probeSupported('s7')).toBe(false);
    expect(probeSupported('modbus-tcp')).toBe(true);
    expect(probeSupported('modbus-rtu')).toBe(true);
  });

  it('chữ phụ trên cây: S7; CPU theo rack/slot hoặc TSAP', () => {
    expect(channelSub(S7)).toBe('S7');
    expect(channelSub({ ...S7, kind: 'modbus-rtu' })).toBe('RTU');
    expect(channelSub({ ...S7, kind: 'modbus-tcp' })).toBe('TCP');
    expect(deviceSub(S7, S7.devices[0]!)).toBe('rack 0 · slot 1');
    expect(deviceSub({ ...S7, s7: { remoteTsap: '0301' } }, S7.devices[0]!)).toBe('TSAP 0301');
    expect(deviceSub({ ...S7, kind: 'modbus-tcp' }, { id: 'a', name: 'a', unitId: 3 })).toBe(
      'unit 3',
    );
    expect(deviceSub({ ...S7, kind: 'modbus-rtu' }, { id: 'a', name: 'a', slave: 4 })).toBe(
      'slave 4',
    );
  });
});
