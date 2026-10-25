// Recipe (feature 024, specs/024-recipes/plan.md mục Hợp đồng): loại recipe là danh sách Tag tham số có giới hạn,
// bản recipe là giá trị của từng tham số. Khai bởi `recipesFile` của project.json 1.1.
export type RecipeRole = 'viewer' | 'operator' | 'engineer' | 'administrator';
export type RecipeValue = number | boolean | string;

export interface RecipeParam {
  tagId: string;
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  description?: string;
}

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  values: Record<string, RecipeValue>;
}

export interface RecipeType {
  id: string;
  name: string;
  description?: string;
  security?: { view?: RecipeRole; operate?: RecipeRole; edit?: RecipeRole };
  params: RecipeParam[];
  recipes: Recipe[];
}

export interface RecipesConfig {
  schemaVersion: string;
  types: RecipeType[];
}

export const RECIPE_LIMITS = { types: 32, params: 64, recipes: 200 } as const;
/** Kích thước tối đa của tệp logo báo cáo (E_RPT_LOGO). */
export const REPORT_LOGO_MAX_BYTES = 262144;

/** Miền giá trị của kiểu Tag số nguyên (giá trị recipe ngoài miền là E_RECIPE_VALUE). */
export const INT_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  INT16: [-32768, 32767],
  UINT16: [0, 65535],
  INT32: [-2147483648, 2147483647],
  UINT32: [0, 4294967295],
  INT64: [-(2 ** 63), 2 ** 63],
  UINT64: [0, 2 ** 64],
};

/**
 * Giá trị `v` hợp với kiểu Tag `type` (BOOL: boolean; số nguyên: số nguyên trong miền kiểu; FLOAT: số hữu hạn;
 * STRING: chuỗi). Dùng chung cho luật E_RECIPE_VALUE, Studio và trang vận hành.
 */
export function recipeValueFits(type: string, v: unknown): boolean {
  if (type === 'BOOL') return typeof v === 'boolean';
  if (type === 'STRING') return typeof v === 'string';
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const r = INT_RANGES[type];
  if (r === undefined) return true; // FLOAT32, FLOAT64
  return Number.isInteger(v) && v >= r[0] && v <= r[1];
}

/** JSON Pointer của một khóa (`~` → `~0`, `/` → `~1`). */
export const pointerKey = (k: string): string => k.replace(/~/g, '~0').replace(/\//g, '~1');
