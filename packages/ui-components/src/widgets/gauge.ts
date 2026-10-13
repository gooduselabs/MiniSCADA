// Widget `gauge` (FR-027): đồng hồ nửa vòng bằng SVG: thang min–max, vùng màu (≤ 4), kim, giá trị và đơn vị.
import { css, html, nothing, svg, type TemplateResult } from 'lit';
import { arcPath, fraction, gaugeAngle, resolveRange, zoneSegments } from '../chart/geometry.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { MatWidget } from './base.ts';

const CX = 100;
const CY = 100;
const R = 78;

export class MatGauge extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        padding: 6px 8px;
        align-items: stretch;
      }
      .label {
        font-size: 12px;
        color: var(--mat-text-muted);
        text-align: center;
        padding-right: 30px;
      }
      svg {
        flex: 1;
        min-height: 0;
        width: 100%;
      }
      .track {
        stroke: var(--mat-border);
        fill: none;
        stroke-width: 12;
      }
      .zone {
        fill: none;
        stroke-width: 12;
      }
      .needle {
        stroke: var(--mat-text);
        stroke-width: 3;
        stroke-linecap: round;
      }
      .hub {
        fill: var(--mat-text);
      }
      .tick {
        fill: var(--mat-text-muted);
        font-size: 10px;
        text-anchor: middle;
      }
      .readout {
        display: flex;
        justify-content: center;
        align-items: baseline;
        gap: 4px;
      }
      .value {
        font-size: 20px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .unit {
        font-size: 12px;
        color: var(--mat-text-muted);
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
    const angle = known ? gaugeAngle(fraction(n, min, max)) : -90;
    const zones = zoneSegments(this.item.props?.zones, min, max);
    const label = this.prop('label', '');
    const valueText = fmt.unit ? `${fmt.text} ${fmt.unit}` : fmt.text;
    const ariaLabel = label || this.nameOf(id);
    return html`<div
      class="w ${qv.cls}"
      role="meter"
      aria-label=${ariaLabel}
      aria-valuemin=${min}
      aria-valuemax=${max}
      aria-valuenow=${known ? n : nothing}
      aria-valuetext=${[valueText, qv.aria].filter(Boolean).join(', ')}
    >
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <svg viewBox="0 0 200 118" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        ${svg`<path class="track" d=${arcPath(CX, CY, R, -90, 90)} />`}
        ${zones.map(
          (z) =>
            svg`<path class="zone" d=${arcPath(CX, CY, R, gaugeAngle(fraction(z.from, min, max)), gaugeAngle(fraction(z.to, min, max)))} stroke=${z.color} data-from=${z.from} data-to=${z.to} />`,
        )}
        <text class="tick" x="22" y="114">${min}</text>
        <text class="tick" x="178" y="114">${max}</text>
        ${
          known
            ? svg`<line class="needle ${qv.dim ? 'dim' : ''}" x1=${CX} y1=${CY} x2=${CX} y2=${CY - R + 6}
              transform="rotate(${angle} ${CX} ${CY})" data-angle=${angle} />`
            : nothing
        }
        <circle class="hub" cx=${CX} cy=${CY} r="6" />
      </svg>
      ${
        this.prop('showValue', true)
          ? html`<div class="readout">
              <span class="value ${qv.dim ? 'dim' : ''}">${fmt.text}</span>
              ${fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing}
            </div>`
          : nothing
      }
      ${this.badge(qv)}
    </div>`;
  }
}
