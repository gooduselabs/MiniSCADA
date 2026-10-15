// Thanh Thử giá trị (feature 008, T073; D28; contract studio-svg-editor §7; mockup studio-svg cảnh 2): đặt giá trị cho Tag của
// dòng đang chọn để thấy ngay hiệu ứng trên canvas. Điều khiển theo kiểu Tag (BOOL công tắc, số thanh trượt kèm ô số, bảng
// giá trị danh sách chọn, chuỗi ô chữ). Giá trị đi vào SimEngine qua `TestStrip` của model (khôi phục khi Đặt lại, bỏ chọn, thoát
// item hoặc đóng editor); không ghi project, không tới thiết bị, kể cả khi Online. Giá trị hiện tại dùng bộ phận `mat-live-value`.
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../i18n/index.ts';
import type { TagInfo } from '../model/screen-catalog.ts';
import { controlFor, type TestControl } from '../model/test-strip.ts';
import { AppElement, icon } from './base.ts';

type Value = boolean | number | string;

export interface TestEntries {
  value: number | boolean;
  text: string;
}

export class MatTestStrip extends AppElement {
  static override properties = {
    tag: { attribute: false },
    range: { attribute: false },
    entries: { attribute: false },
    refusal: { state: true },
  };

  declare tag: TagInfo | null;
  /** Khoảng của thanh trượt: `inMin`/`inMax` của binding, vắng thì `min`/`max` của Tag. */
  declare range: readonly [number, number] | undefined;
  declare entries: readonly TestEntries[] | undefined;
  declare refusal: string | null;

  constructor() {
    super();
    this.tag = null;
    this.range = undefined;
    this.entries = undefined;
    this.refusal = null;
  }

  private current(tag: TagInfo): Value | undefined {
    const ws = this.app.screens;
    if (ws.testActive.includes(tag.id)) return this.app.simulation.read(tag.id)?.value ?? undefined;
    return undefined;
  }

  private set(tag: TagInfo, value: Value): void {
    const r = this.app.screens.testSet(tag.id, value);
    this.refusal = r.ok ? null : t(`svg.test.refuse.${r.reason}` as MessageKey);
    this.requestUpdate();
  }

  private reset(tag: TagInfo): void {
    this.app.screens.testReset(tag.id);
    this.refusal = null;
  }

  private control(tag: TagInfo, c: TestControl): unknown {
    const cur = this.current(tag);
    switch (c.kind) {
      case 'switch': {
        const on = cur === true;
        return html`<button
            type="button"
            class="tgl"
            role="switch"
            aria-checked=${on ? 'true' : 'false'}
            aria-label=${t('ts.switchLabel', { tag: tag.id })}
            @click=${() => this.set(tag, !on)}
          ></button
          ><span class="ts-val">${on ? t('svg.on') : t('svg.off')}</span>`;
      }
      case 'slider': {
        const v = typeof cur === 'number' ? cur : c.min;
        return html`<input
            class="ts-range"
            type="range"
            min=${c.min}
            max=${c.max}
            step=${c.step}
            .value=${String(v)}
            aria-label=${t('ts.sliderLabel', { tag: tag.id })}
            @input=${(e: Event) => this.set(tag, Number((e.target as HTMLInputElement).value))}
          /><input
            class="sv-in num ts-num"
            inputmode="decimal"
            .value=${String(v)}
            aria-label=${t('ts.numberLabel', { tag: tag.id })}
            @change=${(e: Event) => {
              const el = e.target as HTMLInputElement;
              const raw = el.value.trim();
              const n = Number(raw);
              if (raw === '' || raw.includes(',') || !Number.isFinite(n)) {
                this.refusal = t('ts.badNumber');
                return;
              }
              this.set(tag, n);
            }}
          />`;
      }
      case 'select':
        return html`<select
          class="sv-in ts-sel"
          aria-label=${t('ts.selectLabel', { tag: tag.id })}
          @change=${(e: Event) => {
            const v = c.options[Number((e.target as HTMLSelectElement).value)]?.value;
            if (v !== undefined && v !== null) this.set(tag, v);
          }}
        >
          ${
            cur === undefined
              ? html`<option value="-1" selected disabled>${t('ts.pick')}</option>`
              : nothing
          }
          ${c.options.map(
            (o, i) =>
              html`<option value=${i} ?selected=${o.value === cur}>${o.value} · ${o.text}</option>`,
          )}
        </select>`;
      case 'text':
        return html`<input
          class="sv-in ts-txt"
          .value=${typeof cur === 'string' ? cur : ''}
          aria-label=${t('ts.textLabel', { tag: tag.id })}
          @change=${(e: Event) => this.set(tag, (e.target as HTMLInputElement).value)}
        />`;
    }
  }

  protected override render() {
    const tag = this.tag;
    if (tag === null) return nothing;
    const c = controlFor(tag, {
      ...(this.range ? { range: this.range } : {}),
      ...(this.entries ? { entries: this.entries } : {}),
    });
    const active = this.app.screens.testActive.includes(tag.id);
    return html`<div class="teststrip" role="group" aria-label=${t('ts.label')}>
      <span class="lb">${icon('play')}${t('ts.title')}</span>
      <span class="mono ts-tag" title=${tag.id}>${tag.id}</span>
      ${this.control(tag, c)}
      ${
        this.refusal
          ? html`<small class="ts-err" role="alert">${this.refusal}</small>`
          : html`<small>${active ? t('ts.active') : t('ts.note')}</small>`
      }
      <button
        type="button"
        class="btn sm ts-reset"
        ?disabled=${!active}
        @click=${() => this.reset(tag)}
      >
        ${t('ts.reset')}
      </button>
    </div>`;
  }
}

customElements.define('mat-test-strip', MatTestStrip);

declare global {
  interface HTMLElementTagNameMap {
    'mat-test-strip': MatTestStrip;
  }
}
