// Trình thiết kế báo cáo (feature 010 US8; feature 015 US2, FR-007; docs/architecture/studio-ux.md: editor kiểu IDE). Mỗi mẫu một
// editor `report:<id>` ba vùng:
//  - Cấu trúc (trái): Thông tin chung, Kỳ và nhóm hàng, Thẻ tổng hợp, Biểu đồ, Cột (mỗi cột một mục, thêm cột theo Tag), Trang in.
//    Mục có lỗi `E_RPT_*` có dấu đỏ và số lỗi.
//  - Xem trước trực tiếp (giữa): `<mat-report-preview>` dựng bằng CÙNG mã với trang Báo cáo của runtime (runReport +
//    `<mat-report-view>`) trên dữ liệu mô phỏng (hoặc thiết bị); bấm vào phần của báo cáo (dải tiêu đề, thẻ, biểu đồ, tiêu đề cột)
//    để chọn phần đó; kéo Tag từ panel Tag thả vào đây hay vào Cấu trúc để thêm cột.
//  - Thuộc tính (phải): trường của phần đang chọn; lỗi hiện ngay tại trường (và ở dock Lỗi).
// Mỗi thay đổi là MỘT sửa đổi `{ kind: 'reports' }` (một bước hoàn tác của Studio). Tùy chọn của định dạng 1.1 (loại báo cáo, kỳ
// tuần/khoảng, thẻ, biểu đồ, thời gian ON) bị khóa kèm lý do ở project cũ. Trang `reports` là thư viện mẫu có sẵn (lệnh
// "Thêm báo cáo…"). Mọi chữ của người dùng đi qua binding của Lit (văn bản thuần).
import type {
  ReportChartKind,
  ReportFn,
  ReportKind,
  ReportPeriod,
  ReportTemplate,
  ReportsConfig,
  TagDataType,
} from '@mat/project-schema';
import type { HistorySource } from '@mat/ui-components';
import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { StudioApp } from '../../app/app.ts';
import { deviceHistoryFor, simHistoryFor } from '../../app/history-sources.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { tagTypesOf } from '../../model/logging-doc.ts';
import {
  MAX_COLUMNS,
  MAX_REPORTS,
  addColumns,
  addTemplate,
  duplicateReport,
  eligibleGroups,
  eligibleTags,
  fnApplicable,
  fnLabel,
  fnsFor,
  moveColumn,
  removeColumns,
  removeReport,
  reportsEdit,
  setChart,
  setColumnField,
  setKind,
  setOrg,
  setLogo,
  setPaper,
  setPeriod,
  setReportField,
  setRowMinutes,
  setShifts,
  setTiles,
  setTotals,
  shiftLabels,
  suggestUnit,
  toggleFunction,
  type RejectReason,
  SCHEMA_VERSION,
} from '../../model/reports-doc.ts';
import { bucketReportIssues, type ReportIssueBuckets } from '../../model/reports-issues.ts';
import {
  REPORT_PRESETS,
  presetBlocked,
  presetTemplate,
  type PresetId,
} from '../../model/report-presets.ts';
import { simReportEvents } from '../../model/sim-report-events.ts';
import { tagInfoOf } from '../../model/sim-history-groups.ts';
import { suggestTags } from '../../model/watch-table.ts';
import type { IconName } from '../../icons/icons.ts';
import { AppElement, icon } from '../base.ts';
import '../report-preview.ts';
import { projectTheme, type SaveResult } from '../report-preview.ts';
import { registerEditor } from '../registry.ts';
import './templates-editor.css';

const SHIFT_OPTIONS = [2, 3, 4, 6, 8, 12] as const;
const PERIODS: readonly ReportPeriod[] = ['day', 'shift', 'week', 'month', 'range'];
const PERIODS_11: ReadonlySet<ReportPeriod> = new Set(['week', 'range']);
const KINDS: readonly ReportKind[] = ['table', 'equipment', 'alarm', 'logic'];
const CHARTS: ReadonlyArray<ReportChartKind | 'auto'> = ['auto', 'line', 'bar', 'none'];

/** Phần đang chọn theo StudioApp và mẫu: giữ khi chuyển tab. */
const selection = new WeakMap<StudioApp, Map<string, string>>();
/** Nguồn xem trước chọn theo StudioApp (giữ khi chuyển tab). */
const sourceChoice = new WeakMap<StudioApp, 'sim' | 'device'>();
const eventSources = new WeakMap<
  StudioApp,
  { key: unknown[]; src: ReturnType<typeof simReportEvents> }
>();

const REJECT: Readonly<Record<RejectReason, MessageKey>> = {
  dup: 'rpt.ed.rej.dup',
  notInGroup: 'rpt.ed.rej.notInGroup',
  noAgg: 'rpt.ed.rej.noAgg',
  limit: 'rpt.ed.rej.limit',
  notBool: 'rpt.ed.rej.notBool',
  noColumns: 'rpt.ed.rej.noColumns',
};

/** Nguồn sự kiện mô phỏng theo alarms.json, alarm-classes.json, logic.json hiện tại. */
function simEventsFor(app: StudioApp) {
  const o = app.store.state.outline;
  const key = [o.alarms, o.alarmClasses, o.logic];
  const cur = eventSources.get(app);
  if (cur && cur.key.every((k, i) => k === key[i])) return cur.src;
  const src = simReportEvents({ alarms: o.alarms, alarmClasses: o.alarmClasses, logic: o.logic });
  eventSources.set(app, { key, src });
  return src;
}

export class TemplatesEditor extends AppElement {
  static override properties = {
    reportId: { type: String },
    query: { state: true },
    hi: { state: true },
    open: { state: true },
    dropping: { state: true },
  };

  declare reportId: string;
  declare query: string;
  declare hi: number;
  declare open: boolean;
  declare dropping: boolean;

  constructor() {
    super();
    this.reportId = '';
    this.query = '';
    this.hi = -1;
    this.open = false;
    this.dropping = false;
  }

  // ---------- Dữ liệu ----------

  private cfg(): ReportsConfig | null {
    return this.app.store.state.outline.reports;
  }

  private index(): number {
    return this.cfg()?.reports.findIndex((r) => r.id === this.reportId) ?? -1;
  }

  private tpl(): ReportTemplate | null {
    return this.cfg()?.reports[this.index()] ?? null;
  }

  private readOnly(): boolean {
    const s = this.app.store.state;
    return s.readOnly || !s.outline.format06;
  }

  private format11(): boolean {
    return this.app.store.state.outline.format11;
  }

  private types(): Map<string, TagDataType> | null {
    const o = this.app.store.state.outline;
    return o.tags ? tagTypesOf(o.tags) : null;
  }

  private buckets(): ReportIssueBuckets {
    const s = this.app.store.state;
    return bucketReportIssues(s.issues, s.outline.reportsFile);
  }

  private source(): HistorySource {
    return (sourceChoice.get(this.app) ?? 'sim') === 'device'
      ? deviceHistoryFor(this.app)
      : simHistoryFor(this.app);
  }

  private org(): string {
    const p = this.app.store.state.outline.project as { projectName?: unknown } | null;
    return this.cfg()?.org ?? (typeof p?.projectName === 'string' ? p.projectName : '');
  }

  /** Phần đang chọn: `general`, `period`, `tiles`, `chart`, `page`, `col:<i>`. */
  private get sel(): string {
    return selection.get(this.app)?.get(this.reportId) ?? 'general';
  }

  private select(part: string): void {
    let m = selection.get(this.app);
    if (!m) selection.set(this.app, (m = new Map()));
    m.set(this.reportId, part);
    this.requestUpdate();
  }

  // ---------- Vòng đời ----------

  protected override attached(): void {
    this.requestUpdate();
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

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

  /** Áp một phép sửa trên mẫu đang mở. */
  private apply(fn: (cfg: ReportsConfig, i: number) => ReportsConfig): void {
    const cfg = this.guard();
    const i = this.index();
    if (cfg && i >= 0) this.edit(fn(cfg, i));
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
    const r = addColumns(cfg, i, names, o.logging, this.types(), this.format11());
    this.edit(r.cfg);
    if (r.rejected.length) {
      const first = r.rejected[0]!;
      this.app.toast(
        t(REJECT[first.reason], {
          tag: first.tagId,
          group: cfg.reports[i]!.group ?? '',
          n: r.rejected.length,
        }),
      );
    } else this.select(`col:${(r.cfg.reports[i]!.columns ?? []).length - 1}`);
    this.query = '';
    this.open = false;
    this.hi = -1;
  }

  // ---------- Thêm Tag: gõ, chọn gợi ý, kéo thả ----------

  private suggestions(): string[] {
    const r = this.tpl();
    if (!r || !this.query.trim()) return [];
    const types = this.types();
    const ids = eligibleTags(this.app.store.state.outline.logging, r.group ?? '', types).filter(
      (id) => r.kind !== 'equipment' || types?.get(id) === 'BOOL',
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

  private onDragOver = (e: DragEvent): void => {
    if (!e.dataTransfer?.types?.includes('application/x-mat-tag')) return;
    e.preventDefault();
    this.dropping = true;
  };

  private onDragLeave = (): void => {
    this.dropping = false;
  };

  private onDrop = (e: DragEvent): void => {
    this.dropping = false;
    const name = e.dataTransfer?.getData('application/x-mat-tag') ?? '';
    if (!name) return;
    e.preventDefault();
    this.addColumnsFor([name]);
  };

  /** Bấm vào phần của báo cáo ở xem trước: chọn phần tương ứng (cột theo Tag). */
  private onPreviewSelect = (e: Event): void => {
    const part = (e as CustomEvent<{ part: string }>).detail.part;
    if (part.startsWith('col:')) {
      // khóa cột ra là `<tagId>.<hàm>` (Tag có thể có dấu chấm: tách ở dấu chấm cuối)
      const key = part.slice(4);
      const dot = key.lastIndexOf('.');
      const tag = key.slice(0, dot);
      const fn = key.slice(dot + 1);
      const k = (this.tpl()?.columns ?? []).findIndex(
        (c) => c.tagId === tag && c.functions.includes(fn as ReportFn),
      );
      if (k >= 0) this.select(`col:${k}`);
    } else this.select(part);
  };

  private save = async (
    name: string,
    bytes: Uint8Array,
    ext: 'csv' | 'xlsx' | 'pdf',
  ): Promise<SaveResult> => {
    const r = await this.app.platform.reportSave(name, bytes, ext);
    return r === null ? 'cancelled' : 'error' in r ? 'error' : 'saved';
  };

  // ---------- Vẽ: các mẩu dùng chung ----------

  /** Tệp ảnh của project dùng được làm logo (graphics/*.svg, PNG Studio biết). */
  private logoFiles(): string[] {
    return this.app.svgFiles().filter((f) => /^graphics\/[^/]+\.(svg|png)$/i.test(f));
  }

  /** Lỗi E_RPT_LOGO (mức file, `/logo`) hiện ngay dưới trường. */
  private logoErrs(b: ReportIssueBuckets) {
    const list = b.file.filter((x) => x.path === '/logo');
    if (!list.length) return nothing;
    return html`<div class="te-err" data-error="logo" role="alert">
      ${list.map((x) => html`<div><span class="mono">${x.code}</span> ${x.message}</div>`)}
    </div>`;
  }

  /** Data URL của logo SVG cho xem trước (đọc một lần theo đường dẫn); rỗng khi không đọc được. */
  private logoCache = new Map<string, string>();
  private logoUrl(): string {
    const rel = this.cfg()?.logo;
    if (!rel || !rel.toLowerCase().endsWith('.svg')) return '';
    const hit = this.logoCache.get(rel);
    if (hit !== undefined) return hit;
    this.logoCache.set(rel, '');
    void this.app.platform.read(rel).then((r) => {
      if (!('text' in r)) return;
      this.logoCache.set(rel, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.text)}`);
      this.requestUpdate();
    });
    return '';
  }

  private errs(b: ReportIssueBuckets, name: string) {
    const list = b.fields.get(this.index())?.get(name);
    if (!list?.length) return nothing;
    return html`<div class="te-err" data-error=${name} role="alert">
      ${list.map((x) => html`<div><span class="mono">${x.code}</span> ${x.message}</div>`)}
    </div>`;
  }

  private cellErrs(b: ReportIssueBuckets, col: number) {
    const m = b.cells.get(this.index());
    const list = [...(m ?? [])].filter(([k]) => k.startsWith(`${col}:`)).flatMap(([, v]) => v);
    if (!list.length) return nothing;
    return html`<div class="te-err" data-error=${`col-${col}`} role="alert">
      ${list.map((x) => html`<div><span class="mono">${x.code}</span> ${x.message}</div>`)}
    </div>`;
  }

  private invalid(b: ReportIssueBuckets, name: string): 'true' | 'false' {
    return b.fields.get(this.index())?.get(name)?.length ? 'true' : 'false';
  }

  private field(label: string, name: string, control: unknown, help?: string, err?: unknown) {
    return html`<div class="rd-f">
      <label for=${`te-${name}`}>${label}</label>
      ${control} ${help ? html`<div class="te-help">${help}</div>` : nothing} ${err ?? nothing}
    </div>`;
  }

  private input(
    name: string,
    value: string,
    onChange: (e: Event) => void,
    b: ReportIssueBuckets,
    o: { mono?: boolean; errKey?: string; disabled?: boolean; list?: string } = {},
  ) {
    return html`<input
      id=${`te-${name}`}
      list=${o.list ?? nothing}
      class=${o.mono ? 'mono' : ''}
      type="text"
      data-field=${name}
      autocomplete="off"
      spellcheck="false"
      aria-invalid=${this.invalid(b, o.errKey ?? name.split('.')[0]!)}
      ?disabled=${this.readOnly() || o.disabled}
      .value=${live(value)}
      @change=${onChange}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
      }}
    />`;
  }

  private select_(
    name: string,
    value: string,
    options: ReadonlyArray<[string, string, boolean?]>,
    onChange: (e: Event) => void,
    b: ReportIssueBuckets,
  ) {
    return html`<select
      id=${`te-${name}`}
      data-field=${name}
      aria-invalid=${this.invalid(b, name.split('.')[0]!)}
      ?disabled=${this.readOnly()}
      @change=${onChange}
    >
      ${options.map(
        ([v, l, off]) =>
          html`<option value=${v} ?selected=${v === value} ?disabled=${off}>${l}</option>`,
      )}
    </select>`;
  }

  // ---------- Cấu trúc ----------

  private outlineItem(
    part: string,
    label: string,
    ico: IconName,
    o: { meta?: unknown; err?: number; sub?: boolean } = {},
  ) {
    const cur = this.sel === part;
    return html`<li>
      <button
        type="button"
        class="rd-node ${cur ? 'cur' : ''} ${o.sub ? 'sub' : ''}"
        data-node=${part}
        aria-current=${cur ? 'true' : nothing}
        @click=${() => this.select(part)}
      >
        ${icon(ico, 'sm')}<span class="lbl">${label}</span>
        ${o.meta ?? nothing}
        ${
          o.err
            ? html`<span class="rd-bad" title=${t('rpt.ds.errors', { n: o.err })}
                >${icon('err', 'sm')}<span class="te-sr"
                  >${t('rpt.ds.errors', { n: o.err })}</span
                ></span
              >`
            : nothing
        }
      </button>
    </li>`;
  }

  private outline(r: ReportTemplate, b: ReportIssueBuckets) {
    const f = b.fields.get(this.index());
    const n = (...keys: string[]) => keys.reduce((s, k) => s + (f?.get(k)?.length ?? 0), 0);
    const cells = b.cells.get(this.index());
    const colErr = (k: number) =>
      [...(cells ?? [])]
        .filter(([key]) => key.startsWith(`${k}:`))
        .reduce((s, [, v]) => s + v.length, 0);
    const kind = r.kind ?? 'table';
    const events = kind === 'alarm' || kind === 'logic';
    const cols = r.columns ?? [];
    const onOff = (on: boolean) =>
      html`<span class="rd-pill ${on ? 'on' : ''}">${on ? t('rpt.ds.on') : t('rpt.ds.off')}</span>`;
    const chart = r.chart ?? 'auto';
    return html`<nav
      class="rd-outline"
      aria-label=${t('rpt.ds.outline')}
      @dragover=${this.onDragOver}
      @dragleave=${this.onDragLeave}
      @drop=${this.onDrop}
    >
      <div class="rd-pane-h">${t('rpt.ds.outline')}</div>
      <ul class="rd-tree">
        ${this.outlineItem('general', t('rpt.ds.node.general'), 'report', {
          err: n('id', 'name', 'group', 'kind', 'self'),
          meta: html`<span class="rd-meta">${t(`rpt.kind.${kind}` as MessageKey)}</span>`,
        })}
        ${this.outlineItem('period', t('rpt.ds.node.period'), 'cal', {
          err: n('period', 'shifts', 'rowMinutes'),
          meta: html`<span class="rd-meta">${t(`rpt.period.${r.period}` as MessageKey)}</span>`,
        })}
        ${this.outlineItem('tiles', t('rpt.ds.node.tiles'), 'card', { meta: onOff(r.tiles !== false), err: n('tiles') })}
        ${this.outlineItem('chart', t('rpt.ds.node.chart'), 'bar', {
          meta: html`<span class="rd-meta">${t(`rpt.ds.chart.${chart}` as MessageKey)}</span>`,
          err: n('chart'),
        })}
        ${
          events
            ? nothing
            : html`<li class="rd-group" data-node-group="columns">
                <div class="rd-group-h">
                  ${icon('list', 'sm')}<span>${t('rpt.ds.node.columns')}</span>
                  <span class="rd-meta num">${cols.length}/${MAX_COLUMNS}</span>
                  ${n('columns') ? html`<span class="rd-bad">${icon('err', 'sm')}</span>` : nothing}
                </div>
                <ul>
                  ${cols.map((c, k) =>
                    this.outlineItem(`col:${k}`, c.label ?? c.tagId, 'line', {
                      sub: true,
                      err: colErr(k),
                      meta: html`<span class="rd-meta mono">${c.tagId}</span>`,
                    }),
                  )}
                </ul>
                ${this.addBox()}
              </li>`
        }
        ${this.outlineItem('page', t('rpt.ds.node.page'), 'export', { err: n('paper', 'footer', 'totals') })}
      </ul>
    </nav>`;
  }

  private addBox() {
    const list = this.suggestions();
    const open = this.open && list.length > 0;
    return html`<div class="te-add rd-add">
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
        placeholder=${t('rpt.ds.addCol')}
        autocomplete="off"
        spellcheck="false"
        ?disabled=${this.readOnly()}
        .value=${live(this.query)}
        @input=${(e: Event) => {
          this.query = (e.target as HTMLInputElement).value;
          this.open = true;
          this.hi = -1;
        }}
        @keydown=${this.onAddKey}
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

  // ---------- Thuộc tính ----------

  private propsGeneral(r: ReportTemplate, b: ReportIssueBuckets) {
    const kind = r.kind ?? 'table';
    const f11 = this.format11();
    const groups = eligibleGroups(this.app.store.state.outline.logging);
    const known = groups.some((g) => g.id === r.group);
    return html`
      ${this.field(t('rpt.ed.name'), 'name', this.input('name', r.name, this.text('name'), b), undefined, this.errs(b, 'name'))}
      ${this.field(t('rpt.ed.id'), 'id', this.input('id', r.id, this.text('id'), b, { mono: true }), undefined, this.errs(b, 'id'))}
      ${this.field(
        t('rpt.ds.kind'),
        'kind',
        this.select_(
          'kind',
          kind,
          KINDS.map((k): [string, string, boolean] => [
            k,
            t(`rpt.kind.${k}` as MessageKey),
            !f11 && k !== 'table',
          ]),
          (e) =>
            this.apply((c, j) =>
              setKind(
                c,
                j,
                (e.target as HTMLSelectElement).value as ReportKind,
                this.app.store.state.outline.logging,
                this.types(),
              ),
            ),
          b,
        ),
        `${t(`rpt.kindHelp.${kind}` as MessageKey)}${f11 ? '' : ` ${t('rpt.ds.need11')}`}`,
        this.errs(b, 'kind'),
      )}
      ${
        kind === 'alarm' || kind === 'logic'
          ? nothing
          : groups.length === 0
            ? html`<div class="rd-f" data-role="no-group">
                <label>${t('rpt.ed.group')}</label>
                <p class="te-help">${t('rpt.ed.noGroup')}</p>
                <button class="btn sm" type="button" @click=${() => this.app.openEditor('logging')}>
                  ${t('rpt.ed.openLogging')}
                </button>
                ${this.errs(b, 'group')}
              </div>`
            : this.field(
                t('rpt.ed.group'),
                'group',
                this.select_(
                  'group',
                  r.group ?? '',
                  [
                    ...(known || !r.group
                      ? []
                      : ([[r.group, t('rpt.ed.groupUnknown', { id: r.group })]] as Array<
                          [string, string]
                        >)),
                    ...groups.map((g): [string, string] => [g.id, `${g.name} (${g.id})`]),
                  ],
                  this.text('group'),
                  b,
                ),
                t('rpt.ed.groupHelp'),
                this.errs(b, 'group'),
              )
      }
      ${this.field(t('rpt.ed.title'), 'title', this.input('title', r.title ?? '', this.text('title'), b), undefined, this.errs(b, 'title'))}
    `;
  }

  private propsPeriod(r: ReportTemplate, b: ReportIssueBuckets) {
    const f11 = this.format11();
    const labels =
      r.period === 'shift' && r.shifts ? shiftLabels(r.shifts.count, r.shifts.start) : [];
    const grouping =
      r.period === 'day'
        ? t('rpt.ds.grouping.day', { min: r.rowMinutes ?? 60 })
        : r.period === 'shift'
          ? t('rpt.ds.grouping.shift')
          : t('rpt.ds.grouping.daily');
    return html`
      ${this.field(
        t('rpt.ed.period'),
        'period',
        this.select_(
          'period',
          r.period,
          PERIODS.map((p): [string, string, boolean] => [
            p,
            t(`rpt.period.${p}` as MessageKey),
            !f11 && PERIODS_11.has(p),
          ]),
          (e) =>
            this.apply((c, j) =>
              setPeriod(c, j, (e.target as HTMLSelectElement).value as ReportPeriod),
            ),
          b,
        ),
        f11 ? undefined : t('rpt.ds.need11'),
        this.errs(b, 'period'),
      )}
      <div class="rd-f">
        <span class="rd-k">${t('rpt.ds.grouping')}</span>
        <span class="rd-v" data-role="grouping">${grouping}</span>
      </div>
      ${
        r.period === 'day'
          ? this.field(
              t('rpt.ed.rowMinutes'),
              'rowMinutes',
              this.select_(
                'rowMinutes',
                String(r.rowMinutes ?? 60),
                [
                  ['15', '15'],
                  ['30', '30'],
                  ['60', '60'],
                ],
                (e) =>
                  this.apply((c, j) =>
                    setRowMinutes(
                      c,
                      j,
                      Number((e.target as HTMLSelectElement).value) as 15 | 30 | 60,
                    ),
                  ),
                b,
              ),
              undefined,
              this.errs(b, 'rowMinutes'),
            )
          : nothing
      }
      ${
        r.period === 'shift'
          ? html`${this.field(
                t('rpt.ed.shiftCount'),
                'shifts.count',
                this.select_(
                  'shifts.count',
                  String(r.shifts?.count ?? 3),
                  [
                    ...(r.shifts && !(SHIFT_OPTIONS as readonly number[]).includes(r.shifts.count)
                      ? ([
                          [String(r.shifts.count), t('rpt.ed.shiftInvalid', { n: r.shifts.count })],
                        ] as Array<[string, string]>)
                      : []),
                    ...SHIFT_OPTIONS.map((n): [string, string] => [String(n), String(n)]),
                  ],
                  (e) =>
                    this.apply((c, j) =>
                      setShifts(c, j, { count: Number((e.target as HTMLSelectElement).value) }),
                    ),
                  b,
                ),
                t('rpt.ed.shiftCountHelp'),
              )}
              ${this.field(
                t('rpt.ed.shiftStart'),
                'shifts.start',
                this.input(
                  'shifts.start',
                  r.shifts?.start ?? '',
                  (e) =>
                    this.apply((c, j) =>
                      setShifts(c, j, { start: (e.target as HTMLInputElement).value.trim() }),
                    ),
                  b,
                  { mono: true },
                ),
                t('rpt.ed.shiftStartHelp'),
                this.errs(b, 'shifts'),
              )}
              <ul class="te-shifts" data-role="shift-labels" aria-label=${t('rpt.ed.shiftLabels')}>
                ${labels.map((l) => html`<li>${l}</li>`)}
              </ul>`
          : nothing
      }
    `;
  }

  private propsTiles(r: ReportTemplate, b: ReportIssueBuckets) {
    const f11 = this.format11();
    return html`<div class="rd-f">
      <label class="te-chk">
        <input
          type="checkbox"
          data-field="tiles"
          ?disabled=${this.readOnly() || !f11}
          .checked=${r.tiles !== false}
          @click=${(e: Event) => this.apply((c, j) => setTiles(c, j, (e.target as HTMLInputElement).checked))}
        />
        <span>${t('rpt.ds.tilesShow')}</span>
      </label>
      <div class="te-help">${t('rpt.ds.tilesHelp')}${f11 ? '' : ` ${t('rpt.ds.need11')}`}</div>
      ${this.errs(b, 'tiles')}
    </div>`;
  }

  private propsChart(r: ReportTemplate, b: ReportIssueBuckets) {
    const f11 = this.format11();
    const cur = r.chart ?? 'auto';
    return html`<fieldset class="rd-radios" data-field="chart">
        <legend>${t('rpt.ds.node.chart')}</legend>
        ${CHARTS.map(
          (c) =>
            html`<label class="te-chk">
              <input
                type="radio"
                name="rd-chart"
                value=${c}
                data-chart=${c}
                ?disabled=${this.readOnly() || !f11}
                .checked=${cur === c}
                @change=${() => this.apply((cfg, j) => setChart(cfg, j, c))}
              />
              <span>${t(`rpt.ds.chart.${c}` as MessageKey)}</span>
            </label>`,
        )}
      </fieldset>
      <div class="te-help">${t('rpt.ds.chartHelp')}${f11 ? '' : ` ${t('rpt.ds.need11')}`}</div>
      ${this.errs(b, 'chart')}`;
  }

  private propsPage(r: ReportTemplate, b: ReportIssueBuckets) {
    const cfg = this.cfg()!;
    const f11 = this.format11();
    return html`
      ${this.field(
        t('rpt.ds.org'),
        'org',
        this.input(
          'org',
          cfg.org ?? '',
          (e) => {
            const c = this.guard();
            if (c) this.edit(setOrg(c, (e.target as HTMLInputElement).value));
          },
          b,
          { disabled: !f11 },
        ),
        `${t('rpt.ds.orgHelp')}${f11 ? '' : ` ${t('rpt.ds.need11')}`}`,
      )}
      ${this.field(
        t('rpt.ds.logo'),
        'logo',
        html`${this.input(
            'logo',
            cfg.logo ?? '',
            (e) => {
              const c = this.guard();
              if (c) this.edit(setLogo(c, (e.target as HTMLInputElement).value));
            },
            b,
            { disabled: !f11, mono: true, list: 'te-logo-files' },
          )}<datalist id="te-logo-files">
            ${this.logoFiles().map((f) => html`<option value=${f}></option>`)}
          </datalist>`,
        `${t('rpt.ds.logoHelp')}${f11 ? '' : ` ${t('rpt.ds.need11')}`}`,
        this.logoErrs(b),
      )}
      ${this.field(
        t('rpt.ed.paperSize'),
        'paper.size',
        this.select_(
          'paper.size',
          r.paper?.size ?? 'A4',
          [
            ['A4', 'A4'],
            ['A3', 'A3'],
          ],
          (e) =>
            this.apply((c, j) =>
              setPaper(c, j, { size: (e.target as HTMLSelectElement).value as 'A4' | 'A3' }),
            ),
          b,
        ),
      )}
      ${this.field(
        t('rpt.ed.orientation'),
        'paper.orientation',
        this.select_(
          'paper.orientation',
          r.paper?.orientation ?? 'portrait',
          [
            ['portrait', t('rpt.ed.portrait')],
            ['landscape', t('rpt.ed.landscape')],
          ],
          (e) =>
            this.apply((c, j) =>
              setPaper(c, j, {
                orientation: (e.target as HTMLSelectElement).value as 'portrait' | 'landscape',
              }),
            ),
          b,
        ),
      )}
      ${this.field(t('rpt.ed.footer'), 'footer', this.input('footer', r.footer ?? '', this.text('footer'), b), undefined, this.errs(b, 'footer'))}
      <div class="rd-f">
        <label class="te-chk">
          <input
            type="checkbox"
            data-field="totals"
            ?disabled=${this.readOnly()}
            .checked=${r.totals !== false}
            @click=${(e: Event) => this.apply((c, j) => setTotals(c, j, (e.target as HTMLInputElement).checked))}
          />
          <span>${t('rpt.ed.totals')}</span>
        </label>
      </div>
    `;
  }

  private propsColumn(r: ReportTemplate, k: number, b: ReportIssueBuckets) {
    const cols = r.columns ?? [];
    const col = cols[k];
    if (!col) return html`<p class="te-help">${t('rpt.ed.pickColumn')}</p>`;
    const types = this.types();
    const type = types?.get(col.tagId);
    const kind = r.kind ?? 'table';
    const ro = this.readOnly();
    const f11 = this.format11();
    const tags = eligibleTags(this.app.store.state.outline.logging, r.group ?? '', types).filter(
      (id) => kind !== 'equipment' || types?.get(id) === 'BOOL',
    );
    const info = tagInfoOf(this.app.store.state.outline.tags)(col.tagId);
    const setCol = (field: 'tagId' | 'label' | 'unit' | 'decimals') => (e: Event) => {
      const raw = (e.target as HTMLInputElement | HTMLSelectElement).value.trim();
      if (field === 'decimals') {
        if (raw === '') return this.apply((c, j) => setColumnField(c, j, k, 'decimals', undefined));
        const n = /^\d$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isInteger(n) || n > 6) return void this.app.toast(t('rpt.err.decimals'));
        return this.apply((c, j) => setColumnField(c, j, k, 'decimals', n));
      }
      this.apply((c, j) => setColumnField(c, j, k, field, raw === '' ? undefined : raw));
    };
    return html`
      ${this.field(
        t('rpt.ds.colTag'),
        'col.tag',
        html`<select
          id="te-col.tag"
          data-field="col.tag"
          class="mono"
          ?disabled=${ro}
          @change=${setCol('tagId')}
        >
          ${[...new Set([col.tagId, ...tags])].map(
            (id) => html`<option value=${id} ?selected=${id === col.tagId}>${id}</option>`,
          )}
        </select>`,
        type ? `${type}${info?.unit ? ` · ${info.unit}` : ''}` : undefined,
      )}
      ${this.field(t('rpt.col.label'), 'col.label', this.input('col.label', col.label ?? '', setCol('label'), b, { errKey: '-' }), info?.description ? info.description : undefined)}
      <div class="rd-row">
        ${this.field(t('rpt.col.unit'), 'col.unit', this.input('col.unit', col.unit ?? '', setCol('unit'), b, { errKey: '-' }))}
        ${this.field(t('rpt.col.decimals'), 'col.decimals', this.input('col.decimals', col.decimals === undefined ? '' : String(col.decimals), setCol('decimals'), b, { errKey: '-' }))}
      </div>
      <fieldset class="te-fns" data-role="fns">
        <legend>${t('rpt.ed.fnsOf', { tag: col.tagId })}</legend>
        ${fnsFor(kind).map((fn: ReportFn) => {
          const ok = fnApplicable(type, fn, kind) && (f11 || fn !== 'onTime');
          return html`<label
            class="te-chk ${ok ? '' : 'na'}"
            title=${ok ? nothing : t('rpt.ed.fnNa')}
          >
            <input
              type="checkbox"
              data-fn=${fn}
              ?disabled=${ro || !ok}
              .checked=${col.functions.includes(fn)}
              @click=${() => this.apply((c, j) => toggleFunction(c, j, k, fn))}
            />
            <span>${fnLabel(fn)}</span>
          </label>`;
        })}
      </fieldset>
      ${this.cellErrs(b, k)}
      <div class="rd-actions">
        <button
          class="btn sm"
          type="button"
          data-act="suggest-unit"
          ?disabled=${ro}
          @click=${() => {
            // đọc cột lúc bấm (không theo lần vẽ trước): vừa đổi hàm thì gợi ý theo hàm mới
            const fns = this.tpl()?.columns?.[k]?.functions ?? col.functions;
            const fn: ReportFn = fns.includes('onTime')
              ? 'onTime'
              : fns.includes('sum')
                ? 'sum'
                : (fns[0] ?? 'avg');
            const unit = suggestUnit(fn, info?.unit, type);
            this.apply((c, j) => setColumnField(c, j, k, 'unit', unit === '' ? undefined : unit));
          }}
        >
          ${t('rpt.ed.suggestUnit')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="col-up"
          ?disabled=${ro || k === 0}
          @click=${() => {
            this.apply((c, j) => moveColumn(c, j, k, k - 1));
            this.select(`col:${k - 1}`);
          }}
        >
          ${t('rpt.ds.moveUp')}
        </button>
        <button
          class="btn sm"
          type="button"
          data-act="col-down"
          ?disabled=${ro || k === cols.length - 1}
          @click=${() => {
            this.apply((c, j) => moveColumn(c, j, k, k + 1));
            this.select(`col:${k + 1}`);
          }}
        >
          ${t('rpt.ds.moveDown')}
        </button>
        <span class="grow"></span>
        <button
          class="btn sm danger"
          type="button"
          data-act="col-remove"
          ?disabled=${ro}
          @click=${() => {
            this.apply((c, j) => removeColumns(c, j, [k]));
            this.select(cols.length > 1 ? `col:${Math.max(0, k - 1)}` : 'general');
          }}
        >
          ${icon('x', 'sm')}<span>${t('rpt.ds.removeCol')}</span>
        </button>
      </div>
    `;
  }

  private props(r: ReportTemplate, b: ReportIssueBuckets) {
    const part = this.sel;
    let title: string;
    let body: TemplateResult;
    if (part.startsWith('col:')) {
      const k = Number(part.slice(4));
      title = t('rpt.ds.colTitle', { tag: r.columns?.[k]?.tagId ?? '' });
      body = this.propsColumn(r, k, b);
    } else if (part === 'period') {
      title = t('rpt.ds.node.period');
      body = this.propsPeriod(r, b);
    } else if (part === 'tiles') {
      title = t('rpt.ds.node.tiles');
      body = this.propsTiles(r, b);
    } else if (part === 'chart') {
      title = t('rpt.ds.node.chart');
      body = this.propsChart(r, b);
    } else if (part === 'page') {
      title = t('rpt.ds.node.page');
      body = this.propsPage(r, b);
    } else {
      title = t('rpt.ds.node.general');
      body = this.propsGeneral(r, b);
    }
    return html`<aside class="rd-props" aria-label=${t('rpt.ds.props')} data-part=${part}>
      <div class="rd-pane-h">${t('rpt.ds.props')}</div>
      <h3 class="rd-props-t">${title}</h3>
      <div class="rd-form">${body}</div>
    </aside>`;
  }

  // ---------- Vẽ ----------

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
    const choice = sourceChoice.get(this.app) ?? 'sim';
    const kind = r.kind ?? 'table';
    const events = kind === 'alarm' || kind === 'logic';
    const sel = this.sel;
    // cột đang chọn: mọi cột ra (Tag × hàm) của nó có viền chọn ở xem trước
    const selCol = sel.startsWith('col:') ? r.columns?.[Number(sel.slice(4))] : undefined;
    const previewSel = selCol
      ? `cols:${selCol.functions.map((f) => `${selCol.tagId}.${f}`).join('|')}`
      : sel;
    return html`<div class="ed ed-fill te rd">
      <div class="ed-head">
        <h2>${r.name}</h2>
        <span class="chip">${t(`rpt.kind.${kind}` as MessageKey)}</span>
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
      ${
        this.format11() || ro
          ? nothing
          : html`<p class="banner warn rd-banner" role="status">
              ${icon('warn', 'warn')}<span>${t('rpt.ds.banner11')}</span>
            </p>`
      }
      <div class="rd-body">
        ${this.outline(r, b)}
        <section
          class="rd-canvas ${this.dropping ? 'drop' : ''}"
          aria-label=${t('rpt.ds.canvas')}
          @dragover=${this.onDragOver}
          @dragleave=${this.onDragLeave}
          @drop=${this.onDrop}
          @report-select=${this.onPreviewSelect}
        >
          <div class="rd-canvas-bar">
            <span class="rd-pane-h">${t('rpt.ds.canvas')}</span>
            <span class="grow"></span>
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
          ${events ? html`<p class="te-help rd-note">${t('rpt.ds.sourceEvents')}</p>` : html`<p class="te-help rd-note">${icon('hand', 'sm')} ${t('rpt.ds.dropHint')}</p>`}
          <div class="rd-paper" tabindex="0" role="region" aria-label=${t('rpt.pv.title')}>
            <mat-report-preview
              .template=${r}
              .source=${this.source()}
              .events=${choice === 'sim' ? simEventsFor(this.app) : undefined}
              .tagInfo=${tagInfoOf(s.outline.tags)}
              .userName=${this.app.session.auth?.user ?? ''}
              .save=${this.save}
              .theme=${projectTheme(s.outline.project)}
              .org=${this.org()}
              .logo=${this.logoUrl()}
              .selected=${previewSel}
            ></mat-report-preview>
          </div>
        </section>
        ${this.props(r, b)}
      </div>
    </div>`;
  }
}

customElements.define('mat-templates-editor', TemplatesEditor);

/** Thêm báo cáo từ mẫu có sẵn và mở trình thiết kế của nó (lệnh "Thêm báo cáo…", thư viện mẫu). */
export function addReportFromPreset(app: StudioApp, id: PresetId): boolean {
  const s = app.store.state;
  if (s.readOnly || !s.outline.format06) {
    app.toast(t('rpt.ed.readOnlyToast'));
    return false;
  }
  const cur = s.outline.reports;
  if ((cur?.reports.length ?? 0) >= MAX_REPORTS) {
    app.toast(t('rpt.ed.maxReports', { n: MAX_REPORTS }));
    return false;
  }
  const o = s.outline;
  const tpl = presetTemplate(id, {
    logging: o.logging,
    types: o.tags ? tagTypesOf(o.tags) : null,
    info: tagInfoOf(o.tags),
    format11: o.format11,
  });
  if (!tpl) return false;
  const version = (o.project as { schemaVersion?: unknown } | null)?.schemaVersion;
  const next = addTemplate(cur, typeof version === 'string' ? version : SCHEMA_VERSION, tpl);
  app.store.edit([reportsEdit(next)]);
  app.openEditor(`report:${next.reports[next.reports.length - 1]!.id}`);
  return true;
}

/** Trang Báo cáo (mục Báo cáo của cây): thư viện mẫu có sẵn để thêm báo cáo, và danh sách mẫu của project. */
export class ReportsList extends AppElement {
  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.isConnected && super.shouldUpdate(changed);
  }

  protected override render() {
    const s = this.app.store.state;
    if (!s.project) return nothing;
    const o = s.outline;
    const list = o.reports?.reports ?? [];
    const groups = eligibleGroups(o.logging);
    const b = bucketReportIssues(s.issues, o.reportsFile);
    const ctx = {
      logging: o.logging,
      types: o.tags ? tagTypesOf(o.tags) : null,
      info: tagInfoOf(o.tags),
      format11: o.format11,
    };
    const ro = s.readOnly || !o.format06;
    return html`<div class="ed ed-fill te">
      <div class="ed-head">
        <h2>${t('tree.reports')}</h2>
        <span class="path">${o.reportsFile ?? 'reports.json'}</span>
        <span class="grow"></span>
      </div>
      <div class="te-list">
        <section class="rd-gallery" aria-labelledby="rd-gallery-h">
          <h3 id="rd-gallery-h">${t('rpt.preset.title')}</h3>
          <p class="te-help">${t('rpt.preset.help')}</p>
          ${groups.length === 0 ? html`<p class="banner warn" role="status">${icon('warn', 'warn')}<span>${t('rpt.ed.noGroup')}</span></p>` : nothing}
          <div class="rd-cards">
            ${REPORT_PRESETS.map((p) => {
              const why = ro ? t('rpt.ed.readOnlyToast') : presetBlocked(p, ctx);
              return html`<button
                class="rd-card"
                type="button"
                data-preset=${p.id}
                aria-disabled=${why ? 'true' : nothing}
                title=${why ?? nothing}
                @click=${() => (why ? this.app.toast(why) : addReportFromPreset(this.app, p.id))}
              >
                <span class="rd-card-i">${icon(p.icon, 'lg')}</span>
                <span class="rd-card-t">${t(`rpt.preset.${p.id}` as MessageKey)}</span>
                <span class="rd-card-d">${t(`rpt.preset.${p.id}.d` as MessageKey)}</span>
                ${why ? html`<span class="rd-card-why">${why}</span>` : nothing}
              </button>`;
            })}
          </div>
        </section>
        ${
          list.length === 0
            ? nothing
            : html`<table class="te-table">
                <caption class="te-sr">
                  ${t('tree.reports')}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">${t('rpt.ed.name')}</th>
                    <th scope="col">${t('rpt.ds.kind')}</th>
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
                        <td>${t(`rpt.kind.${r.kind ?? 'table'}` as MessageKey)}</td>
                        <td class="mono">${r.group ?? ''}</td>
                        <td>${t(`rpt.period.${r.period}` as MessageKey)}</td>
                        <td class="num">${(r.columns ?? []).length}</td>
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
