// <mat-alarm-table> (feature 009, FR-056, FR-058, FR-062, FR-064, FR-066; contracts/ui-alarm.md §4, §7.2, §10).
import { afterEach, describe, expect, it } from 'vitest';
import { FakeActionHost, MemoryAlarmSource } from '../host/memory-source.ts';
import type { AlarmInstance } from '../host/types.ts';
import { AREAS, CLASSES, inst } from '../fixtures/alarm-fixtures.ts';
import { MatAlarmTable, registerAlarmTable } from './alarm-table.ts';

afterEach(() => document.body.replaceChildren());

const frame = (ms = 40) => new Promise<void>((r) => setTimeout(r, ms));
const shelf = { until: 9, remainingMs: 65_000, reason: 'Bảo trì', user: 'vanhanh1', system: false };

function source(
  list: AlarmInstance[],
  extra: Partial<ConstructorParameters<typeof MemoryAlarmSource>[0]> = {},
) {
  return new MemoryAlarmSource({
    instances: list,
    classes: CLASSES,
    areas: AREAS,
    now: 1_000_000,
    ...extra,
  });
}

async function mount(
  src: MemoryAlarmSource,
  props: Partial<MatAlarmTable> = {},
  host = new FakeActionHost({ session: { user: 'vanhanh1', role: 'operator' } }),
) {
  registerAlarmTable();
  const el = document.createElement('mat-alarm-table') as MatAlarmTable;
  el.alarms = src;
  el.host = host;
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return { el, host };
}

const root = (el: Element) => el.shadowRoot!;
const rows = (el: Element) => [
  ...root(el).querySelectorAll<HTMLTableRowElement>('tbody tr[data-id]'),
];
const cellText = (tr: Element) =>
  [...tr.querySelectorAll('td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
const ids = (el: Element) => rows(el).map((r) => r.dataset.id);

describe('dựng và cập nhật theo id (FR-066)', () => {
  it('dựng một lần; đổi một hàng không dựng lại các hàng khác (cùng nút DOM)', async () => {
    const list = Array.from({ length: 200 }, (_, i) =>
      inst({ id: `A${i}`, tsActive: 1000 + i, priority: 'minor', class: 'minor' }),
    );
    const src = source(list);
    const { el } = await mount(src);
    const before = rows(el);
    expect(before).toHaveLength(200);
    src.upsert({ ...list[7]!, state: 'ACTIVE_ACK', ackUser: 'vanhanh1', rev: 999 });
    await frame();
    const after = rows(el);
    expect(after).toHaveLength(200);
    const same = after.filter((r) => before.includes(r)).length;
    expect(same).toBe(200);
    const changed = after.find((r) => r.dataset.id === 'A7')!;
    expect(cellText(changed).join('|')).toContain('Đang có, đã xác nhận');
    expect(cellText(changed).join('|')).toContain('vanhanh1');
  });

  it('hàng mới được thêm, hàng bị xóa biến mất, thứ tự theo ưu tiên', async () => {
    const src = source([inst({ id: 'M', priority: 'major', tsActive: 5 })]);
    const { el } = await mount(src);
    src.upsert(inst({ id: 'C', priority: 'critical', tsActive: 1 }));
    await frame();
    expect(ids(el)).toEqual(['C', 'M']);
    src.remove('M');
    await frame();
    expect(ids(el)).toEqual(['C']);
  });

  it('nhiều thay đổi liên tiếp gộp vào một lần dựng (rAF)', async () => {
    const src = source([]);
    const { el } = await mount(src);
    let renders = 0;
    const orig = el.requestUpdate.bind(el);
    el.requestUpdate = ((...a: Parameters<typeof orig>) => {
      renders++;
      return orig(...a);
    }) as typeof el.requestUpdate;
    for (let i = 0; i < 20; i++) src.upsert(inst({ id: `N${i}` }));
    await frame(60);
    expect(rows(el)).toHaveLength(20);
    expect(renders).toBeLessThanOrEqual(3);
  });

  it('hủy đăng ký khi gỡ khỏi DOM', async () => {
    const src = source([inst({ id: 'X' })]);
    const { el } = await mount(src);
    el.remove();
    src.upsert(inst({ id: 'Y' }));
    await frame();
    expect(rows(el)).toHaveLength(1);
  });
});

describe('cột, tiêu đề, sắp xếp', () => {
  it('cột đúng thứ tự cấu hình; role=table; <th scope=col>', async () => {
    const src = source([inst({ id: 'A', text: 'Bơm lỗi', area: 'bon', valueActive: 12.5 })]);
    const { el } = await mount(src, { columns: ['text', 'area', 'value'] });
    const heads = [...root(el).querySelectorAll('thead th')].map((h) => h.textContent!.trim());
    expect(heads).toEqual(['Nội dung', 'Khu vực', 'Giá trị lúc bật']);
    expect(cellText(rows(el)[0]!)).toEqual(['Bơm lỗi', 'Bồn', '12.5']);
    expect(root(el).querySelector('table')!.getAttribute('role')).toBe('table');
    expect(root(el).querySelector('thead th')!.getAttribute('scope')).toBe('col');
  });

  it('khu vực null hiện "Chung"', async () => {
    const { el } = await mount(source([inst({ id: 'A', area: null })]), { columns: ['area'] });
    expect(cellText(rows(el)[0]!)).toEqual(['Chung']);
  });

  it('bấm tiêu đề: tăng rồi giảm, aria-sort, báo sự kiện', async () => {
    const src = source([
      inst({ id: 'b', text: 'Bơm' }),
      inst({ id: 'a', text: 'An toàn' }),
      inst({ id: 'c', text: 'Cảm biến' }),
    ]);
    const { el } = await mount(src, { columns: ['text', 'time'] });
    const events: unknown[] = [];
    el.addEventListener('mat-alarm-sort', (e) => events.push((e as CustomEvent).detail));
    const btn = () => root(el).querySelector<HTMLElement>('th button[data-col="text"]')!;
    btn().click();
    await el.updateComplete;
    expect(ids(el)).toEqual(['a', 'b', 'c']);
    expect(root(el).querySelector('th[aria-sort]')!.getAttribute('aria-sort')).toBe('ascending');
    btn().click();
    await el.updateComplete;
    expect(ids(el)).toEqual(['c', 'b', 'a']);
    expect(root(el).querySelector('th[aria-sort]')!.getAttribute('aria-sort')).toBe('descending');
    expect(events).toEqual([
      { column: 'text', dir: 'asc' },
      { column: 'text', dir: 'desc' },
    ]);
  });

  it('thời gian bật: HH:mm:ss; giờ chưa đồng bộ có chú thích', async () => {
    const t = new Date(2026, 9, 13, 8, 5, 9).getTime();
    const src = source([inst({ id: 'a', tsActive: t, clockOk: false })], { now: t + 1000 });
    const { el } = await mount(src, { columns: ['time'] });
    expect(cellText(rows(el)[0]!)[0]).toBe('08:05:09 (giờ chưa đồng bộ)');
  });

  it('trạng thái: chữ và biểu tượng (aria-hidden), thêm đầu vào BAD và Vô hiệu', async () => {
    const src = source([
      inst({ id: 'u', state: 'ACTIVE_UNACK', inputBad: true }),
      inst({ id: 'r', state: 'RTN_UNACK' }),
    ]);
    const { el } = await mount(src, { columns: ['state'] });
    const t = rows(el).map((r) => cellText(r)[0]);
    expect(t).toContain('Đang có, chưa xác nhận (đầu vào BAD)');
    expect(t).toContain('Đã hết, chưa xác nhận');
    for (const r of rows(el)) {
      const ic = r.querySelector('svg')!;
      expect(ic.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('mức ưu tiên: hình khác nhau cho từng mức kèm tên', async () => {
    const src = source(
      (['critical', 'major', 'minor', 'advisory'] as const).map((p) =>
        inst({ id: p, priority: p, class: p }),
      ),
    );
    const { el } = await mount(src, { columns: ['priority'] });
    expect(rows(el).map((r) => cellText(r)[0])).toEqual(['Khẩn cấp', 'Quan trọng', 'Nhỏ', 'Lưu ý']);
    const shapes = rows(el).map((r) => r.querySelector('svg')!.innerHTML);
    expect(new Set(shapes).size).toBe(4);
  });
});

describe('lọc, tab, maxRows', () => {
  const list = [
    inst({ id: 'A', area: 'bon', priority: 'critical', class: 'critical', text: 'Mức bồn' }),
    inst({ id: 'B', area: null, priority: 'minor', class: 'minor', text: 'Bơm' }),
    inst({ id: 'C', area: 'bon', priority: 'major', class: 'major', state: 'ACTIVE_ACK' }),
    inst({ id: 'S', priority: 'critical', class: 'critical', shelved: shelf, state: 'NORMAL' }),
  ];
  it('tab active: bỏ shelved; tab shelved: chỉ shelved kèm Còn lại', async () => {
    const src = source(list);
    const { el } = await mount(src, { columns: ['text', 'ackUser'] });
    expect(ids(el)).toEqual(['A', 'C', 'B']);
    el.tab = 'shelved';
    await el.updateComplete;
    expect(ids(el)).toEqual(['S']);
    const heads = [...root(el).querySelectorAll('thead th')].map((h) => h.textContent!.trim());
    expect(heads).toContain('Còn lại');
    expect(cellText(rows(el)[0]!).join('|')).toMatch(/01:0[45]/);
  });
  it('filter: khu vực, mức tối thiểu, chữ có dấu', async () => {
    const src = source(list);
    const { el } = await mount(src, { filter: { areas: ['bon'], minPriority: 'major' } });
    expect(ids(el)).toEqual(['A', 'C']);
    el.filter = { q: 'bom' };
    await el.updateComplete;
    expect(ids(el)).toEqual(['B']);
  });
  it('maxRows cắt và hiện "và n alarm nữa"', async () => {
    const many = Array.from({ length: 6 }, (_, i) => inst({ id: `m${i}`, tsActive: i }));
    const { el } = await mount(source(many), { maxRows: 4 });
    expect(rows(el)).toHaveLength(4);
    expect(root(el).textContent).toContain('và 2 alarm nữa');
  });
  it('visibleRows theo thứ tự hiển thị sau lọc', async () => {
    const { el } = await mount(source(list), { filter: { areas: ['bon'] } });
    expect(el.visibleRows().map((r) => r.id)).toEqual(['A', 'C']);
  });
});

describe('trạng thái trống và nguồn', () => {
  it('không nguồn: "Không có dữ liệu alarm"', async () => {
    registerAlarmTable();
    const el = document.createElement('mat-alarm-table') as MatAlarmTable;
    document.body.append(el);
    await el.updateComplete;
    expect(root(el).textContent).toContain('Không có dữ liệu alarm');
  });
  it('status none: "Không có alarm cấu hình"', async () => {
    const { el } = await mount(source([], { status: 'none' }));
    expect(root(el).textContent).toContain('Không có alarm cấu hình');
  });
  it('live không hàng: "Không có alarm"', async () => {
    const { el } = await mount(source([]));
    expect(root(el).textContent).toContain('Không có alarm');
  });
  it('unsupported: nêu runtime < 0.8.0', async () => {
    const { el } = await mount(source([], { status: 'unsupported' }));
    expect(root(el).textContent).toContain('Thiết bị chưa hỗ trợ alarm (runtime < 0.8.0)');
  });
  it('stale: bảng mờ (data-stale) kèm dòng mất kết nối, vẫn hiện hàng', async () => {
    const src = source([inst({ id: 'A' })], { status: 'stale' });
    const { el } = await mount(src);
    expect(root(el).querySelector('[data-stale]')).not.toBeNull();
    expect(root(el).textContent).toContain(
      'Mất kết nối tới thiết bị: danh sách alarm có thể đã cũ',
    );
    expect(rows(el)).toHaveLength(1);
    src.setStatus('live');
    await frame();
    expect(root(el).querySelector('[data-stale]')).toBeNull();
  });
});

describe('an toàn DOM (FR-062, SC-020)', () => {
  const evil = [
    '<script>window.__x=1</script>',
    '<img src=x onerror=window.__x=1>',
    '"><svg onload=window.__x=1>',
    '<iframe srcdoc="<script>1</script>"></iframe>',
    "'; alert(1); //",
    '<a href="javascript:alert(1)">x</a>',
    '<style>*{display:none}</style>',
    '<b>đậm</b>',
    '&lt;script&gt;',
    '<math><mi xlink:href="javascript:1">',
    '<details open ontoggle=window.__x=1>',
    '<body onload=window.__x=1>',
    '<input autofocus onfocus=window.__x=1>',
    '<object data="javascript:1">',
    '</td></tr></table><script>1</script>',
    '<template><script>1</script></template>',
    '<svg><script>1</script></svg>',
    '${alert(1)}',
    '{{constructor.constructor("1")()}}',
    '‮<script>',
  ];
  it(`${evil.length} chuỗi nguy hiểm trong text, tên, khu vực, người xác nhận hiện dạng chữ`, async () => {
    const list = evil.map((s, i) =>
      inst({
        id: `E${i}`,
        text: s,
        name: s,
        area: 'x',
        ackUser: s,
        state: 'ACTIVE_ACK',
        valueActive: s,
        tsActive: i,
      }),
    );
    const src = source(list, { areas: [{ id: 'x', name: evil[0]! }] });
    const { el } = await mount(src, { columns: ['text', 'area', 'value', 'ackUser'] });
    const r = root(el);
    expect(r.querySelector('script')).toBeNull();
    expect(r.querySelector('img')).toBeNull();
    expect(r.querySelector('iframe')).toBeNull();
    expect(r.querySelector('style[data-x]')).toBeNull();
    expect(r.querySelectorAll('b, a, math, object, details, input[autofocus]')).toHaveLength(0);
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
    const texts = rows(el).map((tr) => cellText(tr)[0]);
    for (const s of evil) expect(texts).toContain(s.replace(/\s+/g, ' ').trim());
  });
});

describe('khóa thao tác và xác nhận (FR-064)', () => {
  it('operator: nút Xác nhận mỗi hàng gọi host với {id, occurrence}, không hộp', async () => {
    const src = source([inst({ id: 'A', occurrence: 7 })]);
    const { el, host } = await mount(src, { showAck: true });
    const btn = root(el).querySelector<HTMLButtonElement>('button[data-act="ack"]')!;
    expect(btn.getAttribute('aria-disabled')).not.toBe('true');
    btn.click();
    await frame();
    expect(host.ackCalls).toEqual([{ items: [{ id: 'A', occurrence: 7 }] }]);
    expect(root(el).querySelector('[data-msg]')!.textContent).toContain('Đã xác nhận');
  });
  it('chỉ có nút cho ACTIVE_UNACK và RTN_UNACK', async () => {
    const src = source([
      inst({ id: 'u' }),
      inst({ id: 'r', state: 'RTN_UNACK' }),
      inst({ id: 'k', state: 'ACTIVE_ACK' }),
    ]);
    const { el } = await mount(src, { showAck: true });
    const withBtn = rows(el)
      .filter((r) => r.querySelector('button[data-act="ack"]'))
      .map((r) => r.dataset.id);
    expect(withBtn.sort()).toEqual(['r', 'u']);
  });
  it('viewer: nút còn trong DOM, aria-disabled kèm lý do, bấm không gọi host', async () => {
    const host = new FakeActionHost({ session: { user: 'xem1', role: 'viewer' } });
    const { el } = await mount(source([inst({ id: 'A' })]), { showAck: true }, host);
    const btn = root(el).querySelector<HTMLButtonElement>('button[data-act="ack"]')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.title).toBe('Cần đăng nhập với role operator');
    expect(root(el).textContent).toContain('Cần đăng nhập với role operator');
    btn.click();
    await frame();
    expect(host.ackCalls).toHaveLength(0);
    expect(host.calls).not.toContain('login');
  });
  it('chưa đăng nhập: bấm nút mở hộp đăng nhập', async () => {
    const host = new FakeActionHost({ session: null });
    const { el } = await mount(source([inst({ id: 'A' })]), { showAck: true }, host);
    root(el).querySelector<HTMLButtonElement>('button[data-act="ack"]')!.click();
    await frame();
    expect(host.calls).toContain('login');
    expect(host.ackCalls).toHaveLength(0);
  });
  it('mất kết nối live: khóa với lý do', async () => {
    const src = source([inst({ id: 'A' })], { status: 'stale' });
    const { el } = await mount(src, { showAck: true });
    const btn = root(el).querySelector<HTMLButtonElement>('button[data-act="ack"]')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.title).toBe('Mất kết nối tới thiết bị');
  });
  it('khóa chung của 007 (HTTP) dùng câu của host', async () => {
    const host = new FakeActionHost({
      session: { user: 'a', role: 'operator' },
      blocked: { code: 'INSECURE', message: 'Mở bằng HTTPS để điều khiển' },
    });
    const { el } = await mount(source([inst({ id: 'A' })]), { showAck: true }, host);
    expect(root(el).querySelector<HTMLElement>('button[data-act="ack"]')!.title).toBe(
      'Mở bằng HTTPS để điều khiển',
    );
  });
  it('đang gửi: aria-busy, rồi kết quả; STALE nhấn mạnh hàng', async () => {
    const host = new FakeActionHost({ session: { user: 'a', role: 'operator' } });
    let done!: (o: Awaited<ReturnType<typeof host.ackHandler>>) => void;
    host.ackHandler = () => new Promise((r) => (done = r));
    const { el } = await mount(source([inst({ id: 'A', occurrence: 3 })]), { showAck: true }, host);
    root(el).querySelector<HTMLButtonElement>('button[data-act="ack"]')!.click();
    await frame();
    expect(rows(el)[0]!.getAttribute('aria-busy')).toBe('true');
    done({
      ok: true,
      acked: 0,
      skippedNewer: 0,
      results: [{ id: 'A', occurrence: 3, result: 'STALE' }],
    });
    await frame();
    expect(rows(el)[0]!.getAttribute('aria-busy')).toBeNull();
    expect(root(el).textContent).toContain('Alarm đã bật lại lần mới, xem lại trước khi xác nhận');
    expect(rows(el)[0]!.hasAttribute('data-attn')).toBe(true);
  });
  it('lỗi toàn yêu cầu: AUDIT_UNAVAILABLE hiện bằng chữ tiếng Việt, role=alert', async () => {
    const host = new FakeActionHost({ session: { user: 'a', role: 'operator' } });
    host.ackHandler = () => ({
      ok: false,
      error: { code: 'AUDIT_UNAVAILABLE', message: 'x' },
      results: [],
      acked: 0,
      skippedNewer: 0,
    });
    const { el } = await mount(source([inst({ id: 'A' })]), { showAck: true }, host);
    root(el).querySelector<HTMLButtonElement>('button[data-act="ack"]')!.click();
    await frame();
    const msg = root(el).querySelector('[data-msg]')!;
    expect(msg.textContent).toContain('Thiết bị không ghi được nhật ký kiểm toán');
    expect(msg.getAttribute('role')).toBe('alert');
  });
  it('chế độ edit: không gọi host, không khóa lý do, không nhấp nháy', async () => {
    const host = new FakeActionHost({ session: null });
    const src = source([inst({ id: 'A', class: 'critical', priority: 'critical' })]);
    const { el } = await mount(src, { showAck: true, mode: 'edit' }, host);
    root(el).querySelector<HTMLButtonElement>('button[data-act="ack"]')?.click();
    await frame();
    expect(host.ackCalls).toHaveLength(0);
    expect(host.calls).not.toContain('login');
    expect(rows(el)[0]!.classList.contains('blink')).toBe(false);
  });
});

describe('chọn hàng và bàn phím (§10)', () => {
  const list = [
    inst({ id: 'A', tsActive: 3 }),
    inst({ id: 'B', tsActive: 2 }),
    inst({ id: 'C', tsActive: 1 }),
  ];
  const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
    const tr = root(el).querySelector<HTMLElement>('tbody tr[tabindex="0"]') ?? rows(el)[0]!;
    tr.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
    );
  };
  it('hộp chọn có nhãn "Chọn alarm <tên>"; selection và sự kiện', async () => {
    const { el } = await mount(source(list), { selectable: true });
    const boxes = root(el).querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
    expect(boxes[0]!.getAttribute('aria-label')).toBe(`Chọn alarm ${list[0]!.name}`);
    const events: string[][] = [];
    el.addEventListener('mat-alarm-selection', (e) =>
      events.push([...(e as CustomEvent<string[]>).detail]),
    );
    boxes[1]!.click();
    await el.updateComplete;
    expect([...el.selection]).toEqual(['B']);
    expect(events.at(-1)).toEqual(['B']);
  });
  it('chọn tất cả ở tiêu đề; Ctrl+A; Esc xóa', async () => {
    const { el } = await mount(source(list), { selectable: true });
    root(el).querySelector<HTMLInputElement>('thead input[type="checkbox"]')!.click();
    await el.updateComplete;
    expect(el.selection.size).toBe(3);
    key(el, 'Escape');
    await el.updateComplete;
    expect(el.selection.size).toBe(0);
    key(el, 'a', { ctrlKey: true });
    await el.updateComplete;
    expect(el.selection.size).toBe(3);
  });
  it('mũi tên, Home, End di chuyển hàng (roving tabindex); Space chọn', async () => {
    const { el } = await mount(source(list), { selectable: true });
    expect(rows(el)[0]!.tabIndex).toBe(0);
    key(el, 'ArrowDown');
    await frame();
    expect(rows(el)[1]!.tabIndex).toBe(0);
    expect(rows(el)[0]!.tabIndex).toBe(-1);
    key(el, 'End');
    await frame();
    expect(rows(el)[2]!.tabIndex).toBe(0);
    key(el, ' ');
    await el.updateComplete;
    expect([...el.selection]).toEqual(['C']);
    key(el, 'Home');
    await frame();
    expect(rows(el)[0]!.tabIndex).toBe(0);
  });
  it('Shift+A xác nhận hàng chọn, hoặc hàng đang focus nếu chưa chọn gì', async () => {
    const { el, host } = await mount(source(list), { selectable: true, showAck: true });
    key(el, 'A', { shiftKey: true });
    await frame();
    expect(host.ackCalls.at(-1)).toEqual({ items: [{ id: 'A', occurrence: list[0]!.occurrence }] });
    el.focusRow('B');
    root(el).querySelector<HTMLInputElement>('tbody tr[data-id="B"] input')!.click();
    root(el).querySelector<HTMLInputElement>('tbody tr[data-id="C"] input')!.click();
    await el.updateComplete;
    key(el, 'A', { shiftKey: true });
    await frame();
    expect(
      (host.ackCalls.at(-1) as unknown as { items: { id: string }[] }).items
        .map((i) => i.id)
        .sort(),
    ).toEqual(['B', 'C']);
  });
  it('Ctrl+Shift+A và S phát sự kiện cho trang mở hộp; không xung đột phím trần', async () => {
    const { el } = await mount(source(list), { selectable: true, showAck: true, showShelve: true });
    const seen: string[] = [];
    el.addEventListener('mat-alarm-ackall', () => seen.push('ackall'));
    el.addEventListener('mat-alarm-shelve', (e) =>
      seen.push(`shelve:${(e as CustomEvent<{ id: string }>).detail.id}`),
    );
    key(el, 'A', { ctrlKey: true, shiftKey: true });
    key(el, 's');
    key(el, 'x');
    expect(seen).toEqual(['ackall', 'shelve:A']);
  });
  it('chọn bị bỏ khi instance biến mất', async () => {
    const src = source(list);
    const { el } = await mount(src, { selectable: true });
    root(el).querySelector<HTMLInputElement>('tbody tr[data-id="B"] input')!.click();
    await el.updateComplete;
    src.remove('B');
    await frame();
    expect(el.selection.size).toBe(0);
  });
});

describe('tạm ẩn (tab Tạm ẩn)', () => {
  it('nút Gỡ tạm ẩn gọi host.unshelveAlarm', async () => {
    const src = source([inst({ id: 'S', state: 'NORMAL', shelved: shelf, occurrence: 0 })]);
    const { el, host } = await mount(src, { tab: 'shelved', showShelve: true });
    root(el).querySelector<HTMLButtonElement>('button[data-act="unshelve"]')!.click();
    await frame();
    expect(host.unshelveCalls).toEqual(['S']);
  });
  it('nút Tạm ẩn… phát sự kiện với id (hộp do trang mở)', async () => {
    const { el } = await mount(source([inst({ id: 'A' })]), { showShelve: true });
    const seen: string[] = [];
    el.addEventListener('mat-alarm-shelve', (e) =>
      seen.push((e as CustomEvent<{ id: string }>).detail.id),
    );
    root(el).querySelector<HTMLButtonElement>('button[data-act="shelve"]')!.click();
    expect(seen).toEqual(['A']);
  });
});
