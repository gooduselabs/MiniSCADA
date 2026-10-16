// Studio với định dạng 1.0.0 (feature 011, T016; FR-002, R32): project 0.1 đến 0.6 được đề nghị nâng cấp lên 1.0.0 (một
// lần, sao lưu `.mat-backup/` ở lần lưu đầu như 007); project 1.0 mở thẳng (đọc cả logic.json và template); 1.1 trở lên
// bị từ chối; Nạp xuống project 1.0 vào runtime cũ (system/info không có `update`, `logic`) bị khóa kèm lời nhắc.
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptsFormat10, type DeviceInfo } from '../model/device.ts';
import { runtimeRowOf } from '../model/download-flow.ts';
import { readProjectDir } from '../model/test-fixtures.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import { StudioStore, VALIDATE_DELAY_MS } from './store.ts';

const ROOT = resolve(__dirname, '../../../..');
const historyDemo = () => readProjectDir(resolve(ROOT, 'projects/history-demo')); // 0.6.0
const vector10 = () => readProjectDir(resolve(ROOT, 'tests/project-vectors/v10-valid-full'));

async function opened(files: Record<string, string>) {
  const platform: MockPlatform = createMockPlatform();
  platform.control.useProject(files);
  const store = new StudioStore({ platform });
  expect(await store.openProject()).toBe(true);
  await store.validateNow();
  return { store, platform };
}
const errors = (store: StudioStore) => store.state.issues.filter((i) => i.code.startsWith('E_'));

describe('StudioStore: định dạng 1.0', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('mở project 1.0: không đề nghị nâng cấp, đọc logic.json và template, hợp lệ', async () => {
    const files = vector10();
    delete files['expected.json'];
    const { store } = await opened(files);
    const s = store.state;
    expect(s.refusal).toBeNull();
    expect(s.pendingUpgrade).toBe(false);
    expect(s.outline.format10).toBe(true);
    expect(s.outline.format06).toBe(true); // lưu trữ, báo cáo sửa được như 0.6
    expect(s.outline.logicFile).toBe('logic.json');
    expect(s.outline.templateFiles).toEqual(['templates/bom.template.json']);
    expect(s.docs['logic.json']).toBeDefined();
    expect(s.docs['templates/bom.template.json']).toBeDefined();
    expect(errors(store)).toEqual([]);
    expect(s.loaded03).not.toBeNull();
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('nâng cấp 0.6 → 1.0 (history-demo): đĩa chưa đổi, lưu lần đầu sao lưu bản 0.6.0 rồi ghi 1.0.0 và runtime 1.0.0', async () => {
    const { store, platform } = await opened(historyDemo());
    expect(store.state.pendingUpgrade).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    await store.idle();
    const plan = store.state.upgradePlan;
    expect(plan && plan.ok && plan.changes).toContainEqual({
      kind: 'minRuntime',
      version: '1.0.0',
    });
    const r = await store.upgrade();
    expect(r.ok).toBe(true);
    expect(store.state.pendingUpgrade).toBe(false);
    expect(store.state.outline.format10).toBe(true);
    expect(platform.control.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
    await store.idle();
    expect(errors(store)).toEqual([]);
    expect((await store.save()).status).toBe('saved');
    expect(platform.control.backups[0]!.label).toBe('0.6.0');
    const project = platform.control.writes.find((w) => w.rel === 'project.json')!.content;
    expect(project).toMatch(/"schemaVersion": "1\.0\.0"/);
    expect(project).toMatch(/"minRuntimeVersion": "1\.0\.0"/);
    // thuần thêm: không tạo logic.json hay template
    expect(platform.control.writes.map((w) => w.rel)).not.toContain('logic.json');
  });

  it('project 1.1.0 và 0.7.0: từ chối (Studio chưa hiểu)', async () => {
    for (const v of ['1.1.0', '0.7.0', '2.0.0']) {
      const files = historyDemo();
      files['project.json'] = files['project.json']!.replace('"0.6.0"', `"${v}"`);
      const platform = createMockPlatform();
      platform.control.useProject(files);
      const store = new StudioStore({ platform });
      await store.openProject();
      expect(store.state.refusal, v).toEqual({ version: v });
    }
  });
});

describe('Nạp xuống project 1.0 vào runtime cũ (R32)', () => {
  const old: DeviceInfo = { runtimeVersion: '0.9.0', warnings: [] } as DeviceInfo;
  const v10: DeviceInfo = {
    runtimeVersion: '1.0.0',
    update: { supported: false, enabled: false },
    logic: { present: false, writes: 'off' },
  } as DeviceInfo;
  const local = (minRuntimeVersion: string) => ({
    projectId: 'p',
    projectName: 'P',
    projectVersion: '1.0.0',
    minRuntimeVersion,
  });

  it('acceptsFormat10: thiết bị có khối update hoặc logic của system/info', () => {
    expect(acceptsFormat10(old)).toBe(false);
    expect(acceptsFormat10(null)).toBe(false);
    expect(acceptsFormat10(v10)).toBe(true);
    expect(acceptsFormat10({ logic: { writes: 'off' } } as DeviceInfo)).toBe(true);
  });

  it('runtime cũ: dòng runtime lỗi kèm lời nhắc "Runtime cũ không nhận 1.0.0"', () => {
    expect(runtimeRowOf(local('1.0.0'), old)).toEqual({
      id: 'runtime',
      status: 'error',
      required: '1.0.0',
      device: '0.9.0',
      format10: true,
    });
  });
  it('runtime 1.0: được nạp; project 0.x vào runtime cũ: không có lời nhắc 1.0', () => {
    expect(runtimeRowOf(local('1.0.0'), v10)).toMatchObject({ status: 'ok', format10: false });
    expect(runtimeRowOf(local('0.9.0'), old)).toMatchObject({ status: 'ok', format10: false });
    expect(runtimeRowOf(local('1.0.0'), null)).toMatchObject({
      status: 'unknown',
      format10: false,
    });
  });
});
