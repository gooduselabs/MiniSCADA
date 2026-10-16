// Luật liên file của định dạng 1.0.0 (feature 011, T019; contracts/project-format-1.0.md §3-§5; FR-119 đến FR-124):
// luật 0.5/0.6 (rules-05.ts: Tag, kết nối, bảng, logging, báo cáo, alarm, màn hình, binding, sự kiện) cộng template, bản
// sao (`tpl`), faceplate (popup có `params`, hành động popup có `args`) và phiên bản của logic.json. Bản C++
// (core/project-manager/rules_10, T020) cài CÙNG luật; vector chung tests/project-vectors `v10-*` (README-011.md).
//
// Thứ tự và quy ước (C++ làm giống hệt để cùng tập mã và vị trí):
// 1. Template (từng tệp khai trong `templates`, tra theo tên tệp `templates/<id>.template.json`): phiên bản khớp
//    project (E_SCHEMA_VERSION), `id` bằng tên tệp, id item đúng dạng và không trùng (E_TEMPLATE_ID), khai báo tham số
//    và chỗ đặt `{name}` (E_TEMPLATE_PARAM; trong template, giá trị `args` của hành động popup được có `{name}`).
// 2. Popup có `params` (`params` ở màn hình không phải popup: E_TEMPLATE_PARAM `/params`): khai báo và chỗ đặt
//    (E_TEMPLATE_PARAM `/items/<i>…`).
// 3. Chỗ gọi popup (hành động `popup` của widget và sự kiện click của phần tử SVG, theo thứ tự màn hình của
//    project.json, item, phần tử): `args` khớp `params` của popup đích (E_POPUP_ARGS tại `…/events/click/args/<tên>`);
//    bỏ qua chỗ gọi nằm trong popup có tham số mà `args` có `{`/`}` (đã báo ở bước 2). Bộ `args` (sau khi lấy default)
//    khác nhau của mỗi popup: quá 1.000 là E_POPUP_ARGS tại `/params` của popup (chỉ bung 1.000 bộ đầu). Popup có
//    `params` mà không ai gọi: bung một bộ default nếu mọi tham số có default, ngược lại không bung.
// 4. Bung tĩnh: với mỗi bộ, item widget có `{`/`}` (và không lỗi chỗ đặt) được thay rồi kiểm như item thường (rules-03,
//    `expansions`); ở bản gốc các chuỗi có `{`/`}` không được kiểm như Tag/giá trị (`paramScreens`). Lỗi của bản thay:
//    E_REF_TAG, E_WIDGET_TAG_TYPE đổi thành E_TEMPLATE_TAG_REF; mã khác giữ; bỏ trùng theo (mã, tệp, đường dẫn).
// 5. Bản sao (`tpl`, nhóm theo `inst` trong một màn hình): `tid` có trong `templates` (E_TEMPLATE_REF `/tpl/tid`; template
//    khai mà không nạp được thì bỏ qua), mọi item cùng `tid`, `rid` có trong template (`/tpl/rid`), id bằng
//    `<inst>.<rid>` (`/id`); `params` của các item mang nó phải bằng nhau (E_TEMPLATE_PARAM `/tpl/params`) và đúng
//    tham số của template (E_TEMPLATE_PARAM `/tpl/params/<tên>`); Tag của item có `tpl` không có hoặc sai kiểu khe:
//    E_REF_TAG, E_WIDGET_TAG_TYPE của luật thường đổi thành E_TEMPLATE_TAG_REF; item khác bản bung từ template (bỏ qua
//    `id`, `x`, `y`, `width`, `height`, `tpl`, `locked`, `hidden`) hoặc thiếu item của template: W_TEMPLATE_DRIFT.
import type { ErrorCode, Issue, WarningCode } from './codes.ts';
import {
  checkParamDecls,
  checkParamPlaces,
  PARAM_LIMITS,
  resolveArgs,
  substituteParams,
  type ParamDecl,
} from './params.ts';
import type { Rule03Expansion } from './rules-03.ts';
import { runRules05, type Rule05Input } from './rules-05.ts';
import type { ScreenModel } from './types-03.ts';
import type { Item10, LogicDoc, Project10, ScreenModel10, TemplateDoc } from './types-10.ts';

const ITEM_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const TEMPLATE_PATH_RE = /^templates\/([a-z][a-z0-9-]{0,47})\.template\.json$/;
/** Khóa của item không so khi tìm lệch giữa bản sao và template (của riêng bản sao, FR-121). */
const OWN_KEYS = new Set(['id', 'x', 'y', 'width', 'height', 'tpl', 'locked', 'hidden']);
const TAG_CODES = new Set<string>(['E_REF_TAG', 'E_WIDGET_TAG_TYPE']);

export interface Rule10Input extends Omit<Rule05Input, 'project'> {
  project: Project10;
  /** Mỗi tệp của `templates` (theo thứ tự khai): `doc` vắng khi không nạp được (lỗi đã báo). */
  templates: ReadonlyArray<{ file: string; doc?: TemplateDoc }>;
  logic?: { file: string; doc: LogicDoc };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const hasBrace = (v: unknown): boolean =>
  typeof v === 'string'
    ? v.includes('{') || v.includes('}')
    : Array.isArray(v)
      ? v.some(hasBrace)
      : isObj(v) && Object.entries(v).some(([k, x]) => hasBrace(k) || hasBrace(x));

/** So sâu hai giá trị JSON (thứ tự khóa không quan trọng). */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}
const own = (item: unknown): Record<string, unknown> =>
  Object.fromEntries(Object.entries(isObj(item) ? item : {}).filter(([k]) => !OWN_KEYS.has(k)));

export function runRules10(input: Rule10Input): { errors: Issue[]; warnings: Issue[] } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: ErrorCode, file: string, path: string, message: string) =>
    errors.push({ code, file, path, message });
  const warn = (code: WarningCode, file: string, path: string, message: string) =>
    warnings.push({ code, file, path, message });
  const { project, screens } = input;
  const version = project.schemaVersion;

  // ---- logic.json: chỉ phiên bản (luật E_LOGIC_* ở rules-logic, T135) ----
  if (input.logic && input.logic.doc.schemaVersion !== version)
    err(
      'E_SCHEMA_VERSION',
      input.logic.file,
      '/schemaVersion',
      `schemaVersion ${input.logic.doc.schemaVersion} khác project.json (${version}): mọi tệp phải cùng phiên bản`,
    );

  // ---- 1. Template ----
  /** Template theo id (tên tệp); `undefined`: khai mà không nạp được. */
  const templates = new Map<string, TemplateDoc | undefined>();
  for (const { file, doc } of input.templates) {
    const stem = TEMPLATE_PATH_RE.exec(file)?.[1];
    if (stem === undefined || templates.has(stem)) continue; // schema đã từ chối
    templates.set(stem, doc);
    if (!doc) continue;
    if (doc.schemaVersion !== version)
      err(
        'E_SCHEMA_VERSION',
        file,
        '/schemaVersion',
        `schemaVersion ${doc.schemaVersion} khác project.json (${version}): mọi tệp phải cùng phiên bản`,
      );
    if (doc.id !== stem) err('E_TEMPLATE_ID', file, '/id', `id '${doc.id}' khác tên tệp '${stem}'`);
    const params = doc.params ?? [];
    for (const d of checkParamDecls(params))
      err('E_TEMPLATE_PARAM', file, `/params${d.path}`, d.message);
    const ids = new Set<string>();
    doc.items.forEach((item, i) => {
      if (!ITEM_ID_RE.test(item.id))
        err('E_TEMPLATE_ID', file, `/items/${i}/id`, `id item '${item.id}' sai dạng`);
      else if (ids.has(item.id))
        err('E_TEMPLATE_ID', file, `/items/${i}/id`, `id item '${item.id}' bị trùng`);
      ids.add(item.id);
      for (const p of checkParamPlaces(item, params, { template: true }))
        err('E_TEMPLATE_PARAM', file, `/items/${i}${p.path}`, p.message);
    });
  }

  // ---- 2. Popup có params ----
  const paramScreens = new Set<string>();
  /** Item có lỗi chỗ đặt của từng popup có tham số: không bung. */
  const badItems = new Map<string, Set<number>>();
  const screenOf = (id: string) => screens[id]?.screen as ScreenModel10 | undefined;
  for (const [id, s] of Object.entries(screens)) {
    const sc = s.screen as ScreenModel10;
    if (sc.params === undefined) continue;
    if ((sc.kind ?? 'screen') !== 'popup') {
      err('E_TEMPLATE_PARAM', s.file, '/params', 'params chỉ dùng ở màn hình popup');
      continue;
    }
    for (const d of checkParamDecls(sc.params))
      err('E_TEMPLATE_PARAM', s.file, `/params${d.path}`, d.message);
    if (sc.params.length === 0) continue;
    paramScreens.add(id);
    const bad = new Set<number>();
    sc.items.forEach((item, i) => {
      for (const p of checkParamPlaces(item, sc.params!)) {
        err('E_TEMPLATE_PARAM', s.file, `/items/${i}${p.path}`, p.message);
        bad.add(i);
      }
    });
    badItems.set(id, bad);
  }

  // ---- 3. Chỗ gọi popup ----
  const combos = new Map<string, Map<string, Record<string, string>>>();
  const callSite = (callerId: string, click: unknown, file: string, base: string) => {
    if (!isObj(click) || click.action !== 'popup' || typeof click.screen !== 'string') return;
    const target = screenOf(click.screen);
    if (!target || (target.kind ?? 'screen') !== 'popup') return; // E_ACTION_TARGET, E_EVENT_TARGET của luật thường
    if (paramScreens.has(callerId) && hasBrace(click.args)) return;
    const params: ParamDecl[] = target.params ?? [];
    const r = resolveArgs(params, click.args);
    if (!r.ok) {
      for (const p of r.problems)
        err('E_POPUP_ARGS', file, `${base}/args${p.path}`, `popup '${click.screen}': ${p.message}`);
      return;
    }
    if (params.length === 0 || !paramScreens.has(click.screen)) return;
    let set = combos.get(click.screen);
    if (!set) combos.set(click.screen, (set = new Map()));
    const key = JSON.stringify(params.map((p) => r.values[p.name]));
    if (!set.has(key)) set.set(key, r.values);
  };
  for (const [id, s] of Object.entries(screens)) {
    s.screen.items.forEach((item, i) => {
      if (item.type === 'widget')
        callSite(id, item.events?.click, s.file, `/items/${i}/events/click`);
      else {
        const b = s.svg[i]?.bindings as
          { elements?: Array<{ events?: { click?: unknown } }> } | undefined;
        if (!b || !isObj(item) || typeof item.bindingFile !== 'string') return;
        (b.elements ?? []).forEach((e, j) =>
          callSite(id, e.events?.click, item.bindingFile, `/elements/${j}/events/click`),
        );
      }
    });
  }

  // ---- 4. Bung tĩnh ----
  const expansions: Array<Rule03Expansion & { values: Record<string, string> }> = [];
  for (const id of paramScreens) {
    const s = screens[id]!;
    const sc = s.screen as ScreenModel10;
    const params = sc.params!;
    let list = [...(combos.get(id)?.values() ?? [])];
    if (list.length > PARAM_LIMITS.combinations) {
      err(
        'E_POPUP_ARGS',
        s.file,
        '/params',
        `popup '${id}' được mở với ${list.length} bộ args khác nhau (tối đa ${PARAM_LIMITS.combinations})`,
      );
      list = list.slice(0, PARAM_LIMITS.combinations);
    }
    if (list.length === 0 && params.every((p) => p.default !== undefined)) {
      const r = resolveArgs(params, {});
      if (r.ok) list = [r.values];
    }
    const bad = badItems.get(id)!;
    const indices = sc.items
      .map((item, i) => (item.type === 'widget' && !bad.has(i) && hasBrace(item) ? i : -1))
      .filter((i) => i >= 0);
    if (indices.length === 0) continue;
    for (const values of list) {
      const items = sc.items.slice();
      const ok: number[] = [];
      for (const i of indices) {
        const r = substituteParams(sc.items[i], params, values);
        if (!r.ok) continue;
        items[i] = r.value;
        ok.push(i);
      }
      expansions.push({
        key: id,
        file: s.file,
        screen: { ...(sc as unknown as ScreenModel), items: items as ScreenModel['items'] },
        items: ok,
        errors: [],
        warnings: [],
        values,
      });
    }
  }

  // ---- luật 0.5/0.6 (với bung tĩnh) ----
  const base = runRules05({ ...input, schema: '1.0', paramScreens, expansions } as Rule05Input);

  // ---- 5. Bản sao ----
  /** `file` → chỉ số item có `tpl` mà template đã nạp: lỗi Tag của chúng là E_TEMPLATE_TAG_REF. */
  const tplItems = new Map<string, Map<number, string>>();
  for (const s of Object.values(screens)) {
    const items = s.screen.items as Item10[];
    const groups = new Map<string, number[]>();
    items.forEach((item, i) => {
      if (!isObj(item.tpl) || typeof item.tpl.inst !== 'string') return;
      const g = groups.get(item.tpl.inst);
      if (g) g.push(i);
      else groups.set(item.tpl.inst, [i]);
    });
    for (const [inst, idx] of groups) {
      const tid = items[idx[0]!]!.tpl!.tid;
      const members = idx.filter((i) => {
        if (items[i]!.tpl!.tid === tid) return true;
        err(
          'E_TEMPLATE_REF',
          s.file,
          `/items/${i}/tpl/tid`,
          `bản sao '${inst}' dùng template '${tid}', không phải '${items[i]!.tpl!.tid}'`,
        );
        return false;
      });
      if (!templates.has(tid)) {
        for (const i of members)
          err('E_TEMPLATE_REF', s.file, `/items/${i}/tpl/tid`, `không có template '${tid}'`);
        continue;
      }
      const doc = templates.get(tid);
      if (!doc) continue; // tệp template lỗi: đã báo
      let remap = tplItems.get(s.file);
      if (!remap) tplItems.set(s.file, (remap = new Map()));
      const byRid = new Map<string, TemplateDoc['items'][number]>();
      for (const t of doc.items) if (!byRid.has(t.id)) byRid.set(t.id, t);
      for (const i of members) {
        const { rid } = items[i]!.tpl!;
        remap.set(i, inst);
        if (!byRid.has(rid))
          err(
            'E_TEMPLATE_REF',
            s.file,
            `/items/${i}/tpl/rid`,
            `template '${tid}' không có item '${rid}'`,
          );
        if (items[i]!.id !== `${inst}.${rid}`)
          err('E_TEMPLATE_REF', s.file, `/items/${i}/id`, `id phải là '${inst}.${rid}'`);
      }
      // tham số của bản sao
      const carriers = members.filter((i) => items[i]!.tpl!.params !== undefined);
      const given = carriers.length ? items[carriers[0]!]!.tpl!.params : undefined;
      for (const i of carriers.slice(1))
        if (!jsonEqual(items[i]!.tpl!.params, given))
          err(
            'E_TEMPLATE_PARAM',
            s.file,
            `/items/${i}/tpl/params`,
            `mọi item của bản sao '${inst}' phải có cùng params`,
          );
      const params = doc.params ?? [];
      const at = carriers[0] ?? members[0]!;
      const r = resolveArgs(params, given);
      if (!r.ok) {
        for (const p of r.problems)
          err(
            'E_TEMPLATE_PARAM',
            s.file,
            `/items/${at}/tpl/params${p.path}`,
            `bản sao '${inst}': ${p.message}`,
          );
        continue;
      }
      // lệch so với template
      const seen = new Set<string>();
      for (const i of members) {
        const { rid } = items[i]!.tpl!;
        seen.add(rid);
        const t = byRid.get(rid);
        if (!t) continue;
        const e = substituteParams(t, params, r.values, { template: true });
        if (e.ok && !jsonEqual(own(e.value), own(items[i])))
          warn(
            'W_TEMPLATE_DRIFT',
            s.file,
            `/items/${i}`,
            `item khác template '${tid}' (bản sao '${inst}')`,
          );
      }
      for (const t of byRid.keys())
        if (!seen.has(t))
          warn(
            'W_TEMPLATE_DRIFT',
            s.file,
            `/items/${members[0]}`,
            `bản sao '${inst}' thiếu item '${t}' của template '${tid}'`,
          );
    }
  }

  // ---- gộp: đổi mã Tag của bản sao, thêm lỗi của bản bung (bỏ trùng) ----
  const itemOf = (path: string) => /^\/items\/(\d+)\/tags(\/|$)/.exec(path)?.[1];
  const out: Issue[] = base.errors.map((e) => {
    const i = itemOf(e.path);
    const inst = i === undefined ? undefined : tplItems.get(e.file)?.get(Number(i));
    return inst !== undefined && TAG_CODES.has(e.code)
      ? { ...e, code: 'E_TEMPLATE_TAG_REF' as const, message: `${e.message} (bản sao '${inst}')` }
      : e;
  });
  const outW: Issue[] = [...base.warnings];
  const key = (x: Issue) => `${x.code}|${x.file}|${x.path}`;
  const seenE = new Set(out.map(key));
  const seenW = new Set(outW.map(key));
  for (const x of expansions) {
    const label = `popup '${x.key}' với args ${JSON.stringify(x.values)}`;
    for (const e of x.errors) {
      const m = TAG_CODES.has(e.code)
        ? { ...e, code: 'E_TEMPLATE_TAG_REF' as const, message: `${label}: ${e.message}` }
        : { ...e, message: `${label}: ${e.message}` };
      if (seenE.has(key(m))) continue;
      seenE.add(key(m));
      out.push(m);
    }
    for (const w of x.warnings) {
      if (seenW.has(key(w))) continue;
      seenW.add(key(w));
      outW.push({ ...w, message: `${label}: ${w.message}` });
    }
  }
  return { errors: [...out, ...errors], warnings: [...outW, ...warnings] };
}
