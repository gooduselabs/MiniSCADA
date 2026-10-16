// Khung Ước tính ghi của editor Lưu trữ (feature 010, FR-047, contracts/studio-010.md §1.2; T121). Chỉ vẽ `EstimateView`
// (số lấy từ `estimateLogging` ở estimate-view.ts, không có công thức riêng): mức màu kèm nhãn chữ, thanh, bảng nhóm với
// nhãn cơ sở, dung lượng, cảnh báo kèm nhóm lớn nhất và gợi ý, "chưa tính n Tag", cột "Đo thực" khi Online và nút
// Dùng số đo (sự kiện `use-measure`). Light DOM, mọi dữ liệu đi qua binding của Lit.
import { LOG_BUDGET_BYTES } from '@mat/project-schema';
import { html, LitElement, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { t, type MessageKey } from '../i18n/index.ts';
import type { Basis, EstimateView, Level, Suggestion } from '../model/estimate-view.ts';
import { sizeText } from '../model/size-text.ts';
import './estimate-panel.css';

/** Số đo từ thiết bị (`system/info`): ghi eMMC đo 24 giờ và số dòng 24 giờ theo nhóm. */
export interface EstimateOnline {
  bytesPerDay: number | null;
  rows24h: ReadonlyMap<string, number>;
  /** Nguồn số đo ghi (ADR-039); `sqlite-vfs` thì khung ghi chú cách đếm. */
  source?: 'proc-self-io' | 'sqlite-vfs' | null;
}

const INT = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
export { sizeText };

/** Số GB của đầu khung: luôn đơn vị GB (so với ngân sách 2 GB), hai chữ số thập phân. */
const gbNum = (n: number): string => {
  const g = n / 1e9;
  return g > 0 && g < 0.01
    ? '< 0,01'
    : g.toLocaleString('vi-VN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
};

const LEVEL_BADGE: Readonly<Record<Level, MessageKey>> = {
  ok: 'hist.est.lvOk',
  warn: 'hist.est.lvWarn',
  hot: 'hist.est.lvHot',
  extreme: 'hist.est.lvExtreme',
};
const BASIS: Readonly<Record<Basis, MessageKey>> = {
  exact: 'hist.est.basis.exact',
  expected: 'hist.est.basis.expected',
  upper: 'hist.est.basis.upper',
};
const TIP: Readonly<Record<Suggestion, MessageKey>> = {
  raiseInterval: 'hist.est.tip.raiseInterval',
  useCombined: 'hist.est.tip.useCombined',
  fewerTags: 'hist.est.tip.fewerTags',
  setExpected: 'hist.est.tip.setExpected',
};

export class EstimatePanel extends LitElement {
  static override properties = {
    view: { attribute: false },
    online: { attribute: false },
  };

  declare view: EstimateView;
  declare online: EstimateOnline | null;

  constructor() {
    super();
    this.view = { state: 'blocked' };
    this.online = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private warnings(v: Extract<EstimateView, { state: 'ok' }>) {
    const top = v.topGroup;
    const topText = top
      ? t('hist.est.topGroup', { name: top.name, size: sizeText(top.totalBytes) })
      : '';
    const msgs: string[] = [];
    for (const w of v.warnings) {
      if (w === 'W_LOG_WRITE_EXTREME')
        msgs.push(t('hist.est.warn.extreme', { size: sizeText(v.bytesPerDay), top: topText }));
      else if (w === 'W_LOG_WRITE_BUDGET')
        msgs.push(
          t('hist.est.warn.budget', {
            size: sizeText(v.bytesPerDay),
            budget: sizeText(LOG_BUDGET_BYTES),
            top: topText,
          }),
        );
      else if (w === 'W_LOG_SIZE_CAP')
        msgs.push(
          t('hist.est.warn.cap', {
            size: sizeText(v.estimate.storageBytes),
            cap: sizeText(LOG_BUDGET_BYTES),
            top: topText,
          }),
        );
    }
    return msgs;
  }

  private onlineBlock(v: Extract<EstimateView, { state: 'ok' }>) {
    const o = this.online;
    if (!o || (o.bytesPerDay === null && o.rows24h.size === 0)) return nothing;
    return html`<div class="est-online">
      <h4>${t('hist.est.measured')}</h4>
      ${
        o.bytesPerDay !== null
          ? html`<p class="est-cmp">
                ${t('hist.est.measuredVsEst', {
                  real: sizeText(o.bytesPerDay),
                  est: sizeText(v.bytesPerDay),
                })}
              </p>
              ${o.source === 'sqlite-vfs' ? html`<p class="est-note">${t('hist.est.measuredVfsNote')}</p>` : nothing}`
          : nothing
      }
      ${
        o.rows24h.size > 0
          ? html`<button class="tbtn est-use" type="button" @click=${this.useMeasure}>
              ${t('hist.est.useMeasure')}
            </button>`
          : nothing
      }
    </div>`;
  }

  private readonly useMeasure = (): void => {
    this.dispatchEvent(new CustomEvent('use-measure', { bubbles: true }));
  };

  protected override render() {
    const v = this.view;
    if (v.state !== 'ok')
      return html`<section class="est est-empty" aria-label=${t('hist.est.title')}>
        <h3>${t('hist.est.title')}</h3>
        <p class="est-state" role="status">
          ${t(v.state === 'blocked' ? 'hist.est.blocked' : 'hist.est.noTags')}
        </p>
      </section>`;
    const pct = Math.round(v.percent);
    const warnings = this.warnings(v);
    const big = gbNum(v.bytesPerDay);
    const online = this.online;
    const showRows = !!online && online.rows24h.size > 0;
    return html`<section class="est lv-${v.level}" aria-label=${t('hist.est.title')}>
      <h3>${t('hist.est.title')}</h3>
      <div class="est-head">
        <span class="est-big">${t('hist.est.perDay', { gb: big })}</span>
        <span class="est-badge">${t(LEVEL_BADGE[v.level])}</span>
      </div>
      <div
        class="est-meter"
        role="img"
        aria-label=${t('hist.est.meterLabel', { gb: big, pct, budget: gbNum(LOG_BUDGET_BYTES) })}
      >
        <span class="est-bar" style=${styleMap({ width: `${Math.min(100, v.percent)}%` })}></span>
      </div>
      <p class="est-sr">
        ${t('hist.est.sr', {
          gb: big,
          pct,
          budget: gbNum(LOG_BUDGET_BYTES),
          level: t(LEVEL_BADGE[v.level]),
        })}
      </p>
      <p class="est-split">
        ${t('hist.est.split', {
          raw: sizeText(v.estimate.rawWriteBytesPerDay),
          agg: sizeText(v.estimate.aggWriteBytesPerDay),
        })}
      </p>
      <p class="est-storage">
        ${
          v.daysToFillCap === null
            ? t('hist.est.storageStable', {
                size: sizeText(v.estimate.storageBytes),
                cap: sizeText(LOG_BUDGET_BYTES),
              })
            : t(v.warnings.includes('W_LOG_SIZE_CAP') ? 'hist.est.fillsIn' : 'hist.est.keeps', {
                n: INT.format(v.daysToFillCap),
                size: sizeText(v.estimate.storageBytes),
                cap: sizeText(LOG_BUDGET_BYTES),
              })
        }
      </p>
      ${
        v.unknownTags > 0
          ? html`<p class="est-unknown">${t('hist.est.unknown', { n: v.unknownTags })}</p>`
          : nothing
      }
      <table class="est-groups">
        <caption class="est-sr">
          ${t('hist.est.groupsCaption')}
        </caption>
        <thead>
          <tr>
            <th scope="col">${t('hist.est.col.group')}</th>
            <th scope="col" class="num">${t('hist.est.col.raw')}</th>
            <th scope="col" class="num">${t('hist.est.col.agg')}</th>
            <th scope="col" class="num">${t('hist.est.col.total')}</th>
            <th scope="col">${t('hist.est.col.basis')}</th>
            ${showRows ? html`<th scope="col" class="num">${t('hist.est.col.rows24h')}</th>` : nothing}
          </tr>
        </thead>
        <tbody>
          ${v.groups.map(
            (g) =>
              html`<tr>
                <th scope="row" title=${g.name}>${g.name}</th>
                <td class="num">${sizeText(g.rawBytes)}</td>
                <td class="num">${sizeText(g.aggBytes)}</td>
                <td class="num">${sizeText(g.totalBytes)}</td>
                <td class="est-basis">${t(BASIS[g.basis])}</td>
                ${
                  showRows
                    ? html`<td class="num">
                        ${online!.rows24h.has(g.id) ? INT.format(online!.rows24h.get(g.id)!) : t('hist.dash')}
                      </td>`
                    : nothing
                }
              </tr>`,
          )}
        </tbody>
      </table>
      ${warnings.map((w) => html`<p class="est-warn" role="status">${w}</p>`)}
      ${
        v.suggestions.length
          ? html`<ul class="est-tips" aria-label=${t('hist.est.tips')}>
              ${v.suggestions.map((s) => html`<li>${t(TIP[s])}</li>`)}
            </ul>`
          : nothing
      }
      ${this.onlineBlock(v)}
    </section>`;
  }
}

customElements.define('mat-estimate-panel', EstimatePanel);

declare global {
  interface HTMLElementTagNameMap {
    'mat-estimate-panel': EstimatePanel;
  }
}
