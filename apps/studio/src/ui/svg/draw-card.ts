// Task card "Công cụ vẽ" khi trình vẽ SVG mở (feature 011, T163 phần còn lại; mockup studio-svg-draw.html cảnh 1 không có
// Toolbox widget ở bên phải): thay Toolbox widget và Ký hiệu của editor Màn hình. Công cụ: cùng bộ với Toolbox dọc trong editor
// (cùng lệnh `svg.tool*`, cùng phím tắt), kèm tên đầy đủ. Bảng màu: màu tô và màu viền áp cho phần tử đang chọn qua `setProp`
// (một bước hoàn tác, như ô màu của Thuộc tính). Dữ liệu chỉ qua binding của Lit.
import { html, nothing } from 'lit';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import { setProp } from '../../model/svg/props.ts';
import { SVG_KEYS } from '../../model/svg/keys.ts';
import { icon } from '../base.ts';
import { TOOLS, type ToolDef } from './tools.ts';

/** Màu thường dùng cho đồ họa HMI (nền xám, trạng thái chạy, dừng, cảnh báo, lỗi, nước, viền). */
export const DRAW_SWATCHES: readonly string[] = [
  '#ffffff',
  '#cfd8dc',
  '#90a4ae',
  '#546e7a',
  '#263238',
  '#2e7d32',
  '#f9a825',
  '#c62828',
  '#1565c0',
  '#4fc3f7',
];

const SVGDRAW = 'svgdraw:';

function paint(app: StudioApp, rel: string, key: 'fill' | 'stroke', color: string): void {
  const ed = app.svg.editor(rel);
  if (!ed || ed.selection.length === 0) {
    app.toast(t('tc.draw.noSel'));
    return;
  }
  const r = setProp(ed, key, color);
  if (r.ok) app.svg.changed(rel, r.targets);
  else if ('reason' in r) app.toast(r.reason);
  else if (ed.message) app.toast(ed.message);
}

function swatches(app: StudioApp, rel: string, key: 'fill' | 'stroke', ok: boolean) {
  const what = t(key === 'fill' ? 'tc.draw.fill' : 'tc.draw.stroke');
  return html`<div class="tc-swatches" role="group" aria-label=${what}>
    <span class="sw-lbl">${what}</span>
    ${DRAW_SWATCHES.map(
      (c) =>
        html`<button
          type="button"
          class="sw ${key}"
          data-swatch=${key}
          data-color=${c}
          style=${`--sw:${c}`}
          aria-label=${t('tc.draw.swatch', { what, color: c })}
          title=${t('tc.draw.swatch', { what, color: c })}
          ?disabled=${!ok}
          @click=${() => paint(app, rel, key, c)}
        ></button>`,
    )}
  </div>`;
}

export function renderDrawCard(app: StudioApp, refresh: () => void) {
  const active = app.store.state.active;
  const rel = active.startsWith(SVGDRAW) ? active.slice(SVGDRAW.length) : null;
  const ed = rel ? app.svg.editor(rel) : null;
  const ro = app.store.state.readOnly;
  return html`<div class="tc-draw">
    <div class="pane-h"><span>${t('tc.draw.tools')}</span></div>
    ${rel === null ? html`<p class="help pad">${t('tc.draw.newFirst')}</p>` : nothing}
    <div
      class="tc-tools"
      role="toolbar"
      aria-orientation="vertical"
      aria-label=${t('svgd.toolbox')}
    >
      ${TOOLS.filter((d): d is ToolDef => d !== null).map(
        (d) =>
          html`<button
            type="button"
            class="tc-dtool"
            data-tool=${d.tool}
            aria-pressed=${ed?.tool === d.tool ? 'true' : 'false'}
            ?disabled=${!ed}
            @click=${() => void app.run(d.cmd).then(refresh)}
          >
            ${icon(d.icon)}<span class="nm">${t(d.label)}</span
            ><kbd class="k">${SVG_KEYS[d.cmd] ?? ''}</kbd>
          </button>`,
      )}
    </div>
    <div class="pane-h"><span>${t('tc.draw.fill')} · ${t('tc.draw.stroke')}</span></div>
    ${rel ? swatches(app, rel, 'fill', !!ed && !ro) : nothing}
    ${rel ? swatches(app, rel, 'stroke', !!ed && !ro) : nothing}
    <p class="help pad">${t('tc.draw.paletteHelp')}</p>
    <p class="help pad sm-text">${t('svgd.limits.text')}</p>
  </div>`;
}
