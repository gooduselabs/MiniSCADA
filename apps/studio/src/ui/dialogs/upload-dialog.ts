// Hộp thoại Đọc lên (feature 005, US3, FR-028; theo openUpload của mockup đã duyệt): chọn "Thành project mới" (giải
// nén vào thư mục rỗng rồi mở) hoặc "So với project đang mở" (mở So sánh, không ghi đè gì). Việc làm tiếp do
// `app.startUpload`.
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';

export class MatUploadDialog extends OnlineDialog {
  protected readonly kind = 'upload';
  private mode: 'new' | 'compare' = 'new';

  protected override opened(): void {
    this.mode = 'new';
  }

  private pick(mode: 'new' | 'compare'): void {
    this.mode = mode;
    this.requestUpdate();
  }

  private option(
    mode: 'new' | 'compare',
    title: string,
    text: string,
    disabled: boolean,
    reason?: string,
  ) {
    return html`<label class="radio ${this.mode === mode ? 'on' : ''}" title=${reason ?? nothing}>
      <input
        type="radio"
        name="upload-mode"
        value=${mode}
        data-role=${`upload-${mode}`}
        ?disabled=${disabled}
        .checked=${this.mode === mode}
        @change=${() => this.pick(mode)}
      />
      <b>${title}</b>
      <small>${text}</small>
    </label>`;
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const app = this.app;
    const s = app.session;
    const name = s.device?.name ?? '';
    const project = s.info?.project;
    const hasProject = app.store.state.project !== null;
    const body = html`<p class="help">
        ${t('upload.text', {
          project: project?.projectName ?? project?.projectId ?? '',
          version: project?.projectVersion ?? '',
        })}
      </p>
      ${this.option('new', t('upload.new'), t('upload.newText'), false)}
      ${this.option(
        'compare',
        t('upload.compare'),
        t('upload.compareText'),
        !hasProject,
        hasProject ? undefined : t('upload.noProject'),
      )}`;
    const foot = html`<span class="grow"></span>
      <button class="btn" type="button" data-role="upload-cancel" @click=${() => this.close()}>
        ${t('upload.cancel')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-role="upload-go"
        @click=${() => app.startUpload(this.mode)}
      >
        ${icon(this.mode === 'new' ? 'upload' : 'compare')}${t(
          this.mode === 'new' ? 'upload.go.new' : 'upload.go.compare',
        )}
      </button>`;
    return this.frame({ title: t('upload.title', { name }), icon: 'upload', body, foot });
  }
}

customElements.define('mat-upload-dialog', MatUploadDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-upload-dialog': MatUploadDialog;
  }
}
