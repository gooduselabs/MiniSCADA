// Khung chung của ba hộp thoại Online (feature 005, US1; hàm dialog() của mockup đã duyệt, mat-dialog của
// 004): overlay, hộp (role dialog, aria-modal, nhãn là tiêu đề), đầu (icon, tiêu đề, nút đóng), thân, chân.
// Focus giữ trong hộp (Tab vòng), Esc đóng, mở thì focus vào ô hoặc nút chính, đóng thì trả focus về chỗ cũ.
// Mỗi hộp thoại hiện khi `app.ui.dialog.kind` là loại của nó.
import { html, nothing, type TemplateResult } from 'lit';
import type { OnlineDialogSpec } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import { AppElement, icon } from '../base.ts';
import './online-dialogs.css';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]';

export interface FrameParts {
  title: string;
  icon: IconName;
  body: unknown;
  foot: unknown;
  /** Đang chờ thiết bị: `aria-busy` trên hộp. */
  busy?: boolean;
  /** Không đóng được (thao tác đang chạy trên thiết bị): nút đóng của đầu hộp thoại bị khóa. */
  closeDisabled?: boolean;
}

export abstract class OnlineDialog extends AppElement {
  /** Loại hộp thoại của thành phần (theo `app.ui.dialog.kind`). */
  protected abstract readonly kind: OnlineDialogSpec['kind'];
  private shownOpen = false;
  private returnFocus: HTMLElement | null = null;

  protected get isOpen(): boolean {
    return this.hasApp && this.app.ui.dialog?.kind === this.kind;
  }

  /** Esc và nút đóng của đầu hộp thoại. */
  protected close(): void {
    this.app.closeOnlineDialog();
  }

  /** Mở hộp thoại thì focus vào đây; mặc định nút chính của chân, rồi ô nhập đầu tiên. */
  protected initialFocus(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>('.dlg-f .primary:not([disabled])') ??
      this.querySelector<HTMLElement>('.dlg-b input:not([disabled]), .dlg-b select, .dlg-b button')
    );
  }

  /** Gọi khi hộp thoại vừa mở (đặt lại trạng thái riêng của lần mở). */
  protected opened(): void {}

  protected override willUpdate(): void {
    const open = this.isOpen;
    if (open && !this.shownOpen) {
      const a = document.activeElement;
      this.returnFocus = a instanceof HTMLElement && !this.contains(a) ? a : null;
      this.opened();
    }
  }

  protected override updated(): void {
    const open = this.isOpen;
    if (open && !this.shownOpen) {
      (this.initialFocus() ?? this.querySelector<HTMLElement>('.dlg-h .ibtn'))?.focus();
    } else if (open) {
      // Phần tử đang có focus bị vẽ lại mất (ví dụ xong bước dò chứng chỉ): đưa focus về lại hộp thoại.
      const a = document.activeElement;
      if (!a || a === document.body)
        (this.initialFocus() ?? this.querySelector<HTMLElement>('.dlg-h .ibtn'))?.focus();
    } else if (!open && this.shownOpen) {
      // Hộp thoại Online khác mở tiếp (bước sau) thì nó tự lấy focus; không thì trả về chỗ cũ.
      if (!this.app.ui.dialog && this.returnFocus?.isConnected) this.returnFocus.focus();
      this.returnFocus = null;
    }
    this.shownOpen = open;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...this.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      items[items.length - 1].focus();
    } else if (!e.shiftKey && i === items.length - 1) {
      e.preventDefault();
      items[0].focus();
    }
  }

  protected frame(p: FrameParts): TemplateResult {
    const id = `${this.kind}-dlg-title`;
    return html`<div class="overlay" @keydown=${(e: KeyboardEvent) => this.onKey(e)}>
      <div
        class="dlg dlg-online"
        role="dialog"
        aria-modal="true"
        aria-labelledby=${id}
        aria-busy=${p.busy ? 'true' : nothing}
      >
        <div class="dlg-h">
          ${icon(p.icon)}<span class="ttl" id=${id}>${p.title}</span>
          <button
            class="ibtn"
            type="button"
            ?disabled=${p.closeDisabled}
            aria-label=${t('dlg.close')}
            title=${t('dlg.closeTip')}
            @click=${() => this.close()}
          >
            ${icon('x')}
          </button>
        </div>
        <div class="dlg-b">${p.body}</div>
        <div class="dlg-f">${p.foot}</div>
      </div>
    </div>`;
  }
}

/** Fingerprint 64 hex → chữ hoa, nhóm theo cặp cách nhau một khoảng, 8 cặp mỗi dòng (như mockup). */
export function groupFingerprint(hex: string): string {
  const pairs = hex.toUpperCase().match(/[0-9A-F]{2}/g) ?? [];
  const lines: string[] = [];
  for (let i = 0; i < pairs.length; i += 8) lines.push(pairs.slice(i, i + 8).join(' '));
  return lines.join('\n');
}
