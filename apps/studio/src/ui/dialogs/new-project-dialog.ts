// Hộp thoại Project mới (lệnh Project → Project mới…, Ctrl+N, 2026-10-20): tên, mã project (tự sinh không dấu từ tên,
// sửa được), thư mục chứa (mặc định Documents\mAT SCADA, nút Chọn… mở hộp chọn thư mục của Rust), mẫu (Trống hay Mẫu
// trạm bơm) và chủ đề giao diện. Dòng "Project sẽ nằm ở" hiện thư mục đích `<cha>\<mã>` và trạng thái của nó (Rust
// kiểm: mới, trống, đã có project, có file khác) ngay khi gõ. Tạo thì gọi `app.createNewProject`; lỗi hiện tại chỗ,
// hộp thoại giữ nguyên.
import { html, nothing } from 'lit';
import type { MessageKey } from '../../i18n/index.ts';
import { t } from '../../i18n/index.ts';
import {
  NEW_PROJECT_TEMPLATES,
  PROJECT_ID_MAX,
  PROJECT_NAME_MAX,
  isValidProjectId,
  projectIdFromName,
  type NewProjectTemplate,
} from '../../model/new-project.ts';
import type { CreateFailure, NewTargetState } from '../../platform/types.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './new-project-dialog.css';

const TEMPLATE_TEXT: Readonly<Record<NewProjectTemplate, readonly [MessageKey, MessageKey]>> = {
  blank: ['np.tpl.blank', 'np.tpl.blankText'],
  pump: ['np.tpl.pump', 'np.tpl.pumpText'],
  dashboard: ['np.tpl.dashboard', 'np.tpl.dashboardText'],
  diagram: ['np.tpl.diagram', 'np.tpl.diagramText'],
};

interface Draft {
  name: string;
  id: string;
  /** Người dùng đã tự sửa mã: không sinh lại theo tên nữa. */
  idTouched: boolean;
  template: NewProjectTemplate;
}

const EMPTY: Draft = { name: '', id: '', idTouched: false, template: 'blank' };

export class MatNewProjectDialog extends OnlineDialog {
  static override properties = {
    draft: { state: true },
    parent: { state: true },
    target: { state: true },
    error: { state: true },
    busy: { state: true },
  };

  protected get kind(): 'newProject' {
    return 'newProject';
  }

  declare draft: Draft;
  /** Thư mục chứa (đường dẫn để hiện; Rust giữ đường dẫn thật). */
  declare parent: string | null;
  /** Trạng thái của thư mục đích theo Rust. */
  declare target: NewTargetState | null;
  declare error: string | null;
  declare busy: boolean;
  /** Số thứ tự lần kiểm thư mục đích: bỏ kết quả của lần kiểm cũ về muộn. */
  private checkSeq = 0;

  constructor() {
    super();
    this.draft = EMPTY;
    this.parent = null;
    this.target = null;
    this.error = null;
    this.busy = false;
  }

  protected override opened(): void {
    this.draft = EMPTY;
    this.target = null;
    this.error = null;
    this.busy = false;
    void this.app.platform.newProjectParentDefault().then(
      (r) => {
        this.parent = r.display;
        void this.check();
      },
      () => (this.parent = null),
    );
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLInputElement>('#np-name');
  }

  private patch(p: Partial<Draft>): void {
    this.draft = { ...this.draft, ...p };
    this.error = null;
  }

  private onName(name: string): void {
    this.patch(this.draft.idTouched ? { name } : { name, id: projectIdFromName(name) });
    void this.check();
  }

  private onId(id: string): void {
    this.patch({ id, idTouched: true });
    void this.check();
  }

  private regenId(): void {
    this.patch({ id: projectIdFromName(this.draft.name), idTouched: false });
    void this.check();
  }

  /** Hỏi Rust thư mục đích `<cha>/<mã>` đang thế nào (chỉ khi mã hợp lệ). */
  private async check(): Promise<void> {
    const seq = ++this.checkSeq;
    const id = this.draft.id;
    if (!this.parent || !isValidProjectId(id)) {
      this.target = null;
      return;
    }
    const r = await this.app.platform.newProjectCheck(id);
    if (seq !== this.checkSeq) return;
    this.target = typeof r === 'string' ? r : null;
  }

  private async pickFolder(): Promise<void> {
    const r = await this.app.platform.newProjectParentPick().catch(() => null);
    if (!r) return;
    this.parent = r.display;
    this.error = null;
    void this.check();
  }

  private async defaultFolder(): Promise<void> {
    const r = await this.app.platform.newProjectParentDefault().catch(() => null);
    if (!r) return;
    this.parent = r.display;
    this.error = null;
    void this.check();
  }

  private targetPath(): string | null {
    if (!this.parent || !this.draft.id) return null;
    const sep = this.parent.includes('\\') ? '\\' : '/';
    return this.parent.endsWith(sep)
      ? `${this.parent}${this.draft.id}`
      : `${this.parent}${sep}${this.draft.id}`;
  }

  private failureText(e: CreateFailure, detail?: string): string {
    const path = this.targetPath() ?? '';
    switch (e) {
      case 'exists-project':
        return t('np.err.exists', { path });
      case 'not-empty':
        return t('np.err.notEmpty', { path });
      case 'no-parent':
        return t('np.err.noParent');
      case 'bad-id':
        return t('np.err.id');
      case 'bad-path':
        return t('np.err.badPath');
      case 'io':
        return t('np.err.io', { detail: detail ?? '' });
    }
  }

  /** Lỗi chặn nút Tạo, theo thứ tự các ô. */
  private blocking(): string | null {
    const d = this.draft;
    if (d.name.trim() === '') return t('np.err.name');
    if (!isValidProjectId(d.id)) return t('np.err.id');
    if (!this.parent) return t('np.err.noParent');
    if (this.target === 'exists-project' || this.target === 'not-empty')
      return this.failureText(this.target);
    return null;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const block = this.blocking();
    if (block) {
      this.error = block;
      return;
    }
    const d = this.draft;
    this.busy = true;
    const r = await this.app.createNewProject({
      name: d.name,
      id: d.id,
      template: d.template,
    });
    this.busy = false;
    if (r !== true) {
      this.error = this.failureText(r.error, r.detail);
      void this.check();
    }
  }

  private enterSubmits(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      void this.submit();
    }
  }

  private targetRow() {
    const path = this.targetPath();
    const state = this.target;
    const bad = state === 'exists-project' || state === 'not-empty';
    const chip =
      state === 'free'
        ? html`<span class="chip ok">${t('np.state.free')}</span>`
        : state === 'empty'
          ? html`<span class="chip info">${t('np.state.empty')}</span>`
          : bad
            ? html`<span class="chip err"
                >${icon('warn', 'sm')}${t(state === 'exists-project' ? 'np.state.exists' : 'np.state.notEmpty')}</span
              >`
            : nothing;
    return html`<div class="np-target ${bad ? 'bad' : ''}" aria-live="polite">
      ${icon('project')}
      <div class="np-target-b">
        <span class="np-k">${t('np.target')}</span>
        <code class="np-path" title=${path ?? ''}>${path ?? '—'}</code>
        ${chip} ${bad ? html`<p class="err-text">${this.failureText(state)}</p>` : nothing}
      </div>
    </div>`;
  }

  private templateCard(tpl: NewProjectTemplate) {
    const [title, text] = TEMPLATE_TEXT[tpl];
    const on = this.draft.template === tpl;
    return html`<label class="np-card ${on ? 'on' : ''}" data-template=${tpl}>
      <input
        type="radio"
        name="np-template"
        value=${tpl}
        .checked=${on}
        @change=${() => this.patch({ template: tpl })}
      />
      <span class="np-tpl-thumb ${tpl}" aria-hidden="true">
        ${
          tpl === 'blank'
            ? html`<i></i><i></i><i></i>`
            : html`<i></i><i></i><i></i><i class="wide"></i><i class="wide"></i>`
        }
      </span>
      <span class="np-card-t"><b>${t(title)}</b><small>${t(text)}</small></span>
    </label>`;
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const d = this.draft;
    const idBad = d.id !== '' && !isValidProjectId(d.id);
    const body = html`<div class="np">
        <div class="np-main">
          <div class="field">
            <label for="np-name">${t('np.name')}</label>
            <input
              id="np-name"
              class="input"
              type="text"
              maxlength=${PROJECT_NAME_MAX}
              autocomplete="off"
              spellcheck="false"
              placeholder=${t('np.namePh')}
              aria-required="true"
              .value=${d.name}
              @input=${(e: Event) => this.onName((e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => this.enterSubmits(e)}
            />
          </div>
          <div class="field">
            <label for="np-id">${t('np.id')}</label>
            <div class="np-row">
              <input
                id="np-id"
                class="input mono ${idBad ? 'bad' : ''}"
                type="text"
                maxlength=${PROJECT_ID_MAX}
                autocomplete="off"
                spellcheck="false"
                aria-required="true"
                aria-invalid=${idBad ? 'true' : 'false'}
                aria-describedby="np-id-help"
                .value=${d.id}
                @input=${(e: Event) => this.onId((e.target as HTMLInputElement).value)}
                @keydown=${(e: KeyboardEvent) => this.enterSubmits(e)}
              />
              <button
                class="ibtn"
                type="button"
                ?disabled=${!d.idTouched}
                aria-label=${t('np.idAuto')}
                title=${t('np.idAuto')}
                @click=${() => this.regenId()}
              >
                ${icon('refresh')}
              </button>
            </div>
            <p class="help ${idBad ? 'bad' : ''}" id="np-id-help">
              ${idBad ? t('np.err.id') : t('np.idHelp')}
            </p>
          </div>
          <div class="field">
            <span class="np-label" id="np-folder-l">${t('np.folder')}</span>
            <div class="np-row" role="group" aria-labelledby="np-folder-l">
              <code class="np-path np-parent" title=${this.parent ?? ''}
                >${this.parent ?? '—'}</code
              >
              <button
                class="btn"
                type="button"
                data-role="pick"
                title=${t('np.folderPickTip')}
                @click=${() => void this.pickFolder()}
              >
                ${t('np.folderPick')}
              </button>
              <button
                class="btn"
                type="button"
                data-role="default"
                title=${t('np.folderDefaultTip')}
                @click=${() => void this.defaultFolder()}
              >
                ${t('np.folderDefault')}
              </button>
            </div>
          </div>
          ${this.targetRow()}
        </div>
        <div class="np-side">
          <fieldset class="np-set">
            <legend>${t('np.template')}</legend>
            ${NEW_PROJECT_TEMPLATES.map((x) => this.templateCard(x))}
          </fieldset>
        </div>
      </div>
      ${this.error ? html`<p class="field-err" role="alert">${this.error}</p>` : nothing}`;
    const foot = html`<span class="np-format">${icon('info', 'sm')}${t('np.format')}</span>
      <span class="grow"></span>
      <button
        class="btn"
        type="button"
        data-role="cancel"
        ?disabled=${this.busy}
        @click=${() => this.close()}
      >
        ${t('dlg.cancel')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-role="ok"
        ?disabled=${this.busy}
        @click=${() => void this.submit()}
      >
        ${this.busy ? t('np.creating') : t('np.do')}
      </button>`;
    return this.frame({
      title: t('np.title'),
      icon: 'fnew',
      body,
      foot,
      busy: this.busy,
      closeDisabled: this.busy,
    });
  }

  protected override close(): void {
    if (!this.busy) super.close();
  }
}

customElements.define('mat-new-project-dialog', MatNewProjectDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-new-project-dialog': MatNewProjectDialog;
  }
}
