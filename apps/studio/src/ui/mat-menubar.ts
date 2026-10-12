// Thanh menu (feature 004, T045, FR-001, FR-011, contracts/commands.md): Project, Sửa, Xem, Online, Công
// cụ, Trợ giúp dựng từ danh mục lệnh. Mẫu ARIA menubar + menu: ← → giữa các menu, ↓ Enter Space mở menu,
// ↑ ↓ Home End trong menu, Esc đóng và trả focus. Lệnh bị khóa vẫn hiện (aria-disabled) kèm lý do.
// Rê chuột sang menu khác khi đang mở thì chuyển menu. Project › Mở gần đây liệt kê danh sách gần đây.
import { html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import {
  COMMANDS,
  MENU_LABEL,
  MENU_ORDER,
  MENUS,
  type CommandId,
  type MenuId,
} from '../app/commands.ts';
import { t } from '../i18n/index.ts';
import { AppElement } from './base.ts';

interface MenuItem {
  key: string;
  label: string;
  shortcut?: string;
  reason?: string;
  sub?: string;
  run: () => void;
}

const SPEC = new Map(COMMANDS.map((c) => [c.id, c]));

export class MatMenubar extends AppElement {
  private open: MenuId | null = null;
  private returnFocus: HTMLElement | null = null;
  private pos = { left: 0, top: 0 };

  protected override attached(): void {
    this.app.hooks.focusMenu = () => this.buttons()[0]?.focus();
    document.addEventListener('mousedown', this.onDocDown, true);
  }

  protected override detached(): void {
    document.removeEventListener('mousedown', this.onDocDown, true);
  }

  private readonly onDocDown = (e: MouseEvent): void => {
    if (this.open && !this.contains(e.target as Node)) this.closeMenu(false);
  };

  private buttons(): HTMLButtonElement[] {
    return [...this.querySelectorAll<HTMLButtonElement>('.menubar-btn')];
  }

  private menuItems(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>('.menu-pop [role="menuitem"]')];
  }

  private items(menu: MenuId): Array<MenuItem | '-'> {
    const app = this.app;
    const ctx = app.commandContext();
    const out: Array<MenuItem | '-'> = [];
    for (const entry of MENUS[menu]) {
      if (entry === '-') {
        out.push('-');
        continue;
      }
      if (entry === 'project.openRecent') {
        out.push(...this.recentItems());
        continue;
      }
      const spec = SPEC.get(entry);
      if (!spec) continue;
      const enabled = spec.enabled(ctx);
      out.push({
        key: entry,
        label: t(spec.label),
        shortcut: spec.shortcut,
        reason: enabled === true ? undefined : t(enabled),
        run: () => void app.run(entry as CommandId),
      });
    }
    return out;
  }

  private recentItems(): MenuItem[] {
    const app = this.app;
    const recent = app.ui.recent;
    if (!recent.length)
      return [
        {
          key: 'recent-empty',
          label: t('cmd.project.openRecent'),
          reason: t('menu.recent.empty'),
          run: () => undefined,
        },
      ];
    return recent.map((r) => ({
      key: `recent-${r.index}`,
      label: r.exists ? r.name : t('menu.recent.missing', { name: r.name }),
      sub: r.display,
      run: () => void app.run('project.openRecent', r.index),
    }));
  }

  private openMenu(menu: MenuId, focusFirst: boolean): void {
    if (!this.open) {
      const active = document.activeElement;
      this.returnFocus = active instanceof HTMLElement && !this.contains(active) ? active : null;
    }
    const btn = this.buttons()[MENU_ORDER.indexOf(menu)];
    const r = btn?.getBoundingClientRect();
    this.pos = { left: r ? r.left : 0, top: r ? r.bottom + 2 : 0 };
    this.open = menu;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      this.fitPopup();
      if (focusFirst) this.menuItems()[0]?.focus();
    });
  }

  /** Đẩy menu vào trong cửa sổ khi gần mép phải. */
  private fitPopup(): void {
    const pop = this.querySelector<HTMLElement>('.menu-pop');
    if (!pop || typeof window === 'undefined') return;
    const w = pop.offsetWidth;
    if (w && this.pos.left + w > window.innerWidth - 8)
      pop.style.left = `${Math.max(8, window.innerWidth - w - 8)}px`;
  }

  private closeMenu(restoreToButton: boolean): void {
    const menu = this.open;
    if (!menu) return;
    this.open = null;
    this.requestUpdate();
    if (restoreToButton) this.buttons()[MENU_ORDER.indexOf(menu)]?.focus();
  }

  private activate(item: MenuItem): void {
    if (item.reason) {
      // Lệnh bị khóa: chỉ báo lý do (app.run báo bằng thông báo ngắn).
      this.closeMenu(false);
      this.returnFocus?.focus();
      item.run();
      return;
    }
    this.closeMenu(false);
    const back = this.returnFocus;
    this.returnFocus = null;
    if (back?.isConnected) back.focus();
    item.run();
  }

  private onBarKey(e: KeyboardEvent, menu: MenuId): void {
    const i = MENU_ORDER.indexOf(menu);
    const n = MENU_ORDER.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = MENU_ORDER[(i + (e.key === 'ArrowRight' ? 1 : n - 1)) % n];
      if (this.open) this.openMenu(next, true);
      else this.buttons()[MENU_ORDER.indexOf(next)]?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.openMenu(menu, true);
    } else if (e.key === 'Escape' && this.open) {
      e.preventDefault();
      this.closeMenu(true);
    }
  }

  private onMenuKey(e: KeyboardEvent): void {
    const items = this.menuItems();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const menu = this.open;
    if (!menu) return;
    const move = (j: number) => items[(j + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        move(i + 1);
        break;
      case 'ArrowUp':
        move(i - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(items.length - 1);
        break;
      case 'ArrowRight':
      case 'ArrowLeft': {
        const k = MENU_ORDER.indexOf(menu);
        const n = MENU_ORDER.length;
        this.openMenu(MENU_ORDER[(k + (e.key === 'ArrowRight' ? 1 : n - 1)) % n], true);
        break;
      }
      case 'Escape':
        this.closeMenu(true);
        break;
      case 'Tab':
        this.closeMenu(false);
        return;
      default:
        return;
    }
    e.preventDefault();
  }

  private renderPopup(menu: MenuId) {
    const items = this.items(menu);
    return html`<div
      class="menu-pop"
      role="menu"
      aria-label=${t(MENU_LABEL[menu])}
      style=${styleMap({ left: `${this.pos.left}px`, top: `${this.pos.top}px` })}
      @keydown=${(e: KeyboardEvent) => this.onMenuKey(e)}
    >
      ${items.map((it) =>
        it === '-'
          ? html`<hr role="separator" />`
          : html`<button
              type="button"
              role="menuitem"
              tabindex="-1"
              aria-disabled=${it.reason ? 'true' : nothing}
              title=${it.reason ?? it.sub ?? nothing}
              @click=${() => this.activate(it)}
            >
              <span class="mi-label">${it.label}</span>
              ${it.sub ? html`<span class="mi-sub">${it.sub}</span>` : nothing}
              ${it.reason ? html`<span class="mi-reason">${it.reason}</span>` : nothing}
              ${it.shortcut ? html`<span class="k">${it.shortcut}</span>` : nothing}
            </button>`,
      )}
    </div>`;
  }

  protected override render() {
    const open = this.open;
    // menu bật lên nằm ngoài phần tử menubar: menubar chỉ được chứa menuitem (ARIA).
    return html`<div class="menubar" role="menubar" aria-label=${t('shell.menu')}>
        ${MENU_ORDER.map(
          (m, i) =>
            html`<button
              type="button"
              class="menubar-btn"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded=${open === m ? 'true' : 'false'}
              tabindex=${i === 0 ? 0 : -1}
              @click=${() => (this.open === m ? this.closeMenu(false) : this.openMenu(m, false))}
              @mouseenter=${() => this.open && this.open !== m && this.openMenu(m, false)}
              @keydown=${(e: KeyboardEvent) => this.onBarKey(e, m)}
            >
              ${t(MENU_LABEL[m])}
            </button>`,
        )}
      </div>
      ${open ? this.renderPopup(open) : nothing}`;
  }
}

customElements.define('mat-menubar', MatMenubar);

declare global {
  interface HTMLElementTagNameMap {
    'mat-menubar': MatMenubar;
  }
}
