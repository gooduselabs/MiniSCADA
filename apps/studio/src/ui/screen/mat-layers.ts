// Panel Lớp của editor Màn hình 0.3 (feature 007, T116, FR-059, FR-061; mockup studio-screens cảnh 1): thứ tự xếp lớp (trên cùng ở
// đầu danh sách), đổi tên tại chỗ, ẩn, khóa, kéo đổi thứ tự bằng Pointer Events và bằng bàn phím (Alt+mũi tên), chọn đồng bộ
// với canvas. ARIA: `grid` đa chọn, mỗi item một `row` (aria-selected) có ba ô; focus ở lưới và trỏ bằng aria-activedescendant,
// nút khóa và ẩn nằm trong ô nên không lồng điều khiển trong option.
import type { Item } from '@mat/project-schema';
import { html, nothing } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { rename, reorder, setHidden, setLocked } from '../../model/screen-doc.ts';
import { AppElement, icon } from '../base.ts';
import { WIDGET_ICON } from '../mat-taskcards.ts';
import { resolveCanvasKey } from './keymap.ts';
import './mat-layers.css';

const rowId = (id: string) => `ly-${id}`;
const itemName = (it: Item): string => it.name?.trim() || it.id;
const itemIcon = (it: Item): IconName =>
  it.type === 'svg' ? 'shape' : (WIDGET_ICON[it.widget] ?? 'card');
const itemKind = (it: Item): string =>
  it.type === 'svg' ? t('widget.svg') : t(`widget.${it.widget}` as MessageKey);

/** Id màn hình mà tab Lớp đang hiện (tab của editor Màn hình 0.3 đang mở). */
export const layersScreenId = (app: StudioApp): string | null => {
  const a = app.store.state.active;
  return a.startsWith('screen:') && app.store.state.outline.schema === '0.3'
    ? a.slice('screen:'.length)
    : null;
};

export class MatLayers extends AppElement {
  static override properties = {
    cursor: { state: true },
    renaming: { state: true },
    drag: { state: true },
    menu: { state: true },
  };

  declare cursor: string | null;
  declare renaming: string | null;
  /** Đang kéo: id item kéo, hàng đích (theo id) và chèn lên trên hay dưới hàng đó. */
  declare drag: { ids: string[]; target: string; above: boolean } | null;

  /** Menu ngữ cảnh của item `svg` (Nhập lại SVG…), tọa độ cửa sổ. */
  declare menu: { x: number; y: number } | null;

  private dragStart: { id: string; y: number; active: boolean } | null = null;

  constructor() {
    super();
    this.cursor = null;
    this.renaming = null;
    this.drag = null;
    this.menu = null;
  }

  private get screenId(): string | null {
    return layersScreenId(this.app);
  }

  /** Menu ngữ cảnh của item `svg`: chọn item rồi hiện "Nhập lại SVG…" (T102); item khác loại không có menu. */
  private openMenu(it: Item, x: number, y: number): void {
    const sid = this.screenId;
    if (sid === null || it.type !== 'svg') return;
    this.app.selectItems(sid, [it.id]);
    this.cursor = it.id;
    this.menu = { x, y };
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('.ctx-menu .ctx-item')?.focus(),
    );
  }

  private closeMenu(refocus = true): void {
    this.menu = null;
    if (refocus)
      void this.updateComplete.then(() => this.querySelector<HTMLElement>('.ly-grid')?.focus());
  }

  private menuView() {
    const m = this.menu;
    if (m === null) return nothing;
    const why = this.app.enabled('import.reimport');
    const on = why === true;
    return html`<div class="tree-ctx">
      <div
        class="ctx-menu"
        role="menu"
        aria-label=${t('ly.menu')}
        style=${`left:${m.x}px;top:${m.y}px`}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation();
            this.closeMenu();
          }
        }}
        @focusout=${(e: FocusEvent) => {
          if (!this.querySelector('.ctx-menu')?.contains(e.relatedTarget as Node | null))
            this.closeMenu(false);
        }}
      >
        <button
          class="ctx-item"
          type="button"
          role="menuitem"
          data-cmd="import.reimport"
          aria-disabled=${on ? 'false' : 'true'}
          title=${on ? '' : t(why as MessageKey)}
          @click=${() => {
            if (!on) return;
            this.closeMenu(false);
            void this.app.run('import.reimport');
          }}
        >
          <span class="lbl">${t('cmd.import.reimport')}</span>
        </button>
      </div>
    </div>`;
  }

  /** Item theo thứ tự hiển thị: lớp trên cùng đứng đầu. */
  private rows(): Item[] {
    const id = this.screenId;
    const doc = id === null ? null : this.app.screenModel(id);
    return doc ? [...doc.items].reverse() : [];
  }

  private selected(): readonly string[] {
    const id = this.screenId;
    return id === null ? [] : this.app.selectedItems(id);
  }

  private select(ids: string[], moveCursor: string | null = null): void {
    const sid = this.screenId;
    if (sid === null) return;
    this.app.selectItems(sid, ids);
    if (moveCursor) this.cursor = moveCursor;
  }

  // ---------- Chuột ----------

  private onRowClick(e: MouseEvent, it: Item, rows: Item[]): void {
    this.cursor = it.id;
    const cur = this.selected();
    if (e.shiftKey && cur.length > 0) {
      const a = rows.findIndex((r) => r.id === cur[cur.length - 1]);
      const b = rows.findIndex((r) => r.id === it.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      this.select(rows.slice(lo, hi + 1).map((r) => r.id));
    } else if (e.ctrlKey || e.metaKey)
      this.select(cur.includes(it.id) ? cur.filter((x) => x !== it.id) : [...cur, it.id]);
    else this.select([it.id]);
  }

  private toggle(it: Item, what: 'locked' | 'hidden'): void {
    const sid = this.screenId;
    if (sid === null) return;
    const ids = this.selected().includes(it.id) ? [...this.selected()] : [it.id];
    const next = it[what] !== true;
    this.app.editScreen(sid, (d) =>
      what === 'locked' ? setLocked(d, ids, next) : setHidden(d, ids, next),
    );
  }

  private commitRename(it: Item, value: string): void {
    this.renaming = null;
    const sid = this.screenId;
    if (sid === null || value.trim() === '' || value.trim() === itemName(it)) return;
    this.app.editScreen(sid, (d) => rename(d, it.id, value.trim()));
    void this.updateComplete.then(() => this.querySelector<HTMLElement>('.ly-grid')?.focus());
  }

  // ---------- Kéo đổi thứ tự (Pointer Events) ----------

  private onGripDown(e: PointerEvent, it: Item): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.dragStart = { id: it.id, y: e.clientY, active: false };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  private onGripMove(e: PointerEvent): void {
    const s = this.dragStart;
    if (!s) return;
    if (!s.active && Math.abs(e.clientY - s.y) < 4) return;
    s.active = true;
    const rows = [...this.querySelectorAll<HTMLElement>('.ly-row')];
    let hit: { id: string; above: boolean } | null = null;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (e.clientY >= b.top && e.clientY < b.bottom)
        hit = { id: r.dataset.item!, above: e.clientY < b.top + b.height / 2 };
    }
    if (!hit) return;
    const sel = this.selected();
    const ids = sel.includes(s.id) ? [...sel] : [s.id];
    this.drag = { ids, target: hit.id, above: hit.above };
  }

  private onGripUp(e: PointerEvent): void {
    const s = this.dragStart;
    this.dragStart = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const d = this.drag;
    this.drag = null;
    const sid = this.screenId;
    if (!s?.active || !d || sid === null) return;
    const doc = this.app.screenModel(sid);
    if (!doc || d.ids.includes(d.target)) return;
    const rest = doc.items.filter((i) => !d.ids.includes(i.id));
    const ti = rest.findIndex((i) => i.id === d.target);
    // Hiển thị đảo: "trên" hàng đích là lớp cao hơn, tức sau nó trong mảng.
    const toIndex = d.above ? ti + 1 : ti;
    this.app.editScreen(sid, (x) => reorder(x, d.ids, { toIndex }));
  }

  // ---------- Bàn phím ----------

  private onKey(e: KeyboardEvent, rows: Item[]): void {
    if (this.renaming !== null) return;
    const sid = this.screenId;
    if (sid === null || e.target !== e.currentTarget) return;
    const i = Math.max(
      0,
      rows.findIndex((r) => r.id === this.cursor),
    );
    // Phím menu (Shift+F10, phím Menu) trên item `svg` đang trỏ: cùng menu với chuột phải.
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const cur = rows.find((r) => r.id === this.cursor) ?? rows[i];
      const r = cur ? this.querySelector(`[id="${rowId(cur.id)}"]`)?.getBoundingClientRect() : null;
      if (cur && r) {
        e.preventDefault();
        this.openMenu(cur, r.left + 24, r.bottom);
      }
      return;
    }
    const go = (j: number, extend: boolean) => {
      const to = rows[Math.min(rows.length - 1, Math.max(0, j))];
      if (!to) return;
      this.cursor = to.id;
      if (extend) {
        const cur = this.selected();
        this.select(cur.includes(to.id) ? [...cur] : [...cur, to.id]);
      } else this.select([to.id]);
      void this.updateComplete.then(() =>
        this.querySelector(`[id="${rowId(to.id)}"]`)?.scrollIntoView?.({ block: 'nearest' }),
      );
    };
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const sel = this.selected();
      if (sel.length)
        this.app.editScreen(sid, (d) =>
          reorder(d, [...sel], e.key === 'ArrowUp' ? 'forward' : 'backward'),
        );
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return go(i + 1, e.shiftKey);
      case 'ArrowUp':
        e.preventDefault();
        return go(i - 1, e.shiftKey);
      case 'Home':
        e.preventDefault();
        return go(0, false);
      case 'End':
        e.preventDefault();
        return go(rows.length - 1, false);
      case 'F2':
      case 'Enter':
        if (e.key === 'Enter' && !e.ctrlKey) {
          e.preventDefault();
          this.app.hooks.focusInspector?.();
          return;
        }
        e.preventDefault();
        if (this.cursor) this.renaming = this.cursor;
        return;
      case ' ':
        e.preventDefault();
        if (this.cursor) {
          const cur = this.selected();
          this.select(
            cur.includes(this.cursor)
              ? cur.filter((x) => x !== this.cursor)
              : [...cur, this.cursor],
          );
        }
        return;
      case 'l':
      case 'L':
      case 'h':
      case 'H': {
        const it = rows.find((r) => r.id === this.cursor);
        if (it && !e.ctrlKey && !e.altKey && !e.metaKey) {
          e.preventDefault();
          this.toggle(it, e.key.toLowerCase() === 'l' ? 'locked' : 'hidden');
        }
        return;
      }
    }
    const act = resolveCanvasKey(e);
    if (act?.kind === 'command') {
      e.preventDefault();
      e.stopPropagation();
      void this.app.run(act.id);
    } else if (act?.kind === 'enter') {
      e.preventDefault();
      this.app.hooks.focusInspector?.();
    }
  }

  protected override updated(): void {
    const rows = this.rows();
    if (this.cursor !== null && !rows.some((r) => r.id === this.cursor)) this.cursor = null;
    // Chọn ở canvas thì con trỏ danh sách theo.
    const sel = this.selected();
    const last = sel[sel.length - 1];
    if (last && this.cursor !== last && !this.drag && this.renaming === null) this.cursor = last;
  }

  protected override render() {
    const sid = this.screenId;
    if (sid === null) return html`<p class="help pad">${t('ly.noScreen')}</p>`;
    const rows = this.rows();
    if (rows.length === 0) return html`<p class="help pad">${t('ly.empty')}</p>`;
    const sel = new Set(this.selected());
    const active = this.cursor ? rowId(this.cursor) : null;
    return html`<div
        class="ly-grid"
        role="grid"
        tabindex="0"
        aria-label=${t('ly.label')}
        aria-multiselectable="true"
        aria-activedescendant=${active ?? nothing}
        @keydown=${(e: KeyboardEvent) => this.onKey(e, rows)}
      >
        ${rows.map((it) => this.row(it, rows, sel.has(it.id)))}
      </div>
      ${this.menuView()}`;
  }

  private row(it: Item, rows: Item[], selected: boolean) {
    const d = this.drag;
    const over = d?.target === it.id ? (d.above ? 'over-top' : 'over-bottom') : '';
    const renaming = this.renaming === it.id;
    const name = itemName(it);
    return html`<div
      class="ly-row ${selected ? 'sel' : ''} ${this.cursor === it.id ? 'cursor' : ''} ${over} ${d?.ids.includes(it.id) ? 'dragging' : ''}"
      role="row"
      id=${rowId(it.id)}
      data-item=${it.id}
      aria-selected=${selected ? 'true' : 'false'}
      @click=${(e: MouseEvent) => this.onRowClick(e, it, rows)}
      @contextmenu=${(e: MouseEvent) => {
        if (it.type !== 'svg') return;
        e.preventDefault();
        this.openMenu(it, e.clientX, e.clientY);
      }}
      @dblclick=${() => {
        this.renaming = it.id;
      }}
    >
      <div class="ly-main" role="gridcell">
        <span
          class="grip"
          aria-hidden="true"
          title=${t('ly.dragTip')}
          @pointerdown=${(e: PointerEvent) => this.onGripDown(e, it)}
          @pointermove=${(e: PointerEvent) => this.onGripMove(e)}
          @pointerup=${(e: PointerEvent) => this.onGripUp(e)}
          >${icon('grip', 'sm')}</span
        >
        ${icon(itemIcon(it), it.hidden ? 'dim' : '')}
        ${
          renaming
            ? html`<input
                class="ly-name"
                type="text"
                maxlength="80"
                aria-label=${t('ly.rename')}
                .value=${name}
                @click=${(e: Event) => e.stopPropagation()}
                @keydown=${(e: KeyboardEvent) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && !e.isComposing)
                    this.commitRename(it, (e.target as HTMLInputElement).value);
                  else if (e.key === 'Escape') {
                    this.renaming = null;
                    void this.updateComplete.then(() =>
                      this.querySelector<HTMLElement>('.ly-grid')?.focus(),
                    );
                  }
                }}
                @blur=${(e: FocusEvent) => this.renaming === it.id && this.commitRename(it, (e.target as HTMLInputElement).value)}
              />`
            : html`<span class="nm ${it.hidden ? 'dim' : ''}">${name}</span
                ><span class="kind">${itemKind(it)}</span>`
        }
      </div>
      <div class="ly-act" role="gridcell">
        <button
          type="button"
          class="ibtn sm ${it.locked ? 'on' : ''}"
          tabindex="-1"
          aria-pressed=${it.locked ? 'true' : 'false'}
          aria-label=${t('ly.lock', { name })}
          title=${t('ly.lockTip')}
          @click=${(e: Event) => {
            e.stopPropagation();
            this.toggle(it, 'locked');
          }}
        >
          ${icon('lock', 'sm')}
        </button>
        <button
          type="button"
          class="ibtn sm ${it.hidden ? 'on' : ''}"
          tabindex="-1"
          aria-pressed=${it.hidden ? 'true' : 'false'}
          aria-label=${t('ly.hide', { name })}
          title=${t('ly.hideTip')}
          @click=${(e: Event) => {
            e.stopPropagation();
            this.toggle(it, 'hidden');
          }}
        >
          ${icon(it.hidden ? 'eyeoff' : 'eye', 'sm')}
        </button>
      </div>
    </div>`;
  }
}

customElements.define('mat-layers', MatLayers);

declare global {
  interface HTMLElementTagNameMap {
    'mat-layers': MatLayers;
  }
}
