// Chip "Ghi PLC" khi Online (feature 011, T144; FR-083, FR-096; mockup studio-logic.html cảnh 3; T007 quyết định 1, 5): bốn
// trạng thái theo `system/info.logic.writes` (tắt xám, bật xanh lá, dừng đỏ, chưa hỗ trợ xám nét đứt), luôn có biểu tượng và
// chữ. Nhấp mở menu: chi tiết (configured, runtimeEnabled, giới hạn), Mở danh sách Ghi PLC, hỏi lại trạng thái khối,
// "Dừng ghi của logic…" (chỉ administrator khi đang bật; mở hộp xác nhận), "Bật ghi PLC" luôn khóa (LOGIC_ENABLE_ROOT_ONLY).
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { logicChip } from '../../model/deploy-preview.ts';
import { AppElement, icon } from '../base.ts';
import { wsClass, wsIcon, wsText } from './logic-parts.ts';
import { logicUi, refreshLive, setKind } from './logic-state.ts';

export class LogicChipElement extends AppElement {
  private readonly onDoc = (e: Event): void => {
    if (!this.contains(e.target as Node) && logicUi(this.app).chipMenu) {
      logicUi(this.app).chipMenu = false;
      this.app.requestRender();
    }
  };

  protected override attached(): void {
    document.addEventListener('pointerdown', this.onDoc, true);
  }

  protected override detached(): void {
    document.removeEventListener('pointerdown', this.onDoc, true);
  }

  private toggle(open?: boolean): void {
    const ui = logicUi(this.app);
    ui.chipMenu = open ?? !ui.chipMenu;
    this.app.requestRender();
    if (ui.chipMenu)
      void this.updateComplete.then(() =>
        this.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus(),
      );
  }

  private onMenuKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.toggle(false);
      this.querySelector<HTMLElement>('button.chip')?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...this.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[j]?.focus();
  }

  protected override render() {
    const app = this.app;
    if (!app.online() || app.session.mode !== 'online') return nothing;
    const role = app.session.auth?.role ?? null;
    const chip = logicChip(app.session.info, role);
    const ui = logicUi(app);
    const live = ui.live;
    const note =
      chip.stopBlocked === 'role'
        ? t('logic.chip.needAdmin', { role: role ?? '?' })
        : chip.stopBlocked === 'not-on'
          ? t('logic.chip.notOn')
          : chip.stopBlocked === 'unsupported'
            ? t('logic.chip.unsupported')
            : t('logic.chip.stopNote');
    return html`<span class="lg-chipwrap">
      <button
        type="button"
        class="chip big ${wsClass(chip.state)}"
        aria-haspopup="menu"
        aria-expanded=${ui.chipMenu ? 'true' : 'false'}
        title=${t('logic.chip.tip')}
        @click=${() => this.toggle()}
      >
        ${icon(wsIcon(chip.state))}${wsText(chip.state)}${icon('chev-d', 'sm')}
      </button>
      ${
        ui.chipMenu
          ? html`<div
              class="menu lg-menu"
              role="menu"
              aria-label=${t('logic.chip.menu')}
              @keydown=${(e: KeyboardEvent) => this.onMenuKey(e)}
            >
              <div class="mh">
                <b>${wsText(chip.state)}</b>
                <span class="muted">${t(`logic.chip.desc.${chip.state}`)}</span>
                ${
                  live
                    ? html`<span class="mono sm-text"
                        >configured: ${live.writes.configured} · runtimeEnabled:
                        ${String(live.writes.runtimeEnabled)} ·
                        ${live.writes.perMinute}/${live.writes.limitPerMinute}
                        ${t('logic.chip.perMin')}</span
                      >`
                    : nothing
                }
              </div>
              <button
                type="button"
                role="menuitem"
                data-act="open-writes"
                @click=${() => {
                  this.toggle(false);
                  app.openEditor('logic');
                  setKind(app, 'writes');
                }}
              >
                ${icon('plc')}${t('logic.chip.openWrites')}
              </button>
              <button
                type="button"
                role="menuitem"
                data-act="status"
                @click=${() => {
                  this.toggle(false);
                  refreshLive(app);
                }}
              >
                ${icon('logic')}${t('logic.chip.status')}
              </button>
              <button
                type="button"
                role="menuitem"
                data-act="stop"
                class=${chip.canStop ? 'danger' : ''}
                aria-disabled=${chip.canStop ? 'false' : 'true'}
                @click=${() => {
                  if (!chip.canStop) return;
                  this.toggle(false);
                  app.openDialog({ kind: 'logicStop' });
                }}
              >
                ${icon('stop')}${t('logic.chip.stop')}
              </button>
              <div class="note">${note}</div>
              <button type="button" role="menuitem" data-act="enable" aria-disabled="true">
                ${icon('plc')}${t('logic.chip.enable')}
              </button>
              <div class="note">${t('logic.chip.enableNote', { code: chip.enableBlocked })}</div>
            </div>`
          : nothing
      }
    </span>`;
  }
}

customElements.define('mat-logic-chip', LogicChipElement);

declare global {
  interface HTMLElementTagNameMap {
    'mat-logic-chip': LogicChipElement;
  }
}
