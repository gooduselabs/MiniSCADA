// Bộ điều khiển giao diện (feature 004, US1, data-model §1, §6, §8, contracts/commands.md): nối store,
// không gian làm việc, phiên thiết bị và lệnh; giữ trạng thái giao diện (cây, inspector, hộp thoại,
// bảng lệnh, thông báo). Logic thuần, chạy với lớp platform giả.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import type { StorageLike } from './workspace.ts';
import { WORKSPACE_KEY } from './workspace.ts';
import { StudioApp } from './app.ts';
import { VALIDATE_DELAY_MS } from './store.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

async function started(platform: MockPlatform = createMockPlatform()) {
  const storage = memoryStorage();
  const app = new StudioApp({ platform, storage, windowWidth: 1400 });
  await app.start();
  return { app, platform, storage };
}

async function withProject(platform: MockPlatform = createMockPlatform()) {
  const r = await started(platform);
  await r.app.run('project.open');
  await r.app.store.idle();
  return r;
}

/** Trả lời hộp thoại đang mở khi nó xuất hiện. */
async function answerWhenAsked(app: StudioApp, choice: Parameters<StudioApp['answer']>[0]) {
  await vi.waitFor(() => expect(app.ui.dialog).not.toBeNull());
  app.answer(choice);
}

describe('StudioApp', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('khởi động: chỉ tab Bắt đầu, nạp danh sách gần đây, tiêu đề cửa sổ mặc định', async () => {
    const { app } = await started();
    expect(app.store.state.tabs).toEqual(['start']);
    expect(app.ui.recent.map((r) => r.name)).toEqual(['tank-demo', 'plant-a']);
    expect(document.title).toBe('mAT Studio');
    expect(app.commandContext().hasProject).toBe(false);
  });

  it('mở project: cây có tên project, mở sẵn các nhóm, tiêu đề có tên project', async () => {
    const { app } = await withProject();
    const root = app.tree();
    expect(root.label).toBe('Trạm bơm nước (demo Sprint 1)');
    expect([...app.ui.expanded]).toEqual(
      expect.arrayContaining(['root', 'device', 'tagsFolder', 'screens']),
    );
    expect(document.title).toBe('Trạm bơm nước (demo Sprint 1) · mAT Studio');
  });

  it('chọn mục trên cây mở editor; chọn lại không mở tab trùng; đổi tab thì cây chọn theo', async () => {
    const { app } = await withProject();
    app.selectNode('tags');
    app.selectNode('settings');
    app.selectNode('tags');
    expect(app.store.state.tabs).toEqual(['start', 'tags', 'settings']);
    expect(app.store.state.active).toBe('tags');
    app.activate('settings');
    expect(app.ui.treeSel).toBe('settings');
    expect(app.store.state.selection).toEqual({ kind: 'project' });
  });

  it('chuyển tab rồi quay lại: lựa chọn của editor đó được nhớ', async () => {
    const { app } = await withProject();
    app.openEditor('logging');
    app.select({ kind: 'group', index: 1 });
    app.openEditor('tags');
    app.select({ kind: 'tag', row: 3 });
    app.activate('logging');
    expect(app.store.state.selection).toEqual({ kind: 'group', index: 1 });
    app.activate('tags');
    expect(app.store.state.selection).toEqual({ kind: 'tag', row: 3 });
  });

  it('mở editor từ lệnh thì mở đường tới mục đó trên cây', async () => {
    const { app } = await withProject();
    app.collapseAll();
    expect([...app.ui.expanded]).toEqual(['root']);
    await app.run('open.tags');
    expect(app.ui.treeSel).toBe('tags');
    expect([...app.ui.expanded]).toEqual(expect.arrayContaining(['device', 'tagsFolder']));
  });

  it('nút nhóm chỉ mở/đóng, mục giai đoạn mở trang giải thích', async () => {
    const { app } = await withProject();
    app.selectNode('tagsFolder');
    expect(app.store.state.tabs).toEqual(['start']);
    app.toggleNode('tagsFolder');
    expect(app.ui.expanded.has('tagsFolder')).toBe(false);
    app.selectNode('reports');
    expect(app.store.state.active).toBe('phase:reports');
  });

  it('lệnh bị khóa: không chạy, báo lý do', async () => {
    const { app } = await withProject();
    await app.run('online.download');
    expect(app.ui.toast?.text).toBe('Nạp xuống…: Có ở feature 005');
    await app.run('edit.undo');
    expect(app.ui.toast?.text).toBe('Hoàn tác: Không còn bước để hoàn tác');
  });

  it('lưu: báo số file; còn lỗi thì nói thiết bị sẽ từ chối (FR-023)', async () => {
    const { app, platform } = await withProject();
    app.store.edit([{ kind: 'tagField', index: 0, field: 'max', value: -1 }]);
    await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
    await app.store.idle();
    await app.run('project.save');
    expect(platform.control.writes.map((w) => w.rel)).toEqual(['tags.json']);
    expect(app.ui.toast?.text).toBe(
      'Đã lưu tags.json. Còn 1 lỗi: thiết bị sẽ từ chối project này.',
    );
  });

  it('lưu khi file bị sửa ngoài Studio: hỏi, chọn Ghi đè thì ghi (FR-025)', async () => {
    const { app, platform } = await withProject();
    platform.control.editOutside('project.json', '{"projectName":"ngoài"}\n');
    app.store.edit([{ kind: 'project', field: 'projectName', value: 'Trạm mới' }]);
    const saving = app.run('project.save');
    await answerWhenAsked(app, 'overwrite');
    await saving;
    expect(app.ui.dialog).toBeNull();
    expect(platform.control.writes.at(-1)?.content).toContain('Trạm mới');
    expect(app.store.dirtyFiles()).toEqual([]);
  });

  it('xung đột → Hủy: giữ chưa lưu và báo', async () => {
    const { app, platform } = await withProject();
    platform.control.editOutside('project.json', '{}\n');
    app.store.edit([{ kind: 'project', field: 'projectName', value: 'Trạm mới' }]);
    const saving = app.run('project.save');
    await answerWhenAsked(app, 'cancel');
    await saving;
    expect(app.store.dirtyFiles()).toEqual(['project.json']);
    expect(app.ui.toast?.text).toBe('Chưa lưu project.json: thay đổi vẫn giữ trong Studio.');
  });

  it('mở project khác khi còn thay đổi: hỏi Lưu / Không lưu / Hủy (FR-024)', async () => {
    const { app, platform } = await withProject();
    app.store.edit([{ kind: 'project', field: 'projectName', value: 'Trạm mới' }]);
    const cancelled = app.run('project.open');
    await answerWhenAsked(app, 'cancel');
    await cancelled;
    expect(app.store.dirtyFiles()).toEqual(['project.json']);
    const discarded = app.run('project.open');
    await answerWhenAsked(app, 'discard');
    await discarded;
    expect(app.store.dirtyFiles()).toEqual([]);
    expect(platform.control.writes).toEqual([]);
  });

  it('đóng cửa sổ khi còn thay đổi: Hủy thì không đóng; Lưu thì ghi rồi đóng (FR-024)', async () => {
    const { app, platform } = await withProject();
    app.store.edit([{ kind: 'project', field: 'projectName', value: 'Trạm mới' }]);
    const first = platform.control.requestClose();
    await answerWhenAsked(app, 'cancel');
    expect(await first).toBe(false);
    const second = platform.control.requestClose();
    await answerWhenAsked(app, 'save');
    expect(await second).toBe(true);
    expect(platform.control.writes.map((w) => w.rel)).toEqual(['project.json']);
  });

  it('đóng cửa sổ khi không có thay đổi: đóng ngay, không hỏi', async () => {
    const { app, platform } = await withProject();
    expect(await platform.control.requestClose()).toBe(true);
    expect(app.ui.dialog).toBeNull();
  });

  it('theme và bố cục được nhớ; Đặt lại bố cục giữ theme', async () => {
    const { app, storage } = await started();
    app.setTheme('dark');
    app.setLayout({ leftWidth: 999 });
    expect(app.workspace.leftWidth).toBe(480);
    expect(JSON.parse(storage.data.get(WORKSPACE_KEY) ?? '{}')).toMatchObject({
      theme: 'dark',
      leftWidth: 480,
    });
    await app.run('view.resetLayout');
    expect(app.workspace).toMatchObject({ theme: 'dark', leftWidth: 264 });
  });

  it('task card: chọn thẻ đang mở thì thu lại; lệnh Tìm mở thẻ Tìm', async () => {
    const { app } = await withProject();
    expect(app.workspace).toMatchObject({ taskCard: 'toolbox', taskCardOpen: true });
    app.setTaskCard('toolbox');
    expect(app.workspace.taskCardOpen).toBe(false);
    app.setTaskCard('toolbox');
    expect(app.workspace.taskCardOpen).toBe(true);
    app.setTaskCard('library');
    expect(app.workspace).toMatchObject({ taskCard: 'library', taskCardOpen: true });
    const focusFind = vi.fn();
    app.hooks.focusFind = focusFind;
    await app.run('edit.find');
    expect(app.workspace).toMatchObject({ taskCard: 'find', taskCardOpen: true });
    expect(focusFind).toHaveBeenCalled();
  });

  it('nhảy tới lỗi: mở Bảng Tag và để sẵn vị trí cho editor lấy một lần (FR-018)', async () => {
    const { app } = await withProject();
    app.store.edit([{ kind: 'tagField', index: 0, field: 'max', value: -1 }]);
    await app.run('tools.validate');
    expect(app.ui.inspectorTab).toBe('info');
    const issue = app.store.state.issues.find((i) => i.code === 'E_TAG_RANGE');
    expect(issue).toBeDefined();
    app.gotoIssue(issue!);
    expect(app.store.state.active).toBe('tags');
    expect(app.takeReveal('tags')).toEqual({ editor: 'tags', row: 0, column: 'max' });
    expect(app.takeReveal('tags')).toBeNull();
  });

  it('kết nối theo dõi khi chưa nhập địa chỉ: mở trang Thiết bị', async () => {
    const { app } = await withProject();
    await app.run('online.connect');
    expect(app.store.state.active).toBe('device');
    expect(app.session.state).toBe('idle');
  });

  it('mở mục gần đây đã mất thư mục: báo, không đổi project', async () => {
    const { app } = await started();
    await app.run('project.openRecent', 1);
    expect(app.store.state.project).toBeNull();
    expect(app.ui.toast?.text).toBe(
      'Thư mục không còn tồn tại. Bỏ mục này khỏi danh sách ở tab Bắt đầu.',
    );
    await app.forgetRecent(1);
    expect(app.ui.recent.map((r) => r.name)).toEqual(['tank-demo']);
  });

  it('đóng tab có thay đổi chưa lưu: thay đổi vẫn giữ, có báo', async () => {
    const { app } = await withProject();
    app.openEditor('tags');
    app.store.edit([{ kind: 'tagField', index: 0, field: 'unit', value: 'm' }]);
    app.closeTab('tags');
    expect(app.store.dirtyFiles()).toEqual(['tags.json']);
    expect(app.ui.toast?.text).toBe(
      'Bảng Tag mặc định: thay đổi chưa lưu vẫn giữ trong project (Ctrl+S để lưu).',
    );
  });

  it('đóng project: hết tab, cây rỗng, tiêu đề mặc định', async () => {
    const { app } = await withProject();
    app.openEditor('tags');
    await app.run('project.close');
    expect(app.store.state.project).toBeNull();
    expect(app.store.state.tabs).toEqual(['start']);
    expect(document.title).toBe('mAT Studio');
  });

  it('người nghe được báo khi trạng thái giao diện đổi', async () => {
    const { app } = await started();
    const seen = vi.fn();
    const off = app.subscribe(seen);
    app.setInspectorTab('info');
    off();
    app.setInspectorTab('props');
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
