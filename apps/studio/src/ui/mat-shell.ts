// Khung cửa sổ bảy vùng của Studio (feature 004, T044, FR-001, FR-002, FR-011, mockup bản 1):
// menu, thanh công cụ, cây project + Details | tab editor + inspector | task card, thanh trạng thái.
// Thanh kéo đổi cỡ (chuột và phím mũi tên) ghi vào không gian làm việc; F6/Shift+F6 chuyển vùng; lớp
// `online` vẽ viền cam khi làm việc với thiết bị. Thanh tiêu đề là thanh gốc của Windows (research R12).
import { html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { installShortcuts } from '../app/shortcuts.ts';
import { TASK_CARD_MIN_WINDOW, type Workspace } from '../app/workspace.ts';
import { t } from '../i18n/index.ts';
import { AppElement } from './base.ts';
import './dialogs/devices-dialog.ts';
import './dialogs/login-dialog.ts';
import './dialogs/pin-dialog.ts';
import './dialogs/download-dialog.ts';
import './dialogs/restore-dialog.ts';
import './dialogs/upload-dialog.ts';
import './editors/index.ts';
import { detailsHeading } from './mat-details.ts';
import './mat-dialog.ts';
import './dialogs/upgrade-dialog.ts';
import './dialogs/rename-dialog.ts';
import './dialogs/bulk-add-dialog.ts';
import './dialogs/rename-tag-dialog.ts';
import './dialogs/csv-import-dialog.ts';
import './dialogs/write-confirm-dialog.ts';
import './mat-inspector.ts';
import './mat-menubar.ts';
import './mat-palette.ts';
import './mat-statusbar.ts';
import './mat-tabs.ts';
import { tabId } from './mat-tabs.ts';
import './mat-taskcards.ts';
import './mat-toast.ts';
import './mat-toolbar.ts';
import './mat-tree.ts';
import { renderEditor } from './registry.ts';

type Split = 'left' | 'details' | 'inspector';

/** Thứ tự vòng của F6 (contracts/commands.md). */
const REGIONS = ['tree', 'details', 'editor', 'inspector', 'taskcards', 'statusbar'] as const;

const STEP = 16;

/** Áp theme lên phần tử gốc: `system` theo Windows (prefers-color-scheme). */
export function applyTheme(root: HTMLElement, theme: Workspace['theme']): void {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export class MatShell extends AppElement {
  private uninstallKeys: (() => void) | null = null;

  protected override attached(): void {
    this.app.hooks.region = (dir) => this.focusRegion(dir);
    this.uninstallKeys = installShortcuts(document, this.app);
    document.addEventListener('pointerdown', this.onDocPointer, true);
  }

  protected override detached(): void {
    this.uninstallKeys?.();
    this.uninstallKeys = null;
    document.removeEventListener('pointerdown', this.onDocPointer, true);
  }

  /**
   * Cửa sổ hẹp hơn TASK_CARD_MIN_WINDOW: task card nổi đè lên vùng editor như một ngăn kéo, nên nhấp ra
   * ngoài thì thu lại (cây dạng ngăn kéo ở cửa sổ rất hẹp cũng vậy).
   */
  private readonly onDocPointer = (e: Event): void => {
    const target = e.target as Node | null;
    if (!target || typeof window === 'undefined') return;
    const app = this.app;
    if (
      window.innerWidth < TASK_CARD_MIN_WINDOW &&
      app.workspace.taskCardOpen &&
      !this.querySelector('mat-taskcards')?.contains(target)
    )
      void app.run('view.taskCards');
    if (app.ui.treeDrawer && !this.querySelector('.left')?.contains(target)) {
      const drawerBtn = this.querySelector('.drawer-btn');
      if (!drawerBtn?.contains(target)) app.setTreeDrawer(false);
    }
  };

  // ---------- Chuyển vùng (F6) ----------

  private focusRegion(dir: 1 | -1): void {
    const regions = REGIONS.map((r) =>
      this.querySelector<HTMLElement>(`[data-region="${r}"]`),
    ).filter((r): r is HTMLElement => r !== null);
    if (!regions.length) return;
    const active = document.activeElement;
    const cur = regions.findIndex((r) => r.contains(active));
    const next =
      cur < 0 ? (dir > 0 ? 0 : regions.length - 1) : (cur + dir + regions.length) % regions.length;
    this.focusInto(regions[next]);
  }

  private focusInto(region: HTMLElement): void {
    const name = region.dataset.region;
    const target =
      name === 'tree'
        ? region
        : name === 'details'
          ? region.querySelector<HTMLElement>('[role="listbox"]')
          : name === 'inspector'
            ? region.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
            : name === 'taskcards'
              ? region.querySelector<HTMLElement>('.tc-strip [role="tab"][tabindex="0"]')
              : name === 'statusbar'
                ? region.querySelector<HTMLElement>('button')
                : null;
    (target ?? region).focus();
  }

  // ---------- Thanh kéo đổi cỡ ----------

  private resize(split: Split, value: number): void {
    const left = this.querySelector<HTMLElement>('.left');
    const center = this.querySelector<HTMLElement>('.center');
    const dims = {
      leftColumnHeight: left?.getBoundingClientRect().height ?? 0,
      centerHeight: center?.getBoundingClientRect().height ?? 0,
    };
    if (split === 'left') this.app.setLayout({ leftWidth: value }, dims);
    else if (split === 'details') this.app.setLayout({ detailsHeight: value }, dims);
    else this.app.setLayout({ inspectorHeight: value }, dims);
  }

  private valueFromPointer(split: Split, e: MouseEvent): number {
    if (split === 'left') {
      const r = this.querySelector('.main')?.getBoundingClientRect();
      return Math.round(e.clientX - (r?.left ?? 0));
    }
    const box = this.querySelector(
      split === 'details' ? '.left' : '.center',
    )?.getBoundingClientRect();
    return Math.round((box?.bottom ?? 0) - e.clientY);
  }

  private current(split: Split): number {
    const ws = this.app.workspace;
    return split === 'left'
      ? ws.leftWidth
      : split === 'details'
        ? ws.detailsHeight
        : ws.inspectorHeight;
  }

  private onSplitDown(split: Split, e: MouseEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    const pointerId = (e as PointerEvent).pointerId;
    if (pointerId !== undefined) handle.setPointerCapture?.(pointerId);
    handle.classList.add('drag');
    const move = (ev: Event) => this.resize(split, this.valueFromPointer(split, ev as MouseEvent));
    const up = () => {
      handle.classList.remove('drag');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  private onSplitKey(split: Split, e: KeyboardEvent): void {
    const grow = split === 'left' ? 'ArrowRight' : 'ArrowUp';
    const shrink = split === 'left' ? 'ArrowLeft' : 'ArrowDown';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    this.resize(split, this.current(split) + (e.key === grow ? STEP : -STEP));
  }

  private splitter(split: Split) {
    const vertical = split === 'left';
    const [min, max] = vertical ? [180, 480] : split === 'details' ? [70, 2000] : [90, 2000];
    const label =
      split === 'left'
        ? t('shell.resize.left')
        : split === 'details'
          ? t('shell.resize.details')
          : t('shell.resize.inspector');
    return html`<div
      class=${vertical ? 'split-v' : 'split-h'}
      data-split=${split}
      role="separator"
      tabindex="0"
      aria-orientation=${vertical ? 'vertical' : 'horizontal'}
      aria-label=${label}
      title=${label}
      aria-valuenow=${this.current(split)}
      aria-valuemin=${min}
      aria-valuemax=${max}
      @pointerdown=${(e: MouseEvent) => this.onSplitDown(split, e)}
      @keydown=${(e: KeyboardEvent) => this.onSplitKey(split, e)}
    ></div>`;
  }

  // ---------- Vẽ ----------

  protected override updated(): void {
    applyTheme(document.documentElement, this.app.workspace.theme);
  }

  /** Dấu MÔ PHỎNG (FR-052): tím, nét đứt ở khung; có chữ để màu không là tín hiệu duy nhất. */
  private simChip() {
    const app = this.app;
    if (!app.simulating() || app.online()) return nothing;
    return html`<div class="sim-chip" role="status" title=${t('sim.pillTip')}>
      <span class="dot"></span>${t('sim.pill')}
    </div>`;
  }

  private onlineChip() {
    const app = this.app;
    if (!app.online()) return nothing;
    const session = app.session;
    const state = session.state;
    // Online có đăng nhập (feature 005): tên thiết bị đã lưu; theo dõi theo địa chỉ (004): địa chỉ.
    const online = session.mode === 'online' && session.device !== null;
    const name = online
      ? session.device!.name
      : (session.address?.replace(/^https?:\/\//, '') ?? app.deviceAddress());
    const lost = state === 'lost' || state === 'full';
    // Chữ theo đúng trạng thái phiên (T071): đang kết nối, đang theo dõi, mất kết nối, thiết bị đầy.
    const label =
      state === 'connecting'
        ? t('monitor.chip.connecting', { name })
        : state === 'full'
          ? t('monitor.chip.full', { name })
          : lost
            ? t('shell.lostChip', { name })
            : state === 'relogin'
              ? t('online.chipRelogin', { name })
              : online
                ? t('online.chip', { name })
                : t('shell.onlineChip', { name });
    return html`<div class="online-chip ${lost ? 'lost' : ''}" role="status">
      <span class="dot"></span>${label}
    </div>`;
  }

  protected override render() {
    const app = this.app;
    const ws = app.workspace;
    const active = app.store.state.active;
    const vars = {
      '--left-w': `${ws.leftWidth}px`,
      '--details-h': `${ws.detailsHeight}px`,
      '--insp-h': `${ws.inspectorHeight}px`,
    };
    const online = app.online();
    const simulating = app.simulating() && !online;
    const classes = [
      'win',
      online ? 'online' : '',
      simulating ? 'sim' : '',
      app.session.state === 'lost' ? 'lost' : '',
      app.ui.treeDrawer ? 'tree-open' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return html`<div class=${classes} style=${styleMap(vars)}>
        <header class="menurow">
          <div class="logo" aria-hidden="true">m</div>
          <mat-menubar .app=${app}></mat-menubar>
          <span class="grow"></span>
          ${this.simChip()} ${this.onlineChip()}
        </header>
        <mat-toolbar class="toolbar" .app=${app}></mat-toolbar>
        <div class="main">
          <aside class="left">
            <section class="pane" aria-label=${t('shell.tree')}>
              <div class="pane-h">
                <span>${t('shell.tree')}</span>
                <button
                  class="ibtn sm"
                  type="button"
                  aria-label=${t('shell.collapseAll')}
                  title=${t('shell.collapseAll')}
                  @click=${() => app.collapseAll()}
                >
                  <svg class="ic sm" aria-hidden="true"><use href="#i-collapse"></use></svg>
                </button>
              </div>
              <mat-tree class="tree" data-region="tree" .app=${app}></mat-tree>
            </section>
            ${this.splitter('details')}
            <section class="pane" aria-label=${t('shell.details')}>
              <div class="pane-h"><span>${detailsHeading(app)}</span></div>
              <mat-details class="details" data-region="details" .app=${app}></mat-details>
            </section>
          </aside>
          ${this.splitter('left')}
          <section class="center">
            <mat-tabs class="tabbar" .app=${app}></mat-tabs>
            <div
              class="editor"
              id="editor-panel"
              role="tabpanel"
              tabindex="-1"
              data-region="editor"
              aria-labelledby=${tabId(active)}
            >
              ${renderEditor(app, active)}
            </div>
            ${this.splitter('inspector')}
            <mat-inspector class="inspector" data-region="inspector" .app=${app}></mat-inspector>
          </section>
          <mat-taskcards
            class="right ${ws.taskCardOpen ? '' : 'collapsed'}"
            data-region="taskcards"
            .app=${app}
          ></mat-taskcards>
        </div>
        <mat-statusbar class="statusbar" data-region="statusbar" .app=${app}></mat-statusbar>
      </div>
      <mat-palette .app=${app}></mat-palette>
      <mat-dialog .app=${app}></mat-dialog>
      <mat-devices-dialog .app=${app}></mat-devices-dialog>
      <mat-pin-dialog .app=${app}></mat-pin-dialog>
      <mat-login-dialog .app=${app}></mat-login-dialog>
      <mat-download-dialog .app=${app}></mat-download-dialog>
      <mat-restore-dialog .app=${app}></mat-restore-dialog>
      <mat-upload-dialog .app=${app}></mat-upload-dialog>
      <mat-upgrade-dialog .app=${app}></mat-upgrade-dialog>
      <mat-rename-dialog .app=${app}></mat-rename-dialog>
      <mat-bulk-add-dialog .app=${app}></mat-bulk-add-dialog>
      <mat-rename-tag-dialog .app=${app}></mat-rename-tag-dialog>
      <mat-csv-import-dialog .app=${app}></mat-csv-import-dialog>
      <mat-write-confirm-dialog .app=${app}></mat-write-confirm-dialog>
      <mat-toast .app=${app}></mat-toast>`;
  }
}

customElements.define('mat-shell', MatShell);

declare global {
  interface HTMLElementTagNameMap {
    'mat-shell': MatShell;
  }
}
