import { describe, expect, it } from 'vitest';
import { checkDevice, liveUrl, loadDevice, normalizeDevice, saveDevice } from './device.ts';

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

  it('liveUrl', () => {
    expect(liveUrl('http://1.2.3.4:9080')).toBe('ws://1.2.3.4:9080/api/v1/live');
    expect(liveUrl('https://x:8080')).toBe('wss://x:8080/api/v1/live');
  });
});

describe('checkDevice', () => {
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

  it('lỗi mạng / HTTP lỗi / quá thời gian → "Không kết nối được"', async () => {
    const net = await checkDevice('http://d:8080', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(net.ok).toBe(false);
    if (!net.ok) expect(net.error).toMatch(/^Không kết nối được/);
    const http = await checkDevice('http://d:8080', async () => new Response('x', { status: 500 }));
    expect(http.ok).toBe(false);
    const slow = await checkDevice(
      'http://d:8080',
      (_u, init) =>
        new Promise((_res, rej) =>
          init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))),
        ),
      20,
    );
    expect(slow.ok).toBe(false);
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
