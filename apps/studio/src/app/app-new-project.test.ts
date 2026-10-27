// Project mới… (2026-10-20): lệnh `project.new` (Ctrl+N) hỏi Lưu/Bỏ/Hủy như Mở project rồi mở hộp thoại; tạo project
// ghi bộ file qua platform, mở project vừa tạo (cây, màn hình đầu), đưa lên đầu danh sách gần đây.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import { StudioApp } from './app.ts';
import { resolveShortcut } from './shortcuts.ts';

async function started(platform: MockPlatform = createMockPlatform()) {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  const app = new StudioApp({ platform, storage, windowWidth: 1400, versionGate: false });
  await app.start();
  return { app, platform };
}

describe('Project mới', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('Ctrl+N là project.new; lệnh luôn dùng được và mở hộp thoại', async () => {
    const key = { key: 'n', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };
    expect(resolveShortcut(key, { inTextField: false, modal: false })).toEqual({
      command: 'project.new',
    });
    // Đang có hộp thoại: không chạy lệnh nhưng vẫn chặn (WebView2 mở cửa sổ mới với Ctrl+N).
    expect(resolveShortcut(key, { inTextField: false, modal: true })).toEqual({ block: true });
    const { app } = await started();
    expect(app.enabled('project.new')).toBe(true);
    await app.run('project.new');
    expect(app.ui.dialog).toEqual({ kind: 'newProject' });
  });

  it('tạo từ mẫu trống: ghi bộ file, mở project, cây đầy đủ, mở sẵn màn hình đầu, 0 lỗi', async () => {
    const { app, platform } = await started();
    await app.run('project.new');
    const r = await app.createNewProject({
      name: 'Trạm bơm Số 1',
      id: 'tram-bom-so-1',
      template: 'blank',
      theme: 'dark', // bỏ qua (feature 029)
    });
    expect(r).toBe(true);
    expect(app.ui.dialog).toBeNull();
    expect(platform.control.created).toEqual([
      {
        id: 'tram-bom-so-1',
        display: 'D:\\Users\\ky-su\\Documents\\mAT SCADA\\tram-bom-so-1',
        files: ['project.json', 'screens/tong-quan.screen.json', 'tags.json'],
      },
    ]);
    await app.store.idle();
    expect(app.store.state.project?.display).toBe(
      'D:\\Users\\ky-su\\Documents\\mAT SCADA\\tram-bom-so-1',
    );
    expect(app.tree().label).toBe('Trạm bơm Số 1');
    expect(app.store.state.outline.format11).toBe(true);
    expect(app.store.state.active).toBe('screen:tong-quan');
    expect(app.counts().errors).toBe(0);
    expect(app.ui.recent[0]?.name).toBe('Trạm bơm Số 1');
    expect(app.ui.toast?.text).toContain('Trạm bơm Số 1');
  });

  it('tạo từ mẫu trạm bơm: mở màn hình đầu của mẫu, 0 lỗi', async () => {
    const { app } = await started();
    const r = await app.createNewProject({
      name: 'Trạm A',
      id: 'tram-a',
      template: 'pump',
      theme: 'vivid', // bỏ qua (feature 029)
    });
    expect(r).toBe(true);
    await app.store.idle();
    const entry = app.store.state.outline.project?.entryScreen;
    expect(entry).toBeTruthy();
    expect(app.store.state.active).toBe(`screen:${entry}`);
    expect(app.counts().errors).toBe(0);
  });

  it('thư mục đã có project: trả lỗi, hộp thoại vẫn mở, không mở gì', async () => {
    const { app, platform } = await started();
    platform.control.dirs['D:\\Users\\ky-su\\Documents\\mAT SCADA\\cu'] = 'exists-project';
    await app.run('project.new');
    const r = await app.createNewProject({
      name: 'Cũ',
      id: 'cu',
      template: 'blank',
      theme: 'vivid', // bỏ qua (feature 029)
    });
    expect(r).toEqual({ error: 'exists-project' });
    expect(app.ui.dialog).toEqual({ kind: 'newProject' });
    expect(app.store.state.project).toBeNull();
  });

  it('đang có thay đổi chưa lưu: hỏi như Mở project; Hủy thì không mở hộp thoại, Bỏ thì mở', async () => {
    const { app } = await started();
    await app.run('project.open');
    await app.store.idle();
    app.store.edit([{ kind: 'project', field: 'projectName', value: 'Đang sửa' }]);
    const cancelled = app.run('project.new');
    await vi.waitFor(() => expect(app.ui.dialog?.kind).toBe('unsaved'));
    app.answer('cancel');
    await cancelled;
    expect(app.ui.dialog).toBeNull();
    expect(app.store.dirtyFiles()).toEqual(['project.json']);
    const discarded = app.run('project.new');
    await vi.waitFor(() => expect(app.ui.dialog?.kind).toBe('unsaved'));
    app.answer('discard');
    await discarded;
    expect(app.ui.dialog).toEqual({ kind: 'newProject' });
  });
});
