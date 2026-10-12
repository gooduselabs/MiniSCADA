// DeviceLink giả cho feature 006 (T115, contracts/tauri-commands-006.md §7): `DeviceLink.post`; `drivers/test` mọi mã kết
// quả; `projects/active` 0.2; live có `reason` và đóng 4401; `system/info.device.viewerAccess`; ghi Tag (kết quả theo
// mã yêu cầu, từ chối theo bước, tần suất); chẩn đoán driver đổi theo thời gian; điều khiển qua `control`.
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { full02 } from '../model/test-fixtures.ts';
import {
  isDeviceError,
  type ApiResult,
  type DeviceError,
  type KnownDevice,
} from './device-types.ts';
import { createMockDevice, type MockDevice } from './mock-device.ts';

const PW = `thu-${randomUUID()}`;

function ok<T>(r: T | DeviceError): T {
  if (isDeviceError(r)) throw new Error(`lỗi không mong đợi: ${JSON.stringify(r)}`);
  return r;
}
const body = (r: ApiResult | DeviceError): Record<string, unknown> =>
  ok(r).body as Record<string, unknown>;

async function online(dev: MockDevice, user = 'kysu1'): Promise<KnownDevice> {
  const f = dev.control.device('BL335-01');
  const known = ok(await dev.addDevice({ host: f.ip, httpsPort: f.httpsPort }));
  const p = ok(await dev.probe(known.id));
  const pinned = ok(await dev.pin(known.id, p.fingerprint));
  ok(await dev.login(pinned.id, user, `${PW}-${user}`));
  return pinned;
}

const uuid = () => randomUUID();

describe('DeviceLink giả: phần 006', () => {
  let dev: MockDevice;
  beforeEach(() => {
    vi.useFakeTimers();
    dev = createMockDevice({ latency: false });
    for (const u of ['kysu1', 'xem1', 'admin']) dev.control.setPassword(u, `${PW}-${u}`);
    dev.control.setRuntime('BL335-01', '0.5.0');
  });
  afterEach(() => vi.useRealTimers());

  it('runtime 0.5.0: API 1.1.0, live 1.2.0, schema 0.1 và 0.2, tính năng mới; viewerAccess và cảnh báo VIEWER_PUBLIC', async () => {
    const k = await online(dev);
    const info = body(await dev.get(k.id, '/api/v1/system/info'));
    expect(info).toMatchObject({ protocolVersion: '1.2.0', schemaVersions: ['0.1', '0.2'] });
    expect((info.device as { apiVersion: string; viewerAccess: string }).apiVersion).toBe('1.1.0');
    expect((info.device as { viewerAccess: string }).viewerAccess).toBe('private');
    expect(info.warnings).toBeUndefined();
    dev.control.setViewerAccess('BL335-01', 'any');
    const open = body(await dev.get(k.id, '/api/v1/system/info'));
    expect((open.device as { viewerAccess: string }).viewerAccess).toBe('any');
    expect(open.warnings).toEqual(['VIEWER_PUBLIC']);
    const ident = body(await dev.get(k.id, '/api/v1/device/identity'));
    expect(ident.features).toEqual(
      expect.arrayContaining(['tag-write', 'drivers', 'serial-ports']),
    );
    // Runtime cũ không có đường dẫn mới.
    dev.control.setRuntime('BL335-01', '0.4.0');
    expect(ok(await dev.get(k.id, '/api/v1/system/info')).status).toBe(200);
    expect(await dev.post(k.id, '/api/v1/tags/write', { requests: [] })).toEqual({
      error: 'http',
      detail: 404,
    });
  });

  it('post: chỉ tags/write và drivers/test; thân > 16 KiB → too-large; cần đăng nhập', async () => {
    const k = await online(dev);
    expect(await dev.post(k.id, '/api/v1/auth/login', {})).toEqual({ error: 'bad-path' });
    expect(await dev.post(k.id, '/api/v1/tags/write', { x: 'a'.repeat(17 * 1024) })).toEqual({
      error: 'too-large',
    });
    expect(await dev.post('khong-co', '/api/v1/tags/write', {})).toEqual({
      error: 'no-such-device',
    });
    await dev.logout(k.id);
    expect(await dev.post(k.id, '/api/v1/tags/write', { requests: [] })).toEqual({
      error: 'auth-required',
    });
  });

  it('projects/active: công khai, trả project 0.2 với valueTables và connections (không địa chỉ), digest', async () => {
    const k = await online(dev);
    // Đặt project 0.2 làm bản đang chạy bằng cách sửa kho của thiết bị giả.
    const files = full02();
    for (const [rel, text] of Object.entries(files)) dev.control.editStored('BL335-01', rel, text);
    const r = body(await dev.get(k.id, '/api/v1/projects/active'));
    expect((r.project as { schemaVersion: string }).schemaVersion).toBe('0.2.0');
    expect(Object.keys(r.valueTables as object)).toEqual(['TrangThaiBom']);
    const channels = (r.connections as { channels: Array<Record<string, unknown>> }).channels;
    expect(channels.map((c) => c.id)).toEqual(['plc1', 'rs485-1']);
    expect(JSON.stringify(channels)).not.toContain('192.168.10.5');
    expect(String(r.digest)).toMatch(/^sha256:/);
    // Khác bản trên máy: để thử cảnh báo khác biệt của hộp xác nhận ghi.
    dev.control.setActiveOverride('BL335-01', {
      tags: [{ id: 'TANK01.SP', kind: 'external', type: 'FLOAT32' }],
    });
    const o = body(await dev.get(k.id, '/api/v1/projects/active'));
    expect((o.tags as { tags: unknown[] }).tags).toHaveLength(1);
  });

  describe('live', () => {
    async function liveSetup() {
      const k = await online(dev);
      for (const [rel, text] of Object.entries(full02()))
        dev.control.editStored('BL335-01', rel, text);
      const sock = dev.openLive({ id: k.id });
      const msgs: Array<Record<string, unknown>> = [];
      const closes: Array<{ code: number; reason?: string }> = [];
      sock.onopen = () => undefined;
      sock.onmessage = (e) => msgs.push(JSON.parse(String(e.data)) as Record<string, unknown>);
      sock.onclose = (e) => closes.push(e as { code: number; reason?: string });
      await vi.advanceTimersByTimeAsync(30);
      sock.send(
        JSON.stringify({
          type: 'subscribe',
          requestId: 'r1',
          tags: ['TANK01.LEVEL', 'PUMP01.STATE', 'KHONG.CO'],
          mode: 'delta',
        }),
      );
      await vi.advanceTimersByTimeAsync(30);
      return { k, sock, msgs, closes };
    }

    it('Tag của project 0.2 có giá trị; Tag lạ nằm trong unknown; snapshot có reason khi không GOOD', async () => {
      const { msgs } = await liveSetup();
      const snap = msgs.find((m) => m.type === 'snapshot')!;
      expect((snap.tags as Array<{ id: string }>).map((t) => t.id)).toEqual([
        'TANK01.LEVEL',
        'PUMP01.STATE',
      ]);
      expect(snap.unknown).toEqual(['KHONG.CO']);
      expect((snap.tags as Array<Record<string, unknown>>)[0].reason).toBeUndefined();
    });

    it('setTag đổi giá trị, quality, lý do: delta có vị trí thứ tư; đổi lý do mà không đổi giá trị vẫn phát', async () => {
      const { msgs } = await liveSetup();
      dev.control.setTag('BL335-01', 'TANK01.LEVEL', {
        value: 12.4,
        quality: 'BAD',
        reason: 'TIMEOUT',
      });
      await vi.advanceTimersByTimeAsync(600);
      const d1 = msgs.filter((m) => m.type === 'delta').at(-1)!;
      expect(d1.tags).toEqual([[0, 12.4, 'BAD', 'TIMEOUT']]);
      dev.control.setTag('BL335-01', 'TANK01.LEVEL', {
        value: 12.4,
        quality: 'BAD',
        reason: 'DISCONNECTED',
      });
      await vi.advanceTimersByTimeAsync(600);
      expect(msgs.filter((m) => m.type === 'delta').at(-1)!.tags).toEqual([
        [0, 12.4, 'BAD', 'DISCONNECTED'],
      ]);
      dev.control.setTag('BL335-01', 'TANK01.LEVEL', { value: 12.5, quality: 'GOOD' });
      await vi.advanceTimersByTimeAsync(600);
      expect(msgs.filter((m) => m.type === 'delta').at(-1)!.tags).toEqual([[0, 12.5, 'GOOD']]);
    });

    it('endSession: kết nối mở bằng phiên bị đóng 4401, phiên hết hạn', async () => {
      const { k, closes } = await liveSetup();
      dev.control.endSession('BL335-01');
      await vi.advanceTimersByTimeAsync(10);
      expect(closes.at(-1)?.code).toBe(4401);
      expect(await dev.get(k.id, '/api/v1/diagnostics')).toEqual({ error: 'session-expired' });
    });

    it('theo dõi theo địa chỉ bị lọc nguồn: close 1006 lý do viewer-private hoặc viewer-off; monitor_get cũng báo', async () => {
      const f = dev.control.device('BL335-01');
      dev.control.setViewerBlock('BL335-01', 'viewer-private');
      const sock = dev.openLive({ address: `${f.ip}:${f.httpPort}` });
      const closes: Array<{ code: number; reason?: string }> = [];
      sock.onclose = (e) => closes.push(e as { code: number; reason?: string });
      await vi.advanceTimersByTimeAsync(30);
      expect(closes).toEqual([{ code: 1006, reason: 'viewer-private' }]);
      expect(await dev.monitorGet(`${f.ip}:${f.httpPort}`)).toEqual({ error: 'viewer-private' });
      dev.control.setViewerBlock('BL335-01', null);
      dev.control.setViewerAccess('BL335-01', 'off');
      expect(await dev.monitorGet(`${f.ip}:${f.httpPort}`)).toEqual({ error: 'viewer-off' });
    });
  });

  describe('ghi Tag', () => {
    async function setup(user = 'kysu1') {
      const k = await online(dev, user);
      for (const [rel, text] of Object.entries(full02()))
        dev.control.editStored('BL335-01', rel, text);
      return k;
    }
    const write = (k: KnownDevice, tag: string, value: unknown, requestId = uuid()) =>
      dev.post(k.id, '/api/v1/tags/write', { requests: [{ requestId, tag, value }] });
    const first = (r: ApiResult | DeviceError) =>
      (body(r).results as Array<Record<string, unknown>>)[0];

    it('ghi hợp lệ: ACCEPTED rồi hỏi theo mã tới CONFIRMED có readback; audit started và ok; giá trị sống đổi', async () => {
      const k = await setup();
      const id = uuid();
      const r = first(await write(k, 'TANK01.SP', 75, id));
      expect(r).toMatchObject({
        requestId: id,
        status: 'ACCEPTED',
        phase: 'queued',
        tag: 'TANK01.SP',
        value: 75,
      });
      const mid = first(await dev.get(k.id, `/api/v1/tags/write/${id}`));
      expect(mid.status).toBe('ACCEPTED');
      await vi.advanceTimersByTimeAsync(200);
      const done = first(await dev.get(k.id, '/api/v1/tags/write', { ids: id }));
      expect(done).toMatchObject({ status: 'CONFIRMED', code: 'CONFIRMED', readback: 75 });
      expect(dev.control.writeLog('BL335-01').map((x) => x.tag)).toEqual(['TANK01.SP']);
    });

    it('từ chối theo bước: tag lạ, chỉ đọc, sai kiểu, ngoài giới hạn (kèm limits), chuỗi, id trùng khác nội dung', async () => {
      const k = await setup();
      expect(first(await write(k, 'KHONG.CO', 1))).toMatchObject({
        status: 'REJECTED',
        reason: 'NO_SUCH_TAG',
      });
      expect(first(await write(k, 'TANK01.LEVEL', 1))).toMatchObject({ reason: 'READ_ONLY' });
      expect(first(await write(k, 'PUMP01.RUN_CMD', 'x'))).toMatchObject({ reason: 'BAD_TYPE' });
      expect(first(await write(k, 'TANK01.SP', 95))).toMatchObject({
        reason: 'OUT_OF_LIMITS',
        limits: { min: 0, max: 90 },
      });
      expect(first(await write(k, 'TANK01.SP', 'abc'))).toMatchObject({ reason: 'NOT_FINITE' });
      expect(first(await write(k, 'DEMO.SET', 70000))).toMatchObject({ reason: 'OUT_OF_LIMITS' });
      const id = uuid();
      await write(k, 'TANK01.SP', 10, id);
      expect(first(await write(k, 'TANK01.SP', 11, id))).toMatchObject({
        reason: 'REQUEST_ID_CONFLICT',
      });
      const dup = first(await write(k, 'TANK01.SP', 10, id));
      expect(dup).toMatchObject({ status: 'ACCEPTED', duplicate: true });
    });

    it('cách trả lời đổi được: NO_READBACK, FAILED kèm exception, TIMEOUT; mã lạ UNKNOWN', async () => {
      const k = await setup();
      dev.control.setWriteBehavior('BL335-01', {
        status: 'CONFIRMED',
        code: 'NO_READBACK',
        delayMs: 30,
      });
      const a = uuid();
      await write(k, 'PUMP01.RUN_CMD', true, a);
      dev.control.setWriteBehavior('BL335-01', {
        status: 'FAILED',
        code: 'DEVICE_EXCEPTION',
        exception: { code: '02', meaning: 'địa chỉ không hợp lệ' },
        delayMs: 30,
      });
      const b = uuid();
      await write(k, 'TANK01.SP', 50, b);
      dev.control.setWriteBehavior('BL335-01', {
        status: 'TIMEOUT',
        code: 'WRITE_TIMEOUT',
        delayMs: 30,
      });
      const c = uuid();
      await write(k, 'TANK01.SP', 51, c);
      await vi.advanceTimersByTimeAsync(100);
      const res = body(
        await dev.get(k.id, '/api/v1/tags/write', { ids: [a, b, c, uuid()].join(',') }),
      ).results as Array<Record<string, unknown>>;
      expect(res[0]).toMatchObject({ status: 'CONFIRMED', code: 'NO_READBACK' });
      expect(res[0].readback).toBeUndefined();
      expect(res[1]).toMatchObject({ status: 'FAILED', exception: { code: '02' } });
      expect(res[2]).toMatchObject({ status: 'TIMEOUT', code: 'WRITE_TIMEOUT' });
      expect(res[3].status).toBe('UNKNOWN');
      expect(await dev.get(k.id, `/api/v1/tags/write/${uuid()}`)).toEqual({
        error: 'no-such-request',
      });
    });

    it('tần suất: quá 20 lệnh/phút → RATE_LIMITED kèm retryAfterMs; setWriteRate đổi giới hạn', async () => {
      const k = await setup();
      for (let i = 0; i < 20; i++)
        expect(first(await write(k, 'TANK01.SP', i)).status).toBe('ACCEPTED');
      const r = first(await write(k, 'TANK01.SP', 1));
      expect(r).toMatchObject({ status: 'REJECTED', reason: 'RATE_LIMITED' });
      expect(Number(r.retryAfterMs)).toBeGreaterThan(0);
      dev.control.setWriteRate('BL335-01', 0);
      expect(first(await write(k, 'TANK01.SP', 2)).status).toBe('ACCEPTED');
    });

    it('viewer không ghi được: 403 kèm results FORBIDDEN; kết quả của lệnh người khác: operator không thấy, administrator thấy', async () => {
      const k = await setup('kysu1');
      const id = uuid();
      await write(k, 'TANK01.SP', 5, id);
      ok(await dev.login(k.id, 'xem1', PW + '-xem1'));
      const r = ok(
        await dev.post(k.id, '/api/v1/tags/write', {
          requests: [{ requestId: uuid(), tag: 'TANK01.SP', value: 1 }],
        }),
      );
      expect(r.status).toBe(403);
      expect((r.body as { results: Array<{ reason: string }> }).results[0].reason).toBe(
        'FORBIDDEN',
      );
      expect(await dev.get(k.id, '/api/v1/tags/write/' + id)).toEqual({ error: 'forbidden' });
      ok(await dev.login(k.id, 'admin', PW + '-admin'));
      expect(first(await dev.get(k.id, '/api/v1/tags/write/' + id)).requestId).toBe(id);
    });

    it('audit lọc theo Tag (administrator): lệnh ghi hiện started, ok, denied với target và requestId', async () => {
      const k = await setup('kysu1');
      const id = uuid();
      await write(k, 'TANK01.SP', 5, id);
      await write(k, 'TANK01.SP', 95);
      await vi.advanceTimersByTimeAsync(300);
      await dev.get(k.id, '/api/v1/tags/write/' + id);
      ok(await dev.login(k.id, 'admin', PW + '-admin'));
      const rows = (
        body(await dev.get(k.id, '/api/v1/audit', { target: 'TANK01.SP', action: 'tag.' }))
          .records as Array<Record<string, unknown>>
      ).map((r) => [r.result, r.code]);
      expect(rows).toEqual(
        expect.arrayContaining([
          ['started', 'ACCEPTED'],
          ['ok', 'CONFIRMED'],
          ['denied', 'OUT_OF_LIMITS'],
        ]),
      );
      expect(body(await dev.get(k.id, '/api/v1/audit', { target: 'KHONG.CO' })).records).toEqual(
        [],
      );
    });
  });

  it('drivers/test: mọi mã kết quả theo máy chủ, cổng và địa chỉ đọc; kèm thanh ghi thô', async () => {
    const k = await online(dev);
    const probe = (
      host: string,
      read: Record<string, unknown> | null = { address: 'HR100', count: 2 },
      extra: object = {},
    ) =>
      dev.post(k.id, '/api/v1/drivers/test', {
        channel: { kind: 'modbus-tcp', tcp: { host, port: 502 }, ...extra },
        device: { unitId: 1 },
        ...(read ? { read } : {}),
      });
    const okr = body(await probe('192.168.10.5'));
    expect(okr).toMatchObject({ ok: true, code: 'OK' });
    expect((okr.read as { registers: string[] }).registers).toEqual(['42F6', 'E979']);
    const bits = body(await probe('192.168.10.5', { address: 'C10', count: 3 }));
    expect((bits.read as { bits: boolean[] }).bits).toHaveLength(3);
    for (const [host, code] of [
      ['refuse.test', 'REFUSED'],
      ['timeout.test', 'TIMEOUT'],
      ['unreach.test', 'UNREACHABLE'],
      ['dns.test', 'DNS'],
      ['badframe.test', 'BAD_FRAME'],
    ] as const)
      expect(body(await probe(host)).code, host).toBe(code);
    expect(body(await probe('192.168.10.5', { address: 'HR9000', count: 1 }))).toMatchObject({
      ok: false,
      code: 'EXCEPTION',
      exception: { code: '02', meaning: 'địa chỉ không hợp lệ' },
    });
    // RTU: các mã cổng.
    for (const [port, code] of [
      ['ttyAS0', 'PORT_CONSOLE'],
      ['ttyAS9', 'PORT_NOT_ALLOWED'],
      ['ttyUSB0', 'PORT_BUSY'],
      ['ttyERR1', 'PORT_ERROR'],
    ] as const) {
      const r = body(
        await dev.post(k.id, '/api/v1/drivers/test', {
          channel: { kind: 'modbus-rtu', serial: { port } },
          device: { slave: 1 },
        }),
      );
      expect(r.code, port).toBe(code);
    }
    // Địa chỉ đọc sai cú pháp → 400 kèm issues.
    const bad = ok(await probe('192.168.10.5', { address: 'HR', count: 1 }));
    expect(bad.status).toBe(400);
    expect((bad.body as { issues: Array<{ code: string }> }).issues[0].code).toBe('E_ADDR_SYNTAX');
    expect(dev.control.probeLog('BL335-01').length).toBeGreaterThan(8);
  });

  it('drivers/test: TEST_BUSY, TEST_RATE_LIMITED, AUDIT_UNAVAILABLE một lần; viewer không dùng được', async () => {
    const k = await online(dev);
    const call = () =>
      dev.post(k.id, '/api/v1/drivers/test', {
        channel: { kind: 'modbus-tcp', tcp: { host: 'a', port: 502 } },
        device: {},
      });
    dev.control.setProbeError('BL335-01', 'TEST_BUSY');
    expect(ok(await call())).toMatchObject({ status: 409, body: { error: 'TEST_BUSY' } });
    dev.control.setProbeError('BL335-01', 'TEST_RATE_LIMITED');
    expect(ok(await call())).toMatchObject({ status: 429, body: { error: 'TEST_RATE_LIMITED' } });
    dev.control.setProbeError('BL335-01', 'AUDIT_UNAVAILABLE');
    expect(ok(await call())).toMatchObject({ status: 503 });
    expect(ok(await call()).status).toBe(200);
    dev.control.setProbe('BL335-01', () => ({ body: { ok: false, code: 'TIMEOUT' } }));
    expect(body(await call()).code).toBe('TIMEOUT');
  });

  it('chẩn đoán driver: số đếm đổi theo thời gian, tiêm lỗi, Tag xấu, lỗi chung; yêu cầu viewer', async () => {
    const k = await online(dev);
    for (const [rel, text] of Object.entries(full02()))
      dev.control.editStored('BL335-01', rel, text);
    const a = body(await dev.get(k.id, '/api/v1/drivers/diagnostics'));
    const channels = a.channels as Array<{
      id: string;
      devices: Array<{ id: string; requestsOk: number; timeouts: number }>;
    }>;
    expect(channels.map((c) => c.id)).toEqual(['plc1', 'rs485-1']);
    const base = channels[0].devices[0].requestsOk;
    const b = body(await dev.get(k.id, '/api/v1/drivers/diagnostics'));
    expect((b.channels as typeof channels)[0].devices[0].requestsOk).toBeGreaterThan(base);
    dev.control.injectDriverFault('BL335-01', 'plc1', {
      timeouts: 10,
      exceptions: { '02': 1 },
      overloaded: true,
    });
    const c = body(await dev.get(k.id, '/api/v1/drivers/diagnostics'));
    const dev1 = (
      c.channels as Array<{
        devices: Array<Record<string, unknown>>;
        lastError: { code: string } | null;
      }>
    )[0];
    expect(dev1.devices[0].timeouts).toBe(10);
    expect(dev1.devices[0].exceptions).toEqual({ '02': 1 });
    expect(dev1.lastError?.code).toBe('TIMEOUT');
    dev.control.setDriverDiagnostics('BL335-01', {
      badTags: [
        { id: 'PUMP01.FAULT', quality: 'BAD', reason: 'EXCEPTION_02', detail: '02', updatedAt: 1 },
      ],
    });
    expect(
      (body(await dev.get(k.id, '/api/v1/drivers/diagnostics')).badTags as unknown[]).length,
    ).toBe(1);
    dev.control.setDriverDiagnostics('BL335-01', { fail: 'timeout' });
    expect(await dev.get(k.id, '/api/v1/drivers/diagnostics')).toEqual({ error: 'timeout' });
  });

  it('danh sách cổng serial cần engineer; có console, đang dùng, USB modem, RS485', async () => {
    const k = await online(dev);
    const ports = body(await dev.get(k.id, '/api/v1/serial/ports')).ports as Array<
      Record<string, unknown>
    >;
    expect(ports.map((p) => p.name)).toEqual(['ttyAS0', 'ttyAS2', 'ttyAS3', 'ttyUSB0']);
    expect(ports[0]).toMatchObject({ allowed: false, inUse: { by: 'console' } });
    expect(ports[3]).toMatchObject({ kind: 'usb', usb: { product: 'EC25' } });
    expect(ports.map((p) => p.rs485)).toEqual(['unknown', 'enabled', 'unsupported', 'unknown']);
  });
});
