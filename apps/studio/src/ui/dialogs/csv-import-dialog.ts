// Hộp thoại Nhập CSV của Bảng Tag (feature 006, T126, FR-045, US1-12, mockup d-csv): mở hộp thoại chọn file, giải mã byte,
// xem trước từng dòng (thêm, cập nhật, giống, lỗi, bỏ qua) và đổi dấu phân cách, dấu thập phân, bảng mã ngay tại đó.
// Nhập xong là MỘT bước hoàn tác; dòng lỗi không được áp, không bao giờ xóa Tag.
import { html, nothing } from 'lit';
import { hasKey, t, type MessageKey } from '../../i18n/index.ts';
import type { CsvEncoding, Delimiter } from '../../model/grid/csv.ts';
import {
  defaultDecimal,
  planCsvImport,
  type CsvImportPlan,
  type CsvImportRow,
} from '../../model/csv-import.ts';
import { tableInputs, tagTable } from '../../model/tag-table.ts';
import { OnlineDialog } from './dialog-frame.ts';

/** Số dòng xem trước tối đa (file lớn hơn thì liệt kê các dòng lỗi trước, rồi các dòng đầu). */
const MAX_SHOWN = 300;

const reasonText = (r: string): string => (hasKey(r) ? t(r as MessageKey) : r);

export class MatCsvImportDialog extends OnlineDialog {
  static override properties = {
    file: { state: true },
    decimal: { state: true },
    delimiter: { state: true },
    encoding: { state: true },
    loadError: { state: true },
  };

  protected get kind(): 'csvImport' {
    return 'csvImport';
  }

  declare file: { name: string; bytes: Uint8Array } | null;
  declare decimal: '.' | ',';
  declare delimiter: Delimiter | 'auto';
  declare encoding: CsvEncoding | 'auto';
  declare loadError: MessageKey | null;

  constructor() {
    super();
    this.file = null;
    this.decimal = '.';
    this.delimiter = 'auto';
    this.encoding = 'auto';
    this.loadError = null;
  }

  protected override opened(): void {
    this.file = null;
    this.loadError = null;
    this.decimal = defaultDecimal();
    this.delimiter = 'auto';
    this.encoding = 'auto';
    void this.pick();
  }

  /** Hộp thoại chọn file của Rust; hủy thì đóng luôn hộp thoại. */
  private async pick(): Promise<void> {
    const r = await this.app.csvOpen();
    if (!this.isOpen) return;
    if (r === null) {
      this.app.closeOnlineDialog();
      return;
    }
    if ('error' in r) {
      this.loadError = r.error === 'too-large' ? 'tt.csv.err.too-large' : 'tt.csv.err.io';
      return;
    }
    this.file = { name: r.name, bytes: r.bytes };
  }

  private plan(): CsvImportPlan | null {
    if (!this.file) return null;
    const table = tagTable({ ...tableInputs(this.app.store.state.outline), version: '0.2' });
    return planCsvImport(this.file.bytes, table, {
      decimal: this.decimal,
      ...(this.delimiter === 'auto' ? {} : { delimiter: this.delimiter }),
      ...(this.encoding === 'auto' ? {} : { encoding: this.encoding }),
    });
  }

  private submit(): void {
    const plan = this.plan();
    if (!plan || plan.fatal || !plan.edits.length) return;
    this.app.store.edit(plan.edits);
    this.app.closeOnlineDialog();
    this.app.toast(t('tt.csv.done', { add: plan.counts.add, update: plan.counts.update }));
  }

  protected override initialFocus(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>('.dlg-f .primary:not([disabled])') ??
      this.querySelector<HTMLElement>('select, .dlg-f button')
    );
  }

  private opt<T extends string>(
    name: string,
    label: MessageKey,
    value: T,
    options: ReadonlyArray<{ value: T; text: string }>,
    set: (v: T) => void,
  ) {
    return html`<div class="field inline">
      <label for=${`ci-${name}`}>${t(label)}</label>
      <select
        id=${`ci-${name}`}
        name=${name}
        .value=${value}
        @change=${(e: Event) => set((e.target as HTMLSelectElement).value as T)}
      >
        ${options.map((o) => html`<option value=${o.value} ?selected=${o.value === value}>${o.text}</option>`)}
      </select>
    </div>`;
  }

  private rowView(r: CsvImportRow) {
    const chip =
      r.action === 'error' ? 'err' : r.action === 'add' || r.action === 'update' ? 'ok' : 'info';
    return html`<tr data-line=${r.line} data-action=${r.action}>
      <td class="num">${r.line}</td>
      <td class="mono">${r.id}</td>
      <td>
        <span class="chip ${chip}">${t(`tt.csv.act.${r.action}` as MessageKey)}</span>
        ${r.cells.length ? html`<span class="help">${r.cells.join(', ')}</span>` : nothing}
        ${r.errors.map(
          (e) =>
            html`<div class="field-err">
              ${e.col ? `${e.col}: ` : ''}${reasonText(String(e.reason))}
            </div>`,
        )}
      </td>
    </tr>`;
  }

  private bodyView(plan: CsvImportPlan) {
    const c = plan.counts;
    const shown = [
      ...plan.rows.filter((r) => r.action === 'error'),
      ...plan.rows.filter((r) => r.action !== 'error'),
    ]
      .slice(0, MAX_SHOWN)
      .sort((a, b) => a.line - b.line);
    const ignored = plan.headers.filter((h) => h.col === null).map((h) => h.header);
    return html`<div class="ci-opts">
        ${this.opt(
          'encoding',
          'tt.csv.encoding',
          this.encoding,
          [
            { value: 'auto', text: t('tt.csv.auto', { value: plan.encoding }) },
            { value: 'utf-8', text: 'UTF-8' },
            { value: 'windows-1258', text: 'Windows-1258' },
          ],
          (v) => (this.encoding = v),
        )}
        ${this.opt(
          'delimiter',
          'tt.csv.delimiter',
          this.delimiter,
          [
            {
              value: 'auto',
              text: t('tt.csv.auto', { value: plan.delimiter === '\t' ? 'Tab' : plan.delimiter }),
            },
            { value: ',', text: ',' },
            { value: ';', text: ';' },
            { value: '\t', text: 'Tab' },
          ],
          (v) => (this.delimiter = v),
        )}
        ${this.opt(
          'decimal',
          'tt.csv.decimal',
          this.decimal,
          [
            { value: '.', text: t('tt.csv.dot') },
            { value: ',', text: t('tt.csv.comma') },
          ],
          (v) => (this.decimal = v),
        )}
      </div>
      ${
        plan.fatal
          ? html`<p class="field-err" role="alert">${t(plan.fatal)}</p>`
          : html`<p class="summary" data-role="summary" role="status" aria-live="polite">
                ${t('tt.csv.summary', { add: c.add, update: c.update, same: c.same, error: c.error, dropped: c.dropped })}
              </p>
              ${
                ignored.length
                  ? html`<p class="help" data-role="ignored">
                      ${t('tt.csv.ignored', { list: ignored.join(', ') })}
                    </p>`
                  : nothing
              }
              <div class="ci-table" role="region" tabindex="0" aria-label=${t('tt.csv.preview')}>
                <table class="grid">
                  <thead>
                    <tr>
                      <th>${t('tt.csv.col.line')}</th>
                      <th>${t('tt.col.id')}</th>
                      <th>${t('tt.csv.col.result')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${shown.map((r) => this.rowView(r))}
                  </tbody>
                </table>
              </div>
              ${
                plan.rows.length > MAX_SHOWN
                  ? html`<p class="help">
                      ${t('tt.csv.truncated', { n: MAX_SHOWN, total: plan.rows.length })}
                    </p>`
                  : nothing
              }`
      }`;
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const plan = this.plan();
    const n = plan ? plan.counts.add + plan.counts.update : 0;
    const body = this.loadError
      ? html`<p class="field-err" role="alert">${t(this.loadError)}</p>`
      : plan
        ? html`<p class="help">${t('tt.csv.file', { name: this.file!.name })}</p>
            ${this.bodyView(plan)}`
        : html`<p class="row" role="status">
            <span class="spin" aria-hidden="true"></span>${t('tt.csv.waiting')}
          </p>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-role="ok"
        ?disabled=${n === 0}
        @click=${() => this.submit()}
      >
        ${t('tt.csv.do', { n })}
      </button>`;
    return this.frame({
      title: t('tt.csv.title'),
      icon: 'import',
      body,
      foot,
      busy: !plan && !this.loadError,
    });
  }
}

customElements.define('mat-csv-import-dialog', MatCsvImportDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-csv-import-dialog': MatCsvImportDialog;
  }
}
