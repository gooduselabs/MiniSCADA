// Cổng serial mà project được dùng trên một thiết bị (feature 006 T166; research R13): theo
// `serialPorts` trong cấu hình thiết bị, trừ cổng console của hệ thống. Luật `E_SERIAL_NOT_ALLOWED`
// chỉ có ở runtime (phụ thuộc thiết bị), nên không nằm trong vector chung: validator chỉ chạy nó
// khi được đưa một `SerialPolicy` (Studio khi Online, từ danh sách cổng của thiết bị). Bản C++:
// core/common/serial_match.hpp.

export interface SerialPolicy {
  /** `serialPorts` của thiết bị: tên `tty…` (có thể kết thúc bằng `*`) hoặc đường dẫn `/dev/serial/…` đúng tên. */
  allowPatterns: readonly string[];
  /** true: cổng là console của hệ thống (hoặc có getty); không bao giờ được phép. */
  isConsole?: (port: string) => boolean;
}

/** Mẫu `serialPorts` so với cổng như project gọi: tên tty hoặc đường dẫn `/dev/serial/by-id|by-path/…`. */
export function serialPatternMatches(pattern: string, port: string): boolean {
  if (!pattern || !port) return false;
  const patternPath = pattern.startsWith('/');
  const portPath = port.startsWith('/');
  if (patternPath !== portPath) return false;
  if (patternPath) return pattern === port;
  if (pattern.endsWith('*')) return port.startsWith(pattern.slice(0, -1));
  return pattern === port;
}

/** Cổng có trong danh sách và không phải console. */
export function serialPortAllowed(policy: SerialPolicy, port: string): boolean {
  if (policy.isConsole?.(port)) return false;
  return policy.allowPatterns.some((p) => serialPatternMatches(p, port));
}
