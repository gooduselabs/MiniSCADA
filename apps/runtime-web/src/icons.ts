// Bộ 16 biểu tượng của menu (data-model §7: home, tank, pump, chart, table, gear, bell, bolt, thermo, drop, valve,
// motor, list, map, doc, user) cộng vài biểu tượng của thanh trên. Dựng bằng createElementNS từ dữ liệu đường vẽ:
// không HTML thô. Nét 1,8 px, kế thừa `currentColor`.
export const ICON_NAMES = [
  'home',
  'tank',
  'pump',
  'chart',
  'table',
  'gear',
  'bell',
  'bolt',
  'thermo',
  'drop',
  'valve',
  'motor',
  'list',
  'map',
  'doc',
  'user',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** Biểu tượng của thanh trên (không nằm trong bộ 16 tên của project). */
export type UiIconName = 'menu' | 'close' | 'lock' | 'logout' | 'login' | 'warn';

const PATHS: Record<IconName | UiIconName, string> = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  tank: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3v12c0 1.7-3.1 3-7 3s-7-1.3-7-3zM5 6c0 1.7 3.1 3 7 3s7-1.3 7-3',
  pump: 'M4 15a6 6 0 1012 0 6 6 0 00-12 0zM10 9V5h8l3 3M10 15h.01',
  chart: 'M4 20V4M4 20h16M8 16l4-5 3 3 5-7',
  table: 'M3 5h18v14H3zM3 10h18M9 5v14',
  gear: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
  bell: 'M6 16v-5a6 6 0 1112 0v5l2 2H4zM10 20a2 2 0 004 0',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  thermo: 'M10 14V5a2 2 0 114 0v9a4 4 0 11-4 0zM12 9v8',
  drop: 'M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z',
  valve: 'M3 7l9 5-9 5zM21 7l-9 5 9 5zM12 12V4M9 4h6',
  motor: 'M4 8h12v8H4zM16 10h3v4h-3zM19 12h2M7 8V6M13 8V6',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-6 8-6s8 2 8 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 118 0v3',
  logout: 'M10 4H5v16h5M14 8l5 4-5 4M19 12H9',
  login: 'M14 4h5v16h-5M10 8l-5 4 5 4M5 12h10',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
};

const NS = 'http://www.w3.org/2000/svg';

export const isIconName = (v: unknown): v is IconName => ICON_NAMES.includes(v as IconName);

export function createIcon(name: IconName | UiIconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('ic');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
