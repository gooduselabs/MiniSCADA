// Địa chỉ quay lại sau đăng nhập (feature 013, FR-002, FR-003; contracts/admin-api.md §7). Hàm thuần, dùng ở cả trang
// vận hành (dựng `/login?next=…`) và trang `/login` (kiểm rồi chuyển). Chống chuyển hướng mở: chỉ nhận một đường dẫn
// hash của trang vận hành `#/…` khớp `^#/[A-Za-z0-9/_\-.]{0,200}$`; thêm (chặt hơn hợp đồng): không đoạn rỗng (`//`),
// không đoạn `.` hay `..`. Sai thì bỏ, về `/`.

const NEXT_RE = /^#\/[A-Za-z0-9/_\-.]{0,200}$/;

/** `next` hợp lệ (đã giải mã một lần bởi URLSearchParams) → chính nó; khác → null. */
export function safeNext(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !NEXT_RE.test(raw)) return null;
  const path = raw.slice(2);
  if (path === '') return raw;
  const parts = path.split('/');
  // `#/a/` (đoạn cuối rỗng) cũng bỏ: route của trang không có dạng này.
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  return raw;
}

/** Địa chỉ trang chính sau đăng nhập: `/` + hash hợp lệ, hoặc `/`. */
export function afterLogin(raw: string | null | undefined): string {
  const n = safeNext(raw);
  return n ? `/${n}` : '/';
}

/**
 * Hash hiện tại → giá trị `next`: bỏ phần truy vấn của trang (`#/history?g=…`, không khớp hợp đồng) để vẫn quay về đúng
 * trang; hash không hợp lệ → rỗng (trang đầu).
 */
export function nextOf(hash: string): string {
  const q = hash.indexOf('?');
  const h = q < 0 ? hash : hash.slice(0, q);
  return safeNext(h) ?? '';
}

/** `/login?next=<hash>` (contracts/admin-api.md §7). */
export function loginUrl(hash: string): string {
  const n = nextOf(hash);
  return n ? `/login?next=${encodeURIComponent(n)}` : '/login';
}

/**
 * `next` của trang `/login`: tham số `next` nếu có; không có thì hash của chính trang (máy chủ trả 302 `/` → `/login` và
 * trình duyệt giữ fragment của địa chỉ gốc).
 */
export function nextFromLocation(search: string, hash: string): string | null {
  const q = new URLSearchParams(search);
  if (q.has('next')) return safeNext(q.get('next'));
  return hash ? safeNext(hash) : null;
}
