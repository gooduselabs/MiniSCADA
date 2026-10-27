// Editor "Thiết lập thiết bị" (feature 027, specs/027-device-settings FR-007, ADR-054; docs/architecture/studio-ux.md): nút
// con của thiết bị trên cây khi Online bằng administrator. Tab Chung là lưới thuộc tính (Thiết lập | Giá trị | Nguồn): bắt
// buộc đăng nhập, phạm vi xem, tên miền cho phép, giới hạn kết nối, OTA, tên thiết bị; tab Chứng chỉ: vân tay, hạn, SAN,
// cảnh báo, sinh lại có IP, CSR, nhập, rồi ghim lại có xác nhận so vân tay. Mật khẩu xác nhận hỏi ngay trong editor (giảm
// bảo vệ, thay chứng chỉ), chỉ chuyển cho lệnh, không giữ. Logic ở model/device-settings-flow.ts.
import {
  deviceSettingsProblem,
  parseHosts,
  type DeviceSettingKey,
  type DeviceSettingsValues,
} from '@mat/access-model';
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { StudioApp } from '../../app/app.ts';
import { sessionActive } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './device-settings-editor.css';

type Tab = 'general' | 'cert';
type Pending =
  | { kind: 'save'; values: DeviceSettingsValues; keys: DeviceSettingKey[] }
  | { kind: 'regen'; san: string[] }
  | { kind: 'import'; pem: string };

const KEY_LABEL: Readonly<Record<DeviceSettingKey, MessageKey>> = {
  deviceName: 'devset.deviceName',
  viewerLogin: 'devset.viewerLogin',
  viewerAccess: 'devset.viewerAccess',
  allowedHosts: 'devset.allowedHosts',
  maxLiveClientsPerSource: 'devset.maxLive',
  updateEnabled: 'devset.ota',
};

export class MatDeviceSettings extends AppElement {
  private tab: Tab = 'general';
  private draft: DeviceSettingsValues | null = null;
  private draftRev = -1;
  private hostsText = '';
  private sanText = '';
  private pemText = '';
  private pending: Pending | null = null;
  private password = '';
  private localError = '';
  private requested = false;

  private get online(): boolean {
    const s = this.app.session;
    return s.mode === 'online' && s.auth !== null && sessionActive(s.state);
  }

  private get admin(): boolean {
    return this.app.session.auth?.role === 'administrator';
  }

  protected override updated(): void {
    const flow = this.app.deviceSettings;
    if (!flow || !this.online || !this.admin) return;
    if (!this.requested && !flow.loading && !flow.info) {
      this.requested = true;
      void flow.load();
    }
    if (flow.info && flow.info.rev !== this.draftRev) {
      this.draftRev = flow.info.rev;
      this.draft = { ...flow.info.effective, allowedHosts: [...flow.info.effective.allowedHosts] };
      this.hostsText = this.draft.allowedHosts.join('\n');
      this.requestUpdate();
    }
  }

  private setTab(tab: Tab): void {
    this.tab = tab;
    this.requestUpdate();
    void this.updateComplete.then(() => this.querySelector<HTMLElement>(`#ds-tab-${tab}`)?.focus());
  }

  private edit(patch: Partial<DeviceSettingsValues>): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, ...patch };
    this.localError = '';
    this.requestUpdate();
  }

  private values(): DeviceSettingsValues | null {
    if (!this.draft) return null;
    return { ...this.draft, allowedHosts: parseHosts(this.hostsText) };
  }

  private async save(): Promise<void> {
    const flow = this.app.deviceSettings;
    const v = this.values();
    if (!flow || !v) return;
    const problem = deviceSettingsProblem(v);
    if (problem) {
      this.localError = problem;
      this.requestUpdate();
      return;
    }
    const keys = flow.lowered(v);
    if (keys.length) {
      this.pending = { kind: 'save', values: v, keys };
      this.requestUpdate();
      return;
    }
    await flow.save(v);
  }

  private async confirm(): Promise<void> {
    const flow = this.app.deviceSettings;
    const p = this.pending;
    const pw = this.password;
    if (!flow || !p || !pw) return;
    this.password = '';
    if (p.kind === 'save') {
      const r = await flow.save(p.values, pw);
      if (r !== 'needs-reauth') this.pending = null;
    } else {
      const ok = await flow.changeCert(
        p.kind === 'regen' ? { kind: 'regen', san: p.san } : { kind: 'import', pem: p.pem },
        pw,
      );
      if (ok || flow.error?.code !== 'REAUTH_REQUIRED') this.pending = null;
      if (ok && p.kind === 'import') this.pemText = '';
    }
    this.requestUpdate();
  }

  private sourceOf(k: DeviceSettingKey): string {
    const info = this.app.deviceSettings?.info;
    return info && k in info.settings ? t('devset.src.settings') : t('devset.src.runtime');
  }

  override render() {
    const flow = this.app.deviceSettings;
    const title = t('devset.tab');
    // Sau khi đổi chứng chỉ phiên Online rơi (chứng chỉ khác ghim) tới khi ghim lại: vẫn hiện bước ghim lại.
    const repinOpen = !!flow?.repin && flow.repin.state !== 'done';
    if (!flow || ((!this.online || !this.admin) && !repinOpen))
      return html`<div class="ed ed-fill">
        <div class="ed-head"><h2>${title}</h2></div>
        <p class="empty" data-role="need-admin">${icon('lock')}${t('devset.needAdmin')}</p>
      </div>`;
    if (!this.online || !this.admin)
      return html`<div class="ed ed-fill ds-ed">
        <div class="ed-head"><h2>${title}</h2></div>
        <div class="ds-panel">${this.repinPanel()}</div>
      </div>`;
    const err = flow.error;
    return html`<div class="ed ed-fill ds-ed">
      <div class="ed-head">
        <h2>${title}</h2>
        <span class="path">${this.app.session.device?.name ?? ''}</span>
        <span class="grow"></span>
        <button
          class="btn"
          type="button"
          data-role="reload"
          ?disabled=${flow.loading || flow.busy}
          @click=${() => void flow.load()}
        >
          ${icon('refresh')}${t('devset.reload')}
        </button>
      </div>
      <p class="help ds-intro">${t('devset.intro')}</p>
      ${
        err
          ? html`<div class="banner err" role="alert" data-role="error">
              ${icon('warn', 'warn')}
              <div>${t('devset.error', { code: err.code, message: err.message })}</div>
            </div>`
          : nothing
      }
      ${
        flow.notice === 'saved' || flow.notice === 'saved-no-restart'
          ? html`<div class="banner info" role="status" data-role="notice">
              <div>${t(flow.notice === 'saved' ? 'devset.saved' : 'devset.savedNoRestart')}</div>
            </div>`
          : flow.info?.restartPending
            ? html`<div class="banner warn" role="status">
                <div>${t('devset.pending')}</div>
              </div>`
            : nothing
      }
      ${this.pending ? this.reauthPanel() : nothing}
      <div class="btabs ds-tabs" role="tablist" aria-label=${t('devset.tabs')}>
        ${(['general', 'cert'] as const).map(
          (id) =>
            html`<button
              type="button"
              role="tab"
              id="ds-tab-${id}"
              data-tab=${id}
              aria-selected=${this.tab === id ? 'true' : 'false'}
              aria-controls="ds-panel"
              tabindex=${this.tab === id ? 0 : -1}
              @click=${() => this.setTab(id)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  this.setTab(this.tab === 'general' ? 'cert' : 'general');
                }
              }}
            >
              ${t(id === 'general' ? 'devset.tab.general' : 'devset.tab.cert')}
            </button>`,
        )}
      </div>
      <div id="ds-panel" role="tabpanel" aria-labelledby="ds-tab-${this.tab}" class="ds-panel">
        ${
          !flow.info
            ? html`<p class="help" role="status">
                <span class="spin" aria-hidden="true"></span>${t('devset.loading')}
              </p>`
            : this.tab === 'general'
              ? this.general()
              : this.cert()
        }
      </div>
    </div>`;
  }

  private reauthPanel() {
    const p = this.pending!;
    const why =
      p.kind === 'save'
        ? t('devset.reauth.lowered', { keys: p.keys.map((k) => t(KEY_LABEL[k])).join(', ') })
        : t('devset.reauth.cert');
    return html`<form
      class="banner warn ds-reauth"
      role="alertdialog"
      aria-labelledby="ds-reauth-title"
      data-role="reauth"
      @submit=${(e: Event) => {
        e.preventDefault();
        void this.confirm();
      }}
    >
      <div>
        <strong id="ds-reauth-title">${t('devset.reauth.title')}</strong>
        <p>${why}</p>
        <label class="ds-field">
          <span>${t('devset.reauth.label')}</span>
          <input
            class="input"
            type="password"
            autocomplete="current-password"
            maxlength="256"
            data-role="reauth-password"
            .value=${live(this.password)}
            @input=${(e: Event) => (this.password = (e.target as HTMLInputElement).value)}
          />
        </label>
        <div class="ds-actions">
          <button class="btn primary" type="submit" data-role="reauth-ok">
            ${t('devset.reauth.ok')}
          </button>
          <button
            class="btn"
            type="button"
            @click=${() => {
              this.pending = null;
              this.password = '';
              this.requestUpdate();
            }}
          >
            ${t('devset.reauth.cancel')}
          </button>
        </div>
      </div>
    </form>`;
  }

  private general() {
    const flow = this.app.deviceSettings!;
    const d = this.draft;
    if (!d) return nothing;
    const host = this.app.session.device?.host ?? '';
    const hosts = parseHosts(this.hostsText);
    const hostWarn = hosts.length > 0 && host && !/^[\d.]+$/.test(host) && !hosts.includes(host);
    const row = (k: DeviceSettingKey, control: unknown, hint?: string) =>
      html`<tr data-key=${k}>
        <th scope="row"><label for="ds-${k}">${t(KEY_LABEL[k])}</label></th>
        <td>${control}${hint ? html`<div class="help">${hint}</div>` : nothing}</td>
        <td class="ds-src">${this.sourceOf(k)}</td>
      </tr>`;
    return html`<div class="gridwrap">
        <table class="grid ds-grid">
          <thead>
            <tr>
              <th scope="col">${t('devset.col.setting')}</th>
              <th scope="col">${t('devset.col.value')}</th>
              <th scope="col">${t('devset.col.source')}</th>
            </tr>
          </thead>
          <tbody>
            ${row(
              'deviceName',
              html`<input
                id="ds-deviceName"
                class="input"
                maxlength="32"
                .value=${live(d.deviceName)}
                @input=${(e: Event) =>
                  this.edit({ deviceName: (e.target as HTMLInputElement).value })}
              />`,
            )}
            ${row(
              'viewerLogin',
              html`<input
                id="ds-viewerLogin"
                type="checkbox"
                .checked=${live(d.viewerLogin === 'required')}
                @change=${(e: Event) =>
                  this.edit({
                    viewerLogin: (e.target as HTMLInputElement).checked ? 'required' : 'off',
                  })}
              />`,
            )}
            ${row(
              'viewerAccess',
              html`<select
                id="ds-viewerAccess"
                class="select"
                .value=${live(d.viewerAccess)}
                @change=${(e: Event) =>
                  this.edit({
                    viewerAccess: (e.target as HTMLSelectElement)
                      .value as DeviceSettingsValues['viewerAccess'],
                  })}
              >
                ${(['private', 'any', 'off'] as const).map(
                  (a) =>
                    html`<option value=${a} ?selected=${d.viewerAccess === a}>
                      ${t(`devset.access.${a}`)}
                    </option>`,
                )}
              </select>`,
            )}
            ${row(
              'allowedHosts',
              html`<textarea
                  id="ds-allowedHosts"
                  class="input"
                  rows="3"
                  spellcheck="false"
                  .value=${live(this.hostsText)}
                  @input=${(e: Event) => {
                    this.hostsText = (e.target as HTMLTextAreaElement).value;
                    this.requestUpdate();
                  }}
                ></textarea>
                ${
                  hostWarn
                    ? html`<div class="help warn" role="status">
                        ${t('devset.hostWarn', { host })}
                      </div>`
                    : nothing
                }`,
              t('devset.allowedHostsHint'),
            )}
            ${row(
              'maxLiveClientsPerSource',
              html`<input
                id="ds-maxLiveClientsPerSource"
                class="input num"
                type="number"
                min="1"
                max="10"
                .value=${live(d.maxLiveClientsPerSource ? String(d.maxLiveClientsPerSource) : '')}
                @input=${(e: Event) => {
                  const s = (e.target as HTMLInputElement).value.trim();
                  this.edit({ maxLiveClientsPerSource: s ? Math.round(Number(s)) : 0 });
                }}
              />`,
              t('devset.maxLiveHint'),
            )}
            ${row(
              'updateEnabled',
              html`<input
                id="ds-updateEnabled"
                type="checkbox"
                .checked=${live(d.updateEnabled)}
                @change=${(e: Event) =>
                  this.edit({ updateEnabled: (e.target as HTMLInputElement).checked })}
              />`,
              flow.info?.update.updaterInstalled ? undefined : t('devset.otaMissing'),
            )}
          </tbody>
        </table>
      </div>
      ${this.localError ? html`<p class="help warn" role="alert">${this.localError}</p>` : nothing}
      <div class="ds-actions">
        <button
          class="btn primary"
          type="button"
          data-role="save"
          ?disabled=${flow.busy}
          @click=${() => void this.save()}
        >
          ${t('devset.save')}
        </button>
        <button
          class="btn"
          type="button"
          ?disabled=${flow.busy}
          @click=${() => {
            this.draftRev = -1;
            this.requestUpdate();
          }}
        >
          ${t('devset.revert')}
        </button>
      </div>`;
  }

  private cert() {
    const flow = this.app.deviceSettings!;
    const c = flow.info!.cert;
    const list = (v: string[]) => (v.length ? v.join(', ') : t('devset.cert.none'));
    const rows: [MessageKey, string][] = [
      ['devset.cert.fingerprint', c.fingerprintColons],
      ['devset.cert.subject', c.subject],
      ['devset.cert.issuer', c.issuer],
      ['devset.cert.selfSigned', t(c.selfSigned ? 'devset.cert.yes' : 'devset.cert.no')],
      ['devset.cert.validity', `${c.notBefore} – ${c.notAfter}`],
      ['devset.cert.sanIps', list(c.sanIps)],
      ['devset.cert.sanDns', list(c.sanDns)],
      ['devset.cert.cardIps', list(c.cardIps)],
    ];
    const rp = flow.repin;
    return html`
      <dl class="ds-cert" data-role="cert">
        ${rows.map(
          ([k, v]) =>
            html`<dt>${t(k)}</dt>
              <dd data-cert=${k}>${v}</dd>`,
        )}
      </dl>
      ${c.warnings.map(
        (w) =>
          html`<div class="banner warn" role="status" data-warning=${w}>
            ${icon('warn', 'warn')}
            <div>
              ${w === 'TLS_NO_IP_SAN' || w === 'TLS_SAN_MISMATCH' ? t(`devset.cert.${w}`) : w}
            </div>
          </div>`,
      )}
      ${rp ? this.repinPanel() : nothing}
      <label class="ds-field">
        <span>${t('devset.cert.extra')}</span>
        <textarea
          class="input"
          rows="2"
          spellcheck="false"
          data-role="san"
          .value=${live(this.sanText)}
          @input=${(e: Event) => (this.sanText = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
        <span class="help">${t('devset.cert.extraHint')}</span>
      </label>
      <div class="ds-actions">
        <button
          class="btn"
          type="button"
          data-role="regen"
          ?disabled=${flow.busy}
          @click=${() => {
            this.pending = { kind: 'regen', san: parseHosts(this.sanText) };
            this.requestUpdate();
          }}
        >
          ${t('devset.cert.regen')}
        </button>
        <button
          class="btn"
          type="button"
          data-role="csr"
          ?disabled=${flow.busy}
          @click=${() => void flow.makeCsr(parseHosts(this.sanText))}
        >
          ${t('devset.cert.csr')}
        </button>
      </div>
      ${
        flow.csrPem
          ? html`<p class="help">${t('devset.cert.csrDone')}</p>
              <pre class="ds-pem" tabindex="0" data-role="csr-pem">${flow.csrPem}</pre>`
          : nothing
      }
      <label class="ds-field">
        <span>${t('devset.cert.pem')}</span>
        <textarea
          class="input"
          rows="5"
          spellcheck="false"
          data-role="pem"
          .value=${live(this.pemText)}
          @input=${(e: Event) => (this.pemText = (e.target as HTMLTextAreaElement).value)}
        ></textarea>
      </label>
      <div class="ds-actions">
        <button
          class="btn"
          type="button"
          data-role="import"
          ?disabled=${flow.busy}
          @click=${() => {
            const pem = this.pemText.trim();
            if (!pem) {
              this.localError = t('devset.cert.importEmpty');
            } else this.pending = { kind: 'import', pem };
            this.requestUpdate();
          }}
        >
          ${t('devset.cert.import')}
        </button>
      </div>
      ${this.localError ? html`<p class="help warn" role="alert">${this.localError}</p>` : nothing}
      ${
        flow.importWarnings.length
          ? html`<p class="help warn">
              ${t('devset.cert.warnings', { list: flow.importWarnings.join('; ') })}
            </p>`
          : nothing
      }
    `;
  }

  private repinPanel() {
    const flow = this.app.deviceSettings!;
    const rp = flow.repin!;
    const fp = (s: string | null) =>
      (s ?? '')
        .toUpperCase()
        .match(/.{1,2}/g)
        ?.join(':') ?? '';
    if (rp.state === 'waiting')
      return html`<div class="banner info" role="status" data-repin="waiting">
        <span class="spin" aria-hidden="true"></span>
        <div>${t('devset.repin.waiting')}</div>
      </div>`;
    if (rp.state === 'confirm')
      return html`<div
        class="banner warn ds-repin"
        role="alertdialog"
        aria-labelledby="ds-repin-text"
        data-repin="confirm"
      >
        <div>
          <p id="ds-repin-text">${t('devset.repin.confirm')}</p>
          <dl class="ds-cert">
            <dt>${t('devset.repin.expected')}</dt>
            <dd data-role="fp-expected">${fp(rp.expected)}</dd>
            <dt>${t('devset.repin.seen')}</dt>
            <dd data-role="fp-seen">${fp(rp.seen)}</dd>
          </dl>
          <button
            class="btn primary"
            type="button"
            data-role="repin"
            @click=${() => void flow.confirmRepin()}
          >
            ${t('devset.repin.ok')}
          </button>
        </div>
      </div>`;
    const key: MessageKey =
      rp.state === 'done'
        ? 'devset.repin.done'
        : rp.state === 'differs'
          ? 'devset.repin.differs'
          : 'devset.repin.failed';
    return html`<div
      class="banner ${rp.state === 'done' ? 'info' : 'err'}"
      role=${rp.state === 'done' ? 'status' : 'alert'}
      data-repin=${rp.state}
    >
      <div>${t(key)}</div>
    </div>`;
  }
}

customElements.define('mat-device-settings', MatDeviceSettings);

registerEditor({
  match: (id) => id === 'deviceSettings',
  render: (app: StudioApp) => html`<mat-device-settings .app=${app}></mat-device-settings>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-device-settings': MatDeviceSettings;
  }
}
