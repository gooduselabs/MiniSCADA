// Hộp thoại Nâng cấp project 0.1 / 0.2 → 0.3 và hộp thoại từ chối project mới hơn (feature 006, T082, FR-003, FR-004, FR-005,
// research R3; mockup studio-tags.html, d-upg). Nâng cấp / Mở chỉ đọc / Hủy; liệt kê các thay đổi của `migrate01to02`
// và nơi giữ bản sao lưu; chưa ghi gì. Esc là Hủy (đóng project).
import type { UpgradeChange } from '../../model/svg-upgrade.ts';
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';

const ERROR_KEY: Readonly<Record<string, MessageKey>> = {
  UNREADABLE: 'upgrade.error.UNREADABLE',
  UNSUPPORTED_VERSION: 'upgrade.error.UNSUPPORTED_VERSION',
  NEW_ERRORS: 'upgrade.error.NEW_ERRORS',
  ALREADY_02: 'upgrade.error.ALREADY_02',
  ALREADY_03: 'upgrade.error.ALREADY_03',
  ALREADY_04: 'upgrade.error.ALREADY_04',
  ALREADY_05: 'upgrade.error.ALREADY_05',
  ALREADY_06: 'upgrade.error.ALREADY_06',
  ALREADY_10: 'upgrade.error.ALREADY_10',
  NO_PROJECT: 'upgrade.error.NO_PROJECT',
};

/** Câu cho lỗi nâng cấp (mã của `migrate01to02` hoặc `NO_PROJECT`). */
export function upgradeErrorText(error: {
  code: string;
  file?: string;
  version?: string;
  errors?: string[];
}): string {
  const key = Object.prototype.hasOwnProperty.call(ERROR_KEY, error.code)
    ? ERROR_KEY[error.code]
    : 'upgrade.error.other';
  switch (key) {
    case 'upgrade.error.UNREADABLE':
      return t(key, { file: error.file ?? '' });
    case 'upgrade.error.UNSUPPORTED_VERSION':
      return t(key, { version: error.version ?? '' });
    case 'upgrade.error.NEW_ERRORS':
      return t(key, { errors: (error.errors ?? []).join(', ') });
    default:
      return t(key);
  }
}

function changeText(c: UpgradeChange): string {
  switch (c.kind) {
    case 'legacyTags':
      return t('upgrade.change.legacyTags', { count: c.count });
    case 'minRuntime':
      return t('upgrade.change.minRuntime', { version: c.version });
    case 'rewrite':
      return t('upgrade.change.rewrite', { files: c.files.join(', ') });
    case 'originalErrors':
      return t('upgrade.change.originalErrors', { count: c.count });
    case 'screens':
      return t('upgrade.change.screens', { count: c.count });
    case 'navigation':
      return t('upgrade.change.navigation', { entries: c.entries });
    case 'svgClean':
      return t('upgrade.change.svgClean', {
        elements: c.totalElements,
        attributes: c.totalAttributes,
        files: c.files.length,
        detail: c.files
          .map((f) => {
            const parts = Object.entries(f.elements).map(([name, n]) =>
              t('upgrade.svgClean.element', { name, count: n }),
            );
            if (f.attributes > 0) parts.push(t('upgrade.svgClean.attrs', { count: f.attributes }));
            if (f.codes.includes('R_DTD')) parts.push(t('upgrade.svgClean.dtd'));
            return `${f.file}: ${parts.join(', ')}`;
          })
          .slice(0, 3)
          .join('; '),
      });
  }
}

export class MatUpgradeDialog extends OnlineDialog {
  protected get kind(): 'upgrade' | 'refused' {
    return this.hasApp && this.app.ui.dialog?.kind === 'refused' ? 'refused' : 'upgrade';
  }

  /** Đã đưa focus vào nút chính (kế hoạch nâng cấp tính xong sau khi mở). */
  private focusedPrimary = false;

  protected override opened(): void {
    this.focusedPrimary = false;
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.dlg-f .primary:not([disabled])');
  }

  protected override updated(): void {
    super.updated();
    if (!this.isOpen || this.focusedPrimary) return;
    const primary = this.initialFocus();
    if (primary) {
      this.focusedPrimary = true;
      primary.focus();
    }
  }

  protected override close(): void {
    // Esc và nút đóng: Hủy (đóng project); hộp thoại từ chối thì chỉ đóng.
    if (this.kind === 'upgrade') void this.app.cancelUpgrade();
    else this.app.closeOnlineDialog();
  }

  private refusedView() {
    const d = this.app.ui.dialog;
    const version = d?.kind === 'refused' ? d.version : '';
    return this.frame({
      title: t('refused.title'),
      icon: 'warn',
      body: html`<div class="banner warn" role="alert">
        ${icon('warn', 'warn')}
        <div>${t('refused.text', { version })}</div>
      </div>`,
      foot: html`<span class="grow"></span
        ><button class="btn primary" type="button" @click=${() => this.close()}>
          ${t('refused.close')}
        </button>`,
    });
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    if (this.kind === 'refused') return this.refusedView();
    const app = this.app;
    const s = app.store.state;
    const plan = s.upgradePlan;
    const from = String(
      (s.docs['project.json']?.value as { schemaVersion?: unknown } | null)?.schemaVersion ??
        '0.1.0',
    );
    const backupDir = `.mat-backup/${from}-<UTC>/`;
    const failed = plan !== null && !plan.ok;
    const body = html`<p>${t('upgrade.text', { from })}</p>
      ${
        plan === null
          ? html`<p class="row" role="status">
              <span class="spin" aria-hidden="true"></span>${t('upgrade.planning')}
            </p>`
          : plan.ok
            ? html`<h3 class="dlg-sub">${t('upgrade.changes')}</h3>
                <ul class="ud-changes">
                  ${plan.changes.map((c) => html`<li>${changeText(c)}</li>`)}
                </ul>
                <p class="help">${t('upgrade.backup', { dir: backupDir })}</p>
                <p class="help">${t('upgrade.noWrite')}</p>`
            : html`<div class="banner err" role="alert">
                ${icon('err', 'err')}
                <div>${t('upgrade.failed', { reason: upgradeErrorText(plan.error) })}</div>
              </div>`
      }
      <p class="help">${t('upgrade.readonlyHelp')}</p>`;
    const foot = html`<button class="btn" type="button" @click=${() => void app.cancelUpgrade()}>
        ${t('upgrade.cancel')}</button
      ><span class="grow"></span
      ><button class="btn" type="button" @click=${() => app.openReadOnly()}>
        ${t('upgrade.readonly')}</button
      ><button
        class="btn primary"
        type="button"
        ?disabled=${plan === null || failed}
        @click=${() => void app.upgradeProject()}
      >
        ${t('upgrade.do')}
      </button>`;
    return this.frame({
      title: t('upgrade.title', { from }),
      icon: 'project',
      body,
      foot,
      busy: plan === null,
    });
  }
}

customElements.define('mat-upgrade-dialog', MatUpgradeDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-upgrade-dialog': MatUpgradeDialog;
  }
}
