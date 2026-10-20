// Widget `kpi` (feature 014): số đọc to so với mục tiêu: dòng "Mục tiêu …", chênh lệch phần trăm có mũi tên (▲ trên,
// ▼ dưới mục tiêu; màu tốt/xấu theo `higherIsBetter`, luôn kèm chữ), thanh mảnh giá trị/mục tiêu. Mục tiêu lấy từ khe
// `goal` (Tag) nếu có giá trị dùng được, không thì từ thuộc tính `goal`; không có mục tiêu thì chỉ hiện số.
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { formatValue, numberOf } from '../format/format-value.ts';
import type { TagState } from '../host/types.ts';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';

export interface KpiCompare {
  /** Chênh lệch theo phần trăm của |mục tiêu| (mục tiêu 0: null). */
  pct: number | null;
  dir: 'up' | 'down' | 'flat';
  meets: boolean;
  /** Tỷ lệ giá trị/mục tiêu, kẹp 0..1 (thanh). */
  ratio: number;
}

/** So giá trị với mục tiêu (hàm thuần). */
export function kpiCompare(value: number, goal: number, higherIsBetter: boolean): KpiCompare {
  const dir = value > goal ? 'up' : value < goal ? 'down' : 'flat';
  const pct = goal === 0 ? null : ((value - goal) / Math.abs(goal)) * 100;
  const meets = higherIsBetter ? value >= goal : value <= goal;
  const ratio = goal > 0 ? Math.min(1, Math.max(0, value / goal)) : value >= goal ? 1 : 0;
  return { pct, dir, meets, ratio };
}

const usable = (s: TagState): number | null => {
  const n = numberOf(s.value);
  return Number.isFinite(n) && (s.quality === 'GOOD' || s.quality === 'UNCERTAIN') ? n : null;
};

export class MatKpi extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        justify-content: center;
        gap: 4px;
        padding: 12px 16px;
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        box-shadow: var(--mat-shadow-card, none);
      }
      .label {
        font-size: 13px;
        color: var(--mat-text-muted);
        padding-right: 36px;
      }
      .main {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
      }
      .value {
        font-size: 32px;
        font-weight: 700;
        line-height: 1.15;
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .unit {
        font-size: 14px;
        color: var(--mat-text-muted);
      }
      .goal {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        color: var(--mat-text-muted);
        min-width: 0;
      }
      .goal .t {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .delta {
        flex: none;
        padding: 1px 8px;
        border-radius: 999px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .delta.good {
        color: var(--mat-good);
        background: var(--mat-good-soft);
      }
      .delta.bad {
        color: var(--mat-bad);
        background: var(--mat-bad-soft);
      }
      .meter {
        height: 6px;
        border-radius: 999px;
        background: var(--mat-surface-2);
        border: 1px solid var(--mat-border);
        overflow: hidden;
      }
      .meter > i {
        display: block;
        height: 100%;
        background: var(--mat-accent);
      }
      .meter.good > i {
        background: var(--mat-good);
      }
    `,
  ];

  #goal(): number | null {
    const id = this.tagOf('goal');
    if (id) {
      const g = usable(this.source.get(id));
      if (g !== null) return g;
    }
    const p = this.item.props?.goal;
    return typeof p === 'number' && Number.isFinite(p) ? p : null;
  }

  protected override renderWidget(): TemplateResult {
    const id = this.tagOf('value');
    const state: TagState = id ? this.source.get(id) : { value: null, quality: 'GOOD' };
    const info = id ? this.source.info(id) : undefined;
    const unitProp = this.item.props?.unit;
    const opts = {
      decimals: this.decimals(info),
      unit: typeof unitProp === 'string' ? unitProp : undefined,
    };
    const fmt = formatValue(state, info, opts);
    const qv = this.qv(id);
    const label = this.prop('label', '');
    const goal = this.#goal();
    const v = usable(state);
    const cmp =
      goal !== null && v !== null ? kpiCompare(v, goal, this.prop('higherIsBetter', true)) : null;
    const goalText =
      goal === null ? '' : formatValue({ value: goal, quality: 'GOOD' }, info, opts).text;
    const deltaText =
      cmp && cmp.pct !== null
        ? `${cmp.dir === 'up' ? '▲' : cmp.dir === 'down' ? '▼' : '–'} ${Math.abs(cmp.pct).toFixed(1)} %`
        : '';
    const aria = [
      `${this.nameOf(id)}: ${fmt.text}${fmt.unit ? ' ' + fmt.unit : ''}`,
      goal !== null ? `${vi.dash.goal} ${goalText}${fmt.unit ? ' ' + fmt.unit : ''}` : '',
      deltaText ? `${deltaText.slice(2)} ${vi.dash.ofGoal}` : '',
      qv.aria,
    ]
      .filter(Boolean)
      .join(', ');
    return html`<div class="w ${qv.cls}" role="group" aria-label=${aria}>
      ${label ? html`<div class="label ellipsis">${label}</div>` : nothing}
      <div class="main">
        <span class="value ${qv.dim ? 'dim' : ''}">${fmt.text}</span>
        ${fmt.unit ? html`<span class="unit">${fmt.unit}</span>` : nothing}
      </div>
      ${
        goal !== null
          ? html`<div class="goal">
                <span class="t">${vi.dash.goal}: ${goalText}${fmt.unit ? ' ' + fmt.unit : ''}</span>
                ${
                  deltaText
                    ? html`<span class="delta ${cmp!.meets ? 'good' : 'bad'}" aria-hidden="true"
                        >${deltaText}</span
                      >`
                    : nothing
                }
              </div>
              <div class="meter ${cmp?.meets ? 'good' : ''}" aria-hidden="true">
                <i style=${styleMap({ width: `${((cmp?.ratio ?? 0) * 100).toFixed(1)}%` })}></i>
              </div>`
          : nothing
      }
      ${this.badge(qv)}
    </div>`;
  }
}
