// Widget `level` (FR-027): thanh mức dọc hoặc ngang, min–max, màu theo vùng, hiện % (giá trị thô khi `showRaw`, 044).
// Feature 037: `style` = `tank` vẽ bồn bo tròn hai đầu có vạch chia; `color` đặt màu chất lỏng (vùng màu vẫn thắng);
// `wave` (mặc định bật) vẽ gợn sóng nhẹ trên mặt chất lỏng của bồn dọc ở chế độ chạy: một dải mỏng dịch bằng
// `transform` (CSS thuần, không JS theo khung hình), tắt khi giảm chuyển động.
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { fraction, resolveRange, zoneColorAt, zoneSegments } from '../chart/geometry.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { MatWidget, safeColor } from './base.ts';
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
        opacity: 0.45;
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
        background: var(--lq, var(--mat-tile-blue, var(--mat-accent)));
        transition:
          height 0.4s ease-out,
          width 0.4s ease-out;
      }
      .tank .track {
        border-width: 2px;
        border-radius: 16px / 10px;
        background: linear-gradient(
          90deg,
          var(--mat-surface-2) 0%,
          var(--mat-surface, #fff) 45%,
          var(--mat-surface-2) 100%
        );
      }
      .tank .fill {
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--lq, var(--mat-tile-blue)) 80%, #000) 0%,
          var(--lq, var(--mat-tile-blue)) 45%,
          color-mix(in srgb, var(--lq, var(--mat-tile-blue)) 85%, #000) 100%
        );
      }
      .tank.horizontal .track {
        height: 40px;
        border-radius: 10px / 16px;
      }
      .ticks {
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          to top,
          transparent 0 calc(25% - 1px),
          color-mix(in srgb, var(--mat-text, #1a2225) 55%, transparent) calc(25% - 2px) 25%
        );
        mask: linear-gradient(90deg, #000 0 22%, transparent 22%);
      }
      .horizontal .ticks {
        background: repeating-linear-gradient(
          to right,
          transparent 0 calc(25% - 1px),
          color-mix(in srgb, var(--mat-text, #1a2225) 55%, transparent) calc(25% - 2px) 25%
        );
        mask: linear-gradient(180deg, #000 0 22%, transparent 22%);
      }
      .wave {
        position: absolute;
        left: 0;
        top: -7px;
        width: 200%;
        height: 8px;
        background: radial-gradient(
            ellipse 12px 7px at 12px 8px,
            color-mix(in srgb, var(--lq, var(--mat-tile-blue)) 75%, #fff) 98%,
            transparent 100%
          )
          0 0 / 24px 8px repeat-x;
        animation: mat-wave 2.4s linear infinite;
      }
      @keyframes mat-wave {
        to {
          transform: translateX(-50%);
        }
      }
      /* Sóng mức là trạng thái vận hành (ADR 056): chỉ "still" tắt; chuyển tiếp chiều cao là trang trí. */
      @media (prefers-reduced-motion: reduce) {
        .fill {
          transition: none;
        }
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
    const color =
      (known ? zoneColorAt(zones, Math.min(max, Math.max(min, n))) : undefined) ??
      safeColor(this.item.props?.color);
    const tank = this.prop('style', 'bar') === 'tank';
    const wave =
      tank &&
      !horizontal &&
      known &&
      pct > 2 &&
      pct < 99 &&
      this.mode !== 'edit' &&
      this.prop('wave', false);
    const dim = horizontal ? 'width' : 'height';
    const label = this.prop('label', '');
    const valueText = fmt.unit ? `${fmt.text} ${fmt.unit}` : fmt.text;
    return html`<div
      class="w ${horizontal ? 'horizontal' : 'vertical'} ${tank ? 'tank' : ''} ${qv.cls}"
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
            style=${styleMap({ [dim]: `${pct}%`, '--lq': color })}
          >
            ${wave ? html`<div class="wave" aria-hidden="true"></div>` : nothing}
          </div>
          ${tank ? html`<div class="ticks" aria-hidden="true"></div>` : nothing}
        </div>
        ${
          this.prop('showValue', true)
            ? html`<div class="readout ${qv.dim ? 'dim' : ''}">
                <span class="percent">${known ? `${pct}%` : fmt.text}</span>
                ${
                  // 044: mặc định chỉ hiện %, giá trị thô (m, m³…) khi bật showRaw; giá trị đã là % (0–100) thì không lặp.
                  !this.prop('showRaw', false) ||
                  (known && fmt.unit === '%' && min === 0 && max === 100)
                    ? nothing
                    : html`<span>
                        <span class="value">${fmt.text}</span>${
                          fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing
                        }
                      </span>`
                }
              </div>`
            : nothing
        }
      </div>
      ${this.badge(qv)}
    </div>`;
  }
}
