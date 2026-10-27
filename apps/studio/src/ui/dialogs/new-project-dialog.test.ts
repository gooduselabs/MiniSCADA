// Hộp thoại Project mới (2026-10-20): mã tự sinh từ tên (sửa được), thư mục chứa mặc định và Chọn…, dòng "Project
// sẽ nằm ở" báo thư mục đã có project ngay khi gõ, Tạo thì mở project mới; Esc hủy. Tab Bắt đầu: hai nút lớn.
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../editors/start-page.ts';
import { cleanup, mount, newApp, press, settled } from '../test-helpers.ts';
import './new-project-dialog.ts';
import type { MatNewProjectDialog } from './new-project-dialog.ts';

afterEach(cleanup);

async function open() {
  const env = await newApp({ open: false });
  const el = await mount<MatNewProjectDialog>('mat-new-project-dialog', env.app);
  await env.app.run('project.new');
  await settled();
  await vi.waitFor(() => expect(el.textContent).toContain('mAT SCADA'));
  return { ...env, el };
}

const field = (el: Element, id: string) => el.querySelector<HTMLInputElement>(`#${id}`)!;
async function type(el: Element, id: string, text: string) {
  const i = field(el, id);
  i.value = text;
  i.dispatchEvent(new Event('input', { bubbles: true }));
  await settled();
}

describe('mat-new-project-dialog', () => {
  it('mở bằng Project mới…: modal, focus ô tên, thư mục chứa mặc định, mẫu Trống và chủ đề Sáng đa sắc chọn sẵn', async () => {
    const { el } = await open();
    const dlg = el.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.textContent).toContain('Project mới');
    expect(document.activeElement).toBe(field(el, 'np-name'));
    expect(el.querySelector('.np-parent')!.textContent).toBe(
      'D:\\Users\\ky-su\\Documents\\mAT SCADA',
    );
    expect(el.querySelector<HTMLInputElement>('input[name="np-template"]:checked')!.value).toBe(
      'blank',
    );
    // feature 029: không còn chọn chủ đề
    expect(el.querySelector('input[name="np-theme"]')).toBeNull();
  });

  it('gõ tên: mã tự sinh không dấu, đích hiện <cha>\\<mã>; sửa mã thì thôi sinh theo tên, nút sinh lại trả về', async () => {
    const { el } = await open();
    await type(el, 'np-name', 'Trạm bơm Đồng Tâm');
    expect(field(el, 'np-id').value).toBe('tram-bom-dong-tam');
    await vi.waitFor(() =>
      expect(el.querySelector('.np-target .np-path')!.textContent).toBe(
        'D:\\Users\\ky-su\\Documents\\mAT SCADA\\tram-bom-dong-tam',
      ),
    );
    await vi.waitFor(() =>
      expect(el.querySelector('.np-target')!.textContent).toContain('sẽ được tạo'),
    );
    await type(el, 'np-id', 'tram-dt');
    await type(el, 'np-name', 'Trạm bơm Đồng Tâm 2');
    expect(field(el, 'np-id').value).toBe('tram-dt');
    el.querySelector<HTMLButtonElement>('.np-row .ibtn')!.click();
    await settled();
    expect(field(el, 'np-id').value).toBe('tram-bom-dong-tam-2');
  });

  it('mã sai: báo tại ô, Tạo không chạy', async () => {
    const { el, platform } = await open();
    await type(el, 'np-name', 'Trạm');
    await type(el, 'np-id', 'Trạm 1');
    expect(field(el, 'np-id').getAttribute('aria-invalid')).toBe('true');
    el.querySelector<HTMLButtonElement>('[data-role="ok"]')!.click();
    await settled();
    expect(el.querySelector('[role="alert"]')!.textContent).toContain('chữ thường không dấu');
    expect(platform.control.created).toEqual([]);
  });

  it('thư mục đích đã có project: báo ngay, Tạo không ghi gì', async () => {
    const { el, platform } = await open();
    platform.control.dirs['D:\\Users\\ky-su\\Documents\\mAT SCADA\\cu'] = 'exists-project';
    await type(el, 'np-name', 'Cũ');
    await vi.waitFor(() => expect(el.querySelector('.np-target.bad')).not.toBeNull());
    expect(el.querySelector('.np-target')!.textContent).toContain('đã có project');
    el.querySelector<HTMLButtonElement>('[data-role="ok"]')!.click();
    await settled();
    expect(platform.control.created).toEqual([]);
  });

  it('Chọn… đổi thư mục chứa; chọn mẫu trạm bơm, chủ đề Tối; Tạo thì mở project và đóng hộp thoại', async () => {
    const { el, app, platform } = await open();
    el.querySelector<HTMLButtonElement>('[data-role="pick"]')!.click();
    await vi.waitFor(() =>
      expect(el.querySelector('.np-parent')!.textContent).toBe('D:\\Projects'),
    );
    await type(el, 'np-name', 'Trạm A');
    el.querySelector<HTMLInputElement>('input[value="pump"]')!.click();
    await settled();
    el.querySelector<HTMLButtonElement>('[data-role="ok"]')!.click();
    await vi.waitFor(() => expect(app.ui.dialog).toBeNull());
    expect(platform.control.created[0]).toMatchObject({
      id: 'tram-a',
      display: 'D:\\Projects\\tram-a',
    });
    const project = JSON.parse(platform.control.fileText('project.json')!) as Record<
      string,
      unknown
    >;
    expect(project).toMatchObject({ projectId: 'tram-a', projectName: 'Trạm A' });
    expect(project.theme).toBeUndefined();
    expect(app.store.state.project?.display).toBe('D:\\Projects\\tram-a');
  });

  it('Esc hủy: không tạo gì', async () => {
    const { el, app, platform } = await open();
    await type(el, 'np-name', 'X1');
    press(field(el, 'np-name'), 'Escape');
    await settled();
    expect(app.ui.dialog).toBeNull();
    expect(platform.control.created).toEqual([]);
  });
});

describe('tab Bắt đầu khi chưa mở project', () => {
  it('hai nút lớn Tạo project mới (Ctrl+N), Mở project… (Ctrl+O) và danh sách gần đây', async () => {
    const { app } = await newApp({ open: false });
    const el = await mount('mat-start-page', app);
    const actions = [...el.querySelectorAll<HTMLButtonElement>('.start-actions .start-action')];
    expect(actions.map((b) => b.dataset.cmd)).toEqual(['project.new', 'project.open']);
    expect(actions[0].textContent).toContain('Tạo project mới');
    expect(actions[0].textContent).toContain('Ctrl+N');
    expect(actions[1].textContent).toContain('Ctrl+O');
    expect(el.querySelectorAll('.list .li')).toHaveLength(2);
    actions[0].click();
    await vi.waitFor(() => expect(app.ui.dialog).toEqual({ kind: 'newProject' }));
  });
});
