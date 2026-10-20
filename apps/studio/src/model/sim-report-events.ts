// Sự kiện mô phỏng cho xem trước báo cáo alarm và logic trong Studio (feature 015, FR-007): tất định theo thời gian (cùng
// kỳ cho cùng bảng), sinh từ alarm của alarms.json (tên, khu, mức của lớp alarm) và luật của logic.json (Tag được ghi).
// Cùng giao diện ReportEventSource với nguồn thật của trang vận hành, nên xem trước đi qua đúng runReport của trang.
import type { AlarmClassesFile, AlarmsFile, LogicDoc } from '@mat/project-schema';
import type { AlarmOccurrence, LogicEvent } from '@mat/history-math';
import type { ReportEventSource } from '@mat/ui-components';

const HOUR = 3_600_000;
const MIN = 60_000;

/** Băm nhỏ, tất định (xorshift trên chỉ số giờ). */
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 0xffffffff;
}

interface SimAlarm {
  alarmId: string;
  name: string;
  priority: string;
  area: string | null;
  text: string;
}

function alarmsOf(alarms: AlarmsFile | null, classes: AlarmClassesFile | null): SimAlarm[] {
  const prio = new Map((classes?.classes ?? []).map((c) => [c.id, c.priority as string]));
  const list = (alarms?.alarms ?? []).map((a): SimAlarm => {
    const cls =
      'class' in a && typeof a.class === 'string'
        ? a.class
        : 'limits' in a
          ? (Object.values(a.limits ?? {})[0]?.class ?? '')
          : '';
    return {
      alarmId: a.id,
      name: a.name,
      priority: prio.get(cls) ?? 'major',
      area: a.area ?? null,
      text: a.text ?? a.name,
    };
  });
  return list.length
    ? list
    : [
        { alarmId: 'muc_cao', name: 'Mức cao', priority: 'critical', area: null, text: 'Mức cao' },
        {
          alarmId: 'loi',
          name: 'Thiết bị lỗi',
          priority: 'major',
          area: null,
          text: 'Thiết bị lỗi',
        },
      ];
}

export function simReportEvents(o: {
  alarms: AlarmsFile | null;
  alarmClasses: AlarmClassesFile | null;
  logic: LogicDoc | null;
}): ReportEventSource {
  const alarms = alarmsOf(o.alarms, o.alarmClasses);
  const rules = (o.logic?.rules ?? []).map((r) => ({
    id: r.id,
    tag: [...(r.onRise ?? []), ...(r.onFall ?? [])].find((a) => a.tag)?.tag ?? null,
  }));
  return {
    async alarms(from, to, max) {
      const items: AlarmOccurrence[] = [];
      for (let h = Math.floor(from / HOUR); h * HOUR < to && items.length < max; h++) {
        const n = Math.floor(hash(h) * 4);
        for (let k = 0; k < n; k++) {
          const a = alarms[Math.floor(hash(h * 7 + k) * alarms.length)]!;
          const tsActive = h * HOUR + Math.floor(hash(h * 13 + k) * 50) * MIN;
          if (tsActive < from || tsActive >= to) continue;
          const ack = hash(h * 17 + k) < 0.8;
          items.push({
            ...a,
            tsActive,
            tsAck: ack ? tsActive + (1 + Math.floor(hash(h * 19 + k) * 9)) * MIN : null,
            tsReturn: hash(h * 23 + k) < 0.85 ? tsActive + 20 * MIN : null,
            ackUser: ack ? 'vanhanh1' : null,
          });
        }
      }
      return { items, truncated: false };
    },
    async logic(from, to, max) {
      if (rules.length === 0) return { events: [], truncated: false, enabled: false };
      const events: LogicEvent[] = [];
      let id = 1;
      for (let h = Math.floor(from / HOUR); h * HOUR < to && events.length < max; h++) {
        const ts = h * HOUR + 17 * MIN;
        if (ts < from || ts >= to || hash(h) < 0.35) continue;
        const r = rules[h % rules.length]!;
        const x = hash(h * 31);
        events.push({
          id: id++,
          ts,
          rule: r.id,
          action: x > 0.93 ? 'logic.write.suppressed' : 'logic.write',
          tag: r.tag,
          result: x > 0.93 ? 'denied' : x > 0.85 ? 'failed' : 'ok',
          code: null,
          detail: JSON.stringify({ value: h % 2 === 0 }),
        });
      }
      return { events, truncated: false, enabled: true };
    },
  };
}
