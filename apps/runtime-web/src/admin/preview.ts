// Xem trước màn hình trên trang Quản trị (feature 013, FR-042, FR-043): chính `<mat-screen>` của trang vận hành ở chế
// độ chỉ đọc. PreviewHost không bao giờ gửi lệnh: mọi widget điều khiển khóa (`PREVIEW`, hoặc `NO_PERMISSION` cho item
// bị khóa của người đang "xem với tư cách"), điều hướng và popup không làm gì. Lớp phủ tùy chọn: mỗi item một nút trong
// suốt đúng chỗ item (bấm hoặc Tab + Enter để chọn), dùng cho tab Quyền theo component.
import type {
  ActionHost,
  AlarmSource,
  HistorySource,
  MatScreen,
  TagSource,
} from '@mat/ui-components';
import type { ScreenModel } from '@mat/project-schema';
import type { ProjectStore } from '../project-store.ts';
import { h } from './ui.ts';

// PreviewHost dùng chung với Studio (feature 027).
export { PreviewHost } from '@mat/admin-model';

export interface PreviewDeps {
  store: ProjectStore;
  tags: TagSource;
  alarms: AlarmSource;
  history: HistorySource;
}

export class ScreenPreview {
  readonly el: HTMLElement;
  readonly #screen: MatScreen;
  readonly #overlay: HTMLElement | null;
  readonly #d: PreviewDeps;
  readonly #onPick: ((item: string) => void) | null;
  readonly #ro: ResizeObserver | null;
  #titles = new Map<string, string>();
  #selected: string | null = null;
  #tagsOff: (() => void) | null = null;
  #pickLabel: (title: string) => string;

  constructor(
    d: PreviewDeps,
    o: {
      host: ActionHost;
      label: string;
      onPick?: (item: string) => void;
      pickLabel?: (title: string) => string;
    },
  ) {
    this.#d = d;
    this.#onPick = o.onPick ?? null;
    this.#pickLabel = o.pickLabel ?? ((t) => t);
    const s = document.createElement('mat-screen') as MatScreen;
    s.tags = d.tags;
    s.host = o.host;
    s.alarms = d.alarms;
    s.history = d.history;
    s.mode = 'run';
    s.viewport = 'auto';
    s.loadSvg = (p) => d.store.loadSvg(p);
    s.loadBindings = (p) => d.store.loadBindings(p);
    s.setAttribute('aria-label', o.label);
    this.#screen = s;
    s.addEventListener('mat-tags', () => this.#subscribe());
    s.addEventListener('mat-ready', () => this.#layout());
    this.#overlay = this.#onPick ? h('div', { class: 'ad-overlay' }) : null;
    this.el = h('div', { class: 'ad-preview' }, s, this.#overlay);
    this.#ro =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.#layout());
    this.#ro?.observe(this.el);
  }

  get screenEl(): MatScreen {
    return this.#screen;
  }

  async show(model: ScreenModel, titles: ReadonlyMap<string, string> = new Map()): Promise<void> {
    this.#titles = new Map(titles);
    this.#screen.screen = model;
    await this.#screen.updateComplete;
    await this.#screen.whenReady().catch(() => undefined);
    this.#subscribe();
    // Màn hình lưới cuộn dọc bên trong mat-screen: lớp phủ đi theo.
    const vp = this.#screen.shadowRoot?.querySelector('.viewport');
    if (vp && this.#overlay && vp !== this.#scroller) {
      this.#scroller?.removeEventListener('scroll', this.#onScroll);
      vp.addEventListener('scroll', this.#onScroll, { passive: true });
      this.#scroller = vp;
    }
    this.#layout();
  }

  #scroller: Element | null = null;
  readonly #onScroll = () => this.#layout();

  select(item: string | null): void {
    this.#selected = item;
    for (const b of this.#overlay?.querySelectorAll<HTMLElement>('[data-pick]') ?? [])
      b.setAttribute('aria-pressed', String(b.dataset.pick === item));
  }

  dispose(): void {
    this.#tagsOff?.();
    this.#tagsOff = null;
    this.#ro?.disconnect();
  }

  #subscribe(): void {
    this.#tagsOff?.();
    this.#tagsOff = this.#d.tags.subscribe(this.#screen.tagIds(), () => undefined);
  }

  /** Nút phủ đúng hộp của từng item (đo trong Shadow DOM của mat-screen). */
  #layout(): void {
    const ov = this.#overlay;
    if (!ov || !this.el.isConnected) return;
    requestAnimationFrame(() => {
      const base = this.el.getBoundingClientRect();
      const root = this.#screen.shadowRoot;
      if (!root) return;
      const out: HTMLElement[] = [];
      for (const it of root.querySelectorAll<HTMLElement>('.item[data-item-id]')) {
        const id = it.dataset.itemId!;
        // Popup lồng bên trong không có trong lớp phủ (chỉ item của màn hình đang xem).
        if (it.closest('.popup-body')) continue;
        const r = it.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const title = this.#titles.get(id) ?? id;
        const b = h('button', {
          type: 'button',
          class: 'ad-pick',
          attrs: {
            'data-pick': id,
            'aria-pressed': String(id === this.#selected),
            'aria-label': this.#pickLabel(title),
            title,
          },
          on: { click: () => this.#onPick?.(id) },
        });
        b.style.left = `${r.left - base.left}px`;
        b.style.top = `${r.top - base.top}px`;
        b.style.width = `${r.width}px`;
        b.style.height = `${r.height}px`;
        out.push(b);
      }
      ov.replaceChildren(...out);
    });
  }
}
