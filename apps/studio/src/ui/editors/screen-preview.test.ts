// Xem trước màn hình (feature 004, T067, FR-032, FR-007, data-model §10): ba chế độ; "Thiết bị" khóa khi
// chưa theo dõi; mất phiên thì về Mô phỏng và báo; nhấp phần tử → lựa chọn `element` và inspector hiện
// binding chỉ đọc; phóng to, thu nhỏ, vừa khung; xem trước dùng giá trị của phiên thiết bị duy nhất.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import '../mat-shell.ts';
import type { MatShell } from '../mat-shell.ts';
import { flush, newDeviceApp, toMonitoring } from '../device-test-helpers.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';

const SCREEN = 'screen:tank-motor';
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const apps: StudioApp[] = [];

beforeAll(() => {
  // jsdom chưa có Web Animations (DomApplier quay cánh quạt bằng element.animate).
  if (!('animate' in Element.prototype))
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: () => ({ play() {}, pause() {}, cancel() {} }),
    });
});

async function openScreen() {
  const env = await newDeviceApp();
  apps.push(env.app);
  const shell = await mount<MatShell>('mat-shell', env.app);
  env.app.openEditor(SCREEN);
  await settled(shell);
  await frame();
  const preview = () => shell.querySelector<HTMLElement>('mat-screen-preview')!;
  return { ...env, shell, preview };
}

const svgEl = (root: Element, uid: string) =>
  root.querySelector('.svg-host')?.shadowRoot?.querySelector(`[data-mat-uid="${uid}"]`) ?? null;
const modeBtn = (root: Element, mode: string) =>
  root.querySelector<HTMLButtonElement>(`.seg [data-mode="${mode}"]`)!;
const act = (root: Element, name: string) =>
  root.querySelector<HTMLButtonElement>(`.ed-tools [data-act="${name}"]`)!;
const zoomText = (root: Element) => root.querySelector('.sp-zoom')?.textContent?.trim();
const board = (root: Element) => root.querySelector<HTMLElement>('.board')!;
const pressed = (b: Element) => b.getAttribute('aria-pressed');

async function tick(shell: Element) {
  await flush();
  await settled(shell);
  await frame();
}

describe('xem trước màn hình', () => {
  afterEach(() => {
    for (const app of apps.splice(0)) app.session.disconnect();
    cleanup();
  });

  it('editor screen:{id} vẽ SVG của project bằng svg-renderer, có tên và kích thước thiết kế', async () => {
    const { shell, preview } = await openScreen();
    expect(shell.querySelector('mat-pending-editor')).toBeNull();
    const p = preview();
    expect(p).not.toBeNull();
    expect(p.querySelector('.ed-head h2')?.textContent).toBe('Bồn nước + bơm');
    expect(p.querySelector('.ed-head .path')?.textContent).toContain('screens/tank-motor.svg');
    expect(p.querySelector('.ed-head .path')?.textContent).toContain('1280 × 720');
    expect(svgEl(p, 'el_tank_level')).not.toBeNull();
    expect(svgEl(p, 'el_txt_level')?.textContent).not.toBeUndefined();
  });

  it('ba chế độ: mặc định Mô phỏng chạy giá trị tự sinh; Tắt về bản vẽ gốc', async () => {
    const { shell, preview } = await openScreen();
    const p = preview();
    expect(p.querySelector('.seg')?.getAttribute('role')).toBe('group');
    expect(pressed(modeBtn(p, 'sim'))).toBe('true');
    expect(pressed(modeBtn(p, 'off'))).toBe('false');
    expect(svgEl(p, 'el_txt_level')?.textContent).toMatch(/^\d+\.\d %$/);
    modeBtn(p, 'off').click();
    await tick(shell);
    expect(pressed(modeBtn(p, 'off'))).toBe('true');
    expect(svgEl(p, 'el_txt_level')?.textContent).toBe('--');
    modeBtn(p, 'sim').click();
    await tick(shell);
    expect(pressed(modeBtn(p, 'sim'))).toBe('true');
    expect(svgEl(p, 'el_txt_level')?.textContent).toMatch(/^\d+\.\d %$/);
  });

  it('"Thiết bị" khóa khi chưa theo dõi, kèm lý do', async () => {
    const { app, shell, preview } = await openScreen();
    const p = preview();
    const dev = modeBtn(p, 'device');
    expect(dev.getAttribute('aria-disabled')).toBe('true');
    expect(dev.title).toContain('Cần kết nối theo dõi');
    dev.click();
    await tick(shell);
    expect(pressed(modeBtn(p, 'sim'))).toBe('true');
    expect(app.ui.toast?.text).toContain('Cần kết nối theo dõi');
  });

  it('chế độ Thiết bị dùng giá trị của phiên thiết bị duy nhất (một WebSocket)', async () => {
    const { app, device, shell, preview } = await openScreen();
    await toMonitoring(app, device);
    await tick(shell);
    const p = preview();
    expect(modeBtn(p, 'device').getAttribute('aria-disabled')).not.toBe('true');
    modeBtn(p, 'device').click();
    await tick(shell);
    expect(pressed(modeBtn(p, 'device'))).toBe('true');
    expect(svgEl(p, 'el_txt_level')?.textContent).toBe('42.0 %');
    expect(svgEl(p, 'el_txt_speed')?.textContent).toBe('1440');
    // Snapshot theo thứ tự đăng ký: TANK01.LEVEL là Tag đầu.
    const order = device.last().request().tags;
    device.last().delta([[order.indexOf('TANK01.LEVEL'), 55, 'GOOD']]);
    await tick(shell);
    expect(svgEl(p, 'el_txt_level')?.textContent).toBe('55.0 %');
    expect(device.sockets).toHaveLength(1);
    expect(device.openSockets()).toBe(1);
  });

  it('mất phiên (mất kết nối, ngắt) thì về Mô phỏng và báo', async () => {
    const { app, device, shell, preview } = await openScreen();
    await toMonitoring(app, device);
    await tick(shell);
    const p = preview();
    modeBtn(p, 'device').click();
    await tick(shell);
    device.last().serverClose(1006);
    await tick(shell);
    expect(app.session.state).toBe('lost');
    expect(pressed(modeBtn(p, 'sim'))).toBe('true');
    expect(app.ui.toast?.text).toBe('Mất phiên theo dõi thiết bị: xem trước chuyển về Mô phỏng.');
    expect(svgEl(p, 'el_txt_level')?.textContent).toMatch(/^\d+\.\d %$/);

    // Có lại rồi ngắt (Ctrl+M) khi đang xem bằng dữ liệu thiết bị: cũng về Mô phỏng.
    await app.run('online.disconnect');
    await toMonitoring(app, device);
    await tick(shell);
    modeBtn(p, 'device').click();
    await tick(shell);
    expect(pressed(modeBtn(p, 'device'))).toBe('true');
    await app.run('online.disconnect');
    await tick(shell);
    expect(pressed(modeBtn(p, 'sim'))).toBe('true');
    expect(app.ui.toast?.text).toBe('Mất phiên theo dõi thiết bị: xem trước chuyển về Mô phỏng.');
  });

  it('nhấp phần tử → lựa chọn element; inspector hiện binding chỉ đọc, ghi chú GĐ 3b', async () => {
    const { app, shell, preview } = await openScreen();
    app.setInspectorTab('info');
    const p = preview();
    svgEl(p, 'el_tank_level')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    );
    await tick(shell);
    expect(app.store.state.selection).toEqual({
      kind: 'element',
      screen: 'tank-motor',
      uid: 'el_tank_level',
    });
    expect(app.ui.inspectorTab).toBe('props');
    const insp = shell.querySelector('mat-inspector')!;
    const text = insp.textContent!.replace(/\s+/g, ' ');
    expect(insp.querySelector('.insp-ctx')?.textContent).toBe('Mức nước · el_tank_level');
    for (const s of ['Mức chất lỏng', 'TANK01.LEVEL', 'Độ mờ', 'TANK01.INFLOW', 'trực tiếp'])
      expect(text, s).toContain(s);
    expect(text).toContain('Sửa bằng giao diện: GĐ 3b');
    expect(
      insp.querySelector('.insp-body input, .insp-body select, .insp-body textarea'),
    ).toBeNull();
    const sel = p.querySelector<HTMLElement>('.selbox')!;
    expect(sel.hidden).toBe(false);
    expect(sel.querySelector('.nm')?.textContent).toBe('Mức nước');

    // Nhóm "Chung": tên, uid, loại.
    insp.querySelector<HTMLButtonElement>('.ptabs [data-ptab="general"]')!.click();
    await tick(shell);
    const general = insp.textContent!.replace(/\s+/g, ' ');
    for (const s of ['Mức nước', 'el_tank_level', 'Hình', 'screens/tank-motor.svg'])
      expect(general, s).toContain(s);

    // Nhấp chỗ trống: bỏ chọn, inspector hiện thuộc tính màn hình.
    p.querySelector('.svg-host')!
      .shadowRoot!.querySelector('svg')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await tick(shell);
    expect(app.store.state.selection).toBeNull();
    expect(sel.hidden).toBe(true);
    expect(insp.querySelector('.insp-ctx')?.textContent).toBe('Màn hình Bồn nước + bơm');
    expect(insp.textContent).toContain('1280 × 720');
  });

  it('phần tử chọn ở Details cũng tô trên màn hình; vị trí lỗi chọn đúng phần tử', async () => {
    const { app, shell, preview } = await openScreen();
    const row = [...shell.querySelectorAll<HTMLElement>('mat-details [role="option"]')].find((r) =>
      r.textContent?.includes('Thân bơm'),
    );
    row!.click();
    await tick(shell);
    const sel = preview().querySelector<HTMLElement>('.selbox')!;
    expect(sel.hidden).toBe(false);
    expect(sel.querySelector('.nm')?.textContent).toBe('Thân bơm');

    app.revealLocation({ editor: 'screen', screen: 'tank-motor', element: 'el_txt_speed' });
    await tick(shell);
    await tick(shell);
    expect(app.store.state.selection).toEqual({
      kind: 'element',
      screen: 'tank-motor',
      uid: 'el_txt_speed',
    });
    expect(sel.querySelector('.nm')?.textContent).toBe('Chữ tốc độ');
  });

  it('SVG hỏng (sửa ngoài Studio rồi F7): báo lý do tại editor, không vỡ giao diện', async () => {
    const { app, platform, shell, preview } = await openScreen();
    platform.control.editOutside(
      'screens/tank-motor.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"',
    );
    await app.run('tools.validate');
    await tick(shell);
    await tick(shell);
    const banner = preview().querySelector('.banner.err');
    expect(banner?.textContent).toContain('Không vẽ được màn hình');
    expect(svgEl(preview(), 'el_tank_level')).toBeNull();
    // Các nút vẫn dùng được.
    act(preview(), 'zoom-in').click();
    await tick(shell);
    expect(zoomText(preview())).toBe('63 %');
  });

  it('phóng to, thu nhỏ, vừa khung, 100 %, Ctrl+lăn chuột; thước và lưới theo tỉ lệ', async () => {
    const { shell, preview } = await openScreen();
    const p = preview();
    expect(zoomText(p)).toBe('50 %');
    expect(board(p).style.width).toBe('640px');
    act(p, 'zoom-in').click();
    await tick(shell);
    expect(zoomText(p)).toBe('63 %');
    expect(board(p).style.width).toBe('800px');
    act(p, 'zoom-out').click();
    await tick(shell);
    expect(zoomText(p)).toBe('50 %');

    const scroll = p.querySelector<HTMLElement>('.cv-scroll')!;
    Object.defineProperty(scroll, 'clientWidth', { configurable: true, value: 400 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 600 });
    act(p, 'fit').click();
    await tick(shell);
    expect(zoomText(p)).toBe('25 %');
    expect(board(p).style.width).toBe('320px');
    expect(board(p).style.height).toBe('180px');

    act(p, 'actual').click();
    await tick(shell);
    expect(zoomText(p)).toBe('100 %');
    expect(board(p).style.width).toBe('1280px');
    const labels = [...p.querySelectorAll('.rt span')].map((s) => s.textContent);
    expect(labels).toEqual(expect.arrayContaining(['0', '100', '1200']));

    scroll.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, cancelable: true }),
    );
    await tick(shell);
    expect(zoomText(p)).toBe('110 %');

    expect(pressed(act(p, 'grid'))).toBe('true');
    expect(p.querySelector<HTMLElement>('.gridov')!.hidden).toBe(false);
    act(p, 'grid').click();
    await tick(shell);
    expect(pressed(act(p, 'grid'))).toBe('false');
    expect(p.querySelector<HTMLElement>('.gridov')!.hidden).toBe(true);
  });
});
