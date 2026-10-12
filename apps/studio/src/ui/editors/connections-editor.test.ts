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
