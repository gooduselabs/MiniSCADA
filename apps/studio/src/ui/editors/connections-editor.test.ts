// Editor Kết nối (feature 006, T129, FR-030, FR-044, studio-ux §5 mục Form): nhóm theo kênh và thiết bị trường; trợ giúp ngay
// dưới ô; lỗi tại ô; panel Thử kết nối (thời gian, mã, hex, bảng cách hiểu 4 thứ tự; exception kèm nghĩa); bàn phím, ARIA.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { VALIDATE_DELAY_MS } from '../../app/store.ts';
import { full02 } from '../../model/test-fixtures.ts';
import { newOnlineApp, pinnedDevice, textOf } from '../online-test-helpers.ts';
import { cleanup, mount, newApp, newApp02, settled } from '../test-helpers.ts';
import './connections-editor.ts';
import type { ConnectionsEditor } from './connections-editor.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const channels = (app: StudioApp) => app.store.state.outline.connections?.channels ?? [];

async function open(node: string, make: () => Promise<{ app: StudioApp }> = () => newApp02()) {
  const env = await make();
  env.app.openEditor('connections');
  env.app.revealNode(node);
  const el = await mount<ConnectionsEditor>('mat-connections-editor', env.app);
  await settled(el);
  return { ...env, el };
}

const input = (el: Element, id: string) =>
  el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
async function change(el: Element, id: string, value: string) {
  const f = input(el, id);
  f.value = value;
  f.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(el);
}

describe('mat-connections-editor: bố cục', () => {
  it('danh sách kênh › thiết bị trường kèm số Tag; chọn một kênh hiện form theo nhóm Kết nối và Nâng cao', async () => {
    const { el } = await open('channel:plc1');
    const items = [...el.querySelectorAll<HTMLElement>('[role="treeitem"] .cn-item')].map(
      (b) => b.dataset.node,
    );
    expect(items).toEqual([
      'channel:plc1',
      'fdev:plc1',
      'channel:rs485-1',
      'fdev:meter1',
      'fdev:meter2',
    ]);
    expect(textOf(el.querySelector('[data-node="fdev:plc1"] .cnt'))).toBe('6');
    const groups = [...el.querySelectorAll('.cn-form fieldset legend')].map((l) => textOf(l));
    expect(groups).toEqual(['Kết nối', 'Nâng cao']);
    expect(el.querySelector('#cn-channel-host')).not.toBeNull();
    expect((input(el, 'cn-channel-host') as HTMLInputElement).value).toBe('192.168.10.5');
  });

  it('đang gõ dở một ô mà giao diện vẽ lại (kết quả thử, kiểm tra nền): chữ đã gõ không bị ghi đè', async () => {
    const { el, app } = await open('channel:plc1');
    const host = input(el, 'cn-channel-host') as HTMLInputElement;
    host.focus();
    host.value = 'timeout';
    host.dispatchEvent(new Event('input', { bubbles: true }));
    app.probe.clear();
    await settled(el);
    expect((input(el, 'cn-channel-host') as HTMLInputElement).value).toBe('timeout');
    host.value = 'timeout.local';
    host.dispatchEvent(new Event('change', { bubbles: true }));
    host.blur();
    await settled(el);
    expect(channels(app)[0].tcp?.host).toBe('timeout.local');
    app.probe.clear();
    await settled(el);
    expect((input(el, 'cn-channel-host') as HTMLInputElement).value).toBe('timeout.local');
  });

  it('mỗi ô có nhãn, trợ giúp ngay dưới ô (aria-describedby), giá trị mặc định làm gợi ý', async () => {
    const { el } = await open('channel:plc1');
    const port = input(el, 'cn-channel-port') as HTMLInputElement;
    expect(el.querySelector(`label[for="cn-channel-port"]`)).not.toBeNull();
    const help = el.querySelector('#cn-channel-port-h')!;
    expect(textOf(help)).toContain('Mặc định 502');
    expect(port.getAttribute('aria-describedby')).toContain('cn-channel-port-h');
    expect(port.placeholder).toBe('502');
    expect(port.value).toBe('502');
  });

  it('chọn thiết bị trường: form thiết bị (Unit ID với TCP, slave với RTU) và panel Thử kết nối', async () => {
    const tcp = await open('fdev:plc1');
    expect(tcp.el.querySelector('#cn-device-unitId')).not.toBeNull();
    expect(tcp.el.querySelector('#cn-device-slave')).toBeNull();
    expect(tcp.el.querySelector('.cn-probe')).not.toBeNull();
    cleanup();
    const rtu = await open('fdev:meter2');
    expect(rtu.el.querySelector('#cn-device-slave')).not.toBeNull();
    expect((input(rtu.el, 'cn-device-slave') as HTMLInputElement).value).toBe('2');
  });

  it('chọn Kết nối: nhóm quét; project có kênh thì không hiện trạng thái trống', async () => {
    const { el } = await open('connections');
    expect(el.querySelectorAll('.cn-scan input')).toHaveLength(3);
    expect(el.querySelector('.empty')).toBeNull();
  });
});

describe('mat-connections-editor: sửa', () => {
  it('đổi cổng: một sửa đổi channelUpsert, một bước hoàn tác; bằng mặc định thì bỏ khóa', async () => {
    const { app, el } = await open('channel:plc1');
    const before = app.store.state.history.past.length;
    await change(el, 'cn-channel-port', '1502');
    expect(channels(app)[0].tcp?.port).toBe(1502);
    expect(app.store.state.history.past.length).toBe(before + 1);
    await change(el, 'cn-channel-port', '502');
    expect(channels(app)[0].tcp).toEqual({ host: '192.168.10.5' });
    await app.run('edit.undo');
    expect(channels(app)[0].tcp?.port).toBe(1502);
  });

  it('lỗi tại ô: ngoài khoảng hiện dưới ô (role alert), giữ chữ đã gõ, không ghi; sửa đúng thì hết lỗi', async () => {
    const { app, el } = await open('channel:plc1');
    const before = app.store.state.history.past.length;
    await change(el, 'cn-channel-port', '70000');
    expect(app.store.state.history.past.length).toBe(before);
    const port = input(el, 'cn-channel-port');
    expect(port.getAttribute('aria-invalid')).toBe('true');
    const err = el.querySelector('#cn-channel-port-e')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(textOf(err)).toBe('Ngoài khoảng cho phép');
    expect(port.getAttribute('aria-describedby')).toContain('cn-channel-port-e');
    expect((port as HTMLInputElement).value).toBe('70000');
    await change(el, 'cn-channel-port', '1503');
    expect(el.querySelector('#cn-channel-port-e')).toBeNull();
  });

  it('mã kênh trùng bị từ chối; đổi mã đúng thì nút đang chọn theo mã mới', async () => {
    const { app, el } = await open('channel:plc1');
    await change(el, 'cn-channel-id', 'rs485-1');
    expect(textOf(el.querySelector('#cn-channel-id-e'))).toBe('Mã này đã dùng');
    await change(el, 'cn-channel-id', 'plc-chinh');
    expect(channels(app)[0].id).toBe('plc-chinh');
    expect(app.ui.treeSel).toBe('channel:plc-chinh');
  });

  it('thiết bị trường: chọn danh sách (thứ tự byte), ô bật tắt; trường lồng write.registerBit', async () => {
    const { app, el } = await open('fdev:meter1');
    await change(el, 'cn-device-byteOrder', 'CDAB');
    expect(channels(app)[1].devices[0].byteOrder).toBe('CDAB');
    await change(el, 'cn-device-writeRegisterBit', 'mask');
    expect(channels(app)[1].devices[0].write?.registerBit).toBe('mask');
    const cb = input(el, 'cn-device-enabled') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(channels(app)[1].devices[0].enabled).toBe(false);
  });

  it('nhóm quét: đổi chu kỳ, ngoài 100–60.000 bị từ chối', async () => {
    const { app, el } = await open('connections');
    await change(el, 'cn-scan-fast', '500');
    expect(app.store.state.outline.connections?.scanGroups?.fast).toBe(500);
    await change(el, 'cn-scan-slow', '50');
    expect(el.textContent).toContain('Ngoài khoảng cho phép');
    expect(app.store.state.outline.connections?.scanGroups?.slow).toBe(5000);
  });

  it('Thêm kênh, Thêm thiết bị trường, Xóa: qua nút và Ctrl+Z', async () => {
    const { app, el } = await open('channel:plc1');
    const add = el.querySelector<HTMLButtonElement>('[data-act="add-channel"]')!;
    add.click();
    await settled(el);
    expect(channels(app)).toHaveLength(3);
    expect(app.ui.treeSel).toBe('channel:plc2');
    el.querySelector<HTMLButtonElement>('[data-act="add-device"]')!.click();
    await settled(el);
    expect(channels(app)[2].devices).toHaveLength(1);
    el.querySelector<HTMLButtonElement>('[data-act="remove"]')!.click();
    await settled(el);
    expect(channels(app)[2].devices).toHaveLength(0);
    await app.run('edit.undo');
    expect(channels(app)[2].devices).toHaveLength(1);
  });

  it('lỗi từ bộ kiểm tra hiện tại đúng ô: cổng serial sai của kênh RTU', async () => {
    const { app, el } = await open('channel:rs485-1');
    app.store.edit([
      {
        kind: 'channelUpsert',
        index: 1,
        channel: { ...channels(app)[1], serial: { ...channels(app)[1].serial!, port: 'cổng sai' } },
      },
    ]);
    await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS + 40));
    await app.store.idle();
    await settled(el);
    expect(textOf(el.querySelector('#cn-channel-serialPort-e'))).toContain(
      'tên cổng serial không đúng dạng',
    );
  });

  it('project 0.1 (chưa nâng cấp): form chỉ đọc, nút Thêm khóa kèm lý do', async () => {
    const { el } = await open('connections', () => newApp());
    expect(el.textContent).toContain('chỉ đọc');
    expect(
      el
        .querySelector<HTMLButtonElement>('[data-act="add-channel"]')!
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });
});

describe('mat-connections-editor: Thử kết nối', () => {
  async function online(role = 'kysu1') {
    vi.useFakeTimers();
    const env = await newOnlineApp({ files: full02() });
    env.dev.control.setRuntime('BL335-01', '0.5.0');
    env.app.openEditor('connections');
    env.app.revealNode('fdev:plc1');
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await vi.advanceTimersByTimeAsync(20);
    await env.app.login(role, env.pw(role));
    await vi.advanceTimersByTimeAsync(60);
    const el = await mount<ConnectionsEditor>('mat-connections-editor', env.app);
    await vi.advanceTimersByTimeAsync(10);
    await settled(el);
    return { ...env, el };
  }
  const run = async (el: Element) => {
    el.querySelector<HTMLButtonElement>('[data-role="probe-run"]')!.click();
    await vi.advanceTimersByTimeAsync(300);
    await settled(el);
  };

  it('Offline: nút khóa kèm lý do, không gửi gì', async () => {
    const { el, app } = await open('fdev:plc1');
    const btn = el.querySelector<HTMLButtonElement>('[data-role="probe-run"]')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(textOf(el.querySelector('[data-role="probe-lock"]'))).toContain('Cần Online');
    btn.click();
    expect(app.probe.state.result).toBeNull();
  });

  it('viewer hoặc operator: khóa vì role; engineer: chạy được', async () => {
    const viewer = await online('xem1');
    expect(textOf(viewer.el.querySelector('[data-role="probe-lock"]'))).toContain('engineer');
    cleanup();
    const eng = await online('kysu1');
    expect(eng.el.querySelector('[data-role="probe-lock"]')).toBeNull();
    expect(
      eng.el
        .querySelector<HTMLButtonElement>('[data-role="probe-run"]')!
        .getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('kết quả: trạng thái, thời gian, mã, hex, bảng cách hiểu 4 thứ tự byte; gửi cấu hình đang sửa', async () => {
    const { el, dev } = await online();
    await run(el);
    expect(textOf(el.querySelector('[data-role="probe-status"]'))).toBe('Kết nối được');
    expect(textOf(el.querySelector('[data-role="probe-code"]'))).toContain('OK');
    expect(textOf(el.querySelector('[data-role="probe-hex"]'))).toBe('42F6 E979');
    expect(el.textContent).toContain('4 ms');
    const f32 = el.querySelector('tr[data-type="FLOAT32"]')!;
    expect([...f32.querySelectorAll('td')].map((td) => textOf(td)).slice(1, 2)[0]).toMatch(
      /^123\.45/,
    );
    expect(el.querySelectorAll('.cn-interp thead th.mono')).toHaveLength(4);
    const sent = dev.control.probeLog('BL335-01').at(-1)!;
    expect(sent).toMatchObject({
      channel: { kind: 'modbus-tcp', tcp: { host: '192.168.10.5' } },
      read: { address: 'HR100', count: 2 },
    });
  });

  it('đổi host ở form kênh rồi chọn lại thiết bị: lần thử gửi host MỚI (không dùng host cũ)', async () => {
    const { el, dev, app } = await online();
    app.revealNode('channel:plc1');
    await settled(el);
    await change(el, 'cn-channel-host', 'timeout.local');
    app.revealNode('fdev:plc1');
    await settled(el);
    await run(el);
    expect(dev.control.probeLog('BL335-01').at(-1)).toMatchObject({
      channel: { tcp: { host: 'timeout.local' } },
    });
    expect(textOf(el.querySelector('[data-role="probe-code"]'))).toContain('TIMEOUT');
    app.revealNode('channel:plc1');
    await settled(el);
    await change(el, 'cn-channel-host', 'unreach.local');
    app.revealNode('fdev:plc1');
    await settled(el);
    await run(el);
    expect(dev.control.probeLog('BL335-01').at(-1)).toMatchObject({
      channel: { tcp: { host: 'unreach.local' } },
    });
  });

  it('exception kèm nghĩa; các mã lỗi kết nối kèm lý do', async () => {
    const { el, dev } = await online();
    (el.querySelector('#cn-probe-address') as HTMLInputElement).value = 'HR9000';
    el.querySelector('#cn-probe-address')!.dispatchEvent(new Event('input', { bubbles: true }));
    await run(el);
    expect(textOf(el.querySelector('[data-role="probe-exception"]'))).toContain('02');
    expect(textOf(el.querySelector('[data-role="probe-exception"]'))).toContain(
      'địa chỉ không hợp lệ',
    );
    dev.control.setProbe('BL335-01', () => ({
      body: { ok: false, code: 'REFUSED', message: 'PLC từ chối kết nối' },
    }));
    await run(el);
    expect(textOf(el.querySelector('[data-role="probe-code"]'))).toContain('REFUSED');
    expect(el.textContent).toContain('PLC từ chối kết nối');
  });

  it('TEST_BUSY và TEST_RATE_LIMITED: thông báo rõ, không treo', async () => {
    const { el, dev } = await online();
    dev.control.setProbeError('BL335-01', 'TEST_BUSY');
    await run(el);
    expect(textOf(el.querySelector('[data-role="probe-result"] .banner'))).toContain(
      'đang có một lần thử khác',
    );
    dev.control.setProbeError('BL335-01', 'TEST_RATE_LIMITED');
    await run(el);
    expect(textOf(el.querySelector('[data-role="probe-result"] .banner'))).toContain(
      'thử lại sau 20 giây',
    );
    expect(el.querySelector('[data-role="probe-result"]')!.getAttribute('aria-busy')).toBe('false');
  });
});

describe('mat-connections-editor: kênh Modbus RTU (T170, US3-1, US3-4, US3-5, US3-6)', () => {
  async function online(role = 'kysu1', node = 'channel:rs485-1') {
    vi.useFakeTimers();
    const env = await newOnlineApp({ files: full02() });
    env.dev.control.setRuntime('BL335-01', '0.5.0');
    env.app.openEditor('connections');
    env.app.revealNode(node);
    env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
    await vi.advanceTimersByTimeAsync(20);
    await env.app.login(role, env.pw(role));
    await vi.advanceTimersByTimeAsync(60);
    const el = await mount<ConnectionsEditor>('mat-connections-editor', env.app);
    await vi.advanceTimersByTimeAsync(10);
    await settled(el);
    return { ...env, el };
  }
  const load = async (el: Element, role: 'ports-load' | 'ports-probe' = 'ports-load') => {
    el.querySelector<HTMLButtonElement>(`[data-role="${role}"]`)!.click();
    await vi.advanceTimersByTimeAsync(300);
    await settled(el);
  };
  const portRows = (el: Element) => [...el.querySelectorAll<HTMLElement>('tr[data-port]')];
  const portsCalls = (dev: { control: { calls: { cmd: string; args: unknown }[] } }) =>
    dev.control.calls.filter(
      (c) =>
        c.cmd === 'device_get' && (c.args as { path?: string }).path === '/api/v1/serial/ports',
    );

  it('form kênh RTU: cổng, tốc độ 1.200–115.200, 7 hoặc 8 bit dữ liệu, parity, bit dừng, RS485, bỏ vọng lại, khoảng lặng', async () => {
    const { el } = await open('channel:rs485-1');
    const baud = input(el, 'cn-channel-baud') as HTMLSelectElement;
    expect([...baud.options].map((o) => o.value)).toEqual([
      '1200',
      '2400',
      '4800',
      '9600',
      '19200',
      '38400',
      '57600',
      '115200',
    ]);
    expect(
      [...(input(el, 'cn-channel-dataBits') as HTMLSelectElement).options].map((o) => o.value),
    ).toEqual(['7', '8']);
    expect(
      [...(input(el, 'cn-channel-parity') as HTMLSelectElement).options].map((o) => o.value),
    ).toEqual(['none', 'even', 'odd']);
    expect(
      [...(input(el, 'cn-channel-stopBits') as HTMLSelectElement).options].map((o) => o.value),
    ).toEqual(['1', '2']);
    for (const id of [
      'cn-channel-serialPort',
      'cn-channel-rs485',
      'cn-channel-dropEcho',
      'cn-channel-silenceMs',
    ])
      expect(input(el, id), id).not.toBeNull();
    expect((input(el, 'cn-channel-rs485') as HTMLInputElement).type).toBe('checkbox');
    const groups = [...el.querySelectorAll('.cn-form fieldset legend')].map((l) => textOf(l));
    expect(groups).toEqual(['Kết nối', 'Nâng cao']);
  });

  it('đổi tốc độ, parity: một sửa đổi mỗi lần; slave của thiết bị trường chỉ nhận 1–247', async () => {
    const { app, el } = await open('channel:rs485-1');
    await change(el, 'cn-channel-baud', '38400');
    expect(channels(app)[1].serial?.baud).toBe(38400);
    await change(el, 'cn-channel-parity', 'none');
    expect(channels(app)[1].serial?.parity).toBe('none');
    cleanup();
    const dev = await open('fdev:meter1');
    await change(dev.el, 'cn-device-slave', '248');
    expect(textOf(dev.el.querySelector('#cn-device-slave-e'))).toContain('Ngoài khoảng');
    expect(textOf(dev.el.querySelector('#cn-device-slave-h'))).toContain('247');
    expect(channels(dev.app)[1].devices[0].slave).toBe(1);
    await change(dev.el, 'cn-device-slave', '17');
    expect(channels(dev.app)[1].devices[0].slave).toBe(17);
  });

  it('cảnh báo thời gian quét W_RTU_SCAN_TIME kèm số ms ước tính (US3-6)', async () => {
    const { app, el } = await open('channel:rs485-1');
    await change(el, 'cn-channel-baud', '1200');
    app.store.edit([{ kind: 'scanGroups', value: { normal: 100 } }]);
    await new Promise((r) => setTimeout(r, VALIDATE_DELAY_MS + 40));
    await app.store.idle();
    await settled(el);
    const warn = textOf(el.querySelector('.cn-issues, .cn-warn'));
    expect(warn).toMatch(/\d+ ms/);
    expect(warn.toLowerCase()).toContain('quét');
  });

  it('Offline: danh sách cổng khóa kèm lý do, không gửi gì', async () => {
    const { el } = await open('channel:rs485-1');
    const btn = el.querySelector<HTMLButtonElement>('[data-role="ports-load"]')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(textOf(el.querySelector('[data-role="ports-lock"]'))).toContain('Cần Online');
    expect(el.querySelector('[data-role="ports-probe"]')?.getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(portRows(el)).toHaveLength(0);
  });

  it('viewer: danh sách cổng khóa vì role (cần engineer), không gửi gì', async () => {
    const { el, dev } = await online('xem1');
    expect(textOf(el.querySelector('[data-role="ports-lock"]'))).toContain('engineer');
    expect(el.querySelector('[data-role="ports-load"]')!.getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(portsCalls(dev)).toHaveLength(0);
  });

  it('engineer: danh sách cổng với tên, loại, ai đang dùng, RS485 (US3-1)', async () => {
    const { el, dev } = await online();
    expect(portsCalls(dev)).toHaveLength(0);
    await load(el);
    expect(portsCalls(dev)).toHaveLength(1);
    expect((portsCalls(dev)[0]!.args as { query?: unknown }).query).toBeUndefined();
    const rows = portRows(el);
    expect(rows.map((r) => r.dataset.port)).toEqual(['ttyAS2', 'ttyAS3', 'ttyAS0', 'ttyUSB0']);
    const as0 = rows.find((r) => r.dataset.port === 'ttyAS0')!;
    expect(textOf(as0)).toContain('trên bo');
    expect(textOf(as0)).toContain('console của hệ điều hành');
    expect(textOf(rows.find((r) => r.dataset.port === 'ttyUSB0')!)).toContain('USB');
    expect(textOf(rows.find((r) => r.dataset.port === 'ttyUSB0')!)).toContain('EC25');
    expect(textOf(rows.find((r) => r.dataset.port === 'ttyAS2')!)).toContain('kênh này');
    const as3 = rows.find((r) => r.dataset.port === 'ttyAS3')!;
    expect(textOf(as3)).toContain('rảnh');
    expect(textOf(as3)).toContain('không hỗ trợ');
    expect(textOf(rows[0]!.querySelector('.pt-rs485'))).toContain('chưa biết');
  });

  it('chọn một cổng dùng được: ghi vào kênh (một bước hoàn tác); cổng không dùng được khóa kèm lý do', async () => {
    const { app, el } = await online();
    await load(el);
    const pick = (name: string) =>
      el.querySelector<HTMLButtonElement>(`tr[data-port="${name}"] button[data-act="pick"]`)!;
    expect(pick('ttyAS0').getAttribute('aria-disabled')).toBe('true');
    expect(pick('ttyAS0').title).toContain('console');
    expect(pick('ttyUSB0').getAttribute('aria-disabled')).toBe('true');
    expect(pick('ttyUSB0').title).toContain('chưa được phép');
    pick('ttyAS3').click();
    await settled(el);
    expect(channels(app)[1].serial?.port).toBe('ttyAS3');
    await app.run('edit.undo');
    expect(channels(app)[1].serial?.port).toBe('ttyAS2');
  });

  it('Dò RS485: gửi ?probe=1 (có audit ở thiết bị), cổng rảnh hiện RS485 đã dò', async () => {
    const { el, dev } = await online();
    await load(el, 'ports-probe');
    const calls = portsCalls(dev);
    expect((calls.at(-1)!.args as { query?: Record<string, string> }).query).toEqual({
      probe: '1',
    });
    expect(
      textOf(
        portRows(el)
          .find((r) => r.dataset.port === 'ttyAS2')!
          .querySelector('.pt-rs485'),
      ),
    ).toContain('bật');
    expect(textOf(el.querySelector('[data-role="ports-probed"]'))).toContain('Đã dò RS485');
  });

  it('Online: gõ cổng ngoài danh sách cho phép thì Studio báo ngay dưới ô; cổng đang là console cũng báo', async () => {
    const { app, el } = await online();
    await load(el);
    await change(el, 'cn-channel-serialPort', 'ttyAS9');
    expect(textOf(el.querySelector('#cn-channel-serialPort-w'))).toContain(
      'không có trong danh sách cổng của BL335',
    );
    await change(el, 'cn-channel-serialPort', 'ttyAS0');
    expect(textOf(el.querySelector('#cn-channel-serialPort-w'))).toContain('console');
    await change(el, 'cn-channel-serialPort', 'ttyAS2');
    expect(el.querySelector('#cn-channel-serialPort-w')).toBeNull();
    expect(channels(app)[1].serial?.port).toBe('ttyAS2');
  });

  it('bật RS485 trên cổng kernel không hỗ trợ: gợi ý cần bộ chuyển tự đổi chiều (US3-5)', async () => {
    const { el } = await online();
    await load(el);
    // kênh mẫu dùng ttyAS2 (RS485 bật được): chưa có gợi ý; đổi sang ttyAS3 (kernel không hỗ trợ RS485) thì có
    expect(el.querySelector('#cn-channel-rs485-w')).toBeNull();
    await change(el, 'cn-channel-serialPort', 'ttyAS3');
    expect(textOf(el.querySelector('#cn-channel-rs485-w'))).toContain('cần bộ chuyển tự đổi chiều');
    const rs485 = input(el, 'cn-channel-rs485') as HTMLInputElement;
    rs485.checked = false;
    rs485.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(el.querySelector('#cn-channel-rs485-w')).toBeNull();
  });

  it('Thêm kênh Modbus RTU bằng nút: kênh rtu1 được chọn, form RTU với cổng trống, một bước hoàn tác', async () => {
    const { app, el } = await open('connections');
    const n = channels(app).length;
    el.querySelector<HTMLButtonElement>('[data-act="add-channel-rtu"]')!.click();
    await settled(el);
    expect(channels(app)).toHaveLength(n + 1);
    expect(channels(app).at(-1)).toMatchObject({
      id: 'rtu1',
      kind: 'modbus-rtu',
      serial: { port: '' },
    });
    expect(el.querySelector('#cn-channel-baud')).not.toBeNull();
    expect((input(el, 'cn-channel-serialPort') as HTMLInputElement).value).toBe('');
    await app.run('edit.undo');
    expect(channels(app)).toHaveLength(n);
  });

  it('thiết bị trường của kênh RTU: panel Thử kết nối vẫn có; kênh TCP không có danh sách cổng', async () => {
    const tcp = await open('channel:plc1');
    expect(tcp.el.querySelector('[data-role="ports-load"]')).toBeNull();
    cleanup();
    const rtu = await open('fdev:meter1');
    expect(rtu.el.querySelector('.cn-probe')).not.toBeNull();
  });
});

describe('mat-connections-editor: OPC DA qua cầu nối (spec 021)', () => {
  it('tổng quan có hướng dẫn; thiết bị TCP nhập CSV ánh xạ thành Tag external', async () => {
    const overview = await open('');
    expect(overview.el.querySelector('[data-role="opcda-help"]')).not.toBeNull();
    cleanup();
    const { app, el } = await open('fdev:plc1');
    const csv =
      'id,type,address,access,qualityAddress\nOPC.LEVEL,FLOAT32,HR1,R,IR1\nBAD-NAME,INT16,HR3,R,IR2\n';
    vi.spyOn(app, 'csvOpen').mockResolvedValue({
      name: 'map.csv',
      bytes: new TextEncoder().encode(csv),
    } as never);
    el.querySelector<HTMLButtonElement>('[data-act="opcda-import"]')!.click();
    await vi.waitFor(() => expect(el.querySelector('[data-role="opcda-result"]')).not.toBeNull());
    const tags = (app.store.state.outline.tags?.tags ?? []) as unknown as {
      id: string;
      source?: unknown;
    }[];
    expect(tags.find((x) => x.id === 'OPC.LEVEL')?.source).toEqual({
      device: 'plc1',
      address: 'HR1',
    });
    expect(tags.some((x) => x.id === 'OPC.LEVEL_Q')).toBe(true);
    expect(textOf(el.querySelector('[data-role="opcda-result"]'))).toContain('Dòng 3');
  });

  it('thiết bị RTU không có mục nhập ánh xạ', async () => {
    const { el } = await open('fdev:meter2');
    expect(el.querySelector('[data-role="opcda"]')).toBeNull();
  });
});
