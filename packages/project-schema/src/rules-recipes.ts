// Luật recipes.json (feature 024; thứ tự và vị trí: specs/024-recipes/plan.md mục Hợp đồng). Bản C++ cho cùng mã và
// vị trí trên tests/project-vectors (v11-recipe-*): core/project-manager/rules_recipes.cpp.
import { SUPPORTED_SCHEMA_11, type ErrorCode, type Issue } from './codes.ts';
import { pointerKey, recipeValueFits, type RecipesConfig } from './recipes.ts';
import { writable } from './rules-03.ts';
import type { TagV1 } from './types-02.ts';

export interface RecipeRuleInput {
  project: { schemaVersion: string; recipesFile?: string };
  /** recipes.json đã qua schema; undefined khi không có hoặc lỗi (luật dưới bỏ qua). */
  recipes: RecipesConfig | undefined;
  /** Tag của tags.json; undefined khi tags.json lỗi (luật cần Tag bỏ qua). */
  tags: readonly TagV1[] | undefined;
}

const isNumericType = (t: string) => t !== 'BOOL' && t !== 'STRING';

export function recipeRules(input: RecipeRuleInput): Issue[] {
  const out: Issue[] = [];
  const { project, recipes } = input;
  const file = project.recipesFile;
  if (file === undefined) return out;
  if (!SUPPORTED_SCHEMA_11.test(project.schemaVersion)) {
    out.push({
      code: 'E_RECIPE_VERSION',
      file: 'project.json',
      path: '/recipesFile',
      message: 'recipesFile cần định dạng 1.1',
    });
    return out;
  }
  if (!recipes) return out;
  const add = (code: ErrorCode, path: string, message: string) =>
    out.push({ code, file, path, message });
  if (recipes.schemaVersion !== project.schemaVersion)
    add(
      'E_SCHEMA_VERSION',
      '/schemaVersion',
      `schemaVersion ${recipes.schemaVersion} khác project ${project.schemaVersion}`,
    );
  const byId = input.tags ? new Map(input.tags.map((t) => [t.id, t])) : undefined;

  const typeIds = new Set<string>();
  recipes.types.forEach((ty, i) => {
    const tp = `/types/${i}`;
    if (typeIds.has(ty.id)) add('E_RECIPE_DUP_ID', `${tp}/id`, `loại '${ty.id}' bị trùng`);
    typeIds.add(ty.id);

    // tham số
    const params = new Map<string, { tag: TagV1 | undefined; min?: number; max?: number }>();
    ty.params.forEach((p, j) => {
      const pp = `${tp}/params/${j}`;
      if (params.has(p.tagId)) {
        add('E_RECIPE_DUP_ID', `${pp}/tagId`, `Tag '${p.tagId}' đã là tham số`);
        return;
      }
      const tag = byId?.get(p.tagId);
      params.set(p.tagId, {
        tag,
        ...(p.min !== undefined ? { min: p.min } : {}),
        ...(p.max !== undefined ? { max: p.max } : {}),
      });
      if (!byId) return;
      if (!tag) return add('E_RECIPE_TAG', `${pp}/tagId`, `không có Tag '${p.tagId}'`);
      if (!writable(tag))
        return add('E_RECIPE_TAG_RW', `${pp}/tagId`, `Tag '${p.tagId}' không ghi được`);
      if (!isNumericType(tag.type)) {
        if (p.min !== undefined) add('E_RECIPE_LIMIT', `${pp}/min`, 'min chỉ dùng cho Tag số');
        else if (p.max !== undefined) add('E_RECIPE_LIMIT', `${pp}/max`, 'max chỉ dùng cho Tag số');
      } else if (p.min !== undefined && p.max !== undefined && p.min > p.max)
        add('E_RECIPE_LIMIT', `${pp}/max`, 'max nhỏ hơn min');
    });

    // bản
    const recipeIds = new Set<string>();
    ty.recipes.forEach((r, k) => {
      const rp = `${tp}/recipes/${k}`;
      if (recipeIds.has(r.id)) add('E_RECIPE_DUP_ID', `${rp}/id`, `bản '${r.id}' bị trùng`);
      recipeIds.add(r.id);
      for (const key of Object.keys(r.values))
        if (!params.has(key))
          add('E_RECIPE_VALUE', `${rp}/values/${pointerKey(key)}`, `'${key}' không là tham số`);
      for (const [tagId, prm] of params) {
        if (byId && !prm.tag) continue; // E_RECIPE_TAG đã báo
        if (!Object.prototype.hasOwnProperty.call(r.values, tagId)) {
          add('E_RECIPE_VALUE', `${rp}/values`, `thiếu giá trị của '${tagId}'`);
          continue;
        }
        if (!prm.tag) continue; // tags.json lỗi: không biết kiểu
        const v = r.values[tagId];
        const vp = `${rp}/values/${pointerKey(tagId)}`;
        if (!recipeValueFits(prm.tag.type, v)) {
          add('E_RECIPE_VALUE', vp, `giá trị không hợp kiểu ${prm.tag.type}`);
          continue;
        }
        if (typeof v !== 'number') continue;
        const lo = [prm.min, prm.tag.limits?.min].filter((x): x is number => x !== undefined);
        const hi = [prm.max, prm.tag.limits?.max].filter((x): x is number => x !== undefined);
        if (lo.some((m) => v < m) || hi.some((m) => v > m))
          add('E_RECIPE_LIMIT', vp, `giá trị ${v} ngoài giới hạn`);
      }
    });
  });
  return out;
}
