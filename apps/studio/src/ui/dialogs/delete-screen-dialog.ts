// Hộp thoại Xóa màn hình (feature 007, T109, FR-065): liệt kê mọi chỗ trỏ tới màn hình (màn hình đầu, mục menu điều hướng, nút
// chuyển màn hình hoặc mở popup) rồi hỏi trước khi xóa; chỗ trỏ không tự sửa, thành lỗi của bước kiểm tra. Hủy là nút có focus
// ban đầu (xóa là việc khó hoàn lại ngoài Ctrl+Z).
import { html, nothing } from 'lit';
import { t } from '../../i18n/index.ts';
import { planRemoveScreen, screenRefs, type ScreenRef } from '../../model/screen-ops.ts';
import { icon } from '../base.ts';
import { OnlineDialog } from './dialog-frame.ts';
import './screen-dialogs.css';

export function refText(r: ScreenRef): string {
  switch (r.kind) {
    case 'entry':
      return t('dsd.ref.entry');
    case 'nav':
      return t('dsd.ref.nav', { label: r.label });
    case 'svgEvent':
      return t('screenref.svgEvent', {
        action: r.action,
        item: r.itemName,
        element: r.elementName,
        screen: r.screenName,
      });
    case 'action':
      return t(r.action === 'popup' ? 'dsd.ref.popup' : 'dsd.ref.navigate', {
        item: r.itemName,
        screen: r.screenName,
      });
  }
}

export class MatDeleteScreenDialog extends OnlineDialog {
  protected get kind(): 'deleteScreen' {
    return 'deleteScreen';
  }

  private screenId(): string | null {
    const d = this.hasApp ? this.app.ui.dialog : null;
    return d?.kind === 'deleteScreen' ? d.id : null;
  }

  protected override initialFocus(): HTMLElement | null {
    return this.querySelector<HTMLElement>('[data-role="cancel"]');
  }

  private confirm(id: string): void {
    const app = this.app;
    const name = app.store.state.outline.screens.find((s) => s.id === id)?.model?.name ?? id;
    app.store.edit(planRemoveScreen(id));
    // Tab của màn hình đã xóa đóng theo; chọn trên cây bỏ.
    app.store.closeTab(`screen:${id}`);
    app.closeOnlineDialog();
    app.toast(t('tree.removed', { name }));
  }

  protected override render() {
    const id = this.screenId();
    if (!this.isOpen || id === null) return nothing;
    const outline = this.app.store.state.outline;
    const screen = outline.screens.find((s) => s.id === id)?.model;
    if (!screen) return nothing;
    const refs = screenRefs(outline, id);
    const body = html`<p>${t('dsd.text', { name: screen.name, id })}</p>
      ${
        refs.length
          ? html`<h3 class="dlg-sub">${t('dsd.refs', { count: refs.length })}</h3>
              <ul class="sd-refs">
                ${refs.map((r) => html`<li>${refText(r)}</li>`)}
              </ul>
              <div class="banner warn" role="note">
                ${icon('warn', 'warn')}
                <div>${t('dsd.warn')}</div>
              </div>`
          : html`<p class="help">${t('dsd.noRefs')}</p>`
      }`;
    const foot = html`<span class="grow"></span
      ><button class="btn" type="button" data-role="cancel" @click=${() => this.close()}>
        ${t('dlg.cancel')}</button
      ><button class="btn danger" type="button" data-role="ok" @click=${() => this.confirm(id)}>
        ${t('dsd.do')}
      </button>`;
    return this.frame({ title: t('dsd.title'), icon: 'warn', body, foot });
  }
}

customElements.define('mat-delete-screen-dialog', MatDeleteScreenDialog);

declare global {
  interface HTMLElementTagNameMap {
    'mat-delete-screen-dialog': MatDeleteScreenDialog;
  }
}
