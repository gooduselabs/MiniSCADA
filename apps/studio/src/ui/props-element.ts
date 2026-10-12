// Inspector › Thuộc tính cho phần tử màn hình và cho màn hình (feature 004, T073, FR-006, FR-007, mockup
// bản 1): tên, uid, loại; binding ở dạng chỉ đọc (thuộc tính, Tag, cách đổi giá trị), sửa bằng giao diện
// có ở GĐ 3b; nhóm Sự kiện, Bảo mật nói giai đoạn. Khi theo dõi thiết bị, kèm giá trị sống của các Tag
// phần tử dùng ("không có trên thiết bị" với Tag thiết bị không có). Đọc từ file màn hình và binding của
// project (outline), nên vẫn xem được khi project còn lỗi.
import { html, nothing } from 'lit';
import type { StudioApp } from '../app/app.ts';
import { t, type MessageKey } from '../i18n/index.ts';
import type { LiveValue } from '../model/device-session.ts';
import type { ProjectOutline, ScreenOutline } from '../model/project-doc.ts';
import { targetLabel } from '../model/xref.ts';
import { AppElement, icon } from './base.ts';
import { prow } from './mat-inspector.ts';
import { registerProps, type InspectorView } from './registry.ts';

type PropsTab = 'general' | 'bind' | 'events' | 'security';

const TABS: ReadonlyArray<{ id: PropsTab; label: MessageKey; phase?: MessageKey }> = [
  { id: 'general', label: 'element.tab.general' },
  { id: 'bind', label: 'element.tab.bind' },
  { id: 'events', label: 'element.tab.events', phase: 'phase.p3b' },
  { id: 'security', label: 'element.tab.security', phase: 'phase.p3a' },
];

/** Nhóm đang xem, giữ khi chọn phần tử khác (như mockup); mặc định "Gắn Tag". */
const openTab = new WeakMap<StudioApp, PropsTab>();

const KIND: Readonly<Record<string, MessageKey>> = {
  shape: 'element.kind.shape',
  group: 'element.kind.group',
  text: 'element.kind.text',
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const scalar = (v: unknown): string =>
  typeof v === 'string' ? `"${v}"` : v === undefined ? '' : String(v);

/** Binding đọc được của một phần tử (bỏ mục sai hình dạng; bộ kiểm tra báo lỗi riêng). */
export interface BindingView {
  id: string;
  target: string;
  tag: string;
  raw: Record<string, unknown>;
}

export function screenOf(outline: ProjectOutline, id: string): ScreenOutline | undefined {
  return outline.screens.find((s) => s.id === id);
}

export function screenName(s: ScreenOutline): string {
  return str(s.screen?.name) || s.id;
}

export function elementBindings(s: ScreenOutline | undefined, uid: string): BindingView[] {
  const eb = list(s?.bindings?.elements).find((e) => isObject(e) && e.elementUid === uid) as
    Record<string, unknown> | undefined;
  const out: BindingView[] = [];
  for (const b of list(eb?.bindings)) {
    if (!isObject(b) || !isObject(b.source)) continue;
    out.push({ id: str(b.id), target: str(b.target), tag: str(b.source.tagId), raw: b });
  }
  return out;
}

function elementRef(s: ScreenOutline | undefined, uid: string): { name: string; kind: string } {
  const e = list(s?.screen?.elements).find((x) => isObject(x) && x.elementUid === uid) as
    Record<string, unknown> | undefined;
  return { name: str(e?.name) || uid, kind: str(e?.kind) };
}

const DIRECTION: Readonly<Record<string, MessageKey>> = {
  up: 'element.tr.up',
  down: 'element.tr.down',
  left: 'element.tr.left',
  right: 'element.tr.right',
};

/** Cách đổi giá trị của binding bằng chữ: transform, chiều, định dạng, xử lý quality xấu. */
export function transformText(b: Record<string, unknown>): string {
  const parts: string[] = [];
  const tr = isObject(b.transform) ? b.transform : {};
  if (tr.kind === 'direct') parts.push(t('element.tr.direct'));
  else if (tr.kind === 'discreteMap') {
    const cases = list(tr.cases)
      .filter(isObject)
      .map((c) => t('element.tr.case', { from: scalar(c.equals), to: scalar(c.value) }));
    if (tr.default !== undefined) cases.push(t('element.tr.default', { to: scalar(tr.default) }));
    parts.push(t('element.tr.map', { cases: cases.join('; ') }));
  } else if (tr.kind === 'linearScale') {
    parts.push(
      t('element.tr.scale', {
        inMin: scalar(tr.inMin),
        inMax: scalar(tr.inMax),
        outMin: scalar(tr.outMin),
        outMax: scalar(tr.outMax),
      }),
    );
    if (tr.clamp !== false) parts.push(t('element.tr.clamp'));
  } else parts.push(str(tr.kind) || '?');
  if (b.animation === 'spin') parts.push(t('element.tr.spin'));
  if (b.target === 'geometry.levelPercent') {
    const dir = typeof b.direction === 'string' ? b.direction : 'up';
    if (Object.prototype.hasOwnProperty.call(DIRECTION, dir)) parts.push(t(DIRECTION[dir]));
  }
  const fmt = isObject(b.format) ? b.format : {};
  if (typeof fmt.decimals === 'number') parts.push(t('element.tr.decimals', { n: fmt.decimals }));
  if (typeof fmt.suffix === 'string' && fmt.suffix)
    parts.push(t('element.tr.suffix', { s: fmt.suffix.trim() || fmt.suffix }));
  const bad = isObject(b.onBadQuality) ? b.onBadQuality : {};
  if (bad.mode === 'hold') parts.push(t('element.tr.hold'));
  else if (bad.mode === 'override')
    parts.push(t('element.tr.override', { value: scalar(bad.value) }));
  return parts.join(' · ');
}

// ---------- Giá trị sống của một Tag ----------

const number = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });

/** Giá trị hiển thị: số theo kiểu Việt Nam, BOOL true/false, chuỗi giữ nguyên, chưa có giá trị "—". */
export function formatValue(v: LiveValue['value']): string {
  if (v === null) return t('prop.none');
  return typeof v === 'number' ? number.format(v) : String(v);
}

/** Chữ của giá trị sống một Tag và lớp CSS: không có trên thiết bị, chưa có, mất kết nối, giá trị. */
export function liveText(app: StudioApp, tag: string): { text: string; cls: string } {
  const s = app.session;
  if (!app.valuesLive()) return { text: t('live.offline'), cls: 'off' };
  if (app.online() && s.unknown.has(tag)) return { text: t('live.unknown'), cls: 'unknown' };
  const v = app.readValue(tag);
  if (!v) return { text: t('live.none'), cls: 'off' };
  if (v.quality === 'STALE')
    return { text: t('live.stale', { value: formatValue(v.value) }), cls: 'stale' };
  return {
    text: t('live.value', { value: formatValue(v.value), quality: v.quality }),
    cls: v.quality === 'GOOD' ? 'good' : 'bad',
  };
}

/** Giá trị sống của một Tag; tự vẽ lại khi giá trị Tag đó đổi (app.subscribeValues). */
export class MatLiveValue extends AppElement {
  private tagId = '';
  private offValues: (() => void) | null = null;

  set tag(id: string) {
    if (id === this.tagId) return;
    this.tagId = id;
    this.requestUpdate();
  }

  protected override attached(): void {
    this.offValues = this.app.subscribeValues((tags) => {
      if (tags.includes(this.tagId)) this.requestUpdate();
    });
  }

  protected override detached(): void {
    this.offValues?.();
    this.offValues = null;
  }

  protected override render() {
    const v = liveText(this.app, this.tagId);
    return html`<span class="sp-live sp-live-${v.cls}">${v.text}</span>`;
  }
}

customElements.define('mat-live-value', MatLiveValue);

// ---------- Thuộc tính phần tử ----------

export class MatElementProps extends AppElement {
  private screen = '';
  private uidValue = '';

  set screenId(id: string) {
    this.screen = id;
    this.requestUpdate();
  }

  set uid(uid: string) {
    this.uidValue = uid;
    this.requestUpdate();
  }

  private get tab(): PropsTab {
    return openTab.get(this.app) ?? 'bind';
  }

  private setTab(tab: PropsTab): void {
    openTab.set(this.app, tab);
    this.requestUpdate();
  }

  private general(s: ScreenOutline | undefined) {
    const uid = this.uidValue;
    const ref = elementRef(s, uid);
    const kind = Object.prototype.hasOwnProperty.call(KIND, ref.kind)
      ? t(KIND[ref.kind])
      : ref.kind;
    return html`${prow(t('element.name'), ref.name)} ${prow(t('element.uid'), uid, { mono: true })}
    ${prow(t('element.kind'), kind || t('prop.none'))}
    ${prow(t('element.screen'), s ? screenName(s) : this.screen)}
    ${prow(t('element.svgFile'), str(s?.screen?.svgFile) || t('prop.none'), { mono: true })}
    ${prow(t('element.bindingFile'), s?.bindingFile ?? t('prop.none'), { mono: true })}`;
  }

  private bindings(s: ScreenOutline | undefined, bindings: BindingView[]) {
    const app = this.app;
    const tags = [...new Set(bindings.map((b) => b.tag).filter(Boolean))];
    return html`<div class="psec">
        ${icon('link')}<span>${t('element.bindings')}</span><span class="grow"></span
        ><span class="phase">${t('element.editPhase')}</span>
      </div>
      ${
        bindings.length
          ? bindings.map((b) => {
              const target = targetLabel(b.target);
              const how = transformText(b.raw);
              return prow(target, how, {
                extra: html`<span
                  class="dyn"
                  title=${t('element.bindingTip', { target, tag: b.tag, transform: how })}
                  >${icon('link', 'sm')}<span>${b.tag}</span></span
                >`,
              });
            })
          : html`<p class="help pad">${t('element.noBindings')}</p>`
      }
      ${
        s?.bindingFile
          ? html`<p class="help pad">${t('element.readonly', { file: s.bindingFile })}</p>`
          : nothing
      }
      ${
        app.valuesLive() && tags.length
          ? html`<div class="psec">${icon('pulse')}<span>${t('element.live')}</span></div>
              ${tags.map(
                (tag) =>
                  html`<div class="prow">
                    <div class="pl mono" title=${tag}>${tag}</div>
                    <div class="pv"><mat-live-value .app=${app} .tag=${tag}></mat-live-value></div>
                    <span></span>
                  </div>`,
              )}`
          : nothing
      }`;
  }

  protected override render() {
    const s = screenOf(this.app.store.state.outline, this.screen);
    const bindings = elementBindings(s, this.uidValue);
    const tab = this.tab;
    const body =
      tab === 'general'
        ? this.general(s)
        : tab === 'bind'
          ? this.bindings(s, bindings)
          : tab === 'events'
            ? html`<div class="empty">
                ${icon('play', 'lg')}<b>${t('element.events.title')}</b>
                <p>${t('element.events.text')}</p>
              </div>`
            : html`<div class="empty">
                ${icon('lock', 'lg')}<b>${t('element.security.title')}</b>
                <p>${t('element.security.text')}</p>
              </div>`;
    return html`<div class="ptabs" role="group" aria-label=${t('element.groups')}>
        ${TABS.map(
          (x) =>
            html`<button
              type="button"
              data-ptab=${x.id}
              aria-pressed=${tab === x.id ? 'true' : 'false'}
              @click=${() => this.setTab(x.id)}
            >
              ${t(x.label)}
              ${x.id === 'bind' ? html`<span class="cnt">${bindings.length}</span>` : nothing}
              ${x.phase && this.app.workspace.showPhases ? html`<span class="phase">${t(x.phase)}</span>` : nothing}
            </button>`,
        )}
      </div>
      ${body}`;
  }
}

customElements.define('mat-element-props', MatElementProps);

// ---------- Thuộc tính màn hình (đang mở màn hình, chưa chọn phần tử) ----------

function screenView(app: StudioApp, id: string): InspectorView | null {
  const outline = app.store.state.outline;
  const s = screenOf(outline, id);
  if (!s) return null;
  const sc = s.screen;
  const name = screenName(s);
  const vb = Array.isArray(sc?.viewBox) ? sc.viewBox : [];
  const size =
    typeof vb[2] === 'number' && typeof vb[3] === 'number'
      ? t('preview.sizeValue', { w: vb[2], h: vb[3] })
      : t('prop.none');
  let elements = 0;
  let count = 0;
  for (const e of list(s.bindings?.elements)) {
    const n = isObject(e) ? list(e.bindings).length : 0;
    if (n) elements++;
    count += n;
  }
  const entry = outline.project?.entryScreen === id;
  return {
    ctx: t('screen.props.ctx', { name }),
    body: html`${prow(t('screen.props.name'), name)}
      ${prow(t('screen.props.id'), id, { mono: true })} ${prow(t('screen.props.size'), size)}
      ${prow(t('screen.props.fit'), str(sc?.fitMode) || t('prop.none'), { mono: true })}
      ${prow(t('screen.props.background'), str(sc?.background) || t('prop.none'), { mono: true })}
      ${prow(t('screen.props.entry'), entry ? t('screen.props.yes') : t('screen.props.no'))}
      ${prow(t('screen.props.bound'), t('screen.props.boundValue', { e: elements, b: count }))}
      ${prow(t('element.svgFile'), str(sc?.svgFile) || t('prop.none'), { mono: true })}
      ${prow(t('element.bindingFile'), s.bindingFile ?? t('prop.none'), { mono: true })}
      <p class="help pad">${t('screen.props.hint')}</p>`,
  };
}

registerProps((app) => {
  const state = app.store.state;
  const sel = state.selection;
  if (sel?.kind === 'element') {
    const s = screenOf(state.outline, sel.screen);
    return {
      ctx: t('element.ctx', { name: elementRef(s, sel.uid).name, uid: sel.uid }),
      body: html`<mat-element-props
        .app=${app}
        .screenId=${sel.screen}
        .uid=${sel.uid}
      ></mat-element-props>`,
    };
  }
  if (!sel && state.active.startsWith('screen:'))
    return screenView(app, state.active.slice('screen:'.length));
  return null;
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-live-value': MatLiveValue;
    'mat-element-props': MatElementProps;
  }
}
