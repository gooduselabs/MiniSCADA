// Hai widget alarm `alarm-list` và `alarm-count` (feature 009, FR-069 đến FR-072; US5 kịch bản 2 đến 5; contracts/ui-alarm.md §13).
import { afterEach, describe, expect, it } from 'vitest';
import type { WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryAlarmSource, MemoryTagSource } from '../host/memory-source.ts';
import type { AlarmInstance } from '../host/types.ts';
import { registerWidgets } from '../widgets/register.ts';
import { AREAS, CLASSES, inst } from '../fixtures/alarm-fixtures.ts';
import { countProps, listProps } from './alarm-widget-props.ts';

afterEach(() => document.body.replaceChildren());

const frame = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));
const shelf = { until: 9, remainingMs: 1000, reason: 'r', user: 'u', system: false };

type El = HTMLElement & { updateComplete: Promise<boolean>; shadowRoot: ShadowRoot } & Record<
    string,
    unknown
  >;

function item(
  widget: 'alarm-list' | 'alarm-count',
  props: Record<string, unknown> = {},
): WidgetItem {
  return {
    type: 'widget',
    id: 'w1',
    widget,
    x: 0,
    y: 0,
    width: widget === 'alarm-list' ? 640 : 120,
    height: widget === 'alarm-list' ? 260 : 48,
    props,
  } as WidgetItem;
}

async function mount(
  it: WidgetItem,
  alarms: MemoryAlarmSource | undefined,
  o: { host?: FakeActionHost; mode?: 'run' | 'edit' } = {},
): Promise<El> {
  registerWidgets();
  const el = document.createElement(`mat-w-${it.widget}`) as El;
  el.item = it;
  el.source = new MemoryTagSource({ now: 1 });
  el.host = o.host ?? new FakeActionHost({ session: { user: 'vanhanh1', role: 'operator' } });
  el.mode = o.mode ?? 'run';
  el.context = { screen: 's1', widget: 'w1' };
  el.alarms = alarms;
  document.body.append(el);
  await el.updateComplete;
  await frame();
  return el;
}

const src = (list: AlarmInstance[], status: 'live' | 'none' | 'stale' = 'live') =>
  new MemoryAlarmSource({
    instances: list,
    classes: CLASSES,
    areas: AREAS,
    status,
    now: 1_000_000,
  });

const table = (el: El) =>
  el.shadowRoot.querySelector('mat-alarm-table') as
    (HTMLElement & { shadowRoot: ShadowRoot }) | null;
const rowIds = (el: El) =>
  [...(table(el)?.shadowRoot.querySelectorAll<HTMLElement>('tbody tr[data-id]') ?? [])].map(
    (r) => r.dataset.id,
  );
const heads = (el: El) =>
  [...(table(el)?.shadowRoot.querySelectorAll('thead th') ?? [])]
    .map((h) => (h.textContent ?? '').trim())
    .filter((t) => t !== 'Thao tác');
const text = (n: Element | null) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();

const LIST = () => [
  inst({
    id: 'A',
    area: 'bon',
    class: 'critical',
    priority: 'critical',
    tsActive: 9,
    text: 'Mức bồn',
  }),
  inst({ id: 'B', area: null, class: 'major', priority: 'major', tsActive: 8, text: 'Bơm' }),
  inst({
    id: 'C',
    area: 'dien',
    class: 'minor',
    priority: 'minor',
    tsActive: 7,
    state: 'ACTIVE_ACK',
  }),
  inst({
    id: 'D',
    area: 'bon',
    class: 'advisory',
    priority: 'advisory',
    tsActive: 6,
    state: 'RTN_UNACK',
  }),
  inst({
    id: 'S',
    class: 'critical',
    priority: 'critical',
    state: 'NORMAL',
    shelved: shelf,
    occurrence: 0,
  }),
];

describe('đọc thuộc tính (listProps, countProps)', () => {
  it('mặc định theo danh mục', () => {
    expect(listProps(item('alarm-list'))).toEqual({
      areas: [],
      classes: [],
      minPriority: 'advisory',
      states: ['ACTIVE_UNACK', 'ACTIVE_ACK', 'RTN_UNACK'],
      columns: ['time', 'priority', 'text', 'value', 'state'],
      maxRows: 8,
      showAck: true,
    });
    expect(countProps(item('alarm-count'))).toEqual({
      areas: [],
      minPriority: 'advisory',
      mode: 'unacked',
      target: { kind: 'alarms' },
    });
  });
  it('giá trị sai kiểu hoặc ngoài khoảng dùng mặc định; trùng và lạ bị bỏ', () => {
    const p = listProps(
      item('alarm-list', {
        maxRows: 999,
        columns: ['text', 'text', 'xyz', 'time'],
        minPriority: 'zz',
        states: [],
        showAck: 'x',
        areas: 'bon',
      }),
    );
    expect(p.maxRows).toBe(8);
    expect(p.columns).toEqual(['text', 'time']);
    expect(p.minPriority).toBe('advisory');
    expect(p.states).toEqual(['ACTIVE_UNACK', 'ACTIVE_ACK', 'RTN_UNACK']);
    expect(p.showAck).toBe(true);
    expect(p.areas).toEqual([]);
    expect(
      countProps(item('alarm-count', { target: { kind: 'screen' }, mode: 'q' })).target,
    ).toEqual({ kind: 'alarms' });
    expect(
      countProps(item('alarm-count', { target: { kind: 'screen', screen: 'tong-quan' } })).target,
    ).toEqual({
      kind: 'screen',
      screen: 'tong-quan',
    });
  });
});

describe('mat-w-alarm-list', () => {
  it('mặc định: các alarm không shelved theo ưu tiên, cột mặc định, dùng bảng chung', async () => {
    const el = await mount(item('alarm-list'), src(LIST()));
    expect(table(el)).not.toBeNull();
    expect(rowIds(el)).toEqual(['A', 'B', 'C', 'D']);
    expect(heads(el)).toEqual([
      'Thời gian bật',
      'Ưu tiên',
      'Nội dung',
      'Giá trị lúc bật',
      'Trạng thái',
    ]);
  });
  it('lọc areas (kể cả "-" Chung)', async () => {
    expect(rowIds(await mount(item('alarm-list', { areas: ['bon'] }), src(LIST())))).toEqual([
      'A',
      'D',
    ]);
    expect(rowIds(await mount(item('alarm-list', { areas: ['-', 'dien'] }), src(LIST())))).toEqual([
      'B',
      'C',
    ]);
  });
  it('lọc classes, minPriority, states', async () => {
    expect(
      rowIds(await mount(item('alarm-list', { classes: ['minor', 'advisory'] }), src(LIST()))),
    ).toEqual(['C', 'D']);
    expect(rowIds(await mount(item('alarm-list', { minPriority: 'major' }), src(LIST())))).toEqual([
      'A',
      'B',
    ]);
    expect(
      rowIds(await mount(item('alarm-list', { states: ['ACTIVE_UNACK'] }), src(LIST()))),
    ).toEqual(['A', 'B']);
  });
  it('columns đúng thứ tự cấu hình', async () => {
    const el = await mount(
      item('alarm-list', { columns: ['text', 'area', 'ackUser'] }),
      src(LIST()),
    );
    expect(heads(el)).toEqual(['Nội dung', 'Khu vực', 'Người xác nhận']);
  });
  it('maxRows cắt và hiện "và n alarm nữa"', async () => {
    const many = Array.from({ length: 6 }, (_, i) => inst({ id: `m${i}`, tsActive: i }));
    const el = await mount(item('alarm-list', { maxRows: 4 }), src(many));
    expect(rowIds(el)).toHaveLength(4);
    expect(text(table(el)!.shadowRoot.querySelector('.more'))).toBe('và 2 alarm nữa');
  });
  it('showAck: nút Xác nhận mỗi hàng gọi host (operator), không hộp chọn, không tạm ẩn', async () => {
    const host = new FakeActionHost({ session: { user: 'a', role: 'operator' } });
    const el = await mount(item('alarm-list', { showAck: true }), src(LIST()), { host });
    const root = table(el)!.shadowRoot;
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
    expect(root.querySelector('button[data-act="shelve"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('tr[data-id="A"] button[data-act="ack"]')!.click();
    await frame();
    expect(host.ackCalls).toEqual([{ items: [{ id: 'A', occurrence: expect.any(Number) }] }]);
  });
  it('showAck=false: không có nút', async () => {
    const el = await mount(item('alarm-list', { showAck: false }), src(LIST()));
    expect(table(el)!.shadowRoot.querySelector('button[data-act="ack"]')).toBeNull();
  });
  it('viewer: nút khóa kèm lý do "Cần đăng nhập với role operator"', async () => {
    const host = new FakeActionHost({ session: { user: 'x', role: 'viewer' } });
    const el = await mount(item('alarm-list'), src(LIST()), { host });
    const b = table(el)!.shadowRoot.querySelector<HTMLButtonElement>('button[data-act="ack"]')!;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.title).toBe('Cần đăng nhập với role operator');
    b.click();
    await frame();
    expect(host.ackCalls).toHaveLength(0);
  });
  it('không có nguồn alarm: "Không có dữ liệu alarm"', async () => {
    const el = await mount(item('alarm-list'), undefined);
    expect(text(table(el)!.shadowRoot.querySelector('.empty'))).toBe('Không có dữ liệu alarm');
  });
  it('project không có alarm: "Không có alarm cấu hình"', async () => {
    const el = await mount(item('alarm-list'), src([], 'none'));
    expect(text(table(el)!.shadowRoot.querySelector('.empty'))).toBe('Không có alarm cấu hình');
  });
  it('chế độ edit (Studio): không gọi host, không nút xác nhận hoạt động', async () => {
    const host = new FakeActionHost({ session: null });
    const el = await mount(item('alarm-list'), src(LIST()), { host, mode: 'edit' });
    table(el)!.shadowRoot.querySelector<HTMLButtonElement>('button[data-act="ack"]')?.click();
    await frame();
    expect(host.ackCalls).toHaveLength(0);
    expect(host.calls).not.toContain('login');
  });
  it('cập nhật khi nguồn đổi', async () => {
    const s = src(LIST());
    const el = await mount(item('alarm-list'), s);
    s.upsert(inst({ id: 'NEW', class: 'critical', priority: 'critical', tsActive: 100 }));
    await frame(60);
    expect(rowIds(el)[0]).toBe('NEW');
  });
  it('nội dung <script> hiện dạng chữ; không innerHTML', async () => {
    const evil = '<script>window.__w=1</script><img src=x onerror=1>';
    const el = await mount(
      item('alarm-list', { columns: ['text'] }),
      src([inst({ id: 'E', text: evil, name: evil })]),
    );
    expect(el.shadowRoot.querySelector('script')).toBeNull();
    expect(table(el)!.shadowRoot.querySelector('script, img')).toBeNull();
    expect(text(table(el)!.shadowRoot.querySelector('tbody td'))).toBe(evil);
  });
  it('không gọi mạng: chỉ đọc AlarmSource và gọi ActionHost (không có khe Tag)', async () => {
    const el = await mount(item('alarm-list'), src(LIST()));
    expect((el as unknown as { tagIds(): string[] }).tagIds()).toEqual([]);
  });
});

describe('mat-w-alarm-count', () => {
  const dot = (el: El) => el.shadowRoot.querySelector<HTMLElement>('button')!;
  it('mode unacked (mặc định): đếm ACTIVE_UNACK và RTN_UNACK, không tính shelved', async () => {
    const el = await mount(item('alarm-count'), src(LIST()));
    expect(text(dot(el).querySelector('[data-n]'))).toBe('3');
    expect(dot(el).getAttribute('aria-label')).toBe('3 alarm chưa xác nhận');
  });
  it('mode active: mọi trạng thái khác NORMAL, không shelved', async () => {
    const el = await mount(item('alarm-count', { mode: 'active' }), src(LIST()));
    expect(text(dot(el).querySelector('[data-n]'))).toBe('4');
    expect(dot(el).getAttribute('aria-label')).toBe('4 alarm đang có');
  });
  it('lọc areas và minPriority', async () => {
    const a = await mount(item('alarm-count', { areas: ['bon'] }), src(LIST()));
    expect(text(dot(a).querySelector('[data-n]'))).toBe('2');
    const b = await mount(item('alarm-count', { minPriority: 'major' }), src(LIST()));
    expect(text(dot(b).querySelector('[data-n]'))).toBe('2');
  });
  it('màu theo mức ưu tiên cao nhất trong tập đếm (màu của lớp), xám khi 0', async () => {
    const el = await mount(item('alarm-count'), src(LIST()));
    expect(dot(el).dataset.color).toBe('red');
    const m = await mount(
      item('alarm-count', { minPriority: 'minor' }),
      src([inst({ id: 'x', class: 'major', priority: 'major' })]),
    );
    expect(dot(m).dataset.color).toBe('orange');
    const z = await mount(item('alarm-count'), src([]));
    expect(dot(z).dataset.color).toBe('gray');
    expect(text(dot(z).querySelector('[data-n]'))).toBe('0');
  });
  it('nhấp nháy khi có ACTIVE_UNACK của lớp blink (chế độ run); không ở edit hoặc khi chỉ RTN_UNACK', async () => {
    const run = await mount(item('alarm-count'), src(LIST()));
    expect(dot(run).classList.contains('blink')).toBe(true);
    const edit = await mount(item('alarm-count'), src(LIST()), { mode: 'edit' });
    expect(dot(edit).classList.contains('blink')).toBe(false);
    const rtn = await mount(
      item('alarm-count'),
      src([inst({ class: 'critical', priority: 'critical', state: 'RTN_UNACK' })]),
    );
    expect(dot(rtn).classList.contains('blink')).toBe(false);
    const noBlink = await mount(
      item('alarm-count'),
      src([inst({ class: 'minor', priority: 'minor' })]),
    );
    expect(dot(noBlink).classList.contains('blink')).toBe(false);
  });
  it('cập nhật ≤ 1 s sau thay đổi nguồn', async () => {
    const s = src([]);
    const el = await mount(item('alarm-count'), s);
    s.upsert(inst({ id: 'new' }));
    await frame(80);
    expect(text(dot(el).querySelector('[data-n]'))).toBe('1');
  });
  it('target alarms: nhấp chuyển tới #/alarms', async () => {
    const el = await mount(item('alarm-count', { target: { kind: 'alarms' } }), src(LIST()));
    dot(el).click();
    expect(location.hash).toBe('#/alarms');
    location.hash = '';
  });
  it('target screen: gọi host.navigate; target none: không làm gì', async () => {
    const host = new FakeActionHost({ session: null });
    const el = await mount(
      item('alarm-count', { target: { kind: 'screen', screen: 'tong-quan' } }),
      src(LIST()),
      { host },
    );
    dot(el).click();
    expect(host.calls).toContain('navigate:tong-quan');
    const host2 = new FakeActionHost({ session: null });
    const none = await mount(item('alarm-count', { target: { kind: 'none' } }), src(LIST()), {
      host: host2,
    });
    dot(none).click();
    expect(host2.calls).toEqual([]);
  });
  it('chế độ edit: nhấp không làm gì', async () => {
    const host = new FakeActionHost({ session: null });
    const el = await mount(
      item('alarm-count', { target: { kind: 'screen', screen: 'x' } }),
      src(LIST()),
      { host, mode: 'edit' },
    );
    dot(el).click();
    expect(host.calls).toEqual([]);
  });
  it('là <button> thật; không nguồn: "Không có dữ liệu alarm" (aria-label), số —', async () => {
    const el = await mount(item('alarm-count'), undefined);
    expect(dot(el).tagName).toBe('BUTTON');
    expect(dot(el).getAttribute('aria-label')).toBe('Không có dữ liệu alarm');
    expect(text(dot(el).querySelector('[data-n]'))).toBe('—');
  });
  it('project không alarm: "Không có alarm cấu hình"', async () => {
    const el = await mount(item('alarm-count'), src([], 'none'));
    expect(dot(el).getAttribute('aria-label')).toBe('Không có alarm cấu hình');
  });
});
