// Inspector dưới vùng editor (feature 004, T049, FR-006, FR-018, FR-029): tab Thuộc tính, Thông tin (huy
// hiệu số lỗi/cảnh báo), Chẩn đoán. Thuộc tính lấy từ bảng đăng ký (registry.ts) theo lựa chọn hiện tại;
// không có bộ vẽ nào nhận thì hiện thuộc tính project. Thông tin liệt kê lỗi và cảnh báo của lần kiểm
// mới nhất (mẫu ARIA listbox): nhấp đúp hoặc Enter mở đúng editor và ô (issue-map.ts).
import type { Issue } from '@mat/project-schema';
import { html, nothing } from 'lit';
import type { InspectorTab } from '../app/app.ts';
import { t } from '../i18n/index.ts';
import { severityOf } from '../model/issue-map.ts';
import { AppElement, icon } from './base.ts';
import { issueText } from './issue-text.ts';
import { renderDiagnostics, renderDock, renderProps, type InspectorView } from './registry.ts';

const TABS: ReadonlyArray<{ id: InspectorTab; label: 'insp.props' | 'insp.info' | 'insp.diag' }> = [
  { id: 'props', label: 'insp.props' },
  { id: 'info', label: 'insp.info' },
  { id: 'diag', label: 'insp.diag' },
];

const issueId = (i: number) => `issue-${i}`;

/**
 * 036: `full` ba tab (editor bảng); `props` chỉ Thuộc tính (cột phải editor canvas); `bottom` chỉ Thông tin và
 * Chẩn đoán (khung dưới editor canvas, gập được).
 */
export type InspectorMode = 'full' | 'props' | 'bottom';

/** Một dòng thuộc tính: nhãn, giá trị (chữ), phần thêm bên phải. */
export const prow = (
  label: string,
  value: string,
  opts: { mono?: boolean; extra?: unknown } = {},
) =>
  html`<div class="prow">
    <div class="pl" title=${label}>${label}</div>
    <div class="pv ${opts.mono ? 'mono' : ''}" title=${value}>${value}</div>
    ${opts.extra ?? html`<span></span>`}
  </div>`;

export class MatInspector extends AppElement {
  private cursor = 0;
  private modeValue: InspectorMode = 'full';

  get mode(): InspectorMode {
    return this.modeValue;
  }

  set mode(m: InspectorMode) {
    if (m === this.modeValue) return;
    this.modeValue = m;
    this.requestUpdate();
  }

  private tabs() {
    return this.modeValue === 'bottom' ? TABS.filter((x) => x.id !== 'props') : TABS;
  }

  /** Tab đang hiện: khung dưới không có Thuộc tính nên hiện Thông tin. */
  private shownTab(): InspectorTab {
    const tab = this.app.ui.inspectorTab;
    if (this.modeValue === 'props') return 'props';
    if (this.modeValue === 'bottom' && tab === 'props') return 'info';
    return tab;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('aria-label', t('shell.inspector'));
  }

  private onTabKey(e: KeyboardEvent, tab: InspectorTab): void {
    const tabs = this.tabs();
    const i = tabs.findIndex((x) => x.id === tab);
    let j: number;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    else return;
    e.preventDefault();
    this.app.setInspectorTab(tabs[j]!.id);
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('.insp-tabs [aria-selected="true"]')?.focus(),
    );
  }

  private projectView(): InspectorView {
    const app = this.app;
    const s = app.store.state;
    if (!s.project)
      return {
        ctx: t('insp.ctx.noProject'),
        body: html`<p class="help pad">${t('insp.noProject')}</p>`,
      };
    const p = s.outline.project;
    const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : t('prop.none'));
    const files = Object.keys(s.docs).sort().join(', ');
    return {
      ctx: t('insp.ctx.project'),
      body: html`${prow(t('prop.project'), app.projectName())}
        ${prow(t('prop.folder'), s.project.display, { mono: true })}
        ${prow(t('prop.projectId'), str(p?.projectId), { mono: true })}
        ${prow(t('prop.version'), str(p?.projectVersion))}
        ${prow(t('prop.entryScreen'), str(p?.entryScreen), { mono: true })}
        ${prow(t('prop.files'), files, { mono: true })}
        <p class="help pad">${t('prop.hint')}</p>`,
    };
  }

  private propsView(): InspectorView {
    return (this.app.store.state.project && renderProps(this.app)) || this.projectView();
  }

  private infoView(): InspectorView {
    const app = this.app;
    const s = app.store.state;
    const ctx = !s.project
      ? t('insp.ctx.noProject')
      : s.checking
        ? t('insp.ctx.checking')
        : app.ui.checkedAt
          ? t('insp.ctx.checked', { time: new Date(app.ui.checkedAt).toLocaleTimeString('vi-VN') })
          : '';
    if (!s.project) return { ctx, body: html`<p class="help pad">${t('insp.noProject')}</p>` };
    const issues = s.issues;
    if (!issues.length)
      return {
        ctx,
        body: html`<div class="empty">
          ${icon('ok', 'lg ok')}<b>${t('insp.noIssues.title')}</b>
          <p>${t('insp.noIssues.text')}</p>
        </div>`,
      };
    if (this.cursor >= issues.length) this.cursor = 0;
    return {
      ctx,
      body: html`<div
        class="issues"
        role="listbox"
        tabindex="0"
        aria-label=${t('insp.issues')}
        aria-activedescendant=${issueId(this.cursor)}
        @keydown=${(e: KeyboardEvent) => this.onIssueKey(e, issues)}
      >
        ${issues.map((it, i) => this.issueRow(it, i))}
      </div>`,
    };
  }

  private issueRow(it: Issue, i: number) {
    const sev = severityOf(it);
    return html`<div
      class="issue ${i === this.cursor ? 'cursor' : ''}"
      id=${issueId(i)}
      role="option"
      aria-selected=${i === this.cursor ? 'true' : 'false'}
      title=${t('insp.issue.goto')}
      @click=${() => {
        this.cursor = i;
        this.requestUpdate();
      }}
      @dblclick=${() => this.app.gotoIssue(it)}
    >
      ${icon(sev === 'error' ? 'err' : 'warn', sev === 'error' ? 'err' : 'warn')}
      <span class="visually-hidden"
        >${sev === 'error' ? t('insp.issue.error') : t('insp.issue.warning')}</span
      >
      <span class="mono code">${it.code}</span>
      <span class="loc mono">${it.file}${it.path ? ` ${it.path}` : ''}</span>
      <span class="msg">${issueText(this.app, it)}</span>
    </div>`;
  }

  private onIssueKey(e: KeyboardEvent, issues: readonly Issue[]): void {
    let i = this.cursor;
    if (e.key === 'ArrowDown') i = Math.min(issues.length - 1, i + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = issues.length - 1;
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (issues[i]) this.app.gotoIssue(issues[i]);
      return;
    } else return;
    e.preventDefault();
    this.cursor = i;
    this.requestUpdate();
    void this.updateComplete.then(() =>
      this.querySelector(`[id="${issueId(i)}"]`)?.scrollIntoView?.({ block: 'nearest' }),
    );
  }

  private diagView(): InspectorView {
    const app = this.app;
    const registered = renderDiagnostics(app);
    if (registered) return registered;
    return {
      ctx: t('insp.ctx.offline'),
      body: html`<div class="empty">
        ${icon('pulse', 'lg')}<b>${t('insp.diag.offTitle')}</b>
        <p>${t('insp.diag.offText')}</p>
        <button class="btn" type="button" @click=${() => void app.run('online.connect')}>
          ${icon('online')}${t('cmd.online.connect')}
        </button>
      </div>`,
    };
  }

  protected override render() {
    const app = this.app;
    // Editor có khung dưới riêng (Logic: Inspector trái, Thông tin và Thử logic phải; feature 011).
    const dock = app.store.state.project ? renderDock(app) : null;
    if (dock !== null) return dock;
    const tab = this.shownTab();
    if (this.modeValue === 'props') return this.renderProps();
    const view =
      tab === 'info' ? this.infoView() : tab === 'diag' ? this.diagView() : this.propsView();
    const { errors, warnings } = app.counts();
    const badge = errors
      ? html`<span class="badge" title=${t('insp.badgeErrors', { n: errors })}>${errors}</span>`
      : warnings
        ? html`<span class="badge warn" title=${t('insp.badgeWarnings', { n: warnings })}
            >${warnings}</span
          >`
        : nothing;
    const bottom = this.modeValue === 'bottom';
    const collapsed = bottom && app.workspace.infoCollapsed;
    const pid = bottom ? 'insp-panel-b' : 'insp-panel';
    const tid = (id: string) => (bottom ? `insp-btab-${id}` : `insp-tab-${id}`);
    return html`<div class="insp-tabs">
        <div class="insp-tablist" role="tablist" aria-label=${t('shell.inspector')}>
          ${this.tabs().map(
            (x) =>
              html`<button
                type="button"
                role="tab"
                id=${tid(x.id)}
                aria-selected=${tab === x.id ? 'true' : 'false'}
                aria-controls=${collapsed ? nothing : pid}
                tabindex=${tab === x.id ? 0 : -1}
                @click=${() => app.setInspectorTab(x.id)}
                @keydown=${(e: KeyboardEvent) => this.onTabKey(e, x.id)}
              >
                ${t(x.label)} ${x.id === 'info' ? badge : nothing}
              </button>`,
          )}
        </div>
        <span class="insp-ctx" title=${view.ctx}>${view.ctx}</span>
        ${
          bottom
            ? html`<button
                type="button"
                class="ibtn sm insp-toggle ${collapsed ? 'closed' : ''}"
                aria-expanded=${collapsed ? 'false' : 'true'}
                aria-label=${t(collapsed ? 'insp.dock.open' : 'insp.dock.close')}
                title=${t(collapsed ? 'insp.dock.open' : 'insp.dock.close')}
                @click=${() => app.setInfoCollapsed(!collapsed)}
              >
                ${icon('chev-d', 'sm')}
              </button>`
            : nothing
        }
      </div>
      ${
        collapsed
          ? nothing
          : html`<div
              class="insp-body"
              id=${pid}
              role="tabpanel"
              tabindex="0"
              aria-labelledby=${tid(tab)}
            >
              ${view.body}
            </div>`
      }`;
  }

  /** Cột Thuộc tính bên phải editor canvas: tiêu đề nhỏ "Thuộc tính" và tên phần tử đang chọn. */
  private renderProps() {
    const view = this.propsView();
    return html`<div class="insp-tabs insp-head">
        <span class="insp-title" id="insp-props-title">${t('insp.props')}</span>
        <span class="insp-ctx" title=${view.ctx}>${view.ctx}</span>
      </div>
      <div
        class="insp-body"
        id="insp-panel"
        role="region"
        tabindex="0"
        aria-labelledby="insp-props-title"
      >
        ${view.body}
      </div>`;
  }
}

customElements.define('mat-inspector', MatInspector);

declare global {
  interface HTMLElementTagNameMap {
    'mat-inspector': MatInspector;
  }
}
