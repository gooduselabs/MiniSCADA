// Thiết lập thiết bị và chứng chỉ của thiết bị giả (feature 027, specs/027-device-settings FR-004–FR-006): `GET/POST
// /api/v1/admin/device-settings`, `POST /api/v1/admin/cert/{regen,csr,import}` theo đúng contract của runtime (rev, 409,
// REAUTH_REQUIRED khi giảm bảo vệ, CERT_KEY_MISMATCH). Sinh lại chứng chỉ đổi fingerprint của thiết bị giả (như runtime
// sau khi khởi động lại), để Studio thử luồng ghim lại. Trạng thái giữ riêng theo thiết bị giả; mật khẩu không ghi lại.
import {
  defaultDeviceSettings,
  fingerprintColons,
  loweredKeys,
  type DeviceSettingsValues,
} from '@mat/access-model';
import type { ApiResult, DeviceError, Role } from './device-types.ts';

interface DevState {
  rev: number;
  settings: Partial<DeviceSettingsValues>;
  sanIps: string[];
  sanDns: string[];
  csr: number;
}

const states = new WeakMap<object, DevState>();

const stateOf = (dev: object): DevState => {
  let s = states.get(dev);
  if (!s) {
    s = { rev: 0, settings: {}, sanIps: [], sanDns: [], csr: 0 };
    states.set(dev, s);
  }
  return s;
};

export const DEVICE_ADMIN_POST: readonly string[] = [
  '/api/v1/admin/device-settings',
  '/api/v1/admin/cert/regen',
  '/api/v1/admin/cert/csr',
  '/api/v1/admin/cert/import',
];

export interface MockDeviceAdminCtx {
  name: string;
  ip: string;
  fingerprint: string;
  updateEnabled: boolean;
  passwordOk: (typed: unknown) => boolean;
  /** Đổi chứng chỉ; trả fingerprint mới. */
  rotate: () => string;
}

const reply = (status: number, body: Record<string, unknown>): ApiResult => ({ status, body });

function base(c: MockDeviceAdminCtx): DeviceSettingsValues {
  return {
    ...defaultDeviceSettings(),
    viewerLogin: 'required',
    updateEnabled: c.updateEnabled,
    deviceName: c.name,
  };
}

export function get(dev: object, role: Role, c: MockDeviceAdminCtx): ApiResult | DeviceError {
  if (role !== 'administrator') return { error: 'forbidden' };
  const s = stateOf(dev);
  const eff = { ...base(c), ...s.settings };
  return reply(200, {
    rev: s.rev,
    settings: s.settings,
    base: base(c),
    effective: eff,
    running: eff,
    restartPending: false,
    cert: {
      ok: true,
      fingerprint: c.fingerprint,
      fingerprintColons: fingerprintColons(c.fingerprint),
      subject: `CN=mAT ${c.name}`,
      issuer: `CN=mAT ${c.name}`,
      selfSigned: true,
      sanDns: ['bl335', ...s.sanDns],
      sanIps: s.sanIps,
      notBefore: '2026-10-01 00:00:00',
      notAfter: '2036-10-01 00:00:00',
      chainLength: 1,
      warnings: s.sanIps.length ? [] : ['TLS_NO_IP_SAN'],
      cardIps: [c.ip],
    },
    update: { enabled: eff.updateEnabled, updaterInstalled: true },
  });
}

export function post(
  dev: object,
  role: Role,
  path: string,
  body: Record<string, unknown>,
  c: MockDeviceAdminCtx,
): ApiResult | DeviceError {
  if (role !== 'administrator') return { error: 'forbidden' };
  const s = stateOf(dev);
  if (path === '/api/v1/admin/device-settings') {
    if (body.rev !== s.rev) return reply(409, { error: 'CONFLICT', rev: s.rev });
    const settings = (body.settings ?? {}) as Partial<DeviceSettingsValues>;
    const before = { ...base(c), ...s.settings };
    const after = { ...base(c), ...settings };
    const lowered = loweredKeys(before, after);
    if (lowered.length && !c.passwordOk(body.reauth))
      return reply(403, { error: 'REAUTH_REQUIRED', lowered });
    s.settings = settings;
    s.rev++;
    return reply(200, { rev: s.rev, effective: after, restart: true, restartInMs: 1000 });
  }
  if (path === '/api/v1/admin/cert/csr') {
    s.csr++;
    return reply(200, {
      csrPem: '-----BEGIN CERTIFICATE REQUEST-----\nMIIBmock\n-----END CERTIFICATE REQUEST-----\n',
    });
  }
  if (!c.passwordOk(body.reauth)) return reply(403, { error: 'REAUTH_REQUIRED' });
  if (path === '/api/v1/admin/cert/regen') {
    const san = Array.isArray(body.san) ? body.san.filter((x) => typeof x === 'string') : [];
    s.sanIps = [c.ip, ...san.filter((x) => /^[\d.]+$/.test(x))];
    s.sanDns = san.filter((x) => !/^[\d.]+$/.test(x));
    const fp = c.rotate();
    return reply(200, {
      fingerprint: fp,
      fingerprintColons: fingerprintColons(fp),
      sanIps: s.sanIps,
      sanDns: ['bl335', ...s.sanDns],
      restart: true,
      restartInMs: 1000,
    });
  }
  // import: thiết bị giả không có khóa CA nào: chứng chỉ đọc được luôn không khớp khóa.
  const pem = typeof body.pem === 'string' ? body.pem : '';
  if (!pem.includes('BEGIN CERTIFICATE') || pem.includes('PRIVATE KEY'))
    return reply(400, { error: 'CERT_FILE_INVALID', message: 'no CERTIFICATE block' });
  return reply(400, {
    error: 'CERT_KEY_MISMATCH',
    message: 'the certificate fits no key of the device',
  });
}
