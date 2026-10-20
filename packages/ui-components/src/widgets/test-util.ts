// Tiện ích dùng chung cho test widget (không phải mã chạy thật).
import type { ValueTable } from '@mat/expression';
import type { WidgetItem } from '@mat/project-schema';
import { setEChartsLoader } from '../chart/echarts-lite.ts';
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
  setEChartsLoader(null);
};

/** Một biểu đồ của ECharts giả: phần tử chứa, tùy chọn init, mọi option đã đặt. */
export interface FakeChart {
  el: HTMLElement;
  init: { width?: number; height?: number } | undefined;
  options: Array<Record<string, unknown>>;
  resized: number;
  disposed: boolean;
}

/** Thay ECharts bằng bản giả ghi lại option (feature 012): test đọc option thay vì điểm ảnh. */
export function fakeECharts(): {
  charts: FakeChart[];
  /** Số lần thư viện được nạp (loadECharts gọi bộ nạp). */
  loads: () => number;
  option(): Record<string, unknown>;
} {
  const charts: FakeChart[] = [];
  let loads = 0;
  setEChartsLoader(
    async () => (
      loads++,
      {
        init(el, init) {
          const c: FakeChart = { el, init, options: [], resized: 0, disposed: false };
          charts.push(c);
          return {
            setOption: (o) => void c.options.push(o as Record<string, unknown>),
            resize: () => void c.resized++,
            dispose: () => void (c.disposed = true),
          };
        },
      }
    ),
  );
  return {
    charts,
    loads: () => loads,
    option: () => {
      const o = charts.at(-1)?.options.at(-1);
      if (!o) throw new Error('chưa có option nào');
      return o;
    },
  };
}

/** Gắn widget biểu đồ và chờ ECharts (giả hoặc thật) nhận option đầu tiên. */
export async function mountChart(it: WidgetItem, source: MemoryTagSource): Promise<El> {
  const el = await mount(it, source);
  await (el as unknown as { chartReady: Promise<void> }).chartReady;
  await el.updateComplete;
  return el;
}

/** Gọi formatter (hàm) của ECharts như ECharts gọi. */
export function callFormatter(f: unknown, params: Record<string, unknown>): unknown {
  if (typeof f !== 'function') throw new Error('formatter không phải hàm');
  return (f as (p: Record<string, unknown>) => unknown)(params);
}
