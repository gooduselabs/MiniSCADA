// Khung Xem trước trực tiếp của trình thiết kế báo cáo (feature 010 US8; feature 015 FR-004, FR-007). Dựng bảng bằng
// `runReport` của ui-components, CÙNG mã với trang Báo cáo của runtime-web (một ReportTable cho màn hình và bốn định dạng
// xuất), từ MỘT nguồn lịch sử chọn được: mô phỏng (`SimHistorySource`) hoặc thiết bị (`DeviceHistorySource`); mẫu alarm và
// logic dùng nguồn sự kiện (mô phỏng của Studio). Hiện bằng `<mat-report-view>` (dải tiêu đề, thẻ, biểu đồ, bảng, bảng phụ);
// bấm vào phần của báo cáo chọn phần đó ở trình thiết kế (`report-select`). Đổi mẫu, hàm, thứ tự cột hay kỳ thì dựng lại ngay
// (hủy lần dựng cũ). Nút xuất thử CSV, CSV vi-VN, XLSX, PDF dùng đúng mã của trang runtime (`report-export`, XLSX và PDF tải
// lười) rồi giao byte cho `save` (hộp thoại lưu của Tauri). Mọi chữ qua binding của Lit: nhãn, tiêu đề là văn bản thuần.
import {
  isoWeekOf,
  localParts,
  parseUtcOffset,
  validSelection,
  workDayOffsetMs,
  type ReportFn,
  type ReportSelection,
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
import {
  runReport,
  viReport,
  type HistorySource,
  type ReportEventSource,
  type ReportViewLabels,
} from '@mat/ui-components';
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
export type ReportPeriodSel = ReportSelection;

/**
 * Chủ đề báo cáo từ `project.json` (cùng quy ước với trang vận hành: không đặt hoặc lạ là industrial, contracts/ui-theme.md §1).
 */
export function projectTheme(project: unknown): ReportTheme {
  const theme = (project as { theme?: unknown } | null | undefined)?.theme;
  return theme === 'vivid' || theme === 'dark' ? theme : 'industrial';
}

const p2 = (n: number) => String(n).padStart(2, '0');
const FNS: readonly ReportFn[] = [
  'min',
  'max',
  'avg',
  'sum',
  'first',
  'last',
  'delta',
  'count',
  'onTime',
  'starts',
];
const fnNames = (): Record<ReportFn, string> =>
  Object.fromEntries(FNS.map((f) => [f, fnLabel(f).toLowerCase()])) as Record<ReportFn, string>;

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
    fn: fnNames(),
  };
}

/** Chữ của `<mat-report-view>` theo i18n của Studio. */
export function viewLabels(): ReportViewLabels {
  return {
    ...viReport,
    period: t('rpt.x.period'),
    rowHeader: t('rpt.pv.time'),
    total: t('rpt.pv.total'),
    pending: t('rpt.pv.pending'),
    missingCell: t('rpt.pv.missingCell'),
    tableTitle: t('rpt.pv.tableTitle'),
    noRows: t('rpt.pv.noRows'),
    chartHint: t('rpt.pv.chartHint'),
    coverage: (pct) => t('rpt.pv.coverage', { pct }),
    fn: fnNames(),
  };
}

type Msg =
  | { kind: 'info' | 'busy' | 'error' | 'narrow' | 'disabled'; text: string; retry?: boolean }
  | { kind: 'login'; text: string };

/** Độ lệch giờ của máy (`±HH:MM`): múi giờ của báo cáo alarm/logic khi không có nhóm lưu trữ. */
function localTz(now: number): string {
  const off = -new Date(now).getTimezoneOffset();
  const a = Math.abs(off);
  return `${off < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

export class ReportPreview extends LitElement {
  static override properties = {
    template: { attribute: false },
    source: { attribute: false },
    events: { attribute: false },
    period: { attribute: false },
    now: { attribute: false },
    userName: { attribute: false },
    tagInfo: { attribute: false },
    save: { attribute: false },
    exporter: { attribute: false },
    theme: { attribute: false },
    org: { attribute: false },
    selected: { attribute: false },
    table: { state: true },
    msg: { state: true },
    loading: { state: true },
    exporting: { state: true },
    notice: { state: true },
  };

  declare template: SchemaTemplate | undefined;
  declare source: HistorySource | undefined;
  /** Nguồn sự kiện của mẫu alarm/logic (mô phỏng); thiếu thì báo chỉ xem được bằng mô phỏng. */
  declare events: ReportEventSource | undefined;
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
  /** Tên đơn vị trên dải tiêu đề (reports.json `org` hoặc tên project). */
  declare org: string;
  /** Phần đang chọn ở trình thiết kế (viền nhấn trong xem trước). */
  declare selected: string;
  declare table: ReportTable | null;
  declare msg: Msg | null;
  declare loading: boolean;
  declare exporting: boolean;
  declare notice: string;

  #seq = 0;
  #pending: Promise<void> = Promise.resolve();
  #exporting: Promise<void> = Promise.resolve();
  #tz = '+07:00';
  #sel: ReportSelection = {};
  #unsub: (() => void) | null = null;
  #sourceOf: HistorySource | undefined;
  #ac: AbortController | null = null;

  constructor() {
    super();
    this.now = () => Date.now();
    this.userName = '';
    this.org = '';
    this.selected = '';
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
    this.#ac?.abort();
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
    if (
      changed.has('template') ||
      changed.has('source') ||
      changed.has('period') ||
      changed.has('events') ||
      changed.has('org')
    )
      this.refresh();
  }

  /** Dựng lại bảng (hủy lần dựng đang chạy). */
  refresh(): void {
    const seq = ++this.#seq;
    this.#ac?.abort();
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
      await this.querySelector('mat-report-view')?.updateComplete;
      if (p === this.#pending && x === this.#exporting) return;
    }
  }

  // ---- dựng bảng ---------------------------------------------------------------------------------------------

  // Kỳ mặc định: ngày (tuần, tháng) đang chạy. Mẫu theo ca: ngày làm việc bắt đầu lúc ca 1 (`shifts.start`), nên trước giờ
  // đó (ví dụ 01:07 với ca 06:00) ngày làm việc đang chạy là của hôm trước. Khoảng: 7 ngày tới hôm nay.
  #defaultSel(tpl: SchemaTemplate, tz: string): ReportSelection {
    const tzMs = parseUtcOffset(tz);
    const now = this.now();
    const p = localParts(now - workDayOffsetMs(tpl), tzMs);
    const day = (q: { y: number; m: number; d: number }) => `${q.y}-${p2(q.m)}-${p2(q.d)}`;
    switch (tpl.period) {
      case 'month':
        return { m: `${p.y}-${p2(p.m)}` };
      case 'week':
        return { w: isoWeekOf(p.y, p.m, p.d) };
      case 'range':
        return { from: day(localParts(now - 6 * 86_400_000, tzMs)), to: day(p) };
      default:
        return { d: day(p) };
    }
  }

  async #run(seq: number): Promise<void> {
    const tpl = this.template;
    const src = this.source;
    if (!tpl || !src) {
      this.#show(seq, null, null);
      return;
    }
    const kind = tpl.kind ?? 'table';
    const events = kind === 'alarm' || kind === 'logic';
    if (events && !this.events)
      return this.#show(seq, null, { kind: 'info', text: t('rpt.pv.noEvents') });
    if (!events && !tpl.group)
      return this.#show(seq, null, { kind: 'info', text: t('rpt.pv.noGroup') });
    if (!events && (tpl.columns ?? []).length === 0)
      return this.#show(seq, null, { kind: 'info', text: t('rpt.pv.noColumns') });
    this.loading = true;
    const ac = new AbortController();
    this.#ac = ac;
    try {
      if (events) {
        let tz = localTz(this.now());
        try {
          const cat = await src.catalog();
          if (cat.enabled && cat.groups[0]) tz = cat.groups[0].timeZone;
        } catch {
          /* alarm, logic không cần lưu trữ */
        }
        this.#tz = tz;
      } else {
        const cat = await src.catalog();
        if (seq !== this.#seq) return;
        if (!cat.enabled)
          return this.#show(seq, null, { kind: 'disabled', text: t('rpt.pv.noHistory') });
        const g = cat.groups.find((x) => x.id === tpl.group);
        if (!g) return this.#show(seq, null, { kind: 'info', text: t('rpt.pv.noGroup') });
        this.#tz = g.timeZone;
      }
      if (seq !== this.#seq) return;
      const want = this.period ?? {};
      const sel = (this.#sel = validSelection(tpl, want) ? want : this.#defaultSel(tpl, this.#tz));
      const table = await runReport({
        template: tpl,
        select: sel,
        tz: this.#tz,
        now: this.now(),
        signal: ac.signal,
        history: src,
        ...(this.events ? { events: this.events } : {}),
        shiftWord: t('rpt.shiftWord'),
        fnNames: fnNames(),
        coverageLabel: t('rpt.x.coverage'),
        ...(this.org ? { org: this.org } : {}),
        ...(this.tagInfo ? { tagInfo: this.tagInfo } : {}),
        notes: { startsCapped: t('rpt.pv.startsCapped'), noLogic: t('rpt.pv.noLogic') },
      });
      if (seq !== this.#seq) return;
      const hasData =
        events || table.rows.some((r) => !r.pending && r.cells.some((c) => c !== null));
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
      case 'NOT_SUPPORTED':
        return { kind: 'info', text: t('rpt.pv.noEvents') };
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
    if (!tbl || !tpl || !this.save) return;
    const labels = exportLabels();
    const meta: ExportMeta = {
      exportedBy: this.userName,
      exportedAt: this.now(),
      tz: this.#tz,
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
      const s = this.#sel;
      const key = s.m ?? s.w ?? s.d ?? (s.from ? `${s.from}_${s.to}` : '');
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

  #periodInputs(tpl: SchemaTemplate | undefined) {
    const set = (patch: ReportSelection) => {
      this.period = { ...this.#sel, ...patch };
    };
    const input = (key: keyof ReportSelection, type: string, label: string) =>
      html`<label class="rp-period">
        <span>${label}</span>
        <input
          type=${type}
          data-role=${key === 'to' ? 'period-to' : 'period'}
          .value=${this.#sel[key] ?? ''}
          ?disabled=${!tpl}
          @change=${(e: Event) => set({ [key]: (e.target as HTMLInputElement).value })}
        />
      </label>`;
    switch (tpl?.period) {
      case 'month':
        return input('m', 'month', t('rpt.pv.month'));
      case 'week':
        return input('w', 'week', t('rpt.pv.week'));
      case 'range':
        return html`${input('from', 'date', t('rpt.pv.from'))}
        ${input('to', 'date', t('rpt.pv.to'))}`;
      default:
        return input('d', 'date', tpl?.period === 'shift' ? t('rpt.pv.workDay') : t('rpt.pv.day'));
    }
  }

  protected override render() {
    const tpl = this.template;
    const msg = this.msg;
    return html`<section
      class="rp"
      aria-label=${t('rpt.pv.title')}
      aria-busy=${this.loading ? 'true' : 'false'}
    >
      <div class="rp-bar">
        ${this.#periodInputs(tpl)}
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
      ${
        this.table
          ? html`<mat-report-view
              class="rp-view"
              compact
              selectable
              .selected=${this.selected}
              .labels=${viewLabels()}
              .table=${this.table}
            ></mat-report-view>`
          : nothing
      }
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
