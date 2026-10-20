// `<mat-report-view>` (feature 015, FR-004; specs/015-reports/plan.md): dựng MỘT ReportTable (history-math) thành báo cáo
// trên trang: dải tiêu đề (đơn vị, tên, kỳ), hàng thẻ chỉ số màu đặc như `stat-tile` của 014 (bảng `--mat-tile-*`, chữ
// trắng ≥ 4,5:1), khung biểu đồ có tiêu đề (ECharts lite nạp lười, tooltip dựng bằng DOM), bảng số liệu có sọc và hàng
// tổng nổi bật, các bảng phụ (thống kê, danh sách sự kiện) và ghi chú. Dùng chung cho trang Báo cáo của runtime-web và
// khung Xem trước của trình thiết kế báo cáo trong Studio: cùng mã dựng, cùng số. Mọi chữ qua binding của Lit (văn bản
// thuần); ECharts chỉ nhận chuỗi thuần.
import type { ReportChart, ReportColumnOut, ReportTable } from '@mat/history-math';
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import {
  baseOption,
  loadECharts,
  prefersReducedMotion,
  readChartTheme,
  tooltipContent,
  type ChartInstance,
} from '../chart/echarts-lite.ts';
import { viReport, type ReportViewLabels } from '../i18n/report-vi.ts';

const LOW_COVERAGE = 0.95;

/** Tiêu đề cột: nhãn (đơn vị) · tên hàm; cột thường (sự kiện) không kèm hàm. */
export function reportColumnHeader(c: ReportColumnOut, l: ReportViewLabels): string {
  const base = `${c.label}${c.unit ? ` (${c.unit})` : ''}`;
  return c.plain ? base : `${base} · ${l.fn[c.fn] ?? c.fn}`;
}

export class MatReportView extends LitElement {
  static override properties = {
    table: { attribute: false },
    labels: { attribute: false },
    compact: { type: Boolean, reflect: true },
  };

  declare table: ReportTable | null;
  declare labels: ReportViewLabels;
  /** Khung hẹp (xem trước Studio): thẻ nhỏ hơn, biểu đồ thấp hơn. */
  declare compact: boolean;

  #chart: ChartInstance | null = null;
  #chartBox: HTMLElement | null = null;
  #ro: ResizeObserver | null = null;
  #seq = 0;

  constructor() {
    super();
    this.table = null;
    this.labels = viReport;
    this.compact = false;
  }

  static override styles = css`
    :host {
      display: block;
      color: var(--mat-text, #1a2225);
      font-family: var(--mat-font, system-ui, sans-serif);
      font-size: 14px;
      container-type: inline-size;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    .doc {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .band {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px 24px;
      flex-wrap: wrap;
      padding: 14px 18px;
      border-radius: var(--mat-radius-lg, 10px);
      color: var(--mat-accent-ink, #fff);
      background: linear-gradient(
        120deg,
        var(--mat-accent, #0b7285) 0%,
        color-mix(in srgb, var(--mat-accent, #0b7285) 78%, #000) 100%
      );
      box-shadow: var(--mat-shadow-card, none);
    }
    .org {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      opacity: 0.9;
    }
    .title {
      margin: 2px 0 0;
      font-size: 20px;
      line-height: 1.25;
      font-weight: 700;
    }
    .period {
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
    }
    .tile {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      min-height: 92px;
      padding: 12px 16px;
      overflow: hidden;
      color: var(--mat-tile-ink, #fff);
      background: linear-gradient(135deg, var(--c) 0%, color-mix(in srgb, var(--c) 80%, #000) 100%);
      border-radius: var(--mat-radius-lg, 10px);
      box-shadow: var(--mat-shadow-card, none);
    }
    .tile .label {
      font-size: 13px;
      font-weight: 500;
      opacity: 0.95;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tile .main {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }
    .tile .value {
      font-size: clamp(22px, 4.5cqw, 34px);
      font-weight: 700;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .tile .unit {
      font-size: 14px;
      font-weight: 500;
      opacity: 0.92;
    }
    .frame {
      margin: 0;
      background: var(--mat-surface, #fff);
      border: 1px solid var(--mat-border, #d2d9dc);
      border-radius: var(--mat-radius-lg, 10px);
      box-shadow: var(--mat-shadow-card, none);
      overflow: hidden;
    }
    .head {
      display: block;
      padding: 9px 14px 8px;
      font-size: 13px;
      line-height: 18px;
      font-weight: 600;
      background: var(--mat-surface-2, #f5f7f8);
      border-bottom: 1px solid var(--mat-border, #d2d9dc);
    }
    .ec {
      width: 100%;
      height: 280px;
    }
    :host([compact]) .ec {
      height: 220px;
    }
    :host([compact]) .tile {
      min-height: 76px;
    }
    .scroll {
      max-height: min(72vh, 760px);
      overflow: auto;
    }
    .scroll:focus-visible {
      outline: 2px solid var(--mat-focus, var(--mat-accent, #0b7285));
      outline-offset: -2px;
    }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      padding: 7px 12px;
      text-align: left;
      white-space: nowrap;
      border-bottom: 1px solid var(--mat-border, #d2d9dc);
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      font-size: 12.5px;
      font-weight: 600;
      color: var(--mat-accent-ink, #fff);
      background: var(--mat-accent, #0b7285);
      border-bottom: none;
    }
    thead th.num,
    td.num {
      text-align: right;
    }
    tbody tr:nth-child(even) > * {
      background: var(--mat-surface-2, #f5f7f8);
    }
    tbody th {
      font-weight: 600;
    }
    td.wrap {
      white-space: normal;
      min-width: 160px;
    }
    td.pending {
      color: var(--mat-text-muted, #56646a);
      font-style: italic;
    }
    td.miss {
      color: var(--mat-warn, #8f5e00);
      text-decoration: underline dotted;
    }
    tr.total > * {
      font-weight: 700;
      background: color-mix(in srgb, var(--mat-accent, #0b7285) 12%, var(--mat-surface, #fff));
      border-top: 2px solid var(--mat-accent, #0b7285);
      border-bottom: none;
      position: sticky;
      bottom: 0;
    }
    .notes {
      margin: 0;
      padding: 0 4px;
      color: var(--mat-text-muted, #56646a);
      font-size: 13px;
    }
    .notes p {
      margin: 2px 0;
    }
    .empty {
      padding: 14px;
      color: var(--mat-text-muted, #56646a);
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#ro?.disconnect();
    this.#ro = null;
    this.#chart?.dispose();
    this.#chart = null;
    this.#chartBox = null;
  }

  protected override render(): TemplateResult | typeof nothing {
    const t = this.table;
    if (!t) return nothing;
    const l = this.labels;
    return html`<article class="doc" aria-label=${`${t.title} ${t.periodLabel}`}>
      <header class="band">
        <div>
          ${t.org ? html`<div class="org">${t.org}</div>` : nothing}
          <h2 class="title">${t.title}</h2>
        </div>
        <div class="period">${l.period}: ${t.periodLabel}</div>
      </header>
      ${this.#tiles(t)} ${this.#chartFrame(t.chart ?? null)} ${this.#mainTable(t)}
      ${(t.sections ?? []).map(
        (s, i) =>
          html`<figure class="frame section" data-section=${i}>
            <figcaption class="head">${s.title}</figcaption>
            ${
              s.rows.length === 0
                ? html`<div class="empty">${l.noRows}</div>`
                : html`<div class="scroll" tabindex="0" role="region" aria-label=${s.title}>
                    <table>
                      <thead>
                        <tr>
                          ${s.columns.map(
                            (c) =>
                              html`<th scope="col" class=${c.numeric ? 'num' : ''}>${c.label}</th>`,
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        ${s.rows.map(
                          (r) =>
                            html`<tr>
                              ${r.map(
                                (v, k) =>
                                  html`<td
                                    class=${s.columns[k]?.numeric ? 'num' : k === r.length - 1 || v.length > 40 ? 'wrap' : ''}
                                  >
                                    ${v}
                                  </td>`,
                              )}
                            </tr>`,
                        )}
                      </tbody>
                    </table>
                  </div>`
            }
          </figure>`,
      )}
      ${this.#notes(t)}
    </article>`;
  }

  #tiles(t: ReportTable): TemplateResult | typeof nothing {
    const tiles = t.tiles ?? [];
    if (tiles.length === 0) return nothing;
    return html`<div class="tiles">
      ${tiles.map(
        (x) =>
          html`<div
            class="tile"
            role="group"
            aria-label=${`${x.label}: ${x.text}${x.unit ? ' ' + x.unit : ''}`}
            style=${`--c: var(--mat-tile-${x.color}, #0f7f75)`}
          >
            <div class="label">${x.label}</div>
            <div class="main">
              <span class="value">${x.text}</span
              >${x.unit ? html`<span class="unit">${x.unit}</span>` : nothing}
            </div>
          </div>`,
      )}
    </div>`;
  }

  #chartFrame(c: ReportChart | null): TemplateResult | typeof nothing {
    if (!c) return nothing;
    return html`<figure class="frame chart">
      <figcaption class="head">${c.title}</figcaption>
      <div class="ec" role="img" aria-label=${`${c.title}. ${this.labels.chartHint}`}></div>
    </figure>`;
  }

  #mainTable(t: ReportTable): TemplateResult {
    const l = this.labels;
    const n = t.columns.length;
    return html`<figure class="frame main">
      <figcaption class="head">${l.tableTitle}</figcaption>
      <div
        class="scroll"
        tabindex="0"
        role="region"
        aria-label=${`${l.tableTitle} ${t.periodLabel}`}
      >
        <table class="rpt">
          <caption class="sr-only">
            ${t.title} ${t.periodLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">${t.rowHeader ?? l.rowHeader}</th>
              ${t.columns.map(
                (c) => html`<th scope="col" class="num">${reportColumnHeader(c, l)}</th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${t.rows.map((r) => {
              const low = t.showCoverage !== false && !r.pending && r.coverage < LOW_COVERAGE;
              return html`<tr>
                <th scope="row">${r.label}</th>
                ${
                  r.pending
                    ? html`<td class="pending" colspan=${n}>${l.pending}</td>`
                    : r.text.map(
                        (s) =>
                          html`<td
                            class=${low ? 'num miss' : 'num'}
                            title=${low ? l.missingCell : nothing}
                          >
                            ${s}
                          </td>`,
                      )
                }
              </tr>`;
            })}
            ${
              t.totalsText
                ? html`<tr class="total">
                    <th scope="row">${l.total}</th>
                    ${t.totalsText.map((s) => html`<td class="num">${s}</td>`)}
                  </tr>`
                : nothing
            }
          </tbody>
        </table>
      </div>
    </figure>`;
  }

  #notes(t: ReportTable): TemplateResult | typeof nothing {
    const lines = [...(t.notes ?? [])];
    if (t.showCoverage !== false) lines.unshift(l10nCoverage(this.labels, t.coverage));
    if (lines.length === 0) return nothing;
    return html`<div class="notes coverage">${lines.map((s) => html`<p>${s}</p>`)}</div>`;
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    void this.#drawChart();
  }

  /** Vẽ biểu đồ sau mỗi lần dựng; phần tử `.ec` mới (bảng khác) thì khởi tạo lại. */
  async #drawChart(): Promise<void> {
    const seq = ++this.#seq;
    const c = this.table?.chart ?? null;
    const box = this.renderRoot.querySelector<HTMLElement>('.ec');
    if (!c || !box) {
      this.#chart?.dispose();
      this.#chart = null;
      this.#chartBox = null;
      return;
    }
    let lib;
    try {
      lib = await loadECharts();
    } catch {
      return; // không nạp được: bảng số liệu vẫn đủ
    }
    if (seq !== this.#seq || !box.isConnected) return;
    if (this.#chartBox !== box) {
      this.#chart?.dispose();
      this.#chart = lib.init(box);
      this.#chartBox = box;
      this.#ro?.disconnect();
      if (typeof ResizeObserver !== 'undefined') {
        this.#ro = new ResizeObserver(() => this.#chart?.resize());
        this.#ro.observe(box);
      }
    }
    this.#chart!.setOption(this.#option(c), { notMerge: true });
  }

  #option(c: ReportChart): Record<string, unknown> {
    const th = readChartTheme(this);
    const reduced = prefersReducedMotion(this.ownerDocument.defaultView);
    const many = c.series.length > 1;
    const fmt = (v: number) =>
      new Intl.NumberFormat('vi-VN', {
        minimumFractionDigits: Number.isInteger(v) ? 0 : c.decimals,
        maximumFractionDigits: Number.isInteger(v) ? 0 : c.decimals,
      }).format(v);
    const doc = this.ownerDocument;
    return {
      ...baseOption(th, reduced),
      legend: many
        ? {
            top: 6,
            right: 12,
            icon: 'roundRect',
            itemWidth: 12,
            itemHeight: 8,
            textStyle: { color: th.text, fontFamily: th.font, fontSize: 12 },
          }
        : { show: false },
      grid: { left: 14, right: 18, top: many ? 40 : 28, bottom: 8 },
      tooltip: {
        ...(baseOption(th, reduced) as { tooltip: object }).tooltip,
        trigger: 'axis',
        axisPointer: { type: c.kind === 'bar' ? 'shadow' : 'line' },
        formatter: (ps: Array<{ dataIndex: number; seriesIndex: number; color: string }>) => {
          const i = ps[0]?.dataIndex ?? 0;
          return tooltipContent(
            doc,
            c.categories[i] ?? '',
            ps.map((p) => {
              const v = c.series[p.seriesIndex]?.values[i] ?? null;
              return {
                color: String(p.color),
                name: c.series[p.seriesIndex]?.name ?? '',
                value: v === null ? '–' : `${fmt(v)}${c.unit ? ' ' + c.unit : ''}`,
              };
            }),
          );
        },
      },
      xAxis: {
        type: 'category',
        data: c.categories,
        boundaryGap: c.kind === 'bar',
        axisLine: { lineStyle: { color: th.borderStrong } },
        axisTick: { show: false },
        axisLabel: { color: th.muted, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        name: c.unit,
        scale: c.kind === 'line',
        nameTextStyle: { color: th.muted, fontSize: 11, align: 'left' },
        axisLabel: { color: th.muted, fontSize: 11, formatter: fmt },
        splitLine: { lineStyle: { color: th.border, type: [3, 3] } },
      },
      series: c.series.map((s) =>
        c.kind === 'bar'
          ? {
              type: 'bar',
              name: s.name,
              data: s.values.map((v) => v ?? '-'),
              barMaxWidth: 28,
              barGap: '12%',
              itemStyle: { borderRadius: [4, 4, 0, 0] },
            }
          : {
              type: 'line',
              name: s.name,
              data: s.values.map((v) => v ?? '-'),
              showSymbol: c.categories.length <= 31,
              symbolSize: 6,
              lineStyle: { width: 2 },
              ...(many ? {} : { areaStyle: { opacity: 0.12 } }),
            },
      ),
    };
  }
}

const l10nCoverage = (l: ReportViewLabels, cov: number) =>
  l.coverage(`${(cov * 100).toFixed(1).replace('.', ',')} %`);

if (!customElements.get('mat-report-view')) customElements.define('mat-report-view', MatReportView);

declare global {
  interface HTMLElementTagNameMap {
    'mat-report-view': MatReportView;
  }
}
