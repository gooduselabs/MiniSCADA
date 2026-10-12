import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkDevice,
  DEVICE_TIMEOUT_MS,
  deviceProject,
  formatBytes,
  liveUrl,
  loadDevice,
  normalizeDevice,
  normalizeHttps,
  normalizeMonitor,
  saveDevice,
} from './device.ts';

// Feature 005 (T085a): địa chỉ của chế độ theo dõi chỉ đọc (trang Thiết bị) chỉ đi HTTP. `https://` báo lỗi
// riêng ngay khi gõ, để gợi ý dùng Online; không tự bỏ scheme rồi gọi HTTP.
describe('normalizeMonitor', () => {
  it('như normalizeDevice với http:// hoặc không có scheme', () => {
    for (const input of [
      '192.168.1.110',
      ' 192.168.1.110:9080 ',
      'http://198.51.100.200:9080/',
      'x y',
    ])
      expect(normalizeMonitor(input), input).toEqual(normalizeDevice(input));
  });

  it('https:// (kể cả chữ hoa, chưa gõ xong) → lỗi https; scheme khác vẫn là scheme', () => {
    for (const input of [
      'https://192.168.1.110:8443',
      ' HTTPS://bl335.local',
      'https://',
      'https://x y',
    ])
      expect(normalizeMonitor(input), input).toEqual({ ok: false, error: 'https' });
    expect(normalizeMonitor('ftp://x')).toEqual({ ok: false, error: 'scheme' });
    expect(normalizeMonitor('  ')).toEqual({ ok: false, error: 'empty' });
  });
});

// Feature 005 (T079, T080): thêm thiết bị theo địa chỉ dùng HTTPS, cổng mặc định 8443; cùng luật tên máy
// với normalizeDevice (contract tauri-commands §3).
describe('normalizeHttps', () => {
  it('IP hoặc tên, có thể kèm cổng; mặc định cổng 8443; nhận https://', () => {
    expect(normalizeHttps('10.8.0.21')).toEqual({
      ok: true,
      host: '10.8.0.21',
      port: 8443,
      base: 'https://10.8.0.21:8443',
    });
    expect(normalizeHttps(' 10.8.0.21:9443 ')).toMatchObject({ ok: true, port: 9443 });
    expect(normalizeHttps('https://bl335.local/')).toEqual({
      ok: true,
      host: 'bl335.local',
      port: 8443,
      base: 'https://bl335.local:8443',
    });
  });

  it('lý do từ chối là mã; http:// không dùng được (API kỹ thuật chỉ qua HTTPS, FR-007)', () => {
    expect(normalizeHttps('  ')).toEqual({ ok: false, error: 'empty' });
    expect(normalizeHttps('http://10.8.0.21:8080')).toEqual({ ok: false, error: 'scheme' });
    expect(normalizeHttps('ftp://x')).toEqual({ ok: false, error: 'scheme' });
    expect(normalizeHttps('x y')).toEqual({ ok: false, error: 'address' });
    expect(normalizeHttps('a/b')).toEqual({ ok: false, error: 'address' });
    expect(normalizeHttps('a:0')).toEqual({ ok: false, error: 'port' });
    expect(normalizeHttps('a:70000')).toEqual({ ok: false, error: 'port' });
  });
});

describe('normalizeDevice', () => {
  it('chuẩn hóa địa chỉ; mặc định cổng 8080', () => {
    expect(normalizeDevice('192.168.1.110')).toEqual({
      ok: true,
      base: 'http://192.168.1.110:8080',
    });
    expect(normalizeDevice(' 192.168.1.110:9080 ')).toEqual({
      ok: true,
      base: 'http://192.168.1.110:9080',
    });
    expect(normalizeDevice('http://198.51.100.200:9080/')).toEqual({
      ok: true,
      base: 'http://198.51.100.200:9080',
    });
    expect(normalizeDevice('https://scada.local')).toEqual({
      ok: true,
      base: 'https://scada.local:8080',
    });
    expect(normalizeDevice('bl335.local')).toEqual({ ok: true, base: 'http://bl335.local:8080' });
  });

  it('từ chối scheme khác, đường dẫn, cổng sai', () => {
    for (const bad of [
      '',
      'ftp://x',
      'javascript:alert(1)',
      'x y',
      'http://a/b',
      'a:0',
      'a:70000',
      'a@b',
    ]) {
      expect(normalizeDevice(bad).ok, bad).toBe(false);
    }
  });

  // Feature 004: lý do là mã, giao diện đổi sang chữ qua i18n (FR-014).
  it('lý do từ chối là mã: empty, scheme, address, port', () => {
    expect(normalizeDevice('   ')).toEqual({ ok: false, error: 'empty' });
    expect(normalizeDevice('ftp://x')).toEqual({ ok: false, error: 'scheme' });
    expect(normalizeDevice('x y')).toEqual({ ok: false, error: 'address' });
    expect(normalizeDevice('http://a/b')).toEqual({ ok: false, error: 'address' });
    expect(normalizeDevice('a:0')).toEqual({ ok: false, error: 'port' });
    expect(normalizeDevice('a:70000')).toEqual({ ok: false, error: 'port' });
  });

  it('liveUrl', () => {
    expect(liveUrl('http://1.2.3.4:9080')).toBe('ws://1.2.3.4:9080/api/v1/live');
    expect(liveUrl('https://x:8080')).toBe('wss://x:8080/api/v1/live');
  });
});

describe('checkDevice', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('200 → thông tin thiết bị', async () => {
    const info = {
      runtimeVersion: '0.2.0',
      clients: 1,
      maxClients: 10,
      project: { status: 'active' },
    };
    const r = await checkDevice('http://d:8080', async (url) => {
      expect(url).toBe('http://d:8080/api/v1/system/info');
      return new Response(JSON.stringify(info), { status: 200 });
    });
    expect(r).toEqual({ ok: true, info });
  });

  // Feature 004: phiên thiết bị và giao diện đọc mã lỗi; chữ hiển thị nằm trong i18n.
  it('lỗi kèm mã máy đọc được: network, http, timeout, bad-response', async () => {
    const base = 'http://d:8080';
    const net = await checkDevice(base, async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(net).toEqual({ ok: false, code: 'network', detail: 'Failed to fetch' });
    const http = await checkDevice(base, async () => new Response('x', { status: 503 }));
    expect(http).toEqual({ ok: false, code: 'http', detail: '503' });
    const slow = await checkDevice(
      base,
      (_u, init) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
      20,
    );
    expect(slow).toEqual({ ok: false, code: 'timeout' });
    const html = await checkDevice(base, async () => new Response('<html>', { status: 200 }));
    expect(html).toMatchObject({ ok: false, code: 'bad-response' });
    for (const body of ['null', '[]', '42']) {
      const r = await checkDevice(base, async () => new Response(body, { status: 200 }));
      expect(r, body).toMatchObject({ ok: false, code: 'bad-response' });
    }
  });

  // FR-027: báo trong ≤ 3 s kể cả khi lớp mạng không trả lời và không nghe tín hiệu hủy.
  it('fetch treo, không nghe tín hiệu hủy: vẫn báo timeout đúng hạn (≤ 2,8 s, chừa thời gian vẽ trong 3 s)', async () => {
    expect(DEVICE_TIMEOUT_MS).toBeLessThanOrEqual(2800);
    vi.useFakeTimers();
    let done = false;
    const p = checkDevice('http://d:8080', () => new Promise<Response>(() => undefined)).then(
      (r) => {
        done = true;
        return r;
      },
    );
    await vi.advanceTimersByTimeAsync(DEVICE_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: false, code: 'timeout' });
  });

  it('thân phản hồi treo: cũng báo timeout', async () => {
    vi.useFakeTimers();
    const p = checkDevice(
      'http://d:8080',
      async () =>
        ({
          ok: true,
          status: 200,
          json: () => new Promise(() => undefined),
        }) as unknown as Response,
      3000,
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toEqual({ ok: false, code: 'timeout' });
  });

  it('lớp mạng trả lỗi sau khi đã quá hạn: không có lỗi promise bị bỏ rơi', async () => {
    vi.useFakeTimers();
    let reject: (e: unknown) => void = () => undefined;
    const p = checkDevice(
      'http://d:8080',
      () => new Promise<Response>((_res, rej) => (reject = rej)),
      100,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(await p).toEqual({ ok: false, code: 'timeout' });
    reject(new TypeError('late'));
    await vi.advanceTimersByTimeAsync(10);
  });
});

describe('ghi nhớ địa chỉ', () => {
  it('đọc/ghi qua storage, chịu được storage lỗi', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    saveDevice('1.2.3.4:9080', storage);
    expect(loadDevice(storage)).toBe('1.2.3.4:9080');
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadDevice(broken)).toBeNull();
    expect(() => saveDevice('x', broken)).not.toThrow();
  });
});

// Thanh trạng thái và Chẩn đoán báo project trên thiết bị so với project đang mở (spec, Edge Cases).
describe('deviceProject', () => {
  const local = { projectId: 'tank-demo', projectVersion: '0.1.0' };
  const info = (project: unknown) => ({ project }) as Parameters<typeof deviceProject>[0];

  it('chưa có thông tin hoặc thiết bị không báo khối project', () => {
    expect(deviceProject(null, local)).toEqual({ kind: 'unknown' });
    expect(deviceProject(info(undefined), local)).toEqual({ kind: 'unknown' });
    expect(deviceProject(info({ status: 'la' }), local)).toEqual({ kind: 'unknown' });
  });

  it('thiết bị chưa có project, project lỗi', () => {
    expect(deviceProject(info({ status: 'missing' }), local)).toEqual({ kind: 'none' });
    expect(deviceProject(info({ status: 'invalid', errors: [] }), local)).toEqual({
      kind: 'invalid',
    });
  });

  it('cùng project, khác phiên bản, project khác', () => {
    const active = (projectId: string, projectVersion: string) =>
      info({ status: 'active', projectId, projectVersion });
    expect(deviceProject(active('tank-demo', '0.1.0'), local)).toEqual({
      kind: 'same',
      id: 'tank-demo',
      version: '0.1.0',
    });
    expect(deviceProject(active('tank-demo', '0.1.1'), local)).toEqual({
      kind: 'version',
      id: 'tank-demo',
      device: '0.1.1',
      local: '0.1.0',
    });
    expect(deviceProject(active('plant-a', '0.2.0'), local)).toEqual({
      kind: 'other',
      id: 'plant-a',
      version: '0.2.0',
    });
  });

  it('chưa mở project trên máy: chỉ báo project đang chạy', () => {
    expect(
      deviceProject(info({ status: 'active', projectId: 'a', projectVersion: '1.0.0' }), null),
    ).toEqual({ kind: 'active', id: 'a', version: '1.0.0' });
  });
});

describe('formatBytes', () => {
  it('KB / MB / GB, dấu phẩy thập phân', () => {
    expect(formatBytes(49152)).toBe('48 KB');
    expect(formatBytes(12582912)).toBe('12,0 MB');
    expect(formatBytes(2147483648)).toBe('2,0 GB');
    expect(formatBytes(undefined)).toBe('?');
  });
});
