// Trình soạn bố cục lưới (feature 012, T028; US1, FR-016 đến FR-023; specs/012-screen-grid-layout/plan.md). Vẽ màn hình
// bằng <mat-screen mode="edit"> (cùng cách hiển thị với trang vận hành) và đặt lớp phủ vào slot `cell-<id>` của từng ô:
// chọn ô, vùng thả widget, đường chia cột. Thanh công cụ: Thêm hàng theo mẫu cột, thuộc tính ô và hàng, chiều rộng xem
// trước, chế độ xem trước. Mọi sửa đổi đi qua `app.editScreen` (một bước hoàn tác; lý do từ chối hiện ở toast).
import {
  catalogWidget,
  GRID_COLUMNS,
  type CellAlign,
  type GridCell,
  type GridLayout,
  type GridRow,
  type ScreenModel,
} from '@mat/project-schema';
import { MemoryTagSource, registerScreen } from '@mat/ui-components';
import { html, nothing, type TemplateResult } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  addCell,
  addRow,
  attachWidget,
  GRID_PRESETS,
  moveCell,
  moveRow,
  removeCell,
  removeRow,
  replaceWidget,
  resizeDivider,
  setCellProps,
  setRowProps,
} from '../../model/grid-ops.ts';
import { hostTagInfo } from '../../model/preview-hosts.ts';
import { remove } from '../../model/screen-doc.ts';
import { AppElement, icon } from '../base.ts';
import './mat-grid-editor.css';

registerScreen();

/** Chiều rộng xem trước (FR-023). */
export const PREVIEW_WIDTHS = [1920, 1366, 600] as const;
/** Chiều cao khi bỏ "Tự động" của hàng. */
const FIXED_ROW_HEIGHT = 240;

type GridDoc = ScreenModel & { layout: GridLayout };

interface CellAt {
  row: GridRow;
  r: number;
  cell: GridCell;
  c: number;
}

const WIDGET_TYPE = 'application/x-mat-widget-';
const SYMBOL_TYPE = 'application/x-mat-symbol-';
const TAG_TYPE = 'application/x-mat-tag';

export class MatGridEditor extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    selCell: { state: true },
    overCell: { state: true },
    presetsOpen: { state: true },
    previewWidth: { state: true },
  };
  declare screenId: string;
  declare selCell: string | null;
  declare overCell: string | null;
  declare presetsOpen: boolean;
  declare previewWidth: number;

  #editSource: MemoryTagSource | null = null;
  #editTags: unknown = null;
  #drag: { row: string; index: number; startX: number; step: number; applied: number } | null =
    null;

  constructor() {
    super();
    this.screenId = '';
    this.selCell = null;
    this.overCell = null;
    this.presetsOpen = false;
    this.previewWidth = 1366;
  }

  // ---------- dữ liệu ----------

  private doc(): GridDoc | null {
    const d = this.app.screenModel(this.screenId) as GridDoc | null;
    return d && d.layout ? d : null;
  }

  private find(cellId: string | null): CellAt | null {
    const d = this.doc();
    if (!d || cellId === null) return null;
    for (let r = 0; r < d.layout.rows.length; r++) {
      const row = d.layout.rows[r]!;
      const c = row.cells.findIndex((x) => x.id === cellId);
      if (c >= 0) return { row, r, cell: row.cells[c]!, c };
    }
    return null;
  }

  private nameOfItem(id: string | undefined): string {
    if (id === undefined) return t('lay.cellEmpty');
    const it = this.doc()?.items.find((i) => i.id === id);
    if (!it) return id;
    if (it.name) return it.name;
    return it.type === 'widget' ? t(`widget.${it.widget}` as MessageKey) : id;
  }

  private edit(fn: (d: ScreenModel) => ReturnType<typeof addRow>, mergeKey?: string) {
    return this.app.editScreen(this.screenId, fn, mergeKey);
  }

  private select(cellId: string | null): void {
    this.selCell = cellId;
    const at = this.find(cellId);
    this.app.selectItems(this.screenId, at?.cell.item ? [at.cell.item] : []);
  }

  // ---------- thao tác ----------

  private addRowPreset(spans: readonly number[]): void {
    this.presetsOpen = false;
    const at = this.find(this.selCell);
    const r = this.edit((d) => addRow(d, spans, at ? at.r + 1 : undefined));
    if (r && !r.rejected) {
      const rows = (r.doc as GridDoc).layout.rows;
      const row = rows[at ? at.r + 1 : rows.length - 1];
      if (row?.cells[0]) this.select(row.cells[0].id);
    }
  }

  private addRowCustom(): void {
    const raw = globalThis.prompt?.(t('lay.presetCustomPrompt'), '3+6+3');
    if (raw === null || raw === undefined) return;
    const spans = raw
      .split('+')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
    this.addRowPreset(spans);
  }

  /** Gắn widget `type` vào ô đang chọn (Toolbox: nhấp hoặc nhấp đúp khi màn hình lưới đang mở). */
  attachToSelected(type: string): void {
    if (this.selCell === null) {
      this.app.toast(t('lay.noCell'));
      return;
    }
    void this.attach(this.selCell, type);
  }

  private async attach(cellId: string, type: string): Promise<void> {
    const at = this.find(cellId);
    if (!at) return;
    if (catalogWidget(type) === undefined) return;
    if (at.cell.item !== undefined) {
      const choice = await this.app.ask({
        kind: 'gridReplace',
        from: this.nameOfItem(at.cell.item),
        to: t(`widget.${type}` as MessageKey),
      });
      if (choice !== 'ok') return;
      this.edit((d) => replaceWidget(d, cellId, type));
    } else this.edit((d) => attachWidget(d, cellId, type));
    this.selCell = cellId;
  }

  private setCell(p: Parameters<typeof setCellProps>[2]): void {
    if (this.selCell === null) return;
    const id = this.selCell;
    this.edit((d) => setCellProps(d, id, p));
  }

  private setRow(p: Parameters<typeof setRowProps>[2]): void {
    const at = this.find(this.selCell);
    if (!at) return;
    this.edit((d) => setRowProps(d, at.row.id, p));
  }

  private removeSelectedItem(cellId: string): void {
    const item = this.find(cellId)?.cell.item;
    if (item === undefined) return;
    this.edit((d) => remove(d, [item]));
    this.app.toast(t('lay.removed'));
  }

  private nudge(cellId: string, delta: -1 | 1): void {
    const at = this.find(cellId);
    if (!at) return;
    if (at.c + 1 < at.row.cells.length) this.edit((d) => resizeDivider(d, at.row.id, at.c, delta));
    else this.edit((d) => setCellProps(d, cellId, { span: at.cell.span + delta }));
  }

  // ---------- bàn phím ----------

  private focusCell(id: string | undefined): void {
    if (id === undefined) return;
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>(`.ge-cell[data-cell="${CSS.escape(id)}"]`)?.focus(),
    );
  }

  private onCellKey(e: KeyboardEvent, cellId: string): void {
    const at = this.find(cellId);
    const d = this.doc();
    if (!at || !d) return;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      stop();
      this.edit((x) => moveRow(x, at.row.id, e.key === 'ArrowUp' ? -1 : 1));
      this.focusCell(cellId);
    } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      stop();
      this.edit((x) => moveCell(x, cellId, e.key === 'ArrowLeft' ? -1 : 1));
      this.focusCell(cellId);
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      stop();
      this.nudge(cellId, e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      stop();
      const next = at.row.cells[at.c + (e.key === 'ArrowLeft' ? -1 : 1)];
      this.focusCell(next?.id);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      stop();
      const row = d.layout.rows[at.r + (e.key === 'ArrowUp' ? -1 : 1)];
      this.focusCell(row?.cells[Math.min(at.c, row.cells.length - 1)]?.id);
    } else if (e.key === 'Enter' || e.key === ' ') {
      stop();
      this.select(cellId);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      stop();
      this.removeSelectedItem(cellId);
    }
  }

  // ---------- kéo thả ----------

  private typeOf(e: DragEvent, prefix: string): string | null {
    for (const type of e.dataTransfer?.types ?? [])
      if (type.startsWith(prefix)) return type.slice(prefix.length);
    return null;
  }

  private onDragOver(e: DragEvent, cellId: string): void {
    if (this.app.screens.previewMode !== 'off' || this.app.store.state.readOnly) return;
    const widget = this.typeOf(e, WIDGET_TYPE);
    const tag = (e.dataTransfer?.types ?? []).includes(TAG_TYPE);
    if (widget === null && !(tag && this.find(cellId)?.cell.item !== undefined)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = widget !== null ? 'copy' : 'link';
    if (this.overCell !== cellId) this.overCell = cellId;
  }

  private onDrop(e: DragEvent, cellId: string): void {
    this.overCell = null;
    if (this.app.screens.previewMode !== 'off') return;
    if (this.typeOf(e, SYMBOL_TYPE) !== null) {
      e.preventDefault();
      this.app.toast(t('lay.symbolUnsupported'));
      return;
    }
    const widget =
      e.dataTransfer?.getData('application/x-mat-widget') || this.typeOf(e, WIDGET_TYPE);
    if (widget) {
      e.preventDefault();
      void this.attach(cellId, widget);
      return;
    }
    const tag = e.dataTransfer?.getData(TAG_TYPE);
    const item = this.find(cellId)?.cell.item;
    if (tag && item !== undefined) {
      e.preventDefault();
      // Gắn Tag vào widget của ô: cùng đường với canvas tự do (screen-editor nghe canvas-tag-drop).
      this.dispatchEvent(
        new CustomEvent('canvas-tag-drop', { detail: { itemId: item, tagId: tag }, bubbles: true }),
      );
    }
  }

  /** Kéo đường chia: mỗi bước một cột; cả lần kéo gộp thành một bước hoàn tác (mergeKey). */
  private onDividerDown(e: PointerEvent, rowId: string, index: number): void {
    e.preventDefault();
    e.stopPropagation();
    const d = this.doc();
    if (!d) return;
    const row = d.layout.rows.find((r) => r.id === rowId);
    const pad = d.layout.padding ?? 16;
    const gap = row?.gap ?? d.layout.gap ?? 12;
    const col = (this.previewWidth - 2 * pad - (GRID_COLUMNS - 1) * gap) / GRID_COLUMNS;
    this.#drag = { row: rowId, index, startX: e.clientX, step: Math.max(1, col + gap), applied: 0 };
    const key = `grid-divider-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const g = this.#drag;
      if (!g) return;
      const want = Math.round((ev.clientX - g.startX) / g.step);
      const delta = want - g.applied;
      if (delta === 0) return;
      const r = this.edit((x) => resizeDivider(x, g.row, g.index, delta), key);
      if (r && !r.rejected) g.applied = want;
    };
    const up = () => {
      this.#drag = null;
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', up);
    };
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', up);
  }

  // ---------- nguồn giá trị cho xem trước ----------

  private source() {
    const hosts = this.app.screens.previewMode === 'off' ? null : this.app.screens.previewHosts();
    if (hosts) return hosts;
    const tags = this.app.store.state.outline.tags?.tags;
    if (this.#editSource === null || tags !== this.#editTags) {
      this.#editTags = tags;
      this.#editSource = new MemoryTagSource({
        tags: ((tags ?? []) as unknown as Parameters<typeof hostTagInfo>[0][]).flatMap((tg) => {
          const i = hostTagInfo(tg);
          return i ? [i] : [];
        }),
      });
    }
    return { source: this.#editSource, host: NO_HOST, alarms: null };
  }

  // ---------- vẽ ----------

  private toolbar(d: GridDoc): TemplateResult {
    const at = this.find(this.selCell);
    const ro = this.app.store.state.readOnly;
    const pm = this.app.screens.previewMode;
    return html`<div class="ge-bar" role="toolbar" aria-label=${t('lay.toolbar')}>
      <span class="ge-add">
        <button
          type="button"
          class="btn"
          data-act="add-row"
          aria-haspopup="menu"
          aria-expanded=${this.presetsOpen ? 'true' : 'false'}
          title=${t('lay.addRowTitle')}
          ?disabled=${ro}
          @click=${() => (this.presetsOpen = !this.presetsOpen)}
        >
          ${icon('plus')} ${t('lay.addRow')}
        </button>
        ${
          this.presetsOpen
            ? html`<div class="ge-presets" role="menu" aria-label=${t('lay.presetMenu')}>
                ${GRID_PRESETS.map(
                  (p) =>
                    html`<button
                      type="button"
                      role="menuitem"
                      data-preset=${p.join('+')}
                      @click=${() => this.addRowPreset(p)}
                    >
                      <span class="ge-preview">
                        ${p.map((s) => html`<i style=${`flex:${s}`}></i>`)}
                      </span>
                      <span>${p.join(' + ')}</span>
                    </button>`,
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-preset="custom"
                  @click=${() => this.addRowCustom()}
                >
                  ${t('lay.presetCustom')}
                </button>
              </div>`
            : nothing
        }
      </span>
      ${at ? this.cellProps(at, ro) : nothing} ${at ? this.rowProps(at, ro, d) : nothing}
      <span class="ge-sep"></span>
      <span class="ge-group" role="group" aria-label=${t('lay.previewWidth')}>
        ${PREVIEW_WIDTHS.map(
          (w) =>
            html`<button
              type="button"
              class="btn seg"
              data-width=${String(w)}
              aria-pressed=${this.previewWidth === w ? 'true' : 'false'}
              @click=${() => (this.previewWidth = w)}
            >
              ${w}
            </button>`,
        )}
      </span>
      <span class="ge-group" role="group" aria-label=${t('cmd.screen.previewOff' as MessageKey)}>
        ${(['off', 'sim', 'device'] as const).map(
          (m) =>
            html`<button
              type="button"
              class="btn seg"
              data-act=${`preview-${m}`}
              aria-pressed=${pm === m ? 'true' : 'false'}
              @click=${() =>
                void this.app.run(
                  m === 'off'
                    ? 'screen.previewOff'
                    : m === 'sim'
                      ? 'screen.previewSim'
                      : 'screen.previewDevice',
                )}
            >
              ${t(m === 'off' ? 'preview.mode.off' : m === 'sim' ? 'preview.mode.sim' : 'preview.mode.device')}
            </button>`,
        )}
      </span>
    </div>`;
  }

  private num(
    field: string,
    label: MessageKey,
    value: number,
    min: number,
    max: number,
    set: (v: number) => void,
    ro: boolean,
  ): TemplateResult {
    return html`<label class="ge-field">
      <span>${t(label)}</span>
      <input
        type="number"
        data-field=${field}
        min=${String(min)}
        max=${String(max)}
        .value=${String(value)}
        ?disabled=${ro}
        @change=${(e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (!Number.isNaN(v)) set(v);
          this.requestUpdate();
        }}
      />
    </label>`;
  }

  private cellProps(at: CellAt, ro: boolean): TemplateResult {
    const c = at.cell;
    return html`<span class="ge-props" role="group" aria-label=${t('lay.cell')}>
      <b>${t('lay.cell')}</b>
      ${this.num('span', 'lay.span', c.span, 1, 12, (v) => this.setCell({ span: v }), ro)}
      ${this.num('offset', 'lay.offset', c.offset ?? 0, 0, 11, (v) => this.setCell({ offset: v }), ro)}
      <label class="ge-field">
        <span>${t('lay.align')}</span>
        <select
          data-field="align"
          ?disabled=${ro}
          @change=${(e: Event) =>
            this.setCell({ align: (e.target as HTMLSelectElement).value as CellAlign })}
        >
          ${(['stretch', 'start', 'center', 'end'] as const).map(
            (a) =>
              html`<option value=${a} ?selected=${(c.align ?? 'stretch') === a}>
                ${t(`lay.align.${a}` as MessageKey)}
              </option>`,
          )}
        </select>
      </label>
      ${this.num('minHeight', 'lay.minHeight', c.minHeight ?? 0, 0, 4000, (v) => this.setCell({ minHeight: v }), ro)}
      <button
        type="button"
        class="btn icon"
        data-act="cell-left"
        title=${t('lay.cellLeft')}
        aria-label=${t('lay.cellLeft')}
        ?disabled=${ro}
        @click=${() => this.edit((d) => moveCell(d, c.id, -1))}
      >
        ←
      </button>
      <button
        type="button"
        class="btn icon"
        data-act="cell-right"
        title=${t('lay.cellRight')}
        aria-label=${t('lay.cellRight')}
        ?disabled=${ro}
        @click=${() => this.edit((d) => moveCell(d, c.id, 1))}
      >
        →
      </button>
      <button
        type="button"
        class="btn icon"
        data-act="cell-add"
        title=${t('lay.cellAdd')}
        aria-label=${t('lay.cellAdd')}
        ?disabled=${ro}
        @click=${() => this.edit((d) => addCell(d, at.row.id))}
      >
        ${icon('plus')}
      </button>
      <button
        type="button"
        class="btn icon"
        data-act="cell-remove"
        title=${t('lay.cellRemove')}
        aria-label=${t('lay.cellRemove')}
        ?disabled=${ro}
        @click=${() => {
          this.edit((d) => removeCell(d, c.id));
          this.selCell = null;
        }}
      >
        ${icon('trash')}
      </button>
    </span>`;
  }

  private rowProps(at: CellAt, ro: boolean, d: GridDoc): TemplateResult {
    const row = at.row;
    const auto = row.height === 'auto';
    return html`<span class="ge-props" role="group" aria-label=${t('lay.row')}>
      <b>${t('lay.row')}</b>
      <label class="ge-field ge-check">
        <input
          type="checkbox"
          data-field="heightAuto"
          .checked=${auto}
          ?disabled=${ro}
          @change=${(e: Event) =>
            this.setRow({
              height: (e.target as HTMLInputElement).checked ? 'auto' : FIXED_ROW_HEIGHT,
            })}
        />
        <span>${t('lay.heightAuto')}</span>
      </label>
      ${
        auto
          ? nothing
          : this.num(
              'height',
              'lay.height',
              row.height as number,
              24,
              4000,
              (v) => this.setRow({ height: v }),
              ro,
            )
      }
      ${this.num('gap', 'lay.gap', row.gap ?? d.layout.gap ?? 12, 0, 64, (v) => this.setRow({ gap: v }), ro)}
      <button
        type="button"
        class="btn icon"
        data-act="row-up"
        title=${t('lay.rowUp')}
        aria-label=${t('lay.rowUp')}
        ?disabled=${ro}
        @click=${() => this.edit((x) => moveRow(x, row.id, -1))}
      >
        ↑
      </button>
      <button
        type="button"
        class="btn icon"
        data-act="row-down"
        title=${t('lay.rowDown')}
        aria-label=${t('lay.rowDown')}
        ?disabled=${ro}
        @click=${() => this.edit((x) => moveRow(x, row.id, 1))}
      >
        ↓
      </button>
      <button
        type="button"
        class="btn icon"
        data-act="row-remove"
        title=${t('lay.rowRemove')}
        aria-label=${t('lay.rowRemove')}
        ?disabled=${ro}
        @click=${() => {
          this.edit((x) => removeRow(x, row.id));
          this.selCell = null;
        }}
      >
        ${icon('trash')}
      </button>
    </span>`;
  }

  private overlays(d: GridDoc, edit: boolean): TemplateResult[] {
    if (!edit) return [];
    return d.layout.rows.flatMap((row) =>
      row.cells.map((cell, c) => {
        const empty = cell.item === undefined;
        const next = row.cells[c + 1];
        const label = t('lay.cellLabel', {
          cell: cell.id,
          span: cell.span,
          content: this.nameOfItem(cell.item),
        });
        return html`<div
          class="ge-cell ${this.selCell === cell.id ? 'sel' : ''} ${
            this.overCell === cell.id ? 'over' : ''
          } ${empty ? 'empty' : ''}"
          slot=${`cell-${cell.id}`}
          data-cell=${cell.id}
          tabindex="0"
          role="button"
          aria-pressed=${this.selCell === cell.id ? 'true' : 'false'}
          aria-label=${label}
          title=${label}
          @click=${() => this.select(cell.id)}
          @keydown=${(e: KeyboardEvent) => this.onCellKey(e, cell.id)}
          @dragover=${(e: DragEvent) => this.onDragOver(e, cell.id)}
          @dragleave=${() => {
            if (this.overCell === cell.id) this.overCell = null;
          }}
          @drop=${(e: DragEvent) => this.onDrop(e, cell.id)}
        >
          ${
            empty
              ? html`<span class="ge-drop" title=${t('lay.dropHint')}
                  >${icon('plus')} ${t('lay.drop')}</span
                >`
              : nothing
          }
          <span class="ge-tag">${cell.span}</span>
          ${
            next
              ? html`<span
                  class="ge-divider"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label=${t('lay.divider', { a: cell.id, b: next.id })}
                  @pointerdown=${(e: PointerEvent) => this.onDividerDown(e, row.id, c)}
                ></span>`
              : nothing
          }
        </div>`;
      }),
    );
  }

  protected override render() {
    const d = this.doc();
    if (!d) return nothing;
    const edit = this.app.screens.previewMode === 'off';
    const src = this.source();
    return html`<div class="ge">
      ${this.toolbar(d)}
      ${
        d.layout.rows.length === 0
          ? html`<div class="ge-empty" role="status">${t('lay.noRows')}</div>`
          : nothing
      }
      <div class="ge-stage">
        <div class="ge-page" style=${`width:${this.previewWidth}px`}>
          <mat-screen
            .screen=${d}
            .tags=${src.source}
            .host=${src.host}
            .alarms=${src.alarms ?? undefined}
            .mode=${edit ? 'edit' : 'run'}
            .viewport=${{ width: this.previewWidth, height: 800 }}
            .loadSvg=${this.loadSvg}
            .loadBindings=${this.loadBindings}
            @mat-tags=${this.onTags}
          >
            ${this.overlays(d, edit)}
          </mat-screen>
        </div>
      </div>
    </div>`;
  }

  private readonly loadSvg = async (path: string): Promise<string> => {
    const doc = this.app.store.state.docs[path];
    if (!doc) throw new Error(`missing ${path}`);
    return doc.pending ?? doc.diskText;
  };

  private readonly loadBindings = async (path: string) => {
    const v = this.app.store.state.docs[path.split('#')[0]!]?.value as
      { elements?: unknown } | null | undefined;
    return Array.isArray(v?.elements) ? (v.elements as never) : [];
  };

  private readonly onTags = (e: Event): void => {
    this.app.screens.declareTags((e as CustomEvent<{ ids: string[] }>).detail.ids);
  };
}

const NO_HOST = {
  ackAlarms: () => Promise.resolve({ ok: false, results: [], acked: 0, skippedNewer: 0 }),
  shelveAlarm: () => Promise.resolve({ ok: false }),
  unshelveAlarm: () => Promise.resolve({ ok: false }),
  session: () => null,
  writeBlocked: () => null,
  write: () => Promise.resolve({ status: 'REJECTED' as const }),
  navigate: () => undefined,
  openPopup: () => undefined,
  closePopup: () => undefined,
  requestLogin: () => undefined,
};

customElements.define('mat-grid-editor', MatGridEditor);

declare global {
  interface HTMLElementTagNameMap {
    'mat-grid-editor': MatGridEditor;
  }
}
