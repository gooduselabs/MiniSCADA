// Hộp thoại Đổi tên của cây project 0.2 (feature 006, T084, FR-043): kênh, thiết bị trường, bảng giá trị, bảng theo dõi.
// Một ô tên điền sẵn; Enter đổi; lỗi hiện tại ô (role alert, aria-describedby); Esc hoặc Hủy thì không đổi gì.
import { html, nothing } from 'lit';
import { applyRename, renameDraft, selectedRef } from '../../app/tree-commands.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { OnlineDialog } from './dialog-frame.ts';

const HELP: Readonly<Record<string, MessageKey>> = {
  channel: 'tree.rename.help.channel',
  device: 'tree.rename.help.device',
  valueTable: 'tree.rename.help.valueTable',
  watch: 'tree.rename.help.watch',
};

export class MatRenameDialog extends OnlineDialog {
  static override properties = { value: { state: true }, error: { state: true } };

  protected get kind(): 'rename' {
    return 'rename';
  }

  declare value: string;
  declare error: MessageKey | null;

  constructor() {
    super();
    this.value = '';
    this.error = null;
  }

  protected override opened(): void {
    this.value = renameDraft(this.app);
    this.error = null;
  }

  protected override initialFocus(): HTMLElement | null {
    const input = this.querySelector<HTMLInputElement>('input[name="name"]');
    queueMicrotask(() => input?.select());
    return input;
  }

  private submit(): void {
    const r = applyRename(this.app, this.value);
    if (r && 'error' in r) {
      this.error = r.error;
      return;
    }
    this.app.closeOnlineDialog();
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const ref = selectedRef(this.app);
    const help = ref ? HELP[ref.type] : undefined;
    const errId = 'rename-err';
    const body = html`<label class="field">
        <span>${t('tree.rename.label')}</span>
        <input
          name="name"
          type="text"
          autocomplete="off"
          spellcheck="false"
          .value=${this.value}
          aria-invalid=${this.error ? 'true' : 'false'}
          aria-describedby=${this.error ? errId : nothing}
          @input=${(e: Event) => {
            this.value = (e.target as HTMLInputElement).value;
            this.error = null;
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.isComposing) {
              e.preventDefault();
              this.submit();
            }
          }}
        />
      </label>
      ${
        this.error
          ? html`<p class="field-err" id=${errId} role="alert">${t(this.error)}</p>`
          : nothing
      }
      ${help ? html`<p class="help">${t(help)}</p>` : nothing}`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button class="btn primary" type="button" data-role="ok" @click=${() => this.submit()}>
        ${t('tree.rename.do')}
      </button>`;
    return this.frame({ title: t('tree.rename.title'), icon: 'gear', body, foot });
  }
}

customElements.define('mat-rename-dialog', MatRenameDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-rename-dialog': MatRenameDialog;
  }
}
