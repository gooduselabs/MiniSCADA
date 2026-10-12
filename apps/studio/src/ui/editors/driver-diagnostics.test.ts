// Trang Chẩn đoán driver (T197, FR-051, R22; mockup studio-tags.html v-diag): cây kênh › thiết bị trường có trạng thái; số đếm
// kèm phần tăng thêm từ lúc mở trang (US5-4); chu kỳ thực cạnh chu kỳ đặt và dấu quá tải (US5-3); Tag xấu kèm lý do tiếng
// Việt, nhấp đúp tới Bảng Tag (US5-5); hỏi mỗi 2 s chỉ khi trang đang mở; role viewer trở lên; Offline thì báo cần Online.
// Chạy trên DeviceLink giả (platform/mock-device.ts), đồng hồ giả.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import type { DiagChannel } from '../../platform/mock-device-006.ts';
import { full02 } from '../../model/test-fixtures.ts';
import { newOnlineApp, pinnedDevice } from '../online-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import './driver-diagnostics.ts';
import type { DriverDiagnostics } from './driver-diagnostics.ts';

const apps: StudioApp[] = [];

const CHANNELS = [
  {
    id: 'plc1',
    name: 'PLC trạm bơm',
    kind: 'modbus-tcp',
    state: 'connected',
    lastError: null,
    reconnects: 0,
    warnings: [],
    devices: [
      {
        id: 'plc1',
        name: 'PLC 1',
        state: 'active',
        requestsOk: 120431,
        timeouts: 3,
        exceptions: { '02': 1 },
        badFrames: { crc: 0, format: 2, tid: 0, unit: 0, length: 0, echo: 0 },
        responseMs: { avg: 38, max: 120 },
        groups: [
          {
            group: 'fast',
            periodMs: 250,
            actualMs: { avg: 312, max: 480 },
            overruns: 6,
            overloaded: true,
          },
          {
            group: 'normal',
            periodMs: 1000,
            actualMs: { avg: 1002, max: 1010 },
            overruns: 0,
            overloaded: false,
          },
        ],
        writes: { confirmed: 3, failed: 0, timeout: 1, rejected: 2 },
      },
    ],
  },
  {
    id: 'rs485-1',
    name: 'RS485 đồng hồ điện',
    kind: 'modbus-rtu',
    state: 'error',
    lastError: { code: 'TIMEOUT', at: 1791601201000, device: 'meter1' },
    reconnects: 2,
    warnings: ['RS485_UNSUPPORTED'],
    devices: [
      {
        id: 'meter1',
        name: 'Đồng hồ 1',
        state: 'suspended',
        requestsOk: 10,
        timeouts: 57,
        exceptions: {},
        badFrames: { crc: 12, format: 0, tid: 0, unit: 0, length: 3, echo: 0 },
        responseMs: { avg: 41.5, max: 212 },
        groups: [],
        writes: { confirmed: 0, failed: 0, timeout: 0, rejected: 0 },
      },
    ],
  },
] as unknown as DiagChannel[];

const BAD = [
  { id: 'METER9.P', quality: 'BAD', reason: 'TIMEOUT', detail: null, updatedAt: 1791601201000 },
  {
    id: 'TANK01.VOLUME',
    quality: 'BAD',
    reason: 'INPUT_BAD',
    detail: 'TANK01.LEVEL',
    updatedAt: 1791601202000,
  },
];

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function setup(opts: { login?: string | null; open?: boolean } = {}) {
  vi.useFakeTimers();
  const env = await newOnlineApp({ files: full02() });
  apps.push(env.app);
  env.dev.control.setRuntime('BL335-01', '0.5.0');
  env.dev.control.setDriverDiagnostics('BL335-01', {
    channels: structuredClone(CHANNELS),
    badTags: BAD as never,
  });
  const user = opts.login === undefined ? 'kysu1' : opts.login;
  if (user) {
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await vi.advanceTimersByTimeAsync(60);
    await env.app.login(user, env.pw(user));
    await vi.advanceTimersByTimeAsync(300);
  }
  env.app.openEditor('driverDiag');
  const el = await mount<DriverDiagnostics>('mat-driver-diagnostics', env.app);
  await vi.advanceTimersByTimeAsync(10);
  await settled(el);
  const polls = () =>
    env.dev.control.calls.filter(
      (c) =>
        c.cmd === 'device_get' &&
        (c.args as { path?: string }).path === '/api/v1/drivers/diagnostics',
    ).length;
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settled(el);
  };
  return { ...env, el, polls, advance };
}

const rowOf = (el: Element, key: string) => el.querySelector(`tr[data-row="${key}"]`);

describe('mat-driver-diagnostics', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('Offline: trang báo cần Online, có nút Online, không hỏi thiết bị', async () => {
    const { el, polls, advance } = await setup({ login: null });
    expect(el.querySelector('[data-role="needs-online"]')).not.toBeNull();
    expect(text(el)).toContain('Cần Online');
    expect(el.querySelector('button[data-act="online"]')).not.toBeNull();
    await advance(20_000);
    expect(polls()).toBe(0);
  });

  it('cây kênh › thiết bị trường: tên, loại, trạng thái bằng chữ (màu không là tín hiệu duy nhất); chọn thiết bị đầu', async () => {
    const { el } = await setup();
    const tree = el.querySelector('[role="tree"]')!;
    expect(tree.getAttribute('aria-label')).toBe('Kênh › thiết bị trường');
    const items = [...tree.querySelectorAll('[role="treeitem"]')];
    expect(items.map((i) => text(i.querySelector('.dd-name')))).toEqual([
      'PLC trạm bơm',
      'PLC 1',
      'RS485 đồng hồ điện',
      'Đồng hồ 1',
    ]);
    expect(text(items[0]!)).toContain('đã kết nối');
    expect(text(items[1]!)).toContain('hoạt động');
    expect(text(items[2]!)).toContain('lỗi');
    expect(text(items[3]!)).toContain('tạm ngưng');
    expect(items[1]!.getAttribute('aria-selected')).toBe('true');
    expect(items.every((i) => i.getAttribute('aria-level'))).toBe(true);
  });

  it('số đếm của thiết bị đang chọn: tổng và phần tăng thêm từ lúc mở (bắt đầu từ 0)', async () => {
    const { el } = await setup();
    const ok = rowOf(el, 'requestsOk')!;
    expect(text(ok.querySelector('.dd-total'))).toBe('120.515');
    expect(text(ok.querySelector('.dd-delta'))).toBe('+0');
    expect(text(rowOf(el, 'exception:02')!)).toContain('Exception 02');
    expect(text(rowOf(el, 'badFrames')!.querySelector('.dd-total'))).toBe('0/2/0/0/0/0');
    expect(text(rowOf(el, 'responseMs')!.querySelector('.dd-total'))).toBe('38 / 120');
    expect(text(rowOf(el, 'responseMs')!.querySelector('.dd-delta'))).toBe('—');
  });

  it('số đếm tăng đúng sau tiêm lỗi giả: phần tăng thêm tính từ lúc mở; Đặt lại phần tăng về 0', async () => {
    const { el, dev, advance } = await setup();
    dev.control.injectDriverFault('BL335-01', 'plc1', { timeouts: 4, exceptions: { '02': 3 } });
    await advance(2100);
    // mock tự cộng 84 yêu cầu thành công mỗi lần hỏi: phần tăng = 84 × số lần hỏi sau lần đầu
    expect(text(rowOf(el, 'timeouts')!.querySelector('.dd-delta'))).toBe('+4');
    expect(text(rowOf(el, 'timeouts')!.querySelector('.dd-total'))).toBe('7');
    expect(text(rowOf(el, 'exception:02')!.querySelector('.dd-delta'))).toBe('+3');
    expect(text(rowOf(el, 'requestsOk')!.querySelector('.dd-delta'))).toBe('+84');
    await advance(2000);
    expect(text(rowOf(el, 'requestsOk')!.querySelector('.dd-delta'))).toBe('+168');
    el.querySelector<HTMLButtonElement>('button[data-act="rebase"]')!.click();
    await settled(el);
    expect(text(rowOf(el, 'requestsOk')!.querySelector('.dd-delta'))).toBe('+0');
    expect(text(rowOf(el, 'timeouts')!.querySelector('.dd-delta'))).toBe('+0');
  });

  it('chu kỳ thực cạnh chu kỳ đặt, dấu quá tải kèm chữ và số lần (US5-3)', async () => {
    const { el } = await setup();
    const fast = el.querySelector('tr[data-group="fast"]')!;
    expect(text(fast.querySelector('.dd-set'))).toBe('250 ms');
    expect(text(fast.querySelector('.dd-actual'))).toBe('312 / 480 ms');
    expect(text(fast.querySelector('.dd-over'))).toContain('quá tải');
    expect(text(fast.querySelector('.dd-over'))).toContain('6 lần');
    expect(fast.querySelector('.dd-over .chip.err')).not.toBeNull();
    const normal = el.querySelector('tr[data-group="normal"]')!;
    expect(text(normal.querySelector('.dd-over'))).toBe('—');
  });

  it('chọn kênh: hiện trạng thái, kết nối lại, lỗi gần nhất, cảnh báo; chọn thiết bị khác đổi số đếm', async () => {
    const { el } = await setup();
    const items = [...el.querySelectorAll('[role="treeitem"]')] as HTMLElement[];
    items[2]!.click();
    await settled(el);
    const info = text(el.querySelector('[data-role="channel-info"]'));
    expect(info).toContain('Kết nối lại: 2 lần');
    expect(info).toContain('TIMEOUT');
    expect(info).toContain('meter1');
    expect(info).toContain('RS485_UNSUPPORTED');
    items[3]!.click();
    await settled(el);
    expect(text(rowOf(el, 'timeouts')!.querySelector('.dd-total'))).toBe('57');
  });

  it('Tag xấu: lý do tiếng Việt, Tag tính toán kèm đầu vào xấu; nhấp đúp tới Bảng Tag và chọn đúng Tag (US5-5)', async () => {
    const { app, el } = await setup();
    const rows = [...el.querySelectorAll('tr[data-tag]')];
    expect(rows.map((r) => (r as HTMLElement).dataset.tag)).toEqual(['METER9.P', 'TANK01.VOLUME']);
    expect(text(rows[0]!)).toContain('thiết bị trường không trả lời kịp');
    expect(text(rows[1]!)).toContain('đầu vào của biểu thức không tốt: TANK01.LEVEL');
    expect(rows[1]!.querySelector('.chip.err')).not.toBeNull();
    rows[1]!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(app.store.state.active).toBe('tags');
    const tags = app.store.state.outline.tags!.tags as unknown as { id: string }[];
    expect(app.takeReveal('tags')).toMatchObject({
      row: tags.findIndex((x) => x.id === 'TANK01.VOLUME'),
    });
  });

  it('Enter trên dòng Tag xấu cũng mở Tag; Tag không có trong project thì báo, không mở', async () => {
    const { app, el } = await setup();
    const rows = [...el.querySelectorAll<HTMLElement>('tr[data-tag]')];
    rows[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(app.ui.toast?.text).toContain('METER9.P');
    expect(app.store.state.active).not.toBe('tags');
    expect(rows[1]!.getAttribute('tabindex')).toBeDefined();
  });

  it('hỏi mỗi 2 s chỉ khi trang đang mở: gỡ trang thì ngừng hỏi', async () => {
    const { el, polls, advance } = await setup();
    const first = polls();
    expect(first).toBeGreaterThanOrEqual(1);
    await advance(2000);
    expect(polls()).toBe(first + 1);
    await advance(4000);
    expect(polls()).toBe(first + 3);
    el.remove();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(polls()).toBe(first + 3);
  });

  it('role viewer cũng xem được; mất Online thì trang về báo cần Online và ngừng hỏi', async () => {
    const { app, el, polls, advance } = await setup({ login: 'xem1' });
    expect(el.querySelector('[role="tree"]')).not.toBeNull();
    const n = polls();
    app.session.disconnect();
    await advance(100);
    expect(el.querySelector('[data-role="needs-online"]')).not.toBeNull();
    await advance(10_000);
    expect(polls()).toBe(n);
  });

  it('lỗi khi hỏi: giữ số liệu cũ và nói lý do; forbidden nói thiếu quyền', async () => {
    const { el, dev, advance } = await setup();
    dev.control.setDriverDiagnostics('BL335-01', { fail: 'unreachable' });
    await advance(2100);
    expect(el.querySelector('[role="tree"]')).not.toBeNull();
    expect(text(el.querySelector('[data-role="error"]'))).toContain(
      'Không đọc được chẩn đoán driver',
    );
    dev.control.setDriverDiagnostics('BL335-01', { fail: 'forbidden' });
    await advance(2100);
    expect(text(el.querySelector('[data-role="error"]'))).toContain('chưa đủ quyền');
    dev.control.setDriverDiagnostics('BL335-01', { fail: null });
    await advance(2100);
    expect(el.querySelector('[data-role="error"]')).toBeNull();
  });

  it('cập nhật ghi giờ nhận và chu kỳ 2 giây; bảng có tiêu đề cột và nhãn ARIA', async () => {
    const { el } = await setup();
    expect(text(el.querySelector('[data-role="updated"]'))).toContain('mỗi 2 giây');
    expect([...el.querySelectorAll('table[data-role="counters"] th')].map(text)).toEqual([
      'Mục',
      'Tổng',
      '+ từ lúc mở',
    ]);
    expect(
      el.querySelector('table[data-role="counters"]')!.getAttribute('aria-label'),
    ).toBeTruthy();
    expect(el.querySelector('table[data-role="bad-tags"]')!.getAttribute('aria-label')).toContain(
      'Tag xấu',
    );
  });
});
