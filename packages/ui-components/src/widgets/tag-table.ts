// Widget `tag-table` (FR-030): bảng Tag sống ≤ 50 dòng: nhãn, giá trị (qua bảng giá trị nếu có), đơn vị, quality,
// thời điểm cập nhật. Sắp xếp tại chỗ khi bấm tiêu đề cột (trạng thái giao diện, không đổi project).
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { safeColor } from '../format/color.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import type { Quality } from '../host/types.ts';
import { MatWidget } from './base.ts';

const MAX = 50;
type Col = 'label' | 'value' | 'unit' | 'quality' | 'updated';
const ALL: readonly Col[] = ['label', 'value', 'unit', 'quality', 'updated'];
const DEFAULT: readonly Col[] = ['label', 'value', 'unit', 'quality'];
const QUALITY_RANK: Record<Quality, number> = {
  GOOD: 0,
  UNCERTAIN: 1,
  STALE: 2,
  BAD: 3,
  UNKNOWN: 4,
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

export class MatTagTable extends MatWidget {
  static override properties = {
    ...MatWidget.properties,
    _sortKey: { state: true },
    _sortDir: { state: true },
  };
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        padding: 0;
        justify-content: flex-start;
        overflow: auto;
      }
      /* feature 014: khung có thanh tiêu đề; bảng cuộn trong thân khung */
      .w.framed {
        overflow: hidden;
      }
      .framed > .body.tbl {
        padding: 0;
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }
      th,
      td {
        text-align: left;
        padding: 5px 10px;
        border-bottom: 1px solid var(--mat-border);
        white-space: nowrap;
        max-width: 260px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dense th,
      .dense td {
        padding: 2px 8px;
        font-size: 12px;
      }
      th {
        position: sticky;
        top: 0;
        background: var(--mat-surface-2);
        font-weight: 600;
        color: var(--mat-text-muted);
        z-index: 1;
      }
      th button {
        all: unset;
        cursor: pointer;
        display: inline-flex;
        gap: 4px;
        align-items: center;
        width: 100%;
      }
      th button:focus-visible {
        outline: 2px solid var(--mat-accent);
        outline-offset: 1px;
      }
      td.value {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      td.q {
        font-weight: 600;
      }
      tr.q-bad td.q {
        color: var(--mat-bad);
      }
      tr.q-stale td.q,
      tr.q-unknown td.q {
        color: var(--mat-text-muted);
      }
      tr.q-uncertain td.q {
        color: var(--mat-warn);
      }
      .empty {
        padding: 12px;
        color: var(--mat-text-muted);
      }
    `,
  ];

  declare _sortKey: Col | null;
  declare _sortDir: 'asc' | 'desc';

  constructor() {
    super();
    this._sortKey = null;
    this._sortDir = 'asc';
  }

  #columns(): Col[] {
    const raw = this.item?.props?.columns;
    if (!Array.isArray(raw)) return [...DEFAULT];
    const out: Col[] = [];
    for (const c of raw)
      if (
        typeof c === 'string' &&
        (ALL as readonly string[]).includes(c) &&
        !out.includes(c as Col)
      )
        out.push(c as Col);
    return out.length > 0 ? out : [...DEFAULT];
  }

  #sort(col: Col): void {
    if (this._sortKey === col) this._sortDir = this._sortDir === 'asc' ? 'desc' : 'asc';
    else {
      this._sortKey = col;
      this._sortDir = 'asc';
    }
  }

  protected override renderWidget(): TemplateResult {
    const ids = this.tagsOf('rows').slice(0, MAX);
    if (ids.length === 0)
      return html`<div class="w"><div class="empty">${vi.table.empty}</div></div>`;
    const cols = this.#columns();
    const labels = Array.isArray(this.item.props?.labels)
      ? (this.item.props!.labels as unknown[])
      : [];
    const rows = ids.map((id, i) => {
      const info = this.source.info(id);
      const state = this.source.get(id);
      const tableName = info?.valueTable;
      const fmt = formatValue(state, info, {
        decimals: this.decimals(info),
        table: tableName ? this.source.valueTable(tableName) : undefined,
      });
      const qv = this.qv(id);
      const label = (typeof labels[i] === 'string' && labels[i]) || info?.description || id;
      const quality =
        state.quality === 'GOOD' || state.quality === 'UNCERTAIN'
          ? vi.quality[state.quality]
          : qv.badge;
      return {
        id,
        state,
        info,
        fmt,
        qv,
        label: label as string,
        quality,
        n: numberOf(state.value),
      };
    });

    const key = this._sortKey;
    if (key) {
      const dir = this._sortDir === 'asc' ? 1 : -1;
      const cmp = (a: (typeof rows)[number], b: (typeof rows)[number]): number => {
        switch (key) {
          case 'label':
            return a.label.localeCompare(b.label, 'vi');
          case 'unit':
            return a.fmt.unit.localeCompare(b.fmt.unit, 'vi');
          case 'quality':
            return QUALITY_RANK[a.state.quality] - QUALITY_RANK[b.state.quality];
          case 'updated':
            return (a.state.updatedAt ?? -Infinity) - (b.state.updatedAt ?? -Infinity);
          case 'value': {
            const an = Number.isFinite(a.n);
            const bn = Number.isFinite(b.n);
            if (an && bn) return a.n - b.n;
            if (an !== bn) return an ? -1 : 1; // số trước chữ
            return a.fmt.text.localeCompare(b.fmt.text, 'vi');
          }
        }
      };
      rows.sort((a, b) => dir * cmp(a, b)); // Array.sort ổn định: dòng bằng nhau giữ thứ tự cấu hình
    }

    const sortable = this.prop('sortable', true);
    const head = (c: Col) => {
      const text = vi.table[c];
      const active = this._sortKey === c;
      const aria = active ? (this._sortDir === 'asc' ? 'ascending' : 'descending') : nothing;
      return html`<th scope="col" aria-sort=${aria}>
        ${
          sortable
            ? html`<button
                type="button"
                data-col=${c}
                title=${`${vi.table.sortBy} ${text}`}
                @click=${() => this.#sort(c)}
              >
                ${text}${
                  active
                    ? html`<span aria-hidden="true">${this._sortDir === 'asc' ? '▲' : '▼'}</span>`
                    : nothing
                }
              </button>`
            : text
        }
      </th>`;
    };

    const cell = (c: Col, r: (typeof rows)[number]) => {
      switch (c) {
        case 'label':
          return html`<td class="label" title=${r.label}>${r.label}</td>`;
        case 'value':
          return html`<td
            class="value ${r.qv.dim ? 'dim' : ''}"
            style=${styleMap({ color: safeColor(r.fmt.color) })}
            title=${r.fmt.text}
          >
            ${r.fmt.text}
          </td>`;
        case 'unit':
          return html`<td class="unit">${r.fmt.unit}</td>`;
        case 'quality':
          return html`<td class="q" title=${r.qv.tooltip}>${r.quality}</td>`;
        case 'updated':
          return html`<td class="updated">
            ${r.state.updatedAt === undefined ? vi.noValue : clock(r.state.updatedAt)}
          </td>`;
      }
    };

    const title = this.titleText();
    const table = html`<table role="table" aria-label=${title || vi.widget['tag-table']!}>
      <thead>
        <tr>
          ${cols.map(head)}
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (r) =>
            html`<tr class=${r.qv.cls}>
              ${cols.map((c) => cell(c, r))}
            </tr>`,
        )}
      </tbody>
    </table>`;
    return html`<div class="w ${this.prop('dense', false) ? 'dense' : ''} ${title ? 'framed' : ''}">
      ${this.head()} ${title ? html`<div class="body tbl">${table}</div>` : table}
    </div>`;
  }
}
