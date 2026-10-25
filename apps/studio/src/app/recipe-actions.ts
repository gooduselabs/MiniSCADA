// Hành động Recipe của Studio (feature 024): nối `model/recipes-doc.ts` với app. Mỗi thao tác một `store.edit`.
import type { RecipesConfig } from '@mat/project-schema';
import { t } from '../i18n/index.ts';
import { addType, emptyRecipes, recipesEdit, type RecipeTagInfo } from '../model/recipes-doc.ts';
import type { StudioApp } from './app.ts';

/** recipes.json hiện có hoặc rỗng theo phiên bản của project. */
export function recipesOf(app: StudioApp): RecipesConfig {
  const o = app.store.state.outline;
  const v = (o.project as { schemaVersion?: unknown } | null)?.schemaVersion;
  return o.recipes ?? emptyRecipes(typeof v === 'string' ? v : '1.1.0');
}

/** Tag của project theo id (cho kiểu, giới hạn, quyền ghi). */
export function recipeTags(app: StudioApp): Map<string, RecipeTagInfo> {
  const list = (app.store.state.outline.tags?.tags ?? []) as unknown as RecipeTagInfo[];
  return new Map(list.map((x) => [x.id, x]));
}

/** Thêm một loại recipe và mở editor của nó. */
export function recipeAddType(app: StudioApp): void {
  const s = app.store.state;
  if (s.readOnly) return app.toast(t('reason.readOnly'));
  if (!s.outline.format11) return app.toast(t('rcp.need11'));
  const r = addType(recipesOf(app), t('rcp.newType'));
  if (r.index < 0) return app.toast(t('rcp.err.maxTypes'));
  app.store.edit([recipesEdit(r.cfg)]);
  app.openEditor(`recipe:${r.cfg.types[r.index]!.id}`);
}
