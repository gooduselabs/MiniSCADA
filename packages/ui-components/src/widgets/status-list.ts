// Widget `status-list` (feature 014): danh sách đèn trạng thái của nhiều Tag (≤ 16), 1 đến 4 cột, có thanh tiêu đề tùy
// chọn. Tag BOOL: chấm màu tốt khi bật, xám khi tắt, chữ `onText`/`offText` (mặc định Bật/Tắt); Tag số: chữ và màu của
// bảng giá trị nếu có, không thì giá trị. Quality xấu: chấm rỗng viền và nhãn chữ (BAD, STALE, ?), không chỉ màu.
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { safeColor } from '../format/color.ts';
import { formatValue } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';

const MAX = 16;

export class MatStatusList extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        justify-content: flex-start;
        padding: 8px 12px;
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        box-shadow: var(--mat-shadow-card, none);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 2px 16px;
        align-content: start;
        overflow: auto;
        min-height: 0;
      }
      li {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        padding: 5px 0;
        border-bottom: 1px solid var(--mat-border);
        font-size: 13px;
      }
      li:last-child {
        border-bottom: none;
      }
      .dot {
        flex: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: var(--dc, var(--mat-offline));
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dc, var(--mat-offline)) 22%, transparent);
      }
      .dot.off {
        background: var(--mat-surface-2);
        box-shadow: inset 0 0 0 2px var(--mat-border-strong);
      }
      .dot.bad {
        background: transparent;
        box-shadow: inset 0 0 0 2px var(--mat-bad);
      }
      .name {
        flex: 1;
        min-width: 0;
      }
      .state {
        flex: none;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .state.off {
        color: var(--mat-text-muted);
        font-weight: 500;
      }
      .q {
        flex: none;
        font: 600 10px/1 var(--mat-font-mono, monospace);
        padding: 2px 4px;
        border-radius: 3px;
        border: 1px solid currentColor;
      }
      .q.q-bad {
        color: var(--mat-bad);
      }
      .q.q-uncertain {
        color: var(--mat-warn);
      }
      .q.q-stale,
      .q.q-unknown {
        color: var(--mat-text-muted);
      }
      .empty {
        color: var(--mat-text-muted);
        font-size: 12px;
      }
    `,
  ];

  protected override renderWidget(): TemplateResult {
    const ids = this.tagsOf('items').slice(0, MAX);
    const labels = Array.isArray(this.item.props?.labels)
      ? (this.item.props!.labels as unknown[])
      : [];
    const cols = Math.max(1, Math.min(4, Math.trunc(this.prop('columns', 1))));
    const onText = this.prop('onText', '') || vi.dash.on;
    const offText = this.prop('offText', '') || vi.dash.off;
    const rows = ids.map((id, i) => {
      const info = this.source.info(id);
      const state = this.source.get(id);
      const qv = this.qv(id);
      const name = (typeof labels[i] === 'string' && labels[i]) || info?.description || id;
      const bad = state.quality !== 'GOOD' && state.quality !== 'UNCERTAIN';
      if (info?.type === 'BOOL' || typeof state.value === 'boolean') {
        const on = state.value === true;
        return {
          name: name as string,
          qv,
          on: on && !bad,
          text: bad ? vi.dash.statusWord[state.quality] : on ? onText : offText,
          color: on ? 'var(--mat-good)' : undefined,
          bad,
        };
      }
      const fmt = formatValue(state, info, {
        decimals: this.decimals(info),
        table: info?.valueTable ? this.source.valueTable(info.valueTable) : undefined,
      });
      return {
        name: name as string,
        qv,
        on: !bad,
        text: `${fmt.text}${fmt.unit ? ' ' + fmt.unit : ''}`,
        color: safeColor(fmt.color) ?? 'var(--mat-info)',
        bad,
      };
    });
    const title = this.titleText();
    const list = rows.length
      ? html`<ul style=${styleMap({ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` })}>
          ${rows.map(
            (r) =>
              html`<li>
                <span
                  class="dot ${r.bad ? 'bad' : r.on ? '' : 'off'}"
                  style=${styleMap({ '--dc': r.color })}
                  aria-hidden="true"
                ></span>
                <span class="name ellipsis" title=${r.name}>${r.name}</span>
                <span class="state ${r.on ? '' : 'off'}">${r.text}</span>
                ${r.qv.badge ? html`<span class="q ${r.qv.cls}" title=${r.qv.tooltip}>${r.qv.badge}</span>` : nothing}
              </li>`,
          )}
        </ul>`
      : html`<div class="empty">${vi.dash.noItems}</div>`;
    const aria = [title, ...rows.map((r) => `${r.name}: ${r.text}`)].filter(Boolean).join('; ');
    return html`<div class="w ${title ? 'framed' : ''}" role="group" aria-label=${aria}>
      ${this.head()} ${title ? html`<div class="body">${list}</div>` : list}
    </div>`;
  }
}
