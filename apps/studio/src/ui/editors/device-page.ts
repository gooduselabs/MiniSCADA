// Trang Thiết bị (feature 004, T070, FR-027, FR-030, FR-033, Sprint 1 FR-034, mockup bản 1 "Thiết lập
// thiết bị"): nhập và nhớ địa chỉ (IP hoặc tên, cổng), kiểm kết nối qua /api/v1/system/info (≤ 3 s, không
// chiếm phiên của thiết bị), kết nối theo dõi và ngắt (phiên thiết bị duy nhất của Studio), mở web thiết
// bị. Thay tab Thiết bị của Sprint 1; nút thiết bị trên cây và Online › Thiết bị… mở trang này.
// Feature 005 (T085a, FR-031, FR-035): khi có lớp thiết bị, trang hiện thiết bị gắn với project (Ctrl+K và nút
// Online kết nối tới thiết bị này) kèm "Đổi thiết bị…". Ô địa chỉ còn để theo dõi chỉ đọc qua HTTP thiết bị
// runtime cũ ("Kết nối theo dõi" của trang, không phải Ctrl+K); gõ `https://` thì báo ngay tại ô, gợi ý Online.
import { isCompatibleProtocol } from '@mat/live-client';
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import type { StudioApp } from '../../app/app.ts';
import type { CommandId } from '../../app/commands.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import {
  acceptedHostsOf,
  checkDevice,
  normalizeMonitor,
  warningChips,
  type CheckErrorCode,
  type DeviceInfo,
  type MonitorAddressError,
} from '../../model/device.ts';
import { AppElement, icon } from '../base.ts';
import { chipAction, chipView } from '../device-warnings.ts';
import {
  destinations,
  destLine,
  errorText,
  projectIcon,
  projectOf,
  projectText,
  sessionHost,
  sessionsOf,
  storageLine,
  uptimeText,
} from '../diagnostics.ts';
import { historianLines } from '../../model/logging-online.ts';
import { registerEditor } from '../registry.ts';
import './device-page.css';

/** Kết quả lần kiểm kết nối gần nhất (giữ khi đổi tab). */
type CheckState =
  | { kind: 'idle' }
  | { kind: 'running'; url: string }
  | { kind: 'ok'; url: string; info: DeviceInfo; ms: number }
  | { kind: 'fail'; url: string; code: CheckErrorCode; detail?: string };

interface CheckEntry {
  state: CheckState;
  /** Tăng mỗi lần kiểm: kết quả của lần cũ về sau thì bỏ. */
  seq: number;
}

const checks = new WeakMap<StudioApp, CheckEntry>();
/** Trang đang hiện: kiểm xong (kể cả khi trang đã được dựng lại) thì vẽ lại. */
const pages = new Set<DevicePage>();

function entryOf(app: StudioApp): CheckEntry {
  let e = checks.get(app);
  if (!e) {
    e = { state: { kind: 'idle' }, seq: 0 };
    checks.set(app, e);
  }
  return e;
}

const ADDRESS_ERROR: Readonly<Record<MonitorAddressError, MessageKey>> = {
  empty: 'device.addr.err.empty',
  scheme: 'device.addr.err.scheme',
  address: 'device.addr.err.address',
  port: 'device.addr.err.port',
  https: 'device.addr.err.https',
};

const INPUT_ID = 'dp-address';
const HELP_ID = 'dp-address-help';
const ERROR_ID = 'dp-address-err';

export class DevicePage extends AppElement {
  /** Đã thử kiểm hay kết nối: lúc đó ô trống mới báo lỗi. */
  private touched = false;

  protected override attached(): void {
    pages.add(this);
  }

  protected override detached(): void {
    pages.delete(this);
  }

  private refreshPages(): void {
    for (const p of pages) if (p.hasApp && p.app === this.app) p.requestUpdate();
  }

  private focusInput(): void {
    void this.updateComplete.then(() =>
      this.querySelector<HTMLInputElement>(`#${INPUT_ID}`)?.focus(),
    );
  }

  /** Địa chỉ dùng được (chỉ HTTP); không thì báo tại ô và đưa focus về ô. */
  private base(): string | null {
    const n = normalizeMonitor(this.app.deviceAddress());
    if (n.ok) return n.base;
    this.touched = true;
    this.requestUpdate();
    this.focusInput();
    return null;
  }

  private async check(): Promise<void> {
    const url = this.base();
    if (!url) return;
    const entry = entryOf(this.app);
    const seq = ++entry.seq;
    entry.state = { kind: 'running', url };
    this.refreshPages();
    const started = Date.now();
    // Qua Rust (`monitor_get`) khi có DeviceLink (feature 005): CSP không cho WebView tự gọi ra mạng.
    const r = await checkDevice(url, this.app.checkFetch);
    if (entry.seq !== seq) return;
    entry.state = r.ok
      ? { kind: 'ok', url, info: r.info, ms: Date.now() - started }
      : { kind: 'fail', url, code: r.code, detail: r.detail };
    this.refreshPages();
  }

  /** Lệnh cần địa chỉ (Mở web thiết bị) hoặc Ngắt: địa chỉ sai thì báo tại ô. */
  private run(cmd: CommandId): void {
    if (cmd !== 'online.disconnect' && !this.base()) return;
    void this.app.run(cmd);
  }

  /** Kết nối theo dõi theo địa chỉ đã nhập (chỉ đọc, HTTP; thiết bị runtime cũ). */
  private monitor(): void {
    if (this.base()) this.app.monitorAddress();
  }

  private readonly onSubmit = (e: Event): void => {
    e.preventDefault();
    void this.check();
  };

  private readonly onInput = (e: Event): void => {
    this.app.setDeviceAddress((e.target as HTMLInputElement).value);
  };

  /** Nút theo điều kiện bật của lệnh `cmd` (khóa thì kèm lý do); `action` là việc khi nhấp. */
  private commandButton(
    cmd: CommandId,
    ic: IconName,
    label: string,
    tip: string,
    action: () => void = () => this.run(cmd),
  ) {
    const enabled = this.app.enabled(cmd);
    const reason = enabled === true ? null : t(enabled);
    return html`<button
      class="btn"
      type="button"
      data-cmd=${cmd}
      aria-disabled=${reason ? 'true' : nothing}
      title=${reason ? t('reason.locked', { label, reason }) : tip}
      @click=${action}
    >
      ${icon(ic)}${label}
    </button>`;
  }

  /**
   * Thiết bị gắn với project (T085a, FR-031): Ctrl+K và nút Online kết nối tới thiết bị này; "Đổi thiết bị…"
   * mở Thiết bị trong mạng (chọn hoặc thêm thiết bị ở đó thì thiết bị được gắn). Chỉ có khi có lớp thiết bị.
   */
  private bound() {
    const app = this.app;
    if (!app.link) return nothing;
    const devices = (key: MessageKey) =>
      html`<button class="btn" type="button" @click=${() => void app.openDevices()}>
        ${icon('device')}${t(key)}
      </button>`;
    let body;
    if (!app.store.state.project) {
      body = html`<p class="dp-dev">${icon('info', 'info')}${t('device.bound.noProject')}</p>`;
    } else {
      const d = app.projectDevice();
      const s = app.session;
      const working = d !== null && app.online() && s.deviceId === d.id;
      body = d
        ? html`<p class="dp-dev">
              ${icon('device')}<b>${d.name}</b><span class="mono">${d.host}:${d.httpsPort}</span>
              <span class="chip ${d.pin ? 'ok' : ''}"
                >${icon(d.pin ? 'shield' : 'info')}${t(
                  d.pin ? 'device.bound.pinned' : 'device.bound.unpinned',
                )}</span
              >
              ${d.lastRuntime ? html`<span>${t('sb.runtime', { version: d.lastRuntime })}</span>` : nothing}
              ${
                d.lastUser
                  ? html`<span>${t('device.bound.lastUser', { user: d.lastUser })}</span>`
                  : nothing
              }
            </p>
            <div class="row dp-actions">
              ${
                working
                  ? this.commandButton(
                      'online.disconnect',
                      'offline',
                      t('toolbar.offline'),
                      t('device.bound.offlineTip'),
                      () => void app.run('online.disconnect'),
                    )
                  : this.commandButton(
                      'online.connect',
                      'online',
                      t('toolbar.online'),
                      t('device.bound.onlineTip'),
                      () => void app.run('online.connect'),
                    )
              }
              ${devices('device.bound.change')}
            </div>`
        : html`<p class="dp-dev">${icon('info', 'info')}${t('device.bound.none')}</p>
            <div class="row dp-actions">${devices('device.bound.choose')}</div>`;
    }
    return html`<fieldset class="dp-bound">
      <legend>${t('device.bound.legend')}</legend>
      <div class="dp-body">
        ${body}
        <p class="help">${t('device.bound.help')}</p>
      </div>
    </fieldset>`;
  }

  private address() {
    const app = this.app;
    const value = app.deviceAddress();
    const n = normalizeMonitor(value);
    const error = !n.ok && (n.error !== 'empty' || this.touched) ? t(ADDRESS_ERROR[n.error]) : null;
    const https = !n.ok && n.error === 'https';
    // Đang theo dõi theo địa chỉ (không phải thiết bị đã lưu): nút Ngắt ở đây.
    const byAddress = app.online() && app.session.device === null;
    return html`<form class="dp-addr" novalidate @submit=${this.onSubmit}>
      <fieldset>
        <legend>${t('device.page.address')}</legend>
        <div class="field">
          <label for=${INPUT_ID}>${t('device.page.addressLabel')}</label>
          <input
            id=${INPUT_ID}
            name="device-address"
            class="input mono ${error ? 'bad' : ''}"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="192.168.1.110:8080"
            .value=${live(value)}
            aria-invalid=${error ? 'true' : 'false'}
            aria-describedby=${error ? ERROR_ID : HELP_ID}
            @input=${this.onInput}
          />
          ${
            error
              ? html`<p class="err-text" id=${ERROR_ID}>${error}</p>`
              : html`<p class="help" id=${HELP_ID}>
                  ${n.ok ? t('device.page.url', { url: n.base }) : t('device.page.addressHelp')}
                </p>`
          }
          ${
            https && app.link
              ? html`<div class="row">
                  <button class="btn" type="button" @click=${() => void app.run('online.devices')}>
                    ${icon('device')}${t('device.addr.openDevices')}
                  </button>
                </div>`
              : nothing
          }
        </div>
        <div class="row dp-actions">
          <button class="btn primary" type="submit">
            ${icon('check')}${t('device.page.check')}
          </button>
          ${
            byAddress
              ? this.commandButton(
                  'online.disconnect',
                  'offline',
                  t('cmd.online.disconnect'),
                  t('device.page.disconnectTip'),
                )
              : this.commandButton(
                  'online.connect',
                  'online',
                  t('cmd.online.connect'),
                  t('device.page.connectTip'),
                  () => this.monitor(),
                )
          }
          <button
            class="btn"
            type="button"
            data-cmd="online.openWeb"
            aria-disabled=${n.ok ? nothing : 'true'}
            title=${n.ok ? `${n.base}/` : t(ADDRESS_ERROR[n.error])}
            @click=${() => this.run('online.openWeb')}
          >
            ${icon('ext')}${t('cmd.online.openWeb')}
          </button>
        </div>
      </fieldset>
    </form>`;
  }

  /** Thông tin thiết bị trả về (dùng chung cách hiển thị với Chẩn đoán). */
  private infoList(info: DeviceInfo) {
    const app = this.app;
    const project = projectOf(app, info);
    const pi = projectIcon(project);
    const protocol = typeof info.protocolVersion === 'string' ? info.protocolVersion : '';
    const uptime = uptimeText(info.uptimeS);
    const dests = destinations(info);
    return html`<dl class="kvs dp-info">
      <dt>${t('device.info.runtime')}</dt>
      <dd class="mono">${info.runtimeVersion ?? t('device.info.unknown')}</dd>
      <dt>${t('device.info.protocol')}</dt>
      <dd>
        <span class="mono">${protocol || t('device.info.unknown')}</span>
        ${
          protocol && !isCompatibleProtocol(protocol)
            ? html`<span class="chip warn">${icon('warn')}${t('device.page.incompatible')}</span>`
            : nothing
        }
      </dd>
      <dt>${t('device.info.sessions')}</dt>
      <dd>${sessionsOf(info).text}</dd>
      <dt>${t('device.info.project')}</dt>
      <dd>
        ${pi.icon ? icon(pi.icon, pi.iconCls ?? '') : nothing}
        ${projectText(project) ?? t('device.info.unknown')}
      </dd>
      <dt>${t('device.info.uptime')}</dt>
      <dd>${uptime ?? t('diag.notYet')}</dd>
      <dt>${t('device.info.storage')}</dt>
      <dd>
        <div>${storageLine(info)}</div>
        ${historianLines(info).map((l) => html`<div data-role="hist-line">${l}</div>`)}
        ${dests.map((d) => html`<div>${destLine(d)}</div>`)}
      </dd>
    </dl>`;
  }

  /** Dòng kết quả là một vùng `status` cố định (chỉ đổi nội dung) để trình đọc màn hình đọc được. */
  private checkResult() {
    const s = entryOf(this.app).state;
    const line =
      s.kind === 'running'
        ? html`<span class="spin" aria-hidden="true"></span>${t('device.page.checking', {
              url: s.url,
            })}`
        : s.kind === 'ok'
          ? html`${icon('ok', 'ok')}${t('device.page.checkOk', { url: s.url, ms: s.ms })}`
          : s.kind === 'fail'
            ? html`${icon('err', 'err')}${t('device.page.checkFail', {
                url: s.url,
                reason: errorText(s.code, s.detail),
              })}`
            : t('device.page.checkIdle');
    const cls = s.kind === 'fail' ? 'err-text' : s.kind === 'idle' ? 'help' : '';
    return html`<p class="dp-result ${cls}" role="status">${line}</p>
      ${s.kind === 'ok' ? this.infoList(s.info) : nothing}`;
  }

  /**
   * Feature 011 (T052, FR-036, FR-013): cảnh báo mới của thiết bị, mỗi cái một chip kèm hướng dẫn hành động, và
   * tên `Host` thiết bị nhận (`device/identity.acceptedHosts`; mở bằng tên khác: 421).
   */
  private deviceWarnings() {
    const s = this.app.session;
    const chips = warningChips(s.info);
    const hosts = acceptedHostsOf(s.identity);
    if (chips.length === 0 && !hosts) return nothing;
    return html`<div class="dp-warn">
      ${
        chips.length > 0
          ? html`<p class="dp-sub"><b>${t('devwarn.title')}</b></p>
              <ul class="dp-warn-list">
                ${chips.map((c) => html`<li>${chipView(c)} <span class="help">${chipAction(c)}</span></li>`)}
              </ul>`
          : nothing
      }
      ${
        hosts
          ? html`<div data-role="accepted-hosts">
              <b>${t('devwarn.hosts')}:</b>
              <span class="mono"
                >${hosts.names.includes('*') ? t('devwarn.hostsAny') : hosts.names.join(', ')}</span
              >
              · ${hosts.ips.includes('*') ? t('devwarn.hostsIps') : hosts.ips.join(', ')}
              <p class="help">${t('devwarn.hostsHelp')}</p>
            </div>`
          : nothing
      }
    </div>`;
  }

  private monitorState() {
    const app = this.app;
    const s = app.session;
    const host = sessionHost(app);
    const name = s.device?.name ?? host;
    switch (s.state) {
      case 'monitoring': {
        const info = s.info;
        const project = info ? projectText(projectOf(app, info)) : null;
        // Online có đăng nhập (feature 005): tên thiết bị và `tài khoản · role`.
        const auth = s.mode === 'online' ? s.auth : null;
        return html`<p class="dp-result">
            <span class="sdot monitoring"></span
            ><b>${auth ? t('online.state.online') : t('device.state.monitoring')}</b>
            ${s.device ? html`<b>${s.device.name}</b>` : nothing}
            <span class="mono">${host}</span>
            ${info?.runtimeVersion ? html`· ${t('sb.runtime', { version: info.runtimeVersion })}` : nothing}
            ${project ? html`· ${project}` : nothing}
            ${auth ? html`· ${t('online.account', { user: auth.user, role: auth.role })}` : nothing}
            ${
              s.notice === 'runtime-old'
                ? html`· ${icon('warn', 'warn')}${t('device.err.runtime-old')}`
                : nothing
            }
          </p>
          ${this.deviceWarnings()}`;
      }
      case 'probing':
        return html`<p class="dp-result">
          <span class="spin" aria-hidden="true"></span>${t('online.state.probing', { name })}
        </p>`;
      case 'pin-confirm':
        return html`<p class="dp-result">
          ${icon('shield', 'info')}${t('online.state.pin', { name })}
        </p>`;
      case 'login':
        return html`<p class="dp-result">${icon('lock')}${t('online.state.login', { name })}</p>`;
      case 'relogin':
        return html`<p class="dp-result">
          ${icon('warn', 'warn')}${t('online.state.relogin')} <b>${name}</b>
        </p>`;
      case 'connecting':
        return html`<p class="dp-result">
          <span class="spin" aria-hidden="true"></span>${t('sb.connecting', { address: host })}
        </p>`;
      case 'lost':
        return html`<p class="dp-result">
          <span class="sdot lost"></span>${t('device.state.lost')}
          <span class="mono">${host}</span>
        </p>`;
      case 'full':
        return html`<p class="dp-result"><span class="sdot lost"></span>${t('sb.full')}</p>`;
      case 'error':
        return html`<p class="dp-result err-text">
          ${icon('err', 'err')}${t('sb.error', { reason: errorText(s.error) })}
        </p>`;
      case 'incompatible':
        return html`<p class="dp-result err-text">${icon('err', 'err')}${t('sb.incompatible')}</p>`;
      default:
        return html`<p class="dp-result">
          <span class="sdot"></span>${t('device.state.offline')}
        </p>`;
    }
  }

  protected override render() {
    return html`<div class="ed dp">
      <div class="ed-head">
        <h2>${t('device.page.title')}</h2>
        <span class="path">${t('tree.device')}</span>
      </div>
      <div class="banner">
        ${icon('info', 'info')}
        <div>${t('device.page.banner')}</div>
      </div>
      <div class="form">
        ${this.bound()} ${this.address()}
        <fieldset>
          <legend>${t('device.page.checkLegend')}</legend>
          <div class="dp-body">${this.checkResult()}</div>
        </fieldset>
        <fieldset>
          <legend>${t('device.page.monitor')}</legend>
          <div class="dp-body">
            ${this.monitorState()}
            <p class="help">${t('device.page.monitorHelp')}</p>
          </div>
        </fieldset>
      </div>
    </div>`;
  }
}

customElements.define('mat-device-page', DevicePage);

registerEditor({
  match: (id) => id === 'device',
  render: (app) => html`<mat-device-page .app=${app}></mat-device-page>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-device-page': DevicePage;
  }
}
