// Hộp thoại "Tạo alarm cho Tag…", Nhập CSV alarm, nâng cấp 0.5, lệnh alarm (T070, T077, T081, T084, T085; FR-075, FR-012, FR-086):
// gợi ý ngưỡng 80/90 cho Tag 0 đến 100, một bước hoàn tác, khóa vượt 500 instance, nhập CSV có lỗi theo dòng, nâng cấp từ 0.3
// (không tạo tệp alarm rỗng, runtime tối thiểu 0.8.0), điều kiện bật của lệnh và phím chỉ khi có focus.
import { afterEach, describe, expect, it } from 'vitest';
import { COMMANDS } from '../../app/commands.ts';
import type { StudioApp } from '../../app/app.ts';
import { full05, full05WithAlarms } from '../../model/alarm-fixtures.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './alarm-grid.ts';
import './alarm-quick-create.ts';
import './alarm-csv-dialog.ts';
import type { MatAlarmQuickDialog } from './alarm-quick-create.ts';
import type { MatAlarmCsvDialog } from './alarm-csv-dialog.ts';

afterEach(cleanup);

interface Rec {
  id: string;
  type: string;
  tag: string;
  deadband?: number;
  onDelayMs?: number;
  offDelayMs?: number;
  limits?: Record<string, { value: number; class: string }>;
  class?: string;
}
const alarms = (app: StudioApp) =>
  (app.store.state.outline.alarms?.alarms ?? []) as unknown as Rec[];
const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function openQuick(files: Record<string, string>, tags: string[]) {
  const env = await newApp02({ files });
  const el = await mount<MatAlarmQuickDialog>('mat-alarm-quick-dialog', env.app);
  env.app.openAlarmQuick(tags);
  await settled();
  return { ...env, el };
}
const input = (el: Element, sel: string) => el.querySelector<HTMLInputElement>(sel)!;
async function type(el: Element, sel: string, value: string) {
  const i = input(el, sel);
  i.value = value;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await settled();
}

describe('mat-alarm-quick-dialog (FR-075)', () => {
  it('Tag 0 đến 100: gợi ý H = 80, HH = 90, lớp gợi ý; xem trước một dòng với nội dung mặc định đã chèn mẫu', async () => {
    const { el } = await openQuick(await full05(), ['TANK01.LEVEL']);
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(input(el, '[data-th-value="H"]').placeholder).toBe('80');
    expect(input(el, '[data-th-value="HH"]').placeholder).toBe('90');
    expect(input(el, '[data-th-on="L"]').checked).toBe(false);
    const row = el.querySelector('[data-row="TANK01_LEVEL"]')!;
    expect(text(row)).toContain('HH 90 · H 80');
    expect(text(row)).toContain('Khẩn cấp · Nhỏ');
    expect(text(row)).toContain('cao');
  });

  it('Tạo: thêm alarm và bốn lớp mặc định trong MỘT bước hoàn tác, mở lưới ở dòng mới', async () => {
    const { app, el } = await openQuick(await full05(), ['TANK01.LEVEL']);
    el.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(alarms(app)).toHaveLength(1);
    expect(alarms(app)[0]).toMatchObject({
      id: 'TANK01_LEVEL',
      type: 'limit',
      tag: 'TANK01.LEVEL',
      deadband: 2,
      onDelayMs: 3000,
      limits: { H: { value: 80, class: 'minor' }, HH: { value: 90, class: 'critical' } },
    });
    expect(app.store.state.outline.alarmClasses?.classes).toHaveLength(4);
    expect(app.store.state.active).toBe('alarms');
    await app.run('edit.undo');
    expect(app.store.state.outline.alarms).toBeNull();
  });

  it('giá trị gõ tay thắng gợi ý; Tag BOOL: loại Ngưỡng bị khóa kèm lý do; quality có hậu tố _COMM', async () => {
    const { app, el } = await openQuick(await full05WithAlarms(), ['TANK01.LEVEL']);
    await type(el, '[data-th-value="H"]', '75');
    expect(text(el.querySelector('[data-row="TANK01_LEVEL_2"]'))).toContain('H 75');
    el.querySelector<HTMLButtonElement>('[data-act="create"]')!.click();
    await settled();
    expect(alarms(app).some((a) => a.id === 'TANK01_LEVEL_2')).toBe(true);
    // Tag BOOL
    app.openAlarmQuick(['PUMP01.RUN_CMD']);
    await settled();
    const limitBtn = el.querySelector<HTMLButtonElement>('[data-kind="limit"]')!;
    expect(limitBtn.getAttribute('aria-disabled')).toBe('true');
    expect(limitBtn.title).toContain('Tag số');
    el.querySelector<HTMLButtonElement>('[data-kind="quality"]')!.click();
    await settled();
    expect(el.querySelector('[data-row="PUMP01_RUN_CMD_COMM"]')).not.toBeNull();
  });

  it('chưa chọn Tag: nút Tạo khóa kèm lý do; Esc đóng', async () => {
    const { app, el } = await openQuick(await full05(), []);
    expect(el.querySelector<HTMLButtonElement>('[data-act="create"]')!.disabled).toBe(true);
    expect(text(el.querySelector('[data-role="blocked"]'))).toContain('Chọn một Tag');
    el.querySelector('.overlay')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await settled();
    expect(app.ui.dialog).toBeNull();
  });
});

describe('mat-alarm-csv-dialog (FR-074)', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  async function openCsv(csv: string) {
    const env = await newApp02({ files: await full05WithAlarms() });
    env.platform.control.csvOpenResult = { name: 'alarms.csv', bytes: bytes(csv) };
    const el = await mount<MatAlarmCsvDialog>('mat-alarm-csv-dialog', env.app);
    env.app.openEditor('alarms');
    await env.app.run('alarm.import');
    await settled();
    await new Promise((r) => setTimeout(r, 20));
    await settled();
    return { ...env, el };
  }

  it('đọc tệp, báo lỗi theo dòng, Nhập thêm vào theo id trong MỘT bước hoàn tác', async () => {
    const csv =
      'id,name,type,tag,class\nNEW1,Mới 1,digital,PUMP01.FAULT,major\nBAD,Lạ,wat,PUMP01.FAULT,major\nTANK01_LEVEL,Trùng,digital,PUMP01.FAULT,minor\n';
    const { app, el } = await openCsv(csv);
    expect(text(el.querySelector('[data-role="summary"]'))).toContain('2 dòng hợp lệ, 1 dòng lỗi');
    expect(text(el.querySelector('[data-role="issues"]'))).toContain('Dòng 3');
    el.querySelector<HTMLButtonElement>('[data-act="import"]')!.click();
    await settled();
    expect(alarms(app).map((a) => a.id)).toEqual([
      'TANK01_LEVEL',
      'PUMP01_FAULT',
      'METER1_COMM',
      'NEW1',
    ]);
    await app.run('edit.undo');
    expect(alarms(app)).toHaveLength(3);
  });

  it('Thay thế tất cả; thiếu cột id là lỗi chung và khóa nút Nhập', async () => {
    const { app, el } = await openCsv(
      'id,name,type,tag,class\nONLY,Một,digital,PUMP01.FAULT,major\n',
    );
    el.querySelector<HTMLInputElement>('[data-mode="replace"]')!.click();
    el.querySelector<HTMLInputElement>('[data-mode="replace"]')!.dispatchEvent(
      new Event('change', { bubbles: true }),
    );
    await settled();
    el.querySelector<HTMLButtonElement>('[data-act="import"]')!.click();
    await settled();
    expect(alarms(app).map((a) => a.id)).toEqual(['ONLY']);
    const bad = await openCsv('name,type\nx,y\n');
    expect(text(bad.el.querySelector('[data-role="summary"]'))).toContain('Thiếu cột id');
    expect(bad.el.querySelector<HTMLButtonElement>('[data-act="import"]')!.disabled).toBe(true);
  });
});

describe('nâng cấp lên 0.5 và lệnh alarm', () => {
  it('lệnh alarm.upgrade: chỉ đổi schemaVersion và runtime tối thiểu; không tạo tệp alarm rỗng; mục Alarm mở khóa', async () => {
    const env = await newApp02();
    expect(env.app.store.state.outline.v05).toBe(false);
    await env.app.run('alarm.upgrade');
    await env.app.store.idle();
    const s = env.app.store.state;
    expect(s.outline.v05).toBe(true);
    expect((s.docs['project.json']?.value as { minRuntimeVersion: string }).minRuntimeVersion).toBe(
      '0.8.0',
    );
    expect(Object.keys(s.docs).filter((r) => /alarm/.test(r))).toEqual([]);
    expect(env.app.enabled('alarm.open')).toBe(true);
    expect(env.app.enabled('alarm.upgrade')).toBe('reason.already05');
  });

  it('điều kiện bật: project 0.3 khóa lệnh alarm; Thử alarm cần ít nhất một alarm; phím của lưới chỉ khi lưới mở', async () => {
    const old = await newApp02();
    expect(old.app.enabled('alarm.quickCreate')).toBe('reason.needVersion05');
    expect(old.app.enabled('alarm.test.open')).toBe('reason.needVersion05');
    const empty = await newApp02({ files: await full05() });
    expect(empty.app.enabled('alarm.quickCreate')).toBe(true);
    expect(empty.app.enabled('alarm.test.open')).toBe('reason.noAlarmsValid');
    expect(empty.app.enabled('alarm.fillDown')).toBe('reason.alarmNotActive');
    const full = await newApp02({ files: await full05WithAlarms() });
    expect(full.app.enabled('alarm.test.open')).toBe(true);
    expect(full.app.enabled('alarm.test.run')).toBe('reason.alarmTestClosed');
    for (const c of COMMANDS.filter((x) => x.id.startsWith('alarm.')))
      expect(c.canvasKey === undefined || c.menu === null).toBe(true);
  });
});
