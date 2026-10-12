// Xem trước màn hình (feature 004, T073, FR-032, data-model §10, mockup bản 1): vùng vẽ có thước, lưới,
// phóng to, thu nhỏ, vừa khung; ba chế độ Tắt, Mô phỏng (SimSource), Thiết bị (giá trị của phiên thiết bị
// duy nhất của Studio, FR-030). SVG dựng bằng @mat/svg-renderer và áp giá trị bằng DomApplier qua
// src/preview.ts, cùng package với runtime web (Constitution II). Nhấp phần tử để chọn: inspector hiện
// binding chỉ đọc (props-element.ts); phần tử chọn ở Details, từ lỗi hay "Dùng ở đâu" cũng được tô trên
// màn hình. Bố trí màn hình (kéo thả widget, bắt dính) có ở GĐ 3a.
import type { TagUpdate } from '@mat/binding-engine';
import type { ElementBindings, TagDataType } from '@mat/project-schema';
import type { ScreenLayout } from '@mat/svg-renderer';
import { html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type { StudioApp } from '../../app/app.ts';
import { t } from '../../i18n/index.ts';
import { isLive } from '../../model/device-session.ts';
import type { ScreenOutline } from '../../model/project-doc.ts';
import { SimSource, type SimTag } from '../../model/sim-source.ts';
import { Preview, type ValueSource } from '../../preview.ts';
import { AppElement, icon } from '../base.ts';
import { screenName, screenOf } from '../props-element.ts';
import { registerEditor } from '../registry.ts';
import './screen-preview.css';

export type PreviewMode = 'off' | 'sim' | 'device';

/** Trạng thái xem của các màn hình (giữ khi đổi tab; như mockup, dùng chung cho mọi màn hình). */
interface ViewState {
  mode: PreviewMode;
  zoom: number;
  /** Đang vừa khung: vùng vẽ đổi cỡ thì tính lại tỉ lệ. */
  fit: boolean;
  grid: boolean;
}

const views = new WeakMap<StudioApp, ViewState>();

function viewOf(app: StudioApp): ViewState {
  let v = views.get(app);
  if (!v) {
    v = { mode: 'sim', zoom: 0.5, fit: true, grid: true };
    views.set(app, v);
  }
  return v;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 1.25;
const WHEEL_STEP = 1.1;
/** Lề quanh màn hình trong vùng vẽ (px), như mockup. */
const PAD = 40;
/** Ô lưới (đơn vị của màn hình). */
const GRID = 20;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
const TAG_TYPES: ReadonlySet<string> = new Set([
  'BOOL',
  'INT16',
  'UINT16',
  'INT32',
  'UINT32',
  'INT64',
  'UINT64',
  'FLOAT32',
  'FLOAT64',
  'STRING',
]);
const FIT_MODES: ReadonlySet<string> = new Set(['contain', 'cover', 'stretch']);

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const finite = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/** Màn hình đọc được từ project (kể cả khi project còn lỗi); mục sai hình dạng bị bỏ qua. */
interface ScreenData {
  id: string;
  name: string;
  outline: ScreenOutline;
  svgFile: string;
  /** Nội dung SVG trên đĩa; `null` khi không đọc được file (bộ kiểm tra báo lỗi). */
  svgText: string | null;
  vb: [number, number, number, number];
  layout: ScreenLayout;
  bindings: ElementBindings[];
  declared: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
  tags: SimTag[];
  tagTypes: Record<string, TagDataType>;
  typesKey: string;
}

function viewBoxOf(v: unknown): [number, number, number, number] {
  const a = list(v).map(finite);
  return a.length === 4 && a.every((x) => x !== undefined) && a[2]! > 0 && a[3]! > 0
    ? (a as [number, number, number, number])
    : [0, 0, 1280, 720];
}

function projectTags(app: StudioApp): SimTag[] {
  return list(app.store.state.outline.tags?.tags).flatMap((x): SimTag[] =>
    isObject(x) && typeof x.id === 'string' && TAG_TYPES.has(String(x.type))
      ? [{ id: x.id, type: x.type as TagDataType, min: finite(x.min), max: finite(x.max) }]
      : [],
  );
}

function screenData(app: StudioApp, id: string): ScreenData | null {
  const s = screenOf(app.store.state.outline, id);
  const sc = s?.screen;
  if (!s || !sc) return null;
  const vb = viewBoxOf(sc.viewBox);
  const names = new Map<string, string>();
  const elements: Array<{ elementUid: string }> = [];
  for (const e of list(sc.elements)) {
    if (!isObject(e) || typeof e.elementUid !== 'string') continue;
    elements.push({ elementUid: e.elementUid });
    names.set(e.elementUid, typeof e.name === 'string' && e.name ? e.name : e.elementUid);
  }
  const bindings: ElementBindings[] = [];
  for (const eb of list(s.bindings?.elements)) {
    if (!isObject(eb) || typeof eb.elementUid !== 'string') continue;
    const ok = list(eb.bindings).filter(
      (b) =>
        isObject(b) &&
        typeof b.target === 'string' &&
        isObject(b.source) &&
        typeof b.source.tagId === 'string' &&
        isObject(b.transform),
    ) as ElementBindings['bindings'];
    bindings.push({ elementUid: eb.elementUid, bindings: ok });
  }
  const svgFile = typeof sc.svgFile === 'string' ? sc.svgFile : '';
  const doc = svgFile ? app.store.state.docs[svgFile] : undefined;
  const tags = projectTags(app);
  const tagTypes: Record<string, TagDataType> = {};
  for (const tag of tags) tagTypes[tag.id] = tag.type;
  return {
    id,
    name: screenName(s),
    outline: s,
    svgFile,
    svgText: doc ? doc.diskText : null,
    vb,
    layout: {
      viewBox: vb,
      fitMode: FIT_MODES.has(String(sc.fitMode)) ? sc.fitMode : 'contain',
      background: typeof sc.background === 'string' ? sc.background : undefined,
      elements,
    },
    bindings,
    declared: new Set(names.keys()),
    names,
    tags,
    tagTypes,
    typesKey: tags.map((x) => `${x.id}:${x.type}`).join('\n'),
  };
}

/** Mô phỏng (research R11): giá trị tự sinh trong Min–Max, BOOL đổi mỗi 5 s. */
function simSource(tags: SimTag[]): ValueSource {
  return (push) => {
    const sim = new SimSource({ tags });
    sim.onChange = push;
    sim.start();
    return () => {
      sim.onChange = null;
      sim.stop();
    };
  };
}

/** Giá trị của phiên thiết bị duy nhất (FR-030): không mở kết nối riêng cho xem trước. */
function sessionSource(app: StudioApp, tags: readonly string[]): ValueSource {
  const wanted = new Set(tags);
  const read = (ids: Iterable<string>): TagUpdate[] => {
    const out: TagUpdate[] = [];
    for (const id of ids) {
      if (!wanted.has(id)) continue;
      const v = app.session.values.get(id);
      if (v) out.push({ id, value: v.value, quality: v.quality });
    }
    return out;
  };
  return (push) => {
    push(read(wanted));
    return app.subscribeValues((changed) => {
      const updates = read(changed);
      if (updates.length) push(updates);
    });
  };
}

export class ScreenPreview extends AppElement {
  private screen = '';
  private readonly preview = new Preview();
  private data: ScreenData | null = null;
  /** Màn hình đang dựng (để biết khi nào phải dựng lại) và phần tử chứa nó. */
  private mountKey: readonly unknown[] | null = null;
  private mountedHost: Element | null = null;
  private mountSeq = 0;
  private sourceKey = '';
  private missing: string[] = [];
  private error: string | null = null;
  private scrollX = 0;
  private scrollY = 0;
  private ro: ResizeObserver | null = null;
  private observed: Element | null = null;
  private placeFrame = 0;

  set screenId(id: string) {
    if (id === this.screen) return;
    this.screen = id;
    this.scrollX = 0;
    this.scrollY = 0;
    this.requestUpdate();
  }

  private get view(): ViewState {
    return viewOf(this.app);
  }

  protected override detached(): void {
    this.preview.stop();
    this.mountKey = null;
    this.mountedHost = null;
    this.sourceKey = '';
    this.ro?.disconnect();
    this.ro = null;
    this.observed = null;
    if (this.placeFrame) cancelAnimationFrame(this.placeFrame);
    this.placeFrame = 0;
  }

  protected override willUpdate(): void {
    // "Thiết bị" chỉ dùng được khi đang theo dõi; mất phiên thì về Mô phỏng và báo (data-model §10).
    const v = this.view;
    if (v.mode === 'device' && !isLive(this.app.session.state)) {
      v.mode = 'sim';
      const app = this.app;
      void Promise.resolve().then(() => app.toast(t('preview.fellBack')));
    }
    this.data = screenData(this.app, this.screen);
  }

  protected override updated(): void {
    this.syncMount();
    this.syncSource();
    this.observe();
    this.placeSel();
    this.reveal();
  }

  // ---------- Dựng màn hình, nguồn giá trị ----------

  private syncMount(): void {
    const d = this.data;
    const host = this.querySelector<HTMLElement>('.svg-host');
    if (!d || !host || d.svgText === null) {
      if (this.mountKey) {
        this.preview.stop();
        this.mountKey = null;
        this.mountedHost = null;
        this.sourceKey = '';
      }
      return;
    }
    const key = [d.id, d.svgText, d.outline.screen, d.outline.bindings, d.typesKey];
    const same = this.mountKey !== null && key.every((k, i) => k === this.mountKey![i]);
    if (same && host === this.mountedHost) return;
    this.mountKey = key;
    this.mountedHost = host;
    this.mountSeq++;
    this.sourceKey = '';
    let missing: string[] = [];
    let error: string | null = null;
    try {
      missing = this.preview.mount(host, d.svgText, d.layout, d.bindings, d.tagTypes);
    } catch (e) {
      this.preview.stop();
      error = e instanceof Error ? e.message : String(e);
    }
    if (error !== this.error || missing.join() !== this.missing.join()) {
      this.error = error;
      this.missing = missing;
      void Promise.resolve().then(() => this.requestUpdate());
    }
  }

  private syncSource(): void {
    if (!this.mountKey || !this.data) return;
    const mode = this.view.mode;
    const used = new Set(this.preview.tags);
    const sim = mode === 'sim' ? this.data.tags.filter((x) => used.has(x.id)) : [];
    const key = `${mode}|${this.mountSeq}|${sim.map((x) => `${x.id}:${x.type}:${x.min}:${x.max}`).join(',')}`;
    if (key === this.sourceKey) return;
    this.sourceKey = key;
    const source =
      mode === 'sim'
        ? simSource(sim)
        : mode === 'device'
          ? sessionSource(this.app, this.preview.tags)
          : null;
    this.preview.setSource(source ? this.tracked(source) : null);
  }

  /** Sau mỗi lần nguồn phát, khung chọn đi theo phần tử (ví dụ mức chất lỏng đổi chiều cao). */
  private tracked(source: ValueSource): ValueSource {
    return (push) =>
      source((changes) => {
        push(changes);
        this.schedulePlace();
      });
  }

  // ---------- Chọn phần tử ----------

  private schedulePlace(): void {
    if (this.placeFrame || typeof requestAnimationFrame === 'undefined') return;
    this.placeFrame = requestAnimationFrame(() => {
      this.placeFrame = 0;
      this.placeSel();
    });
  }

  /** Khung chọn quanh phần tử đang chọn (mockup `.selbox`), đặt bằng CSSOM. */
  private placeSel(): void {
    const box = this.querySelector<HTMLElement>('.selbox');
    const board = this.querySelector<HTMLElement>('.board');
    if (!box || !board) return;
    const sel = this.app.store.state.selection;
    const uid = sel?.kind === 'element' && sel.screen === this.screen ? sel.uid : null;
    const el = uid ? this.preview.elements.get(uid) : undefined;
    if (!uid || !el) {
      box.hidden = true;
      return;
    }
    const b = board.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    box.style.left = px(r.left - b.left - 2);
    box.style.top = px(r.top - b.top - 2);
    box.style.width = px(r.width + 4);
    box.style.height = px(r.height + 4);
    const name = box.querySelector('.nm');
    if (name) name.textContent = this.data?.names.get(uid) ?? uid;
    box.hidden = false;
  }

  private pick(uid: string | null): void {
    const app = this.app;
    if (uid) {
      app.select({ kind: 'element', screen: this.screen, uid });
      app.setInspectorTab('props');
    } else if (app.store.state.selection) app.select(null);
  }

  /** Vị trí lỗi, "Dùng ở đâu" (app.revealLocation): chọn phần tử và cuộn tới. */
  private reveal(): void {
    const loc = this.app.takeReveal('screen');
    if (loc?.editor !== 'screen' || loc.screen !== this.screen) return;
    void Promise.resolve().then(() => {
      this.pick(loc.element);
      this.preview.elements.get(loc.element)?.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
      });
    });
  }

  private readonly onCanvasClick = (e: MouseEvent): void => {
    const host = this.querySelector('.svg-host');
    for (const n of e.composedPath()) {
      if (n === host) break;
      if (!(n instanceof Element)) continue;
      const uid = n.getAttribute('data-mat-uid');
      if (uid && this.data?.declared.has(uid)) {
        this.pick(uid);
        return;
      }
    }
    this.pick(null);
  };

  private readonly onCanvasKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === '+' || e.key === '=') this.zoomBy(ZOOM_STEP);
    else if (e.key === '-') this.zoomBy(1 / ZOOM_STEP);
    else if (e.key === '0') this.fit();
    else if (e.key === 'Escape' && this.app.store.state.selection) this.pick(null);
    else return;
    e.preventDefault();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    this.zoomBy(e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
  };

  private readonly onScroll = (e: Event): void => {
    const el = e.currentTarget as HTMLElement;
    this.scrollX = el.scrollLeft;
    this.scrollY = el.scrollTop;
    this.requestUpdate();
  };

  private readonly onDrop = (e: DragEvent): void => {
    e.preventDefault();
    this.app.toast(t('preview.drop'));
  };

  // ---------- Tỉ lệ ----------

  private setZoom(z: number, fit = false): void {
    const v = this.view;
    v.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    v.fit = fit;
    this.requestUpdate();
  }

  private zoomBy(factor: number): void {
    this.setZoom(this.view.zoom * factor);
  }

  /** Vừa khung: cả màn hình nằm trong vùng vẽ, chừa lề. Chưa đo được (ẩn) thì giữ tỉ lệ, đo sau. */
  private fit(): void {
    const sc = this.querySelector<HTMLElement>('.cv-scroll');
    const d = this.data;
    if (!sc || !d) return;
    if (!sc.clientWidth || !sc.clientHeight) {
      this.view.fit = true;
      this.requestUpdate();
      return;
    }
    const z = Math.min((sc.clientWidth - 2 * PAD) / d.vb[2], (sc.clientHeight - 2 * PAD) / d.vb[3]);
    this.setZoom(z, true);
  }

  private observe(): void {
    const sc = this.querySelector('.cv-scroll');
    if (sc === this.observed) return;
    this.ro?.disconnect();
    this.ro = null;
    this.observed = sc;
    if (!sc || typeof ResizeObserver === 'undefined') return;
    this.ro = new ResizeObserver(() => {
      if (this.view.fit) this.fit();
      else this.placeSel();
    });
    this.ro.observe(sc);
  }

  // ---------- Vẽ ----------

  private setMode(mode: PreviewMode): void {
    const app = this.app;
    if (mode === 'device' && !isLive(app.session.state)) {
      app.toast(
        t('reason.locked', { label: t('preview.mode.device'), reason: t('preview.deviceLocked') }),
      );
      return;
    }
    this.view.mode = mode;
    this.requestUpdate();
  }

  private modeButton(mode: PreviewMode, locked = false) {
    const label =
      mode === 'off'
        ? t('preview.mode.off')
        : mode === 'sim'
          ? t('preview.mode.sim')
          : t('preview.mode.device');
    const tip = locked
      ? t('preview.deviceLocked')
      : mode === 'off'
        ? t('preview.mode.offTip')
        : mode === 'sim'
          ? t('preview.mode.simTip')
          : t('preview.mode.deviceTip');
    return html`<button
      type="button"
      data-mode=${mode}
      aria-pressed=${this.view.mode === mode ? 'true' : 'false'}
      aria-disabled=${locked ? 'true' : nothing}
      title=${tip}
      @click=${() => this.setMode(mode)}
    >
      ${label}
    </button>`;
  }

  private tools() {
    const v = this.view;
    const zoomIn = t('preview.zoomIn');
    const zoomOut = t('preview.zoomOut');
    const monitoring = isLive(this.app.session.state);
    return html`<div class="ed-tools sp-tools">
      <button
        class="ibtn"
        type="button"
        data-act="zoom-out"
        aria-label=${zoomOut}
        title=${t('preview.zoomTip', { label: zoomOut })}
        @click=${() => this.zoomBy(1 / ZOOM_STEP)}
      >
        ${icon('zoomout')}
      </button>
      <output class="num sp-zoom" aria-label=${t('preview.zoom')}
        >${t('preview.zoomValue', { n: Math.round(v.zoom * 100) })}</output
      >
      <button
        class="ibtn"
        type="button"
        data-act="zoom-in"
        aria-label=${zoomIn}
        title=${t('preview.zoomTip', { label: zoomIn })}
        @click=${() => this.zoomBy(ZOOM_STEP)}
      >
        ${icon('zoomin')}
      </button>
      <button class="tbtn" type="button" data-act="fit" @click=${() => this.fit()}>
        ${icon('fit')}<span>${t('preview.fit')}</span>
      </button>
      <button class="tbtn" type="button" data-act="actual" @click=${() => this.setZoom(1)}>
        <span>${t('preview.actual')}</span>
      </button>
      <span class="tsep"></span>
      <button
        class="ibtn"
        type="button"
        data-act="grid"
        aria-pressed=${v.grid ? 'true' : 'false'}
        aria-label=${t('preview.grid')}
        title=${t('preview.gridTip', { n: GRID })}
        @click=${() => {
          v.grid = !v.grid;
          this.requestUpdate();
        }}
      >
        ${icon('grid')}
      </button>
      <button
        class="ibtn"
        type="button"
        data-act="snap"
        aria-disabled="true"
        aria-label=${t('preview.snap')}
        title=${t('preview.snapTip')}
        @click=${() => this.app.toast(t('preview.snapTip'))}
      >
        ${icon('snap')}
      </button>
      <span class="tsep"></span>
      <span class="muted">${t('preview.mode')}</span>
      <div class="seg" role="group" aria-label=${t('preview.modeGroup')}>
        ${this.modeButton('off')}${this.modeButton('sim')}${this.modeButton('device', !monitoring)}
      </div>
      <span class="grow"></span>
      ${
        this.app.workspace.showPhases
          ? html`<span class="phase">${t('preview.layoutPhase')}</span>`
          : nothing
      }
    </div>`;
  }

  private notices(d: ScreenData) {
    if (d.svgText === null)
      return html`<div class="banner warn" role="status">
        ${icon('warn', 'warn')}
        <div>${t('preview.noSvg', { file: d.svgFile })}</div>
      </div>`;
    if (this.error)
      return html`<div class="banner err" role="status">
        ${icon('err', 'err')}
        <div>${t('preview.mountError', { reason: this.error })}</div>
      </div>`;
    if (this.missing.length)
      return html`<div class="banner warn" role="status">
        ${icon('warn', 'warn')}
        <div>${t('preview.missingUids', { list: this.missing.join(', ') })}</div>
      </div>`;
    return nothing;
  }

  /** Thước trên (x) hoặc trái (y): vạch theo tỉ lệ, số theo đơn vị của màn hình, đi theo cuộn. */
  private ruler(axis: 'x' | 'y', origin: number, size: number) {
    const z = this.view.zoom;
    const off = PAD - (axis === 'x' ? this.scrollX : this.scrollY);
    const step = z >= 0.75 ? 100 : z >= 0.35 ? 200 : 400;
    const marks: number[] = [];
    for (let m = 0; m <= size; m += step) marks.push(m);
    return html`<div
      class="ruler ${axis === 'x' ? 'rt' : 'rl'}"
      aria-hidden="true"
      style=${styleMap({ '--tick': px(50 * z), '--off': px(off) })}
    >
      ${marks.map(
        (m) =>
          html`<span
            style=${styleMap(axis === 'x' ? { left: px(off + m * z + 3) } : { top: px(off + m * z + 3) })}
            >${origin + m}</span
          >`,
      )}
    </div>`;
  }

  protected override render() {
    const d = this.data;
    if (!d)
      return html`<div class="ed sp">
        <div class="ed-head"><h2>${this.app.editorTitle(`screen:${this.screen}`)}</h2></div>
        <div class="empty">
          ${icon('screen', 'lg')}
          <p>${t('preview.noScreen', { id: this.screen })}</p>
        </div>
      </div>`;
    const z = this.view.zoom;
    const [vx, vy, w, h] = d.vb;
    return html`<div class="ed ed-fill sp">
      <div class="ed-head">
        <h2>${d.name}</h2>
        <span class="path">${t('preview.path', { file: d.svgFile, w, h })}</span>
        <span class="grow"></span>
        <span class="help">${t('preview.hint')}</span>
      </div>
      ${this.tools()} ${this.notices(d)}
      <div class="cv">
        <div class="ruler-corner"></div>
        ${this.ruler('x', vx, w)} ${this.ruler('y', vy, h)}
        <div
          class="cv-scroll"
          tabindex="0"
          role="region"
          aria-label=${t('preview.canvas', { name: d.name })}
          @scroll=${this.onScroll}
          @wheel=${this.onWheel}
          @click=${this.onCanvasClick}
          @keydown=${this.onCanvasKey}
          @dragover=${(e: DragEvent) => e.preventDefault()}
          @drop=${this.onDrop}
        >
          <div class="cv-inner">
            <div
              class="board"
              style=${styleMap({ width: px(w * z), height: px(h * z), '--g': px(GRID * z) })}
            >
              <div class="svg-host"></div>
              <div class="gridov" ?hidden=${!this.view.grid}></div>
              <div class="selbox" hidden>
                <span class="nm"></span>${HANDLES.map((p) => html`<i class=${p}></i>`)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }
}

customElements.define('mat-screen-preview', ScreenPreview);

registerEditor({
  match: (id) => id.startsWith('screen:'),
  render: (app, id) =>
    html`<mat-screen-preview
      .app=${app}
      .screenId=${id.slice('screen:'.length)}
    ></mat-screen-preview>`,
});

declare global {
  interface HTMLElementTagNameMap {
    'mat-screen-preview': ScreenPreview;
  }
}
