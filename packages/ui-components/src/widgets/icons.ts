// Bộ biểu tượng công nghiệp của widget dashboard (feature 014): thẻ chỉ số (stat-tile), danh sách trạng thái. Tự vẽ trên
// lưới 24 × 24, nét 2 px đầu tròn (vẽ bằng `stroke`, không tô), không lấy từ thư viện ngoài nên không có điều khoản giấy
// phép kèm theo. Chỉ là dữ liệu đường (`d`) đưa vào thuộc tính của phần tử <path> qua Lit (không chuỗi HTML).
// Tên là giá trị `icon` của danh mục widget (schemas/widgets.catalog.json); thêm hình: thêm khóa ở đây và vào `options`.
import { svg, type SVGTemplateResult } from 'lit';

export const DASH_ICONS = {
  thermometer: ['M10 4.5a2 2 0 0 1 4 0v9.8a4 4 0 1 1-4 0Z', 'M12 9v7.5'],
  droplet: [
    'M12 3c3.6 4.3 6 7.7 6 11a6 6 0 0 1-12 0c0-3.3 2.4-6.7 6-11Z',
    'M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5',
  ],
  wave: [
    'M2 8.5c2.5-2.4 4.5-2.4 7 0s4.5 2.4 7 0 4.5-2.4 6 0',
    'M2 15.5c2.5-2.4 4.5-2.4 7 0s4.5 2.4 7 0 4.5-2.4 6 0',
  ],
  wind: ['M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5', 'M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5', 'M3 16h7'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8Z',
    'M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  ],
  lightbulb: [
    'M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z',
    'M9.5 19.5h5M10.5 22h3',
  ],
  gas: [
    'M7 18.5h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 10 4.3 4.3 0 0 0 7 18.5Z',
    'M9.5 14.5h2M13 14.5h1.5',
  ],
  flame: [
    'M12 2.5c.8 3.4 5 5.6 5 10.2a5 5 0 0 1-10 0c0-2.4 1.3-4 2.4-5 .3 1.6 1 2.6 2 3 .3-2.6-.2-5.4.6-8.2Z',
  ],
  fan: [
    'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Z',
    'M12 10.5c-1.2-3.6-.6-7 2.4-7 2 0 2.6 2.4.6 4.4l-1.8 1.6',
    'M13.3 12.8c3.6.8 6.2 3.3 4.6 5.8-1 1.7-3.4 1.1-4.2-1.6l-.5-2.4',
    'M10.6 12.7c-2.5 2.6-5.8 3.6-7.2 1-1-1.8.8-3.4 3.6-2.8l2.4.6',
  ],
  snowflake: [
    'M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6',
    'M9.5 4l2.5 2 2.5-2M9.5 20l2.5-2 2.5 2M3.5 10.6l3.1-.6-1-3M20.5 13.4l-3.1.6 1 3M5.6 17l1-3-3.1-.6M18.4 7l-1 3 3.1.6',
  ],
  pump: [
    'M11 8a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11Z',
    'M11 8h9v4h-3.7',
    'M6.5 21.5h9M8 18.5l-1 3M14 18.5l1 3',
    'M11 11v5M8.5 13.5h5',
  ],
  valve: ['M3 8.5v7l9-3.5Z', 'M21 8.5v7L12 12Z', 'M12 12V5.5', 'M8.5 5.5h7'],
  bolt: ['M13 2.5 4.5 13.5h6.5l-1 8 8.5-11H12l1-8Z'],
  power: ['M12 3v8.5', 'M6.6 6.6a7.5 7.5 0 1 0 10.8 0'],
  pressure: [
    'M4.4 18a8.8 8.8 0 1 1 15.2 0',
    'M12 14.5l3.6-4.6',
    'M12 13a1.5 1.5 0 1 0 0 3 1.5 1.5 0 1 0 0-3Z',
    'M7 18h10',
  ],
  tank: [
    'M5 5.5c0-1.4 3.1-2.5 7-2.5s7 1.1 7 2.5v13c0 1.4-3.1 2.5-7 2.5s-7-1.1-7-2.5Z',
    'M5 5.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5',
    'M5 12.5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5',
  ],
  motor: ['M3.5 8h11v9h-11Z', 'M14.5 12.5h6', 'M6.5 8V5.5M9 8V5.5M11.5 8V5.5', 'M5 17v3h8v-3'],
  gear: [
    'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z',
    'M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13Z',
    'M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22M4.9 4.9l2.5 2.5M16.6 16.6l2.5 2.5M4.9 19.1l2.5-2.5M16.6 7.4l2.5-2.5',
  ],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Z', 'M12 7v5l3.5 2'],
  alert: ['M12 3.2 2.3 20h19.4Z', 'M12 9.5v5', 'M12 17.5v.1'],
  star: ['M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3-4.6-4.4 6.3-.9Z'],
} as const satisfies Record<string, readonly string[]>;

export type DashIconName = keyof typeof DASH_ICONS;

export const DASH_ICON_NAMES = Object.keys(DASH_ICONS) as DashIconName[];

export function isDashIcon(name: unknown): name is DashIconName {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(DASH_ICONS, name);
}

/** Phần tử <svg> của biểu tượng (trang trí: aria-hidden); tên lạ trả `null`. */
export function dashIcon(name: unknown, cls = 'icon'): SVGTemplateResult | null {
  if (!isDashIcon(name)) return null;
  return svg`<svg
    class=${cls}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >${DASH_ICONS[name].map((d) => svg`<path d=${d}></path>`)}</svg>`;
}
