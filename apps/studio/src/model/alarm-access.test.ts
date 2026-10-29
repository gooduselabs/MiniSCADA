// Feature 040: lối vào alarm trên web. Mô hình (cảnh báo W_ALARM_NO_ACCESS, menu có mục Alarm và chuông), sửa nhanh ở
// Studio, tự thêm mục Alarm khi thêm alarm đầu tiên (cùng một bước hoàn tác).
import type { AlarmsFile, Navigation } from '@mat/project-schema';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newHistoryApp } from '../ui/history-test-helpers.ts';
import { alarmAccessIssue, hasAlarmAccess, withAlarmAccess } from './alarm-access.ts';
import { usesSystem } from './navigation-doc.ts';
import { readProjectDir, REPO } from './test-fixtures.ts';

const nav0 = (): Navigation => ({
  position: 'left',
  items: [
    { label: 'Tổng quan', screen: 'tong-quan' },
    { label: 'Alarm', screen: 'man-hinh-1' },
  ],
});

describe('mô hình', () => {
  it('chuông mặc định bật là đủ lối vào; tắt chuông và không có mục Alarm thì cảnh báo', () => {
    expect(hasAlarmAccess(nav0())).toBe(true);
    expect(alarmAccessIssue('1.1.0', nav0(), 1)).toBeNull();
    const off = { ...nav0(), alarmBell: false };
    expect(alarmAccessIssue('1.1.0', off, 0)).toBeNull();
    expect(alarmAccessIssue('1.0.0', off, 3)).toBeNull();
    expect(alarmAccessIssue('1.1.0', off, 1)?.code).toBe('W_ALARM_NO_ACCESS');
    const withPage = { ...off, items: [...off.items, { label: 'A', system: 'alarms' as const }] };
    expect(alarmAccessIssue('1.1.0', withPage, 1)).toBeNull();
  });

  it('withAlarmAccess thêm mục Alarm cuối menu và bật chuông; đã đủ thì null; project cũ thì null', () => {
    const next = withAlarmAccess({ ...nav0(), alarmBell: false }, '1.1.0', 'Alarm')!;
    expect('alarmBell' in next).toBe(false);
    expect(next.items.at(-1)).toEqual({ label: 'Alarm', system: 'alarms', icon: 'bell' });
    expect(withAlarmAccess(next, '1.1.0', 'Alarm')).toBeNull();
    expect(withAlarmAccess(nav0(), '1.0.0', 'Alarm')).toBeNull();
  });
});

describe('Studio', () => {
  const alarms = (n: number): AlarmsFile =>
    ({
      schemaVersion: '1.1.0',
      alarms: Array.from({ length: n }, (_, i) => ({
        id: `A${i + 1}`,
        type: 'digital',
        name: `A${i + 1}`,
        tag: 'TANK01.RUN',
        class: 'minor',
        text: 'Thử',
      })),
    }) as unknown as AlarmsFile;

  async function open() {
    const files = readProjectDir(resolve(REPO, 'projects/grid-demo'));
    const { app } = await newHistoryApp({ files });
    const toasts: string[] = [];
    app.toast = ((m: string) => toasts.push(m)) as typeof app.toast;
    return { app, toasts };
  }
  const nav = (app: Awaited<ReturnType<typeof open>>['app']) => app.store.state.outline.navigation!;

  it('alarm đầu tiên: cùng bước hoàn tác thêm mục Alarm vào menu, có thông báo; Ctrl+Z bỏ cả hai', async () => {
    const { app, toasts } = await open();
    expect(usesSystem(nav(app), 'alarms')).toBe(false);
    app.store.edit([{ kind: 'alarmsSet', doc: alarms(1) }]);
    expect(usesSystem(nav(app), 'alarms')).toBe(true);
    expect(toasts.join(' ')).toContain('Ctrl+Z');
    // alarm thứ hai: không đụng menu nữa
    const before = JSON.stringify(nav(app));
    app.store.edit([{ kind: 'alarmsSet', doc: alarms(2) }]);
    expect(JSON.stringify(nav(app))).toBe(before);
    app.store.undo();
    app.store.undo();
    expect(app.store.state.outline.alarms?.alarms.length ?? 0).toBe(0);
    expect(usesSystem(nav(app), 'alarms')).toBe(false);
  });

  it('W_ALARM_NO_ACCESS khi tắt chuông và bỏ mục Alarm; sửa nhanh thêm lại cả hai', async () => {
    const { app } = await open();
    app.store.edit([{ kind: 'alarmsSet', doc: alarms(1) }]);
    const n = nav(app);
    app.store.edit([
      {
        kind: 'navigation',
        value: { ...n, alarmBell: false, items: n.items.filter((i) => i.system !== 'alarms') },
      },
    ]);
    await app.run('tools.validate');
    expect(app.store.state.issues.some((i) => i.code === 'W_ALARM_NO_ACCESS')).toBe(true);
    expect(app.fixAlarmAccess()).toBe(true);
    expect(nav(app).alarmBell).toBeUndefined();
    expect(usesSystem(nav(app), 'alarms')).toBe(true);
    await app.run('tools.validate');
    expect(app.store.state.issues.some((i) => i.code === 'W_ALARM_NO_ACCESS')).toBe(false);
  });
});
