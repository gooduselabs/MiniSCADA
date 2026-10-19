// Hộp thoại xem trước "Chuyển sang bố cục lưới" (feature 012, T052; US5, FR-040, SC-010): số hàng, sơ đồ 12 cột của từng
// hàng (mỗi ô ghi component của nó), cảnh báo của bản đề xuất (`model/grid-convert.ts`). Áp bằng MỘT `app.editScreen`
// (một `screenUpsert`, một bước hoàn tác); Hủy hay Esc không đổi gì. Chỉnh chi tiết làm sau khi áp, trong trình soạn lưới.
// Mọi chữ của người dùng (tên, id item) đi qua binding của Lit (văn bản thuần).
import type { GridLayout, ScreenModel } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import { convertToGrid, type ConvertWarning } from '../../model/grid-convert.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './grid-convert-dialog.css';

const WARN_KEY: Readonly<Record<Exclude<ConvertWarning['code'], 'already-grid'>, MessageKey>> = {
  overlap: 'lay.convert.w.overlap',
  squeezed: 'lay.convert.w.squeezed',
  split: 'lay.convert.w.split',
  'max-rows': 'lay.convert.w.maxRows',
};

export class MatGridConvertDialog extends OnlineDialog {
  protected get kind(): 'gridConvert' {
    return 'gridConvert';
  }

  private spec() {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'gridConvert' ? d : null;
  }

  private source(): ScreenModel | null {
    const s = this.spec();
    return s ? this.app.screenModel(s.screen) : null;
  }

  private apply(): void {
    const s = this.spec();
    if (!s) return;
    const r = this.app.editScreen(s.screen, (d) => ({ doc: convertToGrid(d).doc, selection: [] }));
    this.app.closeOnlineDialog();
    const rows = (r?.doc as { layout?: GridLayout } | undefined)?.layout?.rows.length;
    if (r && !r.rejected && rows !== undefined) this.app.toast(t('lay.convert.done', { rows }));
  }

  private warning(w: ConvertWarning) {
    if (w.code === 'already-grid') return nothing;
    const row = w.row === undefined ? '' : String(w.row + 1);
    return html`<li>${t(WARN_KEY[w.code], { row, items: w.items.join(', ') })}</li>`;
  }

  protected override render() {
    const src = this.source();
    if (!this.isOpen || !src) return nothing;
    const { doc, report } = convertToGrid(src);
    const layout = (doc as { layout?: GridLayout }).layout;
    const byId = new Map(src.items.map((i) => [i.id, i]));
    const warnings = report.warnings.filter((w) => w.code !== 'already-grid');
    const blocked = warnings.some((w) => w.code === 'max-rows') || layout === undefined;
    const body = html`<div class="gc-dlg">
      <p class="gc-sum" data-k="summary">
        ${t('lay.convert.summary', { rows: report.rows, items: src.items.length })}
      </p>
      <p class="help">${src.items.length ? t('lay.convert.rule') : t('lay.convert.empty')}</p>
      <ol class="gc-rows">
        ${(layout?.rows ?? []).map((row, r) => {
          let col = 0;
          const spans = row.cells.map((c) => c.span).join(' + ');
          const height =
            row.height === 'auto'
              ? t('lay.convert.heightAuto')
              : t('lay.convert.heightPx', { px: row.height });
          return html`<li
            class="gc-row"
            data-row=${r}
            aria-label=${`${t('lay.convert.row', { n: r + 1, spans })}, ${height}`}
          >
            <span class="gc-rh" aria-hidden="true">${r + 1}</span>
            <div class="gc-grid">
              ${row.cells.map((c) => {
                col += c.offset ?? 0;
                const start = col + 1;
                col += c.span;
                const it = c.item === undefined ? undefined : byId.get(c.item);
                const label = it ? (it.name ?? it.id) : t('lay.cellEmpty');
                return html`<span
                  class=${it ? 'gc-cell' : 'gc-cell empty'}
                  style=${`grid-column:${start} / span ${c.span}`}
                  data-item=${it ? it.id : nothing}
                  title=${it ? `${it.id} (${c.span})` : ''}
                  ><span class="gc-lbl">${label}</span
                  ><span class="gc-span num">${c.span}</span></span
                >`;
              })}
            </div>
            <span class="gc-h">${height}</span>
          </li>`;
        })}
      </ol>
      ${
        warnings.length
          ? html`<div class="gc-warn" data-k="warn" role="note">
              ${icon('warn')}
              <div>
                <b>${t('lay.convert.warnings')}</b>
                <ul>
                  ${warnings.map((w) => this.warning(w))}
                </ul>
              </div>
            </div>`
          : nothing
      }
      <p class="help">${t('lay.convert.after')}</p>
    </div>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-role="ok"
        ?disabled=${blocked}
        @click=${() => this.apply()}
      >
        ${icon('grid')}${t('lay.convert.apply')}
      </button>`;
    return this.frame({
      title: t('lay.convert.title', { name: src.name }),
      icon: 'grid',
      body,
      foot,
    });
  }
}

customElements.define('mat-grid-convert-dialog', MatGridConvertDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-grid-convert-dialog': MatGridConvertDialog;
  }
}
