// Tab "Thông báo email" (feature 023, device-api 1.6.0 mở rộng, apiVersion không đổi; specs/023-alarm-email US1, US7): máy chủ SMTP, tên trạm, liên
// kết, quy tắc gửi theo mức/lớp/khu/sự kiện tới địa chỉ và nhóm người dùng, chống bão (gom, giới hạn/giờ, giờ yên
// lặng), nút Gửi thử, trạng thái (hàng đợi, lần gửi cuối, lỗi cuối). Mật khẩu SMTP không bao giờ qua trang: chỉ hiện
// "đã đặt/chưa đặt". Máy chủ kiểm chặt lại mọi thứ (rev, CSRF, administrator). Mọi chữ qua textContent.
import { viAdmin } from '../i18n/vi-admin.ts';
import type { AdminCtx, AdminTab } from './admin-page.ts';
import type { EmailConfig, EmailEvent, EmailRule, EmailSettings } from './api.ts';
import { emailConfigProblem, newRule, splitList } from './email-model.ts';
import { fmtTime, validEmail } from './model.ts';
import { button, field, h, input, pill } from './ui.ts';

const E = viAdmin.email;
const EVENTS: readonly EmailEvent[] = ['active', 'return', 'reminder'];

function num(i: HTMLInputElement, lo: number, hi: number, d: number): number {
  const v = Math.round(Number(i.value));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}

function numberInput(value: number, lo: number, hi: number): HTMLInputElement {
  const i = input('number', { min: String(lo), max: String(hi), step: '1' });
  i.value = String(value);
  return i;
}

function textInput(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  const i = input('text', { autocomplete: 'off', spellcheck: 'false', ...attrs });
  i.value = value;
  return i;
}

function check(label: string, on: boolean, attrs: Record<string, string> = {}) {
  const c = input('checkbox', attrs);
  c.checked = on;
  return { c, el: h('label', { class: 'ad-check' }, c, h('span', { text: label })) };
}

export class EmailTab implements AdminTab {
  readonly el: HTMLElement;
  readonly #c: AdminCtx;
  #s: EmailSettings | null = null;
  #cfg: EmailConfig | null = null;
  #busy = false;
  #collect: (() => void)[] = [];
  #ruleCollect: (() => void)[] = [];
  readonly #form: HTMLElement;
  readonly #status: HTMLElement;
  readonly #msg: HTMLElement;

  constructor(c: AdminCtx) {
    this.#c = c;
    this.#form = h('div', { class: 'ad-email-form' });
    this.#status = h('section', {
      class: 'ad-email-card',
      attrs: { 'aria-labelledby': 'ad-email-status' },
    });
    this.#msg = h('p', { class: 'ad-hint', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.el = h(
      'div',
      { class: 'ad-tabbody ad-email' },
      h('p', { class: 'ad-hint', text: E.intro }),
      this.#status,
      this.#form,
      this.#msg,
    );
  }

  render(): void {
    void this.#load();
  }

  async #load(): Promise<void> {
    try {
      this.#s = await this.#c.api.emailSettings();
      this.#cfg = structuredClone(this.#s.config);
      this.#draw();
    } catch (e) {
      this.#c.fail(e);
    }
  }

  #draw(): void {
    const s = this.#s;
    const cfg = this.#cfg;
    if (!s || !cfg) return;
    this.#collect = [];
    this.#drawStatus(s);

    // ---- chung + SMTP
    const enabled = check(E.enabled, cfg.enabled, { 'data-email-enabled': '' });
    const site = textInput(cfg.siteName, { maxlength: '80' });
    const baseUrl = textInput(cfg.baseUrl, { maxlength: '200', inputmode: 'url' });
    const host = textInput(cfg.smtp.host, { maxlength: '253', 'data-smtp-host': '' });
    const port = numberInput(cfg.smtp.port, 1, 65535);
    const security = h('select');
    for (const k of ['starttls', 'smtps', 'none'])
      security.append(h('option', { text: E.securityNames[k] ?? k, attrs: { value: k } }));
    security.value = cfg.smtp.security;
    security.addEventListener('change', () => {
      if (security.value === 'smtps' && port.value === '587') port.value = '465';
      if (security.value === 'starttls' && port.value === '465') port.value = '587';
    });
    const username = textInput(cfg.smtp.username, { maxlength: '254' });
    const from = input('email', { autocomplete: 'off', maxlength: '254', 'data-smtp-from': '' });
    from.value = cfg.smtp.from;
    const fromName = textInput(cfg.smtp.fromName, { maxlength: '80' });
    const pin = textInput(cfg.smtp.pinSha256, { maxlength: '95' });
    this.#collect.push(() => {
      cfg.enabled = enabled.c.checked;
      cfg.siteName = site.value.trim();
      cfg.baseUrl = baseUrl.value.trim();
      cfg.smtp.host = host.value.trim();
      cfg.smtp.port = num(port, 1, 65535, 587);
      cfg.smtp.security = security.value as EmailConfig['smtp']['security'];
      cfg.smtp.username = username.value.trim();
      cfg.smtp.from = from.value.trim();
      cfg.smtp.fromName = fromName.value.trim();
      cfg.smtp.pinSha256 = pin.value.trim();
    });
    const smtp = h(
      'section',
      { class: 'ad-email-card', attrs: { 'aria-labelledby': 'ad-email-smtp' } },
      h('h3', { id: 'ad-email-smtp', text: E.smtpTitle }),
      enabled.el,
      h(
        'div',
        { class: 'ad-email-grid' },
        field(E.site, site),
        field(E.baseUrl, baseUrl, E.baseUrlHint),
        field(E.host, host),
        field(E.port, port),
        field(E.security, security),
        field(E.username, username, E.usernameHint),
        field(E.from, from),
        field(E.fromName, fromName),
        field(E.pin, pin, E.pinHint),
      ),
      h(
        'p',
        { class: 'ad-email-pw' },
        h('span', { text: `${E.password}: ` }),
        pill(
          s.passwordSet ? E.passwordSet : E.passwordMissing,
          s.passwordSet ? 'ok' : cfg.smtp.username ? 'warn' : 'muted',
        ),
      ),
    );

    // ---- quy tắc
    const rulesBox = h('div', { class: 'ad-email-rules' });
    const drawRules = () => {
      this.#ruleCollect = [];
      rulesBox.replaceChildren(
        ...(cfg.rules.length
          ? cfg.rules.map((r, i) => this.#ruleCard(r, i, drawRules))
          : [h('p', { class: 'ad-empty', text: E.noRules })]),
      );
    };
    drawRules();
    const addRule = button(
      E.addRule,
      () => {
        this.#gather();
        cfg.rules.push(newRule(cfg.rules));
        drawRules();
        rulesBox.querySelector<HTMLInputElement>('.ad-email-rule:last-child input')?.focus();
      },
      { kind: 'subtle', icon: 'list' },
    );
    addRule.setAttribute('data-add-rule', '');
    addRule.disabled = cfg.rules.length >= 20;
    const rules = h(
      'section',
      { class: 'ad-email-card', attrs: { 'aria-labelledby': 'ad-email-rules' } },
      h('h3', { id: 'ad-email-rules', text: E.rulesTitle }),
      rulesBox,
      addRule,
    );

    // ---- chống bão
    const batch = numberInput(cfg.batchSeconds, 5, 600);
    const maxH = numberInput(cfg.maxPerHour, 1, 120);
    const remMax = numberInput(cfg.reminderMax, 1, 20);
    const quiet = check(E.quiet, cfg.quietHours.enabled);
    const qFrom = input('time');
    qFrom.value = cfg.quietHours.from;
    const qTo = input('time');
    qTo.value = cfg.quietHours.to;
    const qMin = h('select');
    for (const p of [1, 2, 3, 4])
      qMin.append(
        h('option', {
          text: `≤ ${E.priorityNames[p] ?? p}`,
          attrs: { value: String(p) },
        }),
      );
    qMin.value = String(cfg.quietHours.minPriority);
    this.#collect.push(() => {
      cfg.batchSeconds = num(batch, 5, 600, 30);
      cfg.maxPerHour = num(maxH, 1, 120, 20);
      cfg.reminderMax = num(remMax, 1, 20, 3);
      cfg.quietHours = {
        enabled: quiet.c.checked,
        from: qFrom.value || '22:00',
        to: qTo.value || '06:00',
        minPriority: Number(qMin.value) || 1,
      };
    });
    const limits = h(
      'section',
      { class: 'ad-email-card', attrs: { 'aria-labelledby': 'ad-email-limits' } },
      h('h3', { id: 'ad-email-limits', text: E.limitsTitle }),
      h(
        'div',
        { class: 'ad-email-grid' },
        field(E.batch, batch),
        field(E.maxPerHour, maxH),
        field(E.reminderMax, remMax),
      ),
      quiet.el,
      h(
        'div',
        { class: 'ad-email-grid' },
        field(E.quietFrom, qFrom),
        field(E.quietTo, qTo),
        field(E.quietMin, qMin),
      ),
    );

    const save = button(E.save, () => void this.#save(), { kind: 'primary' });
    save.setAttribute('data-email-save', '');
    save.disabled = this.#busy;

    // ---- gửi thử
    const to = input('email', { autocomplete: 'off', maxlength: '254', 'data-test-to': '' });
    const testBtn = button(E.test, () => void this.#test(to, testBtn), { kind: 'subtle' });
    testBtn.setAttribute('data-email-test', '');
    const test = h(
      'section',
      { class: 'ad-email-card', attrs: { 'aria-labelledby': 'ad-email-test' } },
      h('h3', { id: 'ad-email-test', text: E.testTitle }),
      h('div', { class: 'ad-email-row' }, field(E.testTo, to), testBtn),
    );

    this.#form.replaceChildren(
      smtp,
      rules,
      limits,
      h('div', { class: 'ad-email-actions' }, save),
      test,
    );
  }

  #ruleCard(r: EmailRule, i: number, redraw: () => void): HTMLElement {
    const groups = this.#s?.groups ?? [];
    const name = textInput(r.name, { maxlength: '80' });
    const en = check(viAdmin.users.enabled, r.enabled);
    const prios = new Set(r.priorities);
    const prioBox = h('div', {
      class: 'ad-email-checks',
      attrs: { role: 'group', 'aria-label': E.priorities },
    });
    const prioChecks = [1, 2, 3, 4].map((p) => {
      const x = check(E.priorityNames[p] ?? String(p), prios.has(p), { 'data-prio': String(p) });
      prioBox.append(x.el);
      return x.c;
    });
    const evBox = h('div', {
      class: 'ad-email-checks',
      attrs: { role: 'group', 'aria-label': E.events },
    });
    const evChecks = EVENTS.map((ev) => {
      const x = check(E.eventNames[ev] ?? ev, r.events.includes(ev), { 'data-event': ev });
      evBox.append(x.el);
      return x.c;
    });
    const remMin = numberInput(r.reminderMin, 5, 1440);
    const classes = textInput(r.classes.join(', '));
    const areas = textInput(r.areas.join(', '));
    const to = textInput(r.to.join(', '), { 'data-rule-to': '' });
    const grpBox = h('div', {
      class: 'ad-email-checks',
      attrs: { role: 'group', 'aria-label': E.groups },
    });
    const grpChecks = groups.map((g) => {
      const x = check(
        `${g.name} (${E.groupInfo(g.withEmail, g.members)})`,
        r.groups.includes(g.id),
        {
          'data-group': g.id,
        },
      );
      grpBox.append(x.el);
      return { id: g.id, c: x.c };
    });
    this.#ruleCollect.push(() => {
      r.name = name.value.trim();
      r.enabled = en.c.checked;
      r.priorities = [1, 2, 3, 4].filter((_, k) => prioChecks[k]!.checked);
      if (r.priorities.length === 4) r.priorities = [];
      const ev = EVENTS.filter((_, k) => evChecks[k]!.checked);
      r.events = ev.length ? [...ev] : ['active'];
      r.reminderMin = num(remMin, 5, 1440, 30);
      r.classes = splitList(classes.value);
      r.areas = splitList(areas.value);
      r.to = splitList(to.value);
      r.groups = grpChecks.filter((g) => g.c.checked).map((g) => g.id);
    });
    const label = r.name || r.id;
    const remove = button(
      E.remove,
      () => {
        this.#gather();
        this.#cfg?.rules.splice(i, 1);
        redraw();
      },
      { kind: 'ghost', icon: 'close', aria: E.removeRule(label), small: true },
    );
    return h(
      'fieldset',
      { class: 'ad-email-rule', attrs: { 'data-rule': r.id } },
      h('legend', { text: `${i + 1}. ${label}` }),
      h('div', { class: 'ad-email-grid' }, field(E.ruleName, name), en.el),
      h(
        'div',
        { class: 'ad-field' },
        h('span', { class: 'ad-label', text: `${E.priorities} (${E.allPriorities})` }),
        prioBox,
      ),
      h('div', { class: 'ad-field' }, h('span', { class: 'ad-label', text: E.events }), evBox),
      h(
        'div',
        { class: 'ad-email-grid' },
        field(E.reminderMin, remMin),
        field(E.classes, classes),
        field(E.areas, areas),
        field(E.to, to),
      ),
      groups.length
        ? h('div', { class: 'ad-field' }, h('span', { class: 'ad-label', text: E.groups }), grpBox)
        : null,
      remove,
    );
  }

  #drawStatus(s: EmailSettings): void {
    const st = s.status;
    const rows: [string, string][] = [
      [E.queue, String(st.queue.count)],
      [E.pending, String(st.pendingEvents)],
      [E.lastOk, st.lastOkAt ? fmtTime(st.lastOkAt) : E.never],
      [
        E.lastError,
        st.lastError
          ? `${fmtTime(st.lastError.at)} · ${st.lastError.error} · ${st.lastError.message}${
              st.queue.count && st.nextAttemptInS ? ` (${E.nextAttempt(st.nextAttemptInS)})` : ''
            }`
          : E.never,
      ],
    ];
    this.#status.replaceChildren(
      h('h3', { id: 'ad-email-status', text: E.statusTitle }),
      ...(st.configError
        ? [
            h('p', {
              class: 'ad-error',
              attrs: { role: 'alert' },
              text: E.configError(st.configError),
            }),
          ]
        : []),
      h(
        'dl',
        { class: 'ad-email-status' },
        ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]),
      ),
      h('p', { class: 'ad-hint', text: E.counters(st.sent, st.failed, st.dropped) }),
    );
  }

  #gather(): void {
    for (const f of this.#collect) f();
    for (const f of this.#ruleCollect) f();
  }

  async #save(): Promise<void> {
    if (this.#busy || !this.#s || !this.#cfg) return;
    this.#gather();
    const problem = emailConfigProblem(this.#cfg);
    if (problem) {
      this.#msg.textContent = problem;
      return;
    }
    this.#busy = true;
    try {
      await this.#c.api.saveEmail(this.#s.rev, this.#cfg);
      this.#c.toast(E.saved);
      this.#msg.textContent = '';
      this.#busy = false;
      await this.#load();
    } catch (e) {
      this.#busy = false;
      this.#c.fail(e);
    }
  }

  async #test(to: HTMLInputElement, btn: HTMLButtonElement): Promise<void> {
    const addr = to.value.trim();
    if (!validEmail(addr)) {
      this.#msg.textContent = viAdmin.userForm.emailBad;
      to.focus();
      return;
    }
    btn.disabled = true;
    this.#msg.textContent = E.testing;
    try {
      const r = await this.#c.api.testEmail(addr);
      this.#msg.textContent = r.ok ? E.testOk : E.testFail(r.message || r.error);
      this.#c.toast(r.ok ? E.testOk : E.testFail(r.message || r.error), r.ok ? 'ok' : 'bad');
      if (this.#s) {
        this.#s = await this.#c.api.emailSettings();
        this.#drawStatus(this.#s);
      }
    } catch (e) {
      this.#msg.textContent = '';
      this.#c.fail(e);
    } finally {
      btn.disabled = false;
    }
  }
}
