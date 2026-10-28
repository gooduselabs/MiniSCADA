// Feature 037: widget mới equipment (Motor/Bơm/Quạt/Van), stack-light (đèn tháp), multi-state (nhãn đa trạng thái).
import { afterEach, describe, expect, it } from 'vitest';
import type { WidgetItem } from '@mat/project-schema';
import { dialog, dialogBtn, makeEnv, settle, type Env } from './control-test-util.ts';
import { matchState } from './multi-state.ts';
import { cleanup, makeSource, mount, tagInfo, textOf, widgetItem } from './test-util.ts';
import { registerWidgets } from './register.ts';

afterEach(cleanup);

async function equip(
  env: Env,
  tags: Record<string, string>,
  props: WidgetItem['props'] = {},
  mode: 'run' | 'edit' = 'run',
) {
  registerWidgets();
  const el = document.createElement('mat-w-equipment') as HTMLElement & Record<string, unknown>;
  el.item = { ...widgetItem('equipment', tags, props), height: 160 };
  el.source = env.source;
  el.host = env.host;
  el.modal = env.modal;
  el.mode = mode;
  el.context = { screen: 's1', widget: 'w1' };
  document.body.append(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}
const root = (el: Element) => el.shadowRoot!;

describe('mat-w-equipment', () => {
  it('BOOL: dừng → chạy, đổi màu, chữ và quay cánh khi chạy', async () => {
    const env = makeEnv();
    const el = await equip(env, { state: 'RUN' }, { kind: 'fan', label: 'Quạt 1' });
    expect(root(el).querySelector('.w')!.classList.contains('st-stop')).toBe(true);
    expect(textOf(el, '.pill')).toBe('Dừng');
    expect(root(el).querySelector('.sym.spin')).toBeNull();
    env.source.set('RUN', { value: true });
    await settle(el);
    expect(root(el).querySelector('.w')!.classList.contains('st-run')).toBe(true);
    expect(textOf(el, '.pill')).toBe('Đang chạy');
    expect(root(el).querySelector('.sym.spin')).not.toBeNull();
    expect(root(el).querySelector('.w')!.getAttribute('aria-label')).toContain('Đang chạy');
  });

  it('animate=false hoặc chế độ edit: không quay; van không quay, chữ Mở/Đóng', async () => {
    const env = makeEnv();
    env.source.set('RUN', { value: true });
    expect(
      root(await equip(env, { state: 'RUN' }, { animate: false })).querySelector('.spin'),
    ).toBeNull();
    expect(root(await equip(env, { state: 'RUN' }, {}, 'edit')).querySelector('.spin')).toBeNull();
    const v = await equip(env, { state: 'RUN' }, { kind: 'valve' });
    expect(root(v).querySelector('.spin')).toBeNull();
    expect(textOf(v, '.pill')).toBe('Mở');
  });

  it('lỗi: khe fault hoặc state = faultValue; số dùng runValue', async () => {
    const env = makeEnv();
    env.source.set('MODE', { value: 2 });
    const el = await equip(env, { state: 'MODE' }, { runValue: 1, faultValue: 2 });
    expect(textOf(el, '.pill')).toBe('Lỗi');
    expect(root(el).querySelector('.pill.blink')).not.toBeNull();
    env.source.set('MODE', { value: 1 });
    await settle(el);
    expect(textOf(el, '.pill')).toBe('Đang chạy');
    env.source.set('RUN', { value: true });
    const f = await equip(env, { state: 'MODE', fault: 'RUN' });
    expect(textOf(f, '.pill')).toBe('Lỗi');
  });

  it('quality xấu: Không rõ', async () => {
    const env = makeEnv();
    env.source.set('RUN', { quality: 'BAD' });
    expect(textOf(await equip(env, { state: 'RUN' }), '.pill')).toBe('Không rõ');
  });

  it('không gắn target: không có nút; có target: Chạy ghi true sau xác nhận', async () => {
    const env = makeEnv();
    expect(root(await equip(env, { state: 'RUN' })).querySelector('.btns')).toBeNull();
    const el = await equip(env, { state: 'RUN', target: 'RUN' });
    const start = root(el).querySelector<HTMLButtonElement>('.b-start')!;
    expect(start.disabled).toBe(false);
    start.click();
    await settle(el);
    expect(dialog()).not.toBeNull();
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({ kind: 'write', tag: 'RUN', value: true });
  });

  it('Tag số: Dừng ghi stopValue', async () => {
    const env = makeEnv();
    const el = await equip(env, { state: 'SP', target: 'SP' }, { stopValue: 5 });
    root(el).querySelector<HTMLButtonElement>('.b-stop')!.click();
    await settle(el);
    dialogBtn('ok').click();
    await settle(el);
    expect(env.host.writes[0]).toMatchObject({ kind: 'write', tag: 'SP', value: 5 });
  });

  it('chế độ edit: nút tắt, không ghi', async () => {
    const env = makeEnv();
    const el = await equip(env, { state: 'RUN', target: 'RUN' }, {}, 'edit');
    expect(root(el).querySelector<HTMLButtonElement>('.b-start')!.disabled).toBe(true);
  });
});

describe('mat-w-stack-light', () => {
  const src = () => {
    const s = makeSource([
      tagInfo('r', { type: 'BOOL' }),
      tagInfo('y', { type: 'BOOL' }),
      tagInfo('g', { type: 'INT16' }),
    ]);
    s.set('r', { value: true, quality: 'GOOD' });
    s.set('y', { value: false, quality: 'GOOD' });
    s.set('g', { value: 3, quality: 'GOOD' });
    return s;
  };
  it('chỉ vẽ tầng đã gắn, tầng sáng có lớp on, đỏ nhấp nháy', async () => {
    const el = await mount(widgetItem('stack-light', { red: 'r', yellow: 'y', green: 'g' }), src());
    const segs = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.seg')];
    expect(segs.map((s) => s.dataset['level'])).toEqual(['red', 'yellow', 'green']);
    expect(segs.map((s) => s.classList.contains('on'))).toEqual([true, false, true]);
    expect(segs[0]!.classList.contains('blink')).toBe(true);
    expect(el.shadowRoot!.querySelector('.w')!.getAttribute('aria-label')).toContain('Đỏ, Xanh lá');
  });
  it('blinkRed=false; chưa gắn gì thì vẽ đủ 4 tầng tắt; quality xấu viền đứt', async () => {
    const s = src();
    const el = await mount(widgetItem('stack-light', { red: 'r' }, { blinkRed: false }), s);
    expect(el.shadowRoot!.querySelector('.blink')).toBeNull();
    const none = await mount(widgetItem('stack-light', {}), s);
    expect(none.shadowRoot!.querySelectorAll('.seg').length).toBe(4);
    expect(none.shadowRoot!.querySelectorAll('.seg.on').length).toBe(0);
    s.set('r', { value: true, quality: 'BAD' });
    const bad = await mount(widgetItem('stack-light', { red: 'r' }), s);
    expect(bad.shadowRoot!.querySelector('.seg.bad')).not.toBeNull();
  });
});

describe('mat-w-multi-state', () => {
  const states = [
    { value: 0, text: 'Dừng', color: '#6b777c' },
    { value: 1, text: 'Chạy', color: '#268426' },
    { value: 2, text: 'Lỗi', color: '#c84845', blink: true },
  ];
  it('matchState: số, BOOL = 0/1, không khớp, bảng sai dạng', () => {
    expect(matchState(states, 1)?.text).toBe('Chạy');
    expect(matchState(states, true)?.text).toBe('Chạy');
    expect(matchState(states, 9)).toBeUndefined();
    expect(matchState('x', 1)).toBeUndefined();
    expect(matchState([null, { value: 1 }], 1)).toBeUndefined();
  });
  it('chữ và màu theo bảng của widget; nhấp nháy theo mục', async () => {
    const s = makeSource([tagInfo('m', { type: 'INT16' })]);
    s.set('m', { value: 2, quality: 'GOOD' });
    const el = await mount(widgetItem('multi-state', { value: 'm' }, { states } as never), s);
    expect(textOf(el, '.state')).toBe('Lỗi');
    expect(el.shadowRoot!.querySelector('.state.blink')).not.toBeNull();
    expect(el.shadowRoot!.querySelector<HTMLElement>('.w')!.style.getPropertyValue('--c')).toMatch(
      /#c84845|rgb\(200, 72, 69\)/,
    );
  });
  it('bảng rỗng: dùng Bảng giá trị của Tag; không khớp: giá trị số', async () => {
    const s = makeSource([tagInfo('m', { type: 'INT16', valueTable: 'T' })], {
      T: { entries: [{ value: 1, text: 'Tự động', color: '#2c7ac0' }] },
    });
    s.set('m', { value: 1, quality: 'GOOD' });
    expect(textOf(await mount(widgetItem('multi-state', { value: 'm' }), s), '.state')).toBe(
      'Tự động',
    );
    s.set('m', { value: 7, quality: 'GOOD' });
    expect(textOf(await mount(widgetItem('multi-state', { value: 'm' }), s), '.state')).toBe('7');
  });
});
