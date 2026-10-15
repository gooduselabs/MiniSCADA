// Cây phần tử của item `svg` đang vào (feature 008, T071, SC-018; contract studio-svg-editor §10, §13; mockup studio-svg cảnh 2).
// Nằm ở vùng Details (tab "Phần tử"). Dựng lười từ DOM đã lọc của item: chỉ cấp trên cùng và con của nút đã mở; danh sách dài
// được cắt theo cửa sổ nhìn (hàng cao cố định, chỉ vẽ hàng đang thấy) nên 20.000 nút vẫn mở nhanh. ARIA: `role="tree"` có
// `treeitem` (không có phần tử đệm), `aria-level`, `aria-expanded`, `aria-selected`, focus ở cây và trỏ bằng
// `aria-activedescendant` (các ô chuột không là điều khiển lồng nhau). Phím: ↑↓ di chuyển và chọn, ←→ gập mở hoặc lên cha và
// xuống con, Enter đưa focus tới inspector, F2 đổi tên, Home/End. Chọn đồng bộ hai chiều với canvas.
import { html, nothing, type TemplateResult } from 'lit';
import { bindingSetOf, elementNameOf, itemRef, type ItemRef } from '../../app/svg-bind.ts';
import { t } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { elementOf } from '../../model/svg-binding-doc.ts';
import {
  filterTree,
  findByUid,
  flattenTree,
  uidAncestors,
  uidChildren,
  type TreeRow,
} from '../../model/svg-dom.ts';
import { groupBySvgElement, severityOfElement } from '../../model/svg-issues.ts';
import { AppElement, icon } from '../base.ts';
import './svg-element-tree.css';

export const ROW_H = 24;
const OVERSCAN = 8;

const KIND_ICON: Readonly<Record<string, IconName>> = {
  g: 'group',
  svg: 'group',
  a: 'group',
  switch: 'group',
  text: 'text',
  tspan: 'text',
  line: 'line',
  polyline: 'line',
};

const rowDomId = (uid: string) => `et-${uid}`;

interface Marks {
  bind: number;
  event: boolean;
}

export class MatSvgTree extends AppElement {
  static override properties = {
    cursor: { state: true },
    scrollPos: { state: true },
    renaming: { state: true },
    height: { state: true },
  };

  declare cursor: string | null;
  declare scrollPos: number;
  declare renaming: string | null;
  declare height: number;

  private ro: ResizeObserver | null = null;
  private lastFocusUid = '';
  private renameFocused: string | null = null;
  private cache: { key: string; rows: TreeRow[]; total: number } | null = null;

  constructor() {
    super();
    this.cursor = null;
    this.scrollPos = 0;
    this.renaming = null;
    this.height = 240;
  }

  // ---------- Dữ liệu ----------

  private ref(): ItemRef | null {
    const app = this.app;
    const active = app.store.state.active;
    if (!active.startsWith('screen:')) return null;
    const screen = active.slice('screen:'.length);
    const id = app.screens.enteredItemId(screen);
    return id === null ? null : itemRef(app, screen, id);
  }

  private svgRoot(ref: ItemRef): Element | null {
    return this.app.screens.svgRoot(ref.screen, ref.item)?.querySelector('svg') ?? null;
  }

  /** Các dòng đang thấy (đệm theo bản DOM, tập nút mở và chữ lọc). */
  private rows(ref: ItemRef, svg: Element): { rows: TreeRow[]; total: number } {
    const ws = this.app.screens;
    const key = `${ws.svgRevision}|${[...ws.treeExpanded].join(',')}|${ws.treeFilter}|${ref.item}`;
    if (this.cache?.key === key) return this.cache;
    const q = ws.treeFilter.trim();
    const res =
      q === ''
        ? (() => {
            const rows = flattenTree(svg, ws.treeExpanded);
            return { rows, total: rows.length };
          })()
        : filterTree(svg, q);
    this.cache = { key, ...res };
    return this.cache;
  }

  // ---------- Vòng đời ----------

  protected override firstUpdated(): void {
    const box = this.querySelector<HTMLElement>('.et-scroll');
    if (box === null || typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver((entries) => {
      const h = Math.round(entries[entries.length - 1]?.contentRect.height ?? 0);
      if (h > 0 && h !== this.height) this.height = h;
    });
    this.ro.observe(box);
  }

  override disconnectedCallback(): void {
    this.ro?.disconnect();
    this.ro = null;
    super.disconnectedCallback();
  }

  // ---------- Hành động ----------

  private setSelection(uids: readonly string[]): void {
    this.app.screens.pickUids(uids);
  }

  private toggle(uid: string, open: boolean): void {
    const ex = this.app.screens.treeExpanded;
    if (open) ex.add(uid);
    else ex.delete(uid);
    this.app.screens.treeExpanded = new Set(ex);
    this.cache = null;
    this.requestUpdate();
  }

  private onRowClick(e: MouseEvent, row: TreeRow): void {
    this.cursor = row.uid;
    const cur = this.app.screens.selectedUids;
    if (e.shiftKey || e.ctrlKey || e.metaKey)
      this.setSelection(
        cur.includes(row.uid) ? cur.filter((u) => u !== row.uid) : [...cur, row.uid],
      );
    else this.setSelection([row.uid]);
    this.querySelector<HTMLElement>('[role="tree"]')?.focus({ preventScroll: true });
  }

  private onRowDblClick(row: TreeRow): void {
    if (row.hasChildren) this.toggle(row.uid, !row.expanded);
    else this.app.hooks.focusInspector?.();
  }

  private commitRename(ref: ItemRef, uid: string, value: string): void {
    this.renaming = null;
    const name = value.trim();
    if (name === '') return;
    this.app.editScreen(ref.screen, (d) => ({
      doc: {
        ...d,
        items: d.items.map((i) =>
          i.id === ref.item && i.type === 'svg'
            ? {
                ...i,
                elements: i.elements.some((e) => e.elementUid === uid)
                  ? i.elements.map((e) => (e.elementUid === uid ? { ...e, name } : e))
                  : [...i.elements, { elementUid: uid, name }],
              }
            : i,
        ),
      },
    }));
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('[role="tree"]')?.focus({ preventScroll: true }),
    );
  }

  private onKey(e: KeyboardEvent, ref: ItemRef, rows: TreeRow[], svg: Element): void {
    if (this.renaming !== null || e.altKey) return;
    const i = Math.max(
      0,
      rows.findIndex((r) => r.uid === this.cursor),
    );
    const cur = rows[i];
    if (cur === undefined) return;
    const go = (to: number) => {
      const r = rows[Math.min(rows.length - 1, Math.max(0, to))]!;
      this.cursor = r.uid;
      this.setSelection([r.uid]);
      this.revealRow(rows.indexOf(r));
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(i + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        go(i - 1);
        return;
      case 'Home':
        e.preventDefault();
        go(0);
        return;
      case 'End':
        e.preventDefault();
        go(rows.length - 1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        if (cur.hasChildren && !cur.expanded) this.toggle(cur.uid, true);
        else if (cur.expanded) go(i + 1);
        return;
      case 'ArrowLeft': {
        e.preventDefault();
        if (cur.expanded) {
          this.toggle(cur.uid, false);
          return;
        }
        // Lên cha: dòng gần nhất phía trên có độ sâu nhỏ hơn.
        for (let j = i - 1; j >= 0; j--)
          if (rows[j]!.depth < cur.depth) {
            go(j);
            return;
          }
        return;
      }
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        this.app.hooks.focusInspector?.();
        return;
      case 'F2':
        e.preventDefault();
        this.renaming = cur.uid;
        return;
      default:
        void ref;
        void svg;
    }
  }

  /** Cuộn để hàng `index` hiện trong cửa sổ nhìn. */
  private revealRow(index: number): void {
    const box = this.querySelector<HTMLElement>('.et-scroll');
    if (box === null) return;
    const top = index * ROW_H;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (top + ROW_H > box.scrollTop + box.clientHeight)
      box.scrollTop = top + ROW_H - box.clientHeight;
  }

  // ---------- Vẽ ----------

  private marks(ref: ItemRef): {
    marks: Map<string, Marks>;
    sev: Map<string, 'error' | 'warning' | null>;
  } {
    const set = bindingSetOf(this.app, ref);
    const marks = new Map<string, Marks>();
    for (const e of set.elements)
      marks.set(e.elementUid, {
        bind: e.bindings?.length ?? 0,
        event: e.events?.click !== undefined,
      });
    const { byElement } = groupBySvgElement(
      this.app.store.state.issues.filter((i) => i.file === ref.file),
      set,
    );
    const sev = new Map<string, 'error' | 'warning' | null>();
    for (const [uid, list] of byElement) sev.set(uid, severityOfElement(list));
    return { marks, sev };
  }

  private rowView(
    ref: ItemRef,
    row: TreeRow,
    index: number,
    size: number,
    m: { marks: Map<string, Marks>; sev: Map<string, 'error' | 'warning' | null> },
    item: ReturnType<typeof elementOf> | undefined,
  ): TemplateResult {
    void item;
    const app = this.app;
    const selected = app.screens.selectedUids.includes(row.uid);
    const mk = m.marks.get(row.uid);
    const sev = m.sev.get(row.uid) ?? null;
    const it = app.screenModel(ref.screen)?.items.find((x) => x.id === ref.item);
    const name = it?.type === 'svg' ? elementNameOf(it, row.uid, row.el) : row.name;
    const label = name || row.tag;
    return html`<div
      class="ti et-row ${selected ? 'sel' : ''} ${row.uid === this.cursor ? 'cur' : ''} ${sev ? `iss-${sev}` : ''}"
      id=${rowDomId(row.uid)}
      role="treeitem"
      aria-level=${row.depth + 1}
      aria-posinset=${index + 1}
      aria-setsize=${size}
      aria-expanded=${row.hasChildren ? (row.expanded ? 'true' : 'false') : nothing}
      aria-selected=${selected ? 'true' : 'false'}
      aria-label=${t('et.rowLabel', {
        name: label,
        tag: row.tag,
        bind: mk?.bind ?? 0,
        event: mk?.event ? t('et.hasEvent') : '',
      })}
      style="padding-left:${6 + row.depth * 14}px"
      data-uid=${row.uid}
      @click=${(e: MouseEvent) => this.onRowClick(e, row)}
      @dblclick=${() => this.onRowDblClick(row)}
    >
      <span
        class="tw"
        @click=${(e: MouseEvent) => {
          if (!row.hasChildren) return;
          e.stopPropagation();
          this.toggle(row.uid, !row.expanded);
        }}
        >${row.hasChildren ? icon(row.expanded ? 'chev-d' : 'chev-r') : nothing}</span
      >
      ${icon(KIND_ICON[row.tag] ?? 'shape')}
      ${
        this.renaming === row.uid
          ? html`<input
              class="input sm et-rename"
              aria-label=${t('et.renameLabel')}
              .value=${name}
              @click=${(e: Event) => e.stopPropagation()}
              @keydown=${(e: KeyboardEvent) => {
                e.stopPropagation();
                if (e.isComposing) return;
                if (e.key === 'Enter')
                  this.commitRename(ref, row.uid, (e.target as HTMLInputElement).value);
                else if (e.key === 'Escape') this.renaming = null;
              }}
              @blur=${(e: FocusEvent) => {
                if (this.renaming === row.uid)
                  this.commitRename(ref, row.uid, (e.target as HTMLInputElement).value);
              }}
            />`
          : html`<span class="lbl nm">${label}</span
              ><span class="tg mono">${name ? row.tag : ''}</span>`
      }
      <span class="end mark">
        ${mk && mk.bind > 0 ? html`<span class="mk" title=${t('et.hasBind', { n: mk.bind })}>${icon('link')}<span class="cnt">${mk.bind}</span></span>` : nothing}
        ${mk?.event ? html`<span class="mk" title=${t('et.hasEvent')}>${icon('play')}</span>` : nothing}
        ${sev ? html`<span class="mk ${sev}" title=${t(sev === 'error' ? 'et.hasError' : 'et.hasWarning')}>${icon(sev === 'error' ? 'err' : 'warn', sev === 'error' ? 'err' : 'warn')}</span>` : nothing}
      </span>
    </div>`;
  }

  protected override updated(): void {
    // F2: đưa focus vào ô tên ngay khi nó hiện (một lần mỗi lần đổi tên), chọn sẵn chữ cũ; không có thì người dùng bàn phím
    // gõ vào khoảng trống (T114, SC-015).
    if (this.renaming === null) this.renameFocused = null;
    else if (this.renameFocused !== this.renaming) {
      const input = this.querySelector<HTMLInputElement>('.et-rename');
      if (input !== null) {
        this.renameFocused = this.renaming;
        input.focus();
        input.select();
      }
    }
    // Chọn từ canvas: mở tới phần tử và cuộn cho thấy (một lần mỗi lần đổi phần tử chọn).
    const ref = this.ref();
    const last = this.app.screens.selectedUids.at(-1) ?? '';
    if (ref === null || last === this.lastFocusUid) return;
    this.lastFocusUid = last;
    const svg = this.svgRoot(ref);
    if (svg === null || last === '') return;
    this.cursor = last;
    const el = findByUid(svg.getRootNode() as ShadowRoot, last);
    if (el === null || this.app.screens.treeFilter.trim() !== '') return;
    const need = uidAncestors(el, svg).filter((u) => !this.app.screens.treeExpanded.has(u));
    if (need.length > 0) {
      const ex = new Set(this.app.screens.treeExpanded);
      for (const u of need) ex.add(u);
      this.app.screens.treeExpanded = ex;
      this.cache = null;
      this.requestUpdate();
      return;
    }
    const idx = this.rows(ref, svg).rows.findIndex((r) => r.uid === last);
    if (idx >= 0) this.revealRow(idx);
  }

  protected override render() {
    const ref = this.ref();
    if (ref === null) return html`<p class="help pad">${t('et.notEntered')}</p>`;
    const svg = this.svgRoot(ref);
    const ws = this.app.screens;
    const filter = html`<div class="filt">
      ${icon('search' as IconName)}
      <input
        class="input sm"
        type="search"
        aria-label=${t('et.filter')}
        placeholder=${t('et.filterHint')}
        .value=${ws.treeFilter}
        @input=${(e: Event) => {
          ws.treeFilter = (e.target as HTMLInputElement).value;
          this.cache = null;
          this.scrollPos = 0;
          const box = this.querySelector<HTMLElement>('.et-scroll');
          if (box) box.scrollTop = 0;
          this.requestUpdate();
        }}
      />
    </div>`;
    if (svg === null)
      return html`${filter}
        <p class="help pad" role="status">${t('et.loading')}</p>`;
    const { rows, total } = this.rows(ref, svg);
    if (!rows.some((r) => r.uid === this.cursor)) this.cursor = rows[0]?.uid ?? null;
    const first = Math.max(0, Math.floor(this.scrollPos / ROW_H) - OVERSCAN);
    const count = Math.ceil(this.height / ROW_H) + OVERSCAN * 2;
    const last = Math.min(rows.length, first + count);
    const m = this.marks(ref);
    const bound = [...m.marks.values()].filter((x) => x.bind > 0 || x.event).length;
    const filtering = ws.treeFilter.trim() !== '';
    return html`${filter}
      <div
        class="et-scroll"
        @scroll=${(e: Event) => {
          this.scrollPos = (e.target as HTMLElement).scrollTop;
        }}
      >
        ${
          rows.length > 0
            ? html`<div
                class="et-tree"
                role="tree"
                tabindex="0"
                aria-label=${t('et.label')}
                aria-multiselectable="true"
                aria-activedescendant=${this.cursor !== null && rows.some((r) => r.uid === this.cursor) ? rowDomId(this.cursor) : nothing}
                style="padding-top:${first * ROW_H}px;padding-bottom:${Math.max(0, rows.length - last) * ROW_H}px"
                @keydown=${(e: KeyboardEvent) => this.onKey(e, ref, rows, svg)}
              >
                ${rows.slice(first, last).map((r, i) => this.rowView(ref, r, first + i, rows.length, m, undefined))}
              </div>`
            : html`<p class="help pad" role="status">
                ${filtering ? t('et.noMatch') : t('et.empty')}
              </p>`
        }
      </div>
      <div class="foot-note" role="status">
        ${filtering ? t('et.footFilter', { n: Math.min(total, rows.length), total }) : t('et.foot', { n: uidChildren(svg).length, bound })}
      </div>`;
  }
}

customElements.define('mat-svg-tree', MatSvgTree);

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-tree': MatSvgTree;
  }
}
