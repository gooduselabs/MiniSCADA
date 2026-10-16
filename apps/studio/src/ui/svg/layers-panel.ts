// Panel Lớp của trình vẽ SVG (feature 011, T163; FR-105; contracts/svg-editor.md §6; mockup studio-svg-draw cảnh 1, panel phải
// trên): lớp trên cùng trước, mỗi lớp có mắt (ẩn trong editor) và khóa (không chọn được trên canvas) chỉ lưu ở
// .mat-editor/svg-state.json, tên (nhấp: lớp nhận phần tử mới; nhấp đúp hoặc F2: đổi tên), số phần tử; dưới mỗi lớp là các
// phần tử cấp trên cùng (nhấp: chọn, được cả ở lớp khóa). Nút: thêm lớp, đưa lên, đưa xuống, xóa (hỏi). Danh sách dài cắt ở
// 300 phần tử mỗi lớp. Không dùng role="tree" vì mỗi hàng có nút bấm (tránh điều khiển lồng nhau).
import { html, nothing } from 'lit';
import { isElement, type NodeId } from '@mat/svg-edit';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import type { IconName } from '../../icons/icons.ts';
import type { SvgEditor } from '../../model/svg/editor.ts';
import { icon } from '../base.ts';

export const MAX_ROWS = 300;

const TAG_ICON: Readonly<Record<string, IconName>> = {
  g: 'group',
  rect: 'd-rect',
  circle: 'd-ellipse',
  ellipse: 'd-ellipse',
  line: 'd-line',
  polyline: 'd-poly',
  polygon: 'd-poly',
  path: 'd-node',
  text: 'text',
  use: 'link',
  image: 'shape',
};

export interface LayersCtx {
  app: StudioApp;
  rel: string;
  ed: SvgEditor;
  /** Tên lớp đang đổi tên (`''`: Lớp mặc định không đổi tên được). */
  renaming: string | null;
  setRenaming(name: string | null): void;
  /** uid đang có binding (dấu liên kết). */
  bound: ReadonlySet<string>;
  changed(targets: readonly NodeId[] | null): void;
  refresh(): void;
}

function rowLabel(name: string | null): string {
  return name === null ? t('svgd.layer.default') : name;
}

export function renderLayers(c: LayersCtx) {
  const { app, rel, ed } = c;
  const ws = app.svg;
  const rows = ed.layerRows();
  const cur = ed.currentLayer;
  const curReal = cur !== null;
  const run = (r: { ok: boolean; targets: readonly NodeId[] } | null) => {
    if (r?.ok) c.changed(r.targets);
    else if (ed.message) app.toast(ed.message);
    c.refresh();
  };
  return html`<section class="sv-sec sv-layers-sec" aria-labelledby="sv-layers-h">
    <div class="pane-h">
      <span id="sv-layers-h">${t('svgd.layers')}</span>
      <span class="sv-hbtns">
        <button
          type="button"
          class="ibtn sm"
          data-act="layer-add"
          aria-label=${t('svgd.layer.add')}
          title=${t('svgd.layer.add')}
          @click=${() => run(ed.addLayer())}
        >
          ${icon('plus')}
        </button>
        <button
          type="button"
          class="ibtn sm"
          data-act="layer-up"
          ?disabled=${!curReal}
          aria-label=${t('svgd.layer.up')}
          title=${t('svgd.layer.up')}
          @click=${() => curReal && run(ed.moveLayer(cur, 1))}
        >
          ${icon('forward')}
        </button>
        <button
          type="button"
          class="ibtn sm"
          data-act="layer-down"
          ?disabled=${!curReal}
          aria-label=${t('svgd.layer.down')}
          title=${t('svgd.layer.down')}
          @click=${() => curReal && run(ed.moveLayer(cur, -1))}
        >
          ${icon('backward')}
        </button>
        <button
          type="button"
          class="ibtn sm"
          data-act="layer-del"
          ?disabled=${!curReal}
          aria-label=${t('svgd.layer.delete')}
          title=${t('svgd.layer.deleteTip')}
          @click=${() => curReal && app.openDialog({ kind: 'svgLayerDelete', rel, layer: cur })}
        >
          ${icon('trash')}
        </button>
      </span>
    </div>
    <ul class="sv-layers" aria-label=${t('svgd.layers.list')}>
      ${rows.map((r) => {
        const name = rowLabel(r.name);
        const key = r.name ?? '';
        const isCur = r.name === cur;
        const kids = r.children.slice(0, MAX_ROWS);
        return html`<li class="lyr ${isCur ? 'cur' : ''}" data-layer=${key}>
          <div class="lrow">
            <button
              type="button"
              class="ibtn sm ${r.state.hidden ? 'off' : ''}"
              data-eye=${key}
              aria-pressed=${r.state.hidden ? 'true' : 'false'}
              aria-label=${t(r.state.hidden ? 'svgd.layer.show' : 'svgd.layer.hide', { name })}
              title=${t('svgd.layer.eyeTip')}
              @click=${() => ws.setLayerState(rel, r.name, { hidden: !r.state.hidden })}
            >
              ${icon(r.state.hidden ? 'eyeoff' : 'eye')}
            </button>
            <button
              type="button"
              class="ibtn sm"
              data-lock=${key}
              aria-pressed=${r.state.locked ? 'true' : 'false'}
              aria-label=${t(r.state.locked ? 'svgd.layer.unlock' : 'svgd.layer.lock', { name })}
              title=${t('svgd.layer.lockTip')}
              @click=${() => ws.setLayerState(rel, r.name, { locked: !r.state.locked })}
            >
              ${icon(r.state.locked ? 'lock' : 'unlock')}
            </button>
            ${
              c.renaming !== null && c.renaming === key && r.name !== null
                ? html`<input
                    class="input sm sv-lrename"
                    aria-label=${t('svgd.layer.renameLabel', { name })}
                    .value=${r.name}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter') {
                        const v = (e.target as HTMLInputElement).value;
                        c.setRenaming(null);
                        if (v.trim() && v.trim() !== r.name) ws.renameLayer(rel, r.name!, v);
                      } else if (e.key === 'Escape') c.setRenaming(null);
                    }}
                    @blur=${(e: FocusEvent) => {
                      const v = (e.target as HTMLInputElement).value;
                      c.setRenaming(null);
                      if (v.trim() && v.trim() !== r.name) ws.renameLayer(rel, r.name!, v);
                    }}
                  />`
                : html`<button
                    type="button"
                    class="lname"
                    aria-current=${isCur ? 'true' : 'false'}
                    title=${t('svgd.layer.nameTip')}
                    @click=${() => {
                      ed.currentLayer = r.name;
                      c.refresh();
                    }}
                    @dblclick=${() => r.name !== null && c.setRenaming(key)}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === 'F2' && r.name !== null) {
                        e.preventDefault();
                        c.setRenaming(key);
                      }
                    }}
                  >
                    ${icon('layer')}<span>${name}</span>
                  </button>`
            }
            <span class="cnt" aria-label=${t('svgd.layer.count', { n: r.children.length })}
              >${r.children.length}</span
            >
          </div>
          ${
            r.state.hidden
              ? nothing
              : html`<ul class="lkids" aria-label=${t('svgd.layer.items', { name })}>
                  ${kids.map((id) => {
                    const n = ed.doc.nodes.get(id);
                    if (!n || !isElement(n)) return nothing;
                    const uid = n.attrs.get('data-mat-uid') ?? '';
                    const sel = ed.selection.includes(id);
                    return html`<li>
                      <button
                        type="button"
                        class="el ${sel ? 'sel' : ''}"
                        data-nid=${id}
                        aria-pressed=${sel ? 'true' : 'false'}
                        @click=${(e: MouseEvent) => {
                          ed.selectFromPanel(id, e.shiftKey || e.ctrlKey);
                          c.refresh();
                        }}
                      >
                        ${icon(TAG_ICON[n.tag] ?? 'shape')}<span class="lbl">${ed.label(id)}</span>
                        <span class="tag mono">${n.tag}</span>
                        ${c.bound.has(uid) ? html`<span class="bnd" title=${t('svgd.layer.bound')}>${icon('link')}</span>` : nothing}
                      </button>
                    </li>`;
                  })}
                  ${
                    r.children.length > MAX_ROWS
                      ? html`<li class="more muted">
                          ${t('svgd.layer.more', { n: r.children.length - MAX_ROWS })}
                        </li>`
                      : nothing
                  }
                </ul>`
          }
        </li>`;
      })}
    </ul>
    <div class="foot-note">${t('svgd.layer.note')}</div>
  </section>`;
}
