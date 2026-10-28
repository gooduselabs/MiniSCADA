// Feature 037 vòng 2: thao tác tiện dụng trên component.
// 1. "Đổi thành…": đổi loại widget tại chỗ, giữ id, vị trí, cỡ (nới tới cỡ tối thiểu), nhãn/tiêu đề, khe Tag cùng tên hoặc
//    khe chính, thuộc tính cùng tên còn hợp lệ với loại mới.
// 2. Sao chép / dán định dạng: chỉ thuộc tính trình bày (màu, kiểu nền, biểu tượng, ngưỡng…), không Tag, không nhãn.
// 3. Kéo nhiều Tag thả vào lưới: thêm hàng Thẻ giá trị (Tag BOOL → Đèn / trạng thái kiểu đèn), mỗi Tag một ô.
// Hàm thuần `(doc, …) → { doc, selection?, rejected? }` như screen-doc / grid-ops.
import {
  catalogWidget,
  checkPropValue,
  tagClassOf,
  type PropValue,
  type ScreenModel,
  type WidgetItem,
} from '@mat/project-schema';
import { addRow, attachWidget, setRowProps } from './grid-ops.ts';
import type { EditResult } from './screen-doc.ts';
import { presetProps } from './widget-presets.ts';

type Item = ScreenModel['items'][number];

/** Nhóm loại đổi qua lại được (cùng vai trò hiển thị một giá trị, một trạng thái, điều khiển một Tag…). */
const FAMILIES: readonly (readonly string[])[] = [
  ['card', 'multi-state', 'label', 'gauge', 'level', 'progress', 'kpi', 'equipment'],
  ['button', 'switch', 'setpoint', 'slider', 'select'],
  ['line', 'bar', 'pie', 'tag-table', 'status-list'],
  ['panel', 'text'],
];

/** Loại có thể đổi sang (không gồm chính nó và loại đã lỗi thời). */
export function changeTargets(widget: string): string[] {
  const fam = FAMILIES.find((f) => f.includes(widget)) ?? [];
  return fam.filter((w) => w !== widget && catalogWidget(w) && !catalogWidget(w)!.deprecated);
}

const NAME_PROPS = ['label', 'title', 'text'] as const;

/** Item sau khi đổi loại (thuần). */
export function convertItem(it: WidgetItem, type: string): WidgetItem {
  const spec = catalogWidget(type)!;
  const old = it.props ?? {};
  const props: Record<string, PropValue> = { ...(presetProps(type) ?? {}) };
  // Thuộc tính cùng tên, còn hợp lệ với loại mới.
  for (const [k, v] of Object.entries(old)) {
    const p = spec.props.find((x) => x.name === k);
    if (p && checkPropValue(p, v) === null) props[k] = v;
  }
  // Nhãn: label/title/text của loại cũ sang thuộc tính tên của loại mới.
  const name = NAME_PROPS.map((k) => old[k]).find((v) => typeof v === 'string' && v !== '');
  const target = NAME_PROPS.find((k) => spec.props.some((p) => p.name === k));
  if (typeof name === 'string' && target) props[target] = name;
  // Khe Tag: cùng tên giữ; khe chính cũ → khe chính mới.
  const oldSpec = catalogWidget(it.widget);
  const tags: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(it.tags ?? {})) {
    const s = spec.slots.find((x) => x.name === k);
    if (s) tags[k] = s.multi ? (Array.isArray(v) ? v : [v]) : Array.isArray(v) ? v[0]! : v;
  }
  const mainOld = oldSpec?.slots[0]?.name;
  const mainNew = spec.slots[0];
  if (mainOld && mainNew && tags[mainNew.name] === undefined) {
    const v = it.tags?.[mainOld];
    if (v !== undefined)
      tags[mainNew.name] = mainNew.multi
        ? Array.isArray(v)
          ? v
          : [v]
        : Array.isArray(v)
          ? v[0]!
          : v;
  }
  const out: WidgetItem = { ...it, widget: type };
  delete out.props;
  delete out.tags;
  delete out.events;
  if (Object.keys(props).length) out.props = props;
  if (Object.keys(tags).length) out.tags = tags;
  if (it.events && spec.events.length) out.events = it.events;
  if (it.width !== undefined) out.width = Math.max(it.width, spec.minSize[0]);
  if (it.height !== undefined) out.height = Math.max(it.height, spec.minSize[1]);
  return out;
}

export function changeWidgetType(doc: ScreenModel, id: string, type: string): EditResult {
  const it = doc.items.find((i) => i.id === id);
  if (!it || it.type !== 'widget') return { doc, selection: [], rejected: 'unknown-item' };
  if (!changeTargets(it.widget).includes(type))
    return { doc, selection: [id], rejected: 'unknown-widget' };
  const next = convertItem(it as WidgetItem, type) as unknown as Item;
  return {
    doc: { ...doc, items: doc.items.map((x) => (x.id === id ? next : x)) },
    selection: [id],
  };
}

// ---- Định dạng ----

/** Thuộc tính trình bày được chép (không Tag, không nhãn, không giá trị nghiệp vụ). */
export const FORMAT_PROPS: readonly string[] = [
  'accent',
  'accentColor',
  'fill',
  'icon',
  'fontSize',
  'valueColor',
  'background',
  'color',
  'onColor',
  'offColor',
  'showUnit',
  'showQuality',
  'statusText',
  'sparkline',
  'trend',
  'flash',
  'glow',
  'wave',
  'animate',
  'variant',
  'style',
  'shape',
  'warnAbove',
  'warnBelow',
  'alarmAbove',
  'alarmBelow',
  'blinkAbove',
  'blinkBelow',
  'blinkOn',
  'blinkRed',
  'zones',
];

export type FormatClip = Readonly<Record<string, PropValue>>;

export function copyFormat(it: Item): FormatClip | null {
  if (it.type !== 'widget') return null;
  const p = (it as WidgetItem).props ?? {};
  return Object.fromEntries(FORMAT_PROPS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]!]));
}

/** Dán định dạng lên các item: chỉ thuộc tính có ở loại đích và hợp lệ; item khóa bỏ qua. */
export function pasteFormat(
  doc: ScreenModel,
  ids: readonly string[],
  clip: FormatClip,
): EditResult {
  let changed = false;
  const items = doc.items.map((it) => {
    if (!ids.includes(it.id) || it.type !== 'widget' || it.locked === true) return it;
    const w = it as WidgetItem;
    const spec = catalogWidget(w.widget);
    if (!spec) return it;
    const props = { ...(w.props ?? {}) };
    let mine = false;
    for (const [k, v] of Object.entries(clip)) {
      const p = spec.props.find((x) => x.name === k);
      if (p && checkPropValue(p, v) === null && JSON.stringify(props[k]) !== JSON.stringify(v)) {
        props[k] = v;
        mine = changed = true;
      }
    }
    return mine ? ({ ...w, props } as unknown as Item) : it;
  });
  return changed ? { doc: { ...doc, items }, selection: [...ids] } : { doc, selection: [...ids] };
}

// ---- Nhiều Tag → hàng thẻ ----

export interface DropTag {
  id: string;
  type: string;
  description?: string;
}

/** Chia `n` ô (≤ 6) thành độ rộng cột tổng 12. */
function spansOf(n: number): number[] {
  const base = Math.floor(12 / n);
  const extra = 12 - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/**
 * Thêm hàng (mỗi hàng tối đa 6 ô, cao 116 px) ở vị trí `at`: mỗi Tag một Thẻ giá trị (Tag BOOL: Đèn / trạng thái kiểu
 * đèn), nhãn = mô tả hoặc id Tag. Chọn các component mới.
 */
export function addTagRows(doc: ScreenModel, tags: readonly DropTag[], at?: number): EditResult {
  if (tags.length === 0) return { doc, selection: [] };
  let d = doc;
  let pos = at;
  const sel: string[] = [];
  for (let i = 0; i < tags.length; i += 6) {
    const chunk = tags.slice(i, i + 6);
    const added = addRow(d, spansOf(chunk.length), pos);
    if (added.rejected) return { ...added, doc };
    d = added.doc;
    const rows = (
      d as unknown as { layout: { rows: Array<{ id: string; cells: Array<{ id: string }> }> } }
    ).layout.rows;
    const row = pos === undefined ? rows[rows.length - 1]! : rows[Math.min(pos, rows.length - 1)]!;
    for (const [k, t] of chunk.entries()) {
      const bool = tagClassOf(t.type) === 'bool';
      const type = bool ? 'multi-state' : 'card';
      const r = attachWidget(d, row.cells[k]!.id, type);
      if (r.rejected) return { ...r, doc };
      d = r.doc;
      const id = r.selection![0]!;
      sel.push(id);
      const label = t.description || t.id;
      d = {
        ...d,
        items: d.items.map((x) =>
          x.id === id
            ? ({
                ...x,
                props: {
                  ...((x as WidgetItem).props ?? {}),
                  label,
                  ...(bool ? { shape: 'lamp', glow: true, states: [] } : {}),
                },
                tags: { value: t.id },
              } as unknown as Item)
            : x,
        ),
      };
    }
    const h = setRowProps(d, row.id, { height: 116 });
    if (!h.rejected) d = h.doc;
    if (pos !== undefined) pos++;
  }
  return { doc: d, selection: sel };
}
