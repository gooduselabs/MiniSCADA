// mat-grid: lưới ảo hóa tự viết trên Lit (feature 006, ADR-016, FR-045, FR-046, studio-ux §5).
//
// - Dòng cao cố định (24 px gọn, 28 px thoáng); chỉ vẽ khung nhìn cộng 10 dòng đệm mỗi phía; không ảo hóa cột.
// - ARIA `grid`: `aria-rowcount`/`aria-rowindex`, `aria-colcount`/`aria-colindex`; tiêu đề và cột tên dính khi cuộn.
// - MỘT `textarea` luôn giữ focus khi lưới được focus, đặt đúng trên ô hiện hành: ở chế độ di chuyển nó rỗng và trong
//   suốt; `compositionstart`, hoặc `beforeinput`/`input` có chữ, vào chế độ sửa NGAY TRÊN CHÍNH PHẦN TỬ ĐÓ, không dời
//   focus, không gán lại `value` (bộ gõ Telex TSF của Windows không có chỗ ghép chữ nếu focus nằm ở bảng). Phím
//   `Process` không bao giờ bị chặn; Enter, Tab, mũi tên khi đang ghép thuộc về bộ gõ.
// - Sao chép, cắt, dán qua sự kiện clipboard của chính ô nhập; ô danh sách chọn dùng cùng ô nhập làm ô lọc (combobox).
// - Mô hình (chọn vùng, sửa, dán, điền, CSV, lọc, sắp xếp) là logic thuần ở model/grid; component chỉ nối sự kiện.
//
// Sự kiện: `grid-state` {state} khi trạng thái đổi; `grid-edit` {edits, rejected} khi có sửa đổi (người nghe áp vào
// store thành MỘT bước hoàn tác); `grid-notice` {text, key} thông báo ngắn. CSS theo tên thẻ (mat-grid.css).
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { fold, hasKey, t, type MessageKey } from '../../i18n/index.ts';
import {
  beginEdit,
  beginTyped,
  buildView,
  clampSelection,
  clearSelection,
  commitEdit,
  compositionEnd,
  compositionStart,
  copyText,
  dragFill,
  fillDown,
  editKey,
  gridKey,
  initialGrid,
  paste,
  selectCell,
  selectionRect,
  setColFilter,
  setSort,
  type GridAdapter,
  type GridColumn,
  type GridOutcome,
  type GridState,
  type GridView,
  type Pos,
  type Rejected,
} from '../../model/grid/index.ts';
import { posIn } from '../../model/grid/selection.ts';
import { cellId as cellKeyOf } from '../../model/grid/types.ts';
import './mat-grid.css';

const BUFFER = 10;
/** Bề rộng cột số thứ tự (px). */
const NUM_WIDTH = 44;
/** Số dòng coi như vừa khung nhìn khi chưa đo được (jsdom, lần vẽ đầu). */
const FALLBACK_ROWS = 30;

let uidSeq = 0;

export interface GridEditDetail {
  edits: import('../../model/project-doc.ts').ProjectEdit[];
  rejected: Rejected[];
}

export type CellRenderer = (
  row: number,
  col: GridColumn,
  text: string,
) => TemplateResult | string | undefined;

export class MatGrid extends LitElement {
  static override properties = {
    adapter: { attribute: false },
    state: { attribute: false },
    label: {},
    issues: { attribute: false },
    warns: { attribute: false },
    rowHeight: { type: Number },
    showFilters: { type: Boolean },
    decimal: {},
    renderCell: { attribute: false },
    ticks: { type: Number },
  };

  declare adapter: GridAdapter;
  declare state: GridState;
  declare label: string;
  /** Lỗi theo ô: khóa `dòng:cột` (cellId) → các lý do. */
  declare issues: ReadonlyMap<string, readonly string[]>;
  /** Cảnh báo theo ô (khóa như `issues`): viền hổ phách, không chặn gì. */
  declare warns: ReadonlyMap<string, readonly string[]>;
  declare rowHeight: number;
  declare showFilters: boolean;
  /** Dấu thập phân của số khi dán. */
  declare decimal: '.' | ',';
  /** Vẽ riêng nội dung của một số ô (giá trị sống, màu…); `undefined` thì vẽ chữ của ô. */
  declare renderCell: CellRenderer | undefined;
  /** Tăng để vẽ lại khi dữ liệu ngoài đổi mà adapter không đổi (giá trị sống). */
  declare ticks: number;

  private readonly uid = `mg${++uidSeq}`;
  private sTop = 0;
  private vh = 0;
  private cachedView: { adapter: GridAdapter; key: string; view: GridView } | null = null;
  /** Lỗi do ô bị từ chối khi dán hoặc sửa; mất khi sửa lại. */
  private cellErrors = new Map<string, string>();
  private hi = 0;
  private dragging: 'select' | 'fill' | null = null;
  private resizeObs: ResizeObserver | null = null;
  private focusAfter: 'input' | null = null;
  private pendingScroll = false;
  private noticeText = '';

  constructor() {
    super();
    this.adapter = {
      columns: [],
      maxRows: 0,
      rowCount: () => 0,
      text: () => '',
      editable: () => false,
      apply: () => ({ edits: [], rejected: [] }),
    };
    this.state = initialGrid;
    this.label = '';
    this.issues = new Map();
    this.warns = new Map();
    this.rowHeight = 24;
    this.showFilters = false;
    this.decimal = '.';
    this.renderCell = undefined;
    this.ticks = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  // ---------- Vòng đời ----------

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('pointermove', this.onWindowMove);
    window.addEventListener('pointerup', this.onWindowUp);
  }

  override disconnectedCallback(): void {
    window.removeEventListener('pointermove', this.onWindowMove);
    window.removeEventListener('pointerup', this.onWindowUp);
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    const scroll = this.scrollEl();
    if (scroll && typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.syncViewport());
      this.resizeObs.observe(scroll);
    }
    this.syncViewport();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('adapter')) {
      this.cachedView = null;
      const clamped = clampSelection(this.adapter, this.state);
      if (clamped !== this.state) this.state = clamped;
    }
  }

  protected override updated(): void {
    this.announceViewport();
    if (this.pendingScroll) {
      this.pendingScroll = false;
      this.scrollToCell();
    }
    if (this.focusAfter === 'input') {
      this.focusAfter = null;
      this.input()?.focus({ preventScroll: true });
    }
  }

  // ---------- Truy cập phần tử ----------

  private scrollEl(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.mg-scroll');
  }

  private input(): HTMLTextAreaElement | null {
    return this.querySelector<HTMLTextAreaElement>('textarea.mg-input');
  }

  /** Đo lại khung nhìn (cuộn, đổi cỡ). */
  syncViewport(): void {
    const el = this.scrollEl();
    if (!el) return;
    this.sTop = el.scrollTop;
    this.vh = el.clientHeight;
    this.requestUpdate();
  }

  /** Chỉ số dòng gốc đang hiện trong khung nhìn (không tính dòng đệm): để đăng ký dữ liệu sống chỉ cho các dòng này. */
  visibleRows(): number[] {
    const view = this.view();
    const rowH = this.rowHeight;
    const vh = this.vh || rowH * FALLBACK_ROWS;
    const first = Math.max(0, Math.floor(this.sTop / rowH));
    const last = Math.min(
      view.rows.length - 1,
      Math.ceil((this.sTop + vh - this.headerHeight) / rowH) - 1,
    );
    return view.rows.slice(first, last + 1);
  }

  private lastViewport = '';

  /** Báo `grid-viewport` {rows} khi tập dòng đang hiện đổi. */
  private announceViewport(): void {
    const rows = this.visibleRows();
    const key = rows.length
      ? `${rows[0]}-${rows.length}-${rows.at(-1)}-${this.adapter.rowCount()}`
      : '';
    if (key === this.lastViewport) return;
    this.lastViewport = key;
    this.dispatchEvent(new CustomEvent('grid-viewport', { detail: { rows }, bubbles: true }));
  }

  focusGrid(): void {
    this.input()?.focus({ preventScroll: true });
  }

  // ---------- Dòng đang hiện, hình học ----------

  private view(): GridView {
    const s = this.state;
    const key = `${s.filter}|${JSON.stringify(s.colFilters)}|${s.sort ? `${s.sort.col}:${s.sort.dir}` : ''}`;
    const c = this.cachedView;
    if (c && c.adapter === this.adapter && c.key === key) return c.view;
    const view = buildView(this.adapter, s);
    this.cachedView = { adapter: this.adapter, key, view };
    return view;
  }

  private get headerRows(): number {
    return this.showFilters ? 2 : 1;
  }

  private get headerHeight(): number {
    return this.headerRows * this.rowHeight;
  }

  private offsets(): { left: Map<string, number>; width: number } {
    const left = new Map<string, number>();
    let x = NUM_WIDTH;
    for (const c of this.adapter.columns) {
      left.set(c.key, x);
      x += c.width;
    }
    return { left, width: x };
  }

  private cellDomId(row: number, col: string): string {
    return `${this.uid}-c-${row}-${col}`;
  }

  // ---------- Trạng thái ----------

  private setState(next: GridState): void {
    const prev = this.state;
    if (next === prev) return;
    this.state = next;
    // Vào sửa bằng F2, nhấp đúp: ô nhập nhận chữ hiện tại và chọn hết; thoát sửa: ô nhập rỗng.
    const ta = this.input();
    if (ta) {
      if (!prev.editing && next.editing && next.editing.origin !== 'typed') {
        ta.value = next.editing.text;
        queueMicrotask(() => ta.select());
      } else if (prev.editing && !next.editing) ta.value = '';
    }
    if (prev.cell !== next.cell && next.cell) this.pendingScroll = true;
    this.hi = 0;
    this.dispatchEvent(new CustomEvent('grid-state', { detail: { state: next }, bubbles: true }));
  }

  private notify(text: string, key = ''): void {
    this.noticeText = text;
    this.dispatchEvent(new CustomEvent('grid-notice', { detail: { text, key }, bubbles: true }));
  }

  /** Áp kết quả của mô hình: trạng thái, sửa đổi, thông báo, ô bị từ chối. */
  private apply(out: GridOutcome, e?: Event): void {
    if (out.handled) e?.preventDefault();
    this.setState(out.state);
    // Sửa lại ô thì hết lỗi cũ của ô đó (theo dòng với Bảng Tag; mọi lỗi cũ với bảng khác); đặt lỗi mới sau cùng.
    for (const ed of out.edits) this.clearErrorsFor(ed);
    for (const r of out.rejected ?? [])
      this.cellErrors.set(
        cellKeyOf(r.row, r.col, r.newIndex),
        hasKey(String(r.reason)) ? t(r.reason as MessageKey) : String(r.reason),
      );
    if (out.edits.length) {
      this.dispatchEvent(
        new CustomEvent<GridEditDetail>('grid-edit', {
          detail: { edits: out.edits, rejected: out.rejected ?? [] },
          bubbles: true,
        }),
      );
    }
    if (out.notice) this.notify(t(out.notice.key, out.notice.params), out.notice.key);
    this.requestUpdate();
  }

  private clearErrorsFor(ed: import('../../model/project-doc.ts').ProjectEdit): void {
    if (ed.kind === 'batch') for (const e of ed.edits) this.clearErrorsFor(e);
    else if (ed.kind === 'tagField' || ed.kind === 'tagRemove') {
      for (const k of [...this.cellErrors.keys()])
        if (k.startsWith(`${ed.index}:`)) this.cellErrors.delete(k);
    } else if (ed.kind !== 'tagUpsert') this.cellErrors.clear();
  }

  /** Điền xuống bằng lệnh (menu Điền xuống, Ctrl+D): xác nhận ô đang sửa trước. */
  fillDownSelection(): void {
    this.commitPending();
    this.apply(fillDown(this.adapter, this.state));
  }

  /** Chỉ số dòng gốc của các dòng trong vùng chọn (theo thứ tự đang hiện). */
  selectedRows(): number[] {
    const view = this.view();
    const rect = selectionRect(view, this.state);
    return rect ? view.rows.slice(rect.r0, rect.r1 + 1) : [];
  }

  /** Vị trí (0 là dòng đầu) của ô hiện hành trong các dòng đang hiện; `null` khi chưa chọn. */
  currentPosition(): number | null {
    const cur = this.state.cell && posIn(this.view(), this.state.cell);
    return cur ? cur.r : null;
  }

  /** Số dòng đang hiện (sau lọc). */
  shownCount(): number {
    return this.view().rows.length;
  }

  /** Xác nhận ô đang sửa dở (nhấp chỗ khác, Ctrl+S, rời ô nhập). */
  commitPending(): void {
    if (!this.state.editing) return;
    this.apply(
      commitEdit(this.adapter, this.state, this.input()?.value ?? this.state.editing.text, 'none'),
    );
  }

  /** Chọn ô (và vào sửa nếu `edit`) rồi cuộn tới ô: dùng cho "nhảy tới lỗi", Details, Tìm. */
  reveal(pos: Pos, opts: { edit?: boolean } = {}): void {
    this.commitPending();
    let s = selectCell(this.adapter, this.state, pos);
    if (s === this.state || !s.cell) {
      // Dòng bị lọc: bỏ lọc để thấy ô.
      s = selectCell(this.adapter, { ...this.state, filter: '', colFilters: {} }, pos);
    }
    this.cachedView = null;
    this.setState(s);
    this.pendingScroll = true;
    if (opts.edit) this.apply(beginEdit(this.adapter, this.state, 'f2'));
    this.focusAfter = 'input';
    this.requestUpdate();
  }

  // ---------- Sự kiện của ô nhập ----------

  private readonly onKey = (e: KeyboardEvent): void => {
    const input = e.currentTarget as HTMLTextAreaElement;
    const s = this.state;
    if (s.editing) {
      // Ô danh sách chọn: mũi tên chọn mục, Enter/Tab lấy mục sáng.
      const opts = this.listOptions();
      if (opts && !e.isComposing && e.key !== 'Process') {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          this.hi = Math.max(
            0,
            Math.min(opts.length - 1, this.hi + (e.key === 'ArrowDown' ? 1 : -1)),
          );
          this.requestUpdate();
          return;
        }
        if ((e.key === 'Enter' || e.key === 'Tab') && opts.length) {
          this.apply(
            commitEdit(
              this.adapter,
              s,
              opts[Math.min(this.hi, opts.length - 1)],
              e.key === 'Tab' ? (e.shiftKey ? 'left' : 'right') : 'down',
            ),
            e,
          );
          return;
        }
      }
      this.apply(editKey(this.adapter, s, e, input.value), e);
      return;
    }
    const pageSize = Math.max(
      1,
      Math.floor((this.vh || this.rowHeight * FALLBACK_ROWS) / this.rowHeight) - 1,
    );
    this.apply(gridKey(this.adapter, s, e, { pageSize }), e);
  };

  private readonly onInput = (e: Event): void => {
    const input = e.currentTarget as HTMLTextAreaElement;
    const ev = e as InputEvent;
    if (this.state.editing) {
      this.setState({ ...this.state, editing: { ...this.state.editing, text: input.value } });
      this.hi = 0;
      this.requestUpdate();
      return;
    }
    if (input.value === '' || ev.inputType?.startsWith('delete')) return;
    // Chữ đã vào ô nhập: giữ nguyên, chỉ báo cho lưới biết đang sửa.
    this.apply(beginTyped(this.adapter, this.state, input.value));
    if (!this.state.editing) input.value = '';
    this.requestUpdate();
  };

  private readonly onBeforeInput = (e: Event): void => {
    const ev = e as InputEvent;
    if (!this.state.editing && ev.data && !ev.isComposing) {
      // Ô chỉ đọc: chặn chữ vào, báo lý do.
      const cell = this.state.cell;
      if (cell && !this.adapter.editable(cell.row, cell.col)) {
        e.preventDefault();
        this.notify(t('gx.notice.readonly'), 'gx.notice.readonly');
      }
    }
  };

  private readonly onCompositionStart = (): void => {
    this.apply(compositionStart(this.adapter, this.state));
    if (!this.state.editing) return;
    this.requestUpdate();
  };

  private readonly onCompositionEnd = (e: Event): void => {
    const input = e.currentTarget as HTMLTextAreaElement;
    const cancelled = this.state.ime === 'cancelPending';
    this.apply(compositionEnd(this.adapter, this.state));
    if (cancelled) input.value = '';
    else if (this.state.editing) {
      // Chữ cuối cùng của lần ghép.
      this.setState({ ...this.state, editing: { ...this.state.editing, text: input.value } });
    }
  };

  private readonly onBlur = (): void => {
    if (!this.state.editing) return;
    // Cửa sổ mất focus (chuyển ứng dụng): giữ ô đang sửa, quay lại gõ tiếp.
    if (typeof document.hasFocus === 'function' && !document.hasFocus() && !this.isConnected)
      return;
    if (this.state.ime === 'composing') return;
    this.commitPending();
  };

  private readonly onFocus = (): void => {
    if (this.state.cell) return;
    const view = this.view();
    if (view.rows.length && view.cols.length)
      this.setState(selectCell(this.adapter, this.state, { row: view.rows[0], col: view.cols[0] }));
  };

  private readonly onCopy = (e: ClipboardEvent): void => {
    if (!this.state.cell) return;
    e.clipboardData?.setData('text/plain', copyText(this.adapter, this.state));
    e.preventDefault();
  };

  private readonly onCut = (e: ClipboardEvent): void => {
    this.onCopy(e);
    if (!this.state.editing) this.apply(clearSelection(this.adapter, this.state));
  };

  private readonly onPaste = (e: ClipboardEvent): void => {
    if (this.state.editing) return; // đang sửa: ô nhập tự dán chữ vào ô
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!this.state.cell) return;
    e.preventDefault();
    const r = paste(this.adapter, this.state, text, { decimal: this.decimal });
    this.apply({ state: r.state, edits: r.edits, handled: true, rejected: r.rejected });
    const notes: string[] = [];
    if (r.skippedHeader) notes.push(t('gx.notice.headerSkipped'));
    if (r.droppedCols) notes.push(t('gx.notice.colsDropped', { count: r.droppedCols }));
    if (r.droppedRows)
      notes.push(t('gx.notice.rowLimit', { max: this.adapter.maxRows, count: r.droppedRows }));
    if (r.rejected.length) notes.push(t('gx.notice.rejected', { count: r.rejected.length }));
    if (!notes.length && r.edits.length)
      notes.push(t('gx.notice.pasted', { rows: text.split(/\r?\n/).filter(Boolean).length }));
    if (notes.length) this.notify(notes.join('. '));
  };

  // ---------- Chuột ----------

  private cellAt(target: EventTarget | null): Pos | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-r][data-c]') : null;
    return el ? { row: Number(el.dataset.r), col: el.dataset.c as string } : null;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.mg-fill')) {
      e.preventDefault();
      this.dragging = 'fill';
      return;
    }
    const pos = this.cellAt(e.target);
    if (!pos) return;
    // Giữ focus ở ô nhập (không để trình duyệt chuyển focus sang ô vừa nhấp).
    e.preventDefault();
    if (
      this.state.editing &&
      !(this.state.editing.row === pos.row && this.state.editing.col === pos.col)
    )
      this.commitPending();
    if (this.state.editing) return;
    this.setState(selectCell(this.adapter, this.state, pos, e.shiftKey));
    this.dragging = 'select';
    this.input()?.focus({ preventScroll: true });
    this.requestUpdate();
  };

  private readonly onDblClick = (e: MouseEvent): void => {
    const pos = this.cellAt(e.target);
    if (!pos) return;
    if (!this.state.cell || this.state.cell.row !== pos.row || this.state.cell.col !== pos.col)
      this.setState(selectCell(this.adapter, this.state, pos));
    this.apply(beginEdit(this.adapter, this.state, 'dblclick'));
    this.input()?.focus({ preventScroll: true });
  };

  private readonly onWindowMove = (e: PointerEvent): void => {
    if (!this.dragging || typeof document.elementFromPoint !== 'function') return;
    const pos = this.cellAt(document.elementFromPoint(e.clientX, e.clientY));
    if (!pos) return;
    if (this.dragging === 'select') {
      if (this.state.cell?.row !== pos.row || this.state.cell?.col !== pos.col)
        this.setState(selectCell(this.adapter, this.state, pos, true));
    } else this.fillTo = pos.row;
  };

  private fillTo: number | null = null;

  private readonly onWindowUp = (): void => {
    const was = this.dragging;
    this.dragging = null;
    if (was === 'fill' && this.fillTo !== null) {
      this.apply(dragFill(this.adapter, this.state, this.fillTo));
      this.fillTo = null;
    }
  };

  private onSort(col: string): void {
    const cur = this.state.sort;
    const next =
      cur?.col !== col
        ? setSort(this.adapter, this.state, col, 'asc')
        : cur.dir === 'asc'
          ? setSort(this.adapter, this.state, col, 'desc')
          : setSort(this.adapter, this.state, null, 'asc');
    this.cachedView = null;
    this.setState(next);
  }

  private onColFilter(col: string, value: string): void {
    this.cachedView = null;
    this.setState(setColFilter(this.adapter, this.state, col, value));
  }

  // ---------- Cuộn ----------

  private readonly onScroll = (): void => {
    const el = this.scrollEl();
    if (!el) return;
    this.sTop = el.scrollTop;
    this.requestUpdate();
  };

  /** Cuộn tới ô hiện hành mà không bị tiêu đề, cột số và cột tên (dính) che. */
  private scrollToCell(): void {
    const el = this.scrollEl();
    const cell = this.state.cell;
    if (!el || !cell) return;
    const view = this.view();
    const p = posIn(view, cell);
    if (!p) return;
    const rowTop = p.r * this.rowHeight;
    const vh = el.clientHeight || this.rowHeight * FALLBACK_ROWS;
    const usable = vh - this.headerHeight;
    if (rowTop < el.scrollTop) el.scrollTop = rowTop;
    else if (rowTop + this.rowHeight > el.scrollTop + usable)
      el.scrollTop = rowTop + this.rowHeight - usable;
    const { left } = this.offsets();
    const col = this.adapter.columns.find((c) => c.key === cell.col);
    if (col) {
      const x = left.get(col.key) ?? 0;
      const sticky = NUM_WIDTH + (this.adapter.columns[0]?.width ?? 0);
      const vw = el.clientWidth;
      if (vw) {
        if (x - sticky < el.scrollLeft && col !== this.adapter.columns[0])
          el.scrollLeft = Math.max(0, x - sticky);
        else if (x + col.width > el.scrollLeft + vw) el.scrollLeft = x + col.width - vw;
      }
    }
    this.syncViewport();
  }

  // ---------- Danh sách chọn ----------

  /** Mục của danh sách chọn đang mở (ô `select` đang sửa), đã lọc theo chữ gõ; `null` khi không có. */
  private listOptions(): string[] | null {
    const ed = this.state.editing;
    if (!ed) return null;
    const col = this.adapter.columns.find((c) => c.key === ed.col);
    if (col?.kind !== 'select') return null;
    const all = this.adapter.options?.(ed.row, ed.col);
    if (!all) return null;
    // Vào bằng F2 hoặc nhấp đúp: hiện đủ danh sách; gõ thì lọc.
    const q = ed.origin === 'typed' || ed.text !== ed.original ? fold(ed.text) : '';
    return all.filter((o) => fold(o).includes(q));
  }

  private optionId(i: number): string {
    return `${this.uid}-opt-${i}`;
  }

  // ---------- Vẽ ----------

  private cellContent(row: number, col: GridColumn, text: string): unknown {
    const custom = this.renderCell?.(row, col, text);
    if (custom !== undefined) return custom;
    if (col.kind === 'color' && /^#[0-9a-fA-F]{6}$/.test(text))
      return html`<span class="mg-swatch" style=${styleMap({ background: text })}></span>${text}`;
    return text;
  }

  private rowTemplate(
    row: number,
    pos: number,
    rect: ReturnType<typeof selectionRect>,
    headerH: number,
  ): TemplateResult {
    const a = this.adapter;
    const cur = this.state.cell;
    const rowSelected = !!rect && pos >= rect.r0 && pos <= rect.r1;
    return html`<div
      role="row"
      class="mg-row${rowSelected ? ' mg-rsel' : ''}"
      data-r=${row}
      aria-rowindex=${pos + 1 + this.headerRows}
      style=${styleMap({ top: `${headerH + pos * this.rowHeight}px`, height: `${this.rowHeight}px` })}
    >
      <div role="rowheader" class="mg-num" aria-colindex="1">${pos + 1}</div>
      ${a.columns.map((col, ci) => {
        const text = a.text(row, col.key);
        const inSel = !!rect && pos >= rect.r0 && pos <= rect.r1 && ci >= rect.c0 && ci <= rect.c1;
        const isCur = !!cur && cur.row === row && cur.col === col.key;
        const key = cellKeyOf(row, col.key);
        const issue = this.issues.get(key);
        const err = issue?.length ? issue.join('\n') : (this.cellErrors.get(key) ?? '');
        const warnList = this.warns.get(key);
        const warn = !err && warnList?.length ? warnList.join('\n') : '';
        const ro = col.kind === 'readonly' || col.kind === 'live' || !a.editable(row, col.key);
        const cls = [
          'mg-cell',
          col.mono ? 'mono' : '',
          col.end ? 'r' : '',
          col.name ? 'mg-name' : '',
          ro ? 'mg-ro' : '',
          col.kind === 'live' ? 'mg-live' : '',
          inSel ? 'mg-sel' : '',
          isCur ? 'mg-cur' : '',
          err ? 'mg-err' : '',
          warn ? 'mg-warn' : '',
        ]
          .filter(Boolean)
          .join(' ');
        const descId = `${this.uid}-d-${row}-${col.key}`;
        return html`<div
          role="gridcell"
          id=${this.cellDomId(row, col.key)}
          class=${cls}
          data-r=${row}
          data-c=${col.key}
          aria-colindex=${ci + 2}
          aria-selected=${inSel ? 'true' : 'false'}
          aria-readonly=${ro ? 'true' : nothing}
          aria-invalid=${err ? 'true' : nothing}
          aria-describedby=${err || warn ? descId : nothing}
          title=${err || warn || nothing}
        >
          ${this.cellContent(row, col, text)}${err || warn ? html`<span id=${descId} class="visually-hidden">${err || warn}</span>` : nothing}
        </div>`;
      })}
    </div>`;
  }

  private headerTemplate(): TemplateResult {
    const a = this.adapter;
    const sort = this.state.sort;
    return html`<div
        role="row"
        class="mg-head"
        aria-rowindex="1"
        style=${styleMap({ height: `${this.rowHeight}px` })}
      >
        <div class="mg-num mg-corner" role="presentation"></div>
        ${a.columns.map((c) => {
          const dir =
            sort?.col === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
          return html`<div
            role="columnheader"
            class="mg-hcell${c.name ? ' mg-name' : ''}"
            data-c=${c.key}
            aria-sort=${dir}
            aria-colindex=${a.columns.indexOf(c) + 2}
          >
            <button
              type="button"
              class="mg-hbtn"
              title=${t('gx.sortBy', { col: c.label })}
              @click=${() => this.onSort(c.key)}
            >
              ${c.label}${dir === 'none' ? nothing : html`<span class="mg-sort" aria-hidden="true">${dir === 'ascending' ? '▲' : '▼'}</span>`}
            </button>
          </div>`;
        })}
      </div>
      ${
        this.showFilters
          ? html`<div
              role="row"
              class="mg-head mg-filters"
              aria-rowindex="2"
              style=${styleMap({ top: `${this.rowHeight}px`, height: `${this.rowHeight}px` })}
            >
              <div class="mg-num mg-corner" role="presentation"></div>
              ${a.columns.map(
                (c) =>
                  html`<div
                    role="columnheader"
                    class="mg-hcell${c.name ? ' mg-name' : ''}"
                    aria-label=${t('gx.filterCol', { col: c.label })}
                  >
                    <input
                      class="mg-filter"
                      type="search"
                      autocomplete="off"
                      spellcheck="false"
                      aria-label=${t('gx.filterCol', { col: c.label })}
                      .value=${this.state.colFilters[c.key] ?? ''}
                      @input=${(e: Event) => this.onColFilter(c.key, (e.target as HTMLInputElement).value)}
                    />
                  </div>`,
              )}
            </div>`
          : nothing
      }`;
  }

  protected override render(): TemplateResult {
    const a = this.adapter;
    const s = this.state;
    const view = this.view();
    const rect = selectionRect(view, s);
    const rowH = this.rowHeight;
    const headerH = this.headerHeight;
    const total = view.rows.length;
    const vh = this.vh || rowH * FALLBACK_ROWS;
    const first = Math.max(0, Math.floor(this.sTop / rowH) - BUFFER);
    const last = Math.min(total - 1, Math.ceil((this.sTop + vh - headerH) / rowH) - 1 + BUFFER);
    const { left, width } = this.offsets();
    const tpl = `${NUM_WIDTH}px ${a.columns.map((c) => `${c.width}px`).join(' ')}`;
    const rows: Array<{ row: number; pos: number }> = [];
    for (let p = first; p <= last && p < total; p++) rows.push({ row: view.rows[p], pos: p });

    // Ô nhập đặt đúng trên ô hiện hành.
    const cur = s.cell && posIn(view, s.cell);
    const curCol = s.cell ? a.columns.find((c) => c.key === s.cell!.col) : undefined;
    const editing = !!s.editing;
    const taStyle: Record<string, string> =
      cur && curCol
        ? {
            left: `${left.get(curCol.key) ?? 0}px`,
            top: `${headerH + cur.r * rowH}px`,
            width: `${curCol.width}px`,
            height: `${rowH}px`,
            caretColor: editing ? 'auto' : 'transparent',
          }
        : { left: '0px', top: '0px', width: '1px', height: '1px', caretColor: 'transparent' };
    const list = this.listOptions();
    const listTop = cur ? headerH + (cur.r + 1) * rowH : 0;
    const hi = list ? Math.min(this.hi, Math.max(0, list.length - 1)) : 0;
    const label =
      s.cell && curCol
        ? t('gx.cellLabel', {
            col: curCol.label,
            row: (cur?.r ?? 0) + 1,
            value: a.text(s.cell.row, s.cell.col),
          })
        : this.label;
    const activeId =
      list && list.length
        ? this.optionId(hi)
        : s.cell && cur
          ? this.cellDomId(s.cell.row, s.cell.col)
          : undefined;
    // Núm kéo điền ở góc dưới phải vùng chọn.
    const handle =
      rect && !editing
        ? (() => {
            const lastCol = a.columns[rect.c1];
            return {
              left: `${(left.get(lastCol.key) ?? 0) + lastCol.width - 5}px`,
              top: `${headerH + (rect.r1 + 1) * rowH - 5}px`,
            };
          })()
        : null;

    return html`<div class="mg" data-density=${rowH > 24 ? 'roomy' : 'compact'}>
      <div class="mg-scroll" @scroll=${this.onScroll}>
        <div
          class="mg-body"
          role="grid"
          aria-label=${this.label}
          aria-rowcount=${total + this.headerRows}
          aria-colcount=${a.columns.length + 1}
          aria-multiselectable="true"
          style=${styleMap({ height: `${total * rowH + headerH}px`, width: `${width}px`, '--mg-cols': tpl, '--mg-row': `${rowH}px` })}
          @pointerdown=${this.onPointerDown}
          @dblclick=${this.onDblClick}
        >
          ${this.headerTemplate()}
          ${repeat(
            rows,
            (r) => r.row,
            (r) => this.rowTemplate(r.row, r.pos, rect, headerH),
          )}
        </div>
        <textarea
          class="mg-input${editing ? ' mg-editing' : ''}"
          rows="1"
          wrap="off"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          aria-label=${label}
          aria-activedescendant=${activeId ?? nothing}
          aria-autocomplete=${list ? 'list' : nothing}
          aria-expanded=${list ? 'true' : nothing}
          aria-controls=${list ? `${this.uid}-list` : nothing}
          style=${styleMap(taStyle)}
          @keydown=${this.onKey}
          @input=${this.onInput}
          @beforeinput=${this.onBeforeInput}
          @compositionstart=${this.onCompositionStart}
          @compositionend=${this.onCompositionEnd}
          @blur=${this.onBlur}
          @focus=${this.onFocus}
          @copy=${this.onCopy}
          @cut=${this.onCut}
          @paste=${this.onPaste}
        ></textarea>
        ${
          list && cur && curCol
            ? html`<ul
                id="${this.uid}-list"
                role="listbox"
                class="mg-list"
                aria-label=${t('gx.options', { col: curCol.label })}
                style=${styleMap({ left: `${left.get(curCol.key) ?? 0}px`, top: `${listTop}px`, minWidth: `${curCol.width}px` })}
              >
                ${
                  list.length
                    ? list.map(
                        (o, i) =>
                          html`<li
                            id=${this.optionId(i)}
                            role="option"
                            aria-selected=${i === hi ? 'true' : 'false'}
                            class=${i === hi ? 'mg-hi' : ''}
                            @pointerdown=${(e: Event) => {
                              e.preventDefault();
                              this.apply(commitEdit(this.adapter, this.state, o, 'none'));
                              this.input()?.focus({ preventScroll: true });
                            }}
                          >
                            ${o}
                          </li>`,
                      )
                    : html`<li class="mg-none" role="presentation">${t('gx.noOption')}</li>`
                }
              </ul>`
            : nothing
        }
        ${
          handle
            ? html`<div
                class="mg-fill"
                role="presentation"
                style=${styleMap(handle)}
                title=${t('gx.fillHandle')}
              ></div>`
            : nothing
        }
      </div>
      <div class="visually-hidden" role="status" aria-live="polite">${this.noticeText}</div>
    </div>`;
  }
}

if (!customElements.get('mat-grid')) customElements.define('mat-grid', MatGrid);

declare global {
  interface HTMLElementTagNameMap {
    'mat-grid': MatGrid;
  }
}
