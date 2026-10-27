// Widget `lamp` (FR-026): BOOL hoặc số (qua bảng giá trị), hình tròn hoặc vuông, nhãn, chữ trạng thái đi kèm.
import { lookupValueTable } from '@mat/expression';
import { css, html, nothing, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { styleMap } from 'lit/directives/style-map.js';
import { safeColor } from '../format/color.ts';
import { numberOf } from '../format/format-value.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';

export class MatLamp extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .dot {
        flex: none;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: 2px solid var(--mat-border-strong);
        background: var(--mat-surface-2);
      }
      .dot.square {
        border-radius: 3px;
      }
      .dot.on {
        background: var(--mat-good);
        border-color: var(--mat-good);
      }
      .dot.off {
        background: var(--mat-offline);
        border-color: var(--mat-offline);
        opacity: 0.55;
      }
      .dot.inactive {
        background: transparent;
        border-style: dashed;
      }
      .texts {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.2;
      }
      .label {
        font-size: 12px;
        color: var(--mat-text-muted);
      }
      .state-text {
        font-weight: 600;
      }
    `,
  ];

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('state');
    const state = id ? this.source.get(id) : { value: null, quality: 'GOOD' as const };
    const info = id ? this.source.info(id) : undefined;
    const qv = this.qv(id);
    const tableName = this.prop('useValueTable', true) ? info?.valueTable : undefined;
    const table = tableName ? this.source.valueTable(tableName) : undefined;

    const n = numberOf(state.value);
    const hasValue = state.value !== null && !Number.isNaN(n);
    const inactive = qv.dim || !hasValue;
    let on = hasValue && n !== 0;
    let text: string = state.quality === 'UNKNOWN' ? vi.unknownValue : vi.noValue;
    let color: string | undefined;
    if (hasValue) {
      const hit = table
        ? lookupValueTable(table, typeof state.value === 'boolean' ? state.value : n)
        : null;
      if (hit && hit.entry !== null) {
        text = hit.text;
        color = safeColor(hit.color ?? undefined);
      } else {
        if (this.prop('invert', false)) on = !on;
        text = on ? vi.on : vi.off;
        color = safeColor(this.item.props?.[on ? 'onColor' : 'offColor']);
      }
    }
    const name = this.nameOf(id);
    const label = this.prop('label', '');
    const aria = [`${name}: ${text}`, qv.aria].filter(Boolean).join(', ');
    const dotClass = {
      dot: true,
      square: this.prop('shape', 'circle') === 'square',
      on: !inactive && on,
      blink: !inactive && on && this.prop('blinkOn', false),
      off: !inactive && !on,
      inactive,
    };
    return html`<div class="w ${qv.cls}" role="group" aria-label=${aria}>
      <div class="row">
        <span
          class=${classMap(dotClass)}
          style=${styleMap({ background: inactive ? undefined : color })}
        ></span>
        <span class="texts ${qv.dim ? 'dim' : ''}">
          ${label ? html`<span class="label ellipsis">${label}</span>` : nothing}
          ${
            this.prop('showText', true)
              ? html`<span class="state-text ellipsis">${text}</span>`
              : nothing
          }
        </span>
      </div>
      ${this.badge(qv)}
    </div>`;
  }
}
