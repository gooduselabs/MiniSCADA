// Inspector của phần tử SVG đang chọn trong item `svg` đã vào (feature 008, T072; contract studio-svg-editor §2, §5, §8; mockup
// studio-svg cảnh 2): bốn nhóm Chung, Gắn Tag, Sự kiện, Bảo mật. Thay `props-element.ts` cho project 0.3/0.4 (bản đó vẫn phục vụ
// project 0.1/0.2, nơi phần tử đọc từ outline và chỉ xem). Đọc loại và tên phần tử từ DOM đã lọc của item, binding từ project.
import { html, nothing, type TemplateResult } from 'lit';
import { bindingSetOf, elementNameOf, itemRef, type ItemRef } from '../app/svg-bind.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import { portStatuses, quickParts, quickTarget, type QuickPart } from '../model/quick-bind.ts';
import { elementOf, eventMinRole, setEventMinRole } from '../model/svg-binding-doc.ts';
import { findByUid } from '../model/svg-dom.ts';
import { commitSet, eventCtx } from '../app/svg-bind.ts';
import { AppElement } from './base.ts';
import { prow } from './mat-inspector.ts';
import './props-svg-bind.ts';
import './props-svg-events.ts';
import './props-svg.css';
import { registerProps } from './registry.ts';

type Tab = 'general' | 'bind' | 'events' | 'security';
const TABS: readonly Tab[] = ['general', 'bind', 'events', 'security'];
const TAB_LABEL = {
  general: 'svp.tab.general',
  bind: 'svp.tab.bind',
  events: 'svp.tab.events',
  security: 'svp.tab.security',
} as const;

export class MatSvgProps extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    itemId: { attribute: false },
  };

  declare screenId: string;
  declare itemId: string;

  constructor() {
    super();
    this.screenId = '';
    this.itemId = '';
  }

  private get tab(): Tab {
    return this.app.screens.svgTab;
  }

  private setTab(tab: Tab, focus = false): void {
    this.app.screens.svgTab = tab;
    this.requestUpdate();
    if (focus)
      void this.updateComplete.then(() =>
        this.querySelector<HTMLElement>('.sv-tabs [aria-selected="true"]')?.focus(),
      );
  }

  private onTabKey(e: KeyboardEvent): void {
    const i = TABS.indexOf(this.tab);
    let j: number;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = TABS.length - 1;
    else return;
    e.preventDefault();
    this.setTab(TABS[j]!, true);
  }

  // ---------- Nhóm Chung ----------

  private general(ref: ItemRef, uids: readonly string[]): TemplateResult {
    const app = this.app;
    const item = app.screenModel(ref.screen)?.items.find((i) => i.id === ref.item);
    const root = app.screens.svgRoot(ref.screen, ref.item);
    const uid = uids.at(-1)!;
    const el = root === null ? null : findByUid(root, uid);
    const name = item?.type === 'svg' ? elementNameOf(item, uid, el) : '';
    return html`${
        uids.length > 1
          ? html`<p class="help pad" role="status">${t('svp.multi', { n: uids.length })}</p>`
          : nothing
      }
      ${prow(t('svp.name'), name || t('prop.none'))} ${prow(t('svp.uid'), uid, { mono: true })}
      ${prow(t('svp.tag'), el?.localName ?? t('prop.none'), { mono: true })}
      ${prow(t('svp.item'), item?.name?.trim() || ref.item)}
      ${item?.type === 'svg' ? prow(t('svp.svgFile'), item.svgFile, { mono: true }) : nothing}
      ${prow(t('svp.bindingFile'), ref.file, { mono: true })}
      <p class="help pad">${t('svp.generalHint')}</p>`;
  }

  // ---------- Nhóm Bảo mật ----------

  private security(ref: ItemRef, uids: readonly string[]): TemplateResult {
    const app = this.app;
    const uid = uids.at(-1)!;
    const set = bindingSetOf(app, ref);
    const click = elementOf(set, uid)?.events?.click;
    const writes =
      click !== undefined &&
      click.action !== 'navigate' &&
      click.action !== 'popup' &&
      click.action !== 'closePopup';
    const role = eventMinRole(set, uid) ?? '';
    const err = this.roleError;
    return html`<div class="sv-sec">
      <div class="sv-row">
        <label class="sv-l" for="svp-minrole">${t('svp.minRole')}</label>
        <div class="sv-v">
          <select
            id="svp-minrole"
            class="sv-in"
            ?disabled=${!writes || app.store.state.readOnly}
            aria-describedby="svp-minrole-hint"
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              const r = setEventMinRole(
                set,
                uid,
                v === '' ? undefined : (v as 'operator' | 'engineer' | 'administrator'),
                eventCtx(app, click !== undefined && 'tag' in click ? click.tag : undefined),
              );
              this.roleError = r.rejected ?? null;
              if (r.rejected === undefined) commitSet(app, ref, r.set);
              this.requestUpdate();
            }}
          >
            ${[
              ['', 'svp.role.default'],
              ['operator', 'svp.role.operator'],
              ['engineer', 'svp.role.engineer'],
              ['administrator', 'svp.role.administrator'],
            ].map(
              ([v, k]) =>
                html`<option value=${v!} ?selected=${role === v}>
                  ${t(k as 'svp.role.default')}
                </option>`,
            )}
          </select>
        </div>
        <p class="sv-hint" id="svp-minrole-hint">
          ${writes ? t('svp.minRoleHint') : t('svp.minRoleNoEvent')}
        </p>
        ${err ? html`<p class="sv-err" role="alert">${t(`svg.eventReject.${err}` as 'svg.eventReject.bad-role')}</p>` : nothing}
      </div>
    </div>`;
  }

  private roleError: string | null = null;

  protected override render() {
    const app = this.app;
    const ref = itemRef(app, this.screenId, this.itemId);
    const uids = app.screens.selectedUids;
    if (ref === null || uids.length === 0) return nothing;
    const tab = this.tab;
    const set = bindingSetOf(app, ref);
    const entry = elementOf(set, uids.at(-1)!);
    const bound = entry?.bindings?.length ?? 0;
    const body =
      tab === 'general'
        ? this.general(ref, uids)
        : tab === 'bind'
          ? html`<mat-svg-bind
              .app=${app}
              .screenId=${ref.screen}
              .itemId=${ref.item}
              .uids=${uids}
            ></mat-svg-bind>`
          : tab === 'events'
            ? html`<mat-svg-events
                .app=${app}
                .screenId=${ref.screen}
                .itemId=${ref.item}
                .uids=${uids}
              ></mat-svg-events>`
            : this.security(ref, uids);
    return html`<div class="sv-tabs" role="tablist" aria-label=${t('svp.groups')}>
        ${TABS.map(
          (x) =>
            html`<button
              type="button"
              role="tab"
              id="svp-tab-${x}"
              aria-selected=${tab === x ? 'true' : 'false'}
              aria-controls="svp-panel"
              tabindex=${tab === x ? 0 : -1}
              @click=${() => this.setTab(x)}
              @keydown=${(e: KeyboardEvent) => this.onTabKey(e)}
            >
              ${t(TAB_LABEL[x])}
              ${x === 'bind' && bound > 0 ? html`<span class="cnt">${bound}</span>` : nothing}
              ${x === 'events' && entry?.events?.click !== undefined ? html`<span class="cnt">1</span>` : nothing}
            </button>`,
        )}
      </div>
      <div id="svp-panel" class="sv-panel" role="tabpanel" aria-labelledby="svp-tab-${tab}">
        ${body}
      </div>`;
  }
}

customElements.define('mat-svg-props', MatSvgProps);

// Đang vào item `svg` và có phần tử được chọn: inspector của phần tử. Chưa chọn phần tử, hoặc đang chọn Tag ở Details: để
// inspector của item (props-widget) và của Tag vẽ.
registerProps((app) => {
  const s = app.store.state;
  if (s.outline.schema !== '0.3' || !s.active.startsWith('screen:')) return null;
  const screen = s.active.slice('screen:'.length);
  const itemId = app.screens.enteredItemId(screen);
  const uids = app.screens.selectedUids;
  if (itemId === null || uids.length === 0 || s.selection?.kind !== 'items') return null;
  const ref = itemRef(app, screen, itemId);
  if (ref === null) return null;
  const item = app.screenModel(screen)?.items.find((i) => i.id === itemId);
  const root = app.screens.svgRoot(screen, itemId);
  const last = uids.at(-1)!;
  const el = root === null ? null : findByUid(root, last);
  const name = (item?.type === 'svg' ? elementNameOf(item, last, el) : '') || last;
  return {
    ctx:
      uids.length > 1 ? t('svp.ctxMulti', { n: uids.length }) : t('svp.ctx', { name, uid: last }),
    body: html`<mat-svg-props .app=${app} .screenId=${screen} .itemId=${itemId}></mat-svg-props>`,
  };
});

// ---------- Gắn nhanh (T092, FR-058; mockup studio-svg cảnh 4) ----------

/** Danh sách bộ phận của item ký hiệu thư viện kèm gợi ý; bấm: vào item, chọn phần tử, mở dòng gợi ý đầu tiên. */
export class MatSvgQuick extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    itemId: { attribute: false },
  };

  declare screenId: string;
  declare itemId: string;

  constructor() {
    super();
    this.screenId = '';
    this.itemId = '';
  }

  /** Vào item, chọn phần tử `part.uid` và mở dòng gợi ý đầu tiên (một thao tác của người dùng, không ghi gì vào project). */
  private open(part: QuickPart): void {
    const app = this.app;
    const to = quickTarget(part);
    app.selectItems(this.screenId, [this.itemId]);
    app.screens.enterSvgItem(this.screenId, this.itemId);
    app.screens.pickUids([part.uid]);
    app.screens.svgTab = to.tab === 'events' ? 'events' : 'bind';
    app.setInspectorTab('props');
    app.screens.jump = {
      uid: part.uid,
      ...(to.rowId !== undefined ? { rowId: to.rowId } : {}),
      field: to.field,
      n: (app.screens.jump?.n ?? 0) + 1,
    };
    app.requestRender();
  }

  protected override render() {
    const app = this.app;
    const screen = app.screenModel(this.screenId);
    const item = screen?.items.find((i) => i.id === this.itemId);
    const ref = itemRef(app, this.screenId, this.itemId);
    if (!screen || item === undefined || ref === null) return nothing;
    const parts = quickParts(item, bindingSetOf(app, ref));
    if (parts === null) return nothing;
    const ports = portStatuses(item, screen.items);
    return html`<div class="qb" role="region" aria-label=${t('qb.title')}>
      <div class="qb-sec"><b>${t('qb.title')}</b> · ${t('qb.hint')}</div>
      <div role="list" aria-label=${t('qb.parts')}>
        ${parts.map((p) => {
          const first = quickTarget(p);
          const rows = p.suggest.map((s) =>
            s === 'click' ? t('qb.event') : t(`svg.row.${s}` as MessageKey),
          );
          return html`<div class="qb-row" role="listitem" data-part=${p.role}>
            <span class="nm"
              >${p.label}
              <span class="mono muted">${p.role}</span
              >${p.bound > 0 ? html` · ${t('qb.bound', { n: p.bound })}` : nothing}${
                p.hasEvent ? html` · ${t('qb.event')}` : nothing
              }</span
            >
            <span class="chip">${t('qb.suggest', { rows: rows.join(', ') })}</span>
            <button
              type="button"
              class="btn sm"
              data-quick=${p.role}
              data-tab=${first.tab}
              data-row=${first.rowId ?? nothing}
              aria-label=${t('qb.openFor', { label: p.label })}
              ?disabled=${app.store.state.readOnly}
              @click=${() => this.open(p)}
            >
              ${t('qb.open')}
            </button>
          </div>`;
        })}
      </div>
      ${
        ports.length > 0
          ? html`<div class="qb-sec">${t('qb.ports')}</div>
              ${ports.map(
                (p) =>
                  html`<div class="qb-port" data-port=${p.id}>
                    <span
                      class="qb-dot ${p.linkedTo !== null ? 'on' : ''}"
                      aria-hidden="true"
                    ></span>
                    <span class="mono">${p.id}</span>
                    <span class="chip">${t(`qb.portDir.${p.dir}` as MessageKey)}</span>
                    <span class="muted"
                      >${p.linkedTo !== null ? t('qb.portLinked', { item: p.linkedTo }) : t('qb.portFree')}</span
                    >
                  </div>`,
              )}
              <p class="help pad">${t('qb.portHint')}</p>`
          : nothing
      }
    </div>`;
  }
}

customElements.define('mat-svg-quick', MatSvgQuick);

// Item ký hiệu thư viện được chọn (một item, chưa chọn phần tử): inspector của item kèm danh sách Gắn nhanh.
registerProps((app) => {
  const s = app.store.state;
  if (s.outline.schema !== '0.3' || !s.active.startsWith('screen:')) return null;
  if (app.screens.selectedUids.length > 0) return null;
  const screen = s.active.slice('screen:'.length);
  const doc = app.screenModel(screen);
  const sel = app.selectedItems(screen);
  if (!doc || sel.length !== 1) return null;
  const item = doc.items.find((i) => i.id === sel[0]);
  if (item === undefined || item.type !== 'svg' || quickParts(item, undefined) === null)
    return null;
  return {
    ctx: t('wi.ctx.item', { kind: t('widget.svg'), name: item.name?.trim() || item.id }),
    body: html`<mat-widget-props .app=${app} .screenId=${screen}></mat-widget-props>
      <mat-svg-quick .app=${app} .screenId=${screen} .itemId=${item.id}></mat-svg-quick>`,
  };
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-svg-quick': MatSvgQuick;
    'mat-svg-props': MatSvgProps;
  }
}
