// Thiết lập project (feature 004, T057, T062, FR-019, FR-018, mockup bản 1): tên, phiên bản, màn hình
// đầu, số client tối đa sửa được; mã project, runtime tối thiểu chỉ đọc; trợ giúp dưới mỗi ô; lỗi hiện
// ngay tại ô; nhảy từ tab Thông tin tới đúng ô.
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { VALIDATE_DELAY_MS } from '../../app/store.ts';
import { locate } from '../../model/issue-map.ts';
import { cleanup, mount, newApp, settled } from '../test-helpers.ts';
import './settings-editor.ts';
import type { SettingsEditor } from './settings-editor.ts';

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim();
const field = (el: Element, f: string) => el.querySelector<HTMLInputElement>(`#set-${f}`)!;
const project = (app: StudioApp) => app.store.state.outline.project!;

async function openSettings() {
  const made = await newApp();
  made.app.openEditor('settings');
  const el = await mount<SettingsEditor>('mat-settings-editor', made.app);
  await settled(el);
  return { ...made, el };
}

function typeInto(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function validated(app: StudioApp, el: Element) {
  await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS + 30));
  await app.store.idle();
  await settled(el);
}

describe('mat-settings-editor', () => {
  afterEach(cleanup);

  it('ô tên, phiên bản, màn hình đầu (chọn từ danh sách màn hình), số client 1–10', async () => {
    const { el } = await openSettings();
    expect(text(el.querySelector('.ed-head h2'))).toBe('Thiết lập project');
    expect(text(el.querySelector('.ed-head .path'))).toBe('project.json');
    expect(field(el, 'projectName').value).toBe('Trạm bơm nước (demo Sprint 1)');
    expect(field(el, 'projectVersion').value).toBe('0.1.0');
    const entry = el.querySelector<HTMLSelectElement>('#set-entryScreen')!;
    expect(entry.tagName).toBe('SELECT');
    expect(entry.value).toBe('tank-motor');
    expect([...entry.options].map((o) => text(o))).toEqual(['Bồn nước + bơm (tank-motor)']);
    const clients = field(el, 'maxClients');
    expect([clients.type, clients.value, clients.min, clients.max]).toEqual([
      'number',
      '10',
      '1',
      '10',
    ]);
    const labels = [...el.querySelectorAll('.field > label')].map((l) => text(l));
    expect(labels).toEqual(
      expect.arrayContaining([
        'Tên project',
        'Mã project',
        'Phiên bản',
        'Màn hình đầu',
        'Số client tối đa',
        'Runtime tối thiểu',
      ]),
    );
  });

  it('mã project và runtime tối thiểu chỉ đọc', async () => {
    const { el } = await openSettings();
    expect(field(el, 'projectId').readOnly).toBe(true);
    expect(field(el, 'projectId').value).toBe('tank-demo');
    expect(field(el, 'minRuntimeVersion').readOnly).toBe(true);
    expect(field(el, 'minRuntimeVersion').value).toBe('0.3.0');
    for (const f of ['projectName', 'projectVersion', 'maxClients'])
      expect(field(el, f).readOnly, f).toBe(false);
  });

  it('mỗi ô có dòng trợ giúp ngay dưới, gắn bằng aria-describedby', async () => {
    const { el } = await openSettings();
    for (const f of [
      'projectName',
      'projectId',
      'projectVersion',
      'entryScreen',
      'maxClients',
      'minRuntimeVersion',
    ]) {
      const control = el.querySelector<HTMLElement>(`#set-${f}`)!;
      const help = el.querySelector<HTMLElement>(`#set-${f}-help`);
      expect(help?.classList.contains('help'), f).toBe(true);
      expect(text(help)?.length, f).toBeGreaterThan(10);
      expect(control.getAttribute('aria-describedby')?.split(' '), f).toContain(`set-${f}-help`);
      expect(el.querySelector(`label[for="set-${f}"]`), f).not.toBeNull();
    }
    expect(text(el.querySelector('#set-maxClients-help'))).toContain('1 đến 10');
  });

  it('múi giờ lưu trữ chỉ đọc (đặt trong logging.json)', async () => {
    const { el } = await openSettings();
    expect(field(el, 'timeZone').readOnly).toBe(true);
    expect(field(el, 'timeZone').value).toBe('UTC+07:00');
  });

  it('sửa qua store: gõ liên tục vào một ô là một bước hoàn tác; chỉ project.json chưa lưu', async () => {
    const { app, el } = await openSettings();
    const name = field(el, 'projectName');
    typeInto(name, 'Trạm A');
    typeInto(name, 'Trạm AB');
    expect(project(app).projectName).toBe('Trạm AB');
    expect(app.store.dirtyFiles()).toEqual(['project.json']);
    app.store.undo();
    await settled(el);
    expect(project(app).projectName).toBe('Trạm bơm nước (demo Sprint 1)');
    expect(field(el, 'projectName').value).toBe('Trạm bơm nước (demo Sprint 1)');
    typeInto(field(el, 'projectVersion'), '0.2.0');
    expect(project(app).projectVersion).toBe('0.2.0');
    typeInto(field(el, 'maxClients'), '4');
    expect(project(app).maxClients).toBe(4);
  });

  it('lỗi tại ô: số client 11 → E_MAX_CLIENTS, viền đỏ và lý do ngay dưới ô', async () => {
    const { app, el } = await openSettings();
    typeInto(field(el, 'maxClients'), '11');
    expect(project(app).maxClients).toBe(11);
    await validated(app, el);
    const input = field(el, 'maxClients');
    expect(input.classList.contains('bad')).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const err = el.querySelector('#set-maxClients-err');
    expect(err?.classList.contains('err-text')).toBe(true);
    expect(text(err)).toContain('E_MAX_CLIENTS');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain('set-maxClients-err');
    expect(field(el, 'projectName').classList.contains('bad')).toBe(false);
    // sửa lại thì hết lỗi
    typeInto(field(el, 'maxClients'), '8');
    await validated(app, el);
    expect(field(el, 'maxClients').classList.contains('bad')).toBe(false);
    expect(el.querySelector('#set-maxClients-err')).toBeNull();
  });

  it('màn hình đầu không có trong project: hiện mục báo, lỗi tại ô; chọn lại từ danh sách', async () => {
    const { app, el } = await openSettings();
    app.store.edit([{ kind: 'project', field: 'entryScreen', value: 'khong-co' }]);
    await validated(app, el);
    const entry = el.querySelector<HTMLSelectElement>('#set-entryScreen')!;
    expect(entry.value).toBe('khong-co');
    expect(text(entry.selectedOptions[0])).toBe('khong-co (không có trong project)');
    expect(entry.classList.contains('bad')).toBe(true);
    entry.value = 'tank-motor';
    entry.dispatchEvent(new Event('change', { bubbles: true }));
    expect(project(app).entryScreen).toBe('tank-motor');
  });

  it('nhảy tới lỗi từ tab Thông tin: mở Thiết lập project và focus đúng ô', async () => {
    const { app, el } = await openSettings();
    typeInto(field(el, 'maxClients'), '11');
    await validated(app, el);
    const issue = app.store.state.issues.find((i) => i.code === 'E_MAX_CLIENTS')!;
    expect(locate(issue, app.store.state.outline)).toEqual({
      editor: 'settings',
      field: 'maxClients',
    });
    app.openEditor('tags');
    app.gotoIssue(issue);
    await settled(el);
    expect(app.store.state.active).toBe('settings');
    expect(document.activeElement).toBe(field(el, 'maxClients'));
  });

  it('lỗi ở trường không có ô sửa: liệt kê ở đầu editor, nhảy tới thì focus danh sách đó', async () => {
    const { app, platform, el } = await openSettings();
    const disk = JSON.parse(JSON.stringify(project(app))) as Record<string, unknown>;
    disk.screens = 'tank-motor';
    platform.control.editOutside('project.json', JSON.stringify(disk, null, 2) + '\n');
    await app.store.validateNow();
    await settled(el);
    const issue = app.store.state.issues.find(
      (i) => i.file === 'project.json' && i.path.startsWith('/screens'),
    )!;
    expect(issue).toBeDefined();
    const banner = el.querySelector<HTMLElement>('#set-other')!;
    expect(text(banner)).toContain(issue.code);
    expect(text(banner)).toContain('/screens');
    app.gotoIssue(issue);
    await settled(el);
    expect(document.activeElement).toBe(banner);
  });

  it('project.json hỏng: báo lỗi, không có ô sửa', async () => {
    const { app, platform, el } = await openSettings();
    platform.control.editOutside('project.json', '{ hỏng');
    await app.store.validateNow();
    await settled(el);
    expect(text(el.querySelector('.banner.err'))).toContain('project.json');
    expect(el.querySelector('#set-projectName')).toBeNull();
  });
});

describe('Thiết lập project: chủ đề (feature 012, FR-029, FR-030)', () => {
  it('project 1.1: chọn chủ đề Sáng đa sắc, Công nghiệp trầm, Tối; ghi theme vào project.json', async () => {
    const { resolve } = await import('node:path');
    const { readProjectDir } = await import('../../model/test-fixtures.ts');
    const { createMockPlatform } = await import('../../platform/mock.ts');
    const { StudioApp } = await import('../../app/app.ts');
    const files = readProjectDir(
      resolve(__dirname, '../../../../../tests/project-vectors/v11-valid-full'),
    );
    delete files['expected.json'];
    const platform = createMockPlatform();
    platform.control.useProject(files);
    const app = new StudioApp({ platform, storage: null, windowWidth: 1400, versionGate: false });
    await app.start();
    await app.run('project.open');
    await app.store.idle();
    app.openEditor('settings');
    const el = await mount<SettingsEditor>('mat-settings-editor', app);
    await settled(el);
    const sel = el.querySelector<HTMLSelectElement>('#set-theme')!;
    expect([...sel.options].map((o) => o.value)).toEqual(['vivid', 'industrial', 'dark']);
    expect(sel.value).toBe('vivid');
    sel.value = 'dark';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect((app.store.state.outline.project as unknown as { theme: string }).theme).toBe('dark');
  });

  it('project dưới 1.1: không có ô chủ đề', async () => {
    const { el } = await openSettings();
    expect(el.querySelector('#set-theme')).toBeNull();
  });
});
