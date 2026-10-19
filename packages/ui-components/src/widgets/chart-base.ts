// Nền của widget vẽ bằng ECharts lite (feature 012, T042-T044): lớp con render phần Lit (khung, phần truy cập, chú giải)
// có một phần tử `.ec`, và trả option ECharts ở chartOption(). Lần đầu có `.ec` thì nạp lười ECharts (loadECharts) và
// init vào `.ec` với kích thước của item (hoặc của phần tử khi đã bố cục); mỗi lần render sau đặt lại option (gộp,
// thay mảng series). ResizeObserver (nếu có) đổi cỡ biểu đồ theo phần tử (bố cục lưới). Gỡ khỏi trang thì dispose.
import { css, type PropertyValues } from 'lit';
import {
  baseOption,
  loadECharts,
  prefersReducedMotion,
  readChartTheme,
  type ChartInstance,
  type ChartTheme,
} from '../chart/echarts-lite.ts';
import { MatWidget } from './base.ts';

export class MatEChartWidget extends MatWidget {
  static override styles = [
    MatWidget.styles,
    css`
      .ec {
        flex: 1;
        min-width: 0;
        min-height: 0;
        width: 100%;
        height: 100%;
        position: relative;
      }
    `,
  ];

  #chart: ChartInstance | null = null;
  #box: HTMLElement | null = null;
  #loading = false;
  #ro: ResizeObserver | null = null;
  #ready: Promise<void>;
  #resolveReady: () => void = () => {};

  constructor() {
    super();
    this.#ready = new Promise((r) => (this.#resolveReady = r));
  }

  /** Xong khi biểu đồ nhận option đầu tiên (hoặc khi không có biểu đồ để vẽ, hoặc nạp lỗi). */
  get chartReady(): Promise<void> {
    return this.#ready;
  }

  /** Option ECharts cho lần vẽ này (gộp sau baseOption); null = không vẽ. */
  protected chartOption(theme: ChartTheme): Record<string, unknown> | null {
    void theme;
    return null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Gắn lại sau khi gỡ: biểu đồ cũ đã dispose, vẽ lại.
    if (this.hasUpdated && !this.#chart) this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#teardown();
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.#sync();
  }

  /** Cỡ vùng vẽ hiện tại (px); trước khi có vùng vẽ: cỡ của item. */
  protected chartSize(): { width: number; height: number } {
    return this.#box
      ? this.#size(this.#box)
      : { width: this.item?.width || 300, height: this.item?.height || 200 };
  }

  /** true: option phụ thuộc cỡ vùng vẽ, đổi cỡ thì dựng lại option (đồng hồ tính bán kính bằng px). */
  protected sizeDependent = false;

  #size(box: HTMLElement): { width: number; height: number } {
    return {
      width: Math.max(box.clientWidth || this.item?.width || 300, 40),
      height: Math.max(box.clientHeight || this.item?.height || 200, 40),
    };
  }

  #sync(): void {
    const box = this.renderRoot.querySelector<HTMLElement>('.ec');
    if (box !== this.#box) {
      this.#teardown();
      this.#box = box;
    }
    if (!box) {
      this.#resolveReady();
      return;
    }
    if (this.#chart) {
      this.#apply();
      return;
    }
    if (this.#loading) return;
    this.#loading = true;
    loadECharts()
      .then((lib) => {
        this.#loading = false;
        if (!this.isConnected || this.#box !== box) return;
        this.#chart = lib.init(box, this.#size(box));
        this.#observe(box);
        this.#apply();
      })
      .catch((e: unknown) => {
        this.#loading = false;
        console.error('mat-widget: không nạp được ECharts', this.item?.id ?? this.localName, e);
        this.#resolveReady();
      });
  }

  #apply(): void {
    try {
      const theme = readChartTheme(this);
      const opt = this.chartOption(theme);
      if (opt && this.#chart) {
        const base = baseOption(theme, prefersReducedMotion(this.ownerDocument.defaultView)) as {
          tooltip: object;
        };
        this.#chart.setOption(
          {
            ...base,
            ...opt,
            tooltip: { ...base.tooltip, ...((opt.tooltip as object | undefined) ?? {}) },
          },
          { replaceMerge: ['series'] },
        );
      }
    } finally {
      this.#resolveReady();
    }
  }

  #observe(box: HTMLElement): void {
    const RO = this.ownerDocument.defaultView?.ResizeObserver;
    if (!RO) return;
    this.#ro = new RO(() => {
      if (!this.#chart || !box.clientWidth || !box.clientHeight) return;
      this.#chart.resize(this.#size(box));
      if (this.sizeDependent) this.#apply();
    });
    this.#ro.observe(box);
  }

  #teardown(): void {
    this.#ro?.disconnect();
    this.#ro = null;
    this.#chart?.dispose();
    this.#chart = null;
    this.#box = null;
  }
}
