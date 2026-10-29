// Icon của Studio (feature 004, research R4, ADR-009): Fluent UI System Icons nạp lúc build (`?raw`),
// chỉ những icon dùng tới, cộng vài ký hiệu công nghiệp tự vẽ (bơm, van, bồn, motor, ống) mà bộ Fluent
// không có. Tất cả gom thành một sprite <symbol> đặt trong document; thành phần Studio render ở light
// DOM nên dùng <svg class="ic"><use href="#i-tên"></use></svg>. Nội dung SVG là tài nguyên của Studio,
// không phải dữ liệu project; dựng bằng DOMParser, không qua innerHTML.
import add from '@fluentui/svg-icons/icons/add_16_regular.svg?raw';
import arrowRepeatAll from '@fluentui/svg-icons/icons/arrow_repeat_all_16_regular.svg?raw';
import clock from '@fluentui/svg-icons/icons/clock_16_regular.svg?raw';
import copy from '@fluentui/svg-icons/icons/copy_16_regular.svg?raw';
import flash from '@fluentui/svg-icons/icons/flash_16_regular.svg?raw';
import hourglassHalf from '@fluentui/svg-icons/icons/hourglass_half_16_regular.svg?raw';
import alert from '@fluentui/svg-icons/icons/alert_16_regular.svg?raw';
import arrowClockwise from '@fluentui/svg-icons/icons/arrow_clockwise_16_regular.svg?raw';
import arrowCollapseAll from '@fluentui/svg-icons/icons/arrow_collapse_all_16_regular.svg?raw';
import arrowDownload from '@fluentui/svg-icons/icons/arrow_download_16_regular.svg?raw';
import arrowExport from '@fluentui/svg-icons/icons/arrow_export_16_regular.svg?raw';
import arrowFit from '@fluentui/svg-icons/icons/arrow_fit_16_regular.svg?raw';
import arrowImport from '@fluentui/svg-icons/icons/arrow_import_16_regular.svg?raw';
import arrowRedo from '@fluentui/svg-icons/icons/arrow_redo_16_regular.svg?raw';
import arrowSortDownLines from '@fluentui/svg-icons/icons/arrow_sort_down_lines_16_regular.svg?raw';
import arrowUndo from '@fluentui/svg-icons/icons/arrow_undo_16_regular.svg?raw';
import arrowUpload from '@fluentui/svg-icons/icons/arrow_upload_16_regular.svg?raw';
import borderInside from '@fluentui/svg-icons/icons/border_inside_16_regular.svg?raw';
import button from '@fluentui/svg-icons/icons/button_16_regular.svg?raw';
import cardUi from '@fluentui/svg-icons/icons/card_ui_20_regular.svg?raw';
import checkmarkCircle from '@fluentui/svg-icons/icons/checkmark_circle_16_regular.svg?raw';
import chevronDown from '@fluentui/svg-icons/icons/chevron_down_16_regular.svg?raw';
import chevronRight from '@fluentui/svg-icons/icons/chevron_right_16_regular.svg?raw';
import clipboardPaste from '@fluentui/svg-icons/icons/clipboard_paste_16_regular.svg?raw';
import columnDoubleCompare from '@fluentui/svg-icons/icons/column_double_compare_20_regular.svg?raw';
import connector from '@fluentui/svg-icons/icons/connector_16_regular.svg?raw';
import darkTheme from '@fluentui/svg-icons/icons/dark_theme_20_regular.svg?raw';
import dataBarVertical from '@fluentui/svg-icons/icons/data_bar_vertical_16_regular.svg?raw';
import dataLine from '@fluentui/svg-icons/icons/data_line_16_regular.svg?raw';
import dataPie from '@fluentui/svg-icons/icons/data_pie_16_regular.svg?raw';
import database from '@fluentui/svg-icons/icons/database_16_regular.svg?raw';
import desktop from '@fluentui/svg-icons/icons/desktop_16_regular.svg?raw';
import developerBoard from '@fluentui/svg-icons/icons/developer_board_16_regular.svg?raw';
import dismiss from '@fluentui/svg-icons/icons/dismiss_16_regular.svg?raw';
import documentCheckmark from '@fluentui/svg-icons/icons/document_checkmark_16_regular.svg?raw';
import documentData from '@fluentui/svg-icons/icons/document_data_16_regular.svg?raw';
import errorCircle from '@fluentui/svg-icons/icons/error_circle_16_regular.svg?raw';
import eye from '@fluentui/svg-icons/icons/eye_16_regular.svg?raw';
import folder from '@fluentui/svg-icons/icons/folder_16_regular.svg?raw';
import gauge from '@fluentui/svg-icons/icons/gauge_16_regular.svg?raw';
import gridDots from '@fluentui/svg-icons/icons/grid_dots_16_regular.svg?raw';
import group from '@fluentui/svg-icons/icons/group_20_regular.svg?raw';
import history from '@fluentui/svg-icons/icons/history_16_regular.svg?raw';
import home from '@fluentui/svg-icons/icons/home_16_regular.svg?raw';
import info from '@fluentui/svg-icons/icons/info_16_regular.svg?raw';
import library from '@fluentui/svg-icons/icons/library_16_regular.svg?raw';
import lightbulb from '@fluentui/svg-icons/icons/lightbulb_16_regular.svg?raw';
import link from '@fluentui/svg-icons/icons/link_16_regular.svg?raw';
import lockClosed from '@fluentui/svg-icons/icons/lock_closed_16_regular.svg?raw';
import mathFormula from '@fluentui/svg-icons/icons/math_formula_16_regular.svg?raw';
import navigation from '@fluentui/svg-icons/icons/navigation_16_regular.svg?raw';
import open from '@fluentui/svg-icons/icons/open_16_regular.svg?raw';
import options from '@fluentui/svg-icons/icons/options_16_regular.svg?raw';
import panelLeft from '@fluentui/svg-icons/icons/panel_left_16_regular.svg?raw';
import people from '@fluentui/svg-icons/icons/people_16_regular.svg?raw';
import play from '@fluentui/svg-icons/icons/play_16_regular.svg?raw';
import plugConnected from '@fluentui/svg-icons/icons/plug_connected_16_regular.svg?raw';
import plugDisconnected from '@fluentui/svg-icons/icons/plug_disconnected_16_regular.svg?raw';
import pulse from '@fluentui/svg-icons/icons/pulse_20_regular.svg?raw';
import save from '@fluentui/svg-icons/icons/save_16_regular.svg?raw';
import search from '@fluentui/svg-icons/icons/search_16_regular.svg?raw';
import settings from '@fluentui/svg-icons/icons/settings_16_regular.svg?raw';
import shieldCheckmark from '@fluentui/svg-icons/icons/shield_checkmark_16_regular.svg?raw';
import square from '@fluentui/svg-icons/icons/square_16_regular.svg?raw';
import subtract from '@fluentui/svg-icons/icons/subtract_16_regular.svg?raw';
import table from '@fluentui/svg-icons/icons/table_16_regular.svg?raw';
import tag from '@fluentui/svg-icons/icons/tag_16_regular.svg?raw';
import textBulletList from '@fluentui/svg-icons/icons/text_bullet_list_16_regular.svg?raw';
import textT from '@fluentui/svg-icons/icons/text_t_16_regular.svg?raw';
import textbox from '@fluentui/svg-icons/icons/textbox_16_regular.svg?raw';
import toggleLeft from '@fluentui/svg-icons/icons/toggle_left_16_regular.svg?raw';
import toolbox from '@fluentui/svg-icons/icons/toolbox_16_regular.svg?raw';
import warning from '@fluentui/svg-icons/icons/warning_16_regular.svg?raw';
import weatherMoon from '@fluentui/svg-icons/icons/weather_moon_16_regular.svg?raw';
import weatherSunny from '@fluentui/svg-icons/icons/weather_sunny_16_regular.svg?raw';
import zoomIn from '@fluentui/svg-icons/icons/zoom_in_16_regular.svg?raw';
import zoomOut from '@fluentui/svg-icons/icons/zoom_out_16_regular.svg?raw';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Tên dùng trong Studio → file Fluent (mỗi nghĩa một icon, như mockup bản 1). */
const FLUENT = {
  save,
  undo: arrowUndo,
  redo: arrowRedo,
  check: documentCheckmark,
  download: arrowDownload,
  upload: arrowUpload,
  compare: columnDoubleCompare,
  online: plugConnected,
  offline: plugDisconnected,
  play,
  bolt: flash,
  clock,
  repeat: arrowRepeatAll,
  copy,
  hourglass: hourglassHalf,
  search,
  project: folder,
  home,
  gear: settings,
  device: developerBoard,
  connection: connector,
  tag,
  table,
  fx: mathFormula,
  list: textBulletList,
  bell: alert,
  db: database,
  screen: desktop,
  report: documentData,
  users: people,
  library,
  'chev-r': chevronRight,
  'chev-d': chevronDown,
  x: dismiss,
  plus: add,
  minus: subtract,
  paste: clipboardPaste,
  filldown: arrowSortDownLines,
  import: arrowImport,
  export: arrowExport,
  ok: checkmarkCircle,
  warn: warning,
  err: errorCircle,
  info,
  zoomin: zoomIn,
  zoomout: zoomOut,
  fit: arrowFit,
  grid: gridDots,
  snap: borderInside,
  sun: weatherSunny,
  moon: weatherMoon,
  contrast: darkTheme,
  toolbox,
  pulse,
  lamp: lightbulb,
  gauge,
  card: cardUi,
  button,
  switch: toggleLeft,
  input: textbox,
  slider: options,
  line: dataLine,
  bar: dataBarVertical,
  pie: dataPie,
  lock: lockClosed,
  ext: open,
  refresh: arrowClockwise,
  link,
  menu: navigation,
  sidebar: panelLeft,
  shield: shieldCheckmark,
  restore: history,
  text: textT,
  group,
  shape: square,
  eye,
  collapse: arrowCollapseAll,
} as const;

/**
 * Ký hiệu công nghiệp tự vẽ (từ mockup), lưới 16, chỉ dùng nét: mỗi phần tử ghi `fill="none"` để không bị
 * tô kín bởi `fill: currentColor` của lớp `.ic`. Bộ ký hiệu đầy đủ thuộc GĐ 3b.
 */
const STROKE =
  'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"';
const custom = (body: string) =>
  `<svg xmlns="${SVG_NS}" viewBox="0 0 16 16"><g ${STROKE}>${body.replace(
    /<(path|rect|circle|ellipse)( [^>]*)?>/g,
    (m: string, tag: string, attrs: string | undefined) =>
      (attrs ?? '').includes(' fill=') ? m : `<${tag} fill="none"${attrs ?? ''}>`,
  )}</g></svg>`;
const CUSTOM = {
  pump: custom(
    '<circle fill="none" cx="7" cy="9" r="4"/><path fill="none" d="M7 5h6.6v2.6"/><path fill="none" d="M3.8 13.6h6.4"/>',
  ),
  valve: custom(
    '<path fill="none" d="M2 5.2v5.6L8 8zM14 5.2v5.6L8 8z"/><path fill="none" d="M8 8V3.6M6 3.6h4"/>',
  ),
  tank: custom(
    '<rect fill="none" x="4" y="2" width="8" height="12" rx="2"/><path fill="none" d="M4 9h8"/>',
  ),
  motor: custom(
    '<rect fill="none" x="2.4" y="4.4" width="9" height="7.2" rx="1"/><path fill="none" d="M11.4 8H14"/><path fill="none" d="M4.4 11.6v2M9.4 11.6v2"/>',
  ),
  pipe: custom(
    '<path fill="none" d="M2 5.8h7a3.2 3.2 0 0 1 3.2 3.2v5"/><path fill="none" d="M2 10.2h5a1.2 1.2 0 0 1 1.2 1.2V14"/>',
  ),
  // ---- Widget lịch sử (feature 010): biểu đồ kèm vòng đồng hồ ở góc phải dưới ----
  'hist-trend': custom(
    '<path d="M1.8 12.5V3M1.8 12.5h8"/><path d="M3 10l2.4-3 2 1.6L10.4 4"/><circle cx="12" cy="11.6" r="2.6"/><path d="M12 10.2v1.5l1 .6"/>',
  ),
  'hist-table': custom(
    '<rect x="1.8" y="2.6" width="9.6" height="9" rx="1"/><path d="M1.8 5.6h9.6M5.4 5.6v6"/><circle cx="12" cy="11.8" r="2.4"/><path d="M12 10.5v1.4l.9.5"/>',
  ),
  'hist-bar': custom(
    '<path d="M1.8 12.8h8.4"/><rect x="2.6" y="7.2" width="2" height="5.6"/><rect x="5.8" y="3.4" width="2" height="9.4"/><circle cx="12" cy="11.6" r="2.6"/><path d="M12 10.2v1.5l1 .6"/>',
  ),
  'hist-pie': custom(
    '<circle cx="6.6" cy="7.6" r="4.6"/><path d="M6.6 7.6V3M6.6 7.6l3.8 2.4"/><circle cx="12.4" cy="12.4" r="2.2"/><path d="M12.4 11.3v1.2l.8.5"/>',
  ),
  // ---- Trình bố trí màn hình (feature 007, mockup studio-screens): căn chỉnh, xếp lớp, công cụ, widget ----
  // ---- Template và faceplate (feature 011, mockup studio-svg-draw cảnh 3) ----
  template: custom(
    '<rect x="1.8" y="1.8" width="7.4" height="5.4" rx=".8"/><rect x="6.8" y="8.8" width="7.4" height="5.4" rx=".8"/><path d="M5.5 7.2v3.2h1.3"/>',
  ),
  explode: custom(
    '<rect x="5.4" y="5.4" width="5.2" height="5.2" rx=".6"/><path d="M2 2l2.4 2.4M14 2l-2.4 2.4M2 14l2.4-2.4M14 14l-2.4-2.4"/>',
  ),
  popup: custom(
    '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1"/><rect x="4.4" y="5.4" width="7.2" height="5" rx=".6"/>',
  ),
  panel: custom('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6h12"/>'),
  select: custom(
    '<rect x="2" y="4.5" width="12" height="7" rx="1"/><path d="M9.5 7.5 11 9l1.5-1.5"/>',
  ),
  pointer: custom('<path d="M4 2.5l8 5.5-3.6.9L6.8 13z"/>'),
  hand: custom(
    '<path d="M5.5 8V3.8a1 1 0 0 1 2 0V7M7.5 7V2.8a1 1 0 0 1 2 0V7M9.5 7V3.6a1 1 0 0 1 2 0v6c0 2.6-1.5 4-3.7 4C6 13.5 5 12.5 4 10.8L3 9a1 1 0 0 1 1.7-1z"/>',
  ),
  'align-l': custom(
    '<path d="M2.5 2v12"/><rect x="4.5" y="4" width="8" height="3"/><rect x="4.5" y="9" width="5" height="3"/>',
  ),
  'align-c': custom(
    '<path d="M8 2v12"/><rect x="3.5" y="4" width="9" height="3"/><rect x="5" y="9" width="6" height="3"/>',
  ),
  'align-r': custom(
    '<path d="M13.5 2v12"/><rect x="3.5" y="4" width="8" height="3"/><rect x="6.5" y="9" width="5" height="3"/>',
  ),
  'align-t': custom(
    '<path d="M2 2.5h12"/><rect x="4" y="4.5" width="3" height="8"/><rect x="9" y="4.5" width="3" height="5"/>',
  ),
  'align-m': custom(
    '<path d="M2 8h12"/><rect x="4" y="3.5" width="3" height="9"/><rect x="9" y="5" width="3" height="6"/>',
  ),
  'align-b': custom(
    '<path d="M2 13.5h12"/><rect x="4" y="3.5" width="3" height="8"/><rect x="9" y="6.5" width="3" height="5"/>',
  ),
  'dist-h': custom('<path d="M2.5 2v12M13.5 2v12"/><rect x="6.5" y="4.5" width="3" height="7"/>'),
  'dist-v': custom('<path d="M2 2.5h12M2 13.5h12"/><rect x="4.5" y="6.5" width="7" height="3"/>'),
  'same-w': custom('<path d="M2.5 2v12M13.5 2v12"/><path d="M5 6h6M5 10h6"/>'),
  'same-h': custom('<path d="M2 2.5h12M2 13.5h12"/><path d="M6 5v6M10 5v6"/>'),
  front: custom(
    '<rect x="2.5" y="2.5" width="7" height="7" fill="currentColor" fill-opacity=".25"/><rect x="6.5" y="6.5" width="7" height="7"/>',
  ),
  back: custom(
    '<rect x="6.5" y="6.5" width="7" height="7" fill="currentColor" fill-opacity=".25"/><rect x="2.5" y="2.5" width="7" height="7"/>',
  ),
  forward: custom('<path d="M8 12.5V4M4.5 7.5 8 4l3.5 3.5"/>'),
  backward: custom('<path d="M8 3.5V12M4.5 8.5 8 12l3.5-3.5"/>'),
  eyeoff: custom(
    '<path d="M2 2l12 12"/><path d="M3.6 5C2.4 6 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.6-.7M6 3.7c.6-.1 1.3-.2 2-.2 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.2"/>',
  ),
  grip: custom('<path d="M5.5 4h.01M10.5 4h.01M5.5 8h.01M10.5 8h.01M5.5 12h.01M10.5 12h.01"/>'),
  // ---- Logic v2 (feature 011, mockup studio-logic.html): nhóm khối, trạng thái, hành động, Ghi PLC ----
  logic: custom(
    '<rect x="4" y="2.5" width="8" height="11" rx="1"/><path d="M1.5 5.5H4M1.5 10.5H4M12 8h2.5M6 6h4M6 8h2.5M6 10h3"/>',
  ),
  rule: custom('<path d="M9.2 1.8 3.8 9h4l-1 5.2L12.2 7h-4z"/>'),
  timer: custom('<circle cx="8" cy="9" r="5"/><path d="M8 9V6.3M6.5 2h3M8 2v2M12 4.5l1-1"/>'),
  counter: custom('<path d="M3.5 4v8M6 4v8M8.5 4v8M11 4v8M2 10.5l11-5"/>'),
  sum: custom('<path d="M12 3H4l4.5 5L4 13h8"/>'),
  hours: custom(
    '<path d="M2.5 11a5.5 5.5 0 1 1 11 0"/><path d="M8 11l2.6-3.4"/><path d="M2.5 13.5h11"/>',
  ),
  cal: custom(
    '<rect x="2.5" y="3.5" width="11" height="10" rx="1"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3M5 9h1.5M7.5 9H9M10 9h1.5M5 11.3h1.5M7.5 11.3H9"/>',
  ),
  plc: custom(
    '<rect x="2" y="9" width="12" height="5" rx="1"/><path d="M4.5 11.5h1M7 11.5h1"/><path d="M8 1.5v5.5M5.6 4.8 8 7.2l2.4-2.4"/>',
  ),
  'plc-off': custom(
    '<rect x="2" y="9" width="12" height="5" rx="1"/><path d="M4.5 11.5h1M7 11.5h1"/><path d="M8 1.5v5.5M5.6 4.8 8 7.2l2.4-2.4"/><path d="M2 2l12 12"/>',
  ),
  stop: custom('<path d="M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5L1.8 10.5v-5z"/><path d="M5.3 8h5.4"/>'),
  susp: custom('<circle cx="8" cy="8" r="6"/><path d="M6.4 5.6v4.8M9.6 5.6v4.8"/>'),
  throt: custom(
    '<path d="M4 2.5h8M4 13.5h8"/><path d="M4.8 2.5c0 3 2 4 3.2 5.5-1.2 1.5-3.2 2.5-3.2 5.5M11.2 2.5c0 3-2 4-3.2 5.5 1.2 1.5 3.2 2.5 3.2 5.5"/><path d="M6.4 12.2h3.2"/>',
  ),
  ban: custom('<circle cx="8" cy="8" r="6"/><path d="M3.8 12.2l8.4-8.4"/>'),
  'set-tag': custom('<path d="M3.5 6h9M3.5 10h9"/>'),
  'toggle-tag': custom(
    '<rect x="1.5" y="4.8" width="13" height="6.4" rx="3.2"/><circle cx="11.2" cy="8" r="1.8"/>',
  ),
  square: custom('<path d="M1.5 12h3V4h5v8h5"/>'),
  step: custom('<path d="M4 3.5v9l6-4.5zM12 3.5v9"/>'),
  pause: custom('<path d="M5.5 3.5v9M10.5 3.5v9"/>'),
  // ---- Tệp, nút sơ đồ, khóa, xóa (feature 011) ----
  fnew: custom('<path d="M3.5 1.8h6l3 3v9.4h-9z"/><path d="M9.5 1.8v3h3M8 7.5v5M5.5 10h5"/>'),
  'd-node': custom(
    '<path d="M2.5 13l4-8 6 3"/><rect x="1.4" y="11.9" width="2.2" height="2.2"/><rect x="5.4" y="3.9" width="2.2" height="2.2"/><rect x="11.4" y="6.9" width="2.2" height="2.2"/>',
  ),
  unlock: custom(
    '<rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V4.8a2.5 2.5 0 0 1 4.8-1"/>',
  ),
  trash: custom('<path d="M2.5 4h11M6 4V2.5h4V4M4 4l.8 9.5h6.4L12 4M6.6 6.5v5M9.4 6.5v5"/>'),
  // ---- Recipe (feature 024): bình chia độ ----
  recipe: custom(
    '<path d="M6 1.8h4M6.7 1.8v4.4L3 12.6a1.1 1.1 0 0 0 1 1.6h8a1.1 1.1 0 0 0 1-1.6L9.3 6.2V1.8"/><path d="M4.6 9.8h6.8"/>',
  ),
  ruler: custom(
    '<rect x="1.5" y="5" width="13" height="6" rx=".6"/><path d="M4 5v2.5M6.5 5v1.5M9 5v2.5M11.5 5v1.5"/>',
  ),
} as const;

export type IconName = keyof typeof FLUENT | keyof typeof CUSTOM;

const SOURCES: Record<IconName, string> = { ...FLUENT, ...CUSTOM };

export const ICON_NAMES = Object.keys(SOURCES) as IconName[];

export const iconHref = (name: IconName) => `#i-${name}`;

/** Dựng sprite <svg> ẩn chứa mỗi icon một <symbol id="i-tên">. Gọi một lần lúc khởi động. */
export function buildSprite(doc: Document): SVGSVGElement {
  const parser = new DOMParser();
  const sprite = doc.createElementNS(SVG_NS, 'svg');
  sprite.setAttribute('width', '0');
  sprite.setAttribute('height', '0');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('focusable', 'false');
  sprite.style.position = 'absolute';
  for (const name of ICON_NAMES) {
    const src = parser.parseFromString(SOURCES[name], 'image/svg+xml').documentElement;
    const symbol = doc.createElementNS(SVG_NS, 'symbol');
    symbol.setAttribute('id', `i-${name}`);
    symbol.setAttribute('viewBox', src.getAttribute('viewBox') ?? '0 0 16 16');
    for (const child of Array.from(src.childNodes)) {
      if (child.nodeType === 1) symbol.append(doc.importNode(child, true));
    }
    sprite.append(symbol);
  }
  return sprite;
}
