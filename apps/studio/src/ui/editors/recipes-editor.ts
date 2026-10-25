// Editor Recipe (feature 024, specs/024-recipes/spec.md US1): ba vùng như IDE: Loại recipe (trái), lưới kiểu bảng tính
// (giữa: mỗi tham số một dòng, cột cố định Tham số/Tag/Đơn vị/Min/Max, mỗi bản recipe một cột; sửa tại ô, phím mũi tên,
// Enter, Tab, F2, Esc, dán khối TSV nhờ lưới dùng chung), Thuộc tính (phải: loại, tham số, bản đang chọn). Kéo Tag từ
// cây/Bảng Tag thả vào lưới thêm tham số. Ô lỗi (giới hạn, kiểu) tô đỏ với mã E_RECIPE_*. Mỗi thao tác là MỘT sửa đổi
// `{ kind: 'recipes' }` (một bước hoàn tác).
import type { RecipeRole, RecipeType, RecipesConfig } from '@mat/project-schema';
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { recipeAddType, recipeTags, recipesOf } from '../../app/recipe-actions.ts';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { initialGrid, type GridState } from '../../model/grid/index.ts';
import { decodeCsvBytes } from '../../model/grid/csv.ts';
import type {
  ApplyResult,
  CellChange,
  GridAdapter,
  GridColumn,
  Rejected,
} from '../../model/grid/types.ts';
import { locate } from '../../model/issue-map.ts';
import {
  addParams,
  addRecipe,
  cellProblem,
  duplicateRecipe,
  exportCsv,
  formatValue,
  importCsv,
  moveParam,
  parseValue,
  recipesEdit,
  removeParam,
  removeRecipe,
  removeType,
  setParamField,
  setRecipeField,
  setSecurity,
  setTypeField,
  type ParamField,
  type RecipeTagInfo,
} from '../../model/recipes-doc.ts';
import { AppElement, icon } from '../base.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import { registerEditor } from '../registry.ts';
import './recipes-editor.css';

const memory = new WeakMap<StudioApp, Map<string, GridState>>();
const FIXED = ['label', 'tag', 'unit', 'min', 'max'] as const;
const ROLES: readonly RecipeRole[] = ['viewer', 'operator', 'engineer', 'administrator'];
const recipeCol = (k: number): string => `r${k}`;
const recipeOfCol = (col: string): number | null =>
  /^r\d+$/.test(col) ? Number(col.slice(1)) : null;

const rej = (c: CellChange, reason: MessageKey): Rejected => ({
  row: c.row,
  ...(c.newIndex !== undefined ? { newIndex: c.newIndex } : {}),
  col: c.col,
  text: c.text,
  reason,
});

/** Lưới của một loại: dòng = tham số, cột = thuộc tính cố định + mỗi bản một cột. */
export function recipeGridAdapter(o: {
  cfg: RecipesConfig;
  index: number;
  tags: ReadonlyMap<string, RecipeTagInfo>;
  readOnly: boolean;
}): GridAdapter {
  const ty = o.cfg.types[o.index];
  const params = ty?.params ?? [];
  const recipes = ty?.recipes ?? [];
  const columns: GridColumn[] = [
    { key: 'label', label: t('rcp.col.label'), kind: 'text', width: 130 },
    { key: 'tag', label: t('rcp.col.tag'), kind: 'readonly', width: 140, mono: true },
    { key: 'unit', label: t('rcp.col.unit'), kind: 'text', width: 56 },
    { key: 'min', label: t('rcp.col.min'), kind: 'number', width: 56, end: true },
    { key: 'max', label: t('rcp.col.max'), kind: 'number', width: 56, end: true },
    ...recipes.map((r, k): GridColumn => ({
      key: recipeCol(k),
      label: r.name,
      kind: 'text',
      width: 92,
      end: true,
      csv: r.id,
    })),
  ];
  const text = (row: number, col: string): string => {
    const p = params[row];
    if (!p) return '';
    const k = recipeOfCol(col);
    if (k !== null) return formatValue(recipes[k]?.values[p.tagId]);
    switch (col) {
      case 'label':
        return p.label ?? '';
      case 'tag':
        return p.tagId;
      case 'unit':
        return p.unit ?? '';
      case 'min':
        return p.min === undefined ? '' : String(p.min);
      case 'max':
        return p.max === undefined ? '' : String(p.max);
      default:
        return '';
    }
  };
  const apply = (changes: readonly CellChange[]): ApplyResult => {
    if (o.readOnly) return { edits: [], rejected: changes.map((c) => rej(c, 'rcp.err.readOnly')) };
    let cfg = o.cfg;
    const rejected: Rejected[] = [];
    for (const c of changes) {
      const p = c.row === null ? undefined : params[c.row];
      if (c.row === null || !p) {
        rejected.push(rej(c, 'rcp.err.row'));
        continue;
      }
      const k = recipeOfCol(c.col);
      if (k !== null) {
        const r = recipes[k];
        const v = parseValue(o.tags.get(p.tagId)?.type ?? 'FLOAT64', c.text);
        if (!r || v === null) rejected.push(rej(c, 'rcp.err.value'));
        else {
          const next = JSON.parse(JSON.stringify(cfg)) as RecipesConfig;
          next.types[o.index]!.recipes[k]!.values[p.tagId] = v;
          cfg = next;
        }
        continue;
      }
      if (c.col === 'tag') {
        rejected.push(rej(c, 'rcp.err.readOnlyCell'));
        continue;
      }
      const next = setParamField(cfg, o.index, c.row, c.col as ParamField, c.text);
      if (next === cfg && c.text.trim() !== '' && (c.col === 'min' || c.col === 'max'))
        rejected.push(rej(c, 'rcp.err.number'));
      cfg = next;
    }
    return { edits: cfg === o.cfg ? [] : [recipesEdit(cfg)], rejected };
  };
  return {
    columns,
    maxRows: 64,
    rowCount: () => params.length,
    text,
    editable: (row, col) => !o.readOnly && !!params[row] && col !== 'tag',
    apply,
    remove: (rows) => {
      let cfg = o.cfg;
      for (const j of [...rows].sort((a, b) => b - a)) cfg = removeParam(cfg, o.index, j);
      return [recipesEdit(cfg)];
    },
    searchText: (row) => `${params[row]?.tagId ?? ''} ${params[row]?.label ?? ''}`,
  };
}

export class RecipesEditor extends AppElement {
  static override properties = {
    typeId: { type: String },
    dropping: { state: true },
    ticks: { state: true },
  };

  declare typeId: string;
  declare dropping: boolean;
  declare ticks: number;

  constructor() {
    super();
    this.typeId = '';
    this.dropping = false;
    this.ticks = 0;
  }

  // ---------- Dữ liệu ----------

  private cfg(): RecipesConfig {
    return recipesOf(this.app);
  }

  /** Chỉ số loại đang mở (loại đầu khi id trống hoặc không còn). */
  private index(): number {
    const types = this.cfg().types;
    const i = types.findIndex((x) => x.id === this.typeId);
    return i >= 0 ? i : types.length ? 0 : -1;
  }

  private type(): RecipeType | null {
    const i = this.index();
    return i < 0 ? null : (this.cfg().types[i] ?? null);
  }

  /** Lý do không sửa được (chỉ đọc, project chưa 1.1), hoặc null. */
  private blocked(): MessageKey | null {
    const s = this.app.store.state;
    if (s.readOnly) return 'reason.readOnly';
    if (!s.outline.format11) return 'rcp.need11';
    return null;
  }

  private gridEl(): MatGrid | null {
    return this.querySelector<MatGrid>('mat-grid');
  }

  private gridState(): GridState {
    return memory.get(this.app)?.get(this.typeId) ?? initialGrid;
  }

  private commit(cfg: RecipesConfig): void {
    this.gridEl()?.commitPending();
    this.app.store.edit([recipesEdit(cfg)]);
  }

  /** Lỗi theo ô: bộ kiểm tra (E_RECIPE_*) và kiểm ngay tại chỗ (giới hạn, kiểu). */
  private issues(ty: RecipeType, i: number): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const add = (k: string, m: string) => out.set(k, [...(out.get(k) ?? []), m]);
    const tags = recipeTags(this.app);
    ty.params.forEach((p, j) =>
      ty.recipes.forEach((r, k) => {
        const code = cellProblem(p, tags.get(p.tagId), r.values[p.tagId]);
        if (code)
          add(
            `${j}:${recipeCol(k)}`,
            `${code}: ${t(code === 'E_RECIPE_LIMIT' ? 'rcp.issue.limit' : 'rcp.issue.value')}`,
          );
      }),
    );
    const s = this.app.store.state;
    for (const issue of s.issues) {
      const loc = locate(issue, s.outline);
      if (loc.editor !== 'recipe' || loc.id !== ty.id || loc.param === undefined) continue;
      const col =
        loc.recipe !== undefined
          ? recipeCol(loc.recipe)
          : issue.path.endsWith('/min')
            ? 'min'
            : issue.path.endsWith('/max')
              ? 'max'
              : 'tag';
      const key = `${loc.param}:${col}`;
      if (!(out.get(key) ?? []).some((m) => m.startsWith(issue.code)))
        add(key, `${issue.code}: ${issue.message}`);
    }
    void i;
    return out;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => this.gridEl()?.commitPending();

  protected override attached(): void {
    this.app.hooks.commitPending = this.commitHook;
    this.requestUpdate();
  }

  protected override detached(): void {
    this.gridEl()?.commitPending();
    if (this.app.hooks.commitPending === this.commitHook) this.app.hooks.commitPending = undefined;
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override updated(): void {
    const loc = this.app.takeReveal('recipe');
    if (loc && loc.editor === 'recipe' && loc.param !== undefined)
      this.gridEl()?.reveal({
        row: loc.param,
        col: loc.recipe !== undefined ? recipeCol(loc.recipe) : 'label',
      });
  }

  private onGridState = (e: Event): void => {
    const state = (e as CustomEvent<{ state: GridState }>).detail.state;
    let m = memory.get(this.app);
    if (!m) memory.set(this.app, (m = new Map()));
    m.set(this.typeId, state);
    this.requestUpdate();
  };

  private onGridEdit = (e: Event): void => {
    this.app.store.edit(
      (e as CustomEvent<{ edits: Parameters<StudioApp['store']['edit']>[0] }>).detail.edits,
    );
  };

  private onGridNotice = (e: Event): void => {
    this.app.toast((e as CustomEvent<{ text: string }>).detail.text);
  };

  // ---------- Kéo Tag ----------

  private onDragOver = (e: DragEvent): void => {
    if (this.blocked() || !e.dataTransfer?.types?.includes('application/x-mat-tag')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.dropping = true;
  };

  private onDrop = (e: DragEvent): void => {
    this.dropping = false;
    const name = e.dataTransfer?.getData('application/x-mat-tag') ?? '';
    if (!name) return;
    e.preventDefault();
    this.addTags(
      name
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean),
    );
  };

  /** Thêm Tag làm tham số (kéo thả, ô "Thêm Tag"). */
  addTags(ids: readonly string[]): boolean {
    const i = this.index();
    if (i < 0 || this.blocked()) return false;
    const r = addParams(this.cfg(), i, ids, recipeTags(this.app));
    if (!r.ok) {
      this.app.toast(t(`rcp.reject.${r.reason}`, { tag: r.tag }));
      return false;
    }
    this.commit(r.cfg);
    this.app.toast(t('rcp.added', { n: r.added.length }));
    return true;
  }

  // ---------- Lệnh ----------

  private current(): { row: number | null; recipe: number | null } {
    const cell = this.gridState().cell;
    return { row: cell ? cell.row : null, recipe: cell ? recipeOfCol(cell.col) : null };
  }

  private addRecipe(): void {
    const i = this.index();
    if (i < 0 || this.blocked()) return;
    const ty = this.cfg().types[i]!;
    const r = addRecipe(
      this.cfg(),
      i,
      t('rcp.newRecipe', { n: ty.recipes.length + 1 }),
      recipeTags(this.app),
    );
    if (r.index < 0) return this.app.toast(t('rcp.err.maxRecipes'));
    this.commit(r.cfg);
    void this.updateComplete.then(() => this.gridEl()?.reveal({ row: 0, col: recipeCol(r.index) }));
  }

  private duplicate(): void {
    const i = this.index();
    const k = this.current().recipe;
    if (i < 0 || k === null || this.blocked()) return;
    const name = this.cfg().types[i]!.recipes[k]?.name ?? '';
    const r = duplicateRecipe(this.cfg(), i, k, t('rcp.copyName', { name }));
    if (r.index < 0) return this.app.toast(t('rcp.err.maxRecipes'));
    this.commit(r.cfg);
  }

  private removeRecipe(): void {
    const i = this.index();
    const k = this.current().recipe;
    if (i < 0 || k === null || this.blocked()) return;
    this.commit(removeRecipe(this.cfg(), i, k));
  }

  private removeParams(): void {
    const grid = this.gridEl();
    const i = this.index();
    if (!grid || i < 0 || this.blocked()) return;
    const rows = grid.selectedRows();
    if (!rows.length) return this.app.toast(t('rcp.noSelection'));
    let cfg = this.cfg();
    for (const j of [...rows].sort((a, b) => b - a)) cfg = removeParam(cfg, i, j);
    this.commit(cfg);
  }

  private move(delta: number): void {
    const i = this.index();
    const j = this.current().row;
    if (i < 0 || j === null || this.blocked()) return;
    const next = moveParam(this.cfg(), i, j, j + delta);
    if (next === this.cfg()) return;
    this.commit(next);
    void this.updateComplete.then(() => this.gridEl()?.reveal({ row: j + delta, col: 'label' }));
  }

  private removeType(): void {
    const i = this.index();
    if (i < 0 || this.blocked()) return;
    this.commit(removeType(this.cfg(), i));
  }

  private async exportCsv(): Promise<void> {
    const ty = this.type();
    if (!ty) return;
    const r = await this.app.csvSave(`${ty.id}.csv`, exportCsv(ty));
    if (r === null) return;
    this.app.toast(
      'error' in r
        ? t('rcp.csv.exportFailed', { reason: r.detail })
        : t('rcp.csv.exported', { name: r.name }),
    );
  }

  private async importCsv(): Promise<void> {
    const i = this.index();
    if (i < 0 || this.blocked()) return;
    const f = await this.app.csvOpen();
    if (f === null) return;
    if ('error' in f) return this.app.toast(t('rcp.csv.readFailed'));
    const { text } = decodeCsvBytes(f.bytes);
    const r = importCsv(this.cfg(), i, text, recipeTags(this.app));
    if (!r.ok) {
      const e = r.errors[0]!;
      this.app.toast(
        t('rcp.csv.error', {
          line: e.line,
          column: e.column,
          reason: t(`rcp.csv.err.${e.code}`),
          n: r.errors.length,
        }),
      );
      return;
    }
    this.commit(r.cfg);
    this.app.toast(t('rcp.csv.imported', { n: r.cfg.types[i]!.recipes.length }));
  }

  // ---------- Vẽ ----------

  private tool(
    act: string,
    ic: Parameters<typeof icon>[0],
    label: string,
    reason: string | null,
    run: () => void,
  ) {
    return html`<button
      class="tbtn"
      type="button"
      data-act=${act}
      aria-disabled=${reason ? 'true' : nothing}
      title=${reason ?? label}
      @click=${() => (reason ? this.app.toast(reason) : run())}
    >
      ${icon(ic)}<span>${label}</span>
    </button>`;
  }

  private typeList(cfg: RecipesConfig, i: number, blocked: MessageKey | null) {
    return html`<nav class="rc-types" aria-label=${t('rcp.types')}>
      <div class="rc-pane-head">
        <h3>${t('rcp.types')}</h3>
        <button
          class="tbtn icon"
          type="button"
          data-act="add-type"
          aria-label=${t('rcp.addType')}
          title=${blocked ? t(blocked) : t('rcp.addType')}
          aria-disabled=${blocked ? 'true' : nothing}
          @click=${() => recipeAddType(this.app)}
        >
          ${icon('plus')}
        </button>
      </div>
      <ul role="listbox" aria-label=${t('rcp.types')}>
        ${cfg.types.map(
          (ty, n) =>
            html`<li
              role="option"
              tabindex="0"
              aria-selected=${n === i ? 'true' : 'false'}
              class=${n === i ? 'on' : ''}
              data-type=${ty.id}
              @click=${() => this.app.openEditor(`recipe:${ty.id}`)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  this.app.openEditor(`recipe:${ty.id}`);
                }
              }}
            >
              ${icon('recipe')}
              <span class="rc-tname">${ty.name}</span>
              <span class="muted num">${ty.recipes.length}</span>
            </li>`,
        )}
      </ul>
      ${cfg.types.length === 0 ? html`<p class="help">${t('rcp.noTypes')}</p>` : nothing}
    </nav>`;
  }

  private field(
    label: string,
    id: string,
    value: string,
    disabled: boolean,
    onChange: (v: string) => void,
    opts: { mono?: boolean; num?: boolean } = {},
  ) {
    return html`<div class="rc-field">
      <label for=${`rc-${id}`}>${label}</label>
      <input
        id=${`rc-${id}`}
        class="input sm ${opts.mono ? 'mono' : ''}"
        type="text"
        inputmode=${opts.num ? 'decimal' : nothing}
        ?disabled=${disabled}
        spellcheck="false"
        .value=${live(value)}
        @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
      />
    </div>`;
  }

  private roleSelect(
    i: number,
    key: 'view' | 'operate' | 'edit',
    ty: RecipeType,
    disabled: boolean,
  ) {
    const cur = ty.security?.[key];
    const def = key === 'view' ? 'viewer' : 'operator';
    const roles = key === 'view' ? ROLES : ROLES.slice(1);
    return html`<div class="rc-field">
      <label for=${`rc-sec-${key}`}>${t(`rcp.sec.${key}`)}</label>
      <select
        id=${`rc-sec-${key}`}
        class="input sm"
        ?disabled=${disabled}
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          this.commit(setSecurity(this.cfg(), i, key, v === '' ? undefined : (v as RecipeRole)));
        }}
      >
        <option value="" ?selected=${cur === undefined}>
          ${t('rcp.sec.default', { role: t(`rcp.role.${def}`) })}
        </option>
        ${roles.map((r) => html`<option value=${r} ?selected=${cur === r}>${t(`rcp.role.${r}`)}</option>`)}
      </select>
    </div>`;
  }

  private props(ty: RecipeType, i: number, blocked: MessageKey | null) {
    const dis = blocked !== null;
    const { row, recipe } = this.current();
    const p = row === null ? undefined : ty.params[row];
    const r = recipe === null ? undefined : ty.recipes[recipe];
    const tag = p ? recipeTags(this.app).get(p.tagId) : undefined;
    const set = (f: 'name' | 'id' | 'description') => (v: string) =>
      this.commit(setTypeField(this.cfg(), i, f, v));
    return html`<aside class="rc-props" aria-label=${t('rcp.props')}>
      <section class="rc-card" data-role="type-props">
        <h3>${icon('recipe')} ${t('rcp.props.type')}</h3>
        ${this.field(t('rcp.f.name'), 'type-name', ty.name, dis, set('name'))}
        ${this.field(t('rcp.f.id'), 'type-id', ty.id, dis, set('id'), { mono: true })}
        ${this.field(t('rcp.f.description'), 'type-desc', ty.description ?? '', dis, set('description'))}
        <h4>${t('rcp.sec.title')}</h4>
        ${this.roleSelect(i, 'view', ty, dis)} ${this.roleSelect(i, 'operate', ty, dis)}
        ${this.roleSelect(i, 'edit', ty, dis)}
        <p class="help">${t('rcp.sec.help')}</p>
      </section>
      ${
        p && row !== null
          ? html`<section class="rc-card" data-role="param-props">
              <h3>${icon('tag')} ${t('rcp.props.param')}</h3>
              <p class="mono rc-tagline">
                ${p.tagId} <span class="muted">${tag?.type ?? t('rcp.tag.unknown')}</span>
              </p>
              ${(['label', 'unit', 'min', 'max', 'decimals', 'description'] as const).map((f) =>
                this.field(
                  t(`rcp.f.${f}`),
                  `param-${f}`,
                  p[f] === undefined ? '' : String(p[f]),
                  dis,
                  (v) => {
                    const next = setParamField(this.cfg(), i, row, f, v);
                    if (next === this.cfg() && v.trim() !== '') this.app.toast(t('rcp.err.number'));
                    else this.commit(next);
                  },
                  { num: f === 'min' || f === 'max' || f === 'decimals' },
                ),
              )}
              ${
                tag?.limits && (tag.limits.min !== undefined || tag.limits.max !== undefined)
                  ? html`<p class="help">
                      ${t('rcp.tagLimits', { min: tag.limits.min ?? '−∞', max: tag.limits.max ?? '+∞' })}
                    </p>`
                  : nothing
              }
            </section>`
          : nothing
      }
      ${
        r && recipe !== null
          ? html`<section class="rc-card" data-role="recipe-props">
              <h3>${icon('list')} ${t('rcp.props.recipe')}</h3>
              ${this.field(t('rcp.f.name'), 'recipe-name', r.name, dis, (v) => this.commit(setRecipeField(this.cfg(), i, recipe, 'name', v)))}
              ${this.field(t('rcp.f.id'), 'recipe-id', r.id, dis, (v) => this.commit(setRecipeField(this.cfg(), i, recipe, 'id', v)), { mono: true })}
              ${this.field(t('rcp.f.description'), 'recipe-desc', r.description ?? '', dis, (v) => this.commit(setRecipeField(this.cfg(), i, recipe, 'description', v)))}
            </section>`
          : nothing
      }
      ${!p && !r ? html`<p class="help rc-hint">${t('rcp.props.hint')}</p>` : nothing}
    </aside>`;
  }

  protected override render() {
    const s = this.app.store.state;
    const cfg = this.cfg();
    const i = this.index();
    const blocked = this.blocked();
    const reason = blocked ? t(blocked) : null;
    const file = s.outline.recipesFile ?? 'recipes.json';
    if (i < 0)
      return html`<div class="ed ed-fill rc">
        <div class="ed-head">
          <h2>${t('tree.recipes')}</h2>
          <span class="path">${file}</span>
        </div>
        <div class="empty" data-role="empty">
          ${icon('recipe', 'lg')}<b>${t('rcp.empty.title')}</b>
          <p class="help">${blocked ? t(blocked) : t('rcp.empty.help')}</p>
          ${this.tool('add-type', 'plus', t('rcp.addType'), reason, () => recipeAddType(this.app))}
        </div>
      </div>`;
    const ty = cfg.types[i]!;
    const tags = recipeTags(this.app);
    const a = recipeGridAdapter({ cfg, index: i, tags, readOnly: blocked !== null });
    const issues = this.issues(ty, i);
    const cur = this.current();
    const noRecipe = cur.recipe === null ? t('rcp.pickRecipe') : null;
    const noRow = cur.row === null ? t('rcp.noSelection') : null;
    return html`<div class="ed ed-fill rc">
      <div class="ed-head">
        <h2>${ty.name}</h2>
        <span class="path">${file} › ${ty.id}</span>
        <span class="grow"></span>
        <span class="help">${t('rcp.help')}</span>
      </div>
      ${
        blocked
          ? html`<div class="banner warn" role="status">
              ${icon('warn', 'warn')}
              <div>${t(blocked)}</div>
            </div>`
          : nothing
      }
      <div class="ed-tools" role="group" aria-label=${t('rcp.tools')}>
        ${this.tool('add-recipe', 'plus', t('rcp.addRecipe'), reason, () => this.addRecipe())}
        ${this.tool('dup-recipe', 'paste', t('rcp.dupRecipe'), reason ?? noRecipe, () => this.duplicate())}
        ${this.tool('del-recipe', 'trash', t('rcp.delRecipe'), reason ?? noRecipe, () => this.removeRecipe())}
        <span class="sep" aria-hidden="true"></span>
        ${this.tool('up', 'forward', t('rcp.up'), reason ?? noRow, () => this.move(-1))}
        ${this.tool('down', 'backward', t('rcp.down'), reason ?? noRow, () => this.move(1))}
        ${this.tool('del-param', 'x', t('rcp.delParam'), reason ?? noRow, () => this.removeParams())}
        <span class="sep" aria-hidden="true"></span>
        ${this.tool('import', 'import', t('rcp.importCsv'), reason, () => void this.importCsv())}
        ${this.tool('export', 'export', t('rcp.exportCsv'), null, () => void this.exportCsv())}
        ${this.tool('del-type', 'trash', t('rcp.delType'), reason, () => this.removeType())}
        <span class="grow"></span>
        <span class="muted num" data-role="count" role="status"
          >${t('rcp.count', { p: ty.params.length, r: ty.recipes.length })}</span
        >
      </div>
      <div class="rc-body">
        ${this.typeList(cfg, i, blocked)}
        <div
          class="rc-gridwrap ${this.dropping ? 'drop' : ''}"
          data-role="drop"
          @dragover=${this.onDragOver}
          @dragleave=${() => (this.dropping = false)}
          @drop=${this.onDrop}
        >
          ${
            ty.params.length === 0
              ? html`<div class="rc-dropzone" data-role="dropzone">
                  ${icon('tag', 'lg')}<b>${t('rcp.drop.title')}</b>
                  <p class="help">${t('rcp.drop.help')}</p>
                </div>`
              : html`<mat-grid
                  .adapter=${a}
                  .state=${this.gridState()}
                  .label=${ty.name}
                  .issues=${issues}
                  .ticks=${this.ticks}
                  .dragColumn=${'tag'}
                  @grid-state=${this.onGridState}
                  @grid-edit=${this.onGridEdit}
                  @grid-notice=${this.onGridNotice}
                ></mat-grid>`
          }
        </div>
        ${this.props(ty, i, blocked)}
      </div>
      <p class="help rc-foot">${t('rcp.foot')}</p>
    </div>`;
  }
}

customElements.define('mat-recipes-editor', RecipesEditor);

registerEditor({
  match: (id) => id === 'recipes' || id.startsWith('recipe:'),
  render: (app, id) =>
    html`<mat-recipes-editor
      .app=${app}
      .typeId=${id.startsWith('recipe:') ? id.slice('recipe:'.length) : ''}
    ></mat-recipes-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-recipes-editor': RecipesEditor;
  }
}

// FIXED dùng cho test (thứ tự cột cố định).
export const RECIPE_FIXED_COLUMNS = FIXED;
