// <mat-screen> ở bố cục lưới (feature 012, T018; contracts/project-format-1.1.md §2, research R5): hàng là lưới 12 cột,
// ô giữ chỗ theo offset và span, widget điền đầy ô, không co cả màn hình; dưới 768 px các ô xếp chồng một cột.
import { afterEach, describe, expect, it } from 'vitest';
import type { GridLayout, ScreenModel } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo } from '../host/types.ts';
import type { MatScreen } from './mat-screen.ts';
import './mat-screen.ts';

const tag = (id: string, over: Partial<TagInfo> = {}): TagInfo => ({
  id,
  type: 'FLOAT32',
  access: 'R',
  kind: 'external',
  ...over,
});

const layout = (): GridLayout => ({
  mode: 'grid',
  columns: 12,
  gap: 12,
  padding: 16,
  rows: [
    {
      id: 'r1',
      height: 'auto',
      cells: [
        { id: 'c1', span: 4, item: 'a' },
        { id: 'c2', span: 4, offset: 2, item: 'b' },
        { id: 'c3', span: 2 },
      ],
    },
    { id: 'r2', height: 320, gap: 8, cells: [{ id: 'c4', span: 12, item: 'c', minHeight: 200 }] },
  ],
});

const gridScreen = (over: Partial<GridLayout> = {}): ScreenModel =>
  ({
    schemaVersion: '1.1.0',
    id: 'tong-quan',
    name: 'Tổng quan',
    kind: 'screen',
    size: { width: 1920, height: 1080 },
    background: '#fafafa',
    layout: { ...layout(), ...over },
    items: [
      { id: 'a', type: 'widget', widget: 'card', tags: { value: 't1' } },
      { id: 'b', type: 'widget', widget: 'lamp', tags: { state: 'b1' } },
      { id: 'c', type: 'widget', widget: 'panel' },
      { id: 'orphan', type: 'widget', widget: 'card', tags: { value: 't2' } },
    ],
  }) as unknown as ScreenModel;

async function setup(screen: ScreenModel, width = 1366) {
  const src = new MemoryTagSource({ tags: [tag('t1'), tag('t2'), tag('b1', { type: 'BOOL' })] });
  const host = new FakeActionHost({ session: { user: 'u', role: 'operator' } });
  const el = document.createElement('mat-screen') as MatScreen;
  el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
  el.tags = src;
  el.host = host;
  el.mode = 'run';
  el.viewport = { width, height: 768 };
  el.loadSvg = async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  el.loadBindings = async () => [];
  el.screen = screen;
  document.body.append(el);
  await el.updateComplete;
  await el.whenReady();
  return { el, src, host };
}

const root = (el: MatScreen) => el.shadowRoot!;
const rows = (el: MatScreen) => [...root(el).querySelectorAll<HTMLElement>('.grid > .row')];
const cell = (el: MatScreen, id: string) =>
  root(el).querySelector<HTMLElement>(`.cell[data-cell-id="${id}"]`)!;

afterEach(() => document.body.replaceChildren());

describe('<mat-screen>: bố cục lưới', () => {
  it('không có .frame co giãn; mỗi hàng một lưới 12 cột, ô đặt theo offset và span', async () => {
    const { el } = await setup(gridScreen());
    expect(root(el).querySelector('.frame')).toBeNull();
    expect(rows(el)).toHaveLength(2);
    expect(rows(el)[0]!.style.gridTemplateColumns).toBe('repeat(12, minmax(0, 1fr))');
    expect(cell(el, 'c1').style.gridColumn).toBe('1 / span 4');
    expect(cell(el, 'c2').style.gridColumn).toBe('7 / span 4'); // 4 cột của c1 + offset 2
    expect(cell(el, 'c3').style.gridColumn).toBe('11 / span 2');
    expect(cell(el, 'c4').style.gridColumn).toBe('1 / span 12');
  });

  it('khoảng cách, lề, chiều cao hàng px, chiều cao tối thiểu của ô, nền', async () => {
    const { el } = await setup(gridScreen());
    const grid = root(el).querySelector<HTMLElement>('.grid')!;
    expect(grid.style.padding).toBe('16px');
    expect(grid.style.rowGap).toBe('12px');
    expect(rows(el)[0]!.style.columnGap).toBe('12px');
    expect(rows(el)[1]!.style.columnGap).toBe('8px');
    expect(rows(el)[1]!.style.height).toBe('320px');
    expect(cell(el, 'c4').style.minHeight).toBe('200px');
    expect(root(el).querySelector<HTMLElement>('.viewport')!.style.background).toContain('250');
  });

  it('hàng auto cao tối thiểu bằng cỡ tối thiểu lớn nhất của widget trong hàng (danh mục)', async () => {
    const { el } = await setup(gridScreen());
    // card: minSize [96, 56], lamp: [24, 24]
    expect(rows(el)[0]!.style.minHeight).toBe('56px');
  });

  it('widget nằm trong ô và điền đầy ô; ô trống không có widget; item mồ côi không hiện', async () => {
    const { el } = await setup(gridScreen());
    const a = cell(el, 'c1').querySelector<HTMLElement>('.item')!;
    expect(a.dataset.itemId).toBe('a');
    expect(a.style.position).toBe('relative');
    expect(a.style.width).toBe('100%');
    expect(a.style.height).toBe('100%');
    expect(a.querySelector('mat-w-card')).not.toBeNull();
    expect(cell(el, 'c3').children).toHaveLength(0);
    expect(root(el).querySelector('[data-item-id="orphan"]')).toBeNull();
  });

  it('đăng ký Tag của widget trong ô, bỏ item mồ côi', async () => {
    const { el } = await setup(gridScreen());
    expect(el.tagIds().sort()).toEqual(['b1', 't1']);
  });

  it('dưới 768 px: lớp narrow, mọi ô chiếm trọn hàng', async () => {
    const { el } = await setup(gridScreen(), 600);
    expect(root(el).querySelector('.grid')!.classList.contains('narrow')).toBe(true);
    expect(cell(el, 'c2').style.gridColumn).toBe('1 / -1');
    const wide = await setup(gridScreen(), 1366);
    expect(root(wide.el).querySelector('.grid')!.classList.contains('narrow')).toBe(false);
  });

  it('đổi bố cục (Studio sửa): widget giữ phần tử cũ, chuyển sang ô mới', async () => {
    const { el } = await setup(gridScreen());
    const before = cell(el, 'c1').querySelector('mat-w-card');
    const s = gridScreen() as unknown as { layout: GridLayout };
    s.layout.rows[0]!.cells = [{ id: 'c9', span: 12, item: 'a' }];
    el.screen = s as unknown as ScreenModel;
    await el.updateComplete;
    expect(cell(el, 'c9').querySelector('mat-w-card')).toBe(before);
    expect(root(el).querySelector('[data-item-id="b"]')).toBeNull();
  });

  it('màn hình tự do vẫn dựng như cũ (.frame co giãn)', async () => {
    const free = gridScreen() as unknown as Record<string, unknown>;
    delete free.layout;
    (free.items as Array<Record<string, unknown>>).forEach((i, n) =>
      Object.assign(i, { x: n * 10, y: 0, width: 200, height: 100 }),
    );
    const { el } = await setup(free as unknown as ScreenModel);
    expect(root(el).querySelector('.frame')).not.toBeNull();
    expect(root(el).querySelector('.grid')).toBeNull();
  });
});
