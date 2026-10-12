// Hộp thoại xác nhận chứng chỉ (feature 005, US1, FR-008, spec US1-3, US1-4; theo drawCert của mockup đã
// duyệt). Hai dạng:
// - lần đầu: fingerprint SHA-256 đủ 64 ký tự (chữ đơn cách, nhóm theo cặp), hướng dẫn so với
//   `mat-runtime --cert-fingerprint`; chỉ ghim khi người dùng bấm "Ghim và tiếp tục". Fingerprint của gói
//   tìm khác kết quả dò thì cảnh báo đỏ (gói tìm chỉ để tham khảo, R6);
// - không khớp (phiên ở `error`/`cert-mismatch`): chặn, hiện fingerprint đã ghim và fingerprint thấy, nói
//   rõ nguy cơ; nút gỡ ghim khóa tới khi người dùng đánh dấu đã kiểm trên thiết bị; focus mặc định ở Đóng.
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { compareDiscovered } from '../../model/discovery.ts';
import { icon } from '../base.ts';
import { groupFingerprint, OnlineDialog } from './dialog-frame.ts';

export class MatPinDialog extends OnlineDialog {
  protected readonly kind = 'pin';
  /** Người dùng đánh dấu đã kiểm fingerprint mới trên thiết bị (mới được gỡ ghim). */
  private confirmUnpin = false;

  protected override opened(): void {
    this.confirmUnpin = false;
  }

  protected override initialFocus(): HTMLElement | null {
    // Lần đầu: nút Ghim và tiếp tục (mockup). Không khớp: nút Đóng (an toàn mặc định).
    return this.querySelector<HTMLElement>('.dlg-f .primary:not([disabled])');
  }

  private mismatchView(name: string) {
    const s = this.app.session;
    const m = s.mismatch;
    const busy = s.busy;
    const body = html`<div class="banner err" role="alert">
        ${icon('err', 'err')}
        <div>
          <b>${t('pin.mismatchHead', { name })}</b>
          <p>${t('pin.mismatchText')}</p>
        </div>
      </div>
      <div class="pd-fp">
        <span>${t('pin.pinnedLabel')}</span>
        <pre class="fp mono">${m?.pinned ? groupFingerprint(m.pinned) : t('pin.seenUnknown')}</pre>
      </div>
      <div class="pd-fp">
        <span>${t('pin.seenLabel')}</span>
        <pre class="fp mono">${m?.seen ? groupFingerprint(m.seen) : t('pin.seenUnknown')}</pre>
      </div>
      <label class="inline"
        ><input
          type="checkbox"
          .checked=${this.confirmUnpin}
          @change=${(e: Event) => {
            this.confirmUnpin = (e.target as HTMLInputElement).checked;
            this.requestUpdate();
          }}
        />${t('pin.unpinCheck')}</label
      >
      <p class="help">${t('pin.unpinHelp')}</p>`;
    const foot = html`<button
        class="btn"
        type="button"
        ?disabled=${!this.confirmUnpin || busy || !m}
        @click=${() => {
          this.confirmUnpin = false;
          void this.app.unpin();
        }}
      >
        ${icon('shield')}${t('pin.unpin')}
      </button>
      <span class="grow"></span>
      <button class="btn primary" type="button" @click=${() => this.close()}>
        ${t('pin.close')}
      </button>`;
    return this.frame({
      title: t('pin.mismatchTitle', { name }),
      icon: 'shield',
      body,
      foot,
      busy,
    });
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const app = this.app;
    const s = app.session;
    const d = s.device;
    const name = d?.name ?? '';
    if (s.state === 'error' && s.error === 'cert-mismatch') return this.mismatchView(name);
    const p = s.state === 'pin-confirm' ? s.probe : null;
    const busy = s.busy || !p;
    const differs = p ? compareDiscovered(p) === 'differs' : false;
    const body = p
      ? html`<div class="note-box">
            ${icon('shield', 'lg info')}
            <div>
              <b>${t('pin.first', { name, address: d ? `${d.host}:${d.httpsPort}` : '' })}</b>
              <p>${t('pin.text')}</p>
            </div>
          </div>
          <div class="pd-fp">
            <span>${t('pin.fpLabel')}</span>
            <pre class="fp mono">${groupFingerprint(p.fingerprint)}</pre>
          </div>
          ${
            differs && p.discovered
              ? html`<div class="banner err" role="alert">
                  ${icon('warn', 'err')}
                  <div>
                    ${t('pin.discoveredDiffers', {
                      short: groupFingerprint(p.discovered).slice(0, 11),
                    })}
                  </div>
                </div>`
              : nothing
          }`
      : html`<p class="row" role="status">
          <span class="spin" aria-hidden="true"></span>${t('pin.probing', { name })}
        </p>`;
    const foot = html`<button class="btn" type="button" @click=${() => app.cancelOnline(true)}>
        ${t('pin.back')}
      </button>
      <span class="grow"></span>
      <button
        class="btn primary"
        type="button"
        ?disabled=${busy}
        @click=${() => void app.confirmPin()}
      >
        ${icon('shield')}${s.busy ? t('pin.busy') : t('pin.confirm')}
      </button>`;
    return this.frame({ title: t('pin.title', { name }), icon: 'shield', body, foot, busy });
  }
}

customElements.define('mat-pin-dialog', MatPinDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-pin-dialog': MatPinDialog;
  }
}
