// Bảng Tag trên mat-grid (feature 006, T126, FR-045, FR-046, FR-047, FR-015; viết lại phần lưới của 004, ADR-016): ảo hóa
// 2.000 dòng, gõ thẳng qua bộ gõ không cần F2, chọn vùng, sao chép, dán Excel, điền xuống, bộ cột theo loại Tag, lỗi tại ô,
// cột giá trị sống chỉ cho các dòng đang hiện, Thêm hàng loạt, Nhập và Xuất CSV, mức dùng tags.json.
// - Mỗi lần xác nhận ô (hoặc dán, điền, nhập) là MỘT bước hoàn tác qua app.store.edit.
// - Ô chọn và bộ lọc giữ khi chuyển tab: bộ nhớ theo StudioApp (editor được tạo lại mỗi lần mở tab).
// - Vị trí cần hiện (tab Thông tin, Details, Tìm) lấy bằng app.takeReveal('tags'): ô có lỗi thì chọn và vào sửa.
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import type { Issue } from '@mat/project-schema';
import { splitRenames } from '../../model/rename-flow.ts';
import { whereUsed } from '../../model/xref.ts';
import type { StudioApp } from '../../app/app.ts';
import { issueText } from '../../app/code-text.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { defaultDecimal, tagsToCsv } from '../../model/csv-import.ts';
import { PRIORITY } from '../../model/live-subscriptions.ts';
import { initialGrid, setFilter, type GridState } from '../../model/grid/index.ts';
import { issueCells } from '../../model/issue-map.ts';
import {
  COLUMN_SETS,
  tableInputs,
  tagTable,
  tagsFileUsage,
  type ColumnSet,
  type TagTable,
} from '../../model/tag-table.ts';
import { AppElement, icon } from '../base.ts';
import type { IconName } from '../../icons/icons.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import { registerEditor } from '../registry.ts';
import { liveOf, liveReasonText, qualityText, QUALITY_CHIP } from './tag-live.ts';
import './tag-grid.css';

const SETS: readonly ColumnSet[] = ['all', 'external', 'internal', 'calculated', 'simulation'];
/** Cột có thể chọn (mọi cột 0.2 của bộ "tất cả"), theo thứ tự chuẩn. */
const CHOOSABLE = COLUMN_SETS.all;

interface Memo {
  project: object | null;
  grid: GridState;
}
/** Ô chọn và bộ lọc theo StudioApp: giữ khi chuyển tab; mở project khác thì bắt đầu lại. */
const memory = new WeakMap<StudioApp, Memo>();

interface PendingReveal {
  row: number;
  col: string;
  edit: boolean;
}

const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MiB`
    : bytes >= 1024
      ? `${(bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1)} KiB`
      : `${bytes} B`;

export class TagGrid extends AppElement {
  static override properties = { ticks: { state: true } };

  declare ticks: number;

  private offValues: (() => void) | null = null;
  private pending: PendingReveal | null = null;
  private cache: { key: unknown[]; adapter: TagTable } | null = null;
  private lastIssueKey: unknown = null;
  private lastIssues: ReadonlyMap<string, readonly string[]> = new Map();
  private usage: { tags: unknown; text: string; level: string; title: string } | null = null;

  constructor() {
    super();
    this.ticks = 0;
  }

  // ---------- Trạng thái ----------

  private memo(): Memo {
    const project = this.app.store.state.project;
    let m = memory.get(this.app);
    if (!m || m.project !== project) {
      m = { project, grid: initialGrid };
      memory.set(this.app, m);
    }
    return m;
  }

  private gridEl(): MatGrid | null {
    return this.querySelector<MatGrid>('mat-grid');
  }

  /** File Tag không đọc được (thiếu, JSON hỏng): không có gì để hiện. */
  private broken(): boolean {
    return !this.app.store.state.outline.tags;
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || !s.docs[s.outline.tagFile]?.editable;
  }

  /** Adapter của lưới; dựng lại khi dữ liệu hay lựa chọn cột đổi (không dựng lại khi chỉ có giá trị sống đổi). */
  private adapter(): TagTable {
    const app = this.app;
    const s = app.store.state;
    const o = s.outline;
    const choice = app.columnChoice();
    const online = app.valuesLive();
    const readOnly = this.readOnly();
    const key = [
      o.tags,
      o.connections,
      o.valueTables,
      o.version,
      readOnly,
      choice.set,
      choice.columns,
      online,
    ];
    const c = this.cache;
    if (c && c.key.length === key.length && c.key.every((k, i) => k === key[i])) return c.adapter;
    const units = new Map<string, unknown>();
    for (const tag of (o.tags?.tags ?? []) as unknown as Array<{ id?: string; unit?: unknown }>)
      if (typeof tag.id === 'string') units.set(tag.id, tag.unit);
    const adapter = tagTable({
      ...tableInputs(o),
      version: o.version,
      readOnly,
      set: choice.set,
      columns: choice.columns,
      live: online,
      liveText: (id, col) => {
        const v = liveOf(app, id, units.get(id));
        if (col === 'value') return v.text;
        if (col === 'quality') return v.quality ? qualityText(v.quality) : '';
        return liveReasonText(v);
      },
    });
    this.cache = { key, adapter };
    return adapter;
  }

  private issueMap(): ReadonlyMap<string, readonly string[]> {
    const s = this.app.store.state;
    if (this.lastIssueKey === s.issues) return this.lastIssues;
    const cells = issueCells(s.issues, s.outline);
    const out = new Map<string, readonly string[]>();
    for (const [k, list] of cells)
      out.set(
        k,
        list.map((i: Issue) => issueText(i)),
      );
    this.lastIssueKey = s.issues;
    this.lastIssues = out;
    return out;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => this.gridEl()?.commitPending();

  protected override attached(): void {
    const app = this.app;
    app.setCommandHandler('edit.fillDown', () => this.gridEl()?.fillDownSelection());
    app.setCommandHandler('tags.add', () => this.addTag());
    app.setCommandHandler('tags.delete', () => this.deleteRows());
    app.setCommandHandler('tags.exportCsv', () => void this.exportCsv());
    app.hooks.commitPending = this.commitHook;
    this.offValues = app.subscribeValues(() => {
      if (app.valuesLive()) this.ticks++;
    });
    this.addEventListener('focusin', this.onFocus);
    this.addEventListener('focusout', this.onFocus);
    this.requestUpdate();
  }

  protected override detached(): void {
    const app = this.app;
    this.gridEl()?.commitPending();
    for (const id of ['edit.fillDown', 'tags.add', 'tags.delete', 'tags.exportCsv'] as const)
      app.setCommandHandler(id, null);
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
    this.offValues?.();
    this.offValues = null;
    this.removeEventListener('focusin', this.onFocus);
    this.removeEventListener('focusout', this.onFocus);
    app.live.release('tag-table');
    app.setUiContext({ tagGridFocused: false, cellRow: null });
  }

  /** Không vẽ khi đã rời document (lần vẽ còn chờ không được đặt lại ngữ cảnh lệnh của editor mới). */
  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    const loc = this.app.takeReveal('tags');
    if (loc?.editor === 'tags') this.planReveal(loc.row, String(loc.column));
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const p = this.pending;
    if (!p) return;
    const grid = this.gridEl();
    if (!grid) return;
    this.pending = null;
    void grid.updateComplete.then(() => {
      if (this.isConnected) grid.reveal({ row: p.row, col: p.col }, { edit: p.edit });
    });
  }

  /** Vị trí cần hiện: ô có lỗi thì vào sửa; ô không lỗi (Details, Tìm) thì chỉ chọn. Cột bị ẩn thì hiện lại cột. */
  private planReveal(row: number, wanted: string): void {
    const app = this.app;
    const s = app.store.state;
    let col = wanted;
    const columns = () => this.adapter().columns.map((c) => c.key);
    if (!columns().includes(col) && s.outline.version === '0.2') {
      app.setColumnChoice({ set: 'all', columns: null });
    }
    if (!columns().includes(col)) col = columns().includes('address') ? 'address' : 'id';
    const edit = issueCells(s.issues, s.outline).has(`${row}:${wanted}`);
    this.pending = { row, col, edit };
  }

  private readonly onFocus = (): void => {
    const grid = this.gridEl();
    const inGrid = !!grid && grid.contains(document.activeElement);
    this.app.setUiContext({ tagGridFocused: inGrid && !grid.state.editing });
  };

  // ---------- Sự kiện của lưới ----------

  private onGridState = (e: Event): void => {
    const state = (e as CustomEvent<{ state: GridState }>).detail.state;
    this.memo().grid = state;
    const app = this.app;
    const cell = state.cell;
    const sel = app.store.state.selection;
    if (cell && !(sel?.kind === 'tag' && sel.row === cell.row))
      app.select({ kind: 'tag', row: cell.row });
    else if (!cell && sel?.kind === 'tag') app.select(null);
    app.setUiContext({ cellRow: this.gridEl()?.currentPosition() ?? null });
    this.onFocus();
    this.requestUpdate();
  };

  private onGridEdit = (e: Event): void => {
    const detail = (e as CustomEvent<{ edits: Parameters<StudioApp['store']['edit']>[0] }>).detail;
    const app = this.app;
    // Ô tên của Tag đang được dùng (biểu thức, bảng theo dõi, lưu trữ, binding): không đổi lặng lẽ mà mở hộp thoại Đổi tên
    // để người dùng xem chỗ sẽ đổi (FR-047). Các sửa đổi khác trong cùng lần gõ vẫn áp.
    const o = app.store.state.outline;
    const split = splitRenames(
      (o.tags?.tags ?? []) as unknown as { id?: unknown }[],
      detail.edits,
      (id) => whereUsed(o, id).length > 0,
    );
    app.store.edit(split.edits);
    const first = split.requests[0];
    if (first) {
      if (split.requests.length > 1) app.toast(t('rtd.onlyOne'));
      app.openDialog({ kind: 'renameTag', tagId: first.from, to: first.to });
    }
  };

  private onGridNotice = (e: Event): void => {
    this.app.toast((e as CustomEvent<{ text: string }>).detail.text);
  };

  /** Dòng đang hiện thay đổi: chỉ đăng ký dữ liệu sống cho các dòng này (ưu tiên 1, data-model §13.5). */
  private onViewport = (e: Event): void => {
    const app = this.app;
    if (!app.online()) return;
    const rows = (e as CustomEvent<{ rows: number[] }>).detail.rows;
    const adapter = this.adapter();
    app.live.declare(
      'tag-table',
      rows.map((r) => adapter.text(r, 'id')).filter(Boolean),
      PRIORITY.tagTable,
    );
  };

  private onFilter = (e: Event): void => {
    const grid = this.gridEl();
    if (!grid) return;
    const next = setFilter(this.adapter(), grid.state, (e.target as HTMLInputElement).value);
    grid.state = next;
    this.memo().grid = next;
    this.requestUpdate();
  };

  // ---------- Lệnh ----------

  private addTag(): void {
    if (this.readOnly()) return;
    const adapter = this.adapter();
    const add = adapter.append();
    this.app.store.edit(add.edits);
    this.pending = { row: add.row, col: 'id', edit: true };
    this.requestUpdate();
  }

  private deleteRows(): void {
    const grid = this.gridEl();
    if (!grid || this.readOnly()) return;
    const rows = grid.selectedRows();
    if (!rows.length) return;
    const adapter = this.adapter();
    const names = rows.map((r) => adapter.text(r, 'id'));
    this.app.store.edit(adapter.remove(rows));
    this.app.toast(
      rows.length === 1
        ? t('tagGrid.deleted', { id: names[0] })
        : t('tt.deletedMany', { n: rows.length }),
    );
  }

  private async exportCsv(): Promise<void> {
    const app = this.app;
    const adapter = this.adapter();
    const text = tagsToCsv(adapter, defaultDecimal());
    const r = await app.csvSave('tags.csv', text);
    if (r === null) return;
    if ('error' in r) app.toast(t('tt.csv.exportFailed', { reason: r.detail }));
    else app.toast(t('tt.csv.exported', { n: adapter.rowCount(), name: r.name }));
  }

  private setChoice(choice: { set: ColumnSet; columns: string[] | null }): void {
    this.app.setColumnChoice(choice);
  }

  // ---------- Vẽ ----------

  private tool(
    act: string,
    ic: IconName,
    labelKey: MessageKey,
    reason: string | null,
    run: () => void,
    tip?: string,
  ) {
    const label = t(labelKey);
    const locked = reason === null ? null : t('reason.locked', { label, reason });
    return html`<button
      class="tbtn"
      type="button"
      data-act=${act}
      aria-disabled=${locked ? 'true' : nothing}
      title=${locked ?? tip ?? label}
      @click=${() => (locked ? this.app.toast(locked) : run())}
    >
      ${icon(ic)}<span>${label}</span>
    </button>`;
  }

  private tools(adapter: TagTable) {
    const app = this.app;
    const s = app.store.state;
    const grid = this.gridEl();
    const v02 = s.outline.version === '0.2';
    const choice = app.columnChoice();
    const broken = this.broken();
    const ro = this.readOnly();
    const blocked = broken
      ? t('tagGrid.broken', { file: s.outline.tagFile })
      : ro
        ? t('reason.readOnly')
        : null;
    const pos = grid?.currentPosition() ?? null;
    const shown = grid?.shownCount() ?? adapter.rowCount();
    const deleteReason = blocked ?? (pos === null ? t('reason.noRow') : null);
    const fillReason =
      blocked ??
      (pos === null ? t('reason.gridNotFocused') : pos === 0 ? t('reason.firstRow') : null);
    const csvReason = broken ? t('tagGrid.broken', { file: s.outline.tagFile }) : null;
    const wanted = new Set(adapter.columns.map((c) => c.key));
    const u = this.usageInfo();
    return html`<div class="ed-tools" role="group" aria-label=${t('tagGrid.tools')}>
      ${this.tool('add', 'plus', 'cmd.tags.add', blocked, () => void app.run('tags.add'))}
      ${this.tool('delete', 'x', 'cmd.tags.delete', deleteReason, () => void app.run('tags.delete'))}
      ${this.tool('fill', 'filldown', 'cmd.edit.fillDown', fillReason, () => void app.run('edit.fillDown'), t('tagGrid.fillTip'))}
      <span class="tsep" aria-hidden="true"></span>
      ${
        v02
          ? html`${this.tool('bulk', 'plus', 'cmd.tags.bulkAdd', blocked, () => void app.run('tags.bulkAdd'))}
            ${this.tool('import', 'import', 'cmd.tags.importCsv', blocked, () => void app.run('tags.importCsv'))}
            ${this.tool('export', 'export', 'cmd.tags.exportCsv', csvReason, () => void app.run('tags.exportCsv'))}
            ${
              s.outline.v05
                ? this.tool(
                    'alarm',
                    'bell',
                    'cmd.alarm.quickCreate',
                    app.enabled('alarm.quickCreate') === true
                      ? null
                      : t(app.enabled('alarm.quickCreate') as MessageKey),
                    () => app.openAlarmQuick(this.selectedTagIds()),
                  )
                : nothing
            }`
          : nothing
      }
      <span class="grow"></span>
      ${
        v02
          ? html`<label class="tg-set"
                ><span class="visually-hidden">${t('tt.set.label')}</span>
                <select
                  class="select sm"
                  data-role="set"
                  .value=${choice.set}
                  @change=${(e: Event) =>
                    this.setChoice({
                      set: (e.target as HTMLSelectElement).value as ColumnSet,
                      columns: null,
                    })}
                >
                  ${SETS.map((x) => html`<option value=${x} ?selected=${x === choice.set}>${t(`tt.set.${x}` as MessageKey)}</option>`)}
                </select></label
              >
              <details class="tg-cols" data-role="cols">
                <summary class="tbtn">${t('tt.cols.choose')}</summary>
                <div class="tg-cols-pop" role="group" aria-label=${t('tt.cols.choose')}>
                  ${CHOOSABLE.map(
                    (c) =>
                      html`<label
                        ><input
                          type="checkbox"
                          data-col=${c}
                          .checked=${wanted.has(c)}
                          ?disabled=${c === 'id'}
                          @change=${(e: Event) => this.toggleColumn(c, (e.target as HTMLInputElement).checked, wanted)}
                        />${t(`tt.col.${c}` as MessageKey)}</label
                      >`,
                  )}
                  <button
                    class="btn sm"
                    type="button"
                    @click=${() => this.setChoice({ set: choice.set, columns: null })}
                  >
                    ${t('tt.cols.reset')}
                  </button>
                </div>
              </details>`
          : nothing
      }
      <input
        class="input sm"
        type="search"
        data-role="filter"
        placeholder=${t('tagGrid.filterPlaceholder')}
        aria-label=${t('tagGrid.filter')}
        autocomplete="off"
        spellcheck="false"
        .value=${live(this.memo().grid.filter)}
        @input=${this.onFilter}
      />
      <span class="muted num tg-count" data-role="count" role="status"
        >${t('tagGrid.count', { shown, total: adapter.rowCount() })}</span
      >
      ${
        u
          ? html`<span
              class="muted num tg-usage ${u.level === 'ok' ? '' : u.level}"
              data-role="usage"
              title=${u.title}
              >${u.text}</span
            >`
          : nothing
      }
    </div>`;
  }

  /** Tag của các dòng đang chọn (Tạo alarm cho Tag…). */
  private selectedTagIds(): string[] {
    const grid = this.gridEl();
    const adapter = this.adapter();
    return (grid?.selectedRows() ?? []).map((r) => adapter.text(r, 'id')).filter(Boolean);
  }

  private toggleColumn(col: string, on: boolean, current: ReadonlySet<string>): void {
    const next = new Set(current);
    if (on) next.add(col);
    else next.delete(col);
    next.add('id');
    this.setChoice({
      set: this.app.columnChoice().set,
      columns: CHOOSABLE.filter((c) => next.has(c)),
    });
  }

  /** Mức dùng tags.json so với trần 1 MiB (R2): tính lại khi danh sách Tag đổi; cảnh báo từ 85 %. */
  private usageInfo(): { text: string; level: string; title: string } | null {
    const o = this.app.store.state.outline;
    if (!o.tags) return null;
    if (!this.usage || this.usage.tags !== o.tags) {
      const u = tagsFileUsage(o.tags.tags, o.version === '0.2' ? '0.2.0' : '0.1.0');
      const percent = Math.round(u.ratio * 100);
      this.usage = {
        tags: o.tags,
        level: u.level,
        text: t('tt.usage', { used: sizeText(u.bytes), limit: '1 MiB' }),
        title:
          u.level === 'full'
            ? t('tt.usage.full')
            : u.level === 'warn'
              ? t('tt.usage.warn', { percent })
              : `${percent}%`,
      };
    }
    return this.usage;
  }

  /** Dòng gợi ý của ô địa chỉ: mã hàm, offset thật, số thanh ghi (FR-015). */
  private addressHint(adapter: TagTable, grid: MatGrid | null) {
    const cell = grid?.state.cell;
    if (!cell || cell.col !== 'address') return nothing;
    const info = adapter.addressInfo(cell.row);
    if (!info)
      return html`<p class="help tg-hint" data-role="addr-hint">${t('tt.hint.syntax')}</p>`;
    if (!info.ok)
      return html`<p class="field-err tg-hint" data-role="addr-hint">${t(info.error!)}</p>`;
    return html`<p class="help tg-hint" data-role="addr-hint">
      ${t('tt.hint.address', { fc: info.fc ?? '', offset: info.offset ?? 0, regs: info.regs ?? 0 })}
    </p>`;
  }

  /** Vẽ riêng quality (chip có chữ, màu không là tín hiệu duy nhất) và giá trị thiết bị không có. */
  private renderCell = (row: number, col: { key: string }, text: string) => {
    if (col.key === 'quality' && text) {
      const stale = text === qualityText('STALE');
      if (stale) return html`<span class="tg-stale">${text}</span>`;
      const cls = QUALITY_CHIP[text as keyof typeof QUALITY_CHIP];
      return cls ? html`<span class="chip ${cls}">${text}</span>` : undefined;
    }
    void row;
    return undefined;
  };

  protected override render() {
    const app = this.app;
    const s = app.store.state;
    const adapter = this.adapter();
    const broken = this.broken();
    const title = app.editorTitle('tags');
    const grid = this.gridEl();
    return html`<div class="ed ed-fill">
      <div class="ed-head">
        <h2>${title}</h2>
        <span class="path">${s.outline.tagFile}</span>
        <span class="grow"></span>
        <span class="help">${t('tagGrid.hint2')}</span>
      </div>
      ${
        broken
          ? html`<div class="banner err" role="alert">
              ${icon('err', 'err')}
              <div>${t('tagGrid.broken', { file: s.outline.tagFile })}</div>
            </div>`
          : s.readOnly
            ? html`<div class="banner warn" role="status">
                ${icon('warn', 'warn')}
                <div>${t('tagTable.readOnlyBanner')}</div>
              </div>`
            : nothing
      }
      ${this.tools(adapter)} ${this.addressHint(adapter, grid)}
      <div class="tg-gridwrap">
        <mat-grid
          .adapter=${adapter}
          .state=${this.memo().grid}
          .label=${title}
          .issues=${this.issueMap()}
          .decimal=${defaultDecimal()}
          .renderCell=${this.renderCell}
          .ticks=${this.ticks}
          .dragColumn=${'id'}
          .showFilters=${false}
          @grid-state=${this.onGridState}
          @grid-edit=${this.onGridEdit}
          @grid-notice=${this.onGridNotice}
          @grid-viewport=${this.onViewport}
        ></mat-grid>
        ${
          adapter.rowCount() === 0 && !broken
            ? html`<div class="empty">
                ${icon('tag', 'lg')}<b>${t('tagGrid.empty.title')}</b>
                <p>${t('tagGrid.empty.text')}</p>
              </div>`
            : nothing
        }
      </div>
    </div>`;
  }
}

customElements.define('mat-tag-grid', TagGrid);

registerEditor({
  match: (id) => id === 'tags',
  render: (app) => html`<mat-tag-grid .app=${app}></mat-tag-grid>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-tag-grid': TagGrid;
  }
}
