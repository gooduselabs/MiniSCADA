// Widget `panel` (FR-027): khung và tiêu đề, không Tag, không nhận sự kiện. Vẽ ở lớp dưới các widget khác theo thứ tự
// `items` do người thiết kế đặt (việc xếp lớp thuộc <mat-screen>).
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { safeColor } from '../format/color.ts';
import { MatWidget } from './base.ts';

export class MatPanel extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      :host {
        pointer-events: none;
      }
      .w {
        justify-content: flex-start;
        background: var(--mat-surface-2);
      }
      .w.no-border {
        border-color: transparent;
      }
      .title {
        font-weight: 600;
        font-size: 13px;
        color: var(--mat-text-muted);
      }
    `,
  ];

  override tagIds(): string[] {
    return [];
  }

  protected override renderWidget(): TemplateResult {
    const title = this.prop('title', '');
    const bg = safeColor(this.item.props?.background);
    return html`<div
      class="w ${this.prop('border', true) ? '' : 'no-border'}"
      role="group"
      aria-label=${title}
      style=${styleMap({ background: bg })}
    >
      ${title && this.prop('showTitle', true) ? html`<div class="title ellipsis">${title}</div>` : nothing}
    </div>`;
  }
}
