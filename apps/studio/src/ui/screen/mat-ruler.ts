// Thước ngang và dọc của canvas Màn hình (feature 007, T111, FR-058; mockup studio-screens cảnh 1): vạch theo tỉ lệ zoom,
// số theo đơn vị thiết kế, đi theo pan. Chỉ là trang trí (aria-hidden): tọa độ chính xác hiện ở thanh trạng thái và ở ô X, Y
// của inspector. Vẽ bằng phần tử DOM (nhãn) và `background` nhiều lớp (vạch); không dùng <canvas> để chạy được trong jsdom.
import { LitElement, html } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

/** Khoảng cách nhãn nhỏ nhất (điểm ảnh): bước thước là số đẹp đầu tiên đạt ngưỡng này. */
const MIN_LABEL_PX = 56;
const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000] as const;

/** Bước nhãn (đơn vị thiết kế) cho zoom đã cho. */
export function rulerStep(zoom: number): number {
  for (const s of NICE) if (s * zoom >= MIN_LABEL_PX) return s;
  return NICE[NICE.length - 1]!;
}

export interface RulerMark {
  value: number;
  /** Vị trí trên thước (điểm ảnh màn hình). */
  at: number;
}

/** Các nhãn nhìn thấy: từ đầu thước tới `length` điểm ảnh. */
export function rulerMarks(zoom: number, pan: number, length: number): RulerMark[] {
  const step = rulerStep(zoom);
  const first = Math.floor(-pan / zoom / step) * step;
  const out: RulerMark[] = [];
  for (let v = first; v * zoom + pan <= length; v += step) {
    const at = v * zoom + pan;
    if (at >= -MIN_LABEL_PX) out.push({ value: v, at: Math.round(at) });
    if (out.length > 200) break;
  }
  return out;
}

export class MatRuler extends LitElement {
  static override properties = {
    axis: { reflect: true },
    zoom: { type: Number },
    pan: { type: Number },
    length: { type: Number },
  };

  declare axis: 'x' | 'y';
  declare zoom: number;
  declare pan: number;
  declare length: number;

  constructor() {
    super();
    this.axis = 'x';
    this.zoom = 1;
    this.pan = 0;
    this.length = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override render() {
    const step = rulerStep(this.zoom);
    const major = step * this.zoom;
    const minor = major / 5;
    const x = this.axis === 'x';
    const marks = rulerMarks(this.zoom, this.pan, this.length);
    this.setAttribute('aria-hidden', 'true');
    return html`<div
        class="rl-ticks"
        style=${styleMap({
          '--major': `${major}px`,
          '--minor': `${minor}px`,
          '--off': `${this.pan}px`,
        })}
      ></div>
      ${marks.map(
        (m) =>
          html`<span
            class="rl-mark"
            style=${styleMap(x ? { left: `${m.at + 3}px` } : { top: `${m.at + 3}px` })}
            >${m.value}</span
          >`,
      )}`;
  }
}

customElements.define('mat-ruler', MatRuler);

declare global {
  interface HTMLElementTagNameMap {
    'mat-ruler': MatRuler;
  }
}
