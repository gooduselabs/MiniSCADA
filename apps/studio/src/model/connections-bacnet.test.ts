// Kênh BACnet/IP trong mô hình Kết nối (feature 020): trường, kênh và thiết bị mới, thân các lần thử, đọc kết quả
// Tìm thiết bị / Duyệt đối tượng, thiết bị và Tag tạo từ kết quả, Bảng Tag nhận địa chỉ BACnet.
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
import {
  bacnetObjectsBody,
  bacnetWhoIsBody,
  deviceFromFound,
  tagFromObject,
} from './connections-bacnet.ts';
import { tagTable } from './tag-table.ts';

const taken = { channels: new Set<string>(), devices: new Set<string>() };
const channel: Channel = {
  id: 'bms',
  name: 'BMS',
  kind: 'bacnet',
  bacnet: { localPort: 47809, broadcast: '192.168.1.255' },
  devices: [
    { id: 'ahu1', name: 'AHU', deviceInstance: 1001, host: '192.168.1.50', network: 5, mac: '07' },
  ],
};

describe('BACnet fields', () => {
  it('channel and device forms have the BACnet fields', () => {
    const ch = channelFields('bacnet').map((f) => f.key);
    expect(ch).toEqual(
      expect.arrayContaining(['bacnetLocalPort', 'bacnetBroadcast', 'bacnetBbmdHost']),
    );
    const dev = deviceFields('bacnet').map((f) => f.key);
    expect(dev).toEqual(
      expect.arrayContaining([
        'bacnetInstance',
        'bacnetHost',
        'bacnetWritePriority',
        'bacnetMaxApdu',
        'bacnetUseRpm',
      ]),
    );
    expect(dev).not.toContain('unitId');
  });
  it('priority 6 is not offered; instance range is checked; defaults are not written', () => {
    const prio = deviceFields('bacnet').find((f) => f.key === 'bacnetWritePriority')!;
    expect(prio.options).not.toContain('6');
    const inst = deviceFields('bacnet').find((f) => f.key === 'bacnetInstance')!;
    expect(setField(channel.devices[0]!, inst, '4194303', taken)).toEqual({
      error: 'cn.err.range',
    });
    const r = setField(channel.devices[0]!, prio, '16', taken);
    expect('value' in r && r.value.writePriority).toBe(undefined);
    const bbmd = channelFields('bacnet').find((f) => f.key === 'bacnetBbmdHost')!;
    const c = setField(channel, bbmd, '10.0.0.1', taken);
    expect('value' in c && c.value.bacnet?.bbmd).toEqual({ host: '10.0.0.1' });
  });
  it('a validator path maps to its field', () => {
    expect(issueField('/channels/0/devices/0/deviceInstance', 'bacnet')).toEqual({
      channel: 0,
      device: 0,
      field: 'bacnetInstance',
    });
    expect(issueField('/channels/0/bacnet/bbmd/host', 'bacnet')?.field).toBe('bacnetBbmdHost');
  });
  it('new channel and device', () => {
    const c = newChannel(['bms1'], 'bacnet', []);
    expect(c).toMatchObject({ id: 'bms2', kind: 'bacnet', devices: [] });
    expect(newDevice(c, [])).toMatchObject({
      id: 'bms2-d1',
      deviceInstance: 1,
      host: '192.168.1.50',
    });
  });
});

describe('BACnet probe bodies', () => {
  it('read, whois and objects', () => {
    expect(probeBody(channel, channel.devices[0]!, { address: 'AI:1', count: 1 })).toEqual({
      channel: { kind: 'bacnet', bacnet: { localPort: 47809, broadcast: '192.168.1.255' } },
      device: { deviceInstance: 1001, host: '192.168.1.50', network: 5, mac: '07' },
      action: 'read',
      read: { address: 'AI:1' },
    });
    expect(probeBody(channel, channel.devices[0]!, null)).not.toHaveProperty('read');
    expect(bacnetWhoIsBody(channel)).toMatchObject({ action: 'whois', whois: { waitMs: 3000 } });
    expect(bacnetObjectsBody(channel, channel.devices[0]!)).toMatchObject({ action: 'objects' });
  });

  it('the probe reads the BACnet answers', async () => {
    const answers: Record<string, unknown> = {
      whois: {
        ok: true,
        code: 'OK',
        action: 'whois',
        devices: [
          {
            instance: 7,
            host: '10.0.0.60',
            port: 47808,
            network: 5,
            mac: '07',
            maxApdu: 480,
            vendorId: 8,
          },
        ],
      },
      objects: {
        ok: true,
        code: 'OK',
        action: 'objects',
        truncated: false,
        objects: [
          { type: 0, instance: 1, address: 'AI:1', name: 'Temp' },
          { type: 200, instance: 3 },
        ],
      },
      read: {
        ok: false,
        code: 'BACNET_ERROR',
        action: 'read',
        error: { class: 1, code: 31, reason: 'BACNET_UNKNOWN_OBJECT' },
      },
    };
    const probe = new ConnectionProbe({
      post: async (_p, body) => ({
        status: 200,
        body: answers[(body as { action: string }).action],
      }),
      gate: () => null,
    });
    await probe.runBody(bacnetWhoIsBody(channel));
    expect(probe.state.result?.devices?.[0]).toMatchObject({ instance: 7, network: 5, mac: '07' });
    await probe.runBody(bacnetObjectsBody(channel, channel.devices[0]!));
    expect(probe.state.result?.objects).toEqual([
      { type: 0, instance: 1, address: 'AI:1', name: 'Temp' },
      { type: 200, instance: 3, address: '', name: '' },
    ]);
    await probe.run(channel, channel.devices[0]!, { address: 'AI:9', count: 1 });
    expect(probe.state.result?.bacnetError).toEqual({
      class: 1,
      code: 31,
      reason: 'BACNET_UNKNOWN_OBJECT',
    });
  });
});

describe('devices and Tags from results', () => {
  it('a found device becomes a device of the channel once', () => {
    const d = deviceFromFound(
      {
        instance: 7,
        host: '10.0.0.60',
        port: 47808,
        network: 5,
        mac: '07',
        maxApdu: 480,
        vendorId: 8,
      },
      channel,
      ['ahu1'],
    );
    expect(d).toEqual({
      id: 'dev7',
      name: 'Device 7',
      deviceInstance: 7,
      host: '10.0.0.60',
      network: 5,
      mac: '07',
      maxApdu: 480,
    });
    expect(
      deviceFromFound(
        { instance: 1001, host: 'x', port: 47808, network: 0, mac: '', maxApdu: 1476, vendorId: 0 },
        channel,
        [],
      ),
    ).toBeNull();
  });
  it('an object becomes a Tag of the right type and access', () => {
    const taken = new Set(['AHU1.AV_5']);
    expect(
      tagFromObject({ type: 2, instance: 5, address: 'AV:5', name: 'Điểm đặt' }, 'ahu1', taken),
    ).toEqual({
      id: 'AHU1.AV_5_2',
      kind: 'external',
      type: 'FLOAT32',
      access: 'RW',
      description: 'Điểm đặt',
      source: { device: 'ahu1', address: 'AV:5' },
    });
    expect(
      tagFromObject({ type: 3, instance: 1, address: 'BI:1', name: '' }, '1-dev', new Set()),
    ).toMatchObject({
      id: 'D1_DEV.BI_1',
      type: 'BOOL',
    });
    expect(
      tagFromObject({ type: 8, instance: 1001, address: 'DEV:1001', name: '' }, 'ahu1', new Set()),
    ).toBeNull();
    expect(
      tagFromObject({ type: 200, instance: 1, address: '', name: '' }, 'ahu1', new Set()),
    ).toBeNull();
  });
});

describe('Tag table with a BACnet device', () => {
  const table = () =>
    tagTable({
      tags: [
        {
          id: 'A',
          kind: 'external',
          type: 'FLOAT32',
          source: { device: 'ahu1', address: 'AV:5@8' },
        },
        {
          id: 'B',
          kind: 'external',
          type: 'FLOAT32',
          source: { device: 'ahu1', address: 'HR100' },
        },
        { id: 'C', kind: 'external', type: 'UINT16', source: { device: 'plc', address: 'HR100' } },
      ] as never,
      devices: [
        { id: 'ahu1', name: 'AHU', bacnet: true },
        { id: 'plc', name: 'PLC' },
      ],
      valueTables: [],
    } as never);
  it('reads BACnet addresses on BACnet rows only', () => {
    const tt = table();
    expect(tt.isBacnetRow(0)).toBe(true);
    expect(tt.isBacnetRow(2)).toBe(false);
    expect(tt.addressInfo(0)).toEqual({
      ok: true,
      normalized: 'AV:5@8',
      bacnet: { object: 'AV:5', property: 'present-value', priority: 8 },
    });
    expect(tt.addressInfo(1)).toEqual({ ok: false, error: 'tt.err.address' });
    expect(tt.addressInfo(2)?.ok).toBe(true);
    expect(tt.text(0, 'fc')).toBe('');
  });
});
