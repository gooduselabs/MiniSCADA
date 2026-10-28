// Nền chung của mọi widget `mat-w-*` (contracts/ui-components-api.md §4): thuộc tính JS item/source/host/mode/context,
// đăng ký và hủy TagSource.subscribe theo vòng đời, hạn chế vẽ khi tab ẩn, quality theo `qualityView`.
// Widget không giữ giá trị riêng: render là hàm của (item, TagState, trạng thái điều khiển).
import {
  LitElement,
  html,
  nothing,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit';
import type { WidgetItem } from '@mat/project-schema';
import { safeColor } from '../format/color.ts';
import { formatValue, numberOf } from '../format/format-value.ts';
import { qualityView, type QualityView } from '../format/quality.ts';
import type { ActionHost, TagInfo, TagSource } from '../host/types.ts';
import { itemTagIds } from '../screen/layers.ts';
import { installTokens } from '../styles/tokens.ts';
import { widgetStyles } from '../styles/widget-styles.ts';
import { motionOn, onMotionChange, watchVisible } from './motion.ts';

type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T;

export type WidgetMode = 'run' | 'edit';
export interface WidgetContext {
  screen: string;
  widget: string;
}

const INTEGER_TYPES = new Set(['INT16', 'UINT16', 'INT32', 'UINT32', 'INT64', 'UINT64']);

export { safeColor };

export class MatWidget extends LitElement {
  static override properties = {
    item: { attribute: false },
    source: { attribute: false },
    host: { attribute: false },
    mode: { reflect: true },
    context: { attribute: false },
  };
  static override styles: CSSResultGroup = [widgetStyles];

  declare item: WidgetItem;
  declare source: TagSource;
  declare host: ActionHost;
  declare mode: WidgetMode;
  declare context: WidgetContext;

  #unsub: (() => void) | null = null;
  #subKey = '';
  #subSource: TagSource | null = null;
  #dirtyHidden = false;
  #visHandler: (() => void) | null = null;
  #inView = true;
  #offVis: (() => void) | null = null;
  #offMotion: (() => void) | null = null;

  constructor() {
    super();
    this.mode = 'run';
  }

  /** Widget được phép tác động ra ngoài (ghi, điều hướng): chế độ run và có host. */
  protected get canAct(): boolean {
    return this.mode !== 'edit' && !!this.host;
  }

  /** Tập Tag cần đăng ký: mọi khe của item. Widget không Tag (panel) trả rỗng. */
  tagIds(): string[] {
    return this.item ? itemTagIds(this.item) : [];
  }

  protected tagOf(slot: string): string | undefined {
    const v = this.item?.tags?.[slot];
    return typeof v === 'string' ? v : undefined;
  }

  protected tagsOf(slot: string): string[] {
    const v = this.item?.tags?.[slot];
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : typeof v === 'string'
        ? [v]
        : [];
  }

  /** Thuộc tính tĩnh theo kiểu của giá trị mặc định (sai kiểu hoặc vắng: dùng mặc định). */
  protected prop<T extends string | number | boolean>(name: string, fallback: T): Widen<T> {
    const v = this.item?.props?.[name];
    return typeof v === typeof fallback && (typeof v !== 'number' || Number.isFinite(v))
      ? (v as Widen<T>)
      : (fallback as Widen<T>);
  }

  /** Số lẻ: thuộc tính `decimals` nếu có, vắng thì 0 cho kiểu nguyên và 1 cho kiểu thực (mặc định của danh mục). */
  /** Màu do project đặt (`#rrggbb` …); `auto`, rỗng hoặc không an toàn thì undefined (feature 029). */
  protected colorProp(name: string): string | undefined {
    return safeColor(this.item?.props?.[name]);
  }

  /**
   * Feature 029: nhấp nháy theo ngưỡng. Số `v` > `blinkAbove` hoặc < `blinkBelow` (prop tùy chọn) thì nhấp nháy;
   * chất lượng xấu không nhấp nháy (đã có dấu chất lượng riêng).
   */
  protected blinking(v: unknown, quality?: string): boolean {
    if (quality && quality !== 'GOOD' && quality !== 'UNCERTAIN') return false;
    const n = numberOf(v as Parameters<typeof numberOf>[0]);
    if (v === null || v === undefined || Number.isNaN(n)) return false;
    const hi = this.item?.props?.['blinkAbove'];
    const lo = this.item?.props?.['blinkBelow'];
    return (typeof hi === 'number' && n > hi) || (typeof lo === 'number' && n < lo);
  }

  /**
   * Feature 029: dòng trạng thái thứ hai từ khe `status` (tùy chọn), hiện qua bảng giá trị của Tag (vd. Chạy/Dừng/Lỗi) kèm
   * màu của bảng. Không gắn thì `nothing`.
   */
  protected statusLine(): TemplateResult | typeof nothing {
    const id = this.tagOf('status');
    if (!id || !this.source) return nothing;
    const info = this.source.info(id);
    const table = info?.valueTable ? this.source.valueTable(info.valueTable) : undefined;
    const f = formatValue(this.source.get(id), info, { decimals: 0, ...(table ? { table } : {}) });
    const color = safeColor(f.color);
    return html`<div
      class="status2 ellipsis"
      data-slot="status"
      style=${color ? `color:${color}` : nothing}
    >
      ${f.text}${f.unit ? ` ${f.unit}` : ''}
    </div>`;
  }

  protected decimals(info: TagInfo | undefined, name = 'decimals'): number {
    const v = this.item?.props?.[name];
    if (typeof v === 'number' && Number.isInteger(v)) return Math.max(0, Math.min(6, v));
    return info && INTEGER_TYPES.has(info.type) ? 0 : 1;
  }

  /** Nhãn truy cập: thuộc tính `label` hoặc mô tả Tag hoặc id Tag (luôn là chuỗi, Lit sẽ thoát). */
  protected nameOf(tagId: string | undefined, labelProp = 'label'): string {
    const label = this.prop(labelProp, '');
    if (label) return label;
    if (!tagId) return '';
    return this.source?.info(tagId)?.description || tagId;
  }

  protected qv(tagId: string | undefined): QualityView {
    return qualityView(
      tagId ? this.source.get(tagId) : { value: null, quality: 'GOOD' },
      this.mode,
    );
  }

  /** Nhãn quality ở góc widget: chữ hoặc biểu tượng (không chỉ màu). */
  protected badge(qv: QualityView): TemplateResult | typeof nothing {
    return qv.badge
      ? html`<span class="badge ${qv.cls}" title=${qv.tooltip} part="badge">${qv.badge}</span>`
      : nothing;
  }

  /** Tiêu đề khung (feature 014): thuộc tính `title`, rỗng là không có thanh tiêu đề. */
  protected titleText(): string {
    return this.prop('title', '');
  }

  /** Thanh tiêu đề của khung (chữ thuần, Lit thoát); không có tiêu đề thì không vẽ. */
  protected head(): TemplateResult | typeof nothing {
    const t = this.titleText();
    return t ? html`<div class="head" part="head">${t}</div>` : nothing;
  }

  // ---- vòng đời ----------------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    installTokens(this.ownerDocument);
    this.#sync();
    this.#offVis = watchVisible(this, (v) => {
      this.#inView = v;
      this.#syncStill();
    });
    this.#offMotion = onMotionChange(this.ownerDocument, () => this.#syncStill());
    this.#syncStill();
  }

  /**
   * Feature 037: thuộc tính `still` (tắt mọi hoạt ảnh CSS bên trong) khi đang thiết kế, ngoài vùng nhìn, hoặc project tắt
   * chuyển động. Widget vẫn đặt lớp spin/wave/blink theo dữ liệu; CSS chung quyết định có chạy không.
   */
  #syncStill(): void {
    const still = this.mode === 'edit' || !this.#inView || !motionOn(this.ownerDocument);
    this.toggleAttribute('still', still);
  }

  override disconnectedCallback(): void {
    this.#offVis?.();
    this.#offMotion?.();
    this.#offVis = this.#offMotion = null;
    this.#unsubscribe();
    this.#clearVis();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('item') || changed.has('source')) this.#sync();
    if (changed.has('mode')) this.#syncStill();
  }

  #unsubscribe(): void {
    this.#unsub?.();
    this.#unsub = null;
    this.#subKey = '';
    this.#subSource = null;
  }

  #sync(): void {
    if (!this.isConnected || !this.source || !this.item) return;
    const ids = this.tagIds();
    const key = ids.join('\u0000');
    if (this.#unsub && this.#subSource === this.source && this.#subKey === key) return;
    this.#unsubscribe();
    if (ids.length === 0) return;
    this.#subSource = this.source;
    this.#subKey = key;
    this.#unsub = this.source.subscribe(ids, () => this.#safeChange());
  }

  /**
   * Người nghe của nguồn Tag không bao giờ ném (T041, FR-026, D32): nguồn gọi người nghe tuần tự, một widget lỗi không
   * được làm các widget sau mất cập nhật. Lỗi ghi console kèm id widget.
   */
  #safeChange(): void {
    try {
      this.#onChange();
    } catch (e) {
      console.error('mat-widget: lỗi khi cập nhật', this.item?.id ?? this.localName, e);
    }
  }

  #onChange(): void {
    if (this.ownerDocument.hidden) {
      // Tab ẩn (FR-019): không vẽ; hiện lại thì vẽ một lần với giá trị cuối.
      this.#dirtyHidden = true;
      if (!this.#visHandler) {
        this.#visHandler = () => {
          if (this.ownerDocument.hidden) return;
          this.#clearVis();
          if (this.#dirtyHidden) {
            this.#dirtyHidden = false;
            this.requestUpdate();
          }
        };
        this.ownerDocument.addEventListener('visibilitychange', this.#visHandler);
      }
      return;
    }
    this.requestUpdate();
  }

  #clearVis(): void {
    if (this.#visHandler)
      this.ownerDocument.removeEventListener('visibilitychange', this.#visHandler);
    this.#visHandler = null;
  }

  protected override render(): TemplateResult | typeof nothing {
    return this.item && this.source ? this.renderWidget() : nothing;
  }

  /** Lớp con vẽ nội dung. */
  protected renderWidget(): TemplateResult | typeof nothing {
    return nothing;
  }
}
