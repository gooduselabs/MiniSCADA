// CSP của Studio (feature 005, T084, contracts/tauri-commands.md §1, research R6): WebView không tự kết nối ra
// mạng nữa, `connect-src 'self' ipc: http://ipc.localhost` (bỏ `http: ws:`); mọi request và WebSocket tới
// thiết bị đi qua Rust. Điều kiện để siết: chế độ theo dõi của 004 (Kiểm tra kết nối, Ctrl+K) đã đi qua
// `monitor_get` và `live_open({ address })`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkDevice } from '../model/device.ts';
import { newOnlineApp } from '../ui/online-test-helpers.ts';

const CONF = resolve(__dirname, '../../src-tauri/tauri.conf.json');

function csp(): Map<string, string[]> {
  const conf = JSON.parse(readFileSync(CONF, 'utf8')) as {
    app: { security: { csp: string; freezePrototype?: boolean } };
  };
  const out = new Map<string, string[]>();
  for (const part of conf.app.security.csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe('CSP của Studio', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("connect-src chỉ có 'self' và IPC của Tauri: WebView không tự gọi ra mạng", () => {
    expect(csp().get('connect-src')).toEqual(["'self'", 'ipc:', 'http://ipc.localhost']);
  });

  it('không chỉ thị nào cho phép http:, https:, ws:, wss: hay * (mọi kết nối tới thiết bị đi qua Rust)', () => {
    for (const [name, values] of csp())
      for (const v of values)
        expect(['http:', 'https:', 'ws:', 'wss:', '*'], name).not.toContain(v);
  });

  it('các chỉ thị khác giữ như 004; freezePrototype bật', () => {
    const d = csp();
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('script-src')).toEqual(["'self'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'none'"]);
    const conf = JSON.parse(readFileSync(CONF, 'utf8')) as {
      app: { security: { freezePrototype?: boolean } };
    };
    expect(conf.app.security.freezePrototype).toBe(true);
  });

  // T085a: Ctrl+K chạy Online theo thiết bị gắn với project; theo dõi theo địa chỉ còn ở trang Thiết bị
  // (Kết nối theo dõi, `monitorAddress`).
  it('chế độ theo dõi của 004 đi qua Rust: Kiểm tra kết nối và Kết nối theo dõi (trang Thiết bị) dùng monitor_get, live_open theo địa chỉ; không fetch, WebSocket của WebView', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn(() => Promise.reject(new Error('WebView fetch bị CSP chặn')));
    const wsSpy = vi.fn(() => {
      throw new Error('WebView WebSocket bị CSP chặn');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    const { app, dev } = await newOnlineApp();
    app.setDeviceAddress('192.168.1.110');
    const check = await checkDevice('http://192.168.1.110:8080', app.checkFetch);
    expect(check).toMatchObject({ ok: true, info: { runtimeVersion: '0.4.0' } });
    app.monitorAddress();
    await vi.advanceTimersByTimeAsync(300);
    expect(app.session.state).toBe('monitoring');
    const calls = dev.control.calls;
    expect(calls.filter((c) => c.cmd === 'monitor_get').map((c) => c.args.address)).toContain(
      '192.168.1.110:8080',
    );
    expect(calls.find((c) => c.cmd === 'live_open')?.args.target).toEqual({
      address: '192.168.1.110:8080',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    app.session.disconnect();
  });

  it('main.ts dựng StudioApp với DeviceLink của tauri-device.ts (bản e2e: mock-device.ts)', () => {
    const main = readFileSync(resolve(__dirname, '../main.ts'), 'utf8');
    expect(main).toMatch(/import \{ deviceLink \} from '\.\/platform\/tauri-device\.ts';/);
    expect(main).toMatch(/new StudioApp\(\{[^}]*link: deviceLink/);
  });
});
