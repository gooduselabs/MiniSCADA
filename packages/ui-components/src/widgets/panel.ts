// Widget `panel` (FR-027): khung và tiêu đề, không Tag, không nhận sự kiện. Vẽ ở lớp dưới các widget khác theo thứ tự
// `items` do người thiết kế đặt (việc xếp lớp thuộc <mat-screen>). Feature 014: `variant` = `card` vẽ khung có thanh tiêu đề.
import { css, html, nothing, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { safeColor } from '../format/color.ts';
import { MatWidget } from './base.ts';
import { accentCss } from './card.ts';

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
      .w.card {
        background: var(--mat-surface);
      }
      .w.no-border {
        border-color: transparent;
      }
      .title {
        font-weight: 600;
        font-size: 13px;
        color: var(--mat-text-muted);
      }
      /* Feature 037: màu nhấn của khung nhóm: vạch màu ở đầu, tiêu đề màu */
      .acc {
        border-top: 3px solid var(--c);
      }
      .acc .title,
      .acc .head {
        color: color-mix(in srgb, var(--c) 85%, #000);
      }
      .acc .head {
        background: color-mix(in srgb, var(--c) 10%, var(--mat-surface, #fff));
      }
    `,
  ];

  override tagIds(): string[] {
    return [];
  }

  protected override renderWidget(): TemplateResult {
    const title = this.prop('title', '');
    const bg = safeColor(this.item.props?.background);
    const accent = this.prop('accent', 'none');
    const acc = accent !== 'none' ? accentCss(accent) : undefined;
    // Feature 014: kiểu "card có header" như khung biểu đồ (thanh tiêu đề, nền khung, bo góc, bóng).
    if (this.prop('variant', 'plain') === 'card')
      return html`<div
        class="w framed card ${this.prop('border', true) ? '' : 'no-border'} ${acc ? 'acc' : ''}"
        role="group"
        aria-label=${title}
        style=${styleMap({ background: bg, '--c': acc })}
      >
        ${title && this.prop('showTitle', true) ? this.head() : nothing}
        <div class="body"></div>
      </div>`;
    return html`<div
      class="w ${this.prop('border', true) ? '' : 'no-border'} ${acc ? 'acc' : ''}"
      role="group"
      aria-label=${title}
      style=${styleMap({ background: bg, '--c': acc })}
    >
      ${title && this.prop('showTitle', true) ? html`<div class="title ellipsis">${title}</div>` : nothing}
    </div>`;
  }
}
