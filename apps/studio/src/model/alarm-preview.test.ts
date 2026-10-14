// Nguồn alarm cho xem trước màn hình của Studio (T107, FR-081): Mô phỏng cấp AlarmSource từ AlarmSim và ack thử; Thiết bị chỉ đọc
// (ba hàm của ActionHost trả READ_ONLY); alarm có lỗi bị bỏ qua khi xem trước.
import { describe, expect, it } from 'vitest';
import { DeviceActionHost, SimActionHost } from './preview-hosts.ts';
import { createAlarmPreview, invalidAlarmIds } from './alarm-preview.ts';
import { full05WithAlarms } from './alarm-fixtures.ts';
import { alarmDocOf } from './alarm-doc.ts';
import { filesOf, loadDoc, outlineOf, type ProjectDocs } from './project-doc.ts';

async function outline(mutate?: (a: { alarms: Array<Record<string, unknown>> }) => void) {
  const files = await full05WithAlarms();
  if (mutate) {
    const a = JSON.parse(files['alarms.json']!) as { alarms: Array<Record<string, unknown>> };
    mutate(a);
    files['alarms.json'] = JSON.stringify(a);
  }
  const docs: Record<string, ReturnType<typeof loadDoc>> = {};
  for (const [rel, text] of Object.entries(files)) docs[rel] = loadDoc(rel, text, null, false);
  return outlineOf(filesOf(docs as ProjectDocs));
}

const fakeTimers = () => {
  const fns: Array<() => void> = [];
  return {
    timers: {
      setInterval: (fn: () => void) => {
        fns.push(fn);
        return fns.length - 1;
      },
      clearInterval: (h: unknown) => void (fns[h as number] = () => undefined),
    },
    tick: (n = 1) => {
      for (let i = 0; i < n; i++) fns.forEach((f) => f());
    },
  };
};

describe('createAlarmPreview (chế độ Mô phỏng)', () => {
  it('cấp AlarmSource sống chạy theo đồng hồ ảo; chạy đủ lâu thì alarm số do mô phỏng bật', async () => {
    const o = await outline();
    const ft = fakeTimers();
    const p = createAlarmPreview(o, [], [], ft.timers)!;
    expect(p).not.toBeNull();
    expect(p.source.status()).toBe('live');
    expect(p.source.snapshot().instances.map((i) => i.id)).toEqual(['PUMP01_FAULT']);
    ft.tick(80);
    expect(p.sim.virtualNowMs).toBeGreaterThan(10_000);
    p.stop();
    const at = p.sim.virtualNowMs;
    ft.tick(10);
    expect(p.sim.virtualNowMs).toBe(at);
  });

  it('ackAlarms thử đi qua AlarmSim, không gọi thiết bị; SimActionHost nhận ba hàm alarm', async () => {
    const o = await outline();
    const ft = fakeTimers();
    const p = createAlarmPreview(o, [], [], ft.timers)!;
    p.sim.setManual('PUMP01.FAULT', { value: 1, quality: 'GOOD' });
    p.sim.run(20);
    const inst = p.source.snapshot().instances.find((i) => i.id === 'PUMP01_FAULT')!;
    expect(inst.state).toBe('ACTIVE_UNACK');
    const host = new SimActionHost({
      engine: {} as never,
      source: {} as never,
      nav: {} as never,
      user: 'thử',
      alarms: p.actions,
    });
    const out = await host.ackAlarms({ items: [{ id: inst.id, occurrence: inst.occurrence }] });
    expect(out.ok).toBe(true);
    expect(out.acked).toBe(1);
    expect(p.source.snapshot().instances.find((i) => i.id === 'PUMP01_FAULT')?.state).toBe(
      'ACTIVE_ACK',
    );
    // Không có AlarmSim: READ_ONLY.
    const none = new SimActionHost({
      engine: {} as never,
      source: {} as never,
      nav: {} as never,
      user: 'x',
    });
    expect((await none.ackAlarms({ items: [] })).error?.code).toBe('READ_ONLY');
    expect((await none.unshelveAlarm('x')).ok).toBe(false);
  });

  it('project không có alarm: không có nguồn (widget báo "Không có dữ liệu alarm")', async () => {
    const o = await outline((a) => (a.alarms = []));
    expect(createAlarmPreview(o, [], [])).toBeNull();
  });

  it('alarm có lỗi bị bỏ qua, phần hợp lệ vẫn chạy', async () => {
    const o = await outline();
    const doc = alarmDocOf({ alarms: o.alarms, alarmClasses: o.alarmClasses });
    const issues = [
      {
        code: 'E_ALARM_TAG_REF' as const,
        file: 'alarms.json',
        path: '/alarms/1/tag',
        message: 'x',
      },
    ];
    expect(invalidAlarmIds(issues, 'alarms.json', doc)).toEqual([
      { id: 'PUMP01_FAULT', code: 'E_ALARM_TAG_REF', row: 1 },
    ]);
    const p = createAlarmPreview(o, issues, [], fakeTimers().timers)!;
    expect(p.source.snapshot().instances.some((i) => i.id === 'PUMP01_FAULT')).toBe(false);
    p.sim.setManual('TANK01.LEVEL', { value: 95, quality: 'GOOD' });
    p.sim.run(20);
    expect(p.source.snapshot().instances.some((i) => i.id === 'TANK01_LEVEL.HH')).toBe(true);
  });
});

describe('DeviceActionHost: chỉ đọc', () => {
  it('ba hàm alarm trả READ_ONLY', async () => {
    const host = new DeviceActionHost({} as never);
    expect((await host.ackAlarms()).error?.code).toBe('READ_ONLY');
    expect((await host.shelveAlarm()).error?.code).toBe('READ_ONLY');
    expect((await host.unshelveAlarm()).error?.code).toBe('READ_ONLY');
  });
});
