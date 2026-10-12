// Hộp thoại Thiết bị trong mạng (feature 005, T081, spec US1-1, US1-2, Edge Cases, mockup openDevices):
// chọn card; kết quả hiện dần với tên, địa chỉ, runtime, project (tên, phiên bản), trạng thái; chọn dòng
// hiện thêm model, MAC, cổng HTTPS, fingerprint; Thêm theo địa chỉ (IP hoặc tên, cổng HTTPS); danh sách đã
// lưu; Tìm lại; bàn phím và ARIA.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import {
  buttonByText,
  newOnlineApp,
  textOf,
  typeInto,
  type OnlineEnv,
} from '../online-test-helpers.ts';
import { cleanup, mount, press, settled } from '../test-helpers.ts';
import './devices-dialog.ts';
import type { MatDevicesDialog } from './devices-dialog.ts';
import './pin-dialog.ts';

const apps: StudioApp[] = [];

async function openDialog(): Promise<OnlineEnv & { el: MatDevicesDialog }> {
  vi.useFakeTimers();
  const env = await newOnlineApp();
  apps.push(env.app);
  const el = await mount<MatDevicesDialog>('mat-devices-dialog', env.app);
  await env.app.run('online.devices');
  await settled(el);
  return { ...env, el };
}

const rows = (el: Element) => [...el.querySelectorAll<HTMLTableRowElement>('tbody tr[data-key]')];
const rowTexts = (el: Element) => rows(el).map((r) => textOf(r));
const statusLine = (el: Element) => textOf(el.querySelector('.scan[role="status"]'));

async function advance(el: Element, ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settled(el);
}

describe('hộp thoại Thiết bị trong mạng', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('mở từ Online › Thiết bị trong mạng: hộp thoại có nhãn; tự quét; kết quả hiện dần, xong trong ≤ 3 s', async () => {
    const { app, el } = await openDialog();
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
    const dlg = el.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    const title = el.querySelector(`#${dlg.getAttribute('aria-labelledby')}`);
    expect(textOf(title)).toBe('Thiết bị trong mạng');
    expect(statusLine(el)).toContain('Đang tìm trong các card mạng…');
    expect(textOf(el.querySelector('tbody'))).toContain('Đang chờ thiết bị trả lời…');
    await advance(el, 400);
    expect(rowTexts(el)).toHaveLength(1);
    expect(rowTexts(el)[0]).toContain('BL335-01');
    await advance(el, 400);
    expect(rows(el)).toHaveLength(2);
    expect(buttonByText(el, 'Tìm lại')?.disabled).toBe(true);
    await advance(el, 1700);
    expect(statusLine(el)).toBe('Tìm xong trong 2,5 s · 2 thiết bị trả lời');
    expect(buttonByText(el, 'Tìm lại')?.disabled).toBe(false);
  });

  it('cột tên, địa chỉ, runtime, project (tên, phiên bản), trạng thái; chọn dòng hiện model, MAC, cổng HTTPS, fingerprint', async () => {
    const { el } = await openDialog();
    await advance(el, 2500);
    const heads = [...el.querySelectorAll('thead th')].map((th) => textOf(th));
    expect(heads).toEqual(['Tên', 'Địa chỉ', 'Runtime', 'Project', 'Trạng thái']);
    const [r1, r2] = rowTexts(el);
    for (const s of [
      'BL335-01',
      '192.168.1.110',
      '0.4.0',
      'Trạm bơm nước (demo Sprint 1) 0.1.0',
      'Đang chạy',
    ])
      expect(r1, s).toContain(s);
    expect(r2).toContain('BL335-02');
    expect(r2).toContain('Chưa có project');
    // Mặc định chọn dòng đầu; chọn dòng khác thì chi tiết đổi theo.
    expect(rows(el)[0].getAttribute('aria-selected')).toBe('true');
    rows(el)[1].click();
    await settled(el);
    expect(rows(el)[1].getAttribute('aria-selected')).toBe('true');
    const detail = textOf(el.querySelector('.devdetail'));
    for (const s of ['Model', 'BL335', '02:4E:1C:5A:33:02', '192.168.1.111:8443', 'chưa ghim'])
      expect(detail, s).toContain(s);
    // Fingerprint của gói tìm: đủ 64 ký tự hex, chữ đơn cách, nhóm theo cặp; ghi rõ chỉ để tham khảo.
    expect(detail).toContain('chỉ để tham khảo');
    const fp = el.querySelector('.devdetail .fp')!;
    expect(fp.classList.contains('mono')).toBe(true);
    expect(fp.textContent!.replace(/\s/g, '').toLowerCase()).toBe(
      '5ce02b719d440af3861bc729e5503fd8620eb49713af7c58d1269be3046af03d',
    );
    expect(fp.textContent).toContain('5C E0 2B 71 9D 44 0A F3');
  });

  it('bàn phím và ARIA: lưới có nhãn; ↑ ↓ Home End chọn dòng; Tab giữ trong hộp thoại; Esc đóng', async () => {
    const { app, el } = await openDialog();
    await advance(el, 2500);
    const grid = el.querySelector<HTMLTableElement>('table[role="grid"]')!;
    expect(grid.getAttribute('aria-label')).toBe('Thiết bị tìm thấy và đã lưu');
    expect(grid.tabIndex).toBe(0);
    grid.focus();
    press(grid, 'ArrowDown');
    await settled(el);
    expect(rows(el)[1].getAttribute('aria-selected')).toBe('true');
    expect(grid.getAttribute('aria-activedescendant')).toBe(rows(el)[1].id);
    press(grid, 'Home');
    await settled(el);
    expect(rows(el)[0].getAttribute('aria-selected')).toBe('true');
    press(grid, 'End');
    await settled(el);
    expect(rows(el)[1].getAttribute('aria-selected')).toBe('true');
    const focusables = [
      ...el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
      ),
    ];
    focusables[focusables.length - 1].focus();
    press(focusables[focusables.length - 1], 'Tab');
    expect(document.activeElement).toBe(focusables[0]);
    press(focusables[0], 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
    press(grid, 'Escape');
    await settled(el);
    expect(app.ui.dialog).toBeNull();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('card VPN hiện mờ (không chọn được) kèm gợi ý Thêm theo địa chỉ; Tìm lại theo card đã chọn', async () => {
    const { el, dev } = await openDialog();
    await advance(el, 2500);
    const select = el.querySelector<HTMLSelectElement>('select#dev-nic')!;
    expect(textOf(el.querySelector('label[for="dev-nic"]'))).toBe('Card mạng');
    const opts = [...select.options].map((o) => [textOf(o), o.disabled]);
    expect(opts).toEqual([
      ['Mọi card mạng (2)', false],
      ['Ethernet 2 · 192.168.1.20/24', false],
      ['Wi-Fi · 10.0.0.15/24', false],
      ['WireGuard · 10.8.0.2/32 (VPN: dùng Thêm theo địa chỉ)', true],
    ]);
    expect(textOf(el)).toContain('Card VPN thường không chuyển broadcast');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    expect(statusLine(el)).toContain('Đang tìm trong 10.0.0.0/24…');
    expect(dev.control.calls.filter((c) => c.cmd === 'discover_run').at(-1)?.args).toEqual({
      interfaces: [1],
    });
    await advance(el, 2500);
    // Không thấy thiết bị nào: gợi ý kiểm tường lửa Windows và Thêm theo địa chỉ.
    expect(rows(el)).toHaveLength(0);
    expect(textOf(el.querySelector('tbody'))).toContain('Kiểm tường lửa Windows');
    expect(textOf(el.querySelector('tbody'))).toContain('Thêm theo địa chỉ');
    buttonByText(el, 'Tìm lại')!.click();
    await settled(el);
    expect(dev.control.calls.filter((c) => c.cmd === 'discover_run')).toHaveLength(3);
  });

  it('Thêm theo địa chỉ: kiểm địa chỉ tại ô; thêm vào danh sách đã lưu, chọn dòng mới, kiểm runtime qua HTTP', async () => {
    const { app, el } = await openDialog();
    await advance(el, 2500);
    buttonByText(el, 'Thêm theo địa chỉ…')!.click();
    await settled(el);
    const input = el.querySelector<HTMLInputElement>('input[name="addr"]')!;
    expect(document.activeElement).toBe(input);
    expect(textOf(el.querySelector(`label[for="${input.id}"]`))).toBe('Địa chỉ thiết bị');
    expect(input.placeholder).toContain('10.8.0.21:8443');
    typeInto(input, 'http://10.8.0.21');
    buttonByText(el, 'Thêm')!.click();
    await settled(el);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(textOf(el.querySelector(`#${input.getAttribute('aria-describedby')}`))).toBe(
      'Thiết bị dùng HTTPS: bỏ http:// hoặc ghi https://',
    );
    typeInto(input, '10.8.0.21:8443');
    buttonByText(el, 'Thêm')!.click();
    await advance(el, 10);
    expect(app.knownDevices.map((d) => `${d.host}:${d.httpsPort}`)).toEqual(['10.8.0.21:8443']);
    expect(el.querySelector('input[name="addr"]')).toBeNull();
    const added = rows(el).find((r) => r.getAttribute('aria-selected') === 'true')!;
    expect(textOf(added)).toContain('10.8.0.21');
    // Kiểm nhanh qua HTTP (system/info): thiết bị xa có runtime, project, trạng thái.
    expect(textOf(added)).toContain('0.4.0');
    expect(textOf(added)).toContain('Đang chạy');
    expect(textOf(el.querySelector('.devdetail'))).toContain('Không trả lời lượt quét này');
  });

  it('Thêm theo địa chỉ › Nâng cao (T085b): sửa cổng HTTP cho thiết bị runtime cũ; cổng sai báo tại ô; ARIA; chi tiết hiện cổng HTTP', async () => {
    const { app, el } = await openDialog();
    await advance(el, 2500);
    buttonByText(el, 'Thêm theo địa chỉ…')!.click();
    await settled(el);
    const toggle = buttonByText(el, 'Nâng cao')!;
    expect(toggle.type).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('input[name="http-port"]')).toBeNull();
    toggle.click();
    await settled(el);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const region = el.querySelector(`#${toggle.getAttribute('aria-controls')}`)!;
    const port = region.querySelector<HTMLInputElement>('input[name="http-port"]')!;
    expect(textOf(el.querySelector(`label[for="${port.id}"]`))).toBe('Cổng HTTP');
    expect(port.placeholder).toBe('8080');
    expect(port.inputMode).toBe('numeric');
    expect(textOf(region)).toContain('runtime cũ');
    typeInto(el.querySelector<HTMLInputElement>('input[name="addr"]')!, '192.168.1.117');
    typeInto(port, '70000');
    buttonByText(el, 'Thêm')!.click();
    await advance(el, 10);
    expect(port.getAttribute('aria-invalid')).toBe('true');
    const described = port.getAttribute('aria-describedby')!.split(' ');
    expect(textOf(el.querySelector(`#${described[0]}`))).toBe('Cổng HTTP không hợp lệ (1–65535)');
    expect(textOf(el.querySelector(`#${described[1]}`))).toContain('runtime cũ');
    expect(el.querySelector('input[name="addr"]')!.getAttribute('aria-invalid')).toBe('false');
    expect(app.knownDevices).toEqual([]);
    typeInto(port, '9080');
    buttonByText(el, 'Thêm')!.click();
    await advance(el, 10);
    expect(app.knownDevices.map((d) => [d.host, d.httpsPort, d.httpPort])).toEqual([
      ['192.168.1.117', 8443, 9080],
    ]);
    expect(el.querySelector('input[name="http-port"]')).toBeNull();
    const detail = textOf(el.querySelector('.devdetail'));
    expect(detail).toContain('192.168.1.117:8443');
    expect(detail).toContain('192.168.1.117:9080');
    // Mở lại form: phần Nâng cao đóng như lần đầu.
    buttonByText(el, 'Thêm theo địa chỉ…')!.click();
    await settled(el);
    expect(buttonByText(el, 'Nâng cao')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('lỗi của Rust bằng câu tiếng Việt: thêm thiết bị (tối đa 64, mã lạ), quét (đang có lượt khác), TLS khi Online', async () => {
    const { el, dev } = await openDialog();
    await advance(el, 2500);
    buttonByText(el, 'Thêm theo địa chỉ…')!.click();
    await settled(el);
    const input = el.querySelector<HTMLInputElement>('input[name="addr"]')!;
    vi.spyOn(dev, 'addDevice').mockResolvedValueOnce({ error: 'too-many' });
    typeInto(input, '10.8.0.21');
    buttonByText(el, 'Thêm')!.click();
    await advance(el, 10);
    expect(textOf(el.querySelector('#dd-addr-err'))).toBe(
      'Đã lưu tối đa 64 thiết bị: bỏ bớt thiết bị không dùng',
    );
    vi.spyOn(dev, 'addDevice').mockResolvedValueOnce({ error: 'ma-la' });
    buttonByText(el, 'Thêm')!.click();
    await advance(el, 10);
    expect(textOf(el.querySelector('#dd-addr-err'))).toBe(
      'Không thêm được thiết bị: lỗi không rõ của thiết bị hoặc Studio (ma-la)',
    );
    vi.spyOn(dev, 'discover').mockRejectedValueOnce({ error: 'busy' });
    buttonByText(el, 'Tìm lại')!.click();
    await advance(el, 10);
    expect(statusLine(el)).toBe('Không quét được: đang có lượt quét khác, thử lại sau vài giây');
    buttonByText(el, 'Tìm lại')!.click();
    await advance(el, 2600);
    // Online: bắt tay TLS lỗi → câu kèm chi tiết của Rust.
    vi.spyOn(dev, 'probe').mockResolvedValueOnce({ error: 'tls', detail: 'bad handshake' });
    buttonByText(el, 'Hủy')!.click();
    await settled(el);
    rows(el)[0].click();
    await settled(el);
    buttonByText(el, 'Online')!.click();
    await advance(el, 10);
    expect(textOf(el.querySelector('[role="alert"]'))).toBe(
      'Không kết nối được BL335-01: bắt tay TLS với thiết bị không được (bad handshake)',
    );
  });

  it('danh sách đã lưu: thiết bị đã dùng hiện cả khi không trả lời gói tìm; bỏ khỏi danh sách', async () => {
    vi.useFakeTimers();
    const env = await newOnlineApp();
    apps.push(env.app);
    await env.dev.addDevice({ host: '10.8.0.21' });
    const el = await mount<MatDevicesDialog>('mat-devices-dialog', env.app);
    await env.app.run('online.devices');
    await advance(el, 2500);
    expect(rowTexts(el).map((t) => t.slice(0, 20))).toHaveLength(3);
    const saved = rows(el)[2];
    expect(textOf(saved)).toContain('10.8.0.21');
    saved.click();
    await settled(el);
    buttonByText(el, 'Bỏ khỏi danh sách đã lưu')!.click();
    await advance(el, 10);
    expect(env.app.knownDevices).toEqual([]);
    expect(rows(el)).toHaveLength(2);
  });

  it('Online: thiết bị tìm thấy được lưu kèm deviceId và MAC rồi dò chứng chỉ; sang hộp thoại xác nhận chứng chỉ', async () => {
    const { app, el, dev } = await openDialog();
    const pin = await mount('mat-pin-dialog', app);
    await advance(el, 2500);
    const grid = el.querySelector<HTMLTableElement>('table[role="grid"]')!;
    grid.focus();
    press(grid, 'Enter');
    await advance(el, 10);
    await settled(pin);
    const add = dev.control.calls.find((c) => c.cmd === 'device_add');
    expect(add?.args).toMatchObject({
      host: '192.168.1.110',
      httpsPort: 8443,
      name: 'BL335-01',
      fromDiscovery: { deviceId: '4f9c2a8e-6d1b-4c3a-9e57-0b2f1d6c8a10', mac: '02:4E:1C:5A:33:01' },
    });
    expect(app.ui.dialog).toEqual({ kind: 'pin' });
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(textOf(pin.querySelector('.dlg-h'))).toContain('Xác nhận chứng chỉ · BL335-01');
  });

  it('Đọc lên thành project mới: khóa, nói lý do; lỗi khi Online hiện ngay trong hộp thoại', async () => {
    const { app, el, dev } = await openDialog();
    const k = await dev.addDevice({ host: '192.168.1.110', httpsPort: 9443, name: 'BL335-01' });
    await advance(el, 2500);
    await app.refreshDevices();
    await settled(el);
    const upload = buttonByText(el, 'Đọc lên thành project mới')!;
    expect(upload.getAttribute('aria-disabled')).toBe('true');
    expect(upload.title).toContain('Có ở feature 005');
    const savedRow = rows(el).find((r) => r.dataset.key === `saved:${'id' in k ? k.id : ''}`)!;
    savedRow.click();
    await settled(el);
    // Thiết bị thật trả lời dò chứng chỉ sau vài trăm ms: giữ lại để thấy bước đang dò.
    const probe = dev.probe.bind(dev);
    vi.spyOn(dev, 'probe').mockImplementation(async (id) => {
      await new Promise((r) => setTimeout(r, 30));
      return probe(id);
    });
    buttonByText(el, 'Online')!.click();
    await advance(el, 1);
    expect(textOf(el.querySelector('.dlg-f'))).toContain('Đang kiểm chứng chỉ BL335-01…');
    await advance(el, 50);
    const alert = el.querySelector('[role="alert"]');
    expect(textOf(alert)).toBe(
      'Không kết nối được BL335-01: không tới được cổng HTTPS của thiết bị',
    );
    expect(app.ui.dialog).toEqual({ kind: 'devices' });
  });
});
