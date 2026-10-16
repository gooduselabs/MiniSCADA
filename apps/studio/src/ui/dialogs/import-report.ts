// Bảng báo cáo nhập SVG (feature 008, T058; mockup studio-svg.html cảnh 1): ba tab Đã loại / Đã chuyển / Cảnh báo, mỗi tab
// một bảng có tiêu đề cột bấm được để sắp xếp (aria-sort), vùng cuộn focus được. Chỉ hiển thị dữ liệu của
// `ImportReport` qua binding của Lit (thoát ký tự); không dựng HTML từ nội dung file. Dùng trong hộp thoại Nhập SVG.
import { html, LitElement, nothing, type TemplateResult } from 'lit';
import type { ImportReport } from '@mat/svg-import';
import { hasKey, t, type MessageKey } from '../../i18n/index.ts';
import { icon } from '../base.ts';

export type ReportTab = 'removed' | 'converted' | 'warnings';

interface Column {
  key: string;
  label: MessageKey;
  num?: boolean;
  mono?: boolean;
}

type Row = Record<string, string | number>;

const COLS: Record<ReportTab, readonly Column[]> = {
  removed: [
    { key: 'kind', label: 'imp.col.kind' },
    { key: 'name', label: 'imp.col.name', mono: true },
    { key: 'count', label: 'imp.col.count', num: true },
    { key: 'code', label: 'imp.col.code', mono: true },
    { key: 'reason', label: 'imp.col.reason' },
    { key: 'where', label: 'imp.col.where', mono: true },
  ],
  converted: [
    { key: 'what', label: 'imp.col.what' },
    { key: 'count', label: 'imp.col.count', num: true },
    { key: 'code', label: 'imp.col.code', mono: true },
    { key: 'note', label: 'imp.col.note' },
  ],
  warnings: [
    { key: 'code', label: 'imp.col.code', mono: true },
    { key: 'count', label: 'imp.col.count', num: true },
    { key: 'message', label: 'imp.col.note' },
  ],
};

const kindText = (k: string): string =>
  hasKey(`imp.kind.${k}`) ? t(`imp.kind.${k}` as MessageKey) : k;

/** Hàng của từng tab, từ báo cáo (thuần, test được). */
export function reportRows(report: ImportReport, tab: ReportTab): Row[] {
  if (tab === 'removed')
    return report.removed.map((r) => ({
      kind: kindText(r.kind),
      name: r.name,
      count: r.count,
      code: r.code,
      reason: r.reason,
      where: r.examples.join(', '),
    }));
  if (tab === 'converted')
    return report.converted.map((c) => ({
      what: c.what,
      count: c.count,
      code: c.code,
      note: c.note,
    }));
  return report.warnings.map((w) => ({ code: w.code, count: w.count, message: w.message }));
}

/** Câu tóm tắt thuộc tính bị loại: tên và tối đa 3 vị trí ví dụ (FR-020, US1-7); null nếu không loại thuộc tính nào. */
export function attributeSummary(report: ImportReport): string | null {
  const rows = report.removed.filter((r) => r.kind === 'attribute');
  if (rows.length === 0) return null;
  const names = [...new Set(rows.map((r) => r.name))];
  const shown = names.slice(0, 8).join(', ') + (names.length > 8 ? ', …' : '');
  const where = rows.flatMap((r) => r.examples).slice(0, 3);
  return where.length === 0
    ? t('imp.attrSummaryNoWhere', { names: shown })
    : t('imp.attrSummary', { names: shown, where: where.join(', ') });
}

/** Sắp xếp ổn định theo cột; số theo giá trị, chữ theo tiếng Việt. */
export function sortRows(rows: readonly Row[], key: string | null, dir: 'asc' | 'desc'): Row[] {
  if (key === null) return [...rows];
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const x = a.r[key];
      const y = b.r[key];
      const c =
        typeof x === 'number' && typeof y === 'number'
          ? x - y
          : String(x ?? '').localeCompare(String(y ?? ''), 'vi');
      return c !== 0 ? c * sign : a.i - b.i;
    })
    .map((e) => e.r);
}

export class MatImportReport extends LitElement {
  static override properties = {
    report: { attribute: false },
    tab: { state: true },
    sortKey: { state: true },
    sortDir: { state: true },
  };

  declare report: ImportReport | null;
  declare tab: ReportTab;
  declare sortKey: string | null;
  declare sortDir: 'asc' | 'desc';

  constructor() {
    super();
    this.report = null;
    this.tab = 'removed';
    this.sortKey = null;
    this.sortDir = 'asc';
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private setTab(tab: ReportTab): void {
    this.tab = tab;
    this.sortKey = null;
    this.sortDir = 'asc';
  }

  private toggleSort(key: string): void {
    if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
  }

  private tabButton(tab: ReportTab, label: MessageKey, count: number, cls: string): TemplateResult {
    return html`<button
      type="button"
      data-tab=${tab}
      aria-pressed=${this.tab === tab ? 'true' : 'false'}
      @click=${() => this.setTab(tab)}
    >
      ${icon(tab === 'removed' ? 'err' : tab === 'converted' ? 'info' : 'warn', `sm ${cls}`)}
      ${t(label)} <span class="badge ${cls === 'warn' ? 'warn' : cls}">${count}</span>
    </button>`;
  }

  protected override render(): TemplateResult | typeof nothing {
    const rep = this.report;
    if (!rep) return nothing;
    const cols = COLS[this.tab];
    const rows = sortRows(reportRows(rep, this.tab), this.sortKey, this.sortDir);
    return html`<div class="rep" role="group" aria-label=${t('imp.report')}>
      <div class="rep-tabs">
        <span class="rep-title">${t('imp.rep.title')}</span>
        ${this.tabButton('removed', 'imp.rep.removed', rep.removed.length, 'err')}
        ${this.tabButton('converted', 'imp.rep.converted', rep.converted.length, 'info')}
        ${this.tabButton('warnings', 'imp.rep.warnings', rep.warnings.length, 'warn')}
        <span class="grow"></span><span class="help">${t('imp.rep.sortHint')}</span>
      </div>
      ${
        this.tab === 'removed' && attributeSummary(rep) !== null
          ? html`<p class="rep-attrs" data-role="attr-summary">${attributeSummary(rep)}</p>`
          : nothing
      }
      <div class="rep-scroll" role="region" tabindex="0" aria-label=${t('imp.rep.scroll')}>
        <table class="grid" data-role="rep-table" data-tab=${this.tab}>
          <thead>
            <tr>
              ${cols.map(
                (c) =>
                  html`<th
                    scope="col"
                    class=${c.num ? 'num' : ''}
                    aria-sort=${
                      this.sortKey === c.key
                        ? this.sortDir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    <button
                      type="button"
                      class="th-sort"
                      data-col=${c.key}
                      @click=${() => this.toggleSort(c.key)}
                    >
                      ${t(c.label)}${
                        this.sortKey === c.key
                          ? html`<span aria-hidden="true"
                              >${this.sortDir === 'asc' ? ' ▲' : ' ▼'}</span
                            >`
                          : nothing
                      }
                    </button>
                  </th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${
              rows.length === 0
                ? html`<tr>
                    <td colspan=${cols.length} class="empty-row">${t('imp.rep.empty')}</td>
                  </tr>`
                : rows.map(
                    (r) =>
                      html`<tr>
                        ${cols.map(
                          (c) =>
                            html`<td
                              class=${[c.num ? 'num' : '', c.mono ? 'mono' : ''].join(' ').trim()}
                            >
                              ${r[c.key]}
                            </td>`,
                        )}
                      </tr>`,
                  )
            }
          </tbody>
        </table>
      </div>
    </div>`;
  }
}

customElements.define('mat-import-report', MatImportReport);

declare global {
  interface HTMLElementTagNameMap {
    'mat-import-report': MatImportReport;
  }
}
