// Trang "Nâng cấp lên 0.5.0 để dùng alarm" (feature 009, T075, T081, FR-073, FR-012; contract studio-alarm-editor §2, §11): hai
// nút con của mục Alarm trên cây mở trang này ở project 0.1 đến 0.4, không còn nhãn giai đoạn. Nút Nâng cấp dùng cùng đường
// với hộp thoại Nâng cấp khi mở project (`app.upgradeProject`).
import { html } from 'lit';
import { t } from '../../i18n/index.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';

export class AlarmUpgradePage extends AppElement {
  protected override render() {
    const s = this.app.store.state;
    return html`<div class="ed">
      <div class="ed-head">
        <h2>${t('alarm.upgrade.title')}</h2>
      </div>
      <div class="empty phase-page">
        ${icon('bell', 'lg')}
        <b>${t('alarm.upgrade.title')}</b>
        <p>${t('phasePage.alarmUpgrade')}</p>
        ${
          s.readOnly
            ? html`<p class="help" role="status">${t('alarm.upgrade.readOnly')}</p>`
            : html`<button
                class="btn primary"
                type="button"
                data-act="alarm-upgrade"
                @click=${() => void this.app.run('alarm.upgrade')}
              >
                ${t('alarm.upgrade.do')}
              </button>`
        }
      </div>
    </div>`;
  }
}

customElements.define('mat-alarm-upgrade', AlarmUpgradePage);

registerEditor({
  match: (id) => id === 'alarmUpgrade',
  render: (app) => html`<mat-alarm-upgrade .app=${app}></mat-alarm-upgrade>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-alarm-upgrade': AlarmUpgradePage;
  }
}
