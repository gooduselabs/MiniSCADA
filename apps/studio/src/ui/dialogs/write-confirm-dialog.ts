// Hộp thoại Xác nhận ghi của Bảng theo dõi (feature 006, T152, US2, FR-050, mockup d-wr): liệt kê TỪNG Tag sẽ ghi với thiết bị
// trường, giá trị hiện tại, giá trị mới đã hiểu, đơn vị, giới hạn — lấy từ định nghĩa Tag đang chạy trên BL335 (`projects/active`)
// — và cảnh báo khi khác bản trên máy. Dòng bị khóa hiện lý do và không được gửi. Chỉ ghi khi người dùng bấm "Ghi": Enter ở nơi
// khác không ghi, Esc hủy; focus ban đầu ở nút Hủy.
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { DeviceTagDef, WriteDraftItem } from '../../model/write-flow.ts';
import { OnlineDialog } from './dialog-frame.ts';

const ORDER_TEXT = (d: DeviceTagDef): string => {
  const s = d.source ?? {};
  const parts = [s.device, s.address, d.type];
  if (s.byteOrder) parts.push(s.byteOrder);
  return parts.filter(Boolean).join(' · ');
};

/** Giới hạn ghi của Tag theo định nghĩa trên BL335. */
function limitsText(d: DeviceTagDef | null | undefined): string {
  const l = d?.limits;
  if (!l) return t('wc.noLimits');
  if (l.min !== undefined && l.max !== undefined)
    return t('wc.limitsRange', { min: l.min, max: l.max });
  if (l.min !== undefined) return t('wc.limitsMin', { min: l.min });
  if (l.max !== undefined) return t('wc.limitsMax', { max: l.max });
  if (l.maxLength !== undefined) return t('wc.limitsLen', { n: l.maxLength });
  return t('wc.noLimits');
}

const valueText = (v: unknown): string =>
  typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);

export class MatWriteConfirmDialog extends OnlineDialog {
  protected get kind(): 'writeConfirm' {
    return 'writeConfirm';
  }

  /** Hủy: bỏ bản xem trước, không gửi gì. */
  protected override close(): void {
    this.app.writes.cancel();
    this.app.closeOnlineDialog();
  }

  protected override initialFocus(): HTMLElement | null {
    // Focus vào Hủy: ghi vào thiết bị thật phải là việc người dùng chủ động bấm.
    return this.querySelector<HTMLElement>('[data-role="cancel"]');
  }

  private async confirm(): Promise<void> {
    const n = await this.app.writes.confirm();
    this.app.closeOnlineDialog();
    if (n > 0) this.app.toast(t('wc.sent', { n }));
  }

  private reasonText(i: WriteDraftItem): string {
    const b = i.blocked!;
    return t(b.reason as MessageKey, (b.params ?? {}) as Record<string, string | number>);
  }

  private row(i: WriteDraftItem) {
    const def = i.def ?? null;
    return html`<tr data-tag=${i.tag} class=${i.blocked ? 'blocked' : ''}>
      <th scope="row" class="mono">${i.tag}</th>
      <td class="mono">${def ? ORDER_TEXT(def) : '—'}</td>
      <td class="mono num">${i.current || '—'}</td>
      <td class="mono num">
        ${i.value !== undefined ? html`<b>${valueText(i.value)}</b>${i.unit ? ` ${i.unit}` : ''}` : html`<span class="err">${i.text || '—'}</span>`}
      </td>
      <td>${limitsText(def)}</td>
      <td>
        ${
          i.blocked
            ? html`<span class="chip err">${t('wc.notSent')}</span>
                <span class="field-err">${this.reasonText(i)}</span>`
            : html`<span class="chip ok">${t('wc.willSend')}</span>`
        }
        ${
          i.differences.length
            ? html`<div class="warnbox" data-role="diff">
                ${t('wc.differs')}
                ${i.differences.map((d) => html`<div class="mono">${d.field}: ${d.local || '—'} ≠ ${d.device || '—'}</div>`)}
              </div>`
            : nothing
        }
      </td>
    </tr>`;
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const draft = this.app.writes.draft;
    if (!draft) return nothing;
    const n = draft.sendable;
    const body = html`<p>${t('wc.intro', { n })}</p>
      <p class="help">${t('wc.source')}</p>
      <div class="wc-table" role="region" tabindex="0" aria-label=${t('wc.title')}>
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">${t('wt.col.tag')}</th>
              <th scope="col">${t('wc.col.def')}</th>
              <th scope="col">${t('wc.col.current')}</th>
              <th scope="col">${t('wc.col.new')}</th>
              <th scope="col">${t('wc.col.limits')}</th>
              <th scope="col">${t('wc.col.note')}</th>
            </tr>
          </thead>
          <tbody>
            ${draft.items.map((i) => this.row(i))}
          </tbody>
        </table>
      </div>`;
    const foot = html`<span class="grow"></span>
      <button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}
      </button>
      <button
        class="btn danger"
        type="button"
        data-role="confirm"
        ?disabled=${n === 0}
        @click=${() => void this.confirm()}
      >
        ${t('wc.do', { n })}
      </button>`;
    return this.frame({ title: t('wc.title'), icon: 'upload', body, foot });
  }
}

customElements.define('mat-write-confirm-dialog', MatWriteConfirmDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-write-confirm-dialog': MatWriteConfirmDialog;
  }
}
