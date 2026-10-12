// Editor Tag tính toán (feature 006, T185, ADR-016 điểm 4, FR-049, FR-047, mockup studio-tags.html v-vt): danh sách Tag tính toán
// bên trái; bên phải ô biểu thức (gợi ý, kiểm khi gõ, gạch lỗi: ui/editors/expression-input.ts), danh sách Tag đầu vào, xem
// trước kết quả với giá trị sống (Online), giá trị Mô phỏng (đang bật) hoặc giá trị mô phỏng một lần. Mỗi lần ngừng gõ ghi vào
// Tag (gộp các phím thành một bước hoàn tác); kéo Tag từ Details thả vào ô biểu thức.
import {
  buildCalcGraph,
  tokens,
  type CalcInput,
  type InputValue,
  type TagDataType,
  type ValueTable,
} from '@mat/expression';
import { html, nothing, type PropertyValues } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import {
  checkExpression,
  previewExpression,
  type AssistContext,
  type AssistTag,
  type ExprProblem,
} from '../../model/expression-assist.ts';
import { PRIORITY } from '../../model/live-subscriptions.ts';
import type { SimEntry } from '../../model/sim-engine.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './calc-tags-editor.css';
import './expression-input.ts';
import type { ExpressionInput } from './expression-input.ts';

/** Tag tính toán đang chọn theo StudioApp: giữ khi chuyển tab. */
const memory = new WeakMap<StudioApp, string>();

interface CalcRow {
  id: string;
  type: TagDataType;
  expression: string;
  /** Chỉ số dòng trong Bảng Tag. */
  row: number;
}

interface Base {
  tags: unknown;
  docs: readonly unknown[];
  assist: AssistTag[];
  tables: string[];
  valueTables: ValueTable[];
  calcs: CalcInput[];
  rows: CalcRow[];
}

const sameDocs = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((d, i) => d === b[i]);

const uniqueTagTokens = (expression: string): string[] => [
  ...new Set(
    tokens(expression)
      .filter((tk) => tk.kind === 'tag')
      .map((tk) => tk.text),
  ),
];

export class CalcTagsEditor extends AppElement {
  static override properties = { ticks: { state: true } };

  declare ticks: number;

  private offValues: (() => void) | null = null;
  private base: Base | null = null;
  private ctxCache: { base: Base; id: string; type: string; ctx: AssistContext } | null = null;
  private problemCache = new Map<string, ExprProblem | null>();
  private problemBase: Base | null = null;
  private loops = new Map<string, ExprProblem>();
  private snapshot: {
    tags: unknown;
    docs: readonly unknown[];
    second: number;
    map: ReadonlyMap<string, SimEntry>;
  } | null = null;
  private declared = '';

  constructor() {
    super();
    this.ticks = 0;
  }

  // ---------- Dữ liệu ----------

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || s.outline.version !== '0.2';
  }

  private baseOf(): Base {
    const o = this.app.store.state.outline;
    const docs = o.valueTables.map((v) => v.doc);
    const b = this.base;
    if (b && b.tags === o.tags && sameDocs(b.docs, docs)) return b;
    const rows: CalcRow[] = [];
    const assist: AssistTag[] = [];
    ((o.tags?.tags ?? []) as unknown as Array<Record<string, unknown>>).forEach((tag, row) => {
      if (typeof tag.id !== 'string') return;
      assist.push({ id: tag.id, type: String(tag.type) as TagDataType });
      if (tag.kind === 'calculated')
        rows.push({
          id: tag.id,
          type: String(tag.type) as TagDataType,
          expression: typeof tag.expression === 'string' ? tag.expression : '',
          row,
        });
    });
    this.base = {
      tags: o.tags,
      docs,
      assist,
      tables: o.valueTables.map((v) => v.name),
      valueTables: docs.flatMap((d) => (d ? [d as unknown as ValueTable] : [])),
      calcs: rows.map((r) => ({ id: r.id, inputs: uniqueTagTokens(r.expression) })),
      rows,
    };
    return this.base;
  }

  /** Tag tính toán đang chọn: theo lựa chọn của Bảng Tag, rồi theo lần chọn trước, rồi Tag đầu. */
  private current(): CalcRow | null {
    const base = this.baseOf();
    if (!base.rows.length) return null;
    const sel = this.app.store.state.selection;
    if (sel?.kind === 'tag') {
      const r = base.rows.find((x) => x.row === sel.row);
      if (r) return r;
    }
    const m = memory.get(this.app);
    return base.rows.find((x) => x.id === m) ?? base.rows[0]!;
  }

  private ctxFor(cur: CalcRow): AssistContext {
    const base = this.baseOf();
    const c = this.ctxCache;
    if (c && c.base === base && c.id === cur.id && c.type === cur.type) return c.ctx;
    const ctx: AssistContext = {
      tags: base.assist,
      tables: base.tables,
      target: cur.type,
      self: cur.id,
      calcs: base.calcs,
    };
    this.ctxCache = { base, id: cur.id, type: cur.type, ctx };
    return ctx;
  }

  /** Lỗi của biểu thức một Tag (cho dấu trong danh sách); nhớ theo biểu thức, dựng lại khi project đổi. */
  private problemOf(r: CalcRow): ExprProblem | null {
    const base = this.baseOf();
    if (this.problemBase !== base) {
      this.problemBase = base;
      this.problemCache = new Map();
      // Vòng tham chiếu và chuỗi quá sâu: một lần dựng đồ thị cho cả project (không dựng lại theo từng Tag).
      this.loops = new Map();
      for (const i of buildCalcGraph(base.calcs).issues) {
        const row = base.rows.find((x) => x.id === i.id);
        if (!row) continue;
        const span: [number, number] = [0, Array.from(row.expression).length];
        this.loops.set(
          i.id,
          i.code === 'E_EXPR_CYCLE'
            ? {
                code: i.code,
                span,
                message: t('expr.err.E_EXPR_CYCLE', {
                  text: '',
                  path: (i.cycle ?? []).join(' → '),
                }),
                ...(i.cycle ? { cycle: i.cycle } : {}),
              }
            : { code: i.code, span, message: t('expr.err.E_EXPR_DEPTH', { text: '', path: '' }) },
        );
      }
    }
    const loop = this.loops.get(r.id);
    if (loop) return loop;
    const key = `${r.id}|${r.type}|${r.expression}`;
    if (this.problemCache.has(key)) return this.problemCache.get(key)!;
    const p =
      r.expression.trim() === ''
        ? null
        : checkExpression(r.expression, {
            tags: base.assist,
            tables: base.tables,
            target: r.type,
          }).problem;
    this.problemCache.set(key, p);
    return p;
  }

  // ---------- Nguồn giá trị của xem trước ----------

  private source(): { kind: 'live' | 'sim'; read: (id: string) => InputValue | null } {
    const app = this.app;
    if (app.online())
      return {
        kind: 'live',
        read: (id) => {
          const v = app.session.values.get(id);
          if (!v) return null;
          if (v.quality === 'STALE')
            return { value: v.value, quality: 'BAD', reason: 'DISCONNECTED' };
          return {
            value: v.value,
            quality: v.quality,
            ...(v.reason !== undefined ? { reason: v.reason } : {}),
          };
        },
      };
    const entries = app.simulation.running ? app.simulation.engine.entries : this.once();
    return {
      kind: 'sim',
      read: (id) => {
        const e = entries.get(id);
        return e
          ? {
              value: e.value,
              quality: e.quality,
              ...(e.reason !== undefined ? { reason: e.reason } : {}),
            }
          : null;
      },
    };
  }

  /** Giá trị mô phỏng một lần (chưa bật Mô phỏng): tính lại mỗi giây và khi project đổi. */
  private once(): ReadonlyMap<string, SimEntry> {
    const o = this.app.store.state.outline;
    const second = Math.floor(Date.now() / 1000);
    const docs = o.valueTables.map((v) => v.doc);
    const c = this.snapshot;
    if (c && c.tags === o.tags && sameDocs(c.docs, docs) && c.second === second) return c.map;
    const map = this.app.simulation.snapshot(o, second * 1000);
    this.snapshot = { tags: o.tags, docs, second, map };
    return map;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void =>
    this.querySelector<ExpressionInput>('mat-expression-input')?.commitNow();

  protected override attached(): void {
    const app = this.app;
    app.hooks.commitPending = this.commitHook;
    this.offValues = app.subscribeValues(() => {
      if (app.valuesLive() || app.simulation.running) this.ticks++;
    });
    this.requestUpdate();
  }

  protected override detached(): void {
    const app = this.app;
    this.commitHook();
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
    this.offValues?.();
    this.offValues = null;
    this.declared = '';
    app.live.release('calc');
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const cur = this.current();
    const app = this.app;
    if (cur) {
      memory.set(app, cur.id);
      const sel = app.store.state.selection;
      if (!(sel?.kind === 'tag' && sel.row === cur.row)) app.select({ kind: 'tag', row: cur.row });
    }
    // Online: khai các Tag đầu vào của Tag đang chọn (ưu tiên như Bảng theo dõi) để chắc có giá trị.
    const ids = cur && app.online() ? uniqueTagTokens(cur.expression) : [];
    const key = ids.join('\n');
    if (key !== this.declared) {
      this.declared = key;
      if (ids.length) app.live.declare('calc', ids, PRIORITY.watch);
      else app.live.release('calc');
    }
  }

  // ---------- Lệnh ----------

  private select(row: CalcRow): void {
    memory.set(this.app, row.id);
    this.app.select({ kind: 'tag', row: row.row });
  }

  private add(): void {
    if (this.readOnly()) return;
    const app = this.app;
    const base = this.baseOf();
    const taken = new Set(base.assist.map((a) => a.id));
    let n = 1;
    while (taken.has(`CALC_${n}`)) n++;
    const id = `CALC_${n}`;
    const row = base.assist.length;
    app.store.edit([
      { kind: 'tagUpsert', tag: { id, kind: 'calculated', type: 'FLOAT64', expression: '' } },
    ]);
    memory.set(app, id);
    app.select({ kind: 'tag', row });
    void this.updateComplete.then(() =>
      this.querySelector<HTMLTextAreaElement>('textarea.ei-ta')?.focus(),
    );
  }

  /** Ghi biểu thức vào Tag (gộp các lần ngừng gõ liên tiếp thành một bước hoàn tác). */
  private commit(cur: CalcRow, value: string): void {
    if (this.readOnly()) return;
    const now = this.baseOf().rows.find((x) => x.id === cur.id);
    if (!now || now.expression === value) return;
    this.app.store.edit(
      [{ kind: 'tagField', index: now.row, field: 'expression', value }],
      `expr:${cur.id}`,
    );
  }

  private onListKey = (e: KeyboardEvent): void => {
    const rows = this.baseOf().rows;
    const cur = this.current();
    if (!cur || !rows.length) return;
    const i = rows.findIndex((r) => r.id === cur.id);
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(rows.length - 1, i + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else if (e.key === 'Enter') {
      e.preventDefault();
      this.querySelector<HTMLTextAreaElement>('textarea.ei-ta')?.focus();
      return;
    } else return;
    e.preventDefault();
    this.select(rows[next]!);
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('[data-role="calc-list"] [aria-selected="true"]')?.focus(),
    );
  };

  // ---------- Vẽ ----------

  private preview(cur: CalcRow, ctx: AssistContext) {
    const src = this.source();
    const p = previewExpression(cur.expression, ctx, src.read, this.baseOf().valueTables);
    const label = t(src.kind === 'live' ? 'calc.preview.source.live' : 'calc.preview.source.sim');
    const head = html`<h3>${icon('play')}${t('calc.preview')}</h3>
      <p class="help" data-role="preview-source">${label}</p>`;
    if (cur.expression.trim() === '')
      return html`<section class="cx-card" data-role="preview" aria-label=${t('calc.preview')}>
        ${head}
        <p class="help" data-role="preview-error">${t('calc.preview.error')}</p>
      </section>`;
    if (!p.ok)
      return html`<section class="cx-card" data-role="preview" aria-label=${t('calc.preview')}>
        ${head}
        <p class="err-text" data-role="preview-error" role="status">${t('calc.preview.error')}</p>
      </section>`;
    const tone = p.quality === 'GOOD' ? 'ok' : p.quality === 'BAD' ? 'err' : 'warn';
    return html`<section class="cx-card" data-role="preview" aria-label=${t('calc.preview')}>
      ${head}
      <p class="cx-result" data-role="preview-result" role="status">
        <span class="muted">${t('calc.preview.result')}</span> <b class="mono">${p.value ?? '—'}</b>
        <span class="chip ${tone}">${p.quality}</span
        >${p.reason ? html` <span class="muted">${p.reason}</span>` : nothing}
      </p>
      <h4>${t('calc.preview.inputs')}</h4>
      <ul class="cx-inputs" data-role="preview-inputs">
        ${p.inputs.map(
          (i) =>
            html`<li>
              <span class="mono">${i.id}</span>
              <span class="mono">${i.text}</span>
              <span
                class="chip ${i.quality === 'GOOD' ? 'ok' : i.quality === 'BAD' ? 'err' : 'warn'}"
                >${i.quality}</span
              >
              ${i.reason ? html`<span class="muted">${i.reason}</span>` : nothing}
            </li>`,
        )}
      </ul>
    </section>`;
  }

  private inputsBlock(cur: CalcRow) {
    const ids = uniqueTagTokens(cur.expression);
    const base = this.baseOf();
    const app = this.app;
    return html`<section class="cx-card" aria-label=${t('calc.inputs')}>
      <h3>${icon('fx')}${t('calc.inputs')} <span class="cnt">${ids.length}</span></h3>
      ${
        ids.length
          ? html`<ul class="cx-inputs" data-role="inputs">
              ${ids.map((id) => {
                const at = base.assist.findIndex((a) => a.id === id);
                const type = base.assist[at]?.type;
                return html`<li>
                  <button
                    class="tg-xref"
                    type="button"
                    ?disabled=${at < 0}
                    title=${at < 0 ? t('tagProps.inputMissing', { id }) : t('tagProps.gotoRef', { ref: id })}
                    @click=${() => (at >= 0 ? app.revealTag(at) : undefined)}
                  >
                    ${id}
                  </button>
                  ${type ? html`<span class="muted">${type}</span>` : nothing}
                </li>`;
              })}
            </ul>`
          : html`<p class="help" data-role="no-inputs">${t('calc.noInputs')}</p>`
      }
    </section>`;
  }

  protected override render() {
    const app = this.app;
    const base = this.baseOf();
    const ro = this.readOnly();
    if (app.store.state.outline.version !== '0.2')
      return html`<div class="ed ed-fill">
        <div class="empty">
          ${icon('fx', 'lg')}<b>${t('calc.title')}</b>
          <p>${t('calc.pageUnavailable')}</p>
        </div>
      </div>`;
    const cur = this.current();
    const ctx = cur ? this.ctxFor(cur) : null;
    return html`<div class="ed ed-fill cx">
      <div class="ed-head">
        <h2>${t('calc.title')}</h2>
        <span class="path">${app.store.state.outline.tagFile}</span>
        <span class="grow"></span>
        <span class="help">${t('calc.dragHint')}</span>
      </div>
      ${
        ro
          ? html`<div class="banner warn" role="status">
              ${icon('warn', 'warn')}
              <div>${t('calc.readOnly')}</div>
            </div>`
          : nothing
      }
      <div class="ed-tools" role="group" aria-label=${t('calc.title')}>
        <button
          class="tbtn"
          type="button"
          data-act="add"
          aria-disabled=${ro ? 'true' : nothing}
          title=${ro ? t('reason.readOnly') : t('calc.add')}
          @click=${() => this.add()}
        >
          ${icon('plus')}<span>${t('calc.add')}</span>
        </button>
        <span class="grow"></span>
        <span class="muted num" data-role="count" role="status"
          >${t('calc.count', { n: base.rows.length })}</span
        >
      </div>
      ${
        !cur || !ctx
          ? html`<div class="empty">
              ${icon('fx', 'lg')}<b>${t('calc.empty.title')}</b>
              <p>${t('calc.empty.text')}</p>
            </div>`
          : html`<div class="cx-body">
              <div class="cx-nav">
                <ul
                  class="cx-list"
                  data-role="calc-list"
                  role="listbox"
                  aria-label=${t('calc.list')}
                  @keydown=${this.onListKey}
                >
                  ${base.rows.map((r) => {
                    const sel = r.id === cur.id;
                    const bad = this.problemOf(r);
                    return html`<li
                      role="option"
                      class="cx-item ${sel ? 'sel' : ''}"
                      aria-selected=${sel ? 'true' : 'false'}
                      tabindex=${sel ? 0 : -1}
                      @click=${() => this.select(r)}
                    >
                      <span class="mono cx-id">${r.id}</span>
                      <span class="muted">${r.type}</span>
                      ${
                        bad
                          ? html`<span
                              class="cx-bad"
                              role="img"
                              aria-label=${bad.message}
                              title=${bad.message}
                              >${icon('err', 'err')}</span
                            >`
                          : nothing
                      }
                    </li>`;
                  })}
                </ul>
              </div>
              <div class="cx-main">
                <section class="cx-card" aria-label=${t('calc.expression')}>
                  <div class="cx-title">
                    <h3>${cur.id}</h3>
                    <span class="chip info">${cur.type}</span>
                    <span class="grow"></span>
                    <button
                      class="tbtn"
                      type="button"
                      data-act="rename"
                      aria-disabled=${ro ? 'true' : nothing}
                      @click=${() => (ro ? undefined : void app.run('tags.rename'))}
                    >
                      <span>${t('cmd.tags.rename')}</span>
                    </button>
                    <button
                      class="tbtn"
                      type="button"
                      data-act="open-tag"
                      title=${t('calc.open')}
                      @click=${() => app.revealTag(cur.row)}
                    >
                      ${icon('table')}<span>${t('calc.open')}</span>
                    </button>
                  </div>
                  <mat-expression-input
                    .app=${app}
                    .value=${cur.expression}
                    .assist=${ctx}
                    .disabled=${ro}
                    .label=${t('calc.expression')}
                    @expr-check=${(e: CustomEvent<{ problem: ExprProblem | null }>) => {
                      void e;
                      const v = (e.currentTarget as ExpressionInput).text;
                      this.commit(cur, v);
                    }}
                    @expr-commit=${(e: CustomEvent<{ value: string }>) => this.commit(cur, e.detail.value)}
                  ></mat-expression-input>
                </section>
                ${this.inputsBlock(cur)} ${this.preview(cur, ctx)}
              </div>
            </div>`
      }
    </div>`;
  }
}

customElements.define('mat-calc-tags-editor', CalcTagsEditor);

registerEditor({
  match: (id) => id === 'calc',
  render: (app) => html`<mat-calc-tags-editor .app=${app}></mat-calc-tags-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-calc-tags-editor': CalcTagsEditor;
  }
}
