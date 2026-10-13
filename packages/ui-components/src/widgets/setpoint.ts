// Widget `setpoint` (FR-028, FR-035): ô nhập số, Enter hoặc nút Ghi → hộp xác nhận. Dấu thập phân là dấu chấm
// (dấu phẩy bị từ chối bởi ControlController). Giới hạn = giao của widget và Tag; bước kiểm ở đây.
import { css, html, nothing, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { formatValue } from '../format/format-value.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

const NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export class MatWSetpoint extends ControlWidget {
  static override styles = [
    widgetStyles,
    controlStyles,
    css`
      input {
        flex: 1;
        min-width: 0;
        padding: 4px 6px;
        border-radius: var(--mat-radius, 4px);
        border: 1px solid var(--mat-border-strong, #b3bec3);
        background: var(--mat-surface, #fff);
        font-family: var(--mat-font-mono, monospace);
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .unit {
        flex: none;
        color: var(--mat-text-muted, #56646a);
      }
      button {
        flex: none;
        padding: 4px 10px;
        border-radius: var(--mat-radius, 4px);
        border: 1px solid var(--mat-accent, #0b7285);
        background: var(--mat-accent, #0b7285);
        color: var(--mat-accent-ink, #fff);
        cursor: pointer;
      }
      .hint {
        font-size: 11px;
        color: var(--mat-text-muted, #56646a);
      }
    `,
  ];

  #text: string | null = null;

  protected override settled(): void {
    this.#text = null;
  }

  #decimals(): number {
    return this.decimals(this.tagId ? this.source.info(this.tagId) : undefined);
  }

  #shown(): string {
    if (this.#text !== null) return this.#text;
    const id = this.tagId;
    if (!id) return '';
    const st = this.source.get(id);
    if (st.value === null || st.value === undefined) return '';
    return formatValue(st, this.source.info(id), { decimals: this.#decimals(), unit: null }).text;
  }

  #input = (e: Event): void => {
    this.#text = (e.target as HTMLInputElement).value;
    if (this.ctl) this.ctl.error = null;
    this.requestUpdate();
  };

  #key = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.#submit();
    }
  };

  #submit = (): void => {
    const c = this.ctl;
    if (!c || !this.ready || this.#text === null) return;
    const text = this.#text.trim();
    if (!text.includes(',') && NUM_RE.test(text)) {
      const step = this.optNum('step') ?? 10 ** -this.#decimals();
      if (step > 0) {
        const base = this.limits().min ?? 0;
        const ratio = (Number(text) - base) / step;
        if (Math.abs(ratio - Math.round(ratio)) > 1e-6) {
          c.error = `Giá trị phải là bội số của ${Number(step.toPrecision(12))}`;
          this.requestUpdate();
          return;
        }
      }
    }
    c.propose('write', text);
  };

  protected override renderWidget(): TemplateResult | typeof nothing {
    const id = this.tagId;
    const info = id ? this.source.info(id) : undefined;
    const unit = this.prop('unit', info?.unit ?? '');
    const lim = this.limits();
    const hint =
      lim.min !== undefined && lim.max !== undefined
        ? `${lim.min} – ${lim.max}${unit ? ' ' + unit : ''}`
        : '';
    const disabled = this.mode !== 'run' || !this.ready;
    return this.frame(
      html`${this.renderName()}
        <div class="row">
          <input
            type="text"
            inputmode="decimal"
            autocomplete="off"
            data-main
            aria-label=${this.nameOf(id)}
            aria-describedby=${this.describedBy() ?? nothing}
            .value=${this.#shown()}
            ?disabled=${disabled}
            @input=${this.#input}
            @keydown=${this.#key}
          />
          ${unit ? html`<span class="unit">${unit}</span>` : nothing}
          <button type="button" data-write ?disabled=${disabled} @click=${this.#submit}>Ghi</button>
        </div>
        ${hint ? html`<div class="hint">${hint}</div>` : nothing}`,
    );
  }
}

if (!customElements.get('mat-w-setpoint')) customElements.define('mat-w-setpoint', MatWSetpoint);
