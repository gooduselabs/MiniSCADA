// Inspector của nhóm "Người dùng và quyền" (feature 027): đối tượng đang chọn trong editor quản trị (người dùng, nhóm,
// quyền của một trang hay một item, API key, quy tắc email) sửa ở tab Thuộc tính, áp bằng nút Áp dụng (một yêu cầu tới
// thiết bị, kiểm `rev`). Hạ vai trò, tắt tài khoản, key ghi được: hỏi lại mật khẩu (hộp thoại admin-dialog.ts).
import {
  ROLES,
  ROLE_NAMES,
  canWrite,
  dateFromExpiry,
  draftProblem,
  effectiveCell,
  expiryFromDate,
  fmtTime,
  granteeOptions,
  needsReauth,
  splitAllowFrom,
  splitList,
  validEmail,
  type AccessResource,
  type ApiKeyDraft,
  type EmailEvent,
  type EmailRule,
  type GranteeOption,
  type Level,
  type Role,
} from '@mat/admin-model';
import { html, nothing, type TemplateResult } from 'lit';
import { isAdminPage, type AdminPage } from '../../app/admin-workspace.ts';
import type { StudioApp } from '../../app/app.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { AppElement, icon } from '../base.ts';
import { registerProps, type InspectorView } from '../registry.ts';
import { PAGE_TITLE, granteeSummary } from './admin-editors.ts';

const val = (e: Event) => (e.target as HTMLInputElement).value;
const checked = (e: Event) => (e.target as HTMLInputElement).checked;

/** Một dòng thuộc tính: nhãn trái, điều khiển phải (lưới `.prow` của Inspector). */
const prow = (id: string, label: string, control: unknown) =>
  html`<div class="prow adm-prow">
    <label class="pl" for=${id}>${label}</label>
    <div class="pv">${control}</div>
  </div>`;

abstract class AdminProps extends AppElement {
  static override properties = { key: { attribute: false } };
  declare key: string;
  protected shownKey: string | null = null;
  constructor() {
    super();
    this.key = '';
  }
  /** Đối tượng chọn đổi: nạp lại form từ dữ liệu của thiết bị. */
  protected abstract reset(): void;
  protected override willUpdate(): void {
    if (this.key !== this.shownKey) {
      this.shownKey = this.key;
      this.reset();
    }
  }
  protected get a() {
    return this.app.admin!;
  }
}

// ---------- Người dùng ----------

export class MatAdminUserProps extends AdminProps {
  static override properties = { ...AdminProps.properties, f: { state: true } };
  declare f: { role: Role; groups: string[]; enabled: boolean; email: string };

  protected reset(): void {
    const u = this.a.user(this.key);
    this.f = u
      ? { role: u.role, groups: [...u.groups], enabled: u.enabled, email: u.email ?? '' }
      : { role: 'viewer', groups: [], enabled: true, email: '' };
  }

  protected override render() {
    const a = this.a;
    const u = a.user(this.key);
    if (!u) return nothing;
    const changed =
      this.f.role !== u.role ||
      this.f.enabled !== u.enabled ||
      this.f.email.trim() !== (u.email ?? '') ||
      [...this.f.groups].sort().join() !== [...u.groups].sort().join();
    const emailBad = this.f.email.trim() !== '' && !validEmail(this.f.email.trim());
    const me = u.name === this.app.session.auth?.user;
    const now = Date.now();
    return html`<div class="adm-insp" data-props="user">
      <div class="psec">${icon('users')}${t('admin.insp.account')}</div>
      ${prow(
        'ap-role',
        t('admin.user.role'),
        html`<select
          id="ap-role"
          class="select"
          data-role="insp-role"
          @change=${(e: Event) => (this.f = { ...this.f, role: val(e) as Role })}
        >
          ${ROLES.map((r) => html`<option value=${r} ?selected=${this.f.role === r}>${ROLE_NAMES[r]}</option>`)}
        </select>`,
      )}
      ${prow(
        'ap-enabled',
        t('admin.user.enabledLabel'),
        html`<input
          id="ap-enabled"
          type="checkbox"
          data-role="insp-enabled"
          .checked=${this.f.enabled}
          @change=${(e: Event) => (this.f = { ...this.f, enabled: checked(e) })}
        />`,
      )}
      ${prow(
        'ap-email',
        t('admin.user.email'),
        html`<input
          id="ap-email"
          class="input ${emailBad ? 'bad' : ''}"
          type="email"
          data-role="insp-email"
          aria-invalid=${emailBad ? 'true' : 'false'}
          .value=${this.f.email}
          @input=${(e: Event) => (this.f = { ...this.f, email: val(e) })}
        />`,
      )}
      <div class="psec">${icon('group')}${t('admin.user.groups')}</div>
      <div class="adm-checks" role="group" aria-label=${t('admin.user.groups')}>
        ${
          a.groups.length
            ? a.groups.map(
                (g) =>
                  html`<label
                    ><input
                      type="checkbox"
                      data-group=${g.id}
                      .checked=${this.f.groups.includes(g.id)}
                      @change=${(e: Event) =>
                        (this.f = {
                          ...this.f,
                          groups: checked(e)
                            ? [...this.f.groups, g.id]
                            : this.f.groups.filter((x) => x !== g.id),
                        })}
                    />${g.name}</label
                  >`,
              )
            : html`<span class="help">${t('admin.user.noGroups')}</span>`
        }
      </div>
      ${
        me && (this.f.role !== u.role || !this.f.enabled)
          ? html`<p class="help warn-text">${icon('warn', 'warn')}${t('admin.user.selfWarn')}</p>`
          : nothing
      }
      <div class="adm-actions">
        <button
          class="btn primary"
          type="button"
          data-role="insp-apply"
          ?disabled=${!changed || emailBad || a.busy}
          @click=${() => void a.updateUser(u.name, this.f)}
        >
          ${t('admin.apply')}
        </button>
        <button class="btn" type="button" ?disabled=${!changed} @click=${() => this.reset()}>
          ${t('admin.revert')}
        </button>
      </div>
      <div class="psec">${icon('info')}${t('admin.insp.state')}</div>
      <dl class="kvs adm-kvs">
        <dt>${t('admin.col.lastLogin')}</dt>
        <dd>${u.lastLoginAt ? fmtTime(u.lastLoginAt) : t('admin.user.never')}</dd>
        <dt>${t('admin.user.sessions')}</dt>
        <dd>${u.sessions}</dd>
        <dt>${t('admin.user.created')}</dt>
        <dd>${u.createdAt ? fmtTime(u.createdAt) : t('admin.none')}</dd>
        <dt>${t('admin.user.lockedState')}</dt>
        <dd>
          ${
            u.locked && u.locked.until > now
              ? html`${t('admin.user.lockedUntil', { time: fmtTime(u.locked.until) })}
                  <button
                    class="btn"
                    type="button"
                    data-role="insp-unlock"
                    @click=${() => void a.unlockUser(u.name)}
                  >
                    ${icon('unlock')}${t('admin.user.unlock')}
                  </button>`
              : t('admin.user.notLocked')
          }
        </dd>
      </dl>
      <div class="adm-actions">
        <button
          class="btn"
          type="button"
          data-role="insp-password"
          @click=${() => a.openDialog({ kind: 'password', user: u.name })}
        >
          ${icon('lock')}${t('admin.pw.resetBtn')}
        </button>
        <button
          class="btn adm-danger"
          type="button"
          data-role="insp-delete"
          ?disabled=${me}
          title=${me ? t('admin.user.selfDelete') : ''}
          @click=${() => a.openDialog({ kind: 'deleteUser', user: u.name })}
        >
          ${icon('trash')}${t('admin.user.delete')}
        </button>
      </div>
    </div>`;
  }
}
customElements.define('mat-admin-user-props', MatAdminUserProps);

// ---------- Nhóm ----------

export class MatAdminGroupProps extends AdminProps {
  static override properties = { ...AdminProps.properties, name: { state: true } };
  declare name: string;
  protected reset(): void {
    this.name = this.a.group(this.key)?.name ?? '';
  }
  protected override render() {
    const a = this.a;
    const g = a.group(this.key);
    if (!g) return nothing;
    const bad = !this.name.trim() || [...this.name.trim()].length > 64;
    return html`<div class="adm-insp" data-props="group">
      ${prow(
        'ap-gname',
        t('admin.group.name'),
        html`<input
          id="ap-gname"
          class="input"
          data-role="insp-group-name"
          maxlength="64"
          .value=${this.name}
          @input=${(e: Event) => (this.name = val(e))}
        />`,
      )}
      <div class="adm-actions">
        <button
          class="btn primary"
          type="button"
          data-role="insp-rename"
          ?disabled=${bad || this.name.trim() === g.name || a.busy}
          @click=${() => void a.renameGroup(g.id, this.name.trim())}
        >
          ${t('admin.group.rename')}
        </button>
      </div>
      <div class="psec">
        ${icon('users')}${t('admin.group.members')}<span class="cnt">${g.members.length}</span>
      </div>
      <p class="help pad">${t('admin.group.membersHelp')}</p>
      <div class="adm-checks" role="group" aria-label=${t('admin.group.members')}>
        ${a.users.map(
          (u) =>
            html`<label
              ><input
                type="checkbox"
                data-member=${u.name}
                .checked=${u.groups.includes(g.id)}
                ?disabled=${a.busy}
                @change=${(e: Event) => void a.setMember(u.name, g.id, checked(e))}
              />${u.name} <span class="muted">${ROLE_NAMES[u.role]}</span></label
            >`,
        )}
      </div>
      <div class="psec">
        ${icon('shield')}${t('admin.col.rules')}<span class="cnt">${g.rules}</span>
      </div>
      <div class="adm-actions">
        <button
          class="btn adm-danger"
          type="button"
          data-role="insp-group-delete"
          @click=${() => a.openDialog({ kind: 'deleteGroup', id: g.id })}
        >
          ${icon('trash')}${t('admin.group.delete')}
        </button>
      </div>
    </div>`;
  }
}
customElements.define('mat-admin-group-props', MatAdminGroupProps);

// ---------- Quyền của một tài nguyên (trang hoặc item) ----------

const CATS: ReadonlyArray<[GranteeOption['cat'], string]> = [
  ['all', 'admin.cat.all'],
  ['role', 'admin.cat.roles'],
  ['group', 'admin.cat.groups'],
  ['user', 'admin.cat.users'],
];

export class MatAdminRuleProps extends AdminProps {
  protected reset(): void {}

  private level(r: AccessResource, level: Level): TemplateResult {
    const a = this.a;
    const st = a.draft.get(r.id, level);
    const cur = st.grantees ?? null;
    const opts = granteeOptions(
      a.groups,
      a.users.filter((u) => u.role !== 'administrator'),
    );
    const s = granteeSummary(this.app, r, level);
    return html`<div class="psec">
        ${icon(level === 'view' ? 'eye' : 'pointer')}${t(level === 'view' ? 'admin.col.view' : 'admin.col.operate')}
        ${s.dirty ? html`<span class="chip warn">${t('admin.rule.unsaved')}</span>` : nothing}
      </div>
      <p class="help pad" data-role="rule-state" data-level=${level}>
        ${cur === null ? s.text : t('admin.rule.custom', { list: s.text })}
      </p>
      ${CATS.map(([cat, label]) => {
        const list = opts.filter((o) => o.cat === cat);
        if (!list.length) return nothing;
        return html`<div
          class="adm-chips"
          role="group"
          aria-label=${`${t(label as MessageKey)} · ${level}`}
        >
          <span class="adm-chips-l">${t(label as MessageKey)}</span>
          ${list.map((o) => {
            const on = (cur ?? []).includes(o.id);
            return html`<button
              type="button"
              class="adm-chip hue-${o.hue} ${on ? 'on' : ''}"
              aria-pressed=${String(on)}
              data-grantee=${o.id}
              data-level=${level}
              title=${o.label}
              @click=${() => a.toggleGrantee(r.id, level, o.id)}
            >
              ${on ? icon('check') : nothing}${o.short}
            </button>`;
          })}
        </div>`;
      })}
      <div class="adm-actions">
        <button
          class="btn"
          type="button"
          data-role="rule-default"
          data-level=${level}
          ?disabled=${cur === null}
          @click=${() => a.resetRule(r.id, level)}
        >
          ${icon('restore')}${t('admin.rule.toDefault')}
        </button>
      </div>`;
  }

  /** Bảng ai thấy, ai thao tác item (theo quyền hiệu lực máy chủ tính với quy tắc đã lưu). */
  private who(r: AccessResource): TemplateResult | typeof nothing {
    if (r.kind !== 'item' || !r.screen) return nothing;
    const a = this.a;
    a.loadEffective();
    const eff = a.effective;
    const item = r.id.slice(r.id.indexOf('/') + 1);
    const operable = r.levels.includes('operate');
    return html`<div class="psec">${icon('users')}${t('admin.comp.who')}</div>
      ${
        !eff
          ? html`<p class="help pad">${t('admin.loading')}</p>`
          : html`<table
                class="grid dense adm-who"
                aria-label=${t('admin.comp.who')}
                data-table="who"
              >
                <thead>
                  <tr>
                    <th scope="col">${t('admin.col.name')}</th>
                    <th scope="col">${t('admin.comp.sees')}</th>
                    ${operable ? html`<th scope="col">${t('admin.comp.operates')}</th>` : nothing}
                  </tr>
                </thead>
                <tbody>
                  ${a.users.map((u) => {
                    const e = eff.get(u.name);
                    if (!e) return nothing;
                    const c = effectiveCell(e, r.screen!, item, operable);
                    const mark = (v: boolean) =>
                      v
                        ? html`<span class="chip ok">${icon('check')}${t('admin.yes')}</span>`
                        : html`<span class="chip">${t('admin.no')}</span>`;
                    return html`<tr data-who=${u.name}>
                      <td>${u.name}</td>
                      <td>${mark(c.sees)}</td>
                      ${operable ? html`<td>${mark(c.operates === true)}</td>` : nothing}
                    </tr>`;
                  })}
                </tbody>
              </table>
              <p class="help pad">${t('admin.comp.whoHelp')}</p>`
      }`;
  }

  protected override render() {
    const r = this.a.access?.resources.find((x) => x.id === this.key);
    if (!r) {
      // Item của project đang mở chưa có trên thiết bị (project khác hoặc chưa nạp xuống).
      return html`<p class="help pad" data-props="rule-missing">${t('admin.comp.missing')}</p>`;
    }
    return html`<div class="adm-insp" data-props="rule" data-resource=${r.id}>
      <dl class="kvs adm-kvs">
        <dt>${t('admin.col.resource')}</dt>
        <dd class="mono">${r.id}</dd>
        <dt>${t('admin.col.kind')}</dt>
        <dd>${t(`admin.kind.${r.kind}` as MessageKey)}</dd>
      </dl>
      ${r.levels.map((l) => this.level(r, l))} ${this.who(r)}
      <p class="help pad">${t('admin.rule.saveHint')}</p>
    </div>`;
  }
}
customElements.define('mat-admin-rule-props', MatAdminRuleProps);

// ---------- API key ----------

export class MatAdminKeyProps extends AdminProps {
  static override properties = {
    ...AdminProps.properties,
    f: { state: true },
    problem: { state: true },
  };
  declare f: ApiKeyDraft & { allowText: string; expires: string };
  declare problem: string | null;

  protected reset(): void {
    const k = this.a.key(this.key);
    this.problem = null;
    this.f = {
      name: k?.name ?? '',
      role: k?.role ?? 'viewer',
      readOnly: k?.readOnly ?? true,
      groups: [...(k?.groups ?? [])],
      allowFrom: [...(k?.allowFrom ?? [])],
      expiresAt: k?.expiresAt ?? null,
      ratePerMin: k?.ratePerMin ?? 600,
      allowText: (k?.allowFrom ?? []).join(', '),
      expires: dateFromExpiry(k?.expiresAt ?? null),
    };
  }

  private apply(): void {
    const a = this.a;
    const k = a.key(this.key);
    if (!k) return;
    const d: ApiKeyDraft = {
      ...this.f,
      allowFrom: splitAllowFrom(this.f.allowText),
      expiresAt: expiryFromDate(this.f.expires),
    };
    // Ngày hạn không đổi thì không kiểm "ở tương lai" (key đã hết hạn vẫn sửa được tên).
    const p = draftProblem(d.expiresAt === k.expiresAt ? { ...d, expiresAt: null } : d, Date.now());
    if (p) {
      this.problem = t(`admin.key.bad.${p.field}` as MessageKey, {
        value: 'value' in p ? p.value : '',
      });
      return;
    }
    this.problem = null;
    const reauth = needsReauth(d, k) ? t('admin.reauth.key', { name: d.name }) : null;
    void a.updateKey(
      k.id,
      {
        name: d.name.trim(),
        role: d.role,
        readOnly: d.readOnly,
        groups: d.groups,
        allowFrom: d.allowFrom,
        expiresAt: d.expiresAt,
        ratePerMin: d.ratePerMin,
      },
      reauth,
    );
  }

  protected override render() {
    const a = this.a;
    const k = a.key(this.key);
    if (!k) return nothing;
    const set = (patch: Partial<MatAdminKeyProps['f']>) => (this.f = { ...this.f, ...patch });
    return html`<div class="adm-insp" data-props="key">
      ${prow(
        'ak-name',
        t('admin.key.name'),
        html`<input
          id="ak-name"
          class="input"
          maxlength="64"
          .value=${this.f.name}
          @input=${(e: Event) => set({ name: val(e) })}
        />`,
      )}
      ${prow(
        'ak-role',
        t('admin.key.role'),
        html`<select
          id="ak-role"
          class="select"
          @change=${(e: Event) => set({ role: val(e) as 'viewer' | 'operator' })}
        >
          <option value="viewer" ?selected=${this.f.role === 'viewer'}>${ROLE_NAMES.viewer}</option>
          <option value="operator" ?selected=${this.f.role === 'operator'}>
            ${ROLE_NAMES.operator}
          </option>
        </select>`,
      )}
      ${prow(
        'ak-ro',
        t('admin.key.readOnly'),
        html`<input
          id="ak-ro"
          type="checkbox"
          .checked=${this.f.readOnly}
          @change=${(e: Event) => set({ readOnly: checked(e) })}
        />`,
      )}
      ${prow(
        'ak-allow',
        t('admin.key.allowFrom'),
        html`<input
          id="ak-allow"
          class="input mono"
          .value=${this.f.allowText}
          @input=${(e: Event) => set({ allowText: val(e) })}
        />`,
      )}
      ${prow(
        'ak-exp',
        t('admin.key.expires'),
        html`<input
          id="ak-exp"
          class="input"
          type="date"
          .value=${this.f.expires}
          @input=${(e: Event) => set({ expires: val(e) })}
        />`,
      )}
      ${prow(
        'ak-rate',
        t('admin.key.rate'),
        html`<input
          id="ak-rate"
          class="input"
          type="number"
          min="10"
          max="6000"
          .value=${String(this.f.ratePerMin)}
          @input=${(e: Event) => set({ ratePerMin: Number(val(e)) })}
        />`,
      )}
      <div class="psec">${icon('group')}${t('admin.user.groups')}</div>
      <div class="adm-checks" role="group" aria-label=${t('admin.user.groups')}>
        ${a.groups.map(
          (g) =>
            html`<label
              ><input
                type="checkbox"
                .checked=${this.f.groups.includes(g.id)}
                @change=${(e: Event) =>
                  set({
                    groups: checked(e)
                      ? [...this.f.groups, g.id]
                      : this.f.groups.filter((x) => x !== g.id),
                  })}
              />${g.name}</label
            >`,
        )}
      </div>
      ${canWrite(this.f) ? html`<p class="help warn-text">${icon('warn', 'warn')}${t('admin.key.writeWarn')}</p>` : nothing}
      ${this.problem ? html`<p class="err-text pad" role="alert">${this.problem}</p>` : nothing}
      <div class="adm-actions">
        <button
          class="btn primary"
          type="button"
          data-role="insp-key-apply"
          ?disabled=${a.busy}
          @click=${() => this.apply()}
        >
          ${t('admin.apply')}
        </button>
        <button class="btn" type="button" @click=${() => this.reset()}>${t('admin.revert')}</button>
      </div>
      <div class="psec">${icon('info')}${t('admin.insp.state')}</div>
      <dl class="kvs adm-kvs">
        <dt>${t('admin.col.prefix')}</dt>
        <dd class="mono">${k.prefix}…</dd>
        <dt>${t('admin.key.createdBy')}</dt>
        <dd>${k.createdBy} · ${k.createdAt.slice(0, 10)}</dd>
        <dt>${t('admin.col.lastUsed')}</dt>
        <dd>
          ${k.lastUsedAt ? `${fmtTime(Date.parse(k.lastUsedAt))} · ${k.lastFrom ?? ''}` : t('admin.key.unused')}
        </dd>
        <dt>${t('admin.col.calls')}</dt>
        <dd>${k.calls} / ${k.denied}</dd>
      </dl>
      <div class="adm-actions">
        <button
          class="btn adm-danger"
          type="button"
          data-role="insp-key-revoke"
          @click=${() => a.openDialog({ kind: 'revokeKey', id: k.id })}
        >
          ${icon('ban')}${t('admin.key.revoke')}
        </button>
      </div>
    </div>`;
  }
}
customElements.define('mat-admin-key-props', MatAdminKeyProps);

// ---------- Quy tắc email ----------

const EVENTS: readonly EmailEvent[] = ['active', 'return', 'reminder'];

export class MatAdminEmailRuleProps extends AdminProps {
  protected reset(): void {}
  private edit(fn: (r: EmailRule) => void): void {
    this.a.editEmail((c) => {
      const r = c.rules.find((x) => x.id === this.key);
      if (r) fn(r);
      return c;
    });
  }
  protected override render() {
    const a = this.a;
    const r = a.emailConfig?.rules.find((x) => x.id === this.key);
    if (!r) return nothing;
    const bad = r.to.filter((x) => !validEmail(x));
    return html`<div class="adm-insp" data-props="email-rule">
      ${prow(
        'ar-name',
        t('admin.col.ruleName'),
        html`<input
          id="ar-name"
          class="input"
          data-role="rule-name"
          .value=${r.name}
          @input=${(e: Event) => this.edit((x) => (x.name = val(e)))}
        />`,
      )}
      ${prow(
        'ar-on',
        t('admin.user.enabledLabel'),
        html`<input
          id="ar-on"
          type="checkbox"
          .checked=${r.enabled}
          @change=${(e: Event) => this.edit((x) => (x.enabled = checked(e)))}
        />`,
      )}
      ${prow(
        'ar-pri',
        t('admin.col.priorities'),
        html`<input
          id="ar-pri"
          class="input mono"
          .value=${r.priorities.join(', ')}
          @change=${(e: Event) =>
            this.edit(
              (x) =>
                (x.priorities = splitList(val(e))
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n > 0)),
            )}
        />`,
      )}
      ${prow(
        'ar-to',
        t('admin.col.to'),
        html`<input
          id="ar-to"
          class="input ${bad.length ? 'bad' : ''}"
          data-role="rule-to"
          aria-invalid=${bad.length ? 'true' : 'false'}
          .value=${r.to.join(', ')}
          @change=${(e: Event) => this.edit((x) => (x.to = splitList(val(e))))}
        />`,
      )}
      ${bad.length ? html`<p class="err-text pad">${t('admin.email.badAddress', { list: bad.join(', ') })}</p>` : nothing}
      <div class="psec">${t('admin.col.events')}</div>
      <div class="adm-checks" role="group" aria-label=${t('admin.col.events')}>
        ${EVENTS.map(
          (ev) =>
            html`<label
              ><input
                type="checkbox"
                .checked=${r.events.includes(ev)}
                @change=${(e: Event) =>
                  this.edit(
                    (x) =>
                      (x.events = checked(e)
                        ? [...x.events, ev]
                        : x.events.filter((y) => y !== ev)),
                  )}
              />${t(`admin.email.ev.${ev}` as MessageKey)}</label
            >`,
        )}
      </div>
      <div class="psec">${icon('group')}${t('admin.email.ruleGroups')}</div>
      <div class="adm-checks" role="group" aria-label=${t('admin.email.ruleGroups')}>
        ${(a.email?.groups ?? []).map(
          (g) =>
            html`<label
              ><input
                type="checkbox"
                .checked=${r.groups.includes(g.id)}
                @change=${(e: Event) =>
                  this.edit(
                    (x) =>
                      (x.groups = checked(e)
                        ? [...x.groups, g.id]
                        : x.groups.filter((y) => y !== g.id)),
                  )}
              />${g.name}
              <span class="muted"
                >${t('admin.email.withEmail', { n: g.withEmail, all: g.members })}</span
              ></label
            >`,
        )}
      </div>
      <div class="adm-actions">
        <button
          class="btn adm-danger"
          type="button"
          @click=${() => {
            a.editEmail((c) => ({ ...c, rules: c.rules.filter((x) => x.id !== r.id) }));
            a.select('email', null);
          }}
        >
          ${icon('trash')}${t('admin.email.ruleDelete')}
        </button>
      </div>
      <p class="help pad">${t('admin.email.ruleHint')}</p>
    </div>`;
  }
}
customElements.define('mat-admin-email-rule-props', MatAdminEmailRuleProps);

registerProps((app: StudioApp) => {
  const id = app.store.state.active;
  if (!id?.startsWith('admin:') || !isAdminPage(id.slice(6))) return null;
  const a = app.admin;
  if (!a || a.gate !== 'ready' || a.status === 'idle') return null;
  const page = id.slice(6) as AdminPage;
  return (
    selectedView(app, page) ?? {
      ctx: t(PAGE_TITLE[page]),
      body:
        page === 'viewAs'
          ? viewAsSummary(app)
          : html`<p class="help pad" data-props="none">
              ${t(page === 'components' ? 'admin.insp.pickItem' : 'admin.insp.pick')}
            </p>`,
    }
  );
});

/** Quyền hiệu lực của người đang "xem với tư cách" (máy chủ tính). */
function viewAsSummary(app: StudioApp): TemplateResult {
  const a = app.admin!;
  const acc = a.viewAs.access;
  if (!acc) return html`<p class="help pad" data-props="none">${t('admin.viewAs.help')}</p>`;
  const hidden = Object.values(acc.hiddenItems).reduce((n, l) => n + l.length, 0);
  const locked = Object.values(acc.lockedItems).reduce((n, l) => n + l.length, 0);
  return html`<div class="adm-insp">
    <dl class="kvs adm-kvs" data-props="view-as">
      <dt>${t('admin.col.role')}</dt>
      <dd>${ROLE_NAMES[acc.role] ?? acc.role}</dd>
      <dt>${t('admin.col.groups')}</dt>
      <dd>${acc.groups.map((g) => a.group(g)?.name ?? g).join(', ') || t('admin.none')}</dd>
      <dt>${t('admin.insp.screens')}</dt>
      <dd>${acc.screens.length}</dd>
      <dt>${t('admin.insp.pages')}</dt>
      <dd>${acc.pages.join(', ') || t('admin.none')}</dd>
      <dt>${t('admin.insp.hidden')}</dt>
      <dd>${hidden}</dd>
      <dt>${t('admin.insp.locked')}</dt>
      <dd>${locked}</dd>
    </dl>
  </div>`;
}

function selectedView(app: StudioApp, page: AdminPage): InspectorView | null {
  const a = app.admin!;
  const s = a.selection;
  switch (page) {
    case 'users':
      return s.users && a.user(s.users)
        ? {
            ctx: t('admin.insp.userCtx', { name: s.users }),
            body: html`<mat-admin-user-props .app=${app} .key=${s.users}></mat-admin-user-props>`,
          }
        : null;
    case 'groups':
      return s.groups && a.group(s.groups)
        ? {
            ctx: t('admin.insp.groupCtx', { name: a.group(s.groups)!.name }),
            body: html`<mat-admin-group-props
              .app=${app}
              .key=${s.groups}
            ></mat-admin-group-props>`,
          }
        : null;
    case 'pages':
      return s.pages
        ? {
            ctx: t('admin.insp.ruleCtx', {
              name: a.access?.resources.find((r) => r.id === s.pages)?.title ?? s.pages,
            }),
            body: html`<mat-admin-rule-props .app=${app} .key=${s.pages}></mat-admin-rule-props>`,
          }
        : null;
    case 'components': {
      const c = s.components;
      if (!c.screen || !c.item) return null;
      const rid = `item:${c.screen}/${c.item}`;
      return {
        ctx: t('admin.insp.ruleCtx', {
          name: a.access?.resources.find((r) => r.id === rid)?.title ?? c.item,
        }),
        body: html`<mat-admin-rule-props .app=${app} .key=${rid}></mat-admin-rule-props>`,
      };
    }
    case 'apikeys':
      return s.apikeys && a.key(s.apikeys)
        ? {
            ctx: t('admin.insp.keyCtx', { name: a.key(s.apikeys)!.name }),
            body: html`<mat-admin-key-props .app=${app} .key=${s.apikeys}></mat-admin-key-props>`,
          }
        : null;
    case 'email':
      return s.email
        ? {
            ctx: t('admin.insp.emailRuleCtx', { id: s.email }),
            body: html`<mat-admin-email-rule-props
              .app=${app}
              .key=${s.email}
            ></mat-admin-email-rule-props>`,
          }
        : null;
    default:
      return null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mat-admin-user-props': MatAdminUserProps;
    'mat-admin-group-props': MatAdminGroupProps;
    'mat-admin-rule-props': MatAdminRuleProps;
    'mat-admin-key-props': MatAdminKeyProps;
    'mat-admin-email-rule-props': MatAdminEmailRuleProps;
  }
}
