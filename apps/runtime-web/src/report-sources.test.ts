// Feature 015: nguồn alarm/logic của báo cáo: đọc theo trang tới trần, mã lỗi của API, runtime chưa có đường đọc.
import { describe, expect, it } from 'vitest';
import { fetchEventSources } from './report-sources.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('fetchEventSources', () => {
  it('alarm: phân trang beforeId, dừng ở trần và báo cắt', async () => {
    const urls: string[] = [];
    const src = fetchEventSources(async (u) => {
      urls.push(String(u));
      const page = urls.length;
      return json(200, {
        items: Array.from({ length: 500 }, (_, i) => ({ alarmId: `a${page}-${i}` })),
        hasMore: true,
        nextBeforeId: 1000 - page,
      });
    });
    const r = await src.alarms(1, 2, 1200, new AbortController().signal);
    expect(r.items).toHaveLength(1200);
    expect(r.truncated).toBe(true);
    expect(urls[0]).toBe('/api/v1/alarms/history?from=1&to=2&limit=500');
    expect(urls[1]).toContain('beforeId=999');
  });

  it('logic: next null là hết; enabled false; 404 → NOT_SUPPORTED; 403 → mã của API', async () => {
    const one = fetchEventSources(async () =>
      json(200, { enabled: true, events: [{ id: 1 }], next: null }),
    );
    expect(await one.logic(1, 2, 10, new AbortController().signal)).toEqual({
      events: [{ id: 1 }],
      truncated: false,
      enabled: true,
    });
    const off = fetchEventSources(async () => json(200, { enabled: false, events: [] }));
    expect((await off.logic(1, 2, 10, new AbortController().signal)).enabled).toBe(false);
    const old = fetchEventSources(async () => json(404, { error: 'NOT_FOUND' }));
    await expect(old.logic(1, 2, 10, new AbortController().signal)).rejects.toMatchObject({
      code: 'NOT_SUPPORTED',
    });
    const denied = fetchEventSources(async () => json(403, { error: 'ACCESS_DENIED' }));
    await expect(denied.alarms(1, 2, 10, new AbortController().signal)).rejects.toMatchObject({
      code: 'ACCESS_DENIED',
    });
  });
});
