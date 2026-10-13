// Bảng lệnh Ctrl+Shift+P (feature 004, T052, FR-009, contracts/commands.md): ô tìm (combobox) và danh
// sách lệnh (listbox). Tìm theo nhãn, có dấu hay không dấu đều khớp (palette.ts); ↑ ↓ chọn, Enter chạy,
// Esc đóng. Lệnh bị khóa vẫn hiện kèm lý do; Enter trên lệnh bị khóa chỉ báo lý do.
import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { paletteEntries, searchPalette, type PaletteEntry } from '../app/palette.ts';
import { t } from '../i18n/index.ts';
import { AppElement } from './base.ts';

const optionId = (i: number) => `pal-opt-${i}`;

export class MatPalette extends AppElement {
  private query = '';
  private sel = 0;
  private wasOpen = false;
  private returnFocus: HTMLElement | null = null;
  private items: PaletteEntry[] = [];

  private entries(): PaletteEntry[] {
    const app = this.app;
    const screens = app.store.state.outline.screens.map((s) => ({
      id: s.id,
      name: s.screen && typeof s.screen.name === 'string' && s.screen.name ? s.screen.name : s.id,
    }));
    const tables = {
      valueTables: app.store.state.outline.valueTables.map((v) => v.name),
      watchTables: app.store.state.outline.watchTables.map((w) => ({
        id: w.id,
        name: w.doc && typeof w.doc.name === 'string' && w.doc.name ? w.doc.name : w.id,
      })),
    };
    return searchPalette(paletteEntries(app.commandContext(), screens, tables), this.query);
  }

  private close(): void {
    this.app.closePalette();
  }

  private runAt(i: number): void {
    const entry = this.items[i];
    if (!entry) return;
    if (entry.enabled === true) this.close();
    void this.app.run(entry.id);
  }

  private onKey(e: KeyboardEvent): void {
    const n = this.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!n) return;
      this.sel = e.key === 'ArrowDown' ? Math.min(n - 1, this.sel + 1) : Math.max(0, this.sel - 1);
      this.requestUpdate();
      void this.updateComplete.then(() =>
        this.querySelector(`[id="${optionId(this.sel)}"]`)?.scrollIntoView?.({ block: 'nearest' }),
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.runAt(this.sel);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 'Tab') {
      // Focus ở lại trong bảng lệnh (hộp thoại).
      e.preventDefault();
    }
  }

  protected override updated(): void {
    const open = this.app.ui.palette;
    if (open && !this.wasOpen) {
      this.returnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.querySelector<HTMLInputElement>('input')?.focus();
    } else if (!open && this.wasOpen) {
      if (this.returnFocus?.isConnected) this.returnFocus.focus();
      this.returnFocus = null;
    }
    this.wasOpen = open;
  }

  protected override render() {
    if (!this.app.ui.palette) {
      if (this.wasOpen) {
        this.query = '';
        this.sel = 0;
      }
      return nothing;
    }
    this.items = this.entries();
    if (this.sel >= this.items.length) this.sel = 0;
    const activeId = this.items.length ? optionId(this.sel) : '';
    return html`<div class="palette-scrim" @mousedown=${() => this.close()}></div>
      <div class="palette" role="dialog" aria-modal="true" aria-label=${t('palette.label')}>
        <input
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
          aria-autocomplete="list"
          aria-label=${t('palette.input')}
          aria-activedescendant=${activeId || nothing}
          placeholder=${t('palette.placeholder')}
          autocomplete="off"
          spellcheck="false"
          .value=${live(this.query)}
          @input=${(e: Event) => {
            this.query = (e.target as HTMLInputElement).value;
            this.sel = 0;
            this.requestUpdate();
          }}
          @keydown=${(e: KeyboardEvent) => this.onKey(e)}
        />
        <ul id="pal-list" role="listbox" aria-label=${t('palette.label')}>
          ${
            this.items.length
              ? this.items.map(
                  (it, i) =>
                    html`<li
                      id=${optionId(i)}
                      role="option"
                      aria-selected=${i === this.sel ? 'true' : 'false'}
                      aria-disabled=${it.enabled === true ? nothing : 'true'}
                      class=${it.enabled === true ? '' : 'locked'}
                      @click=${() => this.runAt(i)}
                      @mousemove=${() => {
                        if (this.sel !== i) {
                          this.sel = i;
                          this.requestUpdate();
                        }
                      }}
                    >
                      <span class="pal-label">${it.label}</span>
                      ${it.reason ? html`<span class="pal-reason">${it.reason}</span>` : nothing}
                      ${it.shortcut ? html`<kbd>${it.shortcut}</kbd>` : nothing}
                    </li>`,
                )
              : html`<li class="empty-row" role="presentation">${t('palette.empty')}</li>`
          }
        </ul>
      </div>`;
  }
}

customElements.define('mat-palette', MatPalette);

declare global {
  interface HTMLElementTagNameMap {
    'mat-palette': MatPalette;
  }
}
