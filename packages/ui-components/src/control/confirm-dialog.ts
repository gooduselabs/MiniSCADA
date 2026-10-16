// Hộp xác nhận ghi (FR-035; research R9; mockup studio-screens cảnh 2). role="alertdialog", bẫy focus,
// Hủy có focus ban đầu, Enter chỉ kích hoạt nút đang có focus, Esc hủy. Mọi chữ qua template Lit (không HTML thô).
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import type { ValueTable } from '@mat/expression';
import { formatValue } from '../format/format-value.ts';
import { DIALOG } from '../i18n/control-vi.ts';
import type { Draft } from './controller.ts';
import type { Lock } from './lock-reasons.ts';

let seq = 0;

/**
 * Bỏ nhấp chuột trong chừng này mili giây đầu sau khi hộp hiện (T041, FR-026, D32): nhấp đúp vào widget mở hộp và nhấp
 * thứ hai rơi đúng vào nút Xác nhận. Chỉ nhấp do chuột/chạm (`detail > 0`); phím (Enter, Esc) không bị chặn.
 */
export const CLICK_GUARD_MS = 400;

export class MatConfirmDialog extends LitElement {
  static override properties = {
    draft: { attribute: false },
    account: { attribute: false },
    lock: { attribute: false },
    limits: { attribute: false },
    table: { attribute: false },
    decimals: { attribute: false },
    onConfirm: { attribute: false },
    onCancel: { attribute: false },
  };

  declare draft: Draft | null;
  declare account: string;
  declare lock: Lock | null;
  declare limits: { min?: number; max?: number };
  declare table: ValueTable | null;
  declare decimals: number | undefined;
  declare onConfirm: (() => void) | null;
  declare onCancel: (() => void) | null;

  readonly #id = `mcd${++seq}`;
  #focused = false;
  #shownAt = 0;

  constructor() {
    super();
    this.draft = null;
    this.account = '';
    this.lock = null;
    this.limits = {};
    this.table = null;
    this.decimals = undefined;
    this.onConfirm = null;
    this.onCancel = null;
  }

  static override styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 2147483000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-scrim, rgba(12, 22, 26, 0.36));
      font-family: var(--mat-font, system-ui, sans-serif);
      color: var(--mat-text, #1a2225);
    }
    .dlg {
      box-sizing: border-box;
      width: min(440px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      overflow: auto;
      background: var(--mat-surface, #fff);
      border: 1px solid var(--mat-border, #d2d9dc);
      border-radius: calc(var(--mat-radius, 4px) * 2);
      box-shadow: var(--mat-shadow, 0 12px 32px rgba(16, 34, 42, 0.18));
      outline: none;
    }
    h2 {
      margin: 0;
      padding: 14px 16px 10px;
      font-size: 15px;
      font-weight: 600;
      border-bottom: 1px solid var(--mat-border, #d2d9dc);
    }
    .body {
      padding: 12px 16px;
      display: grid;
      gap: 10px;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 14px;
      margin: 0;
      font-size: 13px;
    }
    dt {
      color: var(--mat-text-muted, #56646a);
    }
    dd {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .mono {
      font-family: var(--mat-font-mono, monospace);
    }
    .num b {
      font-weight: 700;
    }
    p {
      margin: 0;
      font-size: 13px;
    }
    .warn,
    .lock {
      padding: 6px 8px;
      border-radius: var(--mat-radius, 4px);
      font-size: 13px;
    }
    .warn {
      background: var(--mat-warn-soft, #fbefcf);
      color: var(--mat-warn, #8f5e00);
    }
    .lock {
      background: var(--mat-bad-soft, #fbe1e1);
      color: var(--mat-bad, #c42b2b);
      font-weight: 600;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 16px 14px;
      border-top: 1px solid var(--mat-border, #d2d9dc);
    }
    button {
      font: inherit;
      font-size: 13px;
      min-width: 88px;
      padding: 7px 14px;
      border-radius: var(--mat-radius, 4px);
      border: 1px solid var(--mat-border-strong, #b3bec3);
      background: var(--mat-surface-2, #f5f7f8);
      color: var(--mat-text, #1a2225);
      cursor: pointer;
    }
    button.primary {
      background: var(--mat-accent, #0b7285);
      border-color: var(--mat-accent, #0b7285);
      color: var(--mat-accent-ink, #fff);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    button:focus-visible {
      outline: 2px solid var(--mat-info, #0b5cad);
      outline-offset: 2px;
    }
  `;

  protected override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (changed.has('draft') && this.draft) this.#shownAt = performance.now();
  }

  /** Nhấp chuột quá sớm sau khi hộp hiện: bỏ. */
  #early(e: MouseEvent): boolean {
    return e.detail > 0 && performance.now() - this.#shownAt < CLICK_GUARD_MS;
  }

  #cancelClick = (e: MouseEvent): void => {
    if (!this.#early(e)) this.onCancel?.();
  };

  #confirmClick = (e: MouseEvent): void => {
    if (!this.#early(e)) this.onConfirm?.();
  };

  protected override firstUpdated(): void {
    this.#focusCancel();
  }

  protected override updated(): void {
    if (!this.#focused) this.#focusCancel();
  }

  #focusCancel(): void {
    const b = this.renderRoot.querySelector<HTMLButtonElement>('[data-cancel]');
    if (b) {
      b.focus();
      this.#focused = true;
    }
  }

  #fmt(value: Draft['current'], d: Draft): string {
    const f = formatValue(value, d.info, {
      ...(this.decimals !== undefined ? { decimals: this.decimals } : {}),
      table: this.table,
      unit: null,
    });
    const u = d.info.unit;
    return u && !this.table ? `${f.text} ${u}` : f.text;
  }

  #buttons(): HTMLButtonElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => !b.disabled,
    );
  }

  #key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.onCancel?.();
    } else if (e.key === 'Enter') {
      // Chỉ nút đang có focus được kích hoạt; chặn hành vi gốc để không bấm hai lần.
      e.preventDefault();
      const a = this.renderRoot instanceof ShadowRoot ? this.renderRoot.activeElement : null;
      if (a instanceof HTMLButtonElement && !a.disabled) a.click();
    } else if (e.key === 'Tab') {
      const bs = this.#buttons();
      if (bs.length === 0) return;
      e.preventDefault();
      const root = this.renderRoot as ShadowRoot;
      const i = bs.indexOf(root.activeElement as HTMLButtonElement);
      const next = e.shiftKey
        ? i <= 0
          ? bs.length - 1
          : i - 1
        : i < 0 || i === bs.length - 1
          ? 0
          : i + 1;
      bs[next]?.focus();
    }
  };

  protected override render(): TemplateResult | typeof nothing {
    const d = this.draft;
    if (!d) return nothing;
    const spec = d.spec;
    const { min, max } = this.limits;
    const limitText =
      min !== undefined && max !== undefined
        ? `${min} – ${max}`
        : min !== undefined
          ? `≥ ${min}`
          : max !== undefined
            ? `≤ ${max}`
            : DIALOG.none;
    const next = this.#fmt({ value: spec.value, quality: 'GOOD' }, d);
    const cur = this.#fmt(d.current, d);
    const t = `${this.#id}-t`;
    const b = `${this.#id}-b`;
    return html`<div
      class="dlg"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby=${t}
      aria-describedby=${b}
      tabindex="-1"
      @keydown=${this.#key}
    >
      <h2 id=${t}>${DIALOG.title}</h2>
      <div class="body" id=${b}>
        <dl>
          <dt>${DIALOG.tag}</dt>
          <dd class="mono">${d.info.id}</dd>
          ${
            d.info.description
              ? html`<dt>${DIALOG.description}</dt>
                  <dd>${d.info.description}</dd>`
              : nothing
          }
          ${
            d.info.deviceName
              ? html`<dt>${DIALOG.device}</dt>
                  <dd>${d.info.deviceName}</dd>`
              : nothing
          }
          <dt>${DIALOG.value}</dt>
          <dd class="num" data-value>${cur} → <b>${next}</b></dd>
          <dt>${DIALOG.unit}</dt>
          <dd>${d.info.unit || DIALOG.none}</dd>
          <dt>${DIALOG.limits}</dt>
          <dd>${limitText}</dd>
          <dt>${DIALOG.account}</dt>
          <dd>${this.account}</dd>
        </dl>
        ${spec.kind === 'pulse' && spec.pulseMs !== undefined ? html`<p>${DIALOG.pulse(spec.pulseMs)}</p>` : nothing}
        ${d.text ? html`<p data-text>${d.text}</p>` : nothing}
        ${d.current.quality === 'UNCERTAIN' ? html`<p class="warn">${DIALOG.uncertain}</p>` : nothing}
        ${this.lock ? html`<p class="lock" role="alert">${this.lock.message}</p>` : nothing}
      </div>
      <div class="foot">
        <button type="button" data-cancel @click=${this.#cancelClick}>${DIALOG.cancel}</button>
        <button
          type="button"
          class="primary"
          data-ok
          ?disabled=${this.lock !== null}
          @click=${this.#confirmClick}
        >
          ${DIALOG.confirm}
        </button>
      </div>
    </div>`;
  }
}

if (!customElements.get('mat-confirm-dialog'))
  customElements.define('mat-confirm-dialog', MatConfirmDialog);
