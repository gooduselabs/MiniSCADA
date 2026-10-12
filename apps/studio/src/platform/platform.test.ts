// Lớp platform của Studio (feature 004, T036, contracts/tauri-commands.md): bản Tauri đổi kết quả và lỗi
// của lệnh Rust sang kiểu có cấu trúc; bản giả (chế độ e2e) giữ project mẫu trong bộ nhớ.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

const { tauriPlatform } = await import('./tauri.ts');
const { createMockPlatform, sha256Hex } = await import('./mock.ts');

describe('platform Tauri', () => {
  beforeEach(() => invoke.mockReset());

  it('read: trả nội dung và hash; lỗi đã phân loại giữ nguyên mã', async () => {
    invoke.mockResolvedValueOnce({ text: '{}', hash: 'ab' });
    expect(await tauriPlatform.read('project.json')).toEqual({ text: '{}', hash: 'ab' });
    expect(invoke).toHaveBeenLastCalledWith('project_read', { rel: 'project.json' });
    invoke.mockRejectedValueOnce('too-large');
    expect(await tauriPlatform.read('a.svg')).toEqual({ error: 'too-large' });
  });

  it('read: lỗi không nhận ra coi như không có file', async () => {
    invoke.mockRejectedValueOnce(new Error('ipc down'));
    expect(await tauriPlatform.read('x.json')).toEqual({ error: 'missing' });
  });

  it('write: gửi hash mong đợi và cờ force; lỗi changed, io có chi tiết', async () => {
    invoke.mockResolvedValueOnce({ hash: 'cd' });
    expect(await tauriPlatform.write('tags.json', 'x', 'ab', false)).toEqual({ hash: 'cd' });
    expect(invoke).toHaveBeenLastCalledWith('project_write', {
      rel: 'tags.json',
      content: 'x',
      expectedHash: 'ab',
      force: false,
    });
    invoke.mockRejectedValueOnce('changed');
    expect(await tauriPlatform.write('tags.json', 'x', 'ab', false)).toEqual({ error: 'changed' });
    invoke.mockRejectedValueOnce({ io: 'disk full' });
    expect(await tauriPlatform.write('tags.json', 'x', null, true)).toEqual({
      error: 'io',
      detail: 'disk full',
    });
  });

  it('project gần đây: danh sách, mở theo chỉ số, bỏ mục', async () => {
    const entry = {
      index: 0,
      display: 'D:\\p',
      name: 'P',
      openedAt: '2026-10-11T00:00:00Z',
      exists: true,
    };
    invoke.mockResolvedValueOnce([entry]);
    expect(await tauriPlatform.recentProjects()).toEqual([entry]);
    invoke.mockResolvedValueOnce({ display: 'D:\\p' });
    expect(await tauriPlatform.openRecent(0)).toEqual({ display: 'D:\\p' });
    expect(invoke).toHaveBeenLastCalledWith('project_open_recent', { index: 0 });
    invoke.mockRejectedValueOnce('missing');
    expect(await tauriPlatform.openRecent(1)).toEqual({ error: 'missing' });
    invoke.mockResolvedValueOnce(undefined);
    await tauriPlatform.forgetRecent(1);
    expect(invoke).toHaveBeenLastCalledWith('project_forget_recent', { index: 1 });
  });
});

describe('platform giả (e2e)', () => {
  it('SHA-256 thuần JS khớp vector chuẩn và node:crypto (UTF-8, nhiều khối)', async () => {
    const { createHash } = await import('node:crypto');
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    for (const s of ['Trạm bơm nước', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(1000)])
      expect(await sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });

  it('đọc project mẫu kèm hash SHA-256 của nội dung', async () => {
    const p = createMockPlatform();
    expect(await p.pickProject()).toEqual({ display: expect.stringContaining('tank-demo') });
    const r = await p.read('project.json');
    expect('text' in r && JSON.parse(r.text).projectId).toBe('tank-demo');
    expect('hash' in r && r.hash).toBe(await sha256Hex('text' in r ? r.text : ''));
    expect(await p.read('khong-co.json')).toEqual({ error: 'missing' });
  });

  it('ghi cập nhật bộ nhớ, ghi lại lần gọi; hash cũ thì changed trừ khi force', async () => {
    const p = createMockPlatform();
    await p.pickProject();
    const r = await p.read('project.json');
    if (!('hash' in r)) throw new Error('đọc lỗi');
    const w = await p.write('project.json', '{"a":1}\n', r.hash, false);
    expect(w).toEqual({ hash: await sha256Hex('{"a":1}\n') });
    expect(p.control.writes.map((x) => x.rel)).toEqual(['project.json']);
    expect(await p.write('project.json', 'x', r.hash, false)).toEqual({ error: 'changed' });
    expect(await p.write('project.json', 'x', r.hash, true)).toEqual({
      hash: await sha256Hex('x'),
    });
    expect(await p.write('a.svg', 'x', null, true)).toEqual({ error: 'bad-path' });
  });

  it('giả lập file bị sửa ngoài Studio và lỗi ghi', async () => {
    const p = createMockPlatform();
    await p.pickProject();
    const r = await p.read('tags.json');
    if (!('hash' in r)) throw new Error('đọc lỗi');
    p.control.editOutside('tags.json', '{"schemaVersion":"0.1.0","tags":[]}\n');
    expect(await p.write('tags.json', 'y', r.hash, false)).toEqual({ error: 'changed' });
    p.control.failWrites = 'io';
    expect(await p.write('tags.json', 'y', null, true)).toEqual({ error: 'io', detail: 'mock' });
  });

  it('useProject: lần mở project sau nạp bộ file khác (đo hiệu năng 500 Tag, T081)', async () => {
    const p = createMockPlatform();
    p.control.useProject(
      { 'project.json': '{"projectName":"X"}\n', 'tags.json': '{}\n' },
      'D:\\P\\x',
    );
    expect(await p.pickProject()).toEqual({ display: 'D:\\P\\x' });
    expect(await p.read('project.json')).toMatchObject({ text: '{"projectName":"X"}\n' });
    expect(await p.read('logging.json')).toEqual({ error: 'missing' });
    p.control.useProject(null);
    await p.pickProject();
    expect(await p.read('logging.json')).toMatchObject({ hash: expect.any(String) });
  });

  it('chưa mở project thì đọc báo missing, ghi báo no-project', async () => {
    const p = createMockPlatform();
    expect(await p.read('project.json')).toEqual({ error: 'missing' });
    expect(await p.write('project.json', 'x', null, false)).toEqual({ error: 'no-project' });
  });

  it('yêu cầu đóng cửa sổ gọi handler; handler trả false thì không đóng', async () => {
    const p = createMockPlatform();
    p.onCloseRequested(async () => false);
    expect(await p.control.requestClose()).toBe(false);
    p.onCloseRequested(async () => true);
    expect(await p.control.requestClose()).toBe(true);
  });
});
