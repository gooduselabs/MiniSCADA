// Hộp thoại của nhóm editor "Người dùng và quyền" (feature 027): Thêm người dùng, Đặt lại mật khẩu, Xóa người dùng, Thêm/Xóa
// nhóm, Tạo/Thu hồi API key, Gửi thử email, hiện mật khẩu sinh hoặc token một lần, và xác nhận lại bằng mật khẩu của chính
// mình (thao tác nhạy cảm). Nội dung theo `app.admin.dialog`; khung, focus, Esc như các hộp thoại Online (dialog-frame.ts).
// Mật khẩu chỉ ở trong ô nhập tới khi gửi, gửi xong thì xóa; không giữ ở đâu khác.
import {
  GROUP_ID,
  PW_MAX,
  PW_MIN,
  ROLES,
  ROLE_NAMES,
  USER_NAME,
  canWrite,
  draftProblem,
  emptyDraft,
  expiryFromDate,
  needsReauth,
  slugify,
  splitAllowFrom,
  validEmail,
  type ApiKeyDraft,
  type Role,
} from '@mat/admin-model';
import { html, nothing, type TemplateResult } from 'lit';
import type { AdminDialog } from '../../app/admin-workspace.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './admin-dialog.css';

const val = (e: Event) => (e.target as HTMLInputElement).value;

export class MatAdminDialog extends OnlineDialog {
  static override properties = { f: { state: true } };
  protected readonly kind = 'admin' as const;

  /** Ô của hộp thoại đang mở (đặt lại mỗi lần mở). */
  declare f: {
    name: string;
    role: Role;
    groups: string[];
    email: string;
    generate: boolean;
    pw: string;
    pw2: string;
    reauth: string;
    to: string;
    groupName: string;
    groupId: string;
    idTouched: boolean;
    key: ApiKeyDraft;
    allowText: string;
    expires: string;
    copied: boolean;
    result: { ok: boolean; text: string } | null;
    problem: string | null;
  };

  constructor() {
    super();
    this.f = MatAdminDialog.blank();
  }

  private static blank(): MatAdminDialog['f'] {
    return {
      name: '',
      role: 'operator',
      groups: [],
      email: '',
      generate: true,
      pw: '',
      pw2: '',
      reauth: '',
      to: '',
      groupName: '',
      groupId: '',
      idTouched: false,
      key: emptyDraft(),
      allowText: '',
      expires: '',
      copied: false,
      result: null,
      problem: null,
    };
  }

  private get d(): AdminDialog | null {
    return this.hasApp ? (this.app.admin?.dialog ?? null) : null;
  }

  protected override opened(): void {
    this.f = MatAdminDialog.blank();
  }

  protected override close(): void {
    this.app.admin?.closeDialog();
  }

  protected override initialFocus(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>('.dlg-b input:not([disabled]):not([type="checkbox"])') ??
      super.initialFocus()
    );
  }

  private set(patch: Partial<MatAdminDialog['f']>): void {
    this.f = { ...this.f, ...patch, problem: null };
  }

  private field(
    id: string,
    label: string,
    control: TemplateResult,
    help?: string | TemplateResult | null,
  ) {
    return html`<div class="field ad-f">
      <label for=${id}>${label}</label>${control}
      ${help ? html`<p class="help" id=${`${id}-h`}>${help}</p>` : nothing}
    </div>`;
  }

  private pwFields(): TemplateResult {
    const n = this.f.pw.length;
    const hint =
      n === 0
        ? t('admin.pw.rule', { min: PW_MIN })
        : n < PW_MIN
          ? t('admin.pw.short', { n, min: PW_MIN })
          : n > PW_MAX
            ? t('admin.pw.long', { max: PW_MAX })
            : t('admin.pw.ok');
    return html`<fieldset class="ad-pwmode">
        <legend>${t('admin.pw.mode')}</legend>
        <label
          ><input
            type="radio"
            name="pwmode"
            data-role="pw-generate"
            .checked=${this.f.generate}
            @change=${() => this.set({ generate: true })}
          />${t('admin.pw.generate')}</label
        >
        <label
          ><input
            type="radio"
            name="pwmode"
            data-role="pw-type"
            .checked=${!this.f.generate}
            @change=${() => this.set({ generate: false })}
          />${t('admin.pw.type')}</label
        >
      </fieldset>
      ${
        this.f.generate
          ? html`<p class="help">${t('admin.pw.generateHelp')}</p>`
          : html`${this.field(
              'ad-pw',
              t('admin.pw.new'),
              html`<input
                id="ad-pw"
                class="input"
                type="password"
                name="new-password"
                autocomplete="new-password"
                aria-describedby="ad-pw-h"
                .value=${this.f.pw}
                @input=${(e: Event) => this.set({ pw: val(e) })}
              />`,
              hint,
            )}
            ${this.field(
              'ad-pw2',
              t('admin.pw.repeat'),
              html`<input
                id="ad-pw2"
                class="input"
                type="password"
                autocomplete="new-password"
                .value=${this.f.pw2}
                @input=${(e: Event) => this.set({ pw2: val(e) })}
              />`,
            )}`
      }`;
  }

  /** Mật khẩu mới đã nhập hợp lệ: `null` khi sinh; chuỗi lỗi khi sai. */
  private newPassword(): { pw: string | null } | { problem: string } {
    if (this.f.generate) return { pw: null };
    const n = this.f.pw.length;
    if (n < PW_MIN || n > PW_MAX) return { problem: t('admin.pw.rule', { min: PW_MIN }) };
    if (this.f.pw !== this.f.pw2) return { problem: t('admin.pw.mismatch') };
    return { pw: this.f.pw };
  }

  private reauthField(): TemplateResult {
    return this.field(
      'ad-reauth',
      t('admin.reauth.label', { user: this.app.session.auth?.user ?? '' }),
      html`<input
        id="ad-reauth"
        class="input"
        type="password"
        name="reauth"
        autocomplete="current-password"
        data-role="reauth"
        .value=${this.f.reauth}
        @input=${(e: Event) => this.set({ reauth: val(e) })}
      />`,
      t('admin.reauth.help'),
    );
  }

  private groupChecks(selected: readonly string[], onToggle: (id: string, on: boolean) => void) {
    const groups = this.app.admin?.groups ?? [];
    if (!groups.length) return html`<p class="help">${t('admin.user.noGroups')}</p>`;
    return html`<fieldset class="ad-checks">
      <legend>${t('admin.user.groups')}</legend>
      ${groups.map(
        (g) =>
          html`<label
            ><input
              type="checkbox"
              data-group=${g.id}
              .checked=${selected.includes(g.id)}
              @change=${(e: Event) => onToggle(g.id, (e.target as HTMLInputElement).checked)}
            />${g.name} <span class="mono muted">${g.id}</span></label
          >`,
      )}
    </fieldset>`;
  }

  private submit(e?: Event): void {
    e?.preventDefault();
    const a = this.app.admin;
    const d = this.d;
    if (!a || !d || a.busy) return;
    const fail = (problem: string): void => {
      this.f = { ...this.f, problem };
    };
    switch (d.kind) {
      case 'createUser': {
        const name = this.f.name.trim();
        if (!USER_NAME.test(name)) return fail(t('admin.user.nameBad'));
        if (this.f.email.trim() && !validEmail(this.f.email.trim()))
          return fail(t('admin.user.emailBad'));
        const p = this.newPassword();
        if ('problem' in p) return fail(p.problem);
        void a.createUser({
          name,
          role: this.f.role,
          groups: this.f.groups,
          email: this.f.email,
          password: p.pw,
        });
        this.f = { ...this.f, pw: '', pw2: '' };
        return;
      }
      case 'password': {
        const p = this.newPassword();
        if ('problem' in p) return fail(p.problem);
        if (!this.f.reauth) return fail(t('admin.reauth.empty'));
        void a.resetPassword(d.user, p.pw, this.f.reauth);
        this.f = { ...this.f, pw: '', pw2: '', reauth: '' };
        return;
      }
      case 'deleteUser':
      case 'deleteGroup': {
        if (!this.f.reauth) return fail(t('admin.reauth.empty'));
        if (d.kind === 'deleteUser') void a.deleteUser(d.user, this.f.reauth);
        else void a.deleteGroup(d.id, this.f.reauth);
        this.f = { ...this.f, reauth: '' };
        return;
      }
      case 'reauth': {
        if (!this.f.reauth) return fail(t('admin.reauth.empty'));
        void d.run(this.f.reauth);
        this.f = { ...this.f, reauth: '' };
        return;
      }
      case 'createGroup': {
        const name = this.f.groupName.trim();
        const id = this.f.groupId.trim();
        if (!name || [...name].length > 64) return fail(t('admin.group.nameBad'));
        if (!GROUP_ID.test(id)) return fail(t('admin.group.idBad'));
        void a.createGroup(id, name);
        return;
      }
      case 'createKey': {
        const k = { ...this.f.key, allowFrom: splitAllowFrom(this.f.allowText) };
        k.expiresAt = expiryFromDate(this.f.expires);
        const p = draftProblem(k, Date.now());
        if (p)
          return fail(
            t(`admin.key.bad.${p.field}` as MessageKey, { value: 'value' in p ? p.value : '' }),
          );
        const writes = needsReauth(k);
        if (writes && !this.f.reauth) return fail(t('admin.reauth.empty'));
        void a.createKey(
          {
            name: k.name.trim(),
            role: k.role,
            readOnly: k.readOnly,
            groups: k.groups,
            allowFrom: k.allowFrom,
            expiresAt: k.expiresAt,
            ratePerMin: k.ratePerMin,
          },
          writes ? this.f.reauth : undefined,
        );
        this.f = { ...this.f, reauth: '' };
        return;
      }
      case 'revokeKey':
        void a.revokeKey(d.id);
        return;
      case 'emailTest': {
        const to = this.f.to.trim();
        if (!validEmail(to)) return fail(t('admin.user.emailBad'));
        void a.testEmail(to).then((result) => (this.f = { ...this.f, result }));
        return;
      }
      case 'secret':
        a.closeDialog();
        return;
    }
  }

  private body(d: AdminDialog): {
    title: string;
    ic: 'users' | 'lock' | 'bell' | 'warn' | 'group';
    body: unknown;
    ok: string;
    danger?: boolean;
  } {
    switch (d.kind) {
      case 'createUser':
        return {
          title: t('admin.user.addTitle'),
          ic: 'users',
          ok: t('admin.user.add'),
          body: html`${this.field(
            'ad-name',
            t('admin.user.name'),
            html`<input
              id="ad-name"
              class="input mono"
              name="name"
              autocomplete="off"
              spellcheck="false"
              maxlength="32"
              data-role="name"
              aria-describedby="ad-name-h"
              .value=${this.f.name}
              @input=${(e: Event) => this.set({ name: val(e) })}
            />`,
            t('admin.user.nameHelp'),
          )}
          ${this.field(
            'ad-role',
            t('admin.user.role'),
            html`<select
              id="ad-role"
              class="select"
              data-role="role"
              @change=${(e: Event) => this.set({ role: val(e) as Role })}
            >
              ${ROLES.map(
                (r) =>
                  html`<option value=${r} ?selected=${this.f.role === r}>${ROLE_NAMES[r]}</option>`,
              )}
            </select>`,
          )}
          ${this.groupChecks(this.f.groups, (id, on) =>
            this.set({
              groups: on ? [...this.f.groups, id] : this.f.groups.filter((g) => g !== id),
            }),
          )}
          ${this.field(
            'ad-email',
            t('admin.user.email'),
            html`<input
              id="ad-email"
              class="input"
              type="email"
              autocomplete="off"
              data-role="email"
              .value=${this.f.email}
              @input=${(e: Event) => this.set({ email: val(e) })}
            />`,
            t('admin.user.emailHelp'),
          )}
          ${this.pwFields()}`,
        };
      case 'password':
        return {
          title: t('admin.pw.title', { name: d.user }),
          ic: 'lock',
          ok: t('admin.pw.reset'),
          body: html`<p class="help">${t('admin.pw.resetHelp')}</p>
            ${this.pwFields()} ${this.reauthField()}`,
        };
      case 'deleteUser':
        return {
          title: t('admin.user.deleteTitle', { name: d.user }),
          ic: 'warn',
          ok: t('admin.delete'),
          danger: true,
          body: html`<p>${t('admin.user.deleteBody', { name: d.user })}</p>
            ${this.reauthField()}`,
        };
      case 'deleteGroup':
        return {
          title: t('admin.group.deleteTitle', { id: d.id }),
          ic: 'warn',
          ok: t('admin.delete'),
          danger: true,
          body: html`<p>${t('admin.group.deleteBody')}</p>
            ${this.reauthField()}`,
        };
      case 'reauth':
        return {
          title: t('admin.reauth.title'),
          ic: 'lock',
          ok: t('admin.reauth.confirm'),
          body: html`<p>${d.reason}</p>
            ${this.reauthField()}`,
        };
      case 'createGroup':
        return {
          title: t('admin.group.addTitle'),
          ic: 'group',
          ok: t('admin.group.add'),
          body: html`${this.field(
            'ad-gname',
            t('admin.group.name'),
            html`<input
              id="ad-gname"
              class="input"
              data-role="group-name"
              maxlength="64"
              autocomplete="off"
              .value=${this.f.groupName}
              @input=${(e: Event) => {
                const groupName = val(e);
                this.set(
                  this.f.idTouched ? { groupName } : { groupName, groupId: slugify(groupName) },
                );
              }}
            />`,
          )}
          ${this.field(
            'ad-gid',
            t('admin.group.id'),
            html`<input
              id="ad-gid"
              class="input mono"
              data-role="group-id"
              maxlength="32"
              spellcheck="false"
              autocomplete="off"
              aria-describedby="ad-gid-h"
              .value=${this.f.groupId}
              @input=${(e: Event) => this.set({ groupId: val(e), idTouched: true })}
            />`,
            t('admin.group.idHelp'),
          )}`,
        };
      case 'createKey':
        return {
          title: t('admin.key.addTitle'),
          ic: 'lock',
          ok: t('admin.key.add'),
          body: this.keyForm(),
        };
      case 'revokeKey': {
        const k = this.app.admin?.key(d.id);
        return {
          title: t('admin.key.revokeTitle', { name: k?.name ?? d.id }),
          ic: 'warn',
          ok: t('admin.key.revoke'),
          danger: true,
          body: html`<p>${t('admin.key.revokeBody')}</p>`,
        };
      }
      case 'emailTest':
        return {
          title: t('admin.email.testTitle'),
          ic: 'bell',
          ok: t('admin.email.testSend'),
          body: html`${this.field(
            'ad-to',
            t('admin.email.testTo'),
            html`<input
              id="ad-to"
              class="input"
              type="email"
              data-role="test-to"
              autocomplete="off"
              .value=${this.f.to}
              @input=${(e: Event) => this.set({ to: val(e), result: null })}
            />`,
            t('admin.email.testHelp'),
          )}
          ${
            this.f.result
              ? html`<div
                  class="banner ${this.f.result.ok ? '' : 'err'} ad-result"
                  role="status"
                  data-role="test-result"
                >
                  ${icon(this.f.result.ok ? 'ok' : 'err', this.f.result.ok ? 'ok' : 'err')}
                  <div>${this.f.result.text}</div>
                </div>`
              : nothing
          }`,
        };
      case 'secret':
        return {
          title: d.title,
          ic: 'lock',
          ok: t('admin.secret.done'),
          body: html`<p class="help">${d.note}</p>
            ${this.field(
              'ad-secret',
              d.label,
              html`<div class="ad-secret">
                <input
                  id="ad-secret"
                  class="input mono"
                  readonly
                  data-role="secret"
                  .value=${d.value}
                  @focus=${(e: Event) => (e.target as HTMLInputElement).select()}
                />
                <button
                  class="btn"
                  type="button"
                  data-role="copy"
                  @click=${() => {
                    void navigator.clipboard?.writeText(d.value).catch(() => undefined);
                    this.f = { ...this.f, copied: true };
                  }}
                >
                  ${t(this.f.copied ? 'admin.secret.copied' : 'admin.secret.copy')}
                </button>
              </div>`,
            )}`,
        };
    }
  }

  private keyForm(): TemplateResult {
    const k = this.f.key;
    const setKey = (patch: Partial<ApiKeyDraft>) => this.set({ key: { ...k, ...patch } });
    return html`${this.field(
        'ad-kname',
        t('admin.key.name'),
        html`<input
          id="ad-kname"
          class="input"
          data-role="key-name"
          maxlength="64"
          autocomplete="off"
          .value=${k.name}
          @input=${(e: Event) => setKey({ name: val(e) })}
        />`,
      )}
      ${this.field(
        'ad-krole',
        t('admin.key.role'),
        html`<select
          id="ad-krole"
          class="select"
          data-role="key-role"
          @change=${(e: Event) => setKey({ role: val(e) as 'viewer' | 'operator' })}
        >
          <option value="viewer" ?selected=${k.role === 'viewer'}>${ROLE_NAMES.viewer}</option>
          <option value="operator" ?selected=${k.role === 'operator'}>
            ${ROLE_NAMES.operator}
          </option>
        </select>`,
      )}
      <label class="ad-check"
        ><input
          type="checkbox"
          data-role="key-readonly"
          .checked=${k.readOnly}
          @change=${(e: Event) => setKey({ readOnly: (e.target as HTMLInputElement).checked })}
        />${t('admin.key.readOnly')}</label
      >
      ${this.groupChecks(k.groups, (id, on) =>
        setKey({ groups: on ? [...k.groups, id] : k.groups.filter((g) => g !== id) }),
      )}
      ${this.field(
        'ad-kallow',
        t('admin.key.allowFrom'),
        html`<input
          id="ad-kallow"
          class="input mono"
          data-role="key-allow"
          spellcheck="false"
          autocomplete="off"
          placeholder="192.168.1.0/24"
          .value=${this.f.allowText}
          @input=${(e: Event) => this.set({ allowText: val(e) })}
        />`,
        t('admin.key.allowHelp'),
      )}
      <div class="ad-row2">
        ${this.field(
          'ad-kexp',
          t('admin.key.expires'),
          html`<input
            id="ad-kexp"
            class="input"
            type="date"
            data-role="key-expires"
            .value=${this.f.expires}
            @input=${(e: Event) => this.set({ expires: val(e) })}
          />`,
        )}
        ${this.field(
          'ad-krate',
          t('admin.key.rate'),
          html`<input
            id="ad-krate"
            class="input"
            type="number"
            min="10"
            max="6000"
            data-role="key-rate"
            .value=${String(k.ratePerMin)}
            @input=${(e: Event) => setKey({ ratePerMin: Number(val(e)) })}
          />`,
        )}
      </div>
      ${
        canWrite(k)
          ? html`<div class="banner warn">
                ${icon('warn', 'warn')}
                <div>${t('admin.key.writeWarn')}</div>
              </div>
              ${this.reauthField()}`
          : nothing
      }`;
  }

  protected override render() {
    const d = this.d;
    if (!this.isOpen || !d) return nothing;
    const a = this.app.admin!;
    const p = this.body(d);
    const error = this.f.problem ?? a.dialogError;
    return this.frame({
      title: p.title,
      icon: p.ic,
      busy: a.busy,
      body: html`<form
        class="ad-dlg ${p.danger ? 'danger' : ''}"
        data-dialog=${d.kind}
        @submit=${(e: Event) => this.submit(e)}
      >
        ${p.body}
        ${
          error
            ? html`<p class="err-text" role="alert" data-role="dialog-error">
                ${icon('err', 'err')}${error}
              </p>`
            : nothing
        }
        <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
      </form>`,
      foot: html`${
          d.kind === 'secret'
            ? nothing
            : html`<button class="btn" type="button" @click=${() => this.close()}>
                ${t('admin.cancel')}
              </button>`
        }
        <button
          class="btn primary ${p.danger ? 'danger' : ''}"
          type="button"
          data-role="ok"
          ?disabled=${a.busy}
          @click=${() => this.submit()}
        >
          ${a.busy ? html`<span class="spin" aria-hidden="true"></span>` : nothing}${p.ok}
        </button>`,
    });
  }
}

customElements.define('mat-admin-dialog', MatAdminDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-admin-dialog': MatAdminDialog;
  }
}
