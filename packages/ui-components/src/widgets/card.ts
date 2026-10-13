// Widget `card` (FR-026): nhãn, giá trị (số lẻ, đơn vị), chấm quality, nền; màu giá trị theo bảng giá trị hoặc đặt tay.
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { formatValue } from '../format/format-value.ts';
import { safeColor } from '../format/color.ts';
import type { TagState } from '../host/types.ts';
import { MatWidget } from './base.ts';

export class MatCard extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .label {
        font-size: 12px;
        color: var(--mat-text-muted);
        margin-bottom: 2px;
        padding-right: 36px;
      }
      .main {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
      }
      .value {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .unit {
        color: var(--mat-text-muted);
        font-size: 0.5em;
        white-space: nowrap;
      }
      .fs-s .value {
        font-size: 20px;
      }
      .fs-m .value {
        font-size: 28px;
      }
      .fs-l .value {
        font-size: 40px;
      }
      .fs-xl .value {
        font-size: 56px;
      }
      .fs-s .unit {
        font-size: 12px;
      }
      .fs-m .unit {
        font-size: 14px;
      }
      .fs-l .unit {
        font-size: 18px;
      }
      .fs-xl .unit {
        font-size: 24px;
      }
    `,
  ];

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const state: TagState = id ? this.source.get(id) : { value: null, quality: 'GOOD' };
    const info = id ? this.source.info(id) : undefined;
    const tableName = info?.valueTable;
    const unitProp = this.item.props?.unit;
    const fmt = formatValue(state, info, {
      decimals: this.decimals(info),
      unit: typeof unitProp === 'string' ? unitProp : undefined,
      table: tableName ? this.source.valueTable(tableName) : undefined,
    });
    const qv = this.qv(id);
    const label = this.prop('label', '');
    const size = this.prop('fontSize', 'm');
    const fs = ['s', 'm', 'l', 'xl'].includes(size) ? size : 'm';
    const color = safeColor(this.item.props?.valueColor) ?? safeColor(fmt.color);
    const bg = safeColor(this.item.props?.background);
    // showQuality=false chỉ ẩn nhãn của GOOD/UNCERTAIN: lỗi nặng luôn có chữ (FR-018).
    const showBadge = this.prop('showQuality', true) || qv.dim || qv.locked;
    const aria = [`${this.nameOf(id)}: ${fmt.text}${fmt.unit ? ' ' + fmt.unit : ''}`, qv.aria]
      .filter(Boolean)
      .join(', ');
    return html`<div
      class="w fs-${fs} ${qv.cls}"
      role="group"
      aria-label=${aria}
      style=${styleMap({ background: bg })}
    >
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="main">
        <span class="value ${qv.dim ? 'dim' : ''}" style=${styleMap({ color })}>${fmt.text}</span>
        ${fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing}
      </div>
      ${showBadge ? this.badge(qv) : nothing}
    </div>`;
  }
}
