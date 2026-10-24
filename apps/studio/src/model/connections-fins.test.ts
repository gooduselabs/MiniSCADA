// Kênh Omron FINS trong mô hình form Kết nối (feature 018): trường theo loại kênh, kênh và thiết bị mới, thân của Thử
// kết nối, đọc kết quả có mã kết thúc và model CPU, lỗi bộ kiểm tra gắn đúng trường.
import type { Channel } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import {
  ConnectionProbe,
  channelFields,
  deviceFields,
  issueField,
  newChannel,
  newDevice,
  probeBody,
  setField,
} from './connections.ts';

const taken = { channels: new Set<string>(), devices: new Set<string>() };

describe('kênh Omron FINS', () => {
  it('form kênh: địa chỉ PLC, giao thức udp/tcp, cổng 9600, nút nguồn ở Nâng cao', () => {
    const f = channelFields('fins');
    const by = (k: string) => f.find((s) => s.key === k)!;
    expect(by('finsHost').path).toEqual(['fins', 'host']);
    expect(by('transport').options).toEqual(['udp', 'tcp']);
    expect(by('finsPort').default).toBe(9600);
    expect(by('sourceNode').group).toBe('advanced');
    expect(f.some((s) => s.path[0] === 'tcp' || s.path[0] === 'serial')).toBe(false);
  });

  it('form thiết bị: nút, mạng, unit, thứ tự word CDAB, chờ 500 ms, gom 0104', () => {
    const f = deviceFields('fins');
    const keys = f.map((s) => s.key);
    for (const k of ['node', 'network', 'unit', 'maxReadWords', 'multiRead', 'maxMultiItems'])
      expect(keys).toContain(k);
    expect(keys).not.toContain('unitId');
    expect(keys).not.toContain('addressBase');
    expect(f.find((s) => s.key === 'finsByteOrder')!.default).toBe('CDAB');
    expect(f.find((s) => s.key === 'finsTimeoutMs')!.default).toBe(500);
  });

  it('kênh mới omron1 với địa chỉ PLC mặc định; thiết bị mới không đặt nút (tự động)', () => {
    const c = newChannel(['omron1'], 'fins', []);
    expect(c.id).toBe('omron2');
    expect(c.kind).toBe('fins');
    expect(c.fins).toEqual({ host: '192.168.250.1' });
    const d = newDevice(c, []);
    expect(d).toEqual({ id: 'omron2-d1', name: expect.any(String) });
  });

  it('sửa trường: giao thức tcp ghi khóa, udp (mặc định) bỏ khóa; nút ngoài 0–254 là lỗi', () => {
    const c = newChannel([], 'fins', []);
    const spec = channelFields('fins').find((s) => s.key === 'transport')!;
    const tcp = setField(c, spec, 'tcp', taken);
    expect('value' in tcp && tcp.value.fins).toEqual({ host: '192.168.250.1', transport: 'tcp' });
    const udp = setField((tcp as { value: Channel }).value, spec, 'udp', taken);
    expect('value' in udp && udp.value.fins).toEqual({ host: '192.168.250.1' });
    const node = deviceFields('fins').find((s) => s.key === 'node')!;
    expect(setField({ id: 'd', name: 'D' }, node, '255', taken)).toEqual({ error: 'cn.err.range' });
    expect(setField({ id: 'd', name: 'D' }, node, '20', taken)).toEqual({
      value: { id: 'd', name: 'D', node: 20 },
    });
  });

  it('thân của Thử kết nối kind fins: chỉ trường của FINS', () => {
    const ch: Channel = {
      id: 'omron1',
      name: 'O',
      kind: 'fins',
      requestGapMs: 5,
      fins: { host: '10.0.0.9', transport: 'tcp', sourceNode: 3 },
      devices: [],
    };
    expect(probeBody(ch, { id: 'd', name: 'D', node: 9, timeoutMs: 300 }, null)).toEqual({
      channel: { kind: 'fins', fins: { host: '10.0.0.9', transport: 'tcp', sourceNode: 3 } },
      device: { node: 9, timeoutMs: 300 },
    });
    expect(probeBody(ch, { id: 'd', name: 'D' }, { address: 'D100', count: 2 })).toMatchObject({
      read: { address: 'D100', count: 2 },
    });
  });

  it('kết quả Thử kết nối: model, nút TCP, mã kết thúc, word đã đọc và bảng cách hiểu', async () => {
    const run = async (body: object) => {
      const p = new ConnectionProbe({
        post: async () => ({ status: 200, body }),
        gate: () => null,
      });
      await p.run(newChannel([], 'fins', []), { id: 'd', name: 'D' }, null);
      return p.state.result!;
    };
    const model = await run({
      ok: true,
      code: 'OK',
      connectMs: 2,
      model: 'CJ2M-CPU31',
      nodes: { client: 33, server: 10 },
    });
    expect(model).toMatchObject({
      ok: true,
      model: 'CJ2M-CPU31',
      nodes: { client: 33, server: 10 },
    });
    const words = await run({
      ok: true,
      code: 'OK',
      read: { address: 'D100', count: 2, words: ['e979', '42f6'] },
    });
    expect(words.address).toBe('D100');
    expect(words.hex).toEqual(['E979', '42F6']);
    expect(words.interpret.some((r) => r.type === 'FLOAT32' && r.byteOrder === 'CDAB')).toBe(true);
    const bits = await run({
      ok: true,
      code: 'OK',
      read: { address: 'T5', count: 1, bits: [true] },
    });
    expect(bits.bits).toEqual([true]);
    const end = await run({
      ok: false,
      code: 'END_CODE',
      endCode: { code: '1103', reason: 'FINS_ADDRESS', meaning: 'Địa chỉ ngoài vùng nhớ của PLC' },
    });
    expect(end.endCode).toEqual({
      code: '1103',
      reason: 'FINS_ADDRESS',
      meaning: 'Địa chỉ ngoài vùng nhớ của PLC',
    });
  });

  it('lỗi bộ kiểm tra theo đường dẫn: /channels/2/fins/host và /channels/2/devices/0/node', () => {
    expect(issueField('/channels/2/fins/host', 'fins')).toEqual({
      channel: 2,
      device: null,
      field: 'finsHost',
    });
    expect(issueField('/channels/2/devices/0/node', 'fins')).toEqual({
      channel: 2,
      device: 0,
      field: 'node',
    });
  });
});
