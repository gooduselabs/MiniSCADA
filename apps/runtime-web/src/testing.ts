// Hàm dùng chung cho test của trang vận hành (không vào bản build: chỉ file *.test.ts import).
export interface FakeCall {
  method: string;
  url: string;
  /** Tên header viết thường. */
  headers: Record<string, string>;
  body: unknown;
  credentials: RequestCredentials | undefined;
}

export interface FakeReply {
  status?: number;
  json?: unknown;
  text?: string;
}
export type FakeHandler =
  FakeReply | Error | ((call: FakeCall) => FakeReply | Error | Promise<FakeReply | Error>);

/**
 * `fetch` giả: tuyến `"METHOD /đường/dẫn"` → trả lời, hàm, hoặc mảng (lần gọi thứ n dùng phần tử n, phần tử cuối lặp lại).
 * Không có tuyến → 404. `Error` → fetch bị từ chối (lỗi mạng).
 */
export function fakeFetch(routes: Record<string, FakeHandler | FakeHandler[]> = {}) {
  const calls: FakeCall[] = [];
  const counters = new Map<string, number>();
  const table = new Map(Object.entries(routes));
  const fn = (async (input: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    let body: unknown = init.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* giữ chuỗi */
      }
    }
    const call: FakeCall = {
      method,
      url: String(input),
      headers,
      body,
      credentials: init.credentials,
    };
    calls.push(call);
    const key = `${method} ${call.url}`;
    let h = table.get(key);
    if (Array.isArray(h)) {
      const n = counters.get(key) ?? 0;
      counters.set(key, n + 1);
      h = h[Math.min(n, h.length - 1)];
    }
    if (typeof h === 'function') h = await h(call);
    if (!h) h = { status: 404 };
    if (h instanceof Error) throw h;
    const status = h.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (h.json === undefined) throw new Error('không phải JSON');
        return h.json;
      },
      text: async () => h.text ?? '',
    };
  }) as unknown as typeof fetch;
  return {
    fn,
    calls,
    set(key: string, h: FakeHandler | FakeHandler[]) {
      table.set(key, h);
      counters.delete(key);
    },
    count: (method: string, url: string) =>
      calls.filter((c) => c.method === method && c.url === url).length,
  };
}
