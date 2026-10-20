// Nguồn của báo cáo alarm và logic (feature 015, FR-008, FR-010): đọc theo trang `GET /api/v1/alarms/history`
// (`beforeId`, 500 lần mỗi trang) và `GET /api/v1/logic/events` (`before`, 200 bản ghi mỗi trang) tới trần của báo cáo,
// cookie của trang (cùng nguồn gốc). Lỗi trả mã của API (`ACCESS_DENIED`, `AUTH_REQUIRED`…), `NOT_SUPPORTED` khi
// runtime chưa có đường đọc (404, 501), `NETWORK` khi mất kết nối.
import type { AlarmOccurrence, LogicEvent } from '@mat/history-math';

export interface EventSources {
  alarms(
    from: number,
    to: number,
    max: number,
    signal: AbortSignal,
  ): Promise<{ items: AlarmOccurrence[]; truncated: boolean }>;
  logic(
    from: number,
    to: number,
    max: number,
    signal: AbortSignal,
  ): Promise<{ events: LogicEvent[]; truncated: boolean; enabled: boolean }>;
}

export class EventSourceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'EventSourceError';
    this.code = code;
  }
}

const ALARM_PAGE = 500;
const LOGIC_PAGE = 200;

async function getJson(
  f: typeof fetch,
  url: string,
  signal: AbortSignal,
  missing: boolean,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(url, { cache: 'no-store', signal });
  } catch (e) {
    if ((e as { name?: string }).name === 'AbortError') throw e;
    throw new EventSourceError('NETWORK');
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    if (missing && (res.status === 404 || res.status === 501))
      throw new EventSourceError('NOT_SUPPORTED');
    if (res.status === 401) throw new EventSourceError('AUTH_REQUIRED');
    throw new EventSourceError(
      body && typeof body.error === 'string' ? body.error : `HTTP_${res.status}`,
    );
  }
  if (!body) throw new EventSourceError('BAD_RESPONSE');
  return body;
}

export function fetchEventSources(f: typeof fetch = (...a) => fetch(...a)): EventSources {
  return {
    async alarms(from, to, max, signal) {
      const items: AlarmOccurrence[] = [];
      let before: number | null = null;
      for (;;) {
        const q = new URLSearchParams({
          from: String(from),
          to: String(to),
          limit: String(ALARM_PAGE),
        });
        if (before !== null) q.set('beforeId', String(before));
        const b = await getJson(f, `/api/v1/alarms/history?${q}`, signal, true);
        if (!Array.isArray(b.items)) throw new EventSourceError('BAD_RESPONSE');
        items.push(...(b.items as AlarmOccurrence[]));
        if (items.length >= max) return { items: items.slice(0, max), truncated: true };
        before = b.hasMore === true && typeof b.nextBeforeId === 'number' ? b.nextBeforeId : null;
        if (before === null) return { items, truncated: false };
      }
    },
    async logic(from, to, max, signal) {
      const events: LogicEvent[] = [];
      let before: number | null = null;
      for (;;) {
        const q = new URLSearchParams({
          from: String(from),
          to: String(to),
          limit: String(LOGIC_PAGE),
        });
        if (before !== null) q.set('before', String(before));
        const b = await getJson(f, `/api/v1/logic/events?${q}`, signal, true);
        if (b.enabled === false) return { events: [], truncated: false, enabled: false };
        if (!Array.isArray(b.events)) throw new EventSourceError('BAD_RESPONSE');
        events.push(...(b.events as LogicEvent[]));
        if (events.length >= max)
          return { events: events.slice(0, max), truncated: true, enabled: true };
        before = typeof b.next === 'number' ? b.next : null;
        if (before === null) return { events, truncated: false, enabled: true };
      }
    },
  };
}
