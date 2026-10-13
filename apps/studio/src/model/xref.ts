// "Dùng ở đâu" của một Tag (feature 004, FR-006): phần tử màn hình và thuộc tính gắn với Tag, nhóm lưu
// trữ có Tag. Đọc từ binding và logging.json của project đang mở (outlineOf), kể cả khi project còn
// lỗi; phần tử hay file sai hình dạng thì bỏ qua, không ném lỗi.
import { tokens } from '@mat/expression';
import type { BindingTarget, WidgetItem } from '@mat/project-schema';
import { t, type MessageKey } from '../i18n/index.ts';
import type { Location } from './issue-map.ts';
import type { ProjectOutline } from './project-doc.ts';

export type XrefEntry =
  | {
      kind: 'binding';
      screen: string;
      screenName: string;
      element: string;
      elementName: string;
      target: string;
      bindingId: string;
    }
  | { kind: 'logging'; group: number; groupId: string; groupName: string }
  /** Biểu thức của Tag tính toán `tag` (dòng `row` của Bảng Tag) dùng Tag hoặc bảng giá trị. */
  | { kind: 'expression'; tag: string; row: number }
  | { kind: 'watch'; table: string; tableName: string; row: number }
  /** Tag có `valueTable` là bảng này. */
  | { kind: 'tagTable'; tag: string; row: number }
  /** Widget của màn hình 0.3 gắn Tag ở khe `slot` (feature 007, FR-069). */
  | {
      kind: 'widget';
      screen: string;
      screenName: string;
      item: string;
      itemName: string;
      slot: string;
    }
  /** Widget `select` của màn hình 0.3 dùng bảng giá trị này (`props.table`). */
  | { kind: 'widgetTable'; screen: string; screenName: string; item: string; itemName: string };

const TARGET_LABEL: Readonly<Record<BindingTarget, MessageKey>> = {
  'style.fill': 'target.style.fill',
  'style.stroke': 'target.style.stroke',
  'style.opacity': 'target.style.opacity',
  'style.visibility': 'target.style.visibility',
  'text.content': 'target.text.content',
  'transform.rotate': 'target.transform.rotate',
  'transform.translateX': 'target.transform.translateX',
  'transform.translateY': 'target.transform.translateY',
  'transform.scale': 'target.transform.scale',
  'geometry.levelPercent': 'target.geometry.levelPercent',
  'component.state': 'target.component.state',
};

/** Tên thuộc tính của đích binding ("Màu nền"); đích lạ giữ nguyên. */
export function targetLabel(target: string): string {
  return Object.prototype.hasOwnProperty.call(TARGET_LABEL, target)
    ? t(TARGET_LABEL[target as BindingTarget])
    : target;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' && v.trim() !== '' ? v : fallback;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

type XrefOutline = Pick<ProjectOutline, 'screens' | 'logging'> &
  Partial<Pick<ProjectOutline, 'tags' | 'watchTables'>>;

/** Binding của mọi màn hình: [màn hình, phần tử, binding] (bỏ qua chỗ sai hình dạng). */
function* eachBinding(outline: XrefOutline): Generator<{
  s: ProjectOutline['screens'][number];
  names: Map<string, string>;
  eb: Record<string, unknown>;
  b: Record<string, unknown>;
}> {
  for (const s of outline.screens) {
    const names = new Map<string, string>();
    for (const e of list(s.screen?.elements))
      if (isObject(e) && typeof e.elementUid === 'string')
        names.set(e.elementUid, str(e.name, e.elementUid));
    for (const eb of list(s.bindings?.elements)) {
      if (!isObject(eb) || typeof eb.elementUid !== 'string') continue;
      for (const b of list(eb.bindings)) if (isObject(b)) yield { s, names, eb, b };
    }
  }
}

const bindingEntry = ({
  s,
  names,
  eb,
  b,
}: ReturnType<typeof eachBinding> extends Generator<infer T> ? T : never): XrefEntry => ({
  kind: 'binding',
  screen: s.id,
  screenName: str(s.screen?.name, s.id),
  element: String(eb.elementUid),
  elementName: names.get(String(eb.elementUid)) ?? String(eb.elementUid),
  target: String(b.target),
  bindingId: String(b.id),
});

const tagRows = (
  outline: XrefOutline,
): { id: string; expression: string; valueTable: string; row: number }[] =>
  list(outline.tags?.tags).flatMap((x, row) =>
    isObject(x) && typeof x.id === 'string'
      ? [
          {
            id: x.id,
            expression: typeof x.expression === 'string' ? x.expression : '',
            valueTable: typeof x.valueTable === 'string' ? x.valueTable : '',
            row,
          },
        ]
      : [],
  );

/** "Dùng ở đâu" của một bảng giá trị: Tag có `valueTable`, biểu thức `text(x, bảng)`, binding `valueTable`. */
export function whereUsedTable(outline: XrefOutline, name: string): XrefEntry[] {
  const out: XrefEntry[] = [];
  const rows = tagRows(outline);
  for (const r of rows)
    if (r.valueTable === name) out.push({ kind: 'tagTable', tag: r.id, row: r.row });
  for (const r of rows)
    if (r.expression && tokens(r.expression).some((tk) => tk.kind === 'table' && tk.text === name))
      out.push({ kind: 'expression', tag: r.id, row: r.row });
  const tagTable = new Map(rows.map((r) => [r.id, r.valueTable]));
  for (const it of eachBinding(outline)) {
    const tr = it.b.transform;
    if (!isObject(tr) || tr.kind !== 'valueTable') continue;
    const table =
      typeof tr.table === 'string'
        ? tr.table
        : isObject(it.b.source) && typeof it.b.source.tagId === 'string'
          ? (tagTable.get(it.b.source.tagId) ?? '')
          : '';
    if (table === name) out.push(bindingEntry(it));
  }
  for (const { s, item } of eachWidget(outline))
    if (item.props?.table === name) out.push({ kind: 'widgetTable', ...widgetNames(s, item) });
  return out;
}

/** Widget của mọi màn hình 0.3: [màn hình, item]. */
function* eachWidget(outline: XrefOutline): Generator<{
  s: ProjectOutline['screens'][number];
  item: WidgetItem;
}> {
  for (const s of outline.screens)
    for (const item of s.model?.items ?? []) if (item.type === 'widget') yield { s, item };
}

const widgetNames = (s: ProjectOutline['screens'][number], item: WidgetItem) => ({
  screen: s.id,
  screenName: str(s.model?.name, s.id),
  item: item.id,
  itemName: str(item.name, item.id),
});

export function whereUsed(outline: XrefOutline, tagId: string): XrefEntry[] {
  const out: XrefEntry[] = [];
  for (const it of eachBinding(outline))
    if (isObject(it.b.source) && it.b.source.tagId === tagId) out.push(bindingEntry(it));
  for (const { s, item } of eachWidget(outline))
    for (const [slot, v] of Object.entries(item.tags ?? {}))
      if (Array.isArray(v) ? v.includes(tagId) : v === tagId)
        out.push({ kind: 'widget', ...widgetNames(s, item), slot });
  list(outline.logging?.groups).forEach((g, i) => {
    if (!isObject(g)) return;
    if (list(g.tags).some((x) => isObject(x) && x.tagId === tagId))
      out.push({
        kind: 'logging',
        group: i,
        groupId: String(g.id),
        groupName: str(g.name, String(g.id)),
      });
  });
  for (const r of tagRows(outline))
    if (r.expression && tokens(r.expression).some((tk) => tk.kind === 'tag' && tk.text === tagId))
      out.push({ kind: 'expression', tag: r.id, row: r.row });
  for (const w of outline.watchTables ?? []) {
    const rows = list(w.doc?.rows);
    rows.forEach((r, row) => {
      if (isObject(r) && r.tag === tagId)
        out.push({
          kind: 'watch',
          table: w.id,
          tableName: str(w.doc?.name, w.id),
          row,
        });
    });
  }
  return out;
}

/** Một dòng của "Dùng ở đâu": "Bồn nước + bơm › Mức nước (Mức chất lỏng)", "Lưu trữ › Vận hành". */
export function xrefText(e: XrefEntry): string {
  switch (e.kind) {
    case 'binding':
      return t('xref.binding', {
        screen: e.screenName,
        element: e.elementName,
        target: targetLabel(e.target),
      });
    case 'logging':
      return t('xref.logging', { group: e.groupName });
    case 'expression':
      return t('xref.expression', { tag: e.tag });
    case 'watch':
      return t('xref.watch', { table: e.tableName, row: e.row + 1 });
    case 'tagTable':
      return t('xref.tagTable', { tag: e.tag });
    case 'widget':
      return t('xref.widget', { screen: e.screenName, item: e.itemName, slot: e.slot });
    case 'widgetTable':
      return t('xref.widgetTable', { screen: e.screenName, item: e.itemName });
  }
}

/** Editor mở khi nhấp một dòng (cùng kiểu chỗ tới với ánh xạ lỗi). */
export function xrefLocation(e: XrefEntry): Location {
  switch (e.kind) {
    case 'binding':
      return { editor: 'screen', screen: e.screen, element: e.element };
    case 'logging':
      return { editor: 'logging', group: e.group };
    case 'expression':
      return { editor: 'calc', tag: e.tag };
    case 'watch':
      return { editor: 'watch', id: e.table, row: e.row };
    case 'tagTable':
      return { editor: 'tags', row: e.row, column: 'valueTable' };
    case 'widget':
    case 'widgetTable':
      return { editor: 'screen', screen: e.screen, item: e.item };
  }
}
