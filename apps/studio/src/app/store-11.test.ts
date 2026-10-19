// Studio với định dạng 1.1 (feature 012, T015; contracts/project-format-1.1.md §1): project 1.1 mở thẳng; project 1.0
// được đề nghị nâng cấp lên 1.1 (một lần, sao lưu ở lần lưu đầu), đổi cả logic.json và template; 1.2 trở lên bị từ chối;
// nút Nâng cấp của hộp thoại đưa 0.6 và 1.0 lên thẳng 1.1.
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readProjectDir } from '../model/test-fixtures.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import { StudioApp } from './app.ts';
import { StudioStore, VALIDATE_DELAY_MS } from './store.ts';

const ROOT = resolve(__dirname, '../../../..');
const vector = (name: string) => {
  const f = readProjectDir(resolve(ROOT, 'tests/project-vectors', name));
  delete f['expected.json'];
  return f;
};

async function opened(files: Record<string, string>) {
  const platform: MockPlatform = createMockPlatform();
  platform.control.useProject(files);
  const store = new StudioStore({ platform });
  expect(await store.openProject()).toBe(true);
  await store.validateNow();
  return { store, platform };
}
const errors = (store: StudioStore) => store.state.issues.filter((i) => i.code.startsWith('E_'));

describe('StudioStore: định dạng 1.1', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('mở project 1.1 (lưới, chủ đề): không đề nghị nâng cấp, hợp lệ, format11', async () => {
    const { store } = await opened(vector('v11-valid-full'));
    expect(store.state.pendingUpgrade).toBe(false);
    expect(store.state.outline.format11).toBe(true);
    expect(store.state.outline.format10).toBe(true); // họ 1.x: template, logic sửa được như 1.0
    expect(errors(store)).toEqual([]);
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('project 1.0: đề nghị nâng cấp; Nâng cấp lên 1.1 rồi Lưu ghi 1.1.0 ở mọi tệp, runtime 1.1.0', async () => {
    const { store, platform } = await opened(vector('v10-valid-full'));
    expect(store.state.pendingUpgrade).toBe(true);
    expect(store.state.outline.format11).toBe(false);
    const r = await store.upgrade();
    expect(r.ok).toBe(true);
    expect(store.state.outline.format11).toBe(true);
    await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
    await store.idle();
    expect(errors(store)).toEqual([]);
    expect((await store.save()).status).toBe('saved');
    expect(platform.control.backups[0]!.label).toBe('1.0.0');
    const text = (rel: string) => platform.control.writes.find((w) => w.rel === rel)?.content;
    expect(text('project.json')).toMatch(/"schemaVersion": "1\.1\.0"/);
    expect(text('project.json')).toMatch(/"minRuntimeVersion": "1\.1\.0"/);
    expect(text('logic.json')).toMatch(/"schemaVersion": "1\.1\.0"/);
    expect(text('templates/bom.template.json')).toMatch(/"schemaVersion": "1\.1\.0"/);
  });

  it('project 1.2.0: từ chối (Studio chưa hiểu)', async () => {
    const files = vector('v11-valid-full');
    files['project.json'] = files['project.json']!.replace('"1.1.0"', '"1.2.0"');
    const platform = createMockPlatform();
    platform.control.useProject(files);
    const store = new StudioStore({ platform });
    await store.openProject();
    expect(store.state.refusal).toEqual({ version: '1.2.0' });
  });
});

describe('StudioApp.upgradeProject lên 1.1', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  for (const [label, files] of [
    ['0.6.0 (history-demo)', () => readProjectDir(resolve(ROOT, 'projects/history-demo'))],
    ['1.0.0 (v10-valid-full)', () => vector('v10-valid-full')],
  ] as const)
    it(`project ${label}: nút Nâng cấp đưa lên 1.1, không báo lỗi`, async () => {
      const platform = createMockPlatform();
      platform.control.useProject(files());
      const data = new Map<string, string>();
      const storage = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      };
      const app = new StudioApp({ platform, storage, windowWidth: 1400, versionGate: true });
      await app.start();
      await app.run('project.open');
      await app.store.idle();
      expect(app.store.state.pendingUpgrade).toBe(true);
      await app.upgradeProject();
      expect(app.store.state.pendingUpgrade).toBe(false);
      expect(app.store.state.outline.format11).toBe(true);
      expect(app.ui.toast?.text ?? '').not.toMatch(/Không nâng cấp được/);
    });
});
