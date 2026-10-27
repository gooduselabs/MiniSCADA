// Widget `stat-tile` (feature 014, phản hồi 2026-10-20): thẻ chỉ số tô màu đặc như dashboard tham khảo: nhãn nhỏ, số
// đọc to (Inter, chữ số đều), dòng "Trạng thái: …" theo quality của giá trị hoặc theo Tag cảnh báo (khe `alarm`), biểu
// tượng lớn mờ ở góc phải; tùy chọn đường nhỏ 60 điểm và mũi tên xu hướng (cùng quy tắc với card). Màu nền là tên trong
// bảng `--mat-tile-*` (chữ trắng ≥ 4,5:1 ở mọi chủ đề); quality xấu luôn có chữ (không chỉ màu) và viền đứt.
import { css, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { formatValue } from '../format/format-value.ts';
import type { Quality, TagState } from '../host/types.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';
import { sparkSegments } from './card.ts';
import { dashIcon } from './icons.ts';
import { LiveBuffer } from './live-buffer.ts';

export const TILE_COLORS = [
  'teal',
  'blue',
  'rose',
  'violet',
  'olive',
  'indigo',
  'orange',
  'cyan',
  'green',
  'slate',
] as const;
export type TileColor = (typeof TILE_COLORS)[number];

export const tileColor = (v: unknown): TileColor =>
  (TILE_COLORS as readonly unknown[]).includes(v) ? (v as TileColor) : 'teal';

/** Lớp trạng thái của thẻ: theo quality, cảnh báo chỉ khi giá trị dùng được. */
export function tileStatus(
  q: Quality,
  alarm: boolean,
): { cls: string; word: string; pill: boolean } {
  if (q === 'GOOD' && alarm) return { cls: 'q-good alarm', word: vi.dash.alarm, pill: true };
  const cls = {
    GOOD: 'q-good',
    UNCERTAIN: 'q-uncertain',
    BAD: 'q-bad',
    STALE: 'q-stale',
    UNKNOWN: 'q-unknown',
  }[q];
  return { cls, word: vi.dash.statusWord[q], pill: q !== 'GOOD' };
}

export class MatStatTile extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      :host {
        container-type: inline-size;
      }
      .tile {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        padding: 12px 16px;
        overflow: hidden;
        color: var(--mat-tile-ink, #ffffff);
        background: linear-gradient(
          135deg,
          var(--c) 0%,
          color-mix(in srgb, var(--c) 80%, #000000) 100%
        );
        border-radius: var(--mat-radius-lg, 10px);
        box-shadow: var(--mat-shadow-card, none);
      }
      .icon {
        position: absolute;
        right: -2%;
        top: 50%;
        height: min(96%, 128px);
        width: auto;
        aspect-ratio: 1;
        transform: translateY(-50%);
        opacity: 0.2;
        stroke-width: 1.6;
        pointer-events: none;
      }
      .label,
      .main,
      .status2 {
        color: inherit;
        opacity: 0.95;
      }
      .status {
        position: relative;
        z-index: 1;
        padding-right: 22%;
        min-width: 0;
      }
      .label {
        font-size: 13px;
        font-weight: 500;
        opacity: 0.92;
      }
      .main {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .value {
        font-size: clamp(24px, 13cqw, 44px);
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .value.dim {
        opacity: 0.6;
      }
      .unit {
        font-size: 15px;
        font-weight: 500;
        opacity: 0.9;
        white-space: nowrap;
      }
      .trend {
        font-size: 14px;
        font-weight: 700;
        opacity: 0.9;
      }
      .status {
        font-size: 12.5px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .status b {
        font-weight: 700;
      }
      .pill {
        display: inline-block;
        padding: 0 8px;
        border-radius: 999px;
        font-weight: 700;
        line-height: 18px;
        background: #ffffff;
        color: #1f2933;
      }
      .q-bad .pill,
      .alarm .pill {
        color: #b42318;
      }
      .q-uncertain .pill {
        color: #7a4f00;
        background: #fff5d6;
      }
      .tile.q-bad,
      .tile.q-stale,
      .tile.q-unknown,
      .tile.alarm {
        outline: 2px dashed rgba(255, 255, 255, 0.9);
        outline-offset: -5px;
      }
      .tile.q-uncertain {
        outline: 2px dotted rgba(255, 255, 255, 0.9);
        outline-offset: -5px;
      }
      .spark {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 4px;
        width: 100%;
        height: 26%;
        opacity: 0.3;
        pointer-events: none;
      }
      .spark polyline {
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
      }
    `,
  ];

  #buf = new LiveBuffer();

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!this.item || !this.source) return;
    if (!this.prop('sparkline', false) && !this.prop('trend', false)) return;
    const id = this.tagOf('value');
    this.#buf.record(id, id ? this.source.get(id) : { value: null, quality: 'GOOD' });
  }

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const state: TagState = id ? this.source.get(id) : { value: null, quality: 'GOOD' };
    const info = id ? this.source.info(id) : undefined;
    const unitProp = this.item.props?.unit;
    const fmt = formatValue(state, info, {
      decimals: this.decimals(info),
      unit: typeof unitProp === 'string' ? unitProp : undefined,
      table: info?.valueTable ? this.source.valueTable(info.valueTable) : undefined,
    });
    const qv = this.qv(id);
    const alarmId = this.tagOf('alarm');
    const alarmOn = alarmId !== undefined && this.source.get(alarmId).value === true;
    const st = tileStatus(state.quality, alarmOn);
    const showStatus = this.prop('statusText', true) || st.pill;
    const label = this.prop('label', '');
    const dir = this.prop('trend', false) ? this.#buf.direction() : null;
    const segs = this.prop('sparkline', false) ? sparkSegments(this.#buf.values) : null;
    const aria = [
      `${this.nameOf(id)}: ${fmt.text}${fmt.unit ? ' ' + fmt.unit : ''}`,
      `${vi.dash.status}: ${st.word}`,
      dir ? vi.trend[dir] : '',
    ]
      .filter(Boolean)
      .join(', ');
    return html`<div
      class="tile ${st.cls}"
      role="group"
      aria-label=${aria}
      title=${qv.tooltip || nothing}
      style=${styleMap({ '--c': `var(--mat-tile-${tileColor(this.item.props?.color)})` })}
    >
      ${dashIcon(this.item.props?.icon) ?? nothing}
      ${
        segs && segs.length
          ? html`<svg
              class="spark"
              viewBox="0 0 100 24"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              ${segs.map(
                (p) => svg`<polyline points=${p} vector-effect="non-scaling-stroke"></polyline>`,
              )}
            </svg>`
          : nothing
      }
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="main">
        <span
          class="value ${qv.dim ? 'dim' : ''} ${this.blinking(state.value, state.quality) ? 'blink' : ''}"
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
        showStatus
          ? html`<div class="status" aria-hidden="true">
              ${vi.dash.status}:
              ${st.pill ? html`<span class="pill">${st.word}</span>` : html`<b>${st.word}</b>`}
            </div>`
          : nothing
      }
      ${this.statusLine()}
    </div>`;
  }
}
