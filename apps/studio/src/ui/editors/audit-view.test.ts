// Editor Audit (feature 005, T147, US4-2, FR-032; device-api §7): administrator xem bản ghi mới nhất trước, lọc theo
// thời gian, tài khoản, hành động, trang tiếp; tài khoản khác thấy "không đủ quyền" và không gọi thiết bị. Chạy trên
// DeviceLink giả, đồng hồ giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { MockDevice } from '../../platform/mock-device.ts';
import { newOnlineApp, pinnedDevice, textOf, type OnlineEnv } from '../online-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import '../dialogs/devices-dialog.ts';
import '../dialogs/login-dialog.ts';
import './audit-view.ts';
import type { MatAuditView } from './audit-view.ts';

const apps: StudioApp[] = [];

async function advance(ms = 10) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled();
}

async function until(pred: () => boolean, label = 'điều kiện') {
  for (let i = 0; i < 400 && !pred(); i++) await advance(10);
  expect(pred(), label).toBe(true);
}

interface Env extends OnlineEnv {
  el: MatAuditView;
  dev: MockDevice;
}

async function setup(user: string | null = 'admin'): Promise<Env> {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  for (const tag of ['mat-devices-dialog', 'mat-login-dialog']) await mount(tag, env.app);
  if (user) {
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await advance();
    await env.app.login(user, env.pw(user));
    await advance(300);
  }
  const el = await mount<MatAuditView>('mat-audit-view', env.app);
  await advance(100);
  return { ...env, el };
}

const rows = (el: Element) => [...el.querySelectorAll<HTMLElement>('tr[data-id]')];
const ids = (el: Element) => rows(el).map((r) => Number(r.dataset.id));
const role = <T extends HTMLElement>(el: Element, r: string) =>
  el.querySelector<T>(`[data-role="${r}"]`);
const auditCalls = (dev: MockDevice) =>
  dev.control.calls.filter(
    (c) => c.cmd === 'device_get' && (c.args as { path?: string }).path === '/api/v1/audit',
  );
const lastQuery = (dev: MockDevice): Record<string, string> =>
  (auditCalls(dev).at(-1)!.args as { query?: Record<string, string> }).query ?? {};

describe('editor Audit', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('administrator: bản ghi mới nhất trước, đủ cột, đăng nhập thất bại và truy cập bị từ chối có mặt', async () => {
    const { el } = await setup();
    await until(() => rows(el).length > 0, 'có bản ghi');
    const list = ids(el);
    expect(list).toEqual([...list].sort((a, b) => b - a)); // mới nhất (id lớn) trước
    const head = [...el.querySelectorAll('thead th')].map((th) => textOf(th));
    for (const col of [
      'Thời gian',
      'Tài khoản',
      'Role',
      'Nguồn',
      'Hành động',
      'Đối tượng',
      'Kết quả',
    ])
      expect(head, col).toContain(col);
    const all = textOf(el.querySelector('tbody'));
    expect(all).toContain('auth.login');
    expect(all).toContain('access.denied');
    expect(all).toContain('thất bại');
    expect(all).toContain('AUTH_FAILED');
    expect(role(el, 'forbidden')).toBeNull();
    expect(el.querySelector('table')?.getAttribute('role')).toBe('grid');
  });

  it('giờ chưa đồng bộ của thiết bị có cờ riêng trên dòng', async () => {
    const { el, dev } = await setup();
    await until(() => rows(el).length > 0);
    dev.control.addAudit('BL335-01', [
      { action: 'project.deploy', result: 'ok', user: 'kysu1', role: 'engineer', clockOk: false },
    ]);
    role<HTMLButtonElement>(el, 'refresh')!.click();
    await until(() => !!el.querySelector('tr[data-clock="unsynced"]'), 'cờ giờ chưa đồng bộ');
    expect(textOf(el.querySelector('tr[data-clock="unsynced"]'))).toContain('giờ chưa đồng bộ');
  });

  it('lọc theo tài khoản và theo hành động; xóa bộ lọc trả đủ', async () => {
    const { el, dev } = await setup();
    await until(() => rows(el).length > 0);
    const all = rows(el).length;
    const user = role<HTMLInputElement>(el, 'filter-user')!;
    user.value = 'kysu1';
    user.dispatchEvent(new Event('input', { bubbles: true }));
    role<HTMLButtonElement>(el, 'apply')!.click();
    await until(() => lastQuery(dev).user === 'kysu1', 'gọi có tham số user');
    await until(() => rows(el).length > 0 && rows(el).every((r) => r.dataset.user === 'kysu1'));
    expect(rows(el).length).toBeLessThan(all);
    const action = role<HTMLSelectElement>(el, 'filter-action')!;
    action.value = 'project.';
    action.dispatchEvent(new Event('change', { bubbles: true }));
    role<HTMLButtonElement>(el, 'apply')!.click();
    await until(
      () => rows(el).length > 0 && rows(el).every((r) => r.dataset.action!.startsWith('project.')),
    );
    expect(lastQuery(dev).action).toBe('project.');
    role<HTMLButtonElement>(el, 'clear')!.click();
    await until(
      () => rows(el).length >= all && rows(el).some((r) => r.dataset.user !== 'kysu1'),
      'đủ như lúc đầu',
    );
  });

  it('lọc theo thời gian: from và to gửi bằng ms UTC', async () => {
    const { el, dev } = await setup();
    await until(() => rows(el).length > 0);
    const from = role<HTMLInputElement>(el, 'filter-from')!;
    const to = role<HTMLInputElement>(el, 'filter-to')!;
    from.value = '2026-10-09T08:00';
    from.dispatchEvent(new Event('input', { bubbles: true }));
    to.value = '2026-10-10T08:00';
    to.dispatchEvent(new Event('input', { bubbles: true }));
    role<HTMLButtonElement>(el, 'apply')!.click();
    await until(() => !!lastQuery(dev).from, 'gọi có from');
    expect(lastQuery(dev).from).toBe(String(new Date('2026-10-09T08:00').getTime()));
    expect(lastQuery(dev).to).toBe(String(new Date('2026-10-10T08:00').getTime()));
  });

  it('trang tiếp: Tải thêm nối bản ghi cũ hơn theo next, hết thì nút mất', async () => {
    const { el, dev } = await setup();
    dev.control.addAudit(
      'BL335-01',
      Array.from({ length: 230 }, () => ({ action: 'project.read', result: 'ok', user: 'kysu1' })),
    );
    role<HTMLButtonElement>(el, 'refresh')!.click();
    await until(() => rows(el).length === 100, 'trang đầu 100 dòng');
    const more = role<HTMLButtonElement>(el, 'more')!;
    expect(more).not.toBeNull();
    more.click();
    await until(() => rows(el).length === 200, 'trang hai');
    const list = ids(el);
    expect(new Set(list).size).toBe(list.length);
    expect(list).toEqual([...list].sort((a, b) => b - a));
    expect(Number(lastQuery(dev).before)).toBeGreaterThan(0);
    role<HTMLButtonElement>(el, 'more')!.click();
    await until(() => !role(el, 'more'), 'hết bản ghi');
    expect(rows(el).length).toBeGreaterThan(230);
  });

  it('tài khoản khác administrator: "không đủ quyền", không gọi thiết bị', async () => {
    const { el, dev } = await setup('kysu1');
    expect(textOf(role(el, 'forbidden'))).toContain('không đủ quyền');
    expect(el.querySelector('table')).toBeNull();
    expect(auditCalls(dev)).toHaveLength(0);
  });

  it('thiết bị trả 403 (quyền đổi giữa chừng): hiện "không đủ quyền"', async () => {
    const { el, dev } = await setup();
    await until(() => rows(el).length > 0);
    dev.control.setAuditError('BL335-01', 'forbidden');
    role<HTMLButtonElement>(el, 'refresh')!.click();
    await until(() => !!role(el, 'forbidden'), 'báo quyền');
  });

  it('chưa Online: nói cần Online, không gọi thiết bị', async () => {
    const { el, dev } = await setup(null);
    expect(textOf(role(el, 'offline'))).toContain('Online');
    expect(auditCalls(dev)).toHaveLength(0);
  });

  it('lỗi mạng khi hỏi: nói lý do', async () => {
    const { el, dev } = await setup();
    await until(() => rows(el).length > 0);
    dev.control.setAuditError('BL335-01', 'unreachable');
    role<HTMLButtonElement>(el, 'refresh')!.click();
    await until(() => !!role(el, 'error'), 'báo lỗi');
    expect(textOf(role(el, 'error'))).toContain('Không đọc được audit');
  });
});
