// Canvas của editor Màn hình 0.3 (feature 007, T111, FR-058, FR-059, FR-071; ADR-022 điểm 1 và 2; mockup studio-screens cảnh 1).
// `<mat-screen mode="edit">` của @mat/ui-components vẽ item ở tỉ lệ 1:1 trong một "thế giới" CSS (`translate` + `scale` theo zoom
// và pan); lớp phủ nằm cùng thế giới nên khung chọn, tay nắm, đường gióng, viền lỗi theo đơn vị thiết kế (`--k` = 1 / zoom giữ
// nét mảnh). Pointer Events đổi sang tọa độ thiết kế rồi đưa vào máy trạng thái thuần `gesture.ts`; canvas chỉ thi hành đầu ra
// của máy (chọn, xem trước tạm, ghi một bước hoàn tác, đường gióng, khung chọn, chú giải). ARIA: vùng nhìn là `listbox` đa chọn,
// mỗi item một `option` (aria-selected); bản vẽ bên dưới `inert` vì đã có các option thay thế.
import type { ValueTable } from '@mat/expression';
import type { Item, ScreenModel } from '@mat/project-schema';
import { MatScreen, MemoryTagSource, type TagInfo as HostTagInfo } from '@mat/ui-components';
import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import {
  acceptSuggestion,
  bindRow,
  bindingSetOf,
  itemRef,
  itemTagIds,
  kindOfUid,
  suggestionsFor,
} from '../../app/svg-bind.ts';
import { t } from '../../i18n/index.ts';
import { ANIMATION_ROWS, rowBlock, transformsFor } from '../../model/animation-catalog.ts';
import { EditTestSource } from '../../model/edit-source.ts';
import { hostTagInfo } from '../../model/preview-hosts.ts';
import { findByUid, nameOfElement } from '../../model/svg-dom.ts';
import { applyPick, uidsAtPoint } from '../../model/svg-select.ts';
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
import './mat-svg-overlay.ts';
import './screen-canvas.css';

const ZOOM_COMMANDS: ReadonlySet<string> = new Set([
  'screen.zoomIn',
  'screen.zoomOut',
  'screen.zoomFit',
  'screen.zoom100',
]);

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
    hoverUid: { state: true },
    dropUid: { state: true },
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
  /** Phần tử SVG đang rê chuột và phần tử đang được rê Tag lên (item đang vào, feature 008). */
  declare hoverUid: string | null;
  declare dropUid: string | null;

  private gesture: Gesture | null = null;
  private ro: ResizeObserver | null = null;
  private edit = new MemoryTagSource();
  private editTags: unknown = null;
  private lastTagsKey = '';
  /** Nguồn của chế độ chỉnh sửa: thông tin Tag, và giá trị chỉ cho Tag đang Thử giá trị (feature 008). */
  private testSource: EditTestSource | null = null;
  /** Vị trí client của lần nhấn gần nhất (hit-test phần tử SVG cho đầu ra `pick` của máy trạng thái). */
  private lastClient: Pt = { x: 0, y: 0 };
  private hoverFrame = 0;
  private readyKey = '';
  private inertSet = false;
  private viewDocCache: { doc: ScreenModel; sig: string; out: ScreenModel } | null = null;
  private readonly bindRevs = new Map<string, { value: unknown; n: number }>();

  constructor() {
    super();
    this.hoverUid = null;
    this.dropUid = null;
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
      getEntered: () => this.entered,
    });
    this.app.screens.svgRootProvider = (screen, itemId) =>
      screen === this.screenId ? this.itemRoot(itemId) : null;
  }

  protected override detached(): void {
    this.gesture = null;
    // Đóng editor: khôi phục giá trị đã Thử và thoát item (contract §7).
    if (this.entered !== null) this.app.screens.exitSvgItem();
    this.app.screens.svgRootProvider = null;
  }

  // ---------- Vào item svg (feature 008) ----------

  /** Item `svg` đang vào ở màn hình này. */
  private get entered(): string | null {
    return this.app.screens.enteredItemId(this.screenId);
  }

  /** Gốc Shadow DOM của item `svg` `itemId` (cây phần tử đã lọc, có `data-mat-uid`); `null` khi chưa dựng. */
  private itemRoot(itemId: string): ShadowRoot | null {
    const ms = this.querySelector('mat-screen');
    const wrappers = ms?.shadowRoot?.querySelectorAll<HTMLElement>('.item');
    if (!wrappers) return null;
    for (const w of wrappers)
      if (w.dataset.itemId === itemId)
        return w.querySelector<HTMLElement>('.svg-host')?.shadowRoot ?? null;
    return null;
  }

  /**
   * Ở chế độ chỉnh sửa item bị `pointer-events: none` nên hit-test không thấy phần tử SVG: trong Shadow DOM của item đang
   * vào, cho phần tử nhận con trỏ (kể cả hình `fill="none"`). Dùng stylesheet dựng sẵn, không sửa DOM của SVG.
   */
  private static readonly hitRoots = new WeakSet<ShadowRoot>();
  private ensureHit(root: ShadowRoot): void {
    if (MatScreenCanvas.hitRoots.has(root)) return;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('svg *{pointer-events:all}');
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      MatScreenCanvas.hitRoots.add(root);
    } catch {
      // Môi trường không có stylesheet dựng sẵn (jsdom): hit-test dùng bản dự phòng của trình duyệt.
    }
  }

  /** Item khác không nhận con trỏ và không focus được khi đang vào một item (thay cho `inert` cả vùng vẽ). */
  private syncInert(): void {
    const entered = this.entered;
    // Không vào item thì không đụng DOM của mat-screen (kéo 100 item chạy mỗi khung hình): chỉ trả lại một lần sau khi thoát.
    if (entered === null && !this.inertSet) return;
    const wrappers =
      this.querySelector('mat-screen')?.shadowRoot?.querySelectorAll<HTMLElement>('.item');
    if (!wrappers) return;
    for (const w of wrappers) w.inert = entered !== null && w.dataset.itemId !== entered;
    this.inertSet = entered !== null;
    if (entered !== null) {
      const root = this.itemRoot(entered);
      if (root) this.ensureHit(root);
    }
  }

  /**
   * UID của các phần tử SVG dưới điểm client, trên cùng trước. Hình con không có UID quy về tổ tiên gần nhất có UID (nhóm có
   * UID mà hình con không có vẫn chọn được); mỗi UID một lần.
   */
  private hitUids(x: number, y: number): string[] {
    const id = this.entered;
    const root = id === null ? null : this.itemRoot(id);
    if (root === null) return [];
    this.ensureHit(root);
    const near: Element[] = [];
    for (const el of root.elementsFromPoint(x, y)) {
      const owner = el.closest('[data-mat-uid]');
      if (owner !== null) near.push(owner);
    }
    return uidsAtPoint(near);
  }

  private pickAt(x: number, y: number, mods: { shift: boolean; alt: boolean }): void {
    const sel = this.app.screens.selectedUids;
    const hit = this.hitUids(x, y);
    let uid: string | null = hit[0] ?? null;
    if (mods.alt) {
      // Alt+nhấp: phần tử cha có UID của phần tử đang chọn nếu nó nằm dưới con trỏ (nhấp liên tiếp đi lên dần), không thì cha
      // của phần tử trên cùng. Danh sách `elementsFromPoint` là thứ tự xếp lớp chứ không phải cây cha con nên không dùng trực tiếp.
      const cur = sel.at(-1);
      const base = cur !== undefined && hit.includes(cur) ? cur : uid;
      uid = base === null ? null : (this.parentUid(base) ?? base);
    }
    this.app.screens.pickUids(applyPick(sel, uid, mods));
  }

  /** UID của tổ tiên gần nhất có UID của phần tử `uid`; `null` khi là phần tử cấp trên cùng. */
  private parentUid(uid: string): string | null {
    const id = this.entered;
    const root = id === null ? null : this.itemRoot(id);
    if (root === null) return null;
    let el = findByUid(root, uid)?.parentElement ?? null;
    while (el !== null && !el.hasAttribute('data-mat-uid')) el = el.parentElement;
    return el?.getAttribute('data-mat-uid') ?? null;
  }

  private selectParent(): void {
    const cur = this.app.screens.selectedUids.at(-1);
    const parent = cur === undefined ? null : this.parentUid(cur);
    if (parent !== null) this.app.screens.pickUids([parent]);
  }

  private readonly onDblClick = (e: MouseEvent): void => {
    if (this.previewing || !this.gesture) return;
    const screen = this.local(e);
    this.run(
      this.gesture.handle({
        type: 'dblclick',
        point: toDesign(this.viewport, screen),
        mods: this.mods(e),
      }),
    );
  };

  private readonly onHover = (e: PointerEvent): void => {
    if (this.entered === null || this.previewing) {
      if (this.hoverUid !== null) this.hoverUid = null;
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    if (this.hoverFrame !== 0) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const uid = this.hitUids(x, y)[0] ?? null;
      if (uid !== this.hoverUid) this.hoverUid = uid;
    });
  };

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
    this.syncEntered(sel);
  }

  /** Giữ trạng thái "vào item" khớp với vùng chọn, khóa các item khác, cho thanh Thử giá trị biết Tag của item. */
  private syncEntered(sel: readonly string[]): void {
    const app = this.app;
    // Chọn Tag ở Details (vùng chọn không còn là item) không thoát item; chọn item khác hoặc xóa item thì thoát.
    if (app.screens.enteredItemId(this.screenId) !== null) {
      const kind = app.store.state.selection?.kind;
      if (kind === 'items' || kind === undefined) app.screens.syncSvgSelection(sel);
      if (itemRef(app, this.screenId, this.entered ?? '') === null) app.screens.exitSvgItem();
    }
    const entered = this.entered;
    this.syncInert();
    if (entered === null) {
      this.readyKey = '';
      if (this.hoverUid !== null) this.hoverUid = null;
      return;
    }
    const ref = itemRef(app, this.screenId, entered);
    if (ref === null) return;
    app.screens.allowTest(entered, itemTagIds(bindingSetOf(app, ref)));
    // Báo DOM của item đã dựng (lần đầu, hoặc dựng lại sau khi binding đổi) để cây phần tử và khung chọn đọc lại.
    const key = `${entered}|${this.bindRev(ref.file)}|${app.screens.testEpoch}`;
    if (key === this.readyKey) return;
    this.readyKey = key;
    const ms = this.querySelector<MatScreen>('mat-screen');
    void ms?.whenReady().then(() => {
      if (this.readyKey === key && this.isConnected) {
        this.syncInert();
        app.screens.bumpSvg();
      }
    });
  }

  /** Số thứ tự bản của file binding: đổi khi nội dung đổi (item dựng lại để áp binding mới). */
  private bindRev(file: string): number {
    const v = this.app.store.state.docs[file]?.value;
    const cur = this.bindRevs.get(file);
    if (cur !== undefined && cur.value === v) return cur.n;
    const n = (cur?.n ?? 0) + 1;
    this.bindRevs.set(file, { value: v, n });
    return n;
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
          if (vp)
            vp.style.cursor =
              o.cursor === 'default' ? (this.entered !== null ? 'crosshair' : '') : o.cursor;
          break;
        case 'enter':
          this.app.screens.enterSvgItem(this.screenId, o.itemId);
          // 13 dòng Gắn Tag cần chỗ: nới inspector khi đang quá thấp (người dùng vẫn kéo thanh chia để đổi lại).
          if (this.app.workspace.inspectorHeight < 300)
            this.app.setLayout(
              { inspectorHeight: 340 },
              {
                leftColumnHeight: 0,
                centerHeight: this.closest<HTMLElement>('.center')?.clientHeight ?? 0,
              },
            );
          this.app.requestRender();
          break;
        case 'exit':
          this.app.screens.exitSvgItem();
          if (vp) vp.style.cursor = '';
          this.app.requestRender();
          break;
        case 'pick':
          this.pickAt(this.lastClient.x, this.lastClient.y, o.mods);
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
    this.lastClient = { x: e.clientX, y: e.clientY };
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
    this.onHover(e);
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
    // Đang vào item svg: Alt+↑ chọn phần tử cha (contract §2).
    if (this.entered !== null && !this.previewing && e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      this.selectParent();
      return;
    }
    const act = resolveCanvasKey(e);
    if (!act || this.previewing) return;
    const app = this.app;
    const sel = app.selectedItems(this.screenId);
    // Đang vào item: phím sửa item (mũi tên, Delete, Tab, sao chép...) không áp cho cả item; chỉ Enter, Esc và thu phóng.
    if (
      this.entered !== null &&
      act.kind !== 'escape' &&
      act.kind !== 'enter' &&
      !(act.kind === 'command' && ZOOM_COMMANDS.has(act.id))
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
        // Một item `svg` đang chọn: Enter vào đồ họa (máy trạng thái quyết định); còn lại đưa focus tới inspector.
        const outs =
          this.entered === null && this.gesture
            ? this.gesture.handle({ type: 'key', key: 'Enter', mods: this.mods(e) })
            : [];
        if (outs.length > 0) this.run(outs);
        else app.hooks.focusInspector?.();
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
    if (this.hasTag(e) && this.entered !== null) {
      // Đang vào item svg: thả Tag lên phần tử SVG (ô thả là phần tử có UID dưới con trỏ).
      const uid = this.hitUids(e.clientX, e.clientY)[0] ?? null;
      if (uid !== null) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'link';
      }
      if (uid !== this.dropUid) this.dropUid = uid;
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

  /**
   * Thả Tag lên phần tử SVG: mục theo Gợi ý nếu có, không thì mục đầu tiên hợp loại phần tử và kiểu Tag. Từ chối thì báo lý do
   * (không có mục nào hợp là sai kiểu: không gắn gì).
   */
  private dropTagOnElement(uid: string, tagId: string): void {
    const app = this.app;
    const entered = this.entered;
    const ref = entered === null ? null : itemRef(app, this.screenId, entered);
    const info = app.screens.tagInfos().get(tagId);
    if (ref === null) return;
    if (info === undefined) {
      app.toast(t('svg.reject.unknown-tag'));
      return;
    }
    const root = this.itemRoot(ref.item);
    const el = root === null ? null : findByUid(root, uid);
    const name = el === null ? uid : nameOfElement(el) || el.localName;
    app.screens.pickUids([uid]);
    const sug = suggestionsFor(app, ref, uid, name, tagId)[0];
    let done = false;
    if (sug !== undefined) done = acceptSuggestion(app, ref, [uid], sug);
    else {
      const kind = kindOfUid(app, ref, uid);
      const row = ANIMATION_ROWS.find(
        (r) => rowBlock(r, kind, info) === null && transformsFor(r, info).length > 0,
      );
      if (row === undefined) app.toast(t('svg.reject.tag-type'));
      else done = bindRow(app, ref, [uid], row.id, tagId).ok;
    }
    if (done) app.toast(t('svg.drop.done', { tag: tagId, name }));
    app.screens.svgTab = 'bind';
    app.requestRender();
  }

  private readonly onDragLeave = (e: DragEvent): void => {
    if (e.relatedTarget && this.contains(e.relatedTarget as Node)) return;
    this.dropItem = null;
    this.dropUid = null;
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
    if (this.entered !== null) {
      const uid = this.dropUid;
      this.dropUid = null;
      if (tag && uid) this.dropTagOnElement(uid, tag);
      return;
    }
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

  /** Nguồn chỉnh sửa có giá trị cho Tag đang Thử giá trị (một đối tượng ổn định: item đã dựng giữ nguồn lúc tạo). */
  private editTestSource(): EditTestSource {
    return (this.testSource ??= new EditTestSource({
      base: () => this.editSource(),
      engine: this.app.simulation.engine,
      active: () => this.app.screens.testActive,
      tables: () =>
        this.app.store.state.outline.valueTables.flatMap((v) =>
          v.doc ? [v.doc as unknown as ValueTable] : [],
        ),
    }));
  }

  private readonly loadSvg = async (path: string): Promise<string> => {
    const d = this.app.store.state.docs[path];
    if (!d) throw new Error(`missing ${path}`);
    return d.diskText;
  };

  /** Đường dẫn có hậu tố `#<bản>` (xem `viewDoc`) về tên file thật. */
  private readonly loadBindings = async (path: string) => {
    const file = path.split('#')[0]!;
    const v = this.app.store.state.docs[file]?.value as { elements?: unknown } | null | undefined;
    return Array.isArray(v?.elements) ? (v.elements as never) : [];
  };

  /**
   * Màn hình đưa cho `<mat-screen>`: mỗi item `svg` mang `bindingFile#<bản>`. Item chỉ dựng lại khi khóa của nó đổi, nên nội
   * dung binding đổi (gắn Tag, hoàn tác) phải đổi khóa để canvas thấy hiệu ứng ngay. Giữ nguyên đối tượng khi không đổi.
   */
  private viewDoc(doc: ScreenModel): ScreenModel {
    if (!doc.items.some((i) => i.type === 'svg')) return doc;
    // Item `svg` giữ nguồn giá trị lúc dựng: đổi chế độ xem trước cũng phải dựng lại (nguồn Mô phỏng, Thiết bị khác nguồn edit).
    const mode = this.previewing ? this.app.screens.previewMode : 'edit';
    const tag = (file: string): string =>
      `${this.bindRev(file)}.${mode}.${this.app.screens.testEpoch}`;
    const sig = doc.items.map((i) => (i.type === 'svg' ? tag(i.bindingFile) : '')).join(',');
    const c = this.viewDocCache;
    if (c !== null && c.doc === doc && c.sig === sig) return c.out;
    const out: ScreenModel = {
      ...doc,
      items: doc.items.map((i) =>
        i.type === 'svg' ? { ...i, bindingFile: `${i.bindingFile}#${tag(i.bindingFile)}` } : i,
      ),
    };
    this.viewDocCache = { doc, sig, out };
    return out;
  }

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
    const entered = this.entered;
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
      ${
        entered !== null
          ? html`<mat-svg-overlay
              .app=${this.app}
              .screenId=${this.screenId}
              .itemId=${entered}
              .viewport=${this.viewport}
              .hoverUid=${this.hoverUid}
              .dropUid=${this.dropUid}
              .rev=${this.app.screens.svgRevision}
            ></mat-svg-overlay>`
          : this.selectionBoxes(doc, sel)
      }
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
    const source = edit || !hosts ? this.editTestSource() : hosts.source;
    const host = edit || !hosts ? NO_HOST : hosts.host;
    return html`<mat-screen
      .screen=${this.viewDoc(doc)}
      .popup=${popup}
      .tags=${source}
      .host=${host}
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
        class="vp ${this.spaceDown || this.app.screens.tool === 'hand' ? 'pan' : ''} ${edit ? 'editing' : `previewing ${this.app.screens.previewMode}`} ${this.entered !== null && edit ? 'entered' : ''}"
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
        @dblclick=${this.onDblClick}
        @keydown=${this.onKeyDown}
        @dragover=${this.onDragOver}
        @dragleave=${this.onDragLeave}
        @drop=${this.onDrop}
      >
        <div class="world" style=${styleMap(worldStyle)}>
          <div
            class="board ${edit ? 'edit' : ''}"
            ?inert=${edit && this.entered === null}
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
