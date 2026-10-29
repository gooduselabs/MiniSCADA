// Widget `progress` (feature 014): phần trăm của giá trị trong thang min–max (thuộc tính, rồi giới hạn của Tag, rồi
// 0–100), dạng thanh ngang hoặc vòng. role=meter có giá trị và chữ; quality xấu có nhãn chữ như mọi widget.
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { fraction, resolveRange } from '../chart/geometry.ts';
import { safeColor } from '../format/color.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { MatWidget } from './base.ts';
import { vi } from '../i18n/vi.ts';

const RING_R = 42;
const RING_C = 2 * Math.PI * RING_R;

export class MatProgress extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        gap: 6px;
        padding: 10px 14px;
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        box-shadow: var(--mat-shadow-card, none);
      }
      .top {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }
      .label {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        color: var(--mat-text-muted);
      }
      .val {
        font-weight: 700;
        font-size: 15px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .pct {
        font-weight: 600;
        color: var(--mat-text-muted);
        font-variant-numeric: tabular-nums;
      }
      .track {
        height: 10px;
        border-radius: 999px;
        background: var(--mat-surface-2);
        border: 1px solid var(--mat-border);
        overflow: hidden;
      }
      .fill {
        height: 100%;
        border-radius: 999px;
        background: var(--fc, var(--mat-accent));
        transition: width var(--mat-motion, 0ms) ease-out;
      }
      .w.ring {
        flex-direction: row;
        align-items: center;
        gap: 12px;
      }
      .ring svg {
        flex: none;
        height: 100%;
        max-height: 140px;
        aspect-ratio: 1;
        transform: rotate(-90deg);
      }
      .ring circle {
        fill: none;
        stroke-width: 10;
      }
      .ring .bg {
        stroke: var(--mat-surface-2);
      }
      .ring .fg {
        stroke: var(--fc, var(--mat-accent));
        stroke-linecap: round;
      }
      .ring .side {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .ring .big {
        font-size: 26px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .dimmed .fill,
      .dimmed .fg {
        opacity: 0.45;
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
    const pct = `${Math.round(f * 100)} %`;
    const label = this.prop('label', '');
    // 044: phần trăm là số chính; giá trị thô chỉ hiện khi bật `showValue` (mặc định danh mục false, project cũ ghi
    // tường minh true vẫn hiện), và không bao giờ khi nó trùng phần trăm (đơn vị %, thang 0–100).
    const same = fmt.unit === '%' && min === 0 && max === 100;
    const show = this.prop('showValue', false) && !same;
    const color = safeColor(this.item.props?.color);
    const ring = this.prop('shape', 'bar') === 'ring';
    const valueText = `${fmt.text}${fmt.unit ? ' ' + fmt.unit : ''}`;
    const attrs = {
      label: label || this.nameOf(id) || vi.widget.progress!,
      text: [`${valueText} (${pct})`, qv.aria].filter(Boolean).join(', '),
    };
    const cls = `w ${ring ? 'ring' : 'bar'} ${qv.cls} ${qv.dim ? 'dimmed' : ''}`;
    const style = styleMap({ '--fc': color });
    if (ring)
      return html`<div
        class=${cls}
        style=${style}
        role="meter"
        aria-label=${attrs.label}
        aria-valuemin=${min}
        aria-valuemax=${max}
        aria-valuenow=${known ? n : min}
        aria-valuetext=${attrs.text}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          ${svg`<circle class="bg" cx="50" cy="50" r=${RING_R}></circle>
            <circle class="fg" cx="50" cy="50" r=${RING_R}
              stroke-dasharray=${`${(f * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`}></circle>`}
        </svg>
        <div class="side">
          ${label ? html`<span class="label ellipsis">${label}</span>` : nothing}
          <span class="big">${pct}</span>
          ${show ? html`<span class="val">${valueText}</span>` : nothing}
        </div>
        ${this.badge(qv)}
      </div>`;
    return html`<div
      class=${cls}
      style=${style}
      role="meter"
      aria-label=${attrs.label}
      aria-valuemin=${min}
      aria-valuemax=${max}
      aria-valuenow=${known ? n : min}
      aria-valuetext=${attrs.text}
    >
      <div class="top">
        <span class="label ellipsis">${label}</span>
        ${show ? html`<span class="val">${valueText}</span>` : nothing}
        <span class="pct">${pct}</span>
      </div>
      <div class="track" aria-hidden="true">
        <div class="fill" style=${styleMap({ width: `${(f * 100).toFixed(1)}%` })}></div>
      </div>
      ${this.badge(qv)}
    </div>`;
  }
}
