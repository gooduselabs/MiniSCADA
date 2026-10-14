// @vitest-environment jsdom
// Hộp thoại Nâng cấp 0.3 → 0.5.0 (feature 009, T071, T081, FR-012, FR-013, FR-014; US2 kịch bản 1, 9): hộp thoại nói đổi gì (chỉ
// schemaVersion và runtime tối thiểu 0.8.0), nơi sao lưu, Nâng cấp, Mở chỉ đọc, Hủy; sao lưu trước lần lưu đầu; project 0.5 mở thẳng;
// Nạp xuống bị khóa khi còn lỗi E_ALARM_*; cột Tương thích runtime thêm điều kiện alarm (≥ 0.8.0).
import { afterEach, describe, expect, it } from 'vitest';
import { full05WithAlarms } from '../../model/alarm-fixtures.ts';
import { dashboardDemo } from '../../model/test-fixtures.ts';
import { createMockPlatform } from '../../platform/mock.ts';
import { StudioApp } from '../../app/app.ts';
import { createDownloadEnv } from '../../app/download-env.ts';
import { FakeSession } from '../fake-session.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import { textOf } from '../online-test-helpers.ts';
import './upgrade-dialog.ts';
import type { MatUpgradeDialog } from './upgrade-dialog.ts';

async function setup(files: Record<string, string>) {
  const platform = createMockPlatform();
  platform.control.useProject(files);
  const app = new StudioApp({ platform, storage: null, windowWidth: 1400 });
  await app.start();
  const el = await mount<MatUpgradeDialog>('mat-upgrade-dialog', app);
  await app.run('project.open');
  await app.store.idle();
  await new Promise((r) => setTimeout(r, 20));
  await settled();
  return { app, platform, el };
}

const dlg = () => document.querySelector('mat-upgrade-dialog [role="dialog"]');
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('mat-upgrade-dialog button')].find((b) =>
    b.textContent?.includes(label),
  );

afterEach(cleanup);

describe('nâng cấp lên 0.5.0 (FR-012)', () => {
  it('mở project 0.3: hộp thoại nói đổi gì, nơi sao lưu, ba nút; chưa ghi gì', async () => {
    const { app, platform } = await setup(dashboardDemo());
    expect(app.ui.dialog?.kind).toBe('upgrade');
    const text = textOf(dlg());
    expect(text).toContain('0.3.0');
    expect(text).toContain('0.5.0');
    expect(text).toContain('0.8.0');
    expect(text).toContain('.mat-backup/0.3.0-');
    for (const label of ['Nâng cấp', 'Mở chỉ đọc', 'Hủy'])
      expect(button(label), label).toBeDefined();
    expect(platform.control.writes).toEqual([]);
    expect(app.store.dirtyFiles()).toEqual([]);
  });

  it('Nâng cấp: chỉ đổi schemaVersion và runtime tối thiểu; không tạo tệp alarm; sao lưu trước lần lưu đầu; nội dung giữ nguyên', async () => {
    const files = dashboardDemo();
    const { app, platform } = await setup(files);
    button('Nâng cấp')!.click();
    await new Promise((r) => setTimeout(r, 20));
    await settled();
    const s = app.store.state;
    expect(app.ui.dialog).toBeNull();
    expect(s.outline.v05).toBe(true);
    const pj = s.docs['project.json']!.value as Record<string, unknown>;
    expect(pj.schemaVersion).toBe('0.5.0');
    expect(pj.minRuntimeVersion).toBe('0.8.0');
    expect(pj.alarmFile).toBeUndefined();
    expect(Object.keys(s.docs).some((r) => r.startsWith('alarm'))).toBe(false);
    // Tag giữ nguyên ngoài schemaVersion.
    const before = JSON.parse(files['tags.json']!) as { tags: unknown[] };
    const after = s.docs['tags.json']!.value as { schemaVersion: string; tags: unknown[] };
    expect(after.tags).toEqual(before.tags);
    expect(after.schemaVersion).toBe('0.5.0');
    expect(platform.control.writes).toEqual([]);
    await app.save();
    expect(platform.control.backups).toHaveLength(1);
    expect(app.ui.toast?.text).toContain('.mat-backup/0.3.0-');
    expect(s.upgrade?.from).toBe('0.3.0');
  });

  it('Mở chỉ đọc: mục Alarm hiện nhưng mọi sửa khóa; Hủy đóng project', async () => {
    const a = await setup(dashboardDemo());
    button('Mở chỉ đọc')!.click();
    await settled();
    expect(a.app.store.state.readOnly).toBe(true);
    expect(a.app.enabled('alarm.upgrade')).toBe('reason.readOnly');
    cleanup();
    const b = await setup(dashboardDemo());
    button('Hủy')!.click();
    await settled();
    expect(b.app.store.state.project).toBeNull();
  });

  it('project 0.5 mở thẳng, không hỏi', async () => {
    const { app } = await setup(await full05WithAlarms());
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.pendingUpgrade).toBe(false);
    expect(app.store.state.outline.alarms?.alarms).toHaveLength(3);
  });
});

describe('Nạp xuống và alarm (FR-013, FR-014)', () => {
  it('còn lỗi E_ALARM_* thì Nạp xuống khóa kèm lý do "Project còn lỗi"', async () => {
    const files = await full05WithAlarms();
    const a = JSON.parse(files['alarms.json']!) as { alarms: Array<Record<string, unknown>> };
    a.alarms[0]!.limits = {
      H: { value: 95, class: 'minor' },
      HH: { value: 90, class: 'critical' },
    };
    files['alarms.json'] = JSON.stringify(a);
    const { app } = await setup(files);
    await app.store.validateNow();
    expect(app.store.state.issues.some((i) => i.code === 'E_ALARM_LIMIT_ORDER')).toBe(true);
    expect(app.commandContext().errorCount).toBeGreaterThan(0);
    expect(app.enabled('online.download')).toBe('reason.projectErrors');
  });

  it('project có alarm: runtime tối thiểu hiệu lực là 0.8.0 dù minRuntimeVersion ghi thấp hơn', async () => {
    const files = await full05WithAlarms();
    const pj = JSON.parse(files['project.json']!) as Record<string, unknown>;
    pj.minRuntimeVersion = '0.6.0';
    files['project.json'] = JSON.stringify(pj, null, 2) + '\n';
    const { app } = await setup(files);
    const env = createDownloadEnv({
      store: app.store,
      link: {} as never,
      session: new FakeSession(),
      save: async () => true,
    });
    expect(env.project.identity()?.minRuntimeVersion).toBe('0.8.0');
  });
});
