// Thanh trạng thái (feature 004, T051, T071, FR-008, FR-012, FR-028, FR-030): trạng thái thiết bị (chấm
// màu hay icon, luôn kèm chữ): không kết nối, đang kết nối, đang theo dõi kèm tên, địa chỉ, phiên bản
// runtime, project trên thiết bị (báo khi thiết bị chạy project khác), mất kết nối và thiết bị đầy kèm đếm
// ngược tới lần thử lại và "Thử lại ngay", lý do không kết nối được. Số lỗi và cảnh báo (nhấp mở tab Thông
// tin), tiến trình kiểm tra, nút đổi theme. Khi làm việc với thiết bị, thanh có nền cam (lớp `online` của
// khung). Đổi trạng thái phiên thì báo bằng thông báo ngắn.
// Feature 005 (US1, FR-031, FR-035): Online có đăng nhập hiện tên thiết bị, địa chỉ HTTPS và `tài khoản · role`;
// các bước dò chứng chỉ, chờ ghim, chờ đăng nhập; phiên hết hạn kèm nút "Đăng nhập lại"; thiết bị runtime cũ
// kèm "runtime cần cập nhật để nạp xuống".
import { html, nothing } from 'lit';
import type { Theme } from '../app/workspace.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import { isLive, type SessionState } from '../model/device-session.ts';
import { AppElement, icon } from './base.ts';
import {
  projectIcon,
  projectOf,
  projectText,
  sessionErrorText,
  sessionHost,
} from './diagnostics.ts';

const THEME_ICON: Readonly<Record<Theme, IconName>> = {
  system: 'contrast',
  light: 'sun',
  dark: 'moon',
};
const THEME_TEXT: Readonly<Record<Theme, MessageKey>> = {
  system: 'sb.theme.system',
  light: 'sb.theme.light',
  dark: 'sb.theme.dark',
};
const NEXT_THEME: Readonly<Record<Theme, Theme>> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

/** Giây còn lại tới lần thử lại (làm tròn lên); `null` khi không hẹn. */
function secondsLeft(at: number | null): number | null {
  return at === null ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

export class MatStatusbar extends AppElement {
  private offSession: (() => void) | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Trạng thái đã báo gần nhất: tránh báo lại mỗi lần thử lại khi thiết bị vẫn đầy. */
  private notified: SessionState = 'idle';

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-label', t('shell.statusbar'));
  }

  protected override attached(): void {
    this.notified = this.app.session.state;
    this.offSession = this.app.session.subscribe((e) => {
      if (e.type === 'state') this.notify(e.state);
    });
  }

  protected override detached(): void {
    this.offSession?.();
    this.offSession = null;
    this.stopTicker();
  }

  /** Thông báo ngắn khi phiên đổi trạng thái (ngắt do người dùng thì không báo). */
  private notify(state: SessionState): void {
    const app = this.app;
    const session = app.session;
    const prev = this.notified;
    const address = sessionHost(app);
    const name = session.device?.name ?? address;
    if (
      state === 'connecting' ||
      state === 'probing' ||
      state === 'pin-confirm' ||
      state === 'login'
    )
      return;
    this.notified = state;
    switch (state) {
      case 'monitoring': {
        if (prev === 'lost') {
          app.toast(t('monitor.toast.reconnected', { address }));
          break;
        }
        if (prev === 'relogin') break;
        const auth = session.auth;
        if (session.mode === 'online' && auth) {
          app.toast(t('online.toast.online', { name, user: auth.user, role: auth.role }));
          break;
        }
        if (session.notice === 'runtime-old') {
          const version = session.info?.runtimeVersion ?? '?';
          app.toast(t('online.toast.runtimeOld', { name, version }));
          break;
        }
        const p = projectOf(app, app.session.info);
        app.toast(
          p.kind === 'other'
            ? t('monitor.toast.otherProject', { address, id: p.id, version: p.version })
            : t('monitor.toast.monitoring', { address }),
        );
        break;
      }
      case 'lost':
        if (prev !== 'lost') app.toast(t('monitor.toast.lost', { address }));
        break;
      case 'full':
        if (prev !== 'full') app.toast(t('monitor.toast.full', { address }));
        break;
      case 'error':
        if (session.mode === 'online' && session.error === 'cert-mismatch')
          app.toast(t('online.toast.certMismatch', { name }));
        else app.toast(t('monitor.toast.error', { address, reason: sessionErrorText(app) }));
        break;
      case 'relogin':
        app.toast(t('online.toast.relogin', { name }));
        break;
      case 'idle':
        if (session.error === 'session-invalid') app.toast(t('online.toast.sessionInvalid'));
        break;
      case 'incompatible':
        app.toast(t('monitor.toast.incompatible', { address }));
        break;
      default:
        break;
    }
  }

  private stopTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  /** Đang chờ thử lại (đầy, mất kết nối): vẽ lại mỗi giây để đếm ngược. */
  protected override updated(): void {
    const s = this.app.session;
    const waiting = (s.state === 'full' || s.state === 'lost') && s.retryAt !== null;
    if (waiting && !this.ticker) this.ticker = setInterval(() => this.requestUpdate(), 1000);
    else if (!waiting) this.stopTicker();
  }

  /** Online có đăng nhập (feature 005): Online · tên · địa chỉ HTTPS · runtime · project · tài khoản · role. */
  private onlineDevice() {
    const app = this.app;
    const session = app.session;
    const d = session.device!;
    const auth = session.auth;
    const info = session.info;
    const sep = html`<span class="sb-sep hide-s"></span>`;
    const relogin = session.state === 'relogin';
    const ptext = info ? projectText(projectOf(app, info)) : null;
    return html`<span class="sb"
        ><span class="sdot monitoring"></span><b>${t('online.state.online')}</b></span
      >${sep}<span class="sb"><b>${d.name}</b></span
      >${sep}<span class="sb mono hide-s">${d.host}:${d.httpsPort}</span> ${
        info?.runtimeVersion
          ? html`${sep}<span class="sb hide-s"
                >${t('sb.runtime', { version: info.runtimeVersion })}</span
              >`
          : nothing
      }
      ${ptext ? html`${sep}<span class="sb hide-s">${ptext}</span>` : nothing}
      ${
        relogin
          ? html`${sep}<span class="sb">${icon('warn', 'warn')}${t('online.state.relogin')}</span>`
          : auth
            ? html`${sep}<span class="sb" title=${t('online.accountTip')}
                  >${icon('lock')}${t('online.account', { user: auth.user, role: auth.role })}</span
                >`
            : nothing
      }`;
  }

  private device() {
    const app = this.app;
    const session = app.session;
    const host = sessionHost(app);
    const sep = html`<span class="sb-sep hide-s"></span>`;
    const wait = secondsLeft(session.retryAt);
    const name = session.device?.name ?? host;
    if (
      session.mode === 'online' &&
      session.device &&
      (session.state === 'monitoring' || session.state === 'relogin')
    )
      return this.onlineDevice();
    switch (session.state) {
      case 'probing':
        return html`<span class="sb"
          ><span class="spin" aria-hidden="true"></span>${t('online.state.probing', { name })}</span
        >`;
      case 'pin-confirm':
        return html`<span class="sb"
          >${icon('shield', 'info')}${t('online.state.pin', { name })}</span
        >`;
      case 'login':
        return html`<span class="sb">${icon('lock')}${t('online.state.login', { name })}</span>`;
      case 'monitoring': {
        const info = session.info;
        const project = projectOf(app, info);
        const ptext = projectText(project);
        const pi = projectIcon(project);
        return html`<span class="sb"
            ><span class="sdot monitoring"></span><b>${t('device.state.monitoring')}</b></span
          >${sep}<span class="sb hide-s">${session.device?.name ?? t('tree.device')}</span
          >${sep}<span class="sb mono hide-s">${host}</span> ${
            info?.runtimeVersion
              ? html`${sep}<span class="sb hide-s"
                    >${t('sb.runtime', { version: info.runtimeVersion })}</span
                  >`
              : nothing
          }
          ${
            ptext
              ? html`${sep}<span class="sb"
                    >${pi.icon ? icon(pi.icon, pi.iconCls ?? '') : nothing}${ptext}</span
                  >`
              : nothing
          }
          ${
            session.notice === 'runtime-old'
              ? html`${sep}<span class="sb"
                    >${icon('warn', 'warn')}${t('device.err.runtime-old')}</span
                  >`
              : nothing
          }`;
      }
      case 'lost':
        return html`<span class="sb"
            ><span class="sdot lost"></span>${
              wait === null ? t('monitor.reconnecting') : t('monitor.lost', { s: wait })
            }</span
          >${sep}<span class="sb mono hide-s">${host}</span>`;
      case 'connecting':
        return html`<span class="sb"
          ><span class="spin" aria-hidden="true"></span
          >${t('sb.connecting', { address: host })}</span
        >`;
      case 'full':
        return html`<span class="sb"
          ><span class="sdot lost"></span>${t('monitor.full', { s: wait ?? 30 })}</span
        >`;
      case 'incompatible':
        return html`<span class="sb">${icon('err', 'err')}${t('sb.incompatible')}</span>`;
      case 'error':
        return html`<span class="sb"
            >${icon('err', 'err')}${t('sb.error', { reason: sessionErrorText(app) })}</span
          >${sep}<span class="sb mono hide-s">${host}</span>`;
      default: {
        // Không làm việc với thiết bị: thiết bị gắn với project (T085a, Ctrl+K kết nối tới thiết bị này),
        // không có thì địa chỉ đã nhập ở trang Thiết bị.
        const bound = app.projectDevice();
        if (bound)
          return html`<span class="sb"><span class="sdot"></span>${t('device.state.offline')}</span
            >${sep}<span class="sb hide-s"><b>${bound.name}</b></span
            >${sep}<span class="sb mono hide-s">${bound.host}:${bound.httpsPort}</span>`;
        const address = app.deviceAddress();
        return html`<span class="sb"><span class="sdot"></span>${t('device.state.offline')}</span
          >${sep}<span class="sb hide-s ${address ? 'mono' : ''}"
            >${address || t('sb.noAddress')}</span
          >`;
      }
    }
  }

  /** "Khớp/khác" với thiết bị (feature 005, US3): ký hiệu kèm chữ; nhấp mở So sánh. */
  private compareChip() {
    const app = this.app;
    const s = app.session;
    if (s.mode !== 'online' || s.auth === null || !isLive(s.state)) return nothing;
    const c = s.compare;
    let cls = '';
    let symbol = '';
    let text: string;
    if (c.error) {
      text = t('compare.sb.error');
      cls = 'del';
      symbol = '!';
    } else if (c.info) {
      cls = c.info.same ? 'eq' : 'ne';
      symbol = c.info.same ? '=' : '≠';
      const version = (app.store.state.outline.project as { projectVersion?: unknown } | null)
        ?.projectVersion;
      text = c.info.same
        ? t('compare.sb.match', { version: typeof version === 'string' ? version : '' })
        : t('compare.sb.differ');
    } else if (c.busy) text = t('compare.sb.busy');
    else return nothing;
    return html`<button
      class="sb"
      type="button"
      data-role="compare"
      title=${t('compare.sb.tip')}
      @click=${() => void app.run('online.compare')}
    >
      ${symbol ? html`<span class="cmp-sym ${cls}" aria-hidden="true">${symbol}</span>` : nothing}
      ${text}
    </button>`;
  }

  /** Dấu MÔ PHỎNG (FR-052): giá trị tự tính trong Studio, không gửi gì tới thiết bị. */
  private simPill() {
    const app = this.app;
    if (!app.simulating() || app.online()) return nothing;
    return html`<span class="sb sb-sim" data-role="sim" role="status" title=${t('sim.pillTip')}
      >${icon('play')}${t('sim.pill')}</span
    >`;
  }

  /** Trang xem đang mở cho mọi nguồn (`viewerAccess = any`, ADR-018): cảnh báo màu hổ phách kèm icon và chữ. */
  private viewerWarning() {
    const s = this.app.session;
    if (!isLive(s.state) || !s.viewerPublic) return nothing;
    return html`<span class="sb sb-viewer" role="status" title=${t('sb.viewerPublicTip')}
      >${icon('warn', 'warn')}${t('sb.viewerPublic')}</span
    >`;
  }

  protected override render() {
    const app = this.app;
    const { errors, warnings } = app.counts();
    const theme = app.workspace.theme;
    const hasProject = app.store.state.project !== null;
    const state = app.session.state;
    const retry = state === 'full' || state === 'lost';
    return html`<button
        class="sb"
        type="button"
        title=${t('monitor.deviceTip')}
        @click=${() => void app.run('online.device')}
      >
        ${this.device()}
      </button>
      ${
        retry
          ? html`<button class="sb" type="button" @click=${() => app.session.retryNow()}>
              ${icon('refresh')}${t('monitor.retryNow')}
            </button>`
          : nothing
      }
      ${
        state === 'relogin'
          ? html`<button class="sb" type="button" @click=${() => void app.run('online.login')}>
              ${icon('lock')}${t('online.reloginButton')}
            </button>`
          : nothing
      }
      ${this.simPill()} ${this.compareChip()} ${this.viewerWarning()}
      <span class="sb-grow"></span>
      ${
        app.store.state.checking
          ? html`<span class="sb" role="status"
                ><span class="spin" aria-hidden="true"></span>${t('sb.checking')}</span
              ><span class="sb-sep"></span>`
          : nothing
      }
      ${
        hasProject
          ? html`<button
                class="sb"
                type="button"
                title=${t('sb.openInfo')}
                @click=${() => app.setInspectorTab('info')}
              >
                ${icon('err', 'e')}<span class="num">${t('sb.errors', { n: errors })}</span>
                ${icon('warn', 'w')}<span class="num">${t('sb.warnings', { n: warnings })}</span>
              </button>
              <span class="sb-sep hide-s"></span>`
          : nothing
      }
      <button
        class="sb hide-s"
        type="button"
        title=${t('sb.themeCycle')}
        @click=${() => app.setTheme(NEXT_THEME[app.workspace.theme])}
      >
        ${icon(THEME_ICON[theme])}${t(THEME_TEXT[theme])}
      </button>`;
  }
}

customElements.define('mat-statusbar', MatStatusbar);

declare global {
  interface HTMLElementTagNameMap {
    'mat-statusbar': MatStatusbar;
  }
}
