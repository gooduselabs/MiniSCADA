// Widget `level` (FR-027): thanh mức dọc hoặc ngang, min–max, màu theo vùng, hiện % và giá trị.
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { fraction, resolveRange, zoneColorAt, zoneSegments } from '../chart/geometry.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { MatWidget } from './base.ts';
import { vi } from '../i18n/vi.ts';

export class MatLevel extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        gap: 4px;
        align-items: stretch;
      }
      .label {
        font-size: 12px;
        color: var(--mat-text-muted);
        text-align: center;
        padding-right: 30px;
      }
      .body {
        flex: 1;
        min-height: 0;
        display: flex;
        gap: 8px;
        align-items: stretch;
      }
      .horizontal .body {
        flex-direction: column;
        justify-content: center;
      }
      .track {
        position: relative;
        flex: 1;
        min-width: 0;
        min-height: 0;
        border: 1px solid var(--mat-border-strong);
        border-radius: var(--mat-radius);
        background: var(--mat-surface-2);
        overflow: hidden;
      }
      .horizontal .track {
        flex: none;
        height: 24px;
      }
      .zone-seg {
        position: absolute;
        opacity: 0.28;
      }
      .vertical .zone-seg {
        left: 0;
        right: 0;
      }
      .horizontal .zone-seg {
        top: 0;
        bottom: 0;
      }
      .fill {
        position: absolute;
        background: var(--mat-accent);
      }
      .vertical .fill {
        left: 0;
        right: 0;
        bottom: 0;
      }
      .horizontal .fill {
        left: 0;
        top: 0;
        bottom: 0;
      }
      .readout {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-width: 44px;
        line-height: 1.2;
      }
      .horizontal .readout {
        flex-direction: row;
        gap: 8px;
        justify-content: center;
      }
      .percent {
        font-size: 18px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .value {
        font-size: 12px;
        font-variant-numeric: tabular-nums;
      }
      .unit {
        font-size: 11px;
        color: var(--mat-text-muted);
        margin-left: 2px;
      }
    `,
  ];

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const info = id ? this.source.info(id) : undefined;
    const state = id ? this.source.get(id) : { value: null, quality: 'GOOD' as const };
    const qv = this.qv(id);
    const { min, max } = resolveRange(
      this.item.props?.min,
      this.item.props?.max,
      info?.min,
      info?.max,
    );
    const unitProp = this.item.props?.unit;
    const fmt = formatValue(state, info, {
      decimals: this.decimals(info),
      unit: typeof unitProp === 'string' ? unitProp : undefined,
    });
    const n = numberOf(state.value);
    const known = Number.isFinite(n) && state.quality !== 'UNKNOWN';
    const f = known ? fraction(n, min, max) : 0;
    const pct = Math.round(f * 100);
    const horizontal = this.prop('orientation', 'vertical') === 'horizontal';
    const zones = zoneSegments(this.item.props?.zones, min, max);
    const color = known ? zoneColorAt(zones, Math.min(max, Math.max(min, n))) : undefined;
    const dim = horizontal ? 'width' : 'height';
    const label = this.prop('label', '');
    const valueText = fmt.unit ? `${fmt.text} ${fmt.unit}` : fmt.text;
    return html`<div
      class="w ${horizontal ? 'horizontal' : 'vertical'} ${qv.cls}"
      role="meter"
      aria-label=${label || this.nameOf(id) || vi.widget.level!}
      aria-valuemin=${min}
      aria-valuemax=${max}
      aria-valuenow=${known ? n : min}
      aria-valuetext=${[valueText, qv.aria].filter(Boolean).join(', ')}
    >
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="body">
        <div class="track">
          ${zones.map((z) => {
            const a = fraction(z.from, min, max) * 100;
            const b = fraction(z.to, min, max) * 100;
            const pos = horizontal
              ? { left: `${a}%`, width: `${b - a}%` }
              : { bottom: `${a}%`, height: `${b - a}%` };
            return html`<div
              class="zone-seg"
              style=${styleMap({ ...pos, background: z.color })}
            ></div>`;
          })}
          <div
            class="fill ${qv.dim ? 'dim' : ''}"
            style=${styleMap({ [dim]: `${pct}%`, background: color })}
          ></div>
        </div>
        ${
          this.prop('showValue', true)
            ? html`<div class="readout ${qv.dim ? 'dim' : ''}">
                <span class="percent">${known ? `${pct}%` : fmt.text}</span>
                <span>
                  <span class="value">${fmt.text}</span>${
                    fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing
                  }
                </span>
              </div>`
            : nothing
        }
      </div>
      ${this.badge(qv)}
    </div>`;
  }
}
