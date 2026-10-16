// Faceplate lúc chạy (feature 011, T170; FR-125; contracts/project-format-1.0.md §5): thay `{param}` của popup bằng
// `args` (dùng substituteParams của @mat/project-schema), Tag đã thay ngoài tập công bố ⇒ widget hiện "Tag không có" và
// không đăng ký; `args` sai bị từ chối; `<mat-screen>` đăng ký Tag đã thay, đổi đăng ký khi mở popup khác, hủy khi đóng.
import { afterEach, describe, expect, it } from 'vitest';
import type { ScreenModel, ScreenModel10, WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo } from '../host/types.ts';
import { itemTagIds } from './layers.ts';
import './mat-screen.ts';
import type { MatScreen } from './mat-screen.ts';
import { missingTagsOf, substitutePopup } from './popup-layer.ts';

const widget = (
  id: string,
  kind: string,
  tags?: Record<string, string>,
  props?: WidgetItem['props'],
): WidgetItem => ({
  type: 'widget',
  id,
  widget: kind,
  x: 10,
  y: 10,
  width: 200,
  height: 100,
  ...(tags ? { tags } : {}),
  ...(props ? { props } : {}),
});

const faceplate = (): ScreenModel10 => ({
  schemaVersion: '1.0.0',
  id: 'bom-chi-tiet',
  name: 'Chi tiết bơm',
  kind: 'popup',
  size: { width: 640, height: 420 },
  params: [
    { name: 'prefix', kind: 'tagPrefix' },
    { name: 'title', kind: 'string', default: 'Bơm' },
  ],
  items: [
    widget('flow', 'card', { value: '{prefix}.FLOW' }, { label: '{title} (lưu lượng)' }),
    widget('run', 'lamp', { state: '{prefix}.RUN' }),
    widget('note', 'label', undefined, { text: 'Faceplate' }),
  ],
});

const PUMPS = ['PUMP07', 'PUMP08'].flatMap((p) => [`${p}.FLOW`, `${p}.RUN`]);
const known = (id: string) => PUMPS.includes(id);

describe('substitutePopup: thay tham số (FR-125)', () => {
  it('thay {param} ở mọi item bằng args; tham số vắng lấy default; không sửa mô hình gốc', () => {
    const src = faceplate();
    const before = JSON.stringify(src);
    const r = substitutePopup(src, { prefix: 'PUMP07' }, known);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [flow, run, note] = r.model.items as WidgetItem[];
    expect(flow!.tags).toEqual({ value: 'PUMP07.FLOW' });
    expect(flow!.props).toEqual({ label: 'Bơm (lưu lượng)' });
    expect(run!.tags).toEqual({ state: 'PUMP07.RUN' });
    expect(note!.props).toEqual({ text: 'Faceplate' });
    expect(missingTagsOf(flow!)).toBeUndefined();
    expect(JSON.stringify(src)).toBe(before);
    expect(r.model.id).toBe('bom-chi-tiet');
  });

  it('args đủ: dùng giá trị của args', () => {
    const r = substitutePopup(faceplate(), { prefix: 'PUMP08', title: 'Bơm 8' }, known);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const flow = r.model.items[0] as WidgetItem;
    expect(flow.tags).toEqual({ value: 'PUMP08.FLOW' });
    expect(flow.props?.label).toBe('Bơm 8 (lưu lượng)');
  });

  it('popup không có params và không args: trả đúng mô hình cũ', () => {
    const plain: ScreenModel = { ...faceplate(), items: [widget('a', 'card', { value: 'X.Y' })] };
    delete (plain as ScreenModel10).params;
    const r = substitutePopup(plain, undefined, () => false);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.model).toBe(plain);
  });

  it.each([
    ['thiếu tham số không default', {}, '/prefix'],
    ['khóa không phải tham số', { prefix: 'PUMP07', extra: 'x' }, '/extra'],
    ['sai kiểu tagPrefix', { prefix: '7PUMP' }, '/prefix'],
    ['giá trị không phải chuỗi', { prefix: 7 }, '/prefix'],
    ['args không phải đối tượng', 'PUMP07', ''],
  ])('args sai bị từ chối: %s', (_name, args, path) => {
    const r = substitutePopup(faceplate(), args, known);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.some((p) => p.kind === 'args' && p.path === path)).toBe(true);
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('popup không có params mà nhận args: từ chối', () => {
    const plain: ScreenModel = { ...faceplate(), items: [] };
    delete (plain as ScreenModel10).params;
    const r = substitutePopup(plain, { prefix: 'PUMP07' }, known);
    expect(r.ok).toBe(false);
  });

  it('Tag đã thay không thuộc tập công bố: item đánh dấu missingTags, bỏ khe tags (không đăng ký)', () => {
    const r = substitutePopup(faceplate(), { prefix: 'PUMP99' }, known);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [flow, run, note] = r.model.items;
    expect(missingTagsOf(flow!)).toEqual(['PUMP99.FLOW']);
    expect(missingTagsOf(run!)).toEqual(['PUMP99.RUN']);
    expect(missingTagsOf(note!)).toBeUndefined();
    expect(itemTagIds(flow!)).toEqual([]);
    expect(itemTagIds(run!)).toEqual([]);
  });

  it('chỉ một phần Tag lạ: item vẫn bị đánh dấu (không đăng ký nửa vời)', () => {
    const m = faceplate();
    m.items = [widget('two', 'line', { series: 'X' })];
    (m.items[0] as WidgetItem).tags = { series: ['{prefix}.FLOW', '{prefix}.GONE'] };
    const r = substitutePopup(m, { prefix: 'PUMP07' }, known);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(missingTagsOf(r.model.items[0]!)).toEqual(['PUMP07.GONE']);
    expect(itemTagIds(r.model.items[0]!)).toEqual([]);
  });
});

// ---- <mat-screen> với popup đã thay ---------------------------------------------------------------------------

const tag = (id: string): TagInfo => ({ id, type: 'FLOAT32', access: 'R', kind: 'external' });

interface Spy {
  el: MatScreen;
  src: MemoryTagSource;
  /** Tập Tag đang được đăng ký (đếm số người nghe theo Tag). */
  active: () => string[];
}

async function setup(): Promise<Spy> {
  const src = new MemoryTagSource({ tags: [...PUMPS, 'MAIN.T'].map(tag) });
  const counts = new Map<string, number>();
  const orig = src.subscribe.bind(src);
  src.subscribe = (ids, fn) => {
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    const off = orig(ids, fn);
    return () => {
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) - 1);
      off();
    };
  };
  const el = document.createElement('mat-screen') as MatScreen;
  el.env = { raf: (cb) => (cb(), 0), cancelRaf: () => {}, ResizeObserver: undefined };
  el.tags = src;
  el.host = new FakeActionHost({ session: { user: 'u', role: 'operator' } });
  el.viewport = { width: 1000, height: 500 };
  el.screen = {
    schemaVersion: '1.0.0',
    id: 'main',
    name: 'main',
    kind: 'screen',
    size: { width: 1000, height: 500 },
    items: [widget('m', 'card', { value: 'MAIN.T' })],
  };
  document.body.append(el);
  await el.updateComplete;
  await el.whenReady();
  const active = () =>
    [...counts]
      .filter(([, n]) => n > 0)
      .map(([id]) => id)
      .sort();
  return { el, src, active };
}

const nested = (el: MatScreen) =>
  el.shadowRoot!.querySelector<MatScreen>('.popup-body > mat-screen')!;

async function openPopup(el: MatScreen, args: unknown): Promise<void> {
  const r = substitutePopup(faceplate(), args, known);
  if (!r.ok) throw new Error(r.message);
  el.popup = r.model;
  await el.updateComplete;
  await nested(el).updateComplete;
  await nested(el).whenReady();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('<mat-screen>: faceplate (FR-125)', () => {
  it('mở với args: widget đăng ký Tag đã thay; tagIds gồm Tag đã thay', async () => {
    const { el, src, active } = await setup();
    await openPopup(el, { prefix: 'PUMP07', title: 'Bơm 7' });
    expect(active()).toEqual(['MAIN.T', 'PUMP07.FLOW', 'PUMP07.RUN']);
    expect(el.tagIds().sort()).toEqual(['MAIN.T', 'PUMP07.FLOW', 'PUMP07.RUN']);
    src.set('PUMP07.FLOW', { value: 12.5 });
    const card = nested(el).shadowRoot!.querySelector<HTMLElement>('mat-w-card')!;
    await (card as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(card.shadowRoot!.textContent).toContain('12.5');
    expect(card.shadowRoot!.textContent).toContain('Bơm 7 (lưu lượng)');
  });

  it('mở popup khác (args mới) thay popup hiện tại: hủy Tag cũ, đăng ký Tag mới', async () => {
    const { el, active } = await setup();
    await openPopup(el, { prefix: 'PUMP07' });
    await openPopup(el, { prefix: 'PUMP08' });
    expect(active()).toEqual(['MAIN.T', 'PUMP08.FLOW', 'PUMP08.RUN']);
    expect(el.shadowRoot!.querySelectorAll('.popup-overlay')).toHaveLength(1);
  });

  it('đóng popup: hủy mọi Tag của popup', async () => {
    const { el, active } = await setup();
    await openPopup(el, { prefix: 'PUMP07' });
    el.popup = null;
    await el.updateComplete;
    expect(active()).toEqual(['MAIN.T']);
    expect(el.tagIds()).toEqual(['MAIN.T']);
  });

  it('Tag đã thay không có: widget hiện "Tag không có", không đăng ký', async () => {
    const { el, active } = await setup();
    await openPopup(el, { prefix: 'PUMP99' });
    expect(active()).toEqual(['MAIN.T']);
    expect(el.tagIds()).toEqual(['MAIN.T']);
    const inner = nested(el).shadowRoot!;
    const errs = [...inner.querySelectorAll<HTMLElement>('.tag-missing')];
    expect(errs).toHaveLength(2);
    expect(errs[0]!.textContent).toContain('Tag không có');
    expect(errs[0]!.textContent).toContain('PUMP99.FLOW');
    expect(errs[0]!.getAttribute('role')).toBe('img');
    expect(inner.querySelector('mat-w-card')).toBeNull();
    expect(inner.querySelector('mat-w-lamp')).toBeNull();
    // Mở lại với bơm có thật: lỗi biến mất, widget dựng và đăng ký.
    await openPopup(el, { prefix: 'PUMP07' });
    expect(inner.querySelectorAll('.tag-missing')).toHaveLength(0);
    expect(inner.querySelector('mat-w-card')).not.toBeNull();
    expect(active()).toEqual(['MAIN.T', 'PUMP07.FLOW', 'PUMP07.RUN']);
  });
});
