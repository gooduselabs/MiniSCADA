// Chip "Ghi PLC" khi Online và hộp "Dừng ghi của logic" (feature 011, T132/T144; FR-083, FR-096; mockup cảnh 3; T007 quyết
// định 1, 5): bốn trạng thái tắt/bật/dừng/chưa hỗ trợ theo system/info.logic; W_LOGIC_WRITES_OFF khi project có writes mà
// thiết bị tắt; menu của chip: "Dừng ghi của logic…" chỉ administrator khi đang bật (tích xác nhận, không nhập lại mật
// khẩu), "Bật ghi PLC" luôn khóa kèm LOGIC_ENABLE_ROOT_ONLY; cột trạng thái sống của bảng khối.
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import { pinnedDevice } from '../online-test-helpers.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, settled } from '../test-helpers.ts';
import '../dialogs/download-dialog.ts';
import { newLogicOnlineApp } from './logic-test-helpers.ts';
import './logic-editor.ts';
import './stop-dialog.ts';

const apps: StudioApp[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const a of apps.splice(0)) a.session.disconnect();
  cleanup();
});

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function online(writes: 'off' | 'on' | 'stopped', user = 'admin') {
  vi.useFakeTimers();
  const env = await newLogicOnlineApp(writes);
  apps.push(env.app);
  env.app.session.goOnline(await pinnedDevice(env.dev, 'BL335-01'));
  await vi.advanceTimersByTimeAsync(50);
  await env.app.login(user, env.pw(user));
  await vi.advanceTimersByTimeAsync(400);
  env.app.openEditor('logic');
  const host = document.createElement('div');
  document.body.append(host);
  const dlg = document.createElement('mat-logic-stop-dialog');
  (dlg as unknown as { app: StudioApp }).app = env.app;
  document.body.append(dlg);
  const draw = () => render(renderEditor(env.app, 'logic'), host);
  draw();
  env.app.subscribe(draw);
  const again = async (ms = 50) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settled(document.body);
  };
  await again(100);
  const chip = () => host.querySelector<HTMLButtonElement>('mat-logic-chip button.chip')!;
  return { ...env, host, chip, again };
}

describe('chip Ghi PLC khi Online', () => {
  it('bật: chip xanh có biểu tượng và chữ; cột trạng thái sống của luật (THROTTLED có màu thông tin)', async () => {
    const { chip, host, again } = await online('on');
    await again(600);
    expect(text(chip())).toContain('Ghi PLC: bật');
    expect(chip().classList.contains('ok')).toBe(true);
    expect(chip().querySelector('svg')).not.toBeNull();
    const live = host.querySelector('tr[data-id="pump_high_level"] td.live-col .chip')!;
    expect(live.classList.contains('st-THROTTLED')).toBe(true);
    expect(text(live)).toContain('THROTTLED');
  });

  it('tắt mà project có writes: chip xám và chip cảnh báo W_LOGIC_WRITES_OFF', async () => {
    const { chip, host } = await online('off');
    expect(text(chip())).toContain('Ghi PLC: tắt');
    expect(text(host.querySelector('[data-role="writes-off"]'))).toContain('W_LOGIC_WRITES_OFF');
  });

  it('administrator: menu → Dừng ghi của logic… → tích xác nhận → dừng ngay; chip thành "dừng"', async () => {
    const { app, chip, host, dev, again } = await online('on');
    chip().click();
    await again();
    const menu = host.querySelector('mat-logic-chip [role="menu"]')!;
    const stop = menu.querySelector<HTMLButtonElement>('[data-act="stop"]')!;
    expect(stop.getAttribute('aria-disabled')).toBe('false');
    const enable = menu.querySelector<HTMLButtonElement>('[data-act="enable"]')!;
    expect(enable.getAttribute('aria-disabled')).toBe('true');
    expect(text(menu)).toContain('LOGIC_ENABLE_ROOT_ONLY');
    stop.click();
    await again();
    expect(app.ui.dialog?.kind).toBe('logicStop');
    const dlg = document.querySelector('mat-logic-stop-dialog')!;
    expect(dlg.querySelector('input[type="password"]')).toBeNull();
    const go = dlg.querySelector<HTMLButtonElement>('[data-act="stop-go"]')!;
    expect(go.disabled).toBe(true);
    dlg.querySelector<HTMLInputElement>('[data-role="stop-ack"]')!.click();
    await again();
    expect(go.disabled).toBe(false);
    go.click();
    await again(5200);
    expect(dev.control.calls.filter((c) => c.cmd === 'logic_writes_stop')).toHaveLength(1);
    expect(app.ui.dialog).toBeNull();
    expect(text(chip())).toContain('Ghi PLC: dừng');
    expect(chip().classList.contains('err')).toBe(true);
  });

  it('engineer: "Dừng ghi" khóa kèm lý do cần administrator', async () => {
    const { chip, host, again } = await online('on', 'kysu1');
    chip().click();
    await again();
    const stop = host.querySelector<HTMLButtonElement>('mat-logic-chip [data-act="stop"]')!;
    expect(stop.getAttribute('aria-disabled')).toBe('true');
    expect(text(host.querySelector('mat-logic-chip [role="menu"]'))).toContain('administrator');
  });
});
