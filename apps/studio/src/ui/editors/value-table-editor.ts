// Editor Bảng giá trị (feature 006, T187, FR-048, FR-046, data-model §3, mockup studio-tags.html v-vt): lưới mục (giá trị hoặc
// khoảng, chữ, màu; dòng mặc định ở cuối) trên lưới dùng chung, ô thử (gõ một giá trị, thấy chữ và màu), bộ chọn màu
// (`<input type="color">`) cho dòng đang chọn, lỗi theo ô (chồng nhau, khoảng rỗng, chữ dài, màu sai), "Dùng ở đâu".
// Mỗi lần xác nhận một ô là một sửa đổi `valueTableUpsert` (một bước hoàn tác).
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { styleMap } from 'lit/directives/style-map.js';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import { initialGrid, type GridState } from '../../model/grid/index.ts';
import {
  VT_MAX_ENTRIES,
  tableIssues,
  tryLookup,
  valueTableAdapter,
  type ValueTableAdapter,
} from '../../model/value-table-doc.ts';
import { whereUsedTable, xrefLocation, xrefText } from '../../model/xref.ts';
import { AppElement, icon } from '../base.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import { registerEditor } from '../registry.ts';
import './value-table-editor.css';

/** Ô chọn theo StudioApp và bảng: giữ khi chuyển tab. */
const memory = new WeakMap<StudioApp, Map<string, GridState>>();
const COLOR = /^#[0-9a-fA-F]{6}$/;

export class ValueTableEditor extends AppElement {
  static override properties = {
    tableName: { type: String },
    tryText: { state: true },
    ticks: { state: true },
  };

  declare tableName: string;
  declare tryText: string;
  declare ticks: number;

  private cache: { key: unknown[]; adapter: ValueTableAdapter } | null = null;

  constructor() {
    super();
    this.tableName = '';
    this.tryText = '';
    this.ticks = 0;
  }

  // ---------- Dữ liệu ----------

  private doc() {
    return (
      this.app.store.state.outline.valueTables.find((v) => v.name === this.tableName)?.doc ?? null
    );
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || s.outline.version !== '0.2';
  }

  private adapter(): ValueTableAdapter | null {
    const doc = this.doc();
    if (!doc) return null;
    const ro = this.readOnly();
    const key = [doc, ro];
    const c = this.cache;
    if (c && c.key[0] === key[0] && c.key[1] === key[1]) return c.adapter;
    const adapter = valueTableAdapter({ table: doc, readOnly: ro });
    this.cache = { key, adapter };
    return adapter;
  }

  private gridEl(): MatGrid | null {
    return this.querySelector<MatGrid>('mat-grid');
  }

  private gridState(): GridState {
    return memory.get(this.app)?.get(this.tableName) ?? initialGrid;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => this.gridEl()?.commitPending();

  protected override attached(): void {
    const app = this.app;
    app.hooks.commitPending = this.commitHook;
    app.setCommandHandler('edit.fillDown', () => this.gridEl()?.fillDownSelection());
    this.requestUpdate();
  }

  protected override detached(): void {
    const app = this.app;
    this.gridEl()?.commitPending();
    app.setCommandHandler('edit.fillDown', null);
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  // ---------- Sự kiện của lưới ----------

  private onGridState = (e: Event): void => {
    const state = (e as CustomEvent<{ state: GridState }>).detail.state;
    let m = memory.get(this.app);
    if (!m) memory.set(this.app, (m = new Map()));
    m.set(this.tableName, state);
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

  // ---------- Lệnh ----------

  private add(a: ValueTableAdapter): void {
    if (this.readOnly()) return;
    const r = a.append();
    if (!r.edits.length) {
      this.app.toast(t('vt.err.max'));
      return;
    }
    this.gridEl()?.commitPending();
    this.app.store.edit(r.edits);
    void this.updateComplete.then(() => this.gridEl()?.reveal({ row: r.row, col: 'value' }));
  }

  private deleteRows(a: ValueTableAdapter): void {
    const grid = this.gridEl();
    if (!grid || this.readOnly()) return;
    const rows = grid.selectedRows();
    if (!rows.length) {
      this.app.toast(t('vte.noSelection'));
      return;
    }
    this.app.store.edit(a.remove(rows));
    this.app.toast(t('tt.deletedMany', { n: rows.length }));
  }

  /** Dòng đang chọn (của adapter) hoặc null. */
  private currentRow(): number | null {
    const cell = this.gridState().cell;
    return cell ? cell.row : null;
  }

  private setColor(a: ValueTableAdapter, text: string): void {
    const row = this.currentRow();
    if (row === null || this.readOnly()) return;
    const r = a.apply([{ row, col: 'color', text }]);
    if (r.edits.length) this.app.store.edit(r.edits);
  }

  private goto(row: number, col: string): void {
    this.gridEl()?.reveal({ row, col });
  }

  // ---------- Vẽ ----------

  private tryBlock(doc: NonNullable<ReturnType<ValueTableEditor['doc']>>) {
    const r = tryLookup(doc, this.tryText);
    const invalid = r.kind === 'invalid';
    let body: unknown;
    if (r.kind === 'empty') body = html`<span class="help">${t('vte.try.hint')}</span>`;
    else if (r.kind === 'invalid')
      body = html`<span class="err-text">${t('vte.try.invalid')}</span>`;
    else if (r.kind === 'none') body = html`<span class="help">${t('vte.try.none')}</span>`;
    else
      body = html`${
        r.color
          ? html`<span
              class="vt-swatch"
              aria-hidden="true"
              style=${styleMap({ background: r.color })}
            ></span>`
          : nothing
      }<b>${t('vte.try.result', { text: r.text, label: r.label })}</b>${
        r.color ? html` <span class="mono muted">${r.color}</span>` : nothing
      }`;
    return html`<section class="vt-card" aria-label=${t('vte.try.title')}>
      <h3>${t('vte.try.title')}</h3>
      <input
        class="input sm mono"
        type="text"
        data-role="try"
        aria-label=${t('vte.try.label')}
        aria-invalid=${invalid ? 'true' : nothing}
        placeholder="12"
        autocomplete="off"
        spellcheck="false"
        .value=${live(this.tryText)}
        @input=${(e: Event) => (this.tryText = (e.target as HTMLInputElement).value)}
      />
      <p class="vt-result" data-role="try-result" role="status">${body}</p>
    </section>`;
  }

  private colorBlock(a: ValueTableAdapter) {
    const row = this.currentRow();
    const ro = this.readOnly();
    const current = row === null ? '' : a.text(row, 'color');
    const valid = COLOR.test(current);
    return html`<section class="vt-card" aria-label=${t('vte.color.title')}>
      <h3>${t('vte.color.title')}</h3>
      <div class="vt-colorrow">
        <input
          type="color"
          class="vt-picker"
          aria-label=${t('vte.color.picker')}
          ?disabled=${row === null || ro}
          .value=${live(valid ? current.toLowerCase() : '#000000')}
          @change=${(e: Event) => this.setColor(a, (e.target as HTMLInputElement).value)}
        />
        <span class="mono">${valid ? current : '—'}</span>
        <button
          class="tbtn"
          type="button"
          data-act="clear-color"
          aria-disabled=${row === null || ro || !current ? 'true' : nothing}
          @click=${() => (row === null || ro || !current ? undefined : this.setColor(a, ''))}
        >
          ${icon('x')}<span>${t('vte.color.clear')}</span>
        </button>
      </div>
      ${row === null ? html`<p class="help">${t('vte.color.noRow')}</p>` : nothing}
    </section>`;
  }

  private issuesBlock(a: ValueTableAdapter, issues: ReadonlyMap<string, readonly string[]>) {
    if (!issues.size) return nothing;
    const items = [...issues.entries()].flatMap(([key, list]) => {
      const [row, col] = key.split(':') as [string, string];
      return list.map((text) => ({ row: Number(row), col, text }));
    });
    return html`<section
      class="vt-card vt-issues"
      data-role="issues"
      role="alert"
      aria-label=${t('vte.issues.title')}
    >
      <h3>${icon('err', 'err')}${t('vte.issues.title')}</h3>
      <ul>
        ${items.map(
          (it) =>
            html`<li>
              <button
                class="tg-xref"
                type="button"
                title=${t('vte.issues.go', {
                  cell: t('vte.cell', {
                    row: it.row + 1,
                    col: a.columns.find((c) => c.key === it.col)?.label ?? it.col,
                  }),
                })}
                @click=${() => this.goto(it.row, it.col)}
              >
                ${t('vte.cell', { row: it.row + 1, col: a.columns.find((c) => c.key === it.col)?.label ?? it.col })}:
                ${it.text}
              </button>
            </li>`,
        )}
      </ul>
    </section>`;
  }

  private usedBlock() {
    const app = this.app;
    const refs = whereUsedTable(app.store.state.outline, this.tableName);
    return html`<section class="vt-card" aria-label=${t('vte.used.title')}>
      <h3>${icon('link')}${t('vte.used.title')} <span class="cnt">${refs.length}</span></h3>
      ${
        refs.length
          ? html`<ul class="xref">
              ${refs.map((e) => {
                const label = xrefText(e);
                return html`<li>
                  <button
                    class="tg-xref"
                    type="button"
                    title=${t('vte.used.goto', { ref: label })}
                    @click=${() => app.revealLocation(xrefLocation(e))}
                  >
                    ${label}
                  </button>
                </li>`;
              })}
            </ul>`
          : html`<p class="help">${t('vte.used.none')}</p>`
      }
    </section>`;
  }

  protected override render() {
    const doc = this.doc();
    const a = this.adapter();
    if (!doc || !a)
      return html`<div class="ed ed-fill">
        <div class="empty">${icon('list', 'lg')}<b>${t('vte.notFound')}</b></div>
      </div>`;
    const ro = this.readOnly();
    const grid = this.gridEl();
    const pos = grid?.currentPosition() ?? null;
    const issues = tableIssues(doc);
    return html`<div class="ed ed-fill vt">
      <div class="ed-head">
        <h2>${doc.name}</h2>
        <span class="path">value-tables/${doc.name}.json</span>
        <span class="grow"></span>
        <span class="help">${t('vte.help')}</span>
      </div>
      ${
        ro
          ? html`<div class="banner warn" role="status">
              ${icon('warn', 'warn')}
              <div>${t('tagTable.readOnlyBanner')}</div>
            </div>`
          : nothing
      }
      <div class="ed-tools" role="group" aria-label=${t('vte.tools')}>
        <button
          class="tbtn"
          type="button"
          data-act="add"
          aria-disabled=${ro ? 'true' : nothing}
          title=${ro ? t('reason.readOnly') : t('vte.add')}
          @click=${() => this.add(a)}
        >
          ${icon('plus')}<span>${t('vte.add')}</span>
        </button>
        <button
          class="tbtn"
          type="button"
          data-act="delete"
          aria-disabled=${ro || pos === null ? 'true' : nothing}
          title=${ro ? t('reason.readOnly') : pos === null ? t('vte.noSelection') : t('vte.delete')}
          @click=${() => this.deleteRows(a)}
        >
          ${icon('x')}<span>${t('vte.delete')}</span>
        </button>
        <span class="grow"></span>
        <span class="muted num" data-role="count" role="status"
          >${t('vte.count', { n: doc.entries.length, max: VT_MAX_ENTRIES })}</span
        >
      </div>
      <div class="vt-body">
        <div class="vt-gridwrap">
          <mat-grid
            .adapter=${a}
            .state=${this.gridState()}
            .label=${doc.name}
            .issues=${issues}
            .ticks=${this.ticks}
            @grid-state=${this.onGridState}
            @grid-edit=${this.onGridEdit}
            @grid-notice=${this.onGridNotice}
          ></mat-grid>
        </div>
        <div class="vt-side">
          ${this.tryBlock(doc)} ${this.colorBlock(a)} ${this.issuesBlock(a, issues)}
          ${this.usedBlock()}
        </div>
      </div>
      <p class="help vt-foot">${t('vte.foot')}</p>
    </div>`;
  }
}

customElements.define('mat-value-table-editor', ValueTableEditor);

registerEditor({
  match: (id) => id.startsWith('vt:'),
  render: (app, id) =>
    html`<mat-value-table-editor
      .app=${app}
      .tableName=${id.slice('vt:'.length)}
    ></mat-value-table-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-value-table-editor': ValueTableEditor;
  }
}
