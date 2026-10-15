// Trang báo cáo `#/report/<id>` (feature 010, FR-040, FR-041; contracts/templates-config.md §4, §5, §6). Chọn kỳ
// (ngày, ngày làm việc cho ca, hoặc tháng), nút Xem gọi `aggregate` theo `reportRequest` (chia lô ≤ 16 Tag, qua hàng
// đợi chung của trang), dựng bảng bằng `buildReport` của @mat/history-math (một ReportTable cho màn hình, CSV,
// XLSX và PDF nên khớp 100 % ô). Xuất file chạy HOÀN TOÀN trên trình duyệt: không gọi lại thiết bị. Mọi chữ do
// textContent; tên mẫu, nhãn cột là văn bản thuần.
import {
  buildReport,
  localParts,
  parseUtcOffset,
  reportRequest,
  type AggregateResult as MathAggregate,
  type ReportTable,
  type ReportTemplate,
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
} from '@mat/report-export';
import type { HistoryCatalogGroup, HistorySource } from '@mat/ui-components';
import { viHist } from './i18n/vi-history.ts';
import { exportLabels } from './i18n/vi-report.ts';

export interface ReportTemplateDoc extends ReportTemplate {
  group: string;
  paper?: { size?: 'A4' | 'A3'; orientation?: 'portrait' | 'landscape' };
}
export interface ReportsFile {
  reports: ReportTemplateDoc[];
}

export interface ReportExporter {
  csv(t: ReportTable, labels: ExportLabels, style: CsvStyle): Uint8Array;
  xlsx(t: ReportTable, meta: ExportMeta, labels: ExportLabels): Promise<Uint8Array>;
  pdf(t: ReportTable, meta: ExportMeta, labels: ExportLabels, footer?: string): Promise<Uint8Array>;
}

export const defaultExporter: ReportExporter = { csv: exportCsv, xlsx: exportXlsx, pdf: exportPdf };

export interface ReportPageOptions {
  container: HTMLElement;
  history: HistorySource;
  now: () => number;
  loadReports: () => Promise<ReportsFile | null>;
  userName: () => string;
  tagInfo?: (tagId: string) => { description?: string; unit?: string } | undefined;
  onUrl: (hash: string) => void;
  download: (name: string, mime: string, bytes: Uint8Array) => void;
  exporter?: ReportExporter;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const p2 = (n: number) => String(n).padStart(2, '0');
const LOW_COVERAGE = 0.95;

export class ReportPage {
  readonly #o: ReportPageOptions;
  readonly #exp: ReportExporter;
  #tpl: ReportTemplateDoc | null = null;
  #group: HistoryCatalogGroup | null = null;
  #sel: { d?: string; m?: string } = {};
  #table: ReportTable | null = null;
  #seq = 0;
  #unsub: (() => void) | null = null;
  #disposed = false;
  #ac: AbortController | null = null;
  #id = '';
  #params = new URLSearchParams();
  #out: HTMLElement | null = null;
  #buttons: Record<string, HTMLButtonElement> = {};
  #stateKind: 'ok' | 'login' | 'other' = 'other';

  constructor(o: ReportPageOptions) {
    this.#o = o;
    this.#exp = o.exporter ?? defaultExporter;
    this.#unsub = o.history.onState((s) => {
      if (this.#disposed || o.container.hidden) return;
      if (s === 'ready' && this.#stateKind === 'login' && this.#id)
        void this.show(this.#id, this.#params);
    });
  }

  /** Hủy yêu cầu aggregate đang bay (chạy lại, rời trang, dispose): không giữ chỗ phiên ở máy chủ. */
  #abort(): void {
    this.#ac?.abort();
    this.#ac = null;
  }

  hide(): void {
    this.#seq++; // kết quả muộn của lần chạy bị hủy không được vẽ vào trang đã ẩn
    this.#abort();
    this.#o.container.hidden = true;
  }

  dispose(): void {
    this.#abort();
    this.#disposed = true;
    this.#unsub?.();
    this.#unsub = null;
    this.#o.container.replaceChildren();
  }

  async show(id: string, params: URLSearchParams): Promise<void> {
    const seq = ++this.#seq;
    this.#abort();
    this.#id = id;
    this.#params = params;
    this.#table = null;
    const c = this.#o.container;
    c.hidden = false;
    c.replaceChildren(el('p', 'hint', '…'));
    let file: ReportsFile | null;
    try {
      file = await this.#o.loadReports();
    } catch {
      if (seq === this.#seq) this.#message(viHist.loadError);
      return;
    }
    if (seq !== this.#seq || this.#disposed) return;
    if (!file || file.reports.length === 0) return this.#message(viHist.report.noReports);
    const tpl = file.reports.find((r) => r.id === id);
    if (!tpl) return this.#message(viHist.report.notFound(id));
    this.#tpl = tpl;
    let cat;
    try {
      cat = await this.#o.history.catalog();
    } catch (e) {
      if (seq === this.#seq && !this.#disposed) this.#fail(e);
      return;
    }
    if (seq !== this.#seq || this.#disposed) return;
    if (!cat.enabled) return this.#message(viHist.disabled);
    const g = cat.groups.find((x) => x.id === tpl.group);
    if (!g) return this.#message(`${viHist.report.noGroup} "${tpl.group}"`);
    this.#group = g;
    this.#stateKind = 'ok';
    this.#build(tpl, g);
    const auto =
      (tpl.period === 'month' ? params.get('m') : params.get('d')) !== null &&
      this.#validSel() !== null;
    if (auto) void this.#run();
  }

  // ---- giao diện ---------------------------------------------------------------------------------------------

  #message(text: string, kind: 'login' | 'other' = 'other', extra?: HTMLElement): void {
    this.#stateKind = kind;
    const p = el('p', 'hist-msg', text);
    p.setAttribute('role', 'status');
    this.#o.container.replaceChildren(
      ...(this.#tpl ? [el('h2', undefined, this.#tpl.name)] : []),
      p,
      ...(extra ? [extra] : []),
    );
  }

  #loginButton(): HTMLButtonElement {
    const b = el('button', 'btn login', viHist.loginButton);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (this.#o.history.requestLogin) this.#o.history.requestLogin();
    });
    return b;
  }

  #fail(e: unknown): void {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED' || code === 'SESSION_INVALID')
      return this.#message(viHist.report.loginRequired, 'login', this.#loginButton());
    if (code === 'HTTPS_REQUIRED') return this.#message(viHist.insecure, 'login');
    if (code === 'NO_HISTORY') return this.#message(viHist.disabled);
    this.#message(viHist.loadError);
  }

  #defaultSel(tpl: ReportTemplateDoc, g: HistoryCatalogGroup): { d?: string; m?: string } {
    const p = localParts(this.#o.now(), parseUtcOffset(g.timeZone));
    return tpl.period === 'month'
      ? { m: `${p.y}-${p2(p.m)}` }
      : { d: `${p.y}-${p2(p.m)}-${p2(p.d)}` };
  }

  #build(tpl: ReportTemplateDoc, g: HistoryCatalogGroup): void {
    const month = tpl.period === 'month';
    const asked = this.#params.get(month ? 'm' : 'd');
    const ok = asked !== null && (month ? MONTH_RE : DAY_RE).test(asked);
    this.#sel = ok ? (month ? { m: asked } : { d: asked }) : this.#defaultSel(tpl, g);

    const input = el('input');
    input.type = month ? 'month' : 'date';
    input.id = 'rpt-period';
    input.value = (month ? this.#sel.m : this.#sel.d) ?? '';
    input.addEventListener('change', () => {
      this.#sel = month ? { m: input.value } : { d: input.value };
    });
    const label = el(
      'label',
      'hist-field',
      (tpl.period === 'shift'
        ? viHist.report.workDay
        : month
          ? viHist.report.month
          : viHist.report.day) + ' ',
    );
    label.htmlFor = 'rpt-period';
    label.append(input);

    const view = el('button', 'btn view', viHist.report.view);
    view.type = 'button';
    view.addEventListener('click', () => void this.#run());

    const bar = el('div', 'rpt-bar');
    const grow = el('span', 'grow');
    bar.append(label, view, grow);
    const defs: Array<[string, string, () => Promise<void>]> = [
      ['csv', viHist.report.csv, () => this.#export('csv')],
      ['csv-vi', viHist.report.csvVi, () => this.#export('csv-excel')],
      ['xlsx', viHist.report.xlsx, () => this.#export('xlsx')],
      ['pdf', viHist.report.pdf, () => this.#export('pdf')],
    ];
    this.#buttons = {};
    for (const [cls, text, fn] of defs) {
      const b = el('button', `btn ${cls}`, text);
      b.type = 'button';
      b.disabled = true;
      b.addEventListener('click', () => void fn());
      this.#buttons[cls] = b;
      bar.append(b);
    }
    this.#out = el('div', 'rpt-out');
    const h = el('h2', undefined, tpl.name);
    this.#o.container.replaceChildren(h, bar, this.#out);
    void g;
  }

  #validSel(): { d?: string; m?: string } | null {
    const tpl = this.#tpl;
    if (!tpl) return null;
    const month = tpl.period === 'month';
    const v = month ? this.#sel.m : this.#sel.d;
    return v && (month ? MONTH_RE : DAY_RE).test(v) ? this.#sel : null;
  }

  #setExport(on: boolean): void {
    for (const b of Object.values(this.#buttons)) b.disabled = !on;
  }

  #status(text: string, alert = false, retry = false): void {
    const out = this.#out;
    if (!out) return;
    const p = el('p', alert ? 'hist-msg err' : 'hist-msg', text);
    p.setAttribute('role', alert ? 'alert' : 'status');
    const nodes: HTMLElement[] = [p];
    if (retry) {
      const b = el('button', 'btn retry', viHist.retry);
      b.type = 'button';
      b.addEventListener('click', () => void this.#run());
      nodes.push(b);
    }
    out.replaceChildren(...nodes);
  }

  // ---- dựng báo cáo ------------------------------------------------------------------------------------------

  async #run(): Promise<void> {
    const tpl = this.#tpl;
    const g = this.#group;
    const sel = this.#validSel();
    if (!tpl || !g || !sel) return;
    const seq = ++this.#seq;
    this.#table = null;
    this.#setExport(false);
    this.#status(viHist.report.loading);
    const tzMs = parseUtcOffset(g.timeZone);
    const req = reportRequest(tpl, sel, tzMs, viHist.shiftWord);
    this.#abort();
    const ac = new AbortController();
    this.#ac = ac;
    let aggs: MathAggregate[];
    try {
      aggs = (await Promise.all(
        req.batches.map((tags) =>
          this.#o.history.aggregate(
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
      )) as MathAggregate[];
    } catch (e) {
      if (seq !== this.#seq || this.#disposed) return;
      const code = (e as { code?: string }).code ?? '';
      if (code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED') return this.#fail(e);
      if (code === 'RANGE_TOO_LARGE') return this.#status(viHist.report.narrowPeriod, true);
      return this.#status(viHist.loadError, true, true);
    }
    if (seq !== this.#seq || this.#disposed) return;
    const tagInfo: Record<string, { description?: string; unit?: string }> = {};
    for (const c of tpl.columns) {
      const i = this.#o.tagInfo?.(c.tagId);
      if (i) tagInfo[c.tagId] = i;
    }
    const table = buildReport({
      template: tpl,
      select: sel,
      tz: g.timeZone,
      now: this.#o.now(),
      shiftWord: viHist.shiftWord,
      tagInfo,
      aggregates: aggs,
    });
    // Ghi kỳ vào đường dẫn để F5 giữ lựa chọn.
    this.#o.onUrl(`#/report/${tpl.id}?${tpl.period === 'month' ? `m=${sel.m}` : `d=${sel.d}`}`);
    const hasData = table.rows.some((r) => !r.pending && r.cells.some((c) => c !== null));
    if (!hasData) return this.#status(viHist.report.empty);
    this.#table = table;
    this.#render(table);
    this.#setExport(true);
  }

  #render(t: ReportTable): void {
    const out = this.#out;
    if (!out) return;
    const nCols = t.columns.length;
    const head = el('tr');
    const th0 = el('th', undefined, viHist.report.time);
    th0.scope = 'col';
    head.append(th0);
    for (const c of t.columns) {
      const th = el(
        'th',
        undefined,
        `${c.label}${c.unit ? ` (${c.unit})` : ''} · ${exportLabels.fn[c.fn]}`,
      );
      th.scope = 'col';
      head.append(th);
    }
    const tbody = el('tbody');
    for (const r of t.rows) {
      const tr = el('tr');
      const lab = el('th', undefined, r.label);
      lab.scope = 'row';
      tr.append(lab);
      if (r.pending) {
        const td = el('td', 'pending', viHist.report.pending);
        td.colSpan = nCols;
        tr.append(td);
      } else {
        const low = r.coverage < LOW_COVERAGE;
        r.text.forEach((s) => {
          const td = el('td', `num${low ? ' miss' : ''}`, s);
          if (low) td.title = viHist.report.missingCell;
          tr.append(td);
        });
      }
      tbody.append(tr);
    }
    if (t.totalsText) {
      const tr = el('tr', 'total');
      const lab = el('th', undefined, viHist.report.total);
      lab.scope = 'row';
      tr.append(lab);
      for (const s of t.totalsText) tr.append(el('td', 'num', s));
      tbody.append(tr);
    }
    const table = el('table', 'rpt');
    const cap = el('caption', 'sr-only', `${t.title} ${t.periodLabel}`);
    const thead = el('thead');
    thead.append(head);
    table.append(cap, thead, tbody);
    const scroll = el('div', 'rpt-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', `${t.title || viHist.pageTitle} ${t.periodLabel}`);
    scroll.append(table);
    const cov = el(
      'p',
      'coverage hint',
      viHist.report.coverage(`${(t.coverage * 100).toFixed(1).replace('.', ',')} %`),
    );
    out.replaceChildren(scroll, cov);
  }

  // ---- xuất file ---------------------------------------------------------------------------------------------

  async #export(kind: 'csv' | 'csv-excel' | 'xlsx' | 'pdf'): Promise<void> {
    const t = this.#table;
    const tpl = this.#tpl;
    const g = this.#group;
    if (!t || !tpl || !g) return;
    const meta: ExportMeta = {
      exportedBy: this.#o.userName(),
      exportedAt: this.#o.now(),
      tz: g.timeZone,
      sheetName: tpl.name,
    };
    if (tpl.paper) meta.paper = tpl.paper;
    this.#out?.querySelector('[role="alert"]')?.remove();
    this.#setExport(false);
    try {
      let bytes: Uint8Array;
      if (kind === 'csv') bytes = this.#exp.csv(t, exportLabels, 'standard');
      else if (kind === 'csv-excel') bytes = this.#exp.csv(t, exportLabels, 'excel-vi');
      else if (kind === 'xlsx') bytes = await this.#exp.xlsx(t, meta, exportLabels);
      else bytes = await this.#exp.pdf(t, meta, exportLabels, tpl.footer ?? '');
      const f = EXPORT_FORMATS[kind];
      const key = this.#sel.m ?? this.#sel.d ?? '';
      this.#o.download(exportFileName(tpl.id, key, f.ext), f.mime, bytes);
    } catch {
      const name = kind === 'xlsx' ? 'XLSX' : kind === 'pdf' ? 'PDF' : 'CSV';
      const p = el('p', 'hist-msg err', viHist.report.exportFailed(name));
      p.setAttribute('role', 'alert');
      this.#out?.append(p);
    } finally {
      this.#setExport(this.#table !== null);
    }
  }
}
