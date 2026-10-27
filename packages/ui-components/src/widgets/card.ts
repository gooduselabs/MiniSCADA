// Widget `card` (FR-026): nhãn, giá trị (số lẻ, đơn vị), chấm quality, nền; màu giá trị theo bảng giá trị hoặc đặt tay.
// Feature 012 (T046, FR-035): `sparkline` (đường nhỏ 60 điểm gần nhất từ giá trị sống, mặc định tắt) và `trend` (mũi
// tên tăng/giảm so với điểm trước, mặc định tắt; màu trung tính vì tăng không nhất thiết là tốt); bo góc, bóng theo token --mat-radius-lg, --mat-shadow-card (atscada:
// 4px, bóng nhẹ kiểu FastWeb). Bộ đệm là của widget: một điểm mỗi lần giá trị (hoặc giờ cập nhật) đổi; BAD,
// STALE, UNKNOWN và giá trị không phải số làm đứt đường.
import { css, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { formatValue, numberOf } from '../format/format-value.ts';
import { safeColor } from '../format/color.ts';
import type { TagState } from '../host/types.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';

const SPARK_POINTS = 60;
const SW = 100;
const SH = 24;

/** Các đoạn liền (không NaN) của dãy, quy về khung SW × SH. */
export function sparkSegments(values: readonly number[]): string[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return [];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const span = hi - lo || 1;
  const n = values.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * SW : 0);
  const y = (v: number) => (hi === lo ? SH / 2 : SH - 1 - ((v - lo) / span) * (SH - 2));
  const out: string[] = [];
  let cur: string[] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    else {
      if (cur.length >= 2) out.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length >= 2) out.push(cur.join(' '));
  return out;
}

export class MatCard extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        box-shadow: var(--mat-shadow-card, none);
      }
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
      .trend {
        font-size: 0.5em;
        font-weight: 700;
        color: var(--mat-text-muted);
      }
      .spark {
        display: block;
        width: 100%;
        height: 24px;
        margin-top: 4px;
        overflow: visible;
      }
      .spark polyline {
        fill: none;
        stroke: var(--mat-chart-1);
        stroke-width: 1.5;
        stroke-linejoin: round;
        stroke-linecap: round;
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
      .fs-s .unit,
      .fs-s .trend {
        font-size: 12px;
      }
      .fs-m .unit,
      .fs-m .trend {
        font-size: 14px;
      }
      .fs-l .unit,
      .fs-l .trend {
        font-size: 18px;
      }
      .fs-xl .unit,
      .fs-xl .trend {
        font-size: 24px;
      }
    `,
  ];

  #buf: number[] = [];
  #lastKey = '';

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has('item') && changed.get('item') !== undefined) {
      const prev = changed.get('item') as { tags?: Record<string, unknown> } | undefined;
      if (prev?.tags?.value !== this.item?.tags?.value) {
        this.#buf = [];
        this.#lastKey = '';
      }
    }
    this.#record();
  }

  /** Thêm một điểm khi trạng thái của Tag đổi (giá trị, quality hoặc giờ cập nhật). */
  #record(): void {
    if (!this.item || !this.source) return;
    if (!this.prop('sparkline', false) && !this.prop('trend', false)) return;
    const id = this.tagOf('value');
    if (!id) return;
    const s = this.source.get(id);
    const key = `${String(s.value)}|${s.quality}|${s.updatedAt ?? ''}`;
    if (key === this.#lastKey) return;
    this.#lastKey = key;
    const n = numberOf(s.value);
    const ok =
      typeof s.value !== 'string' &&
      Number.isFinite(n) &&
      (s.quality === 'GOOD' || s.quality === 'UNCERTAIN');
    this.#buf.push(ok ? n : Number.NaN);
    if (this.#buf.length > SPARK_POINTS) this.#buf.splice(0, this.#buf.length - SPARK_POINTS);
  }

  /** Hướng so với điểm trước: null khi chưa đủ hai điểm số liền nhau. */
  #direction(): 'up' | 'down' | 'flat' | null {
    const b = this.#buf;
    if (b.length < 2) return null;
    const cur = b[b.length - 1]!;
    const prev = b[b.length - 2]!;
    if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
    return cur > prev ? 'up' : cur < prev ? 'down' : 'flat';
  }

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
    const dir = this.prop('trend', false) ? this.#direction() : null;
    const segs = this.prop('sparkline', false) ? sparkSegments(this.#buf) : null;
    const aria = [
      `${this.nameOf(id)}: ${fmt.text}${fmt.unit ? ' ' + fmt.unit : ''}`,
      qv.aria,
      dir ? vi.trend[dir] : '',
    ]
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
        <span
          class="value ${qv.dim ? 'dim' : ''} ${this.blinking(state.value, state.quality) ? 'blink' : ''}"
          style=${styleMap({ color })}
          >${fmt.text}</span
        >
        ${fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing}
        ${
          dir
            ? html`<span class="trend ${dir}" aria-hidden="true" title=${vi.trend[dir]}
                >${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'}</span
              >`
            : nothing
        }
      </div>
      ${
        segs
          ? html`<svg
              class="spark"
              viewBox="0 0 ${SW} ${SH}"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              ${segs.map(
                (p) => svg`<polyline points=${p} vector-effect="non-scaling-stroke"></polyline>`,
              )}
            </svg>`
          : nothing
      }
      ${this.statusLine()} ${showBadge ? this.badge(qv) : nothing}
    </div>`;
  }
}
