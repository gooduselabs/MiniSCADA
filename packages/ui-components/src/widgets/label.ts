// Widget `label` (FR-026): chữ tĩnh, tùy chọn gắn Tag để hiện giá trị (chữ, số, hoặc qua bảng giá trị).
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { safeColor } from '../format/color.ts';
import { formatValue } from '../format/format-value.ts';
import { MatWidget } from './base.ts';

export class MatLabel extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        justify-content: center;
      }
      .line {
        width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.25;
      }
      .value {
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const text = this.prop('text', '');
    const info = id ? this.source.info(id) : undefined;
    const tableName = info?.valueTable;
    const state = id ? this.source.get(id) : undefined;
    const fmt = state
      ? formatValue(state, info, {
          decimals: this.decimals(info),
          table: tableName ? this.source.valueTable(tableName) : undefined,
        })
      : undefined;
    const qv = this.qv(id);
    const align = this.prop('align', 'left');
    const lineStyle = {
      fontSize: `${this.prop('fontSize', 16)}px`,
      fontWeight: this.prop('bold', false) ? '700' : '400',
      textAlign: ['left', 'center', 'right'].includes(align) ? align : 'left',
      color: safeColor(this.item.props?.color),
      whiteSpace: this.prop('wrap', false) ? 'normal' : 'nowrap',
    };
    const valueText = fmt ? (fmt.unit ? `${fmt.text} ${fmt.unit}` : fmt.text) : '';
    const full = [text, valueText].filter(Boolean).join(' ');
    return html`<div
      class="w flat ${qv.cls}"
      role="group"
      aria-label=${[full, qv.aria].filter(Boolean).join(', ')}
    >
      <div class="line" style=${styleMap(lineStyle)}>
        ${text ? html`<span class="static">${text}</span>` : nothing}${
          text && fmt ? ' ' : nothing
        }${
          fmt
            ? html`<span
                class="value ${qv.dim ? 'dim' : ''}"
                style=${styleMap({ color: safeColor(fmt.color) })}
                >${valueText}</span
              >`
            : nothing
        }
      </div>
      ${state ? this.badge(qv) : nothing}
    </div>`;
  }
}
