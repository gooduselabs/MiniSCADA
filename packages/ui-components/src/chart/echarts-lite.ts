// ECharts lite (feature 012, T041, research R2, contracts/ui-theme.md §3): nạp lười gói ECharts tối thiểu
// (echarts-modules.ts, chunk riêng) lần đầu một widget cần, theme lấy từ token --mat-*, tắt hoạt ảnh khi người dùng
// bật giảm chuyển động (FR-033). Không bao giờ đưa chuỗi HTML vào ECharts: tooltip dựng bằng DOM (tooltipContent),
// nhãn là chuỗi thuần mà zrender vẽ thành chữ SVG (cổng nội dung SC-020, T047).
import { safeColor } from '../format/color.ts';
import { FALLBACK_SERIES_COLORS } from './line-chart.ts';

/** Phần API của một biểu đồ ECharts mà widget dùng. */
export interface ChartInstance {
  setOption(
    option: object,
    opts?: { notMerge?: boolean; lazyUpdate?: boolean; replaceMerge?: string[] },
  ): void;
  resize(opts?: { width?: number | 'auto'; height?: number | 'auto' }): void;
  dispose(): void;
}

export interface EChartsLite {
  init(dom: HTMLElement, opts?: { width?: number; height?: number }): ChartInstance;
}

type Loader = () => Promise<EChartsLite>;
const realLoader: Loader = () => import('./echarts-modules.ts').then((m) => m.lib);
let loader: Loader = realLoader;
let pending: Promise<EChartsLite> | null = null;

/** Nạp ECharts lite một lần; lỗi (mạng) thì lần gọi sau thử lại. */
export function loadECharts(): Promise<EChartsLite> {
  if (!pending)
    pending = loader().catch((e: unknown) => {
      pending = null;
      throw e;
    });
  return pending;
}

/** Chỉ cho test: thay bộ nạp (null = bản thật) và xóa bộ nhớ đệm. */
export function setEChartsLoader(fn: Loader | null): void {
  loader = fn ?? realLoader;
  pending = null;
}

// ---- theme từ token ----

export interface ChartTheme {
  colors: string[];
  text: string;
  muted: string;
  border: string;
  borderStrong: string;
  surface: string;
  surface2: string;
  bad: string;
  warn: string;
  font: string;
  radius: number;
  shadow: string;
  /** --mat-motion (ms); 0 khi giảm chuyển động. */
  motionMs: number;
}

// Giá trị industrial sáng (themes/industrial.css): dùng khi nơi chứa chưa nạp token.
const FALLBACK_CHART = FALLBACK_SERIES_COLORS;

export function readChartTheme(el: Element): ChartTheme {
  const view = el.ownerDocument.defaultView;
  const cs = view?.getComputedStyle ? view.getComputedStyle(el) : null;
  const tok = (name: string, fb: string): string =>
    cs?.getPropertyValue(`--mat-${name}`).trim() || fb;
  const color = (name: string, fb: string): string => safeColor(tok(name, fb)) ?? fb;
  const motion = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(tok('motion', '120ms'));
  return {
    colors: FALLBACK_CHART.map((fb, i) => color(`chart-${i + 1}`, fb)),
    text: color('text', '#1a2225'),
    muted: color('text-muted', '#56646a'),
    border: color('border', '#d2d9dc'),
    borderStrong: color('border-strong', '#b3bec3'),
    surface: color('surface', '#ffffff'),
    surface2: color('surface-2', '#f5f7f8'),
    bad: color('bad', '#c42b2b'),
    warn: color('warn', '#8f5e00'),
    font: tok('font', "'Segoe UI', system-ui, sans-serif"),
    radius: parseFloat(tok('radius', '4px')) || 4,
    shadow: tok('shadow', '0 2px 6px rgba(0, 0, 0, 0.15)'),
    motionMs: motion ? Number(motion[1]) * (motion[2] === 's' ? 1000 : 1) : 120,
  };
}

export function prefersReducedMotion(win: Window | null | undefined): boolean {
  try {
    return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Phần option chung của mọi biểu đồ: màu chuỗi, chữ, hoạt ảnh vào nhẹ, khung tooltip. */
export function baseOption(t: ChartTheme, reduced: boolean): object {
  const animate = !reduced && t.motionMs > 0;
  return {
    color: t.colors,
    backgroundColor: 'transparent',
    textStyle: { color: t.text, fontFamily: t.font, fontSize: 11 },
    animation: animate,
    animationDuration: animate ? Math.round(t.motionMs * 3) : 0,
    animationDurationUpdate: animate ? Math.round(t.motionMs * 1.5) : 0,
    animationEasing: 'cubicOut',
    tooltip: {
      confine: true,
      backgroundColor: t.surface,
      borderColor: t.border,
      borderWidth: 1,
      padding: [6, 8],
      textStyle: { color: t.text, fontFamily: t.font, fontSize: 12 },
      extraCssText: `box-shadow: ${t.shadow}; border-radius: ${t.radius}px;`,
    },
  };
}

export interface TooltipRow {
  color: string;
  name: string;
  value: string;
}

/** Nội dung tooltip dựng bằng DOM (textContent): dữ liệu project không bao giờ thành HTML. */
export function tooltipContent(doc: Document, title: string, rows: TooltipRow[]): HTMLElement {
  const box = doc.createElement('div');
  box.className = 'mat-tip';
  if (title) {
    const h = doc.createElement('div');
    h.style.fontWeight = '600';
    h.style.marginBottom = '2px';
    h.textContent = title;
    box.append(h);
  }
  for (const r of rows) {
    const line = doc.createElement('div');
    line.style.display = 'flex';
    line.style.alignItems = 'center';
    line.style.gap = '6px';
    const mk = doc.createElement('span');
    mk.className = 'mk';
    mk.style.display = 'inline-block';
    mk.style.width = '8px';
    mk.style.height = '8px';
    mk.style.borderRadius = '2px';
    const c = safeColor(r.color);
    if (c) mk.style.background = c;
    const name = doc.createElement('span');
    name.textContent = r.name;
    const val = doc.createElement('span');
    val.style.marginLeft = 'auto';
    val.style.paddingLeft = '12px';
    val.style.fontWeight = '600';
    val.style.fontVariantNumeric = 'tabular-nums';
    val.textContent = r.value;
    line.append(mk, name, val);
    box.append(line);
  }
  return box;
}
