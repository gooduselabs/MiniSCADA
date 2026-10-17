/**
 * Đặt thuộc tính riêng `k` của `out`, kể cả khi `k` là `__proto__`: gán `out[k] = v` với khóa đó (thuộc tính riêng
 * khi đến từ JSON.parse) đổi prototype của `out` và làm mất khóa (fuzz T058, rà soát T062 F8).
 */
export function setOwn(out: Record<string, unknown>, k: string, v: unknown): void {
  Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
}
