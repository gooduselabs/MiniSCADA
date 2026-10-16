// @vitest-environment jsdom
// Hộp thoại Nâng cấp project 0.1 hoặc 0.2 → 0.3 (feature 006, T081, FR-003, FR-004, FR-005; research R3; feature 007, T108):
// mở project 0.1 hoặc 0.2 thì hỏi Nâng cấp / Mở chỉ đọc / Hủy, liệt kê thay đổi và nơi giữ bản sao lưu; project mới hơn
// mức hiểu (0.3) thì từ chối, nêu phiên bản Studio cần.
import { afterEach, describe, expect, it } from 'vitest';
import { full02, tankDemo } from '../../model/test-fixtures.ts';
import { createMockPlatform } from '../../platform/mock.ts';
import { StudioApp } from '../../app/app.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import { textOf } from '../online-test-helpers.ts';
import './upgrade-dialog.ts';
import type { MatUpgradeDialog } from './upgrade-dialog.ts';

async function setup(files?: Record<string, string>) {
  const platform = createMockPlatform();
  if (files) platform.control.useProject(files);
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

describe('hộp thoại Nâng cấp', () => {
  it('mở project 0.1: hộp thoại có ba nút, liệt kê thay đổi và nơi sao lưu; chưa ghi gì', async () => {
    const { app, platform } = await setup();
    expect(app.ui.dialog?.kind).toBe('upgrade');
    const d = dlg()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    const text = textOf(d);
    expect(text).toContain('0.1');
    expect(text).toContain('5 Tag mock');
    expect(text).toContain('legacy');
    expect(text).toContain('0.8.0');
    // Làm sạch SVG liệt kê rõ: số phần tử bị bỏ và ví dụ (tank-motor.svg có <title> ở gốc).
    expect(text).toContain('Làm sạch SVG');
    expect(text).toContain('<title> ×1');
    expect(text).toContain('.mat-backup/0.1.0-');
    for (const label of ['Nâng cấp', 'Mở chỉ đọc', 'Hủy'])
      expect(button(label), label).toBeDefined();
    expect(platform.control.writes).toEqual([]);
    expect(app.store.dirtyFiles()).toEqual([]);
  });

  it('Nâng cấp: tài liệu 0.3 trong bộ nhớ, hộp thoại đóng, đĩa không đổi tới khi lưu', async () => {
    const { app, platform } = await setup();
    button('Nâng cấp')!.click();
    await new Promise((r) => setTimeout(r, 20));
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.schema).toBe('0.3');
    expect(app.store.dirtyFiles().length).toBeGreaterThan(0);
    expect(platform.control.writes).toEqual([]);
    expect(app.isDirty()).toBe(true);
    // Lưu lần đầu: có thư mục sao lưu và thông báo đường dẫn.
    await app.save();
    expect(platform.control.backups).toHaveLength(1);
    expect(app.ui.toast?.text).toContain('.mat-backup/0.1.0-');
  });

  it('Mở chỉ đọc: mọi sửa bị khóa kèm lý do; hộp thoại đóng; Nạp xuống nguyên trạng', async () => {
    const { app } = await setup();
    button('Mở chỉ đọc')!.click();
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.readOnly).toBe(true);
    app.store.edit([{ kind: 'project', field: 'projectName', value: 'X' }]);
    expect(app.isDirty()).toBe(false);
    expect(app.commandContext().readOnly).toBe(true);
  });

  it('Hủy hoặc Esc: đóng project, không đọc thêm', async () => {
    const { app } = await setup();
    button('Hủy')!.click();
    await settled();
    expect(app.store.state.project).toBeNull();
    expect(app.ui.dialog).toBeNull();
    // Esc cũng là Hủy.
    await app.run('project.open');
    await app.store.idle();
    await settled();
    expect(app.ui.dialog?.kind).toBe('upgrade');
    press(dlg()!, 'Escape');
    await settled();
    expect(app.store.state.project).toBeNull();
  });

  it('bàn phím: focus vào nút Nâng cấp khi mở, Tab vòng trong hộp thoại', async () => {
    await setup();
    expect(document.activeElement?.textContent).toContain('Nâng cấp');
    const items = [
      ...document.querySelectorAll<HTMLElement>('mat-upgrade-dialog button:not([disabled])'),
    ];
    items.at(-1)!.focus();
    press(items.at(-1)!, 'Tab');
    expect(items.length).toBeGreaterThanOrEqual(4);
  });

  it('project 0.2: cũng hỏi Nâng cấp lên 0.3 (feature 007); Nâng cấp chuyển màn hình sang nhiều mục', async () => {
    const { app } = await setup(full02());
    expect(app.ui.dialog?.kind).toBe('upgrade');
    expect(app.store.state.outline.schema).toBe('0.2');
    const text = textOf(dlg());
    expect(text).toContain('0.2');
    expect(text).toContain('nhiều mục');
    button('Nâng cấp')!.click();
    await new Promise((r) => setTimeout(r, 20));
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(app.store.state.outline.schema).toBe('0.3');
  });

  it('project mới hơn mức hiểu (0.6.0): từ chối, nêu phiên bản, không ghi gì', async () => {
    const files = full02();
    files['project.json'] = files['project.json'].replace('"0.2.0"', '"0.6.0"');
    const { app, platform } = await setup(files);
    expect(app.ui.dialog?.kind).toBe('refused');
    const text = textOf(dlg());
    expect(text).toContain('0.6.0');
    expect(text).toContain('mới hơn');
    expect(app.store.state.project).toBeNull();
    expect(platform.control.writes).toEqual([]);
    button('Đóng')!.click();
    await settled();
    expect(app.ui.dialog).toBeNull();
  });

  it('kế hoạch nâng cấp lỗi (file hỏng): nút Nâng cấp khóa, nói lý do', async () => {
    const files = tankDemo();
    files['tags.json'] = '{khong phai json';
    await setup(files);
    expect(button('Nâng cấp')!.disabled).toBe(true);
    expect(textOf(dlg())).toContain('không nâng cấp được');
  });
});
