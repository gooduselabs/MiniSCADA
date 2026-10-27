// Feature 027 (specs/027-device-settings, ADR-054): the device settings of
// GET/POST /api/v1/admin/device-settings, shared by the Studio and the admin page of the runtime.
// Pure: parsing, the overlay to send, the checks that the device makes again, and which changes
// lower the protection (they need the re-entered password).

export type ViewerLogin = 'off' | 'required';
export type ViewerAccess = 'private' | 'any' | 'off';

export interface DeviceSettingsValues {
  viewerLogin: ViewerLogin;
  viewerAccess: ViewerAccess;
  allowedHosts: string[];
  /** 0: not set (half of the live slots); 1-10. */
  maxLiveClientsPerSource: number;
  updateEnabled: boolean;
  deviceName: string;
}

export type DeviceSettingKey = keyof DeviceSettingsValues;

export const DEVICE_SETTING_KEYS: readonly DeviceSettingKey[] = [
  'viewerLogin',
  'viewerAccess',
  'allowedHosts',
  'maxLiveClientsPerSource',
  'updateEnabled',
  'deviceName',
];

export interface DeviceCertInfo {
  ok: boolean;
  error: string;
  fingerprint: string;
  fingerprintColons: string;
  subject: string;
  issuer: string;
  selfSigned: boolean;
  sanDns: string[];
  sanIps: string[];
  notBefore: string;
  notAfter: string;
  warnings: string[];
  cardIps: string[];
}

export interface DeviceSettingsInfo {
  rev: number;
  /** What settings.json holds (keys left out follow runtime.json). */
  settings: Partial<DeviceSettingsValues>;
  base: DeviceSettingsValues;
  effective: DeviceSettingsValues;
  running: DeviceSettingsValues;
  restartPending: boolean;
  cert: DeviceCertInfo;
  update: { enabled: boolean; updaterInstalled: boolean };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function defaultDeviceSettings(): DeviceSettingsValues {
  return {
    viewerLogin: 'off',
    viewerAccess: 'private',
    allowedHosts: [],
    maxLiveClientsPerSource: 0,
    updateEnabled: false,
    deviceName: '',
  };
}

function values(v: unknown): DeviceSettingsValues {
  const d = defaultDeviceSettings();
  if (!isObj(v)) return d;
  return {
    viewerLogin: v.viewerLogin === 'required' ? 'required' : 'off',
    viewerAccess: v.viewerAccess === 'any' || v.viewerAccess === 'off' ? v.viewerAccess : 'private',
    allowedHosts: strs(v.allowedHosts),
    maxLiveClientsPerSource:
      typeof v.maxLiveClientsPerSource === 'number' ? v.maxLiveClientsPerSource : 0,
    updateEnabled: v.updateEnabled === true,
    deviceName: str(v.deviceName),
  };
}

function partial(v: unknown): Partial<DeviceSettingsValues> {
  if (!isObj(v)) return {};
  const all = values(v);
  const out: Partial<DeviceSettingsValues> = {};
  for (const k of DEVICE_SETTING_KEYS) if (k in v) (out as Record<string, unknown>)[k] = all[k];
  return out;
}

export function parseDeviceSettings(b: unknown): DeviceSettingsInfo {
  const o = isObj(b) ? b : {};
  const c = isObj(o.cert) ? o.cert : {};
  const u = isObj(o.update) ? o.update : {};
  return {
    rev: typeof o.rev === 'number' ? o.rev : 0,
    settings: partial(o.settings),
    base: values(o.base),
    effective: values(o.effective),
    running: values(o.running ?? o.effective),
    restartPending: o.restartPending === true,
    cert: {
      ok: c.ok === true,
      error: str(c.error),
      fingerprint: str(c.fingerprint),
      fingerprintColons: str(c.fingerprintColons),
      subject: str(c.subject),
      issuer: str(c.issuer),
      selfSigned: c.selfSigned === true,
      sanDns: strs(c.sanDns),
      sanIps: strs(c.sanIps),
      notBefore: str(c.notBefore),
      notAfter: str(c.notAfter),
      warnings: strs(c.warnings),
      cardIps: strs(c.cardIps),
    },
    update: { enabled: u.enabled === true, updaterInstalled: u.updaterInstalled === true },
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What to send: only the keys that differ from runtime.json (`base`). */
export function overlayOf(
  base: DeviceSettingsValues,
  edited: DeviceSettingsValues,
): Partial<DeviceSettingsValues> {
  const out: Partial<DeviceSettingsValues> = {};
  for (const k of DEVICE_SETTING_KEYS)
    if (!same(base[k], edited[k])) (out as Record<string, unknown>)[k] = edited[k];
  return out;
}

const accessRank = (a: ViewerAccess) => (a === 'off' ? 0 : a === 'private' ? 1 : 2);

/** The keys whose change lowers the protection (FR-005): the device asks the password again. */
export function loweredKeys(
  before: DeviceSettingsValues,
  after: DeviceSettingsValues,
): DeviceSettingKey[] {
  const out: DeviceSettingKey[] = [];
  if (before.viewerLogin === 'required' && after.viewerLogin !== 'required')
    out.push('viewerLogin');
  if (accessRank(after.viewerAccess) > accessRank(before.viewerAccess)) out.push('viewerAccess');
  if (!before.updateEnabled && after.updateEnabled) out.push('updateEnabled');
  if (after.allowedHosts.some((h) => !before.allowedHosts.includes(h))) out.push('allowedHosts');
  return out;
}

/** Host names from a text area: one per line or separated by commas or spaces; duplicates once. */
export function parseHosts(text: string): string[] {
  const out: string[] = [];
  for (const s of text.split(/[\s,;]+/)) {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

const HOST_RE =
  /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** A name of the SAN or of allowedHosts: IPv4 or an RFC 1123 host name (no wildcard, no IPv6). */
export function validHostOrIp(s: string): boolean {
  return IPV4_RE.test(s) || (HOST_RE.test(s) && !/^[\d.]+$/.test(s));
}

/** The first problem of the edited values (Vietnamese), or null. The device checks them again. */
export function deviceSettingsProblem(v: DeviceSettingsValues): string | null {
  const name = new TextEncoder().encode(v.deviceName).length;
  if (name < 1 || name > 32) return 'Tên thiết bị phải dài 1–32 byte.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(v.deviceName))
    return 'Tên thiết bị không được có ký tự điều khiển.';
  if (v.allowedHosts.length > 32) return 'Tối đa 32 tên miền cho phép.';
  for (const h of v.allowedHosts)
    if (h.length > 253 || !validHostOrIp(h)) return `Tên miền không hợp lệ: ${h}`;
  if (
    v.maxLiveClientsPerSource !== 0 &&
    !(
      Number.isInteger(v.maxLiveClientsPerSource) &&
      v.maxLiveClientsPerSource >= 1 &&
      v.maxLiveClientsPerSource <= 10
    )
  )
    return 'Giới hạn kết nối mỗi nguồn phải là 1–10 (hoặc để mặc định).';
  return null;
}

/** "AB:CD:…" of 64 hex characters, to compare fingerprints the way people read them. */
export function fingerprintColons(hex: string): string {
  const h = hex.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return h.match(/.{1,2}/g)?.join(':') ?? '';
}

/** Two fingerprints are the same (any case, with or without colons). */
export function sameFingerprint(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  return n(a).length === 64 && n(a) === n(b);
}
