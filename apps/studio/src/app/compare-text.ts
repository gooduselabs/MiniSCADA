// Câu tiếng Việt cho lỗi của So sánh và Đọc lên (feature 005, US3): mã lỗi của lệnh Rust → khóa i18n; mã lạ thì dùng
// câu chung của `deviceErrorText`.
import { t, type MessageKey } from '../i18n/index.ts';
import type { DeviceError } from '../platform/device-types.ts';
import { deviceErrorText } from './device-errors.ts';

const COMPARE: Readonly<Record<string, MessageKey>> = {
  'no-project': 'compare.err.no-project',
  'no-project-package': 'compare.err.no-project-package',
  changed: 'compare.err.changed',
  failed: 'compare.err.failed',
};

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** Lý do không so được (`CompareState.error` là mã lỗi của thiết bị hoặc mã của bộ so). */
export function compareErrorText(code: string): string {
  const key = own(COMPARE, code);
  return key ? t(key) : deviceErrorText({ error: code });
}

/** Lý do không đọc lên được (`upload.err.*`), kể cả lỗi của `package_extract`. */
export function uploadErrorText(e: DeviceError): string {
  const detail =
    typeof e.detail === 'string' || typeof e.detail === 'number' ? String(e.detail) : '';
  switch (e.error) {
    case 'not-empty':
      return t('upload.err.not-empty');
    case 'package':
      return t('upload.err.package', { code: detail || '?' });
    case 'io':
      return t('upload.err.io', { detail: detail || '?' });
    case 'no-such-package':
      return t('upload.err.no-such-package');
    case 'no-project-package':
      return t('upload.err.no-project-package');
    default:
      return deviceErrorText(e);
  }
}
