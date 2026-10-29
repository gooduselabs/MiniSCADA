// Trang nhóm trên cây (sửa lỗi 039): bấm một lần vào mục nhóm (Bảng giá trị, Bảng theo dõi, Màn hình, Tag, Alarm, Người
// dùng và quyền) mở trang này: một câu nói mục dùng để làm gì, ví dụ, danh sách mục con (bấm để mở) và nút "Thêm …" lớn.
// Trước đây các mục nhóm không có editor nên bấm vào không có phản hồi, nhất là khi danh sách rỗng.
import { html, nothing } from 'lit';
import { t, type MessageKey } from '../../i18n/index.ts';
import { findNode, type GroupKey } from '../../model/tree.ts';
import { screenAdd, treeAddTo } from '../../app/tree-commands.ts';
import type { StudioApp } from '../../app/app.ts';
import { AppElement, icon } from '../base.ts';
import { registerEditor } from '../registry.ts';
import './group-page.css';

/** Nút Thêm của nhóm; `null` khi nhóm không thêm trực tiếp (thêm ở editor con). */
function addAction(app: StudioApp, key: GroupKey): (() => void) | null {
  const o = app.store.state.outline;
  if (key === 'valueTables') return () => treeAddTo(app, { type: 'valueTables' });
  if (key === 'watchTables') return () => treeAddTo(app, { type: 'watchTables' });
  if (key === 'screens' && o.schema === '0.3') return () => screenAdd(app, 'screen');
  return null;
}

export class GroupPageEl extends AppElement {
  private key: GroupKey = 'valueTables';

  set groupKey(key: GroupKey) {
    this.key = key;
    this.requestUpdate();
  }

  protected override render() {
    const app = this.app;
    const key = this.key;
    const node = findNode(app.tree(), key);
    if (!node) return nothing;
    const kids = node.children ?? [];
    const add = addAction(app, key);
    const addLabel = add ? t(`group.${key}.add` as MessageKey) : '';
    return html`<div class="ed group-page" data-group=${key}>
      <div class="ed-head">
        <h2>${node.label}</h2>
        ${node.count !== undefined ? html`<span class="chip">${node.count}</span>` : nothing}
      </div>
      <div class="gp-intro">
        ${icon(node.icon, 'lg')}
        <div>
          <p class="gp-what">${t(`group.${key}.what` as MessageKey)}</p>
          <p class="gp-example">${t(`group.${key}.example` as MessageKey)}</p>
        </div>
      </div>
      ${
        add
          ? html`<button type="button" class="btn primary gp-add" @click=${add}>
              ${icon('plus')} ${addLabel}
            </button>`
          : nothing
      }
      <h3 class="gp-sub">${t('group.items')}</h3>
      ${
        kids.length
          ? html`<ul class="gp-list">
              ${kids.map(
                (k) =>
                  html`<li>
                    <button
                      type="button"
                      class="gp-item"
                      data-node=${k.id}
                      @click=${() => app.selectNode(k.id, true)}
                    >
                      ${icon(k.icon)} <span>${k.label}</span>
                      ${k.count !== undefined ? html`<span class="muted">${k.count}</span>` : nothing}
                    </button>
                  </li>`,
              )}
            </ul>`
          : html`<p class="muted gp-empty">${t('group.emptyList')}</p>`
      }
    </div>`;
  }
}

customElements.define('mat-group-page', GroupPageEl);

registerEditor({
  match: (id) => id.startsWith('group:'),
  render: (app, id) =>
    html`<mat-group-page
      .app=${app}
      .groupKey=${id.slice('group:'.length) as GroupKey}
    ></mat-group-page>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-group-page': GroupPageEl;
  }
}
