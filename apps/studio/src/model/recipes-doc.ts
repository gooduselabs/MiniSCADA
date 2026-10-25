// Mô hình tài liệu của editor Recipe (feature 024, specs/024-recipes/spec.md US1): hàm thuần trên `RecipesConfig`, mỗi
// hàm cho ra cấu hình mới (người gọi gói thành MỘT sửa đổi `{ kind: 'recipes' }`, một bước hoàn tác). Giá trị sai luật
// (ngoài giới hạn…) vẫn ghi để bộ kiểm tra báo lỗi theo ô (E_RECIPE_*); chỉ Tag không ghi được bị từ chối ngay.
import {
  recipeValueFits,
  RECIPE_LIMITS,
  type Recipe,
  type RecipeParam,
  type RecipeRole,
  type RecipeType,
  type RecipeValue,
  type RecipesConfig,
} from '@mat/project-schema';
import { OFF_WORDS, ON_WORDS } from '../i18n/bool-words.ts';
import type { ProjectEdit } from './project-doc.ts';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const recipesEdit = (value: RecipesConfig): ProjectEdit => ({ kind: 'recipes', value });

/** Phần của Tag mà editor cần (TagV1 của tags.json). */
export interface RecipeTagInfo {
  id: string;
  type: string;
  kind?: string;
  access?: string;
  sim?: { kind?: string };
  unit?: string;
  description?: string;
  limits?: { min?: number; max?: number };
}

/** Tag ghi được bởi người (như `writable` của rules-03.ts). */
export const tagWritable = (t: RecipeTagInfo): boolean =>
  t.access === 'RW' &&
  t.kind !== 'calculated' &&
  (t.kind !== 'simulation' || t.sim?.kind === 'manual');

/** recipes.json mới mang phiên bản của project. */
export const emptyRecipes = (schemaVersion: string): RecipesConfig => ({
  schemaVersion,
  types: [],
});

/** Id không trùng theo mẫu `base`, `base-2`, `base-3`… */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const b = slug(base) || 'recipe';
  if (!set.has(b)) return b;
  for (let i = 2; ; i++) {
    const id = `${b.slice(0, 44)}-${i}`;
    if (!set.has(id)) return id;
  }
}

/** Chữ thường không dấu, gạch ngang (id từ tên). */
export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

// ---- loại ----------------------------------------------------------------------------------------------------------

export function addType(cfg: RecipesConfig, name: string): { cfg: RecipesConfig; index: number } {
  const next = clone(cfg);
  if (next.types.length >= RECIPE_LIMITS.types) return { cfg, index: -1 };
  const id = uniqueId(
    name,
    next.types.map((t) => t.id),
  );
  next.types.push({ id, name: name || id, params: [], recipes: [] });
  return { cfg: next, index: next.types.length - 1 };
}

export function removeType(cfg: RecipesConfig, i: number): RecipesConfig {
  const next = clone(cfg);
  next.types.splice(i, 1);
  return next;
}

export type TypeField = 'id' | 'name' | 'description';
export function setTypeField(
  cfg: RecipesConfig,
  i: number,
  f: TypeField,
  v: string,
): RecipesConfig {
  const next = clone(cfg);
  const t = next.types[i];
  if (!t) return cfg;
  if (f === 'description' && v === '') delete t.description;
  else t[f] = v;
  return next;
}

export function setSecurity(
  cfg: RecipesConfig,
  i: number,
  key: 'view' | 'operate' | 'edit',
  role: RecipeRole | undefined,
): RecipesConfig {
  const next = clone(cfg);
  const t = next.types[i];
  if (!t) return cfg;
  const sec = { ...(t.security ?? {}) };
  if (role === undefined) delete sec[key];
  else sec[key] = role;
  if (Object.keys(sec).length === 0) delete t.security;
  else t.security = sec;
  return next;
}

// ---- tham số -------------------------------------------------------------------------------------------------------

/** Giá trị mặc định của một tham số: min (của tham số, rồi của Tag) nếu có, không thì 0 / false / "". */
export function defaultValue(param: RecipeParam, tag: RecipeTagInfo | undefined): RecipeValue {
  const type = tag?.type ?? 'FLOAT64';
  if (type === 'BOOL') return false;
  if (type === 'STRING') return '';
  const lo = param.min ?? tag?.limits?.min;
  const hi = param.max ?? tag?.limits?.max;
  if (lo !== undefined) return lo;
  if (hi !== undefined && hi < 0) return hi;
  return 0;
}

export type AddParamResult =
  | { ok: true; cfg: RecipesConfig; added: string[] }
  | { ok: false; reason: 'readOnly' | 'missing' | 'duplicate' | 'limit'; tag: string };

/** Thêm Tag làm tham số của loại `i` (thứ tự giữ); mọi bản nhận giá trị mặc định. Tag chỉ đọc bị từ chối. */
export function addParams(
  cfg: RecipesConfig,
  i: number,
  tagIds: readonly string[],
  tags: ReadonlyMap<string, RecipeTagInfo>,
  at?: number,
): AddParamResult {
  const next = clone(cfg);
  const t = next.types[i];
  if (!t) return { ok: false, reason: 'missing', tag: '' };
  const added: string[] = [];
  let pos = at ?? t.params.length;
  for (const id of tagIds) {
    const tag = tags.get(id);
    if (!tag) return { ok: false, reason: 'missing', tag: id };
    if (!tagWritable(tag)) return { ok: false, reason: 'readOnly', tag: id };
    if (t.params.some((p) => p.tagId === id)) return { ok: false, reason: 'duplicate', tag: id };
    if (t.params.length >= RECIPE_LIMITS.params) return { ok: false, reason: 'limit', tag: id };
    const p: RecipeParam = { tagId: id };
    if (tag.unit) p.unit = tag.unit;
    if (tag.description) p.label = tag.description.slice(0, 60);
    t.params.splice(pos++, 0, p);
    for (const r of t.recipes) r.values[id] = defaultValue(p, tag);
    added.push(id);
  }
  return { ok: true, cfg: next, added };
}

export function removeParam(cfg: RecipesConfig, i: number, j: number): RecipesConfig {
  const next = clone(cfg);
  const t = next.types[i];
  const p = t?.params[j];
  if (!t || !p) return cfg;
  t.params.splice(j, 1);
  for (const r of t.recipes) delete r.values[p.tagId];
  return next;
}

export function moveParam(cfg: RecipesConfig, i: number, j: number, to: number): RecipesConfig {
  const next = clone(cfg);
  const ps = next.types[i]?.params;
  if (!ps || !ps[j] || to < 0 || to >= ps.length) return cfg;
  const [p] = ps.splice(j, 1);
  ps.splice(to, 0, p!);
  return next;
}

export type ParamField = 'label' | 'unit' | 'description' | 'min' | 'max' | 'decimals';
/** Đặt thuộc tính tham số; chuỗi rỗng bỏ khóa; số nhập sai bị bỏ qua (trả cấu hình cũ). */
export function setParamField(
  cfg: RecipesConfig,
  i: number,
  j: number,
  f: ParamField,
  text: string,
): RecipesConfig {
  const next = clone(cfg);
  const p = next.types[i]?.params[j] as unknown as Record<string, unknown> | undefined;
  if (!p) return cfg;
  const v = text.trim();
  if (v === '') delete p[f];
  else if (f === 'min' || f === 'max' || f === 'decimals') {
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || (f === 'decimals' && (!Number.isInteger(n) || n < 0 || n > 6)))
      return cfg;
    p[f] = n;
  } else p[f] = text;
  return next;
}

// ---- bản -----------------------------------------------------------------------------------------------------------

export function addRecipe(
  cfg: RecipesConfig,
  i: number,
  name: string,
  tags: ReadonlyMap<string, RecipeTagInfo>,
): { cfg: RecipesConfig; index: number } {
  const next = clone(cfg);
  const t = next.types[i];
  if (!t || t.recipes.length >= RECIPE_LIMITS.recipes) return { cfg, index: -1 };
  const values: Record<string, RecipeValue> = {};
  for (const p of t.params) values[p.tagId] = defaultValue(p, tags.get(p.tagId));
  const id = uniqueId(
    name,
    t.recipes.map((r) => r.id),
  );
  t.recipes.push({ id, name: name || id, values });
  return { cfg: next, index: t.recipes.length - 1 };
}

export function duplicateRecipe(
  cfg: RecipesConfig,
  i: number,
  k: number,
  copyName: string,
): { cfg: RecipesConfig; index: number } {
  const next = clone(cfg);
  const t = next.types[i];
  const r = t?.recipes[k];
  if (!t || !r || t.recipes.length >= RECIPE_LIMITS.recipes) return { cfg, index: -1 };
  const c: Recipe = clone(r);
  c.name = copyName.slice(0, 80);
  c.id = uniqueId(
    `${r.id}-copy`,
    t.recipes.map((x) => x.id),
  );
  t.recipes.splice(k + 1, 0, c);
  return { cfg: next, index: k + 1 };
}

export function removeRecipe(cfg: RecipesConfig, i: number, k: number): RecipesConfig {
  const next = clone(cfg);
  next.types[i]?.recipes.splice(k, 1);
  return next;
}

export function setRecipeField(
  cfg: RecipesConfig,
  i: number,
  k: number,
  f: 'id' | 'name' | 'description',
  v: string,
): RecipesConfig {
  const next = clone(cfg);
  const r = next.types[i]?.recipes[k];
  if (!r) return cfg;
  if (f === 'description' && v === '') delete r.description;
  else r[f] = v;
  return next;
}

/** Chữ của ô → giá trị theo kiểu Tag; null khi không đọc được (BOOL: 1/0, true/false, bật/tắt, có/không). */
export function parseValue(type: string, text: string): RecipeValue | null {
  const s = text.trim();
  if (type === 'STRING') return text;
  if (type === 'BOOL') {
    const l = s.toLowerCase();
    if (ON_WORDS.includes(l) || l === 'on') return true;
    if (OFF_WORDS.includes(l) || l === 'off' || l === '') return false;
    return null;
  }
  if (s === '') return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Hiển thị giá trị trong ô. */
export const formatValue = (v: RecipeValue | undefined): string =>
  v === undefined ? '' : typeof v === 'boolean' ? (v ? '1' : '0') : String(v);

/** Đặt giá trị một ô (chữ gõ vào); false khi chữ không hợp kiểu (người gọi báo, không ghi). */
export function setValue(
  cfg: RecipesConfig,
  i: number,
  k: number,
  tagId: string,
  type: string,
  text: string,
): RecipesConfig | null {
  const v = parseValue(type, text);
  if (v === null) return null;
  const next = clone(cfg);
  const r = next.types[i]?.recipes[k];
  if (!r) return null;
  r.values[tagId] = v;
  return next;
}

/** Lỗi ở ô (cho tô đỏ ngay, trước khi bộ kiểm tra chạy): sai kiểu hoặc ngoài giới hạn. */
export function cellProblem(
  p: RecipeParam,
  tag: RecipeTagInfo | undefined,
  v: RecipeValue | undefined,
): 'E_RECIPE_VALUE' | 'E_RECIPE_LIMIT' | null {
  if (v === undefined) return 'E_RECIPE_VALUE';
  if (!tag) return null;
  if (!recipeValueFits(tag.type, v)) return 'E_RECIPE_VALUE';
  if (typeof v !== 'number') return null;
  const lo = [p.min, tag.limits?.min].filter((x): x is number => x !== undefined);
  const hi = [p.max, tag.limits?.max].filter((x): x is number => x !== undefined);
  return lo.some((m) => v < m) || hi.some((m) => v > m) ? 'E_RECIPE_LIMIT' : null;
}

/**
 * Dán khối TSV (hàng × cột) bắt đầu ở tham số `j0`, bản `k0`. Ô thừa ra ngoài lưới bị bỏ; ô không đọc được trả trong
 * `bad` (vị trí 1-based theo khối dán) và không ghi.
 */
export function pasteBlock(
  cfg: RecipesConfig,
  i: number,
  j0: number,
  k0: number,
  text: string,
  tags: ReadonlyMap<string, RecipeTagInfo>,
): { cfg: RecipesConfig; bad: Array<[number, number]> } {
  const next = clone(cfg);
  const t = next.types[i];
  const bad: Array<[number, number]> = [];
  if (!t) return { cfg, bad };
  const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  rows.forEach((line, a) => {
    const p = t.params[j0 + a];
    if (!p) return;
    line.split('\t').forEach((cell, b) => {
      const r = t.recipes[k0 + b];
      if (!r) return;
      const v = parseValue(tags.get(p.tagId)?.type ?? 'FLOAT64', cell);
      if (v === null) bad.push([a + 1, b + 1]);
      else r.values[p.tagId] = v;
    });
  });
  return { cfg: next, bad };
}

// ---- CSV -----------------------------------------------------------------------------------------------------------
// Hàng 1: `tagId,<id bản>…`; hàng 2: `name,<tên bản>…`; mỗi hàng sau: một tham số (`<tagId>,<giá trị>…`).

const csvCell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function exportCsv(type: RecipeType): string {
  const lines = [
    ['tagId', ...type.recipes.map((r) => r.id)],
    ['name', ...type.recipes.map((r) => r.name)],
    ...type.params.map((p) => [
      p.tagId,
      ...type.recipes.map((r) => formatValue(r.values[p.tagId])),
    ]),
  ];
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Đọc CSV (RFC 4180, dấu phẩy hoặc chấm phẩy). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const sep =
    (src.split(/\r?\n/)[0] ?? '').includes(';') && !src.split(/\r?\n/)[0]!.includes(',')
      ? ';'
      : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let n = 0; n < src.length; n++) {
    const c = src[n]!;
    if (q) {
      if (c === '"') {
        if (src[n + 1] === '"') {
          cell += '"';
          n++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[n + 1] === '\n') n++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out.filter((r) => !(r.length === 1 && r[0] === ''));
}

export interface CsvError {
  line: number;
  column: number;
  code: 'header' | 'names' | 'tag' | 'notParam' | 'value' | 'id';
  text: string;
}

/**
 * Nhập CSV vào loại `i`: thay toàn bộ bản (theo cột) bằng nội dung tệp; tham số phải là tham số của loại (thứ tự hàng
 * tự do; tham số thiếu trong tệp nhận giá trị mặc định). Lỗi: trả `errors` (dòng, cột 1-based), không đổi gì.
 */
export function importCsv(
  cfg: RecipesConfig,
  i: number,
  text: string,
  tags: ReadonlyMap<string, RecipeTagInfo>,
): { ok: true; cfg: RecipesConfig } | { ok: false; errors: CsvError[] } {
  const t = cfg.types[i];
  const rows = parseCsv(text);
  const errors: CsvError[] = [];
  if (!t) return { ok: false, errors: [{ line: 1, column: 1, code: 'header', text: '' }] };
  if (rows[0]?.[0]?.trim() !== 'tagId')
    return {
      ok: false,
      errors: [{ line: 1, column: 1, code: 'header', text: rows[0]?.[0] ?? '' }],
    };
  if (rows[1]?.[0]?.trim() !== 'name')
    return { ok: false, errors: [{ line: 2, column: 1, code: 'names', text: rows[1]?.[0] ?? '' }] };
  const ids = rows[0].slice(1).map((s) => s.trim());
  const names = rows[1].slice(1);
  const seen = new Set<string>();
  ids.forEach((id, b) => {
    if (!ID_RE.test(id) || seen.has(id))
      errors.push({ line: 1, column: b + 2, code: 'id', text: id });
    seen.add(id);
  });
  const recipes: Recipe[] = ids.map((id, b) => {
    const values: Record<string, RecipeValue> = {};
    for (const p of t.params) values[p.tagId] = defaultValue(p, tags.get(p.tagId));
    return { id, name: names[b] ?? id, values };
  });
  rows.slice(2).forEach((row, a) => {
    const line = a + 3;
    const tagId = (row[0] ?? '').trim();
    const p = t.params.find((x) => x.tagId === tagId);
    if (!p) return errors.push({ line, column: 1, code: 'notParam', text: tagId });
    const type = tags.get(tagId)?.type ?? 'FLOAT64';
    ids.forEach((_, b) => {
      const v = parseValue(type, row[b + 1] ?? '');
      if (v === null) errors.push({ line, column: b + 2, code: 'value', text: row[b + 1] ?? '' });
      else recipes[b]!.values[tagId] = v;
    });
  });
  if (errors.length) return { ok: false, errors };
  const next = clone(cfg);
  next.types[i]!.recipes = recipes;
  return { ok: true, cfg: next };
}
