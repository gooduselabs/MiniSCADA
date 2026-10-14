// Hộp thoại Nhập CSV alarm (feature 009, T084, FR-074; contract studio-alarm-editor §3.2): chọn tệp qua hộp chọn của Rust (không đọc
// tệp ngoài thao tác chọn), nhận cột theo tên tiêu đề hoặc khóa, tự nhận dấu phân cách và bảng mã; chế độ "Thay thế tất cả"
// hoặc "Thêm vào" (gộp theo id, trùng thì bỏ qua hoặc thay); báo lỗi theo dòng; một bước hoàn tác.
import { html, nothing } from 'lit';
import { ALARM_LIMITS } from '@mat/project-schema';
import { t } from '../../i18n/index.ts';
import { alarmDocOf, ctxOf, docEdits, type AlarmDoc } from '../../model/alarm-doc.ts';
import { applyAlarmCsv, parseAlarmCsv, type CsvMode } from '../../model/alarm-csv.ts';
import { decodeCsvBytes } from '../../model/grid/csv.ts';
import { OnlineDialog } from '../dialogs/dialog-frame.ts';
import './alarm-editors.css';

export class MatAlarmCsvDialog extends OnlineDialog {
  static override properties = {
    file: { state: true },
    mode: { state: true },
    replaceDup: { state: true },
    loadError: { state: true },
  };

  protected get kind(): 'alarmCsv' {
    return 'alarmCsv';
  }

  declare file: { name: string; text: string } | null;
  declare mode: CsvMode;
  declare replaceDup: boolean;
  declare loadError: string | null;

  constructor() {
    super();
    this.file = null;
    this.mode = 'append';
    this.replaceDup = false;
    this.loadError = null;
  }

  private doc(): AlarmDoc {
    const o = this.app.store.state.outline;
    return alarmDocOf({ alarms: o.alarms, alarmClasses: o.alarmClasses });
  }

  private ctx() {
    const o = this.app.store.state.outline;
    return ctxOf(
      (o.tags?.tags ?? []) as never,
      (o.connections?.channels ?? []).flatMap((c) => (c.devices ?? []).map((d) => d.id)),
    );
  }

  protected override opened(): void {
    this.file = null;
    this.mode = 'append';
    this.replaceDup = false;
    this.loadError = null;
    void this.pick();
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>('[data-act="pick"]');
  }

  private async pick(): Promise<void> {
    const r = await this.app.csvOpen();
    if (!this.isOpen) return;
    if (r === null) return;
    if ('error' in r) {
      this.loadError = r.error === 'too-large' ? 'tt.csv.err.too-large' : 'tt.csv.err.io';
      return;
    }
    this.loadError = null;
    this.file = { name: r.name, text: decodeCsvBytes(r.bytes).text };
  }

  private parsed() {
    return this.file ? parseAlarmCsv(this.file.text, this.doc(), this.ctx()) : null;
  }

  private submit(): void {
    const p = this.parsed();
    if (!p || p.fatal || !p.rows.length) return;
    const doc = this.doc();
    const r = applyAlarmCsv(doc, p, this.mode, this.replaceDup ? 'replace' : 'skip');
    const o = this.app.store.state.outline;
    const version = String(
      (this.app.store.state.docs['project.json']?.value as { schemaVersion?: string } | null)
        ?.schemaVersion ?? '0.5.0',
    );
    this.app.store.edit(
      docEdits(doc, r.doc, version, { alarms: !!o.alarms, classes: !!o.alarmClasses }),
    );
    this.app.closeOnlineDialog();
    this.app.toast(
      t('alarm.csv.imported', {
        n: r.added + r.replaced,
        mode: t(this.mode === 'replace' ? 'alarm.csv.mode.replace' : 'alarm.csv.mode.append'),
      }),
    );
    if (r.dropped > 0)
      this.app.toast(t('alarm.grid.pasteOverLimit', { n: r.dropped, max: ALARM_LIMITS.instances }));
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const p = this.parsed();
    const errors = p?.issues.filter((i) => i.severity === 'error').length ?? 0;
    const ok = !!p && !p.fatal && p.rows.length > 0;
    const dups =
      p && this.mode === 'append'
        ? p.rows.filter((r) =>
            this.doc().alarms.some(
              (a) =>
                (a as unknown as { id: string }).id === (r.def as unknown as { id: string }).id,
            ),
          ).length
        : 0;
    const body = html`<div class="field">
        <span class="lbl">${t('alarm.csv.file')}</span>
        <div class="row" style="display:flex;gap:8px;align-items:center">
          <button class="btn" type="button" data-act="pick" @click=${() => void this.pick()}>
            ${t('alarm.csv.pick')}
          </button>
          <span class="mono" data-role="file">${this.file?.name ?? t('alarm.csv.noFile')}</span>
        </div>
        ${this.loadError ? html`<p class="field-err" role="alert">${t(this.loadError as never)}</p>` : nothing}
      </div>
      <fieldset class="al-fs">
        <legend>${t('alarm.csv.title')}</legend>
        ${(['append', 'replace'] as const).map(
          (m) =>
            html`<label class="al-chk"
              ><input
                type="radio"
                name="csv-mode"
                data-mode=${m}
                .checked=${this.mode === m}
                @change=${() => (this.mode = m)}
              />${t(m === 'replace' ? 'alarm.csv.mode.replace' : 'alarm.csv.mode.append')}</label
            >`,
        )}
        ${
          this.mode === 'append'
            ? html`<label class="al-chk"
                ><input
                  type="checkbox"
                  data-role="replace-dup"
                  .checked=${this.replaceDup}
                  @change=${(e: Event) => (this.replaceDup = (e.target as HTMLInputElement).checked)}
                />${t('alarm.csv.replaceDup', { n: dups })}</label
              >`
            : nothing
        }
      </fieldset>
      ${
        p
          ? html`<p role="status" data-role="summary">
                ${p.fatal ?? t('alarm.csv.summary', { ok: p.rows.length, bad: errors })}
              </p>
              ${
                p.issues.length
                  ? html`<ul class="al-csv-issues" data-role="issues">
                      ${p.issues.slice(0, 50).map((i) => html`<li class=${i.severity === 'error' ? 'err-text' : ''}>${i.text}</li>`)}
                    </ul>`
                  : nothing
              }`
          : nothing
      }`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" @click=${() => this.close()}>
        ${t('alarm.csv.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-act="import"
        ?disabled=${!ok}
        @click=${() => this.submit()}
      >
        ${t('alarm.csv.doImport')}
      </button>`;
    return this.frame({ title: t('alarm.csv.title'), icon: 'import', body, foot });
  }
}

customElements.define('mat-alarm-csv-dialog', MatAlarmCsvDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-alarm-csv-dialog': MatAlarmCsvDialog;
  }
}
