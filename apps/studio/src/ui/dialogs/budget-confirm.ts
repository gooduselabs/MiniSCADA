// Hộp thoại chặn mềm "Cấu hình lưu trữ vượt ngân sách ghi" (feature 010, T122, FR-048, contracts/studio-010.md §1.3): hiện
// TRƯỚC bước Nạp xuống khi ước tính có W_LOG_WRITE_BUDGET / W_LOG_SIZE_CAP / W_LOG_WRITE_EXTREME và chưa xác nhận cho đúng
// số ước tính đó. Focus ban đầu ở Hủy; "Tôi hiểu, vẫn nạp" phải bấm chủ động; cực lớn thì phải gõ lại tên project.
import { LOG_BUDGET_BYTES } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { nameMatches } from '../../model/budget-confirm.ts';
import { sizeText } from '../estimate-panel.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './budget-confirm.css';

export class MatBudgetConfirmDialog extends OnlineDialog {
  static override properties = { typed: { state: true } };
  declare typed: string;

  constructor() {
    super();
    this.typed = '';
  }

  protected get kind(): 'budgetConfirm' {
    return 'budgetConfirm';
  }

  protected override opened(): void {
    this.typed = '';
  }

  protected override initialFocus(): HTMLElement | null {
    // Focus vào Hủy: nạp một cấu hình vượt ngân sách phải là việc người dùng chủ động chọn.
    return this.querySelector<HTMLElement>('[data-role="cancel"]');
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const gate = this.app.budgetGateNow();
    const v = gate.view;
    if (!v || gate.level === 'none') return nothing;
    const extreme = gate.level === 'extreme';
    const project = this.app.projectName();
    const canGo = !extreme || nameMatches(this.typed, project);
    const top = v.topGroup;
    const body = html`<p data-role="numbers">
        ${t(
          v.warnings.includes('W_LOG_SIZE_CAP') && !v.warnings.includes('W_LOG_WRITE_BUDGET')
            ? 'hist.bc.numbersCap'
            : 'hist.bc.numbers',
          {
            size: sizeText(v.bytesPerDay),
            budget: sizeText(LOG_BUDGET_BYTES),
            storage: sizeText(v.estimate.storageBytes),
          },
        )}
      </p>
      ${
        top
          ? html`<p data-role="top">
              ${t('hist.bc.top', { name: top.name, size: sizeText(top.totalBytes) })}
            </p>`
          : nothing
      }
      <p class="warnbox" data-role="effect">${t('hist.bc.effect')}</p>
      ${
        v.suggestions.length
          ? html`<ul class="help" data-role="tips">
              ${v.suggestions.map((s) => html`<li>${t(`hist.est.tip.${s}`)}</li>`)}
            </ul>`
          : nothing
      }
      ${
        extreme
          ? html`<label class="field">
              <span>${t('hist.bc.typeName', { name: project })}</span>
              <input
                class="input mono"
                type="text"
                data-role="type-name"
                autocomplete="off"
                spellcheck="false"
                .value=${this.typed}
                @input=${(e: Event) => (this.typed = (e.target as HTMLInputElement).value)}
              />
            </label>`
          : nothing
      }`;
    const foot = html`<span class="grow"></span>
      <button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}
      </button>
      <button
        class="btn danger"
        type="button"
        data-role="confirm"
        ?disabled=${!canGo}
        @click=${() => this.app.confirmBudget()}
      >
        ${t('hist.bc.confirm')}
      </button>`;
    return this.frame({ title: t('hist.bc.title'), icon: 'warn', body, foot });
  }
}

customElements.define('mat-budget-confirm-dialog', MatBudgetConfirmDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-budget-confirm-dialog': MatBudgetConfirmDialog;
  }
}
