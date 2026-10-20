// Widget `image` (feature 014): ảnh SVG trong project (`graphics/…svg`, thuộc tính `src`), dùng lại đường SVG có sẵn:
// tải bằng `loadSvg` của <mat-screen> (tệp của project, không URL ngoài: Constitution offline) và dựng bằng mountScreen của
// @mat/svg-renderer (lọc allowlist, chống bom `use`, Shadow DOM riêng). Không Tag, không binding; tải lỗi thì hiện chữ.
import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { mountScreen, parseSvg, type MountedScreen } from '@mat/svg-renderer';
import { vi } from '../i18n/vi.ts';
import { MatWidget } from './base.ts';

/** viewBox của SVG: thuộc tính viewBox, không thì width/height, không thì 100 × 100. */
export function svgViewBox(root: Element): [number, number, number, number] {
  const nums = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (nums.length === 4 && nums.every(Number.isFinite) && nums[2]! > 0 && nums[3]! > 0)
    return nums as [number, number, number, number];
  const w = parseFloat(root.getAttribute('width') ?? '');
  const h = parseFloat(root.getAttribute('height') ?? '');
  return w > 0 && h > 0 ? [0, 0, w, h] : [0, 0, 100, 100];
}

export class MatImage extends MatWidget {
  static override properties = {
    ...MatWidget.properties,
    loadSvg: { attribute: false },
    _state: { state: true },
  };
  static override styles = [
    MatWidget.styles,
    css`
      .w {
        justify-content: flex-start;
        padding: 6px;
        border-radius: var(--mat-radius-lg, var(--mat-radius, 4px));
      }
      .area {
        flex: 1;
        min-height: 0;
        position: relative;
      }
      .framed .area {
        margin: 8px;
      }
      .pic {
        position: absolute;
        inset: 0;
      }
      .msg {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--mat-text-muted);
        font-size: 12px;
        border: 1px dashed var(--mat-border-strong);
        border-radius: var(--mat-radius, 4px);
      }
    `,
  ];

  declare loadSvg: ((path: string) => Promise<string>) | undefined;
  declare _state: 'empty' | 'loading' | 'ok' | 'failed';

  #key = '';
  #loader: MatImage['loadSvg'] = undefined;
  #seq = 0;
  #mounted: MountedScreen | null = null;
  #ready: Promise<void> = Promise.resolve();

  constructor() {
    super();
    this._state = 'empty';
  }

  /** Xong khi lần tải gần nhất kết thúc (thành công hay lỗi); cho test. */
  get imageReady(): Promise<void> {
    return this.#ready;
  }

  override tagIds(): string[] {
    return [];
  }

  override disconnectedCallback(): void {
    this.#mounted?.unmount();
    this.#mounted = null;
    this.#key = '';
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const src = this.prop('src', '');
    const fit = this.prop('fit', 'contain') === 'cover' ? 'cover' : 'contain';
    const key = `${src}|${fit}`;
    const host = this.renderRoot.querySelector<HTMLElement>('.pic');
    if (!host || (key === this.#key && this.loadSvg === this.#loader)) return;
    this.#key = key;
    this.#loader = this.loadSvg;
    this.#mounted?.unmount();
    this.#mounted = null;
    if (!src || !this.loadSvg) {
      this._state = 'empty';
      return;
    }
    const seq = ++this.#seq;
    this._state = 'loading';
    this.#ready = this.loadSvg(src)
      .then((text) => {
        if (seq !== this.#seq || !this.isConnected) return;
        const viewBox = svgViewBox(parseSvg(text));
        this.#mounted = mountScreen(host, text, { viewBox, fitMode: fit, elements: [] });
        this._state = 'ok';
      })
      .catch((e: unknown) => {
        if (seq !== this.#seq) return;
        console.warn('mat-w-image: không tải được', src, e);
        this._state = 'failed';
      });
  }

  protected override renderWidget(): TemplateResult {
    const title = this.titleText();
    const alt = this.prop('alt', '') || title;
    const msg =
      this._state === 'failed'
        ? vi.dash.imageFailed
        : this._state === 'empty'
          ? vi.dash.imageEmpty
          : '';
    return html`<div class="w ${title ? 'framed' : ''}">
      ${this.head()}
      <div class="area">
        <div class="pic" role="img" aria-label=${alt || vi.widget.image!}></div>
        ${msg ? html`<div class="msg">${msg}</div>` : nothing}
      </div>
    </div>`;
  }
}
