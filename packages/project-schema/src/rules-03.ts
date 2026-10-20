// Luật liên file của bộ kiểm tra 0.3 (contracts/project-format-0.3.md §7, widget-catalog.md §3-§4).
// Bản C++ (core/project-manager/rules_03) cài CÙNG luật; vector chung ở tests/project-vectors (ca `v03-*`) và
// tests/widget-catalog-vectors. Luật của Tag, kết nối, bảng giá trị, logging dùng lại nguyên từ rules-02.
// Mọi luật về loại widget, khe, thuộc tính, sự kiện, vai trò đều lấy từ danh mục (schemas/widgets.catalog.json),
// không có tên loại widget nào được viết cứng ở đây.
//
// Quy ước `path` (JSON Pointer tới khóa sai trong file màn hình): xem contracts/project-format-0.3.md §7.3.
import {
  MAX_SCREEN_TAGS,
  SUPPORTED_SCHEMA_11,
  WARN_SCREEN_TAGS,
  type ErrorCode,
  type Issue,
  type WarningCode,
} from './codes.ts';
import {
  ACTION_NAMES,
  catalogWidget,
  checkPropValue,
  tagClassOf,
  type PropSpec,
  type SlotSpec,
  type TagClass,
  type WidgetSpec,
} from './catalog.ts';
import { bindingRules, INTEGER_TYPES, runRules02, TYPE_RANGE, utf8Length } from './rules-02.ts';
import type { Rule02Input } from './rules-02.ts';
import type { SerialPolicy } from './serial-allow.ts';
import { isNumericTag } from './rules.ts';
import type { ReportsConfig } from './reports.ts';
import { historyWidgetRules, reportRules } from './rules-010.ts';
import type { LoggingConfig } from './types.ts';
import type {
  ConnectionsConfig,
  TagListV1,
  TagV1,
  ValueTableDoc,
  WatchTableDoc,
} from './types-02.ts';
import type {
  BindingSet03,
  Navigation,
  NavigationItem,
  Project03,
  ScreenModel,
  SvgItem,
  WidgetItem,
} from './types-03.ts';
import type { BindingSet04 } from './types-04.ts';
import type { BindingCtx } from './rules-02.ts';

/** Giới hạn của FR-010 (data-model §16). */
export const LIMITS_03 = {
  screens: 32,
  items: 250,
  svgItems: 8,
  charts: 16,
  navLeaves: 32,
  screenTags: MAX_SCREEN_TAGS,
} as const;

const ITEM_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
/** Định dạng 1.0: id item sinh từ template `<inst>.<rid>` (contracts/project-format-1.0.md §4), có hay không có `tpl`. */
export const INST_ITEM_ID_RE = /^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9_]{1,31}$/;
const KINDS = ['screen', 'popup'];
const WIDTH_RANGE = [64, 4096] as const;
const HEIGHT_RANGE = [64, 2304] as const;
const DURATION_RANGE = [100, 10000] as const;
/** Hành động dùng khe `target` (widget-catalog.md §3). */
const ACTION_USES_TARGET: ReadonlySet<string> = new Set(['write', 'toggle', 'pulse']);
/** Khóa cho phép của từng hành động (ngoài `action`) và khóa bắt buộc. */
const ACTION_KEYS: Readonly<Record<string, { all: string[]; required: string[] }>> = {
  write: { all: ['value'], required: ['value'] },
  toggle: { all: [], required: [] },
  pulse: { all: ['value', 'durationMs'], required: ['value', 'durationMs'] },
  navigate: { all: ['screen'], required: ['screen'] },
  popup: { all: ['screen'], required: ['screen'] },
  closePopup: { all: [], required: [] },
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Item nằm hoàn toàn ngoài khung màn hình (chạm cạnh cũng là ngoài). */
export function isOutside(r: Rect, size: { width: number; height: number }): boolean {
  return r.x + r.width <= 0 || r.y + r.height <= 0 || r.x >= size.width || r.y >= size.height;
}

/** `a` che hoàn toàn `b` (b nằm trong a, kể cả bằng nhau). */
export function itemCovers(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height
  );
}

/**
 * Mọi id Tag mà màn hình tham chiếu: khe của widget, binding của item `svg` và (0.4) Tag của sự kiện `click` ghi
 * (write, toggle, pulse); bỏ item `hidden`.
 */
export function screenTagIds(
  screen: ScreenModel,
  bindingsOf: (item: SvgItem, index: number) => BindingSet03 | BindingSet04 | undefined,
): Set<string> {
  const out = new Set<string>();
  screen.items.forEach((item, i) => {
    if (item.hidden === true) return;
    if (item.type === 'widget') {
      // widget lịch sử không đăng ký live (danh mục 0.5.0): không tính vào giới hạn Tag của màn hình
      if (catalogWidget(item.widget)?.group === 'history') return;
      for (const v of Object.values(item.tags ?? {}))
        for (const id of Array.isArray(v) ? v : [v]) if (typeof id === 'string') out.add(id);
    } else {
      for (const e of bindingsOf(item, i)?.elements ?? []) {
        for (const b of e.bindings ?? []) out.add(b.source.tagId);
        const click = (e as BindingSet04['elements'][number]).events?.click as
          { tag?: unknown } | undefined;
        if (typeof click?.tag === 'string') out.add(click.tag);
      }
    }
  });
  return out;
}

/** Id các màn hình mà nút không ẩn của màn hình này mở bằng hành động `popup` (không trùng, theo thứ tự). */
export function popupTargets(screen: ScreenModel): string[] {
  const out: string[] = [];
  for (const item of screen.items) {
    if (item.type !== 'widget' || item.hidden === true) continue;
    const c = item.events?.click as { action?: unknown; screen?: unknown } | undefined;
    if (c?.action === 'popup' && typeof c.screen === 'string' && !out.includes(c.screen))
      out.push(c.screen);
  }
  return out;
}

export interface Rule03Screen {
  file: string;
  screen: ScreenModel;
  /** Theo chỉ số item: dữ liệu của item `svg` (binding đã nạp và qua schema, nội dung SVG). */
  svg: Array<{ bindings?: BindingSet03 | BindingSet04; svgText: string | null } | undefined>;
}

/**
 * Điểm mở rộng cho định dạng 0.4 (feature 008; rules-04.ts): cùng bộ luật màn hình của 0.3 (phiên bản, kích thước,
 * item, widget, popup, Tag của màn hình) nhưng trần item `svg` riêng, luật binding và luật sự kiện của 0.4 thay cho
 * luật binding của 0.2/0.3, và luật theo màn hình (hoạt ảnh).
 */
export interface Rule03Ext {
  /** Trần item `svg` mỗi màn hình (0.3: 8, 0.4: 64). */
  svgItems: number;
  /** Luật của một file binding (thay `bindingRules` của 0.2/0.3). `add`, `warn` ghi vào file binding. */
  bindingRules(
    b: BindingSet04,
    bfile: string,
    uids: ReadonlySet<string>,
    ctx: BindingCtx & {
      tagInfo: ReadonlyMap<string, TagV1>;
      screens: readonly string[];
      /** Định dạng 1.0: hành động popup của sự kiện có thêm `args`. */
      format10?: boolean;
    },
    add: (code: ErrorCode, file: string, path: string, message: string) => void,
    warn: (code: WarningCode, file: string, path: string, message: string) => void,
    kindOf: (screenId: string) => string | undefined,
  ): void;
  /** Luật theo màn hình sau khi kiểm các item (đếm hoạt ảnh vô hạn). */
  screenRules(
    s: Rule03Screen,
    add: (code: ErrorCode, path: string, message: string) => void,
    warn: (code: WarningCode, path: string, message: string) => void,
  ): void;
}

export interface Rule03Input {
  project: Project03;
  tags?: TagListV1;
  connections?: ConnectionsConfig;
  valueTables: Record<string, { file: string; doc: ValueTableDoc }>;
  watchTables: Record<string, { file: string; doc: WatchTableDoc }>;
  screens: Record<string, Rule03Screen>;
  checkSvg: boolean;
  logging?: LoggingConfig;
  runtimeVersion: string;
  serialPolicy?: SerialPolicy;
  /** Định dạng đang kiểm: `0.3` (mặc định), `0.4` (008), `0.5` (009) hoặc `0.6` (010); luật màn hình như nhau. */
  schema?: '0.3' | '0.4' | '0.5' | '0.6' | '1.0';
  /**
   * Định dạng 1.0 (rules-10.ts): id các popup có `params`. Ở những màn hình này, giá trị khe Tag và thuộc tính có `{`/`}`
   * không được kiểm như Tag/giá trị thường (bản thay của từng tổ hợp `args` được kiểm qua `expansions`).
   */
  paramScreens?: ReadonlySet<string>;
  /**
   * Định dạng 1.0: bản đã thay tham số của một popup (một tổ hợp `args`). Chỉ các item `items` (widget) được kiểm như
   * item thường; lỗi và cảnh báo ghi vào `errors`, `warnings` của chính mục này (rules-10 đổi mã và bỏ trùng).
   */
  expansions?: ReadonlyArray<Rule03Expansion>;
  /**
   * Feature 009: id khu vực và lớp alarm của project (0.5). Có thì `areas`/`classes` của widget alarm tham chiếu id không có ở đây
   * bị cảnh báo `W_WIDGET_ALARM_REF`; vắng (0.3, 0.4) thì không kiểm.
   */
  alarmAreas?: ReadonlySet<string>;
  alarmClasses?: ReadonlySet<string>;
  /** Có: kiểm project 0.4 trở lên (rules-04.ts, feature 008). Không có: project 0.3. */
  ext?: Rule03Ext;
  /** reports.json đã nạp và qua schema (định dạng 0.6). */
  reports?: ReportsConfig;
}

export interface Rule03Expansion {
  key: string;
  file: string;
  screen: ScreenModel;
  items: readonly number[];
  errors: Issue[];
  warnings: Issue[];
}

/** Có chuỗi nào (sâu) chứa `{` hoặc `}`: giá trị có `{tham số}` của popup có `params`. */
const hasParamText = (v: unknown): boolean =>
  typeof v === 'string'
    ? v.includes('{') || v.includes('}')
    : Array.isArray(v)
      ? v.some(hasParamText)
      : v !== null && typeof v === 'object' && Object.values(v).some(hasParamText);

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const writable = (t: TagV1): boolean =>
  t.access === 'RW' &&
  t.kind !== 'calculated' &&
  (t.kind !== 'simulation' || t.sim?.kind === 'manual');

export function runRules03(input: Rule03Input): { errors: Issue[]; warnings: Issue[] } {
  // Tag, kết nối, bảng giá trị, logging, project.json: luật của 0.2 với bộ phiên bản 0.3
  const ext = input.ext;
  const svgItemLimit = ext?.svgItems ?? LIMITS_03.svgItems;
  const base = runRules02({
    ...input,
    screens: {},
    schema: input.schema ?? (ext ? '0.4' : '0.3'),
  } as Rule02Input);
  const errors: Issue[] = [...base.errors];
  const warnings: Issue[] = [...base.warnings];
  const { project, tags, screens } = input;
  const tableSet = new Set(project.valueTables ?? []);

  const tagInfo = new Map<string, TagV1>();
  for (const t of tags?.tags ?? []) if (!tagInfo.has(t.id)) tagInfo.set(t.id, t);
  const tagType = new Map([...tagInfo].map(([k, t]) => [k, t.type]));
  const tagTable = new Map([...tagInfo].map(([k, t]) => [k, t.valueTable]));

  const kindOf = (id: string): string | undefined => {
    const s = screens[id];
    return s === undefined ? undefined : (s.screen.kind ?? 'screen');
  };

  // ---- project.json ----
  if (project.screens.length > LIMITS_03.screens)
    errors.push({
      code: 'E_LIMIT',
      file: 'project.json',
      path: '/screens',
      message: `more than ${LIMITS_03.screens} screens`,
    });
  const entryKind = kindOf(project.entryScreen);
  if (entryKind === 'popup')
    errors.push({
      code: 'E_SCREEN_KIND',
      file: 'project.json',
      path: '/entryScreen',
      message: 'entryScreen must be a screen, not a popup',
    });
  if (project.navigation) navigationRules(project.navigation);
  // Mẫu báo cáo (feature 010): E_RPT_*; luật cần logging.json hoặc tags.json bị bỏ qua khi file đó lỗi
  if (input.reports && project.reportsFile)
    errors.push(
      ...reportRules(
        input.reports,
        project.reportsFile,
        input.logging,
        project.loggingFile !== undefined,
        tags ? tagType : undefined,
        SUPPORTED_SCHEMA_11.test(String(project.schemaVersion)),
      ),
    );

  function navigationRules(nav: Navigation): void {
    const add = (code: ErrorCode, path: string, message: string) =>
      errors.push({ code, file: 'project.json', path, message });
    let leaves = 0;
    const leaf = (it: NavigationItem, path: string) => {
      leaves++;
      if (it.report !== undefined) {
        // feature 010: mục báo cáo; reports.json lỗi thì bỏ qua (luật cần file đó)
        const missing =
          project.reportsFile === undefined ||
          (input.reports !== undefined && !input.reports.reports.some((r) => r.id === it.report));
        if (missing) add('E_NAV_REPORT', `${path}/report`, `report '${it.report}' does not exist`);
        return;
      }
      const target = it.screen;
      if (target === undefined) return add('E_NAV', path, 'a menu entry needs a screen or items');
      if (!project.screens.includes(target))
        return add('E_NAV', `${path}/screen`, `screen '${target}' does not exist`);
      if (kindOf(target) === 'popup')
        add('E_NAV', `${path}/screen`, `screen '${target}' is a popup`);
    };
    nav.items.forEach((it, i) => {
      const p = `/navigation/items/${i}`;
      if (it.items === undefined) return leaf(it, p);
      if (it.screen !== undefined) add('E_NAV', p, 'a group has no screen');
      if (it.items.length === 0) add('E_NAV', p, 'a group needs at least one entry');
      it.items.forEach((c, j) => {
        const cp = `${p}/items/${j}`;
        if (c.items !== undefined) add('E_NAV', cp, 'a group cannot contain a group');
        else leaf(c, cp);
      });
    });
    if (leaves > LIMITS_03.navLeaves)
      add('E_LIMIT', '/navigation/items', `more than ${LIMITS_03.navLeaves} menu entries`);
  }

  // ---- Màn hình ----
  const sharedBinding = new Map<string, string>();
  const tagSets = new Map<string, Set<string>>();
  const format10 = input.schema === '1.0';
  const actionKeys = (name: string) =>
    format10 && name === 'popup'
      ? { all: ['screen', 'args'], required: ['screen'] }
      : ACTION_KEYS[name]!;
  for (const [id, s] of Object.entries(screens)) {
    screenRules(id, s);
    tagSets.set(
      id,
      screenTagIds(s.screen, (_, i) => s.svg[i]?.bindings),
    );
  }

  // E_SCREEN_TAGS theo từng cặp màn hình-popup, W_SCREEN_TAGS_MANY theo màn hình
  for (const [id, s] of Object.entries(screens)) {
    const own = tagSets.get(id)!;
    let over = own.size > LIMITS_03.screenTags;
    if (!over)
      for (const p of popupTargets(s.screen)) {
        const ps = tagSets.get(p);
        if (ps === undefined || kindOf(p) !== 'popup') continue;
        const union = new Set([...own, ...ps]);
        if (union.size > LIMITS_03.screenTags) {
          over = true;
          break;
        }
      }
    if (over)
      errors.push({
        code: 'E_SCREEN_TAGS',
        file: s.file,
        path: '/items',
        message: `screen '${id}' references more than ${LIMITS_03.screenTags} tags (with the popups it opens)`,
      });
    if (own.size > WARN_SCREEN_TAGS)
      warnings.push({
        code: 'W_SCREEN_TAGS_MANY',
        file: s.file,
        path: '/items',
        message: `screen '${id}' references ${own.size} tags`,
      });
  }

  for (const x of input.expansions ?? [])
    screenRules(x.key, { file: x.file, screen: x.screen, svg: [] }, x);

  return { errors, warnings };

  function screenRules(key: string, s: Rule03Screen, only?: Rule03Expansion): void {
    const { screen, file } = s;
    const errSink = only ? only.errors : errors;
    const warnSink = only ? only.warnings : warnings;
    const add = (code: ErrorCode, path: string, message: string, f = file) =>
      errSink.push({ code, file: f, path, message });
    const warn = (code: WarningCode, path: string, message: string, f = file) =>
      warnSink.push({ code, file: f, path, message });
    // popup có tham số (1.0): chuỗi có {tham số} được kiểm ở bản đã thay
    const paramText = (v: unknown) => input.paramScreens?.has(key) === true && hasParamText(v);
    if (only) {
      for (const i of only.items) {
        const item = screen.items[i];
        if (item?.type === 'widget') widgetItem(item, i);
      }
      return;
    }

    // phiên bản (khớp project.json)
    if (screen.schemaVersion !== project.schemaVersion)
      add(
        'E_SCHEMA_VERSION',
        '/schemaVersion',
        `schemaVersion ${screen.schemaVersion} differs from project.json (${project.schemaVersion}): every file must match`,
      );
    if (screen.id !== key)
      add('E_SCREEN_ID', '/id', `id '${screen.id}' differs from the file name '${key}'`);
    const kind = screen.kind ?? 'screen';
    if (!KINDS.includes(kind))
      add('E_SCREEN_KIND', '/kind', `kind must be screen or popup, not '${String(kind)}'`);
    const sz = screen.size;
    const badDim = (v: number, [lo, hi]: readonly [number, number]) =>
      !Number.isInteger(v) || v < lo || v > hi;
    if (badDim(sz.width, WIDTH_RANGE))
      add('E_SCREEN_SIZE', '/size/width', `width must be ${WIDTH_RANGE[0]}-${WIDTH_RANGE[1]}`);
    if (badDim(sz.height, HEIGHT_RANGE))
      add('E_SCREEN_SIZE', '/size/height', `height must be ${HEIGHT_RANGE[0]}-${HEIGHT_RANGE[1]}`);

    const items = screen.items;
    if (items.length > LIMITS_03.items)
      add('E_LIMIT', '/items', `more than ${LIMITS_03.items} items`);
    if (items.filter((i) => i.type === 'svg').length > svgItemLimit)
      add('E_LIMIT', '/items', `more than ${svgItemLimit} svg items`);
    const charts = items.filter(
      (i) => i.type === 'widget' && catalogWidget(i.widget)?.group === 'chart',
    ).length;
    if (charts > LIMITS_03.charts) add('E_LIMIT', '/items', `more than ${LIMITS_03.charts} charts`);
    if (items.length === 0) warn('W_SCREEN_EMPTY', '', 'the screen has no item');
    if (screen.fitMode === 'stretch' && items.some((i) => i.type === 'widget'))
      warn('W_STRETCH_WIDGETS', '/fitMode', 'stretch distorts widgets');

    const ids = new Set<string>();
    items.forEach((item, i) => {
      const p = `/items/${i}`;
      if (!ITEM_ID_RE.test(item.id) && !(format10 && INST_ITEM_ID_RE.test(item.id)))
        add('E_ITEM_ID', `${p}/id`, `item id '${item.id}' is invalid`);
      else if (ids.has(item.id)) add('E_ITEM_ID', `${p}/id`, `item id '${item.id}' is duplicated`);
      ids.add(item.id);
      if (isOutside(item, sz)) warn('W_ITEM_OUTSIDE', p, 'the item lies outside the screen');
      if (item.type === 'svg') svgItem(item, i);
      else widgetItem(item, i);
    });

    ext?.screenRules(s, add, warn);

    // widget bị item phía trên che hoàn toàn
    items.forEach((item, i) => {
      if (item.type !== 'widget' || item.hidden === true) return;
      for (let j = i + 1; j < items.length; j++) {
        const o = items[j]!;
        if (o.hidden !== true && itemCovers(o, item)) {
          warn('W_ITEM_COVERED', `/items/${i}`, `covered by item '${o.id}'`);
          break;
        }
      }
    });

    // ---------- item svg ----------
    function svgItem(item: SvgItem, i: number): void {
      const p = `/items/${i}`;
      if (item.width <= 0) add('E_ITEM_SIZE', `${p}/width`, 'width must be > 0');
      if (item.height <= 0) add('E_ITEM_SIZE', `${p}/height`, 'height must be > 0');
      const uids = new Set<string>();
      item.elements.forEach((e, j) => {
        if (uids.has(e.elementUid))
          add(
            'E_DUP_UID',
            `${p}/elements/${j}/elementUid`,
            `elementUid '${e.elementUid}' is duplicated`,
          );
        uids.add(e.elementUid);
      });
      const data = s.svg[i];
      if (input.checkSvg && data && data.svgText !== null) {
        const declared = new Set<string>();
        try {
          const doc = new DOMParser().parseFromString(data.svgText, 'image/svg+xml');
          doc
            .querySelectorAll('[data-mat-uid]')
            .forEach((el) => declared.add(el.getAttribute('data-mat-uid')!));
        } catch {
          /* SVG hỏng: trình hiển thị sẽ báo */
        }
        item.elements.forEach((e, j) => {
          if (!declared.has(e.elementUid))
            warn(
              'W_UID_NOT_IN_SVG',
              `${p}/elements/${j}/elementUid`,
              `SVG '${item.svgFile}' has no data-mat-uid="${e.elementUid}"`,
            );
        });
      }
      // hai item dùng chung một file binding
      const owner = sharedBinding.get(item.bindingFile);
      if (owner !== undefined)
        add(
          'E_SCHEMA',
          `${p}/bindingFile`,
          `binding file '${item.bindingFile}' is used by ${owner} too`,
        );
      else sharedBinding.set(item.bindingFile, `${key}:${item.id}`);

      const b = data?.bindings;
      if (!b) return;
      const bfile = item.bindingFile;
      if (b.screenId !== screen.id)
        add(
          'E_SCREEN_ID',
          '/screenId',
          `screenId '${b.screenId}' differs from screen '${screen.id}'`,
          bfile,
        );
      if (b.itemId !== undefined && b.itemId !== item.id)
        add(
          'E_SCHEMA',
          '/itemId',
          `itemId '${b.itemId}' differs from the svg item '${item.id}'`,
          bfile,
        );
      if (b.schemaVersion !== project.schemaVersion)
        add(
          'E_SCHEMA_VERSION',
          '/schemaVersion',
          `schemaVersion ${b.schemaVersion} differs from project.json (${project.schemaVersion}): every file must match`,
          bfile,
        );
      const addB = (code: ErrorCode, f: string, path: string, message: string) =>
        errors.push({ code, file: f, path, message });
      const ctx = { hasTags: tags !== undefined, tagType, tagTable, tableSet };
      if (ext)
        ext.bindingRules(
          b as BindingSet04,
          bfile,
          uids,
          { ...ctx, tagInfo, screens: project.screens, ...(format10 ? { format10 } : {}) },
          addB,
          (code, f, path, message) => warnings.push({ code, file: f, path, message }),
          kindOf,
        );
      else bindingRules(b as BindingSet03, bfile, uids, ctx, addB);
    }

    // ---------- item widget ----------
    function widgetItem(item: WidgetItem, i: number): void {
      const p = `/items/${i}`;
      const spec = catalogWidget(item.widget);
      if (!spec) {
        add('E_WIDGET_UNKNOWN', `${p}/widget`, `widget '${item.widget}' is not in the catalog`);
        if (item.width <= 0) add('E_ITEM_SIZE', `${p}/width`, 'width must be > 0');
        if (item.height <= 0) add('E_ITEM_SIZE', `${p}/height`, 'height must be > 0');
        return;
      }
      if (item.width <= 0 || item.width < spec.minSize[0])
        add('E_ITEM_SIZE', `${p}/width`, `width must be >= ${spec.minSize[0]} for ${spec.id}`);
      if (item.height <= 0 || item.height < spec.minSize[1])
        add('E_ITEM_SIZE', `${p}/height`, `height must be >= ${spec.minSize[1]} for ${spec.id}`);

      const props = isObj(item.props) ? item.props : {};
      const tagsObj = isObj(item.tags) ? item.tags : {};

      // security
      if (item.security !== undefined) {
        // định dạng 1.1 (feature 013): `view`, `operate` được ở mọi widget (luật E_SECURITY_* ở rules-11); `security`
        // rỗng hoặc có `minRole` ở widget không có thuộc tính bảo mật vẫn là E_WIDGET_PROP như trước
        const secKeys = Object.keys(item.security);
        const onlyAccess =
          secKeys.length > 0 && secKeys.every((k) => k === 'view' || k === 'operate');
        if (!spec.security && !onlyAccess)
          add('E_WIDGET_PROP', `${p}/security`, `${spec.id} has no security properties`);
        else if (
          spec.security &&
          item.security.minRole !== undefined &&
          !spec.security.minRole.includes(item.security.minRole)
        )
          add(
            'E_WIDGET_MINROLE',
            `${p}/security/minRole`,
            `minRole must be one of ${spec.security.minRole.join(', ')}`,
          );
      }

      // sự kiện, hành động
      const clickSpec = spec.events.find((e) => e.name === 'click');
      let action: string | undefined;
      if (item.events !== undefined) {
        if (!clickSpec) add('E_WIDGET_PROP', `${p}/events`, `${spec.id} has no events`);
        else if (item.events.click !== undefined)
          action = checkAction(item, i, spec, clickSpec.actions);
      }

      // khe Tag
      const targetTag = checkSlots(item, i, spec, tagsObj, action);

      // thuộc tính
      checkProps(spec, p, props, tagsObj, targetTag);
      if (spec.group === 'alarm') checkAlarmWidget(spec, p, props);
      if (spec.group === 'history')
        historyWidgetRules(
          spec.id,
          p,
          spec.slots,
          props,
          tagsObj,
          { logging: input.logging, hasLoggingFile: project.loggingFile !== undefined },
          (id) => {
            const t = tagInfo.get(id);
            return t ? tagClassOf(t.type) : undefined;
          },
          add,
        );

      // xác nhận (chỉ widget có thuộc tính `confirm`)
      if (props.confirm === 'none' && spec.props.some((x) => x.name === 'confirm')) {
        warn('W_CONFIRM_NONE', `${p}/props/confirm`, 'confirm none skips the confirmation');
        if (targetTag && tagClassOf(targetTag.type) !== 'bool')
          add(
            'E_WIDGET_CONFIRM',
            `${p}/props/confirm`,
            'confirm none is only valid for a BOOL tag',
          );
      }
    }

    /**
     * Widget nhóm alarm (danh mục 0.4.0): `areas`, `classes` tham chiếu id không có trong project là cảnh báo (màn hình có thể dựng
     * trước khi định nghĩa alarm); `target` của `alarm-count` kiểu `screen` phải trỏ một màn hình `screen` (E_ACTION_TARGET).
     */
    function checkAlarmWidget(spec: WidgetSpec, p: string, props: Record<string, unknown>): void {
      const refs: Array<[string, ReadonlySet<string> | undefined, string]> = [
        ['areas', input.alarmAreas, 'area'],
        ['classes', input.alarmClasses, 'class'],
      ];
      for (const [name, known, what] of refs) {
        const v = props[name];
        if (!known || !Array.isArray(v) || !spec.props.some((x) => x.name === name)) continue;
        v.forEach((id, k) => {
          if (typeof id !== 'string' || id === '-' || known.has(id)) return;
          warn(
            'W_WIDGET_ALARM_REF',
            `${p}/props/${name}/${k}`,
            `${what} '${id}' is not defined in the project`,
          );
        });
      }
      const t = props.target;
      if (isObj(t) && t.kind === 'screen' && typeof t.screen === 'string') {
        if (!project.screens.includes(t.screen))
          add('E_ACTION_TARGET', `${p}/props/target/screen`, `screen '${t.screen}' does not exist`);
        else {
          const k = kindOf(t.screen);
          if (k !== undefined && k !== 'screen')
            add(
              'E_ACTION_TARGET',
              `${p}/props/target/screen`,
              `target needs a screen, '${t.screen}' is a ${k}`,
            );
        }
      }
    }

    /** Khe Tag của một widget. Trả Tag của khe ghi (`needsWrite`) nếu biết, để kiểm giới hạn và xác nhận. */
    function checkSlots(
      item: WidgetItem,
      i: number,
      spec: WidgetSpec,
      tagsObj: Record<string, unknown>,
      action: string | undefined,
    ): TagV1 | undefined {
      const p = `/items/${i}/tags`;
      let target: TagV1 | undefined;
      // widget có sự kiện: khe `target` chỉ dùng khi hành động là write, toggle hoặc pulse
      const hasEvents = spec.events.length > 0;
      const slotInUse = (slot: SlotSpec): boolean =>
        !hasEvents ||
        slot.name !== 'target' ||
        (action !== undefined && ACTION_USES_TARGET.has(action));
      const requiredByAction = (slot: SlotSpec): boolean =>
        hasEvents &&
        slot.name === 'target' &&
        action !== undefined &&
        ACTION_USES_TARGET.has(action);

      for (const slot of spec.slots)
        if ((slot.required || requiredByAction(slot)) && !(slot.name in tagsObj))
          add('E_WIDGET_SLOT', p, `slot '${slot.name}' is required`);

      for (const [name, value] of Object.entries(tagsObj)) {
        const slot = spec.slots.find((s2) => s2.name === name);
        if (!slot) {
          add('E_WIDGET_SLOT', `${p}/${name}`, `slot '${name}' does not exist for ${spec.id}`);
          continue;
        }
        const inUse = slotInUse(slot);
        if (!inUse && hasEvents && action !== undefined) {
          add('E_WIDGET_SLOT', `${p}/${name}`, `slot '${name}' is not used by action '${action}'`);
          continue;
        }
        if (!inUse && action === undefined && hasEvents) {
          // sự kiện không có hoặc hành động lạ: không dùng khe này
          if (item.events?.click === undefined)
            add('E_WIDGET_SLOT', `${p}/${name}`, `slot '${name}' needs a click action that writes`);
          continue;
        }
        const writeNeeded = slot.needsWrite;
        const toggleLike = action === 'toggle' || action === 'pulse';
        if (slot.multi) {
          if (!Array.isArray(value)) {
            add('E_WIDGET_SLOT', `${p}/${name}`, `slot '${name}' takes a list of tags`);
            continue;
          }
          if (value.length === 0) add('E_WIDGET_SLOT', `${p}/${name}`, `slot '${name}' is empty`);
          if (slot.max !== undefined && value.length > slot.max)
            add('E_LIMIT', `${p}/${name}`, `slot '${name}' takes at most ${slot.max} tags`);
          const seen = new Set<string>();
          value.forEach((id, k) => {
            if (typeof id !== 'string') return;
            if (seen.has(id))
              add('E_WIDGET_SLOT', `${p}/${name}/${k}`, `tag '${id}' is duplicated in '${name}'`);
            seen.add(id);
            tagRef(id, slot, `${p}/${name}/${k}`, writeNeeded, false);
          });
        } else {
          if (typeof value !== 'string') {
            add('E_WIDGET_SLOT', `${p}/${name}`, `slot '${name}' takes one tag`);
            continue;
          }
          const t = tagRef(value, slot, `${p}/${name}`, writeNeeded, toggleLike);
          if (slot.needsWrite) target = t;
        }
      }
      return target;
    }

    function tagRef(
      id: string,
      slot: SlotSpec,
      path: string,
      writeNeeded: boolean,
      boolOnly: boolean,
    ): TagV1 | undefined {
      if (!tags || paramText(id)) return undefined;
      const t = tagInfo.get(id);
      if (!t) {
        add('E_REF_TAG', path, `Tag '${id}' does not exist`);
        return undefined;
      }
      const cls: TagClass = tagClassOf(t.type);
      if (!slot.types.includes(cls))
        add('E_WIDGET_TAG_TYPE', path, `a ${cls} tag cannot be used for '${slot.name}'`);
      else if (boolOnly && cls !== 'bool')
        add('E_WIDGET_TAG_TYPE', path, `this action needs a BOOL tag, '${id}' is ${t.type}`);
      if (writeNeeded && !writable(t))
        add(
          'E_TAG_ACCESS',
          path,
          `tag '${id}' is not writable (needs a real RW tag, not calculated)`,
        );
      return t;
    }

    function checkProps(
      spec: WidgetSpec,
      p: string,
      props: Record<string, unknown>,
      tagsObj: Record<string, unknown>,
      target: TagV1 | undefined,
    ): void {
      const byName = new Map<string, PropSpec>(spec.props.map((x) => [x.name, x]));
      let labelsBad = false;
      for (const [name, value] of Object.entries(props)) {
        const ps = byName.get(name);
        if (!ps) {
          add(
            'E_WIDGET_PROP',
            `${p}/props/${name}`,
            `property '${name}' does not exist for ${spec.id}`,
          );
          continue;
        }
        if (paramText(value)) continue;
        const err = checkPropValue(ps, value);
        if (err && name === 'labels') labelsBad = true;
        if (err) add('E_WIDGET_PROP', `${p}/props/${name}`, `property '${name}': ${err}`);
        else if (ps.kind === 'tableRef' && typeof value === 'string' && !tableSet.has(value))
          add('E_REF_TABLE', `${p}/props/${name}`, `value table '${value}' does not exist`);
      }
      const num = (n: string): number | undefined =>
        typeof props[n] === 'number' ? (props[n] as number) : undefined;

      // yMin, yMax: cùng có hoặc cùng vắng, yMin < yMax
      if (byName.has('yMin') && byName.has('yMax')) {
        const hasMin = 'yMin' in props;
        const hasMax = 'yMax' in props;
        if (hasMin !== hasMax)
          add(
            'E_WIDGET_PROP',
            `${p}/props/${hasMin ? 'yMin' : 'yMax'}`,
            'yMin and yMax must be given together',
          );
        else if (
          num('yMin') !== undefined &&
          num('yMax') !== undefined &&
          num('yMin')! >= num('yMax')!
        )
          add('E_WIDGET_PROP', `${p}/props/yMax`, 'yMin must be less than yMax');
      }
      // min < max
      if (
        byName.has('min') &&
        byName.has('max') &&
        num('min') !== undefined &&
        num('max') !== undefined
      )
        if (num('min')! >= num('max')!)
          add('E_WIDGET_LIMITS', `${p}/props/max`, 'min must be less than max');
      // labels không dài hơn số Tag của khe nhiều Tag
      const labels = props.labels;
      const multi = spec.slots.find((x) => x.multi);
      if (Array.isArray(labels) && multi && !labelsBad) {
        const used = tagsObj[multi.name];
        if (Array.isArray(used) && labels.length > used.length)
          add('E_WIDGET_PROP', `${p}/props/labels`, 'more labels than tags');
      }
      // giới hạn so với Tag.limits (min/max lấy từ limits của Tag)
      const limited = spec.props.some((x) => x.fromTag?.startsWith('limits.'));
      if (limited && target && writable(target)) {
        const lim = target.limits;
        for (const n of ['min', 'max'] as const) {
          const v = num(n);
          if (v === undefined || !lim) continue;
          if ((lim.min !== undefined && v < lim.min) || (lim.max !== undefined && v > lim.max))
            add(
              'E_WIDGET_LIMITS',
              `${p}/props/${n}`,
              `${n} is outside the limits of tag '${target.id}'`,
            );
        }
        if (
          isNumericTag(target.type) &&
          lim?.min === undefined &&
          lim?.max === undefined &&
          num('min') === undefined &&
          num('max') === undefined
        )
          warn(
            'W_WRITE_NO_LIMITS',
            `${p}/tags/${spec.slots.find((x) => x.needsWrite)?.name ?? 'target'}`,
            `no limits on '${target.id}' or on the widget`,
          );
      }
      // bảng giá trị bắt buộc (select): thuộc tính hoặc bảng của Tag
      const tableProp = spec.props.find((x) => x.kind === 'tableRef' && x.fromTag === 'valueTable');
      if (
        tableProp &&
        props[tableProp.name] === undefined &&
        target &&
        target.valueTable === undefined
      )
        add(
          'E_WIDGET_PROP',
          `${p}/props`,
          `'${tableProp.name}' is needed: the tag has no value table`,
        );
    }

    /** Hành động của sự kiện click. Trả tên hành động hợp lệ (để biết khe `target` có dùng), hoặc undefined. */
    function checkAction(
      item: WidgetItem,
      i: number,
      spec: WidgetSpec,
      allowed: readonly string[],
    ): string | undefined {
      const base = `/items/${i}/events/click`;
      const c = item.events!.click as unknown;
      if (!isObj(c) || !('action' in c)) {
        add('E_ACTION', base, 'the click event needs an action');
        return undefined;
      }
      if (typeof c.action !== 'string') {
        add('E_ACTION', `${base}/action`, 'action must be a string');
        return undefined;
      }
      const name = c.action;
      if (!(ACTION_NAMES as readonly string[]).includes(name) || !allowed.includes(name)) {
        add('E_ACTION', `${base}/action`, `action '${name}' is not allowed for ${spec.id}`);
        return undefined;
      }
      const keys = actionKeys(name);
      for (const k of Object.keys(c))
        if (k !== 'action' && !keys.all.includes(k))
          add('E_ACTION', `${base}/${k}`, `'${k}' is not a parameter of '${name}'`);
      for (const k of keys.required)
        if (!(k in c)) add('E_ACTION', base, `action '${name}' needs '${k}'`);

      const targetId = isObj(item.tags) ? item.tags.target : undefined;
      const tag = typeof targetId === 'string' ? tagInfo.get(targetId) : undefined;
      if (name === 'write' && 'value' in c && tag) {
        const e = writeValueError(tag, c.value);
        if (e) add('E_ACTION', `${base}/value`, e);
        if (
          writable(tag) &&
          isNumericTag(tag.type) &&
          tag.limits?.min === undefined &&
          tag.limits?.max === undefined
        )
          warn('W_WRITE_NO_LIMITS', `/items/${i}/tags/target`, `no limits on '${tag.id}'`);
      }
      if (name === 'pulse') {
        if ('value' in c && typeof c.value !== 'boolean')
          add('E_ACTION', `${base}/value`, 'pulse value must be a boolean');
        const d = c.durationMs;
        if (
          'durationMs' in c &&
          (!Number.isInteger(d) ||
            (d as number) < DURATION_RANGE[0] ||
            (d as number) > DURATION_RANGE[1])
        )
          add(
            'E_ACTION',
            `${base}/durationMs`,
            `durationMs must be an integer ${DURATION_RANGE[0]}-${DURATION_RANGE[1]}`,
          );
        if (tag && tag.kind === 'external' && tag.source?.readback !== false)
          warn(
            'W_PULSE_READBACK',
            base,
            `tag '${tag.id}' reads back: the pulse may be seen as a change`,
          );
      }
      if ((name === 'navigate' || name === 'popup') && typeof c.screen === 'string') {
        const want = name === 'navigate' ? 'screen' : 'popup';
        if (!project.screens.includes(c.screen))
          add('E_ACTION_TARGET', `${base}/screen`, `screen '${c.screen}' does not exist`);
        else {
          const k = kindOf(c.screen);
          if (k !== undefined && k !== want)
            add(
              'E_ACTION_TARGET',
              `${base}/screen`,
              `'${name}' needs a ${want}, '${c.screen}' is a ${k}`,
            );
        }
      } else if ((name === 'navigate' || name === 'popup') && 'screen' in c)
        add('E_ACTION', `${base}/screen`, 'screen must be a string');
      if (name === 'closePopup' && (screen.kind ?? 'screen') === 'screen')
        warn('W_ACTION_NOOP', base, 'closePopup on a screen does nothing');
      return name;
    }
  }
}

/** Mô tả lỗi giá trị ghi (kiểu, khoảng của kiểu Tag, giới hạn nhập), hoặc null. */
export function writeValueError(t: TagV1, v: unknown): string | null {
  const cls = tagClassOf(t.type);
  if (cls === 'bool')
    return typeof v === 'boolean' ? null : 'value must be a boolean for a BOOL tag';
  if (cls === 'string') {
    if (typeof v !== 'string') return 'value must be a string for a STRING tag';
    const max = t.limits?.maxLength;
    return max !== undefined && utf8Length(v) > max
      ? `value is longer than limits.maxLength (${max})`
      : null;
  }
  if (typeof v !== 'number' || !Number.isFinite(v))
    return 'value must be a number for a numeric tag';
  if (INTEGER_TYPES.has(t.type) && !Number.isInteger(v)) return `${t.type} needs an integer value`;
  const [lo, hi] = TYPE_RANGE[t.type] ?? [-Infinity, Infinity];
  if (v < lo || v > hi) return `value is outside the range of ${t.type}`;
  const l = t.limits;
  if (l?.min !== undefined && v < l.min) return `value is below limits.min (${l.min})`;
  if (l?.max !== undefined && v > l.max) return `value is above limits.max (${l.max})`;
  return null;
}
