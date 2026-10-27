// Tab "Thiết bị" (feature 027, specs/027-device-settings FR-008, ADR-054): thiết lập của thiết bị (bắt buộc đăng nhập,
// phạm vi xem, tên miền cho phép, giới hạn kết nối, OTA, tên) và chứng chỉ HTTPS (xem, sinh lại có IP, CSR, nhập), cùng
// API với Studio. Giảm mức bảo vệ và mọi thao tác thay chứng chỉ cần nhập lại mật khẩu. Lưu xong runtime tự khởi động
// lại: trang tải lại thiết lập sau vài giây. Mọi chữ qua textContent.
import {
  deviceSettingsProblem,
  loweredKeys,
  overlayOf,
  parseHosts,
  type DeviceSettingsInfo,
  type DeviceSettingsValues,
} from '@mat/access-model';
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import { button, field, h, input, reauthDialog } from './ui.ts';

const D = viAdmin.device;
let seq = 0;

function area(label: string, value: string, hint: string, attrs: Record<string, string> = {}) {
  const id = `ad-dev-ta-${++seq}`;
  const t = h('textarea', { id, attrs: { rows: '3', spellcheck: 'false', ...attrs } });
  t.value = value;
  const hi = h('p', { class: 'ad-hint', id: `${id}-hint`, text: hint });
  t.setAttribute('aria-describedby', hi.id);
  return {
    t,
    el: h('div', { class: 'ad-field' }, h('label', { text: label, attrs: { for: id } }), t, hi),
  };
}

export class DeviceTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  #s: DeviceSettingsInfo | null = null;
  #busy = false;
  readonly #body: HTMLElement;

  constructor(c: AdminCtx) {
    this.#c = c;
    this.#body = h('div', { class: 'ad-email-form' });
    this.el = h(
      'div',
      { class: 'ad-tabbody ad-device' },
      h('p', { class: 'ad-hint', text: D.intro }),
      this.#body,
    );
  }

  render(): void {
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      this.#s = await this.#c.api.deviceSettings();
      this.#draw();
    } catch (e) {
      this.#c.fail(e);
    }
  }

  #draw(): void {
    const s = this.#s;
    if (!s) return;
    const v = s.effective;
    const src = (k: keyof DeviceSettingsValues) => D.source(k in s.settings);

    const login = input('checkbox', { 'data-dev-login': '' });
    login.checked = v.viewerLogin === 'required';
    const access = h('select', { attrs: { 'data-dev-access': '' } });
    for (const k of ['private', 'any', 'off'])
      access.append(h('option', { text: D.accessNames[k] ?? k, attrs: { value: k } }));
    access.value = v.viewerAccess;
    const hosts = area(D.allowedHosts, v.allowedHosts.join('\n'), D.allowedHostsHint, {
      'data-dev-hosts': '',
    });
    const maxLive = input('number', { min: '1', max: '10', step: '1', 'data-dev-maxlive': '' });
    maxLive.value = v.maxLiveClientsPerSource ? String(v.maxLiveClientsPerSource) : '';
    const ota = input('checkbox', { 'data-dev-ota': '' });
    ota.checked = v.updateEnabled;
    const name = input('text', { maxlength: '32', autocomplete: 'off', 'data-dev-name': '' });
    name.value = v.deviceName;
    const msg = h('p', { class: 'ad-hint', attrs: { role: 'status', 'aria-live': 'polite' } });
    if (s.restartPending) msg.textContent = D.pending;

    const edited = (): DeviceSettingsValues => ({
      viewerLogin: login.checked ? 'required' : 'off',
      viewerAccess: access.value as DeviceSettingsValues['viewerAccess'],
      allowedHosts: parseHosts(hosts.t.value),
      maxLiveClientsPerSource: maxLive.value.trim() ? Math.round(Number(maxLive.value)) : 0,
      updateEnabled: ota.checked,
      deviceName: name.value.trim(),
    });
    const save = button(D.save, () => void this.#save(edited(), msg), { kind: 'primary' });
    save.setAttribute('data-dev-save', '');
    save.disabled = this.#busy;

    const check = (c: HTMLInputElement, label: string, from: string) =>
      h(
        'label',
        { class: 'ad-check' },
        c,
        h('span', { text: label }),
        h('span', { class: 'ad-hint', text: ` (${from})` }),
      );
    const general = h(
      'section',
      { class: 'ad-email-card', attrs: { 'aria-labelledby': 'ad-dev-general' } },
      h('h3', { id: 'ad-dev-general', text: D.general }),
      check(login, D.viewerLogin, src('viewerLogin')),
      h(
        'div',
        { class: 'ad-email-grid' },
        field(D.deviceName, name, src('deviceName')),
        field(D.viewerAccess, access, src('viewerAccess')),
        field(D.maxLive, maxLive, `${D.maxLiveHint} ${src('maxLiveClientsPerSource')}`),
        hosts.el,
      ),
      check(ota, D.updateEnabled, src('updateEnabled')),
      s.update.updaterInstalled ? h('span') : h('p', { class: 'ad-hint', text: D.updaterMissing }),
      h('div', { class: 'ad-email-actions' }, save),
      msg,
    );
    this.#body.replaceChildren(general, this.#certCard(s));
  }

  #certCard(s: DeviceSettingsInfo): HTMLElement {
    const c = s.cert;
    const rows: [string, string][] = c.ok
      ? [
          [D.fingerprint, c.fingerprintColons],
          [D.subject, `${c.subject} (${c.selfSigned ? D.selfSigned : D.caSigned})`],
          [D.validity, `${c.notBefore} – ${c.notAfter} UTC`],
          [D.san, [...c.sanIps, ...c.sanDns].join(', ')],
        ]
      : [[D.noCert, c.error]];
    const dl = h('dl', { class: 'ad-dev-cert' });
    for (const [k, v] of rows)
      dl.append(h('dt', { text: k }), h('dd', { text: v, attrs: { 'data-dev-cert': k } }));
    const warn = h('ul', { class: 'ad-hint' });
    for (const w of c.warnings) warn.append(h('li', { text: D.warnings[w] ?? w }));
    const extra = area(D.extraSan, '', D.extraSanHint, { 'data-dev-san': '' });
    const pem = area(D.importLabel, '', '', { rows: '6', 'data-dev-pem': '' });
    const out = h('pre', { class: 'ad-dev-csr', attrs: { 'data-dev-csr': '', tabindex: '0' } });
    const regen = button(D.regen, () => this.#regen(parseHosts(extra.t.value)), {
      kind: 'subtle',
    });
    regen.setAttribute('data-dev-regen', '');
    const csr = button(
      D.csr,
      () =>
        void this.#c.api.makeCsr(parseHosts(extra.t.value)).then(
          (p) => {
            out.textContent = p;
            this.#c.toast(D.csrDone);
          },
          (e) => this.#c.fail(e),
        ),
      { kind: 'subtle' },
    );
    csr.setAttribute('data-dev-csr-make', '');
    const imp = button(D.import, () => this.#import(pem.t), { kind: 'subtle' });
    imp.setAttribute('data-dev-import', '');
    return h(
      'section',
      { class: 'ad-email-card', attrs: { 'aria-labelledby': 'ad-dev-cert' } },
      h('h3', { id: 'ad-dev-cert', text: D.cert }),
      dl,
      warn,
      extra.el,
      h('div', { class: 'ad-email-actions' }, regen, csr),
      out,
      pem.el,
      h('div', { class: 'ad-email-actions' }, imp),
    );
  }

  async #save(v: DeviceSettingsValues, msg: HTMLElement): Promise<void> {
    const s = this.#s;
    if (!s || this.#busy) return;
    const problem = deviceSettingsProblem(v);
    if (problem) {
      this.#c.toast(problem, 'bad');
      return;
    }
    const overlay = overlayOf(s.base, v);
    const run = async (reauth?: string) => {
      this.#busy = true;
      try {
        const r = await this.#c.api.saveDeviceSettings(s.rev, overlay, reauth);
        msg.textContent = r.restart ? D.saved : D.savedNoRestart;
        this.#c.toast(r.restart ? D.saved : D.savedNoRestart);
        setTimeout(() => void this.#load(), r.restart ? 5000 : 0);
      } finally {
        this.#busy = false;
      }
    };
    const lowered = loweredKeys(s.effective, v);
    if (lowered.length === 0) {
      await run().catch((e: unknown) => this.#c.fail(e));
      return;
    }
    reauthDialog(this.#c.modalRoot, {
      title: D.lowerTitle,
      body: D.lowerBody(lowered.join(', ')),
      confirm: D.confirm,
      danger: true,
      run: (pw) => run(pw),
      onError: (e) => this.#c.fail(e),
    });
  }

  #regen(san: string[]): void {
    reauthDialog(this.#c.modalRoot, {
      title: D.regenTitle,
      body: D.regenBody,
      confirm: D.regen,
      danger: true,
      run: async (pw) => {
        const r = await this.#c.api.regenCert(pw, san);
        this.#c.toast(D.regenDone(r.fingerprint));
        setTimeout(() => void this.#load(), 5000);
      },
      onError: (e) => this.#c.fail(e),
    });
  }

  #import(t: HTMLTextAreaElement): void {
    const pem = t.value.trim();
    if (!pem) {
      this.#c.toast(D.importEmpty, 'bad');
      return;
    }
    reauthDialog(this.#c.modalRoot, {
      title: D.importTitle,
      body: D.importBody,
      confirm: D.import,
      danger: true,
      run: async (pw) => {
        const r = await this.#c.api.importCert(pw, pem);
        t.value = '';
        this.#c.toast(D.importDone(r.fingerprint));
        setTimeout(() => void this.#load(), 5000);
      },
      onError: (e) => this.#c.fail(e),
    });
  }
}
