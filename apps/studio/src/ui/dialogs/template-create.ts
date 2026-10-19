// Hộp thoại "Tạo template từ vùng chọn" (feature 011, T173; FR-126; mockup studio-svg-draw cảnh 3 `tcDlg`): id, tên, cỡ
// (hộp bao, chỉ đọc), bảng tham số (phát hiện sẵn: tiền tố Tag chung, args của popup; thêm, bớt, đổi kiểu, default), bảng
// "Thay bằng tham số" (mỗi chỗ một ô tích), tùy chọn thay vùng chọn bằng bản sao. Áp bằng MỘT `store.edit` (template mới,
// project.json › templates, màn hình nếu thay vùng chọn). Mọi chữ của người dùng đi qua binding của Lit (văn bản thuần).
import type { Item, ParamDecl, ParamKind } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { templatesOf } from '../../app/template-actions.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import {
  findReplacements,
  planCreateTemplate,
  suggestParams,
  type Replacement,
  type TemplateRejection,
} from '../../model/template-doc.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './template-dialogs.css';

const KINDS: readonly ParamKind[] = ['tagPrefix', 'string', 'number', 'color'];

export const REJECT_KEY: Readonly<Record<TemplateRejection, MessageKey>> = {
  empty: 'tpl.err.empty',
  'too-many': 'tpl.err.tooMany',
  'svg-item': 'tpl.err.svg',
  'bad-id': 'tpl.err.id',
  taken: 'tpl.err.taken',
  'bad-name': 'tpl.err.name',
  'bad-params': 'tpl.err.params',
  'bad-inst': 'tpl.err.inst',
  'inst-taken': 'tpl.err.instTaken',
  'bad-args': 'tpl.err.args',
  'max-items': 'tpl.err.maxItems',
  'not-popup': 'tpl.fp.notPopup',
  'no-prefix': 'tpl.fp.noPrefix',
  'grid-layout': 'lay.tplUnsupported',
};

const repKey = (r: Replacement) => `${r.item}|${r.path.join('/')}`;

export class MatTemplateCreateDialog extends OnlineDialog {
  static override properties = {
    tid: { state: true },
    name: { state: true },
    params: { state: true },
    off: { state: true },
    replace: { state: true },
    error: { state: true },
  };

  protected get kind(): 'templateCreate' {
    return 'templateCreate';
  }

  declare tid: string;
  declare name: string;
  declare params: ParamDecl[];
  /** Chỗ thay bị bỏ tích. */
  declare off: ReadonlySet<string>;
  declare replace: boolean;
  declare error: MessageKey | null;

  constructor() {
    super();
    this.tid = '';
    this.name = '';
    this.params = [];
    this.off = new Set();
    this.replace = true;
    this.error = null;
  }

  private spec() {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'templateCreate' ? d : null;
  }

  private items(): Item[] {
    const s = this.spec();
    const doc = s ? this.app.screenModel(s.screen) : null;
    const ids = new Set(s?.ids ?? []);
    return (doc?.items ?? []).filter((i) => ids.has(i.id));
  }

  protected override opened(): void {
    const items = this.items();
    const taken = new Set(Object.keys(templatesOf(this.app)));
    let n = 1;
    while (taken.has(n === 1 ? 'mau' : `mau-${n}`)) n++;
    this.tid = n === 1 ? 'mau' : `mau-${n}`;
    this.name = '';
    this.params = suggestParams(items);
    this.off = new Set();
    this.replace = true;
    this.error = null;
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLInputElement>('input[name="tid"]');
  }

  private setParam(i: number, patch: Partial<ParamDecl>): void {
    const next = this.params.map((p, j) => (j === i ? { ...p, ...patch } : p));
    for (const p of next) if (p.default === '') delete p.default;
    this.params = next;
    this.error = null;
  }

  private submit(): void {
    const s = this.spec();
    const doc = s ? this.app.screenModel(s.screen) : null;
    if (!s || !doc) return;
    const reps = findReplacements(this.items(), this.params).filter(
      (r) => !this.off.has(repKey(r)),
    );
    const version = String(
      (this.app.store.state.outline.project as { schemaVersion?: unknown } | null)?.schemaVersion ??
        '1.0.0',
    );
    const plan = planCreateTemplate(doc, s.ids, {
      id: this.tid.trim(),
      name: this.name.trim() === '' ? this.tid.trim() : this.name,
      params: this.params,
      replacements: reps,
      schemaVersion: version,
      taken: Object.keys(templatesOf(this.app)),
      replaceSelection: this.replace,
    });
    if (!plan.ok) {
      this.error = REJECT_KEY[plan.reason];
      return;
    }
    this.app.store.edit(plan.edits);
    if (plan.ids) this.app.selectItems(s.screen, plan.ids);
    this.app.closeOnlineDialog();
    this.app.toast(t('tpl.created', { id: plan.template.id }));
  }

  private paramsTable() {
    return html`<div class="tpl-sec">
      <div class="tpl-row">
        <b>${t('tpl.params', { n: this.params.length })}</b>
        <span class="grow"></span>
        <button
          class="btn sm"
          type="button"
          data-act="add-param"
          ?disabled=${this.params.length >= 16}
          @click=${() => {
            let n = this.params.length + 1;
            while (this.params.some((p) => p.name === `p${n}`)) n++;
            this.params = [...this.params, { name: `p${n}`, kind: 'string' }];
          }}
        >
          ${icon('plus')}${t('tpl.addParam')}
        </button>
      </div>
      <table class="tpl-tb">
        <thead>
          <tr>
            <th scope="col">${t('tpl.col.name')}</th>
            <th scope="col">${t('tpl.col.kind')}</th>
            <th scope="col">${t('tpl.col.default')}</th>
            <th scope="col"><span class="visually-hidden">${t('tpl.col.remove')}</span></th>
          </tr>
        </thead>
        <tbody>
          ${this.params.map(
            (p, i) =>
              html`<tr data-param=${p.name}>
                <td>
                  <input
                    class="input sm mono"
                    aria-label=${t('tpl.col.name')}
                    .value=${p.name}
                    @change=${(e: Event) =>
                      this.setParam(i, { name: (e.target as HTMLInputElement).value.trim() })}
                  />
                </td>
                <td>
                  <select
                    class="select sm"
                    aria-label=${t('tpl.col.kind')}
                    @change=${(e: Event) =>
                      this.setParam(i, {
                        kind: (e.target as HTMLSelectElement).value as ParamKind,
                      })}
                  >
                    ${KINDS.map(
                      (k) => html`<option value=${k} ?selected=${p.kind === k}>${k}</option>`,
                    )}
                  </select>
                </td>
                <td>
                  <input
                    class="input sm"
                    aria-label=${t('tpl.col.default')}
                    .value=${p.default ?? ''}
                    @change=${(e: Event) =>
                      this.setParam(i, { default: (e.target as HTMLInputElement).value })}
                  />
                </td>
                <td>
                  <button
                    class="ibtn sm"
                    type="button"
                    aria-label=${t('tpl.removeParam', { name: p.name })}
                    @click=${() => {
                      this.params = this.params.filter((_, j) => j !== i);
                    }}
                  >
                    ${icon('x')}
                  </button>
                </td>
              </tr>`,
          )}
        </tbody>
      </table>
    </div>`;
  }

  private replacementsTable() {
    const reps = findReplacements(this.items(), this.params);
    if (reps.length === 0) return html`<p class="help">${t('tpl.noReplacements')}</p>`;
    return html`<div class="tpl-sec">
      <b>${t('tpl.replacements')}</b>
      <table class="tpl-tb" aria-label=${t('tpl.replacements')}>
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">${t('tpl.col.use')}</span></th>
            <th scope="col">${t('tpl.col.item')}</th>
            <th scope="col">${t('tpl.col.place')}</th>
            <th scope="col">${t('tpl.col.current')}</th>
            <th scope="col">${t('tpl.col.inTemplate')}</th>
          </tr>
        </thead>
        <tbody>
          ${reps.map((r) => {
            const k = repKey(r);
            return html`<tr data-rep=${k}>
              <td>
                <input
                  type="checkbox"
                  aria-label=${t('tpl.useRep', { item: r.item, place: r.path.join('.') })}
                  .checked=${!this.off.has(k)}
                  @change=${(e: Event) => {
                    const next = new Set(this.off);
                    if ((e.target as HTMLInputElement).checked) next.delete(k);
                    else next.add(k);
                    this.off = next;
                  }}
                />
              </td>
              <td class="mono">${r.item}</td>
              <td class="mono">${r.path.join('.')}</td>
              <td>${String(r.current)}</td>
              <td class="mono">${r.value}</td>
            </tr>`;
          })}
        </tbody>
      </table>
      <p class="help">${t('tpl.substHelp')}</p>
    </div>`;
  }

  protected override render() {
    const s = this.spec();
    if (!this.isOpen || !s) return nothing;
    const items = this.items();
    const x0 = Math.min(...items.map((i) => i.x));
    const y0 = Math.min(...items.map((i) => i.y));
    const w = Math.max(...items.map((i) => i.x + i.width)) - x0;
    const h = Math.max(...items.map((i) => i.y + i.height)) - y0;
    const errId = 'tc-err';
    const body = html`<div class="tpl-dlg">
      <div class="tpl-row wrap">
        <label class="field">
          <span>${t('tpl.id')}</span>
          <input
            name="tid"
            class="mono"
            type="text"
            autocomplete="off"
            spellcheck="false"
            maxlength="48"
            .value=${this.tid}
            aria-invalid=${this.error ? 'true' : 'false'}
            aria-describedby=${this.error ? errId : nothing}
            @input=${(e: Event) => {
              this.tid = (e.target as HTMLInputElement).value;
              this.error = null;
            }}
          />
        </label>
        <label class="field grow">
          <span>${t('tpl.name')}</span>
          <input
            name="tname"
            type="text"
            maxlength="80"
            .value=${this.name}
            @input=${(e: Event) => {
              this.name = (e.target as HTMLInputElement).value;
            }}
          />
        </label>
        <span class="field">
          <span>${t('tpl.size')}</span>
          <span class="mono"
            >${items.length ? t('tpl.sizeValue', { w, h }) : t('tpl.sizeNone')}</span
          >
        </span>
      </div>
      ${this.paramsTable()} ${this.replacementsTable()}
      <label class="tpl-row">
        <input
          type="checkbox"
          name="replace"
          .checked=${this.replace}
          @change=${(e: Event) => {
            this.replace = (e.target as HTMLInputElement).checked;
          }}
        />
        ${t('tpl.replaceSel')}
      </label>
      <p class="help">${t('tpl.saveHelp', { file: `templates/${this.tid}.template.json` })}</p>
      ${
        this.error
          ? html`<p class="field-err" id=${errId} role="alert">${t(this.error)}</p>`
          : nothing
      }
    </div>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button class="btn primary" type="button" data-role="ok" @click=${() => this.submit()}>
        ${icon('template')}${t('tpl.create')}
      </button>`;
    return this.frame({
      title: t('tpl.createTitle', { n: items.length }),
      icon: 'template',
      body,
      foot,
    });
  }
}

customElements.define('mat-template-create-dialog', MatTemplateCreateDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-template-create-dialog': MatTemplateCreateDialog;
  }
}
