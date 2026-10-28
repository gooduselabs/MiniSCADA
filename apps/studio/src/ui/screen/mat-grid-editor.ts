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
import { type MatScreen, MemoryTagSource, registerScreen } from '@mat/ui-components';
import { html, nothing, type TemplateResult } from 'lit';
import { bindingSetOf, itemRef, itemTagIds } from '../../app/svg-bind.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  addCell,
  addRow,
  addTemplateRow,
  attachWidget,
  GRID_PRESETS,
  moveCell,
  moveRow,
  removeCell,
  removeRow,
  replaceWidget,
  resizeDivider,
  ROW_TEMPLATE_IDS,
  ROW_TEMPLATES,
  setCellProps,
  setRowProps,
  type RowTemplateId,
  type TemplateNameKind,
} from '../../model/grid-ops.ts';
import { hostTagInfo } from '../../model/preview-hosts.ts';
import { remove } from '../../model/screen-doc.ts';
import { AppElement, icon } from '../base.ts';
import './mat-grid-editor.css';
import './mat-svg-overlay.ts';
import { BindingRevs, hitUids, pickAt, svgItemRoot, warmHit } from './svg-enter.ts';

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
const TAG_TYPE = 'application/x-mat-tag';
/** Feature 029: kéo thả ô và hàng trong trình soạn lưới. */
const CELL_TYPE = 'application/x-mat-grid-cell';
const ROW_TYPE = 'application/x-mat-grid-row';
/** Chiều cao hàng chọn nhanh (feature 029). */
const QUICK_HEIGHTS = ['auto', 120, 240, 360] as const;

export class MatGridEditor extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    selCell: { state: true },
    overCell: { state: true },
    presetsOpen: { state: true },
    previewWidth: { state: true },
    stageWidth: { state: true },
    dragging: { state: true },
    hoverUid: { state: true },
  };
  declare screenId: string;
  declare selCell: string | null;
  declare overCell: string | null;
  declare presetsOpen: boolean;
  declare previewWidth: number;
  /** Chiều rộng vùng làm việc (đo bằng ResizeObserver); 0 khi chưa đo (jsdom). */
  declare stageWidth: number;
  /** Feature 029: đang kéo (đường chia, cạnh ô, ô, hàng): hiện đường lưới 12 cột rõ. */
  declare dragging: boolean;
  /** Phần tử SVG đang rê chuột khi đã vào đồ họa (khung mảnh). */
  declare hoverUid: string | null;

  readonly #bindRevs = new BindingRevs(() => this.app);
  #readyKey = '';
  #hoverFrame = 0;

  #ro: ResizeObserver | null = null;

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
    this.stageWidth = 0;
    this.dragging = false;
    this.hoverUid = null;
  }

  protected override attached(): void {
    this.app.screens.svgRootProvider = (screen, itemId) =>
      screen === this.screenId ? this.itemRoot(itemId) : null;
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!RO) return;
    this.#ro = new RO((entries) => {
      const w = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (Math.abs(w - this.stageWidth) > 1) this.stageWidth = w;
    });
    void this.updateComplete.then(() => {
      const st = this.querySelector('.ge-stage');
      if (st && this.#ro) this.#ro.observe(st);
    });
  }

  protected override detached(): void {
    // Đóng editor: khôi phục giá trị đã Thử và thoát item (như canvas tự do).
    if (this.entered !== null) this.app.screens.exitSvgItem();
    this.app.screens.svgRootProvider = null;
    this.#ro?.disconnect();
    this.#ro = null;
  }

  /** Hệ số thu nhỏ để trang xem trước vừa vùng làm việc (không phóng to quá 1). */
  private zoom(): number {
    const avail = this.stageWidth - 32;
    return avail > 0 ? Math.min(1, avail / this.previewWidth) : 1;
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

  // ---------- vào đồ họa của item svg (feature 008 trên bố cục lưới) ----------

  /** Item `svg` đang vào ở màn hình này. */
  private get entered(): string | null {
    return this.app.screens.enteredItemId(this.screenId);
  }

  private itemRoot(itemId: string): ShadowRoot | null {
    return svgItemRoot(this.querySelector('mat-screen'), itemId);
  }

  private isSvg(itemId: string | undefined): boolean {
    return itemId !== undefined && this.doc()?.items.find((i) => i.id === itemId)?.type === 'svg';
  }

  /** Vào đồ họa của item `svg` trong ô `cellId` (nhấp đúp, Enter); `false` khi ô không chứa item svg. */
  private enterCell(cellId: string): boolean {
    const item = this.find(cellId)?.cell.item;
    if (this.app.screens.previewMode !== 'off' || item === undefined || !this.isSvg(item))
      return false;
    this.selCell = cellId;
    this.app.enterSvg(this.screenId, item);
    return true;
  }

  private exitSvg(): void {
    this.app.screens.exitSvgItem();
    this.hoverUid = null;
    this.app.requestRender();
  }

  /** Giữ trạng thái "vào item" khớp với vùng chọn; báo DOM của item đã dựng để cây phần tử và khung chọn đọc lại. */
  protected override updated(): void {
    const app = this.app;
    if (this.entered !== null) {
      const kind = app.store.state.selection?.kind;
      if (kind === 'items' || kind === undefined)
        app.screens.syncSvgSelection(app.selectedItems(this.screenId));
      if (itemRef(app, this.screenId, this.entered ?? '') === null) app.screens.exitSvgItem();
    }
    const entered = this.entered;
    if (entered === null) {
      this.#readyKey = '';
      if (this.hoverUid !== null) this.hoverUid = null;
      return;
    }
    const ref = itemRef(app, this.screenId, entered);
    if (ref === null) return;
    app.screens.allowTest(entered, itemTagIds(bindingSetOf(app, ref)));
    const key = `${entered}|${this.#bindRevs.rev(ref.file)}|${app.screens.testEpoch}`;
    if (key === this.#readyKey) return;
    this.#readyKey = key;
    void this.querySelector<MatScreen>('mat-screen')
      ?.whenReady()
      .then(() => {
        if (this.#readyKey === key && this.isConnected) {
          app.screens.bumpSvg();
          warmHit(() => (this.entered === entered ? this.itemRoot(entered) : null));
        }
      });
  }

  private onCellClick(e: MouseEvent, cellId: string): void {
    const item = this.find(cellId)?.cell.item;
    const entered = this.entered;
    if (entered !== null && item === entered) {
      pickAt(this.app, this.itemRoot(entered), e.clientX, e.clientY, {
        shift: e.shiftKey || e.ctrlKey || e.metaKey,
        alt: e.altKey,
      });
      return;
    }
    this.select(cellId);
  }

  private onCellHover(e: PointerEvent, cellId: string): void {
    const entered = this.entered;
    if (entered === null || this.find(cellId)?.cell.item !== entered) return;
    const { clientX: x, clientY: y } = e;
    if (this.#hoverFrame !== 0) return;
    this.#hoverFrame = requestAnimationFrame(() => {
      this.#hoverFrame = 0;
      const uid = hitUids(this.itemRoot(entered), x, y)[0] ?? null;
      if (uid !== this.hoverUid) this.hoverUid = uid;
    });
  }

  /** Chọn ô (menu chuột phải của editor Màn hình); ô của đồ họa đang vào giữ nguyên. */
  selectCell(cellId: string): void {
    if (this.find(cellId)?.cell.item !== this.entered) this.select(cellId);
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

  /** Thêm hàng theo mẫu có sẵn widget (feature 014) sau hàng của ô đang chọn, chọn ô đầu của hàng mới. */
  private addRowTemplate(id: RowTemplateId): void {
    this.presetsOpen = false;
    const at = this.find(this.selCell);
    const nameOf = (kind: TemplateNameKind, n: number): string =>
      kind === 'tile' ? t('lay.tpl.tileLabel', { n }) : t(`lay.tpl.${kind}` as MessageKey);
    const r = this.edit((d) => addTemplateRow(d, id, nameOf, at ? at.r + 1 : undefined));
    if (r && !r.rejected) {
      const rows = (r.doc as GridDoc).layout.rows;
      const row = rows[at ? at.r + 1 : rows.length - 1];
      if (row?.cells[0]) {
        this.select(row.cells[0].id);
        // đưa hàng mới vào tầm nhìn (focus cuộn vùng làm việc tới ô)
        this.focusCell(row.cells[0].id);
      }
      this.app.toast(t('lay.tpl.added', { name: t(`lay.tpl.${id}` as MessageKey) }));
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
    } else if (e.key === 'Escape' && this.entered !== null) {
      stop();
      this.exitSvg();
    } else if (
      e.key === 'Enter' &&
      this.entered === null &&
      this.selCell === cellId &&
      this.enterCell(cellId)
    ) {
      // Enter trên ô đang chọn chứa item svg: vào đồ họa (như canvas tự do).
      stop();
    } else if (e.key === 'Enter' || e.key === ' ') {
      stop();
      this.select(cellId);
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      // Feature 029: + / − đổi số cột của ô (một chạm, không cần mở ô nhập)
      stop();
      this.edit((x) => setCellProps(x, cellId, { span: at.cell.span + (e.key === '-' ? -1 : 1) }));
      this.focusCell(cellId);
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
    const types = e.dataTransfer?.types ?? [];
    if (types.includes(CELL_TYPE) || types.includes(ROW_TYPE)) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      if (this.overCell !== cellId) this.overCell = cellId;
      return;
    }
    const widget = this.typeOf(e, WIDGET_TYPE);
    const tag = types.includes(TAG_TYPE);
    if (widget === null && !(tag && this.find(cellId)?.cell.item !== undefined)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = widget !== null ? 'copy' : 'link';
    if (this.overCell !== cellId) this.overCell = cellId;
  }

  private onDrop(e: DragEvent, cellId: string): void {
    this.overCell = null;
    this.dragging = false;
    if (this.app.screens.previewMode !== 'off') return;
    if (this.onMoveDrop(e, cellId)) return;
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

  /** Bước kéo theo cột (px màn hình) của một hàng. */
  private colStep(rowId: string): number {
    const d = this.doc();
    const row = d?.layout.rows.find((r) => r.id === rowId);
    const pad = d?.layout.padding ?? 16;
    const gap = row?.gap ?? d?.layout.gap ?? 12;
    const col = (this.previewWidth - 2 * pad - (GRID_COLUMNS - 1) * gap) / GRID_COLUMNS;
    return Math.max(1, (col + gap) * this.zoom());
  }

  /**
   * Feature 029: kéo cạnh phải của ô cuối hàng (nơi không có đường chia) để đổi số cột. Mỗi bước một cột, cả lần kéo là
   * một bước hoàn tác.
   */
  private onEdgeDown(e: PointerEvent, cellId: string, rowId: string): void {
    e.preventDefault();
    e.stopPropagation();
    const start = this.find(cellId)?.cell.span;
    if (start === undefined) return;
    const step = this.colStep(rowId);
    const x0 = e.clientX;
    const key = `grid-edge-${Date.now()}`;
    let applied = 0;
    this.dragging = true;
    const move = (ev: PointerEvent) => {
      const want = Math.round((ev.clientX - x0) / step);
      if (want === applied) return;
      const r = this.edit((x) => setCellProps(x, cellId, { span: start + want }), key);
      if (r && !r.rejected) applied = want;
    };
    const up = () => {
      this.dragging = false;
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', up);
    };
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', up);
  }

  /** Áp nhiều bước dời trong một lần sửa (một bước hoàn tác). */
  private shift(
    fn: (d: ScreenModel, dir: -1 | 1) => ReturnType<typeof moveCell>,
    steps: number,
  ): void {
    if (steps === 0) return;
    const dir: -1 | 1 = steps < 0 ? -1 : 1;
    this.edit((d) => {
      let r = fn(d, dir);
      for (let i = 1; i < Math.abs(steps) && !r.rejected; i++) r = fn(r.doc, dir);
      return r;
    });
  }

  /** Feature 029: thả ô (kéo bằng tay nắm) lên ô khác cùng hàng để đổi chỗ; thả hàng lên hàng khác để dời hàng. */
  private onMoveDrop(e: DragEvent, targetCell: string): boolean {
    const cellSrc = e.dataTransfer?.getData(CELL_TYPE) ?? '';
    const rowSrc = e.dataTransfer?.getData(ROW_TYPE) ?? '';
    if (!cellSrc && !rowSrc) return false;
    e.preventDefault();
    const to = this.find(targetCell);
    if (!to) return true;
    if (cellSrc) {
      const from = this.find(cellSrc);
      if (!from) return true;
      if (from.row.id !== to.row.id) {
        this.app.toast(t('lay.moveSameRow'));
        return true;
      }
      this.shift((d, dir) => moveCell(d, cellSrc, dir), to.c - from.c);
      this.select(cellSrc);
    } else {
      const fr = this.doc()?.layout.rows.findIndex((r) => r.id === rowSrc) ?? -1;
      if (fr >= 0) this.shift((x, dir) => moveRow(x, rowSrc, dir), to.r - fr);
    }
    return true;
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
    this.dragging = true;
    this.#drag = {
      row: rowId,
      index,
      startX: e.clientX,
      step: Math.max(1, (col + gap) * this.zoom()),
      applied: 0,
    };
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
      this.dragging = false;
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
    // Hai dòng gọn: dòng 1 luôn có (thêm hàng, chiều rộng, xem trước); dòng 2 chỉ khi đang chọn ô (thuộc tính Ô:, Hàng:).
    return html`<div class="ge-bars">
      <div class="ge-bar" role="toolbar" aria-label=${t('lay.toolbar')}>
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
                  <div class="ge-sec" role="group" aria-label=${t('lay.presetMenu')}>
                    <b class="ge-sec-h">${t('lay.presetMenu')}</b>
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
                  </div>
                  <div class="ge-sec ge-tpls" role="group" aria-label=${t('lay.tplMenu')}>
                    <b class="ge-sec-h">${t('lay.tplMenu')}</b>
                    ${ROW_TEMPLATE_IDS.map(
                      (id) =>
                        html`<button
                          type="button"
                          role="menuitem"
                          class="ge-tpl"
                          data-template=${id}
                          title=${t(`lay.tpl.${id}.hint` as MessageKey)}
                          @click=${() => this.addRowTemplate(id)}
                        >
                          <span class="ge-tpl-pv" aria-hidden="true">
                            ${ROW_TEMPLATES[id].cells.map(
                              (c, i) =>
                                html`<i
                                  class=${c.widget === 'stat-tile' ? `pv-tile pv-tile-${i}` : 'pv-chart'}
                                  style=${`flex:${c.span}`}
                                ></i>`,
                            )}
                          </span>
                          <span class="ge-tpl-t">
                            <span>${t(`lay.tpl.${id}` as MessageKey)}</span>
                            <small>${t(`lay.tpl.${id}.hint` as MessageKey)}</small>
                          </span>
                        </button>`,
                    )}
                  </div>
                </div>`
              : nothing
          }
        </span>
        <span class="ge-quick" role="group" aria-label=${t('lay.quickRow')}>
          ${GRID_PRESETS.slice(0, 6).map(
            (p) =>
              html`<button
                type="button"
                class="btn seg ge-qp"
                data-quick=${p.join('+')}
                title=${t('lay.quickRowTip', { spans: p.join(' + ') })}
                aria-label=${t('lay.quickRowTip', { spans: p.join(' + ') })}
                ?disabled=${ro}
                @click=${() => this.addRowPreset(p)}
              >
                <span class="ge-preview">${p.map((s) => html`<i style=${`flex:${s}`}></i>`)}</span>
              </button>`,
          )}
        </span>
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
      </div>
      ${
        at
          ? html`<div class="ge-bar ge-bar2" role="toolbar" aria-label=${t('lay.selBar')}>
              ${this.cellProps(at, ro)} ${this.rowProps(at, ro, d)}
            </div>`
          : nothing
      }
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
      <b>${t('lay.cell')}:</b>
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
      <b>${t('lay.row')}:</b>
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
      <span class="ge-group" role="group" aria-label=${t('lay.quickHeight')}>
        ${QUICK_HEIGHTS.map(
          (h) =>
            html`<button
              type="button"
              class="btn seg"
              data-height=${String(h)}
              aria-pressed=${row.height === h ? 'true' : 'false'}
              ?disabled=${ro}
              @click=${() => this.setRow({ height: h })}
            >
              ${h === 'auto' ? t('lay.heightAutoShort') : h}
            </button>`,
        )}
      </span>
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

  /** Feature 029: thanh nhỏ ngay trên ô đang chọn: kéo đổi chỗ, −/+ cột, thêm ô, xóa ô. */
  private miniBar(row: GridRow, cell: GridCell): TemplateResult {
    const ro = this.app.store.state.readOnly;
    const b = (act: string, label: MessageKey, body: unknown, fn: () => void, dis = false) =>
      html`<button
        type="button"
        data-act=${act}
        title=${t(label)}
        aria-label=${t(label)}
        ?disabled=${ro || dis}
        @click=${(e: Event) => {
          e.stopPropagation();
          fn();
        }}
      >
        ${body}
      </button>`;
    const span = (v: number) => () => this.edit((d) => setCellProps(d, cell.id, { span: v }));
    return html`<span class="ge-mini" role="toolbar" aria-label=${t('lay.cell')}>
      <span
        class="ge-grip"
        draggable=${ro ? 'false' : 'true'}
        title=${t('lay.dragCell')}
        @dragstart=${(e: DragEvent) => {
          e.stopPropagation();
          e.dataTransfer?.setData(CELL_TYPE, cell.id);
          this.dragging = true;
        }}
        @dragend=${() => (this.dragging = false)}
        >⠿</span
      >
      ${b('mini-narrow', 'lay.spanLess', '−', span(cell.span - 1), cell.span <= 1)}
      <b class="ge-mini-n">${cell.span}/12</b>
      ${b('mini-wide', 'lay.spanMore', '+', span(cell.span + 1), cell.span >= 12)}
      ${b('mini-add', 'lay.cellAdd', icon('plus'), () => this.edit((d) => addCell(d, row.id)))}
      ${b('mini-remove', 'lay.cellRemove', icon('trash'), () => {
        this.edit((d) => removeCell(d, cell.id));
        this.selCell = null;
      })}
    </span>`;
  }

  private overlays(d: GridDoc, edit: boolean): TemplateResult[] {
    if (!edit) return [];
    return d.layout.rows
      .flatMap((row) =>
        row.cells.map((cell, c) => {
          const empty = cell.item === undefined;
          const next = row.cells[c + 1];
          const label = t('lay.cellLabel', {
            cell: cell.id,
            span: cell.span,
            content: this.nameOfItem(cell.item),
          });
          const inSvg = cell.item !== undefined && cell.item === this.entered;
          return html`<div
            class="ge-cell ${inSvg ? 'entered' : ''} ${this.selCell === cell.id ? 'sel' : ''} ${
              this.overCell === cell.id ? 'over' : ''
            } ${empty ? 'empty' : ''}"
            slot=${`cell-${cell.id}`}
            data-cell=${cell.id}
            tabindex="0"
            role="button"
            aria-pressed=${this.selCell === cell.id ? 'true' : 'false'}
            aria-label=${label}
            title=${label}
            @click=${(e: MouseEvent) => this.onCellClick(e, cell.id)}
            @dblclick=${() => this.enterCell(cell.id)}
            @pointermove=${(e: PointerEvent) => this.onCellHover(e, cell.id)}
            @pointerleave=${() => {
              if (inSvg && this.hoverUid !== null) this.hoverUid = null;
            }}
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
              inSvg
                ? html`<mat-svg-overlay
                    .app=${this.app}
                    .screenId=${this.screenId}
                    .itemId=${cell.item}
                    .viewport=${{ zoom: this.zoom(), panX: 0, panY: 0 }}
                    .hoverUid=${this.hoverUid}
                    .dropUid=${null}
                    .fill=${true}
                    .rev=${this.app.screens.svgRevision}
                  ></mat-svg-overlay>`
                : nothing
            }
            ${
              c === 0
                ? html`<span
                    class="ge-rowgrip"
                    draggable="true"
                    title=${t('lay.dragRow')}
                    aria-hidden="true"
                    @dragstart=${(e: DragEvent) => {
                      e.stopPropagation();
                      e.dataTransfer?.setData(ROW_TYPE, row.id);
                      this.dragging = true;
                    }}
                    @dragend=${() => (this.dragging = false)}
                    >⋮⋮</span
                  >`
                : nothing
            }
            ${
              next
                ? nothing
                : html`<span
                    class="ge-edge"
                    role="separator"
                    aria-orientation="vertical"
                    title=${t('lay.edge')}
                    aria-label=${t('lay.edge')}
                    @pointerdown=${(e: PointerEvent) => this.onEdgeDown(e, cell.id, row.id)}
                  ></span>`
            }
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
      )
      .concat(this.miniHost(d));
  }

  /**
   * Thanh nhỏ của ô đang chọn: phần tử anh em cùng slot (nút không lồng trong ô role=button, axe nested-interactive),
   * đặt cuối danh sách để chọn hay dời ô không làm dịch các lớp phủ khác (giữ nhanh khi di chuyển ô).
   */
  private miniHost(d: GridDoc): TemplateResult<1>[] {
    if (this.entered !== null) return [];
    for (const row of d.layout.rows)
      for (const cell of row.cells)
        if (cell.id === this.selCell)
          return [
            html`<div class="ge-mini-host" slot=${`cell-${cell.id}`}>
              ${this.miniBar(row, cell)}
            </div>`,
          ];
    return [];
  }

  protected override render() {
    const d = this.doc();
    if (!d) return nothing;
    const edit = this.app.screens.previewMode === 'off';
    const src = this.source();
    return html`<div class="ge ${this.dragging ? 'dragging' : ''}">
      ${this.toolbar(d)}
      ${
        d.layout.rows.length === 0
          ? html`<div class="ge-empty" role="status">${t('lay.noRows')}</div>`
          : nothing
      }
      <div class="ge-stage">
        <div class="ge-page" style=${`width:${this.previewWidth}px;zoom:${this.zoom()}`}>
          <mat-screen
            .screen=${this.#bindRevs.viewDoc(d, edit ? 'edit' : this.app.screens.previewMode)}
            .tags=${src.source}
            .host=${src.host}
            .alarms=${src.alarms ?? undefined}
            .mode=${edit ? 'edit' : 'run'}
            .autoHeight=${true}
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
