// Tab "Mới: SVG trống" (feature 011, T162; FR-097; mockup studio-svg-draw cảnh 2; T007 quyết định 7: là một tab): tên tệp
// (`graphics/<tên>.svg`, trùng thì báo và không ghi đè), kích thước viewBox (mẫu có sẵn hoặc nhập W, H 1 đến 10.000), bước
// lưới, tên lớp đầu, nền trắng (lớp "Nền" khóa), xem trước nội dung sẽ ghi. "Tạo và mở" mở trình vẽ với tệp chưa lưu (dấu
// chưa lưu); tệp chỉ ghi xuống đĩa khi Lưu. Bên phải: có gì và không có gì trong trình vẽ (FR-118).
import { html, svg } from 'lit';
import { blankSvg } from '@mat/svg-edit';
import { t } from '../../i18n/index.ts';
import { svgSlug } from '../../model/svg-doc.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';

const PRESETS: ReadonlyArray<[number, number, string]> = [
  [100, 100, 'svgd.new.p.symbol'],
  [200, 160, 'svgd.new.p.small'],
  [400, 300, 'svgd.new.p.medium'],
  [1280, 720, 'svgd.new.p.screen'],
];
const MAX_SIDE = 10_000;

export class MatSvgNew extends AppElement {
  static override properties = {
    name: { state: true },
    w: { state: true },
    h: { state: true },
    grid: { state: true },
    layer: { state: true },
    background: { state: true },
  };
  declare name: string;
  declare w: string;
  declare h: string;
  declare grid: number;
  declare layer: string;
  declare background: boolean;

  constructor() {
    super();
    this.name = 'ky-hieu-moi';
    this.w = '200';
    this.h = '160';
    this.grid = 10;
    this.layer = 'Lớp 1';
    this.background = false;
  }

  private size(v: string): number | null {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 1 && n <= MAX_SIDE ? n : null;
  }

  private create(): void {
    const w = this.size(this.w);
    const h = this.size(this.h);
    if (w === null || h === null || !this.app.svg.pathFor(this.name)) return;
    const rel = this.app.svg.createNew(this.name, w, h, {
      layer: this.layer,
      background: this.background,
      grid: this.grid,
    });
    if (rel) {
      this.app.closeTab('svgnew');
      this.app.toast(t('svgd.new.created', { file: rel }));
    }
  }

  protected override render() {
    const app = this.app;
    const rel = `graphics/${svgSlug(this.name)}.svg`;
    const free = app.svg.pathFor(this.name) !== null;
    const w = this.size(this.w);
    const h = this.size(this.h);
    const ok = free && w !== null && h !== null && !app.store.state.readOnly;
    const code = w !== null && h !== null ? blankSvg(w, h) : '';
    const tw = 240;
    const th = w !== null && h !== null ? Math.max(20, Math.min(192, (tw * h) / w)) : 160;
    return html`<div class="ed sv-new">
      <div class="newdoc">
        <form
          class="sv-new-form"
          @submit=${(e: Event) => {
            e.preventDefault();
            this.create();
          }}
        >
          <div>
            <h2>${icon('fnew')}${t('svgd.new.tab')}</h2>
            <p class="help">${t('svgd.new.help')}</p>
          </div>
          <div class="field">
            <label for="svn-name">${t('svgd.new.name')}</label>
            <div class="row">
              <span class="mono muted">graphics/</span>
              <input
                id="svn-name"
                class="input mono"
                .value=${this.name}
                aria-invalid=${free ? 'false' : 'true'}
                aria-describedby="svn-name-st"
                @input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
              />
              <span class="mono muted">.svg</span>
              <span class="chip ${free ? 'ok' : 'err'}" id="svn-name-st" role="status">
                ${icon(free ? 'ok' : 'err')}${free ? t('svgd.new.free', { file: rel }) : t('svgd.new.taken', { file: rel })}
              </span>
            </div>
            <p class="help">${t('svgd.new.nameHelp')}</p>
          </div>
          <fieldset class="field">
            <legend class="lbl">${t('svgd.new.size')}</legend>
            <div class="presets">
              ${PRESETS.map(
                ([pw, ph, label]) =>
                  html`<button
                    type="button"
                    class="btn sm"
                    aria-pressed=${this.w === String(pw) && this.h === String(ph) ? 'true' : 'false'}
                    @click=${() => {
                      this.w = String(pw);
                      this.h = String(ph);
                    }}
                  >
                    ${t(label as 'svgd.new.p.symbol')} ${pw}×${ph}
                  </button>`,
              )}
            </div>
            <div class="row">
              <label for="svn-w">W</label>
              <input
                id="svn-w"
                class="input sm mono"
                inputmode="decimal"
                .value=${this.w}
                aria-invalid=${w === null ? 'true' : 'false'}
                @input=${(e: Event) => (this.w = (e.target as HTMLInputElement).value)}
              />
              <label for="svn-h">H</label>
              <input
                id="svn-h"
                class="input sm mono"
                inputmode="decimal"
                .value=${this.h}
                aria-invalid=${h === null ? 'true' : 'false'}
                @input=${(e: Event) => (this.h = (e.target as HTMLInputElement).value)}
              />
              <span class="muted">${t('svgd.new.units')}</span>
            </div>
          </fieldset>
          <div class="row sv-new-opts">
            <label for="svn-grid">${t('svgd.new.grid')}</label>
            <select
              id="svn-grid"
              class="select sm"
              @change=${(e: Event) => (this.grid = Number((e.target as HTMLSelectElement).value))}
            >
              ${[5, 10, 20].map((g) => html`<option value=${g} ?selected=${g === this.grid}>${g}</option>`)}
            </select>
            <label for="svn-layer">${t('svgd.new.layer')}</label>
            <input
              id="svn-layer"
              class="input sm"
              .value=${this.layer}
              @input=${(e: Event) => (this.layer = (e.target as HTMLInputElement).value)}
            />
            <label class="row"
              ><input
                type="checkbox"
                .checked=${this.background}
                @change=${(e: Event) => (this.background = (e.target as HTMLInputElement).checked)}
              />${t('svgd.new.bg')}</label
            >
          </div>
          <div class="field">
            <span class="lbl">${t('svgd.new.willWrite')}</span>
            <pre class="code" aria-label=${t('svgd.new.willWrite')}>${code}</pre>
          </div>
          <div class="row">
            <button type="submit" class="btn primary" data-act="create" ?disabled=${!ok}>
              ${icon('fnew')}${t('svgd.new.create')}
            </button>
            <button type="button" class="btn" @click=${() => app.closeTab('svgnew')}>
              ${t('dlg.cancel')}
            </button>
            <span class="muted">${t('svgd.new.other')}</span>
          </div>
        </form>
        <div class="sv-new-side">
          <span class="lbl">${t('svgd.new.preview')}</span>
          <div class="thumb">
            <svg width=${tw} height=${th} role="img" aria-label=${t('svgd.new.preview')}>
              ${svg`<rect x="0.5" y="0.5" width=${tw - 1} height=${th - 1} fill=${this.background ? '#ffffff' : 'none'} stroke="currentColor" stroke-dasharray="4 3"></rect>`}
            </svg>
          </div>
          <div class="card">
            <h3>${t('svgd.new.has')}</h3>
            <p class="help">${t('svgd.new.hasText')}</p>
            <h3>${t('svgd.new.hasNot')}</h3>
            <p class="help">${t('svgd.limits.text')}</p>
          </div>
        </div>
      </div>
    </div>`;
  }
}

customElements.define('mat-svg-new', MatSvgNew);

registerEditor({
  match: (id) => id === 'svgnew',
  render: (app) => html`<mat-svg-new .app=${app}></mat-svg-new>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-new': MatSvgNew;
  }
}
