import { describe, expect, it } from 'vitest';
import {
  defaultDeviceSettings,
  deviceSettingsProblem,
  fingerprintColons,
  loweredKeys,
  overlayOf,
  parseDeviceSettings,
  parseHosts,
  sameFingerprint,
  validHostOrIp,
} from './device-settings.ts';

const base = { ...defaultDeviceSettings(), viewerLogin: 'required' as const, deviceName: 'BL335' };

describe('device settings (feature 027)', () => {
  it('parses the answer of GET /admin/device-settings', () => {
    const s = parseDeviceSettings({
      rev: 3,
      settings: { deviceName: 'Trạm 1', bogus: 1 },
      base,
      effective: { ...base, deviceName: 'Trạm 1' },
      restartPending: true,
      cert: { ok: true, fingerprint: 'ab', sanIps: ['192.0.2.10'], warnings: [] },
      update: { enabled: false, updaterInstalled: true },
    });
    expect(s.rev).toBe(3);
    expect(s.settings).toEqual({ deviceName: 'Trạm 1' });
    expect(s.effective.viewerLogin).toBe('required');
    expect(s.running.deviceName).toBe('Trạm 1');
    expect(s.cert.sanIps).toEqual(['192.0.2.10']);
    expect(s.update.updaterInstalled).toBe(true);
    expect(parseDeviceSettings(null).rev).toBe(0);
  });

  it('sends only what differs from runtime.json', () => {
    expect(overlayOf(base, { ...base })).toEqual({});
    expect(overlayOf(base, { ...base, updateEnabled: true, allowedHosts: ['a.local'] })).toEqual({
      updateEnabled: true,
      allowedHosts: ['a.local'],
    });
  });

  it('knows which changes lower the protection', () => {
    expect(loweredKeys(base, { ...base, viewerLogin: 'off' })).toEqual(['viewerLogin']);
    expect(loweredKeys(base, { ...base, viewerAccess: 'any' })).toEqual(['viewerAccess']);
    expect(loweredKeys(base, { ...base, viewerAccess: 'off' })).toEqual([]);
    expect(loweredKeys(base, { ...base, updateEnabled: true })).toEqual(['updateEnabled']);
    expect(loweredKeys(base, { ...base, allowedHosts: ['x.local'] })).toEqual(['allowedHosts']);
    expect(loweredKeys({ ...base, allowedHosts: ['x.local'] }, base)).toEqual([]);
  });

  it('checks names and hosts', () => {
    expect(parseHosts('a.local, b.local\nA.local a.local')).toEqual([
      'a.local',
      'b.local',
      'A.local',
    ]);
    expect(validHostOrIp('192.0.2.10')).toBe(true);
    expect(validHostOrIp('scada.local')).toBe(true);
    expect(validHostOrIp('*.local')).toBe(false);
    expect(validHostOrIp('300.1.1.1')).toBe(false);
    expect(deviceSettingsProblem(base)).toBeNull();
    expect(deviceSettingsProblem({ ...base, deviceName: '' })).toMatch(/1–32/);
    expect(deviceSettingsProblem({ ...base, deviceName: 'a'.repeat(33) })).toMatch(/1–32/);
    expect(deviceSettingsProblem({ ...base, allowedHosts: ['bad host'] })).toMatch(/bad host/);
    expect(deviceSettingsProblem({ ...base, maxLiveClientsPerSource: 11 })).toMatch(/1–10/);
    expect(deviceSettingsProblem({ ...base, maxLiveClientsPerSource: 0 })).toBeNull();
  });

  it('compares fingerprints as people read them', () => {
    const hex = 'ab'.repeat(32);
    expect(fingerprintColons(hex)).toBe(Array(32).fill('AB').join(':'));
    expect(sameFingerprint(hex, fingerprintColons(hex))).toBe(true);
    expect(sameFingerprint(hex, 'cd'.repeat(32))).toBe(false);
    expect(sameFingerprint('', '')).toBe(false);
  });
});
