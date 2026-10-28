// Lớp phủ khi "vào" một item `svg` (feature 008, T070; contract studio-svg-editor §10; mockup studio-svg cảnh 2): khung viền
// của item đang vào kèm nhãn thoát, khung chọn bám từng phần tử SVG ở mọi zoom và pan, khung rê chuột, viền lỗi, ô thả Tag.
// Không sửa DOM của SVG: chỉ đọc `getBoundingClientRect()` của phần tử trong Shadow DOM của item rồi quy về đơn vị thiết kế
// bằng vùng nhìn của canvas (`selectionRect`), nên khung luôn bám theo zoom, pan và cả phép dời, quay do binding.
import { html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { Rect } from '@mat/project-schema';
import { itemRef, bindingSetOf } from '../../app/svg-bind.ts';
import { t } from '../../i18n/index.ts';
import type { Viewport } from '../../model/screen-edit/viewport.ts';
import { clientRectOf, findByUid, nameOfElement } from '../../model/svg-dom.ts';
import { groupBySvgElement, severityOfElement } from '../../model/svg-issues.ts';
import { selectionRect } from '../../model/svg-select.ts';
import { AppElement } from '../base.ts';
import './mat-svg-overlay.css';

const box = (r: Rect) => ({
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${Math.max(r.width, 0)}px`,
  height: `${Math.max(r.height, 0)}px`,
});

export class MatSvgOverlay extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    itemId: { attribute: false },
    viewport: { attribute: false },
    hoverUid: { attribute: false },
    dropUid: { attribute: false },
    rev: { attribute: false },
    fill: { attribute: false },
  };

  declare screenId: string;
  declare itemId: string;
  declare viewport: Viewport;
  /** Phần tử đang rê chuột (khung mảnh). */
  declare hoverUid: string | null;
  /** Phần tử đang được rê Tag lên (ô thả). */
  declare dropUid: string | null;
  /** Số lần DOM của item được dựng lại: đọc lại hộp bao khi đổi. */
  declare rev: number;
  /**
   * Trình soạn lưới (feature 012): lớp phủ nằm trong ô chứa item (item lấp đầy ô), nên khung item phủ kín lớp phủ và gốc tọa
   * độ là chính lớp phủ thay cho vùng nhìn `.vp` của canvas tự do.
   */
  declare fill: boolean;
  constructor() {
    super();
    this.screenId = '';
    this.itemId = '';
    this.viewport = { zoom: 1, panX: 0, panY: 0 };
    this.hoverUid = null;
    this.dropUid = null;
    this.rev = 0;
    this.fill = false;
  }

  /** Hình chữ nhật thiết kế của phần tử `uid`; `null` khi chưa dựng hoặc không có hộp. */
  private rectOf(
    root: ShadowRoot,
    origin: DOMRect,
    uid: string,
  ): { rect: Rect; name: string } | null {
    const el = findByUid(root, uid);
    if (el === null) return null;
    const c = clientRectOf(el);
    if (c === null) return null;
    return {
      rect: selectionRect(c, origin, this.viewport),
      name: nameOfElement(el) || `${el.localName} ${uid}`,
    };
  }

  protected override render(): TemplateResult | typeof nothing {
    if (this.itemId === '') return nothing;
    const app = this.app;
    const item = app.screenModel(this.screenId)?.items.find((i) => i.id === this.itemId);
    if (item === undefined) return nothing;
    const k = 1 / this.viewport.zoom;
    const frame = html`<div
      class="svo-item"
      style=${styleMap(this.fill ? { left: '0', top: '0', width: '100%', height: '100%' } : box(item))}
    >
      <span class="svo-chip">${t('svo.entered', { name: item.name?.trim() || item.id })}</span>
    </div>`;
    const vp = this.fill ? this : this.closest('.vp');
    const root = app.screens.svgRoot(this.screenId, this.itemId);
    if (vp === null || root === null)
      return html`<div class="svo" style=${styleMap({ '--k': String(k) })}>${frame}</div>`;
    const origin = vp.getBoundingClientRect();
    const ref = itemRef(app, this.screenId, this.itemId);
    const { byElement } =
      ref === null
        ? { byElement: new Map() }
        : groupBySvgElement(
            app.store.state.issues.filter((i) => i.file === ref.file),
            bindingSetOf(app, ref),
          );
    const uids = app.screens.selectedUids;
    const boxes = uids.flatMap((uid, i) => {
      const r = this.rectOf(root, origin, uid);
      return r === null ? [] : [{ uid, last: i === uids.length - 1, ...r }];
    });
    const hover =
      this.hoverUid !== null && !uids.includes(this.hoverUid)
        ? this.rectOf(root, origin, this.hoverUid)
        : null;
    const drop = this.dropUid !== null ? this.rectOf(root, origin, this.dropUid) : null;
    return html`<div class="svo" style=${styleMap({ '--k': String(k) })}>
      ${frame}
      ${hover ? html`<div class="svo-hover" style=${styleMap(box(hover.rect))}></div>` : nothing}
      ${boxes.map((b) => {
        const sev = severityOfElement(byElement.get(b.uid));
        return html`<div
          class="svo-sel ${b.last ? 'last' : ''} ${sev ? `iss ${sev}` : ''}"
          data-uid=${b.uid}
          style=${styleMap(box(b.rect))}
        >
          ${b.last ? html`<span class="svo-nm">${b.name}</span>` : nothing}
        </div>`;
      })}
      ${drop ? html`<div class="svo-drop" style=${styleMap(box(drop.rect))}></div>` : nothing}
    </div>`;
  }
}

customElements.define('mat-svg-overlay', MatSvgOverlay);

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-overlay': MatSvgOverlay;
  }
}
