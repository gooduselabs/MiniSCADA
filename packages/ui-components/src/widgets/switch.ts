// Widget `switch` (FR-028): trạng thái hiện là giá trị thật đọc từ Tag; khi vừa gửi hiện "đang chuyển"
// tới khi đọc lại khớp hoặc hết thời gian. Ghi giá trị đối lập kèm `expect` (kind `toggle`).
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

const SWITCHING_MS = 10_000;
const SWITCHING_TEXT = 'Đang chuyển…';

export class MatWSwitch extends ControlWidget {
  static override styles = [
    widgetStyles,
    controlStyles,
    css`
      .sw {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 2px 0;
      }
      .track {
        flex: none;
        width: 34px;
        height: 18px;
        border-radius: 9px;
        background: var(--mat-border-strong, #b3bec3);
        position: relative;
        transition: background 0.15s;
      }
      .thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--mat-surface, #fff);
        transition: left 0.15s;
      }
      .sw[aria-checked='true'] .track {
        background: var(--mat-good, #15703a);
      }
      .sw[aria-checked='true'] .thumb {
        left: 18px;
      }
      .sw[aria-busy='true'] .track {
        background: var(--mat-warn, #8f5e00);
      }
      .txt {
        font-weight: 600;
      }
    `,
  ];

  #pending: boolean | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  #clear(): void {
    this.#pending = null;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  protected override willUpdate(ch: PropertyValues): void {
    super.willUpdate(ch);
    const st = this.cstate;
    const id = this.tagId;
    const value = id ? this.source?.get(id).value : null;
    if (st?.phase === 'sending') {
      this.#pending = st.draft.spec.value === true;
      if (!this.#timer) {
        this.#timer = setTimeout(() => {
          this.#timer = null;
          this.#pending = null;
          this.requestUpdate();
        }, SWITCHING_MS);
      }
    } else if (
      st?.phase === 'result' &&
      st.outcome.status !== 'CONFIRMED' &&
      st.outcome.status !== 'ACCEPTED'
    ) {
      this.#clear();
    }
    if (this.#pending !== null && value === this.#pending) this.#clear();
  }

  override disconnectedCallback(): void {
    this.#clear();
    super.disconnectedCallback();
  }

  get #switching(): boolean {
    return this.#pending !== null;
  }

  #toggle = (): void => {
    const id = this.tagId;
    if (!this.ctl || !this.ready || this.#switching || !id) return;
    const cur = this.source.get(id).value === true;
    this.ctl.propose('toggle', !cur);
  };

  #key = (e: KeyboardEvent): void => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.#toggle();
    }
  };

  protected override renderWidget(): TemplateResult | typeof nothing {
    const id = this.tagId;
    const on = id ? this.source.get(id).value === true : false;
    const label = this.prop('label', '');
    const name = this.nameOf(id);
    const text = this.#switching
      ? SWITCHING_TEXT
      : on
        ? this.prop('onText', 'Bật')
        : this.prop('offText', 'Tắt');
    const disabled = this.mode !== 'run' || !this.ready || this.#switching;
    return this.frame(
      html`<div
        class="sw"
        role="switch"
        tabindex=${this.mode === 'run' ? 0 : -1}
        data-main
        aria-checked=${on ? 'true' : 'false'}
        aria-label=${name}
        aria-busy=${this.#switching ? 'true' : 'false'}
        aria-disabled=${disabled ? 'true' : 'false'}
        aria-describedby=${this.describedBy() ?? nothing}
        @click=${this.#toggle}
        @keydown=${this.#key}
      >
        <span class="track" aria-hidden="true"><span class="thumb"></span></span>
        <span class="txt"
          >${label ? html`<span class="muted">${label}: </span>` : nothing}${text}</span
        >
      </div>`,
    );
  }
}

if (!customElements.get('mat-w-switch')) customElements.define('mat-w-switch', MatWSwitch);
