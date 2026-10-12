// Câu tiếng Việt cho mã lỗi của lệnh Rust (feature 005, contracts/tauri-commands.md §1–7, §10): chuỗi
// kebab-case (`unreachable`) hoặc đối tượng một khóa có dữ liệu kèm (`{ tls: "…" }`, `{ http: 503 }`,
// `{ network: "…" }`, `{ locked: 287 }`, `{ "cert-mismatch": { pinned, seen } }`). Mã lạ: câu chung kèm mã.
import { t, type MessageKey } from '../i18n/index.ts';
import type { DeviceError } from '../platform/device-types.ts';

const TEXT: Readonly<Record<string, MessageKey>> = {
  'bad-address': 'deverr.bad-address',
  closed: 'deverr.closed',
  'too-large': 'deverr.too-large',
  'not-tls': 'deverr.not-tls',
  'bad-response': 'deverr.bad-response',
  'no-such-device': 'deverr.no-such-device',
  'pin-mismatch': 'deverr.pin-mismatch',
  'not-observed': 'deverr.not-observed',
  'setup-required': 'deverr.setup-required',
  'cert-unpinned': 'deverr.cert-unpinned',
  timeout: 'deverr.timeout',
  unreachable: 'deverr.unreachable',
  busy: 'deverr.busy',
  'auth-failed': 'deverr.auth-failed',
  'auth-busy': 'deverr.auth-busy',
  'audit-unavailable': 'deverr.audit-unavailable',
  'auth-required': 'deverr.auth-required',
  'session-expired': 'deverr.session-expired',
  'session-invalid': 'deverr.session-invalid',
  forbidden: 'deverr.forbidden',
  'bad-path': 'deverr.bad-path',
  'too-many': 'deverr.too-many',
  ipc: 'deverr.ipc',
  'cert-mismatch': 'deverr.cert-mismatch',
};

/** Mã có dữ liệu kèm: câu không kèm và câu kèm dữ liệu. */
const WITH_DETAIL: Readonly<Record<string, [MessageKey, MessageKey]>> = {
  tls: ['deverr.tls', 'deverr.tlsDetail'],
  http: ['deverr.http', 'deverr.httpDetail'],
  network: ['deverr.network', 'deverr.networkDetail'],
};

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** "4 phút 47 giây", "40 giây". */
export function duration(total: number): string {
  const s = Math.max(0, Math.round(total));
  const m = Math.floor(s / 60);
  return m ? t('login.time.ms', { m, s: s % 60 }) : t('login.time.s', { s });
}

export function deviceErrorText(e: DeviceError): string {
  const detail =
    typeof e.detail === 'string' || typeof e.detail === 'number' ? String(e.detail) : '';
  if (e.error === 'locked')
    return typeof e.detail === 'number'
      ? t('deverr.lockedDetail', { time: duration(e.detail) })
      : t('deverr.locked');
  const pair = own(WITH_DETAIL, e.error);
  if (pair) return detail ? t(pair[1], { detail }) : t(pair[0]);
  const key = own(TEXT, e.error);
  return key ? t(key) : t('deverr.other', { code: e.error });
}
