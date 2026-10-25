// Recipe của trang vận hành (feature 024, specs/024-recipes/plan.md mục API): đọc câu trả lời của máy chủ, so giá trị
// recipe với giá trị hiện tại trên PLC, danh sách thay đổi của hộp xác nhận, kiểm giá trị phía trang (máy chủ vẫn kiểm
// lại), và lớp gọi API (cookie phiên + `X-MAT-CSRF`). Thuần trừ `RecipeApi`.

export type RecipeValue = number | boolean | string;

export interface RecipeParam {
  tag: string;
  type: string;
  label?: string;
  unit?: string;
  description?: string;
  min?: number;
  max?: number;
  tagMin?: number;
  tagMax?: number;
  decimals?: number;
}

export interface RecipeItem {
  id: string;
  name: string;
  values: Record<string, RecipeValue>;
  origin: 'project' | 'device';
  updatedAt?: string;
  updatedBy?: string;
}

export interface RecipeType {
  id: string;
  name: string;
  description?: string;
  params: RecipeParam[];
  can: { operate: boolean; edit: boolean };
  recipes: RecipeItem[];
}

export interface RecipeList {
  rev: number;
  types: RecipeType[];
}

export interface CurrentValue {
  value: RecipeValue | null;
  quality: string;
}

export interface JobResult {
  tag: string;
  value: RecipeValue | null;
  status: 'pending' | 'ok' | 'failed' | 'skipped';
  code?: string;
  message?: string;
}

export interface Job {
  jobId: string;
  type: string;
  recipe: string;
  state: 'running' | 'done' | 'failed';
  results: JobResult[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const isValue = (v: unknown): v is RecipeValue =>
  typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

function values(v: unknown): Record<string, RecipeValue> {
  const out: Record<string, RecipeValue> = {};
  if (isObj(v)) for (const [k, x] of Object.entries(v)) if (isValue(x)) out[k] = x;
  return out;
}

function opt<T extends object>(o: T, key: string, v: unknown): void {
  if (v !== undefined) (o as Obj)[key] = v;
}

export function parseList(b: unknown): RecipeList {
  if (!isObj(b) || !Array.isArray(b.types)) throw new RecipeApiError(0, 'BAD_RESPONSE', {});
  return {
    rev: num(b.rev) ?? 0,
    types: b.types.filter(isObj).map((t) => {
      const can = isObj(t.can) ? t.can : {};
      const ty: RecipeType = {
        id: String(t.id ?? ''),
        name: String(t.name ?? t.id ?? ''),
        params: (Array.isArray(t.params) ? t.params : []).filter(isObj).map((p) => {
          const out: RecipeParam = { tag: String(p.tag ?? ''), type: String(p.type ?? '') };
          for (const k of ['label', 'unit', 'description'] as const) opt(out, k, str(p[k]));
          for (const k of ['min', 'max', 'tagMin', 'tagMax', 'decimals'] as const)
            opt(out, k, num(p[k]));
          return out;
        }),
        can: { operate: can.operate === true, edit: can.edit === true },
        recipes: (Array.isArray(t.recipes) ? t.recipes : []).filter(isObj).map((r) => {
          const out: RecipeItem = {
            id: String(r.id ?? ''),
            name: String(r.name ?? r.id ?? ''),
            values: values(r.values),
            origin: r.origin === 'device' ? 'device' : 'project',
          };
          opt(out, 'updatedAt', str(r.updatedAt));
          opt(out, 'updatedBy', str(r.updatedBy));
          return out;
        }),
      };
      opt(ty, 'description', str(t.description));
      return ty;
    }),
  };
}

export function parseCurrent(b: unknown): Record<string, CurrentValue> {
  const out: Record<string, CurrentValue> = {};
  if (!isObj(b) || !isObj(b.values)) return out;
  for (const [tag, v] of Object.entries(b.values))
    if (isObj(v))
      out[tag] = { value: isValue(v.value) ? v.value : null, quality: String(v.quality ?? 'BAD') };
  return out;
}

export function parseJob(b: unknown): Job {
  if (!isObj(b) || !Array.isArray(b.results)) throw new RecipeApiError(0, 'BAD_RESPONSE', {});
  const state = b.state === 'done' || b.state === 'failed' ? b.state : 'running';
  return {
    jobId: String(b.jobId ?? ''),
    type: String(b.type ?? ''),
    recipe: String(b.recipe ?? ''),
    state,
    results: b.results.filter(isObj).map((r) => {
      const s = r.status;
      const out: JobResult = {
        tag: String(r.tag ?? ''),
        value: isValue(r.value) ? r.value : null,
        status: s === 'ok' || s === 'failed' || s === 'skipped' ? s : 'pending',
      };
      opt(out, 'code', str(r.code));
      opt(out, 'message', str(r.message));
      return out;
    }),
  };
}

/** Giá trị hiển thị: số theo `decimals` (vắng: nguyên văn), BOOL Bật/Tắt, chuỗi nguyên văn. */
export function formatValue(p: RecipeParam, v: RecipeValue | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Bật' : 'Tắt';
  if (typeof v === 'number')
    return p.decimals !== undefined ? v.toFixed(p.decimals) : String(Math.round(v * 1e6) / 1e6);
  return v;
}

/** Hai giá trị bằng nhau theo số lẻ của tham số (số), so bằng với BOOL và chuỗi. */
export function sameValue(
  p: RecipeParam,
  a: RecipeValue | null | undefined,
  b: RecipeValue | null | undefined,
): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'number') {
    if (p.decimals !== undefined) return a.toFixed(p.decimals) === b.toFixed(p.decimals);
    return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}

export interface Change {
  param: RecipeParam;
  from: RecipeValue | null;
  to: RecipeValue;
}

/** Tham số mà tải xuống sẽ đổi (giá trị hiện tại khác hoặc không đọc được tốt), theo thứ tự của loại. */
export function changesOf(
  t: RecipeType,
  r: RecipeItem,
  current: Record<string, CurrentValue>,
): Change[] {
  const out: Change[] = [];
  for (const p of t.params) {
    const to = r.values[p.tag];
    if (to === undefined) continue;
    const c = current[p.tag];
    const from = c && c.quality === 'GOOD' ? c.value : null;
    if (!sameValue(p, from, to)) out.push({ param: p, from, to });
  }
  return out;
}

const INT: Record<string, [number, number]> = {
  INT16: [-32768, 32767],
  UINT16: [0, 65535],
  INT32: [-2147483648, 2147483647],
  UINT32: [0, 4294967295],
  INT64: [-(2 ** 63), 2 ** 63],
  UINT64: [0, 2 ** 64],
};

/** Như `recipeValueFits` của @mat/project-schema (không nhập gói đó để giữ nhỏ chunk của trang). */
export function valueFits(type: string, v: unknown): boolean {
  if (type === 'BOOL') return typeof v === 'boolean';
  if (type === 'STRING') return typeof v === 'string' && v.length <= 256;
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const r = INT[type];
  return r === undefined || (Number.isInteger(v) && v >= r[0] && v <= r[1]);
}

/** Lỗi của một giá trị: 'type' (sai kiểu), 'limit' (ngoài giới hạn tham số hoặc Tag), null khi hợp lệ. */
export function valueIssue(p: RecipeParam, v: unknown): 'type' | 'limit' | null {
  if (!valueFits(p.type, v)) return 'type';
  if (typeof v !== 'number') return null;
  for (const m of [p.min, p.tagMin]) if (m !== undefined && v < m) return 'limit';
  for (const m of [p.max, p.tagMax]) if (m !== undefined && v > m) return 'limit';
  return null;
}

/** Ô nhập (chuỗi) → giá trị theo kiểu Tag; undefined khi không đọc được. */
export function parseInput(p: RecipeParam, text: string): RecipeValue | undefined {
  if (p.type === 'STRING') return text;
  if (p.type === 'BOOL') {
    const t = text.trim().toLowerCase();
    if (['1', 'true', 'bật', 'bat', 'on'].includes(t)) return true;
    if (['0', 'false', 'tắt', 'tat', 'off'].includes(t)) return false;
    return undefined;
  }
  const t = text.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Giới hạn hiển thị của tham số ("10 … 80"), rỗng khi không có. */
export function limitText(p: RecipeParam): string {
  const lo = p.min ?? p.tagMin;
  const hi = p.max ?? p.tagMax;
  if (lo === undefined && hi === undefined) return '';
  return `${lo ?? '−∞'} … ${hi ?? '+∞'}`;
}

export class RecipeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Obj;
  constructor(status: number, code: string, body: Obj) {
    super(typeof body.message === 'string' ? body.message : code);
    this.name = 'RecipeApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
  /** RECIPE_BAD_QUALITY: Tag không đọc được. */
  get tags(): string[] {
    return Array.isArray(this.body.tags) ? this.body.tags.map(String) : [];
  }
  /** RECIPE_INVALID: Tag và mã. */
  get issues(): { tag: string; code: string }[] {
    return Array.isArray(this.body.issues)
      ? this.body.issues
          .filter(isObj)
          .map((i) => ({ tag: String(i.tag ?? ''), code: String(i.code ?? '') }))
      : [];
  }
}

export interface RecipeApiDeps {
  fetch?: typeof fetch;
  csrfHeaders: () => Record<string, string>;
  onUnauthorized?: () => void;
}

const BASE = '/api/v1/recipes';

export class RecipeApi {
  readonly #d: RecipeApiDeps;
  constructor(d: RecipeApiDeps) {
    this.#d = d;
  }
  async #call(path: string, body?: unknown): Promise<unknown> {
    const f = this.#d.fetch ?? fetch;
    const init: RequestInit = { cache: 'no-store', credentials: 'same-origin' };
    if (body !== undefined) {
      init.method = 'POST';
      init.headers = { 'Content-Type': 'application/json', ...this.#d.csrfHeaders() };
      init.body = JSON.stringify(body);
    }
    const res = await f(path, init);
    let b: unknown;
    try {
      b = await res.json();
    } catch {
      b = {};
    }
    if (!res.ok) {
      if (res.status === 401) this.#d.onUnauthorized?.();
      const o = isObj(b) ? b : {};
      throw new RecipeApiError(res.status, String(o.error ?? `HTTP_${res.status}`), o);
    }
    return b;
  }
  async list(): Promise<RecipeList> {
    return parseList(await this.#call(BASE));
  }
  async current(type: string): Promise<Record<string, CurrentValue>> {
    return parseCurrent(await this.#call(`${BASE}/current?type=${encodeURIComponent(type)}`));
  }
  async job(id: string): Promise<Job> {
    return parseJob(await this.#call(`${BASE}/jobs/${encodeURIComponent(id)}`));
  }
  async download(type: string, recipe: string): Promise<Job> {
    return parseJob(await this.#call(`${BASE}/download`, { type, recipe }));
  }
  async save(b: {
    type: string;
    id?: string;
    name: string;
    values: Record<string, RecipeValue>;
    rev: number;
  }): Promise<{ rev: number }> {
    const r = await this.#call(`${BASE}/save`, b);
    return { rev: num((r as Obj).rev) ?? b.rev + 1 };
  }
  async remove(type: string, id: string, rev: number): Promise<{ rev: number }> {
    const r = await this.#call(`${BASE}/delete`, { type, id, rev });
    return { rev: num((r as Obj).rev) ?? rev + 1 };
  }
  async capture(type: string, name: string, rev: number): Promise<{ rev: number }> {
    const r = await this.#call(`${BASE}/capture`, { type, name, rev });
    return { rev: num((r as Obj).rev) ?? rev + 1 };
  }
}
