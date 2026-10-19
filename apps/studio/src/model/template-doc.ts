// Mô hình template và faceplate của Studio (feature 011, T172; FR-119 đến FR-123, FR-126; contracts/project-format-1.0.md
// §3 đến §5; ADR-038 điểm 6, 7). Hàm thuần, không DOM, không sửa đầu vào:
//  - tạo template từ vùng chọn: phát hiện tham số (tiền tố Tag chung, `args` của hành động popup), chỗ thay `{tham số}`
//    (khe Tag, thuộc tính chuỗi/số/màu, giá trị `args`), vị trí tương đối, cỡ theo hộp bao;
//  - bản sao (bung khi lưu): item thường id `<inst>.<rid>`, giá trị đã thay bằng `substituteParams` (cùng hàm với bộ
//    kiểm và trang vận hành), chú thích `tpl` đủ `params` trên MỌI item của bản sao (tự đủ: xóa một item không mất
//    tham số);
//  - "Cập nhật mọi bản sao": bung lại từ template hiện tại, giữ điểm đặt, cỡ từng item và tham số; item mang `tpl` của
//    bản sao mà template không có (thêm tay) bị xóa; trả về sửa đổi để gộp MỘT bước hoàn tác;
//  - "Bung thành item thường" (xóa `tpl`); xóa template còn bản sao chỉ qua bung rồi xóa (T007 quyết định 10);
//  - faceplate từ màn hình popup: tiền tố Tag chung thành `{prefix}`, `params` có default (chỗ gọi cũ vẫn hợp lệ).
// Chuỗi hiển thị không nằm ở đây: lý do từ chối là mã để UI tra i18n.
import {
  LIMITS_03,
  PARAM_LIMITS,
  PARAM_NAME_RE,
  TAG_PREFIX_RE,
  catalogWidget,
  checkParamDecls,
  checkParamPlaces,
  paramValueError,
  resolveArgs,
  substituteParams,
  type Item,
  type Item10,
  type ParamDecl,
  type ParamProblem,
  type ScreenModel,
  type ScreenModel10,
  type TemplateDoc,
  type TplRef,
} from '@mat/project-schema';
import { templateFile, type ProjectEdit } from './project-doc.ts';

export { templateFile };

export const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]{0,47}$/;
export const INST_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const RID_RE = /^[a-z][a-z0-9_]{1,31}$/;
export const MAX_TEMPLATE_ITEMS = 120;
const SUFFIX_RE = /^(\.[A-Za-z0-9_]+)+$/;

export type TemplateRejection =
  | 'empty'
  | 'too-many'
  | 'svg-item'
  | 'bad-id'
  | 'taken'
  | 'bad-name'
  | 'bad-params'
  | 'bad-inst'
  | 'inst-taken'
  | 'bad-args'
  | 'max-items'
  | 'not-popup'
  | 'no-prefix'
  /** Feature 012: bản sao template cần tọa độ, chưa đặt được vào màn hình bố cục lưới. */
  | 'grid-layout';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const tplOf = (it: Item): TplRef | undefined => {
  const t = (it as Item10).tpl;
  return isObj(t) && typeof t.inst === 'string' ? t : undefined;
};

// ---------------------------------------------------------------------------------------------
// Phát hiện tham số và chỗ thay

/** Mọi chuỗi Tag trong khe của item widget (khe đơn và phần tử của khe nhiều Tag). */
function tagRefs(items: readonly Item[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.type !== 'widget' || !isObj(it.tags)) continue;
    for (const v of Object.values(it.tags as Obj)) {
      if (typeof v === 'string') out.push(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') out.push(x);
    }
  }
  return out;
}

/** Tiền tố chung dài nhất (theo đoạn `.`, bỏ đoạn cuối của mỗi Tag) hoặc `null`. */
export function commonTagPrefix(tags: readonly string[]): string | null {
  if (tags.length === 0) return null;
  let common: string[] | null = null;
  for (const t of tags) {
    const segs = t.split('.').slice(0, -1);
    if (common === null) common = segs;
    else {
      let n = 0;
      while (n < common.length && n < segs.length && common[n] === segs[n]) n++;
      common = common.slice(0, n);
    }
    if (common.length === 0) return null;
  }
  const p = (common ?? []).join('.');
  return p !== '' && paramValueError('tagPrefix', p) === null ? p : null;
}

/**
 * Tham số gợi ý cho vùng chọn: `prefix` (tagPrefix) khi mọi Tag có tiền tố chung; mỗi khóa `args` của hành động popup
 * có giá trị khác tiền tố thành tham số `string` cùng tên (giá trị hiện tại làm default). Tối đa 16.
 */
export function suggestParams(items: readonly Item[]): ParamDecl[] {
  const out: ParamDecl[] = [];
  const prefix = commonTagPrefix(tagRefs(items));
  if (prefix !== null) out.push({ name: 'prefix', kind: 'tagPrefix', default: prefix });
  for (const it of items) {
    const click = it.type === 'widget' ? (it.events?.click as Obj | undefined) : undefined;
    if (!isObj(click) || click.action !== 'popup' || !isObj(click.args)) continue;
    for (const [k, v] of Object.entries(click.args)) {
      if (typeof v !== 'string' || v === prefix || !PARAM_NAME_RE.test(k)) continue;
      if (out.some((p) => p.name === k) || out.length >= PARAM_LIMITS.params) continue;
      if (paramValueError('string', v) === null && v !== '')
        out.push({ name: k, kind: 'string', default: v });
    }
  }
  return out;
}

/** Một chỗ trong item nguồn được thay bằng `{tham số}` khi tạo template. */
export interface Replacement {
  /** Id item nguồn (trên màn hình). */
  item: string;
  /** Đường dẫn trong item: `['tags', 'state']`, `['props', 'label']`, `['events', 'click', 'args', 'prefix']`. */
  path: readonly string[];
  /** Giá trị hiện tại. */
  current: string | number;
  /** Giá trị trong template (`{prefix}.RUN`, `{title} (lưu lượng)`, `{max}`). */
  value: string;
  /** Tham số dùng. */
  param: string;
}

const byLongestDefault = (ps: readonly ParamDecl[]) =>
  ps
    .filter((p) => p.default !== undefined && p.default !== '')
    .slice()
    .sort((a, b) => b.default!.length - a.default!.length);

function tagReplacement(v: string, params: readonly ParamDecl[]): [string, string] | null {
  for (const p of byLongestDefault(params)) {
    if (p.kind !== 'tagPrefix') continue;
    const d = p.default!;
    if (v === d) return [`{${p.name}}`, p.name];
    if (v.startsWith(d + '.') && SUFFIX_RE.test(v.slice(d.length)))
      return [`{${p.name}}${v.slice(d.length)}`, p.name];
  }
  return null;
}

function embedReplacement(
  v: string,
  params: readonly ParamDecl[],
  kinds: readonly ParamDecl['kind'][],
): [string, string] | null {
  if (v.includes('{') || v.includes('}')) return null;
  for (const p of byLongestDefault(params)) {
    if (!kinds.includes(p.kind) || !v.includes(p.default!)) continue;
    return [v.split(p.default!).join(`{${p.name}}`), p.name];
  }
  return null;
}

/**
 * Chỗ thay trong vùng chọn theo default của `params` (giá trị hiện tại): khe Tag (tagPrefix: đúng tiền tố hoặc
 * tiền tố + hậu tố), thuộc tính chuỗi (string: nhúng), số (number: bằng), màu (color: bằng), giá trị `args` của popup
 * (cùng tên tham số và bằng default thì trọn `{tên}`, không thì nhúng mọi kiểu). Theo thứ tự item, rồi tags, props,
 * events (thứ tự khóa trong item).
 */
export function findReplacements(
  items: readonly Item[],
  params: readonly ParamDecl[],
): Replacement[] {
  const out: Replacement[] = [];
  for (const it of items) {
    if (it.type !== 'widget') continue;
    const add = (path: string[], current: string | number, r: [string, string] | null) => {
      if (r) out.push({ item: it.id, path, current, value: r[0], param: r[1] });
    };
    const spec = catalogWidget(it.widget);
    for (const key of Object.keys(it)) {
      if (key === 'tags' && isObj(it.tags)) {
        for (const [slot, v] of Object.entries(it.tags as Obj)) {
          if (typeof v === 'string') add(['tags', slot], v, tagReplacement(v, params));
          else if (Array.isArray(v))
            v.forEach((x, i) => {
              if (typeof x === 'string')
                add(['tags', slot, String(i)], x, tagReplacement(x, params));
            });
        }
      } else if (key === 'props' && isObj(it.props)) {
        for (const [name, v] of Object.entries(it.props as Obj)) {
          const ps = spec?.props.find((p) => p.name === name);
          if (!ps) continue;
          if (ps.kind === 'string' && typeof v === 'string')
            add(['props', name], v, embedReplacement(v, params, ['string']));
          else if (ps.kind === 'array' && ps.items?.kind === 'string' && Array.isArray(v))
            v.forEach((x, i) => {
              if (typeof x === 'string')
                add(['props', name, String(i)], x, embedReplacement(x, params, ['string']));
            });
          else if ((ps.kind === 'number' || ps.kind === 'int') && typeof v === 'number') {
            const p = params.find((q) => q.kind === 'number' && Number(q.default) === v);
            if (p) add(['props', name], v, [`{${p.name}}`, p.name]);
          } else if (ps.kind === 'color' && typeof v === 'string') {
            const p = params.find(
              (q) => q.kind === 'color' && q.default?.toLowerCase() === v.toLowerCase(),
            );
            if (p) add(['props', name], v, [`{${p.name}}`, p.name]);
          }
        }
      } else if (key === 'events' && isObj(it.events)) {
        const click = it.events.click as Obj | undefined;
        if (!isObj(click) || click.action !== 'popup' || !isObj(click.args)) continue;
        for (const [k, v] of Object.entries(click.args)) {
          if (typeof v !== 'string') continue;
          const same = params.find((p) => p.name === k && p.default === v);
          const r: [string, string] | null = same
            ? [`{${k}}`, k]
            : (tagReplacement(v, params) ??
              embedReplacement(v, params, ['tagPrefix', 'string', 'number', 'color']));
          add(['events', 'click', 'args', k], v, r);
        }
      }
    }
  }
  return out;
}

function setPath(target: Obj, path: readonly string[], value: unknown): void {
  let cur: unknown = target;
  for (let i = 0; i < path.length - 1; i++) {
    cur = Array.isArray(cur) ? cur[Number(path[i])] : (cur as Obj)[path[i]!];
    if (cur === null || typeof cur !== 'object') return;
  }
  const last = path[path.length - 1]!;
  if (Array.isArray(cur)) cur[Number(last)] = value;
  else (cur as Obj)[last] = value;
}

/** Id item tương đối hợp lệ (`^[a-z][a-z0-9_]{1,31}$`) từ id trên màn hình, không trùng `used`. */
function ridOf(id: string, used: Set<string>): string {
  const tail = id.includes('.') ? id.slice(id.lastIndexOf('.') + 1) : id;
  let base = tail.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!/^[a-z]/.test(base)) base = 'i_' + base;
  if (base.length < 2) base = base + '_1';
  base = base.slice(0, 32);
  let rid = base;
  for (let n = 2; used.has(rid); n++) rid = `${base.slice(0, 28)}_${n}`;
  used.add(rid);
  return rid;
}

// ---------------------------------------------------------------------------------------------
// Tạo template

export interface CreateTemplateInput {
  id: string;
  name: string;
  /** Item nguồn (vùng chọn, theo thứ tự lớp). */
  items: readonly Item[];
  params: readonly ParamDecl[];
  /** Chỗ thay được chọn (bỏ chỗ không muốn). */
  replacements: readonly Replacement[];
  /** `schemaVersion` của project. */
  schemaVersion: string;
  /** Id template đã có. */
  taken?: Iterable<string>;
}

export type CreateTemplateResult =
  | {
      ok: true;
      template: TemplateDoc;
      /** Góc trên trái của vùng chọn trên màn hình (điểm đặt của bản sao thay vùng chọn). */
      origin: { x: number; y: number };
      /** Id item nguồn → id trong template. */
      rids: Record<string, string>;
    }
  | { ok: false; reason: TemplateRejection; problems?: ParamProblem[] };

/** Kiểm khai báo tham số: tên, trùng, default đúng kiểu, tối đa 16. */
function paramsOk(params: readonly ParamDecl[]): boolean {
  if (params.length > PARAM_LIMITS.params) return false;
  if (params.some((p) => !PARAM_NAME_RE.test(p.name))) return false;
  return checkParamDecls(params).length === 0;
}

export function createTemplate(input: CreateTemplateInput): CreateTemplateResult {
  const { items } = input;
  if (items.length === 0) return { ok: false, reason: 'empty' };
  if (items.length > MAX_TEMPLATE_ITEMS) return { ok: false, reason: 'too-many' };
  if (!TEMPLATE_ID_RE.test(input.id)) return { ok: false, reason: 'bad-id' };
  if ([...(input.taken ?? [])].includes(input.id)) return { ok: false, reason: 'taken' };
  const name = input.name.trim();
  if (name === '' || name.length > 80) return { ok: false, reason: 'bad-name' };
  // Item svg: một tệp binding chỉ thuộc một item, bản sao không dùng chung được.
  if (items.some((i) => i.type !== 'widget')) return { ok: false, reason: 'svg-item' };
  if (!paramsOk(input.params)) return { ok: false, reason: 'bad-params' };
  const x0 = Math.min(...items.map((i) => i.x));
  const y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.width));
  const y1 = Math.max(...items.map((i) => i.y + i.height));
  const used = new Set<string>();
  const rids: Record<string, string> = {};
  const out: Item[] = [];
  for (const src of items) {
    const copy = clone(src) as Item & { tpl?: unknown; locked?: boolean; hidden?: boolean };
    delete copy.tpl;
    const rid = ridOf(src.id, used);
    rids[src.id] = rid;
    for (const r of input.replacements)
      if (r.item === src.id) setPath(copy as unknown as Obj, r.path, r.value);
    copy.id = rid;
    copy.x = src.x - x0;
    copy.y = src.y - y0;
    out.push(copy);
  }
  const params = input.params.map((p) => clone(p));
  const problems = out.flatMap((it) => checkParamPlaces(it, params, { template: true }));
  if (problems.length) return { ok: false, reason: 'bad-params', problems };
  const template: TemplateDoc = {
    schemaVersion: input.schemaVersion,
    id: input.id,
    name,
    size: {
      width: Math.min(4096, Math.max(1, Math.round(x1 - x0))),
      height: Math.min(2304, Math.max(1, Math.round(y1 - y0))),
    },
    ...(params.length ? { params } : {}),
    items: out,
  };
  return { ok: true, template, origin: { x: x0, y: y0 }, rids };
}

// ---------------------------------------------------------------------------------------------
// Bản sao

export type ExpandResult =
  | { ok: true; items: Item10[]; params: Record<string, string> }
  | { ok: false; reason: 'bad-inst' | 'bad-args' | 'bad-params'; problems?: ParamProblem[] };

/**
 * Bung một bản sao: mỗi item của template thành item thường id `<inst>.<rid>` ở `at + (x, y)`, `{tham số}` đã thay
 * (thiếu thì default), `tpl` đủ `params`. `sizes`: cỡ riêng của bản sao theo `rid` (giữ khi cập nhật, FR-121).
 */
export function expandInstance(
  template: TemplateDoc,
  inst: string,
  params: Readonly<Record<string, string>>,
  at: { x: number; y: number },
  sizes?: ReadonlyMap<string, { width: number; height: number }>,
): ExpandResult {
  if (!INST_ID_RE.test(inst)) return { ok: false, reason: 'bad-inst' };
  const decls = template.params ?? [];
  const r = resolveArgs(decls, params);
  if (!r.ok) return { ok: false, reason: 'bad-args', problems: r.problems };
  const items: Item10[] = [];
  for (const t of template.items) {
    const s = substituteParams(t, decls, r.values, { template: true });
    if (!s.ok) return { ok: false, reason: 'bad-params', problems: s.problems };
    const it = clone(s.value) as Item10;
    const size = sizes?.get(t.id);
    it.id = `${inst}.${t.id}`;
    it.x = Math.round(at.x + t.x);
    it.y = Math.round(at.y + t.y);
    if (size) {
      it.width = size.width;
      it.height = size.height;
    }
    it.tpl = { inst, tid: template.id, rid: t.id, params: { ...r.values } };
    items.push(it);
  }
  return { ok: true, items, params: r.values };
}

/** Id bản sao kế tiếp chưa dùng trên màn hình: `<tid><n>` (n nhỏ nhất từ 1). */
export function nextInstanceId(screen: ScreenModel, tid: string): string {
  const base = (/^[a-z]/.test(tid) ? tid : 'inst').slice(0, 28);
  const taken = instanceIds(screen);
  let n = 1;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/** Id bản sao đã dùng trên màn hình (cả tiền tố id item `<inst>.` để không đụng item đã bung). */
function instanceIds(screen: ScreenModel): Set<string> {
  const out = new Set<string>();
  for (const it of screen.items) {
    const t = tplOf(it);
    if (t) out.add(t.inst);
    const dot = it.id.indexOf('.');
    if (dot > 0) out.add(it.id.slice(0, dot));
  }
  return out;
}

export interface AddInstanceOptions {
  /** Vắng: `nextInstanceId`. */
  inst?: string;
  params: Readonly<Record<string, string>>;
  at: { x: number; y: number };
}

export type AddInstanceResult =
  | { ok: true; screen: ScreenModel; inst: string; ids: string[] }
  | { ok: false; reason: TemplateRejection; problems?: ParamProblem[] };

/** Thêm một bản sao vào cuối màn hình (trên cùng). */
export function addInstance(
  screen: ScreenModel,
  template: TemplateDoc,
  opts: AddInstanceOptions,
): AddInstanceResult {
  if ((screen as ScreenModel & { layout?: unknown }).layout !== undefined)
    return { ok: false, reason: 'grid-layout' };
  const inst = opts.inst ?? nextInstanceId(screen, template.id);
  if (!INST_ID_RE.test(inst)) return { ok: false, reason: 'bad-inst' };
  if (instanceIds(screen).has(inst)) return { ok: false, reason: 'inst-taken' };
  if (screen.items.length + template.items.length > LIMITS_03.items)
    return { ok: false, reason: 'max-items' };
  const r = expandInstance(template, inst, opts.params, opts.at);
  if (!r.ok) return { ok: false, reason: 'bad-args', problems: r.problems };
  return {
    ok: true,
    screen: { ...screen, items: [...screen.items, ...(r.items as Item[])] },
    inst,
    ids: r.items.map((i) => i.id),
  };
}

export interface InstanceInfo {
  screen: string;
  inst: string;
  tid: string;
  /** Tham số của bản sao (của item đầu mang `params`); `{}` khi không item nào mang. */
  params: Record<string, string>;
  /** Điểm đặt (góc trên trái của template) suy từ item đầu có `rid` trong template; vắng template: góc hộp bao. */
  at: { x: number; y: number };
  /** Id item theo thứ tự lớp. */
  ids: string[];
  /** Id item mang `tpl` của bản sao mà template không có (thêm tay: bị xóa khi cập nhật). */
  extra: string[];
}

/** Nhóm item theo bản sao, theo thứ tự xuất hiện. */
function groups(screen: ScreenModel): Map<string, number[]> {
  const out = new Map<string, number[]>();
  screen.items.forEach((it, i) => {
    const t = tplOf(it);
    if (!t) return;
    const g = out.get(t.inst);
    if (g) g.push(i);
    else out.set(t.inst, [i]);
  });
  return out;
}

function infoOf(
  screen: ScreenModel,
  inst: string,
  idx: readonly number[],
  template: TemplateDoc | undefined,
): InstanceInfo {
  const members = idx.map((i) => screen.items[i]!);
  const tid = tplOf(members[0]!)!.tid;
  const carrier = members.find((m) => isObj(tplOf(m)!.params));
  const byRid = new Map((template?.items ?? []).map((t) => [t.id, t]));
  const anchor = members.find((m) => byRid.has(tplOf(m)!.rid));
  const at = anchor
    ? {
        x: anchor.x - byRid.get(tplOf(anchor)!.rid)!.x,
        y: anchor.y - byRid.get(tplOf(anchor)!.rid)!.y,
      }
    : { x: Math.min(...members.map((m) => m.x)), y: Math.min(...members.map((m) => m.y)) };
  return {
    screen: screen.id,
    inst,
    tid,
    params: carrier ? { ...tplOf(carrier)!.params! } : {},
    at,
    ids: members.map((m) => m.id),
    extra: template ? members.filter((m) => !byRid.has(tplOf(m)!.rid)).map((m) => m.id) : [],
  };
}

/** Bản sao trên các màn hình (lọc theo `tid` nếu có), theo thứ tự màn hình rồi thứ tự lớp. */
export function instancesOf(
  screens: readonly ScreenModel[],
  templates: Readonly<Record<string, TemplateDoc>>,
  tid?: string,
): InstanceInfo[] {
  const out: InstanceInfo[] = [];
  for (const s of screens) {
    if (!s) continue;
    for (const [inst, idx] of groups(s)) {
      const t = tplOf(s.items[idx[0]!]!)!.tid;
      if (tid !== undefined && t !== tid) continue;
      out.push(infoOf(s, inst, idx, templates[t]));
    }
  }
  return out;
}

export interface UpdateResult {
  screen: ScreenModel;
  /** Số bản sao đã bung lại. */
  instances: number;
  /** Id item thêm tay bị xóa. */
  removed: string[];
  /** Bản sao không bung lại được (tham số thiếu hay sai với template mới): giữ nguyên. */
  failed: string[];
}

/**
 * Bung lại mọi bản sao của `template` trên màn hình (FR-121): giữ điểm đặt, cỡ từng item (theo `rid`) và tham số;
 * item mới của template thêm vào, item không còn trong template bị xóa; khối item mới đặt ở chỗ item đầu của bản sao.
 */
export function updateInstances(
  screen: ScreenModel,
  template: TemplateDoc,
  only?: { inst: string; params: Readonly<Record<string, string>> },
): UpdateResult {
  const byRid = new Set(template.items.map((t) => t.id));
  const replace = new Map<number, Item[]>();
  const drop = new Set<number>();
  const removed: string[] = [];
  const failed: string[] = [];
  let instances = 0;
  for (const [inst, idx] of groups(screen)) {
    if (tplOf(screen.items[idx[0]!]!)!.tid !== template.id) continue;
    if (only && only.inst !== inst) continue;
    const info = infoOf(screen, inst, idx, template);
    const sizes = new Map<string, { width: number; height: number }>();
    for (const i of idx) {
      const it = screen.items[i]!;
      const rid = tplOf(it)!.rid;
      if (byRid.has(rid) && !sizes.has(rid)) sizes.set(rid, { width: it.width, height: it.height });
    }
    const r = expandInstance(template, inst, only ? only.params : info.params, info.at, sizes);
    if (!r.ok) {
      failed.push(inst);
      continue;
    }
    instances++;
    removed.push(...info.extra);
    replace.set(idx[0]!, r.items as Item[]);
    for (const i of idx.slice(1)) drop.add(i);
  }
  if (instances === 0) return { screen, instances, removed: [], failed };
  const items: Item[] = [];
  screen.items.forEach((it, i) => {
    const r = replace.get(i);
    if (r) items.push(...r);
    else if (!drop.has(i)) items.push(it);
  });
  const next = { ...screen, items };
  return {
    screen: JSON.stringify(next) === JSON.stringify(screen) ? screen : next,
    instances,
    removed,
    failed,
  };
}

/** Đổi tham số của một bản sao (bung lại riêng bản sao đó); `null` khi giá trị sai hay không có bản sao. */
export function setInstanceParams(
  screen: ScreenModel,
  template: TemplateDoc,
  inst: string,
  params: Readonly<Record<string, string>>,
): ScreenModel | null {
  const u = updateInstances(screen, template, { inst, params });
  return u.instances === 1 ? u.screen : null;
}

/** "Cập nhật mọi bản sao" trên mọi màn hình: sửa đổi (màn hình đổi) để gộp với `templateUpsert` thành một bước. */
export function planUpdateAll(
  screens: readonly ScreenModel[],
  template: TemplateDoc,
): {
  edits: ProjectEdit[];
  instances: number;
  screens: number;
  removed: string[];
  failed: string[];
} {
  const edits: ProjectEdit[] = [];
  let instances = 0;
  let touched = 0;
  const removed: string[] = [];
  const failed: string[] = [];
  for (const s of screens) {
    if (!s) continue;
    const u = updateInstances(s, template);
    instances += u.instances;
    removed.push(...u.removed);
    failed.push(...u.failed);
    if (u.instances > 0) touched++;
    if (u.screen !== s) edits.push({ kind: 'screenUpsert', screen: u.screen });
  }
  return { edits, instances, screens: touched, removed, failed };
}

/** "Bung thành item thường": xóa `tpl` khỏi mọi item của bản sao; không có bản sao thì trả đúng `screen`. */
export function explodeInstance(screen: ScreenModel, inst: string): ScreenModel {
  let changed = false;
  const items = screen.items.map((it) => {
    if (tplOf(it)?.inst !== inst) return it;
    changed = true;
    const copy = { ...it } as Item10;
    delete copy.tpl;
    return copy as Item;
  });
  return changed ? { ...screen, items } : screen;
}

/** Bung mọi bản sao của template `tid` trên màn hình. */
export function explodeTemplate(screen: ScreenModel, tid: string): ScreenModel {
  let s = screen;
  for (const [inst, idx] of groups(screen))
    if (tplOf(screen.items[idx[0]!]!)!.tid === tid) s = explodeInstance(s, inst);
  return s;
}

/**
 * Xóa template (T007 quyết định 10): mọi bản sao được bung thành item thường rồi template bị xóa; một bước hoàn tác.
 * Không có lựa chọn xóa luôn bản sao.
 */
export function planDeleteTemplate(
  screens: readonly ScreenModel[],
  tid: string,
): { edits: ProjectEdit[]; instances: number; screens: number } {
  const edits: ProjectEdit[] = [];
  let instances = 0;
  let touched = 0;
  for (const s of screens) {
    if (!s) continue;
    const n = [...groups(s).values()].filter((idx) => tplOf(s.items[idx[0]!]!)!.tid === tid).length;
    if (n === 0) continue;
    instances += n;
    touched++;
    edits.push({ kind: 'screenUpsert', screen: explodeTemplate(s, tid) });
  }
  edits.push({ kind: 'templateRemove', id: tid });
  return { edits, instances, screens: touched };
}

export interface PlanCreateInput extends Omit<CreateTemplateInput, 'items'> {
  /** Thay vùng chọn bằng một bản sao (tham số = default, tức giá trị hiện tại). */
  replaceSelection: boolean;
  inst?: string;
}

/** "Tạo template…" từ vùng chọn `ids` của màn hình: sửa đổi (template mới, màn hình nếu thay vùng chọn). */
export function planCreateTemplate(
  screen: ScreenModel,
  ids: readonly string[],
  input: PlanCreateInput,
):
  | { ok: true; edits: ProjectEdit[]; template: TemplateDoc; inst?: string; ids?: string[] }
  | { ok: false; reason: TemplateRejection; problems?: ParamProblem[] } {
  const chosen = new Set(ids);
  const items = screen.items.filter((i) => chosen.has(i.id));
  const c = createTemplate({ ...input, items });
  if (!c.ok) return c;
  const edits: ProjectEdit[] = [{ kind: 'templateUpsert', template: c.template }];
  if (!input.replaceSelection) return { ok: true, edits, template: c.template };
  const rest = { ...screen, items: screen.items.filter((i) => !chosen.has(i.id)) };
  const values: Record<string, string> = {};
  for (const p of c.template.params ?? []) if (p.default !== undefined) values[p.name] = p.default;
  const inst = input.inst ?? nextInstanceId(rest, c.template.id);
  const r = expandInstance(c.template, inst, values, c.origin);
  if (!r.ok) return { ok: false, reason: r.reason === 'bad-inst' ? 'bad-inst' : 'bad-args' };
  // bản sao nằm ở lớp của item đầu vùng chọn
  const first = screen.items.findIndex((i) => chosen.has(i.id));
  const before = screen.items.slice(0, first).filter((i) => !chosen.has(i.id));
  const after = screen.items.slice(first).filter((i) => !chosen.has(i.id));
  edits.push({
    kind: 'screenUpsert',
    screen: { ...rest, items: [...before, ...(r.items as Item[]), ...after] },
  });
  return { ok: true, edits, template: c.template, inst, ids: r.items.map((i) => i.id) };
}

// ---------------------------------------------------------------------------------------------
// Faceplate

/**
 * "Tạo faceplate" từ màn hình popup (FR-126): tiền tố Tag chung thành `{prefix}` (tagPrefix, default = tiền tố hiện
 * tại để chỗ gọi cũ không `args` vẫn hợp lệ); `params` có sẵn được giữ. Màn hình không phải popup hay không có tiền tố
 * chung: từ chối.
 */
export function planFaceplate(
  popup: ScreenModel,
):
  | { ok: true; screen: ScreenModel10; params: ParamDecl[] }
  | { ok: false; reason: TemplateRejection } {
  if ((popup.kind ?? 'screen') !== 'popup') return { ok: false, reason: 'not-popup' };
  const own = ((popup as ScreenModel10).params ?? []).map((p) => clone(p));
  const prefix = commonTagPrefix(tagRefs(popup.items));
  if (prefix === null || !TAG_PREFIX_RE.test(prefix)) return { ok: false, reason: 'no-prefix' };
  const name = own.some((p) => p.name === 'prefix') ? null : 'prefix';
  const params: ParamDecl[] = name ? [...own, { name, kind: 'tagPrefix', default: prefix }] : own;
  if (!paramsOk(params)) return { ok: false, reason: 'bad-params' };
  const reps = findReplacements(popup.items, params).filter((r) => r.path[0] === 'tags');
  const items = popup.items.map((it) => {
    const mine = reps.filter((r) => r.item === it.id);
    if (mine.length === 0) return it;
    const copy = clone(it);
    for (const r of mine) setPath(copy as unknown as Obj, r.path, r.value);
    return copy;
  });
  return {
    ok: true,
    screen: { ...(popup as ScreenModel10), params, items: items as Item10[] },
    params,
  };
}

/** `params` của màn hình popup `id` (faceplate) hoặc `[]`. */
export function popupParamsOf(screens: readonly ScreenModel[], id: string): ParamDecl[] {
  const s = screens.find((x) => x?.id === id) as ScreenModel10 | undefined;
  return s && (s.kind ?? 'screen') === 'popup' ? (s.params ?? []) : [];
}

/** Lỗi của bộ `args` với `params` của popup (thiếu, thừa, sai kiểu); `[]` khi hợp lệ. */
export function argsProblems(params: readonly ParamDecl[], args: unknown): ParamProblem[] {
  const r = resolveArgs(params, args);
  return r.ok ? [] : r.problems;
}
