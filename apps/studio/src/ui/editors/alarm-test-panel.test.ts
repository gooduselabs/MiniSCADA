// Panel Thử alarm (T070, T080, FR-080, SC-017): đồng hồ ảo, 1×/5×/20×, nhập tay Tag đẩy qua ngưỡng thấy bật sau trễ, ack thử,
// bật/tắt từng alarm, nhật ký, alarm lỗi bị bỏ qua, phím chỉ khi panel có focus, lệnh trong bảng lệnh.
import { afterEach, describe, expect, it } from 'vitest';
import { full05WithAlarms } from '../../model/alarm-fixtures.ts';
import { clockText, detailText } from './alarm-test-panel.ts';
import { cleanup, mount, newApp02, settled } from '../test-helpers.ts';
import './alarm-test-panel.ts';
import type { AlarmTestPanel } from './alarm-test-panel.ts';

afterEach(cleanup);

const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function open(files?: Record<string, string>) {
  const env = await newApp02({ files: files ?? (await full05WithAlarms()) });
  env.app.openEditor('alarmTest');
  const el = await mount<AlarmTestPanel>('mat-alarm-test', env.app);
  await settled(el);
  return { ...env, el };
}
const click = async (el: Element, sel: string) => {
  el.querySelector<HTMLElement>(sel)!.click();
  await settled(el);
};
async function setSel(el: Element, sel: string, value: string) {
  const s = el.querySelector<HTMLSelectElement>(sel)!;
  s.value = value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(el);
}
async function setNum(el: Element, sel: string, value: string) {
  const s = el.querySelector<HTMLInputElement>(sel)!;
  s.value = value;
  s.dispatchEvent(new Event('change', { bubbles: true }));
  await settled(el);
}
const steps = async (el: Element, n: number) => {
  for (let i = 0; i < n; i++) await click(el, '[data-act="step"]');
};
const logText = (el: Element) => text(el.querySelector('[data-role="log"]'));

describe('định dạng', () => {
  it('giờ ảo mm:ss.sss và chi tiết nhật ký bằng tiếng Việt', () => {
    expect(clockText(3250)).toBe('00:03.250');
    expect(clockText(65_500, 1)).toBe('01:05.5');
    expect(detailText('85 / 80 · 3000 ms · #2')).toBe('giá trị 85, ngưỡng 80, trễ 3 s');
  });
});

describe('mat-alarm-test', () => {
  it('bố cục: điều khiển, đồng hồ 00:00.2, bảng Nguồn của các Tag được tham chiếu, bảng alarm dùng chung, danh sách, nhật ký', async () => {
    const { el } = await open();
    expect(text(el.querySelector('h2'))).toBe('Thử alarm');
    expect([...el.querySelectorAll('[data-speed]')].map(text)).toEqual(['1×', '5×', '20×']);
    expect(text(el.querySelector('[data-role="clock"]'))).toBe('00:00.2');
    const tags = [...el.querySelectorAll('[data-role="sources"] tr[data-tag]')].map(
      (r) => (r as HTMLElement).dataset.tag,
    );
    expect(tags).toEqual(expect.arrayContaining(['TANK01.LEVEL', 'PUMP01.FAULT', 'METER1.P']));
    expect(el.querySelector('mat-alarm-table')).not.toBeNull();
    expect(el.querySelectorAll('[data-role="list"] tr[data-def]')).toHaveLength(3);
  });

  it('nhập tay Tag qua ngưỡng H: bật sau trễ 3 s ảo (không dùng giờ thật), nhật ký có lý do "hết trễ bật"', async () => {
    const { el } = await open();
    await setSel(el, 'tr[data-tag="TANK01.LEVEL"] [data-role="mode"]', 'manual');
    await setNum(el, 'tr[data-tag="TANK01.LEVEL"] input[type="number"]', '85');
    expect(logText(el)).toContain('Nhập tay TANK01.LEVEL = 85');
    await steps(el, 8); // 2 s ảo: chưa hết trễ
    expect(logText(el)).not.toContain('TANK01_LEVEL.H');
    await steps(el, 6); // tới ~3,75 s ảo
    expect(logText(el)).toContain('TANK01_LEVEL.H');
    expect(logText(el)).toContain('NORMAL → ACTIVE_UNACK');
    expect(logText(el)).toContain('hết trễ bật');
    expect(logText(el)).toContain('giá trị 85, ngưỡng 80, trễ 3 s');
  });

  it('nút nhanh "Vượt ngưỡng H" và "Về bình thường"; về dưới deadband thì hết sau trễ tắt', async () => {
    const { el } = await open();
    await setSel(el, 'tr[data-tag="TANK01.LEVEL"] [data-role="mode"]', 'manual');
    await click(el, 'tr[data-def="TANK01_LEVEL"] [data-act="over"]');
    await steps(el, 14);
    expect(logText(el)).toContain('ACTIVE_UNACK');
    await click(el, 'tr[data-def="TANK01_LEVEL"] [data-act="back"]');
    await steps(el, 4);
    expect(logText(el)).toContain('ra khỏi vùng deadband');
  });

  it('ack thử qua bảng alarm dùng chung; không gọi thiết bị', async () => {
    const { el, platform } = await open();
    await setSel(el, 'tr[data-tag="PUMP01.FAULT"] [data-role="mode"]', 'manual');
    const box = el.querySelector<HTMLInputElement>(
      'tr[data-tag="PUMP01.FAULT"] [data-role="value"]',
    )!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    await steps(el, 3);
    expect(logText(el)).toContain('PUMP01_FAULT');
    const table = el.querySelector('mat-alarm-table') as HTMLElement & {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<boolean>;
    };
    await table.updateComplete;
    await new Promise((r) => setTimeout(r, 60));
    const ackBtn = table.shadowRoot.querySelector<HTMLButtonElement>('button[data-act="ack"]');
    expect(ackBtn).not.toBeNull();
    ackBtn!.click();
    await new Promise((r) => setTimeout(r, 60));
    await settled(el);
    expect(logText(el)).toContain('ACTIVE_UNACK → ACTIVE_ACK');
    expect(platform.control.writes).toEqual([]);
  });

  it('tắt một alarm trong phiên thử không đổi enabled của project', async () => {
    const { app, el } = await open();
    const box = el.querySelector<HTMLInputElement>(
      'tr[data-def="PUMP01_FAULT"] [data-role="enabled"]',
    )!;
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await settled(el);
    await new Promise((r) => setTimeout(r, 20));
    expect(logText(el)).toContain('vô hiệu');
    expect(app.store.dirtyFiles()).toEqual([]);
  });

  it('Đặt lại về 00:00 và xóa nhật ký; tốc độ chọn được; Khởi động lại engine ghi "khởi động lại"', async () => {
    const { el } = await open();
    await steps(el, 4);
    expect(text(el.querySelector('[data-role="clock"]'))).toBe('00:01.2');
    await click(el, '[data-speed="20"]');
    expect(el.querySelector('[data-speed="20"]')!.getAttribute('aria-pressed')).toBe('true');
    await click(el, '[data-act="restart"]');
    expect(logText(el)).toContain('khởi động lại');
    await click(el, '[data-act="reset"]');
    expect(text(el.querySelector('[data-role="clock"]'))).toBe('00:00.0');
    await click(el, '[data-act="clear-log"]');
    expect(logText(el)).not.toContain('khởi động lại');
  });

  it('phím chỉ có hiệu lực khi panel có focus: . một bước, 3 chọn 20×; không bắt phím ở ô nhập', async () => {
    const { el } = await open();
    const panel = el.querySelector<HTMLElement>('[data-role="panel"]')!;
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }),
    );
    await settled(el);
    expect(text(el.querySelector('[data-role="clock"]'))).toBe('00:00.5');
    panel.dispatchEvent(
      new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }),
    );
    await settled(el);
    expect(el.querySelector('[data-speed="20"]')!.getAttribute('aria-pressed')).toBe('true');
    const search = el.querySelector<HTMLInputElement>('[data-role="log-search"]')!;
    search.dispatchEvent(
      new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }),
    );
    await settled(el);
    expect(el.querySelector('[data-speed="20"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('alarm có lỗi bị bỏ qua và liệt kê kèm mã; phần hợp lệ vẫn chạy', async () => {
    const files = await full05WithAlarms();
    const a = JSON.parse(files['alarms.json']!) as { alarms: Array<Record<string, unknown>> };
    a.alarms[1]!.tag = 'KHONG.CO';
    files['alarms.json'] = JSON.stringify(a);
    const env = await newApp02({ files });
    await env.app.store.validateNow();
    env.app.openEditor('alarmTest');
    const el = await mount<AlarmTestPanel>('mat-alarm-test', env.app);
    await settled(el);
    expect(text(el.querySelector('[data-role="skipped"]'))).toContain('1 alarm bị bỏ qua vì lỗi');
    expect(text(el.querySelector('[data-role="skipped"]'))).toContain(
      'PUMP01_FAULT: E_ALARM_TAG_REF',
    );
    expect(el.querySelectorAll('[data-role="list"] tr[data-def]')).toHaveLength(2);
  });

  it('project chưa có alarm: báo không có alarm hợp lệ để thử', async () => {
    const env = await newApp02();
    env.app.openEditor('alarmTest');
    const el = await mount<AlarmTestPanel>('mat-alarm-test', env.app);
    await settled(el);
    expect(text(el.querySelector('[data-role="empty"]'))).toContain('chưa có alarm hợp lệ');
  });

  it('lệnh trong bảng lệnh điều khiển panel đang mở', async () => {
    const { app, el } = await open();
    await app.run('alarm.test.step');
    await settled(el);
    expect(text(el.querySelector('[data-role="clock"]'))).toBe('00:00.5');
    await app.run('alarm.test.speed5');
    await settled(el);
    expect(el.querySelector('[data-speed="5"]')!.getAttribute('aria-pressed')).toBe('true');
  });
});
