// Store với project 0.3 (feature 007, T108, T109; research R6, R22): mở và sửa màn hình, navigation; lưu theo định dạng
// format-03; nâng cấp 0.2 → 0.3 và 0.1 → 0.3 trong bộ nhớ; chỉ đọc; từ chối bản mới hơn 0.3.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenModel } from '@mat/project-schema';
import { dashboardDemo, full02, tankDemo } from '../model/test-fixtures.ts';
import { createMockPlatform, type MockPlatform } from '../platform/mock.ts';
import { StudioStore, VALIDATE_DELAY_MS } from './store.ts';

async function opened(files: Record<string, string>) {
  const platform: MockPlatform = createMockPlatform();
  platform.control.useProject(files);
  const store = new StudioStore({ platform });
  expect(await store.openProject()).toBe(true);
  await store.validateNow();
  return { store, platform };
}

async function settle(store: StudioStore) {
  await vi.advanceTimersByTimeAsync(VALIDATE_DELAY_MS + 1);
  await store.idle();
}

const errors = (store: StudioStore) => store.state.issues.filter((i) => i.code.startsWith('E_'));

describe('StudioStore: project 0.3', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('mở dashboard-demo 0.3: hợp lệ, màn hình là tài liệu sửa được, SVG và binding của item svg được đọc, đề nghị nâng cấp lên 0.5 (FR-012)', async () => {
    const { store } = await opened(dashboardDemo());
    const s = store.state;
    expect(s.outline.schema).toBe('0.3');
    expect(s.outline.version).toBe('0.2');
    expect(s.pendingUpgrade).toBe(true);
    expect(s.refusal).toBeNull();
    expect(errors(store)).toEqual([]);
    expect(s.loaded03).not.toBeNull();
    expect(s.outline.screens.map((x) => x.id)).toEqual([
      'tong-quan',
      'bon-nuoc',
      'giam-sat',
      'bom1',
    ]);
    const overview = s.outline.screens[0]!;
    expect(overview.model?.items.length).toBeGreaterThan(20);
    expect(s.docs['screens/tong-quan.screen.json']!.editable).toBe(true);
    expect(s.docs['screens/tong-quan.svg']).toBeDefined();
    expect(Object.keys(overview.itemBindings)).toContain('svg1');
    expect(s.outline.navigation?.items.length).toBeGreaterThan(0);
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('sửa màn hình: một bước hoàn tác, ghi theo định dạng 0.3 (mỗi item một dòng), hoàn tác về sạch', async () => {
    const { store, platform } = await opened(dashboardDemo());
    const model = store.state.outline.screens[1]!.model as ScreenModel;
    const moved: ScreenModel = {
      ...model,
      items: model.items.map((it, i) => (i === 0 ? { ...it, x: it.x + 8 } : it)),
    };
    store.edit([{ kind: 'screenUpsert', screen: moved }]);
    expect(store.dirtyFiles()).toEqual(['screens/bon-nuoc.screen.json']);
    expect((await store.save()).status).toBe('saved');
    const written = platform.control.writes.find((w) => w.rel === 'screens/bon-nuoc.screen.json')!;
    expect(written.content.split('\n').filter((l) => l.startsWith('    {')).length).toBe(
      moved.items.length,
    );
    store.undo();
    expect(store.state.outline.screens[1]!.model?.items[0]!.x).toBe(model.items[0]!.x);
    expect(store.dirtyFiles()).toEqual(['screens/bon-nuoc.screen.json']);
    store.redo();
    expect(store.dirtyFiles()).toEqual([]);
  });

  it('thêm màn hình mới: file mới và id vào project.json; xóa: file bị xóa khi lưu; hoàn tác khôi phục', async () => {
    const { store, platform } = await opened(dashboardDemo());
    const scr: ScreenModel = {
      schemaVersion: '0.3.0',
      id: 'moi',
      name: 'Mới',
      kind: 'screen',
      size: { width: 1280, height: 720 },
      items: [],
    };
    store.edit([{ kind: 'screenUpsert', screen: scr }]);
    expect(store.state.outline.screens.map((x) => x.id)).toContain('moi');
    expect(store.dirtyFiles().sort()).toEqual(['project.json', 'screens/moi.screen.json']);
    await settle(store);
    expect(errors(store)).toEqual([]);
    await store.save();
    const order = platform.control.writes.map((w) => w.rel);
    expect(order.indexOf('screens/moi.screen.json')).toBeLessThan(order.indexOf('project.json'));
    store.edit([{ kind: 'screenRemove', id: 'moi' }]);
    expect(store.state.outline.screens.map((x) => x.id)).not.toContain('moi');
    expect(store.dirtyFiles()).toContain('screens/moi.screen.json');
    store.undo();
    expect(store.state.outline.screens.map((x) => x.id)).toContain('moi');
  });

  it('đặt navigation', async () => {
    const { store } = await opened(dashboardDemo());
    store.edit([
      { kind: 'navigation', value: { position: 'top', items: [{ label: 'A', screen: 'bom1' }] } },
    ]);
    expect(store.state.outline.navigation?.position).toBe('top');
    store.edit([{ kind: 'navigation', value: undefined }]);
    expect(store.state.outline.navigation).toBeNull();
  });

  it('nâng cấp 0.2 → 0.3: tài liệu 0.3 trong bộ nhớ, đĩa không đổi, màn hình sửa được, sao lưu lần lưu đầu', async () => {
    const { store, platform } = await opened(full02());
    expect(store.state.pendingUpgrade).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    await store.idle();
    const plan = store.state.upgradePlan;
    expect(plan && plan.ok && plan.changes.some((c) => c.kind === 'screens')).toBe(true);
    const r = await store.upgrade();
    expect(r.ok).toBe(true);
    expect(store.state.outline.schema).toBe('0.3');
    expect(platform.control.writes).toEqual([]);
    const id = store.state.outline.screens[0]!.id;
    expect(store.state.docs[`screens/${id}.screen.json`]!.editable).toBe(true);
    expect(store.state.outline.screens[0]!.model?.items[0]?.type).toBe('svg');
    await settle(store);
    expect(errors(store)).toEqual([]);
    expect((await store.save()).status).toBe('saved');
    expect(platform.control.backups[0]!.label).toBe('0.2.0');
  });

  it('nâng cấp 0.1 → 0.5 trong một lần (tank-demo), có làm sạch SVG của 0.4', async () => {
    const { store } = await opened(tankDemo());
    expect(store.state.pendingUpgrade).toBe(true);
    const r = await store.upgrade();
    expect(r.ok).toBe(true);
    expect(store.state.outline.schema).toBe('0.3');
    await settle(store);
    // Bước nâng cấp làm sạch SVG theo allowlist 0.4 (bỏ `title` ở gốc của SVG 0.1): không còn E_SVG_UNSAFE.
    expect(errors(store)).toEqual([]);
    const plan = store.state.upgrade;
    expect(plan?.from).toBe('0.1.0');
    expect(plan?.files.map((f) => f.rel)).toContain('screens/tank-motor.svg');
  });

  it('nâng cấp 0.3 → 0.5 (dashboard-demo): đĩa chưa đổi, lưu lần đầu sao lưu bản 0.3.0 rồi ghi 0.5.0 và runtime 0.8.0', async () => {
    const { store, platform } = await opened(dashboardDemo());
    expect(store.state.pendingUpgrade).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    await store.idle();
    const plan = store.state.upgradePlan;
    expect(plan && plan.ok && plan.changes.some((c) => c.kind === 'minRuntime')).toBe(true);
    const r = await store.upgrade();
    expect(r.ok).toBe(true);
    expect(store.state.pendingUpgrade).toBe(false);
    expect(platform.control.writes).toEqual([]);
    await settle(store);
    expect(errors(store)).toEqual([]);
    expect((await store.save()).status).toBe('saved');
    expect(platform.control.backups[0]!.label).toBe('0.3.0');
    const project = platform.control.writes.find((w) => w.rel === 'project.json')!.content;
    expect(project).toMatch(/"schemaVersion": "0\.5\.0"/);
    expect(project).toMatch(/"minRuntimeVersion": "0\.8\.0"/);
    expect(
      platform.control.writes.filter((w) => w.rel.endsWith('.screen.json')).length,
    ).toBeGreaterThan(0);
  });

  it('mở chỉ đọc project 0.2: mọi sửa bị bỏ', async () => {
    const { store } = await opened(full02());
    store.openReadOnly();
    store.edit([{ kind: 'project', field: 'projectName', value: 'X' }]);
    expect(store.dirtyFiles()).toEqual([]);
    expect(store.state.outline.schema).toBe('0.2');
  });

  it('project 0.6.0: từ chối', async () => {
    const files = dashboardDemo();
    files['project.json'] = files['project.json']!.replace('"0.3.0"', '"0.6.0"');
    const platform = createMockPlatform();
    platform.control.useProject(files);
    const store = new StudioStore({ platform });
    await store.openProject();
    expect(store.state.refusal).toEqual({ version: '0.6.0' });
  });
});
