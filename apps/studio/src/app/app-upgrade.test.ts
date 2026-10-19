// Nút Nâng cấp của hộp thoại mở project cũ (feature 011, FR-002): project 0.6.0 phải nâng cấp được lên 1.0.0. Lỗi cũ:
// `upgradeProject` gọi `store.upgrade('0.6')` nên project đã 0.6 trả `ALREADY_06` và Studio báo "lỗi không rõ".
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readProjectDir } from '../model/test-fixtures.ts';
import { createMockPlatform } from '../platform/mock.ts';
import { StudioApp } from './app.ts';

const ROOT = resolve(__dirname, '../../../..');

describe('StudioApp.upgradeProject', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('project 0.6.0: Nâng cấp thành công lên 1.0.0, không báo lỗi', async () => {
    const platform = createMockPlatform();
    platform.control.useProject(readProjectDir(resolve(ROOT, 'projects/history-demo'))); // 0.6.0
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
    expect(app.store.state.outline.format10).toBe(true);
    expect(app.ui.toast?.text ?? '').not.toMatch(/Không nâng cấp được/);
  });
});
