// Widget `select` (FR-028): mục theo bảng giá trị (`props.table` hoặc bảng của Tag); chọn một mục thì đề xuất ghi
// giá trị của mục, qua hộp xác nhận. Mục đang chọn luôn khớp giá trị thật của Tag.
import type { ValueTable, VtEntry } from '@mat/expression';
import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { ControlWidget, controlStyles } from '../control/control-widget.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

const asNum = (x: unknown): number => (typeof x === 'boolean' ? (x ? 1 : 0) : Number(x));

export class MatWSelect extends ControlWidget {
  static override styles = [widgetStyles, controlStyles];

  #picked: number | null = null;

  protected override settled(): void {
    this.#picked = null;
  }

  #entries(): VtEntry[] {
    const id = this.tagId;
    const info = id ? this.source.info(id) : undefined;
    const name = this.prop('table', '') || info?.valueTable || '';
    const t: ValueTable | undefined = name ? this.source.valueTable(name) : undefined;
    return (t?.entries ?? []).filter((e) => e.value !== undefined);
  }

  #realIndex(entries: VtEntry[]): number {
    const id = this.tagId;
    const v = id ? this.source.get(id).value : null;
    if (v === null || v === undefined) return -1;
    const n = asNum(v);
    return entries.findIndex((e) => asNum(e.value) === n);
  }

  #onChange = (e: Event): void => {
    const entries = this.#entries();
    const idx = Number((e.target as HTMLSelectElement).value);
    const entry = entries[idx];
    if (!entry || !this.ctl || !this.ready) {
      this.#picked = null;
      this.requestUpdate();
      return;
    }
    const id = this.tagId;
    const isBool = id ? this.source.info(id)?.type === 'BOOL' : false;
    const value = isBool ? asNum(entry.value) !== 0 : asNum(entry.value);
    this.#picked = idx;
    if (!this.ctl.propose('write', value)) this.#picked = null;
    this.requestUpdate();
  };

  protected override updated(ch: PropertyValues): void {
    super.updated(ch);
    // Giữ mục đang chọn khớp giá trị thật (hoặc mục vừa chọn khi chờ xác nhận), kể cả sau khi Hủy.
    const s = this.renderRoot.querySelector<HTMLSelectElement>('select');
    if (!s) return;
    const entries = this.#entries();
    const idx = this.#picked ?? this.#realIndex(entries);
    s.value = idx >= 0 ? String(idx) : '';
  }

  protected override renderWidget(): TemplateResult | typeof nothing {
    const entries = this.#entries();
    const idx = this.#picked ?? this.#realIndex(entries);
    const disabled = this.mode !== 'run' || !this.ready || entries.length === 0;
    return this.frame(
      html`${this.renderName()}
        <select
          data-main
          aria-label=${this.nameOf(this.tagId)}
          aria-describedby=${this.describedBy() ?? nothing}
          ?disabled=${disabled}
          @change=${this.#onChange}
        >
          ${entries.length > 0 && idx < 0 ? html`<option value="" disabled selected>—</option>` : nothing}
          ${entries.map((e, i) => html`<option value=${i} ?selected=${i === idx}>${e.text}</option>`)}
        </select>`,
    );
  }
}

if (!customElements.get('mat-w-select')) customElements.define('mat-w-select', MatWSelect);
