// Hộp thoại Đổi tên Tag (feature 006, T189, FR-047, D32, mockup d-ren): hiện tên cũ, ô tên mới, danh sách chỗ sẽ đổi (biểu thức,
// bảng theo dõi, nhóm lưu trữ, binding) tính ngay khi gõ; xác nhận thì đổi hết bằng MỘT bước hoàn tác. Từ chối tên đã có hoặc
// sai luật tại ô. Luật đổi ở `renameTag` của @mat/project-schema; kế hoạch và sửa đổi ở model/rename-flow.ts.
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import { planRename, renameDone } from '../../model/rename-flow.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';

export class MatRenameTagDialog extends OnlineDialog {
  static override properties = { to: { state: true } };

  protected get kind(): 'renameTag' {
    return 'renameTag';
  }

  declare to: string;

  constructor() {
    super();
    this.to = '';
  }

  private spec(): { tagId: string; to?: string } | null {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'renameTag' ? d : null;
  }

  protected override opened(): void {
    const s = this.spec();
    this.to = s?.to ?? s?.tagId ?? '';
  }

  protected override initialFocus(): HTMLElement | null {
    const input = this.querySelector<HTMLInputElement>('input[name="to"]');
    queueMicrotask(() => input?.select());
    return input;
  }

  private plan(from: string) {
    return planRename(this.app.store.state.outline, from, this.to);
  }

  private submit(): void {
    const s = this.spec();
    if (!s) return;
    const plan = this.plan(s.tagId);
    if (!plan.ok) return;
    this.app.store.applyChange({ edits: plan.change.edits, replace: plan.change.replace });
    this.app.closeOnlineDialog();
    this.app.toast(renameDone(s.tagId, this.to, plan.items.length));
  }

  protected override render() {
    const s = this.spec();
    if (!this.isOpen || !s) return nothing;
    const from = s.tagId;
    const plan = this.plan(from);
    const same = this.to === from;
    const error =
      !plan.ok && plan.code !== 'E_RENAME_SAME'
        ? t(`rtd.err.${plan.code}` as MessageKey, { name: this.to })
        : null;
    const ready = plan.ok;
    const body = html`<div class="field">
        <span class="lbl">${t('rtd.from')}</span>
        <span class="mono" data-role="from">${from}</span>
      </div>
      <div class="field">
        <label for="rtd-to">${t('rtd.to')}</label>
        <input
          id="rtd-to"
          name="to"
          class="mono"
          type="text"
          autocomplete="off"
          spellcheck="false"
          .value=${this.to}
          aria-invalid=${error ? 'true' : 'false'}
          aria-describedby=${error ? 'rtd-err' : nothing}
          @input=${(e: Event) => (this.to = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) {
              e.preventDefault();
              this.submit();
            }
          }}
        />
        ${error ? html`<p class="field-err" id="rtd-err" role="alert">${error}</p>` : nothing}
      </div>
      ${
        plan.ok && !same
          ? html`<div class="rtd-hits">
              ${
                plan.items.length
                  ? html`<p data-role="count" role="status">
                        ${t('rtd.count', { n: plan.items.length })}
                      </p>
                      <ul data-role="hits" aria-label=${t('rtd.list')}>
                        ${plan.items.map((it) => html`<li>${icon('link')}<span>${it.text}</span></li>`)}
                      </ul>`
                  : html`<p class="help" data-role="none">${t('rtd.none')}</p>`
              }
            </div>`
          : nothing
      }
      <p class="help">${t('rtd.help')}</p>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-role="ok"
        aria-disabled=${ready ? nothing : 'true'}
        @click=${() => (ready ? this.submit() : undefined)}
      >
        ${t('rtd.do')}
      </button>`;
    return this.frame({ title: t('rtd.title'), icon: 'gear', body, foot });
  }
}

customElements.define('mat-rename-tag-dialog', MatRenameTagDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-rename-tag-dialog': MatRenameTagDialog;
  }
}
