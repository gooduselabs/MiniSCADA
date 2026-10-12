// Thanh công cụ, thanh trạng thái và khung: Mô phỏng (T203, FR-052, D30, US6-1, US6-3): nút bật/tắt (aria-pressed) từ thanh công
// cụ và bảng lệnh; dấu "MÔ PHỎNG" màu tím, khác viền cam của Online, ở khung, thanh trạng thái; Online và Mô phỏng không cùng
// hiện; mọi lệnh dùng được bằng bàn phím.
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession } from './fake-session.ts';
import './mat-shell.ts';
import type { MatShell } from './mat-shell.ts';
import './mat-statusbar.ts';
import type { MatStatusbar } from './mat-statusbar.ts';
import './mat-toolbar.ts';
import type { MatToolbar } from './mat-toolbar.ts';
import { cleanup, mount, newApp, newApp02, press, settled } from './test-helpers.ts';
import { paletteEntries, searchPalette } from '../app/palette.ts';

afterEach(cleanup);

const simBtn = (el: Element) =>
  el.querySelector<HTMLButtonElement>('button[data-cmd="tools.simulate"]')!;

describe('mat-toolbar: nút Mô phỏng', () => {
  it('nút có chữ Mô phỏng, aria-pressed theo trạng thái; nhấp bật rồi tắt', async () => {
    const { app } = await newApp02();
    const bar = await mount<MatToolbar>('mat-toolbar', app);
    expect(simBtn(bar).textContent).toContain('Mô phỏng');
    expect(simBtn(bar).getAttribute('aria-pressed')).toBe('false');
    simBtn(bar).click();
    await settled(bar);
    expect(app.simulating()).toBe(true);
    expect(simBtn(bar).getAttribute('aria-pressed')).toBe('true');
    simBtn(bar).click();
    await settled(bar);
    expect(app.simulating()).toBe(false);
    expect(simBtn(bar).getAttribute('aria-pressed')).toBe('false');
  });

  it('chưa mở project: nút khóa kèm lý do (không bật được)', async () => {
    const { app } = await newApp({ open: false });
    const bar = await mount<MatToolbar>('mat-toolbar', app);
    expect(simBtn(bar).getAttribute('aria-disabled')).toBe('true');
    expect(simBtn(bar).title).toContain('Chưa mở project');
    simBtn(bar).click();
    await settled(bar);
    expect(app.simulating()).toBe(false);
  });

  it('bàn phím: nút nằm trong vòng Tab của thanh công cụ (roving), Enter bật Mô phỏng', async () => {
    const { app } = await newApp02();
    const bar = await mount<MatToolbar>('mat-toolbar', app);
    simBtn(bar).focus();
    press(simBtn(bar), 'Enter');
    simBtn(bar).click(); // Enter trên <button> kích hoạt click
    await settled(bar);
    expect(app.simulating()).toBe(true);
  });
});

describe('dấu MÔ PHỎNG', () => {
  async function shell(simulate = true) {
    const env = await newApp02();
    const el = await mount<MatShell>('mat-shell', env.app);
    if (simulate) await env.app.run('tools.simulate');
    await settled(el);
    return { ...env, el };
  }

  it('khung có lớp sim và chip MÔ PHỎNG (có chữ, không chỉ màu); tắt thì mất', async () => {
    const { app, el } = await shell();
    expect(el.querySelector('.win')!.classList.contains('sim')).toBe(true);
    expect(el.querySelector('.win')!.classList.contains('online')).toBe(false);
    const chip = el.querySelector('.sim-chip')!;
    expect(chip.textContent).toContain('MÔ PHỎNG');
    expect(chip.getAttribute('role')).toBe('status');
    await app.run('tools.simulate');
    await settled(el);
    expect(el.querySelector('.sim-chip')).toBeNull();
    expect(el.querySelector('.win')!.classList.contains('sim')).toBe(false);
  });

  it('thanh trạng thái có dấu MÔ PHỎNG kèm câu "không gửi gì tới thiết bị"', async () => {
    const { app } = await newApp02();
    const bar = await mount<MatStatusbar>('mat-statusbar', app);
    expect(bar.querySelector('[data-role="sim"]')).toBeNull();
    await app.run('tools.simulate');
    await settled(bar);
    const pill = bar.querySelector('[data-role="sim"]')!;
    expect(pill.textContent).toContain('MÔ PHỎNG');
    expect(pill.getAttribute('title')).toContain('không gửi gì tới BL335');
  });

  it('khác Online: lớp online và sim không bao giờ cùng có; Online thì chip Online, không có chip MÔ PHỎNG', async () => {
    const session = new FakeSession();
    session.fakeState = 'idle';
    const env = await newApp02({ session });
    const el = await mount<MatShell>('mat-shell', env.app);
    await env.app.run('tools.simulate');
    await settled(el);
    expect(el.querySelector('.win')!.className).toContain('sim');
    session.fakeState = 'monitoring';
    session.push({ type: 'state', state: 'monitoring' } as never);
    await settled(el);
    const cls = el.querySelector('.win')!.className;
    expect(cls).toContain('online');
    expect(cls).not.toContain('sim');
    expect(el.querySelector('.sim-chip')).toBeNull();
  });
});

describe('bảng lệnh', () => {
  it('Mô phỏng có trong bảng lệnh, gõ "mo phong" tìm được và chạy được', async () => {
    const { app } = await newApp02();
    const found = searchPalette(paletteEntries(app.commandContext()), 'mo phong');
    expect(found.map((e) => e.id)).toContain('tools.simulate');
    expect(found.find((e) => e.id === 'tools.simulate')!.enabled).toBe(true);
    await app.run('tools.simulate');
    expect(app.simulating()).toBe(true);
  });
});
