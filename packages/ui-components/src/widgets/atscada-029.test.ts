// Feature 029: widget/thuộc tính bổ sung kiểu ATSCADA FastWeb (switch Tag số, nút có phản hồi, nhấp nháy theo ngưỡng,
// Tag trạng thái thứ hai, setpoint chuỗi, hẹn giờ Từ–Đến, CSV alarm). Ghi vẫn qua hộp xác nhận và kiểm quyền.
import type { WidgetItem } from '@mat/project-schema';
import { afterEach, describe, expect, it } from 'vitest';
import { ModalRegistry } from '../control/modal-registry.ts';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { ValueTable } from '@mat/expression';
import type { AlarmInstance, TagInfo } from '../host/types.ts';
import { alarmsCsv } from '../alarm/mat-alarm-list.ts';
import { dialog, dialogBtn, settle } from './control-test-util.ts';
import { registerWidgets } from './register.ts';
import { fmtHm, parseHm } from './time-range.ts';

afterEach(() => document.body.replaceChildren());

const rw = (id: string, type: TagInfo['type'], over: Partial<TagInfo> = {}): TagInfo => ({
  id,
  type,
  access: 'RW',
  kind: 'external',
  ...over,
});

function env(tags: TagInfo[], tables: Record<string, ValueTable> = {}) {
  const source = new MemoryTagSource({ tags, tables, now: 1000 });
  const host = new FakeActionHost({ session: { user: 'an', role: 'operator' } });
  return { source, host, modal: new ModalRegistry() };
}
type Env = ReturnType<typeof env>;

async function mount(
  e: Env,
  widget: string,
  tags: WidgetItem['tags'],
  props: WidgetItem['props'] = {},
): Promise<HTMLElement> {
  registerWidgets();
  const el = document.createElement(`mat-w-${widget}`) as HTMLElement & Record<string, unknown>;
  el.item = { id: 'w1', type: 'widget', widget, x: 0, y: 0, width: 300, height: 80, tags, props };
  el.source = e.source;
  el.host = e.host;
  el.modal = e.modal;
  el.mode = 'run';
  el.context = { screen: 's1', widget: 'w1' };
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}
const $ = (el: HTMLElement, sel: string) => el.shadowRoot!.querySelector<HTMLElement>(sel)!;

describe('switch: Tag số với onValue/offValue, màu bật/tắt', () => {
  it('bật khi giá trị bằng onValue; bấm ghi offValue (write, có xác nhận)', async () => {
    const e = env([rw('M', 'INT16')]);
    e.source.set('M', { value: 5, quality: 'GOOD' });
    const el = await mount(
      e,
      'switch',
      { target: 'M' },
      { onValue: 5, offValue: 2, onColor: '#00ff00', offColor: '#ff0000' },
    );
    expect($(el, '[role="switch"]').getAttribute('aria-checked')).toBe('true');
    expect($(el, '.track').getAttribute('style')).toContain('#00ff00');
    $(el, '[role="switch"]').click();
    await settle(el);
    expect(dialog()).not.toBeNull();
    dialogBtn('ok').click();
    await settle(el);
    expect(e.host.writes[0]).toMatchObject({ kind: 'write', tag: 'M', value: 2 });
  });

  it('Tag số đang tắt: ghi onValue (mặc định 1)', async () => {
    const e = env([rw('M', 'UINT16')]);
    e.source.set('M', { value: 0, quality: 'GOOD' });
    const el = await mount(e, 'switch', { target: 'M' });
    expect($(el, '[role="switch"]').getAttribute('aria-checked')).toBe('false');
    $(el, '[role="switch"]').click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    expect(e.host.writes[0]).toMatchObject({ kind: 'write', value: 1 });
  });
});

describe('button: Tag phản hồi', () => {
  it('đổi màu và aria-pressed theo activeValue', async () => {
    const e = env([rw('FB', 'UINT16')]);
    e.source.set('FB', { value: 3, quality: 'GOOD' });
    const el = await mount(
      e,
      'button',
      { feedback: 'FB' },
      { label: 'Bơm', activeValue: '3', activeColor: '#123456', inactiveColor: '#654321' },
    );
    expect($(el, 'button').getAttribute('aria-pressed')).toBe('true');
    expect($(el, 'button').getAttribute('style')).toContain('#123456');
    e.source.set('FB', { value: 1, quality: 'GOOD' });
    await settle(el);
    expect($(el, 'button').getAttribute('aria-pressed')).toBe('false');
    expect($(el, 'button').getAttribute('style')).toContain('#654321');
  });

  it('không có Tag phản hồi: không aria-pressed', async () => {
    const el = await mount(env([]), 'button', {}, { label: 'X' });
    expect($(el, 'button').hasAttribute('aria-pressed')).toBe(false);
  });
});

describe('nhấp nháy theo ngưỡng và Tag trạng thái thứ hai', () => {
  const T: TagInfo = { id: 'T', type: 'FLOAT32', access: 'R', kind: 'external' };
  const S: TagInfo = { id: 'S', type: 'UINT16', access: 'R', kind: 'external', valueTable: 'TT' };
  const tables = {
    TT: {
      entries: [
        { value: 1, text: 'Chạy', color: '#00aa00' },
        { value: 0, text: 'Dừng' },
      ],
    },
  } as unknown as Record<string, ValueTable>;
  for (const w of ['card', 'stat-tile']) {
    it(`${w}: blinkAbove/blinkBelow; khe status hiện qua bảng giá trị`, async () => {
      const e = env([T, S], tables);
      e.source.set('T', { value: 80, quality: 'GOOD' });
      e.source.set('S', { value: 1, quality: 'GOOD' });
      const el = await mount(e, w, { value: 'T', status: 'S' }, { blinkAbove: 70, blinkBelow: 10 });
      const blink = () => $(el, '.value').classList.contains('blink');
      expect(blink()).toBe(true);
      expect($(el, '[data-slot="status"]').textContent).toContain('Chạy');
      e.source.set('T', { value: 50, quality: 'GOOD' });
      await settle(el);
      expect(blink()).toBe(false);
      e.source.set('T', { value: 5, quality: 'GOOD' });
      await settle(el);
      expect(blink()).toBe(true);
      e.source.set('T', { value: 5, quality: 'BAD' });
      await settle(el);
      expect(blink()).toBe(false);
    });
  }

  it('lamp: blinkOn nhấp nháy khi bật', async () => {
    const e = env([rw('L', 'BOOL')]);
    e.source.set('L', { value: true, quality: 'GOOD' });
    const el = await mount(e, 'lamp', { state: 'L' }, { blinkOn: true });
    expect($(el, '.dot').classList.contains('blink')).toBe(true);
    e.source.set('L', { value: false, quality: 'GOOD' });
    await settle(el);
    expect($(el, '.dot').classList.contains('blink')).toBe(false);
  });
});

describe('setpoint: Tag chuỗi', () => {
  it('ô nhập chữ, ghi nguyên chuỗi, giới hạn độ dài theo Tag', async () => {
    const e = env([rw('NAME', 'STRING', { limits: { maxLength: 10 } })]);
    e.source.set('NAME', { value: 'Ca 1', quality: 'GOOD' });
    const el = await mount(e, 'setpoint', { target: 'NAME' });
    const input = $(el, 'input') as HTMLInputElement;
    expect(input.value).toBe('Ca 1');
    expect(input.getAttribute('inputmode')).toBe('text');
    expect(input.getAttribute('maxlength')).toBe('10');
    input.value = 'Ca đêm';
    input.dispatchEvent(new Event('input'));
    $(el, '[data-write]').click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    expect(e.host.writes[0]).toMatchObject({ kind: 'write', tag: 'NAME', value: 'Ca đêm' });
  });
});

describe('time-range: hẹn giờ Từ–Đến', () => {
  it('parseHm/fmtHm', () => {
    expect(parseHm('06:30')).toBe(390);
    expect(parseHm('24:00')).toBeNull();
    expect(parseHm('x')).toBeNull();
    expect(fmtHm(1439)).toBe('23:59');
  });

  it('4 Tag giờ/phút: một hộp xác nhận, ghi lần lượt bốn Tag', async () => {
    const e = env(['SH', 'SM', 'EH', 'EM'].map((id) => rw(id, 'UINT16')));
    const init: Array<[string, number]> = [
      ['SH', 6],
      ['SM', 0],
      ['EH', 18],
      ['EM', 30],
    ];
    for (const [id, v] of init) e.source.set(id, { value: v, quality: 'GOOD' });
    const el = await mount(e, 'time-range', {
      startHour: 'SH',
      startMinute: 'SM',
      endHour: 'EH',
      endMinute: 'EM',
    });
    const from = $(el, '[data-part="from"]') as HTMLInputElement;
    const to = $(el, '[data-part="to"]') as HTMLInputElement;
    expect([from.value, to.value]).toEqual(['06:00', '18:30']);
    from.value = '07:15';
    from.dispatchEvent(new Event('change'));
    await settle(el);
    $(el, '[data-write]').click();
    await settle(el);
    expect(dialog()).not.toBeNull();
    dialogBtn('ok').click();
    await settle(el);
    for (let i = 0; i < 4; i++) {
      e.host.resolve({ status: 'CONFIRMED' });
      await settle(el);
    }
    expect(e.host.writes.map((w) => [w.tag, w.value])).toEqual([
      ['SH', 7],
      ['SM', 15],
      ['EH', 18],
      ['EM', 30],
    ]);
  });

  it('2 Tag phút trong ngày; lệnh đầu lỗi thì dừng', async () => {
    const e = env([rw('A', 'UINT16'), rw('B', 'UINT16')]);
    e.source.set('A', { value: 60, quality: 'GOOD' });
    e.source.set('B', { value: 120, quality: 'GOOD' });
    const el = await mount(e, 'time-range', { start: 'A', end: 'B' }, { format: 'minutes' });
    expect(($(el, '[data-part="from"]') as HTMLInputElement).value).toBe('01:00');
    $(el, '[data-write]').click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    e.host.resolve({ status: 'FAILED', code: 'X', message: 'lỗi' } as never);
    await settle(el);
    await settle(el);
    expect(e.host.writes.map((w) => w.tag)).toEqual(['A']);
  });

  it('viewer bị khóa (minRole), không ghi được', async () => {
    const e = env([rw('A', 'UINT16'), rw('B', 'UINT16')]);
    e.host.sessionInfo = { user: 'v', role: 'viewer' };
    const el = await mount(e, 'time-range', { start: 'A', end: 'B' }, { format: 'minutes' });
    expect(($(el, '[data-write]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('alarm-list: CSV', () => {
  it('có BOM, chặn công thức, bọc ngoặc kép', () => {
    const csv = alarmsCsv([
      {
        id: 'a',
        name: 'AL1',
        text: '=cmd "x"',
        priority: 'major',
        area: null,
        state: 'ACTIVE_UNACK',
        valueActive: 5,
        tsActive: 0,
      } as unknown as AlarmInstance,
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=cmd ""x"""`);
    expect(csv).toContain('1970-01-01T00:00:00.000Z');
  });
});
