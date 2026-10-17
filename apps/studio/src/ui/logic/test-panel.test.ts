// Bảng "Thử logic" (feature 011, T132/T144; FR-094; mockup studio-logic.html cảnh 2): tab cạnh Thông tin ở khung dưới;
// chạy/dừng, một quét, đặt lại, tua ×1/×10/×100, đặt tay giá trị và quality, cờ đồng bộ giờ, đường thời gian bằng SVG,
// nhật ký hành động, trạng thái khối. Không gửi gì tới thiết bị.
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioApp } from '../../app/app.ts';
import '../mat-inspector.ts';
import type { MatInspector } from '../mat-inspector.ts';
import { renderEditor } from '../registry.ts';
import { cleanup, mount, settled } from '../test-helpers.ts';
import { newLogicApp } from './logic-test-helpers.ts';
import './logic-editor.ts';
import type { LogicTestPanel } from './test-panel.ts';

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const text = (el: Element | null | undefined) =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function openTest(app: StudioApp) {
  app.openEditor('logic');
  const host = document.createElement('div');
  document.body.append(host);
  const draw = () => render(renderEditor(app, 'logic'), host);
  draw();
  app.subscribe(draw);
  const insp = await mount<MatInspector>('mat-inspector', app);
  await settled(document.body);
  const tab = insp.querySelector<HTMLButtonElement>('mat-logic-dock [data-tab="test"]')!;
  expect(tab).not.toBeNull();
  tab.click();
  await settled(document.body);
  const panel = insp.querySelector<LogicTestPanel>('mat-logic-test')!;
  expect(panel).not.toBeNull();
  const again = () => settled(document.body);
  return { insp, panel, again, host };
}

describe('Thử logic', () => {
  it('nút Thử logic trên thanh công cụ editor mở tab Thử logic', async () => {
    const { app } = await newLogicApp();
    const { host } = await openTest(app);
    const insp = document.querySelector('mat-inspector')!;
    insp.querySelector<HTMLButtonElement>('mat-logic-dock [data-tab="info"]')!.click();
    await settled(document.body);
    expect(insp.querySelector('mat-logic-test')).toBeNull();
    host.querySelector<HTMLButtonElement>('mat-logic-editor [data-act="test"]')!.click();
    await settled(document.body);
    expect(insp.querySelector('mat-logic-test')).not.toBeNull();
  });

  it('đặt tay mức 15 % rồi chạy quét: sau hold 10 s có lệnh ghi (mô phỏng) trong nhật ký và trên đường thời gian', async () => {
    const { app } = await newLogicApp();
    const { panel, again } = await openTest(app);
    const sim = panel.sim!;
    expect(sim).not.toBeNull();
    sim.jumpWall(Date.UTC(2026, 9, 15, 1, 0, 0)); // Thứ Năm 08:00 giờ thiết bị
    const man = panel.querySelector<HTMLInputElement>('[data-manual="TANK01.LEVEL"]')!;
    man.click();
    const val = panel.querySelector<HTMLInputElement>('[data-value="TANK01.LEVEL"]')!;
    val.value = '50';
    val.dispatchEvent(new Event('change', { bubbles: true }));
    sim.run(10);
    val.value = '15';
    val.dispatchEvent(new Event('change', { bubbles: true }));
    sim.run(105);
    panel.refresh();
    await again();
    expect(text(panel.querySelector('[data-role="log"]'))).toContain('pump_low_level');
    expect(text(panel.querySelector('[data-role="log"]'))).toContain('PUMP01.RUN_CMD = true');
    expect(panel.querySelectorAll('svg.tlsvg [data-mark="write"]').length).toBe(1);
    expect(panel.querySelectorAll('svg.tlsvg [data-lane]').length).toBeGreaterThanOrEqual(6);
    expect(text(panel.querySelector('[data-role="bst"]'))).toContain('pump_low_level');
    expect(text(panel.querySelector('[data-role="scans"]'))).toBe('115');
  });

  it('một quét, đặt lại; tua ×10 đổi khung nhìn; quality BAD làm luật SUSPENDED (chip có chữ và biểu tượng)', async () => {
    const { app } = await newLogicApp();
    const { panel, again } = await openTest(app);
    panel.querySelector<HTMLButtonElement>('[data-act="step"]')!.click();
    await again();
    expect(text(panel.querySelector('[data-role="scans"]'))).toBe('1');
    panel.querySelector<HTMLButtonElement>('[data-act="reset"]')!.click();
    await again();
    expect(text(panel.querySelector('[data-role="scans"]'))).toBe('0');
    panel.querySelector<HTMLButtonElement>('[data-speed="10"]')!.click();
    await again();
    expect(panel.querySelector('[data-speed="10"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(text(panel.querySelector('[data-role="window"]'))).toContain('30 phút');
    panel.querySelector<HTMLInputElement>('[data-manual="TANK01.LEVEL"]')!.click();
    const q = panel.querySelector<HTMLSelectElement>('[data-quality="TANK01.LEVEL"]')!;
    q.value = 'BAD';
    q.dispatchEvent(new Event('change', { bubbles: true }));
    panel.querySelector<HTMLButtonElement>('[data-act="step"]')!.click();
    await again();
    const chip = panel.querySelector('[data-role="bst"] [data-block="pump_high_level"] .chip')!;
    expect(chip.classList.contains('st-SUSPENDED')).toBe(true);
    expect(text(chip)).toContain('SUSPENDED');
    expect(chip.querySelector('svg')).not.toBeNull();
  });

  it('Chạy/Dừng bằng hẹn giờ: mỗi 100 ms thật chạy speed lần quét', async () => {
    vi.useFakeTimers();
    const { app } = await newLogicApp();
    const { panel, again } = await openTest(app);
    panel.querySelector<HTMLButtonElement>('[data-act="play"]')!.click();
    await vi.advanceTimersByTimeAsync(1000);
    panel.querySelector<HTMLButtonElement>('[data-act="play"]')!.click();
    await again();
    expect(panel.sim!.scans).toBe(10);
    expect(text(panel.querySelector('[data-role="state"]'))).toContain('Đang dừng');
  });
});
