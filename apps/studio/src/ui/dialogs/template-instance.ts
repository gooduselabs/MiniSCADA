// Hộp thoại bản sao template (feature 011, T173; FR-126): "Thêm bản sao…" (màn hình, id bản sao, giá trị tham số, điểm
// đặt) hoặc "Tham số của bản sao…" (sửa giá trị tham số của bản sao có sẵn: bung lại riêng bản sao đó, giữ điểm đặt và
// cỡ). Giá trị kiểm theo kiểu tham số ngay khi gõ (cùng luật với bộ kiểm: `paramValueError`); áp bằng MỘT `store.edit`.
import { paramValueError, type ParamDecl } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { instancesOfTemplate, screensOf, templatesOf } from '../../app/template-actions.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import { addInstance, nextInstanceId, setInstanceParams } from '../../model/template-doc.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import { REJECT_KEY } from './template-create.ts';
import './template-dialogs.css';

export class MatTemplateInstanceDialog extends OnlineDialog {
  static override properties = {
    screen: { state: true },
    inst: { state: true },
    values: { state: true },
    x: { state: true },
    y: { state: true },
    error: { state: true },
  };

  protected get kind(): 'templateInstance' {
    return 'templateInstance';
  }

  declare screen: string;
  declare inst: string;
  declare values: Record<string, string>;
  declare x: string;
  declare y: string;
  declare error: MessageKey | null;

  constructor() {
    super();
    this.screen = '';
    this.inst = '';
    this.values = {};
    this.x = '0';
    this.y = '0';
    this.error = null;
  }

  private spec() {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'templateInstance' ? d : null;
  }

  private template() {
    const s = this.spec();
    return s ? (templatesOf(this.app)[s.tid] ?? null) : null;
  }

  private editing(): boolean {
    return this.spec()?.inst !== undefined;
  }

  protected override opened(): void {
    const s = this.spec();
    const tpl = this.template();
    if (!s || !tpl) return;
    const screens = screensOf(this.app).filter((x) => (x.kind ?? 'screen') !== 'popup');
    this.screen = s.screen ?? screens[0]?.id ?? '';
    this.error = null;
    if (s.inst !== undefined) {
      const info = instancesOfTemplate(this.app, s.tid).find(
        (i) => i.inst === s.inst && i.screen === s.screen,
      );
      this.inst = s.inst;
      this.values = { ...(info?.params ?? {}) };
      return;
    }
    const doc = this.app.screenModel(this.screen);
    this.inst = doc ? nextInstanceId(doc, tpl.id) : `${tpl.id}1`;
    this.values = {};
    // điểm đặt: dưới bản sao cuối cùng của màn hình, hoặc góc trên trái
    const last = instancesOfTemplate(this.app, s.tid)
      .filter((i) => i.screen === this.screen)
      .at(-1);
    this.x = String(last ? last.at.x + tpl.size.width + 20 : 20);
    this.y = String(last ? last.at.y : 20);
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.tpl-dlg input:not([disabled]), .tpl-dlg select');
  }

  private problem(p: ParamDecl): string | null {
    const v = this.values[p.name];
    if (v === undefined || v === '') return p.default === undefined ? t('tpl.inst.required') : null;
    return paramValueError(p.kind, v);
  }

  private submit(): void {
    const s = this.spec();
    const tpl = this.template();
    const doc = this.app.screenModel(this.screen);
    if (!s || !tpl || !doc) return;
    const params = tpl.params ?? [];
    if (params.some((p) => this.problem(p) !== null)) {
      this.error = 'tpl.err.args';
      return;
    }
    const values: Record<string, string> = {};
    for (const p of params) {
      const v = this.values[p.name];
      if (v !== undefined && v !== '') values[p.name] = v;
    }
    if (this.editing()) {
      const next = setInstanceParams(doc, tpl, s.inst!, values);
      if (!next) {
        this.error = 'tpl.err.args';
        return;
      }
      if (next !== doc) this.app.store.edit([{ kind: 'screenUpsert', screen: next }]);
      this.app.closeOnlineDialog();
      return;
    }
    const x = Number(this.x);
    const y = Number(this.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      this.error = 'tpl.err.at';
      return;
    }
    const r = addInstance(doc, tpl, { inst: this.inst.trim(), params: values, at: { x, y } });
    if (!r.ok) {
      this.error = REJECT_KEY[r.reason];
      return;
    }
    this.app.store.edit([{ kind: 'screenUpsert', screen: r.screen }]);
    this.app.closeOnlineDialog();
    this.app.openEditor(`screen:${this.screen}`);
    this.app.selectItems(this.screen, r.ids);
    this.app.toast(t('tpl.inst.added', { inst: r.inst, screen: this.screen }));
  }

  protected override render() {
    const s = this.spec();
    const tpl = this.template();
    if (!this.isOpen || !s || !tpl) return nothing;
    const edit = this.editing();
    const screens = screensOf(this.app).filter((x) => (x.kind ?? 'screen') !== 'popup');
    const errId = 'ti-err';
    const params = tpl.params ?? [];
    const body = html`<div class="tpl-dlg">
      <div class="tpl-row wrap">
        <label class="field">
          <span>${t('tpl.inst.screen')}</span>
          <select
            name="screen"
            ?disabled=${edit || s.screen !== undefined}
            @change=${(e: Event) => {
              this.screen = (e.target as HTMLSelectElement).value;
              const doc = this.app.screenModel(this.screen);
              if (doc) this.inst = nextInstanceId(doc, tpl.id);
            }}
          >
            ${screens.map(
              (x) =>
                html`<option value=${x.id} ?selected=${x.id === this.screen}>${x.name}</option>`,
            )}
          </select>
        </label>
        <label class="field">
          <span>${t('tpl.inst.id')}</span>
          <input
            name="inst"
            class="mono"
            type="text"
            maxlength="32"
            autocomplete="off"
            spellcheck="false"
            ?disabled=${edit}
            .value=${this.inst}
            @input=${(e: Event) => {
              this.inst = (e.target as HTMLInputElement).value;
              this.error = null;
            }}
          />
        </label>
        ${
          edit
            ? nothing
            : html`<label class="field">
                  <span>X</span>
                  <input
                    name="x"
                    class="mono"
                    type="text"
                    inputmode="numeric"
                    .value=${this.x}
                    @input=${(e: Event) => {
                      this.x = (e.target as HTMLInputElement).value;
                    }}
                  />
                </label>
                <label class="field">
                  <span>Y</span>
                  <input
                    name="y"
                    class="mono"
                    type="text"
                    inputmode="numeric"
                    .value=${this.y}
                    @input=${(e: Event) => {
                      this.y = (e.target as HTMLInputElement).value;
                    }}
                  />
                </label>`
        }
      </div>
      ${
        params.length === 0
          ? html`<p class="help">${t('tpl.inst.noParams')}</p>`
          : html`<table class="tpl-tb" aria-label=${t('tpl.inst.values')}>
              <thead>
                <tr>
                  <th scope="col">${t('tpl.col.name')}</th>
                  <th scope="col">${t('tpl.col.kind')}</th>
                  <th scope="col">${t('tpl.col.value')}</th>
                  <th scope="col">${t('tpl.col.check')}</th>
                </tr>
              </thead>
              <tbody>
                ${params.map((p) => {
                  const bad = this.problem(p);
                  return html`<tr data-param=${p.name}>
                    <td class="mono">${p.name}</td>
                    <td class="mono">${p.kind}</td>
                    <td>
                      <input
                        name=${`v-${p.name}`}
                        aria-label=${t('tpl.inst.valueOf', { name: p.name })}
                        aria-invalid=${bad ? 'true' : 'false'}
                        placeholder=${p.default ?? ''}
                        .value=${this.values[p.name] ?? ''}
                        @input=${(e: Event) => {
                          this.values = {
                            ...this.values,
                            [p.name]: (e.target as HTMLInputElement).value,
                          };
                          this.error = null;
                        }}
                      />
                    </td>
                    <td class=${bad ? 'bad' : ''}>${bad ?? t('tpl.ok')}</td>
                  </tr>`;
                })}
              </tbody>
            </table>`
      }
      <p class="help">${t('tpl.inst.help', { id: tpl.id })}</p>
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
        ${icon('template')}${t(edit ? 'tpl.inst.apply' : 'tpl.inst.add')}
      </button>`;
    return this.frame({
      title: t(edit ? 'tpl.inst.editTitle' : 'tpl.inst.addTitle', {
        id: tpl.id,
        inst: s.inst ?? '',
      }),
      icon: 'template',
      body,
      foot,
    });
  }
}

customElements.define('mat-template-instance-dialog', MatTemplateInstanceDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-template-instance-dialog': MatTemplateInstanceDialog;
  }
}
