// Thanh công cụ (feature 004, T046, FR-001, FR-031): nhóm nút theo mockup bản 1. Nút nào cũng có
// aria-label và tooltip kèm phím tắt; lệnh bị khóa vẫn hiện (aria-disabled), nhấp vào thì báo lý do.
// Nạp xuống, Đọc lên, So sánh khóa với lý do "Có ở feature 005". Mẫu ARIA toolbar: một điểm dừng Tab,
// ← → Home End di chuyển giữa các nút.
import { html, nothing } from 'lit';
import { commandById, type CommandId } from '../app/commands.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import { AppElement, icon } from './base.ts';

interface ToolButton {
  cmd: CommandId;
  /** Chữ hiện cạnh icon; không có thì chỉ icon. */
  text?: MessageKey;
  icon?: IconName;
  /** Ẩn khi cửa sổ rất hẹp. */
  optional?: boolean;
}

const GROUPS: ReadonlyArray<readonly ToolButton[]> = [
  [
    { cmd: 'project.save' },
    { cmd: 'edit.undo', optional: true },
    { cmd: 'edit.redo', optional: true },
  ],
  [{ cmd: 'tools.validate', text: 'toolbar.validate' }],
  [
    { cmd: 'online.download', text: 'toolbar.download' },
    { cmd: 'online.upload', text: 'toolbar.upload' },
    { cmd: 'online.compare', text: 'toolbar.compare' },
  ],
];

export class MatToolbar extends AppElement {
  // Nút đầu (ngăn kéo cây) chỉ hiện khi cửa sổ hẹp: điểm dừng Tab mặc định là nút Lưu.
  private focusIdx = 1;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'toolbar');
    this.setAttribute('aria-label', t('shell.toolbar'));
    this.addEventListener('keydown', this.onKey);
    this.addEventListener('focusin', this.onFocusIn);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('keydown', this.onKey);
    this.removeEventListener('focusin', this.onFocusIn);
    super.disconnectedCallback();
  }

  private buttons(): HTMLElement[] {
    return [...this.querySelectorAll<HTMLElement>('button')].filter(
      (b) => b.offsetParent !== null || typeof window === 'undefined' || !b.closest('[hidden]'),
    );
  }

  private readonly onFocusIn = (e: FocusEvent): void => {
    const i = this.buttons().indexOf(e.target as HTMLElement);
    if (i >= 0 && i !== this.focusIdx) {
      this.focusIdx = i;
      this.requestUpdate();
    }
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    const list = this.buttons();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let j: number;
    if (e.key === 'ArrowRight') j = (i + 1) % list.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = list.length - 1;
    else return;
    e.preventDefault();
    list[j].focus();
  };

  private tooltip(cmd: CommandId, reason: string | null, tip?: MessageKey): string {
    const spec = commandById(cmd)!;
    const label = tip ? t(tip) : t(spec.label);
    const base =
      spec.shortcut && !tip ? t('shell.tooltip', { label, shortcut: spec.shortcut }) : label;
    return reason ? t('reason.locked', { label: base, reason }) : base;
  }

  private button(b: ToolButton, index: number) {
    const app = this.app;
    const spec = commandById(b.cmd)!;
    const enabled = app.enabled(b.cmd);
    const reason = enabled === true ? null : t(enabled);
    const tip = b.cmd === 'tools.validate' ? 'toolbar.validateTip' : undefined;
    return html`<button
      type="button"
      class="${b.text ? 'tbtn' : 'ibtn'} ${b.optional ? 'opt-s' : ''}"
      data-cmd=${b.cmd}
      tabindex=${index === this.focusIdx ? 0 : -1}
      aria-label=${b.text ? nothing : t(spec.label)}
      aria-disabled=${reason ? 'true' : nothing}
      title=${this.tooltip(b.cmd, reason, tip)}
      @click=${() => void app.run(b.cmd)}
    >
      ${icon(b.icon ?? spec.icon ?? 'info')} ${b.text ? html`<span>${t(b.text)}</span>` : nothing}
    </button>`;
  }

  protected override render() {
    const app = this.app;
    let n = 0;
    const online = app.online();
    const onlineCmd: CommandId = online ? 'online.disconnect' : 'online.connect';
    const onlineEnabled = app.enabled(onlineCmd);
    const onlineReason = onlineEnabled === true ? null : t(onlineEnabled);
    const simulate = app.enabled('tools.simulate');
    const idx = () => n++;
    return html`<button
        type="button"
        class="ibtn drawer-btn"
        tabindex=${idx() === this.focusIdx ? 0 : -1}
        aria-label=${t('shell.treeDrawer')}
        title=${t('shell.treeDrawer')}
        aria-expanded=${app.ui.treeDrawer ? 'true' : 'false'}
        @click=${() => app.setTreeDrawer(!app.ui.treeDrawer)}
      >
        ${icon('sidebar')}
      </button>
      ${GROUPS.map(
        (group, g) =>
          html`${g ? html`<div class="tsep" role="separator" aria-orientation="vertical"></div>` : nothing}
            <div class="tgroup">${group.map((b) => this.button(b, idx()))}</div>`,
      )}
      <div class="tsep" role="separator" aria-orientation="vertical"></div>
      <div class="tgroup">
        <button
          type="button"
          class="tbtn"
          data-cmd="online.toggle"
          tabindex=${idx() === this.focusIdx ? 0 : -1}
          aria-pressed=${online ? 'true' : 'false'}
          aria-disabled=${onlineReason ? 'true' : nothing}
          title=${
            onlineReason
              ? t('reason.locked', { label: t('toolbar.onlineTip'), reason: onlineReason })
              : t('toolbar.onlineTip')
          }
          @click=${() => void app.run(app.online() ? 'online.disconnect' : 'online.connect')}
        >
          ${icon(online ? 'offline' : 'online')}<span
            >${online ? t('toolbar.offline') : t('toolbar.online')}</span
          >
        </button>
        ${this.button({ cmd: 'online.device', text: 'toolbar.device' }, idx())}
        <button
          type="button"
          class="tbtn"
          data-cmd="tools.simulate"
          tabindex=${idx() === this.focusIdx ? 0 : -1}
          aria-pressed=${app.simulating() ? 'true' : 'false'}
          aria-disabled=${simulate === true ? nothing : 'true'}
          title=${this.tooltip('tools.simulate', simulate === true ? null : t(simulate))}
          @click=${() => void app.run('tools.simulate')}
        >
          ${icon('play')}<span>${t('toolbar.simulate')}</span>
        </button>
      </div>
      <div class="tspacer"></div>
      <button
        type="button"
        class="tsearch"
        data-cmd="view.palette"
        tabindex=${idx() === this.focusIdx ? 0 : -1}
        aria-label=${t('cmd.view.palette')}
        title=${t('shell.tooltip', { label: t('cmd.view.palette'), shortcut: 'Ctrl+Shift+P' })}
        @click=${() => void app.run('view.palette')}
      >
        ${icon('search')}<span>${t('shell.paletteButton')}</span><kbd>Ctrl+Shift+P</kbd>
      </button>`;
  }
}

customElements.define('mat-toolbar', MatToolbar);

declare global {
  interface HTMLElementTagNameMap {
    'mat-toolbar': MatToolbar;
  }
}
