// Thư viện template và trang một template (feature 011, T173; FR-126; mockup studio-svg-draw cảnh 3: thư viện, danh sách
// bản sao, "Cập nhật mọi bản sao"). Mục "Template" trên cây mở `templates` (danh sách thẻ: id, tên, tham số, số bản sao);
// mỗi template mở `template:<id>`: thông tin (cỡ, tham số, item), thanh công cụ (Thêm bản sao…, Cập nhật mọi bản sao,
// Xóa template…) và bảng bản sao (màn hình, id, tham số, số item, lệch). Bản sao luôn có màu tím `--tplc` kèm biểu tượng
// và chữ (T007 quyết định 11). Template tạo từ vùng chọn của editor Màn hình (menu ngữ cảnh, Ctrl+Shift+P "Tạo template").
import type { TemplateDoc } from '@mat/project-schema';
import { html, nothing } from 'lit';
import { instancesOfTemplate, templatesOf } from '../../app/template-actions.ts';
import { t } from '../../i18n/index.ts';
import type { InstanceInfo } from '../../model/template-doc.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './template-editor.css';

const paramsText = (tpl: TemplateDoc): string =>
  (tpl.params ?? []).map((p) => `${p.name} (${p.kind})`).join(', ') || t('tpl.lib.noParams');

const valuesText = (i: InstanceInfo): string =>
  Object.entries(i.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

export class MatTemplateLibrary extends AppElement {
  protected override render() {
    const app = this.app;
    const list = app.store.state.outline.templates;
    const readOnly = app.store.state.readOnly;
    return html`<div class="ed tpl-ed">
      <div class="ed-head">
        <h2>${icon('template')}${t('tree.templates')}</h2>
        <span class="grow"></span>
        <span class="chip tpl">${icon('template')}${t('tpl.lib.count', { n: list.length })}</span>
      </div>
      ${
        list.length === 0
          ? html`<div class="empty">
              ${icon('template', 'lg')}
              <b>${t('tpl.lib.empty')}</b>
              <p>${t('tpl.lib.howto')}</p>
            </div>`
          : html`<ul class="tpl-cards" aria-label=${t('tree.templates')}>
              ${list.map((tp) => {
                const n = tp.doc ? instancesOfTemplate(app, tp.id).length : 0;
                return html`<li class="tpl-card" data-tid=${tp.id}>
                  <button
                    type="button"
                    class="tpl-open"
                    @click=${() => app.openEditor(`template:${tp.id}`)}
                  >
                    <span class="mono"><b>${tp.id}</b></span>
                    <span>${tp.doc?.name ?? t('tpl.lib.broken', { file: tp.file })}</span>
                    <small>${tp.doc ? paramsText(tp.doc) : ''}</small>
                    <small>${t('tree.templateInstances', { n })}</small>
                  </button>
                  ${
                    tp.doc && !readOnly
                      ? html`<button
                          type="button"
                          class="btn sm"
                          data-act="add-instance"
                          @click=${() => app.openDialog({ kind: 'templateInstance', tid: tp.id })}
                        >
                          ${icon('plus')}${t('tpl.inst.addShort')}
                        </button>`
                      : nothing
                  }
                </li>`;
              })}
            </ul>`
      }
      <p class="help pad">${t('tpl.lib.help')}</p>
    </div>`;
  }
}

export class MatTemplateEditor extends AppElement {
  static override properties = { tid: { attribute: false } };
  declare tid: string;

  constructor() {
    super();
    this.tid = '';
  }

  protected override render() {
    const app = this.app;
    const tpl = templatesOf(app)[this.tid];
    if (!tpl)
      return html`<div class="ed">
        <div class="empty">
          ${icon('template', 'lg')}
          <p>${t('tpl.err.noTemplate', { id: this.tid })}</p>
        </div>
      </div>`;
    const list = instancesOfTemplate(app, this.tid);
    const readOnly = app.store.state.readOnly;
    const drift = new Set(
      app.store.state.issues
        .filter((i) => i.code === 'W_TEMPLATE_DRIFT' || i.code === 'E_TEMPLATE_TAG_REF')
        .map((i) => `${i.file}|${/^\/items\/(\d+)/.exec(i.path)?.[1] ?? ''}`),
    );
    const statusOf = (i: InstanceInfo): 'ok' | 'drift' => {
      const s = app.store.state.outline.screens.find((x) => x.id === i.screen);
      const items = s?.model?.items ?? [];
      return i.ids.some((id) => drift.has(`${s?.file}|${items.findIndex((x) => x.id === id)}`)) ||
        i.extra.length
        ? 'drift'
        : 'ok';
    };
    return html`<div class="ed tpl-ed">
      <div class="ed-head">
        <h2>${icon('template')}<span class="mono">${tpl.id}</span> · ${tpl.name}</h2>
        <span class="grow"></span>
        <span class="chip tpl"
          >${icon('template')}${t('tree.templateInstances', { n: list.length })}</span
        >
      </div>
      <div class="ed-tools" role="toolbar" aria-label=${t('tpl.ed.toolbar')}>
        <button
          type="button"
          class="btn"
          data-act="add-instance"
          ?disabled=${readOnly}
          @click=${() => app.openDialog({ kind: 'templateInstance', tid: tpl.id })}
        >
          ${icon('plus')}${t('tpl.inst.addShort')}
        </button>
        <button
          type="button"
          class="btn primary"
          data-act="update-all"
          ?disabled=${readOnly || list.length === 0}
          @click=${() => app.openDialog({ kind: 'templateUpdate', tid: tpl.id })}
        >
          ${icon('refresh')}${t('tpl.upd.button', { n: list.length })}
        </button>
        <span class="grow"></span>
        <button
          type="button"
          class="btn"
          data-act="delete"
          ?disabled=${readOnly}
          @click=${() => app.openDialog({ kind: 'templateDelete', tid: tpl.id })}
        >
          ${icon('x')}${t('tpl.del.button')}
        </button>
      </div>
      <dl class="tpl-kv pad">
        <dt>${t('tpl.size')}</dt>
        <dd class="mono">${t('tpl.sizeValue', { w: tpl.size.width, h: tpl.size.height })}</dd>
        <dt>${t('tpl.paramsLabel')}</dt>
        <dd class="mono">${paramsText(tpl)}</dd>
        <dt>${t('tpl.itemsLabel')}</dt>
        <dd class="mono">${tpl.items.map((i) => i.id).join(', ')}</dd>
        <dt>${t('tpl.fileLabel')}</dt>
        <dd class="mono">templates/${tpl.id}.template.json</dd>
      </dl>
      <h3 class="pad">${t('tpl.ed.instances')}</h3>
      ${
        list.length === 0
          ? html`<p class="help pad">${t('tpl.ed.noInstances')}</p>`
          : html`<div class="tpl-scroll">
              <table class="tpl-list" aria-label=${t('tpl.ed.instances')}>
                <thead>
                  <tr>
                    <th scope="col">${t('tpl.col.screen')}</th>
                    <th scope="col">${t('tpl.col.inst')}</th>
                    <th scope="col">${t('tpl.col.values')}</th>
                    <th scope="col">${t('tpl.col.items')}</th>
                    <th scope="col">${t('tpl.col.status')}</th>
                    <th scope="col">
                      <span class="visually-hidden">${t('tpl.col.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  ${list.map((i) => {
                    const st = statusOf(i);
                    return html`<tr data-inst=${i.inst} data-screen=${i.screen}>
                      <td>${app.screenModel(i.screen)?.name ?? i.screen}</td>
                      <td class="mono">
                        <span class="chip tpl">${icon('template')}${i.inst}</span>
                      </td>
                      <td class="mono">${valuesText(i)}</td>
                      <td class="mono">${i.ids.length}</td>
                      <td>
                        ${
                          st === 'ok'
                            ? html`<span class="chip ok">${icon('ok')}${t('tpl.st.ok')}</span>`
                            : html`<span class="chip warn"
                                >${icon('warn')}${t('tpl.st.drift')}</span
                              >`
                        }
                      </td>
                      <td class="acts">
                        <button
                          type="button"
                          class="btn sm"
                          data-act="goto"
                          @click=${() => {
                            app.openEditor(`screen:${i.screen}`);
                            app.selectItems(i.screen, i.ids);
                          }}
                        >
                          ${t('tpl.ed.goto')}
                        </button>
                        <button
                          type="button"
                          class="btn sm"
                          data-act="params"
                          ?disabled=${readOnly}
                          @click=${() =>
                            app.openDialog({
                              kind: 'templateInstance',
                              tid: tpl.id,
                              screen: i.screen,
                              inst: i.inst,
                            })}
                        >
                          ${t('tpl.ed.params')}
                        </button>
                      </td>
                    </tr>`;
                  })}
                </tbody>
              </table>
            </div>`
      }
    </div>`;
  }
}

customElements.define('mat-template-library', MatTemplateLibrary);
customElements.define('mat-template-editor', MatTemplateEditor);

registerEditor({
  match: (id) => id === 'templates',
  render: (app) => html`<mat-template-library .app=${app}></mat-template-library>`,
});
registerEditor({
  match: (id) => id.startsWith('template:'),
  render: (app, id) =>
    html`<mat-template-editor
      .app=${app}
      .tid=${id.slice('template:'.length)}
    ></mat-template-editor>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-template-library': MatTemplateLibrary;
    'mat-template-editor': MatTemplateEditor;
  }
}
