// Feature 041: lịch sử alarm GIẢ cho xem trước (Studio Mô phỏng): dựng các lần xảy ra từ snapshot hiện tại của nguồn alarm,
// trả như `GET /api/v1/alarms/history` (lọc from/to, area, priority tối thiểu, q, limit; không phân trang). Không gọi mạng.
import { PRIORITY_RANK, foldVi } from '../alarm-format.ts';
import type { AlarmPriority, AlarmSource } from '../../host/types.ts';
import type { HistoryItem } from './csv.ts';

export function previewHistoryFetch(source: AlarmSource): (url: string) => Promise<Response> {
  return (url: string) => {
    const q = new URL(url, 'http://preview.invalid').searchParams;
    const from = Number(q.get('from') ?? 0);
    const to = Number(q.get('to') ?? Number.MAX_SAFE_INTEGER);
    const area = q.get('area');
    const prio = q.get('priority') as AlarmPriority | null;
    const text = q.get('q') ? foldVi(q.get('q')!) : null;
    const limit = Number(q.get('limit') ?? 100);
    const items: HistoryItem[] = source
      .snapshot()
      .instances.filter((i) => i.occurrence > 0 && i.tsActive >= from && i.tsActive <= to)
      .filter((i) => !area || (i.area ?? '-') === area)
      .filter((i) => !prio || PRIORITY_RANK[i.priority] >= PRIORITY_RANK[prio])
      .filter((i) => !text || foldVi(`${i.text} ${i.name}`).includes(text))
      .sort((a, b) => b.tsActive - a.tsActive)
      .slice(0, limit)
      .map((i, k) => ({
        id: k + 1,
        alarmId: i.alarmId,
        name: i.name,
        class: i.class,
        priority: i.priority,
        area: i.area,
        text: i.text,
        valueActive: i.valueActive,
        qualityActive: i.qualityActive,
        reason: i.reason ?? null,
        tsActive: i.tsActive,
        clockOk: i.clockOk,
        tsAck: i.tsAck ?? null,
        ackUser: i.ackUser ?? null,
        tsReturn: i.tsReturn ?? null,
        tsReturnAck: null,
        returnAckUser: null,
        flags: { startup: i.startup, inputBad: i.inputBad },
        closedBy: i.state === 'NORMAL' ? 'return' : null,
        state: i.state === 'NORMAL' ? 'closed' : 'active',
      }));
    return Promise.resolve(
      new Response(JSON.stringify({ items, hasMore: false, nextBeforeId: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
}
