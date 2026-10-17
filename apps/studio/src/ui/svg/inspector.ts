// Panel Thuộc tính của trình vẽ SVG (feature 011, T163; FR-106; contracts/svg-editor.md §8; mockup studio-svg-draw cảnh 1, panel
// phải dưới): tab Chung (thẻ, tên hiển thị, id, lớp, uid), Hình học (X, Y, Rộng, Cao, Góc, khóa tỉ lệ, bo góc, bán kính, nơi
// ghi: thuộc tính hay transform, "Co cả nét"), Hiển thị (tô, viền qua bộ chọn màu kèm mã hex, độ dày, nét đứt, đầu mút, độ mờ,
// visibility), Văn bản (nội dung, phông an toàn, cỡ, đậm, nghiêng, canh) và Gắn Tag (tóm tắt binding của uid, mở inspector 13
// dòng của feature 008; T007 quyết định 6). Ô số nhận dấu phẩy; sai thì aria-invalid và lời nhắn, không đổi tài liệu.
import { html, nothing, type TemplateResult } from 'lit';
import { listLayers, type NodeId } from '@mat/svg-edit';
import type { StudioApp } from '../../app/app.ts';
import type { BoundRef, PropTab, SvgView } from '../../app/svg-workspace.ts';
import { t, type MessageKey } from '../../i18n/index.ts';
import type { SvgEditor } from '../../model/svg/editor.ts';
import { DASH_PRESETS, SAFE_FONTS, propsOf, setProp, type PropKey } from '../../model/svg/props.ts';
import { fmt } from '@mat/svg-edit';
import { icon } from '../base.ts';

export interface InspectorCtx {
  app: StudioApp;
  rel: string;
  ed: SvgEditor;
  view: SvgView;
  /** Lý do sai của ô (theo khóa). */
  invalid: ReadonlyMap<PropKey, string>;
  setInvalid(key: PropKey, reason: string | null): void;
  changed(targets: readonly NodeId[] | null): void;
  refresh(): void;
  refs(uid: string): BoundRef[];
}

const TABS: ReadonlyArray<{ id: PropTab; label: MessageKey }> = [
  { id: 'common', label: 'svgd.tab.common' },
  { id: 'geom', label: 'svgd.tab.geom' },
  { id: 'paint', label: 'svgd.tab.paint' },
  { id: 'text', label: 'svgd.tab.text' },
  { id: 'bind', label: 'svgd.tab.bind' },
];

const n3 = (v: number) => fmt(Math.round(v * 1000) / 1000);
const hexOf = (v: string): string => {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const named: Record<string, string> = {
    black: '#000000',
    white: '#ffffff',
    red: '#ff0000',
    blue: '#0000ff',
    green: '#008000',
  };
  return named[s] ?? '#000000';
};

function apply(
  c: InspectorCtx,
  key: PropKey,
  value: string,
  opts: { mergeKey?: string } = {},
): void {
  const r = setProp(c.ed, key, value, { lockRatio: c.view.lockRatio, ...opts });
  if (!r.ok && 'reason' in r) {
    c.setInvalid(key, r.reason);
    return;
  }
  c.setInvalid(key, null);
  if (r.ok) c.changed(r.targets);
  else if (c.ed.message) c.app.toast(c.ed.message);
  c.refresh();
}

/** Ô nhập (chốt khi Enter hoặc rời ô). */
function field(
  c: InspectorCtx,
  key: PropKey,
  label: string,
  value: string,
  opts: { short?: string; mono?: boolean; disabled?: boolean } = {},
) {
  const id = `svp-${key}`;
  const bad = c.invalid.get(key);
  return html`<div class="prow sv-prow" data-field=${key}>
    <label for=${id}>${label}</label>
    <span class="nin ${opts.mono ? 'mono' : ''}">
      ${opts.short ? html`<span aria-hidden="true">${opts.short}</span>` : nothing}
      <input
        id=${id}
        class="input sm"
        .value=${value}
        ?disabled=${opts.disabled}
        inputmode=${key === 'id' || key === 'name' || key === 'text' ? 'text' : 'decimal'}
        aria-invalid=${bad ? 'true' : 'false'}
        aria-describedby=${bad ? `${id}-err` : nothing}
        @change=${(e: Event) => apply(c, key, (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </span>
    ${bad ? html`<span class="err-text" id=${`${id}-err`} role="alert">${bad}</span>` : nothing}
  </div>`;
}

function color(c: InspectorCtx, key: 'fill' | 'stroke', label: string, value: string) {
  const grad = /^url\(/.test(value.trim());
  const id = `svp-${key}`;
  return html`<div class="prow sv-prow" data-field=${key}>
    <label for=${`${id}-hex`}>${label}</label>
    <span class="sv-color">
      <input
        type="color"
        aria-label=${t('svgd.p.picker', { what: label })}
        .value=${hexOf(value)}
        ?disabled=${grad}
        @input=${(e: Event) => apply(c, key, (e.target as HTMLInputElement).value, { mergeKey: `color:${key}` })}
        @change=${() => c.ed.session.endGesture()}
      />
      <input
        id=${`${id}-hex`}
        class="input sm mono"
        .value=${grad ? t('svgd.p.gradient') : value}
        ?readonly=${grad}
        @change=${(e: Event) => apply(c, key, (e.target as HTMLInputElement).value)}
      />
      <button
        type="button"
        class="btn sm"
        title=${t('svgd.p.none')}
        aria-label=${t('svgd.p.noneOf', { what: label })}
        @click=${() => apply(c, key, 'none')}
      >
        ∅
      </button>
    </span>
  </div>`;
}

function select(
  c: InspectorCtx,
  key: PropKey,
  label: string,
  value: string,
  options: ReadonlyArray<[string, string]>,
) {
  const id = `svp-${key}`;
  return html`<div class="prow sv-prow" data-field=${key}>
    <label for=${id}>${label}</label>
    <select
      id=${id}
      class="select sm"
      @change=${(e: Event) => apply(c, key, (e.target as HTMLSelectElement).value)}
    >
      ${options.map(([v, l]) => html`<option value=${v} ?selected=${v === value}>${l}</option>`)}
    </select>
  </div>`;
}

function seg(
  c: InspectorCtx,
  key: PropKey,
  label: string,
  value: string,
  options: ReadonlyArray<[string, string]>,
) {
  return html`<div class="prow sv-prow" data-field=${key}>
    <span class="lbl" id=${`svp-${key}-l`}>${label}</span>
    <span class="seg sm" role="group" aria-labelledby=${`svp-${key}-l`}>
      ${options.map(
        ([v, l]) =>
          html`<button
            type="button"
            aria-pressed=${v === value ? 'true' : 'false'}
            @click=${() => apply(c, key, v)}
          >
            ${l}
          </button>`,
      )}
    </span>
  </div>`;
}

function check(
  c: InspectorCtx,
  key: PropKey | 'lockRatio',
  label: string,
  on: boolean,
  tip?: string,
) {
  const id = `svp-${key}`;
  return html`<div class="prow sv-prow" data-field=${key}>
    <span></span>
    <label class="row" for=${id} title=${tip ?? ''}>
      <input
        id=${id}
        type="checkbox"
        .checked=${on}
        @change=${(e: Event) => {
          const v = (e.target as HTMLInputElement).checked;
          if (key === 'lockRatio') {
            c.view.lockRatio = v;
            c.refresh();
          } else apply(c, key, String(v));
        }}
      />
      ${label}
    </label>
  </div>`;
}

function notes(list: readonly string[], reason: string | null): TemplateResult | typeof nothing {
  const items: string[] = [];
  if (list.includes('opaque')) items.push(t('svgd.note.opaque'));
  if (list.includes('curves') || reason) items.push(t('svgd.note.curves'));
  if (list.includes('gradient')) items.push(t('svgd.note.gradient'));
  return items.length
    ? html`${items.map((x) => html`<p class="pnote">${icon('info')}${x}</p>`)}`
    : nothing;
}

export function renderInspector(c: InspectorCtx) {
  const { ed, view } = c;
  const p = propsOf(ed);
  const tab = view.ptab;
  const tabsId = 'sv-ptabs';
  const panelId = `sv-ptab-${tab}`;
  const none = p.count === 0;
  let body: unknown;
  if (none) body = html`<p class="help pad">${t('svgd.p.none.sel')}</p>`;
  else if (tab === 'common') {
    const layers: Array<[string, string]> = [
      ['', t('svgd.layer.default')],
      ...listLayers(ed.doc).map((l): [string, string] => [l.name, l.name]),
    ];
    body = html`${
      p.count === 1
        ? html`<div class="prow sv-prow">
              <span class="lbl">${t('svgd.p.tag')}</span><span class="mono">&lt;${p.tag}&gt;</span>
            </div>
            ${field(c, 'name', t('svgd.p.name'), p.name)}
            ${field(c, 'id', 'id', p.id, { mono: true })}`
        : html`<p class="help pad">${t('svgd.p.many', { n: p.count })}</p>`
    }
    ${select(c, 'layer', t('svgd.p.layer'), p.layer ?? '', layers)}
    ${p.count === 1 && p.uid ? html`<div class="prow sv-prow"><span class="lbl">uid</span><span class="mono">${p.uid}</span></div>` : nothing}
    ${notes(p.notes, ed.tool === 'node' ? ed.nodeLockReason() : null)}`;
  } else if (tab === 'geom') {
    const b = p.box;
    body = html`${field(c, 'x', 'X', b ? n3(b.x) : '')} ${field(c, 'y', 'Y', b ? n3(b.y) : '')}
      ${field(c, 'w', t('svgd.p.w'), b ? n3(b.width) : '')}
      ${field(c, 'h', t('svgd.p.h'), b ? n3(b.height) : '')}
      ${check(c, 'lockRatio', t('svgd.p.lockRatio'), view.lockRatio)}
      ${field(c, 'angle', t('svgd.p.angle'), p.angle === null ? '' : n3(p.angle), { short: '°', disabled: p.count !== 1 })}
      ${p.rx !== undefined ? field(c, 'rx', p.tag === 'rect' ? t('svgd.p.rx') : 'rx', p.rx) : nothing}
      ${p.ry !== undefined && p.tag === 'ellipse' ? field(c, 'ry', 'ry', p.ry) : nothing}
      ${p.r !== undefined ? field(c, 'r', t('svgd.p.r'), p.r) : nothing}
      ${
        p.writes
          ? html`<div class="prow sv-prow">
              <span class="lbl">${t('svgd.p.writes')}</span
              ><span class="chip ${p.writes === 'attrs' ? 'ok' : 'info'}"
                >${p.writes === 'attrs' ? t('svgd.p.writesAttrs') : 'transform'}</span
              >
            </div>`
          : nothing
      }
      ${p.writes === 'transform' ? check(c, 'non-scaling-stroke', t('svgd.p.nonScaling'), p.nonScaling, t('svgd.p.nonScalingTip')) : nothing}
      <p class="help pad">${t('svgd.p.geomHelp')}</p>`;
  } else if (tab === 'paint') {
    body = html`${color(c, 'fill', t('svgd.p.fill'), p.fill)}
    ${color(c, 'stroke', t('svgd.p.stroke'), p.stroke)}
    ${field(c, 'stroke-width', t('svgd.p.strokeWidth'), p.strokeWidth, { short: 'px' })}
    ${select(
      c,
      'stroke-dasharray',
      t('svgd.p.dash'),
      DASH_PRESETS.includes(p.dash) ? p.dash : 'none',
      DASH_PRESETS.map((d): [string, string] => [d, d === 'none' ? t('svgd.p.solid') : d]),
    )}
    ${seg(c, 'stroke-linecap', t('svgd.p.cap'), p.cap, [
      ['butt', 'butt'],
      ['round', 'round'],
      ['square', 'square'],
    ])}
    ${field(c, 'opacity', t('svgd.p.opacity'), p.opacity)}
    ${select(c, 'visibility', 'visibility', p.visibility, [
      ['visible', 'visible'],
      ['hidden', 'hidden'],
    ])}
    ${notes(p.notes, null)}`;
  } else if (tab === 'text') {
    const tx = p.text;
    if (!tx) body = html`<p class="help pad">${t('svgd.p.noText')}</p>`;
    else {
      const fonts: Array<[string, string]> = SAFE_FONTS.map((f): [string, string] => [f, f]);
      if (!SAFE_FONTS.includes(tx.family)) fonts.unshift([tx.family, `${tx.family} (W_SVG_FONT)`]);
      body = html`${field(c, 'text', t('svgd.p.content'), tx.content, { disabled: tx.hasTspan })}
      ${tx.hasTspan ? html`<p class="pnote">${t('svgd.p.tspan')}</p>` : nothing}
      ${select(c, 'font-family', t('svgd.p.font'), tx.family, fonts)}
      ${tx.fontWarning ? html`<p class="pnote warnc" role="status">${icon('warn', 'warn')}${t('svgd.p.fontWarn', { font: tx.family })}</p>` : nothing}
      ${field(c, 'font-size', t('svgd.p.fontSize'), tx.size, { short: 'px' })}
      ${seg(c, 'font-weight', t('svgd.p.bold'), tx.bold ? 'bold' : 'normal', [
        ['normal', t('svgd.p.normal')],
        ['bold', t('svgd.p.boldOn')],
      ])}
      ${seg(c, 'font-style', t('svgd.p.italic'), tx.italic ? 'italic' : 'normal', [
        ['normal', t('svgd.p.normal')],
        ['italic', t('svgd.p.italicOn')],
      ])}
      ${seg(c, 'text-anchor', t('svgd.p.anchor'), tx.anchor, [
        ['start', t('svgd.p.start')],
        ['middle', t('svgd.p.middle')],
        ['end', t('svgd.p.end')],
      ])}`;
    }
  } else {
    const refs = p.uid ? c.refs(p.uid) : [];
    body = html`${
        refs.length
          ? html`<ul class="sv-binds">
              ${refs.map(
                (r) =>
                  html`<li class="bind">
                    ${icon('link')}
                    <span
                      ><span class="t">${r.rows.join('; ') || t('svgd.bind.events')}</span
                      ><small
                        >${r.screen} · ${r.item} · <span class="mono">${r.uid}</span></small
                      ></span
                    >
                  </li>`,
              )}
            </ul>`
          : html`<p class="help pad">
              ${p.count === 1 ? t('svgd.bind.none') : t('svgd.bind.one')}
            </p>`
      }
      <p class="pnote">${t('svgd.bind.note')}</p>
      ${p.count === 1 && p.uid ? html`<button type="button" class="btn sm sv-open-bind" data-act="open-bind" @click=${() => openBinding(c, p.uid)}>${icon('link')}${t('svgd.bind.open')}</button>` : nothing}`;
  }
  return html`<section class="sv-sec sv-insp" aria-labelledby="sv-insp-h">
    <div class="pane-h">
      <span id="sv-insp-h">${t('svgd.props')}</span
      ><span class="lc mono"
        >${p.count === 1 ? `<${p.tag}>` : p.count > 1 ? t('svgd.p.many', { n: p.count }) : ''}</span
      >
    </div>
    <div class="ptabs" role="tablist" aria-label=${t('svgd.props.tabs')} id=${tabsId}>
      ${TABS.map(
        (x) =>
          html`<button
            type="button"
            role="tab"
            id=${`sv-tab-${x.id}`}
            aria-selected=${x.id === tab ? 'true' : 'false'}
            aria-controls=${`sv-ptab-${x.id}`}
            tabindex=${x.id === tab ? 0 : -1}
            @click=${() => {
              c.view.ptab = x.id;
              c.refresh();
            }}
            @keydown=${(e: KeyboardEvent) => {
              const i = TABS.findIndex((y) => y.id === tab);
              const j =
                e.key === 'ArrowRight'
                  ? (i + 1) % TABS.length
                  : e.key === 'ArrowLeft'
                    ? (i - 1 + TABS.length) % TABS.length
                    : -1;
              if (j < 0) return;
              e.preventDefault();
              c.view.ptab = TABS[j].id;
              c.refresh();
            }}
          >
            ${t(x.label)}
          </button>`,
      )}
    </div>
    ${p.count === 1 ? html`<div class="ictx"><b>${ed.label(ed.selection[0])}</b>${p.uid ? html`<span class="mono muted">${p.uid}</span>` : nothing}</div>` : nothing}
    <div class="ibody" role="tabpanel" id=${panelId} aria-labelledby=${`sv-tab-${tab}`}>
      ${body}
    </div>
  </section>`;
}

/** Mở inspector Gắn Tag (13 dòng) của feature 008 cho phần tử: màn hình đầu tiên có item dùng tệp này. */
function openBinding(c: InspectorCtx, uid: string): void {
  const app = c.app;
  for (const s of app.store.state.outline.screens)
    for (const it of s.model?.items ?? [])
      if (it.type === 'svg' && it.svgFile === c.rel) {
        app.openEditor(`screen:${s.id}`);
        app.selectItems(s.id, [it.id]);
        app.screens.enterSvgItem(s.id, it.id);
        app.screens.setSelectedUids([uid]);
        app.screens.svgTab = 'bind';
        app.setInspectorTab('props');
        app.requestRender();
        return;
      }
  app.toast(t('svgd.bind.unused'));
}
