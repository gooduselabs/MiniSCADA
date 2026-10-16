// Store với project 0.2 (feature 006, T079, T080, T081; data-model §13.1, contracts/tauri-commands-006.md §5): đọc và
// sửa kết nối, bảng giá trị, bảng theo dõi; lưu theo thứ tự (file mới, project.json, file bị xóa); nâng cấp 0.1 → 0.2
// trong bộ nhớ (đề nghị, sao lưu trước lần lưu đầu); chế độ chỉ đọc; project mới hơn mức hiểu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { full02, tankDemo } from '../model/test-fixtures.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import { StudioStore, VALIDATE_DELAY_MS } from './store.ts';

const EDIT_MAX = { kind: 'tagField', index: 0, field: 'max', value: -1 } as const;

async function opened(platform: MockPlatform = createMockPlatform()) {
  const store = new StudioStore({ platform });
  expect(await store.openProject()).toBe(true);
  await store.validateNow();
  return { store, platform };
}

async function settle(store: StudioStore) {
  await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
  await store.idle();
}

const NEW_TABLE = {
  schemaVersion: '0.2.0',
  name: 'Van',
  entries: [{ value: 0, text: 'Đóng' }],
};

async function open02(files: Record<string, string> = full02()) {
  const platform = createMockPlatform();
  platform.control.useProject(files);
  return opened(platform);
}

describe('StudioStore: project 0.2', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('mở project 0.2: đọc kết nối, bảng giá trị, bảng theo dõi; hợp lệ; sửa được, không đề nghị nâng cấp', async () => {
    const { store } = await open02();
    const s = store.state;
    expect(s.outline.version).toBe('0.2');
    expect(Object.keys(s.docs)).toEqual(
      expect.arrayContaining([
        'connections.json',
        'value-tables/TrangThaiBom.json',
        'watch-tables/van-hanh.json',
      ]),
    );
    expect(s.docs['value-tables/TrangThaiBom.json'].editable).toBe(true);
    expect(s.issues.filter((i) => i.code.startsWith('E_'))).toEqual([]);
    expect(s.loaded02?.tags.tags).toHaveLength(13);
    expect(s.pendingUpgrade).toBe(true); // 0.2 → 0.3: hộp thoại Nâng cấp ở app (feature 007, T108)
    expect(s.readOnly).toBe(false);
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('thêm bảng giá trị rồi lưu: file mới ghi trước (hash null), project.json sau', async () => {
    const { store, platform } = await open02();
    store.edit([{ kind: 'valueTableUpsert', table: NEW_TABLE }]);
    expect(store.dirtyFiles()).toEqual(['value-tables/Van.json', 'project.json']);
    expect(await store.save()).toEqual({
      status: 'saved',
      files: ['value-tables/Van.json', 'project.json'],
    });
    expect(platform.control.writes.map((w) => w.rel)).toEqual([
      'value-tables/Van.json',
      'project.json',
    ]);
    expect(JSON.parse(platform.control.writes[0].content)).toEqual(NEW_TABLE);
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.docs['value-tables/Van.json'].created).toBeUndefined();
    await settle(store);
    expect(store.state.issues.filter((i) => i.code.startsWith('E_'))).toEqual([]);
  });

  it('xóa bảng giá trị rồi lưu: project.json ghi trước, file bị xóa sau cùng (project_remove với hash đã đọc)', async () => {
    const { store, platform } = await open02();
    store.edit([{ kind: 'valueTableRemove', name: 'TrangThaiBom' }]);
    expect(store.dirtyFiles()).toEqual(['project.json', 'value-tables/TrangThaiBom.json']);
    const r = await store.save();
    expect(r.status).toBe('saved');
    expect(platform.control.writes.map((w) => w.rel)).toEqual(['project.json']);
    expect(platform.control.removes).toEqual(['value-tables/TrangThaiBom.json']);
    expect(store.state.docs['value-tables/TrangThaiBom.json']).toBeUndefined();
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('xóa bảng mà file bị sửa ngoài Studio: xung đột; Ghi đè vẫn xóa', async () => {
    const { store, platform } = await open02();
    platform.control.editOutside('value-tables/TrangThaiBom.json', '{"name":"khác"}\n');
    store.edit([{ kind: 'valueTableRemove', name: 'TrangThaiBom' }]);
    expect(await store.save()).toEqual({
      status: 'conflict',
      rel: 'value-tables/TrangThaiBom.json',
    });
    expect(platform.control.removes).toEqual([]);
    const r = await store.resolveConflict('overwrite');
    expect(r.status).toBe('saved');
    expect(platform.control.removes).toEqual(['value-tables/TrangThaiBom.json']);
  });

  it('tags.json của project 0.2 ghi mỗi Tag một dòng', async () => {
    const { store, platform } = await open02();
    store.edit([
      {
        kind: 'tagUpsert',
        tag: {
          id: 'PUMP02.FAULT',
          kind: 'external',
          type: 'BOOL',
          source: { device: 'plc1', address: 'HR13.0' },
        },
      },
    ]);
    await store.save();
    const text = platform.control.writes.find((w) => w.rel === 'tags.json')!.content;
    expect(text.split('\n').filter((l) => l.startsWith('    {"id"'))).toHaveLength(14);
  });

  it('batch là MỘT bước hoàn tác; Ctrl+Z hoàn tác cả file mới', async () => {
    const { store } = await open02();
    store.edit([
      {
        kind: 'batch',
        edits: [
          { kind: 'valueTableUpsert', table: NEW_TABLE },
          { kind: 'tagField', index: 0, field: 'description', value: 'đổi' },
        ],
      },
    ]);
    expect(store.state.history.past).toHaveLength(1);
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.docs['value-tables/Van.json']).toBeUndefined();
  });

  it('lỗi do sửa hiện ngay trong kết quả kiểm: địa chỉ sai thì E_ADDR_SYNTAX và không có project đã nạp', async () => {
    const files = full02();
    const tags = JSON.parse(files['tags.json']) as { tags: Array<Record<string, unknown>> };
    (tags.tags[0].source as Record<string, unknown>).address = 'HR12.16';
    files['tags.json'] = JSON.stringify(tags, null, 2) + '\n';
    const { store } = await open02(files);
    expect(store.state.issues.map((i) => i.code)).toContain('E_ADDR_SYNTAX');
    expect(store.state.loaded02).toBeNull();
  });
});

describe('StudioStore: nâng cấp 0.1 → 0.2, chỉ đọc, từ chối', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const REWRITTEN = [
    'logging.json',
    'project.json',
    'screens/tank-motor.bindings.json',
    'screens/tank-motor.screen.json',
    'tags.json',
  ];

  it('mở project 0.1: đề nghị nâng cấp kèm kế hoạch (5 Tag mock thành Tag mô phỏng legacy); chưa đổi gì trên đĩa', async () => {
    const { store, platform } = await opened();
    expect(store.state.pendingUpgrade).toBe(true);
    expect(store.state.outline.version).toBe('0.1');
    await vi.advanceTimersByTimeAsync(10);
    await store.idle();
    const plan = store.state.upgradePlan;
    expect(plan && plan.ok && plan.changes.find((c) => c.kind === 'legacyTags')).toEqual({
      kind: 'legacyTags',
      count: 5,
    });
    expect(platform.control.writes).toEqual([]);
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('Nâng cấp: tài liệu 0.2 trong bộ nhớ, đĩa không đổi; các file đã viết lại chưa lưu; kiểm tra không lỗi', async () => {
    const { store, platform } = await opened();
    const r = await store.upgrade('0.2');
    expect(r.ok).toBe(true);
    expect(store.state.pendingUpgrade).toBe(false);
    expect(store.state.outline.version).toBe('0.2');
    expect(store.dirtyFiles().sort()).toEqual(REWRITTEN);
    expect(platform.control.writes).toEqual([]);
    expect((store.state.outline.tags?.tags[0] as { kind?: string }).kind).toBe('simulation');
    expect(store.state.docs['tags.json'].editable).toBe(true);
    await settle(store);
    expect(store.state.issues.filter((i) => i.code.startsWith('E_'))).toEqual([]);
    expect(store.state.upgrade).toMatchObject({ from: '0.1.0', backup: null });
  });

  it('lưu lần đầu sau khi nâng cấp: sao lưu trước (đúng các file đã viết lại, hash lúc đọc), rồi ghi; báo thư mục sao lưu', async () => {
    const { store, platform } = await opened();
    await store.upgrade('0.2');
    const result = await store.save();
    expect(result.status).toBe('saved');
    expect(platform.control.backups).toHaveLength(1);
    expect(platform.control.backups[0].label).toBe('0.1.0');
    expect(platform.control.backups[0].files.sort()).toEqual(REWRITTEN);
    expect(platform.control.writes.map((w) => w.rel)).toContain('tags.json');
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.upgrade?.backup?.dir).toMatch(/^\.mat-backup\/0\.1\.0-/);
    // Lưu lần sau không sao lưu lại.
    store.edit([{ kind: 'project', field: 'projectName', value: 'Đổi' }]);
    await store.save();
    expect(platform.control.backups).toHaveLength(1);
  });

  it('sao lưu lỗi (exists, changed, io): không ghi file nào, giữ nguyên chưa lưu', async () => {
    const { store, platform } = await opened();
    await store.upgrade('0.2');
    platform.control.backupFailure = 'exists';
    const r = await store.save();
    expect(r).toEqual({ status: 'backup-failed', error: 'exists' });
    expect(platform.control.writes).toEqual([]);
    expect(store.dirtyFiles()).toHaveLength(5);
    platform.control.backupFailure = null;
    expect((await store.save()).status).toBe('saved');
  });

  it('Mở chỉ đọc: mọi sửa bị bỏ, không có gì chưa lưu, lưu không ghi gì', async () => {
    const { store, platform } = await opened();
    store.openReadOnly();
    expect(store.state.readOnly).toBe(true);
    expect(store.state.pendingUpgrade).toBe(false);
    store.edit([EDIT_MAX]);
    store.edit([{ kind: 'project', field: 'projectName', value: 'X' }]);
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.docs['tags.json'].editable).toBe(false);
    expect(await store.save()).toEqual({ status: 'saved', files: [] });
    expect(platform.control.writes).toEqual([]);
    expect(store.commandContext().readOnly).toBe(true);
  });

  it('nâng cấp lỗi (file Tag hỏng): trả lỗi, giữ nguyên project 0.1', async () => {
    const files = tankDemo();
    files['tags.json'] = '{khong phai json';
    const platform = createMockPlatform();
    platform.control.useProject(files);
    const { store } = await opened(platform);
    const r = await store.upgrade('0.2');
    expect(r.ok).toBe(false);
    expect(store.state.outline.version).toBe('0.1');
    expect(store.state.pendingUpgrade).toBe(true);
  });

  it('project mới hơn mức hiểu (0.7.0): từ chối, nêu phiên bản, không đọc thêm, không ghi gì', async () => {
    const files = full02();
    files['project.json'] = files['project.json'].replace('"0.2.0"', '"0.7.0"');
    const platform = createMockPlatform();
    platform.control.useProject(files);
    const store = new StudioStore({ platform });
    expect(await store.openProject()).toBe(true);
    expect(store.state.refusal).toEqual({ version: '0.7.0' });
    expect(store.state.project).toBeNull();
    expect(store.state.docs).toEqual({});
    expect(platform.control.writes).toEqual([]);
  });

  it('đóng project xóa kế hoạch nâng cấp và trạng thái chỉ đọc', async () => {
    const { store } = await opened();
    store.openReadOnly();
    store.closeProject();
    expect(store.state.readOnly).toBe(false);
    expect(store.state.upgrade).toBeNull();
    expect(store.state.pendingUpgrade).toBe(false);
    expect(store.state.refusal).toBeNull();
  });
});
