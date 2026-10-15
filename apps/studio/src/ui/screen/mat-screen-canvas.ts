// Canvas của editor Màn hình 0.3 (feature 007, T111, FR-058, FR-059, FR-071; ADR-022 điểm 1 và 2; mockup studio-screens cảnh 1).
// `<mat-screen mode="edit">` của @mat/ui-components vẽ item ở tỉ lệ 1:1 trong một "thế giới" CSS (`translate` + `scale` theo zoom
// và pan); lớp phủ nằm cùng thế giới nên khung chọn, tay nắm, đường gióng, viền lỗi theo đơn vị thiết kế (`--k` = 1 / zoom giữ
// nét mảnh). Pointer Events đổi sang tọa độ thiết kế rồi đưa vào máy trạng thái thuần `gesture.ts`; canvas chỉ thi hành đầu ra
// của máy (chọn, xem trước tạm, ghi một bước hoàn tác, đường gióng, khung chọn, chú giải). ARIA: vùng nhìn là `listbox` đa chọn,
// mỗi item một `option` (aria-selected); bản vẽ bên dưới `inert` vì đã có các option thay thế.
import type { Item, ScreenModel } from '@mat/project-schema';
import { MatScreen, MemoryTagSource, type TagInfo as HostTagInfo } from '@mat/ui-components';
import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { historyFor } from '../../app/history-sources.ts';
import { t } from '../../i18n/index.ts';
import { hostTagInfo } from '../../model/preview-hosts.ts';
import { catalogMinSizeOf } from '../../model/screen-edit/resize.ts';
import { moveItems } from '../../model/screen-doc.ts';
import {
  createGesture,
  type Gesture,
  type GestureOutput,
  type Modifiers,
  type TooltipInfo,
} from '../../model/screen-edit/gesture.ts';
import { nextByTab } from '../../model/screen-edit/hit.ts';
import { hitTest } from '../../model/screen-edit/hit.ts';
import type { Handle } from '../../model/screen-edit/resize.ts';
import { HANDLES } from '../../model/screen-edit/resize.ts';
import type { Guide } from '../../model/screen-edit/snap.ts';
import { boundsOf } from '../../model/screen-edit/align.ts';
import {
  fitViewport,
  panBy,
  toDesign,
  toScreen,
  zoomAt,
  zoomIn,
  zoomOut,
  zoomTo,
  zoomWheel,
  type Pt,
  type Viewport,
} from '../../model/screen-edit/viewport.ts';
import { groupByItem, screenIssues, severityOfItem } from '../../model/screen-issues.ts';
import { AppElement } from '../base.ts';
import { resolveCanvasKey } from './keymap.ts';
import './mat-ruler.ts';
import './screen-canvas.css';

/** Lề quanh màn hình khi "Vừa khung" (điểm ảnh). */
export const FIT_MARGIN = 40;

const DEFAULT_VIEWPORT: Viewport = { zoom: 1, panX: FIT_MARGIN, panY: FIT_MARGIN };

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const rectStyle = (r: Rect) => ({
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${r.width}px`,
  height: `${r.height}px`,
});

const itemName = (it: Item): string => it.name?.trim() || it.id;

const HANDLE_POS: Readonly<Record<Handle, readonly [string, string]>> = {
  nw: ['0%', '0%'],
  n: ['50%', '0%'],
  ne: ['100%', '0%'],
  e: ['100%', '50%'],
  se: ['100%', '100%'],
  s: ['50%', '100%'],
  sw: ['0%', '100%'],
  w: ['0%', '50%'],
};

export class MatScreenCanvas extends AppElement {
  static override properties = {
    screenId: { attribute: false },
    preview: { state: true },
    guides: { state: true },
    marquee: { state: true },
    tip: { state: true },
    tipAt: { state: true },
    dropItem: { state: true },
    area: { state: true },
    spaceDown: { state: true },
  };

  declare screenId: string;
  /** Tài liệu tạm khi đang kéo (chưa vào lịch sử). */
  declare preview: ScreenModel | null;
  declare guides: Guide[];
  declare marquee: Rect | null;
  declare tip: TooltipInfo | null;
  declare tipAt: Pt;
  /** Item đang được rê Tag lên (kéo thả Tag). */
  declare dropItem: string | null;
  declare area: { width: number; height: number };
  declare spaceDown: boolean;

  private gesture: Gesture | null = null;
  private ro: ResizeObserver | null = null;
  private edit = new MemoryTagSource();
  private editTags: unknown = null;
  private lastTagsKey = '';

  constructor() {
    super();
    this.screenId = '';
    this.preview = null;
    this.guides = [];
    this.marquee = null;
    this.tip = null;
    this.tipAt = { x: 0, y: 0 };
    this.dropItem = null;
    this.area = { width: 0, height: 0 };
    this.spaceDown = false;
  }

  // ---------- Truy cập trạng thái ----------

  private get doc(): ScreenModel | null {
    return this.app.screenModel(this.screenId);
  }

  /** Màn hình đang hiện: ở chế độ xem trước có thể là màn hình khác do nút điều hướng. */
  private get shown(): ScreenModel | null {
    if (this.previewing) {
      const nav = this.app.screens.previewNav;
      return (nav.screen ? this.app.screenModel(nav.screen) : null) ?? this.doc;
    }
    return this.preview ?? this.doc;
  }

  private get previewing(): boolean {
    return this.app.screens.previewMode !== 'off';
  }

  /** Vùng nhìn của màn hình (mặc định "vừa khung" khi chưa đo). */
  get viewport(): Viewport {
    return this.app.screens.view(this.screenId)?.viewport ?? DEFAULT_VIEWPORT;
  }

  private setViewport(viewport: Viewport, fit = false): void {
    this.app.screens.setView(this.screenId, { viewport, fit });
    this.requestUpdate();
  }

  // ---------- Vòng đời ----------

  protected override attached(): void {
    this.gesture = createGesture({
      getDoc: () => this.doc ?? emptyScreen(),
      getSelection: () => this.app.selectedItems(this.screenId),
      getViewport: () => this.viewport,
      getGrid: () => ({ size: this.app.screens.gridSize, snap: this.app.screens.snap }),
      minSizeOf: catalogMinSizeOf,
    });
  }

  protected override detached(): void {
    this.gesture = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keyup', this.onKeyUp);
  }

  override disconnectedCallback(): void {
    this.removeEventListener('keyup', this.onKeyUp);
    this.ro?.disconnect();
    this.ro = null;
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    const vp = this.vp();
    if (!vp || typeof ResizeObserver === 'undefined') {
      this.area = { width: vp?.clientWidth ?? 0, height: vp?.clientHeight ?? 0 };
      return;
    }
    this.ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]?.contentRect;
      if (!r) return;
      this.area = { width: Math.round(r.width), height: Math.round(r.height) };
    });
    this.ro.observe(vp);
    this.area = { width: vp.clientWidth, height: vp.clientHeight };
    // Wheel không thụ động để chặn cuộn trang khi zoom.
    vp.addEventListener('wheel', this.onWheel, { passive: false });
  }

  protected override updated(changed: PropertyValues): void {
    const doc = this.doc;
    const view = this.app.screens.view(this.screenId);
    // Lần đầu có kích thước vùng vẽ, hoặc đang ở "Vừa khung" mà vùng vẽ đổi cỡ: tính lại.
    if (doc && this.area.width > 0 && (!view || (view.fit && changed.has('area')))) {
      this.setViewport(fitViewport(this.area, doc.size, FIT_MARGIN), true);
    }
    const sel = this.app.selectedItems(this.screenId);
    if (changed.has('screenId') || sel.length === 0)
      this.vp()?.removeAttribute('aria-activedescendant');
  }

  private vp(): HTMLElement | null {
    return this.querySelector<HTMLElement>('.vp');
  }

  // ---------- Lệnh công khai cho thanh công cụ và bảng lệnh ----------

  private center(): Pt {
    return { x: this.area.width / 2, y: this.area.height / 2 };
  }

  zoomBy(dir: 1 | -1): void {
    this.setViewport((dir > 0 ? zoomIn : zoomOut)(this.viewport, this.center()));
  }

  zoomActual(): void {
    this.setViewport(zoomTo(this.viewport, 1, this.center()));
  }

  fit(): void {
    const doc = this.doc;
    if (doc) this.setViewport(fitViewport(this.area, doc.size, FIT_MARGIN), true);
  }

  /** Tâm vùng nhìn theo đơn vị thiết kế (nhấp đúp Toolbox thêm widget vào đây). */
  viewCenter(): Pt {
    return toDesign(this.viewport, this.center());
  }

  /** Cuộn để item hiện trong vùng nhìn (chọn từ Lớp, từ lỗi). */
  reveal(id: string): void {
    const it = this.doc?.items.find((x) => x.id === id);
    if (!it) return;
    const v = this.viewport;
    const tl = toScreen(v, { x: it.x, y: it.y });
    const br = toScreen(v, { x: it.x + it.width, y: it.y + it.height });
    const m = 24;
    let dx = 0;
    let dy = 0;
    if (tl.x < m) dx = m - tl.x;
    else if (br.x > this.area.width - m) dx = this.area.width - m - br.x;
    if (tl.y < m) dy = m - tl.y;
    else if (br.y > this.area.height - m) dy = this.area.height - m - br.y;
    if (dx !== 0 || dy !== 0) this.setViewport(panBy(v, dx, dy));
  }

  // ---------- Tọa độ và phím bổ trợ ----------

  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.vp()!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private mods(e: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey?: boolean;
  }): Modifiers {
    return {
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey === true,
      space: this.spaceDown || this.app.screens.tool === 'hand',
    };
  }

  // ---------- Thi hành đầu ra của máy trạng thái ----------

  private run(outs: readonly GestureOutput[]): void {
    const vp = this.vp();
    for (const o of outs) {
      switch (o.kind) {
        case 'select':
          this.app.selectItems(this.screenId, o.ids);
          break;
        case 'preview':
          this.preview = o.doc;
          break;
        case 'cancel':
          this.preview = null;
          break;
        case 'commit': {
          this.preview = null;
          const doc = o.doc;
          this.app.editScreen(this.screenId, () => ({ doc, selection: o.selection }), o.mergeKey);
          break;
        }
        case 'guides':
          this.guides = o.guides;
          break;
        case 'marquee':
          this.marquee = o.rect;
          break;
        case 'cursor':
          if (vp) vp.style.cursor = o.cursor === 'default' ? '' : o.cursor;
          break;
        case 'tooltip':
          this.tip = o.info;
          break;
        case 'viewport':
          this.setViewport(o.viewport);
          break;
        case 'rejected':
          this.app.toast(t('scr.rej.maxItems'));
          break;
      }
    }
  }

  // ---------- Con trỏ ----------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.previewing || !this.gesture) return;
    const vp = this.vp()!;
    if (e.button === 1) e.preventDefault();
    if (document.activeElement !== vp) vp.focus({ preventScroll: true });
    try {
      vp.setPointerCapture(e.pointerId);
    } catch {
      // jsdom hoặc con trỏ đã hết: không cần.
    }
    const screen = this.local(e);
    const handle = (e.target as HTMLElement | null)?.dataset?.h as Handle | undefined;
    this.run(
      this.gesture.handle({
        type: 'down',
        point: toDesign(this.viewport, screen),
        screen,
        mods: this.mods(e),
        button: (e.button === 1 || e.button === 2 ? e.button : 0) as 0 | 1 | 2,
        ...(handle && HANDLES.includes(handle) ? { handle } : {}),
      }),
    );
    this.tipAt = screen;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const screen = this.local(e);
    const point = toDesign(this.viewport, screen);
    this.app.screens.setPointer(point);
    if (this.previewing || !this.gesture) return;
    this.tipAt = screen;
    this.run(this.gesture.handle({ type: 'move', point, screen, mods: this.mods(e) }));
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.previewing || !this.gesture) return;
    const screen = this.local(e);
    this.run(
      this.gesture.handle({
        type: 'up',
        point: toDesign(this.viewport, screen),
        screen,
        mods: this.mods(e),
      }),
    );
    const vp = this.vp();
    try {
      vp?.releasePointerCapture(e.pointerId);
    } catch {
      // đã nhả
    }
  };

  private readonly onPointerCancel = (): void => {
    if (this.gesture) this.run(this.gesture.handle({ type: 'cancel' }));
  };

  private readonly onPointerLeave = (): void => {
    this.app.screens.setPointer(null);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const anchor = this.local(e);
    if (e.ctrlKey || e.metaKey) {
      this.setViewport(zoomWheel(this.viewport, e.deltaY, anchor));
      return;
    }
    // Cuộn: Shift hoặc deltaX đi ngang, còn lại đi dọc.
    const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
    this.setViewport(panBy(this.viewport, -dx, -dy));
  };

  // ---------- Phím (chỉ khi canvas có focus) ----------

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ' && this.spaceDown) this.spaceDown = false;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.target !== this.vp()) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (!this.spaceDown) this.spaceDown = true;
      return;
    }
    // Đang xem trước: Esc về chế độ chỉnh sửa (mockup: "Tắt xem trước (Esc)").
    if (this.previewing && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      void this.app.run('screen.previewOff');
      return;
    }
    const act = resolveCanvasKey(e);
    if (!act || this.previewing) return;
    const app = this.app;
    const sel = app.selectedItems(this.screenId);
    switch (act.kind) {
      case 'command':
        e.preventDefault();
        e.stopPropagation();
        void app.run(act.id);
        return;
      case 'nudge': {
        e.preventDefault();
        e.stopPropagation();
        if (sel.length === 0) return;
        const { dx, dy } = act;
        // Giữ phím mũi tên thì gộp thành một bước hoàn tác.
        app.editScreen(this.screenId, (d) => moveItems(d, sel, dx, dy), `nudge:${sel.join(',')}`);
        return;
      }
      case 'tab': {
        const doc = this.doc;
        if (!doc) return;
        const next = nextByTab(doc.items, sel[0] ?? null, act.reverse);
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        app.selectItems(this.screenId, [next]);
        this.reveal(next);
        return;
      }
      case 'enter': {
        e.preventDefault();
        e.stopPropagation();
        app.hooks.focusInspector?.();
        return;
      }
      case 'escape': {
        if (!this.gesture) return;
        const outs = this.gesture.handle({ type: 'key', key: 'Escape', mods: this.mods(e) });
        if (outs.length) {
          e.preventDefault();
          e.stopPropagation();
          this.run(outs);
        }
        return;
      }
    }
  };

  // ---------- Kéo thả HTML5 (Toolbox, Tag) ----------

  private widgetOf(e: DragEvent): string | null {
    for (const type of e.dataTransfer?.types ?? [])
      if (type.startsWith('application/x-mat-widget-'))
        return type.slice('application/x-mat-widget-'.length);
    return null;
  }

  private hasTag(e: DragEvent): boolean {
    return (e.dataTransfer?.types ?? []).includes('application/x-mat-tag');
  }

  private readonly onDragOver = (e: DragEvent): void => {
    if (this.previewing || !this.gesture) return;
    const screen = this.local(e);
    const point = toDesign(this.viewport, screen);
    const widget = this.widgetOf(e);
    if (widget) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      this.run(this.gesture.handle({ type: 'tool-over', widget, point, mods: this.mods(e) }));
      return;
    }
    if (this.hasTag(e)) {
      const hit = this.doc ? hitTest(this.doc.items, point) : null;
      const it = hit ? this.doc?.items.find((x) => x.id === hit) : undefined;
      if (it && it.type === 'widget') {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
        this.dropItem = it.id;
      } else this.dropItem = null;
    }
  };

  private readonly onDragLeave = (e: DragEvent): void => {
    if (e.relatedTarget && this.contains(e.relatedTarget as Node)) return;
    this.dropItem = null;
    if (this.gesture) this.run(this.gesture.handle({ type: 'tool-leave' }));
  };

  private readonly onDrop = (e: DragEvent): void => {
    if (this.previewing || !this.gesture) return;
    e.preventDefault();
    const screen = this.local(e);
    const point = toDesign(this.viewport, screen);
    const widget = e.dataTransfer?.getData('application/x-mat-widget') || this.widgetOf(e);
    if (widget) {
      this.run(this.gesture.handle({ type: 'tool-drop', widget, point, mods: this.mods(e) }));
      this.vp()?.focus({ preventScroll: true });
      return;
    }
    const tag = e.dataTransfer?.getData('application/x-mat-tag');
    const item = this.dropItem;
    this.dropItem = null;
    if (tag && item)
      this.dispatchEvent(
        new CustomEvent('canvas-tag-drop', {
          detail: { itemId: item, tagId: tag },
          bubbles: true,
        }),
      );
  };

  // ---------- Nguồn giá trị cho mat-screen ----------

  /** Nguồn của chế độ chỉnh sửa: chỉ có thông tin Tag (đơn vị, bảng) để widget vẽ đúng, không có giá trị. */
  private editSource(): MemoryTagSource {
    const tags = this.app.store.state.outline.tags?.tags;
    if (tags !== this.editTags) {
      this.editTags = tags;
      this.edit = new MemoryTagSource({
        tags: ((tags ?? []) as unknown as Parameters<typeof hostTagInfo>[0][]).flatMap(
          (tg): HostTagInfo[] => {
            const i = hostTagInfo(tg);
            return i ? [i] : [];
          },
        ),
      });
    }
    return this.edit;
  }

  private readonly loadSvg = async (path: string): Promise<string> => {
    const d = this.app.store.state.docs[path];
    if (!d) throw new Error(`missing ${path}`);
    return d.diskText;
  };

  private readonly loadBindings = async (path: string) => {
    const v = this.app.store.state.docs[path]?.value as { elements?: unknown } | null | undefined;
    return Array.isArray(v?.elements) ? (v.elements as never) : [];
  };

  private readonly onTags = (e: Event): void => {
    const ids = (e as CustomEvent<{ ids: string[] }>).detail.ids;
    const key = ids.join('|');
    if (key === this.lastTagsKey) return;
    this.lastTagsKey = key;
    this.app.screens.declareTags(ids);
  };

  // ---------- Vẽ ----------

  private selectionBoxes(
    doc: ScreenModel,
    sel: readonly string[],
  ): TemplateResult | typeof nothing {
    const chosen = doc.items.filter((i) => sel.includes(i.id));
    if (!chosen.length) return nothing;
    const group = chosen.length > 1;
    const bounds = boundsOf(chosen);
    const box = group ? bounds : chosen[0]!;
    const locked = !group && chosen[0]!.locked === true;
    return html`${
        group
          ? chosen.map(
              (it) =>
                html`<div
                  class="selbox multi ${it.locked ? 'lk' : ''}"
                  style=${styleMap(rectStyle(it))}
                ></div>`,
            )
          : nothing
      }
      <div
        class="selbox ${group ? 'grp' : ''} ${locked ? 'lk' : ''}"
        data-sel="box"
        style=${styleMap(rectStyle(box))}
      >
        <span class="nm"
          >${group ? t('scr.sel.count', { n: chosen.length }) : itemName(chosen[0]!)}</span
        >
        ${
          locked || this.previewing
            ? nothing
            : HANDLES.map(
                (h) =>
                  html`<i
                    data-h=${h}
                    style=${styleMap({ left: HANDLE_POS[h][0], top: HANDLE_POS[h][1] })}
                  ></i>`,
              )
        }
      </div>`;
  }

  private tooltip(): TemplateResult | typeof nothing {
    const tip = this.tip;
    if (!tip) return nothing;
    const text =
      tip.kind === 'move'
        ? t('scr.tip.move', { x: Math.round(tip.x), y: Math.round(tip.y) })
        : t('scr.tip.size', { w: Math.round(tip.width), h: Math.round(tip.height) });
    return html`<div
      class="tip"
      role="presentation"
      style=${styleMap({ left: `${this.tipAt.x + 14}px`, top: `${this.tipAt.y + 16}px` })}
    >
      ${text}
    </div>`;
  }

  private editOverlay(doc: ScreenModel, committed: ScreenModel): TemplateResult {
    const sel = this.app.selectedItems(this.screenId);
    const { byItem } = groupByItem(
      screenIssues(this.app.store.state.issues, this.screenId),
      committed,
    );
    const k = 1 / this.viewport.zoom;
    const active = sel[0] ? `oi-${this.screenId}-${sel[0]}` : null;
    void active;
    return html`<div class="ov" style=${styleMap({ '--k': String(k) })}>
      ${committed.items.map((it) => {
        const sev = severityOfItem(byItem.get(it.id));
        const selected = sel.includes(it.id);
        return html`<div
          class="oi ${sev ? `iss ${sev}` : ''} ${it.hidden ? 'hid' : ''} ${this.dropItem === it.id ? 'dropt' : ''}"
          role="option"
          id="oi-${this.screenId}-${it.id}"
          aria-selected=${selected ? 'true' : 'false'}
          aria-label=${itemName(it)}
          data-item=${it.id}
          style=${styleMap(rectStyle(it))}
        ></div>`;
      })}
      ${this.selectionBoxes(doc, sel)}
      ${this.guides.map(
        (g) =>
          html`<div
            class="guide ${g.axis === 'x' ? 'v' : 'h'}"
            style=${styleMap(
              g.axis === 'x'
                ? { left: `${g.pos}px`, height: `${doc.size.height}px` }
                : { top: `${g.pos}px`, width: `${doc.size.width}px` },
            )}
          ></div>`,
      )}
      ${this.marquee ? html`<div class="marquee" style=${styleMap(rectStyle(this.marquee))}></div>` : nothing}
    </div>`;
  }

  private screenView(doc: ScreenModel, edit: boolean): TemplateResult {
    const hosts = this.app.screens.previewHosts();
    const nav = this.app.screens.previewNav;
    const popup = !edit && nav.popup ? this.app.screenModel(nav.popup) : null;
    const source = edit || !hosts ? this.editSource() : hosts.source;
    const host = edit || !hosts ? NO_HOST : hosts.host;
    return html`<mat-screen
      .screen=${doc}
      .popup=${popup}
      .tags=${source}
      .host=${host}
      .history=${edit ? undefined : historyFor(this.app, this.app.screens.previewMode)}
      .mode=${edit ? 'edit' : 'run'}
      .viewport=${doc.size}
      .loadSvg=${this.loadSvg}
      .loadBindings=${this.loadBindings}
      @mat-tags=${this.onTags}
    ></mat-screen>`;
  }

  protected override render() {
    const committed = this.doc;
    const shown = this.shown;
    if (!committed || !shown) {
      return html`<div class="cv-empty" role="status">
        ${t('preview.noScreen', { id: this.screenId })}
      </div>`;
    }
    const v = this.viewport;
    const edit = !this.previewing;
    const grid = this.app.screens.grid && this.app.screens.gridSize * v.zoom >= 6;
    const gs = this.app.screens.gridSize;
    const worldStyle = {
      width: `${shown.size.width}px`,
      height: `${shown.size.height}px`,
      transform: `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`,
      '--k': String(1 / v.zoom),
    };
    const options = edit && committed.items.length > 0;
    return html`<div class="cv">
      <div class="ruler-corner" aria-hidden="true"></div>
      <mat-ruler axis="x" .zoom=${v.zoom} .pan=${v.panX} .length=${this.area.width}></mat-ruler>
      <mat-ruler axis="y" .zoom=${v.zoom} .pan=${v.panY} .length=${this.area.height}></mat-ruler>
      <div
        class="vp ${this.spaceDown || this.app.screens.tool === 'hand' ? 'pan' : ''} ${edit ? 'editing' : `previewing ${this.app.screens.previewMode}`}"
        tabindex="0"
        role=${options ? 'listbox' : 'group'}
        aria-multiselectable=${options ? 'true' : nothing}
        aria-roledescription=${t('scr.canvas.roleDesc')}
        aria-label=${t('scr.canvas.label', {
          name: committed.name,
          w: committed.size.width,
          h: committed.size.height,
        })}
        aria-activedescendant=${
          options && this.app.selectedItems(this.screenId)[0]
            ? `oi-${this.screenId}-${this.app.selectedItems(this.screenId)[0]}`
            : nothing
        }
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerUp}
        @pointercancel=${this.onPointerCancel}
        @pointerleave=${this.onPointerLeave}
        @keydown=${this.onKeyDown}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <div class="world" style=${styleMap(worldStyle)}>
          <div
            class="board ${edit ? 'edit' : ''}"
            ?inert=${edit}
            aria-hidden=${edit ? 'true' : nothing}
            style=${styleMap({ '--g': `${gs}px`, '--g5': `${gs * 5}px` })}
          >
            ${
              grid && edit
                ? html`<div class="g1" aria-hidden="true"></div>
                    <div class="g2" aria-hidden="true"></div>`
                : nothing
            }
            ${this.screenView(shown, edit)}
          </div>
          ${edit ? this.editOverlay(shown, committed) : nothing}
        </div>
        ${this.tooltip()}
      </div>
    </div>`;
  }
}

const NO_HOST = {
  session: () => null,
  writeBlocked: () => null,
  write: () => Promise.resolve({ status: 'REJECTED' as const }),
  navigate: () => undefined,
  openPopup: () => undefined,
  closePopup: () => undefined,
  requestLogin: () => undefined,
};

function emptyScreen(): ScreenModel {
  return {
    schemaVersion: '0.3.0',
    id: '',
    name: '',
    kind: 'screen',
    size: { width: 1, height: 1 },
    items: [],
  };
}

// Giữ tham chiếu để bundler không loại thành phần `mat-screen` (đăng ký bằng side effect của gói ui-components).
void MatScreen;
void zoomAt;

customElements.define('mat-screen-canvas', MatScreenCanvas);

declare global {
  interface HTMLElementTagNameMap {
    'mat-screen-canvas': MatScreenCanvas;
  }
}
