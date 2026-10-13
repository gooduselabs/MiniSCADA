// Tiện ích dùng chung cho test widget (không phải mã chạy thật).
import type { ValueTable } from '@mat/expression';
import type { WidgetItem } from '@mat/project-schema';
import { FakeActionHost, MemoryTagSource } from '../host/memory-source.ts';
import type { TagInfo } from '../host/types.ts';
import { registerWidgets } from './register.ts';

export type El = HTMLElement & { updateComplete: Promise<boolean> };

export function tagInfo(id: string, over: Partial<TagInfo> = {}): TagInfo {
  return { id, type: 'FLOAT32', access: 'R', kind: 'external', ...over };
}

export function widgetItem(
  widget: string,
  tags: WidgetItem['tags'],
  props?: WidgetItem['props'],
  extra: Partial<WidgetItem> = {},
): WidgetItem {
  return {
    type: 'widget',
    id: 'w1',
    widget,
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    tags,
    props,
    ...extra,
  };
}

export function makeSource(
  tags: TagInfo[],
  tables: Record<string, ValueTable> = {},
  now = 1_000_000,
): MemoryTagSource {
  return new MemoryTagSource({ tags, tables, now });
}

export async function mount(
  it: WidgetItem,
  source: MemoryTagSource,
  mode: 'run' | 'edit' = 'run',
  host = new FakeActionHost(),
): Promise<El> {
  registerWidgets();
  const el = document.createElement(`mat-w-${it.widget}`) as El & Record<string, unknown>;
  el.item = it;
  el.source = source;
  el.host = host;
  el.mode = mode;
  el.context = { screen: 's1', widget: it.id };
  document.body.append(el);
  await el.updateComplete;
  return el;
}

/** Chữ hiển thị của một phần tử trong Shadow DOM, gộp khoảng trắng. */
export function textOf(el: Element, sel: string): string {
  const n = el.shadowRoot!.querySelector(sel);
  return (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export const cleanup = (): void => {
  document.body.replaceChildren();
};
