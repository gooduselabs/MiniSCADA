// Định dạng ghi của Studio 0.3 (contracts/project-format-0.3.md §11, FR-070): tệp màn hình thụt 2 dấu cách ở cấp
// màn hình, mỗi item một khối JSON gọn trên một dòng (như mỗi Tag một dòng của 0.2); khóa theo thứ tự chuẩn;
// không ghi trường bằng mặc định (danh mục, `locked`, `hidden`, `fit`, `fitMode`, `kind`). Cùng đầu vào cho cùng
// byte, UTF-8 không BOM, kết thúc bằng một dòng trống.
import { catalogWidget, type PropSpec } from './catalog.ts';
import type { Navigation, NavigationItem, Project03, ScreenModel } from './types-03.ts';
import { setOwn } from './own.ts';

type Obj = Record<string, unknown>;

const WIDGET_KEYS = [
  'id',
  'name',
  'type',
  'widget',
  'x',
  'y',
  'width',
  'height',
  'locked',
  'hidden',
  'props',
  'tags',
  'events',
  'security',
  // định dạng 1.0 (feature 011): chú thích bản sao template, đứng cuối
  'tpl',
] as const;
const SVG_KEYS = [
  'id',
  'name',
  'type',
  'x',
  'y',
  'width',
  'height',
  'locked',
  'hidden',
  'svgFile',
  'bindingFile',
  'viewBox',
  'fit',
  'elements',
  // định dạng 1.1 (feature 013): vai trò tối thiểu
  'security',
  'tpl',
] as const;
const ACTION_KEYS = ['action', 'value', 'durationMs', 'screen', 'args'] as const;
const ELEMENT_KEYS = ['elementUid', 'name', 'kind'] as const;
const TPL_KEYS = ['inst', 'tid', 'rid', 'params'] as const;
/** Vai trò tối thiểu (định dạng 1.1, feature 013; `minRole` 0.3 là bí danh cũ của `operate`). */
const SECURITY_KEYS = ['view', 'operate', 'minRole'] as const;
/** Bố cục lưới (định dạng 1.1, feature 012): thứ tự khóa của hàng và ô. */
const ROW_KEYS = ['id', 'height', 'gap', 'cells'] as const;
const CELL_KEYS = ['id', 'span', 'offset', 'align', 'minHeight', 'item'] as const;
/** Thứ tự khóa của mục menu; `report` (định dạng 0.6, mục mở trang báo cáo) đứng sau `screen`. */
const NAV_ITEM_KEYS = ['label', 'screen', 'report', 'icon'] as const;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const pick = (o: Obj, keys: readonly string[]): Obj => {
  const out: Obj = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
};
/** Giữ đúng thứ tự `order`, các khóa còn lại (không có trong `order`) theo thứ tự gốc. */
const ordered = (o: Obj, order: readonly string[]): Obj => {
  const out = pick(o, order);
  for (const k of Object.keys(o))
    if (!Object.hasOwn(out, k) && o[k] !== undefined) setOwn(out, k, o[k]);
  return out;
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Giá trị thuộc tính ở dạng chuẩn: đối tượng con (vùng màu) theo thứ tự `fields` của danh mục. */
function canonProp(spec: PropSpec | undefined, v: unknown): unknown {
  if (!spec) return v;
  if (spec.kind === 'object' && isObj(v))
    return ordered(
      v,
      (spec.fields ?? []).map((f) => f.name),
    );
  if (spec.kind === 'array' && Array.isArray(v)) {
    const item = spec.items as PropSpec | undefined;
    return v.map((x) => canonProp(item, x));
  }
  return v;
}

/** `props` ở dạng chuẩn: bỏ giá trị bằng mặc định của danh mục, sắp theo thứ tự thuộc tính của danh mục. */
function canonProps(widget: string, props: Obj): Obj {
  const spec = catalogWidget(widget);
  const byName = new Map((spec?.props ?? []).map((p) => [p.name, p]));
  const out: Obj = {};
  for (const p of spec?.props ?? []) {
    if (props[p.name] === undefined) continue;
    const v = canonProp(p, props[p.name]);
    if (p.default !== undefined && same(v, p.default)) continue;
    out[p.name] = v;
  }
  for (const [k, v] of Object.entries(props))
    if (!byName.has(k) && v !== undefined) setOwn(out, k, v); // khóa lạ: giữ (luật sẽ báo)
  return out;
}

/** Item ở dạng chuẩn (theo contract §11). */
export function canonicalItem(item: Obj): Obj {
  if (item.type === 'svg') {
    const out = pick(item, SVG_KEYS);
    if (out.locked === false) delete out.locked;
    if (out.hidden === false) delete out.hidden;
    if (out.fit === 'contain') delete out.fit;
    if (Array.isArray(out.elements))
      out.elements = (out.elements as Obj[]).map((e) => pick(e, ELEMENT_KEYS));
    canonSecurity(out, 'operator');
    return out;
  }
  const out = pick(item, WIDGET_KEYS);
  if (out.locked === false) delete out.locked;
  if (out.hidden === false) delete out.hidden;
  const spec = catalogWidget(String(item.widget));
  if (isObj(out.props)) {
    const p = canonProps(String(item.widget), out.props);
    if (Object.keys(p).length > 0) out.props = p;
    else delete out.props;
  }
  if (isObj(out.tags)) {
    const names = (spec?.slots ?? []).map((s) => s.name);
    const t = ordered(out.tags, names);
    if (Object.keys(t).length > 0) out.tags = t;
    else delete out.tags;
  }
  if (isObj(out.events)) {
    const click = out.events.click;
    if (isObj(click)) out.events = { click: ordered(click, ACTION_KEYS) };
    else if (Object.keys(out.events).length === 0) delete out.events;
  }
  if (isObj(out.tpl)) out.tpl = ordered(out.tpl, TPL_KEYS);
  canonSecurity(out, spec?.security?.default);
  return out;
}

/**
 * `security` của item ở dạng chuẩn: khóa theo SECURITY_KEYS; bỏ `view: viewer`, `minRole` bằng mặc định danh mục và
 * `operate` bằng mặc định khi không có `minRole`; rỗng thì bỏ cả khối.
 */
function canonSecurity(out: Obj, defaultOperate: string | undefined): void {
  if (!isObj(out.security)) return;
  const sec = pick(out.security, SECURITY_KEYS);
  if (sec.view === 'viewer') delete sec.view;
  if (sec.minRole === defaultOperate) delete sec.minRole;
  if (sec.operate === defaultOperate && sec.minRole === undefined) delete sec.operate;
  if (Object.keys(sec).length > 0) out.security = sec;
  else delete out.security;
}

/** Tệp màn hình `screens/<id>.screen.json` ở dạng chuẩn. */
export function formatScreen03(screen: ScreenModel): string {
  const s = screen as unknown as Obj;
  const head: string[] = [
    `  "schemaVersion": ${JSON.stringify(s.schemaVersion)}`,
    `  "id": ${JSON.stringify(s.id)}`,
    `  "name": ${JSON.stringify(s.name)}`,
  ];
  if (s.kind !== undefined && s.kind !== 'screen') head.push(`  "kind": ${JSON.stringify(s.kind)}`);
  head.push(`  "size": ${JSON.stringify(pick(s.size as Obj, ['width', 'height']))}`);
  if (s.fitMode !== undefined && s.fitMode !== 'contain')
    head.push(`  "fitMode": ${JSON.stringify(s.fitMode)}`);
  if (s.background !== undefined) head.push(`  "background": ${JSON.stringify(s.background)}`);
  // bố cục lưới (định dạng 1.1): khóa cấp layout mỗi khóa một dòng, mỗi hàng một dòng gọn
  if (isObj(s.layout)) {
    const l = s.layout;
    const lines: string[] = [];
    for (const k of ['mode', 'columns', 'gap', 'padding'] as const)
      if (l[k] !== undefined) lines.push(`    ${JSON.stringify(k)}: ${JSON.stringify(l[k])}`);
    const rows = (Array.isArray(l.rows) ? (l.rows as Obj[]) : []).map((r) => {
      const row = pick(r, ROW_KEYS);
      if (Array.isArray(row.cells))
        row.cells = (row.cells as Obj[]).map((c) => {
          const cell = pick(c, CELL_KEYS);
          if (cell.offset === 0) delete cell.offset;
          if (cell.align === 'stretch') delete cell.align;
          return cell;
        });
      return '      ' + JSON.stringify(row);
    });
    lines.push(rows.length > 0 ? `    "rows": [\n${rows.join(',\n')}\n    ]` : '    "rows": []');
    head.push(`  "layout": {\n${lines.join(',\n')}\n  }`);
  }
  // vai trò tối thiểu để xem màn hình (định dạng 1.1, feature 013); `viewer` là mặc định, không ghi
  if (isObj(s.security)) {
    const sec = pick(s.security, ['view']);
    if (sec.view === 'viewer') delete sec.view;
    if (Object.keys(sec).length > 0) head.push(`  "security": ${JSON.stringify(sec)}`);
  }
  // faceplate (định dạng 1.0): tham số của popup, mỗi tham số một dòng gọn
  if (Array.isArray(s.params)) {
    const ps = (s.params as Obj[]).map(
      (p) => '    ' + JSON.stringify(pick(p, ['name', 'kind', 'default'])),
    );
    head.push(ps.length > 0 ? `  "params": [\n${ps.join(',\n')}\n  ]` : '  "params": []');
  }
  const items = (s.items as Obj[]).map((i) => '    ' + JSON.stringify(canonicalItem(i)));
  head.push(items.length > 0 ? `  "items": [\n${items.join(',\n')}\n  ]` : '  "items": []');
  return `{\n${head.join(',\n')}\n}\n`;
}

const navItem = (it: NavigationItem): Obj => {
  const out = pick(it as unknown as Obj, NAV_ITEM_KEYS);
  if (it.items !== undefined) out.items = it.items.map(navItem);
  return out;
};

/** Khối `navigation` của project.json: vị trí, mỗi mục menu một dòng gọn. */
function formatNavigation(nav: Navigation): string {
  const lines: string[] = [];
  if (nav.position !== undefined) lines.push(`    "position": ${JSON.stringify(nav.position)}`);
  const items = nav.items.map((i) => '      ' + JSON.stringify(navItem(i)));
  lines.push(items.length > 0 ? `    "items": [\n${items.join(',\n')}\n    ]` : '    "items": []');
  return `{\n${lines.join(',\n')}\n  }`;
}

/**
 * `project.json` 0.3: thụt 2 dấu cách, giữ thứ tự khóa của đầu vào; `navigation` (nếu có) luôn đứng
 * ngay trước `maxClients`, mỗi mục menu một dòng. Không bỏ giá trị mặc định ở project.json.
 */
export function formatProject03(project: Project03): string {
  const p = project as unknown as Obj;
  const keys = Object.keys(p).filter((k) => p[k] !== undefined);
  const out: string[] = [];
  const emit = (k: string) => {
    const v =
      k === 'navigation'
        ? formatNavigation(p[k] as Navigation)
        : JSON.stringify(p[k], null, 2).replace(/\n/g, '\n  ');
    out.push(`  ${JSON.stringify(k)}: ${v}`);
  };
  // `navigation` do migrate thêm vào cuối đối tượng: đưa lên trước `maxClients`
  const order = keys.filter((k) => k !== 'navigation');
  const at = order.indexOf('maxClients');
  if (p.navigation !== undefined) order.splice(at >= 0 ? at : order.length, 0, 'navigation');
  for (const k of order) emit(k);
  return `{\n${out.join(',\n')}\n}\n`;
}
