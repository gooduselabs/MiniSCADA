import { describe, expect, it } from 'vitest';
import type { ApiResult, DeviceError, ProbeResult } from '../platform/device-types.ts';
import { DeviceSettingsFlow } from './device-settings-flow.ts';

const base = {
  viewerLogin: 'required',
  viewerAccess: 'private',
  allowedHosts: [],
  maxLiveClientsPerSource: 0,
  updateEnabled: false,
  deviceName: 'BL335-01',
};
const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);

function rig() {
  const posts: { path: string; body: Record<string, unknown> }[] = [];
  const calls: string[] = [];
  let rev = 0;
  let fp = OLD;
  let pinned: string | null = OLD;
  let restarted = false;
  const probes: (ProbeResult | DeviceError)[] = [];
  const flow = new DeviceSettingsFlow({
    get: async (): Promise<ApiResult> => ({
      status: 200,
      body: { rev, settings: {}, base, effective: base, cert: { ok: true, fingerprint: fp } },
    }),
    post: async (path, body): Promise<ApiResult> => {
      const b = body as Record<string, unknown>;
      posts.push({ path, body: b });
      if (path === '/api/v1/admin/device-settings') {
        const s = b.settings as Record<string, unknown>;
        if (s.viewerLogin === 'off' && b.reauth !== 'mk')
          return { status: 403, body: { error: 'REAUTH_REQUIRED' } };
        rev++;
        return { status: 200, body: { rev, restart: true } };
      }
      if (path === '/api/v1/admin/cert/import')
        return { status: 400, body: { error: 'CERT_KEY_MISMATCH', message: 'không khớp' } };
      fp = NEW;
      return { status: 200, body: { fingerprint: NEW, restart: true } };
    },
    probe: async () => {
      const queued = probes.shift();
      if (queued) return queued;
      const seen = restarted ? fp : OLD;
      restarted = true;
      return {
        fingerprint: seen,
        pinned,
        state: pinned === null ? 'unpinned' : pinned === seen ? 'match' : 'mismatch',
        discovered: null,
      };
    },
    pin: async (f) => {
      calls.push(`pin ${f.slice(0, 2)}`);
      pinned = f;
      return {};
    },
    unpin: async (f) => {
      calls.push(`unpin ${f.slice(0, 2)}`);
      pinned = null;
      return {};
    },
    reconnect: () => calls.push('reconnect'),
    onChange: () => {},
    sleep: async () => {},
  });
  return { flow, posts, calls, probes };
}

describe('DeviceSettingsFlow (feature 027)', () => {
  it('saves only the overlay, and asks the password when the protection drops', async () => {
    const { flow, posts } = rig();
    await flow.load();
    expect(flow.info?.effective.deviceName).toBe('BL335-01');
    expect(await flow.save({ ...flow.info!.effective, deviceName: 'Trạm 1' })).toBe('saved');
    expect(posts[0]!.body.settings).toEqual({ deviceName: 'Trạm 1' });
    expect(posts[0]!.body).not.toHaveProperty('reauth');
    const off = { ...flow.info!.effective, viewerLogin: 'off' as const };
    expect(flow.lowered(off)).toEqual(['viewerLogin']);
    expect(await flow.save(off)).toBe('needs-reauth');
    expect(await flow.save(off, 'mk')).toBe('saved');
    expect(flow.notice).toBe('saved');
  });

  it('regenerates, waits for the restart, and re-pins only after the confirmation', async () => {
    const { flow, posts, calls } = rig();
    await flow.load();
    expect(await flow.changeCert({ kind: 'regen', san: ['10.0.0.5'] }, 'mk')).toBe(true);
    expect(posts[0]!.body).toEqual({ reauth: 'mk', san: ['10.0.0.5'] });
    expect(flow.repin?.expected).toBe(NEW);
    expect(flow.repin?.state).toBe('confirm');
    expect(flow.repin?.seen).toBe(NEW);
    expect(calls).toEqual([]);
    expect(await flow.confirmRepin()).toBe(true);
    expect(calls).toEqual(['unpin aa', 'pin bb', 'reconnect']);
  });

  it('never pins a certificate other than the one the device returned', async () => {
    const { flow, probes, calls } = rig();
    await flow.load();
    probes.push({ fingerprint: 'c'.repeat(64), pinned: OLD, state: 'mismatch', discovered: null });
    await flow.changeCert({ kind: 'regen', san: [] }, 'mk');
    expect(flow.repin?.state).toBe('differs');
    expect(await flow.confirmRepin()).toBe(false);
    expect(calls).toEqual([]);
  });

  it('shows the error of an import', async () => {
    const { flow } = rig();
    await flow.load();
    expect(await flow.changeCert({ kind: 'import', pem: 'x' }, 'mk')).toBe(false);
    expect(flow.error).toEqual({ code: 'CERT_KEY_MISMATCH', message: 'không khớp' });
    expect(flow.repin).toBeNull();
  });
});
