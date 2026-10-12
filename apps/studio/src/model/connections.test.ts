// Mô hình form Kết nối và Thử kết nối (feature 006, T127, FR-030, FR-044, data-model §2): nhóm theo loại kênh và thiết bị
// trường, mặc định, kiểm tại ô, id duy nhất; Thử kết nối khóa kèm lý do, mỗi lúc một lần, bảng cách hiểu, TEST_BUSY,
// TEST_RATE_LIMITED; Studio không có đường mạng nào ngoài DeviceLink.
import type { Channel, FieldDevice } from '@mat/project-schema';
import { describe, expect, it } from 'vitest';
import type { ApiResult, DeviceError } from '../platform/device-types.ts';
import {
  ConnectionProbe,
  channelFields,
  deviceFields,
  fieldDefault,
  fieldText,
  newChannel,
  newDevice,
  probeBody,
  SerialPortsLoader,
  parseSerialPorts,
  portChoices,
  portProblem,
  portStatus,
  portsGate,
  probeGate,
  rs485Hint,
  setField,
  tagsPerDevice,
  type FieldSpec,
  type SetResult,
} from './connections.ts';

const TCP: Channel = {
  id: 'plc1',
  name: 'PLC trạm bơm',
  kind: 'modbus-tcp',
  tcp: { host: '192.168.10.5' },
  devices: [{ id: 'plc1-main', name: 'PLC chính', unitId: 1 }],
};
const RTU: Channel = {
  id: 'rs485-1',
  name: 'RS485',
  kind: 'modbus-rtu',
  serial: { port: 'ttyAS2', baud: 19200 },
  devices: [{ id: 'meter3', name: 'Đồng hồ 3', slave: 3 }],
};

const spec = (list: readonly FieldSpec[], key: string): FieldSpec => {
  const s = list.find((x) => x.key === key);
  if (!s) throw new Error(key);
  return s;
};

describe('trường của form', () => {
  it('kênh TCP: nhóm Kết nối và Nâng cao; kênh RTU có cổng serial', () => {
    const tcp = channelFields('modbus-tcp');
    expect(tcp.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'enabled',
        'host',
        'port',
        'connectTimeoutMs',
        'reconnectMaxS',
        'requestGapMs',
      ]),
    );
    expect(tcp.map((f) => f.key)).not.toContain('serialPort');
    const rtu = channelFields('modbus-rtu');
    expect(rtu.map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'serialPort',
        'baud',
        'dataBits',
        'parity',
        'stopBits',
        'rs485',
        'dropEcho',
        'silenceMs',
      ]),
    );
    expect(new Set(tcp.map((f) => f.group))).toEqual(new Set(['basic', 'advanced']));
  });

  it('thiết bị trường: TCP dùng unitId, RTU dùng slave; mỗi trường có trợ giúp', () => {
    expect(deviceFields('modbus-tcp').map((f) => f.key)).toContain('unitId');
    expect(deviceFields('modbus-tcp').map((f) => f.key)).not.toContain('slave');
    expect(deviceFields('modbus-rtu').map((f) => f.key)).toContain('slave');
    for (const f of [...channelFields('modbus-tcp'), ...deviceFields('modbus-rtu')])
      expect(f.help.length).toBeGreaterThan(0);
  });

  it('mặc định theo data-model §2', () => {
    const tcp = channelFields('modbus-tcp');
    expect(fieldDefault(spec(tcp, 'port'))).toBe('502');
    expect(fieldDefault(spec(tcp, 'connectTimeoutMs'))).toBe('3000');
    expect(fieldDefault(spec(tcp, 'reconnectMaxS'))).toBe('10');
    const dev = deviceFields('modbus-tcp');
    expect(fieldDefault(spec(dev, 'timeoutMs'))).toBe('1000');
    expect(fieldDefault(spec(dev, 'retries'))).toBe('0');
    expect(fieldDefault(spec(deviceFields('modbus-rtu'), 'retries'))).toBe('1');
    expect(fieldDefault(spec(dev, 'byteOrder'))).toBe('ABCD');
    expect(fieldDefault(spec(dev, 'maxGapRegisters'))).toBe('10');
    expect(fieldDefault(spec(channelFields('modbus-rtu'), 'parity'))).toBe('even');
  });

  it('chữ của trường lấy từ đối tượng; vắng thì rỗng', () => {
    const tcp = channelFields('modbus-tcp');
    expect(fieldText(TCP, spec(tcp, 'host'))).toBe('192.168.10.5');
    expect(fieldText(TCP, spec(tcp, 'port'))).toBe('');
    expect(fieldText(RTU, spec(channelFields('modbus-rtu'), 'baud'))).toBe('19200');
  });
});

const val = <T>(r: SetResult<T>): T => {
  if (!('value' in r)) throw new Error(String(r.error));
  return r.value;
};

describe('sửa trường', () => {
  const tcp = channelFields('modbus-tcp');
  const taken = {
    channels: new Set(['plc1', 'rs485-1']),
    devices: new Set(['plc1-main', 'meter3']),
  };

  it('số trong khoảng; bằng mặc định hoặc rỗng thì bỏ khóa', () => {
    const a = setField(TCP, spec(tcp, 'port'), '1502', taken);
    expect('value' in a && (a.value as Channel).tcp?.port).toBe(1502);
    const b = setField(val(a), spec(tcp, 'port'), '502', taken);
    expect('value' in b && (b.value as Channel).tcp).toEqual({ host: '192.168.10.5' });
    const c = setField(val(a), spec(tcp, 'port'), '', taken);
    expect('value' in c && (c.value as Channel).tcp).toEqual({ host: '192.168.10.5' });
  });

  it('lỗi tại ô: ngoài khoảng, không phải số nguyên, rỗng với trường bắt buộc', () => {
    expect(setField(TCP, spec(tcp, 'port'), '70000', taken)).toMatchObject({
      error: 'cn.err.range',
    });
    expect(setField(TCP, spec(tcp, 'port'), '12.5', taken)).toMatchObject({
      error: 'cn.err.integer',
    });
    expect(setField(TCP, spec(tcp, 'port'), 'abc', taken)).toMatchObject({
      error: 'cn.err.integer',
    });
    expect(setField(TCP, spec(tcp, 'host'), '  ', taken)).toMatchObject({
      error: 'cn.err.required',
    });
    expect(setField(TCP, spec(tcp, 'name'), 'x'.repeat(65), taken)).toMatchObject({
      error: 'cn.err.maxLen',
    });
  });

  it('id: đúng luật và duy nhất', () => {
    expect(setField(TCP, spec(tcp, 'id'), 'PLC 2', taken)).toMatchObject({
      error: 'cn.err.idSyntax',
    });
    expect(setField(TCP, spec(tcp, 'id'), 'rs485-1', taken)).toMatchObject({
      error: 'cn.err.idDup',
    });
    expect(setField(TCP, spec(tcp, 'id'), 'plc1', taken)).toHaveProperty('value');
    const ok = setField(TCP, spec(tcp, 'id'), 'plc2', taken);
    expect('value' in ok && (ok.value as Channel).id).toBe('plc2');
  });

  it('id thiết bị trường duy nhất trong cả project', () => {
    const dev = deviceFields('modbus-tcp');
    const d = TCP.devices[0];
    expect(setField(d, spec(dev, 'id'), 'meter3', taken)).toMatchObject({ error: 'cn.err.idDup' });
    expect(setField(d, spec(dev, 'id'), 'plc1-main', taken)).toHaveProperty('value');
  });

  it('chọn từ danh sách: số lưu thành số, chữ lưu thành chữ; lựa chọn lạ bị từ chối', () => {
    const rtu = channelFields('modbus-rtu');
    const a = setField(RTU, spec(rtu, 'baud'), '38400', taken);
    expect('value' in a && (a.value as Channel).serial?.baud).toBe(38400);
    expect(setField(RTU, spec(rtu, 'baud'), '12345', taken)).toMatchObject({
      error: 'cn.err.option',
    });
    const p = setField(RTU, spec(rtu, 'parity'), 'odd', taken);
    expect('value' in p && (p.value as Channel).serial?.parity).toBe('odd');
  });

  it('bật/tắt: true là mặc định của enabled nên bỏ khóa; false ghi khóa', () => {
    const f = spec(tcp, 'enabled');
    const off = setField(TCP, f, 'false', taken);
    expect('value' in off && (off.value as Channel).enabled).toBe(false);
    const on = setField(val(off), f, 'true', taken);
    expect('value' in on && 'enabled' in (on.value as Channel)).toBe(false);
  });

  it('trường lồng (write.registerBit) giữ các khóa anh em', () => {
    const dev = deviceFields('modbus-tcp');
    const a = setField(
      { id: 'd', name: 'D' } as FieldDevice,
      spec(dev, 'writeRegisterBit'),
      'mask',
      taken,
    );
    const b = setField(
      'value' in a ? (a.value as FieldDevice) : ({} as FieldDevice),
      spec(dev, 'writeSingleRegister'),
      'fc16',
      taken,
    );
    expect('value' in b && (b.value as FieldDevice).write).toEqual({
      registerBit: 'mask',
      singleRegister: 'fc16',
    });
  });
});

describe('thêm kênh và thiết bị trường', () => {
  it('id kênh kế tiếp không trùng; kênh mới có sẵn một kiểu và tên tiếng Việt', () => {
    const c = newChannel(['plc1', 'plc2'], 'modbus-tcp', ['x']);
    expect(c.id).toBe('plc3');
    expect(c.kind).toBe('modbus-tcp');
    expect(c.tcp?.host).toBe('192.168.1.10');
    expect(c.devices).toEqual([]);
    const r = newChannel([], 'modbus-rtu', []);
    expect(r.serial?.port).toBe('');
    expect(r.id).toBe('rtu1');
  });

  it('thiết bị trường: id duy nhất toàn project; TCP unitId 1, RTU slave 1', () => {
    const d = newDevice(TCP, ['plc1-d1', 'plc1-main']);
    expect(d.id).toBe('plc1-d2');
    expect(d.unitId).toBe(1);
    const r = newDevice(RTU, []);
    expect(r.slave).toBe(1);
    expect(r.unitId).toBeUndefined();
    expect(r.id.length).toBeLessThanOrEqual(32);
  });

  it('số Tag theo thiết bị trường', () => {
    const m = tagsPerDevice([
      { id: 'A', kind: 'external', type: 'INT16', source: { device: 'plc1-main', address: 'HR1' } },
      { id: 'B', kind: 'external', type: 'INT16', source: { device: 'plc1-main', address: 'HR2' } },
      { id: 'C', kind: 'internal', type: 'INT16' },
    ] as never);
    expect(m.get('plc1-main')).toBe(2);
    expect(m.get('meter3')).toBeUndefined();
  });
});

describe('Thử kết nối', () => {
  it('thân yêu cầu theo schema connections.json: chỉ trường đã đặt', () => {
    expect(probeBody(TCP, TCP.devices[0], { address: 'HR100', count: 2 })).toEqual({
      channel: { kind: 'modbus-tcp', tcp: { host: '192.168.10.5' } },
      device: { unitId: 1 },
      read: { address: 'HR100', count: 2 },
    });
    expect(probeBody(RTU, RTU.devices[0], null)).toEqual({
      channel: { kind: 'modbus-rtu', serial: { port: 'ttyAS2', baud: 19200 } },
      device: { slave: 3 },
    });
  });

  it('khóa kèm lý do khi Offline hoặc role dưới engineer', () => {
    expect(probeGate({ online: false, role: null })).toBe('cn.probe.offline');
    expect(probeGate({ online: true, role: 'viewer' })).toBe('cn.probe.role');
    expect(probeGate({ online: true, role: 'operator' })).toBe('cn.probe.role');
    expect(probeGate({ online: true, role: 'engineer' })).toBeNull();
    expect(probeGate({ online: true, role: 'administrator' })).toBeNull();
  });

  function runner(reply: ApiResult | DeviceError | (() => Promise<ApiResult | DeviceError>)) {
    const calls: Array<{ path: string; body: object }> = [];
    const probe = new ConnectionProbe({
      post: async (path, body) => {
        calls.push({ path, body });
        return typeof reply === 'function' ? reply() : reply;
      },
      gate: () => null,
    });
    return { probe, calls };
  }

  it('gửi cấu hình đang sửa qua DeviceLink.post tới drivers/test, không đường nào khác', async () => {
    const { probe, calls } = runner({
      status: 200,
      body: {
        ok: true,
        code: 'OK',
        connectMs: 4,
        responseMs: 12,
        read: { fc: 3, offset: 100, count: 2, registers: ['42F6', 'E979'] },
      },
    });
    await probe.run(TCP, TCP.devices[0], { address: 'HR100', count: 2 });
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/v1/drivers/test');
    expect(probe.state.result).toMatchObject({
      ok: true,
      code: 'OK',
      connectMs: 4,
      responseMs: 12,
    });
  });

  it('thanh ghi hex và bảng cách hiểu: 2 thanh ghi → 4 thứ tự byte cho 32 bit', async () => {
    const { probe } = runner({
      status: 200,
      body: {
        ok: true,
        code: 'OK',
        connectMs: 1,
        responseMs: 2,
        read: { fc: 3, offset: 100, count: 2, registers: ['42F6', 'E979'] },
      },
    });
    await probe.run(TCP, TCP.devices[0], { address: 'HR100', count: 2 });
    const r = probe.state.result!;
    expect(r.hex).toEqual(['42F6', 'E979']);
    const f32 = r.interpret.filter((x) => x.type === 'FLOAT32');
    expect(f32.map((x) => x.byteOrder)).toEqual(['ABCD', 'CDAB', 'BADC', 'DCBA']);
    expect(f32[0].text).toBe(String(f32[0].value));
    expect(Number(f32[0].value)).toBeCloseTo(123.456, 2);
    expect(r.interpret.some((x) => x.type === 'INT16')).toBe(true);
  });

  it('bit: danh sách giá trị; không có bảng cách hiểu số', async () => {
    const { probe } = runner({
      status: 200,
      body: {
        ok: true,
        code: 'OK',
        read: { fc: 1, offset: 5, count: 3, bits: [true, false, true] },
      },
    });
    await probe.run(TCP, TCP.devices[0], { address: 'C5', count: 3 });
    expect(probe.state.result?.bits).toEqual([true, false, true]);
    expect(probe.state.result?.interpret).toEqual([]);
  });

  it('exception: mã và nghĩa; mã lỗi kết nối kèm thông điệp', async () => {
    const a = runner({
      status: 200,
      body: {
        ok: false,
        code: 'EXCEPTION',
        connectMs: 3,
        responseMs: 9,
        exception: { code: '02', meaning: 'địa chỉ không hợp lệ' },
      },
    });
    await a.probe.run(TCP, TCP.devices[0], { address: 'HR9000', count: 1 });
    expect(a.probe.state.result).toMatchObject({
      ok: false,
      code: 'EXCEPTION',
      exception: { code: '02' },
    });
    const b = runner({
      status: 200,
      body: { ok: false, code: 'REFUSED', message: 'PLC từ chối kết nối' },
    });
    await b.probe.run(TCP, TCP.devices[0], null);
    expect(b.probe.state.result).toMatchObject({
      ok: false,
      code: 'REFUSED',
      message: 'PLC từ chối kết nối',
    });
  });

  it('TEST_BUSY, TEST_RATE_LIMITED, BAD_REQUEST kèm issues, AUDIT_UNAVAILABLE', async () => {
    const busy = runner({ status: 409, body: { error: 'TEST_BUSY' } });
    await busy.probe.run(TCP, TCP.devices[0], null);
    expect(busy.probe.state.result).toMatchObject({ ok: false, failure: 'busy' });
    const rate = runner({ status: 429, body: { error: 'TEST_RATE_LIMITED', retryAfterS: 20 } });
    await rate.probe.run(TCP, TCP.devices[0], null);
    expect(rate.probe.state.result).toMatchObject({ failure: 'rate', retryAfterS: 20 });
    const bad = runner({
      status: 400,
      body: { error: 'BAD_REQUEST', issues: [{ code: 'E_ADDR_SYNTAX', path: '/read/address' }] },
    });
    await bad.probe.run(TCP, TCP.devices[0], { address: 'x', count: 1 });
    expect(bad.probe.state.result).toMatchObject({
      failure: 'badRequest',
      issues: ['E_ADDR_SYNTAX'],
    });
    const audit = runner({ status: 503, body: { error: 'AUDIT_UNAVAILABLE' } });
    await audit.probe.run(TCP, TCP.devices[0], null);
    expect(audit.probe.state.result?.failure).toBe('audit');
  });

  it('lỗi mạng hoặc phiên: ghi nhận lỗi thiết bị', async () => {
    const { probe } = runner({ error: 'timeout' });
    await probe.run(TCP, TCP.devices[0], null);
    expect(probe.state.result).toMatchObject({
      ok: false,
      failure: 'device',
      deviceError: { error: 'timeout' },
    });
  });

  it('mỗi lúc một lần: lần chạy thứ hai khi đang chạy bị bỏ qua; chạy xong chạy lại được', async () => {
    let release: (v: ApiResult) => void = () => undefined;
    const { probe, calls } = runner(() => new Promise<ApiResult>((r) => (release = r)));
    const first = probe.run(TCP, TCP.devices[0], null);
    expect(probe.state.running).toBe(true);
    await probe.run(TCP, TCP.devices[0], null);
    expect(calls).toHaveLength(1);
    release({ status: 200, body: { ok: true, code: 'OK' } });
    await first;
    expect(probe.state.running).toBe(false);
    void probe.run(TCP, TCP.devices[0], null);
    expect(calls).toHaveLength(2);
  });

  it('bị khóa thì không gửi gì', async () => {
    const calls: unknown[] = [];
    const probe = new ConnectionProbe({
      post: async (...a) => {
        calls.push(a);
        return { status: 200, body: {} };
      },
      gate: () => 'cn.probe.offline',
    });
    await probe.run(TCP, TCP.devices[0], null);
    expect(calls).toEqual([]);
    expect(probe.state.locked).toBe('cn.probe.offline');
  });

  it('báo cho người nghe khi trạng thái đổi', async () => {
    const { probe } = runner({ status: 200, body: { ok: true, code: 'OK' } });
    let n = 0;
    probe.subscribe(() => n++);
    await probe.run(TCP, TCP.devices[0], null);
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe('lỗi của bộ kiểm tra theo trường', () => {
  it('đường dẫn → kênh, thiết bị, khóa trường của form', async () => {
    const { issueField } = await import('./connections.ts');
    expect(issueField('/channels/1/serial/port', 'modbus-rtu')).toEqual({
      channel: 1,
      device: null,
      field: 'serialPort',
    });
    expect(issueField('/channels/0/tcp/host', 'modbus-tcp')).toEqual({
      channel: 0,
      device: null,
      field: 'host',
    });
    expect(issueField('/channels/0/devices/2/timeoutMs', 'modbus-tcp')).toEqual({
      channel: 0,
      device: 2,
      field: 'timeoutMs',
    });
    expect(issueField('/channels/0/devices/2/write/registerBit', 'modbus-tcp')).toEqual({
      channel: 0,
      device: 2,
      field: 'writeRegisterBit',
    });
    expect(issueField('/channels/3', 'modbus-tcp')).toEqual({
      channel: 3,
      device: null,
      field: null,
    });
    expect(issueField('/channels/0/devices/1', 'modbus-tcp')).toEqual({
      channel: 0,
      device: 1,
      field: null,
    });
    expect(issueField('/scanGroups/fast', 'modbus-tcp')).toBeNull();
  });
});

describe('bảng cách hiểu', () => {
  it('mỗi kiểu một dòng; 32 bit có bốn thứ tự byte; 16 bit chỉ một giá trị; thứ tự không hợp lệ được ghi nhận', async () => {
    const { interpretTable } = await import('./connections.ts');
    const { interpretRegisters } = await import('@mat/tag-codec');
    const lines = interpretTable(interpretRegisters([0x42f6, 0xe979]));
    expect(lines.map((l) => l.type)).toEqual(['INT16', 'UINT16', 'INT32', 'UINT32', 'FLOAT32']);
    expect(lines[0].values).toEqual({ '-': '17142' });
    expect(Object.keys(lines.find((l) => l.type === 'FLOAT32')!.values)).toEqual([
      'ABCD',
      'CDAB',
      'BADC',
      'DCBA',
    ]);
    const nan = interpretTable(interpretRegisters([0x7fc0, 0x0000]));
    expect(nan.find((l) => l.type === 'FLOAT32')!.invalid).toContain('ABCD');
  });
});

// ---------- Cổng serial của kênh RTU (T170, US3-1, US3-4, US3-5; device-api-1.1 §6) ----------

const PORTS_BODY = {
  ports: [
    {
      name: 'ttyAS0',
      path: '/dev/ttyAS0',
      kind: 'onboard',
      driver: 'uart',
      allowed: false,
      inUse: { by: 'console', detail: 'console của hệ điều hành (serial-getty@ttyAS0)' },
      rs485: 'unknown',
    },
    {
      name: 'ttyAS2',
      path: '/dev/ttyAS2',
      kind: 'onboard',
      driver: 'uart',
      allowed: true,
      inUse: null,
      rs485: 'enabled',
    },
    {
      name: 'ttyAS3',
      path: '/dev/ttyAS3',
      kind: 'onboard',
      driver: 'uart',
      allowed: true,
      inUse: { by: 'channel', detail: 'rs485-1' },
      rs485: 'unsupported',
    },
    {
      name: 'ttyAS4',
      path: '/dev/ttyAS4',
      kind: 'onboard',
      driver: 'uart',
      allowed: true,
      inUse: { by: 'channel', detail: 'rs485-2' },
      rs485: 'enabled',
    },
    {
      name: 'ttyUSB0',
      path: '/dev/ttyUSB0',
      kind: 'usb',
      driver: 'option',
      usb: { vid: '2c7c', pid: '0125', product: 'EC25' },
      allowed: false,
      inUse: null,
      rs485: 'unknown',
    },
  ],
};
const ports = () => parseSerialPorts(PORTS_BODY)!;

describe('parseSerialPorts', () => {
  it('đọc tên, loại, driver, cho phép, ai đang dùng, RS485, thông tin USB', () => {
    const p = ports();
    expect(p.map((x) => x.name)).toEqual(['ttyAS0', 'ttyAS2', 'ttyAS3', 'ttyAS4', 'ttyUSB0']);
    expect(p[0]).toMatchObject({
      kind: 'onboard',
      allowed: false,
      inUse: { by: 'console' },
      rs485: 'unknown',
    });
    expect(p[4]!.usb).toEqual({ vid: '2c7c', pid: '0125', product: 'EC25' });
    expect(p[1]!.inUse).toBeNull();
  });

  it('thân sai hình dạng thì null; mục thiếu tên bị bỏ; giá trị lạ thành unknown', () => {
    expect(parseSerialPorts(null)).toBeNull();
    expect(parseSerialPorts({ ports: 'x' })).toBeNull();
    const odd = parseSerialPorts({
      ports: [{ path: '/dev/x' }, { name: 'ttyX1', kind: 'lạ', rs485: 'lạ', allowed: 'có' }],
    })!;
    expect(odd).toHaveLength(1);
    expect(odd[0]).toMatchObject({
      name: 'ttyX1',
      kind: 'unknown',
      rs485: 'unknown',
      allowed: false,
      inUse: null,
    });
  });
});

describe('portStatus và portChoices: ai đang dùng cổng (US3-4)', () => {
  it('cổng trống và được phép: dùng được; cổng của chính kênh này: dùng được', () => {
    const [, free, mine] = ports();
    expect(portStatus(free!, 'rs485-1')).toEqual({ usable: true });
    expect(portStatus(mine!, 'rs485-1')).toEqual({ usable: true });
  });

  it('console, chưa được phép, kênh khác đang dùng: không dùng được kèm lý do', () => {
    const [con, , , other, usb] = ports();
    expect(portStatus(con!, 'rs485-1')).toMatchObject({ usable: false, reason: 'cn.port.console' });
    expect(portStatus(usb!, 'rs485-1')).toMatchObject({
      usable: false,
      reason: 'cn.port.notAllowed',
    });
    expect(portStatus(other!, 'rs485-1')).toEqual({
      usable: false,
      reason: 'cn.port.byChannel',
      channel: 'rs485-2',
    });
  });

  it('getty, khóa file: không dùng được; lý do theo loại', () => {
    const base = ports()[1]!;
    expect(
      portStatus({ ...base, inUse: { by: 'getty', detail: 'serial-getty' } }, 'x'),
    ).toMatchObject({ usable: false, reason: 'cn.port.getty' });
    expect(
      portStatus({ ...base, inUse: { by: 'lock', detail: 'LCK..ttyAS2' } }, 'x'),
    ).toMatchObject({ usable: false, reason: 'cn.port.lock' });
  });

  it('portChoices: cổng dùng được trước, theo thứ tự thiết bị báo; mỗi mục có tên, loại, lý do', () => {
    const choices = portChoices(ports(), 'rs485-1');
    expect(choices.map((c) => [c.name, c.usable])).toEqual([
      ['ttyAS2', true],
      ['ttyAS3', true],
      ['ttyAS0', false],
      ['ttyAS4', false],
      ['ttyUSB0', false],
    ]);
    expect(choices[0]!.kind).toBe('onboard');
    expect(choices[4]!.kind).toBe('usb');
  });
});

describe('portProblem: Studio kiểm trước cổng khi Online (T170)', () => {
  it('chưa có danh sách cổng thì không kiểm; cổng ngoài danh sách cho phép, console, kênh khác dùng thì có lỗi', () => {
    expect(portProblem('ttyAS9', null, 'rs485-1')).toBeNull();
    expect(portProblem('ttyAS9', ports(), 'rs485-1')).toMatchObject({
      reason: 'cn.err.portUnknown',
    });
    expect(portProblem('ttyUSB0', ports(), 'rs485-1')).toMatchObject({
      reason: 'cn.port.notAllowed',
    });
    expect(portProblem('ttyAS0', ports(), 'rs485-1')).toMatchObject({ reason: 'cn.port.console' });
    expect(portProblem('ttyAS4', ports(), 'rs485-1')).toMatchObject({
      reason: 'cn.port.byChannel',
      channel: 'rs485-2',
    });
    expect(portProblem('ttyAS2', ports(), 'rs485-1')).toBeNull();
    expect(portProblem('ttyAS3', ports(), 'rs485-1')).toBeNull();
    expect(portProblem('', ports(), 'rs485-1')).toBeNull();
  });

  it('nhận cả đường dẫn /dev/serial/by-id khi thiết bị báo byId', () => {
    const withById = parseSerialPorts({
      ports: [
        {
          name: 'ttyUSB1',
          path: '/dev/ttyUSB1',
          byId: '/dev/serial/by-id/usb-FTDI_X-if00-port0',
          kind: 'usb',
          driver: 'ftdi_sio',
          allowed: true,
          inUse: null,
          rs485: 'unknown',
        },
      ],
    })!;
    expect(portProblem('/dev/serial/by-id/usb-FTDI_X-if00-port0', withById, 'c')).toBeNull();
    expect(portProblem('/dev/serial/by-id/khac', withById, 'c')).toMatchObject({
      reason: 'cn.err.portUnknown',
    });
  });
});

describe('rs485Hint (US3-5)', () => {
  it('bật RS485 trên cổng kernel không hỗ trợ: gợi ý cần bộ chuyển tự đổi chiều; còn lại không có gợi ý', () => {
    const [, free, unsupported] = ports();
    expect(rs485Hint(true, unsupported!)).toBe('cn.port.rs485Unsupported');
    expect(rs485Hint(false, unsupported!)).toBeNull();
    expect(rs485Hint(true, free!)).toBeNull();
    expect(rs485Hint(true, undefined)).toBeNull();
  });
});

describe('SerialPortsLoader: đọc danh sách cổng, Dò RS485', () => {
  const online = { online: true, role: 'engineer' as const };

  it('portsGate: cần Online rồi cần engineer', () => {
    expect(portsGate({ online: false, role: null })).toBe('cn.ports.needOnline');
    expect(portsGate({ online: true, role: 'viewer' })).toBe('cn.ports.needEngineer');
    expect(portsGate({ online: true, role: 'operator' })).toBe('cn.ports.needEngineer');
    expect(portsGate(online)).toBeNull();
  });

  function make(gate: () => ReturnType<typeof portsGate> = () => null) {
    const calls: Array<{ path: string; query?: Record<string, string> }> = [];
    let reply: ApiResult | DeviceError = { status: 200, body: PORTS_BODY };
    const loader = new SerialPortsLoader({
      get: async (path, query) => {
        calls.push({ path, ...(query ? { query } : {}) });
        return reply;
      },
      gate,
    });
    return { loader, calls, setReply: (r: ApiResult | DeviceError) => (reply = r) };
  }

  it('đọc: GET /api/v1/serial/ports không có probe; trạng thái có danh sách', async () => {
    const { loader, calls } = make();
    await loader.load(false);
    expect(calls).toEqual([{ path: '/api/v1/serial/ports' }]);
    expect(loader.state.ports).toHaveLength(5);
    expect(loader.state.error).toBeNull();
    expect(loader.state.probed).toBe(false);
  });

  it('Dò RS485: gửi ?probe=1 và nhớ là đã dò', async () => {
    const { loader, calls } = make();
    await loader.load(true);
    expect(calls).toEqual([{ path: '/api/v1/serial/ports', query: { probe: '1' } }]);
    expect(loader.state.probed).toBe(true);
  });

  it('bị khóa: không gửi gì, nói lý do; lỗi thiết bị: giữ danh sách cũ và báo mã', async () => {
    let locked: ReturnType<typeof portsGate> = 'cn.ports.needOnline';
    const { loader, calls, setReply } = make(() => locked);
    await loader.load(false);
    expect(calls).toEqual([]);
    expect(loader.state.locked).toBe('cn.ports.needOnline');
    locked = null;
    await loader.load(false);
    expect(loader.state.ports).toHaveLength(5);
    setReply({ error: 'forbidden' });
    await loader.load(false);
    expect(loader.state.error).toBe('forbidden');
    expect(loader.state.ports).toHaveLength(5);
    setReply({ status: 200, body: { oops: 1 } });
    await loader.load(false);
    expect(loader.state.error).toBe('bad-response');
  });

  it('mỗi lúc một lần: đang đọc thì lần gọi sau bị bỏ; reset bỏ danh sách', async () => {
    const { loader, calls } = make();
    await Promise.all([loader.load(false), loader.load(false)]);
    expect(calls).toHaveLength(1);
    loader.reset();
    expect(loader.state.ports).toBeNull();
  });
});
