// Editor So sánh (feature 005, T136, US3, FR-029, FR-030; mockup đã duyệt openCompare): bảng đối tượng `= ≠ + -`
// lọc theo trạng thái và kind, khác biệt từng trường, "Đọc lên phần chọn" (chỉ engineer), "Nạp xuống phần khác",
// câu "giống hệt", bàn phím và ARIA. Chạy trên DeviceLink giả, đồng hồ giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { MockDevice } from '../../platform/mock-device.ts';
import { newOnlineApp, pinnedDevice, textOf, type OnlineEnv } from '../online-test-helpers.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import '../dialogs/devices-dialog.ts';
import '../dialogs/login-dialog.ts';
import './compare-editor.ts';
import type { MatCompareEditor } from './compare-editor.ts';

const apps: StudioApp[] = [];

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

async function until(pred: () => boolean, label = 'điều kiện') {
  for (let i = 0; i < 400 && !pred(); i++) await advance(10);
  expect(pred(), label).toBe(true);
}

/** Bản của thiết bị: Tag LEVEL đổi max, bỏ TEMP, thêm DEV.ONLY (tags.json đọc từ project mẫu). */
async function deviceTags(env: OnlineEnv): Promise<string> {
  const r = await env.platform.read('tags.json');
  if (!('text' in r)) throw new Error('không đọc được tags.json');
  const tags = JSON.parse(r.text) as { tags: Array<Record<string, unknown>> };
  tags.tags[0].max = 120;
  tags.tags.splice(
    tags.tags.findIndex((x) => x.id === 'TANK01.TEMP'),
    1,
  );
  tags.tags.push({
    id: 'DEV.ONLY',
    type: 'BOOL',
    description: 'Chỉ có trên thiết bị',
    source: { kind: 'mock', signal: 'motor.run' },
  });
  return JSON.stringify(tags, null, 2) + '\n';
}

interface Env extends OnlineEnv {
  el: MatCompareEditor;
  dev: MockDevice;
}

/** Online với `user`, thiết bị đã sửa (hoặc giống hệt khi `same`), editor So sánh đã mở và so xong. */
async function setup(opts: { user?: string; same?: boolean } = {}): Promise<Env> {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  await env.app.store.validateNow();
  const user = opts.user ?? 'kysu1';
  if (!opts.same) env.dev.control.editStored('BL335-01', 'tags.json', await deviceTags(env));
  for (const tag of ['mat-devices-dialog', 'mat-login-dialog']) await mount(tag, env.app);
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await advance();
  await env.app.login(user, env.pw(user));
  await advance(50);
  const el = await mount<MatCompareEditor>('mat-compare-editor', env.app);
  await until(
    () => !env.app.session.compare.busy && env.app.session.compare.info !== null,
    'đã so',
  );
  return { ...env, el };
}

const rows = (el: Element) => [...el.querySelectorAll<HTMLElement>('tr[data-key]')];
const rowOf = (el: Element, key: string) =>
  el.querySelector<HTMLElement>(`tr[data-key="${key}"]`) ?? undefined;
const symbolOf = (el: Element, key: string) => rowOf(el, key)?.dataset.status;
const role = <T extends HTMLElement>(el: Element, r: string) =>
  el.querySelector<T>(`[data-role="${r}"]`);
const fieldRows = (el: Element) =>
  [...el.querySelectorAll('[data-table="fields"] tbody tr')].map((tr) => textOf(tr));

describe('editor So sánh', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('bảng đối tượng: ký hiệu = ≠ + - đúng từng dòng, có chữ kèm ký hiệu (không chỉ màu)', async () => {
    const { el } = await setup();
    expect(symbolOf(el, 'TANK01.LEVEL')).toBe('≠');
    expect(symbolOf(el, 'TANK01.TEMP')).toBe('+');
    expect(symbolOf(el, 'DEV.ONLY')).toBe('-');
    expect(symbolOf(el, 'MOTOR01.RUN')).toBe('=');
    expect(textOf(rowOf(el, 'TANK01.TEMP'))).toContain('chỉ có trên máy');
    expect(textOf(rowOf(el, 'DEV.ONLY'))).toContain('chỉ có trên thiết bị');
    const grid = el.querySelector('table[role="grid"]');
    expect(grid?.getAttribute('aria-label')).toBeTruthy();
    expect(el.querySelector('[data-role="legend"]')?.textContent).toContain('khác');
  });

  it('lọc theo trạng thái (nút lọc, aria-pressed) và theo kind (ô chọn)', async () => {
    const { el } = await setup();
    const all = rows(el).length;
    role(el, 'status-≠')!.click();
    await advance();
    expect(role(el, 'status-≠')!.getAttribute('aria-pressed')).toBe('true');
    expect(rows(el).map((r) => r.dataset.status)).toEqual(['≠']);
    expect(rows(el)[0].dataset.key).toBe('TANK01.LEVEL');
    role(el, 'status-all')!.click();
    await advance();
    expect(rows(el)).toHaveLength(all);
    const kind = role<HTMLSelectElement>(el, 'kind')!;
    kind.value = 'tag';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    await advance();
    expect(rows(el).every((r) => r.dataset.kind === 'tag')).toBe(true);
    expect(rows(el).length).toBeLessThan(all);
  });

  it('chọn dòng hiện khác biệt từng trường; chọn bằng bàn phím (↑ ↓ Home End)', async () => {
    const { el } = await setup();
    rowOf(el, 'TANK01.LEVEL')!.click();
    await advance();
    expect(rowOf(el, 'TANK01.LEVEL')!.getAttribute('aria-selected')).toBe('true');
    const f = fieldRows(el);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain('/max');
    expect(f[0]).toContain('100');
    expect(f[0]).toContain('120');
    const first = rows(el)[0];
    first.focus();
    press(first, 'ArrowDown');
    await advance();
    expect(rows(el)[1].getAttribute('aria-selected')).toBe('true');
    expect(rows(el)[1].tabIndex).toBe(0);
    expect(rows(el)[0].tabIndex).toBe(-1);
    press(rows(el)[1], 'End');
    await advance();
    expect(rows(el).at(-1)!.getAttribute('aria-selected')).toBe('true');
    press(rows(el).at(-1)!, 'Home');
    await advance();
    expect(rows(el)[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Đọc lên phần chọn: dòng ≠ thành sửa đổi chưa lưu, Ctrl+Z hoàn tác; dòng + và = khóa kèm lý do', async () => {
    const { el, app } = await setup();
    rowOf(el, 'TANK01.TEMP')!.click();
    await advance();
    const take = role<HTMLButtonElement>(el, 'take')!;
    expect(take.getAttribute('aria-disabled')).toBe('true');
    expect(take.title).toContain('Chỉ có trên máy');
    rowOf(el, 'MOTOR01.RUN')!.click();
    await advance();
    expect(take.getAttribute('aria-disabled')).toBe('true');
    rowOf(el, 'TANK01.LEVEL')!.click();
    await advance();
    expect(take.getAttribute('aria-disabled')).toBeNull();
    take.click();
    await until(() => app.store.dirtyFiles().length > 0, 'chưa lưu');
    expect(app.store.dirtyFiles()).toEqual(['tags.json']);
    expect(app.ui.toast?.text).toContain('Ctrl+Z');
    await app.run('edit.undo');
    await advance();
    expect(app.store.dirtyFiles()).toEqual([]);
  });

  it('Nạp xuống phần khác mở hộp thoại Nạp xuống', async () => {
    const { el, app } = await setup();
    role<HTMLButtonElement>(el, 'download')!.click();
    await advance();
    expect(app.ui.dialog?.kind).toBe('download');
    await advance(500);
  });

  it('digest giống: nói "giống hệt" kèm phiên bản; không có dòng khác', async () => {
    const { el } = await setup({ same: true });
    expect(textOf(role(el, 'same'))).toContain('giống hệt');
    expect(rows(el).every((r) => r.dataset.status === '=')).toBe(true);
    expect(role<HTMLButtonElement>(el, 'take')!.getAttribute('aria-disabled')).toBe('true');
  });

  it('So sánh lại gọi thiết bị lại', async () => {
    const { el, dev } = await setup();
    const infos = () => dev.control.calls.filter((c) => c.cmd === 'device_get').length;
    const before = infos();
    role<HTMLButtonElement>(el, 'refresh')!.click();
    await until(() => infos() > before, 'gọi lại');
  });

  it('viewer: chỉ thấy khớp hay khác (digest), không có bảng, không đọc lên, không gọi manifest hay gói', async () => {
    const { el, dev } = await setup({ user: 'xem1' });
    expect(role(el, 'brief')?.textContent).toContain('khác');
    expect(el.querySelector('table[role="grid"]')).toBeNull();
    expect(role(el, 'take')).toBeNull();
    const paths = dev.control.calls
      .filter((c) => c.cmd === 'device_get')
      .map((c) => (c.args as { path: string }).path);
    expect(paths.some((p) => p.includes('/project/'))).toBe(false);
    expect(dev.control.calls.some((c) => c.cmd === 'device_fetch_package')).toBe(false);
  });

  it('chưa Online: nói cần Online, không có bảng', async () => {
    vi.useFakeTimers();
    const env = await newOnlineApp();
    apps.push(env.app);
    const el = await mount<MatCompareEditor>('mat-compare-editor', env.app);
    expect(textOf(el)).toContain('Online');
    expect(el.querySelector('table')).toBeNull();
  });
});
