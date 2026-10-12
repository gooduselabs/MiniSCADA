// Editor Audit (feature 005, T147, US4-2, FR-032; device-api §7): administrator xem bản ghi mới nhất trước, lọc theo
// thời gian, tài khoản, hành động, trang tiếp; tài khoản khác thấy "không đủ quyền" và không gọi thiết bị. Chạy trên
// DeviceLink giả, đồng hồ giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { MockDevice } from '../../platform/mock-device.ts';
import {
  newOnlineApp,
  newWriteEnv,
  pinnedDevice,
  textOf,
  type OnlineEnv,
} from '../online-test-helpers.ts';
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

describe('editor Audit: lệnh ghi Tag và lọc theo Tag (feature 006, T153, US2-9, FR-039)', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  async function writeEnv() {
    const env = await newWriteEnv(vi, 'admin');
    const id = env.app.session.deviceId!;
    const sent: string[] = [];
    const post = (tag: string, value: unknown) => {
      const requestId = crypto.randomUUID();
      sent.push(requestId);
      return env.dev.post(id, '/api/v1/tags/write', { requests: [{ requestId, tag, value }] });
    };
    await post('TANK01.SP', 75);
    await post('PUMP01.RUN_CMD', true);
    await post('TANK01.SP', 95);
    await vi.advanceTimersByTimeAsync(600);
    // Thiết bị giả hoàn tất lệnh (ghi audit kết quả) khi có người hỏi theo mã, như Studio vẫn làm.
    await env.dev.get(id, '/api/v1/tags/write', { ids: sent.join(',') });
    env.app.openEditor('audit');
    const el = await mount<MatAuditView>('mat-audit-view', env.app);
    await vi.advanceTimersByTimeAsync(100);
    await settled(el);
    return { ...env, el };
  }

  it('ô lọc theo Tag có gợi ý tên Tag của project; lọc gửi tham số target và chỉ còn Tag đó', async () => {
    const { el, dev } = await writeEnv();
    await until(() => rows(el).length > 0, 'có bản ghi');
    const list = [...el.querySelectorAll('datalist option')].map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(list).toEqual(expect.arrayContaining(['TANK01.SP', 'PUMP01.RUN_CMD']));
    const box = role<HTMLInputElement>(el, 'filter-target')!;
    expect(box.getAttribute('list')).toBe('au-tags');
    box.value = 'TANK01.SP';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await until(() => lastQuery(dev).target === 'TANK01.SP', 'gửi target');
    await advance(50);
    expect(rows(el).length).toBeGreaterThan(0);
    for (const r of rows(el)) expect(textOf(r.querySelectorAll('td')[5])).toBe('TANK01.SP');
  });

  it('mỗi lệnh ghi hiện thời điểm, tài khoản, role, IP, Tag, kênh, thiết bị trường, giá trị cũ, giá trị mới, kết quả, lý do', async () => {
    const { el } = await writeEnv();
    await until(() => rows(el).some((r) => r.dataset.action === 'tag.write'), 'có tag.write');
    const ok = rows(el).find(
      (r) =>
        r.dataset.action === 'tag.write' &&
        textOf(r).includes('CONFIRMED') &&
        textOf(r).includes('TANK01.SP'),
    )!;
    const t = textOf(ok);
    expect(t).toContain('admin');
    expect(t).toContain('administrator');
    expect(t).toContain('TANK01.SP');
    const d = ok.querySelector('[data-role="write-detail"]')!;
    expect(textOf(d)).toContain('Kênh plc1');
    expect(textOf(d)).toContain('Thiết bị trường plc1');
    expect(textOf(d)).toMatch(/Cũ .+ → mới 75/);
    expect(ok.querySelectorAll('td')[0].textContent?.trim().length).toBeGreaterThan(5);
    expect(ok.querySelectorAll('td')[3].textContent?.trim().length).toBeGreaterThan(3);
    expect(textOf(ok.querySelector('td.code'))).toContain('thiết bị trường đã ghi và đọc lại đúng');
  });

  it('lệnh bị từ chối hiện lý do bằng tiếng Việt (ngoài giới hạn)', async () => {
    const { el } = await writeEnv();
    await until(() => rows(el).some((r) => textOf(r).includes('OUT_OF_LIMITS')), 'có denied');
    const denied = rows(el).find((r) => textOf(r).includes('OUT_OF_LIMITS'))!;
    expect(textOf(denied.querySelector('td.code'))).toContain('ngoài giới hạn ghi');
  });

  it('Xóa bộ lọc: ô Tag về trống và tải lại không có target', async () => {
    const { el, dev } = await writeEnv();
    await until(() => rows(el).length > 0, 'có bản ghi');
    const box = role<HTMLInputElement>(el, 'filter-target')!;
    box.value = 'TANK01.SP';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    el.querySelector<HTMLFormElement>('form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
    await until(() => lastQuery(dev).target === 'TANK01.SP');
    role<HTMLButtonElement>(el, 'clear')!.click();
    await until(() => lastQuery(dev).target === undefined);
    await advance(50);
    expect(role<HTMLInputElement>(el, 'filter-target')!.value).toBe('');
  });
});
