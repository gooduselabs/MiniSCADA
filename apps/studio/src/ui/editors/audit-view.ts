// Editor Audit (feature 005, US4-2, FR-032; device-api §7): administrator xem audit của thiết bị, mới nhất trước, lọc theo
// thời gian, tài khoản, hành động, tải trang tiếp; tài khoản khác thấy "không đủ quyền" và không gọi thiết bị. Dữ liệu do
// `app.audit` giữ (không mất khi đổi tab); thiết bị ghi `audit.read` mỗi lần gọi. Không có mật khẩu, token hay hash
// trong bản ghi.
import { html, nothing } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { sessionActive } from '../../app/app.ts';
import { writeCodeText } from '../../app/code-text.ts';
import { deviceErrorText } from '../../app/device-errors.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { AuditFilter, AuditRecord } from '../../model/audit-feed.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './audit-view.css';

const ACTIONS: ReadonlyArray<[string, MessageKey]> = [
  ['auth.', 'audit.action.auth.'],
  ['access.', 'audit.action.access.'],
  ['project.', 'audit.action.project.'],
  ['audit.', 'audit.action.audit.'],
  ['cert.', 'audit.action.cert.'],
  ['account.', 'audit.action.account.'],
  ['tag.', 'audit.action.tag.'],
  ['driver.', 'audit.action.driver.'],
];

const RESULT_TEXT: Readonly<Record<string, MessageKey>> = {
  ok: 'audit.result.ok',
  failed: 'audit.result.failed',
  denied: 'audit.result.denied',
  started: 'audit.result.started',
  'rolled-back': 'audit.result.rolled-back',
  interrupted: 'audit.result.interrupted',
};
const RESULT_CLASS: Readonly<Record<string, string>> = {
  ok: 'ok',
  failed: 'err',
  denied: 'err',
  started: 'info',
  'rolled-back': 'warn',
  interrupted: 'warn',
};

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

/** "2026-10-09T08:00" (giờ máy này) → ms; sai dạng thì `undefined`. */
function localMs(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** ms → "YYYY-MM-DDTHH:mm" theo giờ máy này (ô datetime-local). */
function localInput(ms: number | undefined): string {
  if (ms === undefined) return '';
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

const time = (ms: number): string => new Date(ms).toLocaleString('vi-VN');

export class MatAuditView extends AppElement {
  private fromText = '';
  private toText = '';
  private userText = '';
  private actionText = '';
  private targetText = '';
  private seeded = false;

  private get online(): boolean {
    const s = this.app.session;
    return s.mode === 'online' && s.auth !== null && sessionActive(s.state);
  }

  private get admin(): boolean {
    return this.app.session.auth?.role === 'administrator';
  }

  /** Lần đầu có thể xem: nạp bộ lọc đang giữ vào ô nhập, rồi tải trang đầu. */
  protected override updated(): void {
    const feed = this.app.audit;
    if (!feed || !this.online || !this.admin) return;
    if (!this.seeded) {
      this.seeded = true;
      const f = feed.state.filter;
      this.fromText = localInput(f.from);
      this.toText = localInput(f.to);
      this.userText = f.user ?? '';
      this.actionText = f.action ?? '';
      this.targetText = f.target ?? '';
    }
    if (feed.state.status === 'idle') void feed.load(feed.state.filter);
  }

  private filter(): AuditFilter {
    const f: AuditFilter = {};
    const from = localMs(this.fromText);
    const to = localMs(this.toText);
    if (from !== undefined) f.from = from;
    if (to !== undefined) f.to = to;
    if (this.userText.trim()) f.user = this.userText.trim();
    if (this.actionText) f.action = this.actionText;
    if (this.targetText.trim()) f.target = this.targetText.trim();
    return f;
  }

  private apply(): void {
    void this.app.audit?.load(this.filter());
  }

  private clear(): void {
    this.fromText = this.toText = this.userText = this.actionText = this.targetText = '';
    this.requestUpdate();
    void this.app.audit?.load({});
  }

  private header() {
    const feed = this.app.audit;
    const device = this.app.session.device?.name ?? '';
    const st = feed?.state;
    return html`<div class="ed-head">
      <h2>${this.online ? t('audit.title', { device }) : t('audit.titleNoDevice')}</h2>
      ${
        st && st.status === 'ready'
          ? html`<span class="au-meta" data-role="count"
              >${t(st.next === null ? 'audit.count' : 'audit.countMore', { n: st.rows.length })}</span
            >`
          : nothing
      }
      <span class="grow"></span>
    </div>`;
  }

  private filters() {
    const busy = this.app.audit?.state.status === 'loading';
    return html`<form
      class="au-filters"
      role="search"
      aria-label=${t('audit.filter')}
      @submit=${(e: Event) => {
        e.preventDefault();
        this.apply();
      }}
    >
      <label class="au-field"
        >${t('audit.filter.from')}
        <input
          class="input"
          type="datetime-local"
          data-role="filter-from"
          .value=${this.fromText}
          @input=${(e: Event) => (this.fromText = (e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="au-field"
        >${t('audit.filter.to')}
        <input
          class="input"
          type="datetime-local"
          data-role="filter-to"
          .value=${this.toText}
          @input=${(e: Event) => (this.toText = (e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="au-field"
        >${t('audit.filter.user')}
        <input
          class="input user"
          type="text"
          maxlength="64"
          data-role="filter-user"
          placeholder=${t('audit.filter.userHint')}
          autocomplete="off"
          .value=${this.userText}
          @input=${(e: Event) => (this.userText = (e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="au-field"
        >${t('audit.filter.action')}
        <select
          class="select"
          data-role="filter-action"
          @change=${(e: Event) => (this.actionText = (e.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${this.actionText === ''}>
            ${t('audit.filter.actionAll')}
          </option>
          ${ACTIONS.map(
            ([prefix, label]) =>
              html`<option value=${prefix} ?selected=${this.actionText === prefix}>
                ${t(label)}
              </option>`,
          )}
        </select>
      </label>
      <label class="au-field"
        >${t('audit.filter.target')}
        <input
          class="input user mono"
          type="text"
          maxlength="64"
          list="au-tags"
          data-role="filter-target"
          placeholder=${t('audit.filter.targetHint')}
          autocomplete="off"
          spellcheck="false"
          .value=${this.targetText}
          @input=${(e: Event) => (this.targetText = (e.target as HTMLInputElement).value)}
        />
        <datalist id="au-tags">
          ${this.tagIds().map((id) => html`<option value=${id}></option>`)}
        </datalist>
      </label>
      <button class="btn primary" type="submit" data-role="apply" ?disabled=${busy}>
        ${icon('search')}${t('audit.filter.apply')}
      </button>
      <button class="btn" type="button" data-role="clear" @click=${() => this.clear()}>
        ${t('audit.filter.clear')}
      </button>
      <span class="grow"></span>
      <button
        class="btn"
        type="button"
        data-role="refresh"
        @click=${() => void this.app.audit?.load()}
      >
        ${icon('refresh')}${t('audit.filter.refresh')}
      </button>
    </form>`;
  }

  /** Tên Tag của project đang mở (gợi ý cho ô lọc theo Tag). */
  private tagIds(): string[] {
    const tags = (this.app.store.state.outline.tags?.tags ?? []) as unknown as Array<{
      id?: unknown;
    }>;
    return tags.map((x) => (typeof x.id === 'string' ? x.id : '')).filter(Boolean);
  }

  /** Chi tiết của lệnh ghi Tag (FR-039): kênh, thiết bị trường, giá trị cũ và mới, đọc lại, exception. */
  private writeDetail(r: AuditRecord) {
    const d = r.detail ?? {};
    const show = (v: unknown): string =>
      v === null || v === undefined
        ? t('audit.none')
        : typeof v === 'boolean'
          ? v
            ? 'TRUE'
            : 'FALSE'
          : String(v);
    const parts: string[] = [];
    if (d.channel !== undefined) parts.push(t('audit.write.channel', { id: show(d.channel) }));
    if (d.device !== undefined) parts.push(t('audit.write.device', { id: show(d.device) }));
    if ('old' in d || 'new' in d)
      parts.push(t('audit.write.change', { old: show(d.old), new: show(d.new) }));
    if (d.readback !== undefined)
      parts.push(t('audit.write.readback', { value: show(d.readback) }));
    if (d.exception && typeof d.exception === 'object') {
      const e = d.exception as { code?: unknown; meaning?: unknown };
      parts.push(t('audit.write.exception', { code: show(e.code), meaning: show(e.meaning) }));
    }
    return html`<span data-role="write-detail">${parts.join(' · ') || t('audit.none')}</span>`;
  }

  private row(r: AuditRecord) {
    const result = own(RESULT_TEXT, r.result);
    const isWrite = r.action === 'tag.write';
    const detail = r.detail ? JSON.stringify(r.detail) : '';
    return html`<tr
      data-id=${r.id}
      data-user=${r.user ?? ''}
      data-action=${r.action}
      data-clock=${r.clockOk ? 'ok' : 'unsynced'}
      tabindex="0"
    >
      <td>
        ${time(r.ts)}${
          r.clockOk
            ? nothing
            : html`<span class="chip warn au-flag" title=${t('audit.unsyncedTip')}
                >${icon('warn', 'warn')}${t('audit.unsynced')}</span
              >`
        }
      </td>
      <td>${r.user ?? t('audit.none')}</td>
      <td>${r.role ?? t('audit.none')}</td>
      <td class="mono">${r.source}</td>
      <td class="mono">${r.action}</td>
      <td class="mono" title=${r.target ?? ''}>${r.target ?? t('audit.none')}</td>
      <td>
        <span class="chip ${own(RESULT_CLASS, r.result) ?? ''}"
          >${result ? t(result) : r.result}</span
        >
      </td>
      <td class="code">
        ${r.code ? html`<span class="mono">${r.code}</span>${isWrite ? html` · ${writeCodeText(r.code)}` : nothing}` : t('audit.none')}
      </td>
      <td class="num">${r.count}</td>
      <td class="detail" title=${detail}>
        ${isWrite ? this.writeDetail(r) : detail || t('audit.none')}
      </td>
    </tr>`;
  }

  private table() {
    const feed = this.app.audit!;
    const st = feed.state;
    if (st.status === 'ready' && st.rows.length === 0)
      return html`<p class="help au-note" data-role="empty">${t('audit.empty')}</p>`;
    return html`<table
      class="grid dense au-grid"
      role="grid"
      aria-readonly="true"
      data-table="audit"
      aria-label=${t('audit.table')}
    >
      <thead>
        <tr>
          <th scope="col">${t('audit.col.time')}</th>
          <th scope="col">${t('audit.col.user')}</th>
          <th scope="col">${t('audit.col.role')}</th>
          <th scope="col">${t('audit.col.source')}</th>
          <th scope="col">${t('audit.col.action')}</th>
          <th scope="col">${t('audit.col.target')}</th>
          <th scope="col">${t('audit.col.result')}</th>
          <th scope="col">${t('audit.col.code')}</th>
          <th scope="col">${t('audit.col.count')}</th>
          <th scope="col">${t('audit.col.detail')}</th>
        </tr>
      </thead>
      <tbody>
        ${st.rows.map((r) => this.row(r))}
      </tbody>
    </table>`;
  }

  protected override render() {
    const app = this.app;
    const feed = app.audit;
    if (!feed || !this.online)
      return html`<div class="ed ed-fill">
        ${this.header()}
        <div class="empty au-note" data-role="offline">
          ${icon('list', 'lg')}
          <b>${t('audit.titleNoDevice')}</b>
          <p>${t('audit.offline')}</p>
        </div>
      </div>`;
    const forbiddenHere = !this.admin || feed.state.status === 'forbidden';
    if (forbiddenHere) {
      const auth = app.session.auth;
      return html`<div class="ed ed-fill">
        ${this.header()}
        <div class="banner err au-note" role="alert" data-role="forbidden">
          ${icon('lock', 'err')}
          <div>
            ${
              auth && auth.role !== 'administrator'
                ? t('audit.forbidden', { user: auth.user, role: auth.role })
                : t('audit.forbidden.generic')
            }
          </div>
        </div>
      </div>`;
    }
    const st = feed.state;
    return html`<div class="ed ed-fill">
      ${this.header()} ${this.filters()}
      <div class="au-body">
        <div class="au-frame gridwrap">
          ${
            st.status === 'error' && st.rows.length === 0
              ? html`<div class="banner err au-note" role="alert" data-role="error">
                  ${icon('err', 'err')}
                  <div>
                    ${t('audit.error', { reason: deviceErrorText({ error: st.error ?? 'failed' }) })}
                    <button class="btn" type="button" @click=${() => void feed.load()}>
                      ${t('audit.retry')}
                    </button>
                  </div>
                </div>`
              : st.status === 'loading' && st.rows.length === 0
                ? html`<p class="row au-note" role="status" data-role="loading">
                    <span class="spin" aria-hidden="true"></span>${t('audit.loading')}
                  </p>`
                : st.status === 'idle'
                  ? nothing
                  : this.table()
          }
        </div>
        <div class="au-foot">
          ${
            st.next !== null
              ? html`<button
                  class="btn"
                  type="button"
                  data-role="more"
                  ?disabled=${st.loadingMore}
                  @click=${() => void feed.more()}
                >
                  ${st.loadingMore ? t('audit.filter.moreBusy') : t('audit.filter.more')}
                </button>`
              : nothing
          }
          <p class="help">${t('audit.help')}</p>
        </div>
      </div>
    </div>`;
  }
}

customElements.define('mat-audit-view', MatAuditView);

registerEditor({
  match: (id) => id === 'audit',
  render: (app: StudioApp) => html`<mat-audit-view .app=${app}></mat-audit-view>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-audit-view': MatAuditView;
  }
}
