// Bảng Tag (feature 004, US2: T061, T063, T066 và phần lưới của T071; FR-018, FR-020, FR-028, research
// R3, contracts/commands.md "Phím trong từng vùng", mockup bản 1: renderTags, fillTagRows, markCells…).
//
// Lưới Lit dùng logic thuần của model/grid-model.ts (GĐ 2 thay phần hiển thị bằng lưới ảo hóa mà giữ
// hành vi). Mẫu ARIA grid với aria-activedescendant: focus nằm ở bảng, ô hiện hành chỉ tới bằng id.
// - Chọn ô chỉ đổi lớp và thuộc tính (Lit so từng phần), không thay node: nhấp đúp luôn trúng ô vừa
//   chọn (lỗi của mockup khi vẽ lại cả bảng).
// - Mỗi lần xác nhận ô là một sửa đổi qua app.store.edit (một bước hoàn tác); gõ trong ô không đụng store
//   nên không tuần tự hóa project mỗi phím (SC-003).
// - Ô chọn và bộ lọc giữ khi chuyển tab: bộ nhớ theo StudioApp ở module này (editor được tạo lại mỗi lần
//   mở tab), bỏ khi mở project khác.
// - Khi lưới đang gắn: đăng ký lệnh Điền xuống, Thêm Tag, Xóa dòng; báo focus và dòng chọn cho điều kiện
//   bật của lệnh; Ctrl+S xác nhận ô đang sửa (hooks.commitPending).
// - Vị trí cần hiện (tab Thông tin, Details, Tìm) lấy bằng app.takeReveal('tags'): ô có lỗi thì chọn và
//   vào sửa (nhảy tới lỗi để sửa); ô không lỗi thì chỉ chọn (như Details của mockup).
// - Khi theo dõi thiết bị: cột giá trị sống và quality ngay sau tên, chỉ đọc; Tag thiết bị không có ghi
//   "không có trên thiết bị"; giá trị không còn tốt (STALE, mất kết nối) hiện rõ, không như GOOD.
// - Dán từ Excel, Nhập/Xuất CSV hiện nhưng khóa (GĐ 2).
// Cuối file: inspector › Thuộc tính của Tag (T066) và dòng giá trị sống tự cập nhật.
import type { Quality, TagValue } from '@mat/live-client';
import type { Issue, TagDefinition } from '@mat/project-schema';
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { styleMap } from 'lit/directives/style-map.js';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import {
  TAG_TYPES,
  addTag,
  beginEdit,
  cellKey,
  cellText,
  clampCell,
  commitEdit,
  deleteRow,
  fillDown,
  gridColumns,
  gridKey,
  initialGridState,
  selectCell,
  setFilter,
  visibleRows,
  type CellRef,
  type ColumnSpec,
  type EditState,
  type GridColumn,
  type GridData,
  type GridResult,
  type GridState,
  type TagColumn,
} from '../../model/grid-model.ts';
import { isLive } from '../../model/device-session.ts';
import { issueCells, severityOf } from '../../model/issue-map.ts';
import { phaseLabel } from '../../model/tree.ts';
import { whereUsed, xrefLocation, xrefText } from '../../model/xref.ts';
import { AppElement, icon } from '../base.ts';
import { prow } from '../mat-inspector.ts';
import { registerEditor, registerProps } from '../registry.ts';
import './tag-grid.css';

const DASH = '—';
/** Focus rời lưới sang menu, bảng lệnh, thanh công cụ, hộp thoại: lệnh của lưới vẫn áp cho lưới. */
const COMMAND_SURFACES = 'mat-menubar, mat-palette, mat-toolbar, mat-dialog';

const cellId = (row: number, column: GridColumn) => `tg-c-${row}-${column}`;
const descId = (row: number, column: GridColumn) => `tg-d-${row}-${column}`;
const sameCell = (a: CellRef | null, b: CellRef | null) =>
  a === b || (!!a && !!b && a.row === b.row && a.column === b.column);
const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement;
const asText = (v: unknown): string =>
  v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Ô chọn và bộ lọc theo StudioApp: giữ khi chuyển tab; mở project khác thì bắt đầu lại. */
const memory = new WeakMap<StudioApp, { project: object | null; state: GridState }>();

// ---------- Giá trị sống (dùng chung cho lưới và inspector) ----------

const NUMBER_FORMAT = new Intl.NumberFormat('vi-VN', {
  maximumFractionDigits: 3,
  useGrouping: false,
});

/** Giá trị sống để hiện: số theo cách viết Việt Nam (dấu phẩy thập phân) kèm đơn vị; BOOL là TRUE/FALSE. */
export function formatLive(value: TagValue, unit?: unknown): string {
  if (value === null) return DASH;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') {
    const n = NUMBER_FORMAT.format(value);
    return typeof unit === 'string' && unit.trim() !== '' ? `${n} ${unit}` : n;
  }
  return String(value);
}

interface LiveView {
  /** `none`: thiết bị không có Tag; `wait`: chưa nhận giá trị; `value`: có giá trị. */
  kind: 'none' | 'wait' | 'value';
  text: string;
  /** STALE khi giá trị không còn tốt (mất kết nối, thiết bị đầy, đang kết nối lại). */
  quality: Quality | null;
}

function liveOf(app: StudioApp, id: string, unit: unknown): LiveView {
  const s = app.session;
  if (id !== '' && s.unknown.has(id))
    return { kind: 'none', text: t('tagGrid.live.none'), quality: null };
  const v = s.values.get(id);
  if (!v) return { kind: 'wait', text: DASH, quality: null };
  // Rời trạng thái theo dõi thì không giữ giá trị cũ như còn tốt (FR-028).
  const good = v.quality !== 'STALE' && isLive(s.state);
  return { kind: 'value', text: formatLive(v.value, unit), quality: good ? v.quality : 'STALE' };
}

const QUALITY_CHIP: Readonly<Record<Exclude<Quality, 'STALE'>, string>> = {
  GOOD: 'ok',
  BAD: 'err',
  UNCERTAIN: 'warn',
};
const qualityText = (q: Quality): string => (q === 'STALE' ? t('tagGrid.live.stale') : q);
/** Chip quality: màu kèm chữ; không còn tốt thì chip xám "mất kết nối". */
const qualityChip = (q: Quality) =>
  q === 'STALE'
    ? html`<span class="chip">${qualityText(q)}</span>`
    : html`<span class="chip ${QUALITY_CHIP[q]}">${q}</span>`;

// ---------- Lưới ----------

interface LockedTool {
  act: string;
  icon: IconName;
  label: MessageKey;
}

/** Hiện trên thanh công cụ nhưng khóa: lưới Tag kiểu Excel đầy đủ có ở GĐ 2 (research R3). */
const LOCKED_TOOLS: readonly LockedTool[] = [
  { act: 'paste', icon: 'paste', label: 'tagGrid.paste' },
  { act: 'import', icon: 'import', label: 'tagGrid.importCsv' },
  { act: 'export', icon: 'export', label: 'tagGrid.exportCsv' },
];

interface RowContext {
  columns: readonly ColumnSpec[];
  cur: CellRef | null;
  editing: EditState | null;
  issues: ReadonlyMap<string, readonly Issue[]>;
  /** Lý do của ô lỗi, gom khi vẽ để đặt vào phần mô tả ẩn (aria-describedby). */
  descs: Array<{ id: string; text: string }>;
}

export class TagGrid extends AppElement {
  /** Việc làm sau lần vẽ tới: focus ô nhập (đặt con trỏ), focus lưới, cuộn tới ô hiện hành. */
  private focusEdit: EditState['caret'] | null = null;
  private focusGrid = false;
  private scrollCell = false;
  /** Đổi kiểu bằng chuột trong danh sách chọn thì xác nhận ngay; bằng phím thì chờ Enter. */
  private pickByPointer = false;
  private offValues: (() => void) | null = null;
  private readonly commitHook = (): void => this.commitPending();

  // ---------- Trạng thái ----------

  private memo(): { project: object | null; state: GridState } {
    const project = this.app.store.state.project;
    let m = memory.get(this.app);
    if (!m || m.project !== project) {
      m = { project, state: initialGridState };
      memory.set(this.app, m);
    }
    return m;
  }

  private get gs(): GridState {
    return this.memo().state;
  }

  private set gs(state: GridState) {
    this.memo().state = state;
  }

  private data(): GridData {
    return {
      tags: this.app.store.state.outline.tags?.tags ?? [],
      columns: gridColumns(this.app.online()),
    };
  }

  /** File Tag không đọc được (thiếu, JSON hỏng): không sửa được trong lưới. */
  private broken(): boolean {
    const s = this.app.store.state;
    return !s.outline.tags || !s.docs[s.outline.tagFile]?.editable;
  }

  private table(): HTMLTableElement | null {
    return this.querySelector<HTMLTableElement>('table.grid');
  }

  private editorEl(): HTMLInputElement | HTMLSelectElement | null {
    return this.querySelector<HTMLInputElement | HTMLSelectElement>('td .tg-edit');
  }

  private setGs(next: GridState): void {
    this.gs = next;
    this.syncApp();
    this.requestUpdate();
  }

  /** Lựa chọn của store theo ô chọn (inspector, Details); vị trí ô trong các dòng đang hiện (lệnh). */
  private syncApp(): void {
    const app = this.app;
    const { cell, filter } = this.gs;
    const sel = app.store.state.selection;
    if (cell && !(sel?.kind === 'tag' && sel.row === cell.row))
      app.select({ kind: 'tag', row: cell.row });
    else if (!cell && sel?.kind === 'tag') app.select(null);
    const pos = cell ? visibleRows(this.data().tags, filter).indexOf(cell.row) : -1;
    app.setUiContext({ cellRow: pos < 0 ? null : pos });
  }

  /** Áp kết quả của grid-model: sửa đổi vào store, thông báo, trạng thái lưới, việc focus sau khi vẽ. */
  private applyResult(r: GridResult, e?: Event, refocus = true): void {
    if (!r.handled && !r.edits.length && !r.notice && r.state === this.gs) return;
    if (r.handled) e?.preventDefault();
    if (r.edits.length) this.app.store.edit(r.edits);
    if (r.notice) this.app.toast(t(r.notice));
    const before = this.gs;
    const next = r.state;
    if (next.editing && next.editing !== before.editing) this.focusEdit = next.editing.caret;
    else if (refocus && before.editing && !next.editing) this.focusGrid = true;
    if (!sameCell(before.cell, next.cell)) this.scrollCell = true;
    this.setGs(next);
  }

  /** Xác nhận ô đang sửa dở: Ctrl+S, nhấp chỗ khác, lệnh của lưới, rời editor. */
  private commitPending(): void {
    const ed = this.gs.editing;
    if (!ed) return;
    const el = this.editorEl();
    const focused = !!el && el === document.activeElement;
    this.applyResult(
      commitEdit(this.data(), this.gs, el ? el.value : ed.text, 'none'),
      undefined,
      focused,
    );
  }

  /** Vị trí cần hiện: ô có lỗi (từ tab Thông tin) thì vào sửa; ô không lỗi (Details, Tìm) thì chỉ chọn. */
  private reveal(row: number, column: TagColumn): void {
    this.commitPending();
    const data = this.data();
    if (!data.tags[row]) return;
    let gs = this.gs;
    if (!visibleRows(data.tags, gs.filter).includes(row)) gs = { ...gs, filter: '' };
    const ref: CellRef = {
      row,
      column: data.columns.some((c) => c.key === column) ? column : 'id',
    };
    const s = this.app.store.state;
    const edit = issueCells(s.issues, s.outline).has(cellKey(ref.row, ref.column))
      ? beginEdit(data, gs, ref).state
      : null;
    if (edit?.editing) {
      this.gs = edit;
      this.focusEdit = edit.editing.caret;
    } else {
      this.gs = selectCell(data, gs, ref);
      this.focusGrid = true;
    }
    this.scrollCell = true;
  }

  // ---------- Vòng đời ----------

  protected override attached(): void {
    const app = this.app;
    app.setCommandHandler('edit.fillDown', () => this.fill());
    app.setCommandHandler('tags.add', () => this.addTag());
    app.setCommandHandler('tags.delete', () => this.deleteRow());
    app.hooks.commitPending = this.commitHook;
    this.offValues = app.subscribeValues(() => {
      if (app.online()) this.requestUpdate();
    });
    this.addEventListener('focusin', this.onFocusIn);
    this.addEventListener('focusout', this.onFocusOut);
    this.requestUpdate();
  }

  /**
   * Không vẽ khi đã rời document: khi đổi tab, app báo đổi (lưới xếp lịch vẽ) rồi khung mới gỡ lưới;
   * lần vẽ còn chờ đó không được đặt lại lựa chọn và ngữ cảnh lệnh của editor mới (syncApp).
   */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override detached(): void {
    const app = this.app;
    // Rời editor (đóng tab, Ctrl+W) khi đang gõ dở: giữ nội dung như khi nhấp ra ngoài, nhưng không
    // đồng bộ lựa chọn (app đã chọn theo editor mới).
    const ed = this.gs.editing;
    if (ed) {
      const el = this.editorEl();
      const r = commitEdit(this.data(), this.gs, el ? el.value : ed.text, 'none');
      if (r.edits.length) app.store.edit(r.edits);
      this.gs = r.state;
    }
    app.setCommandHandler('edit.fillDown', null);
    app.setCommandHandler('tags.add', null);
    app.setCommandHandler('tags.delete', null);
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
    this.offValues?.();
    this.offValues = null;
    this.removeEventListener('focusin', this.onFocusIn);
    this.removeEventListener('focusout', this.onFocusOut);
    app.setUiContext({ tagGridFocused: false, cellRow: null });
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    const app = this.app;
    const loc = app.takeReveal('tags');
    if (loc?.editor === 'tags') this.reveal(loc.row, loc.column);
    const data = this.data();
    let gs = this.gs;
    // Lưới chưa có ô chọn mà store đang chọn một Tag (ví dụ từ trước khi mở tab): nhận Tag đó.
    const sel = app.store.state.selection;
    if (
      !gs.cell &&
      sel?.kind === 'tag' &&
      data.tags[sel.row] &&
      visibleRows(data.tags, gs.filter).includes(sel.row)
    )
      gs = selectCell(data, gs, { row: sel.row, column: 'id' });
    // Dữ liệu đổi (hoàn tác, xóa dòng, bật/tắt cột giá trị sống): đưa ô chọn về chỗ hợp lệ.
    const clamped = clampCell(data, gs);
    if (clamped.cell !== gs.cell || clamped.editing !== gs.editing) gs = clamped;
    if (gs !== this.gs) this.gs = gs;
    this.syncApp();
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const edit = this.focusEdit;
    const grid = this.focusGrid;
    const scroll = this.scrollCell;
    this.focusEdit = null;
    this.focusGrid = false;
    this.scrollCell = false;
    // Focus sau khi lần vẽ này xong hẳn: sự kiện focus báo app (setUiContext) nên gây lần vẽ mới, làm
    // ngay trong updated() thì thành cập nhật lồng nhau.
    if (edit || grid || scroll) queueMicrotask(() => this.applyFocus(edit, grid, scroll));
  }

  private applyFocus(edit: EditState['caret'] | null, grid: boolean, scroll: boolean): void {
    if (!this.isConnected) return;
    if (edit) {
      const el = this.editorEl();
      if (el) {
        el.focus({ preventScroll: true });
        if (el instanceof HTMLInputElement) {
          if (edit === 'all') el.select();
          else el.setSelectionRange(el.value.length, el.value.length);
        }
      }
    } else if (grid) {
      const table = this.table();
      if (table && document.activeElement !== table) table.focus({ preventScroll: true });
    }
    if (scroll) {
      const cell = this.gs.cell;
      const td = cell ? this.querySelector(`#${cellId(cell.row, cell.column)}`) : null;
      td?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }

  // ---------- Sự kiện ----------

  private readonly onFocusIn = (e: FocusEvent): void => {
    // "Lưới đang focus" (Điền xuống): focus trong editor nhưng không ở ô nhập.
    this.app.setUiContext({ tagGridFocused: !isTextField(e.target) });
    // Mẫu ARIA grid: vào lưới thì luôn có ô hiện hành.
    if (e.target === this.table() && !this.gs.cell) {
      const data = this.data();
      const rows = visibleRows(data.tags, this.gs.filter);
      if (rows.length)
        this.setGs(selectCell(data, this.gs, { row: rows[0], column: data.columns[0].key }));
    }
  };

  private readonly onFocusOut = (e: FocusEvent): void => {
    const to = e.relatedTarget;
    if (to instanceof Node && this.contains(to)) return;
    if (to instanceof Element && to.closest(COMMAND_SURFACES)) return;
    this.app.setUiContext({ tagGridFocused: false });
  };

  private readonly onGridKey = (e: KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return; // ô nhập tự xử lý phím của nó (onEditKey)
    this.applyResult(gridKey(this.data(), this.gs, e), e);
  };

  private readonly onEditKey = (e: KeyboardEvent): void => {
    const el = e.currentTarget as HTMLInputElement | HTMLSelectElement;
    if (el instanceof HTMLSelectElement && e.key !== 'Enter' && e.key !== 'Tab')
      this.pickByPointer = false;
    this.applyResult(gridKey(this.data(), this.gs, e, el.value), e);
  };

  private readonly onEditBlur = (e: FocusEvent): void => {
    const el = e.currentTarget as HTMLInputElement | HTMLSelectElement;
    if (!this.gs.editing || el !== this.editorEl()) return;
    // Cửa sổ mất focus (chuyển ứng dụng): giữ ô đang sửa, quay lại gõ tiếp.
    if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;
    // Rời ô đang sửa (nhấp chỗ khác, chuyển tab): xác nhận như mockup.
    this.applyResult(commitEdit(this.data(), this.gs, el.value, 'none'), undefined, false);
  };

  private readonly onPickPointer = (): void => {
    this.pickByPointer = true;
  };

  private readonly onEditChange = (e: Event): void => {
    if (!this.pickByPointer) return;
    this.pickByPointer = false;
    const el = e.currentTarget as HTMLSelectElement;
    this.applyResult(commitEdit(this.data(), this.gs, el.value, 'none'));
  };

  /** Ô (hoặc dòng, khi nhấp số thứ tự) dưới chuột. */
  private refAt(e: Event): CellRef | null {
    const target = e.target instanceof Element ? e.target : null;
    const td = target?.closest<HTMLElement>('td[data-c]');
    if (td) return { row: Number(td.dataset.r), column: td.dataset.c as GridColumn };
    const tr = target?.closest<HTMLElement>('tr[data-r]');
    return tr ? { row: Number(tr.dataset.r), column: this.data().columns[0].key } : null;
  }

  private insideEditor(e: Event): boolean {
    const el = this.editorEl();
    return !!el && e.target instanceof Node && el.contains(e.target);
  }

  private readonly onBodyClick = (e: MouseEvent): void => {
    if (this.insideEditor(e)) return;
    const ref = this.refAt(e);
    if (!ref) return;
    this.commitPending();
    this.setGs(selectCell(this.data(), this.gs, ref));
    this.focusGrid = true;
  };

  private readonly onBodyDblClick = (e: MouseEvent): void => {
    if (this.insideEditor(e) || !(e.target instanceof Element) || !e.target.closest('td[data-c]'))
      return;
    const ref = this.refAt(e);
    if (!ref) return;
    this.commitPending();
    this.applyResult(beginEdit(this.data(), this.gs, ref));
  };

  private readonly onFilter = (e: Event): void => {
    const value = (e.currentTarget as HTMLInputElement).value;
    this.setGs(setFilter(this.data(), this.gs, value));
  };

  /** Ctrl+V trên lưới: dán từ Excel có ở GĐ 2, báo thay vì im lặng. */
  private readonly onPaste = (e: ClipboardEvent): void => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    this.app.toast(t('reason.locked', { label: t('tagGrid.paste'), reason: t('reason.p2') }));
  };

  // ---------- Lệnh ----------

  private addTag(): void {
    if (this.broken()) return;
    this.commitPending();
    this.applyResult(addTag(this.data(), this.gs));
  }

  private deleteRow(): void {
    if (this.broken()) return;
    this.commitPending();
    const data = this.data();
    const cell = this.gs.cell;
    const tag = cell ? data.tags[cell.row] : undefined;
    if (!cell || !tag) return;
    const id = cellText(tag, 'id');
    this.applyResult(deleteRow(data, this.gs));
    this.app.toast(t('tagGrid.deleted', { id: id || t('details.unnamed') }));
    this.focusGrid = true;
  }

  private fill(): void {
    if (this.broken()) return;
    this.commitPending();
    this.applyResult(fillDown(this.data(), this.gs));
    this.focusGrid = true;
  }

  // ---------- Vẽ ----------

  private tool(
    act: string,
    ic: IconName,
    label: string,
    reason: string | null,
    run: () => void,
    tip?: string,
    extra: unknown = nothing,
  ) {
    const locked = reason === null ? null : t('reason.locked', { label, reason });
    return html`<button
      class="tbtn"
      type="button"
      data-act=${act}
      aria-disabled=${locked ? 'true' : nothing}
      title=${locked ?? tip ?? label}
      @click=${() => (locked ? this.app.toast(locked) : run())}
    >
      ${icon(ic)}<span>${label}</span>${extra}
    </button>`;
  }

  private tools(data: GridData, rows: readonly number[], broken: boolean) {
    const app = this.app;
    const gs = this.gs;
    const blocked = broken ? t('tagGrid.broken', { file: app.store.state.outline.tagFile }) : null;
    const pos = gs.cell ? rows.indexOf(gs.cell.row) : -1;
    const deleteReason = blocked ?? (pos < 0 ? t('reason.noRow') : null);
    const fillReason =
      blocked ?? (pos < 0 ? t('reason.gridNotFocused') : pos === 0 ? t('reason.firstRow') : null);
    const phase = app.workspace.showPhases
      ? html`<span class="phase">${phaseLabel('p2')}</span>`
      : nothing;
    return html`<div class="ed-tools" role="group" aria-label=${t('tagGrid.tools')}>
      ${this.tool('add', 'plus', t('cmd.tags.add'), blocked, () => this.addTag())}
      ${this.tool('delete', 'x', t('cmd.tags.delete'), deleteReason, () => this.deleteRow())}
      ${this.tool(
        'fill',
        'filldown',
        t('cmd.edit.fillDown'),
        fillReason,
        () => this.fill(),
        t('tagGrid.fillTip'),
      )}
      <span class="tsep" aria-hidden="true"></span>
      ${LOCKED_TOOLS.map((x) =>
        this.tool(x.act, x.icon, t(x.label), t('reason.p2'), () => undefined, undefined, phase),
      )}
      <span class="grow"></span>
      <input
        class="input sm"
        type="search"
        placeholder=${t('tagGrid.filterPlaceholder')}
        aria-label=${t('tagGrid.filter')}
        autocomplete="off"
        spellcheck="false"
        .value=${live(gs.filter)}
        @input=${this.onFilter}
      />
      <span class="muted num tg-count" role="status"
        >${t('tagGrid.count', { shown: rows.length, total: data.tags.length })}</span
      >
    </div>`;
  }

  private editorTpl(c: ColumnSpec, ed: EditState) {
    const label = t(c.label);
    if (c.kind === 'select') {
      const types: readonly string[] = TAG_TYPES;
      const options = types.includes(ed.text) ? types : [ed.text, ...types];
      return html`<select
        class="tg-edit"
        aria-label=${label}
        @keydown=${this.onEditKey}
        @blur=${this.onEditBlur}
        @change=${this.onEditChange}
        @pointerdown=${this.onPickPointer}
      >
        ${options.map((o) => html`<option value=${o} .selected=${o === ed.text}>${o}</option>`)}
      </select>`;
    }
    return html`<input
      class="tg-edit"
      type="text"
      size="1"
      aria-label=${label}
      spellcheck="false"
      autocomplete="off"
      inputmode=${c.kind === 'number' ? 'decimal' : nothing}
      .value=${ed.text}
      @keydown=${this.onEditKey}
      @blur=${this.onEditBlur}
    />`;
  }

  private liveTpl(tag: TagDefinition | undefined, column: GridColumn) {
    const v = liveOf(this.app, typeof tag?.id === 'string' ? tag.id : '', tag?.unit);
    if (column === 'quality') return v.quality ? qualityChip(v.quality) : DASH;
    if (v.kind === 'none') return html`<span class="tg-none">${v.text}</span>`;
    if (v.kind === 'wait') return DASH;
    return html`<span class=${v.quality === 'STALE' ? 'tg-stale' : ''}>${v.text}</span>`;
  }

  private textTpl(
    tag: TagDefinition | undefined,
    column: GridColumn,
    sev: 'error' | 'warning' | null,
  ) {
    const v = cellText(tag, column);
    if (!sev) return v;
    // Màu không là tín hiệu duy nhất (FR-012): ô lỗi có icon, lý do ở title và aria-describedby.
    return html`${icon(sev === 'error' ? 'err' : 'warn', `sm ${sev === 'error' ? 'err' : 'warn'}`)}${v}`;
  }

  private cell(tag: TagDefinition | undefined, r: number, c: ColumnSpec, ctx: RowContext) {
    const key = c.key;
    const issues = ctx.issues.get(cellKey(r, key));
    const sev = !issues
      ? null
      : issues.some((i) => severityOf(i) === 'error')
        ? 'error'
        : 'warning';
    const cur = ctx.cur?.row === r && ctx.cur.column === key;
    const ed = ctx.editing?.row === r && ctx.editing.column === key ? ctx.editing : null;
    let reason: string | null = null;
    let desc: string | null = null;
    if (issues) {
      reason = issues
        .map((i) => t('tagGrid.issue', { code: i.code, message: i.message }))
        .join('\n');
      desc = descId(r, key);
      ctx.descs.push({ id: desc, text: reason });
    }
    const cls = [
      c.kind === 'readonly' ? 'ro' : '',
      c.kind === 'number' ? 'r' : '',
      c.mono ? 'mono' : '',
      c.kind === 'live' ? 'live' : '',
      sev === 'error' ? 'bad' : sev === 'warning' ? 'warnc' : '',
      cur ? 'cur' : '',
      ed ? 'tg-editing' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return html`<td
      id=${cellId(r, key)}
      role="gridcell"
      data-r=${r}
      data-c=${key}
      class=${cls}
      aria-readonly=${c.kind === 'readonly' || c.kind === 'live' ? 'true' : nothing}
      aria-invalid=${sev === 'error' ? 'true' : nothing}
      aria-describedby=${desc ?? nothing}
      title=${reason ?? nothing}
    >
      ${
        ed
          ? this.editorTpl(c, ed)
          : c.kind === 'live'
            ? this.liveTpl(tag, key)
            : this.textTpl(tag, key, sev)
      }
    </td>`;
  }

  private row(tag: TagDefinition | undefined, r: number, ctx: RowContext) {
    const sel = ctx.cur?.row === r;
    return html`<tr
      data-r=${r}
      aria-rowindex=${r + 2}
      class=${sel ? 'rsel' : ''}
      aria-selected=${sel ? 'true' : 'false'}
    >
      <td class="rn num" role="gridcell">${r + 1}</td>
      ${ctx.columns.map((c) => this.cell(tag, r, c, ctx))}
    </tr>`;
  }

  private emptyState(data: GridData, filter: string, broken: boolean) {
    if (broken) return nothing;
    if (!data.tags.length)
      return html`<div class="empty">
        ${icon('tag', 'lg')}<b>${t('tagGrid.empty.title')}</b>
        <p>${t('tagGrid.empty.text')}</p>
      </div>`;
    return html`<p class="help pad">${t('tagGrid.noMatch', { filter })}</p>`;
  }

  protected override render() {
    const app = this.app;
    const s = app.store.state;
    const data = this.data();
    const gs = this.gs;
    const broken = this.broken();
    const rows = visibleRows(data.tags, gs.filter);
    const ctx: RowContext = {
      columns: data.columns,
      cur: gs.cell,
      editing: gs.editing,
      issues: issueCells(s.issues, s.outline),
      descs: [],
    };
    const body = rows.map((r) => this.row(data.tags[r], r, ctx));
    const active =
      gs.cell && rows.includes(gs.cell.row) ? cellId(gs.cell.row, gs.cell.column) : null;
    const title = app.editorTitle('tags');
    return html`<div class="ed ed-fill">
      <div class="ed-head">
        <h2>${title}</h2>
        <span class="path">${s.outline.tagFile}</span>
        <span class="grow"></span>
        <span class="help">${t('tagGrid.hint')}</span>
      </div>
      ${
        broken
          ? html`<div class="banner err" role="alert">
              ${icon('err', 'err')}
              <div>${t('tagGrid.broken', { file: s.outline.tagFile })}</div>
            </div>`
          : nothing
      }
      ${this.tools(data, rows, broken)}
      <div class="gridwrap">
        <table
          class="grid"
          role="grid"
          tabindex="0"
          aria-label=${title}
          aria-describedby="tg-help"
          aria-rowcount=${data.tags.length + 1}
          aria-colcount=${data.columns.length + 1}
          aria-activedescendant=${active ?? nothing}
          @keydown=${this.onGridKey}
          @paste=${this.onPaste}
        >
          <thead>
            <tr aria-rowindex="1">
              <th class="rn" scope="col">#</th>
              ${data.columns.map(
                (c) =>
                  html`<th
                    scope="col"
                    data-c=${c.key}
                    class=${c.kind === 'live' ? 'tg-live' : ''}
                    style=${styleMap({ minWidth: `${c.width}px` })}
                  >
                    ${t(c.label)}
                  </th>`,
              )}
            </tr>
          </thead>
          <tbody @click=${this.onBodyClick} @dblclick=${this.onBodyDblClick}>
            ${body}
          </tbody>
        </table>
        ${rows.length ? nothing : this.emptyState(data, gs.filter, broken)}
      </div>
      <div class="visually-hidden">
        <span id="tg-help">${t('tagGrid.help')}</span>
        ${ctx.descs.map((d) => html`<span id=${d.id}>${d.text}</span>`)}
      </div>
    </div>`;
  }
}

customElements.define('mat-tag-grid', TagGrid);

registerEditor({
  match: (id) => id === 'tags',
  render: (app) => html`<mat-tag-grid .app=${app}></mat-tag-grid>`,
});

// ---------- Inspector › Thuộc tính của Tag (T066, FR-006) ----------

/**
 * Dòng "Giá trị sống" của inspector khi theo dõi: tự vẽ lại khi giá trị của Tag này đổi (inspector chỉ
 * vẽ lại khi app báo đổi, không theo từng giá trị).
 */
export class TagLiveRow extends AppElement {
  private tagId = '';
  private unit: unknown = undefined;
  private offValues: (() => void) | null = null;

  set tagRef(ref: { id: string; unit: unknown }) {
    if (ref.id === this.tagId && ref.unit === this.unit) return;
    this.tagId = ref.id;
    this.unit = ref.unit;
    this.requestUpdate();
  }

  protected override attached(): void {
    this.offValues = this.app.subscribeValues((tags) => {
      if (tags.includes(this.tagId)) this.requestUpdate();
    });
  }

  protected override detached(): void {
    this.offValues?.();
    this.offValues = null;
  }

  protected override render() {
    const v = liveOf(this.app, this.tagId, this.unit);
    const text =
      v.kind === 'value' && v.quality
        ? t('tagProps.liveValue', { value: v.text, quality: qualityText(v.quality) })
        : v.text;
    return prow(t('tagProps.live'), text, { mono: true });
  }
}

customElements.define('mat-tag-live', TagLiveRow);

const bound = (v: unknown): string => (v === undefined || v === null || v === '' ? '…' : asText(v));

registerProps((app) => {
  const s = app.store.state;
  const sel = s.selection;
  if (sel?.kind !== 'tag') return null;
  const tag: TagDefinition | undefined = s.outline.tags?.tags[sel.row];
  if (!tag || typeof tag !== 'object') return null;
  const id = typeof tag.id === 'string' ? tag.id : '';
  const name = id || t('details.unnamed');
  const none = t('prop.none');
  const refs = id ? whereUsed(s.outline, id) : [];
  const range =
    tag.min === undefined && tag.max === undefined
      ? none
      : t('tagProps.rangeValue', { min: bound(tag.min), max: bound(tag.max) });
  return {
    ctx: t('tagProps.ctx', { id: name }),
    body: html`${prow(t('tagProps.name'), name, { mono: true })}
      ${prow(t('tagProps.type'), asText(tag.type) || none)}
      ${prow(t('tagProps.source'), cellText(tag, 'source') || none)}
      ${prow(t('tagProps.unit'), asText(tag.unit) || none)} ${prow(t('tagProps.range'), range)}
      ${prow(t('tagProps.description'), asText(tag.description) || none)}
      ${
        app.online()
          ? html`<mat-tag-live .app=${app} .tagRef=${{ id, unit: tag.unit }}></mat-tag-live>`
          : nothing
      }
      <div class="psec">
        ${icon('link')}${t('tagProps.whereUsed')} <span class="cnt">${refs.length}</span>
      </div>
      ${
        refs.length
          ? html`<ul class="xref">
              ${refs.map((e) => {
                const label = xrefText(e);
                return html`<li>
                  ${icon(e.kind === 'logging' ? 'db' : 'screen')}
                  <button
                    class="tg-xref"
                    type="button"
                    title=${t('tagProps.gotoRef', { ref: label })}
                    @click=${() => app.revealLocation(xrefLocation(e))}
                  >
                    ${label}
                  </button>
                </li>`;
              })}
            </ul>`
          : html`<p class="help pad">${t('tagProps.unused')}</p>`
      }`,
  };
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-tag-grid': TagGrid;
    'mat-tag-live': TagLiveRow;
  }
}
