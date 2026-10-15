// Bộ chọn Tag gọn dùng trong inspector SVG (feature 008, T072/T074/T081): ô tìm kèm danh sách `listbox` các Tag hợp (tối đa 60
// dòng; gõ thêm cho hẹp). Dùng khi không kéo thả được (bàn phím) và cho nút Gợi ý. ARIA: `combobox` + `listbox` (aria-activedescendant),
// ↑↓ di chuyển, Enter chọn, Esc đóng. Phát `choose` (detail: id Tag) hoặc `cancel`.
import { html, nothing } from 'lit';
import { fold, t } from '../i18n/index.ts';
import type { TagInfo } from '../model/screen-catalog.ts';
import { AppElement, icon } from './base.ts';

export const CHOOSER_MAX = 60;

let seq = 0;

export class MatTagChooser extends AppElement {
  static override properties = {
    accept: { attribute: false },
    label: { attribute: false },
    query: { state: true },
    cursor: { state: true },
  };

  /** Tag có được chọn không (loại phần tử, kiểu, quyền ghi...). */
  declare accept: (tag: TagInfo) => boolean;
  declare label: string;
  declare query: string;
  declare cursor: number;

  private readonly uid = `tc${++seq}`;

  constructor() {
    super();
    this.accept = () => true;
    this.label = '';
    this.query = '';
    this.cursor = 0;
  }

  protected override firstUpdated(): void {
    this.querySelector<HTMLInputElement>('input')?.focus();
  }

  private list(): { tags: TagInfo[]; total: number } {
    const q = fold(this.query.trim());
    let total = 0;
    const tags: TagInfo[] = [];
    for (const tag of this.app.screens.tagInfos().values()) {
      if (!this.accept(tag)) continue;
      if (q !== '' && !fold(tag.id).includes(q)) continue;
      total++;
      if (tags.length < CHOOSER_MAX) tags.push(tag);
    }
    return { tags, total };
  }

  private fire(name: 'choose' | 'cancel', id?: string): void {
    this.dispatchEvent(new CustomEvent(name, { detail: { id }, bubbles: false, composed: false }));
  }

  private onKey(e: KeyboardEvent, tags: readonly TagInfo[]): void {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.cursor = Math.min(tags.length - 1, this.cursor + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.cursor = Math.max(0, this.cursor - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const tag = tags[this.cursor];
      if (tag) this.fire('choose', tag.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.fire('cancel');
    }
  }

  protected override render() {
    const { tags, total } = this.list();
    if (this.cursor >= tags.length) this.cursor = Math.max(0, tags.length - 1);
    const listId = `${this.uid}-list`;
    const opt = (i: number) => `${this.uid}-o${i}`;
    return html`<div class="tc">
      <div class="tc-h">
        <input
          class="sv-in tc-q"
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls=${listId}
          aria-autocomplete="list"
          aria-activedescendant=${tags.length > 0 ? opt(this.cursor) : nothing}
          aria-label=${this.label || t('tc.label')}
          placeholder=${t('tc.hint')}
          .value=${this.query}
          @input=${(e: Event) => {
            this.query = (e.target as HTMLInputElement).value;
            this.cursor = 0;
          }}
          @keydown=${(e: KeyboardEvent) => this.onKey(e, tags)}
        />
        <button
          type="button"
          class="ibtn sm"
          aria-label=${t('tc.close')}
          @click=${() => this.fire('cancel')}
        >
          ${icon('x')}
        </button>
      </div>
      ${
        tags.length > 0
          ? html`<ul class="tc-list" id=${listId} role="listbox" aria-label=${t('tc.list')}>
              ${tags.map(
                (tag, i) =>
                  html`<li
                    id=${opt(i)}
                    role="option"
                    class="tc-opt ${i === this.cursor ? 'cur' : ''}"
                    aria-selected=${i === this.cursor ? 'true' : 'false'}
                    data-tag=${tag.id}
                    @mousedown=${(e: Event) => e.preventDefault()}
                    @click=${() => this.fire('choose', tag.id)}
                  >
                    <span class="mono">${tag.id}</span>
                    <span class="tc-t">${tag.type}${tag.unit ? ` · ${tag.unit}` : ''}</span>
                  </li>`,
              )}
            </ul>`
          : html`<p class="sv-hint" role="status">${t('tc.none')}</p>`
      }
      ${total > tags.length ? html`<p class="sv-hint" role="status">${t('tc.more', { n: total - tags.length })}</p>` : nothing}
    </div>`;
  }
}

customElements.define('mat-tag-chooser', MatTagChooser);

declare global {
  interface HTMLElementTagNameMap {
    'mat-tag-chooser': MatTagChooser;
  }
}
