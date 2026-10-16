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
    expect(await p.write('a.txt', 'x', null, true)).toEqual({ error: 'bad-path' });
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

// Feature 006 (contracts/tauri-commands-006.md §5, §6): sao lưu, xóa file, CSV.
describe('platform Tauri (006)', () => {
  beforeEach(() => invoke.mockReset());

  it('projectBackup: gửi files và label; lỗi exists, changed (kèm file), bad-path, io', async () => {
    invoke.mockResolvedValueOnce({ dir: '.mat-backup/0.1.0-20261020T030000Z', abs: 'D:/p/x' });
    expect(await tauriPlatform.projectBackup([{ rel: 'tags.json', hash: 'ab' }], '0.1.0')).toEqual({
      dir: '.mat-backup/0.1.0-20261020T030000Z',
      abs: 'D:/p/x',
    });
    expect(invoke).toHaveBeenLastCalledWith('project_backup', {
      files: [{ rel: 'tags.json', hash: 'ab' }],
      label: '0.1.0',
    });
    invoke.mockRejectedValueOnce('exists');
    expect(await tauriPlatform.projectBackup([], '0.1.0')).toEqual({ error: 'exists' });
    invoke.mockRejectedValueOnce({ changed: 'tags.json' });
    expect(await tauriPlatform.projectBackup([], '0.1.0')).toEqual({
      error: 'changed',
      detail: 'tags.json',
    });
    invoke.mockRejectedValueOnce({ io: 'disk full' });
    expect(await tauriPlatform.projectBackup([], '0.1.0')).toEqual({
      error: 'io',
      detail: 'disk full',
    });
    invoke.mockRejectedValueOnce('no-project');
    expect(await tauriPlatform.projectBackup([], '0.1.0')).toEqual({ error: 'no-project' });
  });

  it('projectRemove: ok khi xóa được; lỗi changed (kèm file), missing, bad-path, io', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await tauriPlatform.projectRemove('value-tables/A.json', 'ab')).toEqual({ ok: true });
    expect(invoke).toHaveBeenLastCalledWith('project_remove', {
      rel: 'value-tables/A.json',
      hash: 'ab',
    });
    invoke.mockRejectedValueOnce({ changed: 'value-tables/A.json' });
    expect(await tauriPlatform.projectRemove('value-tables/A.json', 'ab')).toEqual({
      error: 'changed',
      detail: 'value-tables/A.json',
    });
    invoke.mockRejectedValueOnce('missing');
    expect(await tauriPlatform.projectRemove('x.json', 'ab')).toEqual({ error: 'missing' });
    invoke.mockRejectedValueOnce('bad-path');
    expect(await tauriPlatform.projectRemove('project.json', 'ab')).toEqual({ error: 'bad-path' });
    invoke.mockRejectedValueOnce({ io: 'locked' });
    expect(await tauriPlatform.projectRemove('x.json', 'ab')).toEqual({
      error: 'io',
      detail: 'locked',
    });
  });

  it('csvOpen: byte gốc thành Uint8Array; hủy thì null; too-large và io là lỗi', async () => {
    invoke.mockResolvedValueOnce({ name: 'tags.csv', bytes: [0xef, 0xbb, 0xbf, 0x61] });
    const r = await tauriPlatform.csvOpen();
    expect(r).toEqual({ name: 'tags.csv', bytes: new Uint8Array([0xef, 0xbb, 0xbf, 0x61]) });
    expect(invoke).toHaveBeenLastCalledWith('csv_open', undefined);
    invoke.mockResolvedValueOnce(null);
    expect(await tauriPlatform.csvOpen()).toBeNull();
    invoke.mockRejectedValueOnce('too-large');
    expect(await tauriPlatform.csvOpen()).toEqual({ error: 'too-large' });
    invoke.mockRejectedValueOnce({ io: 'denied' });
    expect(await tauriPlatform.csvOpen()).toEqual({ error: 'io', detail: 'denied' });
  });

  it('csvSave: gửi tên gợi ý và văn bản; hủy thì null; lỗi io', async () => {
    invoke.mockResolvedValueOnce({ name: 'tags.csv' });
    expect(await tauriPlatform.csvSave('tags.csv', 'a;b')).toEqual({ name: 'tags.csv' });
    expect(invoke).toHaveBeenLastCalledWith('csv_save', { suggestedName: 'tags.csv', text: 'a;b' });
    invoke.mockResolvedValueOnce(null);
    expect(await tauriPlatform.csvSave('tags.csv', 'a')).toBeNull();
    invoke.mockRejectedValueOnce({ io: 'full' });
    expect(await tauriPlatform.csvSave('tags.csv', 'a')).toEqual({ error: 'io', detail: 'full' });
  });

  it('csvSave với đuôi (báo cáo nhập SVG): gửi thêm extension json hoặc md', async () => {
    invoke.mockResolvedValueOnce({ name: 'a.import-report.json' });
    await tauriPlatform.csvSave('a.import-report.json', '{}', 'json');
    expect(invoke).toHaveBeenLastCalledWith('csv_save', {
      suggestedName: 'a.import-report.json',
      text: '{}',
      extension: 'json',
    });
  });

  it('svgOpen: byte gốc thành Uint8Array; hủy thì null; too-large, bad-extension và io là lỗi', async () => {
    invoke.mockResolvedValueOnce({ name: 'a.svg', bytes: [0x3c, 0x73] });
    expect(await tauriPlatform.svgOpen()).toEqual({
      name: 'a.svg',
      bytes: new Uint8Array([0x3c, 0x73]),
    });
    expect(invoke).toHaveBeenLastCalledWith('svg_open', undefined);
    invoke.mockResolvedValueOnce(null);
    expect(await tauriPlatform.svgOpen()).toBeNull();
    invoke.mockRejectedValueOnce('too-large');
    expect(await tauriPlatform.svgOpen()).toEqual({ error: 'too-large' });
    invoke.mockRejectedValueOnce('bad-extension');
    expect(await tauriPlatform.svgOpen()).toEqual({ error: 'bad-extension' });
    invoke.mockRejectedValueOnce({ io: 'denied' });
    expect(await tauriPlatform.svgOpen()).toEqual({ error: 'io', detail: 'denied' });
  });

  it('reportSave (010): gửi byte nguyên văn và phần mở rộng; hủy thì null; lỗi io; bản giả ghi lại file', async () => {
    invoke.mockResolvedValueOnce({ name: 'dien-ca_2026-10-12.pdf' });
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255]);
    expect(await tauriPlatform.reportSave('dien-ca_2026-10-12.pdf', bytes, 'pdf')).toEqual({
      name: 'dien-ca_2026-10-12.pdf',
    });
    expect(invoke).toHaveBeenLastCalledWith('report_save', {
      suggestedName: 'dien-ca_2026-10-12.pdf',
      bytes: [0x25, 0x50, 0x44, 0x46, 0, 255],
      ext: 'pdf',
    });
    invoke.mockResolvedValueOnce(null);
    expect(await tauriPlatform.reportSave('x.xlsx', bytes, 'xlsx')).toBeNull();
    invoke.mockRejectedValueOnce({ io: 'full' });
    expect(await tauriPlatform.reportSave('x.csv', bytes, 'csv')).toEqual({
      error: 'io',
      detail: 'full',
    });
    const p = createMockPlatform();
    expect(await p.reportSave('x.xlsx', bytes, 'xlsx')).toEqual({ name: 'x.xlsx' });
    expect(p.control.savedReports).toHaveLength(1);
    expect([...p.control.savedReports[0]!.bytes]).toEqual([...bytes]);
  });
});

describe('platform giả (006)', () => {
  it('ghi file trong thư mục con; xóa theo hash; sao lưu vào .mat-backup; ghi lại cho e2e', async () => {
    const p = createMockPlatform();
    await p.pickProject();
    const w = await p.write('value-tables/A.json', '{}', null, false);
    expect('hash' in w).toBe(true);
    expect(await p.projectRemove('value-tables/A.json', 'sai')).toEqual({
      error: 'changed',
      detail: 'value-tables/A.json',
    });
    const hash = (w as { hash: string }).hash;
    expect(await p.projectRemove('value-tables/A.json', hash)).toEqual({ ok: true });
    expect(p.control.removes).toEqual(['value-tables/A.json']);
    expect(
      (await p.read('value-tables/A.json')) && 'error' in (await p.read('value-tables/A.json')),
    ).toBe(true);
    expect(await p.projectRemove('project.json', 'x')).toEqual({ error: 'bad-path' });

    const proj = await p.read('project.json');
    const ok = await p.projectBackup(
      [{ rel: 'project.json', hash: (proj as { hash: string }).hash }],
      '0.1.0',
    );
    expect('dir' in ok && ok.dir).toMatch(/^\.mat-backup\/0\.1\.0-\d{8}T\d{6}Z$/);
    expect(p.control.backups).toHaveLength(1);
    expect(p.control.backups[0].files).toEqual(['project.json']);
    // Lần hai cùng giây: không ghi đè.
    p.control.backupFailure = 'exists';
    expect(await p.projectBackup([], '0.1.0')).toEqual({ error: 'exists' });
    p.control.backupFailure = null;
    expect(await p.projectBackup([{ rel: 'project.json', hash: 'sai' }], '0.1.0')).toEqual({
      error: 'changed',
      detail: 'project.json',
    });
  });

  it('CSV giả: nội dung do e2e đặt; xuất ghi lại; hủy được', async () => {
    const p = createMockPlatform();
    p.control.csvOpenResult = { name: 'a.csv', bytes: new Uint8Array([97]) };
    expect(await p.csvOpen()).toEqual({ name: 'a.csv', bytes: new Uint8Array([97]) });
    p.control.csvOpenResult = null;
    expect(await p.csvOpen()).toBeNull();
    expect(await p.csvSave('x.csv', 'abc')).toEqual({ name: 'x.csv' });
    expect(p.control.savedCsv).toEqual([{ name: 'x.csv', text: 'abc' }]);
  });
});
