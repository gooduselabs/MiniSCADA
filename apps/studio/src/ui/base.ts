// Nền chung của thành phần giao diện Studio (feature 004, research R1, ADR-009): web component Lit render
// vào light DOM (sprite icon <use href="#i-…"> và token theme áp thẳng), vẽ lại khi StudioApp báo đổi.
// Dữ liệu project chỉ đi vào template qua binding của Lit (thành text hoặc thuộc tính đã thoát ký tự).
import { html, LitElement, type PropertyValues } from 'lit';
import type { StudioApp } from '../app/app.ts';
import { iconHref, type IconName } from '../icons/icons.ts';

export class AppElement extends LitElement {
  private appRef: StudioApp | null = null;
  private unsubscribe: (() => void) | null = null;

  get app(): StudioApp {
    if (!this.appRef) throw new Error(`${this.localName}: app is not set`);
    return this.appRef;
  }

  set app(app: StudioApp) {
    if (app === this.appRef) return;
    this.release();
    this.appRef = app;
    if (this.isConnected) this.bind();
    this.requestUpdate();
  }

  get hasApp(): boolean {
    return this.appRef !== null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.appRef && !this.unsubscribe) this.bind();
  }

  override disconnectedCallback(): void {
    this.release();
    super.disconnectedCallback();
  }

  private bind(): void {
    this.unsubscribe = this.app.subscribe(() => this.requestUpdate());
    this.attached();
  }

  private release(): void {
    if (!this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
    this.detached();
  }

  /**
   * Gọi khi thành phần đã nằm trong document VÀ đã có app (thứ tự hai việc này tùy cách tạo: phần tử có
   * sẵn trong index.html được nâng cấp trước khi main.ts gắn app). Gắn hook, nghe thêm sự kiện ở đây.
   */
  protected attached(): void {}

  /** Ngược với `attached`: rời document hoặc đổi app. */
  protected detached(): void {}

  protected override shouldUpdate(changed: PropertyValues): boolean {
    return this.appRef !== null && super.shouldUpdate(changed);
  }
}

/** Icon trong sprite (icons.ts). `cls`: `lg`, `ok`, `warn`, `err`, `info`… */
export const icon = (name: IconName, cls = '') =>
  html`<svg class="ic ${cls}" aria-hidden="true" focusable="false">
    <use href=${iconHref(name)}></use>
  </svg>`;

/** Chạy hàm khi phím là Enter hoặc Space (nút tự dựng trên phần tử không phải <button>). */
export const onActivate = (run: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
};
