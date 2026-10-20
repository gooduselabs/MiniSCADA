// Trang báo cáo `#/report/<id>` (feature 010, FR-040, FR-041; contracts/templates-config.md §4, §5, §6; feature 015:
// specs/015-reports/plan.md). Chọn kỳ (ngày, ngày làm việc cho ca, tuần ISO, tháng, khoảng ngày), nút Xem dựng MỘT
// ReportTable bằng @mat/history-math theo loại mẫu: bảng tổng hợp (`aggregate`, chia lô ≤ 16 Tag, qua hàng đợi chung của
// trang), thiết bị (giờ chạy từ `aggregate`, số lần bật từ dòng thô `rows`), alarm (`alarms/history`) hoặc logic
// (`logic/events`). Bảng hiện bằng `<mat-report-view>` (ui-components, cùng mã với xem trước Studio) và là nguồn của CSV,
// XLSX, PDF (khớp 100 % ô). Xuất file chạy HOÀN TOÀN trên trình duyệt: không gọi lại thiết bị. Mọi chữ do textContent
// hoặc binding của Lit; tên mẫu, nhãn cột là văn bản thuần.
import {
  isoWeekOf,
  localParts,
  parseUtcOffset,
  validSelection,
  workDayOffsetMs,
  type ReportSelection,
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
import {
  runReport,
  type HistoryCatalogGroup,
  type HistorySource,
  type ReportEventSource,
} from '@mat/ui-components';
import { viHist } from './i18n/vi-history.ts';
import { exportLabels, viewLabels } from './i18n/vi-report.ts';

export interface ReportTemplateDoc extends ReportTemplate {
  group?: string;
  paper?: { size?: 'A4' | 'A3'; orientation?: 'portrait' | 'landscape' };
}
export interface ReportsFile {
  org?: string;
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
  /** Nguồn alarm và logic (feature 015); thiếu thì mẫu alarm/logic báo "chưa hỗ trợ". */
  events?: ReportEventSource;
  /** Tên project: tên đơn vị mặc định khi reports.json không có `org`. */
  projectName?: () => string;
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

const p2 = (n: number) => String(n).padStart(2, '0');

/** Khóa đường dẫn của kỳ theo loại kỳ. */
const SEL_KEYS: Record<ReportTemplate['period'], Array<keyof ReportSelection>> = {
  day: ['d'],
  shift: ['d'],
  month: ['m'],
  week: ['w'],
  range: ['from', 'to'],
};

/** Độ lệch giờ địa phương của trình duyệt (`±HH:MM`): múi giờ của báo cáo alarm/logic khi không có nhóm lưu trữ. */
function browserTz(now: number): string {
  const off = -new Date(now).getTimezoneOffset();
  const a = Math.abs(off);
  return `${off < 0 ? '-' : '+'}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

export class ReportPage {
  readonly #o: ReportPageOptions;
  readonly #exp: ReportExporter;
  #tpl: ReportTemplateDoc | null = null;
  #org = '';
  #group: HistoryCatalogGroup | null = null;
  #tz = '+07:00';
  #sel: ReportSelection = {};
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

  /** Hủy yêu cầu đang bay (chạy lại, rời trang, dispose): không giữ chỗ phiên ở máy chủ. */
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

  #kind(): NonNullable<ReportTemplate['kind']> {
    return this.#tpl?.kind ?? 'table';
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
    this.#org = file.org ?? this.#o.projectName?.() ?? '';
    const events = tpl.kind === 'alarm' || tpl.kind === 'logic';
    let cat;
    try {
      cat = await this.#o.history.catalog();
    } catch (e) {
      if (seq !== this.#seq || this.#disposed) return;
      if (!events) return this.#fail(e);
      cat = null; // alarm, logic không cần lưu trữ: chỉ lấy múi giờ nếu có
    }
    if (seq !== this.#seq || this.#disposed) return;
    if (events) {
      this.#group = null;
      this.#tz = cat?.enabled
        ? (cat.groups[0]?.timeZone ?? browserTz(this.#o.now()))
        : browserTz(this.#o.now());
    } else {
      if (!cat!.enabled) return this.#message(viHist.disabled);
      const g = cat!.groups.find((x) => x.id === tpl.group);
      if (!g) return this.#message(`${viHist.report.noGroup} "${tpl.group}"`);
      this.#group = g;
      this.#tz = g.timeZone;
    }
    this.#stateKind = 'ok';
    this.#build(tpl);
    const asked = SEL_KEYS[tpl.period].every((k) => params.get(k) !== null);
    if (asked && this.#validSel() !== null) void this.#run();
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

  // Kỳ mặc định: ngày (tuần, tháng) đang chạy; mẫu theo ca lùi giờ bắt đầu ca 1 (ca đêm sau 00:00 vẫn thuộc ngày làm
  // việc hôm trước); khoảng: 7 ngày tới hôm nay.
  #defaultSel(tpl: ReportTemplateDoc): ReportSelection {
    const now = this.#o.now();
    const tz = parseUtcOffset(this.#tz);
    const p = localParts(now - workDayOffsetMs(tpl), tz);
    const day = (q: { y: number; m: number; d: number }) => `${q.y}-${p2(q.m)}-${p2(q.d)}`;
    switch (tpl.period) {
      case 'month':
        return { m: `${p.y}-${p2(p.m)}` };
      case 'week':
        return { w: isoWeekOf(p.y, p.m, p.d) };
      case 'range':
        return { from: day(localParts(now - 6 * 86_400_000, tz)), to: day(p) };
      default:
        return { d: day(p) };
    }
  }

  #build(tpl: ReportTemplateDoc): void {
    const keys = SEL_KEYS[tpl.period];
    const asked: ReportSelection = {};
    for (const k of keys) {
      const v = this.#params.get(k);
      if (v !== null) asked[k] = v;
    }
    this.#sel = validSelection(tpl, asked) ? asked : this.#defaultSel(tpl);

    const bar = el('div', 'rpt-bar');
    const field = (key: keyof ReportSelection, type: string, text: string) => {
      const input = el('input');
      input.type = type;
      input.id = `rpt-${key}`;
      input.value = this.#sel[key] ?? '';
      input.addEventListener('change', () => {
        this.#sel = { ...this.#sel, [key]: input.value };
      });
      const label = el('label', 'hist-field', `${text} `);
      label.htmlFor = input.id;
      label.append(input);
      bar.append(label);
    };
    const r = viHist.report;
    if (tpl.period === 'month') field('m', 'month', r.month);
    else if (tpl.period === 'week') field('w', 'week', r.week);
    else if (tpl.period === 'range') {
      field('from', 'date', r.from);
      field('to', 'date', r.to);
    } else field('d', 'date', tpl.period === 'shift' ? r.workDay : r.day);

    const view = el('button', 'btn view', r.view);
    view.type = 'button';
    view.addEventListener('click', () => void this.#run());
    bar.append(view, el('span', 'grow'));
    const defs: Array<[string, string, () => Promise<void>]> = [
      ['csv', r.csv, () => this.#export('csv')],
      ['csv-vi', r.csvVi, () => this.#export('csv-excel')],
      ['xlsx', r.xlsx, () => this.#export('xlsx')],
      ['pdf', r.pdf, () => this.#export('pdf')],
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
    const h = el('h2', 'rpt-name', tpl.name);
    this.#o.container.replaceChildren(h, bar, this.#out);
  }

  #validSel(): ReportSelection | null {
    const tpl = this.#tpl;
    if (!tpl) return null;
    return validSelection(tpl, this.#sel) ? this.#sel : null;
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
    const sel = this.#validSel();
    if (!tpl) return;
    if (!sel) return this.#status(viHist.report.badPeriod, true);
    const kind = this.#kind();
    if ((kind === 'table' || kind === 'equipment') && !this.#group) return;
    const seq = ++this.#seq;
    this.#table = null;
    this.#setExport(false);
    this.#status(viHist.report.loading);
    this.#abort();
    const ac = new AbortController();
    this.#ac = ac;
    let table: ReportTable;
    try {
      table = await runReport({
        template: tpl,
        select: sel,
        tz: this.#tz,
        now: this.#o.now(),
        signal: ac.signal,
        history: this.#o.history,
        ...(this.#o.events ? { events: this.#o.events } : {}),
        shiftWord: viHist.shiftWord,
        fnNames: exportLabels.fn,
        coverageLabel: exportLabels.coverage,
        org: this.#org,
        ...(this.#o.tagInfo ? { tagInfo: this.#o.tagInfo } : {}),
        notes: { startsCapped: viHist.report.startsCapped, noLogic: viHist.report.noLogic },
      });
    } catch (e) {
      if (seq !== this.#seq || this.#disposed) return;
      const code = (e as { code?: string }).code ?? '';
      if (code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED') return this.#fail(e);
      if (code === 'RANGE_TOO_LARGE') return this.#status(viHist.report.narrowPeriod, true);
      if (code === 'ACCESS_DENIED' || code === 'FORBIDDEN')
        return this.#status(
          kind === 'alarm' ? viHist.report.noAlarmAccess : viHist.report.noAccess,
          true,
        );
      if (code === 'NOT_SUPPORTED')
        return this.#status(
          kind === 'alarm' ? viHist.report.alarmUnsupported : viHist.report.logicUnsupported,
          true,
        );
      return this.#status(viHist.loadError, true, true);
    }
    if (seq !== this.#seq || this.#disposed) return;
    // Ghi kỳ vào đường dẫn để F5 giữ lựa chọn.
    const q = new URLSearchParams();
    for (const k of SEL_KEYS[tpl.period]) q.set(k, sel[k] ?? '');
    this.#o.onUrl(`#/report/${tpl.id}?${q.toString()}`);
    if (kind === 'table' || kind === 'equipment') {
      const hasData = table.rows.some((r) => !r.pending && r.cells.some((c) => c !== null));
      if (!hasData) return this.#status(viHist.report.empty);
    }
    this.#table = table;
    this.#render(table);
    this.#setExport(true);
  }

  #render(t: ReportTable): void {
    const out = this.#out;
    if (!out) return;
    const view = document.createElement('mat-report-view');
    view.labels = viewLabels;
    view.table = t;
    out.replaceChildren(view);
  }

  // ---- xuất file ---------------------------------------------------------------------------------------------

  async #export(kind: 'csv' | 'csv-excel' | 'xlsx' | 'pdf'): Promise<void> {
    const t = this.#table;
    const tpl = this.#tpl;
    if (!t || !tpl) return;
    const meta: ExportMeta = {
      exportedBy: this.#o.userName(),
      exportedAt: this.#o.now(),
      tz: this.#tz,
      sheetName: tpl.name,
    };
    if (tpl.paper) meta.paper = tpl.paper;
    // Màu báo cáo theo chủ đề của project (main.ts đặt data-mat-theme, feature 012 FR-038).
    const theme = document.documentElement.dataset.matTheme;
    if (theme === 'vivid' || theme === 'industrial' || theme === 'dark') meta.theme = theme;
    this.#out?.querySelector('[role="alert"]')?.remove();
    this.#setExport(false);
    try {
      let bytes: Uint8Array;
      if (kind === 'csv') bytes = this.#exp.csv(t, exportLabels, 'standard');
      else if (kind === 'csv-excel') bytes = this.#exp.csv(t, exportLabels, 'excel-vi');
      else if (kind === 'xlsx') bytes = await this.#exp.xlsx(t, meta, exportLabels);
      else bytes = await this.#exp.pdf(t, meta, exportLabels, tpl.footer ?? '');
      const f = EXPORT_FORMATS[kind];
      const s = this.#sel;
      const key = s.m ?? s.w ?? s.d ?? (s.from ? `${s.from}_${s.to}` : '');
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
