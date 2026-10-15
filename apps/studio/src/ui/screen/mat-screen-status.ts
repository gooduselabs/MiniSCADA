// Phần của thanh trạng thái khi mở màn hình 0.3 (feature 007, T112, FR-058): tọa độ con trỏ theo đơn vị thiết kế, zoom, số item và
// số lỗi của màn hình. Tự nghe con trỏ để cập nhật nhiều lần mỗi giây mà không vẽ lại cả thanh.
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { zoomPercent } from '../../model/screen-edit/viewport.ts';
import { findByUid, nameOfElement } from '../../model/svg-dom.ts';
import { breadcrumb } from '../../model/svg-select.ts';
import { screenIssues } from '../../model/screen-issues.ts';
import { AppElement, icon } from '../base.ts';

export class MatScreenStatus extends AppElement {
  private off: (() => void) | null = null;

  protected override attached(): void {
    this.off = this.app.screens.onPointer(() => this.requestUpdate());
  }

  protected override detached(): void {
    this.off?.();
    this.off = null;
  }

  /** "Màn hình › Item › Phần tử" khi đang vào một item `svg` (contract studio-svg-editor §10); rỗng khi không vào. */
  private breadcrumb(screenId: string, screenName: string): string[] {
    const app = this.app;
    const itemId = app.screens.enteredItemId(screenId);
    if (itemId === null) return [];
    const item = app.screenModel(screenId)?.items.find((i) => i.id === itemId);
    const uid = app.screens.selectedUids.at(-1);
    const root = app.screens.svgRoot(screenId, itemId);
    const el = uid !== undefined && root !== null ? findByUid(root, uid) : null;
    return breadcrumb({
      screen: screenName,
      item: item?.name?.trim() || itemId,
      ...(el !== null ? { element: nameOfElement(el) || `${el.localName} ${uid}` } : {}),
    });
  }

  protected override render() {
    const app = this.app;
    const active = app.store.state.active;
    if (app.store.state.outline.schema !== '0.3' || !active.startsWith('screen:')) return nothing;
    const id = active.slice('screen:'.length);
    const doc = app.screenModel(id);
    if (!doc) return nothing;
    const p = app.screens.pointer;
    const v = app.screens.view(id)?.viewport;
    const crumb = this.breadcrumb(id, doc.name);
    const issues = screenIssues(app.store.state.issues, id);
    const errs = issues.filter((i) => i.code.startsWith('E_')).length;
    return html`${
        crumb.length > 0
          ? html`<span class="sb" data-role="crumb" aria-label=${t('svo.crumbLabel')}
                >${crumb.map(
                  (c, i) =>
                    html`${i > 0 ? html`<span aria-hidden="true"> › </span>` : nothing}${
                      i === crumb.length - 1 ? html`<b>${c}</b>` : c
                    }`,
                )}</span
              ><span class="sb-sep hide-s"></span>`
          : nothing
      }<span class="sb mono num" data-role="pointer" title=${t('scr.sb.pointerTip')}
        >${p ? t('scr.sb.pointer', { x: p.x, y: p.y }) : t('scr.sb.noPointer')}</span
      ><span class="sb-sep hide-s"></span>
      <button
        class="sb hide-s"
        type="button"
        data-role="zoom"
        title=${t('scr.sb.zoomTip')}
        @click=${() => void app.run('screen.zoom100')}
      >
        ${t('preview.zoomValue', { n: v ? zoomPercent(v) : 100 })}
      </button>
      <span class="sb-sep hide-s"></span>
      <span class="sb hide-s" data-role="count">${t('scr.sb.items', { n: doc.items.length })}</span>
      ${
        errs > 0
          ? html`<span class="sb-sep hide-s"></span
              ><span class="sb hide-s" role="status"
                >${icon('err', 'e')}${t('scr.sb.errors', { n: errs })}</span
              >`
          : nothing
      }
      <span class="sb-sep hide-s"></span>
      <span class="sb hide-s" data-role="mode"
        >${t('scr.sb.mode', {
          mode: t(app.screens.previewMode === 'off' ? 'scr.sb.edit' : 'scr.sb.preview'),
          w: doc.size.width,
          h: doc.size.height,
        })}</span
      >`;
  }
}

customElements.define('mat-screen-status', MatScreenStatus);

declare global {
  interface HTMLElementTagNameMap {
    'mat-screen-status': MatScreenStatus;
  }
}
