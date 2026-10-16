// Che địa chỉ kết nối trước khi hiện (chuyển từ logging-view.ts của 004 khi editor Lưu trữ có sửa, feature 010).
const MASK = '•••';

/**
 * Địa chỉ để hiện (máy chủ SQL, URL InfluxDB): che tài khoản, mật khẩu (`user:pass@`) và phần truy vấn hay fragment (có thể
 * chứa token). Project không được chứa bí mật (E_LOG_SECRET) nhưng file viết tay có thể lỡ để; giao diện không bao giờ hiện
 * lại. Che rộng tay: tới dấu `@` cuối cùng, kể cả khi mật khẩu có `/`; dấu `?`/`#` đứng trước dấu `@` (không rõ ranh giới) thì
 * che hết phần sau scheme.
 */
export function maskAddress(address: string): string {
  const start = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(address)?.[0].length ?? 0;
  const head = address.slice(0, start);
  const rest = address.slice(start);
  const at = rest.lastIndexOf('@');
  const query = rest.search(/[?#]/);
  if (query >= 0 && at > query) return head + MASK;
  let out = at >= 0 ? MASK + rest.slice(at) : rest;
  const q = out.search(/[?#]/);
  if (q >= 0) out = out.slice(0, q + 1) + MASK;
  return head + out;
}
