// Hộp "Dừng ghi của logic" (feature 011, T144; FR-083; mockup studio-logic.html cảnh 3; T007 quyết định 5): administrator
// dừng ngay mọi lệnh ghi từ logic xuống PLC, giữ qua khởi động lại (`POST /api/v1/logic/writes {"enabled": false}` qua phiên
// Rust có ghim). Phải tích "Tôi hiểu…"; KHÔNG đòi nhập lại mật khẩu (D35 chỉ áp cho OTA). Bật lại không làm được từ Studio.
import { html, nothing } from 'lit';
import type { OnlineDialogSpec } from '../../app/app.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t } from '../../i18n/index.ts';
import { isDeviceError, type DeviceError } from '../../platform/device-types.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from '../dialogs/dialog-frame.ts';
import { logicDoc, refreshLive } from './logic-state.ts';

export class LogicStopDialog extends OnlineDialog {
  protected readonly kind: OnlineDialogSpec['kind'] = 'logicStop';
  private ack = false;
  private busy = false;
  private error: DeviceError | null = null;

  protected override opened(): void {
    this.ack = false;
    this.busy = false;
    this.error = null;
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>('[data-role="stop-ack"]');
  }

  private async go(): Promise<void> {
    if (!this.ack || this.busy) return;
    this.busy = true;
    this.error = null;
    this.requestUpdate();
    const r = await this.app.session.stopLogicWrites();
    this.busy = false;
    if (isDeviceError(r)) {
      this.error = r;
      this.requestUpdate();
      return;
    }
    this.app.closeOnlineDialog();
    this.app.toast(t('logic.stop.done'));
    refreshLive(this.app);
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const doc = logicDoc(this.app);
    const tags = [...new Set((doc?.writes ?? []).map((w) => w.tag))];
    const rules = (doc?.rules ?? []).filter((r) =>
      [...(r.onRise ?? []), ...(r.onFall ?? [])].some((a) => a.do === 'write' || a.do === 'pulse'),
    ).length;
    const name = this.app.session.device?.name ?? '';
    const user = this.app.session.auth?.user ?? '';
    const body = html`<div class="lg-stop">
      <p>${t('logic.stop.lead')}</p>
      <table class="wl">
        <tbody>
          <tr>
            <th scope="row">${t('logic.stop.stopped')}</th>
            <td>
              ${t('logic.stop.stoppedText', { n: tags.length, tags: tags.join(', ') || '—', rules })}
            </td>
          </tr>
          <tr>
            <th scope="row">${t('logic.stop.running')}</th>
            <td>${t('logic.stop.runningText')}</td>
          </tr>
          <tr>
            <th scope="row">${t('logic.stop.audit')}</th>
            <td>${t('logic.stop.auditText', { user })}</td>
          </tr>
          <tr>
            <th scope="row">${t('logic.stop.enable')}</th>
            <td><b>${t('logic.stop.enableNo')}</b> ${t('logic.stop.enableText')}</td>
          </tr>
        </tbody>
      </table>
      <div class="banner warn" role="note">
        ${icon('warn', 'warn')}
        <div>${t('logic.stop.warn')}</div>
      </div>
      <label class="row inline"
        ><input
          type="checkbox"
          data-role="stop-ack"
          .checked=${this.ack}
          @change=${(e: Event) => {
            this.ack = (e.target as HTMLInputElement).checked;
            this.requestUpdate();
          }}
        />${t('logic.stop.ack')}</label
      >
      ${
        this.error
          ? html`<div class="banner err" role="alert">
              ${icon('err', 'err')}
              <div>${t('logic.stop.fail', { reason: deviceErrorText(this.error) })}</div>
            </div>`
          : nothing
      }
    </div>`;
    const foot = html`<span class="grow muted mono sm-text"
        >POST /api/v1/logic/writes {"enabled": false}</span
      >
      <button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dl.cancel')}
      </button>
      <button
        class="btn danger solid"
        type="button"
        data-act="stop-go"
        ?disabled=${!this.ack || this.busy}
        @click=${() => void this.go()}
      >
        ${icon('stop')}${t('logic.stop.go')}
      </button>`;
    return this.frame({
      title: t('logic.stop.title', { name }),
      icon: 'stop',
      body,
      foot,
      busy: this.busy,
    });
  }
}

customElements.define('mat-logic-stop-dialog', LogicStopDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-logic-stop-dialog': LogicStopDialog;
  }
}
