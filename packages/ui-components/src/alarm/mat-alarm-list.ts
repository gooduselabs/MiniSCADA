// Widget `alarm-list` (Bảng alarm; FR-069, FR-070; contracts/ui-alarm.md §13.1): danh sách alarm đang có thỏa bộ lọc, dựa trên
// `<mat-alarm-table>` dùng chung. Không khe Tag, không gọi mạng: chỉ đọc `AlarmSource` (`.alarms` do nơi chứa cấp) và gọi `ActionHost`.
// Không hộp chọn, không "Xác nhận tất cả", không tạm ẩn (việc của trang).
import { css, html, nothing, type TemplateResult } from 'lit';
import type { AlarmSource } from '../host/types.ts';
import { MatWidget } from '../widgets/base.ts';
import { listProps } from './alarm-widget-props.ts';
import { registerAlarmTable } from './alarm-table.ts';

export class MatAlarmList extends MatWidget {
  static override properties = {
    ...MatWidget.properties,
    alarms: { attribute: false },
  };
  static override styles = [
    MatWidget.styles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .wrap {
        height: 100%;
        overflow: auto;
        background: var(--mat-surface);
        border: 1px solid var(--mat-border);
        border-radius: var(--mat-radius);
      }
    `,
  ];

  declare alarms: AlarmSource | undefined;

  override connectedCallback(): void {
    registerAlarmTable();
    super.connectedCallback();
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.item) return nothing;
    const p = listProps(this.item);
    return html`<div class="wrap">
      <mat-alarm-table
        .alarms=${this.alarms}
        .host=${this.host}
        .mode=${this.mode}
        .columns=${p.columns}
        .filter=${{ areas: p.areas, classes: p.classes, minPriority: p.minPriority, states: p.states }}
        .tab=${'active'}
        .maxRows=${p.maxRows}
        .showAck=${p.showAck && this.mode !== 'edit'}
        .selectable=${false}
        .showShelve=${false}
      ></mat-alarm-table>
    </div>`;
  }
}
