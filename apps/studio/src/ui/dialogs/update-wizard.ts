// Hộp "Cập nhật runtime" (OTA, feature 011, T119; FR-068; contracts/device-api-011.md §3): administrator tải gói `.matupdate`
// đã ký lên thiết bị đang Online, xem kế hoạch (phiên bản, tương thích project, thời gian ngừng, người ký), nhập lại mật khẩu
// để áp dụng, theo dõi qua lúc dịch vụ chạy lại tới kết quả (committed, rolled-back, mất kết nối quá 120 s), và "Quay về bản
// trước". Không có mockup riêng: khung, bước tiến trình và khối kết quả theo hộp Nạp xuống (download-dialog.ts, deploy-parts.ts).
// Mật khẩu chỉ nằm trong ô nhập tới lúc gửi rồi bị xóa; không vào trạng thái của luồng, không vào nhật ký.
import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';
import type { OnlineDialogSpec, StudioApp } from '../../app/app.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { hasKey, t, type MessageKey } from '../../i18n/index.ts';
import { formatBytes } from '../../model/device.ts';
import {
  UpdateFlow,
  updateErrorCode,
  updateErrorDetail,
  type UpdateAccess,
  type UpdatePlan,
  type UpdateResult,
} from '../../model/update-flow.ts';
import type { DeviceError } from '../../platform/device-types.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './update-wizard.css';

const PASSWORD_ID = 'upd-password';
const PASSWORD_HELP_ID = 'upd-password-help';

/** Câu cho lỗi của các lệnh OTA: mã của thiết bị kèm câu tiếng Việt; lỗi khác theo bảng chung của lệnh Rust. */
export function updateErrorText(e: DeviceError): string {
  const code = updateErrorCode(e);
  if (code) {
    const key = `ota.code.${code}`;
    const text = hasKey(key) ? t(key as MessageKey) : t('ota.code.other');
    const detail = updateErrorDetail(e);
    return detail ? t('ota.errDetail', { text, code, detail }) : t('ota.err', { text, code });
  }
  if (e.error === 'bad-args') return t('ota.err.badFile');
  if (e.error === 'no-such-package') return t('ota.err.noFile');
  return deviceErrorText(e);
}

/**
 * Nút mở hộp Cập nhật runtime (task card của trang Thiết bị và Công cụ online). `disabled`: OTA tắt trên thiết bị, nút khóa
 * (`aria-disabled`, vẫn nhận focus) và trỏ tới dòng gợi ý `hintId`.
 */
export function otaButton(
  app: StudioApp,
  access: Exclude<UpdateAccess, 'hidden'>,
  hintId?: string,
): TemplateResult {
  const off = access === 'disabled';
  return html`<div class="row dp-actions">
    <button
      class="btn"
      type="button"
      data-act="ota-open"
      aria-disabled=${off ? 'true' : nothing}
      aria-describedby=${off && hintId ? hintId : nothing}
      title=${off ? t('ota.card.disabled') : t('ota.card.text')}
      @click=${() => {
        if (!off) app.openDialog({ kind: 'runtimeUpdate' });
      }}
    >
      ${icon(off ? 'lock' : 'upload')}${t('ota.card.open')}
    </button>
  </div>`;
}

export class MatUpdateWizard extends OnlineDialog {
  protected readonly kind: OnlineDialogSpec['kind'] = 'runtimeUpdate';
  private flow: UpdateFlow | null = null;
  /** Mật khẩu đang gõ: xóa ngay khi gửi, khi đổi bước và khi đóng. */
  private password = '';

  protected override opened(): void {
    this.flow?.dispose();
    this.password = '';
    const link = this.app.link;
    const id = this.app.session.deviceId;
    if (!link || !id) {
      this.flow = null;
      return;
    }
    const flow = new UpdateFlow({
      link,
      deviceId: id,
      onChange: () => {
        if (flow.step === 'result') this.onResult(flow.result);
        this.requestUpdate();
      },
    });
    this.flow = flow;
    void flow.load();
  }

  protected override close(): void {
    const step = this.flow?.step;
    // Đang gửi gói hay đang theo dõi thiết bị chạy lại: không đóng (như Nạp xuống).
    if (step === 'uploading' || step === 'following') return;
    this.password = '';
    this.flow?.dispose();
    this.flow = null;
    super.close();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.flow?.dispose();
    this.flow = null;
    this.password = '';
  }

  protected override initialFocus(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>(`#${PASSWORD_ID}`) ??
      this.querySelector<HTMLElement>('.dlg-f .primary:not([disabled])') ??
      this.querySelector<HTMLElement>('.dlg-b button:not([disabled])')
    );
  }

  private shownStep: string | null = null;

  /** Sang bước mới (kế hoạch, xác nhận quay về, kết quả…): focus vào ô mật khẩu hoặc nút chính của bước đó. */
  protected override updated(): void {
    super.updated();
    const step = this.isOpen ? (this.flow?.step ?? null) : null;
    if (step !== this.shownStep) {
      const first = this.shownStep === null;
      this.shownStep = step;
      if (!first && step && step !== 'uploading' && step !== 'following')
        this.initialFocus()?.focus();
    }
  }

  private resultSeen: UpdateResult | null = null;

  /** Xong: hỏi lại system/info để thanh trạng thái và trang Thiết bị thấy phiên bản mới. */
  private onResult(r: UpdateResult | null): void {
    if (!r || r === this.resultSeen) return;
    this.resultSeen = r;
    if (r.outcome !== 'lost') this.app.session.refreshInfo();
  }

  private get deviceName(): string {
    return this.app.session.device?.name ?? '';
  }

  private takePassword(): string {
    const pw = this.password;
    this.password = '';
    this.requestUpdate();
    return pw;
  }

  private errorBanner(flow: UpdateFlow): TemplateResult | typeof nothing {
    return flow.error
      ? html`<div class="banner err" role="alert" data-role="error">
          ${icon('err', 'err')}
          <div>${updateErrorText(flow.error)}</div>
        </div>`
      : nothing;
  }

  private passwordField(): TemplateResult {
    const user = this.app.session.auth?.user ?? '';
    return html`<div class="field">
      <label for=${PASSWORD_ID}>${t('ota.password', { user })}</label>
      <input
        id=${PASSWORD_ID}
        class="input"
        type="password"
        name="ota-password"
        autocomplete="current-password"
        spellcheck="false"
        aria-describedby=${PASSWORD_HELP_ID}
        .value=${live(this.password)}
        @input=${(e: Event) => {
          this.password = (e.target as HTMLInputElement).value;
          this.requestUpdate();
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.querySelector<HTMLButtonElement>('.dlg-f .primary:not([disabled])')?.click();
          }
        }}
      />
      <p class="help" id=${PASSWORD_HELP_ID}>${t('ota.passwordHelp')}</p>
    </div>`;
  }

  private runningLine(): TemplateResult {
    const v = this.app.session.info?.runtimeVersion;
    return html`<dl class="kvs">
      <dt>${t('ota.current')}</dt>
      <dd class="mono">${typeof v === 'string' && v ? v : t('ota.unknown')}</dd>
    </dl>`;
  }

  private loadingView() {
    return this.frame({
      title: t('ota.title', { name: this.deviceName }),
      icon: 'upload',
      body: html`<div class="upd" data-step="loading">
        <p class="row" role="status">
          <span class="spin" aria-hidden="true"></span>${t('ota.loading')}
        </p>
      </div>`,
      foot: html`<span class="grow"></span>
        <button class="btn" type="button" data-act="close" @click=${() => this.close()}>
          ${t('ota.cancel')}
        </button>`,
      busy: true,
    });
  }

  private pickView(flow: UpdateFlow) {
    const prev = flow.previous;
    const file = flow.file;
    const body = html`<div class="upd" data-step="pick">
      <p>${t('ota.pick.lead')}</p>
      ${this.runningLine()}
      <div class="upd-file">
        <dl class="kvs">
          <dt>${t('ota.pick.file')}</dt>
          <dd class="mono" data-role="file">
            ${
              file
                ? t('ota.pick.size', { name: file.name, size: formatBytes(file.size) })
                : t('ota.pick.none')
            }
          </dd>
        </dl>
        <button
          class="btn"
          type="button"
          data-act="pick"
          ?disabled=${flow.busy}
          @click=${() => void flow.pick()}
        >
          ${icon('import')}${t('ota.pick.choose')}
        </button>
      </div>
      ${this.errorBanner(flow)}
      ${
        prev
          ? html`<dl class="kvs">
              <dt>${t('ota.prev')}</dt>
              <dd class="mono">${prev.available ? prev.version : t('ota.prev.none')}</dd>
            </dl>`
          : nothing
      }
    </div>`;
    const foot = html`${
        prev?.available
          ? html`<button
              class="btn"
              type="button"
              data-act="rollback"
              ?disabled=${flow.busy}
              @click=${() => flow.askRollback()}
            >
              ${icon('restore')}${t('ota.rollback')}
            </button>`
          : nothing
      }
      <span class="grow"></span>
      <button class="btn" type="button" data-act="close" @click=${() => this.close()}>
        ${t('ota.cancel')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-act="upload"
        ?disabled=${!file || flow.busy}
        @click=${() => void flow.upload()}
      >
        ${icon('upload')}${t('ota.pick.upload')}
      </button>`;
    return this.frame({
      title: t('ota.title', { name: this.deviceName }),
      icon: 'upload',
      body,
      foot,
      busy: flow.busy,
    });
  }

  private uploadingView(flow: UpdateFlow) {
    const p = flow.progress ?? { sent: 0, total: flow.file?.size ?? 0 };
    const body = html`<div class="upd" data-step="uploading">
      <p>${t('ota.upload.lead')}</p>
      <div class="upd-progress" role="status" data-role="progress">
        <span
          >${t('ota.upload.progress', {
            sent: formatBytes(p.sent),
            total: formatBytes(p.total),
          })}</span
        >
        <progress
          max=${Math.max(1, p.total)}
          .value=${p.sent}
          aria-label=${t('ota.upload.bar')}
        ></progress>
      </div>
    </div>`;
    return this.frame({
      title: t('ota.title', { name: this.deviceName }),
      icon: 'upload',
      body,
      foot: html`<span class="grow muted">${t('ota.upload.foot')}</span>`,
      busy: true,
      closeDisabled: true,
    });
  }

  private planTable(plan: UpdatePlan): TemplateResult {
    return html`<dl class="kvs upd-plan" data-role="plan">
      <dt>${t('ota.plan.version')}</dt>
      <dd class="mono">${t('ota.plan.versionText', { from: plan.from, to: plan.to })}</dd>
      ${
        plan.releaseSeq !== null
          ? html`<dt>${t('ota.plan.release')}</dt>
              <dd class="mono">${plan.releaseSeq}</dd>`
          : nothing
      }
      <dt>${t('ota.plan.project')}</dt>
      <dd>
        ${
          plan.projectCompatible
            ? html`${icon('ok', 'ok')}${t('ota.plan.compatible')}`
            : html`${icon('err', 'err')}${t('ota.plan.incompatible')}`
        }
      </dd>
      <dt>${t('ota.plan.downtime')}</dt>
      <dd>
        ${
          plan.estimatedDowntimeS !== null
            ? t('ota.plan.downtimeText', { s: plan.estimatedDowntimeS })
            : t('ota.unknown')
        }
      </dd>
      <dt>${t('ota.plan.signer')}</dt>
      <dd>
        ${icon('shield')}<b>${plan.signer.label || t('ota.unknown')}</b>
        <span class="mono upd-key">${plan.signer.keyId}</span>
      </dd>
      ${
        plan.notes
          ? html`<dt>${t('ota.plan.notes')}</dt>
              <dd>${plan.notes}</dd>`
          : nothing
      }
    </dl>`;
  }

  private planView(flow: UpdateFlow) {
    const plan = flow.plan;
    if (!plan) return nothing;
    const can = !!this.password && !flow.busy && plan.projectCompatible;
    const body = html`<div class="upd" data-step="plan">
      <p>${t('ota.plan.lead')}</p>
      ${this.planTable(plan)}
      ${
        plan.projectCompatible
          ? html`<div class="banner warn" role="note">
              ${icon('warn', 'warn')}
              <div>${t('ota.plan.warn', { from: plan.from })}</div>
            </div>`
          : html`<div class="banner err" role="note">
              ${icon('err', 'err')}
              <div>${t('ota.plan.incompatibleWarn')}</div>
            </div>`
      }
      ${this.passwordField()} ${this.errorBanner(flow)}
    </div>`;
    const foot = html`<button
        class="btn"
        type="button"
        data-act="cancel-package"
        ?disabled=${flow.busy}
        @click=${() => {
          this.password = '';
          void flow.cancel();
        }}
      >
        ${t('ota.cancelPackage')}
      </button>
      <span class="grow"></span>
      <button class="btn" type="button" data-act="close" @click=${() => this.close()}>
        ${t('ota.close')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-act="apply"
        ?disabled=${!can}
        @click=${() => {
          if (!can) return;
          void flow.apply(this.takePassword());
        }}
      >
        ${icon('upload')}${t('ota.apply')}
      </button>`;
    return this.frame({
      title: t('ota.title', { name: this.deviceName }),
      icon: 'upload',
      body,
      foot,
      busy: flow.busy,
    });
  }

  private rollbackView(flow: UpdateFlow) {
    const version = flow.previous?.version ?? t('ota.unknown');
    const can = !!this.password && !flow.busy;
    const body = html`<div class="upd" data-step="confirm-rollback">
      <p>${t('ota.rb.lead', { version })}</p>
      ${this.runningLine()}
      <div class="banner warn" role="note">
        ${icon('warn', 'warn')}
        <div>${t('ota.follow.note')}</div>
      </div>
      ${this.passwordField()} ${this.errorBanner(flow)}
    </div>`;
    const foot = html`<button
        class="btn"
        type="button"
        data-act="back"
        ?disabled=${flow.busy}
        @click=${() => {
          this.password = '';
          flow.backToPick();
        }}
      >
        ${t('ota.back')}
      </button>
      <span class="grow"></span>
      <button class="btn" type="button" data-act="close" @click=${() => this.close()}>
        ${t('ota.cancel')}
      </button>
      <button
        class="btn primary"
        type="button"
        data-act="rollback-go"
        ?disabled=${!can}
        @click=${() => {
          if (!can) return;
          void flow.rollback(this.takePassword());
        }}
      >
        ${icon('restore')}${t('ota.rb.go', { version })}
      </button>`;
    return this.frame({
      title: t('ota.rb.title', { name: this.deviceName }),
      icon: 'restore',
      body,
      foot,
      busy: flow.busy,
    });
  }

  private followingView(flow: UpdateFlow) {
    const f = flow.following;
    const rollback = f?.mode === 'rollback';
    const restarting = f?.phase === 'restarting';
    const body = html`<div class="upd" data-step="following">
      <div class="upd-follow" role="status" data-role="following">
        <p class="row">
          <span class="spin" aria-hidden="true"></span>
          <b
            >${
              restarting
                ? t('ota.follow.restarting')
                : t(rollback ? 'ota.follow.rollback' : 'ota.follow.applying')
            }</b
          >
        </p>
        ${
          f?.step && !restarting
            ? html`<p class="mono">${t('ota.follow.step', { step: f.step })}</p>`
            : nothing
        }
      </div>
      <div class="banner warn" role="note">
        ${icon('warn', 'warn')}
        <div>${t('ota.follow.note')}</div>
      </div>
    </div>`;
    return this.frame({
      title: t(rollback ? 'ota.rb.title' : 'ota.title', { name: this.deviceName }),
      icon: rollback ? 'restore' : 'upload',
      body,
      foot: html`<span class="grow muted">${t('ota.follow.foot')}</span>`,
      busy: true,
      closeDisabled: true,
    });
  }

  private resultHead(r: UpdateResult): {
    tone: 'ok' | 'err' | 'warn';
    title: string;
    text: string;
  } {
    const v = r.version ?? t('ota.unknown');
    if (r.outcome === 'lost')
      return r.lostCause === 'session'
        ? { tone: 'warn', title: t('ota.res.session'), text: t('ota.res.sessionText') }
        : { tone: 'warn', title: t('ota.res.lost'), text: t('ota.res.lostText') };
    if (r.mode === 'rollback')
      return r.outcome === 'committed'
        ? { tone: 'ok', title: t('ota.res.rbDone', { version: v }), text: '' }
        : { tone: 'err', title: t('ota.res.rbFailed'), text: '' };
    return r.outcome === 'committed'
      ? {
          tone: 'ok',
          title: t('ota.res.committed', { version: v }),
          text: r.from ? t('ota.res.committedText', { from: r.from }) : '',
        }
      : {
          tone: 'err',
          title: t('ota.res.rolledBack', { version: v }),
          text: t('ota.res.rolledBackText'),
        };
  }

  private resultView(flow: UpdateFlow) {
    const r = flow.result;
    if (!r) return nothing;
    const h = this.resultHead(r);
    const user = this.app.session.auth?.user ?? '';
    const prev = flow.previous;
    const body = html`<div class="upd" data-step="result">
      <div class="result ${h.tone}" data-outcome=${r.outcome} role="status">
        ${icon(h.tone === 'ok' ? 'ok' : h.tone === 'warn' ? 'warn' : 'err', `lg ${h.tone}`)}
        <div>
          <b>${h.title}</b>
          ${h.text ? html`<p>${h.text}</p>` : nothing}
          ${r.reason ? html`<p>${t('ota.res.reason', { reason: r.reason })}</p>` : nothing}
        </div>
      </div>
      ${user && r.outcome !== 'lost' ? html`<p class="help">${t('ota.res.audit', { user })}</p>` : nothing}
    </div>`;
    const foot = html`${
        r.mode === 'update' && r.outcome === 'committed' && prev?.available
          ? html`<button
              class="btn"
              type="button"
              data-act="rollback"
              @click=${() => flow.askRollback()}
            >
              ${icon('restore')}${t('ota.rollback')}
            </button>`
          : nothing
      }
      <span class="grow"></span>
      <button class="btn primary" type="button" data-act="close" @click=${() => this.close()}>
        ${t('ota.close')}
      </button>`;
    return this.frame({
      title: t(r.mode === 'rollback' ? 'ota.rb.title' : 'ota.title', { name: this.deviceName }),
      icon: r.mode === 'rollback' ? 'restore' : 'upload',
      body,
      foot,
    });
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const flow = this.flow;
    if (!flow) return nothing;
    switch (flow.step) {
      case 'loading':
        return this.loadingView();
      case 'pick':
        return this.pickView(flow);
      case 'uploading':
        return this.uploadingView(flow);
      case 'plan':
        return this.planView(flow);
      case 'confirm-rollback':
        return this.rollbackView(flow);
      case 'following':
        return this.followingView(flow);
      case 'result':
        return this.resultView(flow);
      default:
        return nothing;
    }
  }
}

customElements.define('mat-update-wizard', MatUpdateWizard);

declare global {
  interface HTMLElementTagNameMap {
    'mat-update-wizard': MatUpdateWizard;
  }
}
