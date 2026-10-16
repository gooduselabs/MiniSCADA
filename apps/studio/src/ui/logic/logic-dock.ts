// Khung dưới của editor Logic (feature 011, T144; T007 quyết định 3; mockup studio-logic.html cảnh 1, 2): Inspector của khối
// đang chọn bên TRÁI (rộng tối thiểu 360 px, nhóm xếp dọc khi hẹp), bên PHẢI hai tab "Thông tin" (lỗi và cảnh báo E_LOGIC_*,
// W_LOGIC_* của validator TS, nhấp đúp hoặc Enter nhảy tới khối và ô; F8 tới lỗi kế) và "Thử logic". Thay vùng inspector
// của khung khi tab Logic đang mở (registry.registerDock).
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import { AppElement, icon } from '../base.ts';
import { blockInspector } from './block-inspector.ts';
import { kindLabel } from './logic-parts.ts';
import {
  kindOf,
  locatedIssues,
  logicDoc,
  logicUi,
  select,
  selectedId,
  setDockTab,
  setKind,
  type LocatedIssue,
} from './logic-state.ts';
import './test-panel.ts';

const FIELD_LABEL: Readonly<Record<string, MessageKey>> = {
  id: 'logic.col.id',
  name: 'logic.col.name',
  enabled: 'logic.col.enabled',
  when: 'logic.col.when',
  hold: 'logic.col.hold',
  onRise: 'logic.col.onRise',
  onFall: 'logic.col.onFall',
  repeatMs: 'logic.col.repeat',
  in: 'logic.col.in',
  pt: 'logic.col.pt',
  up: 'logic.col.up',
  down: 'logic.col.down',
  reset: 'logic.col.reset',
  source: 'logic.col.source',
  run: 'logic.col.run',
  weekly: 'logic.col.weekly',
  exceptions: 'logic.col.exceptions',
  tag: 'logic.col.writeTag',
  allowed: 'logic.col.allowed',
};

export class LogicDock extends AppElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add('lg-dock');
  }

  /** Nhảy tới khối và ô của một lỗi. */
  jump(li: LocatedIssue): void {
    const tg = li.target;
    if (!tg) return;
    const app = this.app;
    setKind(app, tg.kind);
    if (tg.id) select(app, tg.kind, tg.id);
    logicUi(app).focus = tg.id ? { id: tg.id, field: tg.field } : null;
    app.requestRender();
  }

  protected override updated(): void {
    const ui = logicUi(this.app);
    const f = ui.focus;
    if (!f) return;
    ui.focus = null;
    const el = this.querySelector<HTMLElement>(
      `.lg-dock-l [data-field="${CSS.escape(f.field ?? 'id')}"]`,
    );
    if (el && el.matches('mat-expression-input')) {
      // Ô biểu thức là thành phần con: chờ nó vẽ xong mới có textarea để focus.
      void (el as unknown as { updateComplete: Promise<unknown> }).updateComplete.then(() =>
        el.querySelector<HTMLElement>('textarea')?.focus(),
      );
      return;
    }
    (el ?? this.querySelector<HTMLElement>('.lg-dock-l [data-field="id"]'))?.focus();
  }

  private locText(li: LocatedIssue): string {
    const tg = li.target;
    if (!tg) return li.issue.path || li.issue.file;
    const parts = [kindLabel(tg.kind)];
    if (tg.id) parts.push(tg.id);
    if (tg.field) {
      const key = FIELD_LABEL[tg.field];
      parts.push(`${key ? t(key) : tg.field}${tg.index !== undefined ? ` #${tg.index + 1}` : ''}`);
    }
    return parts.join(' · ');
  }

  private infoView(list: LocatedIssue[]) {
    const onKey = (e: KeyboardEvent, i: number) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.jump(list[i]!);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'F8') {
        e.preventDefault();
        const items = [...this.querySelectorAll<HTMLElement>('.lg-issues .issue[data-code]')];
        const j = e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(items.length - 1, i + 1);
        items[j]?.focus();
      }
    };
    return html`<div class="lg-issues" role="list" aria-label=${t('logic.info.list')}>
      ${
        list.length === 0
          ? html`<p class="help pad" role="listitem">
              ${icon('ok', 'ok')} ${t('logic.info.none')}
            </p>`
          : list.map((li, i) => {
              const err = !li.issue.code.startsWith('W_');
              return html`<div
                class="issue"
                role="listitem"
                tabindex="0"
                data-code=${li.issue.code}
                title=${t('logic.info.jumpTip')}
                @dblclick=${() => this.jump(li)}
                @keydown=${(e: KeyboardEvent) => onKey(e, i)}
              >
                ${icon(err ? 'err' : 'warn', err ? 'err' : 'warn')}
                <span class="mono code">${li.issue.code}</span>
                <span class="msg">${li.issue.message}</span>
                <span class="loc">${this.locText(li)}</span>
              </div>`;
            })
      }
      <div class="issue foot muted">
        <span></span><span class="sm-text">${t('logic.info.live')}</span
        ><span class="msg sm-text">${t('logic.info.liveText')}</span>
      </div>
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const doc = logicDoc(app);
    const ui = logicUi(app);
    const kind = kindOf(app);
    const id = selectedId(app, kind);
    const list = locatedIssues(app);
    const errors = list.filter((x) => !x.issue.code.startsWith('W_')).length;
    const warnings = list.length - errors;
    const tab = ui.dockTab;
    const setTab = (x: 'info' | 'test') => setDockTab(app, x);
    this.classList.toggle('test', tab === 'test');
    const tabKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      setTab(tab === 'info' ? 'test' : 'info');
      void this.updateComplete.then(() =>
        this.querySelector<HTMLElement>('.lg-dock-r [role="tab"][aria-selected="true"]')?.focus(),
      );
    };
    return html`<section class="dock lg-dock-l" aria-label=${t('logic.dock.inspector')}>
        <div class="btabs" role="tablist" aria-label=${t('logic.dock.inspector')}>
          <button
            type="button"
            role="tab"
            id="lg-tab-props"
            aria-selected="true"
            aria-controls="lg-props"
            tabindex="0"
          >
            ${t('insp.props')}
          </button>
          <span class="ctx">${doc ? `${kindLabel(kind)}${id ? ` · ${id}` : ''}` : ''}</span>
        </div>
        <div
          class="bbody"
          id="lg-props"
          role="tabpanel"
          tabindex="0"
          aria-labelledby="lg-tab-props"
        >
          ${doc ? blockInspector(app, kind, id) : html`<p class="help pad">${t('logic.empty.text')}</p>`}
        </div>
      </section>
      <div class="sash" aria-hidden="true"></div>
      <section class="dock lg-dock-r" aria-label=${t('logic.dock.info')}>
        <div class="btabs" role="tablist" aria-label=${t('logic.dock.info')}>
          <button
            type="button"
            role="tab"
            id="lg-tab-info"
            data-tab="info"
            aria-selected=${tab === 'info' ? 'true' : 'false'}
            aria-controls="lg-right"
            tabindex=${tab === 'info' ? 0 : -1}
            @click=${() => setTab('info')}
            @keydown=${tabKey}
          >
            ${t('insp.info')}
            ${errors ? html`<span class="badge" title=${t('insp.badgeErrors', { n: errors })}>${errors}</span>` : nothing}
            ${warnings ? html`<span class="badge warn" title=${t('insp.badgeWarnings', { n: warnings })}>${warnings}</span>` : nothing}
          </button>
          <button
            type="button"
            role="tab"
            id="lg-tab-test"
            data-tab="test"
            aria-selected=${tab === 'test' ? 'true' : 'false'}
            aria-controls="lg-right"
            tabindex=${tab === 'test' ? 0 : -1}
            @click=${() => setTab('test')}
            @keydown=${tabKey}
          >
            ${icon('play', 'sm')}${t('logic.dock.test')}
          </button>
        </div>
        <div
          class="bbody"
          id="lg-right"
          role="tabpanel"
          tabindex="0"
          aria-labelledby=${tab === 'info' ? 'lg-tab-info' : 'lg-tab-test'}
        >
          ${tab === 'info' ? this.infoView(list) : html`<mat-logic-test .app=${app}></mat-logic-test>`}
        </div>
      </section>`;
  }
}

customElements.define('mat-logic-dock', LogicDock);

declare global {
  interface HTMLElementTagNameMap {
    'mat-logic-dock': LogicDock;
  }
}
