// Mô hình thuần của tab "API key" (feature 025, specs/025-data-api FR-003, FR-007): đọc danh sách IP/CIDR từ ô nhập,
// kiểm form trước khi gửi (máy chủ kiểm lại tất cả), biết khi nào cần xác nhận lại mật khẩu (key có quyền ghi), dựng
// ví dụ gọi API. Không DOM, không mạng.

export interface ApiKeyDraft {
  name: string;
  role: 'viewer' | 'operator';
  readOnly: boolean;
  groups: string[];
  allowFrom: string[];
  /** ISO UTC (`2026-12-31T00:00:00Z`) hoặc null: không hạn. */
  expiresAt: string | null;
  ratePerMin: number;
}

export const RATE_MIN = 10;
export const RATE_MAX = 6000;
export const RATE_DEFAULT = 600;
export const MAX_ALLOW_FROM = 16;

export function emptyDraft(): ApiKeyDraft {
  return {
    name: '',
    role: 'viewer',
    readOnly: true,
    groups: [],
    allowFrom: [],
    expiresAt: null,
    ratePerMin: RATE_DEFAULT,
  };
}

/** Key ghi được Tag: vai trò operator và không chỉ đọc. */
export const canWrite = (d: Pick<ApiKeyDraft, 'role' | 'readOnly'>): boolean =>
  d.role === 'operator' && !d.readOnly;

/** Cần nhập lại mật khẩu: tạo key ghi được, hoặc sửa một key chưa ghi được thành ghi được. */
export function needsReauth(
  d: Pick<ApiKeyDraft, 'role' | 'readOnly'>,
  before?: Pick<ApiKeyDraft, 'role' | 'readOnly'>,
): boolean {
  return canWrite(d) && (!before || !canWrite(before));
}

/** Tách ô nhập (dấu phẩy, khoảng trắng, xuống dòng), bỏ trống và trùng, giữ thứ tự. */
export function splitAllowFrom(text: string): string[] {
  const out: string[] = [];
  for (const s of text.split(/[\s,;]+/)) if (s && !out.includes(s)) out.push(s);
  return out;
}

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function validV6(a: string): boolean {
  if (!/^[0-9A-Fa-f:.]+$/.test(a) || a.includes(':::')) return false;
  const halves = a.split('::');
  if (halves.length > 2) return false;
  const groups = (s: string) => (s === '' ? [] : s.split(':'));
  const parts = halves.flatMap(groups);
  let n = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i === parts.length - 1 && p.includes('.')) {
      if (!V4.test(p)) return false;
      n += 2;
    } else if (/^[0-9A-Fa-f]{1,4}$/.test(p)) n += 1;
    else return false;
  }
  return halves.length === 2 ? n < 8 : n === 8;
}

/** Một địa chỉ hoặc mạng như máy chủ nhận: `192.0.2.7`, `192.0.2.0/24`, `2001:db8::/32`. */
export function validIpNet(s: string): boolean {
  const [addr, prefix, more] = s.split('/');
  if (more !== undefined || !addr) return false;
  const v6 = addr.includes(':');
  if (v6 ? !validV6(addr) : !V4.test(addr)) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (v6 ? 128 : 32);
}

export type DraftProblem =
  | { field: 'name' }
  | { field: 'allowFrom'; value: string }
  | { field: 'allowFromCount' }
  | { field: 'rate' }
  | { field: 'expires' };

/** Lỗi đầu tiên của form (null: gửi được). `now`: ms UTC, hạn phải ở tương lai. */
export function draftProblem(d: ApiKeyDraft, now: number): DraftProblem | null {
  const name = d.name.trim();
  // eslint-disable-next-line no-control-regex
  if (!name || [...name].length > 64 || /[\u0000-\u001f\u007f]/.test(name))
    return { field: 'name' };
  if (d.allowFrom.length > MAX_ALLOW_FROM) return { field: 'allowFromCount' };
  for (const a of d.allowFrom) if (!validIpNet(a)) return { field: 'allowFrom', value: a };
  if (!Number.isInteger(d.ratePerMin) || d.ratePerMin < RATE_MIN || d.ratePerMin > RATE_MAX)
    return { field: 'rate' };
  if (d.expiresAt !== null) {
    const t = Date.parse(d.expiresAt);
    if (!Number.isFinite(t) || t <= now) return { field: 'expires' };
  }
  return null;
}

/** Ngày của ô `<input type="date">` (giờ địa phương, cuối ngày) thành ISO UTC; '' → null. */
export function expiryFromDate(value: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
  return `${end.toISOString().slice(0, 19)}Z`;
}

/** ISO UTC thành giá trị cho `<input type="date">` (ngày địa phương). */
export function dateFromExpiry(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/** Lệnh `curl` mẫu cho thiết bị đang mở trang (token thật chỉ có ngay sau khi tạo). */
export function curlExample(origin: string, token = 'matk_…'): string {
  return `curl --cacert device.crt -H "Authorization: Bearer ${token}" ${origin}/api/v1/data/values`;
}
