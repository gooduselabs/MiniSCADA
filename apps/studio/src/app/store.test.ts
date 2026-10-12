// Store của Studio (feature 004, T015, data-model §3–§6, §8): mở project, sửa, kiểm tra liên tục (chỉ áp
// kết quả mới nhất), hoàn tác, tab, lựa chọn, lưu và xung đột khi file bị sửa ngoài Studio.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ValidationResult } from '@mat/project-schema';
import { validateProject } from '@mat/project-schema';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import { StudioStore, VALIDATE_DELAY_MS } from './store.ts';

const EDIT_MAX = { kind: 'tagField', index: 0, field: 'max', value: -1 } as const;

async function opened(platform: MockPlatform = createMockPlatform()) {
  const store = new StudioStore({ platform });
  expect(await store.openProject()).toBe(true);
  await store.validateNow();
  return { store, platform };
}

/** Chạy hết hẹn giờ kiểm tra và chờ promise kiểm tra xong. */
async function settle(store: StudioStore) {
  await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
  await store.idle();
}

describe('StudioStore', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('mở project: nạp các file, cây có dữ liệu, chỉ có tab Bắt đầu, project mẫu hợp lệ', async () => {
    const { store } = await opened();
    const s = store.state;
    expect(s.project?.display).toContain('tank-demo');
    expect(s.outline.project?.projectId).toBe('tank-demo');
    expect(s.outline.tags?.tags).toHaveLength(5);
    expect(Object.keys(s.docs)).toEqual(
      expect.arrayContaining([
        'project.json',
        'tags.json',
        'logging.json',
        'screens/tank-motor.svg',
      ]),
    );
    expect(s.tabs).toEqual(['start']);
    expect(s.active).toBe('start');
    expect(s.issues.filter((i) => i.code.startsWith('E_'))).toEqual([]);
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('hủy hộp thoại chọn thư mục: giữ nguyên trạng thái', async () => {
    const platform = createMockPlatform();
    platform.pickProject = async () => null;
    const store = new StudioStore({ platform });
    expect(await store.openProject()).toBe(false);
    expect(store.state.project).toBeNull();
  });

  it('sửa Tag: tài liệu chưa lưu, kiểm tra chạy 250 ms sau lần sửa cuối và báo E_TAG_RANGE', async () => {
    const { store } = await opened();
    store.edit([EDIT_MAX], 'tags:0:max');
    expect(store.dirtyFiles()).toEqual(['tags.json']);
    await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS - 50);
    expect(store.state.issues.some((i) => i.code === 'E_TAG_RANGE')).toBe(false);
    await settle(store);
    expect(store.state.issues.some((i) => i.code === 'E_TAG_RANGE')).toBe(true);
    expect(store.commandContext().errorCount).toBeGreaterThan(0);
  });

  it('kết quả kiểm tra cũ về sau không đè kết quả mới (checkSeq)', async () => {
    const platform = createMockPlatform();
    const resolvers: Array<(r: ValidationResult) => void> = [];
    const validate = vi.fn(() => new Promise<ValidationResult>((res) => resolvers.push(res)));
    const store = new StudioStore({ platform, validate });
    await store.openProject();
    const old: ValidationResult = {
      valid: false,
      errors: [{ code: 'E_JSON', file: 'a', path: '', message: 'cũ' }],
      warnings: [],
    };
    const fresh: ValidationResult = { valid: true, errors: [], warnings: [] };
    store.edit([EDIT_MAX]);
    await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
    store.edit([{ kind: 'tagField', index: 0, field: 'max', value: 100 }]);
    await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
    const n = resolvers.length;
    expect(n).toBeGreaterThanOrEqual(2);
    resolvers[n - 1](fresh);
    await Promise.resolve();
    resolvers[n - 2](old);
    await store.idle();
    expect(store.state.issues).toEqual([]);
  });

  it('hoàn tác và làm lại; sửa về như cũ thì hết chưa lưu', async () => {
    const { store } = await opened();
    store.edit(
      [{ kind: 'project', field: 'projectName', value: 'Trạm mới' }],
      'settings:projectName',
    );
    expect(store.dirtyFiles()).toEqual(['project.json']);
    expect(store.commandContext().canUndo).toBe(true);
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.commandContext().canRedo).toBe(true);
    store.redo();
    expect((store.state.outline.project as { projectName: string }).projectName).toBe('Trạm mới');
  });

  it('tab: một editor một tab, Bắt đầu không đóng được, đóng tab đang chọn thì chọn tab bên cạnh', async () => {
    const { store } = await opened();
    store.openTab('tags');
    store.openTab('settings');
    store.openTab('tags');
    expect(store.state.tabs).toEqual(['start', 'tags', 'settings']);
    expect(store.state.active).toBe('tags');
    store.closeTab('start');
    expect(store.state.tabs).toContain('start');
    store.closeTab('tags');
    expect(store.state.tabs).toEqual(['start', 'settings']);
    expect(store.state.active).toBe('start');
  });

  it('lựa chọn và người nghe: báo sau mỗi thay đổi, hủy đăng ký thì thôi báo', async () => {
    const { store } = await opened();
    const seen: unknown[] = [];
    const off = store.subscribe((s) => seen.push(s.selection));
    store.select({ kind: 'tag', row: 2 });
    store.select({ kind: 'element', screen: 'tank-motor', uid: 'el_tank_level' });
    off();
    store.select(null);
    expect(seen).toEqual([
      { kind: 'tag', row: 2 },
      { kind: 'element', screen: 'tank-motor', uid: 'el_tank_level' },
    ]);
  });

  it('lưu: chỉ ghi file đã đổi, kèm hash lúc đọc; xong thì hết chưa lưu', async () => {
    const { store, platform } = await opened();
    store.edit([{ kind: 'project', field: 'projectName', value: 'Trạm mới' }]);
    expect(await store.save()).toEqual({ status: 'saved', files: ['project.json'] });
    expect(platform.control.writes.map((w) => w.rel)).toEqual(['project.json']);
    expect(store.dirtyFiles()).toEqual([]);
    expect(await store.save()).toEqual({ status: 'saved', files: [] });
  });

  it('lưu được cả khi project còn lỗi (FR-023)', async () => {
    const { store, platform } = await opened();
    store.edit([EDIT_MAX]);
    await settle(store);
    expect(await store.save()).toEqual({ status: 'saved', files: ['tags.json'] });
    expect(platform.control.writes).toHaveLength(1);
  });

  it('xung đột: file bị sửa ngoài Studio → Hủy giữ chưa lưu; Ghi đè ghi với force', async () => {
    const { store, platform } = await opened();
    platform.control.editOutside('project.json', '{"projectName":"ngoài"}\n');
    store.edit([{ kind: 'project', field: 'projectName', value: 'Trạm mới' }]);
    expect(await store.save()).toEqual({ status: 'conflict', rel: 'project.json' });
    expect(store.state.conflict).toEqual({ rel: 'project.json' });
    await store.resolveConflict('cancel');
    expect(store.state.conflict).toBeNull();
    expect(store.dirtyFiles()).toEqual(['project.json']);
    expect(await store.save()).toEqual({ status: 'conflict', rel: 'project.json' });
    expect(await store.resolveConflict('overwrite')).toEqual({
      status: 'saved',
      files: ['project.json'],
    });
    expect(store.dirtyFiles()).toEqual([]);
    expect(platform.control.writes.at(-1)?.content).toContain('Trạm mới');
  });

  it('xung đột → Tải lại: lấy nội dung trên đĩa, hết chưa lưu, vẫn hoàn tác được', async () => {
    const { store, platform } = await opened();
    const outside = '{"schemaVersion":"0.1.0","tags":[]}\n';
    platform.control.editOutside('tags.json', outside);
    store.edit([EDIT_MAX]);
    expect(await store.save()).toEqual({ status: 'conflict', rel: 'tags.json' });
    await store.resolveConflict('reload');
    expect(store.state.conflict).toBeNull();
    expect(store.state.docs['tags.json'].diskText).toBe(outside);
    expect(store.dirtyFiles()).toEqual([]);
    store.undo();
    expect(store.dirtyFiles()).toEqual(['tags.json']);
  });

  it('lỗi ghi khác: giữ chưa lưu, ghi lại lỗi kèm chi tiết', async () => {
    const { store, platform } = await opened();
    platform.control.failWrites = 'io';
    store.edit([{ kind: 'project', field: 'projectName', value: 'X' }]);
    expect(await store.save()).toEqual({
      status: 'error',
      rel: 'project.json',
      error: 'io',
      detail: 'mock',
    });
    expect(store.dirtyFiles()).toEqual(['project.json']);
    expect(store.state.lastSaveError).toEqual({ rel: 'project.json', error: 'io', detail: 'mock' });
  });

  it('F7: đọc lại file chưa sửa trên đĩa rồi kiểm toàn bộ; file đang sửa giữ nội dung đang sửa', async () => {
    const { store, platform } = await opened();
    store.edit([{ kind: 'project', field: 'projectName', value: 'Đang sửa' }]);
    platform.control.editOutside('tags.json', '{"schemaVersion":"0.1.0","tags":[]}\n');
    await store.validateNow();
    expect(store.state.outline.tags?.tags).toEqual([]);
    expect((store.state.outline.project as { projectName: string }).projectName).toBe('Đang sửa');
    expect(store.state.issues.some((i) => i.code === 'E_REF_TAG')).toBe(true);
  });

  it('kiểm tra dùng nội dung đang sửa: cùng kết luận với bộ kiểm tra chạy trên file đã sửa', async () => {
    const { store } = await opened();
    store.edit([EDIT_MAX]);
    await settle(store);
    const direct = await validateProject({
      read: async (rel) => {
        const doc = store.state.docs[rel];
        return doc ? { text: store.textOf(rel) } : { error: 'missing' };
      },
    });
    expect(store.state.issues.map((i) => i.code).sort()).toEqual(
      [...direct.errors, ...direct.warnings].map((i) => i.code).sort(),
    );
  });

  it('đóng project: về trạng thái ban đầu, kết quả kiểm còn chạy bị bỏ', async () => {
    const { store } = await opened();
    store.openTab('tags');
    store.edit([EDIT_MAX]);
    store.closeProject();
    expect(store.state.project).toBeNull();
    expect(store.state.tabs).toEqual(['start']);
    expect(store.state.docs).toEqual({});
    expect(store.dirtyFiles()).toEqual([]);
    await settle(store);
    expect(store.state.issues).toEqual([]);
    expect(store.commandContext().canUndo).toBe(false);
  });

  it('ngữ cảnh lệnh lấy từ trạng thái và phần giao diện truyền vào', async () => {
    const store = new StudioStore({ platform: createMockPlatform() });
    expect(store.commandContext().hasProject).toBe(false);
    await store.openProject();
    store.openTab('tags');
    const ctx = store.commandContext({ monitoring: true, tagGridFocused: true, cellRow: 3 });
    expect(ctx).toMatchObject({
      hasProject: true,
      activeEditor: 'tags',
      monitoring: true,
      tagGridFocused: true,
      cellRow: 3,
    });
  });
});

describe('StudioStore — nội dung chờ ghi (feature 005, T132, FR-030)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  const LOGGING = '{\n  "timeZone": "UTC",\n  "groups": [],\n  "connections": []\n}\n';

  it('thay cả file thành nội dung chờ ghi: chưa lưu, Ctrl+Z bỏ được, Ctrl+Y đặt lại', async () => {
    const { store } = await opened();
    const original = store.state.docs['logging.json'].diskText;
    store.applyChange({ replace: { 'logging.json': LOGGING } });
    expect(store.dirtyFiles()).toEqual(['logging.json']);
    expect(store.textOf('logging.json')).toBe(LOGGING);
    expect(store.state.outline.logging?.groups).toEqual([]);
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.textOf('logging.json')).toBe(original);
    store.redo();
    expect(store.dirtyFiles()).toEqual(['logging.json']);
  });

  it('Lưu ghi đúng nội dung chờ ghi (kèm hash đã đọc) rồi hết chưa lưu', async () => {
    const { store, platform } = await opened();
    store.applyChange({ replace: { 'logging.json': LOGGING } });
    expect(await store.save()).toEqual({ status: 'saved', files: ['logging.json'] });
    expect(platform.control.writes).toEqual([{ rel: 'logging.json', content: LOGGING }]);
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.docs['logging.json'].diskText).toBe(LOGGING);
  });

  it('một lần áp gồm sửa đối tượng và thay file là MỘT bước hoàn tác', async () => {
    const { store } = await opened();
    const max = (store.state.outline.tags?.tags[0] as { max?: number }).max;
    store.applyChange({
      edits: [{ kind: 'tagField', index: 0, field: 'max', value: 123456 }],
      replace: { 'logging.json': LOGGING },
    });
    expect(store.dirtyFiles().sort()).toEqual(['logging.json', 'tags.json']);
    store.undo();
    expect(store.dirtyFiles()).toEqual([]);
    expect((store.state.outline.tags?.tags[0] as { max?: number }).max).toBe(max);
    expect(store.state.history.past).toHaveLength(0);
  });

  it('file chỉ có trên thiết bị: tạo tài liệu mới (ghi với hash null), hoàn tác bỏ tài liệu', async () => {
    const { store, platform } = await opened();
    store.applyChange({
      replace: { 'screens/moi.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' },
    });
    expect(store.dirtyFiles()).toEqual(['screens/moi.svg']);
    store.undo();
    expect(store.state.docs['screens/moi.svg']).toBeUndefined();
    store.redo();
    const r = await store.save();
    expect(r).toEqual({ status: 'saved', files: ['screens/moi.svg'] });
    expect(platform.control.writes.map((w) => w.rel)).toEqual(['screens/moi.svg']);
  });

  it('không có gì đổi (nội dung giống đĩa) thì không ghi bước hoàn tác', async () => {
    const { store } = await opened();
    store.applyChange({ replace: { 'logging.json': store.state.docs['logging.json'].diskText } });
    expect(store.state.history.past).toHaveLength(0);
  });
});
