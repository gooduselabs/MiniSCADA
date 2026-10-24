// Form Kết nối của kênh Mitsubishi MC (feature 017, US4, FR-011; plan.md "Hợp đồng định dạng"): trường theo nhóm Kết nối,
// Khung, Định tuyến, Gom yêu cầu, Ghi; mặc định và khoảng của hợp đồng; module I/O viết hex; kênh và thiết bị mới; chữ phụ
// trên cây; lỗi của bộ kiểm tra theo trường; cây và thêm kênh qua tree-ops.
import type { Channel, FieldDevice } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import { t, type MessageKey } from '../i18n/index.ts';
import {
  channelFields,
  channelSub,
  deviceFields,
  deviceSub,
  FIELD_GROUPS,
  fieldDefault,
  fieldText,
  issueField,
  newChannel,
  newDevice,
  setField,
  type FieldSpec,
  type SetResult,
} from './connections.ts';

const MC: Channel = {
  id: 'plc-mc',
  name: 'PLC Mitsubishi',
  kind: 'mc',
  tcp: { host: '192.168.3.39' },
  devices: [{ id: 'fx5u', name: 'FX5U' }],
};
const taken = { channels: new Set(['plc-mc']), devices: new Set(['fx5u']) };
const spec = (list: readonly FieldSpec[], key: string) => list.find((s) => s.key === key)!;
const value = <T>(r: SetResult<T>): T => {
  if ('error' in r) throw new Error(r.error);
  return r.value;
};

describe('trường của form MC', () => {
  it('kênh: Kết nối (máy, cổng 5007), Khung (3E/4E, binary/ascii, tcp/udp), Nâng cao', () => {
    const f = channelFields('mc');
    const by = (g: string) => f.filter((s) => s.group === g).map((s) => s.key);
    expect(by('basic')).toEqual(['id', 'name', 'enabled', 'mcHost', 'mcPort']);
    expect(by('frame')).toEqual(['mcFrame', 'mcCode', 'mcTransport']);
    expect(by('advanced')).toEqual(['connectTimeoutMs', 'reconnectMaxS', 'requestGapMs']);
    expect(spec(f, 'mcPort')).toMatchObject({ path: ['tcp', 'port'], default: 5007 });
    expect(spec(f, 'mcFrame').options).toEqual(['3E', '4E']);
    expect(spec(f, 'mcCode').options).toEqual(['binary', 'ascii']);
    expect(spec(f, 'mcTransport').options).toEqual(['tcp', 'udp']);
  });

  it('thiết bị: Định tuyến, Gom yêu cầu, Ghi theo hợp đồng; mọi trường có nhãn và trợ giúp', () => {
    const f = deviceFields('mc');
    const by = (g: string) => f.filter((s) => s.group === g).map((s) => s.key);
    expect(by('basic')).toEqual(['id', 'name', 'enabled', 'xyNotation', 'timeoutMs', 'retries']);
    expect(by('routing')).toEqual(['network', 'station', 'moduleIo', 'moduleStation']);
    expect(by('batch')).toEqual(['maxBatchWords', 'maxGapWords', 'randomRead', 'maxRandomPoints']);
    expect(by('write')).toEqual(['writeDeadlineMs', 'mcRegisterBit']);
    const range = (k: string) => {
      const s = spec(f, k);
      return [s.min, s.max, s.default];
    };
    expect(range('network')).toEqual([0, 239, 0]);
    expect(range('station')).toEqual([0, 255, 255]);
    expect(range('moduleIo')).toEqual([0, 65535, 1023]);
    expect(range('moduleStation')).toEqual([0, 255, 0]);
    expect(range('maxBatchWords')).toEqual([1, 960, 960]);
    expect(range('maxGapWords')).toEqual([0, 960, 16]);
    expect(range('maxRandomPoints')).toEqual([1, 192, 192]);
    expect(range('retries')).toEqual([0, 5, 0]);
    expect(spec(f, 'randomRead').default).toBe(true);
    expect(spec(f, 'mcRegisterBit')).toMatchObject({
      path: ['write', 'registerBit'],
      options: ['none', 'rmw'],
      default: 'none',
    });
    for (const s of [...f, ...channelFields('mc')]) {
      expect(t(s.label).length).toBeGreaterThan(1);
      expect(t(s.help).length).toBeGreaterThan(5);
    }
    // Mọi nhóm của MC có nhãn và có trong thứ tự của form.
    for (const g of new Set([...f, ...channelFields('mc')].map((s) => s.group))) {
      expect(FIELD_GROUPS).toContain(g);
      expect(t(`cn.group.${g}` as MessageKey).length).toBeGreaterThan(1);
    }
  });

  it('Modbus không đổi: chỉ hai nhóm Kết nối và Nâng cao', () => {
    for (const k of ['modbus-tcp', 'modbus-rtu'] as const)
      expect(new Set([...channelFields(k), ...deviceFields(k)].map((s) => s.group))).toEqual(
        new Set(['basic', 'advanced']),
      );
  });
});

describe('module I/O viết hex', () => {
  const io = spec(deviceFields('mc'), 'moduleIo');
  const dev = MC.devices[0];

  it('mặc định hiện 03FF; giá trị lưu là số, hiện hex 4 chữ số', () => {
    expect(fieldDefault(io)).toBe('03FF');
    expect(fieldText(dev, io)).toBe('');
    expect(fieldText({ ...dev, moduleIo: 0x3e0 }, io)).toBe('03E0');
  });

  it('nhận 3e0, 0x03E1, H3E2, 03E3h; bằng mặc định (03ff) thì bỏ khóa; sai thì lỗi tại ô', () => {
    expect(value(setField(dev, io, '3e0', taken)).moduleIo).toBe(0x3e0);
    expect(value(setField(dev, io, '0x03E1', taken)).moduleIo).toBe(0x3e1);
    expect(value(setField(dev, io, 'H3E2', taken)).moduleIo).toBe(0x3e2);
    expect(value(setField(dev, io, '03E3h', taken)).moduleIo).toBe(0x3e3);
    expect('moduleIo' in value(setField({ ...dev, moduleIo: 1 }, io, '03ff', taken))).toBe(false);
    expect(setField(dev, io, '1023x', taken)).toEqual({ error: 'cn.err.hex' });
    expect(setField(dev, io, '10000', taken)).toEqual({ error: 'cn.err.hex' });
    expect(t('cn.err.hex')).toMatch(/03FF/);
  });

  it('số thập phân thường: trạm 0–255, mạng 0–239; khung lồng `mc.frame` giữ khóa anh em', () => {
    const f = deviceFields('mc');
    expect(value(setField(dev, spec(f, 'station'), '3', taken)).station).toBe(3);
    expect(setField(dev, spec(f, 'network'), '240', taken)).toEqual({ error: 'cn.err.range' });
    const c = value(setField(MC, spec(channelFields('mc'), 'mcFrame'), '4E', taken));
    expect(c.mc).toEqual({ frame: '4E' });
    const c2 = value(setField(c, spec(channelFields('mc'), 'mcTransport'), 'udp', taken));
    expect(c2.mc).toEqual({ frame: '4E', transport: 'udp' });
    const c3 = value(setField(c2, spec(channelFields('mc'), 'mcFrame'), '3E', taken));
    expect(c3.mc).toEqual({ transport: 'udp' });
    expect(setField(MC, spec(channelFields('mc'), 'mcFrame'), '1E', taken)).toEqual({
      error: 'cn.err.option',
    });
  });
});

describe('kênh và thiết bị MC mới; chữ phụ', () => {
  it('kênh mc1 (không trùng id thiết bị), chỉ có máy; mặc định không ghi khóa', () => {
    const c = newChannel(['plc1'], 'mc', ['mc1']);
    expect(c).toEqual({
      id: 'mc2',
      name: t('cn.newChannel', { n: 2 }),
      kind: 'mc',
      tcp: { host: '192.168.3.39' },
      devices: [],
    });
  });

  it('thiết bị mới chỉ có id và tên (mạng 0, trạm FF, module 03FF là mặc định)', () => {
    const d: FieldDevice = newDevice(MC, ['fx5u']);
    expect(d).toEqual({ id: 'plc-mc-d1', name: t('cn.newDevice', { n: 1 }) });
  });

  it('chữ phụ: MC 3E, MC 4E UDP, MC 3E ASCII; thiết bị "mạng 0 · trạm FF"', () => {
    expect(channelSub(MC)).toBe('MC 3E');
    expect(channelSub({ kind: 'mc', mc: { frame: '4E', transport: 'udp' } })).toBe('MC 4E UDP');
    expect(channelSub({ kind: 'mc', mc: { code: 'ascii' } })).toBe('MC 3E ASCII');
    expect(channelSub({ kind: 'modbus-tcp' })).toBe('TCP');
    expect(channelSub({ kind: 'modbus-rtu' })).toBe('RTU');
    expect(deviceSub({ kind: 'mc' }, { id: 'a', name: 'a' })).toBe('mạng 0 · trạm FF');
    expect(deviceSub({ kind: 'mc' }, { id: 'a', name: 'a', network: 2, station: 3 })).toBe(
      'mạng 2 · trạm 03',
    );
    expect(deviceSub({ kind: 'modbus-tcp' }, { id: 'a', name: 'a', unitId: 4 })).toBe('unit 4');
    expect(deviceSub({ kind: 'modbus-rtu' }, { id: 'a', name: 'a' })).toBe('slave 1');
  });
});

describe('lỗi của bộ kiểm tra theo trường (kênh MC)', () => {
  it('đường dẫn → khóa trường MC', () => {
    expect(issueField('/channels/2/tcp/port', 'mc')).toEqual({
      channel: 2,
      device: null,
      field: 'mcPort',
    });
    expect(issueField('/channels/2/mc/frame', 'mc')?.field).toBe('mcFrame');
    expect(issueField('/channels/2/devices/0/moduleIo', 'mc')).toEqual({
      channel: 2,
      device: 0,
      field: 'moduleIo',
    });
    expect(issueField('/channels/2/devices/0/write/registerBit', 'mc')?.field).toBe(
      'mcRegisterBit',
    );
    expect(issueField('/channels/2/kind', 'mc')?.field).toBeNull();
  });
});
