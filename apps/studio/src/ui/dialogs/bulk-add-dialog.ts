// Hộp thoại Thêm hàng loạt (feature 006, T126, FR-045, US1-11, mockup d-bulk): tạo N Tag ngoài với tên tăng số và địa chỉ
// tăng theo bước (mặc định bằng số thanh ghi của kiểu). Xem trước ngay khi gõ; lỗi tại từng ô; MỘT bước hoàn tác.
import type { ScanGroupName } from '@mat/project-schema';
import type { TagDataType } from '@mat/tag-codec';
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { planBulkAdd, type BulkAddError, type BulkAddParams } from '../../model/grid/bulk-add.ts';
import { OnlineDialog } from './dialog-frame.ts';

const TYPES: readonly TagDataType[] = [
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
];

interface Form {
  namePattern: string;
  count: string;
  type: TagDataType;
  device: string;
  address: string;
  step: string;
  scanGroup: ScanGroupName;
  stringLength: string;
}

const INITIAL: Form = {
  namePattern: 'TAG_01',
  count: '8',
  type: 'FLOAT32',
  device: '',
  address: 'HR100',
  step: '',
  scanGroup: 'normal',
  stringLength: '',
};

export class MatBulkAddDialog extends OnlineDialog {
  static override properties = { form: { state: true } };

  protected get kind(): 'bulkAdd' {
    return 'bulkAdd';
  }

  declare form: Form;

  constructor() {
    super();
    this.form = INITIAL;
  }

  private devices() {
    const channels = this.app.store.state.outline.connections?.channels ?? [];
    return channels.flatMap((c) =>
      (c.devices ?? []).map((d) => ({ id: d.id, name: d.name, addressBase: d.addressBase })),
    );
  }

  protected override opened(): void {
    this.form = { ...INITIAL, device: this.devices()[0]?.id ?? '' };
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>('input[name="namePattern"]');
  }

  private params(): BulkAddParams {
    const f = this.form;
    const step = f.step.trim();
    return {
      count: f.count.trim() === '' ? NaN : Number(f.count),
      namePattern: f.namePattern,
      address: f.address,
      step: step === '' ? null : Number(step),
      type: f.type,
      device: f.device,
      scanGroup: f.scanGroup,
      ...(f.stringLength.trim() !== '' ? { stringLength: Number(f.stringLength) } : {}),
    };
  }

  private plan() {
    const outline = this.app.store.state.outline;
    const existing = (outline.tags?.tags ?? []).map((x) =>
      String((x as { id?: unknown }).id ?? ''),
    );
    return planBulkAdd(this.params(), {
      existing,
      devices: this.devices(),
      total: existing.length,
    });
  }

  private submit(): void {
    const plan = this.plan();
    if (plan.errors.length || !plan.edits.length) return;
    this.app.store.edit(plan.edits);
    this.app.closeOnlineDialog();
    this.app.toast(t('tt.bulk.done', { n: plan.tags.length }));
  }

  private set<K extends keyof Form>(key: K, value: Form[K]): void {
    this.form = { ...this.form, [key]: value };
  }

  private input(
    name: keyof Form,
    label: string,
    help: string,
    errors: readonly BulkAddError[],
    extra: { placeholder?: string; mono?: boolean; inputmode?: 'numeric' } = {},
  ) {
    const err = errors.find((e) => e.field === name);
    const id = `ba-${name}`;
    return html`<div class="field">
      <label for=${id}>${label}</label>
      <input
        id=${id}
        name=${name}
        type="text"
        autocomplete="off"
        spellcheck="false"
        class=${extra.mono ? 'mono' : ''}
        inputmode=${extra.inputmode ?? nothing}
        placeholder=${extra.placeholder ?? ''}
        .value=${this.form[name] as string}
        aria-invalid=${err ? 'true' : 'false'}
        aria-describedby=${`${id}-h${err ? ` ${id}-e` : ''}`}
        @input=${(e: Event) => this.set(name, (e.target as HTMLInputElement).value as never)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            this.submit();
          }
        }}
      />
      <p class="help" id="${id}-h">${help}</p>
      ${err ? html`<p class="field-err" id="${id}-e">${t(err.reason, err.params)}</p>` : nothing}
    </div>`;
  }

  private select(
    name: 'type' | 'device' | 'scanGroup',
    label: string,
    options: ReadonlyArray<{ value: string; text: string }>,
    errors: readonly BulkAddError[],
  ) {
    const err = errors.find((e) => e.field === name);
    const id = `ba-${name}`;
    return html`<div class="field">
      <label for=${id}>${label}</label>
      <select
        id=${id}
        name=${name}
        .value=${this.form[name]}
        aria-invalid=${err ? 'true' : 'false'}
        aria-describedby=${err ? `${id}-e` : nothing}
        @change=${(e: Event) => this.set(name, (e.target as HTMLSelectElement).value as never)}
      >
        ${options.map(
          (o) =>
            html`<option value=${o.value} ?selected=${o.value === this.form[name]}>
              ${o.text}
            </option>`,
        )}
      </select>
      ${err ? html`<p class="field-err" id="${id}-e">${t(err.reason, err.params)}</p>` : nothing}
    </div>`;
  }

  protected override render() {
    if (!this.isOpen) return nothing;
    const plan = this.plan();
    const errors = plan.errors;
    const ok = !errors.length && plan.tags.length > 0;
    const first = plan.preview[0];
    const last = plan.preview.at(-1);
    const body = html`<div class="form-grid">
        ${this.input('namePattern', t('tt.bulk.f.pattern'), t('tt.bulk.h.pattern'), errors, { mono: true })}
        ${this.input('count', t('tt.bulk.f.count'), t('tt.bulk.h.count'), errors, { inputmode: 'numeric' })}
        ${this.select(
          'type',
          t('tt.col.type'),
          TYPES.map((x) => ({ value: x, text: x })),
          errors,
        )}
        ${this.select(
          'device',
          t('tt.col.device'),
          this.devices().map((d) => ({ value: d.id, text: `${d.id} · ${d.name}` })),
          errors,
        )}
        ${this.input('address', t('tt.bulk.f.address'), t('tt.bulk.h.address'), errors, { mono: true })}
        ${this.input('step', t('tt.bulk.f.step'), t('tt.bulk.h.step'), errors, {
          placeholder: t('tt.bulk.stepAuto'),
          inputmode: 'numeric',
        })}
        ${this.select(
          'scanGroup',
          t('tt.col.scanGroup'),
          (['fast', 'normal', 'slow'] as const).map((g) => ({ value: g, text: g })),
          errors,
        )}
        ${
          this.form.type === 'STRING'
            ? this.input(
                'stringLength',
                t('tt.bulk.f.stringLength'),
                t('tt.bulk.h.stringLength'),
                errors,
                {
                  inputmode: 'numeric',
                },
              )
            : nothing
        }
      </div>
      <p class="preview" data-role="preview" role="status" aria-live="polite">
        ${
          first && last
            ? t('tt.bulk.preview', {
                first: `${first.id} → ${first.address}`,
                last: `${last.id} → ${last.address}`,
              })
            : t('tt.bulk.previewNone')
        }
      </p>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-role="ok"
        ?disabled=${!ok}
        @click=${() => this.submit()}
      >
        ${t('tt.bulk.do', { n: plan.tags.length })}
      </button>`;
    return this.frame({ title: t('tt.bulk.title'), icon: 'plus', body, foot });
  }
}

customElements.define('mat-bulk-add-dialog', MatBulkAddDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-bulk-add-dialog': MatBulkAddDialog;
  }
}
