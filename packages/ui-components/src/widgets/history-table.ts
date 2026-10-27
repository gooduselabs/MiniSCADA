// Widget `history-table` (feature 010, FR-033; contracts/widget-catalog-010.md §2): bảng dòng thô theo trang.
// Phân trang theo khóa `seq` (không trùng, không sót kể cả khi nhiều dòng cùng thời điểm): mỗi trang giữ `after` của
// nó trong một ngăn xếp nên "Trang trước" quay lại đúng dòng. Giá trị định dạng bằng formatValue (bảng giá trị, Bật/Tắt,
// chuỗi nguyên văn qua Lit nên không HTML). Liên kết Xuất CSV dùng exportUrl của nguồn.
import { css, html, nothing, type TemplateResult } from 'lit';
import { localTimeMs } from '../chart/history-fmt.ts';
import { tzOffsetMs } from '../chart/history-plot.ts';
import { baseRange, isRangeKey, RANGE_KEYS, type RangeKey } from '../chart/history-range.ts';
import { formatValue } from '../format/format-value.ts';
import type { HistoryCatalogGroup, RowsResult } from '../host/history-source.ts';
import type { TagInfo, TagType } from '../host/types.ts';
import { viHistory } from '../i18n/history-vi.ts';
import { historyBaseStyles, MatHistoryWidget } from './history-base.ts';

const MAX_COLUMNS = 32;

export class MatHistoryTable extends MatHistoryWidget {
  static override properties = {
    ...MatHistoryWidget.properties,
    _rows: { state: true },
    _page: { state: true },
    _order: { state: true },
    _rangeKey: { state: true },
    _query: { state: true },
  };
  static override styles = [
    MatHistoryWidget.styles,
    historyBaseStyles,
    css`
      .hsearch {
        width: 140px;
        min-width: 80px;
        height: 26px;
        padding: 0 6px;
        font: inherit;
        color: inherit;
        background: var(--mat-surface, #fff);
        border: 1px solid var(--mat-border-strong, #b3bec3);
        border-radius: var(--mat-radius, 4px);
      }
      .controls,
      .exportbar,
      .pager {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        align-items: center;
      }
      .controls .sp,
      .exportbar .sp,
      .pager .sp {
        flex: 1;
      }
      .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
        border: 1px solid var(--mat-border, #d2d9dc);
        border-radius: var(--mat-radius, 4px);
      }
      table.data {
        border-collapse: collapse;
        width: 100%;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      table.data th {
        position: sticky;
        top: 0;
        background: var(--mat-surface-2, #f5f7f8);
        text-align: left;
        font-weight: 600;
        padding: 3px 8px;
        border-bottom: 1px solid var(--mat-border, #d2d9dc);
        white-space: nowrap;
      }
      table.data td {
        padding: 2px 8px;
        border-bottom: 1px solid var(--mat-border, #d2d9dc);
        white-space: nowrap;
      }
      table.data td.num {
        text-align: right;
      }
      a.export {
        color: var(--mat-accent, #0b7285);
        font-size: 12px;
      }
      .hbtn[disabled] {
        opacity: 0.5;
        cursor: default;
      }
    `,
  ];

  declare _rows: RowsResult | null;
  declare _page: number;
  declare _order: 'asc' | 'desc';
  declare _rangeKey: RangeKey;
  /** Feature 029: ô tìm trong trang đang xem (lọc theo chữ đã định dạng, không phân biệt hoa thường). */
  declare _query: string;

  /** `after` của từng trang đã đi qua (trang 0 không có). */
  #afters: (number | undefined)[] = [undefined];
  #range = { from: 0, to: 1 };

  constructor() {
    super();
    this._rows = null;
    this._page = 0;
    this._order = 'desc';
    this._rangeKey = '24h';
    this._query = '';
  }

  // ---- cấu hình ----------------------------------------------------------------------------------------------

  #tags(): string[] {
    return this.tagsOf('columns').slice(0, MAX_COLUMNS);
  }

  #pageSize(): number {
    const v = this.prop('pageSize', 100);
    return Math.max(10, Math.min(500, Math.trunc(v)));
  }

  #labelOf(i: number): string {
    const labels = this.item?.props?.labels;
    const l = Array.isArray(labels) ? labels[i] : undefined;
    if (typeof l === 'string' && l) return l;
    const id = this.#tags()[i] ?? '';
    return this.source?.info(id)?.description || id;
  }

  #infoOf(tagId: string): TagInfo {
    const s = this.source?.info(tagId);
    if (s) return s;
    const c = this.group?.tags.find((t) => t.tagId === tagId);
    const info: TagInfo = {
      id: tagId,
      type: (c?.type ?? 'FLOAT64') as TagType,
      access: 'R',
      kind: 'external',
    };
    if (c?.unit) info.unit = c.unit;
    return info;
  }

  // ---- lớp nền ------------------------------------------------------------------------------------------------

  protected override hasData(): boolean {
    return !!this._rows && this._rows.rows.length > 0;
  }

  protected override onGroupReady(g: HistoryCatalogGroup): void {
    const raw = this.prop('range', '24h');
    this._rangeKey = isRangeKey(raw) ? raw : '24h';
    this._order = this.prop('order', 'desc') === 'asc' ? 'asc' : 'desc';
    const now = this.source ? this.source.now() : Date.now();
    this.#range = baseRange(this._rangeKey, now, tzOffsetMs(g.timeZone));
    this.#afters = [undefined];
    void this.#load(0);
  }

  protected override onDispose(): void {
    this._rows = null;
    this._page = 0;
    this.#afters = [undefined];
  }

  // ---- tải trang ---------------------------------------------------------------------------------------------

  async #load(page: number): Promise<void> {
    const g = this.group;
    const history = this.history;
    if (!g || !history) return;
    const after = this.#afters[page];
    const res = await this.run((signal) =>
      history.rows(
        {
          group: g.id,
          tags: this.#tags(),
          from: this.#range.from,
          to: this.#range.to,
          limit: this.#pageSize(),
          order: this._order,
          ...(after === undefined ? {} : { after }),
          priority: 'user',
        },
        signal,
      ),
    );
    if (!res) return;
    this._rows = res.value;
    this._page = page;
    if (res.value.next !== null) this.#afters[page + 1] = res.value.next;
    else this.#afters.length = page + 1;
    if (res.value.rows.length === 0) this._status = 'empty';
  }

  protected override retry(): void {
    if (this.group) void this.#load(this._page);
    else super.retry();
  }

  #chooseRange(k: RangeKey): void {
    this._rangeKey = k;
    const now = this.source ? this.source.now() : Date.now();
    this.#range = baseRange(k, now, tzOffsetMs(this.group?.timeZone ?? '+00:00'));
    this.#afters = [undefined];
    void this.#load(0);
  }

  #toggleOrder(): void {
    this._order = this._order === 'desc' ? 'asc' : 'desc';
    this.#afters = [undefined];
    void this.#load(0);
  }

  // ---- giao diện ---------------------------------------------------------------------------------------------

  #cell(info: TagInfo, v: number | string | boolean | null): { text: string; num: boolean } {
    const table = info.valueTable ? this.source?.valueTable(info.valueTable) : undefined;
    const f = formatValue({ value: v, quality: 'GOOD' }, info, {
      decimals: this.decimals(info),
      unit: null,
      ...(table ? { table } : {}),
    });
    return { text: f.text, num: typeof v === 'number' };
  }

  protected override renderWidget(): TemplateResult {
    const tz = this.group?.timeZone ?? '+00:00';
    const rows = this._rows;
    const tags = this.#tags();
    const cols = rows ? rows.columns.map((c) => c.tagId) : tags;
    const pageNo = this._page + 1;
    const q = this._query.trim().toLowerCase();
    const shown = (rows?.rows ?? [])
      .map((r) => ({
        r,
        cells: cols.map((id, i) =>
          this.#cell(this.#infoOf(id), (r[2 + i] ?? null) as number | string | boolean | null),
        ),
        time: localTimeMs(Number(r[1]), tz),
      }))
      .filter(
        (x) =>
          !q ||
          x.time.toLowerCase().includes(q) ||
          x.cells.some((c) => c.text.toLowerCase().includes(q)),
      );
    const hasNext = !!rows && rows.next !== null;
    const exportHref =
      this.group && this.history
        ? this.history.exportUrl({
            group: this.group.id,
            from: this.#range.from,
            to: this.#range.to,
            tags,
            res: 'raw',
          })
        : '';
    return html`<div class="w hw" role="group" aria-label=${viHistory.widget.table}>
      ${
        this.prop('controls', true)
          ? html`<div class="controls" role="group" aria-label=${viHistory.rangeLabel}>
              ${RANGE_KEYS.map(
                (k) =>
                  html`<button
                    type="button"
                    class="hbtn"
                    data-range=${k}
                    aria-pressed=${this._rangeKey === k ? 'true' : 'false'}
                    @click=${() => this.#chooseRange(k)}
                  >
                    ${viHistory.range[k]}
                  </button>`,
              )}
              <span class="sp"></span>
              ${
                this.prop('search', true)
                  ? html`<input
                      type="search"
                      class="hsearch"
                      placeholder=${viHistory.table.search}
                      aria-label=${viHistory.table.search}
                      .value=${this._query}
                      @input=${(e: Event) => (this._query = (e.target as HTMLInputElement).value)}
                    />`
                  : nothing
              }
              <button type="button" class="hbtn order" @click=${() => this.#toggleOrder()}>
                ${this._order === 'desc' ? viHistory.table.desc : viHistory.table.asc}
              </button>
              ${
                exportHref
                  ? html`<a class="export" href=${exportHref} download
                      >${viHistory.table.exportCsv}</a
                    >`
                  : nothing
              }
            </div>`
          : exportHref
            ? html`<div class="exportbar">
                <span class="sp"></span
                ><a class="export" href=${exportHref} download>${viHistory.table.exportCsv}</a>
              </div>`
            : nothing
      }
      <div class="scroll" tabindex="0" role="region" aria-label=${viHistory.widget.table}>
        <table class="data">
          <thead>
            <tr>
              <th scope="col">${viHistory.time}</th>
              ${cols.map((id, i) => {
                const info = this.#infoOf(id);
                const unit = info.unit ? ` (${info.unit})` : '';
                return html`<th scope="col">${this.#labelOf(i)}${unit}</th>`;
              })}
            </tr>
          </thead>
          <tbody>
            ${shown.map(
              (x) =>
                html`<tr data-seq=${String(x.r[0])}>
                  <td>${x.time}</td>
                  ${x.cells.map((c) => html`<td class=${c.num ? 'num' : ''}>${c.text}</td>`)}
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="pager">
        <button
          type="button"
          class="hbtn prev"
          ?disabled=${this._page === 0}
          @click=${() => void this.#load(this._page - 1)}
        >
          ${this._order === 'desc' ? viHistory.table.newer : viHistory.table.older}
        </button>
        <span class="page" aria-live="polite">${viHistory.table.page} ${pageNo}</span>
        <button
          type="button"
          class="hbtn next"
          ?disabled=${!hasNext}
          @click=${() => void this.#load(this._page + 1)}
        >
          ${this._order === 'desc' ? viHistory.table.older : viHistory.table.newer}
        </button>
      </div>
      ${this.renderStatus()}
    </div>`;
  }
}
