// Widget `slider` (FR-028): kéo chỉ đổi hiển thị; thả (sự kiện change) mới đề xuất ghi, qua hộp xác nhận.
// Hiện giá trị đang kéo cạnh giá trị thật của Tag.
import { css, html, nothing, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { formatValue } from '../format/format-value.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

export class MatWSlider extends ControlWidget {
  static override styles = [
    widgetStyles,
    controlStyles,
    css`
      input[type='range'] {
        width: 100%;
        accent-color: var(--mat-accent, #0b7285);
      }
      .vertical input[type='range'] {
        writing-mode: vertical-lr;
        direction: rtl;
        height: 100%;
        width: auto;
      }
      .vals {
        font-size: 11px;
        font-family: var(--mat-font-mono, monospace);
        font-variant-numeric: tabular-nums;
        color: var(--mat-text-muted, #56646a);
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
    `,
  ];

  #drag: number | null = null;

  protected override settled(): void {
    this.#drag = null;
  }

  #step(): number {
    const s = this.optNum('step');
    if (s !== undefined && s > 0) return s;
    return 10 ** -this.decimals(this.tagId ? this.source.info(this.tagId) : undefined);
  }

  #onInput = (e: Event): void => {
    this.#drag = Number((e.target as HTMLInputElement).value);
    this.requestUpdate();
  };

  #onChange = (e: Event): void => {
    const v = Number((e.target as HTMLInputElement).value);
    this.#drag = v;
    if (!this.ctl || !this.ready || !this.ctl.propose('write', v)) {
      this.#drag = null;
    }
    this.requestUpdate();
  };

  protected override renderWidget(): TemplateResult | typeof nothing {
    const id = this.tagId;
    const info = id ? this.source.info(id) : undefined;
    const st = id ? this.source.get(id) : { value: null, quality: 'UNKNOWN' as const };
    const lim = this.limits();
    const min = lim.min ?? 0;
    const max = lim.max ?? 100;
    const dec = this.decimals(info);
    const unit = this.prop('unit', info?.unit ?? '');
    const real = typeof st.value === 'number' ? st.value : null;
    const pos = this.#drag ?? real ?? min;
    const fmt = (n: number) =>
      formatValue({ value: n, quality: 'GOOD' }, info, { decimals: dec, unit: null }).text;
    const u = unit ? ` ${unit}` : '';
    const disabled = this.mode !== 'run' || !this.ready;
    return this.frame(
      html`${this.renderName()}
        <div
          class=${this.prop<string>('orientation', 'horizontal') === 'vertical' ? 'vertical' : ''}
        >
          <input
            type="range"
            data-main
            min=${min}
            max=${max}
            step=${this.#step()}
            aria-label=${this.nameOf(id)}
            aria-describedby=${this.describedBy() ?? nothing}
            ?disabled=${disabled}
            @input=${this.#onInput}
            @change=${this.#onChange}
            .value=${String(pos)}
          />
        </div>
        <div class="vals">
          ${this.#drag !== null ? html`<span>Đang kéo ${fmt(this.#drag)}${u}</span>` : nothing}
          <span>Thực tế ${real !== null ? fmt(real) + u : '—'}</span>
        </div>`,
    );
  }
}

if (!customElements.get('mat-w-slider')) customElements.define('mat-w-slider', MatWSlider);
