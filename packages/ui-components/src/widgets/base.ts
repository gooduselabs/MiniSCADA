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
import { qualityView, type QualityView } from '../format/quality.ts';
import type { ActionHost, TagInfo, TagSource } from '../host/types.ts';
import { itemTagIds } from '../screen/layers.ts';
import { installTokens } from '../styles/tokens.ts';
import { widgetStyles } from '../styles/widget-styles.ts';

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

  // ---- vòng đời ----------------------------------------------------------------------------------------------

  override connectedCallback(): void {
    super.connectedCallback();
    installTokens(this.ownerDocument);
    this.#sync();
  }

  override disconnectedCallback(): void {
    this.#unsubscribe();
    this.#clearVis();
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('item') || changed.has('source')) this.#sync();
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
    this.#unsub = this.source.subscribe(ids, () => this.#onChange());
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
