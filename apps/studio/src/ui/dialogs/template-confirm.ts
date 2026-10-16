// Hai hộp xác nhận của template (feature 011, T173; FR-121, FR-126; mockup studio-svg-draw cảnh 3 `updDlg`, `tdelDlg`):
//  - "Cập nhật mọi bản sao": số bản sao, màn hình, phần giữ riêng, item thêm tay sẽ bị xóa (W_TEMPLATE_DRIFT), bản sao không
//    bung lại được (tham số thiếu với template mới), một bước hoàn tác;
//  - "Xóa template còn bản sao" (T007 quyết định 10): chỉ "Bung N bản sao và xóa template" hoặc Hủy, không có xóa luôn
//    bản sao. Template không có bản sao: xóa thẳng (vẫn một bước hoàn tác).
import { html, nothing } from 'lit';
import {
  applyDeleteTemplate,
  applyUpdateAll,
  instancesOfTemplate,
  screensOf,
  templatesOf,
} from '../../app/template-actions.ts';
import { t } from '../../i18n/index.ts';
import { planUpdateAll } from '../../model/template-doc.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './template-dialogs.css';

export class MatTemplateConfirmDialog extends OnlineDialog {
  #kind: 'templateUpdate' | 'templateDelete' = 'templateUpdate';

  protected get kind(): 'templateUpdate' | 'templateDelete' {
    const d = this.hasApp ? this.app.ui.dialog : null;
    if (d?.kind === 'templateUpdate' || d?.kind === 'templateDelete') this.#kind = d.kind;
    return this.#kind;
  }

  private tid(): string | null {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'templateUpdate' || d?.kind === 'templateDelete' ? d.tid : null;
  }

  protected override render() {
    const tid = this.tid();
    if (!this.isOpen || tid === null) return nothing;
    return this.kind === 'templateUpdate' ? this.updateView(tid) : this.removeView(tid);
  }

  private updateView(tid: string) {
    const tpl = templatesOf(this.app)[tid];
    if (!tpl) return nothing;
    const plan = planUpdateAll(screensOf(this.app), tpl);
    const list = instancesOfTemplate(this.app, tid);
    const perScreen = new Map<string, number>();
    for (const i of list) perScreen.set(i.screen, (perScreen.get(i.screen) ?? 0) + 1);
    const where = [...perScreen].map(([s, n]) => `${this.app.screenModel(s)?.name ?? s} ${n}`);
    const body = html`<div class="tpl-dlg">
      <dl class="tpl-kv">
        <dt>${t('tpl.upd.applyTo')}</dt>
        <dd data-k="count">
          ${t('tpl.upd.count', { n: list.length, screens: perScreen.size, list: where.join(', ') })}
        </dd>
        <dt>${t('tpl.upd.keep')}</dt>
        <dd>${t('tpl.upd.keepText')}</dd>
        <dt>${t('tpl.upd.undo')}</dt>
        <dd>${t('tpl.upd.undoText')}</dd>
      </dl>
      ${
        plan.removed.length
          ? html`<div class="tpl-box warn" role="note">
              ${icon('warn', 'warn')}
              <span>${t('tpl.upd.removed', { list: plan.removed.join(', ') })}</span>
            </div>`
          : nothing
      }
      ${
        plan.failed.length
          ? html`<div class="tpl-box err" role="note">
              ${icon('err', 'err')}
              <span>${t('tpl.upd.failed', { list: plan.failed.join(', ') })}</span>
            </div>`
          : nothing
      }
    </div>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button
        class="btn primary"
        type="button"
        data-role="ok"
        ?disabled=${plan.instances === 0}
        @click=${() => {
          this.app.closeOnlineDialog();
          applyUpdateAll(this.app, tid);
        }}
      >
        ${icon('refresh')}${t('tpl.upd.do', { n: plan.instances })}
      </button>`;
    return this.frame({ title: t('tpl.upd.title', { id: tid }), icon: 'refresh', body, foot });
  }

  private removeView(tid: string) {
    const list = instancesOfTemplate(this.app, tid);
    const screens = new Set(list.map((i) => i.screen)).size;
    const body = html`<div class="tpl-dlg">
      ${
        list.length
          ? html`<p data-k="count">
                ${t('tpl.del.has', {
                  n: list.length,
                  screens,
                  first: list[0]!.inst,
                  last: list.at(-1)!.inst,
                })}
              </p>
              <p>${t('tpl.del.only')}</p>
              <p class="help">${t('tpl.del.help')}</p>`
          : html`<p>${t('tpl.del.none')}</p>`
      }
    </div>`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button
        class="btn danger"
        type="button"
        data-role="ok"
        @click=${() => {
          this.app.closeOnlineDialog();
          applyDeleteTemplate(this.app, tid);
        }}
      >
        ${icon('x')}${list.length ? t('tpl.del.do', { n: list.length }) : t('tpl.del.doNone')}
      </button>`;
    return this.frame({ title: t('tpl.del.title', { id: tid }), icon: 'warn', body, foot });
  }
}

customElements.define('mat-template-confirm-dialog', MatTemplateConfirmDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-template-confirm-dialog': MatTemplateConfirmDialog;
  }
}
