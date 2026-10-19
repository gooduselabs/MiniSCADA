// Khung Xem trước báo cáo của editor Mẫu báo cáo (feature 010, US8, T133; contracts/studio-010.md §2). Dựng bảng bằng `reportRequest`
// và `buildReport` của history-math (một ReportTable cho màn hình và cả bốn định dạng xuất) từ MỘT nguồn lịch sử chọn được:
// mô phỏng (`SimHistorySource`) hoặc thiết bị (`DeviceHistorySource`). Đổi mẫu, hàm, thứ tự cột hay kỳ thì dựng lại ngay (hủy lần
// dựng cũ). Nút xuất thử CSV, CSV vi-VN, XLSX, PDF dùng đúng mã của trang runtime (`report-export`, XLSX và PDF tải lười) rồi
// giao byte cho `save` (lệnh lưu của Tauri qua hộp thoại; không ghi tự động). Mọi chữ qua binding của Lit: nhãn, tiêu đề là văn
// bản thuần.
import {
  buildReport,
  localParts,
  parseUtcOffset,
  reportRequest,
  workDayOffsetMs,
  type AggregateResult as MathAggregate,
  type ReportTable,
} from '@mat/history-math';
import {
  EXPORT_FORMATS,
  exportCsv,
  exportFileName,
  exportPdf,
  exportXlsx,
  type CsvStyle,
  type ExportLabels,
  type ExportMeta,
  type ReportTheme,
} from '@mat/report-export';
import type { ReportTemplate as SchemaTemplate } from '@mat/project-schema';
import type { HistoryCatalogGroup, HistorySource } from '@mat/ui-components';
import { html, LitElement, nothing, type PropertyValues } from 'lit';
import { t } from '../i18n/index.ts';
import { fnLabel } from '../model/reports-doc.ts';
import './report-preview.css';

export interface ReportExporter {
  csv(t: ReportTable, labels: ExportLabels, style: CsvStyle): Uint8Array;
  xlsx(t: ReportTable, meta: ExportMeta, labels: ExportLabels): Promise<Uint8Array>;
  pdf(t: ReportTable, meta: ExportMeta, labels: ExportLabels, footer?: string): Promise<Uint8Array>;
}

export const defaultExporter: ReportExporter = { csv: exportCsv, xlsx: exportXlsx, pdf: exportPdf };

export type SaveResult = 'saved' | 'cancelled' | 'error';
export type ExportKind = 'csv' | 'csv-excel' | 'xlsx' | 'pdf';
export interface ReportPeriodSel {
  d?: string;
  m?: string;
}

/**
 * Chủ đề báo cáo từ `project.json` (cùng quy ước với trang vận hành: không đặt hoặc lạ là industrial, contracts/ui-theme.md §1).
 */
export function projectTheme(project: unknown): ReportTheme {
  const theme = (project as { theme?: unknown } | null | undefined)?.theme;
  return theme === 'vivid' || theme === 'dark' ? theme : 'industrial';
}

const LOW_COVERAGE = 0.95;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const p2 = (n: number) => String(n).padStart(2, '0');

/** Nhãn của `report-export` lấy từ i18n của Studio (gói đó không chứa chuỗi giao diện). */
export function exportLabels(): ExportLabels {
  return {
    period: t('rpt.x.period'),
    total: t('rpt.pv.total'),
    exportedBy: t('rpt.x.exportedBy'),
    exportedAt: t('rpt.x.exportedAt'),
    page: t('rpt.x.page'),
    of: '/',
    rowHeader: t('rpt.pv.time'),
    coverage: t('rpt.x.coverage'),
    fn: {
      min: fnLabel('min').toLowerCase(),
      max: fnLabel('max').toLowerCase(),
      avg: fnLabel('avg').toLowerCase(),
      sum: fnLabel('sum').toLowerCase(),
      first: fnLabel('first').toLowerCase(),
      last: fnLabel('last').toLowerCase(),
      delta: fnLabel('delta').toLowerCase(),
      count: fnLabel('count').toLowerCase(),
    },
  };
}

type Msg =
  | { kind: 'info' | 'busy' | 'error' | 'narrow' | 'disabled'; text: string; retry?: boolean }
  | { kind: 'login'; text: string };

export class ReportPreview extends LitElement {
  static override properties = {
    template: { attribute: false },
    source: { attribute: false },
    period: { attribute: false },
    now: { attribute: false },
    userName: { attribute: false },
    tagInfo: { attribute: false },
    save: { attribute: false },
    exporter: { attribute: false },
    theme: { attribute: false },
    table: { state: true },
    msg: { state: true },
    loading: { state: true },
    exporting: { state: true },
    notice: { state: true },
  };

  declare template: SchemaTemplate | undefined;
  declare source: HistorySource | undefined;
  declare period: ReportPeriodSel | undefined;
  declare now: () => number;
  declare userName: string;
  declare tagInfo:
    ((id: string) => { description?: string; unit?: string } | undefined) | undefined;
  declare save:
    | ((name: string, bytes: Uint8Array, ext: 'csv' | 'xlsx' | 'pdf') => Promise<SaveResult>)
    | undefined;
  declare exporter: ReportExporter | undefined;
  /** Chủ đề của project (project.json `theme`, feature 012): màu của PDF/XLSX xuất thử. */
  declare theme: ReportTheme | undefined;
  declare table: ReportTable | null;
  declare msg: Msg | null;
  declare loading: boolean;
  declare exporting: boolean;
  declare notice: string;

  #seq = 0;
  #pending: Promise<void> = Promise.resolve();
  #exporting: Promise<void> = Promise.resolve();
  #group: HistoryCatalogGroup | null = null;
  #sel: ReportPeriodSel = {};
  #unsub: (() => void) | null = null;
  #sourceOf: HistorySource | undefined;

  constructor() {
    super();
    this.now = () => Date.now();
    this.userName = '';
    this.table = null;
    this.msg = null;
    this.loading = false;
    this.exporting = false;
    this.notice = '';
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override disconnectedCallback(): void {
    this.#unsub?.();
    this.#unsub = null;
    this.#sourceOf = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('source') && this.source !== this.#sourceOf) {
      this.#unsub?.();
      this.#sourceOf = this.source;
      this.#unsub =
        this.source?.onState((s) => {
          // Đăng nhập xong thì dựng lại ngay; trạng thái khác do lần dựng tự cập nhật.
          if (s === 'ready' && this.msg?.kind === 'login') this.refresh();
        }) ?? null;
    }
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('template') || changed.has('source') || changed.has('period')) this.refresh();
  }

  /** Dựng lại bảng (hủy lần dựng đang chạy). */
  refresh(): void {
    const seq = ++this.#seq;
    this.#pending = this.#run(seq);
  }

  /** Chờ cho tới khi mọi lần dựng đang chạy xong và giao diện đã vẽ lại (test, e2e). */
  async whenIdle(): Promise<void> {
    await this.updateComplete;
    for (;;) {
      const p = this.#pending;
      const x = this.#exporting;
      await Promise.all([p, x]);
      await this.updateComplete;
      if (p === this.#pending && x === this.#exporting) return;
    }
  }

  // ---- dựng bảng ---------------------------------------------------------------------------------------------

  // Kỳ mặc định: ngày (tháng) đang chạy. Mẫu theo ca: ngày làm việc bắt đầu lúc ca 1 (`shifts.start`), nên
  // trước giờ đó (ví dụ 01:07 với ca 06:00) ngày làm việc đang chạy là của hôm trước, không phải ngày lịch.
  #defaultSel(tpl: SchemaTemplate, tz: string): ReportPeriodSel {
    const period = tpl.period;
    const p = localParts(this.now() - workDayOffsetMs(tpl), parseUtcOffset(tz));
    return period === 'month' ? { m: `${p.y}-${p2(p.m)}` } : { d: `${p.y}-${p2(p.m)}-${p2(p.d)}` };
  }

  #validSel(tpl: SchemaTemplate, tz: string): ReportPeriodSel {
    const month = tpl.period === 'month';
    const want = this.period && (month ? this.period.m : this.period.d);
    if (want && (month ? MONTH_RE : DAY_RE).test(want)) return month ? { m: want } : { d: want };
    return this.#defaultSel(tpl, tz);
  }

  async #run(seq: number): Promise<void> {
    const tpl = this.template;
    const src = this.source;
    if (!tpl || !src) {
      this.#show(seq, null, null);
      return;
    }
    if (!tpl.group) return this.#show(seq, null, { kind: 'info', text: t('rpt.pv.noGroup') });
    if (tpl.columns.length === 0)
      return this.#show(seq, null, { kind: 'info', text: t('rpt.pv.noColumns') });
    this.loading = true;
    try {
      const cat = await src.catalog();
      if (seq !== this.#seq) return;
      if (!cat.enabled)
        return this.#show(seq, null, { kind: 'disabled', text: t('rpt.pv.noHistory') });
      const g = cat.groups.find((x) => x.id === tpl.group);
      if (!g) return this.#show(seq, null, { kind: 'info', text: t('rpt.pv.noGroup') });
      this.#group = g;
      const sel = (this.#sel = this.#validSel(tpl, g.timeZone));
      const req = reportRequest(tpl, sel, parseUtcOffset(g.timeZone), t('rpt.shiftWord'));
      const ac = new AbortController();
      const aggs = (await Promise.all(
        req.batches.map((tags) =>
          src.aggregate(
            {
              group: g.id,
              tags,
              from: req.from,
              to: req.to,
              bucketMs: req.bucketMs,
              offsetMs: req.offsetMs,
              priority: 'user',
            },
            ac.signal,
          ),
        ),
      )) as unknown as MathAggregate[];
      if (seq !== this.#seq) return;
      const tagInfo: Record<string, { description?: string; unit?: string }> = {};
      for (const c of tpl.columns) {
        const i = this.tagInfo?.(c.tagId);
        if (i) tagInfo[c.tagId] = i;
      }
      const table = buildReport({
        template: tpl,
        select: sel,
        tz: g.timeZone,
        now: this.now(),
        shiftWord: t('rpt.shiftWord'),
        tagInfo,
        aggregates: aggs,
      });
      const hasData = table.rows.some((r) => !r.pending && r.cells.some((c) => c !== null));
      this.#show(
        seq,
        hasData ? table : null,
        hasData ? null : { kind: 'info', text: t('rpt.pv.empty') },
      );
    } catch (e) {
      if (seq !== this.#seq) return;
      this.#show(seq, null, this.#failure(e));
    }
  }

  #failure(e: unknown): Msg {
    const code = (e as { code?: string })?.code ?? '';
    switch (code) {
      case 'AUTH_REQUIRED':
      case 'SESSION_EXPIRED':
      case 'SESSION_INVALID':
        return { kind: 'login', text: t('rpt.pv.login') };
      case 'BUSY':
        return { kind: 'busy', text: t('rpt.pv.busy'), retry: true };
      case 'RANGE_TOO_LARGE':
        return { kind: 'narrow', text: t('rpt.pv.narrow') };
      case 'NO_HISTORY':
        return { kind: 'disabled', text: t('rpt.pv.noHistory') };
      case 'NO_DEVICE':
        return { kind: 'info', text: t('rpt.pv.noDevice') };
      case 'ABORTED':
        return { kind: 'info', text: '' };
      default:
        return { kind: 'error', text: t('rpt.pv.error'), retry: true };
    }
  }

  #show(seq: number, table: ReportTable | null, msg: Msg | null): void {
    if (seq !== this.#seq) return;
    this.table = table;
    this.msg = msg;
    this.loading = false;
  }

  // ---- xuất thử ----------------------------------------------------------------------------------------------

  async #export(kind: ExportKind): Promise<void> {
    const tbl = this.table;
    const tpl = this.template;
    const g = this.#group;
    if (!tbl || !tpl || !g || !this.save) return;
    const labels = exportLabels();
    const meta: ExportMeta = {
      exportedBy: this.userName,
      exportedAt: this.now(),
      tz: g.timeZone,
      sheetName: tpl.name,
      ...(tpl.paper ? { paper: tpl.paper } : {}),
      ...(this.theme ? { theme: this.theme } : {}),
    };
    const exp = this.exporter ?? defaultExporter;
    this.exporting = true;
    this.notice = '';
    try {
      let bytes: Uint8Array;
      if (kind === 'csv') bytes = exp.csv(tbl, labels, 'standard');
      else if (kind === 'csv-excel') bytes = exp.csv(tbl, labels, 'excel-vi');
      else if (kind === 'xlsx') bytes = await exp.xlsx(tbl, meta, labels);
      else bytes = await exp.pdf(tbl, meta, labels, tpl.footer ?? '');
      const f = EXPORT_FORMATS[kind];
      const key = this.#sel.m ?? this.#sel.d ?? '';
      const name = exportFileName(tpl.id, key, f.ext);
      const r = await this.save(name, bytes, f.ext as 'csv' | 'xlsx' | 'pdf');
      this.notice =
        r === 'saved'
          ? t('rpt.pv.saved', { name })
          : r === 'cancelled'
            ? ''
            : t('rpt.pv.saveFailed');
    } catch {
      this.notice = t('rpt.pv.exportFailed', {
        format: kind === 'xlsx' ? 'XLSX' : kind === 'pdf' ? 'PDF' : 'CSV',
      });
    } finally {
      this.exporting = false;
    }
  }

  // ---- vẽ ----------------------------------------------------------------------------------------------------

  #renderTable(tb: ReportTable) {
    const nCols = tb.columns.length;
    return html`<div
        class="rpt-scroll"
        tabindex="0"
        role="region"
        aria-label=${`${tb.title} ${tb.periodLabel}`}
      >
        <table class="rpt">
          <caption class="rpt-sr">
            ${tb.title} ${tb.periodLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">${t('rpt.pv.time')}</th>
              ${tb.columns.map(
                (c) =>
                  html`<th scope="col">
                    ${c.label}${c.unit ? ` (${c.unit})` : ''} · ${fnLabel(c.fn)}
                  </th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${tb.rows.map((r) =>
              r.pending
                ? html`<tr>
                    <th scope="row">${r.label}</th>
                    <td class="pending" colspan=${nCols}>${t('rpt.pv.pending')}</td>
                  </tr>`
                : html`<tr>
                    <th scope="row">${r.label}</th>
                    ${r.text.map(
                      (s) =>
                        html`<td
                          class="num ${r.coverage < LOW_COVERAGE ? 'miss' : ''}"
                          title=${r.coverage < LOW_COVERAGE ? t('rpt.pv.missingCell') : nothing}
                        >
                          ${s}
                        </td>`,
                    )}
                  </tr>`,
            )}
            ${
              tb.totalsText
                ? html`<tr class="total">
                    <th scope="row">${t('rpt.pv.total')}</th>
                    ${tb.totalsText.map((s) => html`<td class="num">${s}</td>`)}
                  </tr>`
                : nothing
            }
          </tbody>
        </table>
      </div>
      <p class="rpt-cov">
        ${t('rpt.pv.coverage', { pct: `${(tb.coverage * 100).toFixed(1).replace('.', ',')} %` })}
      </p>`;
  }

  protected override render() {
    const tpl = this.template;
    const month = tpl?.period === 'month';
    const value = month ? (this.#sel.m ?? '') : (this.#sel.d ?? '');
    const msg = this.msg;
    return html`<section
      class="rp"
      aria-label=${t('rpt.pv.title')}
      aria-busy=${this.loading ? 'true' : 'false'}
    >
      <div class="rp-bar">
        <label class="rp-period">
          <span
            >${tpl?.period === 'shift' ? t('rpt.pv.workDay') : month ? t('rpt.pv.month') : t('rpt.pv.day')}</span
          >
          <input
            type=${month ? 'month' : 'date'}
            data-role="period"
            .value=${value}
            ?disabled=${!tpl}
            @change=${(e: Event) => {
              const v = (e.target as HTMLInputElement).value;
              this.period = month ? { m: v } : { d: v };
            }}
          />
        </label>
        <span class="rp-grow"></span>
        ${(
          [
            ['csv', 'rpt.exp.csv'],
            ['csv-vi', 'rpt.exp.csvVi'],
            ['xlsx', 'rpt.exp.xlsx'],
            ['pdf', 'rpt.exp.pdf'],
          ] as const
        ).map(
          ([act, label]) =>
            html`<button
              class="btn sm"
              type="button"
              data-act=${act}
              ?disabled=${!this.table || this.exporting || !this.save}
              @click=${() => {
                this.#exporting = this.#export(act === 'csv-vi' ? 'csv-excel' : act);
              }}
            >
              ${t(label)}
            </button>`,
        )}
      </div>
      ${
        msg && msg.text
          ? html`<p
                class="rp-msg ${msg.kind}"
                data-state=${msg.kind}
                role=${msg.kind === 'error' || msg.kind === 'busy' ? 'alert' : 'status'}
              >
                ${msg.text}
              </p>
              ${
                msg.kind === 'login'
                  ? html`<button
                      class="btn sm"
                      type="button"
                      data-act="login"
                      @click=${() => this.source?.requestLogin?.()}
                    >
                      ${t('rpt.pv.loginBtn')}
                    </button>`
                  : nothing
              }
              ${
                'retry' in msg && msg.retry
                  ? html`<button
                      class="btn sm"
                      type="button"
                      data-act="retry"
                      @click=${() => this.refresh()}
                    >
                      ${t('rpt.pv.retry')}
                    </button>`
                  : nothing
              }`
          : nothing
      }
      ${this.table ? this.#renderTable(this.table) : nothing}
      <p class="rp-saved" role="status">${this.notice}</p>
    </section>`;
  }
}

customElements.define('mat-report-preview', ReportPreview);

declare global {
  interface HTMLElementTagNameMap {
    'mat-report-preview': ReportPreview;
  }
}
