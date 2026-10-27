// Widget `alarm-list` (Bảng alarm; FR-069, FR-070; contracts/ui-alarm.md §13.1): danh sách alarm đang có thỏa bộ lọc, dựa trên
// `<mat-alarm-table>` dùng chung. Không khe Tag, không gọi mạng: chỉ đọc `AlarmSource` (`.alarms` do nơi chứa cấp) và gọi `ActionHost`.
// Không hộp chọn, không "Xác nhận tất cả", không tạm ẩn (việc của trang).
// Feature 029: ô tìm kiếm (lọc theo chữ và tên alarm, bỏ dấu) và nút xuất CSV các alarm đang hiện (props `search`, `exportCsv`).
import { css, html, nothing, type TemplateResult } from 'lit';
import type { AlarmInstance, AlarmSource } from '../host/types.ts';
import { MatWidget } from '../widgets/base.ts';
import { listProps } from './alarm-widget-props.ts';
import { registerAlarmTable } from './alarm-table.ts';
import { filterInstances, inTab } from './alarm-format.ts';
import { alarmVi } from '../i18n/alarm-vi.ts';

/** Ô CSV an toàn: bọc ngoặc kép, chặn công thức Excel (=, +, -, @ ở đầu). */
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const iso = (ms: number | undefined): string =>
  typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : '';

/** CSV (UTF-8, có BOM để Excel đọc đúng tiếng Việt) của danh sách alarm. */
export function alarmsCsv(rows: readonly AlarmInstance[]): string {
  const head = alarmVi.csvHead;
  const lines = rows.map((r) =>
    [iso(r.tsActive), r.priority, r.area ?? '', r.name, r.text, r.valueActive, r.state]
      .map(csvCell)
      .join(','),
  );
  return '﻿' + [head.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}

export class MatAlarmList extends MatWidget {
  static override properties = {
    ...MatWidget.properties,
    alarms: { attribute: false },
    _q: { state: true },
  };
  static override styles = [
    MatWidget.styles,
    css`
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .outer {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--mat-surface);
        border: 1px solid var(--mat-border);
        border-radius: var(--mat-radius);
        overflow: hidden;
      }
      .bar {
        flex: none;
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 4px 6px;
        background: var(--mat-card-head-bg, var(--mat-surface-2));
        border-bottom: 1px solid var(--mat-border);
      }
      .bar input {
        flex: 1;
        min-width: 60px;
        max-width: 240px;
        height: 26px;
        padding: 0 6px;
        font: inherit;
        color: inherit;
        background: var(--mat-surface);
        border: 1px solid var(--mat-border-strong);
        border-radius: var(--mat-radius);
      }
      .bar .sp {
        flex: 1;
      }
      .bar button {
        height: 26px;
        padding: 0 10px;
        font: inherit;
        font-weight: 600;
        color: var(--mat-text);
        background: var(--mat-surface);
        border: 1px solid var(--mat-border-strong);
        border-radius: var(--mat-radius);
        cursor: pointer;
      }
      .wrap {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
    `,
  ];

  declare alarms: AlarmSource | undefined;
  declare _q: string;

  constructor() {
    super();
    this._q = '';
  }

  override connectedCallback(): void {
    registerAlarmTable();
    super.connectedCallback();
  }

  #filter() {
    const p = listProps(this.item!);
    return {
      areas: p.areas,
      classes: p.classes,
      minPriority: p.minPriority,
      states: p.states,
      ...(this._q.trim() ? { q: this._q } : {}),
    };
  }

  /** Alarm đang hiện (cùng bộ lọc với bảng), xuất CSV và tải về. */
  #export = (): void => {
    const src = this.alarms;
    if (!src || !this.item) return;
    const rows = filterInstances(
      src.snapshot().instances.filter((i) => inTab(i, 'active')),
      this.#filter(),
    );
    const blob = new Blob([alarmsCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alarm-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  protected override render(): TemplateResult | typeof nothing {
    if (!this.item) return nothing;
    const p = listProps(this.item);
    const search = this.prop('search', true);
    const csv = this.prop('exportCsv', true);
    return html`<div class="outer">
      ${
        search || csv
          ? html`<div class="bar">
              ${
                search
                  ? html`<input
                      type="search"
                      placeholder=${alarmVi.listSearch}
                      aria-label=${alarmVi.listSearch}
                      .value=${this._q}
                      ?disabled=${this.mode === 'edit'}
                      @input=${(e: Event) => (this._q = (e.target as HTMLInputElement).value)}
                    />`
                  : html`<span class="sp"></span>`
              }
              ${
                csv
                  ? html`<button
                      type="button"
                      data-act="export-csv"
                      ?disabled=${this.mode === 'edit' || !this.alarms}
                      @click=${this.#export}
                    >
                      ${alarmVi.listExportCsv}
                    </button>`
                  : nothing
              }
            </div>`
          : nothing
      }
      <div class="wrap">
        <mat-alarm-table
          .alarms=${this.alarms}
          .host=${this.host}
          .mode=${this.mode}
          .columns=${p.columns}
          .filter=${this.#filter()}
          .tab=${'active'}
          .maxRows=${p.maxRows}
          .showAck=${p.showAck && this.mode !== 'edit'}
          .selectable=${false}
          .showShelve=${false}
        ></mat-alarm-table>
      </div>
    </div>`;
  }
}
