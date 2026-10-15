// Editor Mẫu báo cáo (feature 010, US8, T133, FR-040…FR-044; contracts/studio-010.md §2). Mỗi mẫu một editor `report:<id>`:
// form chung (tên, id, nhóm lưu trữ chỉ có tổng hợp, kỳ, ca với nhãn ca hiện ngay, khổ giấy, tiêu đề, chân trang), lưới cột trên
// `mat-grid` dùng chung (gõ hoặc kéo Tag của nhóm; hàm chọn nhiều và mờ theo kiểu Tag; gợi ý đơn vị theo hàm), khung Xem trước bên
// phải với nguồn Dữ liệu mô phỏng hoặc Dữ liệu thiết bị và nút xuất thử bốn định dạng. Lỗi `E_RPT_*` hiện NGAY tại trường hoặc ô;
// lưu được khi còn lỗi. Trang `reports` liệt kê mẫu và thêm mẫu mới. Mọi chữ của người dùng đi qua binding của Lit (văn bản thuần).
import type { ReportFn, ReportPeriod, ReportsConfig, TagDataType } from '@mat/project-schema';
import type { HistorySource } from '@mat/ui-components';
import { SimHistorySource } from '@mat/tag-sim';
import { html, nothing, type PropertyValues } from 'lit';
import { live } from 'lit/directives/live.js';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import { initialGrid, type GridState } from '../../model/grid/index.ts';
import type { GridAdapter } from '../../model/grid/types.ts';
import { tagTypesOf } from '../../model/logging-doc.ts';
import {
  MAX_REPORTS,
  REPORT_FNS,
  addColumns,
  addReport,
  columnsAdapter,
  duplicateReport,
  eligibleGroups,
  eligibleTags,
  fnApplicable,
  fnLabel,
  removeColumns,
  removeReport,
  reportsEdit,
  setColumnField,
  setPaper,
  setPeriod,
  setReportField,
  setRowMinutes,
  setShifts,
  setTotals,
  shiftLabels,
  suggestUnit,
  toggleFunction,
  type RejectReason,
} from '../../model/reports-doc.ts';
import { bucketReportIssues, type ReportIssueBuckets } from '../../model/reports-issues.ts';
import { simHistoryGroups, tagInfoOf } from '../../model/sim-history-groups.ts';
import { parseNameList, suggestTags } from '../../model/watch-table.ts';
import { DeviceHistorySource } from '../../platform/device-history.ts';
import { AppElement, icon } from '../base.ts';
import '../grid/mat-grid.ts';
import type { MatGrid } from '../grid/mat-grid.ts';
import '../report-preview.ts';
import type { SaveResult } from '../report-preview.ts';
import { registerEditor } from '../registry.ts';
import './templates-editor.css';

const SHIFT_OPTIONS = [2, 3, 4, 6, 8, 12] as const;
const PERIODS: readonly ReportPeriod[] = ['day', 'shift', 'month'];

/** Ô chọn theo StudioApp và mẫu: giữ khi chuyển tab. */
const memory = new WeakMap<StudioApp, Map<string, GridState>>();
/** Nguồn xem trước chọn theo StudioApp (giữ khi chuyển tab). */
const sourceChoice = new WeakMap<StudioApp, 'sim' | 'device'>();
const deviceSources = new WeakMap<StudioApp, DeviceHistorySource>();

const messages = (
  m: ReadonlyMap<string, readonly { message: string }[]> | undefined,
): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const [k, v] of m ?? [])
    out.set(
      k,
      v.map((i) => i.message),
    );
  return out;
};

const REJECT: Readonly<Record<RejectReason, Parameters<typeof t>[0]>> = {
  dup: 'rpt.ed.rej.dup',
  notInGroup: 'rpt.ed.rej.notInGroup',
  noAgg: 'rpt.ed.rej.noAgg',
  limit: 'rpt.ed.rej.limit',
};

export class TemplatesEditor extends AppElement {
  static override properties = {
    reportId: { type: String },
    query: { state: true },
    hi: { state: true },
    open: { state: true },
    selCol: { state: true },
  };

  declare reportId: string;
  declare query: string;
  declare hi: number;
  declare open: boolean;
  declare selCol: number;

  private simCache: { key: unknown[]; src: SimHistorySource } | null = null;
  private adapterCache: { key: unknown[]; adapter: GridAdapter } | null = null;

  constructor() {
    super();
    this.reportId = '';
    this.query = '';
    this.hi = -1;
    this.open = false;
    this.selCol = 0;
  }

  // ---------- Dữ liệu ----------

  private cfg(): ReportsConfig | null {
    return this.app.store.state.outline.reports;
  }

  private index(): number {
    return this.cfg()?.reports.findIndex((r) => r.id === this.reportId) ?? -1;
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || !s.outline.format06;
  }

  private types(): Map<string, TagDataType> | null {
    const o = this.app.store.state.outline;
    return o.tags ? tagTypesOf(o.tags) : null;
  }

  private buckets(): ReportIssueBuckets {
    const s = this.app.store.state;
    return bucketReportIssues(s.issues, s.outline.reportsFile);
  }

  private simSource(): SimHistorySource {
    const o = this.app.store.state.outline;
    const key = [o.logging, o.tags];
    if (this.simCache && this.simCache.key.every((k, i) => k === key[i])) return this.simCache.src;
    const src = new SimHistorySource({
      groups: simHistoryGroups(o.logging, o.tags),
      now: () => Date.now(),
    });
    this.simCache = { key, src };
    return src;
  }

  private deviceSource(): DeviceHistorySource {
    let s = deviceSources.get(this.app);
    if (!s) {
      const app = this.app;
      s = new DeviceHistorySource({
        link: {
          get: (id, path, query) =>
            app.link ? app.link.get(id, path, query) : Promise.resolve({ error: 'no-such-device' }),
        },
        deviceId: () =>
          app.link && app.session.state === 'monitoring' ? app.session.deviceId : null,
        requestLogin: () => void app.run('online.login'),
      });
      deviceSources.set(app, s);
    }
    return s;
  }

  private source(): HistorySource {
    return (sourceChoice.get(this.app) ?? 'sim') === 'device'
      ? this.deviceSource()
      : this.simSource();
  }

  private adapter(i: number): GridAdapter | null {
    const cfg = this.cfg();
    if (!cfg || i < 0) return null;
    const o = this.app.store.state.outline;
    const ro = this.readOnly();
    const types = this.types();
    const key = [cfg, o.logging, types, ro, i];
    const c = this.adapterCache;
    if (c && c.key.length === key.length && c.key.every((k, j) => k === key[j])) return c.adapter;
    const adapter = columnsAdapter({ cfg, index: i, logging: o.logging, types, readOnly: ro });
    this.adapterCache = { key, adapter };
    return adapter;
  }

  private gridEl(): MatGrid | null {
    return this.querySelector<MatGrid>('[data-grid="columns"] mat-grid');
  }

  private gridState(): GridState {
    return memory.get(this.app)?.get(this.reportId) ?? initialGrid;
  }

  // ---------- Vòng đời ----------

  private readonly commitHook = (): void => this.gridEl()?.commitPending();

  protected override attached(): void {
    this.app.hooks.commitPending = this.commitHook;
    this.app.setCommandHandler('edit.fillDown', () => this.gridEl()?.fillDownSelection());
    this.requestUpdate();
  }

  protected override detached(): void {
    this.commitHook();
    this.app.setCommandHandler('edit.fillDown', null);
    if (this.app.hooks.commitPending === this.commitHook) this.app.hooks.commitPending = undefined;
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  private onGridState = (e: Event): void => {
    const state = (e as CustomEvent<{ state: GridState }>).detail.state;
    let m = memory.get(this.app);
    if (!m) memory.set(this.app, (m = new Map()));
    m.set(this.reportId, state);
    const row = this.gridEl()?.currentPosition();
    if (row !== null && row !== undefined && row !== this.selCol) this.selCol = row;
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

  // ---------- Sửa ----------

  private edit(next: ReportsConfig | null): void {
    if (next && next !== this.cfg()) this.app.store.edit([reportsEdit(next)]);
  }

  private guard(): ReportsConfig | null {
    const cfg = this.cfg();
    if (!cfg) return null;
    if (this.readOnly()) {
      this.app.toast(t('rpt.ed.readOnlyToast'));
      return null;
    }
    return cfg;
  }

  private text(field: 'id' | 'name' | 'group' | 'title' | 'footer') {
    return (e: Event): void => {
      const cfg = this.guard();
      const i = this.index();
      if (!cfg || i < 0) return;
      const v = (e.target as HTMLInputElement | HTMLSelectElement).value;
      const next = setReportField(cfg, i, field, field === 'id' ? v.trim() : v);
      this.edit(next);
      // Đổi id: editor chuyển theo id mới (tab giữ tên mẫu).
      if (field === 'id' && next !== cfg && v.trim() !== '') {
        this.app.closeTab(`report:${this.reportId}`);
        this.app.openEditor(`report:${v.trim()}`);
      }
    };
  }

  private addColumnsFor(names: readonly string[]): void {
    const cfg = this.guard();
    const i = this.index();
    if (!cfg || i < 0 || !names.length) return;
    const o = this.app.store.state.outline;
    const r = addColumns(cfg, i, names, o.logging, this.types());
    this.edit(r.cfg);
    if (r.rejected.length) {
      const first = r.rejected[0]!;
      this.app.toast(
        t(REJECT[first.reason], {
          tag: first.tagId,
          group: cfg.reports[i]!.group,
          n: r.rejected.length,
        }),
      );
    }
    this.query = '';
    this.open = false;
    this.hi = -1;
  }

  private suggestUnitCmd = (): void => {
    const cfg = this.guard();
    const i = this.index();
    if (!cfg || i < 0) return;
    const col = cfg.reports[i]!.columns[this.selCol];
    if (!col) return;
    const info = tagInfoOf(this.app.store.state.outline.tags)(col.tagId);
    const fn: ReportFn = col.functions.includes('sum') ? 'sum' : (col.functions[0] ?? 'avg');
    const unit = suggestUnit(fn, info?.unit, this.types()?.get(col.tagId));
    this.edit(setColumnField(cfg, i, this.selCol, 'unit', unit === '' ? undefined : unit));
  };

  private removeColumnsCmd = (): void => {
    const cfg = this.guard();
    const i = this.index();
    const rows = this.gridEl()?.selectedRows() ?? [];
    if (!cfg || i < 0 || !rows.length) return;
    this.edit(removeColumns(cfg, i, rows));
  };

  // ---------- Thêm Tag ----------

  private suggestions(): string[] {
    const cfg = this.cfg();
    const i = this.index();
    if (!cfg || i < 0 || !this.query.trim()) return [];
    const ids = eligibleTags(
      this.app.store.state.outline.logging,
      cfg.reports[i]!.group,
      this.types(),
    );
    return suggestTags(ids, this.query, 8);
  }

  private onAddKey = (e: KeyboardEvent): void => {
    const list = this.suggestions();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!list.length) return;
      e.preventDefault();
      this.open = true;
      this.hi =
        e.key === 'ArrowDown' ? Math.min(list.length - 1, this.hi + 1) : Math.max(0, this.hi - 1);
    } else if (e.key === 'Escape') {
      if (this.open) {
        e.preventDefault();
        e.stopPropagation();
        this.open = false;
        this.hi = -1;
      }
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const pick = this.hi >= 0 ? list[this.hi] : this.query.trim();
      if (pick) this.addColumnsFor([pick]);
    }
  };

  private onAddPaste = (e: ClipboardEvent): void => {
    const names = parseNameList(e.clipboardData?.getData('text/plain') ?? '');
    if (names.length > 1) {
      e.preventDefault();
      this.addColumnsFor(names);
    }
  };

  private onDragOver = (e: DragEvent): void => {
    if (e.dataTransfer?.types?.includes('application/x-mat-tag')) e.preventDefault();
  };

  private onDrop = (e: DragEvent): void => {
    const name = e.dataTransfer?.getData('application/x-mat-tag') ?? '';
    if (!name) return;
    e.preventDefault();
    this.addColumnsFor([name]);
  };

  // ---------- Vẽ ----------

  private err(b: ReportIssueBuckets, name: string) {
    const list = b.fields.get(this.index())?.get(name);
    if (!list?.length) return nothing;
    return html`<div class="te-err" data-error=${name} role="alert">
      ${list.map((x) => html`<div><span class="mono">${x.code}</span> ${x.message}</div>`)}
    </div>`;
  }

  private invalid(b: ReportIssueBuckets, name: string): 'true' | 'false' {
    return b.fields.get(this.index())?.get(name)?.length ? 'true' : 'false';
  }

  private save = async (
    name: string,
    bytes: Uint8Array,
    ext: 'csv' | 'xlsx' | 'pdf',
  ): Promise<SaveResult> => {
    const r = await this.app.platform.reportSave(name, bytes, ext);
    return r === null ? 'cancelled' : 'error' in r ? 'error' : 'saved';
  };

  private form(b: ReportIssueBuckets) {
    const cfg = this.cfg()!;
    const i = this.index();
    const r = cfg.reports[i]!;
    const ro = this.readOnly();
    const groups = eligibleGroups(this.app.store.state.outline.logging);
    const known = groups.some((g) => g.id === r.group);
    const fld = (
      label: string,
      name: string,
      control: unknown,
      o: { help?: string; cls?: string } = {},
    ) =>
      html`<div class="te-f ${o.cls ?? ''}">
        <label for=${`te-${name}`}>${label}</label>
        ${control} ${o.help ? html`<div class="te-help">${o.help}</div>` : nothing}
        ${this.err(b, name.split('.')[0]!)}
      </div>`;
    const text = (name: string, value: string, onChange: (e: Event) => void, mono = false) =>
      html`<input
        id=${`te-${name}`}
        class=${mono ? 'mono' : ''}
        type="text"
        data-field=${name}
        autocomplete="off"
        spellcheck="false"
        aria-invalid=${this.invalid(b, name.split('.')[0]!)}
        ?disabled=${ro}
        .value=${live(value)}
        @change=${onChange}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
        }}
      />`;
    const sel = (
      name: string,
      value: string,
      options: ReadonlyArray<[string, string]>,
      onChange: (e: Event) => void,
    ) =>
      html`<select
        id=${`te-${name}`}
        data-field=${name}
        aria-invalid=${this.invalid(b, name.split('.')[0]!)}
        ?disabled=${ro}
        @change=${onChange}
      >
        ${options.map(([v, l]) => html`<option value=${v} ?selected=${v === value}>${l}</option>`)}
      </select>`;
    const labels =
      r.period === 'shift' && r.shifts ? shiftLabels(r.shifts.count, r.shifts.start) : [];
    return html`<section class="te-sec" aria-label=${t('rpt.ed.general')}>
      <h3>${t('rpt.ed.general')}</h3>
      <div class="te-form">
        ${fld(t('rpt.ed.name'), 'name', text('name', r.name, this.text('name')))}
        ${fld(t('rpt.ed.id'), 'id', text('id', r.id, this.text('id'), true))}
        ${
          groups.length === 0
            ? html`<div class="te-f te-wide" data-role="no-group">
                <label>${t('rpt.ed.group')}</label>
                <p class="te-help">${t('rpt.ed.noGroup')}</p>
                <button class="btn sm" type="button" @click=${() => this.app.openEditor('logging')}>
                  ${t('rpt.ed.openLogging')}
                </button>
                ${this.err(b, 'group')}
              </div>`
            : fld(
                t('rpt.ed.group'),
                'group',
                sel(
                  'group',
                  r.group,
                  [
                    ...(known || r.group === ''
                      ? []
                      : ([[r.group, t('rpt.ed.groupUnknown', { id: r.group })]] as Array<
                          [string, string]
                        >)),
                    ...groups.map((g): [string, string] => [g.id, `${g.name} (${g.id})`]),
                  ],
                  this.text('group'),
                ),
                { help: t('rpt.ed.groupHelp') },
              )
        }
        ${fld(
          t('rpt.ed.period'),
          'period',
          sel(
            'period',
            r.period,
            PERIODS.map((p): [string, string] => [p, t(`rpt.period.${p}`)]),
            (e) => {
              const cfg2 = this.guard();
              if (cfg2)
                this.edit(
                  setPeriod(cfg2, i, (e.target as HTMLSelectElement).value as ReportPeriod),
                );
            },
          ),
        )}
        ${
          r.period === 'day'
            ? fld(
                t('rpt.ed.rowMinutes'),
                'rowMinutes',
                sel(
                  'rowMinutes',
                  String(r.rowMinutes ?? 60),
                  [
                    ['15', '15'],
                    ['30', '30'],
                    ['60', '60'],
                  ],
                  (e) => {
                    const cfg2 = this.guard();
                    if (cfg2)
                      this.edit(
                        setRowMinutes(
                          cfg2,
                          i,
                          Number((e.target as HTMLSelectElement).value) as 15 | 30 | 60,
                        ),
                      );
                  },
                ),
              )
            : nothing
        }
        ${
          r.period === 'shift'
            ? html`${fld(
                  t('rpt.ed.shiftCount'),
                  'shifts.count',
                  sel(
                    'shifts.count',
                    String(r.shifts?.count ?? 3),
                    [
                      ...(r.shifts && !(SHIFT_OPTIONS as readonly number[]).includes(r.shifts.count)
                        ? ([
                            [
                              String(r.shifts.count),
                              t('rpt.ed.shiftInvalid', { n: r.shifts.count }),
                            ],
                          ] as Array<[string, string]>)
                        : []),
                      ...SHIFT_OPTIONS.map((n): [string, string] => [String(n), String(n)]),
                    ],
                    (e) => {
                      const cfg2 = this.guard();
                      if (cfg2)
                        this.edit(
                          setShifts(cfg2, i, {
                            count: Number((e.target as HTMLSelectElement).value),
                          }),
                        );
                    },
                  ),
                  { help: t('rpt.ed.shiftCountHelp') },
                )}
                ${fld(
                  t('rpt.ed.shiftStart'),
                  'shifts.start',
                  text(
                    'shifts.start',
                    r.shifts?.start ?? '',
                    (e) => {
                      const cfg2 = this.guard();
                      if (cfg2)
                        this.edit(
                          setShifts(cfg2, i, {
                            start: (e.target as HTMLInputElement).value.trim(),
                          }),
                        );
                    },
                    true,
                  ),
                  { help: t('rpt.ed.shiftStartHelp') },
                )}
                <div class="te-f te-wide">
                  <ul
                    class="te-shifts"
                    data-role="shift-labels"
                    aria-label=${t('rpt.ed.shiftLabels')}
                  >
                    ${labels.map((l) => html`<li>${l}</li>`)}
                  </ul>
                </div>`
            : nothing
        }
        ${fld(
          t('rpt.ed.paperSize'),
          'paper.size',
          sel(
            'paper.size',
            r.paper?.size ?? 'A4',
            [
              ['A4', 'A4'],
              ['A3', 'A3'],
            ],
            (e) => {
              const cfg2 = this.guard();
              if (cfg2)
                this.edit(
                  setPaper(cfg2, i, { size: (e.target as HTMLSelectElement).value as 'A4' | 'A3' }),
                );
            },
          ),
        )}
        ${fld(
          t('rpt.ed.orientation'),
          'paper.orientation',
          sel(
            'paper.orientation',
            r.paper?.orientation ?? 'portrait',
            [
              ['portrait', t('rpt.ed.portrait')],
              ['landscape', t('rpt.ed.landscape')],
            ],
            (e) => {
              const cfg2 = this.guard();
              if (cfg2)
                this.edit(
                  setPaper(cfg2, i, {
                    orientation: (e.target as HTMLSelectElement).value as 'portrait' | 'landscape',
                  }),
                );
            },
          ),
        )}
        ${fld(t('rpt.ed.title'), 'title', text('title', r.title ?? '', this.text('title')), { cls: 'te-wide' })}
        ${fld(t('rpt.ed.footer'), 'footer', text('footer', r.footer ?? '', this.text('footer')), { cls: 'te-wide' })}
        <div class="te-f">
          <label class="te-chk">
            <input
              type="checkbox"
              data-field="totals"
              ?disabled=${ro}
              .checked=${r.totals !== false}
              @click=${(e: Event) => {
                const cfg2 = this.guard();
                if (cfg2) this.edit(setTotals(cfg2, i, (e.target as HTMLInputElement).checked));
              }}
            />
            <span>${t('rpt.ed.totals')}</span>
          </label>
        </div>
      </div>
    </section>`;
  }

  private fnBoxes() {
    const cfg = this.cfg()!;
    const i = this.index();
    const col = cfg.reports[i]!.columns[this.selCol];
    if (!col) return html`<p class="te-help">${t('rpt.ed.pickColumn')}</p>`;
    const type = this.types()?.get(col.tagId);
    const ro = this.readOnly();
    return html`<fieldset class="te-fns" data-role="fns">
      <legend>${t('rpt.ed.fnsOf', { tag: col.tagId })}</legend>
      ${REPORT_FNS.map((fn) => {
        const ok = fnApplicable(type, fn);
        return html`<label
          class="te-chk ${ok ? '' : 'na'}"
          title=${ok ? nothing : t('rpt.ed.fnNa')}
        >
          <input
            type="checkbox"
            data-fn=${fn}
            ?disabled=${ro || !ok}
            .checked=${col.functions.includes(fn)}
            @click=${() => {
              const c2 = this.guard();
              if (c2) this.edit(toggleFunction(c2, i, this.selCol, fn));
            }}
          />
          <span>${fnLabel(fn)}</span>
        </label>`;
      })}
      <button
        class="btn sm"
        type="button"
        data-act="suggest-unit"
        ?disabled=${ro}
        @click=${this.suggestUnitCmd}
      >
        ${t('rpt.ed.suggestUnit')}
      </button>
    </fieldset>`;
  }

  private addBox(ro: boolean) {
    const list = this.suggestions();
    const open = this.open && list.length > 0;
    return html`<div class="te-add">
      <input
        class="input sm mono"
        type="text"
        data-role="add-tag"
        role="combobox"
        aria-label=${t('rpt.ed.addTag')}
        aria-expanded=${open ? 'true' : 'false'}
        aria-controls="te-suggest"
        aria-autocomplete="list"
        aria-activedescendant=${open && this.hi >= 0 ? `te-opt-${this.hi}` : nothing}
        placeholder=${t('rpt.ed.addTagPlaceholder')}
        autocomplete="off"
        spellcheck="false"
        ?disabled=${ro}
        .value=${live(this.query)}
        @input=${(e: Event) => {
          this.query = (e.target as HTMLInputElement).value;
          this.open = true;
          this.hi = -1;
        }}
        @keydown=${this.onAddKey}
        @paste=${this.onAddPaste}
        @blur=${() => setTimeout(() => (this.open = false), 120)}
      />
      ${
        open
          ? html`<ul
              id="te-suggest"
              class="te-suggest"
              role="listbox"
              aria-label=${t('rpt.ed.suggest')}
            >
              ${list.map(
                (id, i) =>
                  html`<li
                    id="te-opt-${i}"
                    role="option"
                    class=${i === this.hi ? 'hi' : ''}
                    aria-selected=${i === this.hi ? 'true' : 'false'}
                    @mousedown=${(e: Event) => {
                      e.preventDefault();
                      this.addColumnsFor([id]);
                    }}
                  >
                    ${id}
                  </li>`,
              )}
            </ul>`
          : nothing
      }
    </div>`;
  }

  protected override render() {
    const s = this.app.store.state;
    if (!s.project) return nothing;
    const cfg = this.cfg();
    const i = this.index();
    if (!cfg || i < 0)
      return html`<div class="ed ed-fill te">
        <div class="empty">${icon('report', 'lg')}<b>${t('rpt.ed.notFound')}</b></div>
      </div>`;
    const r = cfg.reports[i]!;
    const ro = this.readOnly();
    const b = this.buckets();
    const a = this.adapter(i)!;
    const choice = sourceChoice.get(this.app) ?? 'sim';
    const cellIssues = b.cells.get(i);
    return html`<div class="ed ed-fill te">
      <div class="ed-head">
        <h2>${r.name}</h2>
        <span class="path">${s.outline.reportsFile}</span>
        <span class="grow"></span>
        ${b.hasErrors ? html`<span class="chip err" role="status">${t('rpt.ed.hasErrors')}</span>` : nothing}
        <button
          class="tbtn"
          type="button"
          data-act="dup-report"
          aria-disabled=${ro || cfg.reports.length >= MAX_REPORTS ? 'true' : nothing}
          @click=${() => {
            const c = this.guard();
            if (!c) return;
            const next = duplicateReport(c, i);
            this.edit(next);
            this.app.openEditor(`report:${next.reports[i + 1]!.id}`);
          }}
        >
          ${icon('paste')}<span>${t('rpt.ed.dup')}</span>
        </button>
        <button
          class="tbtn"
          type="button"
          data-act="del-report"
          aria-disabled=${ro ? 'true' : nothing}
          @click=${() => {
            const c = this.guard();
            if (!c) return;
            this.app.closeTab(`report:${this.reportId}`);
            this.edit(removeReport(c, i));
            this.app.openEditor('reports');
          }}
        >
          ${icon('x')}<span>${t('rpt.ed.del')}</span>
        </button>
      </div>
      <div class="te-body">
        <div class="te-main">
          ${this.form(b)}
          <section class="te-sec" aria-label=${t('rpt.ed.columns')}>
            <div class="te-sech">
              <h3>${t('rpt.ed.columns')}</h3>
              <span class="grow"></span>
              ${this.addBox(ro)}
              <button
                class="tbtn"
                type="button"
                data-act="del-columns"
                aria-disabled=${ro ? 'true' : nothing}
                @click=${this.removeColumnsCmd}
              >
                ${icon('x')}<span>${t('rpt.ed.delColumns')}</span>
              </button>
              <span class="muted num" role="status"
                >${t('rpt.ed.columnCount', { n: r.columns.length, max: 24 })}</span
              >
            </div>
            ${this.err(b, 'columns')}
            <div
              class="te-gridbox"
              data-grid="columns"
              @dragover=${this.onDragOver}
              @drop=${this.onDrop}
            >
              <mat-grid
                .adapter=${a}
                .state=${this.gridState()}
                .label=${t('rpt.ed.columns')}
                .issues=${messages(cellIssues)}
                .dragColumn=${'tag'}
                @grid-state=${this.onGridState}
                @grid-edit=${this.onGridEdit}
                @grid-notice=${this.onGridNotice}
              ></mat-grid>
              ${
                r.columns.length === 0
                  ? html`<div class="empty te-empty">
                      ${icon('table', 'lg')}<b>${t('rpt.ed.noColumns')}</b>
                      <p>${t('rpt.ed.noColumnsHelp')}</p>
                    </div>`
                  : nothing
              }
            </div>
            ${this.fnBoxes()}
          </section>
        </div>
        <aside class="te-side" role="region" tabindex="0" aria-label=${t('rpt.pv.title')}>
          <div class="te-source">
            <label for="te-source">${t('rpt.ed.source')}</label>
            <select
              id="te-source"
              data-field="source"
              @change=${(e: Event) => {
                sourceChoice.set(
                  this.app,
                  (e.target as HTMLSelectElement).value === 'device' ? 'device' : 'sim',
                );
                this.requestUpdate();
              }}
            >
              <option value="sim" ?selected=${choice === 'sim'}>${t('rpt.ed.source.sim')}</option>
              <option value="device" ?selected=${choice === 'device'}>
                ${t('rpt.ed.source.device')}
              </option>
            </select>
          </div>
          <mat-report-preview
            .template=${r}
            .source=${this.source()}
            .tagInfo=${tagInfoOf(s.outline.tags)}
            .userName=${this.app.session.auth?.user ?? ''}
            .save=${this.save}
          ></mat-report-preview>
        </aside>
      </div>
    </div>`;
  }
}

customElements.define('mat-templates-editor', TemplatesEditor);

/** Trang danh sách mẫu (mục Báo cáo của cây): mở, thêm, nhân bản mẫu. */
export class ReportsList extends AppElement {
  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  private add = (): void => {
    const s = this.app.store.state;
    if (s.readOnly || !s.outline.format06) return void this.app.toast(t('rpt.ed.readOnlyToast'));
    const cur = s.outline.reports;
    if ((cur?.reports.length ?? 0) >= MAX_REPORTS)
      return void this.app.toast(t('rpt.ed.maxReports', { n: MAX_REPORTS }));
    const next = addReport(cur, s.outline.logging);
    this.app.store.edit([reportsEdit(next)]);
    this.app.openEditor(`report:${next.reports[next.reports.length - 1]!.id}`);
  };

  protected override render() {
    const s = this.app.store.state;
    if (!s.project) return nothing;
    const list = s.outline.reports?.reports ?? [];
    const groups = eligibleGroups(s.outline.logging);
    const b = bucketReportIssues(s.issues, s.outline.reportsFile);
    return html`<div class="ed ed-fill te">
      <div class="ed-head">
        <h2>${t('tree.reports')}</h2>
        <span class="path">${s.outline.reportsFile ?? 'reports.json'}</span>
        <span class="grow"></span>
        <button class="tbtn" type="button" data-act="add-report" @click=${this.add}>
          ${icon('plus')}<span>${t('rpt.ed.add')}</span>
        </button>
      </div>
      <div class="te-list">
        ${groups.length === 0 ? html`<p class="banner warn" role="status">${icon('warn', 'warn')}<span>${t('rpt.ed.noGroup')}</span></p>` : nothing}
        ${
          list.length === 0
            ? html`<div class="empty">
                ${icon('report', 'lg')}<b>${t('rpt.ed.list.none')}</b>
                <p>${t('rpt.ed.list.noneHelp')}</p>
              </div>`
            : html`<table class="te-table">
                <caption class="te-sr">
                  ${t('tree.reports')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">${t('rpt.ed.name')}</th>
                    <th scope="col">${t('rpt.ed.group')}</th>
                    <th scope="col">${t('rpt.ed.period')}</th>
                    <th scope="col" class="num">${t('rpt.ed.columns')}</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  ${list.map(
                    (r, i) =>
                      html`<tr data-report=${r.id}>
                        <th scope="row">
                          <button
                            class="link"
                            type="button"
                            @click=${() => this.app.openEditor(`report:${r.id}`)}
                          >
                            ${r.name}
                          </button>
                        </th>
                        <td class="mono">${r.group}</td>
                        <td>${t(`rpt.period.${r.period}`)}</td>
                        <td class="num">${r.columns.length}</td>
                        <td>
                          ${b.fields.get(i) || b.cells.get(i) ? html`<span class="chip err">${t('rpt.ed.hasErrors')}</span>` : nothing}
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>`
        }
      </div>
    </div>`;
  }
}

customElements.define('mat-reports-list', ReportsList);

registerEditor({
  match: (id) => id.startsWith('report:'),
  render: (app, id) =>
    html`<mat-templates-editor
      .app=${app}
      .reportId=${id.slice('report:'.length)}
    ></mat-templates-editor>`,
});

registerEditor({
  match: (id) => id === 'reports',
  render: (app) => html`<mat-reports-list .app=${app}></mat-reports-list>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-templates-editor': TemplatesEditor;
    'mat-reports-list': ReportsList;
  }
}
