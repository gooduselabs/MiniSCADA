// Editor Danh sách alarm (feature 009, T076, T079, T082, FR-074 đến FR-079, FR-081; contract studio-alarm-editor §3, §5, §8;
// mockup studio-alarms.html cảnh 1): lưới ảo hóa chung của 006 với cột theo §3.1, lỗi và cảnh báo theo ô (cùng validator với
// runtime), bảng Khu vực bên phải, chi tiết dòng đang chọn (lớp và nội dung theo ngưỡng, Xem trước nội dung, gợi ý thẻ khi
// gõ `{`), bộ lọc nhanh, chọn cột, Nhập và Xuất CSV, cột "Trạng thái sống" (viền cam) khi Online. Mỗi lần xác nhận ô, dán,
// điền, thêm, xóa là MỘT bước hoàn tác qua `app.store.edit`.
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import { ALARM_LIMITS, ALARM_THRESHOLDS, type AlarmThresholdName } from '@mat/project-schema';
import type { StudioApp } from '../../app/app.ts';
import { issueText } from '../../app/code-text.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  ALARM_COLS,
  addArea,
  alarmDocOf,
  changeAreaId,
  ctxOf,
  duplicateAlarms,
  isAlarmCol,
  issuesByCell,
  removeArea,
  renameArea,
  setThresholdField,
  usageOfArea,
  type AlarmCol,
} from '../../model/alarm-doc.ts';
import { alarmsToCsv } from '../../model/alarm-csv.ts';
import {
  FILTER_ERRORS,
  FILTER_UNUSED,
  alarmGrid,
  statusLine,
  type AlarmGrid,
} from '../../model/alarm-grid.ts';
import { liveByDef, type LiveRow } from '../../model/alarm-live.ts';
import {
  checkText,
  insertToken,
  previewText,
  sampleFor,
  tokenQuery,
  tokenSuggestions,
} from '../../model/alarm-text.ts';
import { defaultDecimal } from '../../model/csv-import.ts';
import { initialGrid, setColFilter, setFilter, type GridState } from '../../model/grid/index.ts';
import { AppElement, icon } from '../base.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import { registerEditor } from '../registry.ts';
import { stateLabelOf } from './alarm-shared.ts';
import './alarm-editors.css';

interface Memo {
  project: object | null;
  grid: GridState;
  hidden: ReadonlySet<AlarmCol>;
  search: string;
  errorsOnly: boolean;
  unusedOnly: boolean;
  type: string;
  cls: string;
  area: string;
  areaOpen: boolean;
}

/** Trạng thái lưới và bộ lọc theo StudioApp: giữ khi chuyển tab; mở project khác thì bắt đầu lại. */
const memory = new WeakMap<StudioApp, Memo>();

interface PendingReveal {
  row: number;
  col: string;
  edit: boolean;
}

export class AlarmGridEditor extends AppElement {
  static override properties = {
    ticks: { state: true },
    areaEdit: { state: true },
    areaConfirm: { state: true },
    suggest: { state: true },
    previewOpen: { state: true },
  };

  declare ticks: number;
  /** Ô nhập của bảng Khu vực: `id` null là thêm mới. */
  declare areaEdit: { id: string | null; value: string } | null;
  /** Xác nhận xóa khu vực đang dùng. */
  declare areaConfirm: string | null;
  /** Gợi ý thẻ đang hiện ở ô nội dung: danh sách thẻ khớp và vị trí con trỏ. */
  declare suggest: { field: string; q: ReturnType<typeof tokenQuery> } | null;
  declare previewOpen: boolean;

  private pending: PendingReveal | null = null;
  private cache: { key: unknown[]; adapter: AlarmGrid } | null = null;
  private liveCache: { snap: unknown; map: Map<string, LiveRow> } | null = null;
  private offLive: (() => void) | null = null;

  constructor() {
    super();
    this.ticks = 0;
    this.areaEdit = null;
    this.areaConfirm = null;
    this.suggest = null;
    this.previewOpen = false;
  }

  // ---------- Trạng thái ----------

  private memo(): Memo {
    const project = this.app.store.state.project;
    let m = memory.get(this.app);
    if (!m || m.project !== project) {
      m = {
        project,
        grid: initialGrid,
        hidden: new Set(),
        search: '',
        errorsOnly: false,
        unusedOnly: false,
        type: '',
        cls: '',
        area: '',
        areaOpen: true,
      };
      memory.set(this.app, m);
    }
    return m;
  }

  private gridEl(): MatGrid | null {
    return this.querySelector<MatGrid>('mat-grid');
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || !s.outline.v05 || !s.docs['project.json']?.editable;
  }

  private doc() {
    const o = this.app.store.state.outline;
    return alarmDocOf({ alarms: o.alarms, alarmClasses: o.alarmClasses });
  }

  private ctx() {
    const o = this.app.store.state.outline;
    const devices = (o.connections?.channels ?? []).flatMap((c) =>
      (c.devices ?? []).map((d) => d.id),
    );
    return ctxOf((o.tags?.tags ?? []) as never, devices);
  }

  private issues() {
    const s = this.app.store.state;
    return issuesByCell(s.issues, s.outline.alarmFile ?? 'alarms.json', (i) => issueText(i));
  }

  private liveMap(): Map<string, LiveRow> {
    const snap = this.app.session.alarms.snapshot();
    if (this.liveCache?.snap !== snap) this.liveCache = { snap, map: liveByDef(snap) };
    return this.liveCache.map;
  }

  /** Có cột sống: đang Online và thiết bị báo hỗ trợ alarm (hoặc đã có dữ liệu). */
  private liveOn(): boolean {
    if (!this.app.online()) return false;
    const st = this.app.session.alarms.status();
    return st === 'live' || st === 'stale';
  }

  private liveText = (row: number): string => {
    const doc = this.doc();
    const def = doc.alarms[row] as unknown as { id: string; type: string } | undefined;
    if (!def) return '';
    const r = this.liveMap().get(def.id);
    if (!r || !r.top) return '—';
    const top = r.top;
    const stateKey = top.shelved ? 'shelved' : top.disabled ? 'disabled' : top.state;
    const label = stateLabelOf(stateKey);
    return def.type === 'limit'
      ? `${label} · ${t('alarm.live.count', { n: r.active, total: r.total })}`
      : label;
  };

  /** Adapter của lưới; dựng lại khi dữ liệu, cột hoặc lỗi đổi (không dựng lại khi chỉ có trạng thái sống đổi). */
  private adapter(): AlarmGrid {
    const s = this.app.store.state;
    const o = s.outline;
    const m = this.memo();
    const live = this.liveOn();
    const key = [
      o.alarms,
      o.alarmClasses,
      o.tags,
      o.connections,
      this.readOnly(),
      m.hidden,
      s.issues,
      live,
      o.alarmFile,
    ];
    const c = this.cache;
    if (c && c.key.length === key.length && c.key.every((k, i) => k === key[i])) return c.adapter;
    const errorRows = new Set(this.issues().rows.keys());
    const adapter = alarmGrid({
      doc: this.doc(),
      ctx: this.ctx(),
      version: String(
        (s.docs['project.json']?.value as { schemaVersion?: string } | null)?.schemaVersion ??
          '0.5.0',
      ),
      hadFiles: { alarms: !!o.alarms, classes: !!o.alarmClasses },
      readOnly: this.readOnly(),
      columns: ALARM_COLS.filter((x) => !m.hidden.has(x)),
      errorRows,
      live,
      liveText: this.liveText,
    });
    this.cache = { key, adapter };
    return adapter;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => this.gridEl()?.commitPending();

  protected override attached(): void {
    const app = this.app;
    app.hooks.commitPending = this.commitHook;
    app.setCommandHandler('alarm.new', () => this.addRow());
    app.setCommandHandler('alarm.fillDown', () => this.gridEl()?.fillDownSelection());
    app.setCommandHandler('alarm.deleteRows', () => this.deleteRows());
    app.setCommandHandler('alarm.export', () => void this.exportCsv());
    app.setCommandHandler('alarm.filter.errors', () => this.setErrorsOnly(!this.memo().errorsOnly));
    app.setCommandHandler('alarm.areas.focus', () => this.focusAreas());
    app.setCommandHandler('alarm.areas.add', () => this.startAddArea());
    app.setCommandHandler('edit.fillDown', () => this.gridEl()?.fillDownSelection());
    this.offLive = app.session.alarms.subscribe(() => {
      if (this.liveOn()) this.ticks++;
    });
    app.session.alarms.want(true);
    this.requestUpdate();
  }

  protected override detached(): void {
    const app = this.app;
    this.gridEl()?.commitPending();
    for (const id of [
      'alarm.new',
      'alarm.fillDown',
      'alarm.deleteRows',
      'alarm.export',
      'alarm.filter.errors',
      'alarm.areas.focus',
      'alarm.areas.add',
      'edit.fillDown',
    ] as const)
      app.setCommandHandler(id, null);
    if (app.hooks.commitPending === this.commitHook) app.hooks.commitPending = undefined;
    this.offLive?.();
    this.offLive = null;
    app.session.alarms.want(false);
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    const loc = this.app.takeReveal('alarms');
    if (loc?.editor !== 'alarms') return;
    if (loc.area !== undefined) {
      this.memo().areaOpen = true;
      this.pending = null;
      void this.updateComplete.then(() => this.focusAreas());
      return;
    }
    if (loc.row === undefined) return;
    let col = loc.column ?? 'id';
    const m = this.memo();
    if (isAlarmCol(col) && m.hidden.has(col)) {
      const next = new Set(m.hidden);
      next.delete(col);
      m.hidden = next;
    }
    if (!isAlarmCol(col)) col = 'id';
    // Dòng bị lọc che thì bỏ lọc để thấy ô.
    this.clearFilters();
    this.pending = { row: loc.row, col, edit: true };
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

  // ---------- Sự kiện của lưới ----------

  private onGridState = (e: Event): void => {
    const state = (e as CustomEvent<{ state: GridState }>).detail.state;
    this.memo().grid = state;
    this.requestUpdate();
  };

  private onGridEdit = (e: Event): void => {
    const detail = (e as CustomEvent<{ edits: Parameters<StudioApp['store']['edit']>[0] }>).detail;
    const adapter = this.adapter();
    this.app.store.edit(detail.edits);
    if (adapter.lost.length)
      this.app.toast(t('alarm.grid.lost', { fields: adapter.lost.join(', ') }));
  };

  private onGridNotice = (e: Event): void => {
    this.app.toast((e as CustomEvent<{ text: string }>).detail.text);
  };

  // ---------- Lọc ----------

  private applyFilters(): void {
    const m = this.memo();
    const a = this.adapter();
    const words = [m.search, m.errorsOnly ? FILTER_ERRORS : '', m.unusedOnly ? FILTER_UNUSED : '']
      .filter(Boolean)
      .join(' ');
    let g = setFilter(a, m.grid, words);
    g = setColFilter(a, g, 'type', m.type);
    g = setColFilter(a, g, 'class', m.cls);
    g = setColFilter(a, g, 'area', m.area);
    m.grid = g;
    const el = this.gridEl();
    if (el) el.state = g;
    this.requestUpdate();
  }

  private clearFilters(): void {
    const m = this.memo();
    m.search = '';
    m.errorsOnly = false;
    m.unusedOnly = false;
    m.type = '';
    m.cls = '';
    m.area = '';
    this.applyFilters();
  }

  private setErrorsOnly(on: boolean): void {
    this.memo().errorsOnly = on;
    this.applyFilters();
  }

  // ---------- Lệnh ----------

  private addRow(): void {
    if (this.readOnly()) return;
    const add = this.adapter().append();
    if (!add.edits.length) {
      this.app.toast(t('alarm.quick.err.over500'));
      return;
    }
    this.gridEl()?.commitPending();
    this.app.store.edit(add.edits);
    this.clearFilters();
    this.pending = { row: add.row, col: 'name', edit: true };
    this.requestUpdate();
  }

  private deleteRows(): void {
    const grid = this.gridEl();
    if (!grid || this.readOnly()) return;
    const rows = grid.selectedRows();
    if (!rows.length) {
      this.app.toast(t('alarm.grid.noSelection'));
      return;
    }
    this.app.store.edit(this.adapter().remove(rows));
    this.app.toast(t('alarm.grid.deleted', { n: rows.length }));
  }

  private duplicateRows(): void {
    const grid = this.gridEl();
    if (!grid || this.readOnly()) return;
    const rows = grid.selectedRows();
    if (!rows.length) {
      this.app.toast(t('alarm.grid.noSelection'));
      return;
    }
    const adapter = this.adapter();
    const r = duplicateAlarms(adapter.doc, rows);
    this.app.store.edit(adapter.edits(r.doc));
    this.app.toast(
      r.dropped > 0
        ? t('alarm.grid.pasteOverLimit', { n: r.dropped, max: ALARM_LIMITS.instances })
        : t('alarm.grid.duplicated', { n: r.added.length }),
    );
  }

  private async exportCsv(): Promise<void> {
    const grid = this.gridEl();
    const adapter = this.adapter();
    const shown = grid?.visibleRows() ?? [];
    const text = alarmsToCsv(
      adapter.doc,
      shown.length === adapter.rowCount() ? undefined : shown,
      defaultDecimal(),
    );
    const r = await this.app.csvSave('alarms.csv', text);
    if (r === null) return;
    if ('error' in r) this.app.toast(t('alarm.csv.exportFailed', { reason: r.detail }));
    else
      this.app.toast(
        t('alarm.csv.exported', { n: shown.length || adapter.rowCount(), name: r.name }),
      );
  }

  // ---------- Khu vực ----------

  private focusAreas(): void {
    this.memo().areaOpen = true;
    this.requestUpdate();
    void this.updateComplete.then(
      () =>
        this.querySelector<HTMLElement>('.al-area-list button.al-area-item')?.focus() ??
        this.querySelector<HTMLElement>('[data-act="area-add"]')?.focus(),
    );
  }

  private startAddArea(): void {
    if (this.readOnly()) return;
    this.memo().areaOpen = true;
    this.areaEdit = { id: null, value: '' };
    void this.updateComplete.then(() =>
      this.querySelector<HTMLInputElement>('input[name="area"]')?.focus(),
    );
  }

  private commitArea(): void {
    const ed = this.areaEdit;
    if (!ed) return;
    const adapter = this.adapter();
    const name = ed.value.trim();
    if (ed.id === null) {
      const r = addArea(adapter.doc, name);
      if ('error' in r) {
        this.app.toast(t(r.error as MessageKey));
        return;
      }
      this.app.store.edit(adapter.edits(r.doc));
      this.app.toast(t('alarm.area.added', { name }));
    } else if (name) {
      this.app.store.edit(adapter.edits(renameArea(adapter.doc, ed.id, name)));
    }
    this.areaEdit = null;
  }

  private removeAreaNow(id: string): void {
    const adapter = this.adapter();
    const area = adapter.doc.areas.find((a) => a.id === id);
    const used = usageOfArea(adapter.doc, id);
    this.app.store.edit(adapter.edits(removeArea(adapter.doc, id)));
    this.areaConfirm = null;
    this.app.toast(t('alarm.area.removed', { name: area?.name ?? id, n: used.length }));
  }

  private areaPanel() {
    const m = this.memo();
    const adapter = this.adapter();
    const ro = this.readOnly();
    const doc = adapter.doc;
    const count = (id: string) => usageOfArea(doc, id).length;
    const common = doc.alarms.filter((a) => !(a as unknown as { area?: string }).area).length;
    if (!m.areaOpen)
      return html`<aside class="al-side collapsed">
        <button
          class="ibtn"
          type="button"
          data-act="area-expand"
          aria-label=${t('alarm.area.expand')}
          title=${t('alarm.area.expand')}
          @click=${() => {
            m.areaOpen = true;
            this.requestUpdate();
          }}
        >
          ${icon('chev-d')}
        </button>
      </aside>`;
    const confirm = this.areaConfirm ? doc.areas.find((a) => a.id === this.areaConfirm) : null;
    return html`<aside class="al-side" aria-label=${t('alarm.area.title')}>
      <section class="al-card" data-role="areas">
        <h3>
          ${icon('list', 'sm')}${t('alarm.area.title')}
          <span class="grow"></span>
          <button
            class="ibtn"
            type="button"
            data-act="area-add"
            ?disabled=${ro}
            aria-label=${t('alarm.area.add')}
            title=${t('alarm.area.add')}
            @click=${() => this.startAddArea()}
          >
            ${icon('plus')}
          </button>
          <button
            class="ibtn"
            type="button"
            aria-label=${t('alarm.area.collapse')}
            title=${t('alarm.area.collapse')}
            @click=${() => {
              m.areaOpen = false;
              this.requestUpdate();
            }}
          >
            ${icon('collapse')}
          </button>
        </h3>
        <ul class="al-area-list" role="listbox" aria-label=${t('alarm.area.title')}>
          <li>
            <span class="al-area-item static" title=${t('alarm.area.system')}>
              <span class="nm">${t('alarm.area.common')}</span
              ><span class="cnt" aria-label=${t('alarm.area.col.count')}>${common}</span>
            </span>
          </li>
          ${doc.areas.map((a) => {
            const on = m.area !== '' && m.area === a.name;
            const editing = this.areaEdit?.id === a.id;
            return html`<li>
              ${
                editing
                  ? html`<input
                      class="input sm"
                      name="area"
                      type="text"
                      autocomplete="off"
                      aria-label=${t('alarm.area.rename')}
                      .value=${live(this.areaEdit!.value)}
                      @input=${(e: Event) =>
                        (this.areaEdit = { id: a.id, value: (e.target as HTMLInputElement).value })}
                      @keydown=${(e: KeyboardEvent) => this.onAreaKey(e)}
                    />`
                  : html`<button
                      type="button"
                      class="al-area-item${on ? ' on' : ''}"
                      role="option"
                      aria-selected=${on ? 'true' : 'false'}
                      data-area=${a.id}
                      title=${on ? t('alarm.area.filterOn', { name: a.name }) : a.id}
                      @click=${() => {
                        m.area = on ? '' : a.name;
                        this.applyFilters();
                      }}
                      @keydown=${(e: KeyboardEvent) => {
                        if (e.key === 'F2' && !ro) {
                          e.preventDefault();
                          this.areaEdit = { id: a.id, value: a.name };
                          void this.updateComplete.then(() =>
                            this.querySelector<HTMLInputElement>('input[name="area"]')?.select(),
                          );
                        } else if (e.key === 'Delete' && !ro) {
                          e.preventDefault();
                          this.askRemoveArea(a.id);
                        }
                      }}
                    >
                      <span class="nm">${a.name}</span><span class="id mono">${a.id}</span
                      ><span class="cnt" aria-label=${t('alarm.area.col.count')}
                        >${count(a.id)}</span
                      >
                    </button>`
              }
              ${
                !editing && !ro
                  ? html`<button
                      class="ibtn sm"
                      type="button"
                      data-act="area-remove"
                      aria-label=${`${t('alarm.area.remove')}: ${a.name}`}
                      title=${t('alarm.area.remove')}
                      @click=${() => this.askRemoveArea(a.id)}
                    >
                      ${icon('x', 'sm')}
                    </button>`
                  : nothing
              }
            </li>`;
          })}
          ${
            this.areaEdit?.id === null
              ? html`<li>
                  <input
                    class="input sm"
                    name="area"
                    type="text"
                    autocomplete="off"
                    placeholder=${t('alarm.area.addPrompt')}
                    aria-label=${t('alarm.area.addPrompt')}
                    .value=${live(this.areaEdit.value)}
                    @input=${(e: Event) =>
                      (this.areaEdit = { id: null, value: (e.target as HTMLInputElement).value })}
                    @keydown=${(e: KeyboardEvent) => this.onAreaKey(e)}
                  />
                </li>`
              : nothing
          }
        </ul>
        ${
          confirm
            ? html`<div
                class="banner warn al-confirm"
                role="alertdialog"
                aria-label=${t('alarm.area.remove')}
                data-role="area-confirm"
              >
                ${icon('warn', 'warn')}
                <div>
                  ${t('alarm.area.removeConfirm', {
                    name: confirm.name,
                    n: count(confirm.id),
                    ids: usageOfArea(doc, confirm.id)
                      .slice(0, 5)
                      .map((u) => u.id)
                      .join(', '),
                  })}
                  <div class="row">
                    <button
                      class="btn sm primary"
                      type="button"
                      data-act="area-confirm"
                      @click=${() => this.removeAreaNow(confirm.id)}
                    >
                      ${t('alarm.area.remove')}
                    </button>
                    <button class="btn sm" type="button" @click=${() => (this.areaConfirm = null)}>
                      ${t('alarm.quick.cancel')}
                    </button>
                  </div>
                </div>
              </div>`
            : nothing
        }
      </section>
      ${this.detailPanel()}
    </aside>`;
  }

  private askRemoveArea(id: string): void {
    if (usageOfArea(this.adapter().doc, id).length === 0) this.removeAreaNow(id);
    else this.areaConfirm = id;
  }

  private onAreaKey(e: KeyboardEvent): void {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.commitArea();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.areaEdit = null;
    }
  }

  /** Đổi id khu vực (thao tác riêng, một bước hoàn tác): dùng ở e2e và lệnh sau này; không có nút trên giao diện. */
  renameAreaId(from: string, to: string): void {
    const adapter = this.adapter();
    this.app.store.edit(adapter.edits(changeAreaId(adapter.doc, from, to)));
  }

  // ---------- Chi tiết dòng đang chọn ----------

  private selectedRow(): number | null {
    const cell = this.memo().grid.cell;
    return cell ? cell.row : null;
  }

  private detailPanel() {
    const row = this.selectedRow();
    const adapter = this.adapter();
    const def =
      row === null
        ? undefined
        : (adapter.doc.alarms[row] as unknown as Record<string, unknown> | undefined);
    if (!def)
      return html`<section class="al-card" data-role="detail">
        <h3>${icon('bell', 'sm')}${t('alarm.text.preview')}</h3>
        <p class="help">${t('alarm.grid.noSelection')}</p>
      </section>`;
    const ro = this.readOnly();
    const doc = adapter.doc;
    const isLimit = def.type === 'limit';
    const limits = (def.limits ?? {}) as Record<
      string,
      { value: number; class: string; text?: string }
    >;
    const text = typeof def.text === 'string' ? def.text : '';
    const sample = sampleFor(def as never, doc, this.ctx().tags);
    const check = checkText(text);
    const commit = (value: string) => this.setText(row!, value);
    return html`<section
      class="al-card"
      data-role="detail"
      aria-label=${t('alarm.grid.limitDetail', { id: String(def.id) })}
    >
      <h3>${icon('bell', 'sm')}<span class="mono">${String(def.id)}</span></h3>
      ${
        isLimit
          ? html`<fieldset class="al-fs">
              <legend>${t('alarm.grid.limitClasses')}</legend>
              <p class="help">${t('alarm.grid.limitClassesHelp')}</p>
              ${[...ALARM_THRESHOLDS].reverse().map((n) =>
                limits[n]
                  ? html`<label class="al-th"
                      ><span class="lv">${n}</span>
                      <select
                        class="select sm"
                        data-th=${n}
                        ?disabled=${ro}
                        @change=${(e: Event) => this.setThreshold(row!, n, 'class', (e.target as HTMLSelectElement).value)}
                      >
                        ${doc.classes.map((c) => html`<option value=${c.id} ?selected=${c.id === limits[n]!.class}>${c.name}</option>`)}
                        ${doc.classes.some((c) => c.id === limits[n]!.class) ? nothing : html`<option value=${limits[n]!.class} selected>${limits[n]!.class}</option>`}
                      </select></label
                    >`
                  : nothing,
              )}
            </fieldset>`
          : nothing
      }
      <label class="al-l" for="al-text"
        >${isLimit ? t('alarm.grid.textCommon') : t('alarm.grid.col.text')}</label
      >
      <div class="al-textwrap">
        <input
          id="al-text"
          class="input sm"
          type="text"
          name="text"
          autocomplete="off"
          spellcheck="false"
          ?disabled=${ro}
          aria-invalid=${check === 'ok' ? 'false' : 'true'}
          aria-describedby="al-text-hint"
          .value=${live(text)}
          @input=${(e: Event) => this.onTextInput('text', e)}
          @keydown=${(e: KeyboardEvent) => this.onTextKey(e, 'text')}
          @change=${(e: Event) => commit((e.target as HTMLInputElement).value)}
        />
        ${this.suggestList('text', row!)}
      </div>
      <p class="help" id="al-text-hint">${t('alarm.text.tokenHint')}</p>
      ${check !== 'ok' ? html`<p class="field-err" role="alert">${t(check === 'length' ? 'alarm.text.tooLong' : 'alarm.text.badToken')}</p>` : nothing}
      <p class="al-preview" data-role="text-preview" aria-live="polite">
        <b>${t('alarm.text.preview')}:</b>
        ${check === 'ok' ? t('alarm.text.previewOf', { text: previewText(text, def as never, sample) }) : '—'}
      </p>
      ${
        isLimit
          ? html`<fieldset class="al-fs">
              <legend>${t('alarm.grid.limitTexts')}</legend>
              <p class="help">${t('alarm.grid.limitTextsHelp')}</p>
              ${[...ALARM_THRESHOLDS].reverse().map((n) => {
                const l = limits[n];
                if (!l) return nothing;
                const th = typeof l.text === 'string' ? l.text : '';
                const ok = checkText(th) === 'ok';
                return html`<label class="al-th wide"
                  ><span class="lv">${n}</span>
                  <input
                    class="input sm"
                    type="text"
                    data-th-text=${n}
                    ?disabled=${ro}
                    aria-invalid=${ok ? 'false' : 'true'}
                    autocomplete="off"
                    spellcheck="false"
                    .value=${live(th)}
                    @input=${(e: Event) => this.onTextInput(`th-${n}`, e)}
                    @keydown=${(e: KeyboardEvent) => this.onTextKey(e, `th-${n}`)}
                    @change=${(e: Event) => this.setThreshold(row!, n, 'text', (e.target as HTMLInputElement).value)}
                  />
                  <span class="al-thprev"
                    >${ok ? previewText(th, def as never, sampleFor(def as never, doc, this.ctx().tags, n)) : t('alarm.text.badToken')}</span
                  >
                  ${this.suggestList(`th-${n}`, row!)}
                </label>`;
              })}
            </fieldset>`
          : nothing
      }
    </section>`;
  }

  private setText(row: number, value: string): void {
    if (this.readOnly()) return;
    const r = this.adapter().apply([{ row, col: 'text', text: value }]);
    if (r.edits.length) this.app.store.edit(r.edits);
  }

  private setThreshold(
    row: number,
    name: AlarmThresholdName,
    field: 'class' | 'text',
    value: string,
  ): void {
    if (this.readOnly()) return;
    const adapter = this.adapter();
    const def = adapter.doc.alarms[row];
    if (!def) return;
    const next = setThresholdField(def, name, field, value);
    if (next === def) return;
    const alarms = adapter.doc.alarms.map((a, i) => (i === row ? next : a));
    this.app.store.edit(adapter.edits({ ...adapter.doc, alarms }));
  }

  /** Gợi ý thẻ: nhận ra `{` chưa đóng trước con trỏ. */
  private onTextInput(field: string, e: Event): void {
    const el = e.target as HTMLInputElement;
    const q = tokenQuery(el.value, el.selectionStart ?? el.value.length);
    this.suggest = q ? { field, q } : null;
  }

  private onTextKey(e: KeyboardEvent, field: string): void {
    if (e.isComposing) return;
    if (e.key === 'Escape' && this.suggest?.field === field) {
      e.preventDefault();
      e.stopPropagation();
      this.suggest = null;
    } else if (e.key === 'ArrowDown' && this.suggest?.field === field) {
      e.preventDefault();
      this.querySelector<HTMLElement>('.al-sugg button')?.focus();
    }
  }

  private suggestList(field: string, row: number) {
    const s = this.suggest;
    if (!s || s.field !== field || !s.q) return nothing;
    const list = tokenSuggestions(s.q);
    if (!list.length) return nothing;
    return html`<ul
      class="al-sugg"
      role="listbox"
      aria-label=${t('alarm.text.tokens')}
      data-role="suggest"
    >
      ${list.map(
        (x) =>
          html`<li role="presentation">
            <button
              type="button"
              role="option"
              aria-selected="false"
              data-token=${x.token}
              @click=${(e: Event) => this.pickToken(e, field, row, x.token)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'Escape') {
                  this.suggest = null;
                  this.querySelector<HTMLInputElement>(this.inputSelector(field))?.focus();
                } else if (e.key === 'ArrowDown')
                  (e.currentTarget as HTMLElement)
                    .closest('li')
                    ?.nextElementSibling?.querySelector('button')
                    ?.focus();
                else if (e.key === 'ArrowUp')
                  (e.currentTarget as HTMLElement)
                    .closest('li')
                    ?.previousElementSibling?.querySelector('button')
                    ?.focus();
              }}
            >
              <span class="mono">{${x.token}}</span> <span class="muted">${t(x.label)}</span>
            </button>
          </li>`,
      )}
    </ul>`;
  }

  private inputSelector(field: string): string {
    return field === 'text' ? 'input[name="text"]' : `input[data-th-text="${field.slice(3)}"]`;
  }

  private pickToken(_e: Event, field: string, row: number, token: string): void {
    const input = this.querySelector<HTMLInputElement>(this.inputSelector(field));
    const s = this.suggest;
    if (!input || !s?.q) return;
    const caret = input.selectionStart ?? input.value.length;
    const r = insertToken(input.value, caret, s.q, token);
    input.value = r.text;
    this.suggest = null;
    input.focus();
    input.setSelectionRange(r.caret, r.caret);
    if (field === 'text') this.setText(row, r.text);
    else this.setThreshold(row, field.slice(3) as AlarmThresholdName, 'text', r.text);
  }

  // ---------- Vẽ ----------

  private tool(
    act: string,
    ic: Parameters<typeof icon>[0],
    label: string,
    reason: string | null,
    run: () => void,
  ) {
    const locked = reason === null ? null : t('reason.locked', { label, reason });
    return html`<button
      class="tbtn"
      type="button"
      data-act=${act}
      aria-disabled=${locked ? 'true' : nothing}
      title=${locked ?? label}
      @click=${() => (locked ? this.app.toast(locked) : run())}
    >
      ${icon(ic)}<span>${label}</span>
    </button>`;
  }

  private filterSelect(
    name: string,
    label: string,
    value: string,
    options: readonly { v: string; text: string }[],
    on: (v: string) => void,
  ) {
    return html`<label class="al-filter"
      ><span class="visually-hidden">${label}</span>
      <select
        class="select sm"
        data-role=${name}
        title=${label}
        @change=${(e: Event) => on((e.target as HTMLSelectElement).value)}
      >
        <option value="" ?selected=${value === ''}>${label}: ${t('alarm.grid.filter.all')}</option>
        ${options.map((o) => html`<option value=${o.v} ?selected=${o.v === value}>${o.text}</option>`)}
      </select></label
    >`;
  }

  private tools(adapter: AlarmGrid) {
    const app = this.app;
    const m = this.memo();
    const ro = this.readOnly();
    const grid = this.gridEl();
    const pos = grid?.currentPosition() ?? null;
    const roReason = ro ? t('reason.readOnly') : null;
    const delReason = roReason ?? (pos === null ? t('alarm.grid.noSelection') : null);
    const hasTags = (app.store.state.outline.tags?.tags.length ?? 0) > 0;
    const doc = adapter.doc;
    const shown = grid?.shownCount() ?? adapter.rowCount();
    const canTest = doc.alarms.length > 0 && app.store.state.outline.v05;
    const choosable = ALARM_COLS;
    return html`<div class="ed-tools al-tools" role="group" aria-label=${t('alarm.grid.tools')}>
      ${this.tool('add', 'plus', t('alarm.grid.add'), roReason, () => this.addRow())}
      ${this.tool('delete', 'x', t('alarm.grid.delete'), delReason, () => this.deleteRows())}
      ${this.tool('duplicate', 'paste', t('alarm.grid.duplicate'), delReason, () => this.duplicateRows())}
      <span class="tsep" aria-hidden="true"></span>
      ${this.tool('quick', 'bell', t('alarm.grid.quickCreate'), roReason ?? (hasTags ? null : t('reason.noTag')), () => app.openAlarmQuick())}
      ${this.tool('import', 'import', t('alarm.grid.importCsv'), roReason, () => void app.run('alarm.import'))}
      ${this.tool('export', 'export', t('alarm.grid.exportCsv'), null, () => void this.exportCsv())}
      <span class="tsep" aria-hidden="true"></span>
      ${this.tool('test', 'play', t('alarm.grid.test'), canTest ? null : t('reason.noAlarmsValid'), () => void app.run('alarm.test.open'))}
      <span class="grow"></span>
      ${this.filterSelect(
        'f-type',
        t('alarm.grid.filter.type'),
        m.type,
        (['digital', 'limit', 'quality'] as const).map((k) => ({
          v: t(`alarm.type.${k}`),
          text: t(`alarm.type.${k}`),
        })),
        (v) => {
          m.type = v;
          this.applyFilters();
        },
      )}
      ${this.filterSelect(
        'f-class',
        t('alarm.grid.filter.class'),
        m.cls,
        doc.classes.map((c) => ({ v: c.name, text: c.name })),
        (v) => {
          m.cls = v;
          this.applyFilters();
        },
      )}
      <label class="al-chk"
        ><input
          type="checkbox"
          data-role="f-errors"
          .checked=${m.errorsOnly}
          @change=${(e: Event) => this.setErrorsOnly((e.target as HTMLInputElement).checked)}
        />${t('alarm.grid.filter.errors')}</label
      >
      <label class="al-chk"
        ><input
          type="checkbox"
          data-role="f-unused"
          .checked=${m.unusedOnly}
          @change=${(e: Event) => {
            m.unusedOnly = (e.target as HTMLInputElement).checked;
            this.applyFilters();
          }}
        />${t('alarm.grid.filter.unused')}</label
      >
      <details class="tg-cols" data-role="cols">
        <summary class="tbtn">${t('alarm.grid.columns')}</summary>
        <div class="tg-cols-pop" role="group" aria-label=${t('alarm.grid.columnsTitle')}>
          ${choosable.map(
            (c) =>
              html`<label
                ><input
                  type="checkbox"
                  data-col=${c}
                  .checked=${!m.hidden.has(c)}
                  ?disabled=${c === 'id'}
                  @change=${(e: Event) => {
                    const next = new Set(m.hidden);
                    if ((e.target as HTMLInputElement).checked) next.delete(c);
                    else next.add(c);
                    m.hidden = next;
                    this.requestUpdate();
                  }}
                />${t(`alarm.grid.col.${c}`)}</label
              >`,
          )}
        </div>
      </details>
      <input
        class="input sm"
        type="search"
        data-role="filter"
        placeholder=${t('alarm.grid.find')}
        aria-label=${t('alarm.grid.find')}
        autocomplete="off"
        spellcheck="false"
        .value=${live(m.search)}
        @input=${(e: Event) => {
          m.search = (e.target as HTMLInputElement).value;
          this.applyFilters();
        }}
      />
      <span class="muted num tg-count" data-role="count" role="status"
        >${shown} / ${adapter.rowCount()}</span
      >
    </div>`;
  }

  private issueList() {
    const iss = this.issues();
    const all = [...iss.errors.entries(), ...iss.warns.entries()];
    if (!all.length && !iss.status.length) return nothing;
    return html`<div class="al-issues" data-role="issues">
      ${iss.status.map((i) => html`<span class="chip err" title=${i.code}>${t('alarm.grid.statusIssue', { text: issueText(i) })}</span>`)}
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const s = app.store.state;
    const m = this.memo();
    if (!s.outline.v05) return html`<mat-alarm-upgrade .app=${app}></mat-alarm-upgrade>`;
    const adapter = this.adapter();
    const ro = this.readOnly();
    const iss = this.issues();
    const errors =
      [...iss.errors.values()].reduce((n, l) => n + l.length, 0) +
      iss.status.filter((i) => i.code.startsWith('E_')).length;
    const warns =
      [...iss.warns.values()].reduce((n, l) => n + l.length, 0) +
      iss.status.filter((i) => i.code.startsWith('W_')).length;
    const title = app.editorTitle('alarms');
    const unsupported = app.online() && app.session.alarms.status() === 'unsupported';
    return html`<div class="ed ed-fill al-ed">
      <div class="ed-head">
        <h2>${title}</h2>
        <span class="path">${s.outline.alarmFile ?? 'alarms.json'}</span>
        <span class="grow"></span>
        <span class="help">${t('alarm.grid.help')}</span>
      </div>
      ${
        ro && s.readOnly
          ? html`<div class="banner warn" role="status">
              ${icon('warn', 'warn')}
              <div>${t('alarm.grid.readOnly')}</div>
            </div>`
          : nothing
      }
      ${
        unsupported
          ? html`<div class="banner info" role="status" data-role="unsupported">
              ${icon('warn', 'warn')}
              <div>${t('alarm.live.unsupported')}</div>
            </div>`
          : nothing
      }
      ${this.tools(adapter)}
      <div class="al-body">
        <div class="al-gridwrap${this.liveOn() ? ' online' : ''}">
          <mat-grid
            .adapter=${adapter}
            .state=${m.grid}
            .label=${title}
            .issues=${iss.errors}
            .warns=${iss.warns}
            .decimal=${defaultDecimal()}
            .ticks=${this.ticks}
            .showFilters=${false}
            @grid-state=${this.onGridState}
            @grid-edit=${this.onGridEdit}
            @grid-notice=${this.onGridNotice}
          ></mat-grid>
          ${
            adapter.rowCount() === 0
              ? html`<div class="empty" data-role="empty">
                  ${icon('bell', 'lg')}<b>${t('alarm.grid.empty')}</b>
                  <p>${t('alarm.grid.emptyHint')}</p>
                  <button
                    class="btn primary"
                    type="button"
                    data-act="empty-quick"
                    ?disabled=${ro}
                    @click=${() => app.openAlarmQuick()}
                  >
                    ${t('alarm.grid.quickCreate')}
                  </button>
                </div>`
              : nothing
          }
        </div>
        ${this.areaPanel()}
      </div>
      <div class="al-statusbar" data-role="statusbar" role="status">
        <span>${statusLine(adapter.doc, errors, warns)}</span>
        ${this.issueList()}
      </div>
    </div>`;
  }
}

customElements.define('mat-alarm-grid', AlarmGridEditor);

registerEditor({
  match: (id) => id === 'alarms',
  render: (app) => html`<mat-alarm-grid .app=${app}></mat-alarm-grid>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-alarm-grid': AlarmGridEditor;
  }
}
