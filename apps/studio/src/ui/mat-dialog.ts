// Hộp thoại của Studio (feature 004, T052, T055, FR-024, FR-025, FR-034): vẽ theo `app.ui.dialog`.
// Focus giữ trong hộp thoại (Tab vòng), Esc đóng (= Hủy), mở thì focus nút chính, đóng thì trả focus về
// chỗ cũ. Mỗi lúc một hộp thoại; người dùng chọn thì gọi `app.answer`. Hộp thoại Online của feature 005
// (Thiết bị trong mạng, xác nhận chứng chỉ, đăng nhập) do ui/dialogs/* vẽ, không vẽ ở đây.
import { html, nothing } from 'lit';
import { isOnlineDialog, type CoreDialogSpec, type DialogChoice } from '../app/app.ts';
import { COMMANDS } from '../app/commands.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import type { IconName } from '../icons/icons.ts';
import { AppElement, icon } from './base.ts';

interface Action {
  choice: DialogChoice;
  label: MessageKey;
  primary?: boolean;
}

/** Phiên bản WebView2 (Edge/Chromium) đọc từ user agent. */
export function webviewVersion(ua: string): string | null {
  return (/Edg\/([\d.]+)/.exec(ua) ?? /Chrome\/([\d.]+)/.exec(ua))?.[1] ?? null;
}

export class MatDialog extends AppElement {
  private shown: CoreDialogSpec | null = null;
  private returnFocus: HTMLElement | null = null;

  private actions(spec: CoreDialogSpec): Action[] {
    switch (spec.kind) {
      case 'unsaved':
        return [
          { choice: 'save', label: 'dlg.unsaved.save', primary: true },
          { choice: 'discard', label: 'dlg.unsaved.discard' },
          { choice: 'cancel', label: 'dlg.cancel' },
        ];
      case 'conflict':
        return [
          { choice: 'overwrite', label: 'dlg.conflict.overwrite' },
          { choice: 'reload', label: 'dlg.conflict.reload' },
          { choice: 'cancel', label: 'dlg.cancel', primary: true },
        ];
      default:
        return [{ choice: 'ok', label: 'dlg.close', primary: true }];
    }
  }

  private head(spec: CoreDialogSpec): { title: string; icon: IconName } {
    switch (spec.kind) {
      case 'unsaved':
        return { title: t('dlg.unsaved.title'), icon: 'save' };
      case 'conflict':
        return { title: t('dlg.conflict.title'), icon: 'warn' };
      case 'saveError':
        return { title: t('dlg.saveError.title'), icon: 'err' };
      case 'shortcuts':
        return { title: t('dlg.shortcuts.title'), icon: 'search' };
      case 'about':
        return { title: t('dlg.about.title'), icon: 'info' };
    }
  }

  private body(spec: CoreDialogSpec) {
    switch (spec.kind) {
      case 'unsaved':
        return html`<p>${t('dlg.unsaved.text', { files: spec.files.join(', ') })}</p>`;
      case 'conflict':
        return html`<p>${t('dlg.conflict.text', { file: spec.rel })}</p>`;
      case 'saveError':
        return html`<p>${t('dlg.saveError.text', { file: spec.rel, reason: spec.reason })}</p>`;
      case 'shortcuts': {
        const rows: Array<[string, string]> = COMMANDS.filter((c) => c.shortcut).map((c) => [
          c.shortcut!,
          t(c.label),
        ]);
        rows.push(['F2 / Enter', t('shortcut.editCell')], ['Ctrl+W', t('shortcut.closeTab')]);
        rows.push(['Esc', t('shortcut.escape')]);
        return html`<table class="grid dense kbd-table">
            <tbody>
              ${rows.map(
                ([k, v]) =>
                  html`<tr>
                    <td><kbd>${k}</kbd></td>
                    <td>${v}</td>
                  </tr>`,
              )}
            </tbody>
          </table>
          <p class="help">${t('dlg.shortcuts.note')}</p>`;
      }
      case 'about': {
        const info = this.app.ui.appInfo;
        const unknown = t('dlg.about.unknown');
        const rows: Array<[string, string]> = [
          [t('dlg.about.app'), info ? `${info.name} ${info.version}` : unknown],
          [t('dlg.about.tauri'), info?.tauri ?? unknown],
          [t('dlg.about.webview'), webviewVersion(navigator.userAgent) ?? unknown],
        ];
        if (this.app.platform.kind === 'mock')
          rows.push([t('dlg.about.mode'), t('dlg.about.mock')]);
        return html`<dl class="kvs">
          ${rows.map(
            ([k, v]) =>
              html`<dt>${k}</dt>
                <dd>${v}</dd>`,
          )}
        </dl>`;
      }
    }
  }

  private escapeChoice(spec: CoreDialogSpec): DialogChoice {
    return spec.kind === 'unsaved' || spec.kind === 'conflict' ? 'cancel' : 'ok';
  }

  private onKey(e: KeyboardEvent, spec: CoreDialogSpec): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.app.answer(this.escapeChoice(spec));
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = [
      ...this.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, [tabindex="0"]',
      ),
    ];
    if (!focusables.length) return;
    const i = focusables.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      focusables[focusables.length - 1].focus();
    } else if (!e.shiftKey && i === focusables.length - 1) {
      e.preventDefault();
      focusables[0].focus();
    }
  }

  /** Hộp thoại của 004 đang mở (hộp thoại Online thì `null`). */
  private core(): CoreDialogSpec | null {
    const d = this.app.ui.dialog;
    return d && !isOnlineDialog(d) ? d : null;
  }

  protected override updated(): void {
    const spec = this.core();
    if (spec && spec !== this.shown) {
      if (!this.shown) {
        const a = document.activeElement;
        this.returnFocus = a instanceof HTMLElement && !this.contains(a) ? a : null;
      }
      this.querySelector<HTMLElement>('.dlg-f .primary')?.focus();
    } else if (!spec && this.shown) {
      if (this.returnFocus?.isConnected) this.returnFocus.focus();
      this.returnFocus = null;
    }
    this.shown = spec;
  }

  protected override render() {
    const spec = this.core();
    if (!spec) return nothing;
    const head = this.head(spec);
    return html`<div class="overlay" @keydown=${(e: KeyboardEvent) => this.onKey(e, spec)}>
      <div class="dlg dlg-${spec.kind}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="dlg-h">
          ${icon(head.icon)}<span class="ttl" id="dlg-title">${head.title}</span>
          <button
            class="ibtn"
            type="button"
            aria-label=${t('dlg.close')}
            title=${t('dlg.closeTip')}
            @click=${() => this.app.answer(this.escapeChoice(spec))}
          >
            ${icon('x')}
          </button>
        </div>
        <div class="dlg-b">${this.body(spec)}</div>
        <div class="dlg-f">
          <span class="grow"></span>
          ${this.actions(spec).map(
            (a) =>
              html`<button
                class="btn ${a.primary ? 'primary' : ''}"
                type="button"
                data-choice=${a.choice}
                @click=${() => this.app.answer(a.choice)}
              >
                ${t(a.label)}
              </button>`,
          )}
        </div>
      </div>
    </div>`;
  }
}

customElements.define('mat-dialog', MatDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-dialog': MatDialog;
  }
}
