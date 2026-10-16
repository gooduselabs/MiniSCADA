// <mat-screen> (contracts/ui-components-api.md §3, ADR-013): dựng một màn hình v1: khung `size`, item tuyệt đối theo
// thứ tự mảng, co bằng một phép `transform: scale()` theo fitMode, item `svg` qua mountScreen + DomApplier, widget
// `mat-w-*`, popup ở lớp phủ riêng. Dùng chung cho trang runtime và xem trước Studio.
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import type {
  ElementBindings02,
  Item,
  ScreenModel,
  SvgItem,
  WidgetItem,
} from '@mat/project-schema';
import { safeColor } from '../format/color.ts';
import type { ActionHost, AlarmSource, TagSource } from '../host/types.ts';
import { vi } from '../i18n/vi.ts';
import { installTokens } from '../styles/tokens.ts';
import { elementNameFor, registerWidgets } from '../widgets/register.ts';
import { computeFit, type Fit } from './fit.ts';
import { collectTagIds, layersOf } from './layers.ts';
import { deepActiveElement, nextFocusIndex, trapTab } from './popup-layer.ts';
import { SvgItemView, svgItemKey } from './svg-item.ts';
import type { StatusSink } from './svg-events.ts';

export { nextFocusIndex };

/** Thời gian giữ thông báo ở vùng status (ms). */
const STATUS_MS = 6000;

/** Phần phụ thuộc môi trường có thể tiêm (jsdom thiếu ResizeObserver/rAF). */
export interface ScreenEnv {
  raf(cb: () => void): unknown;
  cancelRaf(handle: unknown): void;
  ResizeObserver?: typeof ResizeObserver;
}

function defaultEnv(): ScreenEnv {
  const g = globalThis as unknown as {
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (h: number) => void;
    ResizeObserver?: typeof ResizeObserver;
  };
  return {
    raf: (cb) => (g.requestAnimationFrame ? g.requestAnimationFrame(cb) : setTimeout(cb, 16)),
    cancelRaf: (h) =>
      g.cancelAnimationFrame ? g.cancelAnimationFrame(h as number) : clearTimeout(h as number),
    ResizeObserver: g.ResizeObserver,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Slot {
  item: Item;
  kind: string;
  wrapper: HTMLElement;
  el: HTMLElement | null;
  svg: SvgItemView | null;
}

type Size = { width: number; height: number };

export class MatScreen extends LitElement {
  static override properties = {
    screen: { attribute: false },
    popup: { attribute: false },
    tags: { attribute: false },
    host: { attribute: false },
    alarms: { attribute: false },
    loadSvg: { attribute: false },
    loadBindings: { attribute: false },
    mode: { reflect: true },
    viewport: { attribute: false },
    env: { attribute: false },
  };

  declare screen: ScreenModel;
  declare popup: ScreenModel | null;
  declare tags: TagSource;
  declare host: ActionHost;
  /** Feature 009: nguồn alarm cho widget `alarm-list`, `alarm-count` (trang runtime cấp LiveAlarmSource); vắng thì widget báo "Không có dữ liệu alarm". */
  declare alarms: AlarmSource | undefined;
  declare loadSvg: (path: string) => Promise<string>;
  declare loadBindings: (path: string) => Promise<ElementBindings02[]>;
  declare mode: 'run' | 'edit';
  declare viewport: Size | 'auto';
  /** Tiêm rAF/ResizeObserver (test); vắng thì dùng của trình duyệt. */
  declare env: ScreenEnv | undefined;

  #slots = new Map<string, Slot>();
  #slotsScreenId = '';
  #loads = new Set<Promise<void>>();
  #ro: ResizeObserver | null = null;
  #measured: Size = { width: 0, height: 0 };
  #pendingSize: Size | null = null;
  #rafHandle: unknown = null;
  #rafQueued = false;
  #lastTagsKey: string | null = null;
  #dirty = true;
  #disposed = false;
  #returnFocus: Element | null = null;
  #statusMsg = '';
  #statusKind: 'info' | 'warn' | 'error' | 'ok' = 'info';
  #statusTimer: ReturnType<typeof setTimeout> | null = null;

  /** Vùng `role="status"` (sự kiện phần tử SVG): lý do khóa, "đang gửi", kết quả ghi. */
  readonly #statusSink: StatusSink = {
    show: (message, kind) => {
      if (this.#disposed) return;
      this.#statusMsg = message;
      this.#statusKind = kind;
      if (this.#statusTimer) clearTimeout(this.#statusTimer);
      this.#statusTimer = setTimeout(() => {
        this.#statusTimer = null;
        this.#statusMsg = '';
        this.requestUpdate();
      }, STATUS_MS);
      this.requestUpdate();
    },
  };

  constructor() {
    super();
    this.popup = null;
    this.mode = 'run';
    this.viewport = 'auto';
    this.loadSvg = async () => {
      throw new Error('loadSvg not set');
    };
    this.loadBindings = async () => [];
  }

  static override styles = css`
    :host {
      display: block;
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      font-family: var(--mat-font, system-ui, sans-serif);
    }
    .viewport {
      position: absolute;
      inset: 0;
      overflow: hidden;
    }
    .sizer {
      position: relative;
      transform-origin: 0 0;
    }
    .frame {
      position: absolute;
      left: 0;
      top: 0;
      transform-origin: 0 0;
      overflow: hidden;
    }
    .item {
      position: absolute;
    }
    .frame.edit .item {
      pointer-events: none;
    }
    .svg-host {
      width: 100%;
      height: 100%;
    }
    .svg-failed,
    .unsupported {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: 6px;
      font-size: 12px;
      color: var(--mat-text-muted, #56646a);
      border: 1px dashed var(--mat-border-strong, #b3bec3);
      overflow: hidden;
    }
    .status-bar {
      position: absolute;
      left: 8px;
      bottom: 8px;
      z-index: 20;
      max-width: calc(100% - 16px);
      padding: 6px 12px;
      font-size: 13px;
      color: var(--mat-text, #1a2225);
      background: var(--mat-surface, #fff);
      border: 1px solid var(--mat-border-strong, #b3bec3);
      border-left-width: 4px;
      border-radius: var(--mat-radius, 4px);
      box-shadow: var(--mat-shadow, 0 4px 12px rgba(16, 34, 42, 0.18));
    }
    .status-bar[hidden] {
      display: none;
    }
    .status-bar[data-kind='warn'] {
      border-left-color: var(--mat-warn, #8f5e00);
    }
    .status-bar[data-kind='error'] {
      border-left-color: var(--mat-bad, #c42b2b);
    }
    .status-bar[data-kind='ok'] {
      border-left-color: var(--mat-good, #2e7d32);
    }
    .popup-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-scrim, rgba(12, 22, 26, 0.36));
    }
    .popup-dialog {
      display: flex;
      flex-direction: column;
      background: var(--mat-surface, #fff);
      color: var(--mat-text, #1a2225);
      border: 1px solid var(--mat-border, #d2d9dc);
      border-radius: calc(var(--mat-radius, 4px) * 2);
      box-shadow: var(--mat-shadow, 0 12px 32px rgba(16, 34, 42, 0.18));
      overflow: hidden;
      outline: none;
    }
    .popup-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px 6px 14px;
      border-bottom: 1px solid var(--mat-border, #d2d9dc);
      font-weight: 600;
    }
    .popup-body {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .popup-close {
      font: inherit;
      color: inherit;
      background: var(--mat-surface-2, #f5f7f8);
      border: 1px solid var(--mat-border-strong, #b3bec3);
      border-radius: var(--mat-radius, 4px);
      padding: 3px 10px;
      cursor: pointer;
    }
    .popup-close:focus-visible {
      outline: 2px solid var(--mat-accent, #0b7285);
      outline-offset: 1px;
    }
  `;

  // ---- API công khai -----------------------------------------------------------------------------------------

  /** Hệ số co k hiện tại (stretch: theo chiều ngang). */
  get scale(): number {
    return this.#fit().k;
  }

  /** Tập Tag cần đăng ký của màn hình (+ popup), bỏ item hidden. */
  tagIds(): string[] {
    const own = collectTagIds([this.screen], (sid, iid) => {
      const slot = sid === this.screen?.id ? this.#slots.get(iid) : undefined;
      return slot?.svg?.tagIds() ?? [];
    });
    const nested = this.#popupScreen()?.tagIds() ?? [];
    return [...new Set([...own, ...nested])];
  }

  /** Tổng số hoạt ảnh vô hạn của các item `svg` (cảnh báo > 64, ADR-024 mục 8; đo ở SC-008). */
  animationCount(): number {
    let n = 0;
    for (const s of this.#slots.values()) n += s.svg?.animationCount() ?? 0;
    return n;
  }

  /** Hình chữ nhật item theo đơn vị thiết kế (cho lớp phủ của Studio). */
  itemRect(id: string): Rect | null {
    const it = this.screen?.items.find((i) => i.id === id);
    return it ? { x: it.x, y: it.y, width: it.width, height: it.height } : null;
  }

  /** Resolve khi mọi item đã dựng và các item `svg` đã tải xong. */
  async whenReady(): Promise<void> {
    for (;;) {
      await this.updateComplete;
      if (this.#loads.size === 0) return;
      await Promise.all([...this.#loads]);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#popupScreen()?.dispose();
    if (this.#statusTimer) clearTimeout(this.#statusTimer);
    this.#statusTimer = null;
    this.#statusMsg = '';
    for (const s of this.#slots.values()) this.#destroy(s);
    this.#slots.clear();
    this.#loads.clear();
    this.#disconnectObserver();
    if (this.#rafQueued && this.#rafHandle !== null) this.#env().cancelRaf(this.#rafHandle);
    this.#rafHandle = null;
    this.#rafQueued = false;
    this.#lastTagsKey = null;
  }

  // ---- vòng đời ----------------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    registerWidgets();
    installTokens(this.ownerDocument);
    if (this.#disposed) {
      this.#disposed = false;
      this.#dirty = true;
      this.requestUpdate();
    }
    this.#syncObserver();
  }

  override disconnectedCallback(): void {
    this.dispose();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('viewport') || changed.has('env')) this.#syncObserver();
  }

  protected override updated(changed: PropertyValues): void {
    if (this.#disposed) return;
    const structural =
      this.#dirty ||
      changed.has('screen') ||
      changed.has('tags') ||
      changed.has('host') ||
      changed.has('alarms') ||
      changed.has('mode') ||
      changed.has('loadSvg') ||
      changed.has('loadBindings') ||
      changed.has('env');
    if (structural) {
      this.#dirty = false;
      this.#reconcile();
    }
    if (changed.has('popup'))
      this.#onPopupChange(changed.get('popup') as ScreenModel | null | undefined);
  }

  // ---- đo và co ----------------------------------------------------------------------------------------------

  #env(): ScreenEnv {
    return this.env ?? defaultEnv();
  }

  #size(): Size {
    return this.viewport === 'auto' ? this.#measured : this.viewport;
  }

  #fit(): Fit {
    const s = this.screen;
    if (!s) return computeFit({ width: 1, height: 1 }, 'none', { width: 0, height: 0 });
    return computeFit(s.size, s.fitMode, this.#size());
  }

  #syncObserver(): void {
    if (this.viewport !== 'auto' || !this.isConnected) {
      this.#disconnectObserver();
      return;
    }
    if (this.#ro) return;
    const RO = this.#env().ResizeObserver;
    if (!RO) {
      this.#measured = { width: this.clientWidth, height: this.clientHeight };
      return;
    }
    this.#ro = new RO((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r) return;
      this.#pendingSize = { width: r.width, height: r.height };
      if (this.#rafQueued) return;
      // Gom mọi lần đo trong một khung hình (ADR-013 điểm 4).
      this.#rafQueued = true;
      const h = this.#env().raf(() => {
        this.#rafQueued = false;
        this.#rafHandle = null;
        if (this.#pendingSize) this.#measured = this.#pendingSize;
        this.#pendingSize = null;
        this.requestUpdate();
      });
      if (this.#rafQueued) this.#rafHandle = h;
    });
    this.#ro.observe(this);
    this.#measured = { width: this.clientWidth, height: this.clientHeight };
  }

  #disconnectObserver(): void {
    this.#ro?.disconnect();
    this.#ro = null;
  }

  // ---- dựng item ---------------------------------------------------------------------------------------------

  #frameEl(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.frame');
  }

  #popupScreen(): MatScreen | null {
    return this.renderRoot?.querySelector<MatScreen>('.popup-body > mat-screen') ?? null;
  }

  #reconcile(): void {
    const frame = this.#frameEl();
    if (!frame || !this.screen) return;
    // Slot gắn với một màn hình: item cùng id ở màn hình khác không dùng lại phần tử (và trạng thái nội bộ) cũ.
    if (this.#slotsScreenId !== this.screen.id) {
      for (const s of this.#slots.values()) this.#destroy(s);
      this.#slots.clear();
      this.#slotsScreenId = this.screen.id;
    }
    const layers = layersOf(this.screen);
    const wanted = new Set(layers.map((l) => l.item.id));

    for (const [id, slot] of [...this.#slots]) {
      if (!wanted.has(id)) {
        this.#destroy(slot);
        this.#slots.delete(id);
      }
    }

    const order: HTMLElement[] = [];
    for (const { item } of layers) {
      let slot = this.#slots.get(item.id);
      if (slot && !this.#reusable(slot, item)) {
        this.#destroy(slot);
        this.#slots.delete(item.id);
        slot = undefined;
      }
      if (!slot) {
        slot = this.#create(item);
        this.#slots.set(item.id, slot);
      } else {
        this.#update(slot, item);
      }
      order.push(slot.wrapper);
    }

    // Sắp thứ tự lớp: chỉ di chuyển phần tử lệch chỗ (di chuyển làm widget ngắt và nối lại).
    order.forEach((w, i) => {
      if (frame.children[i] !== w) frame.insertBefore(w, frame.children[i] ?? null);
    });
    while (frame.children.length > order.length) frame.lastElementChild!.remove();

    this.#emitTags();
    this.#checkReady();
  }

  #reusable(slot: Slot, item: Item): boolean {
    if (item.type === 'svg') {
      return slot.kind === 'svg' && slot.svg !== null && slot.svg.key === svgItemKey(item);
    }
    return slot.kind === item.widget;
  }

  #place(wrapper: HTMLElement, item: Item): void {
    const s = wrapper.style;
    s.position = 'absolute';
    s.left = `${item.x}px`;
    s.top = `${item.y}px`;
    s.width = `${item.width}px`;
    s.height = `${item.height}px`;
  }

  #create(item: Item): Slot {
    const doc = this.ownerDocument;
    const wrapper = doc.createElement('div');
    wrapper.className = 'item';
    wrapper.dataset.itemId = item.id;
    this.#place(wrapper, item);

    if (item.type === 'svg') {
      const host = doc.createElement('div');
      host.className = 'svg-host';
      wrapper.append(host);
      const view = new SvgItemView({
        item: item as SvgItem,
        host,
        source: this.tags,
        loadSvg: this.loadSvg,
        loadBindings: this.loadBindings,
        raf: (cb) => this.#env().raf(cb),
        events: () => ({
          screenId: this.screen.id,
          host: this.host,
          mode: this.mode,
          status: this.#statusSink,
        }),
        onLoaded: () => {
          this.#emitTags();
        },
      });
      const p: Promise<void> = view.ready.then(() => {
        this.#loads.delete(p);
        this.#checkReady();
      });
      this.#loads.add(p);
      return { item, kind: 'svg', wrapper, el: host, svg: view };
    }

    const name = elementNameFor(item.widget);
    if (!name) {
      const ph = doc.createElement('div');
      ph.className = 'unsupported';
      ph.textContent = `${vi.screen.unsupportedWidget}: ${item.widget}`;
      wrapper.append(ph);
      return { item, kind: item.widget, wrapper, el: ph, svg: null };
    }
    const el = doc.createElement(name) as HTMLElement & Record<string, unknown>;
    this.#bindWidget(el, item);
    wrapper.append(el);
    return { item, kind: item.widget, wrapper, el, svg: null };
  }

  #bindWidget(el: HTMLElement & Record<string, unknown>, item: WidgetItem): void {
    el.item = item;
    el.source = this.tags;
    el.host = this.host;
    el.alarms = this.alarms;
    el.mode = this.mode;
    el.context = { screen: this.screen.id, widget: item.id };
  }

  #update(slot: Slot, item: Item): void {
    slot.item = item;
    this.#place(slot.wrapper, item);
    // Đổi file binding hoặc nguồn giá trị (Studio: gắn Tag, hoàn tác, đổi chế độ xem trước): dựng lại bộ áp trên cùng DOM,
    // không dựng lại SVG.
    if (slot.svg && item.type === 'svg')
      void slot.svg.rewire(item.bindingFile, this.tags, item.elements);
    slot.svg?.syncEvents();
    if (
      item.type === 'widget' &&
      slot.el &&
      slot.kind === item.widget &&
      elementNameFor(item.widget)
    ) {
      const el = slot.el as HTMLElement & Record<string, unknown>;
      if (el.item !== item) el.item = item;
      if (el.source !== this.tags) el.source = this.tags;
      if (el.host !== this.host) el.host = this.host;
      if (el.alarms !== this.alarms) el.alarms = this.alarms;
      if (el.mode !== this.mode) el.mode = this.mode;
      const ctx = el.context as { screen: string; widget: string } | undefined;
      if (!ctx || ctx.screen !== this.screen.id || ctx.widget !== item.id)
        el.context = { screen: this.screen.id, widget: item.id };
    }
  }

  #destroy(slot: Slot): void {
    slot.svg?.dispose();
    slot.wrapper.remove();
  }

  // ---- sự kiện -----------------------------------------------------------------------------------------------

  #emitTags(): void {
    if (this.#disposed) return;
    const ids = this.tagIds();
    const key = [...ids].sort().join('\u0000');
    if (key === this.#lastTagsKey) return;
    this.#lastTagsKey = key;
    this.dispatchEvent(
      new CustomEvent('mat-tags', { detail: { ids }, bubbles: true, composed: true }),
    );
  }

  #checkReady(): void {
    if (this.#loads.size > 0 || this.#disposed) return;
    this.dispatchEvent(new CustomEvent('mat-ready', { bubbles: true, composed: true }));
  }

  // ---- popup -------------------------------------------------------------------------------------------------

  #closePopup = (): void => {
    if (this.mode === 'edit' || !this.host) return;
    this.host.closePopup();
  };

  #onKeydown = (e: KeyboardEvent): void => {
    const dialog = e.currentTarget as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.#closePopup();
      return;
    }
    trapTab(e, dialog.querySelector<HTMLElement>('.popup-dialog') ?? dialog);
  };

  #onNestedTags = (e: Event): void => {
    e.stopPropagation();
    this.#emitTags();
  };

  #onNestedReady = (e: Event): void => {
    e.stopPropagation();
  };

  #onPopupChange(prev: ScreenModel | null | undefined): void {
    if (this.popup && !prev) {
      this.#returnFocus = deepActiveElement(this.ownerDocument);
      this.renderRoot.querySelector<HTMLElement>('.popup-close')?.focus();
    } else if (!this.popup && prev) {
      const back = this.#returnFocus;
      this.#returnFocus = null;
      if (back && back.isConnected) (back as HTMLElement).focus();
    }
    this.#emitTags();
  }

  #popupTemplate(): TemplateResult | typeof nothing {
    const p = this.popup;
    if (!p) return nothing;
    const ratio = p.size.height > 0 ? p.size.width / p.size.height : 1;
    const dialogStyle = {
      width: `min(${p.size.width}px, 90vw, calc(90vh * ${ratio}))`,
      aspectRatio: `${p.size.width} / ${p.size.height + 40}`,
      maxHeight: '90vh',
    };
    return html`<div class="popup-overlay" @keydown=${this.#onKeydown}>
      <div
        class="popup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label=${p.name}
        tabindex="-1"
        style=${styleMap(dialogStyle)}
      >
        <div class="popup-head">
          <span class="ellipsis">${p.name}</span>
          <button class="popup-close" type="button" @click=${this.#closePopup}>
            ${vi.screen.popupClose}
          </button>
        </div>
        <div class="popup-body">
          <mat-screen
            .screen=${p}
            .tags=${this.tags}
            .host=${this.host}
            .alarms=${this.alarms}
            .loadSvg=${this.loadSvg}
            .loadBindings=${this.loadBindings}
            .mode=${this.mode}
            .env=${this.env}
            .viewport=${'auto'}
            @mat-tags=${this.#onNestedTags}
            @mat-ready=${this.#onNestedReady}
          ></mat-screen>
        </div>
      </div>
    </div>`;
  }

  // ---- render ------------------------------------------------------------------------------------------------

  protected override render(): TemplateResult {
    const s = this.screen;
    const fit = this.#fit();
    const w = s?.size.width ?? 0;
    const h = s?.size.height ?? 0;
    const scrollY = s?.fitMode === 'fit-width';
    const scrollAll = s?.fitMode === 'none';
    return html`<div
        class="viewport"
        style=${styleMap({
          background: safeColor(s?.background),
          overflow: scrollAll ? 'auto' : scrollY ? 'hidden auto' : 'hidden',
        })}
      >
        <div
          class="sizer"
          style=${styleMap({
            width: `${w * fit.kx}px`,
            height: `${h * fit.ky}px`,
            transform: `translate(${fit.x}px, ${fit.y}px)`,
          })}
        >
          <div
            class="frame ${this.mode === 'edit' ? 'edit' : ''}"
            style=${styleMap({
              width: `${w}px`,
              height: `${h}px`,
              transform: `scale(${fit.kx}, ${fit.ky})`,
            })}
          ></div>
        </div>
      </div>
      <div
        class="status-bar"
        role="status"
        aria-live="polite"
        data-kind=${this.#statusKind}
        ?hidden=${!this.#statusMsg}
      >
        ${this.#statusMsg}
      </div>
      ${this.#popupTemplate()}`;
  }
}

export function registerScreen(): void {
  registerWidgets();
  if (!customElements.get('mat-screen')) customElements.define('mat-screen', MatScreen);
}

registerScreen();
