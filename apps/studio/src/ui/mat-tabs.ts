// Dải tab editor (feature 004, T048, FR-005, FR-011, data-model §8): mẫu ARIA tablist, kích hoạt khi
// chuyển bằng phím mũi tên. Mỗi editor tối đa một tab; Bắt đầu không đóng được; dấu chấm khi editor có
// thay đổi chưa lưu. Delete hoặc Ctrl+W đóng tab đang chọn; nhấp giữa cũng đóng.
import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { t } from '../i18n/index.ts';
import { findByEditor, PHASE_PAGES, type EditorId, type PhasePageKey } from '../model/tree.ts';
import type { IconName } from '../icons/icons.ts';
import { AppElement, icon } from './base.ts';

export const tabId = (id: EditorId) => `tab-${id}`;

export class MatTabs extends AppElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'tablist');
    this.setAttribute('aria-label', t('shell.editors'));
  }

  private iconOf(id: EditorId): IconName {
    if (id === 'device') return 'device';
    if (id === 'compare') return 'compare';
    if (id === 'audit') return 'list';
    if (id.startsWith('phase:')) return PHASE_PAGES[id.slice(6) as PhasePageKey]?.icon ?? 'info';
    return findByEditor(this.app.tree(), id)?.icon ?? (id === 'start' ? 'home' : 'screen');
  }

  /** Focus tab đang chọn sau khi vẽ lại. */
  focusActive(): void {
    void this.updateComplete.then(() =>
      this.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(),
    );
  }

  private onKey(e: KeyboardEvent, id: EditorId): void {
    const app = this.app;
    const tabs = app.store.state.tabs;
    const i = tabs.indexOf(id);
    let next: EditorId | undefined;
    if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
    else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === 'Home') next = tabs[0];
    else if (e.key === 'End') next = tabs[tabs.length - 1];
    else if (e.key === 'Enter' || e.key === ' ') next = id;
    else if (e.key === 'Delete' || (e.ctrlKey && (e.key === 'w' || e.key === 'W'))) {
      e.preventDefault();
      if (id !== 'start') {
        app.closeTab(id);
        this.focusActive();
      }
      return;
    } else return;
    e.preventDefault();
    if (next) {
      app.activate(next);
      this.focusActive();
    }
  }

  private renderTab(id: EditorId) {
    const app = this.app;
    const title = app.editorTitle(id);
    const active = app.store.state.active === id;
    const dirty = app.editorDirty(id);
    const closable = id !== 'start';
    return html`<div
      class="tab"
      role="tab"
      id=${tabId(id)}
      aria-selected=${active ? 'true' : 'false'}
      aria-controls="editor-panel"
      tabindex=${active ? 0 : -1}
      title=${dirty ? t('tabs.dirty', { title }) : title}
      @click=${() => app.activate(id)}
      @auxclick=${(e: MouseEvent) => e.button === 1 && closable && app.closeTab(id)}
      @keydown=${(e: KeyboardEvent) => this.onKey(e, id)}
    >
      ${icon(this.iconOf(id))}
      <span class="tab-title">${title}</span>
      ${dirty ? html`<span class="dirty" aria-hidden="true">●</span>` : nothing}
      ${
        closable
          ? html`<span
              class="x"
              aria-hidden="true"
              title=${t('tabs.closeTip')}
              @click=${(e: Event) => {
                e.stopPropagation();
                app.closeTab(id);
              }}
            >
              ${icon('x', 'sm')}
            </span>`
          : html`<span class="nox"></span>`
      }
    </div>`;
  }

  protected override render() {
    return repeat(
      this.app.store.state.tabs,
      (id) => id,
      (id) => this.renderTab(id),
    );
  }
}

customElements.define('mat-tabs', MatTabs);

declare global {
  interface HTMLElementTagNameMap {
    'mat-tabs': MatTabs;
  }
}
