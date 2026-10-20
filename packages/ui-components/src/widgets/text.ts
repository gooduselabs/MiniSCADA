// Widget `text` (feature 014): ghi chú nhiều dòng, chữ thuần (Lit gán bằng textContent, không HTML, không Markdown),
// giữ xuống dòng (`white-space: pre-wrap`), cuộn khi dài; thanh tiêu đề tùy chọn như khung biểu đồ. Không Tag.
import { css, html, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { safeColor } from '../format/color.ts';
import { MatWidget } from './base.ts';

const SIZES: Record<string, string> = { s: '12px', m: '14px', l: '18px' };

export class MatText extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        justify-content: flex-start;
        padding: 10px 14px;
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
        box-shadow: var(--mat-shadow-card, none);
      }
      .txt {
        flex: 1;
        min-height: 0;
        overflow: auto;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        line-height: 1.5;
      }
      .framed .txt {
        padding: 10px 14px;
      }
    `,
  ];

  override tagIds(): string[] {
    return [];
  }

  protected override renderWidget(): TemplateResult {
    const title = this.titleText();
    const text = this.prop('text', '');
    const align = this.prop('align', 'left');
    const style = styleMap({
      fontSize: SIZES[this.prop('fontSize', 'm')] ?? SIZES.m,
      textAlign: ['left', 'center', 'right'].includes(align) ? align : 'left',
      color: safeColor(this.item.props?.color),
    });
    return html`<div
      class="w ${title ? 'framed' : ''}"
      role="note"
      aria-label=${title || text.slice(0, 80)}
      style=${styleMap({ background: safeColor(this.item.props?.background) })}
    >
      ${this.head()}
      <div class="txt" style=${style}>${text}</div>
    </div>`;
  }
}
